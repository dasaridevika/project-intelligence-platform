import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class OutboxClaimRequest(BaseModel):
    batch_size: int = Field(default=10, ge=1, le=100)


class OutboxEventItem(BaseModel):
    event_id: uuid.UUID
    search_run_id: uuid.UUID
    event_type: str
    schema_version: int
    payload: Dict[str, Any]
    created_at: datetime


class OutboxClaimResponse(BaseModel):
    claimed_count: int
    events: List[OutboxEventItem]


class OutboxPublishConfirmResponse(BaseModel):
    event_id: uuid.UUID
    status: str
    published_at: datetime
