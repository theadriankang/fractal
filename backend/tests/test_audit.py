"""Audit log endpoint tests: role-based access, domain filtering and summary text.

Reviewer sees every audit entry.  Domain experts see only entries whose target
Expertise (or proposal's Expertise) is in their domains.  Interns get 403.
Summary sentences are correct for approve and rollback actions.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import app
from app.models import Expertise, ExpertiseVersion, Profile, Proposal

ADRIAN = "a1b2c3d4-0000-4000-8000-00000000ad01"
PRIYA = "a1b2c3d4-0000-4000-8000-00000000ad02"
HAFIZ = "a1b2c3d4-0000-4000-8000-00000000ad03"
ETHAN = "a1b2c3d4-0000-4000-8000-00000000ad04"
MARCUS = "a1b2c3d4-0000-4000-8000-00000000ad05"

READY = dict(
    summary="Triage chiller faults.", when_to_use="CHWST above 7.5 °C.",
    knowledge=["Check load first."], decision_logic=["Stage up standby."],
    guardrails=["Never reset a freeze trip."], escalation=["Chief Engineer."],
)


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False)
    s = Session()
    s.add_all([
        Profile(id=ADRIAN, name="Adrian Kang", email="adrian@fractal.demo", role="reviewer", domains=[]),
        Profile(id=PRIYA, name="Priya S.", email="priya@fractal.demo", role="contributor", domains=["Technical Services"]),
        Profile(id=HAFIZ, name="Hafiz Rahman", email="hafiz@fractal.demo", role="contributor", domains=["Technical Services"]),
        Profile(id=ETHAN, name="Ethan Lim", email="intern@fractal.demo", role="intern", domains=[]),
        Profile(id=MARCUS, name="Marcus Teo", email="marcus@fractal.demo", role="contributor", domains=["Leasing"]),
        # Technical Services expertise (owned by Hafiz)
        Expertise(id="exp-chiller", name="Chiller Plant Fault Triage", domain="Technical Services", topic="Chillers & HVAC",
                  status="in_review", version="0.9", owner="Hafiz Rahman", **READY),
        # Leasing expertise (owned by Marcus)
        Expertise(id="exp-lease", name="Renewal Negotiation Playbook", domain="Leasing", topic="Renewals & Retention",
                  status="in_review", version="0.9", owner="Marcus Teo",
                  summary="Renewal tactics.", when_to_use="Tenant approaching expiry.",
                  knowledge=["Start early."], decision_logic=["Benchmark rent."],
                  guardrails=["Never threaten vacancy."], escalation=["Head of Leasing."]),
    ])
    s.commit()

    def override():
        yield s

    app.dependency_overrides[get_db] = override
    yield s
    app.dependency_overrides.clear()
    s.close()


client = TestClient(app)


def as_(uid):
    return {"X-User-Id": uid}


# --- access control -----------------------------------------------------------

def test_intern_gets_403(db):
    r = client.get("/api/audit", headers=as_(ETHAN))
    assert r.status_code == 403


def test_reviewer_sees_all_entries(db):
    # Adrian approves both chiller (Technical Services) and lease (Leasing)
    client.post("/api/expertise/exp-chiller/approve", headers=as_(ADRIAN))
    client.post("/api/expertise/exp-lease/approve", headers=as_(ADRIAN))

    r = client.get("/api/audit", headers=as_(ADRIAN))
    assert r.status_code == 200
    entries = r.json()["entries"]
    # Both the Technical Services and Leasing entries appear.
    domains = {e.get("domain") for e in entries}
    assert "Technical Services" in domains
    assert "Leasing" in domains


def test_domain_expert_sees_only_own_domains(db):
    # Adrian approves chiller (Technical Services) and lease (Leasing)
    client.post("/api/expertise/exp-chiller/approve", headers=as_(ADRIAN))
    client.post("/api/expertise/exp-lease/approve", headers=as_(ADRIAN))

    r = client.get("/api/audit", headers=as_(HAFIZ))
    assert r.status_code == 200
    entries = r.json()["entries"]
    # Hafiz is a Technical Services expert — only those entries appear.
    domains = {e.get("domain") for e in entries}
    assert domains == {"Technical Services"}


def test_out_of_domain_expert_does_not_see_leasing(db):
    client.post("/api/expertise/exp-lease/approve", headers=as_(ADRIAN))
    r = client.get("/api/audit", headers=as_(HAFIZ))
    assert r.status_code == 200
    assert r.json()["entries"] == []


# --- summary text -------------------------------------------------------------

def test_summary_correct_for_approve(db):
    r = client.post("/api/expertise/exp-chiller/approve", json={"note": "LGTM"}, headers=as_(PRIYA))
    assert r.status_code == 200, r.text
    assert r.json()["version"] == "1.0"

    r = client.get("/api/audit", headers=as_(ADRIAN))
    entries = r.json()["entries"]
    approve = [e for e in entries if e["action"] == "expertise.approve"]
    assert len(approve) == 1
    entry = approve[0]
    assert entry["actor"]["name"] == "Priya S."
    assert entry["targetName"] == "Chiller Plant Fault Triage"
    assert entry["version"] == "1.0"
    assert "Priya S. approved Chiller Plant Fault Triage v1.0" == entry["summary"]


def test_summary_correct_for_rollback(db):
    # Approve first (Adrian), so version 1.0 is created.
    client.post("/api/expertise/exp-chiller/approve", headers=as_(ADRIAN))
    # Patch to change content, then roll back to 1.0.
    client.patch("/api/expertise/exp-chiller", json={"guardrails": ["Changed."]}, headers=as_(PRIYA))
    r = client.post("/api/expertise/exp-chiller/rollback", json={"version": "1.0"}, headers=as_(ADRIAN))
    assert r.status_code == 200, r.text
    # After rollback the version bumps to 1.1.
    assert r.json()["version"] == "1.1"

    r = client.get("/api/audit", headers=as_(ADRIAN))
    entries = r.json()["entries"]
    rollback = [e for e in entries if e["action"] == "expertise.rollback"]
    assert len(rollback) == 1
    entry = rollback[0]
    assert entry["actor"]["name"] == "Adrian Kang"
    assert entry["targetName"] == "Chiller Plant Fault Triage"
    # Summary: "Adrian Kang rolled back Chiller Plant Fault Triage to v1.0 (now v1.1)"
    assert "Adrian Kang rolled back Chiller Plant Fault Triage to v1.0" in entry["summary"]
    assert "v1.1" in entry["summary"]


# --- filtering and pagination -------------------------------------------------

def test_target_id_filter(db):
    client.post("/api/expertise/exp-chiller/approve", headers=as_(ADRIAN))
    client.post("/api/expertise/exp-lease/approve", headers=as_(ADRIAN))
    r = client.get("/api/audit?targetId=exp-chiller", headers=as_(ADRIAN))
    entries = r.json()["entries"]
    assert all(e["targetId"] == "exp-chiller" for e in entries)
    assert len(entries) >= 1


def test_action_filter(db):
    client.post("/api/expertise/exp-chiller/approve", headers=as_(ADRIAN))
    r = client.get("/api/audit?action=expertise.approve", headers=as_(ADRIAN))
    entries = r.json()["entries"]
    assert all(e["action"] == "expertise.approve" for e in entries)
    assert len(entries) == 1


def test_cursor_pagination(db):
    # Create several actions so the cursor has something to page through.
    # approve, patch, approve lease → at least 3 audit rows (approve, update, approve).
    client.post("/api/expertise/exp-chiller/approve", headers=as_(ADRIAN))
    client.patch("/api/expertise/exp-chiller", json={"guardrails": ["New guardrail."]}, headers=as_(PRIYA))
    client.post("/api/expertise/exp-lease/approve", headers=as_(ADRIAN))

    r = client.get("/api/audit?limit=1", headers=as_(ADRIAN))
    page = r.json()
    assert len(page["entries"]) == 1
    assert page["hasMore"] is True

    # Fetch the next page using the `before` cursor.
    before = page["entries"][0]["at"]
    r2 = client.get(f"/api/audit?limit=1&before={before}", headers=as_(ADRIAN))
    page2 = r2.json()
    # The next entry should be older.
    assert len(page2["entries"]) == 1
    assert page2["entries"][0]["at"] < before
