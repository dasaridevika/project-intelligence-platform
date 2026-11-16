from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool
from app.core.config import settings
from app.core.logging import logger


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy 2.x declarative models."""
    pass


def get_engine() -> AsyncEngine:
    """Creates and returns the async database engine based on configuration."""
    db_url = settings.DATABASE_URL
    # Ensure async driver for PostgreSQL (e.g. from Railway/Supabase postgresql:// URLs)
    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql+asyncpg://", 1)
    elif db_url.startswith("postgresql://") and not db_url.startswith("postgresql+"):
        db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)

    is_sqlite = db_url.startswith("sqlite")

    engine_kwargs = {
        "echo": False,
        "future": True,
    }

    if not is_sqlite:
        # PostgreSQL / Production settings
        engine_kwargs.update({
            "pool_size": settings.DB_POOL_SIZE,
            "max_overflow": settings.DB_MAX_OVERFLOW,
            "pool_timeout": settings.DB_POOL_TIMEOUT,
            "pool_pre_ping": True,
        })
    else:
        # SQLite settings for local testing
        engine_kwargs["connect_args"] = {"check_same_thread": False}

    return create_async_engine(db_url, **engine_kwargs)


engine = get_engine()

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency yielding an isolated async database session."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception as exc:
            await session.rollback()
            logger.error(f"Database session rollback triggered due to exception: {exc}")
            raise
        finally:
            await session.close()


async def check_database_health() -> bool:
    """Verifies that the database engine can establish a connection."""
    try:
        from sqlalchemy import text
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return True
    except Exception as exc:
        logger.warning(f"Database health check failed: {exc}")
        return False
