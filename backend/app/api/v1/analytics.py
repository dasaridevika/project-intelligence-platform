import time
from typing import List
from fastapi import APIRouter, Depends
from sqlalchemy import case, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.core.database import check_database_health, get_db
from app.core.redis import redis_service
from app.models.analytics import ActivityEvent, APIUsage
from app.models.outbox import OutboxEvent
from app.models.project import Project
from app.models.search import SearchRun
from app.models.system import SystemError
from app.schemas.analytics import (
    ProviderUsageStat,
    SearchPerformanceResponse,
    SystemHealthResponse,
    UsageAnalyticsResponse,
)

router = APIRouter(prefix="/analytics", tags=["Analytics"])

APP_START_TIME = time.time()


@router.get("/usage", response_model=UsageAnalyticsResponse)
async def get_api_usage_analytics(db: AsyncSession = Depends(get_db)):
    """Computes transparent API provider usage, error rates, and latencies from real executions."""
    # Group by provider
    stmt = (
        select(
            APIUsage.provider,
            func.count(APIUsage.id).label("total_requests"),
            func.sum(case((APIUsage.http_status < 400, 1), else_=0)).label("successful_requests"),
            func.sum(case((APIUsage.http_status >= 400, 1), else_=0)).label("failed_requests"),
            func.avg(APIUsage.latency_ms).label("avg_latency"),
            func.min(APIUsage.latency_ms).label("min_latency"),
            func.max(APIUsage.latency_ms).label("max_latency"),
            func.sum(APIUsage.units_consumed).label("units_consumed"),
            func.sum(APIUsage.estimated_cost).label("estimated_cost")
        )
        .group_by(APIUsage.provider)
    )
    results = (await db.execute(stmt)).all()

    provider_stats: List[ProviderUsageStat] = []
    for row in results:
        total = row.total_requests or 0
        success = row.successful_requests or 0
        failed = row.failed_requests or 0
        rate = round((success / total) * 100.0, 2) if total > 0 else 0.0

        # Check latest call for quota status
        latest_usage = (
            await db.execute(
                select(APIUsage)
                .where(APIUsage.provider == row.provider)
                .order_by(desc(APIUsage.created_at))
                .limit(1)
            )
        ).scalar_one_or_none()

        quota_exhausted = False
        quota_status = "active"
        last_error = None

        if latest_usage:
            meta = latest_usage.response_meta or {}
            if latest_usage.http_status in (402, 429) or meta.get("quota_exhausted"):
                quota_exhausted = True
                quota_status = "quota_exhausted" if latest_usage.http_status == 402 else "rate_limited"
                last_error = meta.get("error") or (
                    "Free credits exhausted (HTTP 402)" if latest_usage.http_status == 402 else "Rate limit / quota exceeded (HTTP 429)"
                )
            elif latest_usage.http_status >= 400:
                last_error = meta.get("error") or f"HTTP {latest_usage.http_status} error"

        provider_stats.append(
            ProviderUsageStat(
                provider=row.provider,
                total_requests=total,
                successful_requests=success,
                failed_requests=failed,
                success_rate=rate,
                avg_latency_ms=round(float(row.avg_latency or 0.0), 2),
                min_latency_ms=round(float(row.min_latency or 0.0), 2),
                max_latency_ms=round(float(row.max_latency or 0.0), 2),
                total_units_consumed=row.units_consumed or 0,
                total_estimated_cost=float(row.estimated_cost) if row.estimated_cost is not None else None,
                quota_exhausted=quota_exhausted,
                quota_status=quota_status,
                last_error_message=last_error
            )
        )

    # Ensure all configured providers appear even with 0 requests sent
    configured_names = ["exa", settings.SECOND_PROVIDER_NAME.lower()]
    existing_names = {p.provider.lower() for p in provider_stats}
    for c_name in configured_names:
        if c_name not in existing_names:
            provider_stats.append(
                ProviderUsageStat(
                    provider=c_name,
                    total_requests=0,
                    successful_requests=0,
                    failed_requests=0,
                    success_rate=100.0,
                    avg_latency_ms=0.0,
                    min_latency_ms=0.0,
                    max_latency_ms=0.0,
                    total_units_consumed=0,
                    quota_exhausted=False,
                    quota_status="active",
                    last_error_message=None
                )
            )

    # General totals
    total_searches = (await db.execute(select(func.count(SearchRun.id)))).scalar() or 0
    total_projects = (await db.execute(select(func.count(Project.id)))).scalar() or 0
    recent_activity_count = (await db.execute(select(func.count(ActivityEvent.id)))).scalar() or 0

    return UsageAnalyticsResponse(
        total_searches=total_searches,
        total_projects=total_projects,
        providers=provider_stats,
        recent_activity_count=recent_activity_count
    )


@router.get("/providers")
async def list_configured_providers():
    """Lists configured external search providers and their connection statuses."""
    import os
    exa_configured = bool(
        (settings.EXA_API_KEY or os.environ.get("EXA_API_KEY") or os.environ.get("EXA_KEY"))
        and (settings.EXA_API_KEY or os.environ.get("EXA_API_KEY") or os.environ.get("EXA_KEY")) not in ("your_exa_api_key_here", "")
    )
    second_key = (
        settings.SECOND_PROVIDER_API_KEY
        or os.environ.get("GOOGLE_SEARCH_API_KEY")
        or os.environ.get("SECOND_PROVIDER_API_KEY")
        or os.environ.get("GOOGLE_API_KEY")
    )
    second_configured = bool(
        second_key and second_key not in ("your_secondary_search_api_key_here", "your_google_search_api_key_here", "")
    )

    return {
        "providers": [
            {
                "name": "exa",
                "label": "Exa Neural Search API",
                "configured": exa_configured,
                "base_url": settings.EXA_BASE_URL,
                "timeout_seconds": settings.EXA_TIMEOUT_SECONDS
            },
            {
                "name": settings.SECOND_PROVIDER_NAME.lower(),
                "label": f"{settings.SECOND_PROVIDER_NAME.title()} Search API",
                "configured": second_configured,
                "base_url": settings.SECOND_PROVIDER_BASE_URL,
                "timeout_seconds": settings.SECOND_PROVIDER_TIMEOUT_SECONDS
            }
        ]
    }


@router.get("/search-performance", response_model=SearchPerformanceResponse)
async def get_search_performance(db: AsyncSession = Depends(get_db)):
    """Computes search execution performance metrics."""
    stmt = (
        select(
            func.avg(SearchRun.total_duration_seconds).label("avg_duration"),
            func.max(SearchRun.total_duration_seconds).label("max_duration"),
            func.sum(case((SearchRun.status == "completed", 1), else_=0)).label("completed"),
            func.sum(case((SearchRun.status == "failed", 1), else_=0)).label("failed"),
            func.sum(case((SearchRun.status == "partially_completed", 1), else_=0)).label("partially_completed")
        )
    )
    row = (await db.execute(stmt)).one()

    return SearchPerformanceResponse(
        avg_search_duration_seconds=round(float(row.avg_duration or 0.0), 3),
        p95_search_duration_seconds=round(float(row.max_duration or 0.0), 3),
        total_completed_searches=row.completed or 0,
        total_failed_searches=row.failed or 0,
        total_partially_completed=row.partially_completed or 0
    )


@router.get("/system-health", response_model=SystemHealthResponse)
async def get_system_health(db: AsyncSession = Depends(get_db)):
    """Returns aggregated real-time operational health for backend, database, cache, and queues."""
    db_ok = await check_database_health()
    redis_info = await redis_service.health_check()

    # Active jobs count
    active_jobs = (
        await db.execute(
            select(func.count(SearchRun.id)).where(SearchRun.status.in_(["queued", "processing"]))
        )
    ).scalar() or 0

    # Unprocessed outbox count
    unprocessed_outbox = (
        await db.execute(
            select(func.count(OutboxEvent.id)).where(OutboxEvent.status.in_(["pending", "claimed"]))
        )
    ).scalar() or 0

    # Recent errors count
    recent_errors = (await db.execute(select(func.count(SystemError.id)))).scalar() or 0

    uptime = time.time() - APP_START_TIME
    is_healthy = db_ok and (redis_info.get("status") == "ok")

    return SystemHealthResponse(
        status="healthy" if is_healthy else "degraded",
        uptime_seconds=round(uptime, 1),
        database="connected" if db_ok else "unreachable",
        redis=redis_info,
        active_search_jobs=active_jobs,
        unprocessed_outbox_events=unprocessed_outbox,
        recent_errors_count=recent_errors
    )
