import uuid
import pytest
from app.core.database import AsyncSessionLocal
from app.models.analytics import ActivityEvent, APIUsage
from app.models.project import Project, ProjectSource, SearchResult
from app.models.search import SearchRun
from app.models.system import SystemError


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

    # 1. Test listing
    res = await client.get("/api/v1/projects")
    assert res.status_code == 200
    data = res.json()
    assert data["total"] == 2
    assert len(data["projects"]) == 2

    # 2. Test category filter
    res_cat = await client.get("/api/v1/projects?category=Semiconductor")
    assert res_cat.status_code == 200
    assert res_cat.json()["total"] == 1
    assert res_cat.json()["projects"][0]["developer"] == "TSMC"

    # 3. Test location filter
    res_loc = await client.get("/api/v1/projects?location=Germany")
    assert res_loc.status_code == 200
    assert res_loc.json()["total"] == 1

    # 4. Test project detail with sources
    res_detail = await client.get(f"/api/v1/projects/{p1.id}")
    assert res_detail.status_code == 200
    p_data = res_detail.json()
    assert p_data["canonical_name"] == p1.canonical_name
    assert len(p_data["sources"]) == 1
    assert p_data["sources"][0]["provider"] == "exa"

    # 5. Test CSV export
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

    # Test usage analytics
    usage_res = await client.get("/api/v1/analytics/usage")
    assert usage_res.status_code == 200
    u_data = usage_res.json()
    assert u_data["total_searches"] >= 1
    assert len(u_data["providers"]) >= 1
    assert u_data["providers"][0]["provider"] == "exa"
    assert u_data["providers"][0]["successful_requests"] == 1

    # Test providers configuration endpoint
    prov_res = await client.get("/api/v1/analytics/providers")
    assert prov_res.status_code == 200
    assert len(prov_res.json()["providers"]) >= 2

    # Test search performance
    perf_res = await client.get("/api/v1/analytics/search-performance")
    assert perf_res.status_code == 200
    assert perf_res.json()["total_completed_searches"] >= 1

    # Test system health
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
