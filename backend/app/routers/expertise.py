"""Expertise router — CRUD + governance (submit, approve, reject, rollback, deprecate, restore, feedback)."""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..db import get_db
from ..governance import (
    CONTENT_FIELDS,
    _bump_version,
    _snapshot,
    has_content_changes,
    save_version,
    write_audit,
)
from ..models import Expertise, ExpertiseVersion, Feedback, Profile, Proposal
from ..permissions import (
    can_contribute,
    can_govern,
    can_review,
    contribute_block,
    review_block,
)
from ..schemas import (
    ApproveBody,
    ExpertiseCreate,
    ExpertiseOut,
    ExpertisePatch,
    ExpertiseVersionOut,
    FeedbackCreate,
    FeedbackOut,
    RejectBody,
    RollbackBody,
)

router = APIRouter(prefix="/api", tags=["expertise"])

# --- Taxonomy (mirrors src/data/taxonomy.js) --------------------------------

_TAXONOMY = [
    {"domain": "Technical Services", "topics": ["Chillers & HVAC", "Lifts & Escalators", "Electrical & Power", "Plumbing & Water"], "description": "Fault diagnosis, maintenance and safety for building systems."},
    {"domain": "Energy Optimisation", "topics": ["Peak Demand", "Chiller Plant Efficiency", "Solar & Renewables"], "description": "Reducing consumption and demand charges without hurting comfort."},
    {"domain": "Asset Operations", "topics": ["Budgeting & CAPEX", "Vendor Management", "Operating Procedures"], "description": "Running the asset day to day — budgets, vendors and procedures."},
    {"domain": "Tenant Experience", "topics": ["Complaints & Feedback", "Communications", "Amenities"], "description": "How we respond to, inform and look after tenants."},
    {"domain": "Leasing", "topics": ["Renewals & Retention", "Rent Reviews", "New Leasing"], "description": "Retention, renewals and commercial negotiation."},
    {"domain": "Sustainability", "topics": ["Carbon Reporting", "Green Mark", "Waste & Water"], "description": "Carbon, certification and resource reporting."},
]

_ASSET_TYPES = ["Office", "Data Centre", "Logistics", "Retail"]


@router.get("/taxonomy")
def get_taxonomy():
    return {"taxonomy": _TAXONOMY, "assetTypes": _ASSET_TYPES}


# --- helpers ----------------------------------------------------------------

def _exp_to_out(e: Expertise, versions: list[ExpertiseVersion], feedback_rows: list[Feedback]) -> ExpertiseOut:
    return ExpertiseOut(
        id=e.id,
        name=e.name,
        domain=e.domain,
        topic=e.topic,
        asset_types=e.asset_types or [],
        related=e.related or [],
        status=e.status,
        version=e.version,
        owner=e.owner,
        owner_role=e.owner_role,
        reviewer=e.reviewer,
        keywords=e.keywords or [],
        usage_count=e.usage_count,
        success_rate=e.success_rate,
        summary=e.summary,
        when_to_use=e.when_to_use,
        knowledge=e.knowledge or [],
        decision_logic=e.decision_logic or [],
        guardrails=e.guardrails or [],
        escalation=e.escalation or [],
        sources=e.sources or [],
        feedback=e.feedback or [],
        origin=e.origin,
        created_at=e.created_at,
        updated_at=e.updated_at,
        versions=[
            ExpertiseVersionOut(
                id=str(v.id), version=v.version, date=v.date, author=v.author,
                approved_by=v.approved_by, note=v.note, snapshot=v.snapshot or {},
            )
            for v in versions
        ],
        feedback_rows=[
            FeedbackOut(
                id=str(f.id), expertise_id=f.expertise_id, response_id=f.response_id,
                user_name=f.user_name, rating=f.rating, comment=f.comment, date=f.date,
            )
            for f in feedback_rows
        ],
    )


def _get_versions(db: Session, exp_id: str) -> list[ExpertiseVersion]:
    return (
        db.query(ExpertiseVersion)
        .filter(ExpertiseVersion.expertise_id == exp_id)
        .order_by(ExpertiseVersion.date)
        .all()
    )


def _get_feedback(db: Session, exp_id: str) -> list[Feedback]:
    return (
        db.query(Feedback)
        .filter(Feedback.expertise_id == exp_id)
        .order_by(Feedback.date.desc())
        .all()
    )


# --- list + create ----------------------------------------------------------

@router.get("/expertise", response_model=list[ExpertiseOut])
def list_expertise(db: Session = Depends(get_db)):
    rows = db.query(Expertise).order_by(Expertise.created_at).all()
    return [_exp_to_out(e, [], []) for e in rows]


@router.get("/expertise/{exp_id}", response_model=ExpertiseOut)
def get_expertise(exp_id: str, db: Session = Depends(get_db)):
    e = db.get(Expertise, exp_id)
    if not e:
        raise HTTPException(status_code=404, detail="Expertise not found")
    return _exp_to_out(e, _get_versions(db, exp_id), _get_feedback(db, exp_id))


@router.post("/expertise", response_model=ExpertiseOut, status_code=status.HTTP_201_CREATED)
def create_expertise(body: ExpertiseCreate, db: Session = Depends(get_db), user: Profile = Depends(get_current_user)):
    block = contribute_block(user, body.domain)
    if block:
        raise HTTPException(status_code=403, detail=block)
    e = Expertise(
        id=body.id or f"exp-{uuid.uuid4().hex[:8]}",
        name=body.name, domain=body.domain, topic=body.topic,
        asset_types=body.asset_types, related=body.related,
        status=body.status, version=body.version,
        owner=user.name, owner_role=user.role,
        reviewer=body.reviewer, keywords=body.keywords,
        usage_count=body.usage_count, success_rate=body.success_rate,
        summary=body.summary, when_to_use=body.when_to_use,
        knowledge=body.knowledge, decision_logic=body.decision_logic,
        guardrails=body.guardrails, escalation=body.escalation,
        sources=body.sources, feedback=body.feedback, origin=body.origin,
    )
    db.add(e)
    db.flush()
    for v in body.versions:
        db.add(ExpertiseVersion(
            expertise_id=e.id, version=v.get("version", ""), date=v.get("date"),
            author=v.get("author", ""), approved_by=v.get("approvedBy"),
            note=v.get("note", ""), snapshot=v.get("snapshot", {}),
        ))
    write_audit(db, actor_id=user.id, actor_role=user.role, action="create_expertise",
                target_type="expertise", target_id=e.id, detail={"name": e.name})
    db.commit()
    db.refresh(e)
    return _exp_to_out(e, [], [])


# --- PATCH (metadata direct; content changes → proposal) --------------------

@router.patch("/expertise/{exp_id}", response_model=ExpertiseOut)
def patch_expertise(
    exp_id: str, body: ExpertisePatch,
    db: Session = Depends(get_db), user: Profile = Depends(get_current_user),
):
    e = db.get(Expertise, exp_id)
    if not e:
        raise HTTPException(status_code=404, detail="Expertise not found")

    block = contribute_block(user, e.domain)
    if block:
        raise HTTPException(status_code=403, detail=block)

    data = body.model_dump(exclude_unset=True, by_alias=False)

    # If approved and content fields change, create a proposal instead of editing.
    if e.status == "approved" and has_content_changes(data):
        changes: dict[str, dict] = {}
        for field in CONTENT_FIELDS:
            if field in data:
                current = getattr(e, field) or []
                new_val = data[field]
                if isinstance(current, list) and isinstance(new_val, list):
                    add = [x for x in new_val if x not in current]
                    remove = [x for x in current if x not in new_val]
                else:
                    add = [new_val] if new_val != current else []
                    remove = [current] if new_val != current and current else []
                if add or remove:
                    changes[field] = {"add": add, "remove": remove}
        if changes:
            prop = Proposal(
                id=f"prop-{uuid.uuid4().hex[:8]}",
                expertise_id=e.id, type="revision",
                author=f"{user.name} (edit on approved)",
                reason="Edit on approved Expertise — changes routed to Review Queue.",
                changes=changes, status="open",
            )
            db.add(prop)
            write_audit(db, actor_id=user.id, actor_role=user.role,
                        action="edit_approved_creates_proposal",
                        target_type="expertise", target_id=e.id,
                        detail={"proposal_id": prop.id, "changes": changes})
            db.commit()
            db.refresh(e)
            return _exp_to_out(e, _get_versions(db, exp_id), _get_feedback(db, exp_id))

    # Metadata (non-content) fields update directly.
    for k, v in data.items():
        if k not in CONTENT_FIELDS:
            setattr(e, k, v)
    e.updated_at = datetime.now(timezone.utc)
    write_audit(db, actor_id=user.id, actor_role=user.role, action="patch_expertise",
                target_type="expertise", target_id=e.id, detail={"fields": list(data.keys())})
    db.commit()
    db.refresh(e)
    return _exp_to_out(e, _get_versions(db, exp_id), _get_feedback(db, exp_id))


# --- governance: submit / approve / reject / deprecate / restore / rollback --

@router.post("/expertise/{exp_id}/submit", response_model=ExpertiseOut)
def submit_expertise(exp_id: str, db: Session = Depends(get_db), user: Profile = Depends(get_current_user)):
    e = db.get(Expertise, exp_id)
    if not e:
        raise HTTPException(status_code=404, detail="Expertise not found")
    if e.status != "draft":
        raise HTTPException(status_code=400, detail=f"Only draft Expertise can be submitted (current: {e.status}).")

    # Author or domain expert may submit.
    block = contribute_block(user, e.domain)
    if block and e.owner != user.name:
        raise HTTPException(status_code=403, detail=block)

    e.status = "in_review"
    e.updated_at = datetime.now(timezone.utc)
    write_audit(db, actor_id=user.id, actor_role=user.role, action="submit_expertise",
                target_type="expertise", target_id=e.id)
    db.commit()
    db.refresh(e)
    return _exp_to_out(e, _get_versions(db, exp_id), _get_feedback(db, exp_id))


@router.post("/expertise/{exp_id}/approve", response_model=ExpertiseOut)
def approve_expertise(
    exp_id: str, body: ApproveBody,
    db: Session = Depends(get_db), user: Profile = Depends(get_current_user),
):
    e = db.get(Expertise, exp_id)
    if not e:
        raise HTTPException(status_code=404, detail="Expertise not found")
    if e.status != "in_review":
        raise HTTPException(status_code=400, detail=f"Only in-review Expertise can be approved (current: {e.status}).")

    block = review_block(user, e.domain, owner=e.owner)
    if block:
        raise HTTPException(status_code=403, detail=block)

    new_version = _bump_version(e.version)
    e.status = "approved"
    e.version = new_version
    e.reviewer = user.name
    e.updated_at = datetime.now(timezone.utc)
    save_version(db, e, version=new_version, author=e.owner, approved_by=user.name, note=body.note)
    write_audit(db, actor_id=user.id, actor_role=user.role, action="approve_expertise",
                target_type="expertise", target_id=e.id, detail={"version": new_version, "note": body.note})
    db.commit()
    db.refresh(e)
    return _exp_to_out(e, _get_versions(db, exp_id), _get_feedback(db, exp_id))


@router.post("/expertise/{exp_id}/reject", response_model=ExpertiseOut)
def reject_expertise(
    exp_id: str, body: RejectBody,
    db: Session = Depends(get_db), user: Profile = Depends(get_current_user),
):
    e = db.get(Expertise, exp_id)
    if not e:
        raise HTTPException(status_code=404, detail="Expertise not found")
    if e.status != "in_review":
        raise HTTPException(status_code=400, detail=f"Only in-review Expertise can be rejected (current: {e.status}).")

    block = review_block(user, e.domain, owner=e.owner)
    if block:
        raise HTTPException(status_code=403, detail=block)

    e.status = "draft"
    e.updated_at = datetime.now(timezone.utc)
    write_audit(db, actor_id=user.id, actor_role=user.role, action="reject_expertise",
                target_type="expertise", target_id=e.id, detail={"reason": body.reason})
    db.commit()
    db.refresh(e)
    return _exp_to_out(e, _get_versions(db, exp_id), _get_feedback(db, exp_id))


@router.post("/expertise/{exp_id}/deprecate", response_model=ExpertiseOut)
def deprecate_expertise(exp_id: str, db: Session = Depends(get_db), user: Profile = Depends(get_current_user)):
    e = db.get(Expertise, exp_id)
    if not e:
        raise HTTPException(status_code=404, detail="Expertise not found")
    if not can_govern(user):
        raise HTTPException(status_code=403, detail="Only the Reviewer can deprecate Expertise.")
    e.status = "deprecated"
    e.updated_at = datetime.now(timezone.utc)
    write_audit(db, actor_id=user.id, actor_role=user.role, action="deprecate_expertise",
                target_type="expertise", target_id=e.id)
    db.commit()
    db.refresh(e)
    return _exp_to_out(e, _get_versions(db, exp_id), _get_feedback(db, exp_id))


@router.post("/expertise/{exp_id}/restore", response_model=ExpertiseOut)
def restore_expertise(exp_id: str, db: Session = Depends(get_db), user: Profile = Depends(get_current_user)):
    e = db.get(Expertise, exp_id)
    if not e:
        raise HTTPException(status_code=404, detail="Expertise not found")
    if not can_govern(user):
        raise HTTPException(status_code=403, detail="Only the Reviewer can restore Expertise.")
    e.status = "approved"
    e.updated_at = datetime.now(timezone.utc)
    write_audit(db, actor_id=user.id, actor_role=user.role, action="restore_expertise",
                target_type="expertise", target_id=e.id)
    db.commit()
    db.refresh(e)
    return _exp_to_out(e, _get_versions(db, exp_id), _get_feedback(db, exp_id))


@router.post("/expertise/{exp_id}/rollback", response_model=ExpertiseOut)
def rollback_expertise(
    exp_id: str, body: RollbackBody,
    db: Session = Depends(get_db), user: Profile = Depends(get_current_user),
):
    e = db.get(Expertise, exp_id)
    if not e:
        raise HTTPException(status_code=404, detail="Expertise not found")
    if not can_govern(user):
        raise HTTPException(status_code=403, detail="Only the Reviewer can roll back Expertise.")

    target = (
        db.query(ExpertiseVersion)
        .filter(ExpertiseVersion.expertise_id == exp_id, ExpertiseVersion.version == body.version)
        .first()
    )
    if not target:
        raise HTTPException(status_code=404, detail=f"Version {body.version} not found.")

    snap = target.snapshot or {}
    if "summary" in snap: e.summary = snap["summary"]
    if "whenToUse" in snap: e.when_to_use = snap["whenToUse"]
    if "knowledge" in snap: e.knowledge = snap["knowledge"]
    if "decisionLogic" in snap: e.decision_logic = snap["decisionLogic"]
    if "guardrails" in snap: e.guardrails = snap["guardrails"]
    if "escalation" in snap: e.escalation = snap["escalation"]

    new_version = _bump_version(e.version)
    e.version = new_version
    e.status = "approved"
    e.updated_at = datetime.now(timezone.utc)
    save_version(db, e, version=new_version, author=user.name, approved_by=user.name,
                 note=f"Rolled back to v{body.version}")
    write_audit(db, actor_id=user.id, actor_role=user.role, action="rollback_expertise",
                target_type="expertise", target_id=e.id,
                detail={"from_version": body.version, "to_version": new_version})
    db.commit()
    db.refresh(e)
    return _exp_to_out(e, _get_versions(db, exp_id), _get_feedback(db, exp_id))


# --- feedback ---------------------------------------------------------------

@router.post("/expertise/{exp_id}/feedback", response_model=ExpertiseOut)
def post_feedback(
    exp_id: str, body: FeedbackCreate,
    db: Session = Depends(get_db), user: Profile = Depends(get_current_user),
):
    e = db.get(Expertise, exp_id)
    if not e:
        raise HTTPException(status_code=404, detail="Expertise not found")

    fb = Feedback(
        expertise_id=exp_id, response_id=None,
        user_name=user.name, rating=body.rating,
        comment=body.comment, chat_id=body.chatId,
    )
    db.add(fb)

    # Recompute successRate
    all_fb = _get_feedback(db, exp_id) + [fb]
    ups = sum(1 for f in all_fb if f.rating == "up")
    total = len(all_fb)
    e.success_rate = round(ups / total, 3) if total else None

    # A down rating with a comment creates an open proposal adding the comment to knowledge.
    if body.rating == "down" and body.comment.strip():
        prop = Proposal(
            id=f"prop-{uuid.uuid4().hex[:8]}",
            expertise_id=exp_id, type="revision",
            author=f"{user.name} (via 👎 feedback)",
            reason=body.comment,
            changes={"knowledge": {"add": [body.comment], "remove": []}},
            chat_id=body.chatId, status="open",
        )
        db.add(prop)
        write_audit(db, actor_id=user.id, actor_role=user.role, action="feedback_creates_proposal",
                    target_type="expertise", target_id=exp_id,
                    detail={"proposal_id": prop.id, "rating": "down", "comment": body.comment})

    write_audit(db, actor_id=user.id, actor_role=user.role, action="feedback",
                target_type="expertise", target_id=exp_id,
                detail={"rating": body.rating, "comment": body.comment})
    db.commit()
    db.refresh(e)
    return _exp_to_out(e, _get_versions(db, exp_id), _get_feedback(db, exp_id))
