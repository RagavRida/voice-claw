import os
import uuid
import logging
from fastapi import APIRouter, UploadFile, File, Form, BackgroundTasks, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from config import settings
from database import get_db, AsyncSessionLocal
from models import Resource
from services import document_intelligence, embeddings, vector_store

logger = logging.getLogger("upload_router")

router = APIRouter()

async def process_pdf_ingestion(resource_id: str, file_path: str, filename: str, agent_id: str):
    async with AsyncSessionLocal() as db:
        try:
            logger.info(f"Starting background ingestion for resource_id: {resource_id}, agent_id: {agent_id}, file: {filename}")
            # 1. Read file bytes
            with open(file_path, "rb") as f:
                file_bytes = f.read()

            # 2. Extract text chunks using Sarvam Document Intelligence
            ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
            image_exts = {"jpg", "jpeg", "png", "tiff", "tif", "bmp", "webp"}
            
            if ext in image_exts:
                chunks = await document_intelligence.extract_image(file_bytes, filename)
            else:
                chunks = await document_intelligence.extract_pdf(file_bytes, filename)
            
            if not chunks:
                raise Exception("No text content could be extracted from this document.")

            # 3. Create embeddings for chunks
            vectors = await embeddings.embed_chunks(chunks)

            # 4. Store in vector store (use agent_id or temp placeholder)
            vector_store_agent_id = agent_id if agent_id and agent_id != "unassigned" else f"temp_{resource_id}"
            chunk_count = await vector_store.store_chunks(vector_store_agent_id, resource_id, chunks, vectors)

            # 5. Update resource record
            result = await db.execute(select(Resource).where(Resource.id == resource_id))
            resource = result.scalars().first()
            if resource:
                resource.status = "ready"
                resource.chunk_count = chunk_count
                await db.commit()
                logger.info(f"Successfully finished ingestion for resource {resource_id}. Chunks: {chunk_count}")
        except Exception as e:
            logger.error(f"Error in background ingestion for resource {resource_id}: {e}", exc_info=True)
            result = await db.execute(select(Resource).where(Resource.id == resource_id))
            resource = result.scalars().first()
            if resource:
                resource.status = "failed"
                await db.commit()

@router.post("/upload")
async def upload_pdf(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    agent_id: str = Form(None),
    db: AsyncSession = Depends(get_db)
):
    try:
        # Validate file type — accept PDFs and images for Sarvam Document Intelligence
        filename = file.filename or "document.pdf"
        ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
        
        pdf_exts = {"pdf"}
        image_exts = {"jpg", "jpeg", "png", "tiff", "tif", "bmp", "webp"}
        supported_exts = pdf_exts | image_exts
        
        is_pdf = ext in pdf_exts or (file.content_type and "pdf" in file.content_type.lower())
        is_image = ext in image_exts or (file.content_type and file.content_type.lower().startswith("image/"))
        
        if not is_pdf and not is_image:
            logger.error(f"Uploaded file {filename} is not supported (ext: {ext}, content_type: {file.content_type})")
            raise HTTPException(
                status_code=400,
                detail={"error": "Invalid file", "detail": f"Supported formats: PDF, {', '.join(sorted(image_exts)).upper()}"}
            )
            
        # Clean agent_id
        if not agent_id or agent_id.strip() in ("", "null", "undefined"):
            agent_id = "unassigned"

        resource_id = str(uuid.uuid4())
        
        # Ensure upload directory exists
        upload_subdir = os.path.join(settings.UPLOAD_DIR, agent_id)
        os.makedirs(upload_subdir, exist_ok=True)
        
        # Save file to upload directory
        saved_filename = f"{uuid.uuid4()}_{filename}"
        file_path = os.path.join(upload_subdir, saved_filename)
        
        with open(file_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)
            
        # Create resource in database
        resource_type = "pdf" if is_pdf else "image"
        db_resource = Resource(
            id=resource_id,
            agent_id=None if agent_id == "unassigned" else agent_id,
            type=resource_type,
            name=filename,
            status="processing",
            chunk_count=0
        )
        db.add(db_resource)
        await db.commit()
        await db.refresh(db_resource)
        
        # Queue the ingestion process background task
        background_tasks.add_task(
            process_pdf_ingestion,
            resource_id=resource_id,
            file_path=file_path,
            filename=filename,
            agent_id=agent_id
        )
        
        return {
            "resource_id": resource_id,
            "status": "processing"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error handling upload: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "Database error", "detail": str(e)})

@router.get("/upload/{resource_id}/status")
async def get_upload_status(resource_id: str, db: AsyncSession = Depends(get_db)):
    try:
        result = await db.execute(select(Resource).where(Resource.id == resource_id))
        resource = result.scalars().first()
        if not resource:
            raise HTTPException(status_code=404, detail={"error": "Not found"})
            
        return {
            "resource_id": resource.id,
            "status": resource.status,
            "chunk_count": resource.chunk_count,
            "name": resource.name
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error checking resource status: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "Database error", "detail": str(e)})
