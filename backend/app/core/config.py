import json
from typing import List, Optional, Union
from pydantic import AnyHttpUrl, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore"
    )

    # Application Basics
    APP_ENV: str = "development"
    APP_NAME: str = "Project Intelligence Platform"
    APP_DEBUG: bool = True
    API_V1_STR: str = "/api/v1"

    # Security & JWT
    SECRET_KEY: str = "default_insecure_development_secret_key_change_in_production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Internal API Key for Cloudflare Publisher & Worker calls
    INTERNAL_API_KEY: str = "change_this_to_a_strong_internal_service_key"

    # Database Configuration
    DATABASE_URL: str = "sqlite+aiosqlite:///./project_intelligence.db"
    SYNC_DATABASE_URL: Optional[str] = "sqlite:///./project_intelligence.db"
    DB_POOL_SIZE: int = 20
    DB_MAX_OVERFLOW: int = 10
    DB_POOL_TIMEOUT: int = 30

    # Redis Configuration
    REDIS_URL: str = "redis://localhost:6379/0"
    REDIS_CACHE_TTL_SECONDS: int = 3600
    REDIS_MAX_CONNECTIONS: int = 50

    # Search Provider: Exa
    EXA_API_KEY: Optional[str] = None
    EXA_BASE_URL: str = "https://api.exa.ai"
    EXA_TIMEOUT_SECONDS: float = 15.0
    EXA_MAX_RESULTS: int = 20

    # Search Provider: Second Configurable Provider (e.g. Brave, Tavily)
    SECOND_PROVIDER_NAME: str = "brave"
    SECOND_PROVIDER_API_KEY: Optional[str] = None
    SECOND_PROVIDER_BASE_URL: str = "https://api.search.brave.com/res/v1/web/search"
    SECOND_PROVIDER_TIMEOUT_SECONDS: float = 15.0
    SECOND_PROVIDER_MAX_RESULTS: int = 20

    # Cloudflare Queue Settings
    CLOUDFLARE_ACCOUNT_ID: Optional[str] = None
    CLOUDFLARE_API_TOKEN: Optional[str] = None
    CLOUDFLARE_QUEUE_NAME: str = "project-search-jobs"
    CLOUDFLARE_DLQ_NAME: str = "project-search-jobs-dlq"

    # Python Consumer Settings
    CONSUMER_POLL_INTERVAL_SECONDS: float = 2.0
    CONSUMER_MAX_BATCH_SIZE: int = 10
    CONSUMER_VISIBILITY_TIMEOUT_SECONDS: int = 60
    CONSUMER_MAX_RETRIES: int = 3

    # CORS and Gateway
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
        "https://project-intelligence.workers.dev"
    ]
    RATE_LIMIT_PER_MINUTE: int = 120

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str):
            if v.startswith("[") and v.endswith("]"):
                try:
                    return json.loads(v)
                except Exception:
                    pass
            return [i.strip() for i in v.split(",") if i.strip()]
        elif isinstance(v, list):
            return v
        return []


settings = Settings()
