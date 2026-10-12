"""Expertise governance rules shared by the expertise, proposals and responses routers.

Ported from src/store.js so the database, not the browser, is the record: version bumps,
snapshots, serialisation to the front-end shape, and audit rows.
"""

import re
from collections import defaultdict

from sqlalchemy.orm import Session

from .models import AuditLog, Expertise, ExpertiseVersion, Feedback, Profile, Proposal
from .schemas import ExpertiseOut, ExpertiseVersionOut, ProposalOut

# src/data/expertise.js CONTENT_FIELDS, as ORM attribute names
CONTENT_FIELDS = {
    "summary": "summary",
    "whenToUse": "when_to_use",
    "knowledge": "knowledge",
    "decisionLogic": "decision_logic",
    "guardrails": "guardrails",
    "escalation": "escalation",
}
LIST_FIELDS = {k: v for k, v in CONTENT_FIELDS.items() if k not in ("summary", "whenToUse")}


def bump_version(v: str | None) -> str:
    """0.x → 1.0, otherwise minor + 1 (mirrors bumpVersion in src/store.js)."""
    try:
        if float(v or "0") < 1:
            return "1.0"
    except ValueError:
        return "1.0"
    major, _, minor = str(v).partition(".")
    return f"{int(major)}.{int(minor or 0) + 1}"


def snapshot(e: Expertise) -> dict:
    return {k: list(getattr(e, a) or []) if k in LIST_FIELDS else getattr(e, a) or "" for k, a in CONTENT_FIELDS.items()}


def restore(e: Expertise, snap: dict) -> None:
    for k, a in CONTENT_FIELDS.items():
        if k in snap:
            setattr(e, a, snap[k])


def add_version(db: Session, e: Expertise, *, author: str, approved_by: str | None, note: str, snap: dict) -> None:
    db.add(ExpertiseVersion(expertise_id=e.id, version=e.version, author=author, approved_by=approved_by, note=note, snapshot=snap))


# --- readiness (mirrors src/lib/readiness.js, required checks only) -----------

def missing_for_review(e: Expertise) -> list[str]:
    name = (e.name or "").strip()
    checks = [
        (bool(name) and not re.match(r"^untitled|^new .* expertise$", name, re.I), "a clear name"),
        (bool((e.summary or "").strip()), "one-sentence summary"),
        (bool((e.when_to_use or "").strip()), "when to use it"),
        (len(e.knowledge or []) + len(e.decision_logic or []) > 0, "at least one piece of knowledge or a decision step"),
        (len(e.guardrails or []) > 0, "at least one guardrail"),
        (len(e.escalation or []) > 0, "at least one escalation rule"),
    ]
    return [label for ok, label in checks if not ok]


# --- feedback -----------------------------------------------------------------

def _feedback_item(f: Feedback) -> dict:
    return {
        "user": f.user_name,
        "rating": f.rating,
        "comment": f.comment,
        "date": f.date.isoformat() if f.date else None,
        "chatId": f.chat_id,
        "userId": f.user_id,
        "responseKey": f.response_key,
        "version": f.version,
    }


def feedback_list(e: Expertise, rows: list[Feedback]) -> list[dict]:
    """Saved ratings (newest first), then the seed feedback stored on the row itself."""
    return [_feedback_item(f) for f in rows] + list(e.feedback or [])


def recompute_success_rate(e: Expertise, rows: list[Feedback]) -> None:
    """Helpful rate over every stored rating, as helpfulStats() in src/lib/ratings.js."""
    rated = [f for f in feedback_list(e, rows) if f.get("rating") in ("up", "down")]
    e.success_rate = sum(f["rating"] == "up" for f in rated) / len(rated) if rated else None


# --- serialisation -----------------------------------------------------------

def exp_to_out(e: Expertise, versions: list[ExpertiseVersion], feedback_rows: list[Feedback]) -> ExpertiseOut:
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
        usage_count=e.usage_count or 0,
        success_rate=e.success_rate,
        summary=e.summary or "",
        when_to_use=e.when_to_use or "",
        knowledge=e.knowledge or [],
        decision_logic=e.decision_logic or [],
        guardrails=e.guardrails or [],
        escalation=e.escalation or [],
        sources=e.sources or [],
        feedback=feedback_list(e, feedback_rows),
        origin=e.origin,
        capture=e.capture,
        author_id=e.author_id,
        created_at=e.created_at,
        updated_at=e.updated_at,
        versions=[
            ExpertiseVersionOut(
                id=str(v.id), version=v.version, date=v.date, author=v.author,
                approved_by=v.approved_by, note=v.note, snapshot=v.snapshot or {},
            )
            for v in versions
        ],
    )


def load_expertise_out(db: Session, rows: list[Expertise]) -> list[ExpertiseOut]:
    """Serialise Expertise with their versions + feedback in two extra queries."""
    ids = [e.id for e in rows]
    versions, feedback = defaultdict(list), defaultdict(list)
    if ids:
        for v in db.query(ExpertiseVersion).filter(ExpertiseVersion.expertise_id.in_(ids)).order_by(ExpertiseVersion.date):
            versions[v.expertise_id].append(v)
        for f in db.query(Feedback).filter(Feedback.expertise_id.in_(ids)).order_by(Feedback.date.desc()):
            feedback[f.expertise_id].append(f)
    return [exp_to_out(e, versions[e.id], feedback[e.id]) for e in rows]


def one_expertise_out(db: Session, e: Expertise) -> ExpertiseOut:
    return load_expertise_out(db, [e])[0]


def proposal_to_out(p: Proposal) -> ProposalOut:
    return ProposalOut(
        id=p.id, expertise_id=p.expertise_id, type=p.type, created_at=p.created_at,
        author=p.author, author_id=p.author_id, reason=p.reason, changes=p.changes or {},
        chat_id=p.chat_id, status=p.status, capture=p.capture, sources=p.sources or [],
        meeting_id=p.meeting_id, meeting_title=p.meeting_title,
    )


def apply_changes(e: Expertise, changes: dict) -> None:
    """Merge a proposal's {field: {add, remove}} diff into the Expertise."""
    for field, diff in (changes or {}).items():
        attr = LIST_FIELDS.get(field)
        if not attr:
            continue
        remove = set(diff.get("remove") or [])
        current = [x for x in (getattr(e, attr) or []) if x not in remove]
        setattr(e, attr, current + [x for x in diff.get("add") or [] if x not in current])


# --- audit -------------------------------------------------------------------

def audit(db: Session, user: Profile, action: str, target_type: str, target_id: str, **detail) -> None:
    db.add(AuditLog(actor=user.id, actor_role=user.role, action=action, target_type=target_type, target_id=target_id, detail=detail))
