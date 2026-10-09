"""Pydantic schemas — camelCase JSON matching the front-end shapes,
plus chat-stream request schemas for the Claude chat backend."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


# ===========================================================================
# CamelCase base — used by chats / expertise / proposals routers
# ===========================================================================

class CamelModel(BaseModel):
    """Base that serialises to camelCase (alias) and accepts camelCase input."""

    model_config = ConfigDict(
        populate_by_name=True,
        alias_generator=lambda field_name: _to_camel(field_name),
        from_attributes=True,
    )


def _to_camel(snake: str) -> str:
    parts = snake.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


# --- Response nested in a message ------------------------------------------
class ResponseCreate(CamelModel):
    model_id: str = ""
    auto: Optional[dict] = None
    expertise_used: list[dict] = Field(default_factory=list)
    content: str = ""
    rating: Optional[str] = None


class ResponseOut(ResponseCreate):
    id: str


# --- Messages ---------------------------------------------------------------
class MessageCreate(CamelModel):
    id: Optional[str] = None
    role: str = "user"
    content: str = ""
    files: list[dict] = Field(default_factory=list)
    attached_expertise: list[str] = Field(default_factory=list)
    web_search: bool = False
    detection: Optional[dict] = None
    detection_state: Optional[str] = None
    responses: list[ResponseCreate] = Field(default_factory=list)


class MessageOut(MessageCreate):
    id: str
    responses: list[ResponseOut] = Field(default_factory=list)
    created_at: Optional[datetime] = None


# --- Chats ------------------------------------------------------------------
class ChatCreate(CamelModel):
    id: Optional[str] = None
    title: str = "New Chat"
    folder: Optional[str] = None
    pinned: bool = False


class ChatPatch(CamelModel):
    title: Optional[str] = None
    folder: Optional[str] = None
    pinned: Optional[bool] = None


class ChatOut(CamelModel):
    id: str
    title: str
    folder: Optional[str] = None
    pinned: bool = False
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    messages: list[MessageOut] = Field(default_factory=list)


# --- Expertise --------------------------------------------------------------
class ExpertiseCreate(CamelModel):
    id: Optional[str] = None
    name: str = "Untitled Expertise"
    domain: str = "Asset Operations"
    topic: str = ""
    asset_types: list[str] = Field(default_factory=lambda: ["Office"])
    related: list[str] = Field(default_factory=list)
    status: str = "draft"
    version: str = "0.1"
    owner: str = ""
    owner_role: str = ""
    reviewer: Optional[str] = None
    keywords: list[str] = Field(default_factory=list)
    usage_count: int = 0
    success_rate: Optional[float] = None
    summary: str = ""
    when_to_use: str = ""
    knowledge: list[str] = Field(default_factory=list)
    decision_logic: list[str] = Field(default_factory=list)
    guardrails: list[str] = Field(default_factory=list)
    escalation: list[str] = Field(default_factory=list)
    sources: list[dict] = Field(default_factory=list)
    feedback: list[dict] = Field(default_factory=list)
    origin: Optional[str] = None
    versions: list[dict] = Field(default_factory=list)


class ExpertisePatch(CamelModel):
    name: Optional[str] = None
    domain: Optional[str] = None
    topic: Optional[str] = None
    asset_types: Optional[list[str]] = None
    related: Optional[list[str]] = None
    status: Optional[str] = None
    version: Optional[str] = None
    owner: Optional[str] = None
    owner_role: Optional[str] = None
    reviewer: Optional[str] = None
    keywords: Optional[list[str]] = None
    usage_count: Optional[int] = None
    success_rate: Optional[float] = None
    summary: Optional[str] = None
    when_to_use: Optional[str] = None
    knowledge: Optional[list[str]] = None
    decision_logic: Optional[list[str]] = None
    guardrails: Optional[list[str]] = None
    escalation: Optional[list[str]] = None
    sources: Optional[list[dict]] = None
    feedback: Optional[list[dict]] = None
    origin: Optional[str] = None


class ExpertiseVersionOut(CamelModel):
    id: Optional[str] = None
    version: str
    date: Optional[datetime] = None
    author: str = ""
    approved_by: Optional[str] = None
    note: str = ""
    snapshot: dict = Field(default_factory=dict)


class FeedbackOut(CamelModel):
    id: Optional[str] = None
    expertise_id: str
    response_id: Optional[str] = None
    user_name: str = ""
    rating: str
    comment: str = ""
    date: Optional[datetime] = None


class ExpertiseOut(CamelModel):
    id: str
    name: str
    domain: str
    topic: str
    asset_types: list[str] = Field(default_factory=list)
    related: list[str] = Field(default_factory=list)
    status: str
    version: str
    owner: str
    owner_role: str
    reviewer: Optional[str] = None
    keywords: list[str] = Field(default_factory=list)
    usage_count: int = 0
    success_rate: Optional[float] = None
    summary: str
    when_to_use: str
    knowledge: list[str] = Field(default_factory=list)
    decision_logic: list[str] = Field(default_factory=list)
    guardrails: list[str] = Field(default_factory=list)
    escalation: list[str] = Field(default_factory=list)
    sources: list[dict] = Field(default_factory=list)
    feedback: list[dict] = Field(default_factory=list)
    origin: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    versions: list[ExpertiseVersionOut] = Field(default_factory=list)
    feedback_rows: list[FeedbackOut] = Field(default_factory=list)


# --- Proposals --------------------------------------------------------------
class ProposalOut(CamelModel):
    id: str
    expertise_id: str
    type: str
    created_at: Optional[datetime] = None
    author: str
    reason: str
    changes: dict = Field(default_factory=dict)
    chat_id: Optional[str] = None
    status: str = "open"


# --- Health ------------------------------------------------------------------
class HealthOut(CamelModel):
    status: str
    database: str
    claude: str


# ===========================================================================
# Chat-stream schemas (Claude chat backend — from origin/main)
# ===========================================================================

class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class RoutingIn(BaseModel):
    """How this response was routed to the model (sent by the front end)."""

    selectedBy: Literal["user", "auto"] = "user"
    category: str = ""
    reason: str = ""


class ExpertiseIn(BaseModel):
    """The Expertise fields the system prompt needs (shape: src/data/expertise.js)."""

    id: str
    name: str
    version: str
    status: str
    owner: str = ""
    whenToUse: str = ""
    knowledge: list[str] = []
    decisionLogic: list[str] = []
    guardrails: list[str] = []
    escalation: list[str] = []


class ChatStreamRequest(BaseModel):
    model: str  # front-end model id, e.g. "claude-sonnet"
    messages: list[ChatTurn] = Field(min_length=1, max_length=40)
    expertise: list[ExpertiseIn] = Field(default=[], max_length=10)
    routing: RoutingIn | None = None
