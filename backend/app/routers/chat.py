import json

import anthropic
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from .. import files
from ..db import get_db
from ..llm import claude, registry
from ..models import Expertise
from ..prompts import build_system_prompt
from ..schemas import ChatStreamRequest, ExpertiseIn

router = APIRouter(prefix="/api")


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def to_model_messages(turns, native_files: bool) -> list[dict]:
    """Drops empty turns and any leading assistant turns (the API needs user-first history),
    then adds each user turn's attachments: content blocks for Claude, extracted text otherwise."""
    kept = [t for t in turns if t.content.strip()]
    while kept and kept[0].role != "user":
        kept.pop(0)
    msgs = []
    for t in kept:
        content = t.content
        if t.role == "user" and t.files:
            if native_files:
                content = [*files.claude_blocks(t.files), {"type": "text", "text": t.content}]
            else:
                content = f"{files.text_attachments(t.files)}\n\n{t.content}"
        msgs.append({"role": t.role, "content": content})
    return msgs


@router.get("/models")
def models():
    """All catalogued models with provider and availability flag."""
    return [
        {"id": e.id, "provider": e.provider, "available": registry.is_available(e)}
        for e in registry.all_models()
    ]


@router.post("/chat/stream")
async def chat_stream(req: ChatStreamRequest, db: Session = Depends(get_db)):
    """Streams one model's answer as Server-Sent Events: meta, delta*, then done or error.

    Accepts any available model id from the catalogue plus "auto"
    (resolves to claude-sonnet for now).

    Chat safety: Expertise is loaded from the database by id (approved only)
    instead of trusting the content the browser sends.
    """
    is_auto = req.model == "auto"
    resolved_id = registry.resolve_auto(req.model)
    entry = registry.get(resolved_id)
    if entry is None:
        raise HTTPException(400, f"Model '{req.model}' is not recognised.")
    if not registry.is_available(entry):
        raise HTTPException(400, f"Model '{req.model}' is not available (no API key configured).")

    messages = to_model_messages(req.messages, native_files=entry.provider == "anthropic")
    if not messages or messages[-1]["role"] != "user":
        raise HTTPException(400, "The conversation must end with a user message.")

    # Only approved Expertise may reach a model prompt (PROJECT_CONTEXT rule 4).
    # Load from the database by id — never trust browser-sent content.
    exp_ids = [e.id for e in req.expertise if e.id]
    applied: list[ExpertiseIn] = []
    if exp_ids:
        rows = db.query(Expertise).filter(
            Expertise.id.in_(exp_ids), Expertise.status == "approved"
        ).all()
        applied = [
            ExpertiseIn(
                id=e.id, name=e.name, version=e.version, status=e.status,
                owner=e.owner or "", whenToUse=e.when_to_use or "",
                knowledge=e.knowledge or [], decisionLogic=e.decision_logic or [],
                guardrails=e.guardrails or [], escalation=e.escalation or [],
            )
            for e in rows
        ]
    system = build_system_prompt(
        applied,
        model_display_name=entry.display_name,
        provider_name=entry.provider_name,
        provider_model=entry.model,
        routing=req.routing,
    )

    async def events():
        yield sse("meta", {
            "modelId": resolved_id,
            "auto": is_auto,
            "expertise": [{"id": e.id, "version": e.version} for e in applied],
        })
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
