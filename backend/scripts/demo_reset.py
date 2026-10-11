#!/usr/bin/env python3
"""Restore the demo to a known-clean state before/after a live run.

What it does, in order:
1. Re-seeds users, Expertise, Proposals and Chats from seed_data.json
   (reuses seed.py's upsert functions — overwrites any field changed
   during testing back to the seed value, e.g. a status/version bumped
   by a test approval).
2. Deletes anything NOT in the seed: stray Chats, Expertise drafts, and
   Proposals created while testing (e.g. auto-detected drafts from the
   capture flow, or chats started by a demo account).
3. Deletes ExpertiseVersion rows for seeded Expertise that aren't one of
   the seed's own versions (extra versions left over from a test
   approve/rollback), and Feedback + audit_log rows entirely, so the
   Review Queue, Audit Log and ratings start empty.
4. Rebuilds the pgvector index for approved Expertise, since step 2/3
   can change which Expertise is approved.

Idempotent — safe to run multiple times, including against a database
that already looks clean.

Run from backend/:
    python scripts/demo_reset.py [--yes]

Prerequisites: same as seed.py (backend/.env with DATABASE_URL, SUPABASE_URL,
SUPABASE_SERVICE_ROLE_KEY; supabase/migrations applied).
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"))

from app.db import SessionLocal
from app.models import Chat, Expertise, ExpertiseVersion, Proposal, Feedback, AuditLog
from app.retrieval.index import sync_missing

import seed as seed_mod


def _load_seed():
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "seed_data.json")
    with open(path) as f:
        return json.load(f)


def main():
    confirm = "--yes" in sys.argv
    if not confirm:
        answer = input(
            "This will overwrite demo Expertise/Proposals/Chats with seed_data.json and "
            "delete anything created outside it (test drafts, feedback, audit log). Continue? [y/N] "
        )
        if answer.strip().lower() not in ("y", "yes"):
            print("Aborted.")
            return

    data = _load_seed()
    seed_expertise_ids = {e["id"] for e in data["expertise"]}
    seed_proposal_ids = {p["id"] for p in data["proposals"]}
    seed_chat_ids = {c["id"] for c in data["chats"]}
    seed_versions_by_expertise = {
        e["id"]: {v["version"] for v in e.get("versions", [])} for e in data["expertise"]
    }

    db = SessionLocal()
    try:
        # 1. Re-seed users (also ensures the reviewer id used as default chat owner exists).
        sb = seed_mod.get_supabase_client()
        default_user_id = None
        for u in data["users"]:
            uid = seed_mod.upsert_user(sb, u["email"], "demo1234", u["name"], u["role"], u.get("domains", []))
            if u["role"] == "reviewer" and default_user_id is None:
                default_user_id = uid
        if default_user_id is None:
            # Offline fallback (no Supabase Admin access): reuse whatever reviewer profile exists.
            existing_reviewer = db.query(seed_mod.Profile).filter_by(role="reviewer").first()
            default_user_id = existing_reviewer.id if existing_reviewer else None

        print("Re-seeding Expertise, Proposals, Chats...")
        seed_mod.seed_expertise(db, json.loads(json.dumps(data["expertise"])))
        seed_mod.seed_proposals(db, json.loads(json.dumps(data["proposals"])))
        if default_user_id:
            seed_mod.seed_chats(db, json.loads(json.dumps(data["chats"])), default_user_id)
        else:
            print("  [skip] No reviewer profile found — skipping chat reseed (run seed.py first).")

        # 2. Delete anything not in the seed.
        stray_expertise = db.query(Expertise).filter(~Expertise.id.in_(seed_expertise_ids)).all()
        stray_proposals = db.query(Proposal).filter(~Proposal.id.in_(seed_proposal_ids)).all()
        stray_chats = db.query(Chat).filter(~Chat.id.in_(seed_chat_ids)).all()
        print(f"Deleting {len(stray_expertise)} stray Expertise, {len(stray_proposals)} stray proposals, "
              f"{len(stray_chats)} stray chats (created outside seed_data.json)...")
        for row in stray_proposals:
            db.delete(row)
        for row in stray_chats:
            db.delete(row)
        for row in stray_expertise:
            db.delete(row)
        db.commit()

        # 3. Trim extra versions on seeded Expertise; clear Feedback + audit_log.
        trimmed = 0
        for eid, versions in seed_versions_by_expertise.items():
            extra = (
                db.query(ExpertiseVersion)
                .filter(ExpertiseVersion.expertise_id == eid, ~ExpertiseVersion.version.in_(versions))
                .all()
            )
            for v in extra:
                db.delete(v)
                trimmed += 1
        n_feedback = db.query(Feedback).delete()
        n_audit = db.query(AuditLog).delete()
        db.commit()
        print(f"Trimmed {trimmed} extra Expertise versions, cleared {n_feedback} feedback rows, "
              f"{n_audit} audit log rows.")

        # 4. Rebuild the retrieval index for whatever is approved now.
        print("Rebuilding Expertise search index...")
        n_reindexed = sync_missing(db)
        print(f"Re-embedded {n_reindexed} approved Expertise.")

    finally:
        db.close()

    print("Demo reset complete.")


if __name__ == "__main__":
    main()
