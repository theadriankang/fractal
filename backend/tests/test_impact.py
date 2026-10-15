"""Impact endpoint tests: the aggregation reflects real Expertise/feedback/proposal state."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import app
from app.models import AuditLog, Expertise, Feedback, Profile, Proposal

ADRIAN = "a1b2c3d4-0000-4000-8000-00000000ad01"
PRIYA = "a1b2c3d4-0000-4000-8000-00000000ad02"

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
        Expertise(id="exp-a", name="Chiller Triage", domain="Technical Services", topic="Chillers",
                  status="approved", version="1.0", owner="Priya S.", usage_count=10, **READY),
        Expertise(id="exp-b", name="Lift Fault Triage", domain="Technical Services", topic="Lifts",
                  status="draft", version="0.1", owner="Priya S.", usage_count=0, **READY),
        Expertise(id="exp-c", name="Renewal Playbook", domain="Leasing", topic="Renewals",
                  status="approved", version="1.0", owner="Priya S.", usage_count=5, **READY),
        Feedback(expertise_id="exp-a", user_name="Someone", rating="up"),
        Feedback(expertise_id="exp-a", user_name="Someone", rating="up"),
        Feedback(expertise_id="exp-a", user_name="Someone", rating="down"),
        Proposal(id="prop-1", expertise_id="exp-a", type="revision", author="Priya S.",
                 reason="correction", status="approved"),
        Proposal(id="prop-2", expertise_id="exp-a", type="revision", author="Priya S.",
                 reason="correction", status="open"),
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


def test_impact_aggregates_counts(db):
    r = client.get("/api/impact", headers=as_(ADRIAN))
    assert r.status_code == 200
    body = r.json()
    assert body["totalExpertise"] == 3
    assert body["approvedExpertise"] == 2
    assert body["draftExpertise"] == 1
    assert body["totalUsage"] == 15  # 10 + 0 + 5
    assert body["feedbackUp"] == 2
    assert body["feedbackDown"] == 1
    assert body["feedbackPositiveRate"] == pytest.approx(2 / 3)
    assert body["openProposals"] == 1
    assert body["approvedProposals"] == 1
    assert body["proposalApprovalRate"] == pytest.approx(1.0)


def test_impact_domain_breakdown(db):
    r = client.get("/api/impact", headers=as_(ADRIAN))
    by_domain = {d["domain"]: d for d in r.json()["byDomain"]}
    assert by_domain["Technical Services"]["total"] == 2
    assert by_domain["Technical Services"]["approved"] == 1
    assert by_domain["Leasing"]["total"] == 1
    assert by_domain["Leasing"]["approved"] == 1


def test_impact_empty_db_returns_nulls_not_errors(db):
    # Clear everything and confirm rates come back None rather than dividing by zero.
    db.query(Feedback).delete()
    db.query(Proposal).delete()
    db.query(Expertise).delete()
    db.commit()
    r = client.get("/api/impact", headers=as_(ADRIAN))
    assert r.status_code == 200
    body = r.json()
    assert body["totalExpertise"] == 0
    assert body["approvalRate"] is None
    assert body["feedbackPositiveRate"] is None
    assert body["proposalApprovalRate"] is None


def test_impact_trend_is_cumulative_and_matches_today(db):
    db.add(AuditLog(actor=ADRIAN, actor_role="reviewer", action="expertise.approve",
                     target_type="expertise", target_id="exp-a"))
    db.add(AuditLog(actor=ADRIAN, actor_role="reviewer", action="proposal.approve",
                     target_type="proposal", target_id="prop-1"))
    db.commit()

    r = client.get("/api/impact", headers=as_(ADRIAN))
    assert r.status_code == 200
    trend = r.json()["trend"]

    # 14 daily buckets, oldest first, today's bucket last.
    assert len(trend["labels"]) == 14
    assert len(trend["totalExpertise"]) == 14
    assert len(trend["approvalRate"]) == 14
    assert len(trend["feedbackPositiveRate"]) == 14
    assert len(trend["proposalsReviewed"]) == 14

    # Everything in the fixture was created "now", so it all lands in today's
    # (last) bucket -- the cumulative total as of today must match the
    # headline totals, and earlier buckets must be monotonically <= it.
    assert trend["totalExpertise"][-1] == 3
    assert trend["totalExpertise"][0] <= trend["totalExpertise"][-1]
    assert trend["proposalsReviewed"][-1] == 1
    # One expertise.approve and zero expertise.deprecate events -> rate is 100%.
    assert trend["approvalRate"][-1] == pytest.approx(1.0)
