"""Knowledge-gap tracking: recording from the weigh engine's gaps, dedup/hit-counting,
listing, and the reviewer-only dismiss/resolve endpoints."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import knowledge_gaps as gaps
from app.db import Base, get_db
from app.main import app
from app.models import KnowledgeGap, Profile

REVIEWER = "a1b2c3d4-0000-4000-8000-00000000ad01"
CONTRIBUTOR = "a1b2c3d4-0000-4000-8000-00000000ad02"


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False)
    s = Session()
    s.add_all([
        Profile(id=REVIEWER, name="Adrian Kang", role="reviewer", domains=[]),
        Profile(id=CONTRIBUTOR, name="Nurul Huda", role="contributor", domains=["Energy Optimisation"]),
    ])
    s.commit()
    yield s
    s.close()


def as_(uid):
    return {"X-User-Id": uid}


def test_record_gaps_creates_then_dedupes_by_normalized_text(db):
    gaps.record_gaps(db, ["Vendor SLA for chiller parts isn't documented."], ["Technical Services"], "q1")
    rows = db.query(KnowledgeGap).all()
    assert len(rows) == 1 and rows[0].hits == 1 and rows[0].status == "open"

    # Same gap, different casing/whitespace and a different question -> bumps hits, doesn't duplicate.
    gaps.record_gaps(db, ["  Vendor SLA for chiller   parts isn't documented.  "], ["Technical Services"], "q2")
    rows = db.query(KnowledgeGap).all()
    assert len(rows) == 1
    assert rows[0].hits == 2 and rows[0].question == "q2"


def test_record_gaps_unions_domains_across_repeats(db):
    gaps.record_gaps(db, ["No guidance on rooftop solar maintenance."], ["Energy Optimisation"], "q1")
    gaps.record_gaps(db, ["No guidance on rooftop solar maintenance."], ["Sustainability"], "q2")
    row = db.query(KnowledgeGap).one()
    assert row.domains == ["Energy Optimisation", "Sustainability"]


def test_list_gaps_orders_by_hits_then_recency_and_filters_by_status(db):
    gaps.record_gaps(db, ["Gap A"], ["Leasing"], "q")
    gaps.record_gaps(db, ["Gap B"], ["Leasing"], "q")
    gaps.record_gaps(db, ["Gap B"], ["Leasing"], "q")  # hits=2, should sort first
    ordered = gaps.list_gaps(db)
    assert [g.text for g in ordered] == ["Gap B", "Gap A"]

    b = next(g for g in ordered if g.text == "Gap B")
    gaps.set_status(db, b.id, "dismissed")
    assert [g.text for g in gaps.list_gaps(db, status="open")] == ["Gap A"]
    assert [g.text for g in gaps.list_gaps(db, status="dismissed")] == ["Gap B"]


def test_weigh_endpoint_persists_gaps(db, monkeypatch):
    from app.weigh import engine as weigh_engine

    async def fake_weigh_auto(question, picked, context=None, client=None, check_implicit=True):
        from app.weigh.schemas import WeighResult
        return WeighResult(question=question, mode="rules", triggered=True,
                           gaps=["No approved Expertise on EV charger allocation."])

    monkeypatch.setattr("app.routers.weigh.select_experts", lambda *a, **kw: [])
    monkeypatch.setattr("app.routers.weigh.weigh_auto", fake_weigh_auto)
    app.dependency_overrides[get_db] = lambda: db
    try:
        client = TestClient(app)
        res = client.post("/api/expertise/weigh", json={"question": "How do we allocate EV chargers?", "auto": True})
        assert res.status_code == 200
        row = db.query(KnowledgeGap).one()
        assert row.text == "No approved Expertise on EV charger allocation."
        assert row.question == "How do we allocate EV chargers?"
    finally:
        app.dependency_overrides.clear()


def test_endpoint_list_and_reviewer_only_dismiss_resolve(db):
    gaps.record_gaps(db, ["Gap A"], ["Leasing"], "q")
    app.dependency_overrides[get_db] = lambda: db
    try:
        client = TestClient(app)
        listed = client.get("/api/knowledge-gaps").json()
        assert len(listed) == 1 and listed[0]["text"] == "Gap A" and listed[0]["status"] == "open"
        gap_id = listed[0]["id"]

        # Contributor can't triage.
        denied = client.post(f"/api/knowledge-gaps/{gap_id}/dismiss", headers=as_(CONTRIBUTOR))
        assert denied.status_code == 403

        # Reviewer can resolve, optionally linking the Expertise that now covers it.
        ok = client.post(f"/api/knowledge-gaps/{gap_id}/resolve", json={"expertiseId": "exp-new"}, headers=as_(REVIEWER))
        assert ok.status_code == 200
        body = ok.json()
        assert body["status"] == "resolved" and body["resolvedExpertiseId"] == "exp-new"

        assert client.post(f"/api/knowledge-gaps/{gap_id + 'x'}/dismiss", headers=as_(REVIEWER)).status_code == 404
    finally:
        app.dependency_overrides.clear()
