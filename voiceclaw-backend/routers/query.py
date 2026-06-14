import logging
import asyncio
import time
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_db
from models import Agent
from services import rag
from services.composio_tools import get_tools_for_agent, execute_tool_call
from services.conversation_log import log_exchange, LatencyTracker
from services import insights as insights_service
from config import settings

# For Gemini tool dispatch
from google import genai
from google.genai import types

logger = logging.getLogger("query_router")
router = APIRouter()

class QueryRequest(BaseModel):
    text: str
    source_lang: str
    agent_id: str
    session_id: Optional[str] = None
    history: Optional[List[Dict[str, Any]]] = []
    enabled_connectors: Optional[List[str]] = []

@router.post("/query")
async def query_agent(
    request: QueryRequest,
    db: AsyncSession = Depends(get_db)
):
    latency = LatencyTracker()
    tool_called = None
    tool_result_text = None
    rag_context_found = True

    try:
        with latency:
            # 1. Load agent config from DB to check existence
            result = await db.execute(select(Agent).where(Agent.id == request.agent_id))
            agent = result.scalars().first()
            if not agent:
                raise HTTPException(status_code=404, detail={"error": "Agent not found"})
                
            # 2. Get composio tools
            composio_tools = await get_tools_for_agent(request.agent_id)
            
            # Use Gemini as the reasoning layer for tool dispatch if tools exist.
            # DEPRECATED: Removed to eliminate 2-4s latency penalty. RAG model handles intent via <action> tags.
            pass

            # 3. Call rag.query_knowledge_base
            answer_text = await rag.query_knowledge_base(
                agent_id=request.agent_id,
                query_text=request.text,
                history=request.history,
                enabled_connectors=request.enabled_connectors or [],
                source_lang=request.source_lang or "en-IN"
            )

        # 4. Fire-and-forget: Log the conversation turn
        asyncio.create_task(
            log_exchange(
                agent_id=request.agent_id,
                session_id=request.session_id,
                user_text=request.text,
                assistant_text=answer_text,
                source_lang=request.source_lang or "en-IN",
                tool_called=tool_called,
                tool_result=tool_result_text,
                latency_ms=latency.latency_ms,
                rag_context_found=rag_context_found,
            )
        )

        # 5. Fire-and-forget: Check for hedging / knowledge gaps in the response
        asyncio.create_task(
            insights_service.detect_hedging_in_response(
                agent_id=request.agent_id,
                query_text=request.text,
                response_text=answer_text,
            )
        )
        
        # 6. Return response matching frontend contract
        return {
            "answer_text": answer_text,
            "agent_id": request.agent_id
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected query error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "Server error", "detail": str(e)})
