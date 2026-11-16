from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional


@dataclass
class RawProviderResultItem:
    """Single search result returned by an external search provider."""
    title: str
    url: str
    snippet: str
    published_date: Optional[str] = None
    raw_content: Optional[str] = None
    score: Optional[float] = None
    extra_metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ProviderUsage:
    """Usage and latency metrics returned or measured from provider query."""
    provider: str
    endpoint: str
    http_status: int
    latency_ms: float
    units_consumed: int = 1
    retry_count: int = 0
    estimated_cost: Optional[float] = None
    response_meta: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ProviderSearchResult:
    """Consolidated outcome of an external provider search execution."""
    provider: str
    success: bool
    items: List[RawProviderResultItem] = field(default_factory=list)
    usage: Optional[ProviderUsage] = None
    error_message: Optional[str] = None
    http_status: int = 200


class BaseSearchProvider(ABC):
    """Abstract interface that all search providers must implement."""

    def __init__(self, name: str, timeout_seconds: float = 15.0):
        self.name = name
        self.timeout_seconds = timeout_seconds

    @abstractmethod
    async def search(self, query: str, max_results: int = 20, **kwargs) -> ProviderSearchResult:
        """Executes a search query and returns structured provider search results."""
        pass
