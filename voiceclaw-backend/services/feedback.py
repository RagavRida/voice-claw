"""
Implicit Feedback Analysis Service.

Since voice users can't click thumbs-up/down, we detect conversation quality
from behavioral signals: repeated questions, escalation language, session
length, tool success, and language confusion.
"""

import logging
from datetime import datetime, timedelta
from sqlalchemy import select, func, and_
from database import AsyncSessionLocal
from models import ConversationTurn, Session as SessionModel

logger = logging.getLogger("feedback")

# ── Signal Definitions ────────────────────────────────────────────────────────

ESCALATION_PHRASES = [
    "talk to a human", "speak to someone", "real person", "manager",
    "I don't understand", "you're not helping", "this isn't working",
    "wrong answer", "that's not right", "you said the same thing",
    "stop repeating", "connect me to", "transfer me",
    # Hindi equivalents
    "insaan se baat", "koi aur bhejo", "samajh nahi aa raha",
    "galat jawab", "ye sahi nahi hai",
]

HEDGING_PHRASES = [
    "i'm not sure", "i don't have information",
    "i couldn't find", "i'm unable to",
    "unfortunately, i don't", "i apologize, but i cannot",
    "that information is not available",
    "based on the information i have",
    "i would need more details",
]


async def analyze_session(session_id: str) -> dict:
    """
    Analyze a completed session and compute a quality score (0-10).
    
    Returns:
        {
            "session_id": str,
            "quality_score": int (0-10),
            "signals": [{"type": str, "impact": int, "detail": str}],
            "turn_count": int,
        }
    """
    signals = []
    score = 7  # Start at 7 (decent baseline)

    async with AsyncSessionLocal() as db:
        # Fetch all turns for this session
        result = await db.execute(
            select(ConversationTurn)
            .where(ConversationTurn.session_id == session_id)
            .order_by(ConversationTurn.created_at)
        )
        turns = result.scalars().all()

        if not turns:
            return {"session_id": session_id, "quality_score": 5, "signals": [], "turn_count": 0}

        user_turns = [t for t in turns if t.role == "user"]
        assistant_turns = [t for t in turns if t.role == "assistant"]
        turn_count = len(turns)

        # ── Signal 1: Fast resolution (1-2 user turns = good) ──────────────
        if len(user_turns) <= 2 and any(t.tool_called for t in assistant_turns):
            signals.append({"type": "fast_resolution", "impact": +1, "detail": f"Resolved in {len(user_turns)} user turns with tool action"})
            score += 1
        elif len(user_turns) == 1:
            signals.append({"type": "single_turn", "impact": +1, "detail": "Single-turn resolution"})
            score += 1

        # ── Signal 2: Long session without resolution ──────────────────────
        if len(user_turns) > 8 and not any(t.tool_called for t in assistant_turns):
            signals.append({"type": "long_unresolved", "impact": -1, "detail": f"{len(user_turns)} user turns with no tool call"})
            score -= 1

        # ── Signal 3: Repeated questions ───────────────────────────────────
        repeat_count = _count_repeated_questions(user_turns)
        if repeat_count > 0:
            impact = min(repeat_count * -1, -3)  # Cap at -3
            signals.append({"type": "repeated_questions", "impact": impact, "detail": f"User repeated {repeat_count} question(s)"})
            score += impact

        # ── Signal 4: Escalation language ──────────────────────────────────
        escalation_count = 0
        for turn in user_turns:
            content_lower = turn.content.lower()
            if any(phrase in content_lower for phrase in ESCALATION_PHRASES):
                escalation_count += 1
        if escalation_count > 0:
            impact = min(escalation_count * -2, -4)
            signals.append({"type": "escalation", "impact": impact, "detail": f"User escalated {escalation_count} time(s)"})
            score += impact

        # ── Signal 5: Agent hedging / no-context ───────────────────────────
        hedge_count = 0
        no_context_count = sum(1 for t in assistant_turns if t.rag_context_found == 0)
        for turn in assistant_turns:
            content_lower = turn.content.lower()
            if any(phrase in content_lower for phrase in HEDGING_PHRASES):
                hedge_count += 1
        if hedge_count > 0 or no_context_count > 0:
            impact = -min(hedge_count + no_context_count, 3)
            signals.append({"type": "knowledge_gap", "impact": impact, "detail": f"Agent hedged {hedge_count}x, no-context {no_context_count}x"})
            score += impact

        # ── Signal 6: Successful tool call ─────────────────────────────────
        successful_tools = sum(1 for t in assistant_turns if t.tool_called and t.tool_result and "error" not in (t.tool_result or "").lower())
        if successful_tools > 0:
            impact = min(successful_tools * 2, 4)
            signals.append({"type": "tool_success", "impact": impact, "detail": f"{successful_tools} successful tool call(s)"})
            score += impact

        # ── Signal 7: Language switch confusion ────────────────────────────
        if len(user_turns) >= 2:
            langs = [t.source_lang for t in user_turns if t.source_lang]
            unique_langs = set(langs)
            if len(unique_langs) > 1:
                # Check if assistant responded in wrong language (heuristic)
                signals.append({"type": "language_switch", "impact": 0, "detail": f"User switched between {unique_langs}"})

        # Clamp score to 0-10
        score = max(0, min(10, score))

        # Update turns with the computed score
        for turn in turns:
            turn.confidence_score = score
        await db.commit()

    return {
        "session_id": session_id,
        "quality_score": score,
        "signals": signals,
        "turn_count": turn_count,
    }


def _count_repeated_questions(user_turns: list) -> int:
    """
    Count how many times a user essentially repeated themselves.
    Uses simple substring overlap as a fast heuristic.
    """
    if len(user_turns) < 2:
        return 0

    count = 0
    for i in range(1, len(user_turns)):
        prev = user_turns[i - 1].content.lower().strip()
        curr = user_turns[i].content.lower().strip()

        # Exact or near-exact repeat
        if curr == prev:
            count += 1
            continue

        # Significant overlap (>60% of words shared)
        prev_words = set(prev.split())
        curr_words = set(curr.split())
        if prev_words and curr_words:
            overlap = len(prev_words & curr_words) / max(len(prev_words), len(curr_words))
            if overlap > 0.6:
                count += 1

    return count


async def get_agent_average_score(agent_id: str, days: int = 7) -> float:
    """Get the average quality score for an agent over the last N days."""
    async with AsyncSessionLocal() as db:
        cutoff = datetime.utcnow() - timedelta(days=days)
        result = await db.execute(
            select(func.avg(ConversationTurn.confidence_score))
            .where(
                and_(
                    ConversationTurn.agent_id == agent_id,
                    ConversationTurn.confidence_score.isnot(None),
                    ConversationTurn.created_at >= cutoff,
                )
            )
        )
        avg = result.scalar()
        return round(float(avg), 1) if avg else 7.0
