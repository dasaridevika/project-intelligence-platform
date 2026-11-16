# Architecture Decision Records (ADR)
## Project Intelligence Platform

### ADR-001: Separate Decoupled Container Deployment for FastAPI and Python Queue Consumer
- **Status**: Accepted
- **Context**: The platform must process long-running project searches asynchronously without holding HTTP connections open or blocking the web API.
- **Decision**: FastAPI acts strictly as the web API and ingestion layer (returning `202 Accepted`). Search processing is handled by an independently deployable Python Pull Consumer that pulls messages from Cloudflare Queues.
- **Consequences**: FastAPI instances scale with API traffic; consumer containers scale independently with job queue backlog. Neither process shares in-memory state.

### ADR-002: Transactional Outbox Pattern via PostgreSQL
- **Status**: Accepted
- **Context**: A dual-write hazard exists if FastAPI attempts to both commit a `search_run` to PostgreSQL and push to Cloudflare Queues directly in the HTTP request. If queue publishing fails or times out after DB commit, searches become orphaned.
- **Decision**: Every search request commits `search_runs` and `outbox_events` within the same ACID PostgreSQL transaction. A scheduled worker claims unpublished events and dispatches them to Cloudflare Queues.
- **Consequences**: Guarantees at-least-once message delivery into Cloudflare Queues with no lost searches. Requires the Python consumer to be idempotent.

### ADR-003: Idempotent Processing via `processed_messages` Table
- **Status**: Accepted
- **Context**: Cloudflare Queues provides at-least-once delivery; network retries or worker crashes can deliver duplicate messages.
- **Decision**: The Python consumer records incoming message IDs and event UUIDs in a dedicated `processed_messages` table within a serializable/locking transaction before executing provider workflows. Duplicate deliveries are acknowledged and skipped cleanly.
- **Consequences**: Zero duplicate project records or duplicate search runs caused by message redelivery.

### ADR-004: Dual-Engine Async Database & Test Strategy
- **Status**: Accepted
- **Context**: Production uses managed PostgreSQL (`asyncpg`), but local environments and continuous integration tests need to run deterministic automated suites even when external cloud databases are being provisioned or are offline.
- **Decision**: SQLAlchemy 2.0 async engine is parameterized via configuration. The application natively supports PostgreSQL in staging/production, while automated test suites execute against SQLite (with foreign keys and JSON support enabled) or PostgreSQL if configured.
- **Consequences**: All unit, API, extraction, deduplication, and integration tests can execute reliably in offline and CI environments.

### ADR-005: Independent Provider Adapter Interface & Registry
- **Status**: Accepted
- **Context**: External search providers (Exa, Brave, Tavily, Serper) have completely different query endpoints, response schemas, and error codes.
- **Decision**: All providers implement `BaseSearchProvider` with unified methods: `search()`, `parse_results()`, `get_usage()`, and error classification. A provider registry allows dynamic provider enablement, fallback, and parallel execution.
- **Consequences**: Adding new search providers requires only implementing the adapter interface without altering orchestration or extraction logic.

### ADR-006: Cloudflare Worker Gateway for Edge Routing, Rate Limiting, and CORS
- **Status**: Accepted
- **Context**: Frontend clients need low-latency edge routing, global rate-limiting, and centralized secret shielding.
- **Decision**: Cloudflare Workers acts as the API Gateway, handling CORS, injecting trace IDs, validating edge rate limits, and proxying requests to the backend container.
- **Consequences**: Backend containers are protected from DDoS and abuse; internal secrets and database credentials remain strictly within container environments.

### ADR-007: Server-Sent Events (SSE) for Real-Time Execution Monitoring
- **Status**: Accepted
- **Context**: Users need immediate visibility into search progress (provider calls, extraction, normalization, deduplication) without heavy WebSocket connection overhead.
- **Decision**: Implement SSE endpoints (`/api/v1/search/{search_id}/events`) with client reconnection support via last event IDs. Events are backed by PostgreSQL `activity_events` and Redis pub/sub.
- **Consequences**: Browser clients receive instant timeline updates through standard HTTP/2, with clean fallback and replay capabilities.

### ADR-008: Global Project Discovery, Multi-Currency, and Worldwide Geography Support
- **Status**: Accepted
- **Context**: The platform must support capital project discovery internationally, covering data centers, semiconductors, renewable energy, and infrastructure across North America, Europe, Asia-Pacific, the Middle East, Latin America, and Africa.
- **Decision**: Remove hardcoded geographic constraints. Support multi-currency extraction (USD, EUR, GBP, JPY, AUD, CAD, SGD, AED, SAR, INR), global developer directories, multi-country and international hub resolution (e.g., Northern Virginia, Frankfurt, Dublin, Tokyo, Riyadh, London, Phoenix), and generic worldwide taxonomy.
- **Consequences**: Enables natural-language discovery and structured normalization for capital projects anywhere in the world.
