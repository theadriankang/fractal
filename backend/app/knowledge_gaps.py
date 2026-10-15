"""Knowledge-gap tracking.

Every time the weighing engine (app/weigh/engine.py) answers a real question, it already
names what the question needed that no approved Expertise covers -- that's the `gaps` field
on WeighResult. That was being shown once in the Weigh panel and then thrown away. This module
persists each gap, deduplicating repeats of the same wording so a knowledge gap that keeps
coming up (many "hits") stands out from one that was asked once and never again -- exactly the
"this is worth someone's time to document" signal a reviewer or contributor wants.

Deduplication is intentionally simple (exact match on normalized text) rather than fuzzy or
embedding-based: good enough for a first pass, and never silently merges two gaps that only
sound similar.
"""

import re
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from .models import KnowledgeGap


def _now():
    return datetime.now(timezone.utc)


def normalize(text: str) -> str:
    """Lowercase + collapsed whitespace, so trivial rewording of the same gap still dedupes."""
    return re.sub(r"\s+", " ", text.strip().lower())


def record_gaps(db: Session, gaps: list[str], domains: list[str], question: str) -> list[KnowledgeGap]:
    """Upsert one row per gap string: a fresh gap is created open; a repeat (by normalized
    text, regardless of status) has its hit count bumped and last_seen/question/domains
    refreshed, so a gap someone already resolved can still be seen resurfacing."""
    rows = []
    for text in gaps:
        text = text.strip()
        if not text:
            continue
        norm = normalize(text)
        existing = db.query(KnowledgeGap).filter(KnowledgeGap.normalized == norm).first()
        if existing:
            existing.hits += 1
            existing.last_seen = _now()
            existing.question = question
            existing.domains = sorted(set(existing.domains or []) | set(domains))
            rows.append(existing)
        else:
            row = KnowledgeGap(text=text, normalized=norm, domains=sorted(set(domains)), question=question)
            db.add(row)
            rows.append(row)
    if rows:
        db.commit()
        for r in rows:
            db.refresh(r)
    return rows


def list_gaps(db: Session, status: str | None = None) -> list[KnowledgeGap]:
    """Open gaps first (by hits desc, then most recently seen), unless a status is requested."""
    q = db.query(KnowledgeGap)
    if status:
        q = q.filter(KnowledgeGap.status == status)
    return q.order_by(KnowledgeGap.hits.desc(), KnowledgeGap.last_seen.desc()).all()


def set_status(db: Session, gap_id: str, status: str, resolved_expertise_id: str | None = None) -> KnowledgeGap | None:
    row = db.query(KnowledgeGap).filter(KnowledgeGap.id == gap_id).first()
    if not row:
        return None
    row.status = status
    if resolved_expertise_id:
        row.resolved_expertise_id = resolved_expertise_id
    db.commit()
    db.refresh(row)
    return row
