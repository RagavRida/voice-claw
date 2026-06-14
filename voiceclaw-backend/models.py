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

class Connector(Base):
    __tablename__ = "connectors"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    agent_id = Column(String, ForeignKey("agents.id"), nullable=False)
    connector_key = Column(String, nullable=False)
    enabled = Column(Integer, default=0)  # Boolean representation (0/1) in SQLite
    config = Column(String, nullable=True)  # JSON string, encrypted
    last_status = Column(String, nullable=True)  # success | failed
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class ConversationTurn(Base):
    """Logs every single turn in every conversation for analytics and improvement."""
    __tablename__ = "conversation_turns"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String, ForeignKey("sessions.id"), nullable=False)
    agent_id = Column(String, ForeignKey("agents.id"), nullable=False)
    role = Column(String, nullable=False)          # "user" or "assistant"
    content = Column(String, nullable=False)
    source_lang = Column(String, nullable=True)
    tool_called = Column(String, nullable=True)    # e.g. "GOOGLECALENDAR_CREATE_EVENT"
    tool_result = Column(String, nullable=True)
    latency_ms = Column(Integer, nullable=True)
    confidence_score = Column(Integer, nullable=True)  # 0-10 quality score
    rag_context_found = Column(Integer, default=1)     # 0 if no context was found
    created_at = Column(DateTime, default=datetime.utcnow)

class AgentInsight(Base):
    """Aggregated learnings per agent — knowledge gaps, FAQ patterns, prompt suggestions."""
    __tablename__ = "agent_insights"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    agent_id = Column(String, ForeignKey("agents.id"), nullable=False)
    insight_type = Column(String, nullable=False)  # "knowledge_gap" | "faq_pattern" | "prompt_suggestion" | "failure_pattern"
    content = Column(JSON, nullable=False)         # {question, cluster_id, frequency, suggested_answer, ...}
    frequency = Column(Integer, default=1)
    last_seen = Column(DateTime, default=datetime.utcnow)
    resolved = Column(Integer, default=0)          # 0 = unresolved, 1 = resolved/dismissed
    created_at = Column(DateTime, default=datetime.utcnow)
