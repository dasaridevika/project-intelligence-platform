import asyncio
import uuid
import pytest
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.models.analytics import ActivityEvent, APIUsage
from app.models.outbox import ProcessedMessage
from app.models.project import Project, ProjectSource, SearchResult
from app.models.search import SearchRun
from app.providers.base import (
    BaseSearchProvider,
    ProviderSearchResult,
    ProviderUsage,
    RawProviderResultItem,
)
from app.providers.registry import provider_registry
from app.services.deduplicator import project_deduplicator
from app.services.extractor import project_extractor
from app.services.normalizer import project_normalizer
from app.services.ranker import project_ranker
from app.services.search_orchestrator import search_orchestrator

# Consumer imports
import sys, os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "consumer")))
from consumer import SearchJobConsumer
from queue_client import CloudflareQueueClient, QueueMessage


class MockSuccessProvider(BaseSearchProvider):
    def __init__(self, name="mock_success"):
        super().__init__(name=name)

    async def search(self, query: str, max_results: int = 20, **kwargs) -> ProviderSearchResult:
        items = [
            RawProviderResultItem(
                title="CtrlS breaks ground on 60MW Hyderabad Data Center Campus - TechNews",
                url="https://technews.example.com/ctrls-hyderabad-60mw",
                snippet="CtrlS Datacenters has announced a massive 60MW hyperscale data center facility in Hyderabad with an estimated capex of ₹1200 Crores.",
                published_date="2026-05-10T10:00:00Z"
            ),
            RawProviderResultItem(
                title="Adani Green to expand Khavda Solar and Wind Park to 30GW",
                url="https://energy.example.com/adani-khavda-30gw",
                snippet="Adani Green Energy is developing the world's largest renewable park at Khavda, Gujarat, targeting 30 GW capacity.",
                published_date="2026-04-12T12:00:00Z"
            )
        ]
        usage = ProviderUsage(
            provider=self.name,
            endpoint="https://mock.search/v1",
            http_status=200,
            latency_ms=120.5,
            units_consumed=1
        )
        return ProviderSearchResult(provider=self.name, success=True, items=items, usage=usage)


class MockFailingProvider(BaseSearchProvider):
    def __init__(self, name="mock_fail"):
        super().__init__(name=name)

    async def search(self, query: str, max_results: int = 20, **kwargs) -> ProviderSearchResult:
        usage = ProviderUsage(
            provider=self.name,
            endpoint="https://mock.fail/search",
            http_status=500,
            latency_ms=310.0,
            units_consumed=0
        )
        return ProviderSearchResult(
            provider=self.name,
            success=False,
            error_message="Simulated upstream 500 Internal Error",
            http_status=500,
            usage=usage
        )


def test_project_extractor_fields():
    item = RawProviderResultItem(
        title="Micron Technology breaks ground on $2.75 Billion semiconductor assembly plant in Sanand, Gujarat",
        url="https://reuters.example.com/micron-sanand",
        snippet="Micron Technology announced its new semiconductor ATMP unit in Sanand, Gujarat with total investment of $2.75 Billion. Civil works under construction.",
        published_date="2026-03-01T08:00:00Z"
    )
    cand = project_extractor.extract_candidate(item, provider_name="mock_exa", default_category="Semiconductor")
    assert cand is not None
    assert "Micron" in cand.canonical_name
    assert cand.developer == "Micron" or cand.developer == "Micron Technology"
    assert cand.location_city == "Sanand"
    assert cand.location_state == "Gujarat"
    assert cand.investment_currency == "USD"
    assert cand.investment_value == 2750000000.0
    assert cand.status == "Under Construction"


def test_normalizer_and_deduplicator():
    item1 = RawProviderResultItem(
        title="CtrlS announces 60MW Data Center Campus in Hyderabad",
        url="https://source1.example.com/ctrls-dc",
        snippet="CtrlS Datacenters 60MW data center project in Hyderabad."
    )
    item2 = RawProviderResultItem(
        title="CtrlS Datacenters reveals 60MW Hyderabad Hyperscale facility",
        url="https://source2.example.com/ctrls-facility",
        snippet="CtrlS announced its 60MW facility in Hyderabad."
    )

    cand1 = project_extractor.extract_candidate(item1, "exa", "Data Center")
    cand2 = project_extractor.extract_candidate(item2, "brave", "Data Center")

    deduped = project_deduplicator.deduplicate([cand1, cand2])
    assert len(deduped) == 1  # Successfully merged
    assert len(deduped[0].sources) == 2  # Provenance from both sources retained!


def test_ranking_scoring():
    item = RawProviderResultItem(
        title="CtrlS 60MW Hyderabad Data Center",
        url="https://example.com/dc",
        snippet="60MW hyperscale data center in Hyderabad, Telangana."
    )
    cand = project_extractor.extract_candidate(item, "exa", "Data Center")
    deduped = project_deduplicator.deduplicate([cand])

    parsed_query = {
        "category": "Data Center",
        "location": "Hyderabad",
        "keywords": ["data", "center", "hyderabad", "ctrls"]
    }

    ranked = project_ranker.rank(deduped, parsed_query)
    assert len(ranked) == 1
    assert ranked[0].relevance_score >= 0.80
    assert ranked[0].ranking_factors["category_match"] == 1.0
    assert ranked[0].ranking_factors["location_match"] == 1.0


@pytest.mark.asyncio
async def test_search_orchestrator_partial_success(setup_db):
    # Register mock providers
    provider_registry.register(MockSuccessProvider())
    provider_registry.register(MockFailingProvider())

    search_run_id = uuid.uuid4()
    query = "Upcoming data center projects in Hyderabad"
    parsed_query = {"category": "Data Center", "location": "Hyderabad", "keywords": ["data", "center"]}

    async with AsyncSessionLocal() as session:
        search_run = SearchRun(
            id=search_run_id,
            query=query,
            parsed_query=parsed_query,
            status="queued"
        )
        session.add(search_run)
        await session.commit()

    # Execute orchestrator
    res = await search_orchestrator.execute_search(
        search_run_id=search_run_id,
        query=query,
        parsed_query=parsed_query,
        requested_providers=["mock_success", "mock_fail"]
    )

    # One provider succeeded, one failed -> partially_completed
    assert res["status"] == "partially_completed"
    assert res["results_count"] >= 1

    # Verify DB records
    async with AsyncSessionLocal() as session:
        run = (await session.execute(select(SearchRun).where(SearchRun.id == search_run_id))).scalar_one()
        assert run.status == "partially_completed"
        assert run.results_count >= 1
        assert run.completed_at is not None

        # Verify search results
        results = (await session.execute(select(SearchResult).where(SearchResult.search_run_id == search_run_id))).scalars().all()
        assert len(results) >= 1

        # Verify activity events
        events = (await session.execute(select(ActivityEvent).where(ActivityEvent.search_run_id == search_run_id))).scalars().all()
        event_types = [e.event_type for e in events]
        assert "provider_started" in event_types
        assert "provider_completed" in event_types
        assert "provider_failed" in event_types
        assert "search_completed" in event_types


@pytest.mark.asyncio
async def test_consumer_idempotency_and_ack(setup_db):
    provider_registry.register(MockSuccessProvider())

    q_client = CloudflareQueueClient()
    consumer = SearchJobConsumer(client=q_client, consumer_id="test-consumer-01")

    search_run_id = uuid.uuid4()
    event_id = uuid.uuid4()
    query = "Renewable energy projects in Gujarat"

    async with AsyncSessionLocal() as session:
        search_run = SearchRun(
            id=search_run_id,
            query=query,
            parsed_query={"category": "Renewable Energy", "location": "Gujarat", "keywords": ["renewable"]},
            status="queued"
        )
        session.add(search_run)
        await session.commit()

    msg = QueueMessage(
        id="cf-msg-12345",
        body={
            "event_id": str(event_id),
            "search_run_id": str(search_run_id),
            "query": query,
            "parsed_query": {"category": "Renewable Energy", "location": "Gujarat", "keywords": ["renewable"]},
            "providers": ["mock_success"]
        },
        timestamp="2026-11-13T17:00:00Z",
        attempts=1
    )

    # First delivery: process message
    success_1 = await consumer.process_message(msg)
    assert success_1 is True

    # Check search run completed
    async with AsyncSessionLocal() as session:
        run = (await session.execute(select(SearchRun).where(SearchRun.id == search_run_id))).scalar_one()
        assert run.status == "completed"
        initial_results_count = run.results_count
        assert initial_results_count > 0

    # Second delivery (duplicate delivery with same event_id):
    success_2 = await consumer.process_message(msg)
    assert success_2 is True  # Acknowledged cleanly

    # Verify no duplicate search execution corrupted the result count
    async with AsyncSessionLocal() as session:
        run = (await session.execute(select(SearchRun).where(SearchRun.id == search_run_id))).scalar_one()
        assert run.results_count == initial_results_count
