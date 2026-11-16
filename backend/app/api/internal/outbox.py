import uuid
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.core.database import get_db
from app.core.logging import logger
from app.core.security import verify_internal_api_key
from app.models.outbox import OutboxEvent
from app.schemas.outbox import (
    OutboxClaimRequest,
    OutboxClaimResponse,
    OutboxEventItem,
    OutboxPublishConfirmResponse,
)

router = APIRouter(prefix="/internal/v1/outbox", tags=["Internal Outbox"])


def require_internal_key(x_internal_key: Optional[str] = Header(None, alias="X-Internal-Key")):
    """Validates that the caller holds the authorized internal service key."""
    if not verify_internal_api_key(x_internal_key):
        logger.warning("Unauthorized access attempt to internal outbox endpoint")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Valid X-Internal-Key header is required"
        )


@router.post("/claim", response_model=OutboxClaimResponse, dependencies=[Depends(require_internal_key)])
async def claim_pending_events(
    req: OutboxClaimRequest,
    db: AsyncSession = Depends(get_db)
):
    """Claims a batch of pending outbox events for publishing to Cloudflare Queues."""
    stmt = (
        select(OutboxEvent)
        .where(OutboxEvent.status == "pending")
        .order_by(OutboxEvent.created_at.asc())
        .limit(req.batch_size)
    )

    # Use FOR UPDATE SKIP LOCKED if supported (PostgreSQL)
    if "postgresql" in settings.DATABASE_URL:
        stmt = stmt.with_for_update(skip_locked=True)

    result = await db.execute(stmt)
    events = result.scalars().all()

    claimed_items = []
    for ev in events:
        ev.status = "claimed"
        claimed_items.append(
            OutboxEventItem(
                event_id=ev.id,
                search_run_id=ev.search_run_id,
                event_type=ev.event_type,
                schema_version=ev.schema_version,
                payload=ev.payload,
                created_at=ev.created_at
            )
        )

    await db.commit()

    return OutboxClaimResponse(
        claimed_count=len(claimed_items),
        events=claimed_items
    )


@router.post("/{event_id}/published", response_model=OutboxPublishConfirmResponse, dependencies=[Depends(require_internal_key)])
async def confirm_event_published(
    event_id: uuid.UUID,
    db: AsyncSession = Depends(get_db)
):
    """Marks an outbox event as successfully published to the message queue."""
    stmt = select(OutboxEvent).where(OutboxEvent.id == event_id)
    ev = (await db.execute(stmt)).scalar_one_or_none()

    if not ev:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Outbox event not found")

    ev.status = "published"
    ev.published_at = datetime.now(timezone.utc)
    await db.commit()

    return OutboxPublishConfirmResponse(
        event_id=ev.id,
        status=ev.status,
        published_at=ev.published_at
    )
