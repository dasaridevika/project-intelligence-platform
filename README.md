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
│   ├── tests/                     # 30 passing automated tests
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
├── docs/                          # Comprehensive technical specifications & guides
│   ├── ARCHITECTURE.md
│   ├── DATABASE_DESIGN.md
│   ├── API_DOCUMENTATION.md
│   ├── QUEUE_ARCHITECTURE.md
│   ├── DEPLOYMENT.md
│   ├── ENVIRONMENT_VARIABLES.md
│   ├── TESTING.md
│   ├── SECURITY.md
│   └── DEVELOPMENT_GUIDE.md
├── ARCHITECTURE_DECISIONS.md      # ADR-001 through ADR-008
├── DEVELOPMENT_PROGRESS.md        # Full project phase tracking
├── docker-compose.yml             # Unified local container orchestration
└── .env.example                   # Environment configuration template
```

---

## ⚡ Quickstart

### 1. Run Automated Tests
```bash
cd backend
python -m pytest -v
```
**30 passed** in under 3 seconds!

### 2. Build Frontend
```bash
cd frontend
npm install
npm run build
```
Produces optimized static bundle in `frontend/dist`.

### 3. Start Local Development Stack
```bash
# Terminal 1: Backend API
cd backend
uvicorn app.main:app --reload --port 8000

# Terminal 2: Background Consumer
cd consumer
python consumer.py

# Terminal 3: Frontend Dashboard
cd frontend
npm run dev
```
Open `http://localhost:5173` in your browser.

---

## 📄 Documentation Sitemap
- [System Architecture](file:///docs/ARCHITECTURE.md)
- [Database Relational Design & ERD](file:///docs/DATABASE_DESIGN.md)
- [API Documentation & Endpoints](file:///docs/API_DOCUMENTATION.md)
- [Queue Architecture & Idempotency](file:///docs/QUEUE_ARCHITECTURE.md)
- [Deployment Guide (Cloudflare + Cloud Run)](file:///docs/DEPLOYMENT.md)
- [Environment Variables Guide](file:///docs/ENVIRONMENT_VARIABLES.md)
- [Testing & Quality Assurance](file:///docs/TESTING.md)
- [Security Architecture](file:///docs/SECURITY.md)
- [Local Development Guide](file:///docs/DEVELOPMENT_GUIDE.md)
- [Architecture Decision Records](file:///ARCHITECTURE_DECISIONS.md)
- [Development Progress & Tracking](file:///DEVELOPMENT_PROGRESS.md)
