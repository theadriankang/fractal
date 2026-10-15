"""Before/after test: re-ask saved questions with the current and the proposed Expertise.

Each answer is graded on its own by a separate model that only sees the question, the pass
criteria and the answer, so it never knows which version wrote it. The pass/fail decision
is made in Python from the grader's per-criterion booleans (decide(), unit-tested).
"""

import asyncio

import anthropic

from ..config import settings
from ..llm import claude
from ..prompts import build_system_prompt
from ..schemas import ExpertiseIn
from .schemas import CaseResult, Graded, LoopExpertise, ReplayCase, ReplayRequest, ReplayResult, ReplaySummary

GRADE_TOOL = {
    "name": "record_grade",
    "description": "Record whether the answer meets each pass criterion.",
    "input_schema": {
        "type": "object",
        "properties": {
            "must_do_met": {"type": "array", "items": {"type": "boolean"}, "description": "One per MUST DO line, in order."},
            "must_not_do_violated": {"type": "array", "items": {"type": "boolean"}, "description": "One per MUST NOT DO line, in order."},
            "consistent_with_reference": {"type": "boolean", "description": "Only when a reference answer is given: does the answer agree with it on substance (no contradictions, no missing safety steps)?"},
            "why": {"type": "string", "description": "One sentence."},
        },
        "required": ["must_do_met", "must_not_do_violated", "why"],
    },
}

GRADE_SYSTEM = """You grade one AI answer written for a building operations team. You do not know which system wrote it.
Judge substance only, not style or length. A criterion is met only if the answer clearly does it; implied or partial does not count.
Always respond by calling the record_grade tool."""


def grade_prompt(case: ReplayCase, answer: str) -> str:
    must_do = "\n".join(f"{i}. {x}" for i, x in enumerate(case.mustDo, start=1)) or "(none)"
    must_not = "\n".join(f"{i}. {x}" for i, x in enumerate(case.mustNotDo, start=1)) or "(none)"
    ref = f"\n<reference_answer>\n{case.referenceAnswer}\n</reference_answer>\n" if case.referenceAnswer else ""
    return (
        f"<question>\n{case.question}\n</question>\n\n"
        f"<must_do>\n{must_do}\n</must_do>\n\n<must_not_do>\n{must_not}\n</must_not_do>\n{ref}\n"
        f"<answer>\n{answer}\n</answer>\n\nCall the record_grade tool."
    )


def decide(raw: dict | None, case: ReplayCase) -> tuple[bool | None, str]:
    """Pass = every MUST DO met, no MUST NOT DO violated, and consistent with the reference (if any).
    Missing MUST DO verdicts count as not met; an unusable grade returns None."""
    if not isinstance(raw, dict):
        return None, "The grader returned no result."
    met = list(raw.get("must_do_met") or [])
    violated = list(raw.get("must_not_do_violated") or [])
    met = [bool(met[i]) if i < len(met) else False for i in range(len(case.mustDo))]
    violated = [bool(violated[i]) if i < len(violated) else False for i in range(len(case.mustNotDo))]
    consistent = raw.get("consistent_with_reference")
    ok = all(met) and not any(violated) and (case.referenceAnswer is None or consistent is not False)
    why = " ".join(str(raw.get("why") or "").split())[:300]
    return ok, why


def has_criteria(case: ReplayCase) -> bool:
    return bool(case.mustDo or case.mustNotDo or case.referenceAnswer)


def as_prompt_expertise(e: LoopExpertise) -> ExpertiseIn:
    # The proposed version isn't approved yet; it is applied here only to test it, never in chat.
    return ExpertiseIn(id=e.id, name=e.name, version=e.version or "proposed", status="approved", owner=e.owner,
                       whenToUse=e.whenToUse, knowledge=e.knowledge, decisionLogic=e.decisionLogic,
                       guardrails=e.guardrails, escalation=e.escalation)


async def answer(client: anthropic.AsyncAnthropic, model_id: str, e: LoopExpertise, question: str) -> str:
    msg = await client.messages.create(
        model=model_id,
        # Same settings as a chat answer, so the test reflects what users get.
        max_tokens=settings.claude_max_output_tokens,
        output_config={"effort": settings.claude_effort},
        system=build_system_prompt([as_prompt_expertise(e)]),
        messages=[{"role": "user", "content": question}],
    )
    return "".join(b.text for b in msg.content if b.type == "text").strip()


async def grade(client: anthropic.AsyncAnthropic, case: ReplayCase, text: str) -> tuple[bool | None, str]:
    msg = await client.messages.create(
        model=settings.loop_grader_model,
        max_tokens=settings.claude_max_output_tokens,
        output_config={"effort": "low"},
        system=GRADE_SYSTEM,
        tools=[GRADE_TOOL],
        tool_choice={"type": "auto"},
        messages=[{"role": "user", "content": grade_prompt(case, text)}],
    )
    return decide(next((b.input for b in msg.content if b.type == "tool_use"), None), case)


def verdict(old: Graded, new: Graded) -> str:
    if old.ok is None or new.ok is None:
        return "error"
    if new.ok and not old.ok:
        return "fixed"
    if old.ok and not new.ok:
        return "broke"
    return "same_pass" if new.ok else "same_fail"


def summarise(results: list[CaseResult]) -> ReplaySummary:
    return ReplaySummary(
        total=len(results),
        oldPass=sum(r.old.ok is True for r in results),
        newPass=sum(r.new.ok is True for r in results),
        fixed=sum(r.verdict == "fixed" for r in results),
        broke=sum(r.verdict == "broke" for r in results),
        errors=sum(r.verdict == "error" for r in results),
    )


async def run(req: ReplayRequest, client: anthropic.AsyncAnthropic, answer_fn=answer, grade_fn=grade) -> ReplayResult:
    """Answers + grades every case with both versions, at most LOOP_CONCURRENCY calls at a time.
    A failed case is reported as an error; it never fails the whole run."""
    key = req.model if req.model in claude.MODELS else settings.loop_answer_model
    model_id = claude.MODELS[key]["model"]
    gate = asyncio.Semaphore(settings.loop_concurrency)

    async def one(e: LoopExpertise, case: ReplayCase) -> Graded:
        try:
            async with gate:
                text = await answer_fn(client, model_id, e, case.question)
            async with gate:
                ok, why = await grade_fn(client, case, text)
            return Graded(answer=text, ok=ok, why=why)
        except anthropic.AuthenticationError:
            raise
        except Exception as err:  # noqa: BLE001 — one bad case must not sink the run
            return Graded(ok=None, why=f"Could not run this case: {type(err).__name__}")

    async def case_result(i: int, case: ReplayCase) -> CaseResult:
        old, new = await asyncio.gather(one(req.current, case), one(req.proposed, case))
        return CaseResult(caseId=case.id or f"case-{i + 1}", question=case.question, old=old, new=new, verdict=verdict(old, new))

    cases = [c for c in req.cases if has_criteria(c)][: settings.loop_max_cases]
    results = list(await asyncio.gather(*(case_result(i, c) for i, c in enumerate(cases))))
    return ReplayResult(results=results, summary=summarise(results), model=model_id, graderModel=settings.loop_grader_model)
