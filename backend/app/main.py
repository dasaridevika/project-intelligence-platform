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
    # Eager check of Redis & Database
    db_ok = await check_database_health()
    redis_health = await redis_service.health_check()
    logger.info(
        "Infrastructure initial probe",
        extra={"extra_data": {"database_ok": db_ok, "redis_health": redis_health}}
    )
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
