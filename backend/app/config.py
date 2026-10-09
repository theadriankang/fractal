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

    # Know-how capture from chat (POST /api/expertise/extract)
    extraction_model: str = "claude-haiku-5-5"
    extraction_threshold: float = 0.6  # below this confidence, nothing is proposed
    extraction_min_words: int = 12  # skip short messages (questions, small talk)

    # Feedback loop (docs/FEEDBACK_LOOP.md): 👎 corrections -> proposals, before/after tests
    loop_correction_model: str = "claude-haiku-5-5"
    loop_grader_model: str = "claude-sonnet-5-5"
    loop_answer_model: str = "claude-haiku"  # front-end id; a test run uses the chat's model when given
    loop_threshold: float = 0.6  # below this confidence a correction proposes nothing
    loop_max_cases: int = 8
    loop_concurrency: int = 4

    # CORS
    cors_origins: list[str] = ["http://localhost:5173"]


settings = Settings()
