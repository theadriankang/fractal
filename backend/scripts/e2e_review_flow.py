#!/usr/bin/env python3
"""End-to-end review-flow test through the HTTP API.

Verifies that two laptops sharing one Supabase database see the same
data:

  1.  As hafiz@fractal.demo (contributor, Technical Services):
      create a draft Expertise, then submit it for review.
  2.  As adrian@fractal.demo (reviewer):
      list the open queue, find the draft, approve it → v1.0 live.
  3.  As priya@fractal.demo (contributor, Technical Services):
      post a down-vote correction → creates an open proposal.
  4.  As adrian:
      approve the proposal → v1.1 live.
  5.  As adrian:
      list the audit entries and print them.

Usage:
    cd backend && python scripts/e2e_review_flow.py
    # (uvicorn must already be running on http://localhost:8000)
"""

import json
import sys
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

BASE = "http://localhost:8000"
HAFIZ = "hafiz@fractal.demo"
ADRIAN = "adrian@fractal.demo"
PRIYA = "priya@fractal.demo"

DRAFT_NAME = "E2E: Chiller Condenser Tube Cleaning"
DOMAIN = "Technical Services"
TOPIC = "Chillers & HVAC"


def _req(path: str, method: str = "GET", body: dict | None = None,
         email: str | None = None, timeout: int = 15):
    """Send an authenticated request and return (status, json)."""
    data = json.dumps(body).encode() if body is not None else None
    req = Request(f"{BASE}{path}", data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if email:
        req.add_header("X-User-Email", email)
    try:
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else None)
    except HTTPError as e:
        raw = e.read()
        try:
            detail = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            detail = {"raw": raw.decode(errors="replace")}
        return e.code, detail


def step(msg: str):
    print(f"\n{'='*60}\n{msg}\n{'='*60}")


def ok(cond: bool, label: str):
    mark = "PASS" if cond else "FAIL"
    print(f"  [{mark}] {label}")
    if not cond:
        print("  ✗ Test failed — see output above.")
        sys.exit(1)


def main():
    step("0. Health check")
    status, _ = _req("/api/health", timeout=5)
    if status != 200:
        print(f"  Backend not reachable (HTTP {status}). Start it first:")
        print("  cd backend && uvicorn app.main:app --reload --port 8000")
        sys.exit(1)
    ok(True, "Backend reachable")

    # -- 1. Hafiz creates a draft + submits ---------------------------------
    step("1. As hafiz@fractal.demo: create a draft in Technical Services")
    draft_body = {
        "name": DRAFT_NAME,
        "domain": DOMAIN,
        "topic": TOPIC,
        "assetTypes": ["Office"],
        "summary": "Condenser tubes should be cleaned quarterly to maintain heat-transfer efficiency and prevent fouling.",
        "whenToUse": "When chiller efficiency drops or during scheduled maintenance.",
        "knowledge": ["Fouling reduces heat transfer by up to 30%.", "Brush cleaning restores nominal efficiency."],
        "decisionLogic": ["Inspect tube condition first.", "Brush-clean if fouling visible."],
        "guardrails": ["Isolate chiller and lock out power before opening tubes.", "Verify water treatment levels after cleaning."],
        "escalation": ["If tubes are corroded or perforated, escalate to the mechanical engineer."],
        "keywords": ["chiller", "condenser", "tube", "cleaning", "fouling", "efficiency"],
    }
    status, created = _req("/api/expertise", "POST", draft_body, email=HAFIZ)
    ok(status == 201, f"POST /api/expertise → {status} (expected 201)")
    exp_id = created["id"]
    ok(created["status"] == "draft", f"Status is 'draft' (got '{created['status']}')")
    ok(created["domain"] == DOMAIN, f"Domain is '{DOMAIN}'")
    print(f"  Created: {exp_id} — v{created['version']}")

    step("2. As hafiz@fractal.demo: submit the draft for review")
    status, submitted = _req(f"/api/expertise/{exp_id}/submit", "POST",
                             body={}, email=HAFIZ)
    ok(status == 200, f"POST /submit → {status} (expected 200)")
    ok(submitted["status"] == "in_review", f"Status is 'in_review' (got '{submitted['status']}')")

    # -- 2. Adrian sees it in the queue and approves -------------------------
    step("3. As adrian@fractal.demo: list open queue, find and approve (v1.0)")
    status, queue = _req("/api/expertise", email=ADRIAN)
    ok(status == 200, f"GET /api/expertise → {status}")
    found = next((e for e in queue if e["id"] == exp_id), None)
    ok(found is not None, "Draft appears in expertise list for Adrian")
    ok(found["status"] == "in_review", f"Adrian sees status 'in_review' (got '{found['status']}')")

    status, approved = _req(f"/api/expertise/{exp_id}/approve", "POST",
                            body={"note": "E2E: approved by Adrian"}, email=ADRIAN)
    ok(status == 200, f"POST /approve → {status} (expected 200)")
    ok(approved["status"] == "approved", f"Status is 'approved' (got '{approved['status']}')")
    ok(approved["version"] == "1.0", f"Version is '1.0' (got '{approved['version']}')")
    ok(approved["reviewer"] == "Adrian Kang", f"Reviewer is 'Adrian Kang' (got '{approved.get('reviewer')}')")
    print(f"  Approved: v{approved['version']} — reviewer={approved['reviewer']}")

    # -- 3. Priya posts a down-vote correction → proposal --------------------
    step("4. As priya@fractal.demo: post a down-vote correction → proposal")
    feedback_body = {
        "rating": "down",
        "comment": "Consider using automated tube cleaning system (TCS) for continuous cleaning without downtime.",
        "chatId": "e2e-test-chat",
    }
    status, fb_result = _req(f"/api/expertise/{exp_id}/feedback", "POST",
                             body=feedback_body, email=PRIYA)
    ok(status == 200, f"POST /feedback → {status} (expected 200)")

    # The feedback endpoint creates a proposal — find it in the open proposals.
    status, proposals = _req("/api/proposals?status=open", email=ADRIAN)
    ok(status == 200, f"GET /api/proposals?status=open → {status}")
    prop = next(
        (p for p in proposals if p.get("expertiseId") == exp_id
         or p.get("expertise_id") == exp_id),
        None,
    )
    ok(prop is not None, "Down-vote correction created an open proposal")
    prop_id = prop["id"]
    print(f"  Proposal: {prop_id}")
    print(f"    reason: {prop['reason'][:80]}")
    changes = prop.get("changes", {})
    ok("knowledge" in changes, "Proposal has knowledge changes")
    add_texts = changes["knowledge"]["add"]
    ok(any("automated tube cleaning" in t.lower() for t in add_texts),
        "Proposal adds the correction text")

    # -- 4. Adrian approves the proposal → v1.1 -----------------------------
    step("5. As adrian@fractal.demo: approve the proposal (v1.1)")
    status, merged = _req(f"/api/proposals/{prop_id}/approve", "POST",
                          body={"note": "E2E: merged correction"}, email=ADRIAN)
    ok(status == 200, f"POST /proposals/{prop_id}/approve → {status} (expected 200)")
    ok(merged["status"] == "approved", f"Proposal status is 'approved' (got '{merged['status']}')")

    # Re-fetch the expertise to see the new version.
    status, updated = _req(f"/api/expertise/{exp_id}", email=ADRIAN)
    ok(status == 200, f"GET /api/expertise/{exp_id} → {status}")
    ok(updated["version"] == "1.1", f"Version is '1.1' (got '{updated['version']}')")
    ok(updated["status"] == "approved", f"Status is 'approved' (got '{updated['status']}')")
    has_correction = any(
        "automated tube cleaning" in k.lower() for k in updated["knowledge"]
    )
    ok(has_correction, "Correction text is in the live knowledge list")
    ok(len(updated["versions"]) >= 2, f"Has >= 2 versions (got {len(updated['versions'])})")
    print(f"  Merged: v{updated['version']} — {len(updated['versions'])} versions")

    # -- 5. Audit trail ------------------------------------------------------
    step("6. As adrian@fractal.demo: show audit entries")
    status, audit = _req(f"/api/audit?targetId={exp_id}&limit=20", email=ADRIAN)
    ok(status == 200, f"GET /api/audit?targetId={exp_id} → {status}")
    # The approve_proposal entry has targetId = prop_id, so fetch those too.
    status, audit_prop = _req(f"/api/audit?targetId={prop_id}&limit=20", email=ADRIAN)
    all_audit = audit + audit_prop
    print(f"  {len(all_audit)} audit entries:")
    for a in all_audit:
        actor = a.get("actor") or "?"
        role = a.get("actorRole") or "?"
        action = a.get("action", "?")
        ts = (a.get("at") or "")[:19]
        print(f"    {ts}  {actor} ({role})  {action}")

    actions = [a["action"] for a in all_audit]
    ok("create_expertise" in actions, "Audit has create_expertise")
    ok("submit_expertise" in actions, "Audit has submit_expertise")
    ok("approve_expertise" in actions, "Audit has approve_expertise")
    ok("feedback" in actions or "feedback_creates_proposal" in actions,
        "Audit has feedback entry")
    ok("approve_proposal" in actions, "Audit has approve_proposal")

    step("ALL CHECKS PASSED")
    print(f"  Expertise: {exp_id}")
    print(f"  Versions:  v0.1 (draft) → v1.0 (approved) → v1.1 (correction merged)")
    print(f"  Audit:     {len(audit)} entries")
    print(f"  Actors:    hafiz@fractal.demo (contributor)")
    print(f"             priya@fractal.demo (contributor)")
    print(f"             adrian@fractal.demo (reviewer)")


if __name__ == "__main__":
    main()
