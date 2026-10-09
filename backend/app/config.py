"""Application configuration — reads from backend/.env via pydantic-settings."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Supabase / Postgres
    database_url: str = "postgresql://postgres:postgres@localhost:5432/postgres"
    supabase_url: str = ""
    supabase_service_role_key: str = ""

    # Auth (stub — Prompt 8 replaces with Supabase JWT verification)
    auth_header_name: str = "x-user-id"

    # CORS
    cors_origins: list[str] = ["http://localhost:5173"]

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()
