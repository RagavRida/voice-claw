import os
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import settings
from database import init_db
from services import embeddings
from routers import upload, ingest, stt, tts, query, agent, config, pronunciation, connectors, analytics

# Configure logging format and level
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("main")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Create upload and database persistence directories
    logger.info("Creating uploads and chroma_db directories if not exist...")
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    os.makedirs(settings.CHROMA_PERSIST_DIR, exist_ok=True)
    
    # 2. Database migrations / tables initialization
    logger.info("Initializing SQLite database and applying schemas...")
    await init_db()
    
    # 3. Embeddings model warmup
    logger.info("Warming up embeddings SentenceTransformer model...")
    embeddings.get_model()
    
    logger.info("VoiceClaw Backend Startup initialization complete.")
    yield
    logger.info("VoiceClaw Backend shutting down...")

app = FastAPI(
    title=settings.APP_TITLE,
    version=settings.APP_VERSION,
    lifespan=lifespan
)

# CORS middleware config
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

# Mount Routers under /api prefix
app.include_router(upload.router, prefix="/api", tags=["upload"])
app.include_router(ingest.router, prefix="/api", tags=["ingest"])
app.include_router(stt.router, prefix="/api", tags=["stt"])
app.include_router(tts.router, prefix="/api", tags=["tts"])
app.include_router(query.router, prefix="/api", tags=["query"])
app.include_router(agent.router, prefix="/api", tags=["agent"])
app.include_router(config.router, prefix="/api", tags=["config"])
app.include_router(pronunciation.router, prefix="/api", tags=["pronunciation"])
app.include_router(connectors.router, prefix="/api", tags=["connectors"])
app.include_router(analytics.router, prefix="/api", tags=["analytics"])

@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "version": settings.APP_VERSION
    }
