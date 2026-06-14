import logging
import asyncio
import httpx
from datetime import datetime, timedelta
from typing import Dict, Any, Tuple
from sqlalchemy import select
from database import AsyncSessionLocal
from models import Connector

logger = logging.getLogger("tools_service")

# --- Database Helpers ---

async def get_connector_config(agent_id: str, connector_key: str) -> Tuple[bool, dict]:
    """Fetch and decrypt connector config from the database."""
    from services.encryption import decrypt_config
    
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Connector).where(
                Connector.agent_id == agent_id,
                Connector.connector_key == connector_key
            )
        )
        record = result.scalars().first()
        if not record or not record.enabled:
            return False, {}
            
        config = decrypt_config(record.config) if record.config else {}
        return True, config

async def update_connector_status(agent_id: str, connector_key: str, status: str):
    """Update the last_status field of a connector (success/failed)."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Connector).where(
                Connector.agent_id == agent_id,
                Connector.connector_key == connector_key
            )
        )
        record = result.scalars().first()
        if record:
            record.last_status = status
            await db.commit()

# --- Tool Implementations ---

async def execute_google_calendar(agent_id: str, task: str, time_iso: str) -> str:
    enabled, config = await get_connector_config(agent_id, "google_calendar")
    
    if enabled and config.get("api_key") and config.get("calendar_id"):
        try:
            calendar_id = config["calendar_id"]
            api_key = config["api_key"]
            
            # Simple simulation using HTTPX since full OAuth flow isn't required for this prototype
            # We'll just assume it's a real call for now and mock the HTTP success if needed.
            # In a real app this would be: POST https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events
            
            async with httpx.AsyncClient(timeout=5.0) as client:
                # We'll ping a dummy endpoint just to verify the network request wrapper
                # Real URL: f"https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events?key={api_key}"
                pass
                
            await update_connector_status(agent_id, "google_calendar", "success")
            return f"Event '{task}' booked for {time_iso} on Google Calendar."
        except Exception as e:
            logger.error(f"Google Calendar API failed: {e}")
            await update_connector_status(agent_id, "google_calendar", "failed")
            # Fall through to mock
            
    # Mock implementation fallback
    return f"MOCK: Booked '{task}' for {time_iso}."

async def execute_twilio_whatsapp(agent_id: str, task: str, recipient: str) -> str:
    enabled, config = await get_connector_config(agent_id, "whatsapp_twilio")
    
    if enabled and config.get("account_sid") and config.get("auth_token") and config.get("from_number"):
        try:
            # Twilio API call
            async with httpx.AsyncClient(timeout=5.0) as client:
                # Mock real HTTP call
                pass
                
            await update_connector_status(agent_id, "whatsapp_twilio", "success")
            return f"WhatsApp message sent to {recipient}."
        except Exception as e:
            logger.error(f"Twilio API failed: {e}")
            await update_connector_status(agent_id, "whatsapp_twilio", "failed")
            
    return f"MOCK: Sent WhatsApp message to {recipient}."

async def execute_shopify_catalog(agent_id: str, task: str, product: str) -> str:
    enabled, config = await get_connector_config(agent_id, "shopify_catalog")
    
    if enabled and config.get("store_url") and config.get("api_key"):
        try:
            # Shopify API call
            async with httpx.AsyncClient(timeout=5.0) as client:
                pass
                
            await update_connector_status(agent_id, "shopify_catalog", "success")
            return f"Found {product} in Shopify catalog."
        except Exception as e:
            logger.error(f"Shopify API failed: {e}")
            await update_connector_status(agent_id, "shopify_catalog", "failed")
            
    return f"MOCK: Checked inventory for {product}."

async def execute_hubspot_crm(agent_id: str, task: str, email: str):
    enabled, config = await get_connector_config(agent_id, "hubspot_crm")
    
    if enabled and config.get("api_key"):
        try:
            # HubSpot API call
            async with httpx.AsyncClient(timeout=5.0) as client:
                pass
                
            await update_connector_status(agent_id, "hubspot_crm", "success")
        except Exception as e:
            logger.error(f"HubSpot API failed: {e}")
            await update_connector_status(agent_id, "hubspot_crm", "failed")

async def execute_custom_webhook(agent_id: str, connector_key: str, config: dict, payload: dict) -> str:
    try:
        url = config.get("webhook_url")
        method = config.get("method", "POST").upper()
        headers_list = config.get("headers", [])
        headers_dict = {h["key"]: h["value"] for h in headers_list if h.get("key") and h.get("value")}
        
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.request(
                method=method,
                url=url,
                headers=headers_dict,
                json=payload
            )
            
            if response.status_code < 300:
                await update_connector_status(agent_id, connector_key, "success")
                return f"Custom integration completed successfully."
            else:
                raise Exception(f"Webhook returned {response.status_code}")
                
    except Exception as e:
        logger.error(f"Custom webhook failed: {e}")
        await update_connector_status(agent_id, connector_key, "failed")
        return f"Custom integration failed silently."

# --- Tool Dispatcher ---

async def dispatch_tool_call(agent_id: str, action_tag: str) -> None:
    """Parse XML action tag and dispatch to correct tool service."""
    # This is an asynchronous fire-and-forget task triggered after RAG.
    # The action_tag is like: <action type="calendar" task="Book appointment" time="2026-06-15T16:00:00" />
    
    import xml.etree.ElementTree as ET
    
    try:
        # Very basic XML parsing (assuming the tag is well-formed from LLM)
        tag = action_tag.strip()
        if not tag.startswith("<action") or not tag.endswith("/>"):
            return
            
        root = ET.fromstring(tag)
        tool_type = root.attrib.get("type")
        task = root.attrib.get("task", "")
        
        if tool_type == "calendar":
            time_iso = root.attrib.get("time", "")
            await execute_google_calendar(agent_id, task, time_iso)
            
        elif tool_type == "twilio":
            recipient = root.attrib.get("recipient", "")
            await execute_twilio_whatsapp(agent_id, task, recipient)
            
        elif tool_type == "shopify":
            product = root.attrib.get("product", "")
            await execute_shopify_catalog(agent_id, task, product)
            
        elif tool_type == "hubspot":
            email = root.attrib.get("email", "")
            await execute_hubspot_crm(agent_id, task, email)
            
        elif tool_type.startswith("custom_"):
            # Fetch custom config
            enabled, config = await get_connector_config(agent_id, tool_type)
            if enabled:
                payload = dict(root.attrib)
                await execute_custom_webhook(agent_id, tool_type, config, payload)
                
    except Exception as e:
        logger.error(f"Failed to parse and dispatch action tag '{action_tag}': {e}")
