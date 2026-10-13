#!/usr/bin/env python3
"""One-off: push fully-structured decisionLogic for three Expertise ids
(exp-energy-peak, exp-tenant-complaint, exp-capex-priority) into the live database.

This is NOT a re-seed -- it only touches the decision_logic column on these three rows,
leaving everything else (including other people's edits) untouched.

Usage (from backend/, with backend/.env configured -- same DATABASE_URL the app uses):
    .venv/bin/python scripts/patch_decision_logic.py
    .venv/bin/python scripts/patch_decision_logic.py --apply
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db import SessionLocal  # noqa: E402
from app.models import Expertise  # noqa: E402

UPDATES = {
    "exp-energy-peak": [
        {
            "text": "Pull last 3 months of 30-min interval data; identify the top 5 demand intervals.",
            "condition": "Starting a peak-demand review (monthly billing cycle, or after a demand-charge spike)",
            "action": "Pull the last 3 months of 30-minute interval demand data and identify the top 5 highest-demand intervals.",
            "reasoning": "Peak-demand charges are set by the highest intervals, not average use — you need to know exactly when the peaks occur before you can target them.",
            "escalateIf": "",
        },
        {
            "text": "If peaks cluster at morning start-up → recommend staggered AHU start (5-min intervals by zone).",
            "condition": "Top demand intervals cluster around 9:00–10:30 morning start-up",
            "action": "Recommend staggering AHU starts by zone in 5-minute intervals, combined with pre-cooling from 7:00.",
            "reasoning": "Most peak demand in Singapore offices occurs when AHUs all start together after the weekend; staggered starts with pre-cooling typically cut the Monday peak by 8–12% without a measurable comfort-complaint increase.",
            "escalateIf": "",
        },
        {
            "text": "If peaks are afternoon → check chiller sequencing and solar gain on west façade floors.",
            "condition": "Top demand intervals occur in the afternoon, not at morning start-up",
            "action": "Check chiller sequencing for inefficient staging and inspect west-façade floors for solar-gain-driven cooling load.",
            "reasoning": "Afternoon peaks aren't explained by the startup pattern — chiller staging and solar gain on west-facing floors are the next most likely drivers.",
            "escalateIf": "",
        },
        {
            "text": "Estimate savings = (peak reduction kW × demand rate) and present with comfort risk.",
            "condition": "A specific intervention (staggered start, sequencing change) has been identified",
            "action": "Estimate savings as peak-reduction (kW) × demand rate, and present the recommendation alongside its comfort risk, not savings alone.",
            "reasoning": "A kW/cost estimate without the comfort trade-off doesn't let the Asset Manager make an informed call, since letting space temperature float is the main lever being used (space temperature can float to 25°C for 30 min without a measurable complaint increase, but never beyond 25.5°C).",
            "escalateIf": "The recommendation would affect a tenant's lease comfort clauses → requires Leasing + Asset Manager approval before implementing, not just informing.",
        },
    ],
    "exp-tenant-complaint": [
        {
            "text": "Acknowledge within 15 minutes with an ETA for first update.",
            "condition": "A tenant comfort complaint (temperature, air quality, noise) comes in",
            "action": "Acknowledge the complaint within 15 minutes, including an ETA for the first substantive update.",
            "reasoning": "Tenants care more about acknowledgement speed than fix speed — a fast acknowledgement defuses frustration even before the underlying issue is resolved.",
            "escalateIf": "",
        },
        {
            "text": "Log ticket and route to Technical Services with floor/zone.",
            "condition": "The complaint has been acknowledged",
            "action": "Log a ticket with the floor/zone and route it to Technical Services for investigation.",
            "reasoning": "Technical Services needs the specific location to diagnose the cause — a single-floor complaint usually points to a local AHU/VAV issue, not a plant-wide fault.",
            "escalateIf": "",
        },
        {
            "text": "If repeat complaint within 30 days → flag to Asset Manager as renewal risk.",
            "condition": "The same tenant has complained again within the last 30 days",
            "action": "Flag the tenant to the Asset Manager as a renewal-risk signal, in addition to the normal routing.",
            "reasoning": "Repeat complaints from the same tenant within 30 days are a known renewal-risk signal, not just an unresolved maintenance item.",
            "escalateIf": "Repeat complaint from an anchor tenant, or any repeat complaint → escalate to the Asset Manager the same day, not just logged for the next review cycle.",
        },
        {
            "text": "Close the loop with the tenant contact once resolved, including root cause in plain language.",
            "condition": "Technical Services has resolved the underlying issue",
            "action": "Close the loop directly with the tenant contact, explaining the root cause in plain, non-technical language.",
            "reasoning": "Tenants who never hear a resolution assume nothing was done, which erodes trust even when the fix was real and timely.",
            "escalateIf": "",
        },
    ],
    "exp-capex-priority": [
        {
            "text": "Score each item: safety/statutory (0–5), tenant impact (0–5), energy payback (years).",
            "condition": "Building the annual CAPEX prioritisation list",
            "action": "Score every candidate item on three axes: safety/statutory urgency (0–5), tenant impact (0–5), and energy payback period in years.",
            "reasoning": "A single combined ranking without separating these dimensions hides why an item ranks where it does, and safety/statutory items need to be visible as a distinct category since they don't trade off against payback.",
            "escalateIf": "",
        },
        {
            "text": "Rank statutory first, then by combined score.",
            "condition": "All items have been scored",
            "action": "Rank statutory and safety items first regardless of their payback or score, then rank the remainder by combined tenant-impact + payback score.",
            "reasoning": "Safety and statutory items always rank first, regardless of payback — this is a fixed rule, not a scoring outcome, because the cost of non-compliance or injury isn't commensurable with a payback-years comparison.",
            "escalateIf": "",
        },
        {
            "text": "Flag any item deferred twice as high risk.",
            "condition": "An item has been deferred in two consecutive CAPEX cycles",
            "action": "Flag the item as high risk in the ranking output, regardless of its individual score.",
            "reasoning": "An item deferred twice is trending toward failure or non-compliance even if its individual score doesn't look urgent in isolation — the deferral history itself is a risk signal.",
            "escalateIf": "A twice-deferred item is also safety/statutory → escalate to the Asset Manager immediately rather than carrying it to a third CAPEX cycle.",
        },
    ],
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Actually write changes (default: dry run).")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        for eid, new_dl in UPDATES.items():
            row = db.get(Expertise, eid)
            if row is None:
                print(f"[SKIP] {eid}: not found in live DB")
                continue
            old_dl = row.decision_logic or []
            print(f"{'[apply]' if args.apply else '[dry-run]'} {eid} ({row.name}): "
                  f"{len(old_dl)} entries -> {len(new_dl)} structured entries")
            if args.apply:
                row.decision_logic = new_dl
        if args.apply:
            db.commit()
            print("\nDone. Committed.")
        else:
            print("\nDry run complete. Re-run with --apply to write changes.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
