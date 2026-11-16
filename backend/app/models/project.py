import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from sqlalchemy import DateTime, ForeignKey, Index, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON
from app.core.database import Base
from app.models.base import GUID, TimestampMixin


class Project(Base, TimestampMixin):
    """Canonical capital project discovered across external search providers."""
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    canonical_name: Mapped[str] = mapped_column(String(300), unique=True, nullable=False, index=True)
    normalized_name: Mapped[str] = mapped_column(String(300), nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    developer: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    location_city: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    location_state: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    location_country: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    investment_value: Mapped[Optional[float]] = mapped_column(Numeric(18, 2), nullable=True)
    investment_currency: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    capacity_value: Mapped[Optional[float]] = mapped_column(Numeric(18, 2), nullable=True)
    capacity_unit: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    announced_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    estimated_completion_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    metadata_: Mapped[Dict[str, Any]] = mapped_column(
        "metadata",
        JSON().with_variant(JSONB, "postgresql"),
        default=dict,
        nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False
    )

    # Relationships
    sources = relationship("ProjectSource", back_populates="project", cascade="all, delete-orphan")
    search_results = relationship("SearchResult", back_populates="project", cascade="all, delete-orphan")


class ProjectSource(Base, TimestampMixin):
    """External provider provenance and URL evidence supporting a project record."""
    __tablename__ = "project_sources"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(50), nullable=False, index=True)  # 'exa', 'brave', etc.
    source_url: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    source_title: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    publication_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    discovery_timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False
    )
    raw_snippet: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    extracted_data: Mapped[Dict[str, Any]] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"),
        default=dict,
        nullable=False
    )

    # Relationship
    project = relationship("Project", back_populates="sources")


class SearchResult(Base, TimestampMixin):
    """Many-to-Many junction between search runs and discovered projects with ranking scores."""
    __tablename__ = "search_results"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    search_run_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("search_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    project_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    relevance_score: Mapped[float] = mapped_column(Numeric(5, 4), default=0.0000, nullable=False)
    ranking_factors: Mapped[Dict[str, Any]] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"),
        default=dict,
        nullable=False
    )

    # Relationships
    search_run = relationship("SearchRun", back_populates="search_results")
    project = relationship("Project", back_populates="search_results")

    __table_args__ = (
        UniqueConstraint("search_run_id", "project_id", name="uq_search_run_project"),
        Index("idx_search_run_relevance", "search_run_id", "relevance_score"),
    )
