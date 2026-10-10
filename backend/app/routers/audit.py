"""Audit log router — read-only endpoint that makes governance actions visible.

Every governance action (approve, reject, rollback, deprecate, restore, submit,
create, update, delete, proposal decisions, rating, chat source view) already
writes an ``audit_log`` row via ``app.governance.audit()``.  This router exposes
those rows with role-based access, human-readable summaries and cursor pagination.
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..db import get_db
from ..models import AuditLog, Expertise, Profile, Proposal

router = APIRouter(prefix="/api", tags=["audit"])


# ---------------------------------------------------------------------------
# Response schema (camelCase, matching the front-end convention)
# ---------------------------------------------------------------------------

class ActorOut(BaseModel):
    id: Optional[str] = None
    name: str = ""
    role: Optional[str] = None


class AuditEntryOut(BaseModel):
    id: int
    at: datetime
    actor: ActorOut
    action: str
    targetType: Optional[str] = None
    targetId: Optional[str] = None
    targetName: Optional[str] = None
    domain: Optional[str] = None
    version: Optional[str] = None
    summary: str
    detail: dict

    model_config = ConfigDict(populate_by_name=True)


class AuditPage(BaseModel):
    entries: list[AuditEntryOut]
    hasMore: bool


# ---------------------------------------------------------------------------
# Summary text generation
# ---------------------------------------------------------------------------

_VERB = {
    "expertise.create": "created",
    "expertise.update": "updated",
    "expertise.submit": "submitted for review",
    "expertise.approve": "approved",
    "expertise.reject": "rejected",
    "expertise.deprecate": "deprecated",
    "expertise.restore": "restored",
    "expertise.rollback": "rolled back",
    "expertise.delete": "deleted",
    "proposal.create": "proposed a revision to",
    "proposal.approve": "approved a revision to",
    "proposal.reject": "rejected a revision to",
    "response.rate": "rated an answer",
    "chat.view_source": "viewed",
}


def _summary(row: AuditLog, actor_name: str, target_name: str | None) -> str:
    """One human sentence, e.g. 'Adrian Kang approved Chiller Plant Fault Triage v1.4'."""
    name = actor_name or "Someone"
    action = row.action or ""
    verb = _VERB.get(action, action)

    # chat.view_source — different shape: "X viewed Y's source conversation"
    if action == "chat.view_source":
        owner = (row.detail or {}).get("owner_name") or "someone's"
        return f"{name} viewed {owner}'s source conversation"

    # response.rate — "X rated an answer"
    if action == "response.rate":
        rating = (row.detail or {}).get("rating")
        if rating == "up":
            return f"{name} rated an answer helpful"
        if rating == "down":
            return f"{name} rated an answer unhelpful"
        return f"{name} cleared a rating"

    # expertise / proposal actions
    tgt = target_name or "an item"
    version = (row.detail or {}).get("version")

    if action == "expertise.rollback":
        to_v = (row.detail or {}).get("to")
        return f"{name} rolled back {tgt} to v{to_v}" + (f" (now v{version})" if version else "")

    if action == "expertise.create":
        origin = (row.detail or {}).get("origin")
        suffix = " (auto-detected)" if origin == "auto-detected" else ""
        return f"{name} created {tgt}{suffix}"

    if action == "expertise.update":
        fields = (row.detail or {}).get("fields")
        suffix = f" ({', '.join(fields)})" if fields else ""
        return f"{name} updated {tgt}{suffix}"

    if action == "proposal.create":
        via = (row.detail or {}).get("via")
        suffix = " via 👎 feedback" if via == "feedback" else ""
        return f"{name} proposed a revision to {tgt}{suffix}"

    suffix = f" v{version}" if version else ""
    return f"{name} {verb} {tgt}{suffix}".strip()


# ---------------------------------------------------------------------------
# Domain resolution (for access control + filtering)
# ---------------------------------------------------------------------------

def _resolve_domains(db: Session, rows: list[AuditLog]) -> dict[str, str | None]:
    """Map each audit row's target_id → the domain of the Expertise it concerns.

    For proposals we follow expertiseId in the detail payload.
    Returns {row.id: domain_or_None}.
    """
    # Collect every target/expertise id we need to look up.
    target_ids: set[str] = set()
    proposal_ids: set[str] = set()
    for r in rows:
        if r.target_type == "expertise" and r.target_id:
            target_ids.add(r.target_id)
        elif r.target_type == "proposal" and r.target_id:
            proposal_ids.add(r.target_id)
            # detail.expertiseId is set when the proposal audit was written
            eid = (r.detail or {}).get("expertiseId")
            if eid:
                target_ids.add(eid)

    domains: dict[str, str | None] = {}
    for e in db.query(Expertise).filter(Expertise.id.in_(target_ids)).all() if target_ids else []:
        domains[e.id] = e.domain

    # Proposals: look up their expertise's domain, or use detail.expertiseId.
    for p in db.query(Proposal).filter(Proposal.id.in_(proposal_ids)).all() if proposal_ids else []:
        e = db.get(Expertise, p.expertise_id)
        domains[p.id] = e.domain if e else None

    result: dict[str, str | None] = {}
    for r in rows:
        dom = None
        if r.target_type == "expertise" and r.target_id:
            dom = domains.get(r.target_id)
        elif r.target_type == "proposal" and r.target_id:
            dom = domains.get(r.target_id)
            if not dom:
                eid = (r.detail or {}).get("expertiseId")
                dom = domains.get(eid) if eid else None
        result[r.id] = dom
    return result


# ---------------------------------------------------------------------------
# Name resolution (batch, no N+1)
# ---------------------------------------------------------------------------

def _resolve_names(db: Session, rows: list[AuditLog]) -> tuple[dict[str, Profile], dict[str, str]]:
    """Batch-resolve actor profiles and target names.

    Returns ({actor_id: Profile}, {target_key: name}).
    """
    actor_ids = {r.actor for r in rows if r.actor}
    target_expertise_ids: set[str] = set()
    target_proposal_ids: set[str] = set()
    for r in rows:
        if r.target_type == "expertise" and r.target_id:
            target_expertise_ids.add(r.target_id)
        elif r.target_type == "proposal" and r.target_id:
            target_proposal_ids.add(r.target_id)
        # Proposals store expertiseId in their detail payload.
        eid = (r.detail or {}).get("expertiseId")
        if eid:
            target_expertise_ids.add(eid)

    actors: dict[str, Profile] = {}
    if actor_ids:
        for p in db.query(Profile).filter(Profile.id.in_(actor_ids)).all():
            actors[str(p.id)] = p

    # Batch-fetch all expertise names we'll need (for proposals too).
    target_names: dict[str, str] = {}
    exp_domains: dict[str, str] = {}
    if target_expertise_ids:
        for e in db.query(Expertise).filter(Expertise.id.in_(target_expertise_ids)).all():
            target_names[e.id] = e.name
            exp_domains[e.id] = e.domain

    if target_proposal_ids:
        proposals = db.query(Proposal).filter(Proposal.id.in_(target_proposal_ids)).all()
        # Collect all proposal→expertise ids and batch-fetch any names we don't have yet.
        proposal_eids = {p.expertise_id for p in proposals}
        missing = proposal_eids - set(target_names.keys())
        if missing:
            for e in db.query(Expertise).filter(Expertise.id.in_(missing)).all():
                target_names[e.id] = e.name
        for p in proposals:
            target_names[p.id] = target_names.get(p.expertise_id) or f"revision to {p.expertise_id}"

    return actors, target_names


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.get("/audit", response_model=AuditPage)
def list_audit(
    targetId: Optional[str] = Query(None),
    actor: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    domain: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    before: Optional[str] = Query(None),
    user: Profile = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return audit log entries newest-first with cursor pagination.

    - Reviewer sees everything.
    - Domain experts see only entries whose target Expertise (or proposal's
      Expertise) is in one of their domains.
    - Interns get 403.
    """
    if user.role == "intern":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Interns can't view the audit log.")

    # --- Build query --------------------------------------------------------
    q = db.query(AuditLog)

    if targetId:
        q = q.filter(AuditLog.target_id == targetId)
    if actor:
        # Match by actor id or actor name (case-insensitive on name).
        q = q.join(Profile, AuditLog.actor == Profile.id, isouter=True).filter(
            func.lower(Profile.email) == actor.strip().lower()
        )
    if action:
        # Allow prefix match (e.g. "expertise." or "proposal.").
        if action.endswith("."):
            q = q.filter(AuditLog.action.like(f"{action}%"))
        else:
            q = q.filter(AuditLog.action == action)
    if before:
        try:
            cutoff = datetime.fromisoformat(before.replace("Z", "+00:00"))
            q = q.filter(AuditLog.at < cutoff)
        except ValueError:
            pass

    q = q.order_by(AuditLog.at.desc(), AuditLog.id.desc()).limit(limit + 1)
    rows = q.all()

    has_more = len(rows) > limit
    rows = rows[:limit]

    if not rows:
        return AuditPage(entries=[], hasMore=False)

    # --- Resolve domains for access control + filtering ---------------------
    domains = _resolve_domains(db, rows)

    # Contributor: keep only entries in the user's domains.
    if user.role != "reviewer":
        user_domains = set(user.domains or [])
        rows = [r for r in rows if domains.get(r.id) in user_domains]

    # Domain filter (reviewer or expert can further narrow).
    if domain:
        rows = [r for r in rows if domains.get(r.id) == domain]

    if not rows:
        return AuditPage(entries=[], hasMore=False)

    # --- Resolve names (batch) ---------------------------------------------
    actors_map, target_names = _resolve_names(db, rows)

    entries: list[AuditEntryOut] = []
    for r in rows:
        actor_p = actors_map.get(r.actor) if r.actor else None
        actor_name = actor_p.name if actor_p else None
        actor_role = actor_p.role if actor_p else r.actor_role

        tgt_name = None
        if r.target_type == "expertise" and r.target_id:
            tgt_name = target_names.get(r.target_id)
        elif r.target_type == "proposal" and r.target_id:
            tgt_name = target_names.get(r.target_id)
        elif r.target_type == "chat" and r.target_id:
            tgt_name = "source conversation"

        version = (r.detail or {}).get("version")
        summary = _summary(r, actor_name or "", tgt_name)

        entries.append(AuditEntryOut(
            id=r.id,
            at=r.at,
            actor=ActorOut(
                id=r.actor,
                name=actor_name or (r.actor or "Unknown"),
                role=actor_role,
            ),
            action=r.action,
            targetType=r.target_type,
            targetId=r.target_id,
            targetName=tgt_name,
            domain=domains.get(r.id),
            version=version if isinstance(version, str) else None,
            summary=summary,
            detail={k: v for k, v in (r.detail or {}).items()},
        ))

    return AuditPage(entries=entries, hasMore=has_more)
