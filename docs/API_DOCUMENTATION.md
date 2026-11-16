# API Documentation: Project Intelligence Platform

## Base URLs
- Local Direct Backend: `http://localhost:8000`
- Cloudflare Gateway: `https://project-intelligence.workers.dev`

All API endpoints are versioned under `/api/v1` except health probes (`/health`, `/ready`) and internal publisher endpoints (`/internal/v1/*`).

---

## Authentication Endpoints

### 1. `POST /api/v1/auth/login`
Authenticates a user and issues JWT access and refresh tokens.

**Request Body:**
```json
{
  "email": "architect@enterprise.com",
  "password": "SecurePassword123!"
}
```

**Response (200 OK):**
```json
{
  "access_token": "eyJhbGciOi...",
  "refresh_token": "eyJhbGciOi...",
  "token_type": "bearer",
  "user_id": "766579fe-3714-41d6-b8cb-4ee5ad6b5c39",
  "email": "architect@enterprise.com",
  "role": "admin",
  "full_name": "Principal Architect"
}
```

### 2. `POST /api/v1/auth/refresh`
Refreshes an expired access token using a valid refresh token.

---

## Discovery & Search Endpoints

### 3. `POST /api/v1/search`
Submits a natural-language discovery query. Transactionally persists `search_runs` and `outbox_events` and returns `202 Accepted` immediately.

**Request Body:**
```json
{
  "query": "Upcoming hyperscale data center projects in Northern Virginia",
  "categories": ["Data Center"],
  "location": "Northern Virginia",
  "providers": ["exa", "brave"]
}
```

**Response (202 Accepted):**
```json
{
  "search_run_id": "87e35b71-12f7-41ab-8547-07469a744432",
  "status": "queued",
  "query": "Upcoming hyperscale data center projects in Northern Virginia",
  "created_at": "2026-11-16T10:30:00Z",
  "message": "Search request accepted for background processing"
}
```

### 4. `GET /api/v1/search/{search_id}/events`
Server-Sent Events (SSE) stream for live real-time execution updates and progress tracking. Supports `Last-Event-ID` header.

**Stream Event Sample:**
```
id: 5f984a9e-8c3b-4171-bc01-e25df963ad76
event: provider_completed
data: {"event_id": "5f984a9e-...", "search_run_id": "87e35b71-...", "component": "exa", "message": "Provider 'exa' returned 18 candidate sources in 240ms", "timestamp": "2026-11-16T10:30:03Z"}

: ping
```

### 5. `GET /api/v1/search/{search_id}`
Retrieves search run metadata, duration, yield count, and status (`queued`, `processing`, `completed`, `partially_completed`, `failed`).

### 6. `GET /api/v1/search/{search_id}/results`
Retrieves deduplicated, ranked project results discovered by the search run.

**Response (200 OK):**
```json
{
  "search_run_id": "87e35b71-12f7-41ab-8547-07469a744432",
  "query": "Upcoming hyperscale data center projects in Northern Virginia",
  "status": "completed",
  "total_results": 1,
  "results": [
    {
      "project_id": "bc115b92-4f32-4467-96a9-e85d9c72e90f",
      "canonical_name": "Microsoft Northern Virginia AI Data Center Campus",
      "category": "Data Center",
      "status": "Under Construction",
      "developer": "Microsoft",
      "location_city": "Ashburn",
      "location_state": "Virginia",
      "location_country": "United States",
      "investment_value": 3300000000.0,
      "investment_currency": "USD",
      "capacity_value": 300.0,
      "capacity_unit": "MW",
      "relevance_score": 0.9450,
      "ranking_factors": {
        "query_keyword_match": 1.0,
        "location_match": 1.0,
        "category_match": 1.0,
        "information_completeness": 1.0,
        "source_verification": 0.67
      },
      "sources": [
        {
          "id": "e2e92c4b-8521-4fa2-bf4b-e85df6498a99",
          "provider": "exa",
          "source_url": "https://news.microsoft.example.com/ai-dc-nova",
          "source_title": "Microsoft breaks ground on $3.3B campus in Virginia",
          "publication_date": "2026-05-15T12:00:00Z"
        }
      ]
    }
  ]
}
```

---

## Project Repository Endpoints

### 7. `GET /api/v1/projects`
Search and filter the permanent project repository.
- Query Parameters: `category`, `location`, `status`, `developer`, `search`, `page`, `page_size`, `sort_by`, `sort_order`.

### 8. `GET /api/v1/projects/{project_id}`
Returns complete structured project data, capacity, capex, description, and multi-source provenance records.

### 9. `GET /api/v1/projects/export`
Exports project repository to CSV format (`Content-Type: text/csv`).

---

## Analytics & Monitoring Endpoints

### 10. `GET /api/v1/analytics/usage`
Telemetry tracking total requests, success rates, avg latency, min/max latency, and units consumed per provider.

### 11. `GET /api/v1/analytics/providers`
Returns provider adapter configurations and status flags without exposing API keys.

### 12. `GET /api/v1/analytics/search-performance`
Aggregates average and P95 search duration, and status counts.

### 13. `GET /api/v1/analytics/system-health`
Real-time operational health: PostgreSQL connectivity, Redis cache fallback status, active jobs, pending outbox events, and error counts.

### 14. `GET /api/v1/monitoring/events`
Live operational event stream for system activity feed.

### 15. `GET /api/v1/monitoring/errors`
Diagnostic error traces.

---

## Internal Publisher Endpoints (Service Auth Required)

Protected via header: `X-Internal-Key: <INTERNAL_API_KEY>`

### 16. `POST /internal/v1/outbox/claim`
Claims pending transactional outbox events using `FOR UPDATE SKIP LOCKED`.

### 17. `POST /internal/v1/outbox/{event_id}/published`
Confirms publication to message queue and updates status to `published`.
