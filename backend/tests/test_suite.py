import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone
import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

# Core & App imports
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.redis import redis_service
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_internal_api_key,
    verify_password,
)
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
from app.services.query_processor import query_processor
from app.services.ranker import project_ranker
from app.services.search_orchestrator import search_orchestrator
from app.services.sector_service import sector_service

# Consumer imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "consumer")))
from consumer import SearchJobConsumer
from queue_client import CloudflareQueueClient, QueueMessage


# ==============================================================================
# SECTION 1: CORE & AUTHENTICATION TESTS (7 tests)
# ==============================================================================

@pytest.mark.asyncio
async def test_root_endpoint(client):
    response = await client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == settings.APP_NAME
    assert data["status"] == "online"
    assert "X-Trace-Id" in response.headers
    assert "X-Response-Time" in response.headers


@pytest.mark.asyncio
async def test_health_endpoint(client):
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_readiness_endpoint(client):
    response = await client.get("/ready")
    assert response.status_code == 200
    data = response.json()
    assert "ready" in data
    assert "components" in data
    assert data["components"]["database"] == "connected"


def test_password_hashing():
    plain = "SuperSecurePassword123!"
    hashed = hash_password(plain)
    assert hashed != plain
    assert verify_password(plain, hashed) is True
    assert verify_password("WrongPassword", hashed) is False


def test_jwt_tokens():
    payload = {"sub": "user_123", "role": "admin"}
    token = create_access_token(payload)
    decoded = decode_token(token)
    assert decoded is not None
    assert decoded["sub"] == "user_123"
    assert decoded["role"] == "admin"
    assert decoded["type"] == "access"

    refresh = create_refresh_token(payload)
    decoded_refresh = decode_token(refresh)
    assert decoded_refresh is not None
    assert decoded_refresh["type"] == "refresh"


def test_internal_api_key_verification():
    assert verify_internal_api_key(settings.INTERNAL_API_KEY) is True
    assert verify_internal_api_key("invalid_key") is False
    assert verify_internal_api_key("") is False
    assert verify_internal_api_key(None) is False


@pytest.mark.asyncio
async def test_redis_service_operations():
    await redis_service.set("test_key", "test_val", ttl=60)
    val = await redis_service.get("test_key")
    assert val == "test_val"

    test_obj = {"query": "Solar projects in Gujarat", "count": 15}
    await redis_service.set_json("test_json", test_obj)
    retrieved = await redis_service.get_json("test_json")
    assert retrieved == test_obj

    progress = {"percent": 45, "step": "extracting"}
    await redis_service.set_search_progress("run_abc", progress)
    stored_progress = await redis_service.get_search_progress("run_abc")
    assert stored_progress == progress

    allowed_1 = await redis_service.check_rate_limit("user_ip", limit=2, window_seconds=60)
    allowed_2 = await redis_service.check_rate_limit("user_ip", limit=2, window_seconds=60)
    allowed_3 = await redis_service.check_rate_limit("user_ip", limit=2, window_seconds=60)
    assert allowed_1 is True
    assert allowed_2 is True
    assert allowed_3 is False

    await redis_service.delete("test_key")
    assert await redis_service.get("test_key") is None


# ==============================================================================
# SECTION 2: DATABASE MODELS & RELATIONS (5 tests)
# ==============================================================================

@pytest.mark.asyncio
async def test_user_and_search_run_relationship(setup_db):
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

        stmt = select(SearchRun).where(SearchRun.id == search_run.id)
        result = await session.execute(stmt)
        fetched_run = result.scalar_one()

        assert fetched_run.user_id == user.id
        assert fetched_run.query == "Upcoming data center projects in Hyderabad"
        assert fetched_run.parsed_query["category"] == "Data Center"


@pytest.mark.asyncio
async def test_project_and_sources(setup_db):
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

        proc = ProcessedMessage(
            event_id=event_id,
            search_run_id=search_run.id,
            consumer_id="consumer-node-01"
        )
        session.add(proc)
        await session.commit()

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
    async with AsyncSessionLocal() as session:
        search_run = SearchRun(query="Cascade test query", status="processing")
        session.add(search_run)
        await session.flush()

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

        await session.delete(search_run)
        await session.commit()

        event_check = (await session.execute(select(ActivityEvent).where(ActivityEvent.search_run_id == search_run.id))).all()
        usage_check = (await session.execute(select(APIUsage).where(APIUsage.search_run_id == search_run.id))).all()
        assert len(event_check) == 0
        assert len(usage_check) == 0


# ==============================================================================
# SECTION 3: GLOBAL PROJECTS & EXTRACTION (5 tests)
# ==============================================================================

def test_query_processor_global_locations():
    q_us = query_processor.process("Upcoming hyperscale data center projects in Northern Virginia")
    assert q_us["category"] == "Data Center"
    assert q_us["location"] == "Northern Virginia"

    q_eu = query_processor.process("Offshore wind farm projects in United Kingdom")
    assert q_eu["category"] == "Renewable Energy"
    assert q_eu["location"] == "United Kingdom"

    q_de = query_processor.process("Semiconductor fab construction in Dresden, Germany")
    assert q_de["category"] == "Semiconductor"
    assert q_de["location"] == "Germany"

    q_sa = query_processor.process("Solar power mega projects in Saudi Arabia")
    assert q_sa["category"] == "Solar Power"
    assert q_sa["location"] == "Saudi Arabia"

    q_my = query_processor.process("Data center developments in Johor, Malaysia")
    assert q_my["category"] == "Data Center"
    assert q_my["location"] in ("Johor", "Malaysia")

    q_global = query_processor.process("Global electric vehicle battery gigafactory projects")
    assert q_global["category"] == "EV & Battery"
    assert q_global["location"] == "Global"


def test_extract_usa_hyperscale_data_center():
    item = RawProviderResultItem(
        title="Microsoft announces $3.3 Billion AI Datacenter Campus in Mount Pleasant",
        url="https://news.microsoft.example.com/ai-datacenter",
        snippet="Microsoft has officially broken ground on a new $3.3 Billion hyperscale data center campus in Northern Virginia with over 300MW total capacity to power generative AI workloads.",
        published_date="2026-05-15T12:00:00Z"
    )
    cand = project_extractor.extract_candidate(item, provider_name="exa", default_category="Data Center")
    assert cand is not None
    assert "Microsoft" in cand.canonical_name
    assert cand.developer == "Microsoft"
    assert cand.location_country == "United States"
    assert cand.location_state == "Virginia"
    assert cand.investment_currency == "USD"
    assert cand.investment_value == 3_300_000_000.0
    assert cand.capacity_value == 300.0
    assert cand.capacity_unit == "MW"
    assert cand.status == "Under Construction"


def test_extract_europe_semiconductor_fab():
    item = RawProviderResultItem(
        title="TSMC breaks ground on €10 Billion Dresden Semiconductor Fab (ESMC)",
        url="https://eetimes.example.com/tsmc-dresden",
        snippet="TSMC in joint venture with Bosch, Infineon and NXP begins construction of a €10 Billion wafer fab in Dresden, Germany. The facility is expected to produce 40,000 300mm wafers per month.",
        published_date="2026-08-20T09:00:00Z"
    )
    cand = project_extractor.extract_candidate(item, provider_name="brave", default_category="Semiconductor")
    assert cand is not None
    assert "TSMC" in cand.canonical_name
    assert cand.developer == "TSMC"
    assert cand.location_city == "Dresden"
    assert cand.location_country == "Germany"
    assert cand.investment_currency == "EUR"
    assert cand.investment_value == 10_000_000_000.0
    assert cand.status == "Under Construction"


def test_extract_middle_east_solar_plant():
    item = RawProviderResultItem(
        title="ACWA Power unveils 1500MW Sudair Solar PV Plant in Riyadh",
        url="https://arabnews.example.com/acwa-sudair-solar",
        snippet="ACWA Power and the Public Investment Fund announced commercial operation of the 1,500 MW Sudair Solar project in Riyadh, Saudi Arabia, representing an investment of $924 Million.",
        published_date="2026-06-01T14:30:00Z"
    )
    cand = project_extractor.extract_candidate(item, provider_name="exa", default_category="Solar Power")
    assert cand is not None
    assert "ACWA Power" in cand.canonical_name
    assert cand.developer == "ACWA Power"
    assert cand.location_city == "Riyadh"
    assert cand.location_country == "Saudi Arabia"
    assert cand.capacity_value == 1500.0
    assert cand.capacity_unit == "MW"
    assert cand.investment_currency == "USD"
    assert cand.investment_value == 924_000_000.0
    assert cand.status == "Operational"


def test_global_ranking_and_relevance():
    item1 = RawProviderResultItem(
        title="Vantage Data Centers opens 100MW campus in Frankfurt, Germany",
        url="https://datacenterdynamics.example.com/vantage-frankfurt",
        snippet="Vantage Data Centers announced 100MW campus in Frankfurt, Germany."
    )
    item2 = RawProviderResultItem(
        title="NextEra Energy 250MW Solar Project in Florida",
        url="https://solar.example.com/nextera-florida",
        snippet="NextEra Energy 250MW solar plant in United States."
    )

    c1 = project_extractor.extract_candidate(item1, "exa", "Data Center")
    c2 = project_extractor.extract_candidate(item2, "brave", "Solar Power")

    deduped = project_deduplicator.deduplicate([c1, c2])
    assert len(deduped) == 2

    parsed_q = {
        "category": "Data Center",
        "location": "Germany",
        "keywords": ["data", "center", "frankfurt", "germany"]
    }
    ranked = project_ranker.rank(deduped, parsed_q)

    assert ranked[0].project.location_city == "Frankfurt"
    assert ranked[0].project.location_country == "Germany"
    assert ranked[0].relevance_score > ranked[1].relevance_score


# ==============================================================================
# SECTION 4: PROJECT REPOSITORY, ANALYTICS & SSE (3 tests)
# ==============================================================================

@pytest.mark.asyncio
async def test_project_repository_and_export(client, setup_db):
    async with AsyncSessionLocal() as session:
        p1 = Project(
            canonical_name="Microsoft Northern Virginia AI Data Center",
            normalized_name="microsoft northern virginia ai data center",
            category="Data Center",
            status="Under Construction",
            developer="Microsoft",
            location_city="Ashburn",
            location_state="Virginia",
            location_country="United States",
            investment_value=3300000000.0,
            investment_currency="USD",
            capacity_value=300.0,
            capacity_unit="MW"
        )
        p2 = Project(
            canonical_name="TSMC Dresden Wafer Fab ESMC",
            normalized_name="tsmc dresden wafer fab esmc",
            category="Semiconductor",
            status="Under Construction",
            developer="TSMC",
            location_city="Dresden",
            location_state="Saxony",
            location_country="Germany",
            investment_value=10000000000.0,
            investment_currency="EUR"
        )
        session.add_all([p1, p2])
        await session.commit()
        await session.refresh(p1)

        src1 = ProjectSource(
            project_id=p1.id,
            provider="exa",
            source_url="https://source.example.com/msft-nova",
            source_title="Microsoft breaks ground in Virginia"
        )
        session.add(src1)
        await session.commit()

    res = await client.get("/api/v1/projects")
    assert res.status_code == 200
    data = res.json()
    assert data["total"] == 2
    assert len(data["projects"]) == 2

    res_cat = await client.get("/api/v1/projects?category=Semiconductor")
    assert res_cat.status_code == 200
    assert res_cat.json()["total"] == 1
    assert res_cat.json()["projects"][0]["developer"] == "TSMC"

    res_loc = await client.get("/api/v1/projects?location=Germany")
    assert res_loc.status_code == 200
    assert res_loc.json()["total"] == 1

    res_detail = await client.get(f"/api/v1/projects/{p1.id}")
    assert res_detail.status_code == 200
    p_data = res_detail.json()
    assert p_data["canonical_name"] == p1.canonical_name
    assert len(p_data["sources"]) == 1
    assert p_data["sources"][0]["provider"] == "exa"

    res_csv = await client.get("/api/v1/projects/export")
    assert res_csv.status_code == 200
    assert "text/csv" in res_csv.headers["content-type"]
    assert "Microsoft Northern Virginia" in res_csv.text
    assert "TSMC Dresden" in res_csv.text


@pytest.mark.asyncio
async def test_analytics_and_system_health(client, setup_db):
    search_id = uuid.uuid4()
    async with AsyncSessionLocal() as session:
        run = SearchRun(id=search_id, query="Global solar projects", status="completed", results_count=5, total_duration_seconds=2.45)
        usage = APIUsage(
            search_run_id=search_id,
            provider="exa",
            endpoint="https://api.exa.ai/search",
            http_status=200,
            latency_ms=350.5,
            units_consumed=1
        )
        err = SystemError(
            component="test_worker",
            error_code="TEST_ERROR",
            message="Transient test failure",
            context={"retry": 1}
        )
        session.add_all([run, usage, err])
        await session.commit()

    usage_res = await client.get("/api/v1/analytics/usage")
    assert usage_res.status_code == 200
    u_data = usage_res.json()
    assert u_data["total_searches"] >= 1
    assert len(u_data["providers"]) >= 1
    assert u_data["providers"][0]["provider"] == "exa"
    assert u_data["providers"][0]["successful_requests"] == 1

    prov_res = await client.get("/api/v1/analytics/providers")
    assert prov_res.status_code == 200
    assert len(prov_res.json()["providers"]) >= 2

    perf_res = await client.get("/api/v1/analytics/search-performance")
    assert perf_res.status_code == 200
    assert perf_res.json()["total_completed_searches"] >= 1

    health_res = await client.get("/api/v1/analytics/system-health")
    assert health_res.status_code == 200
    h_data = health_res.json()
    assert h_data["database"] == "connected"
    assert h_data["recent_errors_count"] >= 1


@pytest.mark.asyncio
async def test_monitoring_endpoints(client, setup_db):
    search_id = uuid.uuid4()
    async with AsyncSessionLocal() as session:
        ev = ActivityEvent(
            search_run_id=search_id,
            event_type="provider_started",
            component="orchestrator",
            message="Started querying provider exa",
            metadata_={"provider": "exa"}
        )
        session.add(ev)
        await session.commit()

    events_res = await client.get("/api/v1/monitoring/events")
    assert events_res.status_code == 200
    events = events_res.json()
    assert len(events) >= 1
    assert events[0]["event_type"] == "provider_started"

    errors_res = await client.get("/api/v1/monitoring/errors")
    assert errors_res.status_code == 200


# ==============================================================================
# SECTION 5: SEARCH API & OUTBOX TRANSACTION (5 tests)
# ==============================================================================

def test_query_processor_data_center():
    res = query_processor.process("Upcoming hyperscale data center projects in Hyderabad")
    assert res["category"] == "Data Center"
    assert res["location"] == "Hyderabad"
    assert res["status"] == "Upcoming"
    assert "data" in res["keywords"] or "hyperscale" in res["keywords"]


def test_query_processor_solar_power():
    res = query_processor.process("Planned solar power projects in Telangana")
    assert res["category"] == "Solar Power"
    assert res["location"] == "Telangana"
    assert res["status"] == "Upcoming"


def test_sector_service_taxonomy_loaded():
    sectors = sector_service.get_all()
    assert len(sectors) == 462
    groups = sector_service.get_groups()
    assert "Batteries & Energy Storage" in groups
    assert "Chemicals & Petrochemicals" in groups
    assert "Power & Renewable Energy" in groups

    cathode = sector_service.get_by_name("Battery Cathode Material Production Plant")
    assert cathode is not None
    assert "cathode active materials" in cathode["definition"].lower()
    assert cathode["group"] == "Batteries & Energy Storage"

    urea = sector_service.get_by_name("Urea Plant")
    assert urea is not None
    assert "nitrogen fertilizer" in urea["definition"].lower()


def test_query_processor_with_primary_sectors():
    res1 = query_processor.process("Tesla battery cathode gigafactory in Nevada")
    assert res1["primary_sector"] == "Battery Cathode Material Production Plant"
    assert res1["primary_sector_group"] == "Batteries & Energy Storage"
    assert "cathode" in res1["primary_sector_definition"].lower()

    res2 = query_processor.process("New Urea plant expansion in Gujarat")
    assert res2["primary_sector"] == "Urea Plant"
    assert res2["primary_sector_group"] == "Chemicals & Petrochemicals"
    assert res2["location"] == "Gujarat"


def test_extractor_primary_sector_metadata():
    raw_item = RawProviderResultItem(
        title="Redwood Materials commences construction on massive Battery Cathode plant in Nevada",
        url="https://example.com/redwood-cathode-nevada",
        snippet="Redwood Materials announced the expansion of its battery cathode active material production plant with $3.5B investment.",
        published_date="2026-06-15T08:00:00Z"
    )
    candidate = project_extractor.extract_candidate(raw_item, provider_name="exa")
    assert candidate is not None
    assert candidate.category == "Battery Cathode Material Production Plant"
    assert candidate.metadata["primary_sector"] == "Battery Cathode Material Production Plant"
    assert "cathode" in candidate.metadata["primary_sector_definition"].lower()
    assert candidate.metadata["primary_sector_group"] == "Batteries & Energy Storage"


@pytest.mark.asyncio
async def test_create_search_run_and_outbox_transaction(client, setup_db):
    search_payload = {
        "query": "Upcoming data center projects in Hyderabad",
        "categories": ["Data Center"],
        "location": "Hyderabad",
        "providers": ["exa", "brave"]
    }

    response = await client.post("/api/v1/search", json=search_payload)
    assert response.status_code == 202
    data = response.json()
    assert "search_run_id" in data
    assert data["status"] == "queued"
    assert data["query"] == search_payload["query"]

    search_run_id = uuid.UUID(data["search_run_id"])

    async with AsyncSessionLocal() as session:
        run = (await session.execute(select(SearchRun).where(SearchRun.id == search_run_id))).scalar_one_or_none()
        assert run is not None
        assert run.query == search_payload["query"]
        assert run.status == "queued"

        outbox = (await session.execute(select(OutboxEvent).where(OutboxEvent.search_run_id == search_run_id))).scalar_one_or_none()
        assert outbox is not None
        assert outbox.status == "pending"
        assert outbox.event_type == "project_search_requested"
        assert outbox.payload["search_run_id"] == str(search_run_id)

        activity = (await session.execute(select(ActivityEvent).where(ActivityEvent.search_run_id == search_run_id))).scalar_one_or_none()
        assert activity is not None
        assert activity.event_type == "search_created"


@pytest.mark.asyncio
async def test_list_and_get_search_runs(client, setup_db):
    await client.post("/api/v1/search", json={"query": "Semiconductor fab projects in Gujarat"})
    await client.post("/api/v1/search", json={"query": "Offshore wind projects in Tamil Nadu"})

    list_res = await client.get("/api/v1/search")
    assert list_res.status_code == 200
    runs = list_res.json()
    assert len(runs) >= 2

    first_id = runs[0]["id"]
    get_res = await client.get(f"/api/v1/search/{first_id}")
    assert get_res.status_code == 200
    assert get_res.json()["id"] == first_id


@pytest.mark.asyncio
async def test_internal_outbox_workflow(client, setup_db):
    post_res = await client.post("/api/v1/search", json={"query": "Green hydrogen projects in India"})
    search_run_id = post_res.json()["search_run_id"]

    unauth_res = await client.post("/internal/v1/outbox/claim", json={"batch_size": 10})
    assert unauth_res.status_code == 401

    headers = {"X-Internal-Key": settings.INTERNAL_API_KEY}
    claim_res = await client.post("/internal/v1/outbox/claim", json={"batch_size": 10}, headers=headers)
    assert claim_res.status_code == 200
    claim_data = claim_res.json()
    assert claim_data["claimed_count"] >= 1

    claimed_event = next(ev for ev in claim_data["events"] if ev["search_run_id"] == search_run_id)
    event_id = claimed_event["event_id"]

    async with AsyncSessionLocal() as session:
        ev = (await session.execute(select(OutboxEvent).where(OutboxEvent.id == uuid.UUID(event_id)))).scalar_one()
        assert ev.status == "claimed"

    pub_res = await client.post(f"/internal/v1/outbox/{event_id}/published", headers=headers)
    assert pub_res.status_code == 200
    assert pub_res.json()["status"] == "published"
    assert pub_res.json()["published_at"] is not None

    async with AsyncSessionLocal() as session:
        ev = (await session.execute(select(OutboxEvent).where(OutboxEvent.id == uuid.UUID(event_id)))).scalar_one()
        assert ev.status == "published"
        assert ev.published_at is not None


# ==============================================================================
# SECTION 6: SEARCH INTEGRATIONS & CONSUMER IDEMPOTENCY (5 tests)
# ==============================================================================

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
    assert len(deduped) == 1
    assert len(deduped[0].sources) == 2


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

    res = await search_orchestrator.execute_search(
        search_run_id=search_run_id,
        query=query,
        parsed_query=parsed_query,
        requested_providers=["mock_success", "mock_fail"]
    )

    assert res["status"] == "partially_completed"
    assert res["results_count"] >= 1

    async with AsyncSessionLocal() as session:
        run = (await session.execute(select(SearchRun).where(SearchRun.id == search_run_id))).scalar_one()
        assert run.status == "partially_completed"
        assert run.results_count >= 1
        assert run.completed_at is not None

        results = (await session.execute(select(SearchResult).where(SearchResult.search_run_id == search_run_id))).scalars().all()
        assert len(results) >= 1

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

    success_1 = await consumer.process_message(msg)
    assert success_1 is True

    async with AsyncSessionLocal() as session:
        run = (await session.execute(select(SearchRun).where(SearchRun.id == search_run_id))).scalar_one()
        assert run.status == "completed"
        initial_results_count = run.results_count
        assert initial_results_count > 0

    success_2 = await consumer.process_message(msg)
    assert success_2 is True

    async with AsyncSessionLocal() as session:
        run = (await session.execute(select(SearchRun).where(SearchRun.id == search_run_id))).scalar_one()
        assert run.results_count == initial_results_count
