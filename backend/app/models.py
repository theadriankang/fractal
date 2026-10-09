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
    origin: Mapped[str | None] = mapped_column(Text, nullable=True)
    capture: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    author_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


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
    actor: Mapped[str | None] = mapped_column(String, nullable=True)
    actor_role: Mapped[str | None] = mapped_column(String, nullable=True)
    action: Mapped[str] = mapped_column(Text, default="")
    target_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
