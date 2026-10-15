"""Knowledge gaps: questions approved Expertise couldn't answer, kept so experts know what to capture next.

When a chat question gets no approved match (or only a weak one), the browser reports it to
POST /api/gaps. This module re-runs the search itself (the browser's score is never trusted),
merges the question into an existing gap when it is the same topic, and guesses which domain's
experts should answer it. Reviewers and domain experts then work the list from the Review Queue:
"Capture this" starts a draft linked to the gap, and approving that draft resolves it.
"""

import math
import re
import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from .config import settings
from .models import Expertise, KnowledgeGap, Profile
from .retrieval import embedder, index
from .weigh.engine import DOMAIN_WORDS

MAX_EXAMPLES = 10
# Nearest-Expertise similarity needed before its domain is used as the gap's domain guess.
# bge-small cosine scores sit high even for loosely related text, so this is deliberately strict.
DOMAIN_GUESS_MIN = 0.62
# Extra words that point at a domain without naming it (equipment, faults, leases). Only used to
# guess a gap's domain; weighing keeps its own, stricter list (weigh/engine.py DOMAIN_WORDS).
DOMAIN_HINTS = {
    "Technical Services": r"troubleshoot|fault|repair|breakdown|leak|alarm|\btrip|\bvrf\b|\bahu\b|\blifts?\b|escalator|"
                          r"\bpump|generator|\bups\b|chiller|plumbing|electrical",
    "Energy Optimisation": r"\bkwh\b|\bkw\b|tariff|solar|baseload|setpoint",
    "Leasing": r"tenancy|rent review|vacancy|letting",
    "Sustainability": r"recycl|waste|water consumption|scope [123]",
}
_WORDS = re.compile(r"[a-z0-9]+")
_STOP = set("a an the and or of to in on at for with is are was were be do does did how what when why "
            "where which who can could should would we our you your i my it this that there any".split())


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _tokens(text: str) -> set[str]:
    return {w for w in _WORDS.findall(text.lower()) if w not in _STOP and len(w) > 2}


def _embed(text: str) -> list[float] | None:
    try:
        return embedder.embed_text(text)
    except Exception:
        return None  # no embedding model available: merging falls back to word overlap


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na, nb = math.sqrt(sum(x * x for x in a)), math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def similar(q: str, q_vec: list[float] | None, gap: KnowledgeGap) -> bool:
    """Same topic? Embeddings when both sides have them, otherwise word overlap (Jaccard)."""
    if q_vec and gap.embedding:
        return _cosine(q_vec, gap.embedding) >= settings.gap_merge_similarity
    a, b = _tokens(q), _tokens(gap.question)
    return bool(a and b) and len(a & b) / len(a | b) >= 0.6


def guess_domain(question: str, near: dict | None) -> str | None:
    """A domain the question names outright wins; otherwise the nearest Expertise's, if it is close."""
    q = question.lower()
    named = [d for d, pattern in DOMAIN_WORDS.items() if re.search(pattern, q)]
    if len(named) == 1:
        return named[0]
    if near and near.get("similarity", 0) >= DOMAIN_GUESS_MIN:
        return near["domain"]
    if named:
        return named[0]
    hinted = [d for d, pattern in DOMAIN_HINTS.items() if re.search(pattern, q)]
    return hinted[0] if hinted else None


def assess(db: Session, question: str) -> dict:
    """How well approved Expertise covers the question: {covered, kind, best_score, best}."""
    hits = index.search(db, question, limit=1, relative_cutoff=None)
    best = hits[0] if hits else None
    score = float(best["score"]) if best else 0.0
    covered = score >= settings.gap_weak_score
    return {"covered": covered, "kind": "weak" if best else "none", "best_score": round(score, 4), "best": best}


def record(db: Session, user: Profile, question: str, chat_id: str | None = None) -> tuple[KnowledgeGap | None, str]:
    """Logs the question as a gap if it is one. Returns (gap or None, outcome).

    outcome: "too_short" | "covered" | "new" | "merged" | "reopened" | "dismissed" (a dismissed
    topic is counted but stays dismissed, so off-topic questions don't resurface).
    """
    question = " ".join(question.split())[:1000]
    if len(question.split()) < settings.gap_min_words:
        return None, "too_short"
    a = assess(db, question)
    if a["covered"]:
        return None, "covered"

    q_vec = _embed(question)
    example = {"question": question, "asker": user.name or user.email or "", "chatId": chat_id, "at": _now().isoformat()}
    existing = next((g for g in db.query(KnowledgeGap).order_by(KnowledgeGap.last_asked_at.desc()).limit(500)
                     if similar(question, q_vec, g)), None)
    if existing is not None:
        g = existing
        g.ask_count = (g.ask_count or 0) + 1
        g.last_asked_at = _now()
        g.examples = [example, *(g.examples or [])][:MAX_EXAMPLES]
        if not any(p.get("id") == user.id for p in g.askers or []):
            g.askers = [*(g.askers or []), {"id": user.id, "name": user.name or ""}]
        g.best_score, g.kind = a["best_score"], a["kind"]
        outcome = "merged"
        if g.status == "resolved":  # it was meant to be covered, yet nothing matches again
            g.status, g.resolution, g.resolved_by = "open", None, None
            outcome = "reopened"
        elif g.status == "dismissed":
            outcome = "dismissed"
        db.commit()
        return g, outcome

    near = index.nearest(db, question)
    g = KnowledgeGap(
        id=f"gap-{uuid.uuid4().hex[:8]}", question=question, domain=guess_domain(question, near),
        kind=a["kind"], best_score=a["best_score"],
        nearest_expertise_id=(near or {}).get("id"), nearest_expertise_name=(near or {}).get("name"),
        status="open", ask_count=1, askers=[{"id": user.id, "name": user.name or ""}], examples=[example],
        embedding=q_vec, created_at=_now(), last_asked_at=_now(),
    )
    db.add(g)
    db.commit()
    return g, "new"


def recheck(db: Session, g: KnowledgeGap, user: Profile) -> bool:
    """Resolves the gap if approved Expertise now answers it. Returns whether it is covered."""
    a = assess(db, g.question)
    g.best_score, g.kind = a["best_score"], a["kind"]
    if a["covered"]:
        g.status = "resolved"
        g.expertise_id = a["best"]["id"]
        g.resolved_by = user.name or ""
        g.resolution = f"Now answered by {a['best']['name']}"
    db.commit()
    return a["covered"]


def resolve_for_approved(db: Session, e: Expertise, approver: Profile) -> int:
    """Called when Expertise is approved: gaps it was drafted from are now answered."""
    n = 0
    for g in db.query(KnowledgeGap).filter(KnowledgeGap.expertise_id == e.id, KnowledgeGap.status == "drafting"):
        g.status, g.resolved_by, g.resolution = "resolved", approver.name or "", f"Answered by {e.name} v{e.version}"
        n += 1
    return n
