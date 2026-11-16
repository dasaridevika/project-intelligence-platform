import asyncio
import json
import uuid
from typing import AsyncGenerator, List, Optional
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from app.core.database import get_db
from app.core.logging import logger
from app.core.redis import redis_service
from app.models.analytics import ActivityEvent
from app.models.outbox import OutboxEvent
from app.models.project import Project, ProjectSource, SearchResult
from app.models.search import SearchRun
from app.models.user import User
from app.schemas.search import (
    SearchCreateRequest,
    SearchCreateResponse,
    SearchResultItemResponse,
    SearchResultsListResponse,
    SearchRunResponse,
)
from app.services.auth_service import get_current_user_optional
from app.services.query_processor import query_processor

router = APIRouter(prefix="/search", tags=["Search"])


@router.post("", status_code=status.HTTP_202_ACCEPTED, response_model=SearchCreateResponse)
async def create_search_run(
    req: SearchCreateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
):
    """Submits a natural-language search. Transactionally creates search_runs and outbox_events records."""
    trace_id = getattr(request.state, "trace_id", str(uuid.uuid4()))
    search_run_id = uuid.uuid4()
    outbox_event_id = uuid.uuid4()

    # Query analysis
    parsed_query = query_processor.process(
        query=req.query,
        explicit_categories=req.categories,
        explicit_location=req.location
    )

    try:
        # Atomic Transaction
        search_run = SearchRun(
            id=search_run_id,
            user_id=current_user.id if current_user else None,
            query=req.query,
            parsed_query=parsed_query,
            status="queued",
            results_count=0
        )
        db.add(search_run)

        # Transactional Outbox Event
        outbox_event = OutboxEvent(
            id=outbox_event_id,
            search_run_id=search_run_id,
            event_type="project_search_requested",
            schema_version=1,
            payload={
                "event_id": str(outbox_event_id),
                "event_type": "project_search_requested",
                "schema_version": 1,
                "search_run_id": str(search_run_id),
                "trace_id": trace_id,
                "query": req.query,
                "parsed_query": parsed_query,
                "providers": req.providers or ["exa", settings.SECOND_PROVIDER_NAME.lower()]
            },
            status="pending"
        )
        db.add(outbox_event)

        # Initial Activity Event
        activity = ActivityEvent(
            id=uuid.uuid4(),
            search_run_id=search_run_id,
            event_type="search_created",
            component="api_gateway",
            message=f"Search accepted for: '{req.query}'. Outbox event enqueued.",
            metadata_={"trace_id": trace_id, "providers": req.providers}
        )
        db.add(activity)

        await db.commit()
        await db.refresh(search_run)

        # Cache initial progress state in Redis
        await redis_service.set_search_progress(
            str(search_run_id),
            {
                "status": "queued",
                "percent": 5,
                "stage": "search_created",
                "query": req.query
            }
        )

        logger.info(
            f"Created search_run {search_run_id} with outbox_event {outbox_event_id}",
            extra={"extra_data": {"trace_id": trace_id, "search_run_id": str(search_run_id)}}
        )

        return SearchCreateResponse(
            search_run_id=search_run.id,
            status=search_run.status,
            query=search_run.query,
            created_at=search_run.created_at,
            message="Search request accepted for background processing"
        )

    except Exception as exc:
        await db.rollback()
        logger.error(f"Failed to transactionally create search run: {exc}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to initiate search run"
        )


@router.get("", response_model=List[SearchRunResponse])
async def list_searches(
    status_filter: Optional[str] = Query(None, alias="status"),
    search: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db)
):
    """Lists previous search runs with optional filtering and pagination."""
    stmt = select(SearchRun).order_by(desc(SearchRun.created_at)).limit(limit).offset(offset)
    if status_filter:
        stmt = stmt.where(SearchRun.status == status_filter)
    if search:
        stmt = stmt.where(SearchRun.query.ilike(f"%{search}%"))

    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/{search_id}", response_model=SearchRunResponse)
async def get_search_run(search_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Retrieves execution status and metadata for a specific search run."""
    stmt = select(SearchRun).where(SearchRun.id == search_id)
    search_run = (await db.execute(stmt)).scalar_one_or_none()
    if not search_run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Search run not found")
    return search_run


@router.get("/{search_id}/events")
async def stream_search_events(
    search_id: uuid.UUID,
    last_event_id: Optional[str] = Header(None, alias="Last-Event-ID"),
    db: AsyncSession = Depends(get_db)
):
    """Server-Sent Events (SSE) stream for live execution timeline and progress updates."""
    # Verify search run exists
    stmt = select(SearchRun).where(SearchRun.id == search_id)
    search_run = (await db.execute(stmt)).scalar_one_or_none()
    if not search_run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Search run not found")

    async def event_generator() -> AsyncGenerator[str, None]:
        seen_event_ids = set()
        if last_event_id:
            seen_event_ids.add(last_event_id)

        terminal_states = {"completed", "partially_completed", "failed", "cancelled"}

        for _ in range(60):  # Maximum stream duration ~60 seconds before reconnection
            # Query new events
            events_stmt = (
                select(ActivityEvent)
                .where(ActivityEvent.search_run_id == search_id)
                .order_by(ActivityEvent.timestamp.asc())
            )
            async with AsyncSessionLocal() as session:
                events = (await session.execute(events_stmt)).scalars().all()
                run_status_res = await session.execute(select(SearchRun.status).where(SearchRun.id == search_id))
                current_status = run_status_res.scalar_one_or_none()

            for ev in events:
                ev_id_str = str(ev.id)
                if ev_id_str not in seen_event_ids:
                    seen_event_ids.add(ev_id_str)
                    payload = {
                        "event_id": ev_id_str,
                        "search_run_id": str(ev.search_run_id),
                        "event_type": ev.event_type,
                        "component": ev.component,
                        "message": ev.message,
                        "metadata": ev.metadata_,
                        "timestamp": ev.timestamp.isoformat()
                    }
                    yield f"id: {ev_id_str}\nevent: {ev.event_type}\ndata: {json.dumps(payload)}\n\n"

            # Check if search reached terminal state
            if current_status in terminal_states:
                yield f"event: done\ndata: {json.dumps({'status': current_status})}\n\n"
                break

            # Keep-alive comment and interval
            yield ": ping\n\n"
            await asyncio.sleep(1.0)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@router.get("/{search_id}/results", response_model=SearchResultsListResponse)
async def get_search_results(
    search_id: uuid.UUID,
    db: AsyncSession = Depends(get_db)
):
    """Retrieves ranked project results discovered by the search run."""
    stmt = select(SearchRun).where(SearchRun.id == search_id)
    search_run = (await db.execute(stmt)).scalar_one_or_none()
    if not search_run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Search run not found")

    # Fetch ranked search results with project and sources
    results_stmt = (
        select(SearchResult)
        .where(SearchResult.search_run_id == search_id)
        .options(
            selectinload(SearchResult.project).selectinload(Project.sources)
        )
        .order_by(desc(SearchResult.relevance_score))
    )
    search_results = (await db.execute(results_stmt)).scalars().all()

    formatted_results: List[SearchResultItemResponse] = []
    for sr in search_results:
        p = sr.project
        sources_list = [
            {
                "id": str(s.id),
                "provider": s.provider,
                "source_url": s.source_url,
                "source_title": s.source_title,
                "publication_date": s.publication_date.isoformat() if s.publication_date else None,
                "raw_snippet": s.raw_snippet
            }
            for s in p.sources
        ]
        formatted_results.append(
            SearchResultItemResponse(
                project_id=p.id,
                canonical_name=p.canonical_name,
                category=p.category,
                status=p.status,
                developer=p.developer,
                location_city=p.location_city,
                location_state=p.location_state,
                location_country=p.location_country,
                investment_value=float(p.investment_value) if p.investment_value is not None else None,
                investment_currency=p.investment_currency,
                capacity_value=float(p.capacity_value) if p.capacity_value is not None else None,
                capacity_unit=p.capacity_unit,
                relevance_score=float(sr.relevance_score),
                ranking_factors=sr.ranking_factors,
                sources=sources_list
            )
        )

    return SearchResultsListResponse(
        search_run_id=search_run.id,
        query=search_run.query,
        status=search_run.status,
        total_results=len(formatted_results),
        results=formatted_results
    )
