"""Know-how capture: validation + access rules. Claude is stubbed, so these run offline."""

from fastapi.testclient import TestClient

from app.capture import extract
from app.capture.extract import grounded, validate
from app.capture.schemas import ExtractRequest
from app.main import app

TAXONOMY = [
    {"domain": "Technical Services", "topics": ["Chillers & HVAC", "Lifts & Escalators"]},
    {"domain": "Leasing", "topics": ["Renewals & Retention"]},
]
CHILLER = {
    "id": "exp-chiller-fault", "name": "Chiller Plant Fault Triage", "domain": "Technical Services",
    "topic": "Chillers & HVAC", "knowledge": ["CHWST drifting above 7.5 °C for >15 min is the earliest sign."],
}
LIFT_MSG = ("Lift 3 at Tower B keeps stopping between floors again. Whenever this happens we check the door lock "
            "contacts first. In my experience it's dust on the contacts, not the controller. Don't let anyone reset "
            "the controller before the contacts are checked, it wipes the fault log.")
HAFIZ = {"name": "Hafiz Rahman", "role": "contributor", "domains": ["Technical Services"]}
MARCUS = {"name": "Marcus Teo", "role": "contributor", "domains": ["Leasing"]}
ADRIAN = {"name": "Adrian Kang", "role": "reviewer", "domains": []}


def req(user=HAFIZ, msg=LIFT_MSG, candidates=(CHILLER,)):
    return ExtractRequest(
        user=user,
        turns=[{"role": "user", "content": msg}, {"role": "assistant", "content": "Check the door contacts and the landing door rollers."}],
        taxonomy=TAXONOMY, candidates=list(candidates),
    )


NEW_LIFT = {
    "kind": "new", "confidence": 0.88, "reason": "User shared a diagnosis rule of thumb.",
    "new": {"name": "lift door lock fault diagnosis", "domain": "Technical Services", "topic": "Lifts & Escalators",
            "asset_types": ["Office", "Spaceship"], "summary": "s", "when_to_use": "w", "keywords": ["Lift", "door lock"]},
    "items": [
        {"field": "decisionLogic", "text": "Check the door lock contacts first.", "quote": "we check the door lock contacts first"},
        {"field": "knowledge", "text": "It is usually dust on the contacts, not the controller.", "quote": "it's dust on the contacts, not the controller"},
        {"field": "guardrails", "text": "Never reset the controller before checking contacts; it wipes the fault log.",
         "quote": "Don't let anyone reset the controller before the contacts are checked, it wipes the fault log"},
        # invented by the model: not in the user's words
        {"field": "escalation", "text": "Call the lift contractor after 2 failures.", "quote": "call the contractor after two failures"},
        # quoted from the ASSISTANT, not the user
        {"field": "knowledge", "text": "Check landing door rollers.", "quote": "landing door rollers"},
        {"field": "bogus", "text": "x", "quote": "we check the door lock contacts first"},
    ],
}


def test_grounding():
    assert grounded("it’s dust on the contacts", LIFT_MSG)  # curly apostrophe still matches
    assert grounded("we check door lock contacts first", LIFT_MSG)  # minor omission
    assert not grounded("call the contractor after two failures", LIFT_MSG)
    assert not grounded("dust", LIFT_MSG)  # too short to be evidence


def test_new_draft_keeps_only_grounded_lines():
    d = validate(NEW_LIFT, req())
    assert d.kind == "new" and d.allowed and d.blockedReason is None
    assert d.draft.name == "Lift Door Lock Fault Diagnosis"
    assert d.draft.assetTypes == ["Office"] and d.draft.keywords == ["lift", "door lock"]
    assert [i.field for i in d.items] == ["decisionLogic", "knowledge", "guardrails"]
    assert d.dropped == 3


def test_out_of_domain_contributor_is_blocked():
    d = validate(NEW_LIFT, req(user=MARCUS))
    assert d.kind == "new" and not d.allowed
    assert "Technical Services experts" in d.blockedReason


def test_reviewer_is_never_allowed():
    d = validate(NEW_LIFT, req(user=ADRIAN))
    assert not d.allowed and "reviewers approve" in d.blockedReason


def test_low_confidence_and_bad_targets_become_none():
    assert validate({**NEW_LIFT, "confidence": 0.4}, req()).kind == "none"
    assert validate({**NEW_LIFT, "new": {**NEW_LIFT["new"], "domain": "Space Ops"}}, req()).kind == "none"
    assert validate({"kind": "revision", "confidence": 0.9, "reason": "", "expertise_id": "exp-made-up", "items": NEW_LIFT["items"]}, req()).kind == "none"
    assert validate(None, req()).kind == "none"


def test_revision_drops_lines_already_in_the_expertise():
    msg = "From experience, CHWST drifting above 7.5 °C for >15 min is the earliest sign. Also the condenser pump VSD trips first when the tower is fouled."
    raw = {"kind": "revision", "confidence": 0.8, "reason": "", "expertise_id": "exp-chiller-fault", "items": [
        {"field": "knowledge", "text": "CHWST drifting above 7.5 °C for >15 min is the earliest sign.", "quote": "CHWST drifting above 7.5 °C for >15 min is the earliest sign"},
        {"field": "knowledge", "text": "The condenser pump VSD trips first when the cooling tower is fouled.", "quote": "the condenser pump VSD trips first when the tower is fouled"},
    ]}
    d = validate(raw, req(msg=msg))
    assert d.kind == "revision" and d.target.expertiseId == "exp-chiller-fault" and d.allowed
    assert len(d.items) == 1 and d.dropped == 1


def test_unknown_topic_falls_back_to_first_topic_of_domain():
    d = validate({**NEW_LIFT, "new": {**NEW_LIFT["new"], "topic": "Teleporters"}}, req())
    assert d.draft.topic == "Chillers & HVAC"


# ---------------------------------------------------------------- endpoint

client = TestClient(app)


def body(user=HAFIZ, msg=LIFT_MSG):
    return req(user=user, msg=msg).model_dump()


def test_endpoint_rejects_reviewers():
    r = client.post("/api/expertise/extract", json=body(user=ADRIAN))
    assert r.status_code == 403


def test_endpoint_skips_short_messages_without_calling_claude(monkeypatch):
    async def boom(*a, **k):
        raise AssertionError("Claude should not be called")
    monkeypatch.setattr(extract, "call_model", boom)
    r = client.post("/api/expertise/extract", json=body(msg="thanks, that helps"))
    assert r.status_code == 200 and r.json()["kind"] == "none"


def test_endpoint_happy_path(monkeypatch):
    from app.routers import capture
    from app.llm import claude

    async def fake(req, client):
        return NEW_LIFT
    monkeypatch.setattr(capture, "call_model", fake)
    monkeypatch.setattr(claude, "is_configured", lambda: True)
    r = client.post("/api/expertise/extract", json=body())
    j = r.json()
    assert r.status_code == 200 and j["kind"] == "new" and j["allowed"] is True and len(j["items"]) == 3
