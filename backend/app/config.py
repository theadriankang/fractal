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

    # Auth: verifies a Supabase JWT when the front end sends one (Authorization: Bearer <token>).
    # Project Settings -> API -> JWT Secret. Empty = JWT verification is skipped and every
    # request falls back to the unverified X-User-Id / X-User-Email header (see app/auth.py).
    supabase_jwt_secret: str = ""

    # Anthropic / Claude chat
    anthropic_api_key: str = ""
    # Thinking depth for chat answers: low | medium | high | xhigh | max.
    claude_effort: str = "medium"
    # Ceiling on one Claude reply, thinking included. Caps the worst-case cost of a single answer.
    claude_max_output_tokens: int = 8000

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

    # Cross-domain weighing (POST /api/expertise/weigh): weighs several domains' Expertise at once,
    # so it uses a stronger reasoning model than the extractor. Unset key = quick text-matching mode.
    weigh_model: str = "claude-sonnet-5-5"
    # Automatic weighing in chat: also check questions that don't explicitly ask for a trade-off, and
    # show the weighing only if the experts conflict. Costs one model call per question that has 2+
    # experts. False = weigh only when the question itself asks about two areas or a trade-off.
    weigh_auto_check: bool = True

    # Expertise retrieval (embeddings)
    embedding_provider: str = "local"  # "local" (fastembed) or "litellm"
    embedding_model: str = ""  # for litellm, e.g. "text-embedding-3-small"
    retrieval_min_score: float = 0.35

    # Meeting Recorder transcription backend (src/hooks/useMeetingRecorder.js).
    # TODO: only "browser" (the Web Speech API, client-side) is implemented. "tencent-asr" and
    # "whisper" are placeholders for a server-side transcription path — swapping one in means
    # adding a POST /api/meetings/{id}/transcribe that accepts the recorded audio and returns a
    # transcript, and having the front end call it instead of (or as a fallback for) SpeechRecognition.
    transcribe: str = "browser"  # "browser" | "tencent-asr" | "whisper"

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
