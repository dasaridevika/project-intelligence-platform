import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel


class ProjectSourceItem(BaseModel):
    id: uuid.UUID
    provider: str
    source_url: str
    source_title: Optional[str] = None
    publication_date: Optional[datetime] = None
    discovery_timestamp: datetime
    raw_snippet: Optional[str] = None

    model_config = {"from_attributes": True}


class ProjectDetailResponse(BaseModel):
    id: uuid.UUID
    canonical_name: str
    normalized_name: str
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
    announced_date: Optional[datetime] = None
    estimated_completion_date: Optional[datetime] = None
    description: Optional[str] = None
    metadata: Dict[str, Any] = {}
    sources: List[ProjectSourceItem] = []
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ProjectListItem(BaseModel):
    id: uuid.UUID
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
    sources_count: int = 0
    created_at: datetime

    model_config = {"from_attributes": True}


class ProjectListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    projects: List[ProjectListItem]
