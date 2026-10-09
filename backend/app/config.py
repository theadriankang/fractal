"""Application configuration — reads from backend/.env via pydantic-settings."""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    """Backend configuration, read from backend/.env (never committed) or the environment."""

    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Supabase / Postgres
    database_url: str = "postgresql://postgres:postgres@localhost:5432/postgres"
    supabase_url: str = ""
    supabase_service_role_key: str = ""

    # Auth (stub — Prompt 8 replaces with Supabase JWT verification)
    auth_header_name: str = "x-user-id"

    # Anthropic / Claude chat
    anthropic_api_key: str = ""
    # Thinking depth for chat answers: low | medium | high | xhigh | max.
    claude_effort: str = "medium"

    # CORS
    cors_origins: list[str] = ["http://localhost:5173"]


settings = Settings()
