import logging
import uuid
import urllib.parse
from fastapi import APIRouter, BackgroundTasks, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_db, AsyncSessionLocal
from models import Resource
from services import firecrawl, embeddings, vector_store, context_graph

logger = logging.getLogger("ingest_router")

router = APIRouter()

class IngestUrlRequest(BaseModel):
    url: str
    agent_id: str = None

async def process_url_ingestion(resource_id: str, url: str, agent_id: str):
    async with AsyncSessionLocal() as db:
        try:
            logger.info(f"Starting background URL scraping for resource_id: {resource_id}, url: {url}")
            
            # 1. Scrape URL using Firecrawl
            chunks = await firecrawl.scrape_url(url)
            if not chunks:
                raise Exception("Failed to scrape any content from the provided URL.")

            # 2. Embed chunks
            vectors = await embeddings.embed_chunks(chunks)

            # 3. Store in vector db
            vector_store_agent_id = agent_id if agent_id and agent_id != "unassigned" else f"temp_{resource_id}"
            chunk_count = await vector_store.store_chunks(vector_store_agent_id, resource_id, chunks, vectors)

            # 4. Build context graph
            try:
                await context_graph.ingest_chunks(vector_store_agent_id, chunks, resource_id=resource_id)
                stats = context_graph.get_graph_stats(vector_store_agent_id)
                logger.info(f"Context graph for {vector_store_agent_id}: {stats}")
            except Exception as graph_err:
                logger.warning(f"Context graph ingestion failed (non-fatal): {graph_err}")

            # 5. Update status in Database
            result = await db.execute(select(Resource).where(Resource.id == resource_id))
            resource = result.scalars().first()
            if resource:
                resource.status = "ready"
                resource.chunk_count = chunk_count
                await db.commit()
                logger.info(f"Successfully finished ingestion for URL resource {resource_id}. Chunks: {chunk_count}")
        except Exception as e:
            logger.error(f"Error in background ingestion for URL resource {resource_id}: {e}", exc_info=True)
            result = await db.execute(select(Resource).where(Resource.id == resource_id))
            resource = result.scalars().first()
            if resource:
                resource.status = "failed"
                await db.commit()

@router.post("/ingest-url")
async def ingest_url(
    request: IngestUrlRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    try:
        # Validate URL format
        parsed_url = urllib.parse.urlparse(request.url)
        if not parsed_url.scheme or not parsed_url.netloc:
            logger.error(f"Invalid URL format: {request.url}")
            raise HTTPException(status_code=400, detail={"error": "Invalid URL", "detail": "The provided URL is not formatted correctly."})

        # Clean agent_id
        agent_id = request.agent_id
        if not agent_id or agent_id.strip() in ("", "null", "undefined"):
            agent_id = "unassigned"

        resource_id = str(uuid.uuid4())
        
        # Create resource in database
        db_resource = Resource(
            id=resource_id,
            agent_id=None if agent_id == "unassigned" else agent_id,
            type="url",
            name=request.url,
            status="processing",
            chunk_count=0
        )
        db.add(db_resource)
        await db.commit()
        await db.refresh(db_resource)
        
        # Queue URL scraping task
        background_tasks.add_task(
            process_url_ingestion,
            resource_id=resource_id,
            url=request.url,
            agent_id=agent_id
        )
        
        return {
            "resource_id": resource_id,
            "status": "processing"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error initiating URL ingestion: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "Database error", "detail": str(e)})
