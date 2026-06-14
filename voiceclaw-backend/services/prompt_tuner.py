"""
Automatic Prompt Tuner.

Analyzes failed conversations periodically and uses Gemini to suggest
specific improvements to the agent's system prompt. Business owners
can apply suggestions with a single click.
"""

import logging
import asyncio
from datetime import datetime, timedelta
from sqlalchemy import select, func, and_
from database import AsyncSessionLocal
from models import ConversationTurn, AgentInsight, Agent, Session as SessionModel
from config import settings

logger = logging.getLogger("prompt_tuner")

META_PROMPT = """You are an AI prompt engineering expert. You are analyzing conversations from a voice AI agent that answers customer queries for a business.

Below are transcripts from the WORST-PERFORMING conversations (lowest quality scores). The agent struggled with these interactions.

Current System Prompt:
---
{current_prompt}
---

Failed Conversation Transcripts:
{transcripts}

Based on these failures, suggest SPECIFIC improvements to the system prompt. Your suggestions should:
1. Address the exact failure patterns you see (e.g., the agent hedges on pricing questions → add explicit pricing instructions)
2. Be concrete — don't say "be more helpful", say exactly what to add/change
3. Preserve the existing capabilities while fixing the gaps
4. Keep the prompt concise — don't bloat it with unnecessary instructions

Output a JSON object with this schema:
{{
  "analysis": "Brief analysis of what went wrong (2-3 sentences)",
  "changes": [
    {{
      "type": "add" | "modify" | "remove",
      "description": "What to change and why",
      "before": "The text to replace (if modify/remove)",
      "after": "The new text (if add/modify)"
    }}
  ],
  "revised_prompt": "The complete revised system prompt incorporating all changes"
}}

Output ONLY the JSON, no markdown fences."""


async def analyze_and_suggest(agent_id: str, days: int = 7, max_sessions: int = 5) -> dict | None:
    """
    Pull the lowest-scoring sessions for an agent, analyze them with Gemini,
    and generate a prompt improvement suggestion.
    
    Returns the suggestion dict or None if not enough data.
    """
    try:
        async with AsyncSessionLocal() as db:
            # 1. Get agent info
            result = await db.execute(select(Agent).where(Agent.id == agent_id))
            agent = result.scalars().first()
            if not agent:
                return None

            # 2. Find the worst sessions (lowest avg confidence_score)
            cutoff = datetime.utcnow() - timedelta(days=days)
            result = await db.execute(
                select(
                    ConversationTurn.session_id,
                    func.avg(ConversationTurn.confidence_score).label("avg_score"),
                    func.count(ConversationTurn.id).label("turn_count"),
                )
                .where(
                    and_(
                        ConversationTurn.agent_id == agent_id,
                        ConversationTurn.confidence_score.isnot(None),
                        ConversationTurn.created_at >= cutoff,
                    )
                )
                .group_by(ConversationTurn.session_id)
                .having(func.count(ConversationTurn.id) >= 2)  # At least 2 turns
                .order_by(func.avg(ConversationTurn.confidence_score))
                .limit(max_sessions)
            )
            worst_sessions = result.all()

            if len(worst_sessions) < 2:
                logger.info(f"Not enough data for prompt tuning on agent {agent_id}")
                return None

            # 3. Fetch full transcripts for worst sessions
            transcripts = []
            for session_row in worst_sessions:
                session_id = session_row[0]
                avg_score = round(float(session_row[1]), 1)

                result = await db.execute(
                    select(ConversationTurn)
                    .where(ConversationTurn.session_id == session_id)
                    .order_by(ConversationTurn.created_at)
                )
                turns = result.scalars().all()

                transcript_lines = [f"--- Session (quality: {avg_score}/10) ---"]
                for turn in turns:
                    role_label = "Customer" if turn.role == "user" else "Agent"
                    transcript_lines.append(f"{role_label}: {turn.content}")
                    if turn.tool_called:
                        transcript_lines.append(f"  [Tool: {turn.tool_called} → {(turn.tool_result or 'no result')[:200]}]")

                transcripts.append("\n".join(transcript_lines))

            if not transcripts:
                return None

            # 4. Build the current system prompt (reconstruct from agent config)
            current_prompt = settings.RAG_SYSTEM_PROMPT_TEMPLATE.format(
                business_name=agent.business_name
            )
            if agent.restrictions:
                current_prompt += f" Restrictions: {agent.restrictions}"

            # 5. Call Gemini for analysis
            from google import genai

            client = genai.Client(api_key=settings.GEMINI_API_KEY)
            prompt = META_PROMPT.format(
                current_prompt=current_prompt,
                transcripts="\n\n".join(transcripts),
            )

            response = await asyncio.to_thread(
                client.models.generate_content,
                model=settings.GEMINI_MODEL,
                contents=prompt,
            )

            if not response or not response.text:
                return None

            # Parse the JSON response
            import json
            text = response.text.strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()

            suggestion = json.loads(text)

            # 6. Store as an AgentInsight
            insight = AgentInsight(
                agent_id=agent_id,
                insight_type="prompt_suggestion",
                content={
                    "analysis": suggestion.get("analysis", ""),
                    "changes": suggestion.get("changes", []),
                    "revised_prompt": suggestion.get("revised_prompt", ""),
                    "sessions_analyzed": len(worst_sessions),
                    "avg_score_of_failures": round(
                        sum(float(s[1]) for s in worst_sessions) / len(worst_sessions), 1
                    ),
                },
                frequency=1,
            )
            db.add(insight)
            await db.commit()

            logger.info(f"Generated prompt suggestion for agent {agent_id}: {suggestion.get('analysis', '')[:100]}")
            return suggestion

    except Exception as e:
        logger.error(f"Prompt tuning failed for agent {agent_id}: {e}", exc_info=True)
        return None


async def apply_prompt_suggestion(insight_id: str) -> bool:
    """
    Apply a prompt_suggestion insight by updating the agent's restrictions
    field (which is appended to the system prompt).
    """
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(AgentInsight).where(AgentInsight.id == insight_id)
            )
            insight = result.scalars().first()
            if not insight or insight.insight_type != "prompt_suggestion":
                return False

            revised = insight.content.get("revised_prompt", "")
            if not revised:
                return False

            # Update agent restrictions with the improved instructions
            result = await db.execute(
                select(Agent).where(Agent.id == insight.agent_id)
            )
            agent = result.scalars().first()
            if not agent:
                return False

            # Append improvement note to restrictions
            improvement_note = "\n\n[Auto-tuned improvement applied on {}]\n{}".format(
                datetime.utcnow().strftime("%Y-%m-%d"),
                "\n".join(
                    f"- {c.get('description', '')}"
                    for c in insight.content.get("changes", [])
                ),
            )
            agent.restrictions = (agent.restrictions or "") + improvement_note

            # Mark insight as resolved
            insight.resolved = 1
            await db.commit()

            logger.info(f"Applied prompt suggestion {insight_id} to agent {insight.agent_id}")
            return True

    except Exception as e:
        logger.error(f"Failed to apply prompt suggestion {insight_id}: {e}", exc_info=True)
        return False
