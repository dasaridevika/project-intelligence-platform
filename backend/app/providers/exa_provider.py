import asyncio
import os
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


class ExaProvider(BaseSearchProvider):
    """Integration for Exa AI Neural Search API."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout_seconds: Optional[float] = None
    ):
        super().__init__(
            name="exa",
            timeout_seconds=timeout_seconds or settings.EXA_TIMEOUT_SECONDS
        )
        self.api_key = (
            api_key
            or settings.EXA_API_KEY
            or os.environ.get("EXA_API_KEY")
            or os.environ.get("EXA_KEY")
        )
        self.base_url = (base_url or settings.EXA_BASE_URL).rstrip("/")

    async def search(self, query: str, max_results: int = 20, **kwargs) -> ProviderSearchResult:
        endpoint = f"{self.base_url}/search"

        # If API key is not configured, return clear error without crashing
        if not self.api_key or self.api_key == "your_exa_api_key_here":
            logger.warning("Exa API key is not configured. Returning provider unconfigured status.")
            return ProviderSearchResult(
                provider=self.name,
                success=False,
                error_message="Exa API key is not configured in environment.",
                http_status=401,
                usage=ProviderUsage(
                    provider=self.name,
                    endpoint=endpoint,
                    http_status=401,
                    latency_ms=0.0,
                    units_consumed=0
                )
            )

        headers = {
            "x-api-key": self.api_key,
            "Content-Type": "application/json",
            "User-Agent": "ProjectIntelligencePlatform/1.0"
        }
        payload = {
            "query": query,
            "type": "neural",
            "useAutoprompt": True,
            "numResults": min(max_results, settings.EXA_MAX_RESULTS),
            "contents": {
                "text": {"maxCharacters": 1500}
            }
        }

        retries = 2
        last_error = None

        for attempt in range(retries + 1):
            start_time = time.perf_counter()
            try:
                async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                    response = await client.post(endpoint, headers=headers, json=payload)
                    latency_ms = (time.perf_counter() - start_time) * 1000.0

                    if response.status_code == 200:
                        data = response.json()
                        results_raw = data.get("results", [])

                        items: List[RawProviderResultItem] = []
                        for r in results_raw:
                            items.append(
                                RawProviderResultItem(
                                    title=r.get("title") or "Untitled Project Source",
                                    url=r.get("url", ""),
                                    snippet=r.get("text", "")[:400] if r.get("text") else "",
                                    published_date=r.get("publishedDate"),
                                    raw_content=r.get("text"),
                                    score=r.get("score"),
                                    extra_metadata={"id": r.get("id"), "author": r.get("author")}
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

                    elif response.status_code == 402 or "credit" in response.text.lower() or "insufficient" in response.text.lower():
                        latency_ms = (time.perf_counter() - start_time) * 1000.0
                        quota_msg = f"Exa API free credits exhausted (HTTP {response.status_code}): {response.text[:200]}"
                        logger.error(quota_msg)
                        return ProviderSearchResult(
                            provider=self.name,
                            success=False,
                            error_message=quota_msg,
                            http_status=response.status_code,
                            usage=ProviderUsage(
                                provider=self.name,
                                endpoint=endpoint,
                                http_status=response.status_code,
                                latency_ms=round(latency_ms, 2),
                                units_consumed=0,
                                retry_count=attempt,
                                response_meta={"quota_exhausted": True, "error": quota_msg}
                            )
                        )
                    elif response.status_code == 429:
                        latency_ms = (time.perf_counter() - start_time) * 1000.0
                        quota_msg = f"Exa API rate limit or quota exceeded (HTTP 429): {response.text[:200]}"
                        logger.warning(quota_msg)
                        return ProviderSearchResult(
                            provider=self.name,
                            success=False,
                            error_message=quota_msg,
                            http_status=429,
                            usage=ProviderUsage(
                                provider=self.name,
                                endpoint=endpoint,
                                http_status=429,
                                latency_ms=round(latency_ms, 2),
                                units_consumed=0,
                                retry_count=attempt,
                                response_meta={"quota_exhausted": True, "error": quota_msg}
                            )
                        )
                    elif response.status_code >= 500:
                        last_error = f"HTTP {response.status_code}: {response.text}"
                        if attempt < retries:
                            await asyncio.sleep(0.5 * (2 ** attempt))
                            continue
                    else:
                        latency_ms = (time.perf_counter() - start_time) * 1000.0
                        return ProviderSearchResult(
                            provider=self.name,
                            success=False,
                            error_message=f"Exa API error: HTTP {response.status_code} - {response.text[:200]}",
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
            error_message=f"Exa request failed after retries: {last_error}",
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
