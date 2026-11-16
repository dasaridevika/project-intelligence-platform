from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel


class ProviderUsageStat(BaseModel):
    provider: str
    total_requests: int
    successful_requests: int
    failed_requests: int
    success_rate: float
    avg_latency_ms: float
    min_latency_ms: float
    max_latency_ms: float
    total_units_consumed: int
    total_estimated_cost: Optional[float] = None


class UsageAnalyticsResponse(BaseModel):
    total_searches: int
    total_projects: int
    providers: List[ProviderUsageStat]
    recent_activity_count: int


class SearchPerformanceResponse(BaseModel):
    avg_search_duration_seconds: float
    p95_search_duration_seconds: float
    total_completed_searches: int
    total_failed_searches: int
    total_partially_completed: int


class SystemHealthResponse(BaseModel):
    status: str
    uptime_seconds: float
    database: str
    redis: Dict[str, Any]
    active_search_jobs: int
    unprocessed_outbox_events: int
    recent_errors_count: int
