# Security & Access Architecture: Project Intelligence Platform

## Security Principles

The Project Intelligence Platform enforces defense-in-depth across edge gateways, container runtimes, message brokers, and relational storage.

---

## 1. Zero Exposure of Provider Secrets to Browser
- External provider API keys (`EXA_API_KEY`, `SECOND_PROVIDER_API_KEY`) and database credentials are strictly bound to backend container runtimes and Cloudflare environment secrets.
- Client browsers communicate solely through the Cloudflare Worker API Gateway or authenticated FastAPI endpoints.
- Diagnostic settings endpoints (`/api/v1/analytics/providers`, `/settings`) return boolean presence flags (`configured: true/false`) and never reveal plaintext tokens.

---

## 2. Authentication & Authorization (RBAC)
- **Password Security**: Plaintext passwords are never persisted. Passwords are salted and hashed using `bcrypt` (12 rounds) or `Argon2`.
- **JWT Tokens**:
  - Signed using HMAC SHA-256 (`HS256`) with a cryptographically random secret (`SECRET_KEY`).
  - Short-lived Access Tokens (default 60 minutes) for API authorization.
  - Refresh Tokens (default 7 days) stored with explicit token type claims to prevent token substitution attacks.
- **Role-Based Access Control**:
  - Roles: `admin`, `user`.
  - Administrative endpoints (e.g. system configurations, provider management) require `role == "admin"`.

---

## 3. Internal Service-to-Service Security
- Internal endpoints (`/internal/v1/outbox/*`) are utilized by the Cloudflare Scheduled Worker to claim and publish pending events.
- These endpoints enforce the `X-Internal-Key` header with constant-time cryptographic comparison (`hmac.compare_digest`) against `INTERNAL_API_KEY`.
- The Cloudflare Gateway explicitly blocks external internet callers from accessing `/internal/*` routes without authorized service credentials.

---

## 4. SQL Injection & Data Sanitization Protection
- All relational operations utilize **SQLAlchemy 2.0 ORM** and parameter-bound parameterized SQL queries. Raw string concatenation in SQL is prohibited.
- User-supplied search queries are parsed via strict Pydantic models (`SearchCreateRequest`) and sanitized regex parsers before execution.

---

## 5. Distributed Tracing & Observability Headers
- Each inbound request is tagged with an immutable `X-Trace-Id` (UUID4).
- Trace IDs propagate from the Cloudflare Worker Gateway into FastAPI request state, log records, activity events, and down to the Python Pull Consumer.
