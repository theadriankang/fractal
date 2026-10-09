from typing import Literal

from pydantic import BaseModel, Field


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


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
