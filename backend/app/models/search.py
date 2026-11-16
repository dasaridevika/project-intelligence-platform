import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional
from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON
from app.core.database import Base
from app.models.base import GUID, TimestampMixin


class SearchRun(Base, TimestampMixin):
    """Represents a single discovery search run and its orchestrator lifecycle."""
    __tablename__ = "search_runs"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    query: Mapped[str] = mapped_column(Text, nullable=False)
    parsed_query: Mapped[Dict[str, Any]] = mapped_column(JSON().with_variant(JSONB, "postgresql"), default=dict, nullable=False)
    status: Mapped[str] = mapped_column(
        String(50),
        default="queued",
        index=True,
        nullable=False
    )  # queued, processing, completed, partially_completed, failed, cancelled
    results_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_duration_seconds: Mapped[Optional[float]] = mapped_column(Numeric(10, 3), nullable=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    user = relationship("User", back_populates="search_runs")
    search_results = relationship("SearchResult", back_populates="search_run", cascade="all, delete-orphan")
    activity_events = relationship("ActivityEvent", back_populates="search_run", cascade="all, delete-orphan", order_by="ActivityEvent.timestamp")
    api_usage = relationship("APIUsage", back_populates="search_run", cascade="all, delete-orphan")
    outbox_event = relationship("OutboxEvent", back_populates="search_run", uselist=False, cascade="all, delete-orphan")
    system_errors = relationship("SystemError", back_populates="search_run", cascade="all, delete-orphan")
