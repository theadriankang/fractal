# Fractal — Project Context (read this first)

> This file is the shared brief for any coding assistant (CodeBuddy, WorkBuddy, Claude) working on this repo.
> Every prompt in `docs/BUILD_PROMPTS.md` starts with "Read docs/PROJECT_CONTEXT.md".

## What Fractal is
A multi-model AI chat platform (Claude, GPT, Gemini, Grok, Tencent Hunyuan, DeepSeek) with a governed **Expertise** layer.
People chat normally; Fractal **captures reusable expert know-how from conversations**, turns it into structured **Expertise**
(Keppel calls these "Intelligence Pills"), routes it through **human review**, **versions** it, and **applies approved Expertise**
to future answers on any model.

Built for the **Tencent Cloud AI CAN DO IT Hackathon 2026 — Real Estate Track (Keppel) "AI HARVEST"**. Deadline **16 Oct 2026**.

## Judging points we must visibly satisfy
Human-supervised · Transparent (show which Expertise/version was used) · Accountable (owner/reviewer) · Reliable · Reusable ·
Scalable (domains × asset types) · Governed (review → approve → version) · Portable (export, model-independent) ·
Version-controlled (rollback) · Secure (role-based access) · Clearly bounded (guardrails, escalation, "never executes").

## Repo layout
```
/                     React 18 + Vite + Tailwind front end (DONE — UI complete, currently uses mocks)
  src/store.js        Zustand store — ALL state + actions (chats, expertise, proposals, settings, user role)
  src/lib/mockApi.js  The ONLY mock layer: matchExpertise, buildReply, streamText, detectExpertise, suggestTitle
  src/data/models.js  Providers, model list (front-end ids like 'claude-sonnet'), routeAuto() keyword router, ROUTES
  src/data/expertise.js  Seed Expertise + STATUSES + CONTENT_FIELDS (the Expertise schema lives here)
  src/data/taxonomy.js   TAXONOMY (6 domains → topics), ASSET_TYPES, buildTree()
  src/data/chats.js      Seed chats + suggestion prompts
  src/pages/*, src/components/*  UI
  src/pages/MeetingRecorder.jsx + src/hooks/useMeetingRecorder.js, useSpeechRecognition.js, useMicAnalyser.js
                      Meeting Recorder (live transcript via browser Web Speech API, inline editing, recent meetings)
  src/lib/meetingsService.js, src/lib/supabase.js
                      Meetings: browser → Supabase Edge Function `meetings` (Claude insights + save)
  supabase/migrations/  ALL database schema (SQL). Every schema change = a new timestamped .sql file here
  supabase/functions/   Supabase Edge Functions (TypeScript/Deno) — currently `meetings`
/backend              Python FastAPI "AI service" (TO BUILD): LiteLLM, LlamaIndex, routing, extraction, governance
/docs                 This file + build prompts
```

## Architecture (decided)
```
Browser (React)
  ├── Supabase Auth  (login; JWT carries the user id)
  ├── Supabase       (simple reads that Row Level Security allows, e.g. listing Expertise)
  ├── Edge Function `meetings`  (Meeting Recorder insights + save — already built)
  └── FastAPI on Tencent Cloud  (/api/*: chat streaming, Auto routing, Expertise retrieval,
                                 extraction, review/approve/rollback, audit) ──► Supabase Postgres (+ pgvector)
```
- **Supabase is the only database** (Postgres + pgvector + Auth + Edge Functions). No SQLite.
- FastAPI talks to Supabase Postgres with `DATABASE_URL` and verifies the user's **Supabase JWT** on every request.
- Use the Supabase project in the **Singapore (ap-southeast-1)** region, owned by a shared team organisation.

## Expertise object (source of truth: src/data/expertise.js)
```
id, name, domain, topic, assetTypes[], status ('draft'|'in_review'|'approved'|'deprecated'), version ('1.3'),
owner, ownerRole, reviewer, keywords[], usageCount, successRate (0–1|null), createdAt, updatedAt,
summary, whenToUse, knowledge[], decisionLogic[], guardrails[], escalation[],
related[] (expertise ids), sources[{type:'conversation'|'interview'|'meeting'|'document', chatId?, meetingId?, title, excerpt, date}],
versions[{version, date, author, approvedBy, note, snapshot:{summary,whenToUse,knowledge,decisionLogic,guardrails,escalation}}],
feedback[{user, rating:'up'|'down', comment, date, chatId?}], origin? ('auto-detected')
```
Proposal (revision): `{id, expertiseId, type:'revision', createdAt, author, reason, changes:{<field>:{add:[], remove:[]}}, chatId?, meetingId?, meetingTitle?, sources?[]}`
(`sources` on a proposal are appended to the Expertise when it is approved.)

## Meeting → Expertise (category selector)
The `meetings` Edge Function runs two Claude calls: (1) extraction (summary, takeaways, action items), then
(2) a **category selector** that pairs each reusable takeaway with an Expertise from the catalog the browser sends
(or proposes a new one) and the section it belongs in (knowledge / decisionLogic / guardrails / escalation), with a
confidence score. The user can re-target, edit or untick each link in the Key Insights drawer. On "Approve & Save" the
meeting is stored (with `expertise_links` for audit) and `captureMeetingInsights` in the store creates one revision
proposal per touched Expertise, or an auto-detected draft for new ones. Live Expertise (and its SKILL.md export)
changes only when a Reviewer merges them.

## Chat message shape (see src/store.js sendMessage)
User msg: `{id, role:'user', content, files[], attachedExpertise[ids], webSearch, createdAt}`
Assistant msg: `{id, role:'assistant', createdAt, responses:[{modelId, auto:{category,reason}|null, expertise:[{id,version}], content, streaming, rating}], detection?, detectionState?}`
`responses` has >1 entry when the user compares models side by side.

## Rules for the coding assistant
1. **Do not redesign the UI.** Keep components, styling and the data shapes above. Change the front end only where a prompt says so.
2. Backend: **Python 3.11+, FastAPI, SQLModel/SQLAlchemy on Supabase Postgres (`DATABASE_URL`), LiteLLM for all model calls, LlamaIndex for Expertise retrieval with pgvector.** Do NOT use SQLite.
3. Secrets: `backend/.env` (server) and root `.env` (front end, `VITE_*` only). Never committed. **`SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` and model API keys must NEVER have a `VITE_` prefix or appear in front-end code.** Provide `.env.example` files with empty values.
3b. **Database schema lives only in `supabase/migrations/*.sql`** (applied with `npx supabase db push`). Enable Row Level Security on every table. Use snake_case columns in SQL; the API returns camelCase matching the front-end shapes.
4. **Only `approved` Expertise may ever be injected into a model prompt.** Drafts/in-review never.
5. Every approve / reject / rollback / deprecate / proposal decision writes an **audit log** row.
6. Role checks happen **on the server**: only `reviewer` can approve, reject, roll back, deprecate.
7. Keep a **mock fallback**: front end must still run with `VITE_USE_MOCK=true` (demo safety if APIs fail on stage).
8. Small commits with clear messages after each prompt.
9. **Do not rewrite the Meeting Recorder** (its page, hooks, `meetingsService.js` or the `meetings` Edge Function) unless a prompt says so. It already uses Supabase — integrate with it, don't replace it.
10. **Branches & commits (version history must read cleanly):**
   - Branch names describe the feature: `feature/<thing>`, `fix/<thing>`, `docs/<thing>` (e.g. `feature/multi-model-chat`). Never `prompt-N`.
   - Commit messages use `type(scope): what changed`, lowercase, imperative, ≤ 72 chars, e.g. `feat(chat): stream replies from GPT and Gemini`, `fix(seed): handle existing demo users`, `docs: add architecture diagram`. Types: feat, fix, refactor, docs, test, chore, merge.
   - Add a short body (what + why) for anything non-trivial. Never mention "Prompt N" in commits or PR titles.
   - Open a pull request, merge into `main` when the ✅ check passes.
