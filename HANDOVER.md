# Fractal — Handover (15 Oct 2026)

Submission deadline: **16 Oct 2026**. This file says what was wrong, what was fixed, how to get
started, and what is still open, in priority order.

---

## 1. What went wrong

The handover notes in the Claude Project (`FEEDBACK_LOOP.md`, `SEARCH.md`, `EVALUATION.md`,
`WEIGHING.md`) described two features in detail that nobody could find in the repo:

| Feature | What we found |
|---|---|
| **Feedback loop** (smart corrections, before/after test, health per version) | **Built, but never pushed.** Commit `926e2a6` existed only on Jason's laptop (`feature/feedback-loop`). It was based on 9 Oct code, before main gained Supabase persistence, so it could not simply be pushed either. |
| **Hybrid chunk search** (`expertise_chunks`, RRF, `/api/expertise/search`) | **Not in the repo anywhere** — not on GitHub, not on either laptop. It was written up in a Claude session whose workspace is gone. Main has a different, simpler search instead (see below). |
| **Cross-domain weighing** | Real and merged (PRs #24, #26, #27). |

Main's actual search: `POST /api/expertise/match` → `backend/app/retrieval/` — one embedding per
approved Expertise (`expertise_embeddings`, bge-small 384-d, HNSW) plus a keyword boost, threshold
0.40. The repo's README and `docs/KEPPEL_MAPPING.md` already describe this correctly. **Don't claim
chunk-level search, RRF or `expertise_chunks` in the pitch** — that design was never built.

Also found on Jason's laptop: `feature/chat-knowhow-capture` was 1 commit ahead of GitHub
(`8a83b94`), but the same fix is already on main, so nothing was lost.

## 2. What was fixed (branch `feature/feedback-loop`)

- **Feedback loop merged onto current main.** Conflicts resolved in 9 files, keeping main's
  domain-scope rules, one-rating-per-person, weighing and retrieval.
- **It now persists like everything else.** Loop proposals save to Supabase with their metadata
  (`proposals.loop`: diagnosis, `set`, test question, reports, last test run); a second 👎 on the
  same issue merges via `PATCH /api/proposals/{id}`; test questions save per Expertise
  (`expertise.test_cases`, `PUT /api/expertise/{id}/test-cases`).
- **Server approval matches the browser.** A rewritten step stays in place, `insertAfter` keeps step
  order, `set` replaces "When to use", and the proposal's test question is saved
  (`backend/app/governance.py`).
- **No more duplicate proposals.** A 👎 rating is sent with `propose: false`, so the server stops
  filing its old plain "add comment to Knowledge" proposal alongside the loop's precise one.
- **Works with structured decision steps** (main switched `decisionLogic` to objects after the loop
  was written).
- **Claude token ceilings raised** for the loop's correction, answers and grader (EVALUATION issue O),
  with `stop_reason` logged when no tool call comes back.
- **Database:** `supabase/migrations/20261015061738_feedback_loop.sql` (two additive columns) was
  **already applied to the shared project `fractal-meetings` on 15 Oct**, so the new backend can be
  deployed safely. The currently deployed backend ignores the new columns.
- **Docs:** `docs/FEEDBACK_LOOP.md`, `docs/KEPPEL_MAPPING.md` and `README.md` now describe the loop
  as it is.

Checks run: backend **170 passed** (4 new loop-persistence tests), `npm run validate:loop` 10/10,
`validate:ratings` and `test:writing` pass, `npm run build` passes. **Not tested:** real Claude
calls through the loop (no API key in the build sandbox), and a click-through in a browser.

## 3. Getting started

```bash
git fetch origin && git checkout main && git pull        # after the PR is merged
npm ci && npm run dev                                     # front end (VITE_API_BASE in .env)
cd backend && pip install -r requirements.txt
cp .env.example .env                                      # DATABASE_URL, SUPABASE_*, ANTHROPIC_API_KEY — ask Adrian
uvicorn app.main:app --reload
python -m pytest -q                                       # backend tests
npm run validate:loop && npm run validate:ratings         # front-end checks
```

**Jason's laptop (`Desktop/Tencent-Fractcals`)** is on `feature/cross-domain-weighing` with local
`main` 62 commits behind. To line it up: `git checkout main && git pull`. The old local
`feature/feedback-loop` and `master` branches can be deleted once the PR is merged
(`git branch -D feature/feedback-loop master`). A file `.git/unpushed.bundle` was left inside the
`.git` folder while recovering the branch; it is safe to delete.

---

## 4. Pending work

### P0 — before submission (16 Oct)

| # | Task | Owner | Done when |
|---|---|---|---|
| 1 | Review and merge the `feature/feedback-loop` PR | Adrian | On main |
| 2 | Redeploy backend (Cloud Run) and front end (Vercel) — see `docs/DEPLOY.md` | Adrian | `/api/health` OK; `/api/loop/correction` responds |
| 3 | **Live run-through of the loop demo with real Claude** (`docs/FEEDBACK_LOOP.md` → Demo): 👍 → 👎 with "Step 2 is out of date…" → Review Queue shows diagnosis and in-place rewrite → **Test change** → approve → v-bump. Check backend logs for `no tool call (stop_reason=…)` | anyone | Demo works twice in a row on the deployed app |
| 4 | Make the pitch/deck match the code: chunk search and RRF are **not** built; the loop **is**; weighing **is** | presenter | Every claim maps to a route or file in `docs/KEPPEL_MAPPING.md` |
| 5 | Run `python -m scripts.eval_retrieval` against the live DB and sanity-check the 0.40 match threshold on the demo questions | anyone | Demo questions match the intended Expertise; off-topic ones match nothing |

### P1 — fixes worth doing (from `EVALUATION.md`, re-checked on 15 Oct)

| Issue | What | Where |
|---|---|---|
| S | Fresh-database migration order: `20261010_core_schema.sql` sorts after migrations that need it. Rename to `20261010000000_core_schema.sql` and `supabase migration repair` the shared project. Also: the shared project's history records `20261010190000` as `profiles_email` (repo has `meetings_recorded_by`), and `20261012180000_create_data_reports` was applied by hand (table exists, not in history). | `supabase/migrations/` |
| O | Same token-ceiling risk remains for the capture extractor (`max_tokens=2000`) and weighing (`3500`). Apply the loop's fix: `settings.claude_max_output_tokens` + `output_config={"effort": "low"}` | `backend/app/capture/extract.py`, `backend/app/weigh/engine.py` |
| — | `npm run validate:demo` fails on main too: stale expectations (expects 54 records / old hydration shape). Update or delete the stale asserts. | `scripts/validate-demo.mjs` |
| L | "Download .md (SKILL.md)" isn't a valid skill file: needs `name` (slug) + `description`, quoted YAML | `src/pages/ExpertiseDetail.jsx` `toMarkdown` |
| X | Settings → Connections still collects API keys in the browser and its Test button is fake. Replace with read-only status from `/api/models` | `src/components/SettingsModal.jsx` |
| G | Every New Chat click makes another empty chat; reuse an existing empty one | `src/store.js` `newChat` |
| W | Feedback lives in two places (`expertise.feedback` JSON and the `feedback` table) | backend models |
| F, H | Compare "+" can add the same model twice; sidebar covers the screen on phones (not re-checked since 10 Oct) | `ModelSelector.jsx`, layout |
| — | Two stale branches never merged and apparently superseded by later work: `feature/connect-ui`, `feature/governance`. Confirm with their author, then delete. | GitHub |

### P2 — next features

| Feature | Why it matters for Keppel | Notes |
|---|---|---|
| **Knowledge-gap radar + expert inbox** | "How does it get smarter" — questions no approved Expertise could answer get routed to the right domain expert | Retrieval already knows the best score per question; log below-threshold questions, show them per domain |
| **Notify the person whose correction was merged** | Closes the loop for the contributor; encourages more corrections | Proposal already stores `reports` with each reporter |
| **Test-run history per proposal** | Today only the latest run is kept (`proposals.loop.testRun`) | Add a `test_runs` table if needed |
| **Chunk-level hybrid search** (the unbuilt `SEARCH.md` design) | Better matching on one step or a code like "CHWST", and "matched on step 2" explanations | Optional; current per-Expertise search works for the demo. The design is in the Claude Project's `SEARCH.md` |
| **Server-side meeting transcription** | Browser speech recognition is the only option today | `TRANSCRIBE=tencent-asr|whisper` are placeholders in `backend/app/config.py` |
| **Domain filters for retrieval** | Pass the user's domains to narrow matches | `backend/app/retrieval/index.py` |
