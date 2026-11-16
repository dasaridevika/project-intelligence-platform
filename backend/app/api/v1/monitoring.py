import uuid
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.models.analytics import ActivityEvent
from app.models.system import SystemError

router = APIRouter(prefix="/monitoring", tags=["Monitoring"])


class ActivityEventResponse(BaseModel):
    id: uuid.UUID
    search_run_id: uuid.UUID
    event_type: str
    component: str
    message: str
    metadata: Dict[str, Any]
    timestamp: str


class SystemErrorResponse(BaseModel):
    id: uuid.UUID
    search_run_id: Optional[uuid.UUID] = None
    component: str
    error_code: str
    message: str
    stack_trace: Optional[str] = None
    context: Dict[str, Any]
    created_at: str


@router.get("/events", response_model=List[ActivityEventResponse])
async def list_recent_activity_events(
    limit: int = Query(50, ge=1, le=200),
    component: Optional[str] = Query(None),
    event_type: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    """Retrieves live system-wide activity events for operational timeline visualization."""
    query = select(ActivityEvent).order_by(desc(ActivityEvent.timestamp)).limit(limit)
    if component:
        query = query.where(ActivityEvent.component == component)
    if event_type:
        query = query.where(ActivityEvent.event_type == event_type)

    result = await db.execute(query)
    events = result.scalars().all()

    return [
        ActivityEventResponse(
            id=ev.id,
            search_run_id=ev.search_run_id,
            event_type=ev.event_type,
            component=ev.component,
            message=ev.message,
            metadata=ev.metadata_,
            timestamp=ev.timestamp.isoformat()
        )
        for ev in events
    ]


@router.get("/errors", response_model=List[SystemErrorResponse])
async def list_system_errors(
    limit: int = Query(50, ge=1, le=200),
    component: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    """Retrieves logged system errors and diagnostic traces for operational troubleshooting."""
    query = select(SystemError).order_by(desc(SystemError.created_at)).limit(limit)
    if component:
        query = query.where(SystemError.component == component)

    result = await db.execute(query)
    errors = result.scalars().all()

    return [
        SystemErrorResponse(
            id=err.id,
            search_run_id=err.search_run_id,
            component=err.component,
            error_code=err.error_code,
            message=err.message,
            stack_trace=err.stack_trace,
            context=err.context,
            created_at=err.created_at.isoformat()
        )
        for err in errors
    ]
