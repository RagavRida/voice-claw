"""
Composio Tools Service.

Uses the Composio MCP (Model Context Protocol) endpoint for tool discovery
and execution. Each agent gets its own entity/user_id for isolated auth.

Architecture:
  1. COMPOSIO_SEARCH_TOOLS  → discover which tools to call
  2. COMPOSIO_MULTI_EXECUTE_TOOL → execute the tool
  3. COMPOSIO_MANAGE_CONNECTIONS → initiate OAuth connections
"""

import logging
import httpx
import json
from typing import List, Dict, Any, Optional
from sqlalchemy import select
from database import AsyncSessionLocal
from models import Connector
from config import settings

logger = logging.getLogger("composio_tools")

# Composio MCP endpoint
MCP_URL = "https://connect.composio.dev/mcp"
MCP_API_KEY = settings.COMPOSIO_API_KEY

# Map our internal connector keys to Composio toolkit slugs
TOOLKIT_MAP = {
    "google_calendar": "googlecalendar",
    "whatsapp_twilio": "twilio",
    "hubspot_crm": "hubspot",
    "shopify_catalog": "shopify",
}

# Session tracking per agent for Composio MCP
_agent_sessions: dict[str, str] = {}


async def _mcp_call(method: str, params: dict) -> dict | None:
    """Make a JSON-RPC call to the Composio MCP endpoint."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                MCP_URL,
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json, text/event-stream",
                    "Authorization": f"Bearer {MCP_API_KEY}",
                },
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": method,
                    "params": params,
                },
            )

            # Parse SSE response (Composio returns event-stream)
            body = response.text
            for line in body.split("\n"):
                if line.startswith("data:"):
                    data = json.loads(line[5:].strip())
                    if "error" in data:
                        logger.error(f"MCP error: {data['error']}")
                        return None
                    return data.get("result", {})

            # Fallback: try parsing as direct JSON
            try:
                data = response.json()
                return data.get("result", {})
            except Exception:
                pass

            return None
    except Exception as e:
        logger.error(f"MCP call failed: {e}", exc_info=True)
        return None


async def search_tools(use_case: str, agent_id: str = "default") -> dict | None:
    """
    Use COMPOSIO_SEARCH_TOOLS to find relevant tools for a use case.
    Returns the full search result including tool schemas and execution plan.
    """
    session_params = {}
    if agent_id in _agent_sessions:
        session_params = {"id": _agent_sessions[agent_id]}
    else:
        session_params = {"generate_id": True}

    result = await _mcp_call("tools/call", {
        "name": "COMPOSIO_SEARCH_TOOLS",
        "arguments": {
            "queries": [{"use_case": use_case}],
            "session": session_params,
        },
    })

    if result:
        # Extract session_id from response for reuse
        content = result.get("content", [])
        for c in content:
            if c.get("type") == "text":
                try:
                    text_data = json.loads(c["text"]) if isinstance(c["text"], str) else c["text"]
                    session_id = text_data.get("data", {}).get("session_id")
                    if session_id:
                        _agent_sessions[agent_id] = session_id
                except (json.JSONDecodeError, AttributeError):
                    pass
        return result

    return None


async def execute_tool(tool_slug: str, params: dict, agent_id: str = "default") -> str:
    """
    Execute a tool via COMPOSIO_MULTI_EXECUTE_TOOL on the MCP endpoint.
    """
    result = await _mcp_call("tools/call", {
        "name": "COMPOSIO_MULTI_EXECUTE_TOOL",
        "arguments": {
            "actions": [{
                "tool_slug": tool_slug,
                "arguments": params,
            }],
            "session": {"id": _agent_sessions.get(agent_id, "default")},
        },
    })

    if result:
        content = result.get("content", [])
        for c in content:
            if c.get("type") == "text":
                return c["text"][:2000]  # Cap output
        return str(result)

    return "Tool execution failed — no response from Composio MCP."


async def initiate_connection(toolkit_slug: str, agent_id: str = "default") -> str | None:
    """
    Use COMPOSIO_MANAGE_CONNECTIONS to initiate an OAuth flow for a toolkit.
    Returns the redirect URL for the user to authorize.
    """
    result = await _mcp_call("tools/call", {
        "name": "COMPOSIO_MANAGE_CONNECTIONS",
        "arguments": {
            "toolkits": [{
                "name": toolkit_slug,
                "action": "add",
            }],
        },
    })

    if result:
        content = result.get("content", [])
        for c in content:
            if c.get("type") == "text":
                text = c["text"]
                # Extract redirect URL from response
                import re
                url_match = re.search(r'https?://[^\s\)\"\']+', text)
                if url_match:
                    return url_match.group(0)
                return text
    return None


async def check_connection_status(toolkit_slug: str) -> bool:
    """Check if a toolkit has an active connection via COMPOSIO_MANAGE_CONNECTIONS list."""
    result = await _mcp_call("tools/call", {
        "name": "COMPOSIO_MANAGE_CONNECTIONS",
        "arguments": {
            "toolkits": [{
                "name": toolkit_slug,
                "action": "list",
            }],
        },
    })

    if result:
        content = result.get("content", [])
        for c in content:
            if c.get("type") == "text":
                text = c["text"].lower()
                return "active" in text
    return False


async def get_tools_for_agent(agent_id: str) -> list:
    """
    Get enabled connectors for the agent, search for relevant tools
    via Composio MCP, and return tool definitions for Gemini to use.

    Returns a list of tool dicts with name, description, and parameters
    formatted for google.genai function calling.
    """
    enabled_toolkits = []

    # 1. Load enabled connectors from DB
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Connector).where(Connector.agent_id == agent_id, Connector.enabled == 1)
        )
        connectors = result.scalars().all()
        for c in connectors:
            toolkit = TOOLKIT_MAP.get(c.connector_key)
            if toolkit:
                enabled_toolkits.append(toolkit)

    if not enabled_toolkits:
        return []

    # 2. Search for tools via MCP for each enabled toolkit
    all_tools = []
    for toolkit in enabled_toolkits:
        use_case_map = {
            "googlecalendar": "manage google calendar events, find free slots, create events",
            "twilio": "send SMS or WhatsApp messages via twilio",
            "hubspot": "manage hubspot contacts and deals",
            "shopify": "list and search shopify products",
        }
        use_case = use_case_map.get(toolkit, f"use {toolkit} tools")
        result = await search_tools(use_case, agent_id)
        if result:
            all_tools.append({"toolkit": toolkit, "search_result": result})

    return all_tools


async def execute_tool_call(tool_name: str, params: dict, entity_id: str = "default") -> str:
    """Execute a specific tool call via Composio MCP."""
    return await execute_tool(tool_name, params, entity_id)
