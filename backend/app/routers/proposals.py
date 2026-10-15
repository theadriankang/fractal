"""Proposals router — revisions to live Expertise waiting in the Review Queue.

Created by domain experts (edits, chat / meeting capture, 👎 corrections — see responses.py);
approving merges the add/remove diff into the Expertise as a new version. Feedback-loop proposals
(docs/FEEDBACK_LOOP.md) also carry `loop` metadata: a `set` of replaced string fields, a test
question saved on approval, merged reports and the last before/after test run.
"""

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..auth import _forbid, get_current_user, in_domain, require_contributor, require_reviewer_for
from ..db import get_db
from ..governance import (
    add_test_case, add_version, apply_changes, apply_set, audit, bump_version, one_expertise_out, proposal_to_out, snapshot,
)
from ..models import Expertise, Profile, Proposal
from ..retrieval.index import index_expertise
from ..schemas import ExpertiseOut, ProposalCreate, ProposalOut, ProposalUpdate

router = APIRouter(prefix="/api/proposals", tags=["proposals"])


@router.get("", response_model=list[ProposalOut])
def list_proposals(status: Optional[str] = "open", db: Session = Depends(get_db)):
    """Open proposals by default; ``?status=all`` for the full history."""
    q = db.query(Proposal)
    if status and status != "all":
        q = q.filter(Proposal.status == status)
    return [proposal_to_out(p) for p in q.order_by(Proposal.created_at.desc())]


@router.post("", response_model=ProposalOut, status_code=status.HTTP_201_CREATED)
def create_proposal(
    body: ProposalCreate,
    user: Profile = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    e = db.get(Expertise, body.expertise_id)
    if not e:
        raise HTTPException(status_code=404, detail="Expertise not found")
    require_contributor(user, e.domain)
    if body.id and db.get(Proposal, body.id):
        raise HTTPException(status_code=409, detail="Proposal id already exists")
    p = Proposal(
        **body.model_dump(exclude={"id"}),
        id=body.id or f"prop-{uuid.uuid4().hex[:8]}",
        status="open",
        created_at=datetime.now(timezone.utc),
    )
    db.add(p)
    audit(db, user, "proposal.create", "proposal", p.id, expertiseId=e.id)
    db.commit()
    db.refresh(p)
    return proposal_to_out(p)


def _open(db: Session, pid: str) -> tuple[Proposal, Expertise]:
    p = db.get(Proposal, pid)
    if not p:
        raise HTTPException(status_code=404, detail="Proposal not found")
    if p.status != "open":
        raise HTTPException(status_code=409, detail=f"Proposal is already {p.status}")
    return p, db.get(Expertise, p.expertise_id)


@router.patch("/{pid}", response_model=ProposalOut)
def update_proposal(pid: str, body: ProposalUpdate, user: Profile = Depends(get_current_user), db: Session = Depends(get_db)):
    """Feedback loop: merge a second 👎 report into an open proposal, or save its before/after test run.
    Allowed for the Reviewer and for experts in the Expertise's domain."""
    p, e = _open(db, pid)
    if user.role != "reviewer" and not in_domain(user, e.domain):
        _forbid(f"Only {e.domain} experts or the Reviewer can update this proposal.")
    if body.changes is not None:
        p.changes = body.changes
    if body.reason is not None:
        p.reason = body.reason
    if body.loop is not None:
        p.loop = {**(p.loop or {}), **body.loop}
    audit(db, user, "proposal.update", "proposal", p.id, expertiseId=e.id, fields=sorted(body.model_dump(exclude_none=True)))
    db.commit()
    db.refresh(p)
    return proposal_to_out(p)


@router.post("/{pid}/approve", response_model=ExpertiseOut)
def approve_proposal(pid: str, user: Profile = Depends(get_current_user), db: Session = Depends(get_db)):
    """Merges the change into the Expertise as a new version; returns the updated Expertise."""
    p, e = _open(db, pid)
    require_reviewer_for(user, e.domain, (p.capture or {}).get("capturedBy") or p.author)
    apply_changes(e, p.changes)
    apply_set(e, (p.loop or {}).get("set"))
    # the question that exposed the mistake now guards every future change
    add_test_case(e, (p.loop or {}).get("testCase"))
    e.version = bump_version(e.version)
    # provenance (e.g. the meeting a revision came from) follows the change into the Expertise
    if p.sources:
        e.sources = list(p.sources) + list(e.sources or [])
    e.updated_at = datetime.now(timezone.utc)
    add_version(db, e, author=p.author, approved_by=user.name, note=p.reason, snap=snapshot(e))
    p.status = "approved"
    audit(db, user, "proposal.approve", "proposal", p.id, expertiseId=e.id, version=e.version)
    db.commit()
    db.refresh(e)
    # Re-index the embedding if the Expertise is approved.
    if e.status == "approved":
        index_expertise(db, e)
    return one_expertise_out(db, e)


@router.post("/{pid}/reject", response_model=ProposalOut)
def reject_proposal(pid: str, user: Profile = Depends(get_current_user), db: Session = Depends(get_db)):
    p, e = _open(db, pid)
    require_reviewer_for(user, e.domain, (p.capture or {}).get("capturedBy") or p.author)
    p.status = "rejected"
    audit(db, user, "proposal.reject", "proposal", p.id, expertiseId=e.id)
    db.commit()
    db.refresh(p)
    return proposal_to_out(p)
