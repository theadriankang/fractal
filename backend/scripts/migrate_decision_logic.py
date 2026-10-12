#!/usr/bin/env python3
"""One-off migration: wrap any plain-string decision_logic entries, on every Expertise row in
the live database, into the new structured shape ({"text": ..., "condition": "", "action": "",
"reasoning": "", "escalateIf": ""}).

Why this is needed: decision_logic is a JSON column (app/models.py) storing whatever shape was
last written to it. Existing rows predate the DecisionStep schema (backend/app/schemas.py) and
hold plain strings. The API layer already coerces plain strings on read (coerce_decision_logic,
used by every response schema), so nothing is broken without this script -- but running it once
makes the stored data match the new shape going forward, so future direct DB reads/exports don't
need that coercion, and so newly-added structured sub-fields (condition/action/reasoning/
escalateIf) have somewhere to live without a mixed-shape list.

Idempotent: a row already holding dicts is left untouched. Safe to re-run.

Usage (from backend/, with backend/.env configured -- same DATABASE_URL the app uses):
    python scripts/migrate_decision_logic.py          # dry run, prints what would change
    python scripts/migrate_decision_logic.py --apply   # actually writes the changes
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db import SessionLocal  # noqa: E402
from app.models import Expertise  # noqa: E402


def wrap(item):
    if isinstance(item, dict):
        return item
    return {"text": str(item), "condition": "", "action": "", "reasoning": "", "escalateIf": ""}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Actually write changes (default: dry run).")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        rows = db.query(Expertise).all()
        changed = 0
        for e in rows:
            dl = e.decision_logic or []
            new_dl = [wrap(x) for x in dl]
            if new_dl != dl:
                changed += 1
                print(f"{'[apply]' if args.apply else '[dry-run]'} {e.id} ({e.name}): "
                      f"{len(dl)} entries would be wrapped")
                if args.apply:
                    e.decision_logic = new_dl
        if args.apply:
            db.commit()
            print(f"\nDone. {changed} Expertise row(s) updated.")
        else:
            print(f"\nDry run complete. {changed} Expertise row(s) would be updated. "
                  f"Re-run with --apply to write changes.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
