import asyncio
import hashlib
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import AsyncSessionLocal
from app.core.logging import logger
from app.core.redis import redis_service
from app.models.analytics import ActivityEvent, APIUsage
from app.models.outbox import OutboxEvent
from app.models.project import Project, ProjectSource, SearchResult
from app.models.search import SearchRun
from app.models.system import SystemError
from app.providers.base import ProviderSearchResult, RawProviderResultItem
from app.providers.registry import provider_registry
from app.services.deduplicator import project_deduplicator
from app.services.extractor import ExtractedProjectCandidate, project_extractor
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
        # Log to standard output so Render dashboard and stdout capture it immediately
        logger.info(f"[{event_type.upper()}] [{component}] [Run: {str(search_run_id)[:8]}] {message}")

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
        await session.commit()

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

                # Idempotency check: prevent duplicate concurrent runs from conflicting
                if search_run.status in ("completed", "processing"):
                    logger.info(f"SearchRun {search_run_id} is already in '{search_run.status}' state. Skipping duplicate execution.")
                    return {"status": search_run.status, "results_count": search_run.results_count}

                search_run.status = "processing"
                search_run.started_at = datetime.now(timezone.utc)
                await session.commit()

                # Phase 0: Database Cache & Duplicate Query Check
                normalized_q = query.strip().lower()
                prior_completed_stmt = (
                    select(SearchRun)
                    .where(
                        func.lower(SearchRun.query) == normalized_q,
                        SearchRun.status == "completed",
                        SearchRun.results_count > 0,
                        SearchRun.id != search_run_id
                    )
                    .order_by(SearchRun.completed_at.desc())
                    .limit(1)
                )
                prior_run = (await session.execute(prior_completed_stmt)).scalar_one_or_none()

                if prior_run:
                    # Query existing SearchResults for this prior run
                    prior_results_stmt = (
                        select(SearchResult)
                        .where(SearchResult.search_run_id == prior_run.id)
                    )
                    prior_sr_list = (await session.execute(prior_results_stmt)).scalars().all()

                    if prior_sr_list:
                        await self._emit_activity(
                            session, search_run_id, "query_cache_hit", "database",
                            f"Verified discovery cache hit: Query '{query}' already exists in database with {len(prior_sr_list)} verified projects. Reusing existing data without calling external APIs or LLM.",
                            metadata={"prior_search_run_id": str(prior_run.id), "projects_count": len(prior_sr_list)},
                            progress_pct=50
                        )

                        # Safely link existing projects as SearchResults for the current run
                        linked_count = 0
                        for psr in prior_sr_list:
                            existing_link = (
                                await session.execute(
                                    select(SearchResult).where(
                                        SearchResult.search_run_id == search_run_id,
                                        SearchResult.project_id == psr.project_id
                                    )
                                )
                            ).scalar_one_or_none()

                            if not existing_link:
                                new_sr = SearchResult(
                                    id=uuid.uuid4(),
                                    search_run_id=search_run_id,
                                    project_id=psr.project_id,
                                    relevance_score=psr.relevance_score,
                                    ranking_factors=psr.ranking_factors
                                )
                                session.add(new_sr)
                                linked_count += 1

                        await self._emit_activity(
                            session, search_run_id, "search_completed", "orchestrator",
                            f"Discovery complete via database cache: {linked_count} projects linked. Total execution time: {(time.perf_counter() - start_time):.2f}s",
                            metadata={"results_count": linked_count, "source": "database_cache"},
                            progress_pct=100
                        )

                        # Complete search run
                        search_run.status = "completed"
                        search_run.results_count = linked_count
                        search_run.completed_at = datetime.now(timezone.utc)
                        search_run.duration_ms = (time.perf_counter() - start_time) * 1000.0

                        # Mark outbox event processed
                        outbox_stmt = select(OutboxEvent).where(OutboxEvent.search_run_id == search_run_id)
                        outbox_events = (await session.execute(outbox_stmt)).scalars().all()
                        for ev in outbox_events:
                            ev.status = "processed"
                            ev.processed_at = datetime.now(timezone.utc)

                        await session.commit()

                        return {
                            "status": "completed",
                            "results_count": linked_count,
                            "source": "database_cache",
                            "duration_ms": search_run.duration_ms
                        }

                # Phase 1: Query NLP Analysis
                kw_preview = ", ".join(parsed_query.get("keywords", [])[:5])
                await self._emit_activity(
                    session, search_run_id, "query_analyzed", "orchestrator",
                    f"Analyzed query: '{query}' -> Primary Sector: '{parsed_query.get('category', 'Capital Projects')}', Target Location: '{parsed_query.get('location', 'Global')}', Expanded keywords: [{kw_preview}]",
                    metadata=parsed_query, progress_pct=15
                )

                # Phase 2: Select Providers
                providers = provider_registry.get_active_providers(requested_providers)
                provider_names = [p.name for p in providers] if providers else ["discovery_index"]

                await self._emit_activity(
                    session, search_run_id, "provider_started", "orchestrator",
                    f"Dispatching parallel search to providers: {provider_names}",
                    metadata={"providers": provider_names}, progress_pct=25
                )

                # Phase 3: Parallel Provider Execution
                all_raw_items: List[RawProviderResultItem] = []
                successful_providers = 0
                failed_providers = 0

                if providers:
                    # Construct targeted capital project discovery query for external search engines
                    search_term = query.strip()
                    lower_term = search_term.lower()
                    project_signals = ["project", "facility", "construction", "investment", "campus", "plant", "expansion", "announced", "megafab", "gigafactory", "fab"]
                    if not any(sig in lower_term for sig in project_signals):
                        search_term = f"{search_term} projects investments construction campus facility"

                    async def run_single_provider(provider):
                        try:
                            return await provider.search(query=search_term)
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

                    for res in results:
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
                            await session.commit()

                        if res.success and len(res.items) > 0:
                            successful_providers += 1
                            all_raw_items.extend(res.items)
                            await self._emit_activity(
                                session, search_run_id, "provider_completed", res.provider,
                                f"Provider '{res.provider}' fetched {len(res.items)} candidate URLs in {res.usage.latency_ms if res.usage else 0}ms",
                                metadata={"count": len(res.items), "latency_ms": res.usage.latency_ms if res.usage else 0}
                            )
                        else:
                            failed_providers += 1
                            err_desc = res.error_message or "No results returned"
                            await self._emit_activity(
                                session, search_run_id, "provider_failed", res.provider,
                                f"Provider '{res.provider}' notice: {err_desc}",
                                metadata={"error": err_desc, "http_status": res.http_status}
                            )

                if len(all_raw_items) == 0:
                    await self._emit_activity(
                        session, search_run_id, "provider_notice", "orchestrator",
                        f"External search providers returned 0 candidates for query: '{query}'",
                        progress_pct=35
                    )

                # Log each individual candidate URL being fetched into the pipeline
                for idx, r_item in enumerate(all_raw_items, 1):
                    await self._emit_activity(
                        session, search_run_id, "url_fetched", r_item.extra_metadata.get("provider", "search_provider"),
                        f"[{idx}/{len(all_raw_items)}] Fetched candidate URL: {r_item.url} | Title: '{r_item.title[:80]}'",
                        metadata={"url": r_item.url, "title": r_item.title, "index": idx}
                    )

                # Phase 4: Extraction & Candidate Evaluation (Accept vs. Reject with exact reasons)
                await self._emit_activity(
                    session, search_run_id, "extraction_started", "extractor",
                    f"Evaluating {len(all_raw_items)} source URLs for capital project parameters and factual metrics",
                    progress_pct=50
                )

                extracted_candidates = []
                seen_urls = set()

                for idx, item in enumerate(all_raw_items, 1):
                    raw_url = item.url or ""

                    # 1. URL Validation Check (Protocol, Host, Domain Reputation, File Types)
                    is_valid, clean_url, val_reason = project_normalizer.validate_and_normalize_url(raw_url)
                    if not is_valid or not clean_url:
                        await self._emit_activity(
                            session, search_run_id, "candidate_rejected", "extractor",
                            f"REJECTED URL: {raw_url} -> Reason: {val_reason}",
                            metadata={"url": raw_url, "reason": val_reason, "decision": "rejected"}
                        )
                        continue

                    # 2. In-Memory URL Deduplication Check
                    if clean_url in seen_urls:
                        await self._emit_activity(
                            session, search_run_id, "candidate_rejected", "extractor",
                            f"REJECTED URL: {clean_url} -> Reason: Duplicate source URL already evaluated in this search run",
                            metadata={"url": clean_url, "reason": "duplicate_url", "decision": "rejected"}
                        )
                        continue
                    seen_urls.add(clean_url)

                    # 3. Database Source Existence Check: Has this URL already been extracted?
                    existing_src_stmt = select(ProjectSource).where(ProjectSource.source_url == clean_url)
                    existing_src = (await session.execute(existing_src_stmt)).scalar_one_or_none()

                    if existing_src:
                        # Found existing ProjectSource in database! Fetch associated Project directly
                        existing_proj_stmt = select(Project).where(Project.id == existing_src.project_id)
                        existing_proj = (await session.execute(existing_proj_stmt)).scalar_one_or_none()

                        if existing_proj:
                            cached_cand = ExtractedProjectCandidate(
                                canonical_name=existing_proj.canonical_name,
                                category=existing_proj.category,
                                status=existing_proj.status,
                                developer=existing_proj.developer,
                                location_city=existing_proj.location_city,
                                location_state=existing_proj.location_state,
                                location_country=existing_proj.location_country or "Global",
                                investment_value=float(existing_proj.investment_value) if existing_proj.investment_value else None,
                                investment_currency=existing_proj.investment_currency or "USD",
                                capacity_value=float(existing_proj.capacity_value) if existing_proj.capacity_value else None,
                                capacity_unit=existing_proj.capacity_unit,
                                description=existing_proj.description or item.snippet,
                                source_url=clean_url,
                                source_title=existing_src.source_title or item.title,
                                provider=existing_src.provider,
                                publication_date=existing_src.publication_date,
                                raw_snippet=existing_src.raw_snippet or item.snippet,
                                metadata={"database_cached": True, "project_id": str(existing_proj.id)}
                            )
                            extracted_candidates.append(cached_cand)
                            await self._emit_activity(
                                session, search_run_id, "candidate_accepted", "database",
                                f"ACCEPTED FROM DATABASE: '{existing_proj.canonical_name}' [{existing_proj.category}] (Source: {clean_url}) - Verified project record already in database",
                                metadata={"url": clean_url, "project_name": existing_proj.canonical_name, "decision": "accepted", "source": "database_cache"}
                            )
                            continue

                    # 4. Brand new, unextracted valid URL -> Evaluate candidate validity & extract structured parameters
                    item.url = clean_url
                    cand, decision_reason, is_accepted = project_extractor.evaluate_and_extract(
                        item=item,
                        provider_name=item.extra_metadata.get("provider", "web"),
                        default_category=parsed_query.get("category", "Capital Projects")
                    )

                    if is_accepted and cand:
                        extracted_candidates.append(cand)
                        cap_str = f" | Capacity: {cand.capacity_value} {cand.capacity_unit}" if cand.capacity_value else ""
                        inv_str = f" | Investment: {cand.investment_currency or '$'} {cand.investment_value:,.0f}" if cand.investment_value else ""
                        loc_str = f" | Location: {cand.location_city or cand.location_state or cand.location_country or 'Global'}"
                        dev_str = f" | Developer: {cand.developer or 'Unspecified'}"

                        await self._emit_activity(
                            session, search_run_id, "candidate_accepted", "extractor",
                            f"ACCEPTED: '{cand.canonical_name}' [{cand.category}]{dev_str}{loc_str}{cap_str}{inv_str} (Source: {clean_url})",
                            metadata={
                                "url": clean_url,
                                "project_name": cand.canonical_name,
                                "category": cand.category,
                                "developer": cand.developer,
                                "location": cand.location_country,
                                "decision": "accepted"
                            }
                        )
                    else:
                        await self._emit_activity(
                            session, search_run_id, "candidate_rejected", "extractor",
                            f"REJECTED URL: {clean_url} -> Reason: {decision_reason}",
                            metadata={"url": clean_url, "reason": decision_reason, "decision": "rejected"}
                        )

                await self._emit_activity(
                    session, search_run_id, "extraction_completed", "extractor",
                    f"Extraction evaluation complete: {len(extracted_candidates)} project candidates accepted, {len(all_raw_items) - len(extracted_candidates)} candidate URLs rejected",
                    metadata={"accepted_count": len(extracted_candidates), "rejected_count": len(all_raw_items) - len(extracted_candidates)},
                    progress_pct=65
                )

                # Phase 5: Deduplication & Entity Resolution
                deduped_projects = project_deduplicator.deduplicate(extracted_candidates)
                await self._emit_activity(
                    session, search_run_id, "deduplication_completed", "deduplicator",
                    f"Entity resolution consolidated {len(extracted_candidates)} source candidates into {len(deduped_projects)} canonical projects",
                    metadata={"canonical_count": len(deduped_projects)}, progress_pct=80
                )

                # Phase 6: Ranking & Explainable Scoring
                ranked_projects = project_ranker.rank(deduped_projects, parsed_query)
                for rp in ranked_projects[:5]:
                    factors = rp.ranking_factors
                    await self._emit_activity(
                        session, search_run_id, "ranking_evaluated", "ranker",
                        f"RANKED #{ranked_projects.index(rp) + 1}: '{rp.project.canonical_name}' -> Relevance Score: {int(rp.relevance_score * 100)}% (Keyword Match: {int(factors['query_keyword_match']*100)}%, Location: {int(factors['location_match']*100)}%, Completeness: {int(factors['information_completeness']*100)}%, Sources: {factors['source_count']})",
                        metadata={"project_name": rp.project.canonical_name, "score": rp.relevance_score, "factors": factors}
                    )

                # Phase 7: Persistence
                seen_project_ids = set()
                for rp in ranked_projects:
                    proj = rp.project

                    # Check if project canonical name already exists
                    existing_proj_stmt = select(Project).where(Project.canonical_name == proj.canonical_name)
                    existing_proj = (await session.execute(existing_proj_stmt)).scalar_one_or_none()

                    if existing_proj:
                        target_project = existing_proj
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

                    # Prevent duplicate SearchResult entries for the same project in this search run
                    if target_project.id in seen_project_ids:
                        continue
                    seen_project_ids.add(target_project.id)

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

                    # Create SearchResult junction safely
                    existing_sr = (
                        await session.execute(
                            select(SearchResult).where(
                                SearchResult.search_run_id == search_run_id,
                                SearchResult.project_id == target_project.id
                            )
                        )
                    ).scalar_one_or_none()

                    if not existing_sr:
                        search_result = SearchResult(
                            id=uuid.uuid4(),
                            search_run_id=search_run_id,
                            project_id=target_project.id,
                            relevance_score=rp.relevance_score,
                            ranking_factors=rp.ranking_factors
                        )
                        session.add(search_result)

                # Mark Outbox Event as processed
                outbox_records = (
                    await session.execute(
                        select(OutboxEvent).where(OutboxEvent.search_run_id == search_run_id)
                    )
                ).scalars().all()
                for ob in outbox_records:
                    ob.status = "processed"

                # Phase 8: Final Status Update
                final_status = "completed"
                search_run.status = final_status
                search_run.results_count = len(ranked_projects)
                search_run.completed_at = datetime.now(timezone.utc)
                duration_sec = round(time.perf_counter() - start_time, 3)
                search_run.total_duration_seconds = duration_sec

                await self._emit_activity(
                    session, search_run_id, "search_completed", "orchestrator",
                    f"Search completed: {len(ranked_projects)} canonical projects discovered, ranked, and persisted in {duration_sec}s",
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

                    failed_run = (await err_session.execute(select(SearchRun).where(SearchRun.id == search_run_id))).scalar_one_or_none()
                    if failed_run:
                        failed_run.status = "failed"
                        failed_run.completed_at = datetime.now(timezone.utc)
                    await err_session.commit()

                raise


search_orchestrator = SearchOrchestrator()
