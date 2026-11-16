# Testing & Quality Assurance: Project Intelligence Platform

## Overview

The platform includes an extensive automated testing suite across backend services, database relational models, extraction logic, deduplication, transparent ranking, consumer idempotency, and frontend compilation.

Deterministic automated tests execute without calling paid external search APIs or requiring live cloud infrastructure.

---

## Test Suite Structure

```
backend/tests/
├── conftest.py                             # Async test fixtures, in-memory DB setup
├── test_phase1.py                          # Health probes, config, security, redis fallback
├── test_database_models.py                 # All 10 SQLAlchemy models, FKs, cascades, constraints
├── test_search_api_and_outbox.py           # Ingestion, 202 Accepted, transactional outbox
├── test_search_integrations_and_consumer.py# Mock providers, parallel execution, consumer idempotency
├── test_global_projects.py                 # Worldwide project extraction (US, Europe, Middle East, Asia)
└── test_projects_analytics_sse.py          # Project repo, CSV export, telemetry, SSE streams
```

---

## Running the Automated Test Suite

### 1. Run All Backend Tests
```bash
cd backend
python -m pytest -v
```

Expected output:
```
tests/test_database_models.py::test_user_and_search_run_relationship PASSED
tests/test_database_models.py::test_project_and_sources PASSED
tests/test_database_models.py::test_search_results_and_ranking PASSED
tests/test_database_models.py::test_outbox_and_idempotency_records PASSED
tests/test_database_models.py::test_cascade_delete_search_run PASSED
tests/test_global_projects.py::test_query_processor_global_locations PASSED
tests/test_global_projects.py::test_extract_usa_hyperscale_data_center PASSED
tests/test_global_projects.py::test_extract_europe_semiconductor_fab PASSED
tests/test_global_projects.py::test_extract_middle_east_solar_plant PASSED
tests/test_global_projects.py::test_global_ranking_and_relevance PASSED
tests/test_phase1.py::test_root_endpoint PASSED
tests/test_phase1.py::test_health_endpoint PASSED
tests/test_phase1.py::test_readiness_endpoint PASSED
tests/test_phase1.py::test_password_hashing PASSED
tests/test_phase1.py::test_jwt_tokens PASSED
tests/test_phase1.py::test_internal_api_key_verification PASSED
tests/test_phase1.py::test_redis_service_operations PASSED
tests/test_projects_analytics_sse.py::test_project_repository_and_export PASSED
tests/test_projects_analytics_sse.py::test_analytics_and_system_health PASSED
tests/test_projects_analytics_sse.py::test_monitoring_endpoints PASSED
tests/test_search_api_and_outbox.py::test_query_processor_data_center PASSED
tests/test_search_api_and_outbox.py::test_query_processor_solar_power PASSED
tests/test_search_api_and_outbox.py::test_create_search_run_and_outbox_transaction PASSED
tests/test_search_api_and_outbox.py::test_list_and_get_search_runs PASSED
tests/test_search_api_and_outbox.py::test_internal_outbox_workflow PASSED
tests/test_search_integrations_and_consumer.py::test_project_extractor_fields PASSED
tests/test_search_integrations_and_consumer.py::test_normalizer_and_deduplicator PASSED
tests/test_search_integrations_and_consumer.py::test_ranking_scoring PASSED
tests/test_search_integrations_and_consumer.py::test_search_orchestrator_partial_success PASSED
tests/test_search_integrations_and_consumer.py::test_consumer_idempotency_and_ack PASSED

============================= 30 passed in 1.62s ==============================
```

### 2. Verify Frontend Build & TypeScript Types
```bash
cd frontend
npm run build
```
Verifies that all TypeScript types, React Router routes, Lucide icons, and Recharts components compile without errors.

---

## Manual Integration Testing with Real Provider Credentials

To verify live queries against Exa AI and Brave Search APIs:
1. Copy `.env.example` to `.env`.
2. Populate `EXA_API_KEY` with your official key from [dashboard.exa.ai](https://dashboard.exa.ai).
3. Populate `SECOND_PROVIDER_API_KEY` with your key from [brave.com/search/api](https://brave.com/search/api).
4. Run:
```bash
cd backend
python -c "
import asyncio
from app.providers.exa_provider import ExaProvider

async def test_live_exa():
    p = ExaProvider()
    res = await p.search('Hyperscale data center projects in Northern Virginia')
    print('Exa Success:', res.success)
    print('Items found:', len(res.items))
    if res.items:
        print('Sample project:', res.items[0].title)

asyncio.run(test_live_exa())
"
```
