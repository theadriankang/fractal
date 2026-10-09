"""Know-how capture from chat: one Claude call proposes, deterministic Python validates.

Flow: build_prompt() -> Claude (tool call `record_knowhow`) -> validate() -> Detection.
validate() is pure and unit-tested: it never trusts the model's ids, domains or quotes.
Prompt adapted from docs/BUILD_PROMPTS.md, Appendix B, plus a required evidence quote per line.
"""

import json
import re
import unicodedata

import anthropic

from ..config import settings
from .schemas import FIELDS, CaptureItem, Detection, DraftMeta, ExpertiseBrief, ExtractRequest, Target

ASSET_TYPES = ("Office", "Data Centre", "Logistics", "Retail")

TOOL = {
    "name": "record_knowhow",
    "description": "Record whether the USER shared reusable know-how in this exchange, and what it is.",
    "input_schema": {
        "type": "object",
        "properties": {
            "kind": {"type": "string", "enum": ["none", "new", "revision"]},
            "confidence": {"type": "number", "description": "0-1"},
            "reason": {"type": "string", "description": "One sentence explaining the decision."},
            "expertise_id": {"type": "string", "description": "kind=revision only: id of the existing Expertise being improved."},
            "new": {
                "type": "object",
                "description": "kind=new only.",
                "properties": {
                    "name": {"type": "string", "description": "3-6 words, Title Case, e.g. 'Lift Door Fault Diagnosis'."},
                    "domain": {"type": "string", "description": "A domain from the taxonomy."},
                    "topic": {"type": "string", "description": "A topic of that domain."},
                    "asset_types": {"type": "array", "items": {"type": "string", "enum": list(ASSET_TYPES)}},
                    "summary": {"type": "string", "description": "One sentence."},
                    "when_to_use": {"type": "string", "description": "One sentence."},
                    "keywords": {"type": "array", "items": {"type": "string"}, "description": "3-8 lowercase trigger terms."},
                },
                "required": ["name", "domain", "topic", "summary", "when_to_use"],
            },
            "items": {
                "type": "array",
                "description": "Each piece of know-how, filed in the right section.",
                "items": {
                    "type": "object",
                    "properties": {
                        "field": {
                            "type": "string",
                            "enum": list(FIELDS),
                            "description": "knowledge = facts, heuristics, thresholds, root causes; decisionLogic = a step the expert follows, in order; guardrails = something that must never be done; escalation = when a human/specialist must take over and who.",
                        },
                        "text": {"type": "string", "description": "The line, lightly rewritten as a standalone statement. Keep every number, unit and condition; add nothing."},
                        "quote": {"type": "string", "description": "The exact words, copied verbatim from the USER's messages, that this line is based on."},
                    },
                    "required": ["field", "text", "quote"],
                },
            },
        },
        "required": ["kind", "confidence", "reason", "items"],
    },
}

SYSTEM = """You review a chat between a building operations professional (USER) and an AI assistant (ASSISTANT).
Decide whether the USER shared reusable, organisation-specific know-how that should be captured as Expertise.

Capture ONLY know-how the USER stated themselves: experience, rules of thumb, procedures, thresholds, root causes, lessons learned, things that must never be done, when to escalate.
Do NOT capture: questions, requests, generic textbook facts, anything the ASSISTANT suggested (even if the user agrees), personal data, or one-off situational details (today's ticket, a single tenant's name, a date).

Decide:
- "none" if the user shared no reusable know-how.
- "revision" if it adds to or corrects one of the existing Expertise listed (prefer this over creating a near-duplicate). Do not repeat lines that Expertise already contains.
- "new" otherwise, with a domain and topic from the taxonomy.

Every item needs a "quote" copied verbatim from the USER's own words. If you cannot quote the user, leave the item out.
Only return "new" or "revision" when confidence >= 0.6.
Always respond by calling the record_knowhow tool."""


def build_prompt(req: ExtractRequest) -> str:
    taxonomy = {t.domain: t.topics for t in req.taxonomy}
    existing = [
        {"id": e.id, "name": e.name, "domain": e.domain, "topic": e.topic, "summary": e.summary,
         **{f: getattr(e, f) for f in FIELDS}}
        for e in req.candidates
    ]
    convo = "\n".join(f"{t.role.upper()}: {t.content}" for t in req.turns)
    return (
        f"<taxonomy>\n{json.dumps(taxonomy, ensure_ascii=False)}\n</taxonomy>\n\n"
        f"<existing_expertise>\n{json.dumps(existing, ensure_ascii=False)}\n</existing_expertise>\n\n"
        f"<conversation>\n{convo}\n</conversation>\n\n"
        "Focus on the LAST user message; earlier turns are context. Call the record_knowhow tool."
    )


async def call_model(req: ExtractRequest, client: anthropic.AsyncAnthropic) -> dict | None:
    msg = await client.messages.create(
        model=settings.extraction_model,
        max_tokens=2000,
        system=SYSTEM,
        tools=[TOOL],
        # Newer Claude models reject forced tool_choice; "auto" + the system rule still yields a tool call.
        tool_choice={"type": "auto"},
        messages=[{"role": "user", "content": build_prompt(req)}],
    )
    return next((b.input for b in msg.content if b.type == "tool_use"), None)


# ---------------------------------------------------------------- validation (pure)

def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s).lower()
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = re.sub(r"[^\w\s'%°.]", " ", s)
    return re.sub(r"\s+", " ", s).strip(" .")


def _tokens(s: str) -> list[str]:
    return [t.strip(".") for t in _norm(s).split() if len(t.strip(".")) >= 2]


def grounded(quote: str, user_text: str) -> bool:
    """True when the quote really comes from the user's words: an exact (normalised) substring,
    or at least 85% of its words present in the user's text. Quotes under 3 words don't count."""
    q, u = _norm(quote), _norm(user_text)
    if len(q.split()) < 3:
        return False
    if q in u:
        return True
    qt, ut = _tokens(quote), set(_tokens(user_text))
    return bool(qt) and sum(t in ut for t in qt) / len(qt) >= 0.85


def _title(s: str) -> str:
    small = {"and", "or", "of", "for", "the", "a", "an", "to", "in", "on", "at"}
    words = re.sub(r"\s+", " ", s).strip()[:60].split(" ")
    return " ".join(w if (w.isupper() and len(w) > 1) else (w.lower() if i and w.lower() in small else w[:1].upper() + w[1:]) for i, w in enumerate(words))


def _scope(req: ExtractRequest, domain: str) -> tuple[bool, str | None]:
    u = req.user
    if u.role != "contributor":
        return False, "Only contributors can add know-how — reviewers approve it."
    if domain not in u.domains:
        return False, f"Only {domain} experts can contribute this. Your domains: {', '.join(u.domains) or 'none'}."
    return True, None


def validate(raw: dict | None, req: ExtractRequest, model: str | None = None) -> Detection:
    none = lambda reason="", dropped=0: Detection(kind="none", reason=reason, dropped=dropped, model=model)  # noqa: E731
    if not isinstance(raw, dict):
        return none("The extractor returned no result.")
    kind = raw.get("kind")
    try:
        confidence = max(0.0, min(1.0, float(raw.get("confidence") or 0)))
    except (TypeError, ValueError):
        confidence = 0.0
    reason = str(raw.get("reason") or "")[:300]
    if kind not in ("new", "revision") or confidence < settings.extraction_threshold:
        return none(reason)

    taxonomy = {t.domain: t.topics for t in req.taxonomy}
    candidates: dict[str, ExpertiseBrief] = {e.id: e for e in req.candidates}
    user_text = "\n".join(t.content for t in req.turns if t.role == "user")

    # Resolve the target first: revisions must point at a real candidate, new drafts at a real domain.
    target: Target
    draft: DraftMeta | None = None
    existing: set[str] = set()
    if kind == "revision":
        e = candidates.get(str(raw.get("expertise_id") or ""))
        if not e:
            return none("The extractor named an Expertise that doesn't exist.")
        target = Target(domain=e.domain, topic=e.topic, expertiseId=e.id, expertiseName=e.name)
        existing = {_norm(x) for f in FIELDS for x in getattr(e, f)}
    else:
        n = raw.get("new") or {}
        domain = n.get("domain")
        if domain not in taxonomy:
            return none("The extractor chose a domain outside the taxonomy.")
        topics = taxonomy[domain]
        topic = n.get("topic") if n.get("topic") in topics else (topics[0] if topics else "")
        name = _title(str(n.get("name") or "")) or "Captured Know-how"
        draft = DraftMeta(
            name=name, domain=domain, topic=topic,
            assetTypes=[a for a in (n.get("asset_types") or []) if a in ASSET_TYPES] or ["Office"],
            summary=str(n.get("summary") or "")[:300],
            whenToUse=str(n.get("when_to_use") or "")[:300],
            keywords=[str(k).lower()[:30] for k in (n.get("keywords") or [])][:8],
        )
        target = Target(domain=domain, topic=topic)

    items: list[CaptureItem] = []
    seen: set[str] = set()
    dropped = 0
    for it in raw.get("items") or []:
        if not isinstance(it, dict):
            dropped += 1
            continue
        field, text, quote = it.get("field"), str(it.get("text") or "").strip()[:400], str(it.get("quote") or "").strip()[:400]
        key = _norm(text)
        if field not in FIELDS or not text or not grounded(quote, user_text) or key in existing or key in seen:
            dropped += 1
            continue
        seen.add(key)
        items.append(CaptureItem(field=field, text=text, quote=quote))

    if not items:
        return none(reason or "Nothing the user said could be verified as reusable know-how.", dropped)

    allowed, blocked = _scope(req, target.domain)
    return Detection(kind=kind, confidence=confidence, reason=reason, target=target, draft=draft, items=items,
                     allowed=allowed, blockedReason=blocked, dropped=dropped, model=model)


def word_count(s: str) -> int:
    return len(s.split())
