import asyncio
import time
from typing import Any, Dict, List, Optional
import httpx
from app.core.config import settings
from app.core.logging import logger
from app.providers.base import (
    BaseSearchProvider,
    ProviderSearchResult,
    ProviderUsage,
    RawProviderResultItem,
)


class ConfigurableSearchProvider(BaseSearchProvider):
    """Configurable secondary search provider (defaulting to Brave Search API or Tavily/Serper)."""

    def __init__(
        self,
        name: Optional[str] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout_seconds: Optional[float] = None
    ):
        provider_name = name or settings.SECOND_PROVIDER_NAME
        super().__init__(
            name=provider_name,
            timeout_seconds=timeout_seconds or settings.SECOND_PROVIDER_TIMEOUT_SECONDS
        )
        self.api_key = api_key or settings.SECOND_PROVIDER_API_KEY
        self.base_url = (base_url or settings.SECOND_PROVIDER_BASE_URL).rstrip("/")

    async def search(self, query: str, max_results: int = 20, **kwargs) -> ProviderSearchResult:
        endpoint = self.base_url

        if not self.api_key or self.api_key == "your_secondary_search_api_key_here":
            logger.warning(f"Secondary provider '{self.name}' API key is not configured.")
            return ProviderSearchResult(
                provider=self.name,
                success=False,
                error_message=f"Secondary search provider '{self.name}' API key not configured.",
                http_status=401,
                usage=ProviderUsage(
                    provider=self.name,
                    endpoint=endpoint,
                    http_status=401,
                    latency_ms=0.0,
                    units_consumed=0
                )
            )

        # Brave Search API conventions
        headers = {
            "Accept": "application/json",
            "Accept-Encoding": "gzip",
            "X-Subscription-Token": self.api_key,
            "User-Agent": "ProjectIntelligencePlatform/1.0"
        }
        params = {
            "q": query,
            "count": min(max_results, settings.SECOND_PROVIDER_MAX_RESULTS),
            "safesearch": "moderate"
        }

        retries = 2
        last_error = None

        for attempt in range(retries + 1):
            start_time = time.perf_counter()
            try:
                async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                    response = await client.get(endpoint, headers=headers, params=params)
                    latency_ms = (time.perf_counter() - start_time) * 1000.0

                    if response.status_code == 200:
                        data = response.json()
                        web_results = data.get("web", {}).get("results", [])

                        items: List[RawProviderResultItem] = []
                        for item in web_results:
                            items.append(
                                RawProviderResultItem(
                                    title=item.get("title") or "Web Search Source",
                                    url=item.get("url", ""),
                                    snippet=item.get("description", ""),
                                    published_date=item.get("page_age"),
                                    extra_metadata={"family_friendly": item.get("family_friendly")}
                                )
                            )

                        usage = ProviderUsage(
                            provider=self.name,
                            endpoint=endpoint,
                            http_status=200,
                            latency_ms=round(latency_ms, 2),
                            units_consumed=1,
                            retry_count=attempt,
                            response_meta={"result_count": len(items)}
                        )

                        return ProviderSearchResult(
                            provider=self.name,
                            success=True,
                            items=items,
                            usage=usage,
                            http_status=200
                        )

                    elif response.status_code in (429, 500, 502, 503, 504):
                        last_error = f"HTTP {response.status_code}: {response.text[:200]}"
                        if attempt < retries:
                            await asyncio.sleep(0.5 * (2 ** attempt))
                            continue
                    else:
                        latency_ms = (time.perf_counter() - start_time) * 1000.0
                        return ProviderSearchResult(
                            provider=self.name,
                            success=False,
                            error_message=f"{self.name} API error: HTTP {response.status_code}",
                            http_status=response.status_code,
                            usage=ProviderUsage(
                                provider=self.name,
                                endpoint=endpoint,
                                http_status=response.status_code,
                                latency_ms=round(latency_ms, 2),
                                units_consumed=0,
                                retry_count=attempt
                            )
                        )

            except Exception as exc:
                latency_ms = (time.perf_counter() - start_time) * 1000.0
                last_error = str(exc)
                if attempt < retries:
                    await asyncio.sleep(0.5 * (2 ** attempt))
                    continue

        return ProviderSearchResult(
            provider=self.name,
            success=False,
            error_message=f"{self.name} request failed after retries: {last_error}",
            http_status=504,
            usage=ProviderUsage(
                provider=self.name,
                endpoint=endpoint,
                http_status=504,
                latency_ms=round(latency_ms, 2),
                units_consumed=0,
                retry_count=retries
            )
        )
