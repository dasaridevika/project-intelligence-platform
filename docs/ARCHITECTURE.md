# System Architecture: Project Intelligence Platform

## Executive Summary

The **Project Intelligence Platform** is an enterprise-grade AI-powered project discovery and intelligence application. It accepts natural-language discovery queries (e.g. *"Upcoming data center projects in India"*, *"Renewable energy projects in Telangana"*), coordinates parallel external search queries across Exa and configurable secondary providers, extracts structured project specifications, normalizes entities, deduplicates records, computes transparent relevance scores, and persists high-fidelity project data into managed PostgreSQL.

The platform provides full operational observability: real-time search execution timelines via Server-Sent Events (SSE), API provider latency and failure metrics, transactional outbox delivery guarantees, and health monitoring.

---

## High-Level Architecture Diagram

```mermaid
flowchart TD
    subgraph ClientLayer ["Client Layer (Edge & Browser)"]
        UserBrowser["User Browser (React + Vite + Tailwind)"]
        CFStatic["Cloudflare Static Assets (CDN)"]
        UserBrowser -->|Fetch Static Bundle| CFStatic
    end

    subgraph EdgeGateway ["Cloudflare Edge Infrastructure"]
        CFGateway["Cloudflare Worker API Gateway\n- Edge Rate Limiting\n- CORS Enforcement\n- Trace ID Injection\n- Path Routing"]
        CFScheduler["Scheduled Outbox Worker\n(Runs every 5-10s)"]
        CFQueue["Cloudflare Queues\n(project-search-jobs)"]
        CFDLQ["Dead-Letter Queue (DLQ)\n(project-search-jobs-dlq)"]
    end

    subgraph BackendServices ["Backend Compute (Cloud Run / Containers)"]
        FastAPIService["FastAPI Service (Web API)\n- Auth & RBAC (JWT)\n- Ingestion (POST 202 Accepted)\n- Transactional Outbox Creation\n- SSE Live Event Streaming\n- Repository & Analytics APIs"]
        PythonConsumer["Python Pull Consumer\n- Cloudflare Queue Poller\n- Idempotency via processed_messages\n- Search Orchestrator\n- Extraction & Normalization\n- Deduplication & Ranking\n- Durable DB Commit & ACK"]
    end

    subgraph StorageLayer ["Persistence & Caching"]
        PostgresDB[("Managed PostgreSQL\n(Permanent Source of Truth)\n- users, search_runs, projects\n- project_sources, search_results\n- api_usage, activity_events\n- outbox_events, processed_messages\n- system_errors")]
        RedisCache[("Managed Redis\n- Search Query Cache\n- SSE Pub/Sub & Progress\n- Rate Limit Tokens")]
    end

    subgraph ExternalProviders ["External Search APIs"]
        ExaAPI["Exa Neural Search API\n(Official API)"]
        SecondProvider["Secondary Search Provider\n(Configurable: Brave / Tavily / Serper)"]
    end

    %% Client and Edge connections
    UserBrowser -->|HTTPS API Requests| CFGateway
    CFGateway -->|Secure Forwarding + Trace ID| FastAPIService
    UserBrowser -->|SSE Stream: /api/v1/search/{id}/events| FastAPIService

    %% Outbox Loop
    FastAPIService -->|Write Search + Outbox atomically| PostgresDB
    CFScheduler -->|Claim Pending Events (/internal/v1/outbox/claim)| FastAPIService
    CFScheduler -->|Push Event| CFQueue
    CFScheduler -->|Mark Published (/internal/v1/outbox/{id}/published)| FastAPIService

    %% Queue Processing Loop
    PythonConsumer -->|Pull Batch Messages| CFQueue
    PythonConsumer -->|Idempotency Check & Commit Results| PostgresDB
    PythonConsumer -->|Update Progress & Publish SSE Events| RedisCache
    FastAPIService -->|Read Progress / Cache| RedisCache
    PythonConsumer -->|Excess Retries| CFDLQ
    PythonConsumer -->|Ack Message (Post-Commit)| CFQueue

    %% External Provider Calls
    PythonConsumer -->|Parallel Query| ExaAPI
    PythonConsumer -->|Parallel Query| SecondProvider
```

---

## Component Responsibilities

### 1. Frontend (React 19 + TypeScript + Vite + Tailwind CSS)
- **Role**: Clean enterprise dashboard inspired by modern SaaS analytics platforms.
- **Key Modules**:
  - Search workspace with live execution timeline.
  - Interactive project repository with filtering, sorting, and CSV export.
  - Project detail drilldown with multi-source provenance.
  - API usage and latency analytics with Recharts visualizations.
  - System health, queue status, and active worker monitoring.

### 2. Cloudflare Worker API Gateway
- Edge termination of client requests.
- Validates CORS policies.
- Injects `X-Trace-Id` and `X-Correlation-Id` for distributed tracing.
- Enforces edge rate limits.
- Proxies requests to backend containers securely, shielding origin IPs and database ports.

### 3. FastAPI Core Service
- **Authentication**: JWT access and refresh tokens, Argon2/bcrypt password hashing, RBAC (Admin, User).
- **Ingestion**: Accepts natural-language query, validates input, writes `search_runs` and `outbox_events` within a single PostgreSQL ACID transaction, returns `202 Accepted` with `search_run_id`.
- **Live Monitoring**: Serves Server-Sent Events (`/api/v1/search/{id}/events`) with replay capability.
- **Internal APIs**: Authenticated endpoints (`/internal/v1/outbox/*`) for scheduled Cloudflare publishers.

### 4. Scheduled Outbox Publisher
- Cloudflare Scheduled Worker executing on cron or micro-intervals.
- Claims batches of pending outbox events using PostgreSQL row locking (`FOR UPDATE SKIP LOCKED`).
- Dispatches messages to Cloudflare Queues and marks them published.

### 5. Python Pull Consumer
- Long-running worker container.
- Polls Cloudflare Queues with adaptive backoff to prevent busy loops.
- Enforces message idempotency via `processed_messages`.
- Runs query analysis, invokes provider adapters concurrently with timeouts and exponential backoff.
- Executes entity extraction, normalization, deduplication, and ranking.
- Commits results into PostgreSQL and emits progress events before acknowledging the queue message.

### 6. Persistence & Caching
- **Managed PostgreSQL**: Relational source of truth with strict foreign keys, unique constraints, and TIMESTAMPTZ timestamps.
- **Managed Redis**: Query response cache with TTLs, live search progress buffers, and rate-limiting counters.
