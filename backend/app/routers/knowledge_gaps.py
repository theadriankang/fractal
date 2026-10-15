"""GET/POST /api/knowledge-gaps -- what questions the approved Expertise can't answer yet.

Rows are written by app/routers/weigh.py whenever the weighing engine names a gap; this
router only reads and triages them. Dismiss/resolve are reviewer-only, same bar as approving
an Expertise, since marking a gap "handled" is a governance call, not a personal preference.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import knowledge_gaps as gaps
from ..auth import get_current_user
from ..db import get_db
from ..models import Profile
from ..schemas import GapOut

router = APIRouter(prefix="/api", tags=["knowledge gaps"])


def _require_reviewer(user: Profile):
    if user.role != "reviewer":
        raise HTTPException(403, "Only the Reviewer can triage knowledge gaps.")


@router.get("/knowledge-gaps", response_model=list[GapOut])
def list_knowledge_gaps(status: str | None = None, db: Session = Depends(get_db)):
    return gaps.list_gaps(db, status=status)


class ResolveIn(BaseModel):
    expertiseId: str | None = None


@router.post("/knowledge-gaps/{gap_id}/dismiss", response_model=GapOut)
def dismiss(gap_id: str, db: Session = Depends(get_db), user: Profile = Depends(get_current_user)):
    _require_reviewer(user)
    row = gaps.set_status(db, gap_id, "dismissed")
    if not row:
        raise HTTPException(404, "Knowledge gap not found.")
    return row


@router.post("/knowledge-gaps/{gap_id}/resolve", response_model=GapOut)
def resolve(gap_id: str, body: ResolveIn, db: Session = Depends(get_db), user: Profile = Depends(get_current_user)):
    _require_reviewer(user)
    row = gaps.set_status(db, gap_id, "resolved", resolved_expertise_id=body.expertiseId)
    if not row:
        raise HTTPException(404, "Knowledge gap not found.")
    return row
