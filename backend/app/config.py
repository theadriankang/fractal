from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    """Backend configuration, read from backend/.env (never committed) or the environment."""

    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    anthropic_api_key: str = ""
    # Thinking depth for chat answers: low | medium | high | xhigh | max.
    claude_effort: str = "medium"
    cors_origins: list[str] = ["http://localhost:5173"]


settings = Settings()
