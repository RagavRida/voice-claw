"""
Insights Service.

Detects knowledge gaps, mines FAQ patterns, and stores actionable
insights for the business owner to review in the builder UI.
"""

import logging
from datetime import datetime, timedelta
from sqlalchemy import select, func, and_
from database import AsyncSessionLocal
from models import ConversationTurn, AgentInsight, Agent

logger = logging.getLogger("insights")

# ── Hedging patterns that indicate knowledge gaps ─────────────────────────────

HEDGING_PATTERNS = [
    "i'm not sure", "i don't have information", "i couldn't find",
    "unfortunately, i don't", "i apologize, but i cannot",
    "that information is not available", "i don't have that",
    "i'm unable to answer", "i would need more details",
    "based on the information i have, i cannot",
]


async def flag_knowledge_gap(agent_id: str, query_text: str):
    """
    Called when the RAG retriever returns no relevant context.
    Creates or increments a knowledge_gap insight.
    """
    try:
        async with AsyncSessionLocal() as db:
            # Check if we already have a similar gap logged
            result = await db.execute(
                select(AgentInsight).where(
                    and_(
                        AgentInsight.agent_id == agent_id,
                        AgentInsight.insight_type == "knowledge_gap",
                        AgentInsight.resolved == 0,
                    )
                )
            )
            existing_insights = result.scalars().all()

            # Simple dedup: check if any existing gap has >50% word overlap
            query_words = set(query_text.lower().split())
            matched_insight = None

            for insight in existing_insights:
                existing_q = insight.content.get("question", "").lower()
                existing_words = set(existing_q.split())
                if existing_words and query_words:
                    overlap = len(query_words & existing_words) / max(len(query_words), len(existing_words))
                    if overlap > 0.5:
                        matched_insight = insight
                        break

            if matched_insight:
                # Increment frequency
                matched_insight.frequency = (matched_insight.frequency or 1) + 1
                matched_insight.last_seen = datetime.utcnow()
                # Add this variant to the questions list
                questions = matched_insight.content.get("questions", [matched_insight.content.get("question", "")])
                if query_text not in questions:
                    questions.append(query_text)
                    matched_insight.content = {**matched_insight.content, "questions": questions[-10:]}  # Keep last 10
            else:
                # Create new gap
                new_insight = AgentInsight(
                    agent_id=agent_id,
                    insight_type="knowledge_gap",
                    content={
                        "question": query_text,
                        "questions": [query_text],
                        "first_seen": datetime.utcnow().isoformat(),
                    },
                    frequency=1,
                )
                db.add(new_insight)

            await db.commit()
            logger.info(f"Knowledge gap flagged for agent {agent_id}: '{query_text[:80]}...'")

    except Exception as e:
        logger.error(f"Failed to flag knowledge gap: {e}", exc_info=True)


async def detect_hedging_in_response(agent_id: str, query_text: str, response_text: str):
    """
    Check if the assistant response contains hedging language,
    which indicates a knowledge gap even when RAG returned some context.
    """
    response_lower = response_text.lower()
    for pattern in HEDGING_PATTERNS:
        if pattern in response_lower:
            await flag_knowledge_gap(agent_id, query_text)
            return True
    return False


async def mine_faq_patterns(agent_id: str, min_frequency: int = 3):
    """
    Analyze recent user queries to find frequently asked questions.
    Groups similar questions and suggests adding them to the agent's FAQ list.
    """
    try:
        async with AsyncSessionLocal() as db:
            cutoff = datetime.utcnow() - timedelta(days=30)
            result = await db.execute(
                select(ConversationTurn.content)
                .where(
                    and_(
                        ConversationTurn.agent_id == agent_id,
                        ConversationTurn.role == "user",
                        ConversationTurn.created_at >= cutoff,
                    )
                )
                .order_by(ConversationTurn.created_at.desc())
                .limit(500)
            )
            user_queries = [row[0] for row in result.all()]

        if len(user_queries) < min_frequency:
            return []

        # Simple frequency-based clustering using word overlap
        clusters: list[dict] = []
        for query in user_queries:
            query_lower = query.lower().strip()
            if len(query_lower) < 5:
                continue

            query_words = set(query_lower.split())
            matched = False

            for cluster in clusters:
                rep_words = set(cluster["representative"].lower().split())
                if rep_words and query_words:
                    overlap = len(query_words & rep_words) / max(len(query_words), len(rep_words))
                    if overlap > 0.5:
                        cluster["count"] += 1
                        cluster["variants"].append(query)
                        matched = True
                        break

            if not matched:
                clusters.append({
                    "representative": query,
                    "count": 1,
                    "variants": [query],
                })

        # Filter to frequent clusters and create/update insights
        frequent = [c for c in clusters if c["count"] >= min_frequency]
        new_insights = []

        async with AsyncSessionLocal() as db:
            for cluster in frequent[:20]:  # Cap at 20 patterns
                # Check if we already have this FAQ pattern
                result = await db.execute(
                    select(AgentInsight).where(
                        and_(
                            AgentInsight.agent_id == agent_id,
                            AgentInsight.insight_type == "faq_pattern",
                            AgentInsight.resolved == 0,
                        )
                    )
                )
                existing = result.scalars().all()

                already_exists = False
                for ex in existing:
                    ex_q = ex.content.get("question", "").lower()
                    rep_q = cluster["representative"].lower()
                    ex_words = set(ex_q.split())
                    rep_words = set(rep_q.split())
                    if ex_words and rep_words:
                        overlap = len(ex_words & rep_words) / max(len(ex_words), len(rep_words))
                        if overlap > 0.5:
                            ex.frequency = cluster["count"]
                            ex.last_seen = datetime.utcnow()
                            already_exists = True
                            break

                if not already_exists:
                    insight = AgentInsight(
                        agent_id=agent_id,
                        insight_type="faq_pattern",
                        content={
                            "question": cluster["representative"],
                            "frequency": cluster["count"],
                            "variants": cluster["variants"][:5],
                        },
                        frequency=cluster["count"],
                    )
                    db.add(insight)
                    new_insights.append(cluster["representative"])

            await db.commit()

        logger.info(f"Mined {len(new_insights)} new FAQ patterns for agent {agent_id}")
        return new_insights

    except Exception as e:
        logger.error(f"FAQ mining failed for agent {agent_id}: {e}", exc_info=True)
        return []


async def get_insights(agent_id: str, include_resolved: bool = False) -> list[dict]:
    """Fetch all insights for an agent, ordered by frequency descending."""
    try:
        async with AsyncSessionLocal() as db:
            query = select(AgentInsight).where(AgentInsight.agent_id == agent_id)
            if not include_resolved:
                query = query.where(AgentInsight.resolved == 0)
            query = query.order_by(AgentInsight.frequency.desc())

            result = await db.execute(query)
            insights = result.scalars().all()

            return [
                {
                    "id": i.id,
                    "type": i.insight_type,
                    "content": i.content,
                    "frequency": i.frequency,
                    "last_seen": i.last_seen.isoformat() if i.last_seen else None,
                    "resolved": bool(i.resolved),
                    "created_at": i.created_at.isoformat() if i.created_at else None,
                }
                for i in insights
            ]
    except Exception as e:
        logger.error(f"Failed to fetch insights: {e}", exc_info=True)
        return []


async def resolve_insight(insight_id: str):
    """Mark an insight as resolved/dismissed."""
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(AgentInsight).where(AgentInsight.id == insight_id)
            )
            insight = result.scalars().first()
            if insight:
                insight.resolved = 1
                await db.commit()
    except Exception as e:
        logger.error(f"Failed to resolve insight {insight_id}: {e}", exc_info=True)
