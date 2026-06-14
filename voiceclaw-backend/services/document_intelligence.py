import io
import asyncio
import logging
import httpx
from config import settings

logger = logging.getLogger("document_intelligence")

# Flexible import for PDF extraction fallback
try:
    import pypdf as pdf_lib
except ImportError:
    try:
        import PyPDF2 as pdf_lib
    except ImportError:
        pdf_lib = None


def chunk_text(text: str, chunk_size: int = None, overlap: int = None) -> list[str]:
    if chunk_size is None:
        chunk_size = settings.CHUNK_SIZE
    if overlap is None:
        overlap = settings.CHUNK_OVERLAP
    chunks = []
    if not text:
        return chunks
    start = 0
    text_len = len(text)
    while start < text_len:
        end = start + chunk_size
        chunks.append(text[start:end].strip())
        # Prevent infinite loops if overlap >= chunk_size
        step = chunk_size - overlap
        if step <= 0:
            step = chunk_size
        start += step
    return [c for c in chunks if c]


async def _sarvam_doc_digitization(file_bytes: bytes, filename: str) -> list[str]:
    """
    Use the Sarvam Document Digitization (formerly Document Intelligence)
    job-based async API.

    Workflow:
      1. POST /doc-digitization/job/v1              → create job, get job_id
      2. POST /doc-digitization/job/v1/upload-files  → get presigned upload URL
      3. PUT  <presigned_url>                        → upload file bytes
      4. POST /doc-digitization/job/v1/{job_id}/start → start processing
      5. GET  /doc-digitization/job/v1/{job_id}       → poll until Completed
      6. GET  /doc-digitization/job/v1/{job_id}/download-files → get results
    """
    base = settings.SARVAM_BASE_URL
    headers = {"api-subscription-key": settings.SARVAM_API_KEY}
    timeout = httpx.Timeout(settings.SARVAM_DOC_TIMEOUT)

    async with httpx.AsyncClient(timeout=timeout) as client:
        # ── Step 1: Create Job ───────────────────────────────────────────
        create_resp = await client.post(
            f"{base}/doc-digitization/job/v1",
            headers=headers,
            json={
                "job_parameters": {
                    "language": "en-IN",
                    "output_format": settings.SARVAM_DOC_OUTPUT_FORMAT,
                }
            },
        )
        if create_resp.status_code not in (200, 202):
            raise Exception(
                f"Create job failed ({create_resp.status_code}): {create_resp.text}"
            )
        create_data = create_resp.json()
        job_id = create_data.get("job_id") or create_data.get("id")
        if not job_id:
            raise Exception(f"No job_id in create response: {create_data}")
        logger.info(f"Created Sarvam doc-digitization job: {job_id}")

        # ── Step 2: Get Upload URL ───────────────────────────────────────
        upload_url_resp = await client.post(
            f"{base}/doc-digitization/job/v1/upload-files",
            headers=headers,
            json={
                "job_id": job_id,
                "files": [filename],
            },
        )
        if upload_url_resp.status_code != 200:
            raise Exception(
                f"Get upload URL failed ({upload_url_resp.status_code}): {upload_url_resp.text}"
            )
        upload_data = upload_url_resp.json()

        # Extract the presigned upload URL from the response
        # Sarvam returns: {"upload_urls": {"filename": {"file_url": "https://...", "file_metadata": null}}}
        upload_urls = upload_data.get("upload_urls") or upload_data.get("urls") or {}
        presigned_url = None
        if isinstance(upload_urls, dict):
            first_val = list(upload_urls.values())[0] if upload_urls else None
            if isinstance(first_val, dict):
                presigned_url = first_val.get("file_url") or first_val.get("url")
            elif isinstance(first_val, str):
                presigned_url = first_val
        elif isinstance(upload_urls, list) and upload_urls:
            item = upload_urls[0]
            presigned_url = item.get("file_url") or item.get("url") if isinstance(item, dict) else item
        if not presigned_url:
            presigned_url = upload_data.get("url")

        if not presigned_url:
            raise Exception(f"No upload URL in response: {upload_data}")

        logger.info(f"Got presigned upload URL for job {job_id}")

        # ── Step 3: Upload File to Presigned URL ─────────────────────────
        ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
        mime_map = {
            "pdf": "application/pdf",
            "jpg": "image/jpeg", "jpeg": "image/jpeg",
            "png": "image/png",
            "tiff": "image/tiff", "tif": "image/tiff",
            "bmp": "image/bmp",
            "webp": "image/webp",
        }
        content_type = mime_map.get(ext, "application/octet-stream")
        put_resp = await client.put(
            presigned_url,
            content=file_bytes,
            headers={"Content-Type": content_type},
        )
        if put_resp.status_code not in (200, 201):
            raise Exception(
                f"File upload PUT failed ({put_resp.status_code}): {put_resp.text}"
            )
        logger.info(f"Uploaded {filename} ({len(file_bytes)} bytes) for job {job_id}")

        # ── Step 4: Start Job ────────────────────────────────────────────
        start_resp = await client.post(
            f"{base}/doc-digitization/job/v1/{job_id}/start",
            headers=headers,
        )
        if start_resp.status_code not in (200, 202):
            raise Exception(
                f"Start job failed ({start_resp.status_code}): {start_resp.text}"
            )
        logger.info(f"Started doc-digitization job {job_id}")

        # ── Step 5: Poll for Completion ──────────────────────────────────
        poll_interval = settings.SARVAM_DOC_POLL_INTERVAL
        max_polls = settings.SARVAM_DOC_MAX_POLLS
        job_state = None

        for attempt in range(max_polls):
            await asyncio.sleep(poll_interval)
            # Try /status endpoint first (per API docs), fallback to bare job_id
            status_resp = await client.get(
                f"{base}/doc-digitization/job/v1/{job_id}/status",
                headers=headers,
            )
            if status_resp.status_code not in (200, 202):
                status_resp = await client.get(
                    f"{base}/doc-digitization/job/v1/{job_id}",
                    headers=headers,
                )
            if status_resp.status_code not in (200, 202):
                logger.warning(
                    f"Poll attempt {attempt + 1} failed ({status_resp.status_code}): {status_resp.text}"
                )
                continue

            status_data = status_resp.json()
            job_state = (
                status_data.get("job_state")
                or status_data.get("status")
                or status_data.get("state")
            )
            logger.info(f"Job {job_id} poll #{attempt + 1}: state={job_state}")

            if job_state in ("Completed", "completed", "COMPLETED"):
                break
            elif job_state in ("Failed", "failed", "FAILED", "Error", "error"):
                error_msg = status_data.get("error") or status_data.get("message") or "Unknown error"
                raise Exception(f"Job {job_id} failed: {error_msg}")
        else:
            raise Exception(
                f"Job {job_id} did not complete after {max_polls} polls "
                f"({max_polls * poll_interval:.0f}s). Last state: {job_state}"
            )

        # ── Step 6: Download Results ─────────────────────────────────────
        download_resp = await client.get(
            f"{base}/doc-digitization/job/v1/{job_id}/download-files",
            headers=headers,
        )
        if download_resp.status_code != 200:
            raise Exception(
                f"Download results failed ({download_resp.status_code}): {download_resp.text}"
            )

        result = download_resp.json()
        return _parse_digitization_result(result)


def _parse_digitization_result(result: dict | list) -> list[str]:
    """Extract text chunks from various possible Sarvam response schemas."""
    # If the response is a list of strings directly
    if isinstance(result, list):
        all_text = "\n\n".join(
            item if isinstance(item, str) else item.get("content", "") or item.get("text", "")
            for item in result
        )
        return chunk_text(all_text) if all_text.strip() else []

    # Common response formats:
    # {"files": [{"content": "..."}]}
    if "files" in result and isinstance(result["files"], list):
        all_text = "\n\n".join(
            f.get("content", "") or f.get("text", "") or f.get("markdown", "")
            for f in result["files"]
        )
        return chunk_text(all_text) if all_text.strip() else []

    # {"pages": [{"content": "..."}]}
    if "pages" in result and isinstance(result["pages"], list):
        all_text = "\n\n".join(
            p.get("content", "") or p.get("text", "") or p.get("markdown", "")
            for p in result["pages"]
        )
        return chunk_text(all_text) if all_text.strip() else []

    # {"chunks": [...]}
    if "chunks" in result and isinstance(result["chunks"], list):
        return result["chunks"]

    # {"text": "...", "markdown": "..."}
    text_content = result.get("text") or result.get("markdown") or result.get("content", "")
    if text_content:
        return chunk_text(text_content)

    # {"download_urls": [...]} — need to fetch each URL
    if "download_urls" in result:
        logger.warning("Response contains download_urls; direct content extraction not available.")
        # Return raw JSON representation so it's not silently lost
        return chunk_text(str(result))

    raise Exception(f"Unexpected response schema from Sarvam Document Digitization: {list(result.keys())}")


def _extract_pdf_local(file_bytes: bytes, filename: str) -> list[str]:
    """Local fallback using pypdf/PyPDF2."""
    if pdf_lib is None:
        logger.error("No PDF library (pypdf/PyPDF2) is installed. Cannot perform fallback extraction.")
        return []

    try:
        reader = pdf_lib.PdfReader(io.BytesIO(file_bytes))
        full_text = ""
        for page in reader.pages:
            page_text = page.extract_text()
            if page_text:
                full_text += page_text + "\n"
        return chunk_text(full_text)
    except Exception as fallback_err:
        logger.error(f"Fallback PDF extraction failed for {filename}: {fallback_err}")
        return []


async def extract_pdf(file_bytes: bytes, filename: str) -> list[str]:
    """
    Primary: Sarvam Document Digitization API (async job workflow).
    Fallback: Local pypdf/PyPDF2 extraction.
    """
    try:
        logger.info(f"Attempting Sarvam Document Digitization for {filename}")
        return await _sarvam_doc_digitization(file_bytes, filename)
    except Exception as e:
        logger.warning(
            f"Sarvam Document Digitization failed for {filename}. Error: {e}. "
            "Falling back to local PDF extraction."
        )
        return _extract_pdf_local(file_bytes, filename)


async def extract_image(file_bytes: bytes, filename: str) -> list[str]:
    """
    Extract text from images (JPG, PNG, TIFF, etc.) using Sarvam Document Intelligence.
    No local fallback — images require OCR which only Sarvam provides.
    """
    try:
        logger.info(f"Attempting Sarvam Document Digitization (image OCR) for {filename}")
        return await _sarvam_doc_digitization(file_bytes, filename)
    except Exception as e:
        logger.error(f"Sarvam Document Digitization failed for image {filename}: {e}")
        raise Exception(f"Image text extraction failed for {filename}: {e}")

