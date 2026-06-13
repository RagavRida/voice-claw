import logging
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from config import settings
from services import sarvam

logger = logging.getLogger("stt_router")

router = APIRouter()

@router.post("/stt")
async def speech_to_text(
    audio: UploadFile = File(...),
    agent_id: str = Form(...),
    db: AsyncSession = Depends(get_db)
):
    try:
        audio_bytes = await audio.read()
        if not audio_bytes:
            raise HTTPException(status_code=400, detail={"error": "Invalid file", "detail": "Audio file is empty"})
            
        # Parse format from filename or content type
        audio_format = settings.DEFAULT_AUDIO_FORMAT
        filename = audio.filename or ""
        if "." in filename:
            audio_format = filename.split(".")[-1]
        elif audio.content_type:
            audio_format = audio.content_type.split("/")[-1]
            
        # Call Sarvam AI STT (transcribe mode — preserves original language)
        result = await sarvam.speech_to_text_translate(audio_bytes, audio_format=audio_format)

        transcript = result.get("transcript", "")
        source_lang = result.get("source_language_code", "")

        # Refine language detection using Sarvam Language ID on the transcribed text.
        # This handles code-mixed speech (Hinglish, Tenglish) more accurately than STT alone.
        if transcript and (not source_lang or source_lang in ("unknown", "")):
            try:
                source_lang = await sarvam.identify_language(transcript)
                logger.info(f"Language ID refined source_lang to: {source_lang}")
            except Exception as lid_err:
                logger.warning(f"Language ID fallback failed: {lid_err}")
                source_lang = settings.DEFAULT_LANGUAGE_CODE

        # Fallback if still empty
        if not source_lang:
            source_lang = settings.DEFAULT_LANGUAGE_CODE

        return {
            "text": transcript,
            "source_lang": source_lang,
            "agent_id": agent_id
        }
    except sarvam.SarvamAPIError as e:
        logger.error(f"Sarvam API error in STT: {e.detail}")
        raise HTTPException(status_code=502, detail={"error": "Sarvam API error", "detail": str(e)})
    except Exception as e:
        logger.error(f"Unexpected error in STT router: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "Server error", "detail": str(e)})
