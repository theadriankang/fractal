"""Model registry: loads models.yaml and routes chat requests to providers.

Routing rules:
  - Anthropic models  → Anthropic SDK (claude.py, keeps working)
  - Tencent Hunyuan   → OpenAI-compatible HUNYUAN_API_KEY + HUNYUAN_BASE_URL
                        when both are set, otherwise OpenRouter
  - Everything else   → OpenRouter via LiteLLM

A model is "available" only if the key for its route is set.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path

import yaml

from ..config import settings

_MODELS_YAML = Path(__file__).resolve().parent.parent.parent / "models.yaml"

# "auto" resolves to this model for now.
AUTO_MODEL_ID = "claude-sonnet"


@dataclass(frozen=True)
class ModelEntry:
    id: str
    provider: str
    model: str  # provider model name used in the API call
    hunyuan_model: str | None = None  # model name for the Hunyuan direct route
    display_name: str = ""  # human-friendly name (e.g. "Claude Haiku")
    provider_name: str = ""  # human-friendly provider name (e.g. "Anthropic")


_PROVIDER_NAMES = {
    "anthropic": "Anthropic",
    "openai": "OpenAI",
    "google": "Google",
    "xai": "xAI",
    "tencent": "Tencent Hunyuan",
    "deepseek": "DeepSeek",
}


def _display_name(entry_id: str) -> str:
    """Convert 'claude-haiku' → 'Claude Haiku', 'gpt-5-mini' → 'GPT-5 Mini'."""
    parts = entry_id.split("-")
    special = {"gpt": "GPT", "ai": "AI", "t1": "T1", "v3": "V3"}
    result = []
    for p in parts:
        result.append(special.get(p, p.capitalize()))
    return " ".join(result)


def _load_catalog() -> list[ModelEntry]:
    with open(_MODELS_YAML, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    entries: list[ModelEntry] = []
    for m in data.get("models", []):
        eid = m["id"]
        entries.append(
            ModelEntry(
                id=eid,
                provider=m["provider"],
                model=m["model"],
                hunyuan_model=m.get("hunyuan_model"),
                display_name=_display_name(eid),
                provider_name=_PROVIDER_NAMES.get(m["provider"], m["provider"]),
            )
        )
    return entries


_catalog: list[ModelEntry] = _load_catalog()
_by_id: dict[str, ModelEntry] = {e.id: e for e in _catalog}


def all_models() -> list[ModelEntry]:
    return list(_catalog)


def get(model_id: str) -> ModelEntry | None:
    return _by_id.get(model_id)


def resolve_auto(model_id: str) -> str:
    """Resolves 'auto' to a concrete model id."""
    if model_id == "auto":
        return AUTO_MODEL_ID
    return model_id


# ---------------------------------------------------------------------------
# Availability
# ---------------------------------------------------------------------------

def is_available(entry: ModelEntry) -> bool:
    """True when the API key for this model's route is set."""
    if entry.provider == "anthropic":
        return bool(settings.anthropic_api_key)
    if entry.provider == "tencent" and settings.hunyuan_api_key and settings.hunyuan_base_url:
        return True
    # Everything else (including Hunyuan via OpenRouter fallback) uses OpenRouter.
    return bool(settings.openrouter_api_key)


def available_ids() -> set[str]:
    return {e.id for e in _catalog if is_available(e)}


# ---------------------------------------------------------------------------
# Streaming
# ---------------------------------------------------------------------------

def _openrouter_model(entry: ModelEntry) -> str:
    """Returns the LiteLLM model string for an OpenRouter-routed model."""
    return f"openrouter/{entry.model}"


async def stream_reply(
    entry: ModelEntry, system: str, messages: list[dict]
) -> AsyncIterator[tuple[str, dict]]:
    """Yields ("delta", {"text"}) then ("done", {...}) or ("error", {...}).

    Anthropic models delegate to claude.py; everything else goes through
    LiteLLM's acompletion stream.
    """
    if entry.provider == "anthropic":
        from . import claude

        # claude.stream_reply takes a front-end model key, not the provider name.
        async for kind, data in claude.stream_reply(entry.id, system, messages):
            yield kind, data
        return

    # --- LiteLLM (OpenRouter / Hunyuan direct) ---
    import litellm

    if entry.provider == "tencent" and settings.hunyuan_api_key and settings.hunyuan_base_url:
        # OpenAI-compatible Hunyuan endpoint.
        model_name = entry.hunyuan_model or entry.model
        kwargs = dict(
            model=model_name,
            messages=[{"role": "system", "content": system}, *messages],
            api_key=settings.hunyuan_api_key,
            api_base=settings.hunyuan_base_url,
            stream=True,
        )
    else:
        # OpenRouter via LiteLLM.
        litellm_model = _openrouter_model(entry)
        os.environ.setdefault("OPENROUTER_API_KEY", settings.openrouter_api_key)
        kwargs = dict(
            model=litellm_model,
            messages=[{"role": "system", "content": system}, *messages],
            api_key=settings.openrouter_api_key,
            stream=True,
        )

    response = await litellm.acompletion(**kwargs)
    used_model = entry.model
    async for chunk in response:
        delta = chunk.choices[0].delta if chunk.choices else None
        if delta and getattr(delta, "content", None):
            yield "delta", {"text": delta.content}
        # Some providers return the real model name on the first chunk.
        if getattr(chunk, "model", None):
            used_model = chunk.model

    yield "done", {"stopReason": "stop", "model": used_model}
