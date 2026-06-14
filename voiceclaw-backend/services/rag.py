import logging
import asyncio
import httpx
from sqlalchemy import select
from config import settings
from database import AsyncSessionLocal
from models import Agent, Resource
from services import embeddings, vector_store, context_graph, firecrawl

logger = logging.getLogger("rag_service")

class RAGError(Exception):
    pass

OLLAMA_BASE_URL = "http://localhost:11434"
OLLAMA_MODEL = "gemma4:latest"

async def _query_via_ollama(system_prompt: str, messages: list[dict]) -> str:
    """Use local Ollama (Gemma 4) for chat completion — no rate limits."""
    url = f"{OLLAMA_BASE_URL}/api/chat"
    payload = {
        "model": OLLAMA_MODEL,
        "messages": messages,
        "stream": False,
        "options": {
            "temperature": settings.RAG_TEMPERATURE,
            "num_predict": settings.RAG_MAX_TOKENS,
        }
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(url, json=payload)
        if response.status_code != 200:
            raise RAGError(f"Ollama API error {response.status_code}: {response.text[:300]}")
        data = response.json()
        message = data.get("message", {})
        answer = message.get("content", "")
        
        # Some reasoning models (like Gemma 4) put their reasoning in "thinking" and leave content empty
        # when they decide to refuse based on strict system prompts.
        if not answer and "thinking" in message:
            return "I don't have information about that in my knowledge base."
            
        if not answer:
            raise RAGError(f"Empty response from Ollama. Raw: {data}")
        return answer.strip()

async def _query_via_groq(system_prompt: str, messages: list[dict]) -> str:
    """Use Groq API (OpenAI-compatible) for chat completion with retry."""
    groq_key = settings.GROQ_API_KEY
    if not groq_key:
        raise RAGError("GROQ_API_KEY not set")

    # Try the big model first, fall back to smaller model on rate-limit
    models_to_try = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        for model in models_to_try:
            response = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {groq_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": messages,
                    "max_tokens": settings.RAG_MAX_TOKENS,
                    "temperature": settings.RAG_TEMPERATURE,
                },
            )
            if response.status_code == 429:
                logger.warning(f"Groq rate-limited on {model}, trying next model...")
                continue
            if response.status_code != 200:
                raise RAGError(f"Groq API error {response.status_code}: {response.text[:200]}")

            data = response.json()
            answer = data.get("choices", [{}])[0].get("message", {}).get("content", "")
            if not answer:
                raise RAGError("Empty response from Groq API.")
            return answer.strip()
    
    raise RAGError("All Groq models rate-limited.")

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
        logger.info(f"Sarvam Chat raw response: {res_data}")
        choices = res_data.get("choices", [])
        if not choices:
            raise RAGError("Empty response choices from Sarvam Chat completions.")

        answer = choices[0].get("message", {}).get("content")
        if not answer:
            # Try alternative response shapes
            answer = choices[0].get("text", "") or res_data.get("output", "")
        if not answer:
            raise RAGError(f"Sarvam Chat returned empty content. Raw: {res_data}")
        return answer.strip()

async def _dynamic_scrape_and_ingest(agent_id: str, query_vector: list[float]) -> list[str]:
    """
    When KB has no chunks, find the agent's registered URL resources,
    re-scrape them via Firecrawl, embed & store into ChromaDB,
    then re-query and return relevant chunks.
    """
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Resource).where(
                    Resource.agent_id == agent_id,
                    Resource.type == "url"
                )
            )
            url_resources = result.scalars().all()

        if not url_resources:
            logger.info(f"No URL resources registered for agent {agent_id}. Skipping dynamic scrape.")
            return []

        all_chunks = []
        for resource in url_resources:
            url = resource.name
            logger.info(f"Dynamic scraping URL: {url} for agent {agent_id}")
            try:
                scraped_chunks = await firecrawl.scrape_url(url)
                if scraped_chunks:
                    all_chunks.extend(scraped_chunks)

                    # Embed and store into ChromaDB immediately
                    vectors = await embeddings.embed_chunks(scraped_chunks)
                    await vector_store.store_chunks(agent_id, resource.id, scraped_chunks, vectors)
                    logger.info(f"Dynamically ingested {len(scraped_chunks)} chunks from {url}")

                    # Update resource status
                    async with AsyncSessionLocal() as db:
                        res = await db.execute(select(Resource).where(Resource.id == resource.id))
                        r = res.scalars().first()
                        if r:
                            r.status = "ready"
                            r.chunk_count = len(scraped_chunks)
                            await db.commit()
            except Exception as scrape_err:
                logger.warning(f"Failed to dynamically scrape {url}: {scrape_err}")
                continue

        if not all_chunks:
            return []

        # Re-query the now-populated vector store
        chunks = await vector_store.query_chunks(agent_id, query_vector, n_results=settings.RAG_TOP_K)
        return chunks

    except Exception as e:
        logger.error(f"Dynamic scrape and ingest failed for agent {agent_id}: {e}")
        return []

async def query_knowledge_base(agent_id: str, query_text: str, history: list[dict] = [], enabled_connectors: list[str] = [], source_lang: str = "en-IN") -> str:
    # 1. Fetch Agent configuration from database
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Agent).where(Agent.id == agent_id))
        agent = result.scalars().first()
        if not agent:
            raise RAGError(f"Agent with ID {agent_id} not found in database.")

        business_name = agent.business_name
        business_type = agent.business_type
        greeting = agent.greeting
        restrictions = agent.restrictions
        top_faqs = agent.top_faqs or []

    try:
        # 2. Embed query_text
        query_vectors = await embeddings.embed_chunks([query_text])
        if not query_vectors:
            raise RAGError("Failed to calculate embedding for the search query.")
        query_vector = query_vectors[0]

        # 3. Retrieve top matching document chunks from ChromaDB
        chunks = await vector_store.query_chunks(agent_id, query_vector, n_results=settings.RAG_TOP_K)

        # 3b. If no chunks found, auto-scrape the agent's registered URLs and ingest
        if not chunks:
            logger.info(f"No KB chunks for agent {agent_id}. Attempting dynamic website scrape...")
            chunks = await _dynamic_scrape_and_ingest(agent_id, query_vector)

        context = "\n\n".join(chunks) if chunks else settings.RAG_NO_CONTEXT_MESSAGE

        # Flag knowledge gap if still no relevant chunks found
        rag_context_found = bool(chunks)
        if not chunks:
            from services import insights as insights_svc
            asyncio.create_task(insights_svc.flag_knowledge_gap(agent_id, query_text))

        # 4. Formulate System Prompt
        # Replace the generic prompt with a fully dynamic one tailored to the agent's specific role
        system_prompt = (
            f"You are a specialized AI voice assistant acting as a {business_type} representative for {business_name}. "
            f"Your primary goal is to help users according to your role as a {business_type}.\n\n"
            f"CONVERSATION STEERING & INTENT: When a customer first interacts or is unsure what to do, you should proactively "
            f"ask them what they need help with by offering core services highly relevant to a {business_type} "
            f"(for example, if you are a Restaurant, you might ask if they want to book a table, check food availability, or place an order). "
            f"Once the customer states their intent, adapt your behavior to guide them through that specific process step-by-step.\n\n"
        )
        
        if greeting:
            system_prompt += f"GREETING INSTRUCTION: {greeting}\n\n"
            
        system_prompt += (
            "CRITICAL RULE: You MUST ONLY answer questions using the exact 'Context' provided below, "
            "or the FAQs provided below. If the user's question cannot be answered using this information, "
            "you MUST politely refuse to answer and state that you do not have that information. "
            "Under NO CIRCUMSTANCES should you use your general outside knowledge to answer questions about topics not found here. "
            "Be concise — max 2 sentences.\n\n"
        )

        if restrictions:
            system_prompt += f"RESTRICTIONS: {restrictions}\n\n"
            
        if top_faqs:
            system_prompt += "FREQUENTLY ASKED QUESTIONS (You can use these to answer):\n"
            for faq in top_faqs:
                if isinstance(faq, dict) and "q" in faq and "a" in faq:
                    system_prompt += f"Q: {faq['q']}\nA: {faq['a']}\n"
            system_prompt += "\n"

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
        
        # Append reminder to the final user message to prevent hallucination 
        # (models often forget the system prompt if history is long)
        final_query = f"{query_text}\n\n[System Reminder: You MUST ONLY use the provided Context to answer. If the answer is not in the Context, say you don't know.]"
        messages.append({"role": "user", "content": final_query})

        # 6. Route: Gemini → Groq → Ollama (local) → Sarvam
        if settings.GEMINI_API_KEY:
            try:
                logger.info(f"Submitting RAG query via Gemini for agent {agent_id}")
                return await _query_via_gemini(system_prompt, messages, query_text)
            except Exception as e:
                logger.warning(f"Gemini RAG failed, falling back: {e}")

        if settings.GROQ_API_KEY:
            groq_key = settings.GROQ_API_KEY  # noqa: F841
            try:
                logger.info(f"Submitting RAG query via Groq for agent {agent_id}")
                return await _query_via_groq(system_prompt, messages)
            except Exception as e:
                logger.warning(f"Groq RAG failed, falling back: {e}")

        try:
            logger.info(f"Submitting RAG query via Ollama/Gemma4 for agent {agent_id}")
            return await _query_via_ollama(system_prompt, messages)
        except Exception as e:
            logger.warning(f"Ollama RAG failed, falling back: {e}")

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

