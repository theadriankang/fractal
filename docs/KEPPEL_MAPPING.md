# Keppel "AI HARVEST" — requirement → Fractal feature mapping

Maps every requirement in the Real Estate Track challenge brief to the exact Fractal feature, file or screen that answers it. Chosen Intelligence Pills (domains): **Technical Services, Energy Optimisation, Asset Operations, Tenant Experience, Leasing, Sustainability** — all six (`src/data/taxonomy.js`), so the platform isn't scoped to just one.

## What the Solution Should Solve

| Requirement | How Fractal answers it |
|---|---|
| **Capture expert know-how**, including undocumented knowledge | Two capture paths: (1) passive — any contributor's chat message ≥12 words is run through an extraction pass (`backend/app/capture/extract.py`) that proposes new/revised Expertise with a verbatim quote as evidence; (2) active — the Meeting Recorder (`src/pages/MeetingRecorder.jsx`) transcribes a live conversation with an expert and saves it as a source. |
| **Turn know-how into reusable, governed intelligence** | The Expertise object (`src/data/expertise.js` schema) structures each pill with `summary`, `whenToUse`, `knowledge[]`, `decisionLogic[]`, `guardrails[]`, `escalation[]`, an `owner`/`reviewer`, and a version history — not a one-off chat answer. |
| **Apply specialist AI support** | `POST /api/chat/stream` retrieves the top-matching *approved* Expertise for the prompt (`backend/app/retrieval/index.py`, hybrid pgvector + keyword search) and grounds the model's system prompt with it (`backend/app/prompts.py`) — any of the 12 connected models (Claude, GPT, Gemini, Grok, Hunyuan, DeepSeek) can apply the same governed knowledge. |
| **Coordinate across domains** | **Weigh domains** mode in chat (`POST /api/expertise/weigh`, `backend/app/weigh/`) doesn't pick a winner between experts: it seats one approved Expertise per relevant domain (best search match per domain, plus the domains those already link to via `related`), then shows **each expert's view**, **where they agree** (common ground to build on), **where one domain's idea may not hold** because of another domain's rule (each conflict quotes the exact approved line it rests on, verified server-side, or it is dropped), and a **suggested way forward** in which every suggestion lists the experts it draws on and how each *other* expert views it (supports / with conditions / has a concern). Escalation rules and "this needs Leasing sign-off but no Leasing Expertise was weighed" gaps come straight from the records, not the model. Example: pre-cooling to cut the Monday peak (Energy) vs. a tenant who has complained twice (Tenant Experience) vs. single-floor complaints usually being an AHU fault (Technical Services). |
| **Keep people in control** | See "Human-supervised" below — every write to governed data requires an explicit human action (submit → review → approve), and the system prompt (Appendix A) instructs models to recommend, never to claim an action was performed. |
| **Learn through governed feedback** | A 👍/👎 rating on any answer feeds `POST /api/responses/{id}/rating`; a 👎 with a comment auto-opens a correction Proposal, success rate is recomputed, and nothing changes live Expertise until a Reviewer approves it. |

## The Solution Should Be

| Criterion | Where it's shown |
|---|---|
| **Human-supervised** | Nothing reaches "approved" without a person: `POST /api/expertise/{id}/submit → approve` requires a `reviewer` role (`backend/app/governance.py`, enforced server-side, not just hidden in the UI). |
| **Transparent** | Every answer that used Expertise shows an "Expertise applied: *name* vN" chip; the `meta` SSE event and chat message store the exact Expertise id+version used, and Auto routing shows its category + reason ("Auto · Operational reasoning"). |
| **Accountable** | Every Expertise has an `owner` and, once approved, a `reviewer`; every governance action writes an audit row with the actor's identity (`audit_log`, `GET /api/audit`). |
| **Reliable** | Drafts/in-review Expertise are never injected into a model prompt (`backend/app/retrieval/index.py` filters `status='approved'` only) — only reviewed, versioned content can influence an answer. Feedback (👍/👎) tracks a `successRate` per Expertise over time. |
| **Reusable** | Once approved, an Expertise is matched and applied automatically to *any future conversation* across the org, on *any* connected model — not re-typed per conversation. |
| **Scalable** | The taxonomy is domain × topic × asset type (`ASSET_TYPES = [Office, Data Centre, Logistics, Retail]`), so one Expertise can be tagged for multiple asset types, and new domains/topics are additive, not a schema change. |
| **Governed** | Full lifecycle: draft → in_review → approved → (deprecated / rolled back), every transition reviewer-gated and audited — see the Expertise-lifecycle diagram in `docs/ARCHITECTURE.md`. |
| **Portable** | Expertise content is plain structured data (JSON fields in Postgres) owned by the organisation, independent of any one model — the same record is used to ground Claude, GPT, Gemini, Grok or Hunyuan interchangeably; it can be exported via the API with no vendor lock-in. |
| **Version-controlled** | Every approval bumps a semantic version and snapshots the prior content to `expertise_versions`; `POST /api/expertise/{id}/rollback {version}` restores any prior snapshot as a new version, never a destructive overwrite. |
| **Secure** | Role-based access (`reviewer` / `contributor` / `intern`) is enforced **server-side** on every governance endpoint, not just hidden in the UI (`backend/app/auth.py`'s role checks). Requests authenticate with a real Supabase session: the front end signs in via `supabase.auth.signInWithPassword` and sends the resulting JWT as `Authorization: Bearer`, and the backend verifies it against the project's own signing keys (`backend/app/auth.py` — ES256 checked against Supabase's JWKS, with a legacy HS256 shared-secret path for older projects) before trusting the `sub` claim as the caller's identity. |
| **Clearly bounded** | Every Expertise explicitly separates `knowledge`/`decisionLogic` (what to do) from `guardrails` (what must never be done) and `escalation` (when a human specialist must take over); the system prompt instructs the model to prefix escalation-condition answers with "⚠️ Escalate:" and to label anything beyond approved Expertise as "General guidance (not from approved Expertise)". |

## Solution Diagram — the four required points

| # | Point | Answer |
|---|---|---|
| 1 | The specific business problem | Critical operational know-how (e.g. "which fault pattern means it's the lift door contacts, not the controller") lives in a few experts' heads, is applied inconsistently across assets, and is lost when they leave — see `docs/PROJECT_CONTEXT.md` → "What Fractal is". |
| 2 | Whose expertise, and how undocumented knowledge is obtained | Domain experts (contributors scoped to their domain, e.g. a Technical Services engineer) — captured passively from their normal chat usage, or actively via the Meeting Recorder when interviewing an expert who doesn't write things down. |
| 3 | How captured expertise becomes reusable | It's promoted from a raw quote into a structured, versioned Expertise record (not left as a chat transcript), matched by semantic + keyword search and auto-applied to any future relevant question — see the lifecycle diagram in `docs/ARCHITECTURE.md`. |
| 4 | How an Asset Operations Manager uses/supervises it | They see the Review Queue (pending drafts/proposals to approve), the Expertise catalog (browse what's approved, by domain/topic/asset type), the "Expertise applied" chip + escalation warnings on every answer, and the Audit Log for full traceability. |

## Solution Should Include

| Required | Status |
|---|---|
| Demo Walkthrough | Live: chat → Expertise applied chip → 👎 correction → Review Queue → approve → version bump (matches Prompt 7's done-when check). |
| Architecture / trust-boundary diagram + key design trade-offs | `docs/ARCHITECTURE.md` (this repo). |
| Source Code via GitHub repo | `github.com/theadriankang/fractal`, `main` branch. |
| Live deployment (bonus) | Front end: https://fractal-delta.vercel.app (Vercel, auto-deploys from `main`). Backend: https://fractal-backend-422044745328.asia-southeast1.run.app (Google Cloud Run, auto-redeploys from `main`; health at `/api/health`). Database/Auth/meetings Edge Function: Supabase. See `docs/DEPLOY.md`. |

## Known limitations (said plainly, not hidden)
- **Meeting Recorder transcription is browser-only today**: `backend/app/config.py`'s `TRANSCRIBE` flag (`browser` / `tencent-asr` / `whisper`) exists for a server-side transcription path, but only `browser` (the Web Speech API, client-side) is implemented — the other two are documented placeholders (see the flag's own TODO).
- **Expertise embeddings run locally (fastembed), not through a hosted embedding API** — a deliberate trade-off for zero marginal cost and no outbound dependency on the core retrieval loop (see "Key design trade-offs" in `docs/ARCHITECTURE.md`); it trails a model like `text-embedding-3-small` on embedding quality, which the hybrid keyword-boosted score partly compensates for.
