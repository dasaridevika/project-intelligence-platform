import json
import time
from typing import Any, Dict, Optional
import redis.asyncio as aioredis
from app.core.config import settings
from app.core.logging import logger


class InMemoryCacheFallback:
    """Thread-safe, TTL-aware in-memory fallback cache for testing or when Redis is offline."""

    def __init__(self):
        self._store: Dict[str, tuple[str, Optional[float]]] = {}
        self._rate_limits: Dict[str, list[float]] = {}

    def _is_expired(self, key: str) -> bool:
        if key not in self._store:
            return True
        _, expires_at = self._store[key]
        if expires_at is not None and time.time() > expires_at:
            del self._store[key]
            return True
        return False

    async def get(self, key: str) -> Optional[str]:
        if self._is_expired(key):
            return None
        val, _ = self._store[key]
        return val

    async def set(self, key: str, value: str, ex: Optional[int] = None) -> bool:
        expires_at = time.time() + ex if ex else None
        self._store[key] = (value, expires_at)
        return True

    async def delete(self, key: str) -> bool:
        if key in self._store:
            del self._store[key]
            return True
        return False

    async def ping(self) -> bool:
        return True

    async def check_rate_limit(self, key: str, limit: int, window: int = 60) -> bool:
        now = time.time()
        timestamps = self._rate_limits.get(key, [])
        # Evict timestamps outside the window
        timestamps = [ts for ts in timestamps if now - ts < window]
        if len(timestamps) >= limit:
            return False
        timestamps.append(now)
        self._rate_limits[key] = timestamps
        return True


class RedisService:
    """Enterprise Redis caching service with automatic fallback, namespacing, and health checks."""

    def __init__(self):
        self._redis_client: Optional[aioredis.Redis] = None
        self._fallback = InMemoryCacheFallback()
        self._use_fallback = False

    async def get_client(self) -> Any:
        if self._use_fallback or settings.APP_ENV == "testing":
            return self._fallback

        if self._redis_client is None:
            try:
                self._redis_client = aioredis.from_url(
                    settings.REDIS_URL,
                    encoding="utf-8",
                    decode_responses=True,
                    max_connections=settings.REDIS_MAX_CONNECTIONS,
                    socket_connect_timeout=0.5,
                    socket_timeout=0.5,
                )
                # Test connectivity
                await self._redis_client.ping()
            except Exception as exc:
                logger.warning(
                    f"Unable to connect to live Redis at {settings.REDIS_URL} ({exc}). "
                    "Engaging resilient in-memory cache fallback for local/test execution."
                )
                self._use_fallback = True
                return self._fallback

        return self._redis_client

    def namespace_key(self, key: str) -> str:
        """Applies versioned namespacing to cache keys."""
        if key.startswith("project_intelligence:"):
            return key
        return f"project_intelligence:v1:{key}"

    async def get(self, key: str) -> Optional[str]:
        client = await self.get_client()
        try:
            return await client.get(self.namespace_key(key))
        except Exception as exc:
            logger.warning(f"Redis get failed on key '{key}': {exc}. Trying fallback.")
            return await self._fallback.get(self.namespace_key(key))

    async def set(self, key: str, value: str, ttl: Optional[int] = None) -> bool:
        ttl = ttl or settings.REDIS_CACHE_TTL_SECONDS
        client = await self.get_client()
        try:
            await client.set(self.namespace_key(key), value, ex=ttl)
            return True
        except Exception as exc:
            logger.warning(f"Redis set failed on key '{key}': {exc}. Setting to fallback.")
            await self._fallback.set(self.namespace_key(key), value, ex=ttl)
            return True

    async def get_json(self, key: str) -> Optional[Any]:
        val = await self.get(key)
        if not val:
            return None
        try:
            return json.loads(val)
        except Exception:
            return None

    async def set_json(self, key: str, data: Any, ttl: Optional[int] = None) -> bool:
        serialized = json.dumps(data, default=str)
        return await self.set(key, serialized, ttl=ttl)

    async def delete(self, key: str) -> bool:
        client = await self.get_client()
        try:
            await client.delete(self.namespace_key(key))
            return True
        except Exception:
            await self._fallback.delete(self.namespace_key(key))
            return True

    async def set_search_progress(self, search_run_id: str, progress: Dict[str, Any], ttl: int = 3600) -> bool:
        key = f"search_progress:{search_run_id}"
        return await self.set_json(key, progress, ttl=ttl)

    async def get_search_progress(self, search_run_id: str) -> Optional[Dict[str, Any]]:
        key = f"search_progress:{search_run_id}"
        return await self.get_json(key)

    async def check_rate_limit(self, identifier: str, limit: int = 120, window_seconds: int = 60) -> bool:
        """Sliding-window or bucket rate limit check."""
        client = await self.get_client()
        if self._use_fallback:
            return await self._fallback.check_rate_limit(f"rate:{identifier}", limit, window_seconds)
        try:
            key = self.namespace_key(f"rate:{identifier}")
            current = await client.incr(key)
            if current == 1:
                await client.expire(key, window_seconds)
            return current <= limit
        except Exception:
            return await self._fallback.check_rate_limit(f"rate:{identifier}", limit, window_seconds)

    async def health_check(self) -> Dict[str, Any]:
        """Returns health status and whether fallback is active."""
        if self._use_fallback:
            return {"status": "ok", "provider": "in_memory_fallback", "live_connected": False}
        try:
            client = await self.get_client()
            await client.ping()
            return {"status": "ok", "provider": "redis", "live_connected": True}
        except Exception as exc:
            return {"status": "degraded", "error": str(exc), "provider": "in_memory_fallback"}


redis_service = RedisService()
