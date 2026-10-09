"""Request/response shapes for capturing know-how from a chat exchange (POST /api/expertise/extract)."""

from typing import Literal

from pydantic import BaseModel, Field

Field_ = Literal["knowledge", "decisionLogic", "guardrails", "escalation"]
FIELDS: tuple[str, ...] = ("knowledge", "decisionLogic", "guardrails", "escalation")


class Turn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=20_000)


class CaptureUser(BaseModel):
    """Who is chatting. Until Supabase Auth (Prompt 8) this comes from the client; afterwards
    it must come from the verified JWT + `profiles` row, never from the request body."""

    name: str
    role: Literal["contributor", "reviewer", "intern"]
    domains: list[str] = []


class TaxonomyDomain(BaseModel):
    domain: str
    topics: list[str] = []


class ExpertiseBrief(BaseModel):
    """An existing Expertise the extractor may revise instead of creating a near-duplicate."""

    id: str
    name: str
    domain: str
    topic: str = ""
    status: str = "approved"
    summary: str = ""
    knowledge: list[str] = []
    decisionLogic: list[str] = []
    guardrails: list[str] = []
    escalation: list[str] = []


class ExtractRequest(BaseModel):
    user: CaptureUser
    # Conversation so far, oldest first, ending with the latest user message and the assistant's reply.
    turns: list[Turn] = Field(min_length=2, max_length=8)
    taxonomy: list[TaxonomyDomain] = Field(min_length=1, max_length=30)
    candidates: list[ExpertiseBrief] = Field(default=[], max_length=12)


class CaptureItem(BaseModel):
    field: Field_
    text: str
    quote: str  # the user's own words this line is based on


class Target(BaseModel):
    domain: str
    topic: str = ""
    expertiseId: str | None = None
    expertiseName: str | None = None


class DraftMeta(BaseModel):
    name: str
    domain: str
    topic: str
    assetTypes: list[str] = []
    summary: str = ""
    whenToUse: str = ""
    keywords: list[str] = []


class Detection(BaseModel):
    kind: Literal["none", "new", "revision"]
    confidence: float = 0.0
    reason: str = ""
    target: Target | None = None
    draft: DraftMeta | None = None  # kind == "new"
    items: list[CaptureItem] = []
    allowed: bool = False  # may THIS user contribute it (contributor + expert in target domain)?
    blockedReason: str | None = None
    dropped: int = 0  # lines removed by validation (ungrounded, duplicate, invalid)
    model: str | None = None
