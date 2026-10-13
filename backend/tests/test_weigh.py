"""Cross-domain weighing: expert selection, validation of the model's answer, quick mode and the
endpoint. Claude is stubbed and search is patched, so these run offline on in-memory SQLite."""

import asyncio
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import app
from app.models import Expertise
from app.retrieval import index
from app.weigh import engine, select
from app.weigh.engine import assemble, explicit_request, handoff_gaps, rules_weigh, validate, weigh, weigh_auto
from app.weigh.select import select_experts

# Trimmed copies of the seed Expertise in src/data/expertise.js.
CHILLER = dict(
    id="exp-chiller-fault", name="Chiller Plant Fault Triage", domain="Technical Services", status="approved", version="1.3",
    owner="Tan Wei Ming", owner_role="Senior M&E Engineer", related=["exp-tenant-complaint", "exp-chiller-seq", "exp-energy-peak"],
    keywords=["chiller", "cooling", "temperature"], summary="Triage for chiller alarms and too-warm complaints.",
    knowledge=["Tenant complaints on a single floor usually point to AHU/VAV issues, not the chiller plant."],
    decision_logic=["Check BMS: is CHWST above 7.5 °C? If no → treat as local AHU/VAV issue on affected floors."],
    guardrails=["Never recommend running all chillers at full load to \"catch up\" — risk of surge and demand-charge spike."],
    escalation=["Two or more chillers unavailable during office hours → Facility Manager + notify tenants via Tenant Experience team."],
)
SEQ = dict(
    id="exp-chiller-seq", name="Chiller Sequencing for Efficiency", domain="Energy Optimisation", status="approved", version="1.0",
    owner="Nurul Huda", related=["exp-chiller-fault"], keywords=["sequencing"], summary="Stage chillers by load.",
    decision_logic=["Stage chillers to keep each between 60 and 85% load."], guardrails=[], escalation=[],
)
PEAK = dict(
    id="exp-energy-peak", name="Peak Demand Shaving", domain="Energy Optimisation", status="approved", version="2.0",
    owner="Nurul Huda", owner_role="Energy Manager", related=["exp-chiller-seq", "exp-tenant-complaint"],
    keywords=["peak", "demand", "tariff"], summary="Cut peak-demand charges with pre-cooling and staged AHU starts.",
    knowledge=["Space temperature can float to 25 °C for 30 min without measurable complaint increase."],
    decision_logic=["Pre-cool tenant floors from 7:00 and let space temperature float during the morning peak."],
    guardrails=["Never let space temperature exceed 25.5 °C in tenant areas."],
    escalation=["Any change affecting tenant lease comfort clauses → Leasing + Asset Manager approval."],
)
TENANT = dict(
    id="exp-tenant-complaint", name="Tenant Complaint Handling (Comfort)", domain="Tenant Experience", status="approved",
    version="1.1", owner="Jasmine Ong", related=["exp-chiller-fault", "exp-lease-renewal"], keywords=["tenant", "complaint", "comfort"],
    summary="Keep tenants informed on comfort complaints.",
    knowledge=["Repeat complaints from the same tenant within 30 days are a renewal risk signal."],
    decision_logic=["If repeat complaint within 30 days → flag to Asset Manager as renewal risk."],
    guardrails=["Never let a tenant floor run warm while a comfort complaint on that floor is still open."],
    escalation=["Anchor tenant or repeat complaint → Asset Manager within same day."],
)
LEASE = dict(  # in review: must never be weighed
    id="exp-lease-renewal", name="Lease Renewal Risk Signals", domain="Leasing", status="in_review", version="0.9",
    owner="Marcus Teo", related=["exp-tenant-complaint"], keywords=["lease"], summary="Renewal risk.",
)


@pytest.fixture()
def db():
    engine_ = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine_)
    session = sessionmaker(bind=engine_)()
    session.add_all(Expertise(**e) for e in (CHILLER, SEQ, PEAK, TENANT, LEASE))
    session.commit()
    yield session
    session.close()


def hits(*pairs):
    return lambda db, q, attached_ids=None, limit=2, relative_cutoff=None: [
        {"id": i, "score": s, "reason": f"semantic match ({s:.0%})"} for i, s in pairs
    ]


def picked_for(db, ids):
    rows = {e.id: e for e in db.query(Expertise).all()}
    return [(select._expert(rows[i], "search", ""), rows[i]) for i in ids]


# ---------------------------------------------------------------- selection

def test_one_voice_per_domain_plus_linked_domains_and_never_unapproved(db, monkeypatch):
    monkeypatch.setattr(index, "search", hits(("exp-energy-peak", 0.71), ("exp-chiller-seq", 0.66), ("exp-chiller-fault", 0.52)))
    picked = select_experts(db, "Can we pre-cool to cut the Monday peak?")
    got = [(x.id, x.via) for x, _ in picked]
    # Tenant joins through Peak's related link; Sequencing is not seated as a search hit (Energy already
    # has a voice) but comes last as a linked second Energy voice.
    assert got == [("exp-energy-peak", "search"), ("exp-chiller-fault", "search"), ("exp-tenant-complaint", "linked"),
                   ("exp-chiller-seq", "linked")]
    assert picked[2][0].reason == "linked from Peak Demand Shaving"
    assert picked[3][0].reason == "same domain, linked from Peak Demand Shaving"
    assert "exp-lease-renewal" not in [x.id for x, _ in picked]


def test_attached_expertise_always_takes_part(db, monkeypatch):
    monkeypatch.setattr(index, "search", hits(("exp-energy-peak", 0.71)))
    picked = select_experts(db, "peak demand", ["exp-chiller-seq", "exp-lease-renewal"])
    assert [(x.id, x.via) for x, _ in picked][:2] == [("exp-chiller-seq", "attached"), ("exp-chiller-fault", "linked")]
    assert "exp-lease-renewal" not in [x.id for x, _ in picked]


def test_selection_is_capped(db, monkeypatch):
    monkeypatch.setattr(index, "search", hits(("exp-energy-peak", 0.71), ("exp-chiller-fault", 0.5), ("exp-tenant-complaint", 0.45)))
    assert len(select_experts(db, "q", max_experts=2)) == 2


# ---------------------------------------------------------------- validation of the model's answer

RAW = {
    "summary": "Pre-cooling can work if the open complaint floor is excluded.",
    "perspectives": [
        {"expertise_id": "exp-energy-peak", "position": "Pre-cool and stagger AHU starts.", "key_points": ["a", "b", "c", "d"]},
        {"expertise_id": "exp-made-up", "position": "x"},
    ],
    "overlaps": [
        {"point": "Comfort limit", "expertise_ids": ["exp-energy-peak", "exp-tenant-complaint"], "detail": "Both protect comfort."},
        {"point": "Alone", "expertise_ids": ["exp-energy-peak", "exp-made-up"]},
    ],
    "tensions": [
        {  # paraphrased evidence → replaced by the record's own line
            "point": "Floating temperature vs open complaint", "idea_from": "exp-energy-peak", "constraint_from": "exp-tenant-complaint",
            "evidence": "never let a tenant floor run warm while a comfort complaint is open", "severity": "blocker",
            "reconcile": "Exclude that floor.",
        },
        {  # invented rule → dropped
            "point": "Invented", "idea_from": "exp-energy-peak", "constraint_from": "exp-chiller-fault",
            "evidence": "Chillers must never be restarted on Mondays.", "severity": "caution",
        },
        {"point": "Self", "idea_from": "exp-energy-peak", "constraint_from": "exp-energy-peak", "evidence": "x"},
    ],
    "suggestions": [
        {"text": "Pre-cool every floor except the one with the open complaint.", "based_on": ["exp-energy-peak", "exp-tenant-complaint"],
         "views": [{"expertise_id": "exp-chiller-fault", "stance": "maybe", "note": "Check AHU first."},
                   {"expertise_id": "exp-made-up", "stance": "supports"}]},
        {"text": "Buy a bigger chiller.", "based_on": ["exp-made-up"]},
    ],
    "gaps": ["No Expertise on BMS scheduling limits."],
}


def test_validate_keeps_only_traceable_claims(db):
    picked = picked_for(db, ["exp-energy-peak", "exp-chiller-fault", "exp-tenant-complaint"])
    parts, dropped = validate(RAW, picked)
    assert set(parts["perspectives"]) == {"exp-energy-peak"}
    assert len(parts["perspectives"]["exp-energy-peak"].keyPoints) == 3
    assert [o.point for o in parts["overlaps"]] == ["Comfort limit"]
    (t,) = parts["tensions"]
    assert t.severity == "blocker" and t.evidence == TENANT["guardrails"][0]
    s1, s2 = parts["suggestions"]
    assert [(v.expertiseId, v.stance) for v in s1.views] == [("exp-chiller-fault", "conditional")]
    assert not s1.general and s2.general and s2.basedOn == []
    assert dropped == 4  # unknown perspective, one-sided overlap, invented rule, self-tension
    assert validate("not a dict", picked) is None


def test_every_expert_keeps_a_voice_and_records_drive_escalations(db):
    picked = picked_for(db, ["exp-energy-peak", "exp-chiller-fault", "exp-tenant-complaint"])
    parts, dropped = validate(RAW, picked)
    r = assemble("q", picked, parts, mode="model", model="m", dropped=dropped)
    assert [p.expertiseId for p in r.perspectives] == ["exp-energy-peak", "exp-chiller-fault", "exp-tenant-complaint"]
    assert r.perspectives[1].position == CHILLER["summary"]  # filled from the record, not invented
    assert {e.expertiseId for e in r.escalations} == {"exp-energy-peak", "exp-chiller-fault", "exp-tenant-complaint"}
    # Peak Demand asks for Leasing approval, but no approved Leasing Expertise was weighed.
    assert any(g.startswith("Energy Optimisation expects Leasing") for g in r.gaps)
    assert "No Expertise on BMS scheduling limits." in r.gaps


def test_handoff_gap_disappears_when_that_domain_is_present(db):
    assert not any("Tenant Experience" in g for g in handoff_gaps(picked_for(db, ["exp-chiller-fault", "exp-tenant-complaint"])))
    assert any("Tenant Experience" in g for g in handoff_gaps(picked_for(db, ["exp-chiller-fault", "exp-energy-peak"])))


# ---------------------------------------------------------------- quick mode

def test_rules_mode_finds_overlap_and_guardrail_tension(db):
    picked = picked_for(db, ["exp-energy-peak", "exp-tenant-complaint"])
    parts = rules_weigh(picked)
    assert parts["overlaps"] and parts["overlaps"][0].expertiseIds == ["exp-energy-peak", "exp-tenant-complaint"]
    t = next(t for t in parts["tensions"] if t.ideaFrom == "exp-energy-peak")
    assert t.constraintFrom == "exp-tenant-complaint" and t.evidence == TENANT["guardrails"][0]
    s = next(s for s in parts["suggestions"] if s.basedOn == ["exp-energy-peak"])
    assert [(v.expertiseId, v.stance) for v in s.views] == [("exp-tenant-complaint", "concern")]


# ---------------------------------------------------------------- weigh(): which mode runs

class StubClient:
    def __init__(self, raw=None, error=None):
        self.raw, self.error, self.calls = raw, error, 0
        self.messages = self

    async def create(self, **kw):
        self.calls += 1
        if self.error:
            raise self.error
        return SimpleNamespace(content=[SimpleNamespace(type="tool_use", input=self.raw)])


def run(*a, **kw):
    return asyncio.run(weigh(*a, **kw))


def test_modes(db):
    picked = picked_for(db, ["exp-energy-peak", "exp-chiller-fault", "exp-tenant-complaint"])
    assert run("q", []).mode == "none"
    one = run("q", picked[:1], client=StubClient(RAW))
    assert one.mode == "rules" and "no other domain" in one.summary
    assert run("q", picked).note == engine.QUICK_NOTE
    assert "unavailable" in run("q", picked, client=StubClient(error=RuntimeError("down"))).note
    live = run("q", picked, client=StubClient(RAW))
    assert live.mode == "model" and live.tensions and live.summary == RAW["summary"]


# ---------------------------------------------------------------- endpoint

def test_endpoint_returns_result_with_markdown(db, monkeypatch):
    monkeypatch.setattr(index, "search", hits(("exp-energy-peak", 0.71), ("exp-chiller-fault", 0.52)))
    monkeypatch.setattr("app.routers.weigh.claude.is_configured", lambda: False)
    app.dependency_overrides[get_db] = lambda: db
    try:
        res = TestClient(app).post("/api/expertise/weigh", json={"question": "Pre-cool on Monday to cut the peak?"})
    finally:
        app.dependency_overrides.clear()
    assert res.status_code == 200
    body = res.json()
    assert [x["domain"] for x in body["experts"]] == ["Energy Optimisation", "Technical Services", "Tenant Experience",
                                                      "Energy Optimisation"]
    assert body["mode"] == "rules" and body["markdown"].startswith("**Weighed 4 experts across 3 domains.**")
    assert "Loop in before acting" in body["markdown"]


def test_endpoint_rejects_empty_question():
    assert TestClient(app).post("/api/expertise/weigh", json={"question": ""}).status_code == 422


# ---------------------------------------------------------------- structured decision steps (DecisionStep)

def test_structured_decision_steps_are_read_as_text(db):
    """decisionLogic entries are now DecisionStep dicts, not plain strings: every path must read them."""
    peak = db.get(Expertise, "exp-energy-peak")
    peak.decision_logic = [{
        "text": PEAK["decision_logic"][0], "condition": "Peaks cluster at morning start-up",
        "action": "Pre-cool tenant floors and let space temperature float", "reasoning": "Shifts load off the peak", "escalateIf": "",
    }]
    db.commit()
    picked = picked_for(db, ["exp-energy-peak", "exp-tenant-complaint"])
    prompt = engine.build_prompt("q", picked)
    assert PEAK["decision_logic"][0] in prompt and "{'text'" not in prompt
    parts = rules_weigh(picked)
    assert parts["perspectives"]["exp-energy-peak"].keyPoints == [PEAK["decision_logic"][0]]
    assert any(t.ideaFrom == "exp-energy-peak" for t in parts["tensions"])
    assert parts["suggestions"][0].text == PEAK["decision_logic"][0]
    # A model quoting the step back (as the prompt rendered it) still traces to the record.
    assert engine._evidence(engine.decision_step_text(peak.decision_logic[0]), peak) == PEAK["decision_logic"][0]


# ---------------------------------------------------------------- two Expertise from the same domain

def test_same_domain_second_voice_only_when_linked_and_capped(db, monkeypatch):
    monkeypatch.setattr(index, "search", hits(("exp-energy-peak", 0.71)))
    picked = select_experts(db, "pre-cool on Monday to cut the peak", max_experts=4)
    energy = [x.id for x, _ in picked if x.domain == "Energy Optimisation"]
    assert energy == ["exp-energy-peak", "exp-chiller-seq"]  # linked → seated, never more than two
    # Not linked to anything seated in its own domain → no second voice.
    db.get(Expertise, "exp-energy-peak").related = ["exp-tenant-complaint"]
    db.get(Expertise, "exp-chiller-fault").related = []
    db.commit()
    picked = select_experts(db, "pre-cool on Monday to cut the peak", max_experts=4)
    assert [x.id for x, _ in picked if x.domain == "Energy Optimisation"] == ["exp-energy-peak"]


def test_same_domain_tension_keeps_its_deciding_factor(db):
    picked = picked_for(db, ["exp-energy-peak", "exp-chiller-seq"])
    raw = {
        "summary": "s", "perspectives": [], "overlaps": [], "suggestions": [],
        "tensions": [{
            "point": "Pre-cooling runs chillers at low part load", "idea_from": "exp-energy-peak",
            "constraint_from": "exp-chiller-seq", "evidence": SEQ["decision_logic"][0], "severity": "caution",
            "deciding_factor": "Net saving = peak kW cut × demand rate − extra pre-cooling kWh × energy rate.",
        }],
    }
    parts, dropped = validate(raw, picked)
    (t,) = parts["tensions"]
    assert dropped == 0 and t.decidingFactor.startswith("Net saving")
    md = engine.to_markdown(assemble("q", picked, parts, mode="model"))
    assert "Energy Optimisation (Peak Demand Shaving)" in md and "Deciding factor: Net saving" in md


# ---------------------------------------------------------------- automatic mode (chat): when does weighing come into play?

def auto(*a, **kw):
    return asyncio.run(weigh_auto(*a, **kw))


NO_CONFLICT = {**RAW, "tensions": []}


def test_explicit_request_by_two_areas_or_a_trade_off():
    two = [1, 2]
    assert "Energy Optimisation and Tenant Experience" in explicit_request("Can we cut the energy bill without the tenants noticing?", two)
    assert "even though" in explicit_request("Pre-cool at 7:00 even though load is low?", two)
    assert explicit_request("How do I triage a chiller alarm?", two) == ""
    assert explicit_request("Pre-cool at 7:00 even though load is low?", [1]) == ""  # one expert: nothing to weigh


def test_auto_comes_into_play_only_on_request_or_real_conflict(db):
    picked = picked_for(db, ["exp-energy-peak", "exp-chiller-fault", "exp-tenant-complaint"])
    plain = "How should we handle the Monday start-up?"
    # Nothing asked, experts agree → stays out of the way, no model claims shown.
    quiet = auto(plain, picked, client=StubClient(NO_CONFLICT))
    assert not quiet.triggered and quiet.mode == "none" and not quiet.tensions
    # Nothing asked, but the checked weighing found a conflict → comes into play and says why.
    conflict = auto(plain, picked, client=StubClient(RAW))
    assert conflict.triggered and conflict.tensions and "pull in different directions" in conflict.trigger
    # Asked about a trade-off → comes into play even without a conflict.
    asked = auto("Should we pre-cool even though it costs comfort?", picked, client=StubClient(NO_CONFLICT))
    assert asked.triggered and "trade-off" in asked.trigger


def test_auto_without_a_model_only_answers_explicit_requests(db):
    picked = picked_for(db, ["exp-energy-peak", "exp-tenant-complaint"])
    assert not auto("How should we handle the Monday start-up?", picked).triggered
    r = auto("Can we cut energy use without upsetting tenants?", picked)
    assert r.triggered and r.mode == "rules"


def test_auto_skips_the_model_when_fewer_than_two_experts_or_checks_are_off(db):
    stub = StubClient(RAW)
    assert not auto("Pre-cool even though load is low?", picked_for(db, ["exp-energy-peak"]), client=stub).triggered
    two = picked_for(db, ["exp-energy-peak", "exp-tenant-complaint"])
    assert not auto("How should we handle the Monday start-up?", two, client=stub, check_implicit=False).triggered
    assert stub.calls == 0


def test_auto_endpoint_and_readable_database_error(db, monkeypatch):
    from sqlalchemy.exc import OperationalError
    monkeypatch.setattr(index, "search", hits(("exp-energy-peak", 0.71)))
    monkeypatch.setattr("app.routers.weigh.claude.is_configured", lambda: False)
    app.dependency_overrides[get_db] = lambda: db
    try:
        client = TestClient(app)
        body = client.post("/api/expertise/weigh", json={"question": "How do I read the BMS trend?", "auto": True}).json()
        assert body["triggered"] is False and body["markdown"] == ""

        def down(*a, **kw):
            raise OperationalError("select 1", {}, Exception("connection refused"))
        monkeypatch.setattr("app.routers.weigh.select_experts", down)
        res = client.post("/api/expertise/weigh", json={"question": "anything", "auto": True})
        assert res.status_code == 503 and "DATABASE_URL" in res.json()["detail"]
    finally:
        app.dependency_overrides.clear()

