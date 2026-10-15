"""Impact router — aggregates existing governance/usage data into a single,
honest "is this actually working" view.

Nothing here is a new source of truth: every number is a straightforward
COUNT/AVG over tables the app already writes to (Expertise, Proposal,
Feedback, AuditLog). This exists because none of those numbers were
visible anywhere as a summary -- a reviewer (or anyone evaluating the
project) had to page through individual records to get a sense of whether
the system is actually being used and actually working, rather than just
theoretically capable of it.
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..db import get_db
from ..models import Expertise, Proposal, Feedback, AuditLog, Profile

router = APIRouter(prefix="/api", tags=["impact"])


class DomainBreakdown(BaseModel):
    domain: str
    total: int
    approved: int


class TrendOut(BaseModel):
    """Daily cumulative snapshots over the trailing window, derived from the
    same timestamped tables as the headline numbers (Expertise.created_at,
    AuditLog.at, Feedback.date) -- not a separate metrics pipeline, just the
    existing rows read as a timeline instead of a single total."""

    labels: list[str]  # short date labels, oldest first
    totalExpertise: list[int]
    approvalRate: list[float | None]
    feedbackPositiveRate: list[float | None]
    proposalsReviewed: list[int]


class ImpactOut(BaseModel):
    totalExpertise: int
    approvedExpertise: int
    inReviewExpertise: int
    draftExpertise: int
    deprecatedExpertise: int
    approvalRate: float | None  # approved / (approved + deprecated) among ever-approved work, 0-1
    totalUsage: int  # sum of Expertise.usage_count -- how many answers were grounded in approved Expertise
    feedbackUp: int
    feedbackDown: int
    feedbackPositiveRate: float | None  # up / (up + down), 0-1
    openProposals: int
    approvedProposals: int
    rejectedProposals: int
    proposalApprovalRate: float | None
    auditEventCount: int
    contributorCount: int  # distinct actors who've taken a governance action (create/submit/propose)
    byDomain: list[DomainBreakdown]
    trend: TrendOut

    model_config = ConfigDict(populate_by_name=True)


@router.get("/impact", response_model=ImpactOut)
def get_impact(
    user: Profile = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # --- Expertise lifecycle counts -----------------------------------------
    status_rows = db.query(Expertise.status, func.count(Expertise.id)).group_by(Expertise.status).all()
    status_counts = {s: c for s, c in status_rows}
    approved = status_counts.get("approved", 0)
    in_review = status_counts.get("in_review", 0)
    draft = status_counts.get("draft", 0)
    deprecated = status_counts.get("deprecated", 0)
    total = approved + in_review + draft + deprecated

    ever_approved = approved + deprecated  # deprecated items were approved at some point
    approval_rate = (approved / ever_approved) if ever_approved else None

    total_usage = db.query(func.coalesce(func.sum(Expertise.usage_count), 0)).scalar() or 0

    # --- Feedback (👍/👎) ----------------------------------------------------
    fb_rows = db.query(Feedback.rating, func.count(Feedback.id)).group_by(Feedback.rating).all()
    fb_counts = {r: c for r, c in fb_rows}
    up = fb_counts.get("up", 0)
    down = fb_counts.get("down", 0)
    positive_rate = (up / (up + down)) if (up + down) else None

    # --- Proposals (revisions + corrections) --------------------------------
    pr_rows = db.query(Proposal.status, func.count(Proposal.id)).group_by(Proposal.status).all()
    pr_counts = {s: c for s, c in pr_rows}
    pr_open = pr_counts.get("open", 0)
    pr_approved = pr_counts.get("approved", 0)
    pr_rejected = pr_counts.get("rejected", 0)
    pr_decided = pr_approved + pr_rejected
    pr_approval_rate = (pr_approved / pr_decided) if pr_decided else None

    # --- Audit volume + distinct contributors -------------------------------
    audit_count = db.query(func.count(AuditLog.id)).scalar() or 0
    contributor_count = (
        db.query(func.count(func.distinct(AuditLog.actor)))
        .filter(AuditLog.action.in_(["expertise.create", "expertise.submit", "proposal.create"]))
        .scalar()
        or 0
    )

    # --- Per-domain breakdown -------------------------------------------------
    dom_rows = (
        db.query(Expertise.domain, Expertise.status, func.count(Expertise.id))
        .group_by(Expertise.domain, Expertise.status)
        .all()
    )
    by_domain: dict[str, dict[str, int]] = {}
    for dom, status, count in dom_rows:
        d = by_domain.setdefault(dom, {"total": 0, "approved": 0})
        d["total"] += count
        if status == "approved":
            d["approved"] += count
    domain_breakdown = [
        DomainBreakdown(domain=dom, total=v["total"], approved=v["approved"])
        for dom, v in sorted(by_domain.items(), key=lambda kv: -kv[1]["total"])
    ]

    trend = _build_trend(db)

    return ImpactOut(
        totalExpertise=total,
        approvedExpertise=approved,
        inReviewExpertise=in_review,
        draftExpertise=draft,
        deprecatedExpertise=deprecated,
        approvalRate=approval_rate,
        totalUsage=int(total_usage),
        feedbackUp=up,
        feedbackDown=down,
        feedbackPositiveRate=positive_rate,
        openProposals=pr_open,
        approvedProposals=pr_approved,
        rejectedProposals=pr_rejected,
        proposalApprovalRate=pr_approval_rate,
        auditEventCount=audit_count,
        contributorCount=contributor_count,
        byDomain=domain_breakdown,
        trend=trend,
    )


def _build_trend(db: Session, days: int = 14) -> TrendOut:
    """Cumulative-as-of-day snapshots for the trailing `days` days.

    Reads only the timestamp (+ rating/action, where needed) columns of each
    table -- cheap even as the tables grow -- and buckets them in Python so
    the same code runs unchanged against SQLite (tests) and Postgres (prod).
    """
    today = datetime.now(timezone.utc).date()
    day_marks = [today - timedelta(days=i) for i in range(days - 1, -1, -1)]
    # End-of-day cutoff (UTC) for each bucket, so "as of" includes everything
    # that happened that day.
    cutoffs = [datetime.combine(d, datetime.max.time(), tzinfo=timezone.utc) for d in day_marks]
    labels = [d.strftime("%-m/%-d") for d in day_marks]

    def _naive(t: datetime) -> datetime:
        # SQLite (tests) hands back naive datetimes; Postgres (prod) hands back
        # tz-aware ones. Normalize both to naive-UTC so they compare cleanly.
        return t.replace(tzinfo=None) if t.tzinfo is not None else t

    naive_cutoffs = [_naive(c) for c in cutoffs]

    def cumulative(timestamps: list[datetime | None]) -> list[int]:
        clean = sorted(_naive(t) for t in timestamps if t is not None)
        counts = []
        idx = 0
        for cutoff in naive_cutoffs:
            while idx < len(clean) and clean[idx] <= cutoff:
                idx += 1
            counts.append(idx)
        return counts

    expertise_dates = [r[0] for r in db.query(Expertise.created_at).all()]
    approve_events = [r[0] for r in db.query(AuditLog.at).filter(AuditLog.action == "expertise.approve").all()]
    deprecate_events = [r[0] for r in db.query(AuditLog.at).filter(AuditLog.action == "expertise.deprecate").all()]
    feedback_rows = db.query(Feedback.date, Feedback.rating).all()
    up_dates = [d for d, r in feedback_rows if r == "up"]
    down_dates = [d for d, r in feedback_rows if r == "down"]
    proposal_review_events = [
        r[0] for r in db.query(AuditLog.at).filter(AuditLog.action.in_(["proposal.approve", "proposal.reject"])).all()
    ]

    expertise_trend = cumulative(expertise_dates)
    approve_trend = cumulative(approve_events)
    deprecate_trend = cumulative(deprecate_events)
    approval_rate_trend = [
        (a / (a + d)) if (a + d) > 0 else None for a, d in zip(approve_trend, deprecate_trend)
    ]
    up_trend = cumulative(up_dates)
    down_trend = cumulative(down_dates)
    feedback_rate_trend = [
        (u / (u + dn)) if (u + dn) > 0 else None for u, dn in zip(up_trend, down_trend)
    ]
    proposals_trend = cumulative(proposal_review_events)

    return TrendOut(
        labels=labels,
        totalExpertise=expertise_trend,
        approvalRate=approval_rate_trend,
        feedbackPositiveRate=feedback_rate_trend,
        proposalsReviewed=proposals_trend,
    )
