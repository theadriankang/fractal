#!/usr/bin/env python3
"""One-off: push fully-structured decisionLogic for three specific Expertise ids
(exp-energy-peak, exp-tenant-complaint, exp-capex-priority) into the live database.

This is NOT a re-seed -- it only touches the decision_logic column on these three rows,
leaving everything else (including other people's edits) untouched. Content comes from
/tmp/decision_matrix_update.json, which mirrors backend/seed_data.json's same update.

Usage (from backend/, with backend/.env configured -- same DATABASE_URL the app uses):
    python /tmp/outputs/patch_decision_logic.py           # dry run, prints what would change
    python /tmp/outputs/patch_decision_logic.py --apply   # actually writes the changes
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath("app")))

from app.db import SessionLocal  # noqa: E402
from app.models import Expertise  # noqa: E402

UPDATES_PATH = "/tmp/decision_matrix_update.json"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Actually write changes (default: dry run).")
    args = parser.parse_args()

    with open(UPDATES_PATH) as f:
        updates = json.load(f)

    db = SessionLocal()
    try:
        for eid, new_dl in updates.items():
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
