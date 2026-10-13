"""Shapes for cross-domain weighing (POST /api/expertise/weigh), camelCase to match the front end.

Weighing is not "pick the better of two answers". Each domain's approved Expertise keeps its own
voice (a Perspective); the engine then marks where those voices agree (Overlap), where one domain's
idea runs into another domain's rule (Tension), and turns the result into suggestions that still
show what every expert thinks of them (Suggestion.views). Humans decide; nothing here is an action.
"""

from typing import Literal, Optional

from pydantic import BaseModel, Field


class ContextTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(default="", max_length=4000)


class WeighRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    attachedIds: list[str] = Field(default=[], max_length=10)
    # Earlier turns of the chat, so a follow-up ("what if we only do it on Mondays?") keeps its meaning.
    context: list[ContextTurn] = Field(default=[], max_length=6)
    # auto = sent alongside every chat question: weighing only "comes into play" (triggered=true) when
    # the question asks about two areas together, or when the experts behind it actually conflict.
    auto: bool = False


class Expert(BaseModel):
    """One approved Expertise taking part, and why it was brought in."""

    id: str
    name: str
    version: str
    domain: str
    owner: str = ""
    ownerRole: str = ""
    via: Literal["search", "attached", "linked"] = "search"
    reason: str = ""  # "semantic match (71%)", "linked from Chiller Plant Fault Triage", ...


class Perspective(BaseModel):
    """What this domain's expert would push for, in their own terms."""

    expertiseId: str
    position: str
    keyPoints: list[str] = []
    concerns: list[str] = []


class Overlap(BaseModel):
    """A point two or more domains agree on or reinforce — common ground to build on."""

    point: str
    expertiseIds: list[str]
    detail: str = ""


class Tension(BaseModel):
    """One domain's idea may not hold because of another domain's rule or knowledge."""

    point: str
    ideaFrom: str  # Expertise whose idea is at risk
    constraintFrom: str  # Expertise whose rule/knowledge limits it
    evidence: str = ""  # the approved line from constraintFrom this rests on (verified, not invented)
    detail: str = ""
    severity: Literal["blocker", "caution"] = "caution"
    reconcile: str = ""  # how the two could still work together
    # The measurable thing a person should check to decide between the two, e.g. "net saving =
    # peak kW cut × demand rate − extra pre-cooling kWh × energy rate". Empty when none applies.
    decidingFactor: str = ""


class View(BaseModel):
    expertiseId: str
    stance: Literal["supports", "conditional", "concern"]
    note: str = ""


class Suggestion(BaseModel):
    text: str
    rationale: str = ""
    basedOn: list[str] = []  # Expertise ids the suggestion draws on
    views: list[View] = []  # how each other expert sees it — the suggestion never hides a dissent
    general: bool = False  # True = not grounded in any approved Expertise


class Escalation(BaseModel):
    expertiseId: str
    domain: str
    text: str


class WeighResult(BaseModel):
    question: str
    # Whether weighing came into play for this question, and why (always true unless auto=true).
    triggered: bool = True
    trigger: str = ""
    mode: Literal["model", "rules", "none"]
    model: Optional[str] = None
    summary: str = ""
    experts: list[Expert] = []
    perspectives: list[Perspective] = []
    overlaps: list[Overlap] = []
    tensions: list[Tension] = []
    suggestions: list[Suggestion] = []
    escalations: list[Escalation] = []
    gaps: list[str] = []
    dropped: int = 0  # model claims removed because they cited unknown Expertise or unverifiable lines
    note: str = ""  # e.g. why the quick (rules) mode was used
    markdown: str = ""  # the same result as plain text: stored as the chat answer, so follow-ups see it
