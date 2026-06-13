import base64
import logging
import httpx
from config import settings

logger = logging.getLogger("sarvam_service")

class SarvamAPIError(Exception):
    def __init__(self, message: str, detail: str = ""):
        super().__init__(message)
        self.detail = detail

async def speech_to_text_translate(
    audio_bytes: bytes,
    audio_format: str = None,
    prompt: str = None,
) -> dict:
    """
    Transcribe speech audio using Sarvam AI SDK (saaras:v3) with auto language detection.
    Preserves the original language of the speaker for multilingual support.

    Args:
        audio_bytes: Raw audio bytes.
        audio_format: Audio codec format (wav, mp3, webm, etc.). Auto-detected if None.
        prompt: Optional context prompt to boost model accuracy (experimental).
    """
    if audio_format is None:
        audio_format = settings.DEFAULT_AUDIO_FORMAT

    import io
    import asyncio
    from sarvamai import SarvamAI

    try:
        client = SarvamAI(api_subscription_key=settings.SARVAM_API_KEY)

        # Create a file-like object from bytes
        audio_file = io.BytesIO(audio_bytes)
        audio_file.name = f"audio.{audio_format}"

        # Run the synchronous SDK call in a thread to keep async compatibility
        response = await asyncio.to_thread(
            client.speech_to_text.transcribe,
            file=audio_file,
            model="saaras:v3",
        )

        logger.info(f"Sarvam STT SDK response: {response}")

        # The SDK returns an object — extract transcript
        transcript = ""
        source_lang = ""
        if hasattr(response, "transcript"):
            transcript = response.transcript or ""
        elif isinstance(response, dict):
            transcript = response.get("transcript", "")

        if hasattr(response, "source_language_code"):
            source_lang = response.source_language_code or ""
        elif isinstance(response, dict):
            source_lang = response.get("source_language_code", "")

        return {
            "transcript": transcript,
            "source_language_code": source_lang,
        }
    except Exception as e:
        logger.error(f"Sarvam STT SDK error: {e}", exc_info=True)
        raise SarvamAPIError(f"Sarvam STT failed: {e}", str(e))


async def speech_to_text(
    audio_bytes: bytes,
    audio_format: str = None,
    language_code: str = "unknown",
    model: str = None,
) -> dict:
    """
    Transcribe speech audio using Sarvam STT API (same-language output).

    Args:
        audio_bytes: Raw audio bytes.
        audio_format: Audio codec format. Auto-detected if None.
        language_code: BCP-47 language code (e.g. hi-IN). 'unknown' for auto-detect.
        model: STT model to use. Default: saarika:v2.5. Options: saarika:v2.5, saaras:v3.
    """
    if audio_format is None:
        audio_format = settings.DEFAULT_AUDIO_FORMAT
    if model is None:
        model = settings.SARVAM_STT_MODEL

    url = f"{settings.SARVAM_BASE_URL}/speech-to-text"
    headers = {
        "API-Subscription-Key": settings.SARVAM_API_KEY
    }
    files = {
        "file": (f"audio.{audio_format}", audio_bytes, f"audio/{audio_format}")
    }
    data = {
        "model": model,
        "language_code": language_code,
    }

    try:
        async with httpx.AsyncClient(timeout=settings.SARVAM_API_TIMEOUT) as client:
            response = await client.post(url, headers=headers, files=files, data=data)
            if response.status_code != 200:
                raise SarvamAPIError(f"Sarvam STT API returned status {response.status_code}", response.text)

            result = response.json()
            return {
                "transcript": result.get("transcript", ""),
                "language_code": result.get("language_code", language_code),
            }
    except httpx.HTTPError as e:
        logger.error(f"HTTP error in speech_to_text: {e}")
        raise SarvamAPIError("Network error calling Sarvam STT API", str(e))
    except Exception as e:
        logger.error(f"Unexpected error in speech_to_text: {e}")
        raise SarvamAPIError("Unexpected error calling Sarvam STT API", str(e))


async def text_to_speech(
    text: str,
    target_language_code: str,
    speaker: str = None,
    dict_id: str = None,
    pace: float = None,
    temperature: float = None,
    speech_sample_rate: int = None,
    enable_cached_responses: bool = None,
) -> bytes:
    """
    Convert text to speech audio using Sarvam AI SDK (bulbul:v3).

    Args:
        text: Text to synthesize.
        target_language_code: BCP-47 code (e.g. hi-IN, en-IN).
        speaker: Voice ID. Default from config.
        dict_id: Pronunciation dictionary ID (v3 only).
        pace: Speech speed (0.5–2.0). Default 1.0.
        temperature: Expressiveness (0.01–1.0). v3 only.
        speech_sample_rate: Audio sample rate in Hz.
        enable_cached_responses: Cache identical requests (beta).
    """
    if speaker is None:
        speaker = settings.SARVAM_TTS_SPEAKER
    if pace is None:
        pace = settings.SARVAM_TTS_PACE

    import asyncio
    import io
    from sarvamai import SarvamAI

    try:
        client = SarvamAI(api_subscription_key=settings.SARVAM_API_KEY)

        # Build kwargs for the SDK call
        kwargs = {
            "target_language_code": target_language_code,
            "text": text,
            "model": settings.SARVAM_TTS_MODEL,
            "speaker": speaker,
        }

        # Run the synchronous SDK call in a thread
        response = await asyncio.to_thread(
            client.text_to_speech.convert,
            **kwargs,
        )

        logger.info(f"Sarvam TTS SDK response type: {type(response)}")

        # The SDK returns audio bytes or a response object
        if isinstance(response, bytes):
            return response
        elif hasattr(response, "read"):
            return response.read()
        elif hasattr(response, "audios") and response.audios:
            # Some SDK versions return base64-encoded audio list
            return base64.b64decode(response.audios[0])
        else:
            # Try to extract from the response object
            logger.warning(f"Unexpected TTS response format: {response}")
            return bytes(response) if response else b""

    except Exception as e:
        logger.error(f"Sarvam TTS SDK error: {e}", exc_info=True)
        raise SarvamAPIError(f"Sarvam TTS failed: {e}", str(e))


async def translate_text(
    text: str,
    source_language_code: str,
    target_language_code: str,
    speaker_gender: str = None,
    mode: str = None,
    numerals_format: str = None,
) -> str:
    """
    Translate text between languages using Sarvam Translate API.

    Args:
        text: Input text (max 1000 chars).
        source_language_code: Source language BCP-47 code, or 'auto'.
        target_language_code: Target language BCP-47 code.
        speaker_gender: 'Male' or 'Female' for gendered translations.
        mode: Translation style — 'formal', 'modern-colloquial', 'classic-colloquial', 'code-mixed'.
        numerals_format: 'international' or 'native' numeral style.
    """
    url = f"{settings.SARVAM_BASE_URL}/translate"
    headers = {
        "API-Subscription-Key": settings.SARVAM_API_KEY,
        "Content-Type": "application/json"
    }
    payload = {
        "input": text,
        "source_language_code": source_language_code,
        "target_language_code": target_language_code,
        "model": settings.SARVAM_TRANSLATE_MODEL,
    }
    # Optional params — only include if set
    gender = speaker_gender or settings.SARVAM_TRANSLATE_GENDER
    if gender:
        payload["speaker_gender"] = gender
    tmode = mode or settings.SARVAM_TRANSLATE_MODE
    if tmode:
        payload["mode"] = tmode
    nformat = numerals_format or settings.SARVAM_TRANSLATE_NUMERALS
    if nformat:
        payload["numerals_format"] = nformat
    
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
    """
    Identify the language of input text using Sarvam Language ID API.

    Args:
        text: Input text (max 1000 chars).

    Returns:
        BCP-47 language code (e.g. 'hi-IN', 'en-IN').
    """
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


async def transliterate_text(
    text: str,
    source_language_code: str,
    target_language_code: str,
    numerals_format: str = "international",
    spoken_form: bool = False,
) -> str:
    """
    Transliterate text between scripts using Sarvam Transliteration API.

    Args:
        text: Input text to transliterate.
        source_language_code: Source language code (or 'auto').
        target_language_code: Target language code.
        numerals_format: 'international' or 'native'.
        spoken_form: If True, converts to natural spoken form.

    Returns:
        Transliterated text string.
    """
    url = f"{settings.SARVAM_BASE_URL}/transliterate"
    headers = {
        "API-Subscription-Key": settings.SARVAM_API_KEY,
        "Content-Type": "application/json"
    }
    payload = {
        "input": text,
        "source_language_code": source_language_code,
        "target_language_code": target_language_code,
        "numerals_format": numerals_format,
        "spoken_form": spoken_form,
    }

    try:
        async with httpx.AsyncClient(timeout=settings.SARVAM_API_TIMEOUT) as client:
            response = await client.post(url, headers=headers, json=payload)
            if response.status_code != 200:
                raise SarvamAPIError(f"Sarvam Transliterate API returned status {response.status_code}", response.text)

            result = response.json()
            return result.get("transliterated_text", result.get("output", text))
    except httpx.HTTPError as e:
        logger.error(f"HTTP error in transliterate_text: {e}")
        raise SarvamAPIError("Network error calling Sarvam Transliterate API", str(e))
    except Exception as e:
        logger.error(f"Unexpected error in transliterate_text: {e}")
        raise SarvamAPIError("Unexpected error calling Sarvam Transliterate API", str(e))
