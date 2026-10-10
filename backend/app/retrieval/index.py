"""Indexing and search for Expertise embeddings.

Works on Postgres + pgvector. Degrades gracefully on SQLite (tests):
- Indexing is a no-op (the table doesn't exist).
- Search returns keyword-only results.
"""

import logging
import re
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from ..models import Expertise
from . import embedder

logger = logging.getLogger(__name__)

# Minimum score to return a match (hybrid score is 0–1).
MIN_SCORE_THRESHOLD = 0.40
# A match must score at least this fraction of the best match to be shown alongside it.
RELATIVE_CUTOFF = 0.85

# Process-level cache for the table-existence check.
_table_exists_cache: Optional[bool] = None


def is_pgvector_available(db: Session) -> bool:
    """True when the DB supports the vector extension."""
    try:
        db.execute(text("select 1 from pg_extension where extname = 'vector'"))
        return True
    except Exception:
        return False


def _ensure_table(db: Session) -> bool:
    """Check once per process whether the expertise_embeddings table exists.

    Schema is managed exclusively by supabase/migrations (PROJECT_CONTEXT rule 3b).
    This function never creates, commits, or rolls back anything — it only reads.
    """
    global _table_exists_cache
    # Only a positive answer is cached: a transient failure (cold start, network blip) must not
    # switch indexing off for the rest of the process.
    if _table_exists_cache:
        return True
    if not is_pgvector_available(db):
        return False
    try:
        row = db.execute(text(
            "select to_regclass('public.expertise_embeddings')"
        )).scalar()
    except Exception:
        return False
    _table_exists_cache = row is not None
    return _table_exists_cache


def index_expertise(db: Session, e: Expertise) -> None:
    """Embed and upsert the embedding for one Expertise (approved only).
    Skips re-embedding when content_hash is unchanged.
    Never raises into the caller — a failure logs a warning and continues."""
    try:
        _index_expertise_inner(db, e)
    except Exception as exc:
        logger.warning("index_expertise failed for %s: %s", getattr(e, "id", "?"), exc)


def _index_expertise_inner(db: Session, e: Expertise) -> None:
    if e.status != "approved":
        delete_embedding(db, e.id)
        return
    if not _ensure_table(db):
        return

    content = embedder.build_expertise_text(e)
    c_hash = embedder.content_hash(content)

    # Check if we already have an up-to-date embedding.
    existing = db.execute(text(
        "select content_hash from expertise_embeddings where expertise_id = :id"
    ), {"id": e.id}).first()
    if existing and existing[0] == c_hash:
        # Update version column in case it changed without a content change.
        db.execute(text(
            "update expertise_embeddings set version = :v where expertise_id = :id"
        ), {"v": e.version, "id": e.id})
        db.commit()
        return

    vec = embedder.embed_text(content)
    vec_str = _vector_to_pg(vec)
    db.execute(text("""
        insert into expertise_embeddings (expertise_id, version, content_hash, embedding, updated_at)
        values (:id, :ver, :ch, :emb, now())
        on conflict (expertise_id) do update
        set version = :ver, content_hash = :ch, embedding = :emb, updated_at = now()
    """), {"id": e.id, "ver": e.version, "ch": c_hash, "emb": vec_str})
    db.commit()


def delete_embedding(db: Session, expertise_id: str) -> None:
    """Remove the embedding for an Expertise (deprecate / delete / reject).
    Never raises into the caller — a failure logs a warning and continues."""
    try:
        _delete_embedding_inner(db, expertise_id)
    except Exception as exc:
        logger.warning("delete_embedding failed for %s: %s", expertise_id, exc)


def _delete_embedding_inner(db: Session, expertise_id: str) -> None:
    if not _ensure_table(db):
        return
    db.execute(text(
        "delete from expertise_embeddings where expertise_id = :id"
    ), {"id": expertise_id})
    db.commit()


def _vector_to_pg(vec: list[float]) -> str:
    """Format a Python list as a Postgres vector literal: '[0.1,0.2,...]'."""
    return "[" + ",".join(repr(v) for v in vec) + "]"


def _pg_vector_to_list(s: str) -> list[float]:
    """Parse a Postgres vector string '[0.1,0.2,...]' back to a list."""
    s = s.strip("[]()")
    if not s:
        return []
    return [float(x) for x in s.split(",")]


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

def search(
    db: Session,
    query: str,
    *,
    attached_ids: list[str] | None = None,
    limit: int = 3,
) -> list[dict]:
    """Hybrid ranking: cosine similarity + keyword overlap boost.

    Returns approved-only matches with score ≥ MIN_SCORE_THRESHOLD.
    ``attached_ids`` are always included (scored, but not filtered out).
    """
    attached_ids = attached_ids or []
    has_vector = _ensure_table(db)

    if has_vector:
        results = _hybrid_search(db, query, attached_ids, limit)
    else:
        results = _keyword_search(db, query, attached_ids, limit)

    # Drop weak tag-alongs: keep matches within RELATIVE_CUTOFF of the best one, so a clearly
    # relevant hit doesn't drag in loosely related Expertise. Attached ones always stay.
    if results:
        best = max(r["score"] for r in results)
        results = [r for r in results if r["id"] in attached_ids or r["score"] >= best * RELATIVE_CUTOFF]

    return results[:limit]


def sync_missing(db: Session) -> int:
    """Embed every approved Expertise that has no embedding (or a stale one). Returns how many changed.

    Run at startup so the index repairs itself if a write was ever skipped."""
    if not _ensure_table(db):
        return 0
    have = dict(db.execute(text("select expertise_id, content_hash from expertise_embeddings")).fetchall())
    changed = 0
    for e in db.query(Expertise).filter(Expertise.status == "approved").all():
        if have.get(e.id) != embedder.content_hash(embedder.build_expertise_text(e)):
            index_expertise(db, e)
            changed += 1
    return changed


def _hybrid_search(
    db: Session, query: str, attached_ids: list[str], limit: int
) -> list[dict]:
    """Cosine similarity from pgvector + keyword overlap boost."""
    q_vec = embedder.embed_text(query)
    q_str = _vector_to_pg(q_vec)
    q_lower = query.lower()

    # Cosine similarity search via pgvector's <=> operator (1 - cosine distance).
    # NOTE: SQLAlchemy uses :q for named params, so we can't use :: cast syntax.
    # Instead we cast inside a subquery or use the cast() function.
    rows = db.execute(text("""
        select e.id, e.name, e.version, e.keywords,
               1 - (emb.embedding <=> cast(:q as extensions.vector)) as cosine_sim
        from expertise_embeddings emb
        join expertise e on e.id = emb.expertise_id
        where e.status = 'approved'
        order by emb.embedding <=> cast(:q as extensions.vector)
        limit 50
    """), {"q": q_str}).fetchall()

    results = []
    for r in rows:
        eid, name, version, keywords_raw, cos_sim = r
        cos_sim = float(cos_sim)

        keywords = _parse_keywords(keywords_raw)
        kw_boost = _keyword_overlap(q_lower, keywords)

        # Hybrid score: 70% semantic, 30% keyword (clamped to [0, 1]).
        # Gate: when there is zero keyword overlap, require a higher
        # semantic similarity to avoid false positives on unrelated questions.
        score = min(1.0, 0.7 * max(cos_sim, 0.0) + 0.3 * kw_boost)

        # No keyword overlap → require a higher semantic similarity to avoid
        # false positives on unrelated questions (e.g. "best pizza restaurant").
        if kw_boost == 0 and cos_sim < 0.60:
            continue

        # Attached ids bypass the threshold but still get a score.
        is_attached = eid in attached_ids
        if not is_attached and score < MIN_SCORE_THRESHOLD:
            continue

        reason = _build_reason(cos_sim, kw_boost, is_attached, keywords, q_lower)
        results.append({
            "id": eid,
            "name": name,
            "version": version,
            "score": round(score, 4),
            "reason": reason,
        })

    # Ensure attached ids are present even if they fell below threshold.
    seen_ids = {r["id"] for r in results}
    for aid in attached_ids:
        if aid in seen_ids:
            continue
        e = db.get(Expertise, aid)
        if e and e.status == "approved":
            results.append({
                "id": e.id,
                "name": e.name,
                "version": e.version,
                "score": 0.0,
                "reason": "manually attached",
            })

    results.sort(key=lambda x: x["score"], reverse=True)
    return results


def _keyword_search(
    db: Session, query: str, attached_ids: list[str], limit: int
) -> list[dict]:
    """Fallback keyword matching (used on SQLite / when pgvector is absent)."""
    q_lower = query.lower()
    approved = db.query(Expertise).filter(Expertise.status == "approved").all()

    results = []
    for e in approved:
        keywords = e.keywords or []
        kw_boost = _keyword_overlap(q_lower, keywords)

        is_attached = e.id in attached_ids
        if not is_attached and kw_boost == 0:
            continue

        # Pure keyword score.
        score = min(1.0, kw_boost * 0.5)
        if not is_attached and score < MIN_SCORE_THRESHOLD:
            continue

        reason = _build_reason(0.0, kw_boost, is_attached, keywords, q_lower)
        results.append({
            "id": e.id,
            "name": e.name,
            "version": e.version,
            "score": round(score, 4),
            "reason": reason,
        })

    # Ensure attached ids are present.
    seen_ids = {r["id"] for r in results}
    for aid in attached_ids:
        if aid in seen_ids:
            continue
        e = db.get(Expertise, aid)
        if e and e.status == "approved":
            results.append({
                "id": e.id,
                "name": e.name,
                "version": e.version,
                "score": 0.0,
                "reason": "manually attached",
            })

    results.sort(key=lambda x: x["score"], reverse=True)
    return results


def _parse_keywords(raw) -> list[str]:
    """Keywords are stored as JSONB; on Postgres they come as a list."""
    if isinstance(raw, list):
        return [str(k) for k in raw]
    if isinstance(raw, str):
        # JSON string fallback
        import json
        try:
            return [str(k) for k in json.loads(raw)]
        except Exception:
            return []
    return []


def _keyword_overlap(query_lower: str, keywords: list[str]) -> float:
    """Fraction of keywords found as substrings in the query (0–1)."""
    if not keywords:
        return 0.0
    hits = sum(1 for k in keywords if k and k.lower() in query_lower)
    return hits / len(keywords)


def _build_reason(
    cos_sim: float, kw_boost: float, is_attached: bool,
    keywords: list[str], query_lower: str,
) -> str:
    """Human-readable explanation for the match."""
    parts = []
    if is_attached:
        parts.append("manually attached")
    if cos_sim > 0.5:
        parts.append(f"semantic match ({cos_sim:.0%})")
    elif cos_sim > 0.3:
        parts.append(f"weak semantic match ({cos_sim:.0%})")
    matched_kw = [k for k in keywords if k and k.lower() in query_lower]
    if matched_kw:
        parts.append(f"keywords: {', '.join(matched_kw)}")
    return "; ".join(parts) if parts else "no strong signal"
