import anthropic
from fastapi import APIRouter, HTTPException

from ..capture.extract import call_model, validate, word_count
from ..capture.schemas import Detection, ExtractRequest
from ..config import settings
from ..llm import claude

router = APIRouter(prefix="/api")


@router.post("/expertise/extract", response_model=Detection)
async def extract(req: ExtractRequest) -> Detection:
    """Decides whether the latest user message shared reusable know-how (AI Harvest).

    Contributor-only. The result says whether THIS user may contribute it (expert in the target
    domain); out-of-domain detections come back with allowed=false so the UI can explain why.
    """
    if req.user.role != "contributor":
        raise HTTPException(403, "Only contributors can capture know-how.")
    last_user = next((t.content for t in reversed(req.turns) if t.role == "user"), "")
    if word_count(last_user) < settings.extraction_min_words:
        return Detection(kind="none", reason="Message too short to contain reusable know-how.")
    if not claude.is_configured():
        raise HTTPException(503, "ANTHROPIC_API_KEY is not set in backend/.env.")
    try:
        raw = await call_model(req, claude.client)
    except anthropic.APIStatusError as e:
        raise HTTPException(502, f"Claude API error ({e.status_code}): {e.message}") from e
    except anthropic.APIConnectionError as e:
        raise HTTPException(502, "The backend could not reach the Claude API.") from e
    return validate(raw, req, model=settings.extraction_model)
