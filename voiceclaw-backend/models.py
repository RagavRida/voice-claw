import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, JSON
from database import Base

class Agent(Base):
    __tablename__ = "agents"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    business_name = Column(String, nullable=False)
    business_type = Column(String, nullable=False)
    primary_language = Column(String, nullable=False)
    greeting = Column(String, nullable=False)
    restrictions = Column(String, nullable=False)
    top_faqs = Column(JSON, nullable=False, default=list)
    dict_id = Column(String, nullable=True)  # Sarvam pronunciation dictionary ID (e.g. "p_5cb7faa6")
    created_at = Column(DateTime, default=datetime.utcnow)

class Resource(Base):
    __tablename__ = "resources"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    agent_id = Column(String, ForeignKey("agents.id"), nullable=True)  # nullable=True for pre-config uploads
    type = Column(String, nullable=False)  # "pdf" or "url"
    name = Column(String, nullable=False)
    status = Column(String, default="processing")  # "processing" | "ready" | "failed"
    chunk_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

class Session(Base):
    __tablename__ = "sessions"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    agent_id = Column(String, ForeignKey("agents.id"), nullable=False)
    source_lang = Column(String, nullable=False)
    turn_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
