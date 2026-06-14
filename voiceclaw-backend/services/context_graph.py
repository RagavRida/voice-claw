"""
Context Graph Service for VoiceClaw.

Maintains a per-agent knowledge graph that extracts entities and relationships
from ingested documents. During RAG queries, the graph is traversed to provide
structured context alongside vector search results, enabling deeper factual
answers and cross-document reasoning.

Architecture:
  - Graph stored as JSON files per agent (lightweight, no external DB needed)
  - Entities: business concepts (products, services, people, locations, prices, hours)
  - Relationships: typed edges between entities (offers, costs, located_at, open_during)
  - Extraction: LLM-based entity/relation extraction during document ingestion
  - Query-time: Extract entities from user query → traverse graph → inject into RAG context
"""

import os
import json
import asyncio
import logging
import httpx
from config import settings

logger = logging.getLogger("context_graph")

GRAPH_DIR = os.path.join(settings.CHROMA_PERSIST_DIR, "context_graphs")
os.makedirs(GRAPH_DIR, exist_ok=True)


# ── Graph Data Structure ─────────────────────────────────────────────────────

class ContextGraph:
    """Lightweight in-memory knowledge graph for a single agent."""

    def __init__(self, agent_id: str):
        self.agent_id = agent_id
        self.entities: dict[str, dict] = {}   # id -> {name, type, attributes}
        self.edges: list[dict] = []           # [{source, target, relation, meta}]
        self._file_path = os.path.join(GRAPH_DIR, f"{agent_id}.json")
        self._load()

    def _load(self):
        """Load graph from disk if it exists."""
        if os.path.exists(self._file_path):
            try:
                with open(self._file_path, "r") as f:
                    data = json.load(f)
                self.entities = data.get("entities", {})
                self.edges = data.get("edges", [])
                logger.info(f"Loaded context graph for agent {self.agent_id}: "
                            f"{len(self.entities)} entities, {len(self.edges)} edges")
            except Exception as e:
                logger.warning(f"Failed to load graph for {self.agent_id}: {e}")
                self.entities = {}
                self.edges = []

    def save(self):
        """Persist graph to disk."""
        try:
            with open(self._file_path, "w") as f:
                json.dump({
                    "agent_id": self.agent_id,
                    "entities": self.entities,
                    "edges": self.edges,
                }, f, indent=2, ensure_ascii=False)
            logger.info(f"Saved context graph for agent {self.agent_id}: "
                        f"{len(self.entities)} entities, {len(self.edges)} edges")
        except Exception as e:
            logger.error(f"Failed to save graph for {self.agent_id}: {e}")

    def add_entity(self, entity_id: str, name: str, entity_type: str, attributes: dict = None):
        """Add or update an entity in the graph."""
        normalized_id = entity_id.lower().strip().replace(" ", "_")
        if normalized_id in self.entities:
            # Merge attributes
            existing = self.entities[normalized_id]
            if attributes:
                existing_attrs = existing.get("attributes", {})
                existing_attrs.update(attributes)
                existing["attributes"] = existing_attrs
        else:
            self.entities[normalized_id] = {
                "name": name,
                "type": entity_type,
                "attributes": attributes or {},
            }

    def add_edge(self, source: str, target: str, relation: str, meta: dict = None):
        """Add a relationship edge between two entities."""
        src = source.lower().strip().replace(" ", "_")
        tgt = target.lower().strip().replace(" ", "_")
        # Avoid duplicate edges
        for edge in self.edges:
            if edge["source"] == src and edge["target"] == tgt and edge["relation"] == relation:
                return
        self.edges.append({
            "source": src,
            "target": tgt,
            "relation": relation,
            "meta": meta or {},
        })

    def get_related(self, entity_id: str, max_depth: int = 2) -> list[dict]:
        """BFS traversal from an entity to find related entities."""
        normalized = entity_id.lower().strip().replace(" ", "_")
        if normalized not in self.entities:
            return []

        visited = set()
        queue = [(normalized, 0)]
        results = []

        while queue:
            current, depth = queue.pop(0)
            if current in visited or depth > max_depth:
                continue
            visited.add(current)

            if current in self.entities:
                results.append({
                    "entity": self.entities[current],
                    "id": current,
                    "depth": depth,
                })

            # Find connected entities
            for edge in self.edges:
                if edge["source"] == current and edge["target"] not in visited:
                    queue.append((edge["target"], depth + 1))
                if edge["target"] == current and edge["source"] not in visited:
                    queue.append((edge["source"], depth + 1))

        return results

    def find_entities_by_name(self, query: str) -> list[str]:
        """Fuzzy find entity IDs that match a query string."""
        query_lower = query.lower()
        matches = []
        for eid, entity in self.entities.items():
            name = entity.get("name", "").lower()
            if query_lower in name or name in query_lower:
                matches.append(eid)
            # Also check entity type
            etype = entity.get("type", "").lower()
            if query_lower in etype:
                matches.append(eid)
        return list(set(matches))

    def to_context_string(self, entity_ids: list[str], max_depth: int = 1) -> str:
        """Convert a set of entities and their relationships to a readable context string."""
        if not entity_ids:
            return ""

        lines = ["=== Knowledge Graph Context ==="]
        seen_entities = set()
        seen_edges = set()

        for eid in entity_ids:
            related = self.get_related(eid, max_depth=max_depth)
            for item in related:
                item_id = item["id"]
                if item_id not in seen_entities:
                    seen_entities.add(item_id)
                    e = item["entity"]
                    attrs = ", ".join(f"{k}: {v}" for k, v in e.get("attributes", {}).items())
                    line = f"• {e['name']} [{e['type']}]"
                    if attrs:
                        line += f" — {attrs}"
                    lines.append(line)

            # Find edges between relevant entities
            for edge in self.edges:
                edge_key = f"{edge['source']}-{edge['relation']}-{edge['target']}"
                if edge_key not in seen_edges:
                    if edge["source"] in seen_entities or edge["target"] in seen_entities:
                        seen_edges.add(edge_key)
                        src_name = self.entities.get(edge["source"], {}).get("name", edge["source"])
                        tgt_name = self.entities.get(edge["target"], {}).get("name", edge["target"])
                        lines.append(f"  → {src_name} --[{edge['relation']}]--> {tgt_name}")

        if len(lines) <= 1:
            return ""
        return "\n".join(lines)

    def get_stats(self) -> dict:
        """Return graph statistics."""
        entity_types = {}
        for e in self.entities.values():
            t = e.get("type", "unknown")
            entity_types[t] = entity_types.get(t, 0) + 1
        return {
            "total_entities": len(self.entities),
            "total_edges": len(self.edges),
            "entity_types": entity_types,
        }


# ── Graph Cache ──────────────────────────────────────────────────────────────

_graph_cache: dict[str, ContextGraph] = {}


def get_graph(agent_id: str) -> ContextGraph:
    """Get or create a context graph for an agent."""
    if agent_id not in _graph_cache:
        _graph_cache[agent_id] = ContextGraph(agent_id)
    return _graph_cache[agent_id]


# ── Entity Extraction via LLM ────────────────────────────────────────────────

EXTRACTION_PROMPT = """You are an entity extraction engine. Given a text chunk from a business document, extract all entities and relationships.

Output ONLY valid JSON with this schema:
{
  "entities": [
    {"id": "unique_snake_case", "name": "Display Name", "type": "product|service|person|location|price|time|contact|policy|faq", "attributes": {"key": "value"}}
  ],
  "edges": [
    {"source": "entity_id_1", "target": "entity_id_2", "relation": "offers|costs|located_at|open_during|has_contact|includes|requires|related_to"}
  ]
}

Rules:
- Extract business-relevant entities: products, services, prices, locations, hours, contacts, policies
- Create meaningful relationships between them
- Use snake_case for IDs
- Keep attribute values concise
- If no entities found, return {"entities": [], "edges": []}
- Output ONLY the JSON, no markdown fences or explanation"""


async def extract_entities_from_chunk(chunk: str) -> dict:
    """Use Groq/Gemini to extract entities and relationships from a text chunk."""
    messages = [
        {"role": "system", "content": EXTRACTION_PROMPT},
        {"role": "user", "content": f"Extract entities and relationships from this text:\n\n{chunk}"},
    ]

    # Try Groq first
    if settings.GROQ_API_KEY:
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {settings.GROQ_API_KEY}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": "llama-3.3-70b-versatile",
                        "messages": messages,
                        "max_tokens": 1000,
                        "temperature": 0.1,
                    },
                )
                if response.status_code == 200:
                    text = response.json()["choices"][0]["message"]["content"].strip()
                    # Clean up potential markdown fences
                    if text.startswith("```"):
                        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
                    if text.endswith("```"):
                        text = text[:-3]
                    text = text.strip()
                    return json.loads(text)
        except Exception as e:
            logger.warning(f"Groq entity extraction failed: {e}")

    # Fallback to Gemini
    if settings.GEMINI_API_KEY:
        try:
            import asyncio as aio
            from google import genai

            gemini_client = genai.Client(api_key=settings.GEMINI_API_KEY)
            response = await aio.to_thread(
                gemini_client.models.generate_content,
                model=settings.GEMINI_MODEL,
                contents=f"{EXTRACTION_PROMPT}\n\nText:\n{chunk}",
            )
            text = response.text.strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()
            return json.loads(text)
        except Exception as e:
            logger.warning(f"Gemini entity extraction failed: {e}")

    return {"entities": [], "edges": []}


# ── Public API ────────────────────────────────────────────────────────────────

async def ingest_chunks(agent_id: str, chunks: list[str], resource_id: str = None):
    """
    Extract entities and relationships from document chunks and add to the agent's context graph.
    Called during document ingestion (after chunking, alongside embedding).
    """
    graph = get_graph(agent_id)
    total_entities = 0
    total_edges = 0

    for i, chunk in enumerate(chunks):
        if not chunk.strip():
            continue
        try:
            result = await extract_entities_from_chunk(chunk)
            entities = result.get("entities", [])
            edges = result.get("edges", [])

            for entity in entities:
                eid = entity.get("id", "")
                if not eid:
                    continue
                graph.add_entity(
                    entity_id=eid,
                    name=entity.get("name", eid),
                    entity_type=entity.get("type", "unknown"),
                    attributes=entity.get("attributes", {}),
                )
                total_entities += 1

            for edge in edges:
                if edge.get("source") and edge.get("target"):
                    graph.add_edge(
                        source=edge["source"],
                        target=edge["target"],
                        relation=edge.get("relation", "related_to"),
                        meta={"resource_id": resource_id, "chunk_index": i} if resource_id else {},
                    )
                    total_edges += 1

        except Exception as e:
            logger.warning(f"Entity extraction failed for chunk {i} of agent {agent_id}: {e}")
            continue

    graph.save()
    logger.info(f"Context graph updated for agent {agent_id}: "
                f"+{total_entities} entities, +{total_edges} edges (total: {graph.get_stats()})")


async def get_graph_context(agent_id: str, query_text: str) -> str:
    """
    Given a user query, find relevant entities in the context graph
    and return a structured context string for the RAG prompt.
    """
    graph = get_graph(agent_id)
    if not graph.entities:
        return ""

    # Extract key terms from the query to match against graph entities
    query_words = query_text.lower().split()
    matched_ids = set()

    # Match individual words and bigrams against entity names
    for word in query_words:
        if len(word) < 3:
            continue
        matches = graph.find_entities_by_name(word)
        matched_ids.update(matches)

    # Also try bigrams
    for i in range(len(query_words) - 1):
        bigram = f"{query_words[i]} {query_words[i+1]}"
        matches = graph.find_entities_by_name(bigram)
        matched_ids.update(matches)

    # If no direct matches, try matching against the full query
    if not matched_ids:
        matches = graph.find_entities_by_name(query_text)
        matched_ids.update(matches)

    if not matched_ids:
        return ""

    # Generate context string from matched entities and their neighbors
    context = graph.to_context_string(list(matched_ids)[:10], max_depth=2)
    return context


def get_graph_stats(agent_id: str) -> dict:
    """Return graph statistics for an agent."""
    graph = get_graph(agent_id)
    return graph.get_stats()
