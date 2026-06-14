import logging
import asyncio
import httpx
from sqlalchemy import select
from config import settings
from database import AsyncSessionLocal
from models import Agent
from services import embeddings, vector_store, context_graph

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
    url = f"{settings.SARVAM_BASE_URL}/v1/chat/completions"
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

async def query_knowledge_base(agent_id: str, query_text: str, history: list[dict] = [], enabled_connectors: list[str] = [], source_lang: str = "en-IN") -> str:
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

        # Flag knowledge gap if no relevant chunks found
        rag_context_found = bool(chunks)
        if not chunks:
            from services import insights as insights_svc
            asyncio.create_task(insights_svc.flag_knowledge_gap(agent_id, query_text))

        # 4. Formulate System Prompt
        system_prompt = settings.RAG_SYSTEM_PROMPT_TEMPLATE.format(business_name=business_name)
        if restrictions:
            system_prompt += f" Restrictions: {restrictions}"

        # 4a. Inject multilingual response instructions
        lang_name_map = {
            "hi-IN": "Hindi", "te-IN": "Telugu", "ta-IN": "Tamil", "kn-IN": "Kannada",
            "ml-IN": "Malayalam", "bn-IN": "Bengali", "mr-IN": "Marathi", "gu-IN": "Gujarati",
            "pa-IN": "Punjabi", "od-IN": "Odia", "ur-IN": "Urdu", "en-IN": "English",
            "as-IN": "Assamese", "ne-IN": "Nepali", "sa-IN": "Sanskrit",
        }
        detected_lang_name = lang_name_map.get(source_lang, "")
        if source_lang and source_lang != "en-IN" and detected_lang_name:
            system_prompt += (
                f"\n\nIMPORTANT LANGUAGE INSTRUCTION: The user's CURRENT message is in {detected_lang_name} ({source_lang}). "
                f"You MUST respond in {detected_lang_name} — even if previous messages in the conversation were in a different language. "
                f"The user may switch languages mid-conversation; always match their LATEST language. "
                f"If the user mixes {detected_lang_name} with English (code-mixing/code-switching), respond in the same mixed style. "
                f"Do NOT translate your response to English. Keep all factual context from earlier turns."
            )
        elif source_lang and source_lang != "en-IN":
            system_prompt += (
                f"\n\nIMPORTANT LANGUAGE INSTRUCTION: The user's CURRENT message is in language code '{source_lang}'. "
                f"Respond in the SAME language as this message, even if earlier turns were in a different language. "
                f"Do NOT translate to English. Keep all factual context from earlier turns."
            )

        system_prompt += (
            f"\n\nCONVERSATIONAL STYLE: You are a voice assistant. Keep your answers brief, conversational, and natural. "
            f"Always end your response with ONE short, relevant follow-up question to keep the conversation going."
        )

        system_prompt += f"\n\nContext:\n{context}"

        # 4c. Inject context graph (entity relationships) if available
        try:
            graph_context = await context_graph.get_graph_context(agent_id, query_text)
            if graph_context:
                system_prompt += f"\n\n{graph_context}"
        except Exception as graph_err:
            logger.warning(f"Context graph query failed (non-fatal): {graph_err}")

        # 4b. Inject connector tool-use instructions when connectors are active
        if enabled_connectors:
            tool_instructions = _build_tool_instructions(enabled_connectors)
            system_prompt += tool_instructions

        # 5. Build conversation history messages (limit to configured turns)
        history_messages = []
        for turn in history[-settings.RAG_HISTORY_LIMIT:]:
            role = turn.get("role", "user")
            if role not in ["system", "user", "assistant", "tool"]:
                role = "assistant" if role in ["agent", "ai"] else "user"
                
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


def _build_tool_instructions(enabled_connectors: list[str]) -> str:
    """Build tool-use instructions for the LLM based on which connectors are active."""
    instructions = "\n\n--- TOOL USE INSTRUCTIONS ---\n"
    instructions += "You have access to the following business tools. When the user's request matches a tool's purpose, "
    instructions += "respond naturally in speech AND append a single self-closing XML action tag at the END of your response.\n"
    instructions += "IMPORTANT: Your spoken response should confirm the action naturally (e.g., 'Sure, I am booking that for you!'). "
    instructions += "The XML tag must come AFTER your spoken text on a new line. Only add ONE action tag per response.\n\n"

    tool_docs = {
        "calendar": (
            "TOOL: Google Calendar\n"
            "PURPOSE: Schedule appointments, book time slots, set reminders\n"
            "TRIGGER: User asks to book, schedule, set up a meeting, or make an appointment\n"
            "FORMAT: <action type=\"calendar\" task=\"BRIEF_DESCRIPTION\" time=\"YYYY-MM-DDTHH:MM:SS\" />\n"
            "EXAMPLE: User says 'Book a slot for tomorrow at 4 PM'\n"
            "  Response: Sure, I am booking an appointment for you tomorrow at 4 PM!\n"
            "  <action type=\"calendar\" task=\"Book appointment\" time=\"2026-06-15T16:00:00\" />\n"
        ),
        "twilio": (
            "TOOL: WhatsApp / Twilio\n"
            "PURPOSE: Send WhatsApp messages, SMS notifications, or confirmations\n"
            "TRIGGER: User asks to send a message, notify someone, or send confirmation\n"
            "FORMAT: <action type=\"twilio\" task=\"BRIEF_DESCRIPTION\" recipient=\"PHONE_OR_NAME\" />\n"
            "EXAMPLE: User says 'Send a confirmation to the patient'\n"
            "  Response: I will send a WhatsApp confirmation right away!\n"
            "  <action type=\"twilio\" task=\"Send confirmation\" recipient=\"patient\" />\n"
        ),
        "shopify": (
            "TOOL: Shopify / Inventory\n"
            "PURPOSE: Check product availability, look up prices, manage orders\n"
            "TRIGGER: User asks about product stock, pricing, or order status\n"
            "FORMAT: <action type=\"shopify\" task=\"BRIEF_DESCRIPTION\" product=\"PRODUCT_NAME\" />\n"
            "EXAMPLE: User says 'Is the blue shirt available?'\n"
            "  Response: Let me check the inventory for the blue shirt!\n"
            "  <action type=\"shopify\" task=\"Check inventory\" product=\"blue shirt\" />\n"
        ),
        "hubspot": (
            "TOOL: HubSpot / CRM\n"
            "PURPOSE: Create contacts, log interactions, update customer records\n"
            "TRIGGER: User provides contact details, asks to save info, or register as a lead\n"
            "FORMAT: <action type=\"hubspot\" task=\"BRIEF_DESCRIPTION\" email=\"EMAIL_OR_NAME\" />\n"
            "EXAMPLE: User says 'Save my details, my email is john@example.com'\n"
            "  Response: I have saved your contact details to our system!\n"
            "  <action type=\"hubspot\" task=\"Create CRM contact\" email=\"john@example.com\" />\n"
        ),
    }

    active_tools = []
    for connector in enabled_connectors:
        if connector in tool_docs:
            active_tools.append(tool_docs[connector])

    if not active_tools:
        return ""

    instructions += "\n".join(active_tools)
    instructions += "\nIf the user's request does NOT match any tool, respond normally WITHOUT any action tag.\n"
    instructions += "--- END TOOL USE INSTRUCTIONS ---\n"
    return instructions

