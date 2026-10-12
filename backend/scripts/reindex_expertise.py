"""Re-index all approved Expertise embeddings.

Usage:
    cd backend && ./venv/bin/python -m scripts.reindex_expertise

Re-embeds every approved Expertise, skipping those whose content_hash is unchanged.
Also removes embeddings for Expertise that are no longer approved.
"""

import sys
import os

# Ensure backend/ is on sys.path so `app` is importable.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text

from app.db import SessionLocal
from app.models import Expertise
from app.retrieval.index import delete_embedding, index_expertise, is_pgvector_available


def main():
    db = SessionLocal()
    try:
        if not is_pgvector_available(db):
            print("pgvector not available — connect to Supabase Postgres first.")
            sys.exit(1)

        approved = db.query(Expertise).filter(Expertise.status == "approved").all()
        print(f"Found {len(approved)} approved Expertise to index.")

        indexed = 0
        for e in approved:
            index_expertise(db, e)
            indexed += 1
            print(f"  ✓ {e.id} ({e.name} v{e.version})")

        # Remove embeddings for non-approved Expertise.
        all_with_emb = db.execute(
            text("select expertise_id from expertise_embeddings")
        ).fetchall()
        approved_ids = {e.id for e in approved}
        removed = 0
        for (eid,) in all_with_emb:
            if eid not in approved_ids:
                delete_embedding(db, eid)
                removed += 1
                print(f"  ✗ removed embedding for {eid}")

        print(f"\nDone: {indexed} indexed, {removed} removed.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
