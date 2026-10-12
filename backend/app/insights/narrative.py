"""Expert-grounded synthesis of a data report: not just statistics, but the analysis a
domain expert would give — blind spots, which issues actually matter and why, and what to
do about them — grounded in the organisation's approved Expertise (never invented), the
same way a chat answer is grounded (app/prompts.py). This is what makes a report read as
"management talking to the energy manager" rather than a raw anomaly table.

Degrades gracefully: if Claude isn't configured, or no Expertise matched, or the call
fails, report generation still succeeds with the statistical table alone — the narrative
is additive, never a hard dependency.
"""

import logging

from ..llm import claude
from ..prompts import build_system_prompt
from ..schemas import ExpertiseIn
from .analysis import Issue, ParsedData

logger = logging.getLogger(__name__)

PROMPT_INSTRUCTIONS = """You are briefing management on the dataset below, the way the relevant \
domain expert would if they were in the room. Using ONLY the approved Expertise above for \
judgement calls (label anything beyond it "General guidance (not from approved Expertise)"), \
and the data below, write a short briefing with exactly these sections:

1. Analysis — what the data shows, in plain terms.
2. Blind spots — what this data alone can't tell you, or what a non-expert might miss or \
misread.
3. Top issues to focus on — which flagged issues actually matter most, and why (not just \
restating severity).
4. Potential resolutions — for each top issue, what to do about it. If a guardrail or \
escalation condition from the Expertise above applies, say so explicitly, prefixed "⚠️ Escalate:".

Keep it concise — a working briefing, not an essay. Use the section headers above verbatim."""


def build_narrative_prompt(title: str, data: ParsedData, issues: list[Issue]) -> str:
    issues_block = "\n".join(
        f"- {i.title} ({i.severity}): {i.detail}" for i in issues
    ) or "(no anomalies statistically flagged)"
    return (
        f"Dataset: {title}\n"
        f"{len(data.rows)} rows across {len(data.categories)} categories "
        f"({', '.join(data.categories[:10])}{'…' if len(data.categories) > 10 else ''}), "
        f"{len(data.periods)} periods ({data.periods[0]} to {data.periods[-1]}).\n\n"
        f"Statistically flagged issues:\n{issues_block}\n\n{PROMPT_INSTRUCTIONS}"
    )


async def synthesize(title: str, data: ParsedData, issues: list[Issue], applied: list[ExpertiseIn]) -> str | None:
    """Returns the briefing text, or None if it couldn't be generated (caller falls back to
    the statistical table alone — see the module docstring)."""
    if not claude.is_configured():
        return None
    system = build_system_prompt(applied)
    try:
        return await claude.answer_once(system, build_narrative_prompt(title, data, issues), max_tokens=1200)
    except Exception as exc:
        logger.warning("insights narrative synthesis failed: %s", exc)
        return None
