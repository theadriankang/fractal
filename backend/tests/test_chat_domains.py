"""Cross-domain visibility in chat: the /api/chat/stream `meta` event says which domain each applied
Expertise came from, and which domains the answer drew on. The model call is stubbed (offline)."""

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.llm import registry
from app.main import app
from app.models import Expertise

ROWS = [
    dict(id="exp-chiller-fault", name="Chiller Plant Fault Triage", domain="Technical Services", status="approved", version="1.3"),
    dict(id="exp-chiller-seq", name="Chiller Sequencing for Efficiency", domain="Energy Optimisation", status="approved", version="1.0"),
    dict(id="exp-energy-peak", name="Peak Demand Shaving", domain="Energy Optimisation", status="approved", version="2.0"),
    dict(id="exp-draft", name="Unreviewed", domain="Leasing", status="draft", version="0.1"),
]


@pytest.fixture()
def client(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    db.add_all(Expertise(**r) for r in ROWS)
    db.commit()

    async def fake_stream(entry, system, messages):
        yield "delta", {"text": "ok"}
        yield "done", {"stopReason": "end_turn"}

    entry = registry.get("claude-sonnet")
    monkeypatch.setattr(registry, "is_available", lambda e: True)
    monkeypatch.setattr(registry, "stream_reply", fake_stream)
    assert entry is not None
    app.dependency_overrides[get_db] = lambda: db
    yield TestClient(app)
    app.dependency_overrides.clear()
    db.close()


def meta_for(client, ids):
    res = client.post("/api/chat/stream", json={
        "model": "claude-sonnet",
        "messages": [{"role": "user", "content": "How do I run the chiller plant more efficiently?"}],
        "expertise": [{"id": i, "name": "x", "version": "1", "status": "approved"} for i in ids],
    })
    assert res.status_code == 200
    block = next(b for b in res.text.split("\n\n") if b.startswith("event: meta"))
    return json.loads(block.split("data: ", 1)[1])


def test_meta_carries_domain_per_expertise_and_domains_coordinated(client):
    meta = meta_for(client, ["exp-chiller-fault", "exp-chiller-seq"])
    by_id = {e["id"]: e for e in meta["expertise"]}
    assert by_id["exp-chiller-fault"]["domain"] == "Technical Services"
    assert by_id["exp-chiller-seq"] == {"id": "exp-chiller-seq", "version": "1.0", "name": "Chiller Sequencing for Efficiency",
                                        "domain": "Energy Optimisation"}
    assert meta["domainsCoordinated"] == ["Energy Optimisation", "Technical Services"]


def test_single_domain_answer_reports_one_domain(client):
    meta = meta_for(client, ["exp-chiller-seq", "exp-energy-peak"])
    assert meta["domainsCoordinated"] == ["Energy Optimisation"]


def test_unapproved_and_missing_expertise_add_no_domain(client):
    meta = meta_for(client, ["exp-draft"])
    assert meta["expertise"] == [] and meta["domainsCoordinated"] == []
