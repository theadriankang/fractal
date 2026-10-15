"""POST /api/expertise/weigh — weigh several domains' Expertise against one question.

Not a comparison: every domain keeps its own voice, and the answer shows where they agree, where
one domain's idea runs into another's rule, and suggestions that still carry every expert's view.
See app/weigh/engine.py for how the model's answer is checked against the approved records.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from .. import knowledge_gaps
from ..db import get_db
from ..config import settings
from ..llm import claude
from ..weigh.engine import to_markdown, weigh, weigh_auto
from ..weigh.schemas import WeighRequest, WeighResult
from ..weigh.select import select_experts

router = APIRouter(prefix="/api", tags=["expertise"])
logger = logging.getLogger(__name__)


@router.post("/expertise/weigh", response_model=WeighResult)
async def weigh_expertise(req: WeighRequest, db: Session = Depends(get_db)) -> WeighResult:
    try:
        picked = select_experts(db, req.question, req.attachedIds)
    except OperationalError as e:
        # Usually DATABASE_URL is blank in backend/.env, so the backend points at a local Postgres
        # that isn't running. Say so instead of a bare 500.
        logger.warning("weigh: database unreachable: %s", e)
        raise HTTPException(503, "The backend can't reach its database. Set DATABASE_URL in backend/.env and restart it.") from e
    client = claude.client if claude.is_configured() else None
    question = req.question.strip()
    if req.auto:
        result = await weigh_auto(question, picked, req.context, client, settings.weigh_auto_check)
    else:
        result = await weigh(question, picked, req.context, client)
    if result.triggered:
        result.markdown = to_markdown(result)
    if result.gaps:
        # The engine already named what this question needed that no approved Expertise
        # covers -- persist it (deduplicated) rather than letting it disappear once the
        # Weigh panel closes. See app/knowledge_gaps.py.
        knowledge_gaps.record_gaps(db, result.gaps, [e.domain for e in result.experts], result.question)
    return result
