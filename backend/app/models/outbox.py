import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from sqlalchemy import DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON
from app.core.database import Base
from app.models.base import GUID, TimestampMixin


class OutboxEvent(Base, TimestampMixin):
    """Transactional outbox record committed atomically with search runs."""
    __tablename__ = "outbox_events"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    search_run_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("search_runs.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    event_type: Mapped[str] = mapped_column(String(100), default="project_search_requested", nullable=False)
    schema_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    payload: Mapped[Dict[str, Any]] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"),
        nullable=False
    )
    status: Mapped[str] = mapped_column(String(50), default="pending", nullable=False, index=True)  # pending, claimed, published, failed
    retry_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationship
    search_run = relationship("SearchRun", back_populates="outbox_event")

    __table_args__ = (
        Index("idx_outbox_status_created", "status", "created_at"),
    )


class ProcessedMessage(Base):
    """Guarantees at-least-once queue message idempotency in the Python consumer."""
    __tablename__ = "processed_messages"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(GUID, unique=True, nullable=False, index=True)
    search_run_id: Mapped[uuid.UUID] = mapped_column(GUID, nullable=False, index=True)
    consumer_id: Mapped[str] = mapped_column(String(100), nullable=False)
    processed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False
    )
