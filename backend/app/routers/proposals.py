"""Proposals router — read-only for now (writes go through governance flow)."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Proposal
from ..schemas import ProposalOut

router = APIRouter(prefix="/api/proposals", tags=["proposals"])


@router.get("", response_model=list[ProposalOut])
def list_proposals(db: Session = Depends(get_db)):
    rows = db.query(Proposal).order_by(Proposal.created_at.desc()).all()
    return [
        ProposalOut(
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
        for p in rows
    ]
