# Queue Architecture & Background Processing
## Project Intelligence Platform

## Overview

The Project Intelligence Platform implements an asynchronous, distributed pipeline utilizing the **PostgreSQL Transactional Outbox Pattern** combined with **Cloudflare Queues** and a **Python Pull Consumer**.

---

## Architecture Flow Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Client as User / Browser
    participant API as FastAPI Ingestion
    participant DB as PostgreSQL
    participant Scheduler as Cloudflare Outbox Publisher
    participant CFQ as Cloudflare Queue (project-search-jobs)
    participant DLQ as Cloudflare DLQ (project-search-jobs-dlq)
    participant Consumer as Python Pull Consumer
    participant Providers as Exa & Secondary Providers

    Client->>API: POST /api/v1/search (query)
    Note over API,DB: Single ACID Transaction
    API->>DB: INSERT INTO search_runs (status='queued')
    API->>DB: INSERT INTO outbox_events (status='pending')
    API->>DB: INSERT INTO activity_events (event_type='search_created')
    API-->>Client: HTTP 202 Accepted (search_run_id)

    loop Scheduled Cron (every 5s)
        Scheduler->>API: POST /internal/v1/outbox/claim
        API->>DB: SELECT FOR UPDATE SKIP LOCKED status='pending'
        API->>DB: UPDATE outbox_events SET status='claimed'
        API-->>Scheduler: List of claimed events
        loop For each event
            Scheduler->>CFQ: send(payload)
            Scheduler->>API: POST /internal/v1/outbox/{event_id}/published
            API->>DB: UPDATE outbox_events SET status='published'
        end
    end

    loop Consumer Adaptive Polling
        Consumer->>CFQ: pull_messages(batch_size=10, timeout=60s)
        CFQ-->>Consumer: Batch [messages]
        Consumer->>DB: Check & INSERT INTO processed_messages (event_id)
        alt Message Already Processed (Duplicate)
            Consumer->>CFQ: ack_message() (Skip duplicate execution)
        else Fresh Message
            Consumer->>Providers: Execute Search (Exa + Secondary Provider)
            Consumer->>DB: INSERT extracted & normalized projects, project_sources, search_results
            Consumer->>DB: INSERT api_usage, activity_events
            Consumer->>DB: UPDATE search_runs SET status='completed'
            Consumer->>DB: COMMIT Transaction
            Consumer->>CFQ: ack_message() (Only after DB Commit)
        else Retries Exceeded (> 3)
            Consumer->>DLQ: Route to Dead-Letter Queue
            Consumer->>DB: INSERT INTO system_errors
            Consumer->>CFQ: ack_message()
        end
    end
```

---

## Message Contract (Schema Version 1)

All messages published to `project-search-jobs` follow this strict versioned JSON envelope:

```json
{
  "event_id": "b3f0df68-c1fa-4cb5-bf99-231a473ee16a",
  "event_type": "project_search_requested",
  "schema_version": 1,
  "search_run_id": "87e35b71-12f7-41ab-8547-07469a744432",
  "trace_id": "9d487f54-d8bc-467a-a43b-481cf1317df8",
  "query": "Upcoming hyperscale data center projects in India",
  "parsed_query": {
    "category": "Data Center",
    "location": "India",
    "status": "Upcoming",
    "keywords": ["data center", "hyperscale", "upcoming", "india"],
    "search_intent": "project_discovery"
  },
  "providers": ["exa", "brave"],
  "created_at": "2026-11-13T16:30:00Z"
}
```

---

## Cloudflare Queue Configuration (`wrangler.jsonc`)

### 1. Main Search Queue
- **Name**: `project-search-jobs`
- **Max Batch Size**: 10 messages
- **Max Batch Timeout**: 5 seconds
- **Message Retention**: 4 days (345,600 seconds)
- **Max Retries**: 3 attempts before Dead-Letter Queue routing

### 2. Dead-Letter Queue (DLQ)
- **Name**: `project-search-jobs-dlq`
- **Message Retention**: 14 days
- **Purpose**: Diagnostic quarantine for payloads that repeatedly fail validation, database connectivity, or provider execution.

---

## Idempotency Controls & Safe At-Least-Once Delivery

Because distributed message brokers provide at-least-once delivery, duplicate messages can be delivered upon network partitions or consumer restarts.

To prevent duplicate results or corrupted search status:
1. **`processed_messages` Table**: Contains `(event_id UUID UNIQUE, search_run_id UUID, consumer_id VARCHAR, processed_at TIMESTAMPTZ)`.
2. **Pre-Execution Check**: The consumer attempts to insert into `processed_messages`. If a `UniqueViolation` occurs, the event is immediately flagged as a duplicate, logged at INFO level, and acknowledged at the broker without re-executing search queries or modifying existing project records.
3. **Post-Commit ACK**: A message is **never acknowledged** prior to successful database transaction commit. If a consumer container crashes during provider calls or before database commit, the message visibility timer expires and the message is redelivered to a healthy consumer.
