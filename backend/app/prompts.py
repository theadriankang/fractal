"""System prompt for chat answers: docs/BUILD_PROMPTS.md, Appendix A, rendered in plain Python."""

from html import escape

from .schemas import ExpertiseIn, RoutingIn

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


def _routing_reason(routing: RoutingIn | None, model_display_name: str) -> str:
    """Human-readable explanation of why this model is answering."""
    if routing is None or routing.selectedBy == "user":
        return f"The user picked {model_display_name} in the model selector."
    # Auto routing
    category = routing.category or "general"
    reason = routing.reason or "best fit"
    return f"Fractal's Auto router chose {model_display_name} because it detected a {category.lower()} task ({reason})."


def _transparency_section(
    model_display_name: str,
    provider_name: str,
    provider_model: str,
    routing: RoutingIn | None,
) -> str:
    """'About this answer' block the model sees so it can answer honestly when asked."""
    why = _routing_reason(routing, model_display_name)
    return (
        f"About this answer:\n"
        f"- You are Fractal, an assistant running on {model_display_name} "
        f"({provider_name}, model: {provider_model}).\n"
        f"- {why}\n"
        f"- If the user asks which model or AI is answering, or why this model was chosen, "
        f"answer honestly: name {model_display_name}, the provider ({provider_name}), "
        f"and the reason above. Be brief and factual.\n"
        f"- Only mention the model and the reason when the user asks about the model, "
        f"the AI, or why it was chosen. Do not volunteer this information otherwise.\n"
        f"- Never claim to be a different model or provider."
    )


def build_system_prompt(
    expertise: list[ExpertiseIn],
    *,
    model_display_name: str = "",
    provider_name: str = "",
    provider_model: str = "",
    routing: RoutingIn | None = None,
) -> str:
    """Callers must pass approved Expertise only (PROJECT_CONTEXT rule 4).

    Optional model metadata and routing build a transparency section so the
    model can honestly answer "which model is this?" when asked.
    """
    if expertise:
        body = "\n\n".join([GROUNDED, *(_block(e) for e in expertise), GROUNDED_RULES])
    else:
        body = UNGROUNDED

    sections = [INTRO, body]
    if model_display_name:
        sections.append(_transparency_section(model_display_name, provider_name, provider_model, routing))
    sections.append(ALWAYS)
    return "\n\n".join(sections)
