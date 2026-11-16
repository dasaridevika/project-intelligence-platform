import time
import uuid
from contextlib import asynccontextmanager
from typing import AsyncGenerator
from fastapi import FastAPI, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.api.internal.outbox import router as internal_outbox_router
from app.api.v1.router import api_v1_router
from app.core.config import settings
from app.core.database import check_database_health
from app.core.logging import logger
from app.core.redis import redis_service


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Lifespan context manager for startup and graceful shutdown."""
    logger.info(
        f"Starting {settings.APP_NAME} in '{settings.APP_ENV}' mode",
        extra={"extra_data": {"version": "1.0.0", "env": settings.APP_ENV}}
    )
    # Auto-initialize tables when running with SQLite
    if settings.DATABASE_URL.startswith("sqlite"):
        from app.core.database import engine
        from app.models.base import Base
        import app.models.user  # noqa: F401
        import app.models.search  # noqa: F401
        import app.models.project  # noqa: F401
        import app.models.analytics  # noqa: F401
        import app.models.outbox  # noqa: F401
        import app.models.system  # noqa: F401
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("Local SQLite database initialized with all 10 schema tables.")

    # Eager check of Redis & Database
    db_ok = await check_database_health()
    redis_health = await redis_service.health_check()
    logger.info(
        "Infrastructure initial probe",
        extra={"extra_data": {"database_ok": db_ok, "redis_health": redis_health}}
    )

    # Auto-drain any queued search runs from previous sessions (non-testing only)
    if settings.APP_ENV != "testing":
        async def drain_pending_runs():
            try:
                import asyncio
                from sqlalchemy import select
                from app.core.database import AsyncSessionLocal
                from app.models.search import SearchRun
                from app.services.search_orchestrator import search_orchestrator

                await asyncio.sleep(2.0)
                async with AsyncSessionLocal() as session:
                    queued_stmt = select(SearchRun).where(SearchRun.status == "queued").limit(10)
                    queued_runs = (await session.execute(queued_stmt)).scalars().all()
                    if queued_runs:
                        logger.info(f"Auto-draining {len(queued_runs)} queued search runs on startup")
                        for qr in queued_runs:
                            asyncio.create_task(
                                search_orchestrator.execute_search(
                                    search_run_id=qr.id,
                                    query=qr.query,
                                    parsed_query=qr.parsed_query or {},
                                    requested_providers=["exa", settings.SECOND_PROVIDER_NAME.lower()],
                                    trace_id=f"startup-drain-{qr.id}"
                                )
                            )
            except Exception as e:
                logger.warning(f"Startup queued runs drain notice: {e}")

        import asyncio
        asyncio.create_task(drain_pending_runs())

    yield
    logger.info(f"Shutting down {settings.APP_NAME} cleanly...")


app = FastAPI(
    title=settings.APP_NAME,
    description="Enterprise AI-powered Project Intelligence & Discovery Platform API",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Trace-Id", "X-Response-Time"],
)


@app.middleware("http")
async def correlation_and_timing_middleware(request: Request, call_next) -> Response:
    """Attaches trace IDs, calculates latency, and injects observability headers."""
    trace_id = request.headers.get("X-Trace-Id") or str(uuid.uuid4())
    start_time = time.perf_counter()

    # Attach trace_id to request state for handler access
    request.state.trace_id = trace_id

    try:
        response = await call_next(request)
        duration_ms = (time.perf_counter() - start_time) * 1000.0

        response.headers["X-Trace-Id"] = trace_id
        response.headers["X-Response-Time"] = f"{duration_ms:.2f}ms"

        # Log request summary
        logger.info(
            f"{request.method} {request.url.path} - {response.status_code} ({duration_ms:.2f}ms)",
            extra={"extra_data": {
                "trace_id": trace_id,
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "duration_ms": round(duration_ms, 2)
            }}
        )
        return response
    except Exception as exc:
        duration_ms = (time.perf_counter() - start_time) * 1000.0
        logger.error(
            f"Unhandled exception during {request.method} {request.url.path}: {exc}",
            exc_info=True,
            extra={"extra_data": {"trace_id": trace_id, "duration_ms": round(duration_ms, 2)}}
        )
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "error": "InternalServerError",
                "message": "An unexpected error occurred while processing the request.",
                "trace_id": trace_id
            },
            headers={"X-Trace-Id": trace_id}
        )


app.include_router(api_v1_router)
app.include_router(internal_outbox_router)


@app.get("/", tags=["Root"])
async def root():
    return {
        "name": settings.APP_NAME,
        "version": "1.0.0",
        "status": "online",
        "environment": settings.APP_ENV,
        "docs": "/docs"
    }


@app.get("/health", tags=["Health"])
async def health_check():
    """Liveness probe: verifies that the HTTP server process is responsive."""
    return {"status": "ok", "timestamp": time.time()}


@app.get("/ready", tags=["Health"])
async def readiness_check():
    """Readiness probe: validates database and Redis availability."""
    db_ok = await check_database_health()
    redis_info = await redis_service.health_check()

    is_ready = db_ok and (redis_info.get("status") == "ok")
    status_code = status.HTTP_200_OK if is_ready else status.HTTP_503_SERVICE_UNAVAILABLE

    return JSONResponse(
        status_code=status_code,
        content={
            "ready": is_ready,
            "components": {
                "database": "connected" if db_ok else "unreachable",
                "redis": redis_info
            }
        }
    )
