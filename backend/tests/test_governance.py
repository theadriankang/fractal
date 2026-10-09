"""Governance tests: role checks, version bumps, rollback, proposals, audit.

Uses FastAPI TestClient with a live Supabase Postgres database. Requires
migrations applied (npx supabase db push) and seed.py run.
"""

import pytest
from fastapi.testclient import TestClient

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.main import app

client = TestClient(app)

# Demo user emails from src/data/users.js
ADRIAN = "adrian@fractal.demo"   # reviewer — all domains, can govern
HAFIZ = "hafiz@fractal.demo"     # contributor — Technical Services
PRIYA = "priya@fractal.demo"     # contributor — Technical Services
NURUL = "nurul@fractal.demo"     # contributor — Energy Optimisation, Sustainability
ETHAN = "intern@fractal.demo"    # intern — read-only


def _h(email):
    return {"X-User-Email": email}


def _create_draft(db_client, email, domain="Technical Services"):
    """Create a draft expertise owned by the given user."""
    resp = db_client.post("/api/expertise", json={
        "name": "Test Expertise",
        "domain": domain,
        "topic": "Lifts & Escalators",
        "summary": "Test summary",
        "whenToUse": "When testing",
        "knowledge": ["Step 1"],
        "decisionLogic": ["Do A then B"],
        "guardrails": ["Never skip safety"],
        "escalation": ["Call supervisor"],
        "status": "draft",
        "version": "0.9",
    }, headers=_h(email))
    assert resp.status_code == 201, resp.text
    return resp.json()


class TestPermissions:
    """Role and domain checks for submit and approve."""

    def test_intern_cannot_submit(self):
        e = _create_draft(client, HAFIZ)
        resp = client.post(f"/api/expertise/{e['id']}/submit", headers=_h(ETHAN))
        assert resp.status_code == 403

    def test_intern_cannot_approve(self):
        e = _create_draft(client, HAFIZ)
        client.post(f"/api/expertise/{e['id']}/submit", headers=_h(HAFIZ))
        resp = client.post(f"/api/expertise/{e['id']}/approve",
                          json={"note": "ok"}, headers=_h(ETHAN))
        assert resp.status_code == 403

    def test_expert_cannot_approve_own_contribution(self):
        e = _create_draft(client, HAFIZ)
        client.post(f"/api/expertise/{e['id']}/submit", headers=_h(HAFIZ))
        resp = client.post(f"/api/expertise/{e['id']}/approve",
                          json={"note": "ok"}, headers=_h(HAFIZ))
        assert resp.status_code == 403
        assert "own contribution" in resp.json()["detail"].lower()

    def test_expert_cannot_approve_other_domain(self):
        e = _create_draft(client, HAFIZ, domain="Technical Services")
        client.post(f"/api/expertise/{e['id']}/submit", headers=_h(HAFIZ))
        # Nurul is an expert in Energy/Sustainability, not Technical Services
        resp = client.post(f"/api/expertise/{e['id']}/approve",
                          json={"note": "ok"}, headers=_h(NURUL))
        assert resp.status_code == 403
        assert "technical services" in resp.json()["detail"].lower()


class TestApproveVersioning:
    """Approve bumps version correctly and saves a snapshot."""

    def test_approve_bumps_09_to_10(self):
        e = _create_draft(client, HAFIZ)
        client.post(f"/api/expertise/{e['id']}/submit", headers=_h(HAFIZ))
        resp = client.post(f"/api/expertise/{e['id']}/approve",
                          json={"note": "Looks good"}, headers=_h(PRIYA))
        assert resp.status_code == 200
        body = resp.json()
        assert body["version"] == "1.0"
        assert body["status"] == "approved"
        assert body["reviewer"] == "Priya S."
        # Snapshot saved
        assert len(body["versions"]) >= 1
        snap = body["versions"][-1]["snapshot"]
        assert "summary" in snap
        assert snap["knowledge"] == ["Step 1"]

    def test_approve_bumps_12_to_13(self):
        e = _create_draft(client, HAFIZ)
        # Manually set version to 1.2 via patch (metadata, not content)
        client.patch(f"/api/expertise/{e['id']}", json={"version": "1.2"}, headers=_h(HAFIZ))
        client.post(f"/api/expertise/{e['id']}/submit", headers=_h(HAFIZ))
        resp = client.post(f"/api/expertise/{e['id']}/approve",
                          json={"note": "ok"}, headers=_h(PRIYA))
        assert resp.status_code == 200
        assert resp.json()["version"] == "1.3"


class TestRollback:
    """Rollback restores a snapshot as a new version."""

    def test_rollback_creates_new_version(self):
        e = _create_draft(client, HAFIZ)
        client.post(f"/api/expertise/{e['id']}/submit", headers=_h(HAFIZ))
        approved = client.post(f"/api/expertise/{e['id']}/approve",
                               json={"note": "v1"}, headers=_h(PRIYA)).json()
        v1 = approved["version"]
        # Modify content via a new approve cycle
        client.patch(f"/api/expertise/{e['id']}", json={"version": "1.1"}, headers=_h(HAFIZ))
        # Now roll back to v1.0 (reviewer only)
        resp = client.post(f"/api/expertise/{e['id']}/rollback",
                         json={"version": v1}, headers=_h(ADRIAN))
        assert resp.status_code == 200
        body = resp.json()
        assert body["version"] != v1  # new version
        assert body["status"] == "approved"
        # The rollback note
        notes = [v["note"] for v in body["versions"]]
        assert any("Rolled back to v" in n for n in notes)


class TestEditApproved:
    """Editing approved content creates a proposal, not a direct edit."""

    def test_edit_approved_creates_proposal(self):
        e = _create_draft(client, HAFIZ)
        client.post(f"/api/expertise/{e['id']}/submit", headers=_h(HAFIZ))
        client.post(f"/api/expertise/{e['id']}/approve",
                    json={"note": "ok"}, headers=_h(PRIYA))
        # Try to edit a content field on approved expertise
        resp = client.patch(f"/api/expertise/{e['id']}",
                           json={"knowledge": ["New step"]}, headers=_h(HAFIZ))
        assert resp.status_code == 200
        body = resp.json()
        # The knowledge field should NOT have changed directly
        assert "New step" not in body["knowledge"]
        # A proposal should exist
        props = client.get("/api/proposals?status=open").json()
        assert any(p["expertiseId"] == e["id"] for p in props)


class TestAudit:
    """Every governance action appears in the audit log."""

    def test_audit_logs_actions(self):
        e = _create_draft(client, HAFIZ)
        client.post(f"/api/expertise/{e['id']}/submit", headers=_h(HAFIZ))
        client.post(f"/api/expertise/{e['id']}/approve",
                    json={"note": "ok"}, headers=_h(PRIYA))
        # Intern cannot see audit
        resp = client.get(f"/api/audit?targetId={e['id']}", headers=_h(ETHAN))
        assert resp.status_code == 403
        # Reviewer can see audit
        resp = client.get(f"/api/audit?targetId={e['id']}", headers=_h(ADRIAN))
        assert resp.status_code == 200
        entries = resp.json()
        actions = [a["action"] for a in entries]
        assert "create_expertise" in actions
        assert "submit_expertise" in actions
        assert "approve_expertise" in actions
