# Environment Variables Reference: Project Intelligence Platform

All environment variables can be configured via a `.env` file in the root directory or injected into deployment environments.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `APP_ENV` | No | `development` | Environment mode (`development`, `testing`, `production`). |
| `APP_NAME` | No | `Project Intelligence Platform` | Human-readable platform name. |
| `SECRET_KEY` | **Yes (Prod)** | `default_insecure_dev_key` | Cryptographic secret for signing JWT tokens. Minimum 64 characters in production. |
| `ALGORITHM` | No | `HS256` | JWT signature algorithm. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | No | `60` | Lifespan of JWT access tokens. |
| `REFRESH_TOKEN_EXPIRE_DAYS` | No | `7` | Lifespan of JWT refresh tokens. |
| `INTERNAL_API_KEY` | **Yes (Prod)** | — | Secret key used to authorize internal outbox claim calls between Cloudflare Workers and FastAPI. |
| `DATABASE_URL` | **Yes (Prod)** | `sqlite+aiosqlite:///./project_intelligence.db` | Async SQLAlchemy database connection string (`postgresql+asyncpg://...`). |
| `SYNC_DATABASE_URL` | No | `sqlite:///./project_intelligence.db` | Synchronous database connection string used by Alembic migrations (`postgresql://...`). |
| `DB_POOL_SIZE` | No | `20` | Database connection pool size for FastAPI & Consumer. |
| `DB_MAX_OVERFLOW` | No | `10` | Maximum connection overflow above pool size. |
| `REDIS_URL` | No | `redis://localhost:6379/0` | Managed Redis connection URL. Activates resilient in-memory fallback if unreachable. |
| `REDIS_CACHE_TTL_SECONDS` | No | `3600` | Expiration time for cached queries and temporary states. |
| `EXA_API_KEY` | Recommended | — | Official Exa AI API key for semantic and neural project search. |
| `EXA_BASE_URL` | No | `https://api.exa.ai` | Base URL for Exa API endpoints. |
| `EXA_TIMEOUT_SECONDS` | No | `15.0` | Timeout for Exa HTTP requests. |
| `SECOND_PROVIDER_NAME` | No | `brave` | Secondary search provider adapter (`brave`, `tavily`, etc.). |
| `SECOND_PROVIDER_API_KEY` | Recommended | — | API key for the secondary search provider. |
| `SECOND_PROVIDER_BASE_URL` | No | `https://api.search.brave.com/res/v1/web/search` | Base endpoint for the secondary provider adapter. |
| `CLOUDFLARE_ACCOUNT_ID` | Production | — | Cloudflare Account ID for Queue Pull REST APIs. Activates local simulation when absent. |
| `CLOUDFLARE_API_TOKEN` | Production | — | Cloudflare API Token with Queue Read & Write permissions. |
| `CLOUDFLARE_QUEUE_NAME` | No | `project-search-jobs` | Main queue name in Cloudflare Queues. |
| `CLOUDFLARE_DLQ_NAME` | No | `project-search-jobs-dlq` | Dead-Letter Queue name. |
| `CONSUMER_POLL_INTERVAL_SECONDS` | No | `2.0` | Initial polling frequency for the Python consumer before adaptive backoff. |
| `CONSUMER_MAX_BATCH_SIZE` | No | `10` | Maximum messages pulled per batch. |
| `CONSUMER_MAX_RETRIES` | No | `3` | Maximum retry attempts before routing failing messages to DLQ. |
| `CORS_ORIGINS` | No | `["http://localhost:3000","http://localhost:5173",...]` | Allowed browser origins for CORS preflight. |
| `RATE_LIMIT_PER_MINUTE` | No | `120` | Maximum API requests allowed per client per minute. |
