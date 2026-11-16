import uuid
import pytest
from sqlalchemy import select
from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.analytics import ActivityEvent
from app.models.outbox import OutboxEvent
from app.models.search import SearchRun
from app.services.query_processor import query_processor


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

    # Verify atomic database persistence
    async with AsyncSessionLocal() as session:
        # SearchRun check
        run = (await session.execute(select(SearchRun).where(SearchRun.id == search_run_id))).scalar_one_or_none()
        assert run is not None
        assert run.query == search_payload["query"]
        assert run.status == "queued"

        # OutboxEvent check
        outbox = (await session.execute(select(OutboxEvent).where(OutboxEvent.search_run_id == search_run_id))).scalar_one_or_none()
        assert outbox is not None
        assert outbox.status == "pending"
        assert outbox.event_type == "project_search_requested"
        assert outbox.payload["search_run_id"] == str(search_run_id)

        # Initial ActivityEvent check
        activity = (await session.execute(select(ActivityEvent).where(ActivityEvent.search_run_id == search_run_id))).scalar_one_or_none()
        assert activity is not None
        assert activity.event_type == "search_created"


@pytest.mark.asyncio
async def test_list_and_get_search_runs(client, setup_db):
    # Create two searches
    await client.post("/api/v1/search", json={"query": "Semiconductor fab projects in Gujarat"})
    await client.post("/api/v1/search", json={"query": "Offshore wind projects in Tamil Nadu"})

    list_res = await client.get("/api/v1/search")
    assert list_res.status_code == 200
    runs = list_res.json()
    assert len(runs) >= 2

    # Get single search run
    first_id = runs[0]["id"]
    get_res = await client.get(f"/api/v1/search/{first_id}")
    assert get_res.status_code == 200
    assert get_res.json()["id"] == first_id


@pytest.mark.asyncio
async def test_internal_outbox_workflow(client, setup_db):
    # Step 1: Create a search
    post_res = await client.post("/api/v1/search", json={"query": "Green hydrogen projects in India"})
    search_run_id = post_res.json()["search_run_id"]

    # Step 2: Test internal claim without header -> must fail 401
    unauth_res = await client.post("/internal/v1/outbox/claim", json={"batch_size": 10})
    assert unauth_res.status_code == 401

    # Step 3: Test claim with valid header -> must succeed
    headers = {"X-Internal-Key": settings.INTERNAL_API_KEY}
    claim_res = await client.post("/internal/v1/outbox/claim", json={"batch_size": 10}, headers=headers)
    assert claim_res.status_code == 200
    claim_data = claim_res.json()
    assert claim_data["claimed_count"] >= 1

    claimed_event = next(ev for ev in claim_data["events"] if ev["search_run_id"] == search_run_id)
    event_id = claimed_event["event_id"]

    # Verify status changed to 'claimed' in DB
    async with AsyncSessionLocal() as session:
        ev = (await session.execute(select(OutboxEvent).where(OutboxEvent.id == uuid.UUID(event_id)))).scalar_one()
        assert ev.status == "claimed"

    # Step 4: Confirm publication
    pub_res = await client.post(f"/internal/v1/outbox/{event_id}/published", headers=headers)
    assert pub_res.status_code == 200
    assert pub_res.json()["status"] == "published"
    assert pub_res.json()["published_at"] is not None

    # Verify status changed to 'published' in DB
    async with AsyncSessionLocal() as session:
        ev = (await session.execute(select(OutboxEvent).where(OutboxEvent.id == uuid.UUID(event_id)))).scalar_one()
        assert ev.status == "published"
        assert ev.published_at is not None
