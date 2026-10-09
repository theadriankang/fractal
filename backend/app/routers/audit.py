"""Audit router — reviewer-only, newest first."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..db import get_db
from ..models import AuditLog, Profile
from ..permissions import is_reviewer
from ..schemas import AuditOut

router = APIRouter(prefix="/api", tags=["audit"])


@router.get("/audit", response_model=list[AuditOut])
def list_audit(
    targetId: str | None = Query(default=None),
    actor: str | None = Query(default=None),
    limit: int = Query(default=100, le=500),
    db: Session = Depends(get_db),
    user: Profile = Depends(get_current_user),
):
    if not is_reviewer(user):
        raise HTTPException(status_code=403, detail="Only the Reviewer can view the audit log.")

    q = db.query(AuditLog)
    if targetId:
        q = q.filter(AuditLog.target_id == targetId)
    if actor:
        q = q.filter(AuditLog.actor == actor)
    rows = q.order_by(desc(AuditLog.at)).limit(limit).all()
    return [
        AuditOut(
            id=r.id, at=r.at, actor=r.actor, actorRole=r.actor_role,
            action=r.action, targetType=r.target_type, targetId=r.target_id,
            detail=r.detail or {},
        )
        for r in rows
    ]
