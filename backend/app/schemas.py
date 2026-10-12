"""Pydantic schemas — camelCase JSON matching the front-end shapes,
plus chat-stream request schemas for the Claude chat backend."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


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
    id: Optional[str] = None
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
    detection_result: Optional[str] = None
    detection_missing: list[str] = Field(default_factory=list)
    responses: list[ResponseCreate] = Field(default_factory=list)
    created_at: Optional[datetime] = None


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
    owner_id: Optional[str] = None
    owner_name: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    messages: list[MessageOut] = Field(default_factory=list)


class DecisionStep(BaseModel):
    """One structured reasoning step in an Expertise's decision logic.

    `text` is the full original line (kept as the stable identity for dedup/diff/removal —
    see governance.apply_changes — and as the grounding target for AI-captured items). The
    other fields are an optional structured breakdown of that same line: what triggers it,
    what was done, why, and when to escalate instead. All default to "" so existing plain
    strings (pre-migration data, or a line nobody has broken down yet) coerce cleanly via
    `coerce_decision_logic` below.
    """

    text: str = ""
    condition: str = ""
    action: str = ""
    reasoning: str = ""
    escalateIf: str = ""


def coerce_decision_logic(v):
    """Accepts the old shape (list[str]) and the new one (list[DecisionStep-like dict]) alike,
    so existing rows / in-flight requests never fail validation during the migration window."""
    if not isinstance(v, list):
        return v
    out = []
    for item in v:
        if isinstance(item, str):
            out.append({"text": item})
        else:
            out.append(item)
    return out


def decision_step_text(x) -> str:
    """Flatten one decisionLogic entry (plain string, DecisionStep, or raw dict from the DB's
    JSON column) into a single readable line, for anywhere that needs plain text: embeddings,
    the chat system prompt, and citation/reference text. Folds condition/action/reasoning/
    escalateIf in when present so that detail isn't silently dropped from those surfaces."""
    if isinstance(x, str):
        return x
    if isinstance(x, DecisionStep):
        d = x.model_dump()
    elif isinstance(x, dict):
        d = x
    else:
        return str(x)
    text = str(d.get("text") or "").strip()
    bits = []
    condition = str(d.get("condition") or "").strip()
    action = str(d.get("action") or "").strip()
    reasoning = str(d.get("reasoning") or "").strip()
    escalate_if = str(d.get("escalateIf") or d.get("escalate_if") or "").strip()
    if condition:
        bits.append(f"if {condition}")
    if action:
        bits.append(f"then {action}")
    if reasoning:
        bits.append(f"because {reasoning}")
    if escalate_if:
        bits.append(f"escalate if {escalate_if}")
    extra = "; ".join(bits)
    if text and extra:
        return f"{text} ({extra})"
    return text or extra


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
    decision_logic: list[DecisionStep] = Field(default_factory=list)
    guardrails: list[str] = Field(default_factory=list)
    escalation: list[str] = Field(default_factory=list)
    sources: list[dict] = Field(default_factory=list)
    feedback: list[dict] = Field(default_factory=list)
    origin: Optional[str] = None
    capture: Optional[dict] = None
    author_id: Optional[str] = None
    versions: list[dict] = Field(default_factory=list)

    @field_validator("decision_logic", mode="before")
    @classmethod
    def _coerce_decision_logic_create(cls, v):
        return coerce_decision_logic(v)


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
    decision_logic: Optional[list[DecisionStep]] = None
    guardrails: Optional[list[str]] = None
    escalation: Optional[list[str]] = None
    sources: Optional[list[dict]] = None
    feedback: Optional[list[dict]] = None
    origin: Optional[str] = None

    @field_validator("decision_logic", mode="before")
    @classmethod
    def _coerce_decision_logic_patch(cls, v):
        return coerce_decision_logic(v)


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
    decision_logic: list[DecisionStep] = Field(default_factory=list)
    guardrails: list[str] = Field(default_factory=list)
    escalation: list[str] = Field(default_factory=list)
    sources: list[dict] = Field(default_factory=list)
    feedback: list[dict] = Field(default_factory=list)
    origin: Optional[str] = None
    capture: Optional[dict] = None
    author_id: Optional[str] = None
    created_at: Optional[datetime] = None

    @field_validator("decision_logic", mode="before")
    @classmethod
    def _coerce_decision_logic_out(cls, v):
        return coerce_decision_logic(v)
    updated_at: Optional[datetime] = None
    versions: list[ExpertiseVersionOut] = Field(default_factory=list)


# --- Proposals --------------------------------------------------------------
class ProposalCreate(CamelModel):
    id: Optional[str] = None
    expertise_id: str
    type: str = "revision"
    author: str = ""
    author_id: Optional[str] = None
    reason: str = ""
    changes: dict = Field(default_factory=dict)  # {field: {add: [...], remove: [...]}}
    chat_id: Optional[str] = None
    capture: Optional[dict] = None
    sources: list[dict] = Field(default_factory=list)
    meeting_id: Optional[str] = None
    meeting_title: Optional[str] = None


class ProposalOut(ProposalCreate):
    id: str
    created_at: Optional[datetime] = None
    status: str = "open"


# --- Governance + feedback requests ------------------------------------------
class ApproveIn(CamelModel):
    note: str = "Approved"


class RollbackIn(CamelModel):
    version: str


class UsageIn(CamelModel):
    ids: list[str] = Field(default_factory=list, max_length=50)


class RatingIn(CamelModel):
    rating: Optional[Literal["up", "down"]] = None
    comment: str = ""
    chat_id: Optional[str] = None
    # Client-generated id for the 👎 correction proposal, so the optimistic copy and the saved row match.
    proposal_id: Optional[str] = None
    # The rater's account id and the answer's key (src/lib/ratings.js responseKey): one rating per
    # person per answer, so a new rating replaces theirs and `rating: null` takes it back.
    author_id: Optional[str] = None
    response_key: Optional[str] = None


class RatingOut(CamelModel):
    expertise: list[ExpertiseOut] = Field(default_factory=list)
    proposal: Optional[ProposalOut] = None
    # Why a 👎 correction was not sent for review (e.g. the rater isn't an expert in that domain).
    blocked: Optional[str] = None


# --- Health ------------------------------------------------------------------
class HealthOut(CamelModel):
    status: str
    database: str
    claude: str
    transcribe: str  # active TRANSCRIBE backend (app/config.py) — "browser" is the only one implemented


# ===========================================================================
# Chat-stream schemas (Claude chat backend — from origin/main)
# ===========================================================================

# --- Expertise match (semantic retrieval) ------------------------------------
class ExpertiseMatchRequest(BaseModel):
    query: str
    attached_ids: list[str] = Field(default_factory=list)
    limit: int = 2


class ExpertiseMatchItem(BaseModel):
    id: str
    name: str
    version: str
    score: float
    reason: str


# ===========================================================================
# Chat-stream schemas (Claude chat backend — from origin/main)
# ===========================================================================

class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    files: list[str] = Field(default=[], max_length=5)  # ids from POST /api/files (user turns)


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
    decisionLogic: list[DecisionStep] = []
    guardrails: list[str] = []
    escalation: list[str] = []

    @field_validator("decisionLogic", mode="before")
    @classmethod
    def _coerce_decision_logic_in(cls, v):
        return coerce_decision_logic(v)


# --- Smart Auto routing -------------------------------------------------------
class RouteRequest(BaseModel):
    prompt: str


class RouteOut(BaseModel):
    modelId: str
    category: str
    reason: str
    source: Literal["classifier", "keyword"]


class ChatStreamRequest(BaseModel):
    model: str  # front-end model id, e.g. "claude-sonnet"
    messages: list[ChatTurn] = Field(min_length=1, max_length=40)
    expertise: list[ExpertiseIn] = Field(default=[], max_length=10)
    routing: RoutingIn | None = None
