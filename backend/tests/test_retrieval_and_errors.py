"""Search tag-along cutoff and readable model errors."""

from app.retrieval import index
from app.routers.chat import _friendly_error


def test_relative_cutoff_drops_weak_tag_alongs(monkeypatch):
    monkeypatch.setattr(index, "_ensure_table", lambda db: True)
    monkeypatch.setattr(index, "_hybrid_search", lambda db, q, a, l: [
        {"id": "lift", "score": 0.51}, {"id": "door", "score": 0.45}, {"id": "escalator", "score": 0.42},
        {"id": "attached", "score": 0.0},
    ])
    ids = [r["id"] for r in index.search(None, "lift stops between floors", attached_ids=["attached"], limit=5)]
    assert ids == ["lift", "door", "attached"]


def test_friendly_errors():
    assert "out of credit" in _friendly_error("gpt-5", Exception("This request requires more credits"))
    assert "isn't available" in _friendly_error("grok-4", Exception("x-ai/grok-4 is not a valid model ID"))
    assert "couldn't answer" in _friendly_error("x", Exception("boom"))
