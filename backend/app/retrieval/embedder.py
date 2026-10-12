"""Embedding provider for semantic Expertise retrieval.

Default: a local model via fastembed (BAAI/bge-small-en-v1.5, 384 dims).
Optional: LiteLLM (set EMBEDDING_PROVIDER=litellm + EMBEDDING_MODEL in backend/.env).
"""

import hashlib
import logging
from typing import Optional

from ..config import settings

logger = logging.getLogger(__name__)

EMBEDDING_DIM = 384

_model = None


def _get_local_model():
    """Lazy-load the fastembed model so the app starts even before first use."""
    global _model
    if _model is None:
        from fastembed import TextEmbedding
        _model = TextEmbedding(model_name="BAAI/bge-small-en-v1.5")
    return _model


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed a batch of texts, returning 384-dim float vectors."""
    provider = settings.embedding_provider
    if provider == "litellm":
        return _embed_litellm(texts)
    return _embed_local(texts)


def embed_text(text: str) -> list[float]:
    """Embed a single text."""
    return embed_texts([text])[0]


def _embed_local(texts: list[str]) -> list[list[float]]:
    model = _get_local_model()
    return [[float(v) for v in emb] for emb in model.embed(texts)]


def _embed_litellm(texts: list[str]) -> list[list[float]]:
    import litellm
    model_name = settings.embedding_model or "text-embedding-3-small"
    resp = litellm.embedding(model=model_name, input=texts)
    return [item["embedding"] for item in resp.data]


def content_hash(text: str) -> str:
    """SHA-256 hex of the text to be embedded, used to skip re-embedding when unchanged."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Text assembly — the fields that are embedded for an Expertise.
# ---------------------------------------------------------------------------

def build_expertise_text(e) -> str:
    """Assemble the text that is embedded for one Expertise.

    Embeds name + summary + whenToUse + keywords + knowledge + decisionLogic.
    """
    parts: list[str] = []

    name = getattr(e, "name", None) or ""
    if name:
        parts.append(name)

    summary = getattr(e, "summary", None) or ""
    if summary:
        parts.append(summary)

    when_to_use = getattr(e, "when_to_use", None) or ""
    if when_to_use:
        parts.append(when_to_use)

    keywords = getattr(e, "keywords", None) or []
    if keywords:
        parts.append(" ".join(keywords))

    knowledge = getattr(e, "knowledge", None) or []
    if knowledge:
        parts.append(" ".join(knowledge))

    decision_logic = getattr(e, "decision_logic", None) or []
    if decision_logic:
        parts.append(" ".join(decision_logic))

    return "\n".join(parts)
