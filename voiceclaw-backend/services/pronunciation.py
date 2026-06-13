import io
import json
import logging
import httpx
from config import settings

logger = logging.getLogger("pronunciation_service")


class PronunciationError(Exception):
    """Raised when a pronunciation dictionary API call fails."""
    pass


def _headers() -> dict:
    return {"api-subscription-key": settings.SARVAM_API_KEY}


def _base_url() -> str:
    return f"{settings.SARVAM_BASE_URL}/text-to-speech/pronunciation-dictionary"


async def create_dictionary(pronunciations: dict) -> str:
    """
    Create a pronunciation dictionary on Sarvam and return the dict_id.

    Args:
        pronunciations: Language-scoped word→pronunciation map, e.g.
            {"hi-IN": {"B2B": "B to B"}, "en-IN": {"HDFC": "H D F C"}}

    Returns:
        The dictionary_id string (e.g. "p_5cb7faa6").
    """
    payload = {"pronunciations": pronunciations}
    file_bytes = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")

    try:
        async with httpx.AsyncClient(timeout=settings.SARVAM_API_TIMEOUT) as client:
            response = await client.post(
                _base_url(),
                headers=_headers(),
                files={"file": ("dict.json", io.BytesIO(file_bytes), "application/json")},
            )
            if response.status_code != 200:
                raise PronunciationError(
                    f"Create dictionary failed ({response.status_code}): {response.text}"
                )
            data = response.json()
            dict_id = data.get("dictionary_id")
            if not dict_id:
                raise PronunciationError(f"No dictionary_id in response: {data}")
            logger.info(f"Created pronunciation dictionary: {dict_id}")
            return dict_id
    except httpx.HTTPError as e:
        logger.error(f"HTTP error creating pronunciation dictionary: {e}")
        raise PronunciationError(f"Network error: {e}")


async def list_dictionaries() -> dict:
    """
    List all pronunciation dictionaries for the authenticated user.

    Returns:
        {"dictionary_count": int, "dictionaries": [str, ...]}
    """
    try:
        async with httpx.AsyncClient(timeout=settings.SARVAM_API_TIMEOUT) as client:
            response = await client.get(_base_url(), headers=_headers())
            if response.status_code != 200:
                raise PronunciationError(
                    f"List dictionaries failed ({response.status_code}): {response.text}"
                )
            return response.json()
    except httpx.HTTPError as e:
        logger.error(f"HTTP error listing pronunciation dictionaries: {e}")
        raise PronunciationError(f"Network error: {e}")


async def get_dictionary(dict_id: str) -> dict:
    """
    Retrieve full pronunciation mappings for a specific dictionary.

    Returns:
        {"pronunciations": {"hi-IN": {"word": "pronunciation"}, ...}}
    """
    try:
        async with httpx.AsyncClient(timeout=settings.SARVAM_API_TIMEOUT) as client:
            response = await client.get(
                f"{_base_url()}/{dict_id}",
                headers=_headers(),
            )
            if response.status_code != 200:
                raise PronunciationError(
                    f"Get dictionary failed ({response.status_code}): {response.text}"
                )
            return response.json()
    except httpx.HTTPError as e:
        logger.error(f"HTTP error getting pronunciation dictionary {dict_id}: {e}")
        raise PronunciationError(f"Network error: {e}")


async def update_dictionary(dict_id: str, pronunciations: dict) -> dict:
    """
    Update an existing pronunciation dictionary (additive merge).

    Args:
        dict_id: The dictionary ID to update.
        pronunciations: New/updated language→word→pronunciation mappings.

    Returns:
        {"dictionary_id": str, "updated_pronunciations": {...}}
    """
    payload = {"pronunciations": pronunciations}
    file_bytes = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")

    try:
        async with httpx.AsyncClient(timeout=settings.SARVAM_API_TIMEOUT) as client:
            response = await client.put(
                _base_url(),
                headers=_headers(),
                params={"dict_id": dict_id},
                files={"file": ("dict.json", io.BytesIO(file_bytes), "application/json")},
            )
            if response.status_code != 200:
                raise PronunciationError(
                    f"Update dictionary failed ({response.status_code}): {response.text}"
                )
            data = response.json()
            logger.info(f"Updated pronunciation dictionary: {dict_id}")
            return data
    except httpx.HTTPError as e:
        logger.error(f"HTTP error updating pronunciation dictionary {dict_id}: {e}")
        raise PronunciationError(f"Network error: {e}")


async def delete_dictionary(dict_id: str) -> dict:
    """
    Delete a pronunciation dictionary by ID.

    Returns:
        {"success": bool, "message": str}
    """
    try:
        async with httpx.AsyncClient(timeout=settings.SARVAM_API_TIMEOUT) as client:
            response = await client.delete(
                _base_url(),
                headers=_headers(),
                params={"dict_id": dict_id},
            )
            if response.status_code != 200:
                raise PronunciationError(
                    f"Delete dictionary failed ({response.status_code}): {response.text}"
                )
            data = response.json()
            logger.info(f"Deleted pronunciation dictionary: {dict_id}")
            return data
    except httpx.HTTPError as e:
        logger.error(f"HTTP error deleting pronunciation dictionary {dict_id}: {e}")
        raise PronunciationError(f"Network error: {e}")
