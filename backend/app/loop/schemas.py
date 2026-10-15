"""Shapes for closing the feedback loop (docs/FEEDBACK_LOOP.md).

POST /api/loop/correction : a 👎 correction -> a precise, reviewable change to one Expertise.
POST /api/loop/test       : re-ask saved test questions with the current and the proposed Expertise.

The backend is stateless here, like /api/chat/stream: the browser sends the Expertise, the
conversation and the open proposals, and keeps the results in its store until governance
moves server-side (BUILD_PROMPTS Prompts 5 and 7).
"""

from typing import Literal

from pydantic import BaseModel, Field

from ..capture.schemas import FIELDS, CaptureUser, Turn

Diagnosis = Literal["expertise_wrong", "expertise_incomplete", "scope_wrong", "model_ignored", "not_actionable"]
CHANGE_DIAGNOSES: tuple[str, ...] = ("expertise_wrong", "expertise_incomplete", "scope_wrong")


class LoopExpertise(BaseModel):
    """An Expertise exactly as it was (or would be) applied: one version's content."""

    id: str
    name: str
    version: str = ""
    status: str = "approved"
    owner: str = ""
    domain: str = ""
    summary: str = ""
    whenToUse: str = ""
    knowledge: list[str] = []
    decisionLogic: list[str] = []
    guardrails: list[str] = []
    escalation: list[str] = []


class OpenProposal(BaseModel):
    """An open revision on one of the applied Expertise, so duplicates merge instead of piling up."""

    id: str
    expertiseId: str
    reason: str = ""
    changes: dict = {}


class CorrectionRequest(BaseModel):
    user: CaptureUser
    # Conversation up to and including the corrected answer, oldest first.
    turns: list[Turn] = Field(min_length=1, max_length=8)
    answer: str = Field(max_length=20_000)
    correction: str = Field(min_length=3, max_length=2_000)
    # The Expertise applied to the answer, at the versions used.
    expertise: list[LoopExpertise] = Field(min_length=1, max_length=4)
    # Set when the user picked which Expertise was wrong.
    targetId: str | None = None
    openProposals: list[OpenProposal] = Field(default=[], max_length=12)


class ListChange(BaseModel):
    add: list[str] = []
    remove: list[str] = []
    # decisionLogic only: index (in the current list) of the step the added steps follow; -1 = first.
    insertAfter: int | None = None


class ReplayCase(BaseModel):
    """A question that checks an Expertise. Pass criteria are must-do / must-not-do lines,
    or a reference answer an operator rated 👍 (or both)."""

    id: str = ""
    question: str = Field(min_length=3, max_length=2_000)
    mustDo: list[str] = Field(default=[], max_length=6)
    mustNotDo: list[str] = Field(default=[], max_length=6)
    referenceAnswer: str | None = Field(default=None, max_length=8_000)


class CorrectionResult(BaseModel):
    diagnosis: Diagnosis
    confidence: float = 0.0
    reason: str = ""
    expertiseId: str | None = None
    changes: dict[str, ListChange] = {}
    set: dict[str, str] = {}  # scope_wrong: {"whenToUse": "..."}
    mergeWith: str | None = None
    testCase: ReplayCase | None = None
    allowed: bool = False  # may THIS user propose it (contributor + expert in the Expertise's domain)?
    blockedReason: str | None = None
    dropped: int = 0  # suggested lines removed by validation
    model: str | None = None


class ReplayRequest(BaseModel):
    # Front-end model id that answers the questions (src/data/models.js); None = LOOP_ANSWER_MODEL.
    model: str | None = None
    current: LoopExpertise
    proposed: LoopExpertise
    cases: list[ReplayCase] = Field(min_length=1, max_length=8)


class Graded(BaseModel):
    answer: str = ""
    ok: bool | None = None  # None = could not be graded (error)
    why: str = ""


class CaseResult(BaseModel):
    caseId: str
    question: str
    old: Graded
    new: Graded
    verdict: Literal["fixed", "broke", "same_pass", "same_fail", "error"]


class ReplaySummary(BaseModel):
    total: int
    oldPass: int
    newPass: int
    fixed: int
    broke: int
    errors: int = 0


class ReplayResult(BaseModel):
    results: list[CaseResult]
    summary: ReplaySummary
    model: str
    graderModel: str


__all__ = [
    "FIELDS", "CHANGE_DIAGNOSES", "CaptureUser", "Turn", "LoopExpertise", "OpenProposal", "CorrectionRequest",
    "ListChange", "ReplayCase", "CorrectionResult", "ReplayRequest", "Graded", "CaseResult", "ReplaySummary", "ReplayResult",
]
