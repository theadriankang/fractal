"""Streaming chat answers from Claude via the official Anthropic SDK."""

from collections.abc import AsyncIterator

import anthropic

from ..config import settings

# Front-end model ids (src/data/models.js) -> Claude API model ids.
# Opus and Sonnet opt into server-side refusal fallbacks; Claude Haiku 5.5 has none.
MODELS = {
    "claude-opus": {"model": "claude-opus-5-5", "fallbacks": True},
    "claude-sonnet": {"model": "claude-sonnet-5-5", "fallbacks": True},
    "claude-haiku": {"model": "claude-haiku-5-5", "fallbacks": False},
}

FALLBACK_BETA = "server-side-fallback-2026-07-01"

client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key or None)


def is_configured() -> bool:
    return bool(settings.anthropic_api_key)


async def stream_reply(model_key: str, system: str, messages: list[dict]) -> AsyncIterator[tuple[str, dict]]:
    """Yields ("delta", {"text"}) for each text chunk, then ("done", {...}) or ("error", {...})."""
    spec = MODELS[model_key]
    params: dict = {
        "model": spec["model"],
        "max_tokens": settings.claude_max_output_tokens,
        "system": system,
        "messages": messages,
        "output_config": {"effort": settings.claude_effort},
        # Caches the conversation prefix, so attached documents resent on later turns bill at cache-read rates.
        "cache_control": {"type": "ephemeral"},
    }
    if spec["fallbacks"]:
        params |= {"betas": [FALLBACK_BETA], "fallbacks": "default"}

    async with client.beta.messages.stream(**params) as stream:
        async for event in stream:
            if event.type == "content_block_delta" and event.delta.type == "text_delta":
                yield "delta", {"text": event.delta.text}
        final = await stream.get_final_message()

    if final.stop_reason == "refusal":
        yield "error", {"message": "Claude declined to answer this request. Try rephrasing it."}
        return
    # final.model differs from the requested model when a server-side fallback answered.
    yield "done", {"stopReason": final.stop_reason, "model": final.model}
