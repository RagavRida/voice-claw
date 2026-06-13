import logging
import httpx
from sqlalchemy import select
from config import settings
from database import AsyncSessionLocal
from models import Agent
from services import embeddings, vector_store

logger = logging.getLogger("rag_service")

class RAGError(Exception):
    pass

async def _query_via_groq(system_prompt: str, messages: list[dict]) -> str:
    """Use Groq API (OpenAI-compatible) for chat completion."""
    groq_key = settings.GROQ_API_KEY
    if not groq_key:
        raise RAGError("GROQ_API_KEY not set")

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {groq_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": "llama-3.3-70b-versatile",
                "messages": messages,
                "max_tokens": settings.RAG_MAX_TOKENS,
                "temperature": settings.RAG_TEMPERATURE,
            },
        )
        if response.status_code != 200:
            raise RAGError(f"Groq API error {response.status_code}: {response.text[:200]}")

        data = response.json()
        answer = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        if not answer:
            raise RAGError("Empty response from Groq API.")
        return answer.strip()

async def _query_via_gemini(system_prompt: str, messages: list[dict], query_text: str) -> str:
    """Use Google Gemini API for chat completion."""
    import asyncio
    from google import genai

    client = genai.Client(api_key=settings.GEMINI_API_KEY)

    # Build contents list for Gemini (system instruction is separate)
    contents = []
    for msg in messages:
        if msg["role"] == "system":
            continue  # handled via system_instruction
        role = "user" if msg["role"] == "user" else "model"
        contents.append({"role": role, "parts": [{"text": msg["content"]}]})

    loop = asyncio.get_event_loop()
    response = await loop.run_in_executor(
        None,
        lambda: client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=contents,
            config={
                "system_instruction": system_prompt,
                "max_output_tokens": settings.RAG_MAX_TOKENS,
                "temperature": settings.RAG_TEMPERATURE,
            }
        )
    )

    if response and response.text:
        return response.text.strip()
    raise RAGError("Empty response from Gemini API.")

async def _query_via_sarvam(system_prompt: str, messages: list[dict]) -> str:
    """Fallback: use Sarvam Chat Completion API."""
    url = f"{settings.SARVAM_BASE_URL}/chat/completions"
    headers = {
        "API-Subscription-Key": settings.SARVAM_API_KEY,
        "Content-Type": "application/json"
    }
    payload = {
        "model": settings.SARVAM_CHAT_MODEL,
        "messages": messages,
        "max_tokens": settings.RAG_MAX_TOKENS,
        "temperature": settings.RAG_TEMPERATURE
    }

    async with httpx.AsyncClient(timeout=settings.SARVAM_API_TIMEOUT) as client:
        response = await client.post(url, headers=headers, json=payload)
        if response.status_code != 200:
            raise RAGError(f"Sarvam Chat completions API error {response.status_code}: {response.text}")

        res_data = response.json()
        choices = res_data.get("choices", [])
        if not choices:
            raise RAGError("Empty response choices from Sarvam Chat completions.")

        answer = choices[0].get("message", {}).get("content", "")
        return answer.strip()

async def query_knowledge_base(agent_id: str, query_text: str, history: list[dict] = []) -> str:
    # 1. Fetch Agent configuration from database
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Agent).where(Agent.id == agent_id))
        agent = result.scalars().first()
        if not agent:
            raise RAGError(f"Agent with ID {agent_id} not found in database.")

        business_name = agent.business_name
        restrictions = agent.restrictions

    try:
        # 2. Embed query_text
        query_vectors = await embeddings.embed_chunks([query_text])
        if not query_vectors:
            raise RAGError("Failed to calculate embedding for the search query.")
        query_vector = query_vectors[0]

        # 3. Retrieve top matching document chunks from ChromaDB
        chunks = await vector_store.query_chunks(agent_id, query_vector, n_results=settings.RAG_TOP_K)
        context = "\n\n".join(chunks) if chunks else settings.RAG_NO_CONTEXT_MESSAGE

        # 4. Formulate System Prompt
        system_prompt = settings.RAG_SYSTEM_PROMPT_TEMPLATE.format(business_name=business_name)
        if restrictions:
            system_prompt += f" Restrictions: {restrictions}"
        system_prompt += f"\n\nContext:\n{context}"

        # 5. Build conversation history messages (limit to configured turns)
        history_messages = []
        for turn in history[-settings.RAG_HISTORY_LIMIT:]:
            role = turn.get("role", "user")
            content = turn.get("content") or turn.get("text") or ""
            history_messages.append({"role": role, "content": content})

        # Assemble full list of message logs
        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(history_messages)
        messages.append({"role": "user", "content": query_text})

        # 6. Route to the appropriate AI provider (Groq first → Gemini → Sarvam)
        if settings.GROQ_API_KEY:
            groq_key = settings.GROQ_API_KEY  # noqa: F841
            try:
                logger.info(f"Submitting RAG query via Groq for agent {agent_id}")
                return await _query_via_groq(system_prompt, messages)
            except Exception as e:
                logger.warning(f"Groq RAG failed, falling back: {e}")

        if settings.GEMINI_API_KEY:
            try:
                logger.info(f"Submitting RAG query via Gemini for agent {agent_id}")
                return await _query_via_gemini(system_prompt, messages, query_text)
            except Exception as e:
                logger.warning(f"Gemini RAG failed, falling back: {e}")

        logger.info(f"Submitting RAG query via Sarvam Chat completions for agent {agent_id}")
        return await _query_via_sarvam(system_prompt, messages)

    except Exception as e:
        logger.error(f"Error executing RAG query for agent {agent_id}: {e}")
        raise RAGError(f"RAG query execution failed: {e}")
