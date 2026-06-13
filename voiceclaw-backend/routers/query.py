import logging
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_db
from models import Agent, Session as SessionModel
from services import rag

logger = logging.getLogger("query_router")

router = APIRouter()

class QueryRequest(BaseModel):
    text: str
    source_lang: str
    agent_id: str
    history: Optional[List[Dict[str, Any]]] = []
    enabled_connectors: Optional[List[str]] = []

@router.post("/query")
async def query_agent(
    request: QueryRequest,
    db: AsyncSession = Depends(get_db)
):
    try:
        # 1. Load agent config from DB to check existence
        result = await db.execute(select(Agent).where(Agent.id == request.agent_id))
        agent = result.scalars().first()
        if not agent:
            logger.error(f"Query request failed: agent {request.agent_id} not found.")
            raise HTTPException(status_code=404, detail={"error": "Not found"})
            
        # Optional: Increment or track session metrics
        # (This handles session logging if needed, but the primary task is to run the RAG query)
        
        # 2. Call rag.query_knowledge_base
        answer_text = await rag.query_knowledge_base(
            agent_id=request.agent_id,
            query_text=request.text,
            history=request.history,
            enabled_connectors=request.enabled_connectors or []
        )
        
        # 3. Return response matching exact frontend contract
        return {
            "answer_text": answer_text,
            "agent_id": request.agent_id
        }
        
    except HTTPException:
        raise
    except rag.RAGError as e:
        logger.error(f"RAG engine error: {e}")
        raise HTTPException(status_code=502, detail={"error": "Sarvam API error", "detail": str(e)})
    except Exception as e:
        logger.error(f"Unexpected query error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "Database error", "detail": str(e)})
