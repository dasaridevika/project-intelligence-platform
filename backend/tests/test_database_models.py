import uuid
from datetime import datetime, timezone
import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from app.models import (
    ActivityEvent,
    APIUsage,
    OutboxEvent,
    ProcessedMessage,
    Project,
    ProjectSource,
    SearchRun,
    SearchResult,
    SystemError,
    User,
)


@pytest.mark.asyncio
async def test_user_and_search_run_relationship(setup_db):
    from app.core.database import AsyncSessionLocal

    async with AsyncSessionLocal() as session:
        user = User(
            email="architect@enterprise.com",
            hashed_password="dummy_hash_for_testing",
            full_name="Principal Architect",
            role="admin",
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)

        search_run = SearchRun(
            user_id=user.id,
            query="Upcoming data center projects in Hyderabad",
            parsed_query={"category": "Data Center", "location": "Hyderabad"},
            status="queued"
        )
        session.add(search_run)
        await session.commit()
        await session.refresh(search_run)

        # Verify linkage
        stmt = select(SearchRun).where(SearchRun.id == search_run.id)
        result = await session.execute(stmt)
        fetched_run = result.scalar_one()

        assert fetched_run.user_id == user.id
        assert fetched_run.query == "Upcoming data center projects in Hyderabad"
        assert fetched_run.parsed_query["category"] == "Data Center"


@pytest.mark.asyncio
async def test_project_and_sources(setup_db):
    from app.core.database import AsyncSessionLocal

    async with AsyncSessionLocal() as session:
        project = Project(
            canonical_name="CtrlS Data Center Hyderabad Campus 2",
            normalized_name="ctrls data center hyderabad campus 2",
            category="Data Center",
            status="Under Construction",
            developer="CtrlS Datacenters Ltd",
            location_city="Hyderabad",
            location_state="Telangana",
            location_country="India",
            investment_value=1200000000.00,
            capacity_value=60.0,
            capacity_unit="MW",
            description="Tier 4 hyperscale data center facility in Hyderabad."
        )
        session.add(project)
        await session.commit()
        await session.refresh(project)

        source = ProjectSource(
            project_id=project.id,
            provider="exa",
            source_url="https://news.example.com/ctrls-hyderabad-expansion",
            source_title="CtrlS announces 60MW Hyderabad Hyperscale facility",
            raw_snippet="CtrlS begins construction of 60MW data center...",
            extracted_data={"capacity": "60MW", "city": "Hyderabad"}
        )
        session.add(source)
        await session.commit()

        # Duplicate source_url should violate unique constraint
        duplicate_source = ProjectSource(
            project_id=project.id,
            provider="brave",
            source_url="https://news.example.com/ctrls-hyderabad-expansion",
        )
        session.add(duplicate_source)
        with pytest.raises(IntegrityError):
            await session.commit()
        await session.rollback()


@pytest.mark.asyncio
async def test_search_results_and_ranking(setup_db):
    from app.core.database import AsyncSessionLocal

    async with AsyncSessionLocal() as session:
        search_run = SearchRun(
            query="Solar power projects in Telangana",
            status="completed",
            results_count=1
        )
        project = Project(
            canonical_name="Ramagundam Floating Solar Project",
            normalized_name="ramagundam floating solar project",
            category="Solar Power",
            status="Operational",
            developer="NTPC",
            location_city="Ramagundam",
            location_state="Telangana",
            capacity_value=100.0,
            capacity_unit="MW"
        )
        session.add_all([search_run, project])
        await session.commit()

        sr = SearchResult(
            search_run_id=search_run.id,
            project_id=project.id,
            relevance_score=0.9450,
            ranking_factors={
                "location_match": 1.0,
                "category_match": 1.0,
                "query_relevance": 0.89,
                "completeness": 0.90
            }
        )
        session.add(sr)
        await session.commit()

        stmt = select(SearchResult).where(SearchResult.search_run_id == search_run.id)
        res = (await session.execute(stmt)).scalar_one()
        assert float(res.relevance_score) == pytest.approx(0.9450)
        assert res.ranking_factors["location_match"] == 1.0


@pytest.mark.asyncio
async def test_outbox_and_idempotency_records(setup_db):
    from app.core.database import AsyncSessionLocal

    async with AsyncSessionLocal() as session:
        search_run = SearchRun(query="Semiconductor projects in Gujarat", status="queued")
        session.add(search_run)
        await session.flush()

        event_id = uuid.uuid4()
        outbox = OutboxEvent(
            id=event_id,
            search_run_id=search_run.id,
            event_type="project_search_requested",
            payload={"search_run_id": str(search_run.id), "query": search_run.query},
            status="pending"
        )
        session.add(outbox)
        await session.commit()

        # Simulate consumer recording processed message
        proc = ProcessedMessage(
            event_id=event_id,
            search_run_id=search_run.id,
            consumer_id="consumer-node-01"
        )
        session.add(proc)
        await session.commit()

        # Verify duplicate event_id is rejected
        dup_proc = ProcessedMessage(
            event_id=event_id,
            search_run_id=search_run.id,
            consumer_id="consumer-node-02"
        )
        session.add(dup_proc)
        with pytest.raises(IntegrityError):
            await session.commit()
        await session.rollback()


@pytest.mark.asyncio
async def test_cascade_delete_search_run(setup_db):
    from app.core.database import AsyncSessionLocal

    async with AsyncSessionLocal() as session:
        search_run = SearchRun(query="Cascade test query", status="processing")
        session.add(search_run)
        await session.flush()

        # Add related activity event and api usage
        event = ActivityEvent(
            search_run_id=search_run.id,
            event_type="provider_started",
            component="orchestrator",
            message="Calling Exa provider"
        )
        usage = APIUsage(
            search_run_id=search_run.id,
            provider="exa",
            endpoint="/search",
            http_status=200,
            latency_ms=450.2,
            units_consumed=1
        )
        session.add_all([event, usage])
        await session.commit()

        # Delete search run and verify cascade
        await session.delete(search_run)
        await session.commit()

        event_check = (await session.execute(select(ActivityEvent).where(ActivityEvent.search_run_id == search_run.id))).all()
        usage_check = (await session.execute(select(APIUsage).where(APIUsage.search_run_id == search_run.id))).all()
        assert len(event_check) == 0
        assert len(usage_check) == 0
