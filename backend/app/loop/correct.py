"""Smart corrections: a 👎 correction becomes a precise, reviewable change to one Expertise.

Flow: build_prompt() -> Claude (tool call `propose_fix`) -> validate() -> CorrectionResult.
validate() is pure and unit-tested. It never trusts the model's ids, field names or "remove"
lines: removals must match a line the Expertise really has, and the change must be non-empty.
"""

import difflib
import json
import logging

import anthropic

from ..capture.extract import _norm
from ..config import settings
from .schemas import (
    CHANGE_DIAGNOSES, FIELDS, CaptureUser, CorrectionRequest, CorrectionResult, ListChange, LoopExpertise, ReplayCase,
)

MAX_LINE = 300

TOOL = {
    "name": "propose_fix",
    "description": "Record the diagnosis of an operator's correction and the minimal change to the Expertise.",
    "input_schema": {
        "type": "object",
        "properties": {
            "diagnosis": {
                "type": "string",
                "enum": ["expertise_wrong", "expertise_incomplete", "scope_wrong", "model_ignored", "not_actionable"],
                "description": (
                    "expertise_wrong = the Expertise content is incorrect or outdated; "
                    "expertise_incomplete = it is missing a step, threshold, guardrail or escalation; "
                    "scope_wrong = it was applied to a situation it should not cover (fix whenToUse); "
                    "model_ignored = the Expertise was right but the answer did not follow it; "
                    "not_actionable = vague, an opinion, or about something else."
                ),
            },
            "confidence": {"type": "number", "description": "0-1"},
            "reason": {"type": "string", "description": "One sentence a reviewer can read."},
            "expertise_id": {"type": "string", "description": "The Expertise to change (one of those given)."},
            "changes": {
                "type": "array",
                "description": "One entry per section that changes.",
                "items": {
                    "type": "object",
                    "properties": {
                        "field": {"type": "string", "enum": list(FIELDS)},
                        "remove": {"type": "array", "items": {"type": "string"}, "description": "Existing lines to remove or replace, copied EXACTLY."},
                        "add": {"type": "array", "items": {"type": "string"}, "description": "New lines, in the Expertise's style."},
                        "insert_after": {"type": "integer", "description": "decisionLogic only: number of the existing step (as numbered in the prompt) the new steps follow; 0 = before step 1. Omit when replacing."},
                    },
                    "required": ["field", "remove", "add"],
                },
            },
            "when_to_use": {"type": "string", "description": "scope_wrong only: the corrected 'When to use' sentence."},
            "merge_with": {"type": "string", "description": "Id of an open proposal that already makes this change, if any."},
            "test_case": {
                "type": "object",
                "description": "A question that would have caught this mistake.",
                "properties": {
                    "question": {"type": "string"},
                    "must_do": {"type": "array", "items": {"type": "string"}},
                    "must_not_do": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["question", "must_do", "must_not_do"],
            },
        },
        "required": ["diagnosis", "confidence", "reason"],
    },
}

log = logging.getLogger(__name__)

SYSTEM = """An operator in a commercial real estate team gave a 👎 to an AI answer and wrote a correction.
The answer was grounded in the organisation's approved Expertise (shown with its sections and numbered steps).
Turn the correction into the MINIMAL change to ONE Expertise, so a human reviewer can approve it.

Rules:
- Decide the diagnosis first. If the Expertise already says what the operator wants and the answer simply didn't follow it, use "model_ignored" and change nothing.
- Prefer REPLACING an existing line over adding a near-duplicate: copy the old line exactly into "remove" and put the new line in "add".
- File each line in the right section: knowledge = facts, thresholds, root causes; decisionLogic = an ordered step the expert follows; guardrails = something that must never (or always) be done; escalation = when a person must take over, and who.
- When adding a step without replacing one, give insert_after so the order is right.
- Keep the operator's meaning and every number, unit and condition they gave. Never invent facts, thresholds or names. Write each line as a short, standalone, imperative instruction (max 30 words).
- If an open proposal already makes the same change, return its id in merge_with and only the lines it lacks.
- Always include a test_case: the user's question (or a close variant) plus what a correct answer must do and must not do.
- Use confidence below 0.6 when you are unsure.
Always respond by calling the propose_fix tool."""


def _section(e: LoopExpertise) -> dict:
    return {
        "id": e.id, "name": e.name, "version": e.version, "domain": e.domain, "whenToUse": e.whenToUse,
        "knowledge": e.knowledge,
        "decisionLogic": {str(i): s for i, s in enumerate(e.decisionLogic, start=1)},
        "guardrails": e.guardrails, "escalation": e.escalation,
    }


def candidates(req: CorrectionRequest) -> list[LoopExpertise]:
    """The Expertise the correction may change: the one the user picked, else all applied."""
    if req.targetId:
        picked = [e for e in req.expertise if e.id == req.targetId]
        if picked:
            return picked
    return list(req.expertise)


def build_prompt(req: CorrectionRequest) -> str:
    ids = {e.id for e in candidates(req)}
    convo = "\n".join(f"{t.role.upper()}: {t.content}" for t in req.turns)
    open_props = [p.model_dump() for p in req.openProposals if p.expertiseId in ids]
    return (
        f"<expertise_applied>\n{json.dumps([_section(e) for e in candidates(req)], ensure_ascii=False)}\n</expertise_applied>\n\n"
        f"<conversation>\n{convo}\n</conversation>\n\n"
        f"<answer_being_corrected>\n{req.answer}\n</answer_being_corrected>\n\n"
        f"<correction by=\"{req.user.name}\">\n{req.correction}\n</correction>\n\n"
        f"<open_proposals>\n{json.dumps(open_props, ensure_ascii=False)}\n</open_proposals>\n\n"
        "Call the propose_fix tool."
    )


async def call_model(req: CorrectionRequest, client: anthropic.AsyncAnthropic) -> dict | None:
    msg = await client.messages.create(
        model=settings.loop_correction_model,
        # Thinking counts toward max_tokens; a low ceiling can end the reply before the tool call.
        max_tokens=settings.claude_max_output_tokens,
        output_config={"effort": "low"},
        system=SYSTEM,
        tools=[TOOL],
        # Newer Claude models reject forced tool_choice; "auto" + the system rule still yields a tool call.
        tool_choice={"type": "auto"},
        messages=[{"role": "user", "content": build_prompt(req)}],
    )
    tool = next((b.input for b in msg.content if b.type == "tool_use"), None)
    if tool is None:
        log.warning("loop correction: no tool call (stop_reason=%s)", getattr(msg, "stop_reason", None))
    return tool


# ---------------------------------------------------------------- validation (pure)

def match_line(line: str, existing: list[str]) -> str | None:
    """The existing line `line` refers to: exact after normalising, else a close match (>= 0.85)."""
    n = _norm(line)
    if not n:
        return None
    for x in existing:
        if _norm(x) == n:
            return x
    best, score = None, 0.0
    for x in existing:
        r = difflib.SequenceMatcher(None, n, _norm(x)).ratio()
        if r > score:
            best, score = x, r
    return best if score >= 0.85 else None


def _clean(s) -> str:
    return " ".join(str(s or "").split())[:MAX_LINE]


def _scope(user: CaptureUser, domain: str) -> tuple[bool, str | None]:
    if user.role != "contributor":
        return False, "Only contributors can propose changes — reviewers approve them."
    if domain and domain not in user.domains:
        return False, f"Only {domain} experts can propose changes here. Your domains: {', '.join(user.domains) or 'none'}."
    return True, None


def _test_case(raw, req: CorrectionRequest, changes: dict[str, ListChange]) -> ReplayCase:
    """The model's test case, cleaned; falls back to the user's question + the added lines."""
    raw = raw if isinstance(raw, dict) else {}
    last_user = next((t.content for t in reversed(req.turns) if t.role == "user"), "")
    question = _clean(raw.get("question"))[:1000] if raw.get("question") else ""
    must_do = [_clean(x)[:200] for x in (raw.get("must_do") or []) if _clean(x)][:5]
    must_not = [_clean(x)[:200] for x in (raw.get("must_not_do") or []) if _clean(x)][:5]
    if len(question) < 3:
        question = last_user[:1000] or req.correction[:1000]
    if not must_do and not must_not:
        must_do = [line[:200] for ch in changes.values() for line in ch.add][:3] or [req.correction[:200]]
    return ReplayCase(question=question, mustDo=must_do, mustNotDo=must_not)


def validate(raw: dict | None, req: CorrectionRequest, model: str | None = None) -> CorrectionResult:
    def plain(diagnosis: str, reason: str, expertise_id: str | None = None, confidence: float = 0.0, dropped: int = 0):
        return CorrectionResult(diagnosis=diagnosis, confidence=confidence, reason=reason, expertiseId=expertise_id,
                                dropped=dropped, model=model)

    if not isinstance(raw, dict):
        return plain("not_actionable", "The analysis returned no result.")
    diagnosis = raw.get("diagnosis")
    try:
        confidence = max(0.0, min(1.0, float(raw.get("confidence") or 0)))
    except (TypeError, ValueError):
        confidence = 0.0
    reason = _clean(raw.get("reason"))
    allowed_targets = {e.id: e for e in candidates(req)}
    named = str(raw.get("expertise_id") or "")
    target = allowed_targets.get(named)
    if target is None and not named and len(allowed_targets) == 1:
        target = next(iter(allowed_targets.values()))  # only one candidate and the model didn't name one

    if diagnosis == "model_ignored":
        return plain("model_ignored", reason, target.id if target else None, confidence)
    if diagnosis not in CHANGE_DIAGNOSES or confidence < settings.loop_threshold:
        return plain("not_actionable", reason or "The correction doesn't describe a specific change.", None, confidence)
    if target is None:
        return plain("not_actionable", "The analysis named an Expertise that wasn't applied to this answer.", None, confidence)

    changes: dict[str, ListChange] = {}
    dropped = 0
    for ch in raw.get("changes") or []:
        if not isinstance(ch, dict) or ch.get("field") not in FIELDS:
            dropped += 1
            continue
        field = ch["field"]
        existing: list[str] = getattr(target, field)
        out = changes.setdefault(field, ListChange())
        for line in ch.get("remove") or []:
            hit = match_line(str(line), existing)
            if hit is None or hit in out.remove:
                dropped += 1
            else:
                out.remove.append(hit)
        kept = {_norm(x) for x in existing if x not in out.remove}
        for line in ch.get("add") or []:
            text = _clean(line)
            if not text or _norm(text) in kept or text in out.add:
                dropped += 1
                continue
            out.add.append(text)
        if field == "decisionLogic" and not out.remove and ch.get("insert_after") is not None:
            try:
                n = int(ch["insert_after"])  # 1-based step number in the prompt; 0 = before step 1
            except (TypeError, ValueError):
                n = None
            if n is not None and 0 <= n <= len(existing):
                out.insertAfter = n - 1
    changes = {f: c for f, c in changes.items() if c.add or c.remove}

    set_fields: dict[str, str] = {}
    if diagnosis == "scope_wrong":
        wtu = _clean(raw.get("when_to_use"))
        if wtu and _norm(wtu) != _norm(target.whenToUse):
            set_fields["whenToUse"] = wtu

    if not changes and not set_fields:
        return plain("not_actionable", reason or "No concrete change could be verified against the Expertise.",
                     None, confidence, dropped)

    open_ids = {p.id for p in req.openProposals if p.expertiseId == target.id}
    merge = str(raw.get("merge_with") or "") or None
    allowed, blocked = _scope(req.user, target.domain)
    return CorrectionResult(
        diagnosis=diagnosis, confidence=confidence, reason=reason or "Correction from an operator.",
        expertiseId=target.id, changes=changes, set=set_fields,
        mergeWith=merge if merge in open_ids else None,
        testCase=_test_case(raw.get("test_case"), req, changes),
        allowed=allowed, blockedReason=blocked, dropped=dropped, model=model,
    )
