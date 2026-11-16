import os
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

# Set test environment
os.environ["APP_ENV"] = "testing"
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
os.environ["SECRET_KEY"] = "test_secret_key_for_automated_testing_purposes_only"
os.environ["INTERNAL_API_KEY"] = "test_internal_key"

from app.main import app
from app.core.database import Base, engine


@pytest_asyncio.fixture(scope="function", autouse=True)
async def setup_db():
    """Initializes in-memory database schema before each test."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture(scope="function")
async def client():
    """Async HTTP client for testing API endpoints."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
