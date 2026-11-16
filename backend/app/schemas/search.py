import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class SearchCreateRequest(BaseModel):
    """Schema for submitting a natural-language capital project search."""
    query: str = Field(..., min_length=3, max_length=500, description="Natural-language discovery query", examples=["Upcoming data center projects in India"])
    categories: Optional[List[str]] = Field(default=None, description="Optional target project categories")
    location: Optional[str] = Field(default=None, description="Target city, state, or country")
    providers: Optional[List[str]] = Field(default=["exa", "brave"], description="Active search providers to query")


class SearchCreateResponse(BaseModel):
    """Asynchronous HTTP 202 Accepted response containing unique search_run_id."""
    search_run_id: uuid.UUID
    status: str = "queued"
    query: str
    created_at: datetime
    message: str = "Search request accepted for background processing"


class SearchRunResponse(BaseModel):
    """Full detail of a search run record."""
    id: uuid.UUID
    user_id: Optional[uuid.UUID] = None
    query: str
    parsed_query: Dict[str, Any] = {}
    status: str
    results_count: int
    total_duration_seconds: Optional[float] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class SearchResultItemResponse(BaseModel):
    """Structured project result item including ranking score and source provenance."""
    project_id: uuid.UUID
    canonical_name: str
    category: str
    status: str
    developer: Optional[str] = None
    location_city: Optional[str] = None
    location_state: Optional[str] = None
    location_country: Optional[str] = None
    investment_value: Optional[float] = None
    investment_currency: Optional[str] = None
    capacity_value: Optional[float] = None
    capacity_unit: Optional[str] = None
    relevance_score: float
    ranking_factors: Dict[str, Any] = {}
    sources: List[Dict[str, Any]] = []

    model_config = {"from_attributes": True}


class SearchResultsListResponse(BaseModel):
    """Response envelope for search results."""
    search_run_id: uuid.UUID
    query: str
    status: str
    total_results: int
    results: List[SearchResultItemResponse]
