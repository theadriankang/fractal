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
                      Meetings persistence: Supabase if VITE_SUPABASE_* set, else localStorage (temporary — see Prompt 12)
  supabase/migrations/  SQL for the meetings table (Supabase, temporary)
/backend              Python FastAPI service (TO BUILD)
/docs                 This file + build prompts
```

## Expertise object (source of truth: src/data/expertise.js)
```
id, name, domain, topic, assetTypes[], status ('draft'|'in_review'|'approved'|'deprecated'), version ('1.3'),
owner, ownerRole, reviewer, keywords[], usageCount, successRate (0–1|null), createdAt, updatedAt,
summary, whenToUse, knowledge[], decisionLogic[], guardrails[], escalation[],
related[] (expertise ids), sources[{type:'conversation'|'interview'|'document', chatId?, title, excerpt, date}],
versions[{version, date, author, approvedBy, note, snapshot:{summary,whenToUse,knowledge,decisionLogic,guardrails,escalation}}],
feedback[{user, rating:'up'|'down', comment, date, chatId?}], origin? ('auto-detected')
```
Proposal (revision): `{id, expertiseId, type:'revision', createdAt, author, reason, changes:{<field>:{add:[], remove:[]}}, chatId?}`

## Chat message shape (see src/store.js sendMessage)
User msg: `{id, role:'user', content, files[], attachedExpertise[ids], webSearch, createdAt}`
Assistant msg: `{id, role:'assistant', createdAt, responses:[{modelId, auto:{category,reason}|null, expertise:[{id,version}], content, streaming, rating}], detection?, detectionState?}`
`responses` has >1 entry when the user compares models side by side.

## Rules for the coding assistant
1. **Do not redesign the UI.** Keep components, styling and the data shapes above. Change the front end only where a prompt says so.
2. Backend: **Python 3.11+, FastAPI, SQLModel (SQLite file `backend/fractal.db`), LiteLLM for all model calls, LlamaIndex for Expertise retrieval.**
3. All secrets in `backend/.env` (never committed). Provide `backend/.env.example`.
4. **Only `approved` Expertise may ever be injected into a model prompt.** Drafts/in-review never.
5. Every approve / reject / rollback / deprecate / proposal decision writes an **audit log** row.
6. Role checks happen **on the server**: only `reviewer` can approve, reject, roll back, deprecate.
7. Keep a **mock fallback**: front end must still run with `VITE_USE_MOCK=true` (demo safety if APIs fail on stage).
8. Small commits with clear messages after each prompt.
9. **Do not touch the Meeting Recorder or Supabase files** until Prompt 12. The main backend is FastAPI + SQLite; meetings move into it in Prompt 12.
10. Work on a branch per prompt (e.g. `backend/prompt-1`), open a pull request, merge into `main` when the ✅ check passes.
