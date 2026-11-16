import uuid
from typing import Any, Dict, Optional
from sqlalchemy import ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON
from app.core.database import Base
from app.models.base import GUID, TimestampMixin


class SystemError(Base, TimestampMixin):
    """Logs system failures, provider errors, and exceptions for operational observability."""
    __tablename__ = "system_errors"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    search_run_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID, ForeignKey("search_runs.id", ondelete="SET NULL"), nullable=True, index=True)
    component: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    error_code: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    stack_trace: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    context: Mapped[Dict[str, Any]] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"),
        default=dict,
        nullable=False
    )

    # Relationship
    search_run = relationship("SearchRun", back_populates="system_errors")

    __table_args__ = (
        Index("idx_system_errors_comp_created", "component", "created_at"),
    )
