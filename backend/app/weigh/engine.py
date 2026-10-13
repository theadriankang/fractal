"""Cross-domain weighing: one Claude call weighs, deterministic Python validates.

Flow: build_prompt() -> Claude (tool call `record_weighing`) -> validate() -> assemble() -> WeighResult.
Like know-how capture (app/capture/extract.py), the model is never trusted on ids or quotes:
- every claim must cite Expertise that was actually weighed, or it is dropped;
- every tension must rest on a real line of the constraining Expertise (its guardrail, knowledge,
  decision step or escalation rule), checked against the record, or it is dropped;
- escalations and "who else must sign off" gaps come straight from the records, never the model.
When no model is configured (or it fails) rules_weigh() gives a plainer, text-matching version so
the feature never goes dark in a demo.
"""

import json
import re
from itertools import combinations, permutations

from ..capture.extract import grounded
from ..config import settings
from ..models import Expertise
from ..schemas import decision_step_text
from .schemas import (
    ContextTurn, Escalation, Expert, Overlap, Perspective, Suggestion, Tension, View, WeighResult,
)

DOMAINS = ("Technical Services", "Energy Optimisation", "Asset Operations", "Tenant Experience", "Leasing", "Sustainability")

Picked = list[tuple[Expert, Expertise]]

TOOL = {
    "name": "record_weighing",
    "description": "Record how the experts' approved Expertise weighs up against the question.",
    "input_schema": {
        "type": "object",
        "properties": {
            "summary": {"type": "string", "description": "Two sentences at most: the overall read across the domains."},
            "perspectives": {
                "type": "array",
                "description": "Exactly one per Expertise, faithful to its content.",
                "items": {
                    "type": "object",
                    "properties": {
                        "expertise_id": {"type": "string"},
                        "position": {"type": "string", "description": "What this expert would push for on this question, one or two sentences."},
                        "key_points": {"type": "array", "items": {"type": "string"}, "description": "Up to 3 points from their Expertise that matter here."},
                        "concerns": {"type": "array", "items": {"type": "string"}, "description": "Up to 3 things this expert would worry about."},
                    },
                    "required": ["expertise_id", "position"],
                },
            },
            "overlaps": {
                "type": "array",
                "description": "Points two or more experts agree on, reinforce, or both depend on — the basis for working together.",
                "items": {
                    "type": "object",
                    "properties": {
                        "point": {"type": "string", "description": "Short headline."},
                        "expertise_ids": {"type": "array", "items": {"type": "string"}, "description": "Two or more ids."},
                        "detail": {"type": "string", "description": "One sentence: how they line up."},
                    },
                    "required": ["point", "expertise_ids"],
                },
            },
            "tensions": {
                "type": "array",
                "description": "Where an idea one expert would push for may not work as well because of another expert's rule or knowledge.",
                "items": {
                    "type": "object",
                    "properties": {
                        "point": {"type": "string", "description": "Short headline."},
                        "idea_from": {"type": "string", "description": "Id of the Expertise whose idea is at risk."},
                        "constraint_from": {"type": "string", "description": "Id of the Expertise whose rule or knowledge limits it."},
                        "evidence": {"type": "string", "description": "The exact line, copied verbatim from constraint_from's Expertise, that creates the tension."},
                        "detail": {"type": "string", "description": "One or two sentences: why the idea may not hold."},
                        "severity": {"type": "string", "enum": ["blocker", "caution"], "description": "blocker = following the idea as-is would break a guardrail; caution = works only with care."},
                        "reconcile": {"type": "string", "description": "How the two experts could still work together."},
                    },
                    "required": ["point", "idea_from", "constraint_from", "evidence", "severity"],
                },
            },
            "suggestions": {
                "type": "array",
                "description": "A suggested way forward that combines the experts, most important first. 2-5 items.",
                "items": {
                    "type": "object",
                    "properties": {
                        "text": {"type": "string", "description": "The suggestion, phrased as a recommendation."},
                        "rationale": {"type": "string", "description": "One sentence: why, in terms of the experts' know-how."},
                        "based_on": {"type": "array", "items": {"type": "string"}, "description": "Ids of the Expertise it draws on."},
                        "views": {
                            "type": "array",
                            "description": "How each OTHER expert sees this suggestion. Never hide a dissent.",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "expertise_id": {"type": "string"},
                                    "stance": {"type": "string", "enum": ["supports", "conditional", "concern"]},
                                    "note": {"type": "string"},
                                },
                                "required": ["expertise_id", "stance"],
                            },
                        },
                        "general": {"type": "boolean", "description": "true if it relies on general knowledge rather than the Expertise."},
                    },
                    "required": ["text", "based_on"],
                },
            },
            "gaps": {"type": "array", "items": {"type": "string"}, "description": "What the question needs that none of the Expertise covers. Up to 3."},
        },
        "required": ["summary", "perspectives", "overlaps", "tensions", "suggestions"],
    },
}

SYSTEM = """You weigh approved Expertise from different domains of a real-estate operations organisation against one question. Each <expertise> block is the captured judgement of a named specialist, approved by a reviewer.

Do NOT pick a winner or compare which expert is better. Weigh them together:
1. perspectives — for every Expertise, what that expert would push for on this question, in their own terms.
2. overlaps — where two or more experts agree, reinforce each other or depend on the same fact. This is the common ground for working together.
3. tensions — where an idea one expert would push for may not work as well because of another expert's guardrail, knowledge or escalation rule. Say whose idea (idea_from), whose rule (constraint_from), copy that rule's exact line from constraint_from's Expertise as evidence, mark it blocker (a guardrail would be broken) or caution (works only with care), and say how they could reconcile.
4. suggestions — a way forward that combines the experts. For each, list the Expertise it draws on and how every other expert views it (supports / conditional / concern, with a short note). Keep dissent visible.
5. gaps — what the question needs that none of the Expertise covers.

Rules:
- Use only the Expertise given and cite it by id. Do not invent thresholds, names, roles or procedures.
- Anything from general knowledge must be a suggestion with general=true.
- You suggest; humans decide. Never write as if an action was taken.
- Plain, short sentences. No markdown.
Always respond by calling the record_weighing tool."""

# Limits on what is kept from the model.
MAX_TEXT = 400
MAX_POINTS = 3
MAX_OVERLAPS = 5
MAX_TENSIONS = 5
MAX_SUGGESTIONS = 6
MAX_GAPS = 4


# ---------------------------------------------------------------- reading the records

def _steps(e: Expertise) -> list[str]:
    """Decision steps as display lines. Entries are DecisionStep dicts (or older plain strings);
    their `text` is the original line and the stable identity used elsewhere (governance diffs)."""
    out = []
    for x in e.decision_logic or []:
        line = (x.get("text") if isinstance(x, dict) else None) or decision_step_text(x)
        if str(line).strip():
            out.append(str(line).strip())
    return out


# ---------------------------------------------------------------- prompt + model call

def _block(x: Expert, e: Expertise) -> str:
    lines = [f'<expertise id="{x.id}" name="{x.name}" domain="{x.domain}" owner="{x.owner}" version="{x.version}">']
    lines.append(f"Summary: {e.summary or ''}")
    lines.append(f"When to use: {e.when_to_use or ''}")
    # Steps are shown with their condition/action/reasoning folded in, like the chat prompt does.
    steps = [decision_step_text(x) for x in e.decision_logic or []]
    for title, items in (("Knowledge", e.knowledge), ("Decision logic (in order)", steps),
                         ("Guardrails (never violate)", e.guardrails), ("Escalate when", e.escalation)):
        lines.append(f"{title}:")
        lines += [f"- {i}" for i in items or []]
    lines.append("</expertise>")
    return "\n".join(lines)


def build_prompt(question: str, picked: Picked, context: list[ContextTurn] | None = None) -> str:
    parts = [_block(x, e) for x, e in picked]
    if context:
        convo = "\n".join(f"{t.role.upper()}: {t.content[:1500]}" for t in context)
        parts.append(f"<conversation_so_far>\n{convo}\n</conversation_so_far>")
    parts.append(f"<question>\n{question}\n</question>")
    parts.append("Weigh the Expertise above against the question. Call the record_weighing tool.")
    return "\n\n".join(parts)


async def call_model(question: str, picked: Picked, context, client) -> dict | None:
    msg = await client.messages.create(
        model=settings.weigh_model,
        max_tokens=3500,
        system=SYSTEM,
        tools=[TOOL],
        # Newer Claude models reject forced tool_choice; "auto" + the system rule still yields a tool call.
        tool_choice={"type": "auto"},
        messages=[{"role": "user", "content": build_prompt(question, picked, context)}],
    )
    return next((b.input for b in msg.content if b.type == "tool_use"), None)


# ---------------------------------------------------------------- deterministic parts (always from the records)

def _lines(e: Expertise) -> list[str]:
    return [*(e.knowledge or []), *_steps(e), *(e.guardrails or []), *(e.escalation or []),
            *([e.when_to_use] if e.when_to_use else [])]


def escalations(picked: Picked) -> list[Escalation]:
    return [Escalation(expertiseId=x.id, domain=x.domain, text=t) for x, e in picked for t in (e.escalation or [])]


def handoff_gaps(picked: Picked) -> list[str]:
    """An expert's escalation names another domain that wasn't part of the weighing → say so."""
    present = {x.domain for x, _ in picked}
    gaps = []
    for x, e in picked:
        for line in e.escalation or []:
            for d in DOMAINS:
                if d != x.domain and d not in present and d.lower() in line.lower():
                    gaps.append(f"{x.domain} expects {d} to be involved (\"{line}\"), but no approved {d} Expertise "
                                f"was weighed here — check with the {d} team directly.")
    return list(dict.fromkeys(gaps))


# ---------------------------------------------------------------- validation of the model's answer (pure)

def _s(v, n: int = MAX_TEXT) -> str:
    return str(v or "").strip()[:n]


def _strs(v, n: int = MAX_POINTS) -> list[str]:
    return [s for s in (_s(i) for i in (v or []) if isinstance(i, (str, int, float))) if s][:n]


def _evidence(text: str, e: Expertise) -> str | None:
    """The record's own line the evidence refers to, or None if it can't be traced to one."""
    text = _s(text)
    if not text:
        return None
    lines = _lines(e)
    for line in lines:
        if grounded(text, line) or grounded(line, text):
            return line
    # A light paraphrase: accept the record line sharing most of its words, and show that line instead.
    want = _terms(text)
    if not want:
        return None
    best = max(lines, key=lambda line: len(want & _terms(line)), default=None)
    if best and len(want & _terms(best)) / len(want) >= 0.6:
        return best
    return None


def validate(raw: dict | None, picked: Picked) -> tuple[dict, int] | None:
    """Keeps only what cites weighed Expertise and, for tensions, a real line of it."""
    if not isinstance(raw, dict):
        return None
    known = {x.id: e for x, e in picked}
    dropped = 0

    def ids(v) -> list[str]:
        return list(dict.fromkeys(i for i in (v or []) if isinstance(i, str) and i in known))

    perspectives = {}
    for p in raw.get("perspectives") or []:
        if not isinstance(p, dict) or p.get("expertise_id") not in known or not _s(p.get("position")):
            dropped += 1
            continue
        perspectives.setdefault(p["expertise_id"], Perspective(
            expertiseId=p["expertise_id"], position=_s(p["position"]),
            keyPoints=_strs(p.get("key_points")), concerns=_strs(p.get("concerns")),
        ))

    overlaps = []
    for o in raw.get("overlaps") or []:
        if not isinstance(o, dict):
            dropped += 1
            continue
        oi = ids(o.get("expertise_ids"))
        if len(oi) < 2 or not _s(o.get("point")):
            dropped += 1
            continue
        overlaps.append(Overlap(point=_s(o["point"], 160), expertiseIds=oi, detail=_s(o.get("detail"))))

    tensions = []
    for t in raw.get("tensions") or []:
        if not isinstance(t, dict):
            dropped += 1
            continue
        a, b = t.get("idea_from"), t.get("constraint_from")
        if a not in known or b not in known or a == b or not _s(t.get("point")):
            dropped += 1
            continue
        line = _evidence(t.get("evidence"), known[b])
        if line is None:  # a conflict nobody can trace to an approved rule is not shown
            dropped += 1
            continue
        tensions.append(Tension(
            point=_s(t["point"], 160), ideaFrom=a, constraintFrom=b, evidence=line, detail=_s(t.get("detail")),
            severity="blocker" if t.get("severity") == "blocker" else "caution", reconcile=_s(t.get("reconcile")),
        ))

    suggestions = []
    for s in raw.get("suggestions") or []:
        if not isinstance(s, dict) or not _s(s.get("text")):
            dropped += 1
            continue
        based = ids(s.get("based_on"))
        views, seen = [], set()
        for v in s.get("views") or []:
            if isinstance(v, dict) and v.get("expertise_id") in known and v["expertise_id"] not in seen:
                seen.add(v["expertise_id"])
                stance = v.get("stance") if v.get("stance") in ("supports", "conditional", "concern") else "conditional"
                views.append(View(expertiseId=v["expertise_id"], stance=stance, note=_s(v.get("note"), 240)))
        suggestions.append(Suggestion(
            text=_s(s["text"]), rationale=_s(s.get("rationale")), basedOn=based, views=views,
            general=bool(s.get("general")) or not based,
        ))

    return {
        "summary": _s(raw.get("summary"), 500),
        "perspectives": perspectives,
        "overlaps": overlaps[:MAX_OVERLAPS],
        "tensions": tensions[:MAX_TENSIONS],
        "suggestions": suggestions[:MAX_SUGGESTIONS],
        "gaps": _strs(raw.get("gaps"), MAX_GAPS),
    }, dropped


# ---------------------------------------------------------------- quick mode: text matching, no model

_STOP = set("""
about above after again against also always approval approved area areas avoid because been before being below
between both cannot check confirm could does done during each either every first from have hour hours into issue
issues just last less make minute minutes month months more most must never next only other over same should since
some than that their them then there these they this those through time under until usually very what when where
which while will with within without would your recommend recommendations recommended only immediately
""".split())


def _ordered_terms(text: str) -> list[str]:
    """Content words (4+ letters, no stop words, plural 's' dropped) in order of first appearance."""
    words = (w for w in re.findall(r"[a-z]{4,}", (text or "").lower()) if w not in _STOP)
    return list(dict.fromkeys(w[:-1] if w.endswith("s") and len(w) > 4 else w for w in words))


def _terms(text: str) -> set[str]:
    return set(_ordered_terms(text))


def _all_text(e: Expertise) -> str:
    return " ".join([*(e.keywords or []), e.summary or "", *_lines(e)])


def rules_weigh(picked: Picked) -> dict:
    """Plain text matching: shared terms = overlap; a step sharing terms with another domain's guardrail = tension."""
    perspectives = {
        x.id: Perspective(expertiseId=x.id, position=e.summary or x.name,
                          keyPoints=_steps(e)[:MAX_POINTS], concerns=list((e.guardrails or [])[:MAX_POINTS]))
        for x, e in picked
    }

    overlaps = []
    for (xa, ea), (xb, eb) in combinations(picked, 2):
        b_terms = _terms(_all_text(eb))
        shared = [t for t in _ordered_terms(_all_text(ea)) if t in b_terms]
        linked = xb.id in (ea.related or []) or xa.id in (eb.related or [])
        if len(shared) >= 2 or linked:
            overlaps.append(Overlap(
                point="Shared ground: " + (", ".join(shared[:4]) or "these experts already point to each other"),
                expertiseIds=[xa.id, xb.id],
                detail="Their Expertise already links to each other." if linked else "",
            ))

    tensions = []
    for (xa, ea), (xb, eb) in permutations(picked, 2):
        best = None
        for step in _steps(ea):
            for rule in eb.guardrails or []:
                n = len(_terms(step) & _terms(rule))
                if n >= 2 and (best is None or n > best[0]):
                    best = (n, step, rule)
        if best:
            tensions.append(Tension(
                point=f"{xa.domain}'s approach may run into a {xb.domain} guardrail",
                ideaFrom=xa.id, constraintFrom=xb.id, evidence=best[2], detail=f"Step: {best[1]}",
                severity="caution", reconcile=f"Agree with {xb.owner or xb.domain} how this step stays within the guardrail before acting.",
            ))

    suggestions = []
    for x, e in picked:
        if not _steps(e):
            continue
        step = _steps(e)[0]
        views = []
        for y, f in picked:
            if y.id == x.id:
                continue
            rule = next((r for r in f.guardrails or [] if len(_terms(step) & _terms(r)) >= 2), None)
            if rule:
                views.append(View(expertiseId=y.id, stance="concern", note=rule))
        suggestions.append(Suggestion(text=step, rationale=f"First step in {x.name}.", basedOn=[x.id], views=views))

    return {
        "summary": "",
        "perspectives": perspectives,
        "overlaps": overlaps[:MAX_OVERLAPS],
        "tensions": tensions[:MAX_TENSIONS],
        "suggestions": suggestions[:MAX_SUGGESTIONS],
        "gaps": [],
    }


# ---------------------------------------------------------------- assembly

QUICK_NOTE = "Quick mode: overlaps and conflicts were found by matching the approved text, without a model."


def assemble(question: str, picked: Picked, parts: dict, *, mode: str, model: str | None = None,
             dropped: int = 0, note: str = "") -> WeighResult:
    experts = [x for x, _ in picked]
    # Every expert keeps a voice: fill any perspective the model left out from the record itself.
    fallback = rules_weigh(picked)["perspectives"] if mode == "model" else {}
    perspectives = [parts["perspectives"].get(x.id) or fallback.get(x.id) for x in experts]
    domains = ", ".join(x.domain for x in experts)
    summary = parts.get("summary") or (
        f"Weighed {len(experts)} domains ({domains}): {len(parts['overlaps'])} point(s) of agreement and "
        f"{len(parts['tensions'])} possible conflict(s)."
    )
    return WeighResult(
        question=question, mode=mode, model=model, summary=summary, experts=experts,
        perspectives=[p for p in perspectives if p], overlaps=parts["overlaps"], tensions=parts["tensions"],
        suggestions=parts["suggestions"], escalations=escalations(picked),
        gaps=list(dict.fromkeys([*handoff_gaps(picked), *parts["gaps"]]))[:MAX_GAPS + 2],
        dropped=dropped, note=note,
    )


async def weigh(question: str, picked: Picked, context: list[ContextTurn] | None = None, client=None) -> WeighResult:
    if not picked:
        return WeighResult(question=question, mode="none",
                           summary="No approved Expertise matched this question, so there is nothing to weigh yet.")
    if len(picked) == 1:
        x = picked[0][0]
        result = assemble(question, picked, rules_weigh(picked), mode="rules")
        result.summary = (f"Only {x.domain} has approved Expertise on this, so there is no other domain to weigh it "
                          f"against. Here is that expert's view.")
        return result
    if client is None:
        return assemble(question, picked, rules_weigh(picked), mode="rules", note=QUICK_NOTE)
    try:
        raw = await call_model(question, picked, context, client)
    except Exception:  # model down / rate limited → quick mode, never an error page mid-demo
        return assemble(question, picked, rules_weigh(picked), mode="rules",
                        note="The model was unavailable, so this is the quick text-matching version.")
    checked = validate(raw, picked)
    if checked is None:
        return assemble(question, picked, rules_weigh(picked), mode="rules",
                        note="The model returned no weighing, so this is the quick text-matching version.")
    parts, dropped = checked
    return assemble(question, picked, parts, mode="model", model=settings.weigh_model, dropped=dropped)


# ---------------------------------------------------------------- plain-text form (chat history, copy button)

def to_markdown(r: WeighResult) -> str:
    name = {x.id: x for x in r.experts}
    label = lambda i: f"{name[i].domain} ({name[i].name})" if i in name else i  # noqa: E731
    out = [f"**Weighed across {len(r.experts)} domain(s).** {r.summary}"]
    if r.perspectives:
        out.append("\n**Each expert's view**")
        out += [f"- **{label(p.expertiseId)}:** {p.position}" for p in r.perspectives]
    if r.overlaps:
        out.append("\n**Where they agree**")
        out += [f"- {o.point} ({', '.join(name[i].domain for i in o.expertiseIds if i in name)})"
                + (f" {o.detail}" if o.detail else "") for o in r.overlaps]
    if r.tensions:
        out.append("\n**Where an idea may not hold**")
        for t in r.tensions:
            sev = "Blocker" if t.severity == "blocker" else "Caution"
            out.append(f"- {sev}: {t.point}. {t.detail} (Rule from {label(t.constraintFrom)}: \"{t.evidence}\")"
                       + (f" Reconcile: {t.reconcile}" if t.reconcile else ""))
    if r.suggestions:
        out.append("\n**Suggested way forward** (suggestions — the specialists decide)")
        for i, s in enumerate(r.suggestions, 1):
            src = "general guidance (not from approved Expertise)" if s.general else ", ".join(label(b) for b in s.basedOn)
            out.append(f"{i}. {s.text} _(from {src})_")
            out += [f"   - {label(v.expertiseId)} — {v.stance}" + (f": {v.note}" if v.note else "") for v in s.views]
    if r.escalations:
        out.append("\n**Loop in before acting**")
        out += [f"- {e.domain}: {e.text}" for e in r.escalations]
    if r.gaps:
        out.append("\n**Not covered by any approved Expertise**")
        out += [f"- {g}" for g in r.gaps]
    return "\n".join(out)


def dumps(r: WeighResult) -> str:  # handy for scripts / debugging
    return json.dumps(r.model_dump(), indent=2, ensure_ascii=False)
