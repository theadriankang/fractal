"""POST /api/expertise/weigh — weigh several domains' Expertise against one question.

Not a comparison: every domain keeps its own voice, and the answer shows where they agree, where
one domain's idea runs into another's rule, and suggestions that still carry every expert's view.
See app/weigh/engine.py for how the model's answer is checked against the approved records.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..llm import claude
from ..weigh.engine import to_markdown, weigh
from ..weigh.schemas import WeighRequest, WeighResult
from ..weigh.select import select_experts

router = APIRouter(prefix="/api", tags=["expertise"])


@router.post("/expertise/weigh", response_model=WeighResult)
async def weigh_expertise(req: WeighRequest, db: Session = Depends(get_db)) -> WeighResult:
    picked = select_experts(db, req.question, req.attachedIds)
    client = claude.client if claude.is_configured() else None
    result = await weigh(req.question.strip(), picked, req.context, client)
    result.markdown = to_markdown(result)
    return result
