import logging
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from database import get_db
from models import Agent, Resource
from services import vector_store, context_graph

logger = logging.getLogger("agent_router")

router = APIRouter()

@router.get("/agent/{agent_id}")
async def get_agent(agent_id: str, db: AsyncSession = Depends(get_db)):
    try:
        result = await db.execute(select(Agent).where(Agent.id == agent_id))
        agent = result.scalars().first()
        if not agent:
            raise HTTPException(status_code=404, detail={"error": "Not found"})
            
        return {
            "id": agent.id,
            "business_name": agent.business_name,
            "business_type": agent.business_type,
            "primary_language": agent.primary_language,
            "greeting": agent.greeting,
            "restrictions": agent.restrictions,
            "top_faqs": agent.top_faqs,
            "dict_id": agent.dict_id,
            "created_at": agent.created_at
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting agent {agent_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "Database error", "detail": str(e)})

@router.get("/agent/{agent_id}/resources")
async def get_agent_resources(agent_id: str, db: AsyncSession = Depends(get_db)):
    try:
        result = await db.execute(select(Resource).where(Resource.agent_id == agent_id))
        resources = result.scalars().all()
        return [
            {
                "id": r.id,
                "type": r.type,
                "name": r.name,
                "status": r.status,
                "chunk_count": r.chunk_count,
                "created_at": r.created_at
            }
            for r in resources
        ]
    except Exception as e:
        logger.error(f"Error getting resources for agent {agent_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "Database error", "detail": str(e)})

@router.delete("/agent/{agent_id}/resource/{resource_id}")
async def delete_agent_resource(agent_id: str, resource_id: str, db: AsyncSession = Depends(get_db)):
    try:
        result = await db.execute(select(Resource).where((Resource.id == resource_id)))
        resource = result.scalars().first()
        if not resource:
            raise HTTPException(status_code=404, detail={"error": "Not found"})
            
        # Delete from vector store
        # First check where the chunks were stored (could be agent_id or temp_resource_id)
        # We will delete from agent_id collection. If not found there, we also try temp_resource_id
        await vector_store.delete_resource_chunks(agent_id, resource_id)
        await vector_store.delete_resource_chunks(f"temp_{resource_id}", resource_id)
        
        # Delete from DB
        await db.execute(delete(Resource).where(Resource.id == resource_id))
        await db.commit()
        
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting resource {resource_id} for agent {agent_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "Database error", "detail": str(e)})

@router.get("/agent/{agent_id}/graph")
async def get_agent_graph(
    agent_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Return the context graph stats and entities for an agent."""
    try:
        result = await db.execute(select(Agent).where(Agent.id == agent_id))
        agent = result.scalars().first()
        if not agent:
            raise HTTPException(status_code=404, detail={"error": "Agent not found"})

        graph = context_graph.get_graph(agent_id)
        stats = graph.get_stats()
        
        # Return stats + first 50 entities for preview
        entities_preview = []
        for eid, entity in list(graph.entities.items())[:50]:
            entities_preview.append({
                "id": eid,
                "name": entity.get("name", ""),
                "type": entity.get("type", ""),
                "attributes": entity.get("attributes", {}),
            })

        edges_preview = graph.edges[:50]

        return {
            "agent_id": agent_id,
            "stats": stats,
            "entities": entities_preview,
            "edges": edges_preview,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting graph for agent {agent_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "Server error", "detail": str(e)})
