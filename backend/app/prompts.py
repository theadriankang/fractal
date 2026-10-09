"""System prompt for chat answers: docs/BUILD_PROMPTS.md, Appendix A, rendered in plain Python."""

from html import escape

from .schemas import ExpertiseIn

INTRO = "You are Fractal, an operations assistant for commercial real estate teams (offices, data centres, logistics, retail)."

GROUNDED = """Your organisation has approved the following Expertise. Treat it as the authoritative way this organisation handles these situations. Follow its decision logic in order, respect every guardrail, and state escalation conditions when they apply."""

GROUNDED_RULES = """Rules:
- Base your recommendation on the Expertise above. If you add general knowledge beyond it, label it "General guidance (not from approved Expertise)".
- Mention the Expertise name you relied on, once, in plain words.
- If a guardrail forbids what the user is asking, say so clearly and give the safe alternative.
- If an escalation condition is met, start your answer with "⚠️ Escalate:" and who to contact."""

UNGROUNDED = "No approved Expertise matched this request. Answer from general knowledge, be concise, and say that no organisation-approved procedure was found."

ALWAYS = """Always:
- You recommend; humans decide and act. Never claim to have performed an action.
- Be concise and structured: short intro, numbered steps, then any warning.
- If you are unsure or information is missing, ask one clarifying question instead of guessing."""


def _attr(value: str) -> str:
    return escape(value, quote=True)


def _block(e: ExpertiseIn) -> str:
    lines = [f'<expertise id="{_attr(e.id)}" name="{_attr(e.name)}" version="{_attr(e.version)}" owner="{_attr(e.owner)}">']
    lines.append(f"When to use: {e.whenToUse}")
    lines.append("Knowledge:")
    lines += [f"- {k}" for k in e.knowledge]
    lines.append("Decision logic (in order):")
    lines += [f"{i}. {s}" for i, s in enumerate(e.decisionLogic, start=1)]
    lines.append("Guardrails (never violate):")
    lines += [f"- {g}" for g in e.guardrails]
    lines.append("Escalate when:")
    lines += [f"- {x}" for x in e.escalation]
    lines.append("</expertise>")
    return "\n".join(lines)


def build_system_prompt(expertise: list[ExpertiseIn]) -> str:
    """Callers must pass approved Expertise only (PROJECT_CONTEXT rule 4)."""
    if expertise:
        body = "\n\n".join([GROUNDED, *(_block(e) for e in expertise), GROUNDED_RULES])
    else:
        body = UNGROUNDED
    return "\n\n".join([INTRO, body, ALWAYS])
