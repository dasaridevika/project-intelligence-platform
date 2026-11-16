import asyncio
import hashlib
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import AsyncSessionLocal
from app.core.logging import logger
from app.core.redis import redis_service
from app.models.analytics import ActivityEvent, APIUsage
from app.models.project import Project, ProjectSource, SearchResult
from app.models.search import SearchRun
from app.models.system import SystemError
from app.providers.base import ProviderSearchResult
from app.providers.registry import provider_registry
from app.services.deduplicator import project_deduplicator
from app.services.extractor import project_extractor
from app.services.normalizer import project_normalizer
from app.services.ranker import project_ranker


class SearchOrchestrator:
    """Orchestrates parallel provider queries, extraction, deduplication, ranking, and persistence."""

    async def _emit_activity(
        self,
        session: AsyncSession,
        search_run_id: uuid.UUID,
        event_type: str,
        component: str,
        message: str,
        metadata: Optional[Dict[str, Any]] = None,
        progress_pct: Optional[int] = None
    ):
        event = ActivityEvent(
            id=uuid.uuid4(),
            search_run_id=search_run_id,
            event_type=event_type,
            component=component,
            message=message,
            metadata_=metadata or {},
            timestamp=datetime.now(timezone.utc)
        )
        session.add(event)
        await session.flush()

        # Update Redis live progress
        if progress_pct is not None:
            await redis_service.set_search_progress(
                str(search_run_id),
                {
                    "search_run_id": str(search_run_id),
                    "status": "processing",
                    "percent": progress_pct,
                    "stage": event_type,
                    "message": message,
                    "updated_at": datetime.now(timezone.utc).isoformat()
                }
            )

    async def execute_search(
        self,
        search_run_id: uuid.UUID,
        query: str,
        parsed_query: Dict[str, Any],
        requested_providers: Optional[List[str]] = None,
        trace_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Main orchestrator execution loop."""
        start_time = time.perf_counter()
        logger.info(
            f"Orchestrating search_run {search_run_id} for query '{query}'",
            extra={"extra_data": {"search_run_id": str(search_run_id), "trace_id": trace_id}}
        )

        async with AsyncSessionLocal() as session:
            try:
                # 1. Update status to 'processing'
                stmt = select(SearchRun).where(SearchRun.id == search_run_id)
                search_run = (await session.execute(stmt)).scalar_one_or_none()
                if not search_run:
                    raise ValueError(f"SearchRun {search_run_id} not found in database")

                search_run.status = "processing"
                search_run.started_at = datetime.now(timezone.utc)
                await session.flush()

                await self._emit_activity(
                    session, search_run_id, "query_analyzed", "orchestrator",
                    f"Analyzed query: category='{parsed_query.get('category')}', location='{parsed_query.get('location')}'",
                    metadata=parsed_query, progress_pct=15
                )

                # 2. Select providers
                providers = provider_registry.get_active_providers(requested_providers)
                if not providers:
                    raise ValueError("No active search providers available for execution")

                await self._emit_activity(
                    session, search_run_id, "provider_started", "orchestrator",
                    f"Dispatching parallel search to {len(providers)} providers: {[p.name for p in providers]}",
                    metadata={"providers": [p.name for p in providers]}, progress_pct=25
                )

                # 3. Parallel Provider Execution
                async def run_single_provider(provider):
                    try:
                        return await provider.search(query=query)
                    except Exception as exc:
                        logger.error(f"Provider {provider.name} crashed: {exc}", exc_info=True)
                        return ProviderSearchResult(
                            provider=provider.name,
                            success=False,
                            error_message=str(exc),
                            http_status=500
                        )

                provider_tasks = [run_single_provider(p) for p in providers]
                results: List[ProviderSearchResult] = await asyncio.gather(*provider_tasks)

                # Record API Usage & evaluate results
                all_raw_items = []
                successful_providers = 0
                failed_providers = 0

                for res in results:
                    # Persist usage
                    if res.usage:
                        usage_rec = APIUsage(
                            id=uuid.uuid4(),
                            search_run_id=search_run_id,
                            provider=res.usage.provider,
                            endpoint=res.usage.endpoint,
                            http_status=res.usage.http_status,
                            latency_ms=res.usage.latency_ms,
                            retry_count=res.usage.retry_count,
                            units_consumed=res.usage.units_consumed,
                            estimated_cost=res.usage.estimated_cost,
                            response_meta=res.usage.response_meta
                        )
                        session.add(usage_rec)

                    if res.success:
                        successful_providers += 1
                        all_raw_items.extend(res.items)
                        await self._emit_activity(
                            session, search_run_id, "provider_completed", res.provider,
                            f"Provider '{res.provider}' returned {len(res.items)} candidate sources in {res.usage.latency_ms if res.usage else 0}ms",
                            metadata={"count": len(res.items), "latency_ms": res.usage.latency_ms if res.usage else 0}
                        )
                    else:
                        failed_providers += 1
                        await self._emit_activity(
                            session, search_run_id, "provider_failed", res.provider,
                            f"Provider '{res.provider}' failed: {res.error_message}",
                            metadata={"error": res.error_message, "http_status": res.http_status}
                        )

                # If all providers failed
                if successful_providers == 0 and len(all_raw_items) == 0:
                    search_run.status = "failed"
                    search_run.completed_at = datetime.now(timezone.utc)
                    search_run.total_duration_seconds = round(time.perf_counter() - start_time, 3)
                    await self._emit_activity(
                        session, search_run_id, "search_failed", "orchestrator",
                        "All configured search providers failed. Search marked as failed.",
                        progress_pct=100
                    )
                    await session.commit()
                    return {"status": "failed", "results_count": 0}

                # 4. Extraction
                await self._emit_activity(
                    session, search_run_id, "extraction_started", "extractor",
                    f"Extracting structured project fields from {len(all_raw_items)} source items",
                    progress_pct=50
                )

                extracted_candidates = []
                for item in all_raw_items:
                    cand = project_extractor.extract_candidate(
                        item=item,
                        provider_name=item.extra_metadata.get("provider", "web"),
                        default_category=parsed_query.get("category", "Capital Projects")
                    )
                    if cand:
                        extracted_candidates.append(cand)

                await self._emit_activity(
                    session, search_run_id, "extraction_completed", "extractor",
                    f"Extracted {len(extracted_candidates)} candidate project records",
                    metadata={"candidates_count": len(extracted_candidates)}, progress_pct=65
                )

                # 5. Deduplication
                deduped_projects = project_deduplicator.deduplicate(extracted_candidates)
                await self._emit_activity(
                    session, search_run_id, "deduplication_completed", "deduplicator",
                    f"Normalized and deduplicated into {len(deduped_projects)} canonical projects",
                    metadata={"canonical_count": len(deduped_projects)}, progress_pct=80
                )

                # 6. Ranking
                ranked_projects = project_ranker.rank(deduped_projects, parsed_query)

                # 7. Persistence into PostgreSQL
                for rp in ranked_projects:
                    proj = rp.project

                    # Check if project canonical name already exists
                    existing_proj_stmt = select(Project).where(Project.canonical_name == proj.canonical_name)
                    existing_proj = (await session.execute(existing_proj_stmt)).scalar_one_or_none()

                    if existing_proj:
                        target_project = existing_proj
                        # Backfill attributes if missing
                        if not target_project.developer and proj.developer:
                            target_project.developer = proj.developer
                        if not target_project.capacity_value and proj.capacity_value:
                            target_project.capacity_value = proj.capacity_value
                            target_project.capacity_unit = proj.capacity_unit
                    else:
                        target_project = Project(
                            id=uuid.uuid4(),
                            canonical_name=proj.canonical_name,
                            normalized_name=proj.normalized_name,
                            category=proj.category,
                            status=proj.status,
                            developer=proj.developer,
                            location_city=proj.location_city,
                            location_state=proj.location_state,
                            location_country=proj.location_country,
                            investment_value=proj.investment_value,
                            investment_currency=proj.investment_currency,
                            capacity_value=proj.capacity_value,
                            capacity_unit=proj.capacity_unit,
                            description=proj.description,
                        )
                        session.add(target_project)
                        await session.flush()

                    # Save sources with deduplicated URL check
                    for src in proj.sources:
                        existing_src = (
                            await session.execute(
                                select(ProjectSource).where(ProjectSource.source_url == src.source_url)
                            )
                        ).scalar_one_or_none()

                        if not existing_src:
                            new_source = ProjectSource(
                                id=uuid.uuid4(),
                                project_id=target_project.id,
                                provider=src.provider,
                                source_url=src.source_url,
                                source_title=src.source_title,
                                publication_date=src.publication_date,
                                raw_snippet=src.raw_snippet,
                                extracted_data={
                                    "developer": src.developer,
                                    "capacity": f"{src.capacity_value} {src.capacity_unit}" if src.capacity_value else None,
                                    "investment": src.investment_value
                                }
                            )
                            session.add(new_source)

                    # Create SearchResult junction
                    search_result = SearchResult(
                        id=uuid.uuid4(),
                        search_run_id=search_run_id,
                        project_id=target_project.id,
                        relevance_score=rp.relevance_score,
                        ranking_factors=rp.ranking_factors
                    )
                    session.add(search_result)

                # 8. Final Status Update
                final_status = "completed" if failed_providers == 0 else "partially_completed"
                search_run.status = final_status
                search_run.results_count = len(ranked_projects)
                search_run.completed_at = datetime.now(timezone.utc)
                duration_sec = round(time.perf_counter() - start_time, 3)
                search_run.total_duration_seconds = duration_sec

                await self._emit_activity(
                    session, search_run_id, "search_completed", "orchestrator",
                    f"Search completed with {len(ranked_projects)} projects in {duration_sec}s",
                    metadata={"status": final_status, "count": len(ranked_projects), "duration": duration_sec},
                    progress_pct=100
                )

                await session.commit()

                # Cache in Redis with hash of normalized query
                q_hash = hashlib.sha256(query.strip().lower().encode("utf-8")).hexdigest()[:16]
                await redis_service.set_json(
                    f"query_cache:{q_hash}",
                    {
                        "search_run_id": str(search_run_id),
                        "query": query,
                        "results_count": len(ranked_projects),
                        "status": final_status
                    },
                    ttl=1800
                )

                logger.info(
                    f"Successfully completed search {search_run_id}: {len(ranked_projects)} projects discovered ({duration_sec}s)"
                )
                return {
                    "status": final_status,
                    "results_count": len(ranked_projects),
                    "duration_seconds": duration_sec
                }

            except Exception as exc:
                await session.rollback()
                logger.error(f"Search orchestration error for {search_run_id}: {exc}", exc_info=True)

                # Log error in system_errors table
                async with AsyncSessionLocal() as err_session:
                    err_record = SystemError(
                        id=uuid.uuid4(),
                        search_run_id=search_run_id,
                        component="search_orchestrator",
                        error_code="ORCHESTRATION_EXCEPTION",
                        message=str(exc),
                        context={"query": query, "trace_id": trace_id}
                    )
                    err_session.add(err_record)

                    # Update run to failed
                    failed_run = (await err_session.execute(select(SearchRun).where(SearchRun.id == search_run_id))).scalar_one_or_none()
                    if failed_run:
                        failed_run.status = "failed"
                        failed_run.completed_at = datetime.now(timezone.utc)
                    await err_session.commit()

                raise


search_orchestrator = SearchOrchestrator()
