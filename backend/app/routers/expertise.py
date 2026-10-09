"""Expertise router — CRUD for expertise + taxonomy mirror."""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Expertise, ExpertiseVersion, Feedback
from ..schemas import (
    ExpertiseCreate,
    ExpertiseOut,
    ExpertisePatch,
    ExpertiseVersionOut,
    FeedbackOut,
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
                id=str(v.id),
                version=v.version,
                date=v.date,
                author=v.author,
                approved_by=v.approved_by,
                note=v.note,
                snapshot=v.snapshot or {},
            )
            for v in versions
        ],
        feedback_rows=[
            FeedbackOut(
                id=str(f.id),
                expertise_id=f.expertise_id,
                response_id=f.response_id,
                user_name=f.user_name,
                rating=f.rating,
                comment=f.comment,
                date=f.date,
            )
            for f in feedback_rows
        ],
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
    versions = (
        db.query(ExpertiseVersion)
        .filter(ExpertiseVersion.expertise_id == exp_id)
        .order_by(ExpertiseVersion.date)
        .all()
    )
    feedback_rows = (
        db.query(Feedback)
        .filter(Feedback.expertise_id == exp_id)
        .order_by(Feedback.date.desc())
        .all()
    )
    return _exp_to_out(e, versions, feedback_rows)


@router.post("/expertise", response_model=ExpertiseOut, status_code=status.HTTP_201_CREATED)
def create_expertise(body: ExpertiseCreate, db: Session = Depends(get_db)):
    e = Expertise(
        id=body.id or f"exp-{uuid.uuid4().hex[:8]}",
        name=body.name,
        domain=body.domain,
        topic=body.topic,
        asset_types=body.asset_types,
        related=body.related,
        status=body.status,
        version=body.version,
        owner=body.owner,
        owner_role=body.owner_role,
        reviewer=body.reviewer,
        keywords=body.keywords,
        usage_count=body.usage_count,
        success_rate=body.success_rate,
        summary=body.summary,
        when_to_use=body.when_to_use,
        knowledge=body.knowledge,
        decision_logic=body.decision_logic,
        guardrails=body.guardrails,
        escalation=body.escalation,
        sources=body.sources,
        feedback=body.feedback,
        origin=body.origin,
    )
    db.add(e)
    db.flush()

    # persist any seed versions passed in
    for v in body.versions:
        db.add(
            ExpertiseVersion(
                expertise_id=e.id,
                version=v.get("version", ""),
                date=v.get("date"),
                author=v.get("author", ""),
                approved_by=v.get("approvedBy"),
                note=v.get("note", ""),
                snapshot=v.get("snapshot", {}),
            )
        )

    db.commit()
    db.refresh(e)
    return _exp_to_out(e, [], [])


@router.patch("/expertise/{exp_id}", response_model=ExpertiseOut)
def patch_expertise(exp_id: str, body: ExpertisePatch, db: Session = Depends(get_db)):
    e = db.get(Expertise, exp_id)
    if not e:
        raise HTTPException(status_code=404, detail="Expertise not found")
    data = body.model_dump(exclude_unset=True, by_alias=False)
    for k, v in data.items():
        setattr(e, k, v)
    e.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(e)
    return _exp_to_out(e, [], [])
