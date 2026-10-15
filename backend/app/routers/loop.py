import anthropic
from fastapi import APIRouter, HTTPException

from ..llm import claude
from ..loop import correct, replay
from ..loop.schemas import CorrectionRequest, CorrectionResult, ReplayRequest, ReplayResult

router = APIRouter(prefix="/api/loop", tags=["feedback loop"])


def _require_claude():
    if not claude.is_configured():
        raise HTTPException(503, "ANTHROPIC_API_KEY is not set in backend/.env.")


@router.post("/correction", response_model=CorrectionResult)
async def correction(req: CorrectionRequest) -> CorrectionResult:
    """Turns a 👎 correction into a precise change to one of the Expertise applied to the answer.

    Contributor-only, like capture. The result says whether THIS user may propose it (expert in the
    Expertise's domain); nothing changes until a reviewer approves the proposal.
    """
    if req.user.role != "contributor":
        raise HTTPException(403, "Only contributors can propose changes.")
    _require_claude()
    try:
        raw = await correct.call_model(req, claude.client)
    except anthropic.APIStatusError as e:
        raise HTTPException(502, f"Claude API error ({e.status_code}): {e.message}") from e
    except anthropic.APIConnectionError as e:
        raise HTTPException(502, "The backend could not reach the Claude API.") from e
    return correct.validate(raw, req, model=correct.settings.loop_correction_model)


@router.post("/test", response_model=ReplayResult)
async def test_change(req: ReplayRequest) -> ReplayResult:
    """Before/after test for a proposed revision: each saved question is answered with the current
    and the proposed Expertise, and each answer is graded blind against the question's criteria."""
    if req.current.id != req.proposed.id:
        raise HTTPException(400, "current and proposed must be versions of the same Expertise.")
    if not any(replay.has_criteria(c) for c in req.cases):
        raise HTTPException(400, "None of the test questions has pass criteria.")
    _require_claude()
    try:
        return await replay.run(req, claude.client)
    except anthropic.AuthenticationError as e:
        raise HTTPException(502, "Claude rejected the API key. Check ANTHROPIC_API_KEY in backend/.env.") from e
