"""Library, Review Queue and Chats persistence: governance rules, proposals, chat upserts and the
rating loop. Runs offline against in-memory SQLite (the same ORM models as Supabase Postgres)."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import app
from app.models import AuditLog, Expertise, ExpertiseVersion, Profile, Proposal

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
        Expertise(id="exp-chiller", name="Chiller Plant Fault Triage", domain="Technical Services", topic="Chillers & HVAC",
                  status="in_review", version="0.9", owner="Hafiz Rahman", **READY),
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


# --- auth stub ------------------------------------------------------------------

def test_email_header_identifies_the_demo_account(db):
    r = client.get("/api/chats", headers={"X-User-Email": "Priya@Fractal.demo"})
    assert r.status_code == 200
    assert client.get("/api/chats", headers={"X-User-Email": "nobody@fractal.demo"}).status_code == 404
    assert client.get("/api/chats").status_code == 401


# --- governance -------------------------------------------------------------------

def test_intern_and_out_of_domain_expert_cannot_approve(db):
    assert client.post("/api/expertise/exp-chiller/approve", headers=as_(ETHAN)).status_code == 403
    assert client.post("/api/expertise/exp-chiller/approve", headers=as_(MARCUS)).status_code == 403


def test_expert_cannot_approve_own_contribution(db):
    r = client.post("/api/expertise/exp-chiller/approve", headers=as_(HAFIZ))
    assert r.status_code == 403 and "own contribution" in r.json()["detail"]


def test_approve_bumps_09_to_10_with_snapshot_and_audit(db):
    r = client.post("/api/expertise/exp-chiller/approve", json={"note": "LGTM"}, headers=as_(PRIYA))
    assert r.status_code == 200, r.text
    e = r.json()
    assert (e["status"], e["version"], e["reviewer"]) == ("approved", "1.0", "Priya S.")
    assert e["versions"][-1]["version"] == "1.0"
    assert e["versions"][-1]["snapshot"]["guardrails"] == ["Never reset a freeze trip."]
    assert db.query(AuditLog).filter_by(action="expertise.approve", target_id="exp-chiller").count() == 1


def test_rollback_restores_snapshot_as_a_new_version(db):
    client.post("/api/expertise/exp-chiller/approve", headers=as_(ADRIAN))
    client.patch("/api/expertise/exp-chiller", json={"guardrails": ["Changed."]}, headers=as_(PRIYA))
    assert client.post("/api/expertise/exp-chiller/rollback", json={"version": "1.0"}, headers=as_(PRIYA)).status_code == 403
    r = client.post("/api/expertise/exp-chiller/rollback", json={"version": "1.0"}, headers=as_(ADRIAN))
    e = r.json()
    assert e["version"] == "1.1" and e["guardrails"] == ["Never reset a freeze trip."]
    assert [v["note"] for v in e["versions"]] == ["Approved", "Rolled back to v1.0"]


def test_patch_cannot_change_status_or_version(db):
    r = client.patch("/api/expertise/exp-chiller", json={"status": "approved", "version": "9.0", "name": "Renamed"}, headers=as_(PRIYA))
    e = r.json()
    assert (e["status"], e["version"], e["name"]) == ("in_review", "0.9", "Renamed")
    assert client.patch("/api/expertise/exp-chiller", json={"name": "x"}, headers=as_(MARCUS)).status_code == 403


def test_create_submit_and_delete_draft(db):
    body = {"id": "exp-new", "name": "Untitled Expertise", "domain": "Technical Services", "topic": "Chillers & HVAC",
            "status": "approved", "capture": {"capturedBy": "Priya S."}, "authorId": "u-priya"}
    assert client.post("/api/expertise", json=body, headers=as_(MARCUS)).status_code == 403
    e = client.post("/api/expertise", json=body, headers=as_(PRIYA)).json()
    assert (e["status"], e["authorId"], e["capture"]) == ("draft", "u-priya", {"capturedBy": "Priya S."})
    r = client.post("/api/expertise/exp-new/submit", headers=as_(PRIYA))
    assert r.status_code == 422 and "a clear name" in r.json()["detail"]
    client.patch("/api/expertise/exp-new", json={"name": "Condenser Approach Check", **{
        "summary": READY["summary"], "whenToUse": READY["when_to_use"], "knowledge": READY["knowledge"],
        "guardrails": READY["guardrails"], "escalation": READY["escalation"]}}, headers=as_(PRIYA))
    assert client.post("/api/expertise/exp-new/submit", headers=as_(PRIYA)).json()["status"] == "in_review"
    assert client.delete("/api/expertise/exp-new", headers=as_(HAFIZ)).status_code == 403  # no longer a draft
    assert client.delete("/api/expertise/exp-new", headers=as_(ADRIAN)).status_code == 204
    assert client.get("/api/expertise/exp-new").status_code == 404


# --- proposals ------------------------------------------------------------------------

def test_proposal_lifecycle(db):
    client.post("/api/expertise/exp-chiller/approve", headers=as_(ADRIAN))
    body = {"id": "prop-1", "expertiseId": "exp-chiller", "author": "Hafiz Rahman (captured from chat)",
            "reason": "Seen on site", "changes": {"knowledge": {"add": ["Check condenser approach."], "remove": ["Check load first."]}},
            "sources": [{"type": "conversation", "chatId": "chat-x"}], "meetingTitle": "Ops sync"}
    assert client.post("/api/proposals", json=body, headers=as_(ADRIAN)).status_code == 403  # reviewers don't author
    p = client.post("/api/proposals", json=body, headers=as_(HAFIZ)).json()
    assert (p["id"], p["status"], p["meetingTitle"]) == ("prop-1", "open", "Ops sync")
    assert [x["id"] for x in client.get("/api/proposals").json()] == ["prop-1"]

    assert client.post("/api/proposals/prop-1/approve", headers=as_(HAFIZ)).status_code == 403  # own contribution
    e = client.post("/api/proposals/prop-1/approve", headers=as_(PRIYA)).json()
    assert e["version"] == "1.1" and e["knowledge"] == ["Check condenser approach."]
    assert e["sources"][0]["chatId"] == "chat-x"
    assert client.get("/api/proposals").json() == []
    assert client.post("/api/proposals/prop-1/reject", headers=as_(ADRIAN)).status_code == 409


# --- chats ------------------------------------------------------------------------------

def _send(uid=PRIYA):
    client.put("/api/chats/chat-a", json={"title": "Level 23 too warm"}, headers=as_(uid))
    client.put("/api/chats/chat-a/messages/m1", json={"role": "user", "content": "CHWST is 8.1 °C", "createdAt": "2026-10-10T10:00:00Z"}, headers=as_(uid))
    return client.put("/api/chats/chat-a/messages/m2", headers=as_(uid), json={
        "role": "assistant", "createdAt": "2026-10-10T10:00:00.001Z",
        "responses": [
            {"id": "r1", "modelId": "claude-sonnet", "content": "Check load.", "expertiseUsed": [{"id": "exp-chiller", "version": "0.9"}]},
            {"id": "r2", "modelId": "gpt", "content": "Check pumps."},
        ]})


def test_chat_messages_and_responses_round_trip(db):
    assert _send().status_code == 200
    # finishing a stream re-saves the message: responses update in place, removed ones go away
    client.put("/api/chats/chat-a/messages/m2", headers=as_(PRIYA), json={
        "role": "assistant", "detectionState": "saved", "detectionResult": "exp-x", "detectionMissing": ["A clear name"],
        "responses": [{"id": "r1", "modelId": "claude-sonnet", "content": "Check load, then approach."}]})
    [chat] = client.get("/api/chats", headers=as_(PRIYA)).json()
    assert chat["title"] == "Level 23 too warm"
    assert [m["id"] for m in chat["messages"]] == ["m1", "m2"]
    m2 = chat["messages"][1]
    assert [r["content"] for r in m2["responses"]] == ["Check load, then approach."]
    assert (m2["detectionResult"], m2["detectionMissing"]) == ("exp-x", ["A clear name"])


def test_chats_are_private_to_their_owner(db):
    _send()
    assert client.get("/api/chats", headers=as_(HAFIZ)).json() == []
    assert client.put("/api/chats/chat-a", json={"title": "mine now"}, headers=as_(HAFIZ)).status_code == 404
    assert client.put("/api/chats/chat-a/messages/m9", json={"role": "user"}, headers=as_(HAFIZ)).status_code == 404
    assert client.post("/api/responses/r1/rating", json={"rating": "up"}, headers=as_(HAFIZ)).status_code == 404


# --- rating loop ----------------------------------------------------------------------

def test_thumbs_down_with_comment_creates_feedback_and_proposal(db):
    _send()
    r = client.post("/api/responses/r1/rating", headers=as_(PRIYA),
                    json={"rating": "down", "comment": "Check condenser approach first.", "proposalId": "prop-fb", "chatId": "chat-a"})
    out = r.json()
    assert out["proposal"]["id"] == "prop-fb"
    assert out["proposal"]["changes"] == {"knowledge": {"add": ["Check condenser approach first."], "remove": []}}
    [e] = out["expertise"]
    assert e["feedback"][0]["rating"] == "down" and e["feedback"][0]["chatId"] == "chat-a"
    [chat] = client.get("/api/chats", headers=as_(PRIYA)).json()
    assert chat["messages"][1]["responses"][0]["rating"] == "down"


def test_one_rating_per_person_per_answer(db):
    _send()
    rate = lambda rating: client.post("/api/responses/r1/rating", headers=as_(PRIYA),  # noqa: E731
                                      json={"rating": rating, "authorId": "u-priya", "responseKey": "r1"}).json()
    rate("up")
    [e] = rate("up")["expertise"]
    assert [f["rating"] for f in e["feedback"]] == ["up"] and e["successRate"] == 1.0
    [e] = rate("down")["expertise"]  # replaces the 👍
    assert [(f["rating"], f["userId"], f["responseKey"], f["version"]) for f in e["feedback"]] == [("down", "u-priya", "r1", "0.9")]
    assert e["successRate"] == 0.0
    [e] = rate(None)["expertise"]  # clicking the same thumb again takes it back
    assert e["feedback"] == [] and e["successRate"] is None


def test_live_expertise_cannot_be_deleted(db):
    client.post("/api/expertise/exp-chiller/approve", headers=as_(ADRIAN))
    r = client.delete("/api/expertise/exp-chiller", headers=as_(ADRIAN))
    assert r.status_code == 409 and "Deprecate it first" in r.json()["detail"]
    client.post("/api/expertise/exp-chiller/deprecate", headers=as_(ADRIAN))
    assert client.delete("/api/expertise/exp-chiller", headers=as_(ADRIAN)).status_code == 204


def test_thumbs_down_outside_domain_saves_feedback_only(db):
    _send(MARCUS)
    out = client.post("/api/responses/r1/rating", json={"rating": "down", "comment": "Wrong."}, headers=as_(MARCUS)).json()
    assert out["proposal"] is None and "Technical Services experts" in out["blocked"]
    assert len(out["expertise"][0]["feedback"]) == 1
    assert db.query(ExpertiseVersion).count() == 0


# --- retrieval resilience -------------------------------------------------------

def test_approve_succeeds_even_when_embedder_raises(db, monkeypatch):
    """index_expertise must never raise into the request: if embedding fails,
    the approve still returns 200."""
    from app.retrieval import index as retrieval_index

    # Force _ensure_table to think the embeddings table exists so the code
    # proceeds to call the embedder / run SQL (which will fail on SQLite).
    monkeypatch.setattr(retrieval_index, "_table_exists_cache", True)

    # Make the embedder raise.
    def boom(_text):
        raise RuntimeError("model download failed")
    monkeypatch.setattr(retrieval_index.embedder, "embed_text", boom)

    r = client.post("/api/expertise/exp-chiller/approve", json={"note": "LGTM"}, headers=as_(PRIYA))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "approved"


# --- regression: audit_log.actor must be UUID, not varchar ---------------------------

def test_audit_log_actor_column_is_uuid_on_postgres():
    """The audit_log.actor column is `uuid` in Postgres (migration
    20261010_core_schema.sql). The ORM model must use PgUUID so psycopg
    sends the right type — otherwise every governance write 500s with
    'column "actor" is of type uuid but expression is of type character
    varying' (regression for the audit-actor-uuid fix).
    """
    from sqlalchemy.dialects.postgresql import UUID as PgUUID

    col = AuditLog.__table__.c.actor
    # On the Postgres dialect the column type must resolve to UUID.
    pg_type = col.type.dialect_impl(dialect=__import__(
        "sqlalchemy.dialects.postgresql", fromlist=["dialect"]
    ).dialect())
    assert isinstance(pg_type, PgUUID), (
        f"audit_log.actor should be PgUUID on Postgres, got {type(pg_type).__name__}"
    )


def test_audit_log_actor_works_on_sqlite_variant():
    """The SQLite variant must be String so in-memory tests don't break."""
    from sqlalchemy import String as SaString

    col = AuditLog.__table__.c.actor
    sqlite_type = col.type.dialect_impl(dialect=__import__(
        "sqlalchemy.dialects.sqlite", fromlist=["dialect"]
    ).dialect())
    assert isinstance(sqlite_type, SaString), (
        f"audit_log.actor should be String on SQLite, got {type(sqlite_type).__name__}"
    )


# --- source chat read-only for reviewers & experts -----------------------------------

def _seed_source_chat(db):
    """Create a chat owned by Hafiz and a proposal linking to it as the source."""
    _send(HAFIZ)
    db.add(Proposal(
        id="prop-src", expertise_id="exp-chiller", type="revision",
        author="Hafiz Rahman (captured from chat)", reason="Seen on site",
        changes={"knowledge": {"add": ["Check condenser approach."], "remove": []}},
        chat_id="chat-a", status="open",
        sources=[{"type": "conversation", "chatId": "chat-a", "excerpt": "..."}],
    ))
    db.commit()


def test_owner_can_read_own_chat(db):
    _seed_source_chat(db)
    r = client.get("/api/chats/chat-a", headers=as_(HAFIZ))
    assert r.status_code == 200
    assert r.json()["ownerId"] and r.json()["ownerName"]


def test_reviewer_can_read_source_chat(db):
    _seed_source_chat(db)
    r = client.get("/api/chats/chat-a", headers=as_(ADRIAN))
    assert r.status_code == 200
    body = r.json()
    assert body["ownerId"] != ADRIAN  # not the reviewer's own chat
    # Non-owner access writes an audit row.
    assert db.query(AuditLog).filter_by(
        action="chat.view_source", target_id="chat-a"
    ).count() == 1


def test_domain_expert_can_read_source_chat(db):
    """Priya is a Technical Services expert; exp-chiller is in Technical Services."""
    _seed_source_chat(db)
    r = client.get("/api/chats/chat-a", headers=as_(PRIYA))
    assert r.status_code == 200
    assert db.query(AuditLog).filter_by(
        action="chat.view_source", target_id="chat-a"
    ).count() == 1


def test_out_of_domain_expert_gets_404(db):
    """Marcus is a Leasing expert; chat-a is the source of a Technical Services proposal."""
    _seed_source_chat(db)
    assert client.get("/api/chats/chat-a", headers=as_(MARCUS)).status_code == 404


def test_intern_gets_404(db):
    _seed_source_chat(db)
    assert client.get("/api/chats/chat-a", headers=as_(ETHAN)).status_code == 404


def test_no_source_link_means_404_for_non_owner(db):
    """Without a proposal/expertise referencing the chat, non-owners get 404."""
    _send(HAFIZ)
    assert client.get("/api/chats/chat-a", headers=as_(PRIYA)).status_code == 404
    assert client.get("/api/chats/chat-a", headers=as_(ADRIAN)).status_code == 200
