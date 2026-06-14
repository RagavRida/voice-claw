"""
Conversation Logging Service.

Fire-and-forget async logging of every conversation turn.
Captures user queries, assistant responses, tool calls, latency,
and context quality for downstream analytics and improvement.
"""

import logging
import time
import uuid
from datetime import datetime
from sqlalchemy import select
from database import AsyncSessionLocal
from models import ConversationTurn, Session as SessionModel

logger = logging.getLogger("conversation_log")


async def log_turn(
    agent_id: str,
    session_id: str | None,
    role: str,
    content: str,
    source_lang: str = "en-IN",
    tool_called: str | None = None,
    tool_result: str | None = None,
    latency_ms: int | None = None,
    rag_context_found: bool = True,
) -> str | None:
    """
    Log a single conversation turn to the database.
    This is designed to be called via asyncio.create_task() so it never blocks the response.
    Returns the turn ID on success, None on failure.
    """
    try:
        async with AsyncSessionLocal() as db:
            # Create or reuse session
            if not session_id:
                session_id = str(uuid.uuid4())
                new_session = SessionModel(
                    id=session_id,
                    agent_id=agent_id,
                    source_lang=source_lang,
                    turn_count=1,
                )
                db.add(new_session)
                await db.flush()  # Ensure session exists before we reference it
            else:
                # Increment turn count for existing session
                result = await db.execute(
                    select(SessionModel).where(SessionModel.id == session_id)
                )
                session = result.scalars().first()
                if session:
                    session.turn_count = (session.turn_count or 0) + 1

            # Create the turn record
            turn = ConversationTurn(
                session_id=session_id,
                agent_id=agent_id,
                role=role,
                content=content[:10000],  # Cap at 10k chars to prevent bloat
                source_lang=source_lang,
                tool_called=tool_called,
                tool_result=tool_result[:2000] if tool_result else None,
                latency_ms=latency_ms,
                rag_context_found=1 if rag_context_found else 0,
            )
            db.add(turn)
            await db.commit()

            logger.debug(f"Logged {role} turn for agent {agent_id}, session {session_id}")
            return turn.id

    except Exception as e:
        logger.error(f"Failed to log conversation turn: {e}", exc_info=True)
        return None


async def log_exchange(
    agent_id: str,
    session_id: str | None,
    user_text: str,
    assistant_text: str,
    source_lang: str = "en-IN",
    tool_called: str | None = None,
    tool_result: str | None = None,
    latency_ms: int | None = None,
    rag_context_found: bool = True,
) -> str | None:
    """
    Convenience: log both the user turn and assistant turn in one call.
    Returns the session_id for reuse.
    """
    if not session_id:
        session_id = str(uuid.uuid4())

    await log_turn(
        agent_id=agent_id,
        session_id=session_id,
        role="user",
        content=user_text,
        source_lang=source_lang,
        rag_context_found=rag_context_found,
    )

    await log_turn(
        agent_id=agent_id,
        session_id=session_id,
        role="assistant",
        content=assistant_text,
        source_lang=source_lang,
        tool_called=tool_called,
        tool_result=tool_result,
        latency_ms=latency_ms,
        rag_context_found=rag_context_found,
    )

    return session_id


class LatencyTracker:
    """Context manager to measure request latency in milliseconds."""

    def __init__(self):
        self.start_time = None
        self.latency_ms = 0

    def __enter__(self):
        self.start_time = time.perf_counter()
        return self

    def __exit__(self, *args):
        elapsed = time.perf_counter() - self.start_time
        self.latency_ms = int(elapsed * 1000)
