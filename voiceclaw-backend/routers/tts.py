import io
import logging
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_db
from config import settings
from models import Agent
from services import sarvam

logger = logging.getLogger("tts_router")

router = APIRouter()

class TTSRequest(BaseModel):
    text: str
    source_lang: str
    agent_id: str

@router.post("/tts")
async def text_to_speech_stream(
    request: TTSRequest,
    db: AsyncSession = Depends(get_db)
):
    try:
        # Standardize source language to match Sarvam target_language_code format (e.g. hi-IN)
        target_lang = request.source_lang
        # If it's a simple two-letter code, append -IN (e.g. te -> te-IN)
        if len(target_lang) == 2:
            target_lang = f"{target_lang}-IN"

        # Look up agent to get dict_id (pronunciation dictionary)
        dict_id = None
        result = await db.execute(select(Agent).where(Agent.id == request.agent_id))
        agent = result.scalars().first()
        if agent and agent.dict_id:
            dict_id = agent.dict_id

        # Generate speech audio bytes
        audio_bytes = await sarvam.text_to_speech(
            text=request.text,
            target_language_code=target_lang,
            speaker=settings.SARVAM_TTS_SPEAKER,
            dict_id=dict_id,
        )
        
        return StreamingResponse(
            io.BytesIO(audio_bytes),
            media_type="audio/wav",
            headers={"Content-Disposition": "inline"}
        )
    except sarvam.SarvamAPIError as e:
        logger.error(f"Sarvam API error in TTS stream: {e.detail}")
        raise HTTPException(status_code=502, detail={"error": "Sarvam API error", "detail": str(e)})
    except Exception as e:
        logger.error(f"Unexpected error in TTS router: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "Server error", "detail": str(e)})
