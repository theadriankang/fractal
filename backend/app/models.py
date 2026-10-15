"""SQLAlchemy ORM models — map 1:1 to the core migration tables."""

import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    String, Text, Boolean, Integer, BigInteger, Float, DateTime,
    ForeignKey, JSON,
)
from sqlalchemy.dialects.postgresql import ARRAY, UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _now():
    return datetime.now(timezone.utc)


def _uuid_str():
    return str(uuid.uuid4())


class Profile(Base):
    __tablename__ = "profiles"
    id: Mapped[str] = mapped_column(PgUUID(as_uuid=False), primary_key=True)
    name: Mapped[str] = mapped_column(Text, default="")
    email: Mapped[str | None] = mapped_column(Text, nullable=True)
    role: Mapped[str] = mapped_column(String, default="contributor")
    # text[] in Postgres; JSON elsewhere so the API tests can run on SQLite.
    domains: Mapped[list] = mapped_column(ARRAY(Text).with_variant(JSON, "sqlite"), default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Chat(Base):
    __tablename__ = "chats"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid_str)
    # FK to auth.users is defined in SQL only — SQLAlchemy can't resolve
    # the auth schema, so no ForeignKey() here.
    user_id: Mapped[str] = mapped_column(PgUUID(as_uuid=False))
    title: Mapped[str] = mapped_column(Text, default="New Chat")
    folder: Mapped[str | None] = mapped_column(Text, nullable=True)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    messages: Mapped[list["Message"]] = relationship(
        "Message", back_populates="chat", cascade="all, delete-orphan",
        order_by="Message.created_at",
    )


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    chat_id: Mapped[str] = mapped_column(String, ForeignKey("chats.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(String)
    content: Mapped[str] = mapped_column(Text, default="")
    files: Mapped[list] = mapped_column(JSON, default=list)
    attached_expertise: Mapped[list] = mapped_column(JSON, default=list)
    web_search: Mapped[bool] = mapped_column(Boolean, default=False)
    detection: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    detection_state: Mapped[str | None] = mapped_column(String, nullable=True)
    detection_result: Mapped[str | None] = mapped_column(Text, nullable=True)
    detection_missing: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    chat: Mapped["Chat"] = relationship("Chat", back_populates="messages")
    responses: Mapped[list["Response"]] = relationship(
        "Response", back_populates="message", cascade="all, delete-orphan",
        order_by="Response.created_at",
    )


class Response(Base):
    __tablename__ = "responses"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid_str)
    message_id: Mapped[str] = mapped_column(String, ForeignKey("messages.id", ondelete="CASCADE"))
    model_id: Mapped[str] = mapped_column(String, default="")
    auto: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    expertise_used: Mapped[list] = mapped_column(JSON, default=list)
    content: Mapped[str] = mapped_column(Text, default="")
    rating: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    message: Mapped["Message"] = relationship("Message", back_populates="responses")


class Expertise(Base):
    __tablename__ = "expertise"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    domain: Mapped[str] = mapped_column(Text, nullable=False)
    topic: Mapped[str] = mapped_column(Text, default="")
    asset_types: Mapped[list] = mapped_column(JSON, default=list)
    related: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String, default="draft")
    version: Mapped[str] = mapped_column(String, default="0.1")
    owner: Mapped[str] = mapped_column(Text, default="")
    owner_role: Mapped[str] = mapped_column(Text, default="")
    reviewer: Mapped[str | None] = mapped_column(Text, nullable=True)
    keywords: Mapped[list] = mapped_column(JSON, default=list)
    usage_count: Mapped[int] = mapped_column(Integer, default=0)
    success_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    summary: Mapped[str] = mapped_column(Text, default="")
    when_to_use: Mapped[str] = mapped_column(Text, default="")
    knowledge: Mapped[list] = mapped_column(JSON, default=list)
    decision_logic: Mapped[list] = mapped_column(JSON, default=list)
    guardrails: Mapped[list] = mapped_column(JSON, default=list)
    escalation: Mapped[list] = mapped_column(JSON, default=list)
    sources: Mapped[list] = mapped_column(JSON, default=list)
    feedback: Mapped[list] = mapped_column(JSON, default=list)
    # Saved test questions (feedback loop): from 👍 answers and approved corrections.
    test_cases: Mapped[list] = mapped_column(JSON, default=list)
    origin: Mapped[str | None] = mapped_column(Text, nullable=True)
    capture: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    author_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class DataReport(Base):
    """A generated Data Insights report: automated analysis + top-issue flags on any
    uploaded tabular data, kept historically so trends build up over time.

    `narrative` is the Expertise-grounded synthesis (analysis, blind spots, prioritised
    issues, potential resolutions) written as if the relevant domain expert were explaining
    the data — not just the raw statistical top_issues table. `expertise_used` /
    `domains_coordinated` record which approved Expertise grounded that synthesis.
    `qa_history` persists every follow-up question asked about this report (and its
    grounded answer) so past exchanges stay available for future reference, the same way
    the report itself does."""
    __tablename__ = "data_reports"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid_str)
    title: Mapped[str] = mapped_column(Text, default="")
    source_filename: Mapped[str] = mapped_column(Text, default="")
    domains: Mapped[list] = mapped_column(JSON, default=list)
    html: Mapped[str] = mapped_column(Text, default="")
    top_issues: Mapped[list] = mapped_column(JSON, default=list)
    raw_metrics: Mapped[dict] = mapped_column(JSON, default=dict)
    narrative: Mapped[str] = mapped_column(Text, default="")
    chart_spec: Mapped[dict] = mapped_column(JSON, default=dict)
    expertise_used: Mapped[list] = mapped_column(JSON, default=list)
    domains_coordinated: Mapped[list] = mapped_column(JSON, default=list)
    qa_history: Mapped[list] = mapped_column(JSON, default=list)
    created_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ExpertiseVersion(Base):
    __tablename__ = "expertise_versions"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid_str)
    expertise_id: Mapped[str] = mapped_column(String, ForeignKey("expertise.id", ondelete="CASCADE"))
    version: Mapped[str] = mapped_column(String, nullable=False)
    date: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    author: Mapped[str] = mapped_column(Text, default="")
    approved_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    note: Mapped[str] = mapped_column(Text, default="")
    snapshot: Mapped[dict] = mapped_column(JSON, default=dict)


class Proposal(Base):
    __tablename__ = "proposals"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    expertise_id: Mapped[str] = mapped_column(String, ForeignKey("expertise.id", ondelete="CASCADE"))
    type: Mapped[str] = mapped_column(String, default="revision")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    author: Mapped[str] = mapped_column(Text, default="")
    reason: Mapped[str] = mapped_column(Text, default="")
    changes: Mapped[dict] = mapped_column(JSON, default=dict)
    chat_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String, default="open")
    author_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    capture: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    sources: Mapped[list] = mapped_column(JSON, default=list)
    meeting_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    meeting_title: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Feedback-loop metadata for 👎 corrections: origin, diagnosis, confidence, engine, set,
    # baseVersion, reportCount, reports, testCase, testRun (src/lib/feedbackLoop.js).
    loop: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class Feedback(Base):
    __tablename__ = "feedback"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid_str)
    expertise_id: Mapped[str] = mapped_column(String, ForeignKey("expertise.id", ondelete="CASCADE"))
    response_id: Mapped[str | None] = mapped_column(String, ForeignKey("responses.id", ondelete="SET NULL"), nullable=True)
    user_name: Mapped[str] = mapped_column(Text, default="")
    rating: Mapped[str] = mapped_column(String, nullable=False)
    comment: Mapped[str] = mapped_column(Text, default="")
    chat_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_id: Mapped[str | None] = mapped_column(Text, nullable=True)  # demo account id until Supabase Auth
    response_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[str | None] = mapped_column(Text, nullable=True)
    date: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    actor: Mapped[str | None] = mapped_column(PgUUID(as_uuid=False).with_variant(String, "sqlite"), nullable=True)
    actor_role: Mapped[str | None] = mapped_column(String, nullable=True)
    action: Mapped[str] = mapped_column(Text, default="")
    target_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    detail: Mapped[dict] = mapped_column(JSON, default=dict)


class KnowledgeGap(Base):
    """A question approved Expertise couldn't answer (no match, or only a weak one).

    Similar questions merge into one gap, so the Review Queue can show "asked 8 times by 5 people".
    Lifecycle: open -> drafting (an expert started a draft from it) -> resolved (that draft was
    approved, or a re-check found approved Expertise now covers it); or dismissed (off-topic).
    See backend/app/gaps.py.
    """

    __tablename__ = "knowledge_gaps"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    question: Mapped[str] = mapped_column(Text, nullable=False)  # the first wording seen
    domain: Mapped[str | None] = mapped_column(Text, nullable=True)  # best guess; None = unsorted
    kind: Mapped[str] = mapped_column(String, default="none")  # none = nothing matched, weak = low confidence
    best_score: Mapped[float] = mapped_column(Float, default=0.0)
    nearest_expertise_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    nearest_expertise_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String, default="open")
    ask_count: Mapped[int] = mapped_column(Integer, default=1)
    askers: Mapped[list] = mapped_column(JSON, default=list)  # [{id, name}] distinct people
    examples: Mapped[list] = mapped_column(JSON, default=list)  # latest wordings [{question, asker, chatId, at}]
    embedding: Mapped[list | None] = mapped_column(JSON, nullable=True)  # for merging similar questions
    expertise_id: Mapped[str | None] = mapped_column(String, ForeignKey("expertise.id", ondelete="SET NULL"), nullable=True)
    resolved_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolution: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    last_asked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
