"""Application configuration — reads from backend/.env via pydantic-settings."""

from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


LOCAL_DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/postgres"


class Settings(BaseSettings):
    """Backend configuration, read from backend/.env (never committed) or the environment."""

    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Supabase / Postgres
    database_url: str = LOCAL_DATABASE_URL
    supabase_url: str = ""
    supabase_service_role_key: str = ""

    # Auth (stub — Prompt 8 replaces with Supabase JWT verification)
    auth_header_name: str = "x-user-id"

    # Anthropic / Claude chat
    anthropic_api_key: str = ""
    # Thinking depth for chat answers: low | medium | high | xhigh | max.
    claude_effort: str = "medium"

    # Multi-model routing (backend/app/llm/registry.py)
    # OpenRouter for all non-Claude models (unless Hunyuan override applies).
    openrouter_api_key: str = ""
    # Hunyuan OpenAI-compatible endpoint override (when set, Hunyuan models
    # go direct instead of through OpenRouter).
    hunyuan_api_key: str = ""
    hunyuan_base_url: str = ""

    # Know-how capture from chat (POST /api/expertise/extract)
    extraction_model: str = "claude-haiku-5-5"
    extraction_threshold: float = 0.6  # below this confidence, nothing is proposed
    extraction_min_words: int = 12  # skip short messages (questions, small talk)

    # Expertise retrieval (embeddings)
    embedding_provider: str = "local"  # "local" (fastembed) or "litellm"
    embedding_model: str = ""  # for litellm, e.g. "text-embedding-3-small"
    retrieval_min_score: float = 0.35

    # CORS (env: CORS_ORIGINS='["https://fractal.vercel.app"]' or a comma-separated list)
    cors_origins: list[str] = ["http://localhost:5173"]

    # Longest answer a non-Claude model may write (tokens).
    max_output_tokens: int = 4096

    # Public demo protection (backend/app/guard.py). Empty / 0 = off.
    access_code: str = ""
    rate_limit_per_minute: int = 0


    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, v):
        if isinstance(v, str) and not v.strip().startswith("["):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @field_validator("database_url", mode="before")
    @classmethod
    def _blank_database_url(cls, v):
        # `DATABASE_URL=` left empty in backend/.env must not crash startup: fall back to the
        # local default so the app runs (health reports the database as disconnected).
        return v if isinstance(v, str) and v.strip() else LOCAL_DATABASE_URL


settings = Settings()
