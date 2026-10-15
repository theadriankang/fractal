"""Feedback loop: correction validation, grading rules and the before/after run. Claude is stubbed."""

import asyncio

from fastapi.testclient import TestClient

from app.llm import claude
from app.loop import correct, replay
from app.loop.correct import match_line, validate
from app.loop.replay import decide
from app.loop.schemas import CorrectionRequest, LoopExpertise, ReplayCase, ReplayRequest
from app.main import app

CHILLER = {
    "id": "exp-chiller-fault", "name": "Chiller Plant Fault Triage", "version": "1.3", "domain": "Technical Services",
    "whenToUse": "A floor reports warm conditions or CHWST drifts.",
    "knowledge": ["CHWST drifting above 7.5 °C for >15 min is the earliest sign."],
    "decisionLogic": [
        "Confirm the CHWST trend in the BMS.",
        "Check the strainer differential pressure.",
        "Stage up the standby chiller if CHWST stays high.",
    ],
    "guardrails": ["Never bypass a chiller safety trip."],
    "escalation": ["Escalate to the M&E contractor if two chillers trip."],
}
TENANT = {"id": "exp-tenant-complaint", "name": "Tenant Comfort Complaints", "version": "2.0", "domain": "Tenant Experience",
          "decisionLogic": ["Acknowledge within 15 minutes."]}
HAFIZ = {"name": "Hafiz Rahman", "role": "contributor", "domains": ["Technical Services"]}
MARCUS = {"name": "Marcus Teo", "role": "contributor", "domains": ["Leasing"]}
ADRIAN = {"name": "Adrian Kang", "role": "reviewer", "domains": []}
CORRECTION = "After the 2025 retrofit we check the VSD fault log before the strainer."


def req(user=HAFIZ, expertise=(CHILLER,), target=None, open_props=()):
    return CorrectionRequest(
        user=user,
        turns=[{"role": "user", "content": "CHWST is 8.1 °C and level 23 is warm, what do I check?"}],
        answer="1. Confirm the trend. 2. Check the strainer.", correction=CORRECTION,
        expertise=list(expertise), targetId=target, openProposals=list(open_props),
    )


REPLACE_STEP_2 = {
    "diagnosis": "expertise_wrong", "confidence": 0.9, "reason": "Step order changed after the retrofit.",
    "expertise_id": "exp-chiller-fault",
    "changes": [{"field": "decisionLogic", "remove": ["Check the strainer differential pressure"],  # no full stop: fuzzy match
                 "add": ["Check the VSD fault log, then the strainer differential pressure."]}],
    "test_case": {"question": "CHWST is 8.1 °C, what do I check first?", "must_do": ["Check the VSD fault log before the strainer"], "must_not_do": []},
}


# ---------------------------------------------------------------- correction validation

def test_match_line_is_exact_or_close_only():
    lines = CHILLER["decisionLogic"]
    assert match_line("check the strainer differential pressure", lines) == lines[1]
    assert match_line("Check the strainer DP", lines) is None
    assert match_line("", lines) is None


def test_replacing_a_step_keeps_the_exact_old_line():
    r = validate(REPLACE_STEP_2, req())
    assert r.diagnosis == "expertise_wrong" and r.expertiseId == "exp-chiller-fault"
    assert r.changes["decisionLogic"].remove == ["Check the strainer differential pressure."]
    assert r.changes["decisionLogic"].add == ["Check the VSD fault log, then the strainer differential pressure."]
    assert r.changes["decisionLogic"].insertAfter is None
    assert r.allowed and r.testCase.mustDo == ["Check the VSD fault log before the strainer"]


def test_invented_removals_and_existing_adds_are_dropped():
    raw = {**REPLACE_STEP_2, "changes": [
        {"field": "decisionLogic", "remove": ["Call the building manager."], "add": ["Confirm the CHWST trend in the BMS."]},
        {"field": "guardrails", "remove": [], "add": ["Never reset the VSD before reading its fault log."]},
        {"field": "bogus", "remove": [], "add": ["x"]},
    ]}
    r = validate(raw, req())
    assert list(r.changes) == ["guardrails"] and r.dropped == 3


def test_insert_after_is_converted_to_an_index():
    raw = {**REPLACE_STEP_2, "diagnosis": "expertise_incomplete", "changes": [
        {"field": "decisionLogic", "remove": [], "add": ["Read the VSD fault log."], "insert_after": 1}]}
    assert validate(raw, req()).changes["decisionLogic"].insertAfter == 0
    raw["changes"][0]["insert_after"] = 0
    assert validate(raw, req()).changes["decisionLogic"].insertAfter == -1
    raw["changes"][0]["insert_after"] = 9
    assert validate(raw, req()).changes["decisionLogic"].insertAfter is None


def test_no_change_left_means_not_actionable():
    raw = {**REPLACE_STEP_2, "changes": [{"field": "knowledge", "remove": ["made up"], "add": []}]}
    r = validate(raw, req())
    assert r.diagnosis == "not_actionable" and r.expertiseId is None


def test_low_confidence_unknown_target_and_garbage():
    assert validate({**REPLACE_STEP_2, "confidence": 0.3}, req()).diagnosis == "not_actionable"
    two = req(expertise=(CHILLER, TENANT))
    assert validate({**REPLACE_STEP_2, "expertise_id": "exp-other"}, two).diagnosis == "not_actionable"
    assert validate(None, req()).diagnosis == "not_actionable"


def test_model_ignored_proposes_nothing():
    r = validate({"diagnosis": "model_ignored", "confidence": 0.8, "reason": "Step 2 already says this."}, req())
    assert r.diagnosis == "model_ignored" and not r.changes and r.testCase is None


def test_user_pick_limits_the_target():
    two = req(expertise=(CHILLER, TENANT), target="exp-tenant-complaint")
    assert correct.candidates(two)[0].id == "exp-tenant-complaint"
    assert validate(REPLACE_STEP_2, two).diagnosis == "not_actionable"  # model chose the other one


def test_merge_with_must_be_an_open_proposal_on_the_same_expertise():
    props = [{"id": "prop-1", "expertiseId": "exp-chiller-fault"}, {"id": "prop-2", "expertiseId": "exp-tenant-complaint"}]
    assert validate({**REPLACE_STEP_2, "merge_with": "prop-1"}, req(open_props=props)).mergeWith == "prop-1"
    assert validate({**REPLACE_STEP_2, "merge_with": "prop-2"}, req(open_props=props)).mergeWith is None


def test_scope_fix_and_permissions():
    raw = {"diagnosis": "scope_wrong", "confidence": 0.8, "reason": "Not for data halls.", "expertise_id": "exp-chiller-fault",
           "when_to_use": "A floor in an office tower reports warm conditions (not data halls)."}
    r = validate(raw, req(user=MARCUS))
    assert r.set == {"whenToUse": "A floor in an office tower reports warm conditions (not data halls)."}
    assert not r.allowed and "Technical Services experts" in r.blockedReason
    assert r.testCase.question.startswith("CHWST is 8.1")  # falls back to the user's question


# ---------------------------------------------------------------- grading

CASE = ReplayCase(question="Why?", mustDo=["a", "b"], mustNotDo=["c"])


def test_decide():
    assert decide({"must_do_met": [True, True], "must_not_do_violated": [False], "why": "ok"}, CASE) == (True, "ok")
    assert decide({"must_do_met": [True], "must_not_do_violated": [False], "why": ""}, CASE)[0] is False  # missing verdict
    assert decide({"must_do_met": [True, True], "must_not_do_violated": [True], "why": ""}, CASE)[0] is False
    ref = ReplayCase(question="Why?", referenceAnswer="r")
    assert decide({"must_do_met": [], "must_not_do_violated": [], "consistent_with_reference": False, "why": ""}, ref)[0] is False
    assert decide({"must_do_met": [], "must_not_do_violated": [], "consistent_with_reference": True, "why": ""}, ref)[0] is True
    assert decide(None, CASE)[0] is None


def test_run_reports_fixed_broke_and_errors():
    current = LoopExpertise(**CHILLER)
    proposed = current.model_copy(update={"decisionLogic": ["NEW"], "version": "1.4"})
    cases = [
        ReplayCase(id="c1", question="fixed?", mustDo=["x"]),
        ReplayCase(id="c2", question="still fine?", mustDo=["x"]),
        ReplayCase(id="c3", question="broken?", mustDo=["x"]),
        ReplayCase(id="c4", question="explodes", mustDo=["x"]),
        ReplayCase(id="c5", question="no criteria"),  # skipped
    ]

    async def fake_answer(client, model_id, e, q):
        if q == "explodes":
            raise RuntimeError("boom")
        return f"{'NEW' if e.decisionLogic == ['NEW'] else 'OLD'}:{q}"

    async def fake_grade(client, case, text):
        new = text.startswith("NEW")
        return {"fixed?": new, "still fine?": True, "broken?": not new}[case.question], "why"

    out = asyncio.run(replay.run(ReplayRequest(current=current, proposed=proposed, cases=cases), None, fake_answer, fake_grade))
    assert [r.verdict for r in out.results] == ["fixed", "same_pass", "broke", "error"]
    s = out.summary
    assert (s.total, s.oldPass, s.newPass, s.fixed, s.broke, s.errors) == (4, 2, 2, 1, 1, 1)


# ---------------------------------------------------------------- endpoints

client = TestClient(app)


def test_correction_endpoint(monkeypatch):
    assert client.post("/api/loop/correction", json=req(user=ADRIAN).model_dump()).status_code == 403

    async def fake(r, c):
        return REPLACE_STEP_2
    monkeypatch.setattr(correct, "call_model", fake)
    monkeypatch.setattr(claude, "is_configured", lambda: True)
    j = client.post("/api/loop/correction", json=req().model_dump()).json()
    assert j["diagnosis"] == "expertise_wrong" and j["changes"]["decisionLogic"]["remove"] == ["Check the strainer differential pressure."]


def test_test_endpoint_validation(monkeypatch):
    monkeypatch.setattr(claude, "is_configured", lambda: True)
    body = {"current": CHILLER, "proposed": {**CHILLER, "id": "other"}, "cases": [{"question": "What now?", "mustDo": ["x"]}]}
    assert client.post("/api/loop/test", json=body).status_code == 400
    body = {"current": CHILLER, "proposed": CHILLER, "cases": [{"question": "What now?"}]}
    assert client.post("/api/loop/test", json=body).status_code == 400
