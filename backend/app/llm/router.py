"""Smart Auto routing: classify a prompt, pick the best-suited model.

Two-step decision, same categories and model map as the client-side
routeAuto() in src/data/models.js (kept here as the fallback):

1. A fast Claude Haiku call reads the prompt and classifies what KIND of
   task it is (coding, quantitative analysis, long-document reading,
   real-estate/operations know-how, writing, live/current events, a
   Chinese-language prompt, or a quick/general question).
2. The category maps to the model best suited for that kind of task
   (backend/models.yaml has the provider wiring for each).

If the classifier is slow, errors, or Claude isn't configured, we fall
back to the same keyword rules the front end used to run alone, so
"Auto" never blocks sending a message.
"""

from __future__ import annotations

import asyncio
import logging
import re

from . import claude, registry

logger = logging.getLogger(__name__)

# How long we wait for the classifier before falling back to keywords.
ROUTER_TIMEOUT_SECONDS = 2.5

# Ported from ROUTES in src/data/models.js — same categories, same
# keyword patterns, same default model per category. Order matters:
# first match wins (mirrors the front end's routeAuto()).
_KEYWORD_ROUTES: list[tuple[str, str, re.Pattern]] = [
    ("Coding", "claude-sonnet", re.compile(
        r"\b(code|bug|function|python|javascript|react|sql|api|regex|script|debug|error|typescript)\b", re.I)),
    ("Live / current events", "grok-4", re.compile(
        r"\b(today|latest|news|current|this week|right now|trending|price of)\b", re.I)),
    ("Math & quantitative", "gpt-5", re.compile(
        r"\b(calculate|equation|forecast|kwh|npv|irr|roi|percentage|statistic|probability|\d+\s*[x×*/+-]\s*\d+)\b", re.I)),
    ("Long document analysis", "gemini-pro", re.compile(
        r"\b(summari[sz]e|this document|report|pdf|attached|contract|lease agreement|transcript)\b", re.I)),
    ("Chinese language", "hunyuan-t1", re.compile(r"[一-鿿]")),
    ("Operational reasoning", "claude-opus", re.compile(
        r"\b(chillers?|hvac|ahu|pumps?|lifts?|elevators?|escalators?|generators?|ups|tenants?|lease|energy|"
        r"maintenance|faults?|escalat\w*|assets?|buildings?|facility|sustainab\w*|carbon|occupancy|technicians?)\b",
        re.I)),
    ("Writing", "claude-opus", re.compile(r"\b(write|draft|email|essay|rewrite|proposal|memo|letter)\b", re.I)),
]

CATEGORIES = [c for c, _, _ in _KEYWORD_ROUTES] + ["Quick question", "General"]

# Category -> preferred model id (front-end id, see src/data/models.js MODELS).
CATEGORY_MODEL: dict[str, str] = {c: m for c, m, _ in _KEYWORD_ROUTES} | {
    "Quick question": "gemini-flash",
    "General": "gpt-5-mini",
}

CLAUDE_FALLBACK_ORDER = ("claude-sonnet", "claude-opus", "claude-haiku")


def _keyword_route(prompt: str) -> tuple[str, str]:
    """Pattern-match fallback — ports routeAuto() from src/data/models.js."""
    for category, model_id, pattern in _KEYWORD_ROUTES:
        if pattern.search(prompt):
            return category, model_id
    if len(prompt.strip().split()) < 8:
        return "Quick question", "gemini-flash"
    return "General", "gpt-5-mini"


_TOOL = {
    "name": "classify_prompt",
    "description": "Classify what kind of task this prompt needs, to route it to the best-suited model.",
    "input_schema": {
        "type": "object",
        "properties": {
            "category": {"type": "string", "enum": CATEGORIES},
            "reason": {
                "type": "string",
                "description": "One short lowercase phrase, e.g. 'debugging a python error', 'reviewing a lease clause'.",
            },
        },
        "required": ["category", "reason"],
    },
}

_SYSTEM = (
    "You route user prompts to the AI model best suited to answer them, for a commercial "
    "real-estate operations platform. Read the prompt and classify it into exactly ONE category "
    "using the classify_prompt tool.\n\n"
    "'Operational reasoning' covers real-estate / facilities-operations topics — chillers, HVAC, "
    "lifts, tenants, leasing, energy, maintenance, sustainability, building assets — prefer it over "
    "'General' whenever the prompt is about running or maintaining a building or asset, even if it "
    "also involves analysis or numbers.\n"
    "'Math & quantitative' is for calculations, forecasts and financial metrics NOT tied to a "
    "building-operations scenario. 'Long document analysis' is for summarising or reasoning over an "
    "attached or pasted document. 'Quick question' is a short, simple factual question. 'General' is "
    "everything else."
)


async def _classify(prompt: str) -> tuple[str, str] | None:
    """One cheap Claude call -> (category, reason), or None if unavailable/unparsable."""
    if not claude.is_configured():
        return None
    try:
        resp = await claude.client.messages.create(
            model="claude-haiku-5-5",
            max_tokens=200,
            system=_SYSTEM,
            messages=[{"role": "user", "content": prompt[:4000]}],
            tools=[_TOOL],
            tool_choice={"type": "tool", "name": "classify_prompt"},
        )
    except Exception as exc:
        logger.warning("router classify call failed: %s", exc)
        return None
    for block in resp.content:
        if block.type == "tool_use" and block.name == "classify_prompt":
            category = block.input.get("category")
            if category not in CATEGORY_MODEL:
                return None
            reason = block.input.get("reason") or f"detected a {str(category).lower()} task"
            return category, reason
    return None


def _best_available(preferred_id: str) -> str | None:
    """preferred_id if its key is set, else the best available Claude model, else None."""
    entry = registry.get(preferred_id)
    if entry and registry.is_available(entry):
        return preferred_id
    for fallback_id in CLAUDE_FALLBACK_ORDER:
        fb = registry.get(fallback_id)
        if fb and registry.is_available(fb):
            return fallback_id
    return None


async def route(prompt: str) -> dict:
    """Decides which model should answer this prompt.

    Tries real classification first — what does the prompt actually need:
    coding help, quantitative analysis, a long document read, building-ops
    know-how, writing...? Falls back to keyword rules if the classifier is
    slow, errors, or Claude isn't configured. Returns
    {modelId, category, reason, source: "classifier"|"keyword"}.
    """
    classified: tuple[str, str] | None = None
    try:
        classified = await asyncio.wait_for(_classify(prompt), timeout=ROUTER_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        logger.info("router classify timed out after %.1fs — using keyword fallback", ROUTER_TIMEOUT_SECONDS)

    if classified:
        category, reason = classified
        model_id = CATEGORY_MODEL[category]
        source = "classifier"
    else:
        category, model_id = _keyword_route(prompt)
        reason = f"detected a {category.lower()} task"
        source = "keyword"

    chosen = _best_available(model_id)
    if chosen is None:
        # Nothing available at all — let the caller's own availability check surface this.
        return {"modelId": model_id, "category": category, "reason": reason, "source": source}
    if chosen != model_id:
        preferred = registry.get(model_id)
        fallback = registry.get(chosen)
        reason = (
            f"{category} → {fallback.display_name} "
            f"({preferred.display_name if preferred else model_id} not configured)"
        )
    return {"modelId": chosen, "category": category, "reason": reason, "source": source}
