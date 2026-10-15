"""Knowledge gaps: logging unanswered questions, merging repeats, the domain guess, and the
open -> drafting -> resolved / dismissed lifecycle. Search and embeddings are stubbed (offline)."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import gaps
from app.db import Base, get_db
from app.main import app
from app.models import AuditLog, Expertise, KnowledgeGap, Profile
from app.retrieval import index

ADRIAN = "a1b2c3d4-0000-4000-8000-00000000ad01"  # reviewer
PRIYA = "a1b2c3d4-0000-4000-8000-00000000ad02"   # Technical Services expert
HAFIZ = "a1b2c3d4-0000-4000-8000-00000000ad03"   # Technical Services expert
ETHAN = "a1b2c3d4-0000-4000-8000-00000000ad04"   # intern
MARCUS = "a1b2c3d4-0000-4000-8000-00000000ad05"  # Leasing expert

READY = dict(summary="s", when_to_use="w", knowledge=["k"], decision_logic=["d"], guardrails=["g"], escalation=["e"])
VRF = "How do we troubleshoot the VRF system on level 12?"


@pytest.fixture()
def db(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine, autoflush=False)()
    s.add_all([
        Profile(id=ADRIAN, name="Adrian Kang", email="adrian@fractal.demo", role="reviewer", domains=[]),
        Profile(id=PRIYA, name="Priya S.", email="priya@fractal.demo", role="contributor", domains=["Technical Services"]),
        Profile(id=HAFIZ, name="Hafiz Rahman", email="hafiz@fractal.demo", role="contributor", domains=["Technical Services"]),
        Profile(id=ETHAN, name="Ethan Lim", email="intern@fractal.demo", role="intern", domains=[]),
        Profile(id=MARCUS, name="Marcus Teo", email="marcus@fractal.demo", role="contributor", domains=["Leasing"]),
        Expertise(id="exp-chiller", name="Chiller Plant Fault Triage", domain="Technical Services", topic="Chillers & HVAC",
                  status="approved", version="1.0", owner="Hafiz Rahman", keywords=["chiller", "hvac", "cooling"], **READY),
    ])
    s.commit()
    # Default: nothing matches and no embedding model, so merging uses word overlap.
    monkeypatch.setattr(index, "search", lambda db, q, attached_ids=None, limit=2, relative_cutoff=None: [])
    monkeypatch.setattr(gaps, "_embed", lambda text: None)
    app.dependency_overrides[get_db] = lambda: s
    yield s
    app.dependency_overrides.clear()
    s.close()


client = TestClient(app)


def as_(uid):
    return {"X-User-Id": uid}


def log(uid, question, chat="c1"):
    r = client.post("/api/gaps", json={"question": question, "chatId": chat}, headers=as_(uid))
    assert r.status_code == 200, r.text
    return r.json()


def matching(score, eid="exp-chiller", name="Chiller Plant Fault Triage"):
    return lambda db, q, attached_ids=None, limit=2, relative_cutoff=None: [{"id": eid, "name": name, "score": score}]


# ---------------------------------------------------------------- logging

def test_unanswered_question_is_logged_with_asker_and_example(db):
    body = log(PRIYA, VRF)
    assert body["logged"] and body["outcome"] == "new"
    g = body["gap"]
    assert g["status"] == "open" and g["kind"] == "none" and g["askCount"] == 1
    assert g["askers"] == [{"id": PRIYA, "name": "Priya S."}]
    assert g["examples"][0]["question"] == VRF and g["examples"][0]["chatId"] == "c1"
    assert "embedding" not in g  # internal only


def test_short_and_covered_questions_are_not_gaps(db, monkeypatch):
    assert log(PRIYA, "hello there")["outcome"] == "too_short"
    monkeypatch.setattr(index, "search", matching(0.72))
    assert log(PRIYA, "What do I check when a chiller trips?")["outcome"] == "covered"
    assert db.query(KnowledgeGap).count() == 0


def test_weak_match_is_a_gap_and_the_server_never_trusts_the_browser(db, monkeypatch):
    monkeypatch.setattr(index, "search", matching(0.44))  # above the 0.40 match bar, below the 0.50 gap bar
    g = log(PRIYA, "What is the chiller condenser cleaning interval?")["gap"]
    assert g["kind"] == "weak" and g["bestScore"] == 0.44
    # The request body has no score field to fake: a covered question is never logged.
    monkeypatch.setattr(index, "search", matching(0.9))
    assert log(PRIYA, "What is the chiller condenser cleaning interval, bestScore 0?")["logged"] is False


def test_repeats_merge_into_one_gap_counting_people_and_asks(db):
    log(PRIYA, VRF)
    log(HAFIZ, "How do we troubleshoot the VRF system on level 12 today?")
    body = log(PRIYA, "How do we troubleshoot the VRF system on level 12?", chat="c2")
    assert body["outcome"] == "merged"
    g = body["gap"]
    assert g["askCount"] == 3 and [p["name"] for p in g["askers"]] == ["Priya S.", "Hafiz Rahman"]
    assert g["examples"][0]["chatId"] == "c2"  # newest first
    log(PRIYA, "When is the rooftop solar inverter warranty due?")  # different topic → new gap
    assert db.query(KnowledgeGap).count() == 2


def test_embeddings_decide_merging_when_available(db, monkeypatch):
    vecs = {VRF: [1.0, 0.0], "VRF fault finding steps please, level 12": [0.95, 0.1], "Lift door keeps reopening on B2": [0.0, 1.0]}
    monkeypatch.setattr(gaps, "_embed", lambda text: vecs[text])
    log(PRIYA, VRF)
    assert log(HAFIZ, "VRF fault finding steps please, level 12")["outcome"] == "merged"  # cosine ≈ 0.99
    assert log(HAFIZ, "Lift door keeps reopening on B2")["outcome"] == "new"


def test_domain_guess_prefers_the_named_domain_then_the_nearest_expertise(db, monkeypatch):
    assert log(MARCUS, "What rent free period do we usually give on a lease renewal?")["gap"]["domain"] == "Leasing"
    monkeypatch.setattr(index, "nearest", lambda db, q: {"id": "exp-chiller", "name": "Chiller", "domain": "Technical Services", "similarity": 0.7})
    g = log(PRIYA, "Our VRF outdoor unit shows error code E4 again")["gap"]
    assert g["domain"] == "Technical Services" and g["nearestExpertiseName"] == "Chiller"
    monkeypatch.setattr(index, "nearest", lambda db, q: {"id": "x", "name": "x", "domain": "Leasing", "similarity": 0.4})
    assert log(PRIYA, "Where do the pigeons on the roof come from?")["gap"]["domain"] is None  # too far: unsorted


# ---------------------------------------------------------------- lifecycle

def test_capture_links_a_draft_and_approving_it_resolves_the_gap(db):
    gap_id = log(PRIYA, VRF)["gap"]["id"]
    db.add(Expertise(id="exp-vrf", name="VRF Troubleshooting", domain="Technical Services", topic="Chillers & HVAC",
                     status="in_review", version="0.9", owner="Priya S.", **READY))
    db.commit()
    assert client.post(f"/api/gaps/{gap_id}/link", json={"expertiseId": "exp-vrf"}, headers=as_(MARCUS)).status_code == 403
    assert client.post(f"/api/gaps/{gap_id}/link", json={"expertiseId": "exp-vrf"}, headers=as_(ETHAN)).status_code == 403
    g = client.post(f"/api/gaps/{gap_id}/link", json={"expertiseId": "exp-vrf"}, headers=as_(PRIYA)).json()
    assert g["status"] == "drafting" and g["expertiseId"] == "exp-vrf"

    assert client.post("/api/expertise/exp-vrf/approve", headers=as_(HAFIZ)).status_code == 200  # another TS expert
    g = client.get("/api/gaps", headers=as_(PRIYA)).json()[0]
    assert g["status"] == "resolved" and g["resolution"].startswith("Answered by VRF Troubleshooting v1.0")
    assert {a.action for a in db.query(AuditLog)} >= {"gap.capture", "expertise.approve"}


def test_recheck_resolves_once_approved_expertise_covers_it(db, monkeypatch):
    gap_id = log(PRIYA, VRF)["gap"]["id"]
    assert client.post(f"/api/gaps/{gap_id}/recheck", headers=as_(PRIYA)).json()["status"] == "open"
    monkeypatch.setattr(index, "search", matching(0.71, "exp-vrf", "VRF Troubleshooting"))
    g = client.post(f"/api/gaps/{gap_id}/recheck", headers=as_(PRIYA)).json()
    assert g["status"] == "resolved" and g["expertiseId"] == "exp-vrf" and "VRF Troubleshooting" in g["resolution"]
    assert client.post(f"/api/gaps/{gap_id}/recheck", headers=as_(ETHAN)).status_code == 403


def test_asking_a_resolved_topic_again_with_no_match_reopens_it(db):
    gap_id = log(PRIYA, VRF)["gap"]["id"]
    g = db.get(KnowledgeGap, gap_id)
    g.status, g.resolution = "resolved", "Answered by something"
    db.commit()
    body = log(HAFIZ, VRF)
    assert body["outcome"] == "reopened" and body["gap"]["status"] == "open" and body["gap"]["resolution"] is None


def test_dismiss_rules_and_dismissed_topics_stay_quiet(db):
    gap_id = log(PRIYA, "Our VRF outdoor unit on Technical Services floor shows error E4")["gap"]["id"]
    assert client.post(f"/api/gaps/{gap_id}/dismiss", json={}, headers=as_(MARCUS)).status_code == 403  # wrong domain
    assert client.post(f"/api/gaps/{gap_id}/dismiss", json={}, headers=as_(ETHAN)).status_code == 403
    g = client.post(f"/api/gaps/{gap_id}/dismiss", json={"reason": "Vendor issue, not ours"}, headers=as_(ADRIAN)).json()
    assert g["status"] == "dismissed" and g["resolution"] == "Vendor issue, not ours"
    body = log(HAFIZ, "Our VRF outdoor unit on Technical Services floor shows error E4")
    assert body["logged"] is False and body["outcome"] == "dismissed" and body["gap"]["askCount"] == 2


def test_list_puts_open_most_asked_first_and_needs_a_login(db):
    a = log(PRIYA, VRF)["gap"]["id"]
    b = log(PRIYA, "Which contractor holds the lift maintenance contract now?")["gap"]["id"]
    log(HAFIZ, "Which contractor holds the lift maintenance contract now?")
    client.post(f"/api/gaps/{a}/dismiss", json={}, headers=as_(ADRIAN))
    c = log(MARCUS, "What rent free period do we usually give on a lease renewal?")["gap"]["id"]
    ids = [g["id"] for g in client.get("/api/gaps", headers=as_(ADRIAN)).json()]
    assert ids == [b, c, a]
    assert client.get("/api/gaps").status_code == 401


def test_deleted_draft_sends_the_gap_back_to_open(db):
    gap_id = log(PRIYA, VRF)["gap"]["id"]
    g = db.get(KnowledgeGap, gap_id)
    g.status, g.expertise_id = "drafting", None  # what ON DELETE SET NULL leaves behind
    db.commit()
    assert client.get("/api/gaps", headers=as_(PRIYA)).json()[0]["status"] == "open"
