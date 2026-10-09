"""Shared helpers for governance: audit logging, version bumping, snapshots."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from .models import AuditLog, Expertise, ExpertiseVersion

# The content fields that, if changed on approved Expertise, must create a
# proposal instead of editing directly (src/data/expertise.js CONTENT_FIELDS).
CONTENT_FIELDS = {
    "summary", "when_to_use", "knowledge", "decision_logic", "guardrails", "escalation",
}


def write_audit(
    db: Session,
    *,
    actor_id: str | None,
    actor_role: str | None,
    action: str,
    target_type: str,
    target_id: str,
    detail: dict | None = None,
) -> AuditLog:
    """Insert an audit_log row and flush it so the id is available."""
    row = AuditLog(
        actor=actor_id,
        actor_role=actor_role,
        action=action,
        target_type=target_type,
        target_id=target_id,
        detail=detail or {},
        at=datetime.now(timezone.utc),
    )
    db.add(row)
    db.flush()
    return row


def _bump_version(current: str) -> str:
    """0.x → 1.0; otherwise minor +1 (e.g. 1.2 → 1.3)."""
    n = float(current or "0")
    if n < 1:
        return "1.0"
    parts = current.split(".")
    major = int(parts[0])
    minor = int(parts[1]) if len(parts) > 1 else 0
    return f"{major}.{minor + 1}"


def _snapshot(e: Expertise) -> dict:
    """Capture the content fields of an Expertise as a version snapshot."""
    return {
        "summary": e.summary,
        "whenToUse": e.when_to_use,
        "knowledge": e.knowledge or [],
        "decisionLogic": e.decision_logic or [],
        "guardrails": e.guardrails or [],
        "escalation": e.escalation or [],
    }


def save_version(
    db: Session,
    expertise: Expertise,
    *,
    version: str,
    author: str,
    approved_by: str | None,
    note: str,
) -> ExpertiseVersion:
    """Create an ExpertiseVersion row with a snapshot of the current content."""
    row = ExpertiseVersion(
        expertise_id=expertise.id,
        version=version,
        author=author,
        approved_by=approved_by,
        note=note,
        snapshot=_snapshot(expertise),
    )
    db.add(row)
    db.flush()
    return row


def has_content_changes(patch_data: dict) -> bool:
    """True when any content field appears in the patch."""
    return any(k in CONTENT_FIELDS for k in patch_data)
