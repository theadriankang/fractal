"""Unit tests for the decisionLogic -> structured DecisionStep migration.

Covers: schema coercion (plain string <-> structured dict), the text-flattening helper, and
governance.apply_changes' identity-by-text diff/dedup logic, now that entries can be dicts
instead of plain strings. These run offline, no DB/network required.
"""

from app.governance import apply_changes
from app.models import Expertise
from app.schemas import DecisionStep, ExpertiseOut, coerce_decision_logic, decision_step_text


# --- schema coercion ----------------------------------------------------------

def test_coerce_decision_logic_accepts_plain_strings():
    assert coerce_decision_logic(["Check CHWST."]) == [{"text": "Check CHWST."}]


def test_coerce_decision_logic_passes_through_dicts():
    step = {"text": "Check CHWST.", "condition": "CHWST > 7.5", "action": "Stage up.", "reasoning": "", "escalateIf": ""}
    assert coerce_decision_logic([step]) == [step]


def test_coerce_decision_logic_mixed_list():
    out = coerce_decision_logic(["plain", {"text": "structured", "condition": "x"}])
    assert out == [{"text": "plain"}, {"text": "structured", "condition": "x"}]


def test_expertise_out_accepts_legacy_plain_string_rows():
    """A DB row written before this migration (plain strings) must still serialise cleanly."""
    out = ExpertiseOut(
        id="exp-1", name="Test", domain="Technical Services", topic="HVAC", status="approved", version="1.0",
        owner="Priya", ownerRole="Engineer", summary="s", whenToUse="w",
        knowledge=[], decision_logic=["Check BMS first."], guardrails=[], escalation=[],
    )
    assert out.decision_logic == [DecisionStep(text="Check BMS first.")]


def test_expertise_out_accepts_new_structured_rows():
    out = ExpertiseOut(
        id="exp-1", name="Test", domain="Technical Services", topic="HVAC", status="approved", version="1.0",
        owner="Priya", ownerRole="Engineer", summary="s", whenToUse="w",
        knowledge=[], guardrails=[], escalation=[],
        decision_logic=[{"text": "Check BMS.", "condition": "CHWST > 7.5", "action": "Stage up.",
                          "reasoning": "", "escalateIf": ""}],
    )
    assert out.decision_logic[0].condition == "CHWST > 7.5"


# --- decision_step_text flattening --------------------------------------------

def test_decision_step_text_plain_string():
    assert decision_step_text("Check CHWST.") == "Check CHWST."


def test_decision_step_text_structured_dict():
    s = decision_step_text({
        "text": "Check CHWST.", "condition": "CHWST > 7.5", "action": "Stage up.",
        "reasoning": "avoid freeze", "escalateIf": "persists 30min",
    })
    assert s == "Check CHWST. (if CHWST > 7.5; then Stage up.; because avoid freeze; escalate if persists 30min)"


def test_decision_step_text_structured_model():
    step = DecisionStep(text="Check CHWST.", condition="CHWST > 7.5")
    assert decision_step_text(step) == "Check CHWST. (if CHWST > 7.5)"


def test_decision_step_text_text_only_has_no_parens():
    assert decision_step_text({"text": "Just text."}) == "Just text."


# --- governance.apply_changes --------------------------------------------------

def _e(**overrides):
    base = dict(
        id="exp-1", name="Test", domain="Technical Services", topic="HVAC", status="approved",
        version="1.0", owner="Priya", knowledge=[], decision_logic=[], guardrails=[], escalation=[],
    )
    base.update(overrides)
    return Expertise(**base)


def test_apply_changes_adds_structured_entries():
    e = _e(decision_logic=[])
    apply_changes(e, {"decisionLogic": {"add": [{"text": "Check CHWST.", "condition": "x"}], "remove": []}})
    assert e.decision_logic == [{"text": "Check CHWST.", "condition": "x"}]


def test_apply_changes_removes_by_text_identity_not_raw_equality():
    """A plain-string legacy entry must be removable by a remove list carrying the same text,
    even though the stored entry might later be a dict -- this is exactly what broke before the
    _item_key fix (set() of dicts, or raw `in` comparison across shapes)."""
    e = _e(decision_logic=[{"text": "Check CHWST.", "condition": "x"}, "Keep this one."])
    apply_changes(e, {"decisionLogic": {"add": [], "remove": ["Check CHWST."]}})
    assert e.decision_logic == ["Keep this one."]


def test_apply_changes_does_not_duplicate_existing_entry():
    e = _e(decision_logic=[{"text": "Check CHWST.", "condition": "x"}])
    apply_changes(e, {"decisionLogic": {"add": ["Check CHWST."], "remove": []}})
    # Already present (by text identity) -- the plain-string "add" must not create a duplicate.
    assert e.decision_logic == [{"text": "Check CHWST.", "condition": "x"}]


def test_apply_changes_mixed_shapes_add_and_remove_together():
    e = _e(decision_logic=["Old step.", {"text": "Keep.", "condition": "y"}])
    apply_changes(e, {
        "decisionLogic": {"add": [{"text": "New step.", "action": "do it"}], "remove": ["Old step."]},
    })
    # Removing and adding in one change rewrites the step in place (feedback loop), so order is kept.
    assert e.decision_logic == [{"text": "New step.", "action": "do it"}, {"text": "Keep.", "condition": "y"}]


def test_apply_changes_unaffected_field_untouched():
    e = _e(knowledge=["A fact."], decision_logic=["Step."])
    apply_changes(e, {"knowledge": {"add": ["New fact."], "remove": []}})
    assert e.knowledge == ["A fact.", "New fact."]
    assert e.decision_logic == ["Step."]  # untouched field stays exactly as-is


# --- full API round-trip (catches route-level serialization issues the unit tests above can't) --

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import app

_ADRIAN = "a1b2c3d4-0000-4000-8000-00000000de01"
_PRIYA = "a1b2c3d4-0000-4000-8000-00000000de02"

_STRUCTURED_STEP = {
    "text": "Check BMS: is CHWST above 7.5 C?",
    "condition": "CHWST > 7.5 C",
    "action": "Stage up a standby chiller.",
    "reasoning": "Plant is undersized for current demand.",
    "escalateIf": "",
}


@pytest.fixture()
def api_db():
    from app.models import Profile

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False)
    s = Session()
    s.add_all([
        Profile(id=_ADRIAN, name="Adrian", email="adrian@fractal.demo", role="reviewer", domains=[]),
        Profile(id=_PRIYA, name="Priya S.", email="priya@fractal.demo", role="contributor", domains=["Technical Services"]),
    ])
    s.commit()

    def override():
        yield s

    app.dependency_overrides[get_db] = override
    yield s
    app.dependency_overrides.clear()
    s.close()


def _as(uid):
    return {"X-User-Id": uid}


def test_create_expertise_with_structured_decision_logic_round_trips(api_db):
    client = TestClient(app)
    body = {
        "id": "exp-rt", "name": "Round Trip Test", "domain": "Technical Services", "topic": "HVAC",
        "summary": "s", "whenToUse": "w", "knowledge": [], "guardrails": ["Never reset."],
        "escalation": ["Call chief engineer."], "decisionLogic": [_STRUCTURED_STEP],
    }
    r = client.post("/api/expertise", json=body, headers=_as(_PRIYA))
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["decisionLogic"][0]["condition"] == "CHWST > 7.5 C"

    # GET round-trips the same structured shape.
    got = client.get("/api/expertise/exp-rt").json()
    assert got["decisionLogic"][0]["action"] == "Stage up a standby chiller."


def test_propose_and_approve_revision_with_structured_decision_logic(api_db):
    """Exercises governance.apply_changes through the real /approve route — the exact path that
    used to raise TypeError: unhashable type: 'dict' before the _item_key fix."""
    client = TestClient(app)
    create = client.post("/api/expertise", json={
        "id": "exp-rt2", "name": "Round Trip Test 2", "domain": "Technical Services", "topic": "HVAC",
        "summary": "s", "whenToUse": "w", "knowledge": [], "guardrails": ["Never reset."],
        "escalation": ["Call chief engineer."], "decisionLogic": ["Legacy plain-string step."],
    }, headers=_as(_PRIYA))
    assert create.status_code == 201
    client.post("/api/expertise/exp-rt2/submit", headers=_as(_PRIYA))
    client.post("/api/expertise/exp-rt2/approve", headers=_as(_ADRIAN))

    prop = client.post("/api/proposals", json={
        "expertiseId": "exp-rt2", "type": "revision", "reason": "Add structured step",
        "changes": {"decisionLogic": {"add": [_STRUCTURED_STEP], "remove": []}},
    }, headers=_as(_PRIYA))
    assert prop.status_code == 201, prop.text
    pid = prop.json()["id"]

    r = client.post(f"/api/proposals/{pid}/approve", headers=_as(_ADRIAN))
    assert r.status_code == 200, r.text

    e = client.get("/api/expertise/exp-rt2").json()
    texts = [d["text"] for d in e["decisionLogic"]]
    assert "Legacy plain-string step." in texts
    assert "Check BMS: is CHWST above 7.5 C?" in texts
