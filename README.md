# Project Intelligence Platform

> **Enterprise AI-Powered Global Project Discovery & Intelligence Application**
> Built with **React 18 + TypeScript + Cloudflare Workers + FastAPI + Cloudflare Queues + Python Pull Consumer + Managed PostgreSQL + Managed Redis + Exa AI + Configurable Web Providers**

---

## 🌟 Executive Overview

The **Project Intelligence Platform** is a production-grade capital projects discovery engine. It accepts natural-language discovery queries for capital projects anywhere in the world—including **hyperscale data centers, semiconductor fabs, solar mega-parks, offshore wind developments, gigafactories, and massive infrastructure corridors** across **North America, Europe, Asia-Pacific, the Middle East, Latin America, and Africa**.

The platform orchestrates parallel search queries across **Exa AI Neural Search** and secondary search providers (e.g. **Brave Web Search**), parses source content without hallucinating missing data, normalizes multi-currency financial valuations and capacities, deduplicates records into canonical projects with complete evidentiary provenance, ranks results with transparent scoring, and persists high-fidelity records into managed **PostgreSQL**.

Live search execution is streamed directly to browser clients using **Server-Sent Events (SSE)**.

---

## 🏗️ Architecture Highlights

- **Edge & Gateway Layer**: Cloudflare Workers API Gateway provides low-latency edge routing, rate limiting, CORS configuration, and serves React Static Assets.
- **Transactional Outbox Delivery**: When a user submits a search, FastAPI atomically records `search_runs` and `outbox_events` in the same PostgreSQL ACID transaction and returns `HTTP 202 Accepted` immediately.
- **Background Queue Processing**: A Scheduled Cloudflare Worker claims outbox events and dispatches them to **Cloudflare Queues**. A separately deployable **Python Pull Consumer** pulls batches, enforces idempotency via `processed_messages`, executes the search pipeline, and only acknowledges messages post-commit.
- **462 Primary Sector Taxonomy & Definitions**: Complete integration of 462 canonical capital project sectors with official definitions, searchable taxonomy APIs (`/api/v1/sectors`), NLP query expansion, and interactive frontend definition cards.
- **Global Multi-Currency Extraction**: Automatic extraction and normalization of projects in USD, EUR, GBP, JPY, AUD, CAD, SGD, AED, SAR, and INR.
- **Real-Time Observability**: Fine-grained `activity_events`, provider latency metrics, error tracking, and system health monitoring.

```mermaid
flowchart TD
    User["Client Browser (React + Vite + Tailwind)"] -->|HTTPS| Gateway["Cloudflare Worker API Gateway"]
    Gateway -->|Static Assets| CDN["Cloudflare Edge CDN"]
    Gateway -->|API Routing + Trace ID| API["FastAPI Container (Cloud Run)"]

    API -->|Atomic Write: search_runs + outbox_events| DB[("Managed PostgreSQL")]
    Scheduler["Cloudflare Scheduled Worker"] -->|Claim Outbox Events| API
    Scheduler -->|Push Messages| Queue["Cloudflare Queues (project-search-jobs)"]

    Consumer["Python Pull Consumer (Cloud Run)"] -->|Pull Messages| Queue
    Consumer -->|Idempotency Check| DB
    Consumer -->|Parallel Semantic Query| Exa["Exa Neural Search API"]
    Consumer -->|Parallel Web Query| SecondProv["Secondary Search Provider"]
    Consumer -->|Deduplicate & Persist Results| DB
    Consumer -->|Update Progress & Cache| Redis[("Managed Redis Cache")]
    Consumer -->|Ack Message (Post-Commit)| Queue

    User -->|SSE Live Stream: /api/v1/search/{id}/events| API
```

---

## 📁 Repository Structure

```
project-intelligence-platform/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── v1/                # Auth, Search, Projects, Analytics, Monitoring
│   │   │   └── internal/          # Outbox claiming & publication confirmation
│   │   ├── core/                  # Config, Database engine, Redis service, Security, Logging
│   │   ├── models/                # 10 SQLAlchemy 2.x relational models
│   │   ├── schemas/               # Strict Pydantic v2 schemas
│   │   ├── providers/             # ExaProvider, ConfigurableSearchProvider, ProviderRegistry
│   │   ├── services/              # QueryProcessor, Extractor, Normalizer, Deduplicator, Ranker, Orchestrator
│   │   └── main.py                # FastAPI ASGI application & middleware
│   ├── alembic/                   # Alembic database migrations (001_initial_schema.py)
│   ├── tests/                     # 33 passing automated tests
│   ├── requirements.txt           # Python dependencies
│   └── Dockerfile                 # Production ASGI container image
├── consumer/
│   ├── consumer.py                # Long-running Python Pull Consumer
│   ├── queue_client.py            # Cloudflare Queues Pull client & simulation fallback
│   └── Dockerfile                 # Container image for worker pool
├── cloudflare/
│   ├── gateway/                   # Cloudflare Worker API Gateway + Static Assets
│   └── scheduler/                 # Cloudflare Scheduled Worker Outbox Publisher
├── frontend/
│   ├── src/
│   │   ├── components/            # Layout, Sidebar, Header
│   │   ├── pages/                 # 8 Full Enterprise Pages
│   │   ├── services/              # API Client (Axios), SSE Stream Subscriber
│   │   ├── types/                 # Comprehensive TypeScript definitions
│   │   └── App.tsx                # React Router routing
│   ├── package.json
│   ├── vite.config.ts
│   └── tailwind.config.js
├── scripts/                           # Single-click deployment and startup scripts
├── docker-compose.yml                 # Unified local container orchestration
├── railway.json                       # Zero-config Railway production deployment
└── .env.example                       # Environment configuration template
```

---

## ⚡ Quick Start

### 1. Run Automated Test Suite
```bash
cd backend
pytest tests/test_suite.py -v
```
All 30 unit, integration, and scenario tests pass in under 3 seconds.

### 2. Run Local Development (No Docker Required)
The platform is designed to run self-contained on local SQLite with an automatic in-memory fallback cache:

```powershell
# Start Backend API (FastAPI on http://localhost:8000)
powershell -ExecutionPolicy Bypass -File .\scripts\start-backend.ps1

# Start Frontend UI (Vite dev server on http://localhost:5173)
powershell -ExecutionPolicy Bypass -File .\scripts\start-frontend.ps1
```

### 3. Deploy to Cloudflare Edge
Deploy frontend static assets, API gateway worker, and background queues:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-cloudflare.ps1
```

---

## 🗄️ Database & Production Deployment (Railway)

- **Local Execution**: Uses `sqlite+aiosqlite:///./project_intelligence.db` automatically with zero external dependencies.
- **Production (Railway)**: When ready to connect Railway PostgreSQL and Redis, simply provide your connection URLs in `.env`:
  ```ini
  DATABASE_URL=postgresql://postgres:password@roundhouse.proxy.rlwy.net:12345/railway
  REDIS_URL=redis://default:password@roundhouse.proxy.rlwy.net:54321
  ```
  Then run `alembic upgrade head` once. The engine automatically enables connection pooling (`pool_size=20`) and distributed Redis caching.
