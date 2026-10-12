"""Evaluate Expertise retrieval quality against paraphrased questions.

Usage:
    cd backend && ./venv/bin/python -m scripts.eval_retrieval

Prints hit@1, hit@3, and a comparison with the old keyword matcher.
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db import SessionLocal
from app.models import Expertise
from app.retrieval.index import search as semantic_search


# --- Test cases ---------------------------------------------------------------
# Paraphrased questions that avoid the Expertise's exact keywords.
# expected_id = the expertise id that SHOULD be the top match, or None for
# unrelated questions that must return nothing.
TEST_CASES = [
    {
        "query": "the aircon on level 23 is struggling and the plant is throwing errors",
        "expected": "exp-chiller-fault",
    },
    {
        "query": "tenant says the air feels stuffy and stale up on 14",
        "expected": "exp-tenant-complaint",
    },
    {
        "query": "our power bill spiked this month, the utility charge is way higher than expected",
        "expected": "exp-energy-peak",
    },
    {
        "query": "people stuck between floors in the lift car and the intercom isn't working",
        "expected": "exp-lift-entrapment",
    },
    {
        "query": "those moving stairs have broken teeth near the landing, should we keep running them",
        "expected": "exp-escalator-comb",
    },
    {
        "query": "need to run the backup diesel generator test this month but not sure how to load it",
        "expected": "exp-genset-test",
    },
    {
        "query": "staging the cooling units to use less power at partial building load",
        "expected": "exp-chiller-seq",
    },
    {
        "query": "ranking our equipment replacement projects for next year's capital plan",
        "expected": "exp-capex-priority",
    },
    {
        "query": "scoring our maintenance contractors on responsiveness and quality this quarter",
        "expected": "exp-vendor-review",
    },
    {
        "query": "drafting the advance notification for tenants about next weekend's water outage",
        "expected": "exp-shutdown-notice",
    },
    {
        "query": "getting ready for the green building recertification audit in six months",
        "expected": "exp-green-mark",
    },
    {
        "query": "which companies in our portfolio might leave when their contracts are up",
        "expected": None,  # lease renewal is in_review, not approved → should return nothing
    },
    {
        "query": "what's the best pizza restaurant near the office",
        "expected": None,  # unrelated
    },
    {
        "query": "how do I reset my email password",
        "expected": None,  # unrelated
    },
]


def old_keyword_matcher(query: str, all_expertise: list, attached_ids=None, auto_apply=True) -> list:
    """The original keyword-substring matcher from src/lib/mockApi.js."""
    p = query.lower()
    attached_ids = attached_ids or []
    attached = [e for e in all_expertise if e.id in attached_ids]
    if not auto_apply:
        return attached
    auto = (
        [
            (e, sum(1 for k in (e.keywords or []) if k and k.lower() in p))
            for e in all_expertise
            if e.status == "approved" and e.id not in attached_ids
        ]
    )
    auto = [(e, s) for e, s in auto if s > 0]
    auto.sort(key=lambda x: x[1], reverse=True)
    auto = auto[:2]
    return [e for e, _ in auto]


def main():
    db = SessionLocal()
    try:
        all_expertise = db.query(Expertise).all()
        approved = [e for e in all_expertise if e.status == "approved"]

        print("=" * 80)
        print("Expertise Retrieval Evaluation — Semantic vs Keyword")
        print("=" * 80)
        print(f"\n{len(approved)} approved Expertise in the database.\n")

        # --- Semantic search ---
        sem_hits_1 = 0
        sem_hits_3 = 0
        sem_results = []

        print("--- Semantic (hybrid) search ---")
        for tc in TEST_CASES:
            results = semantic_search(db, tc["query"], attached_ids=[], limit=3)
            ids = [r["id"] for r in results]
            expected = tc["expected"]

            if expected is None:
                hit = len(ids) == 0
                status = "PASS" if hit else "FAIL (should return nothing)"
            else:
                hit1 = expected in ids[:1]
                hit3 = expected in ids[:3]
                hit = hit1 or hit3
                status = f"hit@1={'Y' if hit1 else 'N'} hit@3={'Y' if hit3 else 'N'}"

            if expected is None:
                if hit:
                    sem_hits_1 += 1
                    sem_hits_3 += 1
            else:
                if expected in ids[:1]:
                    sem_hits_1 += 1
                if expected in ids[:3]:
                    sem_hits_3 += 1

            top = f"{results[0]['id']} ({results[0]['score']})" if results else "(none)"
            print(f"  Q: {tc['query'][:60]}...")
            print(f"    Expected: {expected or 'nothing'} | Top: {top} | {status}")
            sem_results.append((tc, ids, hit))

        # --- Keyword matcher ---
        kw_hits_1 = 0
        kw_hits_3 = 0

        print("\n--- Old keyword matcher ---")
        for tc in TEST_CASES:
            matched = old_keyword_matcher(tc["query"], all_expertise)
            ids = [e.id for e in matched]
            expected = tc["expected"]

            if expected is None:
                hit = len(ids) == 0
                status = "PASS" if hit else "FAIL (should return nothing)"
            else:
                hit1 = expected in ids[:1]
                hit3 = expected in ids[:3]
                hit = hit1 or hit3
                status = f"hit@1={'Y' if hit1 else 'N'} hit@3={'Y' if hit3 else 'N'}"

            if expected is None:
                if hit:
                    kw_hits_1 += 1
                    kw_hits_3 += 1
            else:
                if expected in ids[:1]:
                    kw_hits_1 += 1
                if expected in ids[:3]:
                    kw_hits_3 += 1

            top = ids[0] if ids else "(none)"
            print(f"  Q: {tc['query'][:60]}...")
            print(f"    Expected: {expected or 'nothing'} | Top: {top} | {status}")

        # --- Summary ---
        total = len(TEST_CASES)
        print("\n" + "=" * 80)
        print("SUMMARY")
        print("=" * 80)
        print(f"{'Metric':<20} {'Semantic':>10} {'Keyword':>10}")
        print("-" * 42)
        print(f"{'hit@1':<20} {sem_hits_1:>10}/{total} {kw_hits_1:>10}/{total}")
        print(f"{'hit@3':<20} {sem_hits_3:>10}/{total} {kw_hits_3:>10}/{total}")
        print()

    finally:
        db.close()


if __name__ == "__main__":
    main()
