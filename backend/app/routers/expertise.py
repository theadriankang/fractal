"""Expertise router — CRUD, governance actions (submit / approve / reject / deprecate /
restore / rollback) and the taxonomy mirror. Writes check the role rules in app/auth.py
and leave an audit_log row."""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..auth import get_current_user, in_domain, require_contributor, require_governor, require_reviewer_for
from ..db import get_db
from ..governance import (
    add_version, audit, bump_version, load_expertise_out, missing_for_review, one_expertise_out, restore, snapshot,
)
from ..models import Expertise, ExpertiseVersion, Profile
from ..retrieval.index import delete_embedding, index_expertise, search as retrieval_search
from ..schemas import (
    ApproveIn, ExpertiseCreate, ExpertiseMatchItem, ExpertiseMatchRequest, ExpertiseOut, ExpertisePatch, RollbackIn, UsageIn,
)

router = APIRouter(prefix="/api", tags=["expertise"])

# --- Taxonomy (mirrors src/data/taxonomy.js) --------------------------------

_TAXONOMY = [
    {
        "domain": "Technical Services",
        "topics": ["Chillers & HVAC", "Lifts & Escalators", "Electrical & Power", "Plumbing & Water"],
        "description": "Fault diagnosis, maintenance and safety for building systems.",
    },
    {
        "domain": "Energy Optimisation",
        "topics": ["Peak Demand", "Chiller Plant Efficiency", "Solar & Renewables"],
        "description": "Reducing consumption and demand charges without hurting comfort.",
    },
    {
        "domain": "Asset Operations",
        "topics": ["Budgeting & CAPEX", "Vendor Management", "Operating Procedures"],
        "description": "Running the asset day to day — budgets, vendors and procedures.",
    },
    {
        "domain": "Tenant Experience",
        "topics": ["Complaints & Feedback", "Communications", "Amenities"],
        "description": "How we respond to, inform and look after tenants.",
    },
    {
        "domain": "Leasing",
        "topics": ["Renewals & Retention", "Rent Reviews", "New Leasing"],
        "description": "Retention, renewals and commercial negotiation.",
    },
    {
        "domain": "Sustainability",
        "topics": ["Carbon Reporting", "Green Mark", "Waste & Water"],
        "description": "Carbon, certification and resource reporting.",
    },
]

_ASSET_TYPES = ["Office", "Data Centre", "Logistics", "Retail"]


@router.get("/taxonomy")
def get_taxonomy():
    return {
        "taxonomy": _TAXONOMY,
        "assetTypes": _ASSET_TYPES,
    }


# --- helpers ----------------------------------------------------------------

def _get(db: Session, exp_id: str) -> Expertise:
    e = db.get(Expertise, exp_id)
    if not e:
        raise HTTPException(status_code=404, detail="Expertise not found")
    return e


def _save(db: Session, e: Expertise) -> ExpertiseOut:
    e.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(e)
    # Keep the embedding in sync when the Expertise is approved.
    if e.status == "approved":
        index_expertise(db, e)
    return one_expertise_out(db, e)


def _contributor_or_reviewer(user: Profile, domain: str) -> None:
    """Drafts may be started by the Reviewer or by an expert in that domain."""
    if user.role != "reviewer":
        require_contributor(user, domain)


# --- list + create ----------------------------------------------------------

@router.get("/expertise", response_model=list[ExpertiseOut])
def list_expertise(db: Session = Depends(get_db)):
    rows = db.query(Expertise).order_by(Expertise.created_at).all()
    return load_expertise_out(db, rows)


@router.get("/expertise/{exp_id}", response_model=ExpertiseOut)
def get_expertise(exp_id: str, db: Session = Depends(get_db)):
    return one_expertise_out(db, _get(db, exp_id))


@router.post("/expertise", response_model=ExpertiseOut, status_code=status.HTTP_201_CREATED)
def create_expertise(
    body: ExpertiseCreate,
    user: Profile = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _contributor_or_reviewer(user, body.domain)
    if body.id and db.get(Expertise, body.id):
        raise HTTPException(status_code=409, detail="Expertise id already exists")
    data = body.model_dump(exclude={"id", "versions"})
    # New Expertise always starts as a draft; only the review flow makes it live.
    data.update(status="draft", version=body.version if body.status == "draft" else "0.1")
    e = Expertise(id=body.id or f"exp-{uuid.uuid4().hex[:8]}", **data)
    db.add(e)
    audit(db, user, "expertise.create", "expertise", e.id, name=e.name, origin=e.origin)
    return _save(db, e)


# Content and metadata edits. Status and version change only through the actions below.
_GOVERNED = {"status", "version", "reviewer", "usage_count", "success_rate"}


@router.patch("/expertise/{exp_id}", response_model=ExpertiseOut)
def patch_expertise(
    exp_id: str,
    body: ExpertisePatch,
    user: Profile = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    e = _get(db, exp_id)
    data = body.model_dump(exclude_unset=True, by_alias=False)
    for k in _GOVERNED:
        data.pop(k, None)
    _contributor_or_reviewer(user, e.domain)
    if "domain" in data:
        _contributor_or_reviewer(user, data["domain"])
    for k, v in data.items():
        setattr(e, k, v)
    audit(db, user, "expertise.update", "expertise", e.id, fields=sorted(data))
    return _save(db, e)


@router.delete("/expertise/{exp_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_expertise(
    exp_id: str,
    user: Profile = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    e = _get(db, exp_id)
    # deleteBlock in src/lib/permissions.js: live Expertise is deprecated first, never deleted outright.
    if e.status == "approved":
        raise HTTPException(status_code=409, detail="Live Expertise can't be deleted. Deprecate it first (Reviewer only).")
    if user.role != "reviewer" and not (e.status == "draft" and user.role == "contributor" and in_domain(user, e.domain)):
        raise HTTPException(status_code=403, detail="Only the Reviewer, or a domain expert for a draft, can delete this.")
    audit(db, user, "expertise.delete", "expertise", e.id, name=e.name)
    delete_embedding(db, e.id)
    db.delete(e)
    db.commit()


@router.post("/expertise/usage", status_code=status.HTTP_204_NO_CONTENT)
def record_usage(body: UsageIn, db: Session = Depends(get_db)):
    """Counts one use for each Expertise applied to a chat answer."""
    for e in db.query(Expertise).filter(Expertise.id.in_(body.ids)):
        e.usage_count = (e.usage_count or 0) + 1
    db.commit()


# --- semantic match ----------------------------------------------------------

@router.post("/expertise/match", response_model=list[ExpertiseMatchItem])
def match_expertise(body: ExpertiseMatchRequest, db: Session = Depends(get_db)):
    """Hybrid ranking (cosine similarity + keyword boost) of approved Expertise."""
    results = retrieval_search(
        db, body.query, attached_ids=body.attached_ids, limit=body.limit,
    )
    return [ExpertiseMatchItem(**r) for r in results]


# --- governance ---------------------------------------------------------------

@router.post("/expertise/{exp_id}/submit", response_model=ExpertiseOut)
def submit_for_review(exp_id: str, user: Profile = Depends(get_current_user), db: Session = Depends(get_db)):
    e = _get(db, exp_id)
    require_contributor(user, e.domain)
    if e.status != "draft":
        raise HTTPException(status_code=409, detail=f"Only drafts can be submitted (this one is {e.status}).")
    missing = missing_for_review(e)
    if missing:
        raise HTTPException(status_code=422, detail=f"Not ready for review — still needs: {'; '.join(missing)}")
    e.status = "in_review"
    audit(db, user, "expertise.submit", "expertise", e.id)
    return _save(db, e)


@router.post("/expertise/{exp_id}/approve", response_model=ExpertiseOut)
def approve_expertise(
    exp_id: str,
    body: ApproveIn = ApproveIn(),
    user: Profile = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    e = _get(db, exp_id)
    require_reviewer_for(user, e.domain, (e.capture or {}).get("capturedBy") or e.owner)
    e.version = bump_version(e.version)
    e.status = "approved"
    e.reviewer = user.name
    add_version(db, e, author=e.owner, approved_by=user.name, note=body.note, snap=snapshot(e))
    audit(db, user, "expertise.approve", "expertise", e.id, version=e.version, note=body.note)
    return _save(db, e)


@router.post("/expertise/{exp_id}/reject", response_model=ExpertiseOut)
def reject_expertise(exp_id: str, user: Profile = Depends(get_current_user), db: Session = Depends(get_db)):
    e = _get(db, exp_id)
    require_reviewer_for(user, e.domain, (e.capture or {}).get("capturedBy") or e.owner)
    e.status = "draft"
    delete_embedding(db, e.id)
    audit(db, user, "expertise.reject", "expertise", e.id)
    return _save(db, e)


@router.post("/expertise/{exp_id}/deprecate", response_model=ExpertiseOut)
def deprecate_expertise(exp_id: str, user: Profile = Depends(get_current_user), db: Session = Depends(get_db)):
    e = _get(db, exp_id)
    require_governor(user)
    e.status = "deprecated"
    delete_embedding(db, e.id)
    audit(db, user, "expertise.deprecate", "expertise", e.id)
    return _save(db, e)


@router.post("/expertise/{exp_id}/restore", response_model=ExpertiseOut)
def restore_expertise(exp_id: str, user: Profile = Depends(get_current_user), db: Session = Depends(get_db)):
    e = _get(db, exp_id)
    require_governor(user)
    e.status = "approved"
    audit(db, user, "expertise.restore", "expertise", e.id)
    return _save(db, e)


@router.post("/expertise/{exp_id}/rollback", response_model=ExpertiseOut)
def rollback_expertise(
    exp_id: str,
    body: RollbackIn,
    user: Profile = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    e = _get(db, exp_id)
    require_governor(user)
    target = (
        db.query(ExpertiseVersion)
        .filter(ExpertiseVersion.expertise_id == exp_id, ExpertiseVersion.version == body.version)
        .first()
    )
    if not target or not target.snapshot:
        raise HTTPException(status_code=404, detail=f"No snapshot for v{body.version}")
    restore(e, target.snapshot)
    e.version = bump_version(e.version)
    note = f"Rolled back to v{body.version}"
    add_version(db, e, author=user.name, approved_by=user.name, note=note, snap=dict(target.snapshot))
    audit(db, user, "expertise.rollback", "expertise", e.id, to=body.version, version=e.version)
    return _save(db, e)
