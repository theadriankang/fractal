# Fractal — Closing the Loop

> How Fractal **gets smarter after deployment**, while a human approves every change.
> Answers Keppel's question *"How does the solution get smarter after deployment?"*

**User corrects an answer → AI turns it into a precise fix → we test old vs new → reviewer approves → new version goes live → ratings per version show whether it really is better.**

---

## What's built

### 1 · Smart corrections
A 👎 with a correction is sent to `POST /api/loop/correction`. Claude Haiku reads the conversation, the answer, the **exact version** of the Expertise that was applied, and the correction. It returns:
- a **diagnosis**: outdated/wrong · missing step or rule · applied out of scope · *answer ignored the Expertise* (no change needed) · not actionable
- the **minimal change**, which can *replace* a line in place, insert a step at the right position, or narrow "When to use"
- a **test question** that would have caught the mistake

Python then validates it (`backend/app/loop/correct.py`): removals must match a real line, duplicates are dropped, and the target must be one of the Expertise actually applied. If the same issue is already open, it **merges into that proposal ("2 reports")**.
When more than one Expertise was applied, the correction box asks which one was wrong.
**Offline** (no backend), keyword rules file the correction instead, and the proposal is labelled *Offline rules*.

### 2 · Before/after test
**Test change** on a proposal sends up to 7 questions to `POST /api/loop/test`: the proposal's own question plus saved ones. Each question is answered twice (current version, proposed version). Claude Sonnet grades every answer on its own, seeing only the question, the pass criteria and the answer, so it never knows which version wrote it. Pass/fail is decided in Python.
The result reads **"Proposed 2/2 · current v1.3 1/2 · 1 fixed · nothing broke"**, and each question opens into the two answers side by side. If something broke, the button becomes **Approve anyway**.

Test questions build up on their own:
- a 👍 on an answer from the live version saves *question + approved answer* (graded as "consistent with the reference")
- approving a correction saves its test question (graded on must-do / must-not-do)

Offline, the run is simulated and clearly labelled.

### 3 · Health per version
Every rating now records the version it rated. The Expertise page shows the 👍 rate next to each version. The Review Queue gets a **Needs attention** section when the live version has 3 👎 in 7 days, or a 👍 rate under 70 % over ≥ 10 ratings, and it offers a **one-click rollback** when the previous version scored clearly better. The reviewer always decides.

---

## Where the code is

| Part | Files |
|---|---|
| Backend | `backend/app/loop/` (`schemas.py`, `correct.py`, `replay.py`), `backend/app/routers/loop.py`, settings in `config.py` |
| Front end | `src/lib/feedbackLoop.js` (pure helpers), `src/components/FeedbackLoop.jsx` (Review Queue pieces), store actions `rateResponse` · `submitCorrection` · `runProposalTest` · `approveProposal` |
| Database | `supabase/migrations/20261010150000_feedback_loop.sql`: version on feedback, proposal columns, `test_cases`, `test_runs` (used once governance moves server-side) |
| Tests | `backend/tests/test_loop.py` (14 tests, Claude stubbed) · `npm run validate:loop` (10 checks) |

**Stack:** React + Zustand · FastAPI · Claude Haiku (corrections, answers) + Claude Sonnet (grading) via the Anthropic SDK · Pydantic · Supabase Postgres. No new services.

Like `/api/chat/stream`, both endpoints are **stateless** today: the browser sends the Expertise and keeps proposals, test questions and runs in its store. When Prompts 5 and 7 move governance into the database, the new tables take over.

## Settings (`backend/.env`, all optional)
```
LOOP_CORRECTION_MODEL=claude-haiku-5-5
LOOP_GRADER_MODEL=claude-sonnet-5-5
LOOP_ANSWER_MODEL=claude-haiku        # front-end model id
LOOP_THRESHOLD=0.6                    # below this confidence a correction proposes nothing
LOOP_MAX_CASES=8
LOOP_CONCURRENCY=4
```

---

## Demo (60–90 s)

1. Sign in as **Hafiz Rahman** (Technical Services). Ask *"CHWST is 8.1 °C and level 23 is warm, what do I check?"* → the answer uses **Chiller Plant Fault Triage v1.3**. 👍 it (this saves a test question).
2. Ask again and 👎 → *"Step 2 is out of date — since the 2025 retrofit we check the CHW pump VSD fault log before staging up a standby chiller."* → toast **Correction sent to the Review Queue**.
3. Sign in as **Adrian Kang** (Reviewer) → Review Queue: a diagnosis badge with Claude's confidence, and step 2 **rewritten in place** (or a new step inserted before it) instead of a note appended to Knowledge.
4. **Test change** → *Proposed 2/2 · current 1/2 · 1 fixed · nothing broke* → open the fixed question to show both answers side by side.
5. **Approve & merge** → v1.4. Ask again → the chip says **v1.4** and the answer follows the new step.
6. *"Every correction makes Fractal smarter — and a human approves each one."*

Optional: three quick 👎 on one Expertise → **Needs attention** appears in the Review Queue.

## Not built yet
- Knowledge-gap radar and expert inbox (questions no Expertise could answer, routed to an expert)
- Notifying the person whose correction was merged
- Persisting proposals, test questions and runs in Supabase (waits for Prompts 5 + 7)
