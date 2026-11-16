import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from sqlalchemy import DateTime, ForeignKey, Index, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON
from app.core.database import Base
from app.models.base import GUID, TimestampMixin


class APIUsage(Base, TimestampMixin):
    """Tracks provider API calls, latency, error codes, and cost."""
    __tablename__ = "api_usage"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    search_run_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("search_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    endpoint: Mapped[str] = mapped_column(String(255), nullable=False)
    http_status: Mapped[int] = mapped_column(Integer, nullable=False)
    latency_ms: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    retry_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    units_consumed: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    estimated_cost: Mapped[Optional[float]] = mapped_column(Numeric(10, 6), nullable=True)
    response_meta: Mapped[Dict[str, Any]] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"),
        default=dict,
        nullable=False
    )

    # Relationship
    search_run = relationship("SearchRun", back_populates="api_usage")

    __table_args__ = (
        Index("idx_api_usage_provider_created", "provider", "created_at"),
    )


class ActivityEvent(Base):
    """Fine-grained execution event for real-time SSE streaming and audit trails."""
    __tablename__ = "activity_events"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    search_run_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("search_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    component: Mapped[str] = mapped_column(String(50), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_: Mapped[Dict[str, Any]] = mapped_column(
        "metadata",
        JSON().with_variant(JSONB, "postgresql"),
        default=dict,
        nullable=False
    )
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True
    )

    # Relationship
    search_run = relationship("SearchRun", back_populates="activity_events")

    __table_args__ = (
        Index("idx_activity_search_timestamp", "search_run_id", "timestamp"),
    )
