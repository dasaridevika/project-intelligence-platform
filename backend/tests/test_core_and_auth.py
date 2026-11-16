import pytest
from app.core.config import settings
from app.core.redis import redis_service
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_internal_api_key,
    verify_password,
)


@pytest.mark.asyncio
async def test_root_endpoint(client):
    response = await client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == settings.APP_NAME
    assert data["status"] == "online"
    assert "X-Trace-Id" in response.headers
    assert "X-Response-Time" in response.headers


@pytest.mark.asyncio
async def test_health_endpoint(client):
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_readiness_endpoint(client):
    response = await client.get("/ready")
    assert response.status_code == 200
    data = response.json()
    assert "ready" in data
    assert "components" in data
    assert data["components"]["database"] == "connected"


def test_password_hashing():
    plain = "SuperSecurePassword123!"
    hashed = hash_password(plain)
    assert hashed != plain
    assert verify_password(plain, hashed) is True
    assert verify_password("WrongPassword", hashed) is False


def test_jwt_tokens():
    payload = {"sub": "user_123", "role": "admin"}
    token = create_access_token(payload)
    decoded = decode_token(token)
    assert decoded is not None
    assert decoded["sub"] == "user_123"
    assert decoded["role"] == "admin"
    assert decoded["type"] == "access"

    refresh = create_refresh_token(payload)
    decoded_refresh = decode_token(refresh)
    assert decoded_refresh is not None
    assert decoded_refresh["type"] == "refresh"


def test_internal_api_key_verification():
    assert verify_internal_api_key(settings.INTERNAL_API_KEY) is True
    assert verify_internal_api_key("invalid_key") is False
    assert verify_internal_api_key("") is False
    assert verify_internal_api_key(None) is False


@pytest.mark.asyncio
async def test_redis_service_operations():
    # Test basic string get/set
    await redis_service.set("test_key", "test_val", ttl=60)
    val = await redis_service.get("test_key")
    assert val == "test_val"

    # Test JSON get/set
    test_obj = {"query": "Solar projects in Gujarat", "count": 15}
    await redis_service.set_json("test_json", test_obj)
    retrieved = await redis_service.get_json("test_json")
    assert retrieved == test_obj

    # Test search progress
    progress = {"percent": 45, "step": "extracting"}
    await redis_service.set_search_progress("run_abc", progress)
    stored_progress = await redis_service.get_search_progress("run_abc")
    assert stored_progress == progress

    # Test rate limit check
    allowed_1 = await redis_service.check_rate_limit("user_ip", limit=2, window_seconds=60)
    allowed_2 = await redis_service.check_rate_limit("user_ip", limit=2, window_seconds=60)
    allowed_3 = await redis_service.check_rate_limit("user_ip", limit=2, window_seconds=60)
    assert allowed_1 is True
    assert allowed_2 is True
    assert allowed_3 is False  # Limit exceeded

    # Test deletion
    await redis_service.delete("test_key")
    assert await redis_service.get("test_key") is None
