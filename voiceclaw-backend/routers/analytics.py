"""
Analytics Router.

Exposes endpoints for the builder UI to show agent performance,
knowledge gaps, FAQ patterns, and prompt improvement suggestions.
"""

import logging
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from database import get_db
from models import Agent, ConversationTurn, AgentInsight, Session as SessionModel
from services import insights, feedback, prompt_tuner

logger = logging.getLogger("analytics_router")
router = APIRouter()


@router.get("/agent/{agent_id}/analytics/overview")
async def get_analytics_overview(
    agent_id: str,
    days: int = 7,
    db: AsyncSession = Depends(get_db),
):
    """
    High-level analytics overview: total sessions, avg quality,
    top languages, turn distribution.
    """
    try:
        # Verify agent exists
        result = await db.execute(select(Agent).where(Agent.id == agent_id))
        if not result.scalars().first():
            raise HTTPException(status_code=404, detail={"error": "Agent not found"})

        cutoff = datetime.utcnow() - timedelta(days=days)

        # Total sessions
        result = await db.execute(
            select(func.count(func.distinct(ConversationTurn.session_id)))
            .where(
                and_(
                    ConversationTurn.agent_id == agent_id,
                    ConversationTurn.created_at >= cutoff,
                )
            )
        )
        total_sessions = result.scalar() or 0

        # Total turns
        result = await db.execute(
            select(func.count(ConversationTurn.id))
            .where(
                and_(
                    ConversationTurn.agent_id == agent_id,
                    ConversationTurn.created_at >= cutoff,
                )
            )
        )
        total_turns = result.scalar() or 0

        # Average quality score
        avg_score = await feedback.get_agent_average_score(agent_id, days)

        # Top languages
        result = await db.execute(
            select(
                ConversationTurn.source_lang,
                func.count(ConversationTurn.id).label("count"),
            )
            .where(
                and_(
                    ConversationTurn.agent_id == agent_id,
                    ConversationTurn.role == "user",
                    ConversationTurn.source_lang.isnot(None),
                    ConversationTurn.created_at >= cutoff,
                )
            )
            .group_by(ConversationTurn.source_lang)
            .order_by(func.count(ConversationTurn.id).desc())
            .limit(5)
        )
        top_languages = [{"lang": row[0], "count": row[1]} for row in result.all()]

        # Tool usage stats
        result = await db.execute(
            select(
                ConversationTurn.tool_called,
                func.count(ConversationTurn.id).label("count"),
            )
            .where(
                and_(
                    ConversationTurn.agent_id == agent_id,
                    ConversationTurn.tool_called.isnot(None),
                    ConversationTurn.created_at >= cutoff,
                )
            )
            .group_by(ConversationTurn.tool_called)
            .order_by(func.count(ConversationTurn.id).desc())
        )
        tool_usage = [{"tool": row[0], "count": row[1]} for row in result.all()]

        # Knowledge gap count
        result = await db.execute(
            select(func.count(AgentInsight.id))
            .where(
                and_(
                    AgentInsight.agent_id == agent_id,
                    AgentInsight.insight_type == "knowledge_gap",
                    AgentInsight.resolved == 0,
                )
            )
        )
        knowledge_gaps = result.scalar() or 0

        # Daily score trend (last N days)
        score_trend = []
        for d in range(days, -1, -1):
            day_start = (datetime.utcnow() - timedelta(days=d)).replace(
                hour=0, minute=0, second=0, microsecond=0
            )
            day_end = day_start + timedelta(days=1)
            result = await db.execute(
                select(func.avg(ConversationTurn.confidence_score))
                .where(
                    and_(
                        ConversationTurn.agent_id == agent_id,
                        ConversationTurn.confidence_score.isnot(None),
                        ConversationTurn.created_at >= day_start,
                        ConversationTurn.created_at < day_end,
                    )
                )
            )
            avg = result.scalar()
            score_trend.append({
                "date": day_start.strftime("%Y-%m-%d"),
                "score": round(float(avg), 1) if avg else None,
            })

        return {
            "total_sessions": total_sessions,
            "total_turns": total_turns,
            "avg_quality_score": avg_score,
            "top_languages": top_languages,
            "tool_usage": tool_usage,
            "knowledge_gaps_count": knowledge_gaps,
            "score_trend": score_trend,
            "period_days": days,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Analytics overview error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": str(e)})


@router.get("/agent/{agent_id}/analytics/insights")
async def get_insights(agent_id: str):
    """Get all unresolved insights for an agent."""
    try:
        result = await insights.get_insights(agent_id, include_resolved=False)
        return {"insights": result}
    except Exception as e:
        logger.error(f"Insights fetch error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": str(e)})


@router.post("/agent/{agent_id}/analytics/insights/{insight_id}/apply")
async def apply_insight(agent_id: str, insight_id: str):
    """Apply a prompt suggestion insight."""
    try:
        success = await prompt_tuner.apply_prompt_suggestion(insight_id)
        if not success:
            raise HTTPException(status_code=400, detail={"error": "Could not apply this insight"})
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Apply insight error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": str(e)})


@router.post("/agent/{agent_id}/analytics/insights/{insight_id}/dismiss")
async def dismiss_insight(agent_id: str, insight_id: str):
    """Dismiss/resolve an insight."""
    try:
        await insights.resolve_insight(insight_id)
        return {"success": True}
    except Exception as e:
        logger.error(f"Dismiss insight error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": str(e)})


@router.post("/agent/{agent_id}/analytics/tune")
async def trigger_prompt_tuning(agent_id: str):
    """Manually trigger prompt tuning analysis for an agent."""
    try:
        suggestion = await prompt_tuner.analyze_and_suggest(agent_id)
        if not suggestion:
            return {"message": "Not enough conversation data to generate suggestions. Need at least 2 sessions with quality scores."}
        return {"suggestion": suggestion}
    except Exception as e:
        logger.error(f"Prompt tuning error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": str(e)})


@router.post("/agent/{agent_id}/analytics/mine-faqs")
async def trigger_faq_mining(agent_id: str):
    """Manually trigger FAQ pattern mining."""
    try:
        new_patterns = await insights.mine_faq_patterns(agent_id)
        return {"new_patterns": new_patterns, "count": len(new_patterns)}
    except Exception as e:
        logger.error(f"FAQ mining error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": str(e)})
