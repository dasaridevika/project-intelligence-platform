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


class ConfigurableSearchProvider(BaseSearchProvider):
    """Universal secondary search provider supporting Google Search API, Serper, SerpApi, and Brave."""

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
        raw_key = (
            api_key
            or settings.SECOND_PROVIDER_API_KEY
            or os.environ.get("GOOGLE_SEARCH_API_KEY")
            or os.environ.get("SECOND_PROVIDER_API_KEY")
            or os.environ.get("GOOGLE_API_KEY")
        )
        self.api_key = raw_key.strip().strip('"').strip("'") if raw_key else None
        self.base_url = (base_url or settings.SECOND_PROVIDER_BASE_URL).rstrip("/")

    async def search(self, query: str, max_results: int = 20, **kwargs) -> ProviderSearchResult:
        endpoint = self.base_url

        if not self.api_key or self.api_key in ("your_secondary_search_api_key_here", "your_google_search_api_key_here"):
            logger.warning(f"Secondary search provider '{self.name}' API key is not configured.")
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

        url_lower = endpoint.lower()
        is_google_custom_search = "googleapis.com" in url_lower or "customsearch" in url_lower
        is_serper = "serper.dev" in url_lower
        is_serpapi = "serpapi.com" in url_lower

        retries = 2
        last_error = None
        latency_ms = 0.0

        for attempt in range(retries + 1):
            start_time = time.perf_counter()
            try:
                async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                    if is_serper:
                        # Serper.dev Google Search API
                        headers = {
                            "X-API-KEY": self.api_key,
                            "Content-Type": "application/json"
                        }
                        payload = {
                            "q": query,
                            "num": min(max_results, settings.SECOND_PROVIDER_MAX_RESULTS)
                        }
                        response = await client.post(endpoint, headers=headers, json=payload)
                    elif is_google_custom_search:
                        # Official Google Custom Search JSON API requires both key and cx (Search Engine ID)
                        cse_id = (
                            settings.GOOGLE_CSE_ID
                            or os.environ.get("GOOGLE_CSE_ID")
                            or os.environ.get("GOOGLE_CX")
                            or os.environ.get("GOOGLE_SEARCH_CX")
                        )
                        if not cse_id:
                            msg = "Google Custom Search requires GOOGLE_CSE_ID (Search Engine ID). Please configure GOOGLE_CSE_ID in environment."
                            logger.warning(msg)
                            return ProviderSearchResult(
                                provider=self.name,
                                success=False,
                                error_message=msg,
                                http_status=400,
                                usage=ProviderUsage(
                                    provider=self.name,
                                    endpoint=endpoint,
                                    http_status=400,
                                    latency_ms=0.0,
                                    units_consumed=0,
                                    response_meta={"error": "Missing GOOGLE_CSE_ID (Search Engine ID)"}
                                )
                            )
                        params = {
                            "key": self.api_key,
                            "q": query,
                            "num": min(max_results, 10),
                            "cx": cse_id.strip().strip('"').strip("'")
                        }
                        response = await client.get(endpoint, params=params)
                    elif is_serpapi:
                        # SerpApi Google Search
                        params = {
                            "api_key": self.api_key,
                            "q": query,
                            "engine": "google",
                            "num": min(max_results, settings.SECOND_PROVIDER_MAX_RESULTS)
                        }
                        response = await client.get(endpoint, params=params)
                    else:
                        # Brave Search API or generic web search
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
                        response = await client.get(endpoint, headers=headers, params=params)

                    latency_ms = (time.perf_counter() - start_time) * 1000.0

                    if response.status_code == 200:
                        data = response.json()
                        items: List[RawProviderResultItem] = []

                        if is_serper:
                            for item in data.get("organic", []):
                                items.append(
                                    RawProviderResultItem(
                                        title=item.get("title") or "Google Search Result",
                                        url=item.get("link", ""),
                                        snippet=item.get("snippet", ""),
                                        published_date=item.get("date"),
                                        extra_metadata={"position": item.get("position")}
                                    )
                                )
                        elif is_google_custom_search:
                            for item in data.get("items", []):
                                snippet = item.get("snippet", "")
                                p_date = None
                                pagemap = item.get("pagemap", {})
                                if "metatags" in pagemap and pagemap["metatags"]:
                                    p_date = pagemap["metatags"][0].get("article:published_time") or pagemap["metatags"][0].get("date")
                                items.append(
                                    RawProviderResultItem(
                                        title=item.get("title") or "Google Search Result",
                                        url=item.get("link", ""),
                                        snippet=snippet,
                                        published_date=p_date,
                                        extra_metadata={"displayLink": item.get("displayLink")}
                                    )
                                )
                        elif is_serpapi:
                            for item in data.get("organic_results", []):
                                items.append(
                                    RawProviderResultItem(
                                        title=item.get("title") or "Google Search Result",
                                        url=item.get("link", ""),
                                        snippet=item.get("snippet", ""),
                                        published_date=item.get("date")
                                    )
                                )
                        else:
                            web_results = data.get("web", {}).get("results", [])
                            for item in web_results:
                                items.append(
                                    RawProviderResultItem(
                                        title=item.get("title") or "Web Search Source",
                                        url=item.get("url", ""),
                                        snippet=item.get("description", ""),
                                        published_date=item.get("page_age")
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

                    elif response.status_code in (402, 429) or "quota" in response.text.lower() or "resource_exhausted" in response.text.lower():
                        quota_msg = f"{self.name} API quota or rate limit exceeded (HTTP {response.status_code}): {response.text[:200]}"
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
                    elif response.status_code in (500, 502, 503, 504):
                        last_error = f"HTTP {response.status_code}: {response.text[:200]}"
                        if attempt < retries:
                            await asyncio.sleep(0.5 * (2 ** attempt))
                            continue
                    else:
                        latency_ms = (time.perf_counter() - start_time) * 1000.0
                        err_snippet = response.text[:200]
                        err_label = f"HTTP {response.status_code} error"
                        if response.status_code == 400 and is_google_custom_search:
                            err_label = "Google CSE ID missing or invalid (HTTP 400)"
                        elif response.status_code == 401:
                            err_label = "Invalid API key (HTTP 401)"
                        return ProviderSearchResult(
                            provider=self.name,
                            success=False,
                            error_message=f"{self.name} API error: HTTP {response.status_code} - {err_snippet}",
                            http_status=response.status_code,
                            usage=ProviderUsage(
                                provider=self.name,
                                endpoint=endpoint,
                                http_status=response.status_code,
                                latency_ms=round(latency_ms, 2),
                                units_consumed=0,
                                retry_count=attempt,
                                response_meta={"error": err_label}
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
