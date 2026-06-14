"""
Connectors Router.

Handles OAuth connection initiation via Composio MCP and status polling.
Business owners click "Connect" and are redirected to OAuth — no API keys needed.
"""

import logging
from typing import Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_db
from models import Agent, Connector
from services.composio_tools import (
    TOOLKIT_MAP,
    initiate_connection,
    check_connection_status,
)
from config import settings

logger = logging.getLogger("connectors_router")

router = APIRouter()


class ConnectRequest(BaseModel):
    connector: str


@router.post("/agent/{agent_id}/connectors/connect")
async def connect_integration(
    agent_id: str,
    payload: ConnectRequest,
    db: AsyncSession = Depends(get_db),
):
    try:
        # Check agent exists
        result = await db.execute(select(Agent).where(Agent.id == agent_id))
        if not result.scalars().first():
            raise HTTPException(status_code=404, detail={"error": "Agent not found"})

        toolkit_slug = TOOLKIT_MAP.get(payload.connector)
        if not toolkit_slug:
            raise HTTPException(status_code=400, detail={"error": f"Unknown connector: {payload.connector}"})

        # Initiate connection via Composio MCP
        auth_url = await initiate_connection(toolkit_slug, agent_id)

        if not auth_url:
            raise HTTPException(
                status_code=500,
                detail={"error": f"Failed to initiate {toolkit_slug} connection via Composio."}
            )

        # Save placeholder row in DB
        result = await db.execute(
            select(Connector).where(
                Connector.agent_id == agent_id,
                Connector.connector_key == payload.connector,
            )
        )
        connector_record = result.scalars().first()
        if not connector_record:
            connector_record = Connector(
                agent_id=agent_id,
                connector_key=payload.connector,
                enabled=0,
                config=None,
                last_status="pending",
            )
            db.add(connector_record)
        else:
            connector_record.last_status = "pending"

        await db.commit()

        return {"auth_url": auth_url}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error initiating connection for {payload.connector}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": str(e)})


@router.get("/agent/{agent_id}/connectors/status")
async def get_connectors_status(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Check the true status of connectors by querying Composio MCP.
    """
    try:
        result = await db.execute(select(Connector).where(Connector.agent_id == agent_id))
        connectors = result.scalars().all()

        response = []

        for c in connectors:
            if c.connector_key.startswith("custom_"):
                response.append({
                    "connector_key": c.connector_key,
                    "connected": bool(c.enabled),
                    "account_label": "Custom Webhook",
                    "last_status": c.last_status,
                })
                continue

            toolkit_slug = TOOLKIT_MAP.get(c.connector_key)
            connected = False

            if toolkit_slug:
                try:
                    connected = await check_connection_status(toolkit_slug)
                except Exception as e:
                    logger.warning(f"Failed to check {toolkit_slug} status: {e}")

            # Update DB if connection state changed
            if connected and c.enabled == 0:
                c.enabled = 1
                c.last_status = "success"
            elif not connected and c.last_status == "pending":
                pass  # still waiting

            response.append({
                "connector_key": c.connector_key,
                "connected": connected,
                "account_label": "Connected" if connected else None,
                "last_status": "success" if connected else c.last_status,
            })

        await db.commit()
        return response

    except Exception as e:
        logger.error(f"Error fetching connectors status for agent {agent_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": str(e)})


@router.get("/agent/{agent_id}/connectors")
async def get_connectors(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Legacy endpoint — delegates to status."""
    return await get_connectors_status(agent_id, db)


# ── Custom Webhooks (not via Composio) ────────────────────────────────────────

@router.post("/agent/{agent_id}/connectors/custom")
async def save_custom_connector(
    agent_id: str,
    payload: dict,
    db: AsyncSession = Depends(get_db),
):
    from services.encryption import encrypt_config

    try:
        key = payload.get("connector")
        if not key or not key.startswith("custom_"):
            raise HTTPException(status_code=400, detail="Invalid custom connector key")

        encrypted_config = encrypt_config(payload.get("config"))

        result = await db.execute(
            select(Connector).where(
                Connector.agent_id == agent_id,
                Connector.connector_key == key,
            )
        )
        record = result.scalars().first()
        if record:
            record.enabled = 1
            record.config = encrypted_config
            record.last_status = "success"
        else:
            record = Connector(
                agent_id=agent_id,
                connector_key=key,
                enabled=1,
                config=encrypted_config,
                last_status="success",
            )
            db.add(record)

        await db.commit()
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
