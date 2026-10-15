"""Knowledge gaps router: log questions approved Expertise couldn't answer, and work the list.

POST /api/gaps                 chat reports an unanswered question (the server re-checks it)
GET  /api/gaps                 the list, most-asked first (open and drafting before closed)
POST /api/gaps/{id}/link       an expert started a draft from this gap
POST /api/gaps/{id}/recheck    resolve it if approved Expertise now answers it
POST /api/gaps/{id}/dismiss    off-topic or not worth capturing
"""

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import gaps
from ..auth import _forbid, get_current_user, in_domain
from ..db import get_db
from ..governance import audit
from ..models import Expertise, KnowledgeGap, Profile

router = APIRouter(prefix="/api", tags=["gaps"])


class GapIn(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    chatId: Optional[str] = None


class LinkIn(BaseModel):
    expertiseId: str


class DismissIn(BaseModel):
    reason: str = Field(default="", max_length=300)


class GapOut(BaseModel):
    id: str
    question: str
    domain: Optional[str] = None
    kind: str
    bestScore: float
    nearestExpertiseId: Optional[str] = None
    nearestExpertiseName: Optional[str] = None
    status: Literal["open", "drafting", "resolved", "dismissed"]
    askCount: int
    askers: list[dict]
    examples: list[dict]
    expertiseId: Optional[str] = None
    resolvedBy: Optional[str] = None
    resolution: Optional[str] = None
    createdAt: Optional[str] = None
    lastAskedAt: Optional[str] = None


class GapLogOut(BaseModel):
    logged: bool
    outcome: str
    gap: Optional[GapOut] = None


def out(g: KnowledgeGap) -> GapOut:
    status = g.status
    if status == "drafting" and not g.expertise_id:  # the draft was deleted: back to open
        status = "open"
    return GapOut(
        id=g.id, question=g.question, domain=g.domain, kind=g.kind, bestScore=g.best_score or 0.0,
        nearestExpertiseId=g.nearest_expertise_id, nearestExpertiseName=g.nearest_expertise_name,
        status=status, askCount=g.ask_count or 1, askers=g.askers or [], examples=g.examples or [],
        expertiseId=g.expertise_id, resolvedBy=g.resolved_by, resolution=g.resolution,
        createdAt=g.created_at.isoformat() if g.created_at else None,
        lastAskedAt=g.last_asked_at.isoformat() if g.last_asked_at else None,
    )


def _get(db: Session, gap_id: str) -> KnowledgeGap:
    g = db.get(KnowledgeGap, gap_id)
    if not g:
        raise HTTPException(404, "Knowledge gap not found")
    return g


def _not_intern(user: Profile) -> None:
    if user.role == "intern":
        _forbid("Interns can ask questions, but working the knowledge-gap list needs a domain expert or the Reviewer.")


@router.post("/gaps", response_model=GapLogOut)
def log_gap(body: GapIn, user: Profile = Depends(get_current_user), db: Session = Depends(get_db)):
    g, outcome = gaps.record(db, user, body.question, body.chatId)
    return GapLogOut(logged=g is not None and outcome != "dismissed", outcome=outcome, gap=out(g) if g else None)


_ORDER = {"open": 0, "drafting": 1, "resolved": 2, "dismissed": 3}


@router.get("/gaps", response_model=list[GapOut])
def list_gaps(user: Profile = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = [out(g) for g in db.query(KnowledgeGap).all()]
    # Most recently asked first, then (stable sort) by status and how many people asked.
    rows.sort(key=lambda g: g.lastAskedAt or "", reverse=True)
    rows.sort(key=lambda g: (_ORDER[g.status], -len(g.askers), -g.askCount))
    return rows


@router.post("/gaps/{gap_id}/link", response_model=GapOut)
def link_gap(gap_id: str, body: LinkIn, user: Profile = Depends(get_current_user), db: Session = Depends(get_db)):
    g = _get(db, gap_id)
    e = db.get(Expertise, body.expertiseId)
    if not e:
        raise HTTPException(404, "Expertise not found")
    if user.role != "reviewer" and not (user.role == "contributor" and in_domain(user, e.domain)):
        _forbid(f"Only {e.domain} experts can capture know-how for this gap.")
    if g.status in ("resolved", "dismissed"):
        raise HTTPException(409, f"This gap is already {g.status}.")
    g.status, g.expertise_id, g.domain = "drafting", e.id, e.domain
    audit(db, user, "gap.capture", "knowledge_gap", g.id, expertiseId=e.id, question=g.question[:200])
    db.commit()
    return out(g)


@router.post("/gaps/{gap_id}/recheck", response_model=GapOut)
def recheck_gap(gap_id: str, user: Profile = Depends(get_current_user), db: Session = Depends(get_db)):
    _not_intern(user)
    g = _get(db, gap_id)
    if g.status == "dismissed":
        raise HTTPException(409, "This gap was dismissed.")
    if gaps.recheck(db, g, user):
        audit(db, user, "gap.resolve", "knowledge_gap", g.id, expertiseId=g.expertise_id, how="recheck")
        db.commit()
    return out(g)


@router.post("/gaps/{gap_id}/dismiss", response_model=GapOut)
def dismiss_gap(gap_id: str, body: DismissIn = DismissIn(), user: Profile = Depends(get_current_user),
                db: Session = Depends(get_db)):
    g = _get(db, gap_id)
    if user.role != "reviewer" and not (user.role == "contributor" and g.domain and in_domain(user, g.domain)):
        _forbid("Only the Reviewer, or an expert in this gap's domain, can dismiss it.")
    g.status, g.resolved_by = "dismissed", user.name or ""
    g.resolution = body.reason.strip() or "Dismissed: not something to capture"
    audit(db, user, "gap.dismiss", "knowledge_gap", g.id, reason=g.resolution)
    db.commit()
    return out(g)
