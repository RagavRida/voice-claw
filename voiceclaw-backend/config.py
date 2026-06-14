import os
from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    # ── API Keys ──
    SARVAM_API_KEY: str = ""
    GEMINI_API_KEY: str = ""
    GROQ_API_KEY: str = ""
    FIRECRAWL_API_KEY: str = ""
    ENCRYPTION_KEY: Optional[str] = None
    COMPOSIO_API_KEY: str = ""

    # ── Infrastructure ──
    DATABASE_URL: str = "sqlite:///./voiceclaw.db"
    CHROMA_PERSIST_DIR: str = "./chroma_db"
    UPLOAD_DIR: str = "./uploads"
    PORT: int = 8000

    # ── Sarvam API ──
    SARVAM_BASE_URL: str = "https://api.sarvam.ai"
    SARVAM_STT_MODEL: str = "saarika:v2.5"
    SARVAM_TTS_MODEL: str = "bulbul:v3"
    SARVAM_TTS_SPEAKER: str = "priya"
    SARVAM_TTS_PACE: float = 1.0  # Speed: 0.5 to 2.0
    SARVAM_TTS_TEMPERATURE: float = 0.6  # Expressiveness: 0.01 to 1.0 (v3 only)
    SARVAM_TTS_SAMPLE_RATE: int = 22050  # Audio quality (Hz)
    SARVAM_TTS_ENABLE_CACHE: bool = False  # Cache identical requests (beta)
    SARVAM_TRANSLATE_MODEL: str = "mayura:v1"  # Options: mayura:v1, sarvam-translate:v1
    SARVAM_TRANSLATE_GENDER: str = ""  # Male or Female (optional)
    SARVAM_TRANSLATE_MODE: str = ""  # formal, modern-colloquial, classic-colloquial, code-mixed
    SARVAM_TRANSLATE_NUMERALS: str = "international"  # international or native
    SARVAM_CHAT_MODEL: str = "sarvam-30b"  # Options: sarvam-30b, sarvam-105b
    SARVAM_API_TIMEOUT: float = 30.0
    SARVAM_LID_TIMEOUT: float = 15.0
    SARVAM_DOC_TIMEOUT: float = 60.0
    SARVAM_DOC_POLL_INTERVAL: float = 3.0
    SARVAM_DOC_MAX_POLLS: int = 60
    SARVAM_DOC_OUTPUT_FORMAT: str = "md"
    SARVAM_DOC_PAGE_LIMIT: int = 10

    # ── Gemini ──
    GEMINI_MODEL: str = "gemini-2.0-flash"

    # ── Embeddings ──
    EMBEDDING_MODEL: str = "all-MiniLM-L6-v2"

    # ── Chunking ──
    CHUNK_SIZE: int = 500
    CHUNK_OVERLAP: int = 50

    # ── RAG ──
    RAG_TOP_K: int = 4
    RAG_MAX_TOKENS: int = 200
    RAG_TEMPERATURE: float = 0.3
    RAG_HISTORY_LIMIT: int = 4
    RAG_SYSTEM_PROMPT_TEMPLATE: str = (
        "You are a helpful voice assistant for {business_name}. "
        "CRITICAL RULE: You MUST ONLY answer questions using the exact 'Context' provided below. "
        "If the user's question cannot be answered using the Context below, you MUST politely refuse to answer "
        "and state that you do not have that information. "
        "Under NO CIRCUMSTANCES should you use your general outside knowledge to answer questions about topics not found in the context. "
        "Be concise — max 2 sentences."
    )
    RAG_NO_CONTEXT_MESSAGE: str = "No background information available."

    # ── Language defaults ──
    DEFAULT_LANGUAGE_CODE: str = "en-IN"
    DEFAULT_AUDIO_FORMAT: str = "webm"

    # ── Upload limits ──
    MAX_UPLOAD_SIZE_MB: int = 20

    # ── Vector store ──
    COLLECTION_PREFIX: str = "agent_"
    TEMP_COLLECTION_PREFIX: str = "temp_"

    # ── App metadata ──
    APP_TITLE: str = "VoiceClaw API"
    APP_VERSION: str = "1.0.0"

    model_config = SettingsConfigDict(
        env_file=os.path.join(os.path.dirname(__file__), ".env"),
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()
