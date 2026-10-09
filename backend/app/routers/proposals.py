"""Proposals router — create, list, approve, reject."""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..db import get_db
from ..governance import _bump_version, _snapshot, save_version, write_audit
from ..models import Expertise, ExpertiseVersion, Profile, Proposal
from ..permissions import review_block
from ..schemas import ApproveBody, ProposalCreate, ProposalOut, RejectBody

router = APIRouter(prefix="/api/proposals", tags=["proposals"])


def _prop_to_out(p: Proposal) -> ProposalOut:
    return ProposalOut(
        id=p.id,
        expertise_id=p.expertise_id,
        type=p.type,
        created_at=p.created_at,
        author=p.author,
        reason=p.reason,
        changes=p.changes or {},
        chat_id=p.chat_id,
        status=p.status,
    )


@router.get("", response_model=list[ProposalOut])
def list_proposals(
    status_filter: str | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
):
    q = db.query(Proposal)
    if status_filter:
        q = q.filter(Proposal.status == status_filter)
    rows = q.order_by(Proposal.created_at.desc()).all()
    return [_prop_to_out(p) for p in rows]


@router.post("", response_model=ProposalOut, status_code=201)
def create_proposal(
    body: ProposalCreate,
    db: Session = Depends(get_db),
    user: Profile = Depends(get_current_user),
):
    e = db.get(Expertise, body.expertiseId)
    if not e:
        raise HTTPException(status_code=404, detail="Expertise not found.")

    prop = Proposal(
        id=f"prop-{uuid.uuid4().hex[:8]}",
        expertise_id=body.expertiseId,
        type="revision",
        author=user.name,
        reason=body.reason,
        changes=body.changes,
        chat_id=body.chatId,
        status="open",
    )
    db.add(prop)
    write_audit(db, actor_id=user.id, actor_role=user.role, action="create_proposal",
                target_type="proposal", target_id=prop.id,
                detail={"expertise_id": body.expertiseId, "reason": body.reason})
    db.commit()
    db.refresh(prop)
    return _prop_to_out(prop)


@router.post("/{prop_id}/approve", response_model=ProposalOut)
def approve_proposal(
    prop_id: str, body: ApproveBody,
    db: Session = Depends(get_db), user: Profile = Depends(get_current_user),
):
    p = db.get(Proposal, prop_id)
    if not p:
        raise HTTPException(status_code=404, detail="Proposal not found.")
    if p.status != "open":
        raise HTTPException(status_code=400, detail=f"Proposal is {p.status}, not open.")

    e = db.get(Expertise, p.expertise_id)
    if not e:
        raise HTTPException(status_code=404, detail="Target Expertise not found.")

    block = review_block(user, e.domain, owner=e.owner, author=p.author)
    if block:
        raise HTTPException(status_code=403, detail=block)

    # Merge changes into expertise
    for field, diff in (p.changes or {}).items():
        add = diff.get("add", [])
        remove = diff.get("remove", [])
        current = getattr(e, field) or []
        merged = [x for x in current if x not in remove] + [x for x in add if x not in current]
        setattr(e, field, merged)

    new_version = _bump_version(e.version)
    e.version = new_version
    e.status = "approved"
    e.reviewer = user.name
    e.updated_at = datetime.now(timezone.utc)
    save_version(db, e, version=new_version, author=p.author, approved_by=user.name, note=body.note)

    p.status = "approved"
    write_audit(db, actor_id=user.id, actor_role=user.role, action="approve_proposal",
                target_type="proposal", target_id=p.id,
                detail={"expertise_id": e.id, "version": new_version, "note": body.note})
    db.commit()
    db.refresh(p)
    return _prop_to_out(p)


@router.post("/{prop_id}/reject", response_model=ProposalOut)
def reject_proposal(
    prop_id: str, body: RejectBody,
    db: Session = Depends(get_db), user: Profile = Depends(get_current_user),
):
    p = db.get(Proposal, prop_id)
    if not p:
        raise HTTPException(status_code=404, detail="Proposal not found.")
    if p.status != "open":
        raise HTTPException(status_code=400, detail=f"Proposal is {p.status}, not open.")

    e = db.get(Expertise, p.expertise_id)
    if e:
        block = review_block(user, e.domain, owner=e.owner, author=p.author)
        if block:
            raise HTTPException(status_code=403, detail=block)

    p.status = "rejected"
    write_audit(db, actor_id=user.id, actor_role=user.role, action="reject_proposal",
                target_type="proposal", target_id=p.id, detail={"reason": body.reason})
    db.commit()
    db.refresh(p)
    return _prop_to_out(p)
