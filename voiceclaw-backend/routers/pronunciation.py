import logging
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Dict, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_db
from models import Agent
from services import pronunciation

logger = logging.getLogger("pronunciation_router")

router = APIRouter()


class CreateDictRequest(BaseModel):
    agent_id: str
    pronunciations: Dict[str, Dict[str, str]]
    """Language-scoped word→pronunciation map.
    Example: {"hi-IN": {"B2B": "B to B"}, "en-IN": {"HDFC": "H D F C"}}
    """


class UpdateDictRequest(BaseModel):
    pronunciations: Dict[str, Dict[str, str]]


@router.post("/pronunciation-dictionary")
async def create_pronunciation_dictionary(
    request: CreateDictRequest,
    db: AsyncSession = Depends(get_db),
):
    """Create a pronunciation dictionary on Sarvam and link it to an agent."""
    try:
        # Verify agent exists
        result = await db.execute(select(Agent).where(Agent.id == request.agent_id))
        agent = result.scalars().first()
        if not agent:
            raise HTTPException(status_code=404, detail={"error": "Agent not found"})

        # If agent already has a dict_id, delete the old one first
        if agent.dict_id:
            try:
                await pronunciation.delete_dictionary(agent.dict_id)
                logger.info(f"Deleted old dict {agent.dict_id} for agent {request.agent_id}")
            except Exception as e:
                logger.warning(f"Failed to delete old dict {agent.dict_id}: {e}")

        # Create new dictionary
        dict_id = await pronunciation.create_dictionary(request.pronunciations)

        # Save to agent record
        agent.dict_id = dict_id
        await db.commit()

        return {
            "dict_id": dict_id,
            "agent_id": request.agent_id,
        }
    except HTTPException:
        raise
    except pronunciation.PronunciationError as e:
        logger.error(f"Pronunciation API error: {e}")
        raise HTTPException(status_code=502, detail={"error": "Sarvam API error", "detail": str(e)})
    except Exception as e:
        logger.error(f"Error creating pronunciation dictionary: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "Server error", "detail": str(e)})


@router.get("/pronunciation-dictionary/list")
async def list_pronunciation_dictionaries():
    """List all pronunciation dictionaries for this Sarvam account."""
    try:
        data = await pronunciation.list_dictionaries()
        return data
    except pronunciation.PronunciationError as e:
        logger.error(f"Pronunciation API error: {e}")
        raise HTTPException(status_code=502, detail={"error": "Sarvam API error", "detail": str(e)})
    except Exception as e:
        logger.error(f"Error listing pronunciation dictionaries: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "Server error", "detail": str(e)})


@router.get("/pronunciation-dictionary/{dict_id}")
async def get_pronunciation_dictionary(dict_id: str):
    """Get full pronunciation mappings for a specific dictionary."""
    try:
        data = await pronunciation.get_dictionary(dict_id)
        return data
    except pronunciation.PronunciationError as e:
        logger.error(f"Pronunciation API error: {e}")
        raise HTTPException(status_code=502, detail={"error": "Sarvam API error", "detail": str(e)})
    except Exception as e:
        logger.error(f"Error getting pronunciation dictionary: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "Server error", "detail": str(e)})


@router.put("/pronunciation-dictionary/{dict_id}")
async def update_pronunciation_dictionary(
    dict_id: str,
    request: UpdateDictRequest,
):
    """Update an existing pronunciation dictionary (additive merge)."""
    try:
        data = await pronunciation.update_dictionary(dict_id, request.pronunciations)
        return data
    except pronunciation.PronunciationError as e:
        logger.error(f"Pronunciation API error: {e}")
        raise HTTPException(status_code=502, detail={"error": "Sarvam API error", "detail": str(e)})
    except Exception as e:
        logger.error(f"Error updating pronunciation dictionary: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "Server error", "detail": str(e)})


@router.delete("/pronunciation-dictionary/{dict_id}")
async def delete_pronunciation_dictionary(
    dict_id: str,
    agent_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """Delete a pronunciation dictionary. Optionally unlink from an agent."""
    try:
        data = await pronunciation.delete_dictionary(dict_id)

        # If agent_id provided, clear the dict_id from that agent
        if agent_id:
            result = await db.execute(select(Agent).where(Agent.id == agent_id))
            agent = result.scalars().first()
            if agent and agent.dict_id == dict_id:
                agent.dict_id = None
                await db.commit()

        return data
    except pronunciation.PronunciationError as e:
        logger.error(f"Pronunciation API error: {e}")
        raise HTTPException(status_code=502, detail={"error": "Sarvam API error", "detail": str(e)})
    except Exception as e:
        logger.error(f"Error deleting pronunciation dictionary: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "Server error", "detail": str(e)})
