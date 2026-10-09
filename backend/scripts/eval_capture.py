"""Evaluates know-how capture against real Claude on a fixed set of chat messages.

    cd backend && .venv/bin/python -m scripts.eval_capture        (needs ANTHROPIC_API_KEY in backend/.env)

Each case says what SHOULD happen: "none", or "new"/"revision" (+ the expected domain / Expertise).
Prints one line per case and a score you can quote, e.g. "18/20 correct".
"""

import asyncio
import sys

from app.capture.extract import call_model, validate
from app.capture.schemas import ExtractRequest
from app.config import settings
from app.llm import claude

TAXONOMY = [
    {"domain": "Technical Services", "topics": ["Chillers & HVAC", "Lifts & Escalators", "Electrical & Power", "Plumbing & Water"]},
    {"domain": "Energy Optimisation", "topics": ["Peak Demand", "Chiller Plant Efficiency", "Solar & Renewables"]},
    {"domain": "Asset Operations", "topics": ["Budgeting & CAPEX", "Vendor Management", "Operating Procedures"]},
    {"domain": "Tenant Experience", "topics": ["Complaints & Feedback", "Communications", "Amenities"]},
    {"domain": "Leasing", "topics": ["Renewals & Retention", "Rent Reviews", "New Leasing"]},
    {"domain": "Sustainability", "topics": ["Carbon Reporting", "Green Mark", "Waste & Water"]},
]
CANDIDATES = [
    {"id": "exp-chiller-fault", "name": "Chiller Plant Fault Triage", "domain": "Technical Services", "topic": "Chillers & HVAC",
     "summary": "Triage for chiller plant alarms and 'too warm' complaints.",
     "knowledge": ["CHWST drifting above 7.5 °C for >15 min is the earliest reliable sign of a plant issue."],
     "decisionLogic": ["Check BMS: is CHWST above 7.5 °C?"], "guardrails": ["Never reset a chiller that tripped on a safety."], "escalation": []},
    {"id": "exp-energy-peak", "name": "Peak Demand Shaving", "domain": "Energy Optimisation", "topic": "Peak Demand",
     "summary": "Reducing peak kW demand charges.", "knowledge": ["Peak usually occurs 2-4pm on hot weekdays."], "decisionLogic": [], "guardrails": [], "escalation": []},
    {"id": "exp-lease-renewal", "name": "Lease Renewal Risk Signals", "domain": "Leasing", "topic": "Renewals & Retention",
     "summary": "Early-warning signals that a tenant may not renew.", "knowledge": ["Start renewal talks 12-18 months before expiry."], "decisionLogic": [], "guardrails": [], "escalation": []},
]
EXPERT = {"name": "Eval Expert", "role": "contributor", "domains": [t["domain"] for t in TAXONOMY]}

# (message, expected kind, expected domain or Expertise id)
CASES = [
    ("When the lift at Tower B keeps stopping between floors, we always check the door lock contacts first — in my experience it's dust, not the controller.", "new", "Technical Services"),
    ("If a chiller trips on low oil pressure right after a power dip, we let the oil heater run 30 minutes and it resets fine; also check the condenser pump VSD because it trips first when the tower is fouled.", "revision", "exp-chiller-fault"),
    ("Our peak is actually 11am to 1pm at the data centre, not the afternoon, because the batch jobs kick in then — pre-cool from 10am to shave it.", "revision", "exp-energy-peak"),
    ("For retail tenants, the strongest sign they won't renew is when they stop asking for fit-out approvals in the last year; we start retention talks then.", "revision", "exp-lease-renewal"),
    ("Whenever we get water ponding on the roof after heavy rain, we do a drone survey of the membrane before calling the contractor — saves a site visit most times.", "new", "Technical Services"),
    ("Never isolate the fire pump for maintenance without notifying SCDF and putting a fire watch on every floor; we got fined once.", "new", "Technical Services"),
    ("When a tenant complains about noise from the AHU room, send the technician with a sound meter first — half the time it's below 55 dB and it's actually the ceiling diffuser rattling.", "new", "Tenant Experience"),
    ("For Green Mark recertification, the auditors always ask for 12 months of sub-meter data, so start pulling it 3 months before the audit or you'll miss the gaps.", "new", "Sustainability"),
    ("Vendor rule we follow: if a cleaning contractor misses more than 3 KPIs in a quarter we issue a formal notice; after two notices we go to re-tender.", "new", "Asset Operations"),
    ("If the UPS battery string is older than 4 years, we replace the whole string rather than single blocks — mixing old and new blocks kills the new ones.", "new", "Technical Services"),
    ("What should I check first when a chiller trips? Can you walk me through the steps for Tower A?", "none", None),
    ("Thanks, that's really helpful, I'll pass it on to the team and get back to you tomorrow afternoon.", "none", None),
    ("Can you draft an email to the tenant at level 12 telling them the water will be off on Saturday from 9am to 1pm?", "none", None),
    ("Chillers use a refrigeration cycle with a compressor, condenser, expansion valve and evaporator to remove heat from water.", "none", None),
    ("The meeting with the landlord rep got moved to next Thursday at 3pm, so please update the calendar invite for everyone.", "none", None),
    ("Okay so your suggestion was to check the VAV boxes on level 23 first, I'll get the technician to do that now and report back.", "none", None),
    ("Level 9 has been warm since Monday and the tenant is upset; can you summarise the complaint history for me please?", "none", None),
    ("In my experience the escalator comb plate sensor gives false trips in the rain because water bridges the contacts — we dry it and test before calling the vendor.", "new", "Technical Services"),
    ("For rent reviews, I always pull the last 3 comparable deals within 500m and the tenant's sales per square foot before the first meeting, and I never open with our walk-away number.", "new", "Leasing"),
    ("During haze season we switch AHUs to 100% recirculation once the PSI goes above 150, and we tell tenants by email the same morning.", "new", None),
]


def ok(d, kind, want) -> bool:
    if d.kind != kind:
        return False
    if kind == "revision":
        return d.target.expertiseId == want
    if kind == "new" and want:
        return d.target.domain == want
    return True


async def main() -> int:
    if not claude.is_configured():
        print("Set ANTHROPIC_API_KEY in backend/.env first.")
        return 1
    print(f"Model: {settings.extraction_model}\n")
    correct = 0
    for i, (msg, kind, want) in enumerate(CASES, 1):
        req = ExtractRequest(user=EXPERT, turns=[{"role": "user", "content": msg}, {"role": "assistant", "content": "Noted."}],
                             taxonomy=TAXONOMY, candidates=CANDIDATES)
        d = validate(await call_model(req, claude.client), req, settings.extraction_model)
        good = ok(d, kind, want)
        correct += good
        got = d.kind if d.kind == "none" else f"{d.kind} → {d.target.expertiseName or d.target.domain} ({len(d.items)} lines, {d.confidence:.2f})"
        print(f"{'✓' if good else '✗'} {i:2}. want {kind:<8} got {got}\n      {msg[:90]}…")
    print(f"\n{correct}/{len(CASES)} correct")
    return 0 if correct >= int(0.8 * len(CASES)) else 2


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
