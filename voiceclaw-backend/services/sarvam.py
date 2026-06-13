import base64
import logging
import httpx
from config import settings

logger = logging.getLogger("sarvam_service")

class SarvamAPIError(Exception):
    def __init__(self, message: str, detail: str = ""):
        super().__init__(message)
        self.detail = detail

async def speech_to_text_translate(audio_bytes: bytes, audio_format: str = None) -> dict:
    if audio_format is None:
        audio_format = settings.DEFAULT_AUDIO_FORMAT
    url = f"{settings.SARVAM_BASE_URL}/speech-to-text-translate"
    headers = {
        "API-Subscription-Key": settings.SARVAM_API_KEY
    }
    files = {
        "file": (f"audio.{audio_format}", audio_bytes, f"audio/{audio_format}")
    }
    data = {
        "model": settings.SARVAM_STT_MODEL
    }
    
    try:
        async with httpx.AsyncClient(timeout=settings.SARVAM_API_TIMEOUT) as client:
            response = await client.post(url, headers=headers, files=files, data=data)
            if response.status_code != 200:
                raise SarvamAPIError(f"Sarvam STT API returned status {response.status_code}", response.text)
            
            result = response.json()
            return {
                "transcript": result.get("transcript", ""),
                "source_language_code": result.get("source_language_code", "")
            }
    except httpx.HTTPError as e:
        logger.error(f"HTTP error in speech_to_text_translate: {e}")
        raise SarvamAPIError("Network error calling Sarvam STT API", str(e))
    except Exception as e:
        logger.error(f"Unexpected error in speech_to_text_translate: {e}")
        raise SarvamAPIError("Unexpected error calling Sarvam STT API", str(e))

async def text_to_speech(text: str, target_language_code: str, speaker: str = None, dict_id: str = None) -> bytes:
    if speaker is None:
        speaker = settings.SARVAM_TTS_SPEAKER
    url = f"{settings.SARVAM_BASE_URL}/text-to-speech"
    headers = {
        "API-Subscription-Key": settings.SARVAM_API_KEY,
        "Content-Type": "application/json"
    }
    payload = {
        "inputs": [text],
        "target_language_code": target_language_code,
        "speaker": speaker,
        "model": settings.SARVAM_TTS_MODEL,
        "enable_preprocessing": True
    }
    # Include pronunciation dictionary if provided (requires bulbul:v3)
    if dict_id:
        payload["dict_id"] = dict_id
    
    try:
        async with httpx.AsyncClient(timeout=settings.SARVAM_API_TIMEOUT) as client:
            response = await client.post(url, headers=headers, json=payload)
            if response.status_code != 200:
                raise SarvamAPIError(f"Sarvam TTS API returned status {response.status_code}", response.text)
            
            content_type = response.headers.get("content-type", "")
            if "application/json" in content_type:
                data = response.json()
                audio_base64 = data.get("audio_base64", "")
                if not audio_base64:
                    raise SarvamAPIError("Missing audio_base64 in JSON response", response.text)
                return base64.b64decode(audio_base64)
            else:
                return response.content
    except httpx.HTTPError as e:
        logger.error(f"HTTP error in text_to_speech: {e}")
        raise SarvamAPIError("Network error calling Sarvam TTS API", str(e))
    except Exception as e:
        logger.error(f"Unexpected error in text_to_speech: {e}")
        raise SarvamAPIError("Unexpected error calling Sarvam TTS API", str(e))

async def translate_text(text: str, source_language_code: str, target_language_code: str) -> str:
    url = f"{settings.SARVAM_BASE_URL}/translate"
    headers = {
        "API-Subscription-Key": settings.SARVAM_API_KEY,
        "Content-Type": "application/json"
    }
    payload = {
        "input": text,
        "source_language_code": source_language_code,
        "target_language_code": target_language_code,
        "model": settings.SARVAM_TRANSLATE_MODEL
    }
    
    try:
        async with httpx.AsyncClient(timeout=settings.SARVAM_API_TIMEOUT) as client:
            response = await client.post(url, headers=headers, json=payload)
            if response.status_code != 200:
                raise SarvamAPIError(f"Sarvam Translate API returned status {response.status_code}", response.text)
            
            result = response.json()
            translated = result.get("translated_text", "")
            if not translated:
                translated = result.get("translatedText", "")
            if not translated and "outputs" in result:
                outputs = result["outputs"]
                if isinstance(outputs, list) and len(outputs) > 0:
                    translated = outputs[0]
            if not translated:
                translated = result.get("output", text)
            
            return translated
    except httpx.HTTPError as e:
        logger.error(f"HTTP error in translate_text: {e}")
        raise SarvamAPIError("Network error calling Sarvam Translate API", str(e))
    except Exception as e:
        logger.error(f"Unexpected error in translate_text: {e}")
        raise SarvamAPIError("Unexpected error calling Sarvam Translate API", str(e))

async def identify_language(text: str) -> str:
    url = f"{settings.SARVAM_BASE_URL}/text-lid"
    headers = {
        "API-Subscription-Key": settings.SARVAM_API_KEY,
        "Content-Type": "application/json"
    }
    payload = {
        "input": text
    }
    
    try:
        async with httpx.AsyncClient(timeout=settings.SARVAM_LID_TIMEOUT) as client:
            response = await client.post(url, headers=headers, json=payload)
            if response.status_code != 200:
                raise SarvamAPIError(f"Sarvam LID API returned status {response.status_code}", response.text)
            
            result = response.json()
            lang_code = result.get("language_code", "")
            if not lang_code and "languages" in result:
                langs = result["languages"]
                if isinstance(langs, list) and len(langs) > 0:
                    lang_code = langs[0].get("language_code", "")
            
            if not lang_code:
                lang_code = settings.DEFAULT_LANGUAGE_CODE
            
            return lang_code
    except httpx.HTTPError as e:
        logger.error(f"HTTP error in identify_language: {e}")
        raise SarvamAPIError("Network error calling Sarvam LID API", str(e))
    except Exception as e:
        logger.error(f"Unexpected error in identify_language: {e}")
        raise SarvamAPIError("Unexpected error calling Sarvam LID API", str(e))
