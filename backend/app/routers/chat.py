import json

import anthropic
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from ..llm import claude, registry
from ..prompts import build_system_prompt
from ..schemas import ChatStreamRequest

router = APIRouter(prefix="/api")


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def to_claude_messages(turns) -> list[dict]:
    """Drops empty turns and any leading assistant turns; the API needs user-first history."""
    msgs = [{"role": t.role, "content": t.content} for t in turns if t.content.strip()]
    while msgs and msgs[0]["role"] != "user":
        msgs.pop(0)
    return msgs


@router.get("/models")
def models():
    """All catalogued models with provider and availability flag."""
    return [
        {"id": e.id, "provider": e.provider, "available": registry.is_available(e)}
        for e in registry.all_models()
    ]


@router.post("/chat/stream")
async def chat_stream(req: ChatStreamRequest):
    """Streams one model's answer as Server-Sent Events: meta, delta*, then done or error.

    Accepts any available model id from the catalogue plus "auto"
    (resolves to claude-sonnet for now).
    """
    resolved_id = registry.resolve_auto(req.model)
    entry = registry.get(resolved_id)
    if entry is None:
        raise HTTPException(400, f"Model '{req.model}' is not recognised.")
    if not registry.is_available(entry):
        raise HTTPException(400, f"Model '{req.model}' is not available (no API key configured).")

    messages = to_claude_messages(req.messages)
    if not messages or messages[-1]["role"] != "user":
        raise HTTPException(400, "The conversation must end with a user message.")

    # Only approved Expertise may reach a model prompt (PROJECT_CONTEXT rule 4).
    applied = [e for e in req.expertise if e.status == "approved"]
    system = build_system_prompt(applied)

    async def events():
        yield sse("meta", {"expertise": [{"id": e.id, "version": e.version} for e in applied]})
        try:
            async for kind, data in registry.stream_reply(entry, system, messages):
                yield sse(kind, data)
        except anthropic.AuthenticationError:
            yield sse("error", {"message": "Claude rejected the API key. Check ANTHROPIC_API_KEY in backend/.env."})
        except anthropic.RateLimitError:
            yield sse("error", {"message": "Claude is rate limiting requests. Wait a moment and try again."})
        except anthropic.APIStatusError as e:
            yield sse("error", {"message": f"Claude API error ({e.status_code}): {e.message}"})
        except anthropic.APIConnectionError:
            yield sse("error", {"message": "The backend could not reach the Claude API."})
        except Exception as e:
            # Catch-all so provider errors become an error event, never a crash.
            yield sse("error", {"message": f"{entry.id} request failed: {e}"})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
