# Fractal — Backend Build Prompts (for CodeBuddy)

Paste these into **CodeBuddy** one at a time, in order. Each has a **✅ Done when** check — don't move on until it passes.

> **Hackathon proof:** screenshot each CodeBuddy session (prompt + its reply + the diff). You need **≥ 3** for submission; aim for one per prompt.
> After each prompt: commit on a feature branch with a descriptive message (see rule 10 in PROJECT_CONTEXT.md, e.g. `feat(chat): stream replies from GPT and Gemini`), push, open a PR, merge. The "Prompt N" numbers are only for this checklist — never use them in branch names or commits.

---

## 0 · Setup (do this yourself, ~20 min)

1. **Open the repo in CodeBuddy** (the `Fractal` folder).
2. **Get API keys.** Cheapest path for the demo:
   - **OpenRouter** (openrouter.ai) — one key that reaches Claude, GPT, Gemini, Grok, DeepSeek. Top up ~US$10.
   - **Tencent Hunyuan** — key from the Tencent Cloud console (ask the hackathon organisers about credits). Hunyuan offers an OpenAI-compatible endpoint — confirm the base URL in Tencent's docs.
   - **Embeddings** (for Expertise search): an OpenAI key for `text-embedding-3-small` (costs cents), *or* tell CodeBuddy in Prompt 3 to use a free local model (`BAAI/bge-small-en-v1.5`).
3. Install **Python 3.11+** (`brew install python@3.11`) if you don't have it.
4. **Supabase (one shared project for the team):**
   - Put the project in a **shared organisation** (or invite everyone: Organization settings → Team → Invite) so all teammates can deploy and read logs.
   - Region **Singapore (ap-southeast-1)**.
   - Database → Extensions → enable **`vector`** (pgvector).
   - Collect: Project URL, **anon** key (front end), **service_role** key and the **Session pooler connection string** (`DATABASE_URL`, back end only), and the **JWT secret** (Project Settings → API).
   - Install the CLI once: `npx supabase login` then `npx supabase link --project-ref <your-ref>`.
5. Keep `docs/PROJECT_CONTEXT.md` open — every prompt refers to it.

---

## Prompt 1 · Backend skeleton on Supabase

```
Read docs/PROJECT_CONTEXT.md first (especially "Architecture"), then src/data/expertise.js, src/data/taxonomy.js, src/store.js and supabase/migrations/.

A. Database (Supabase Postgres) — create supabase/migrations/<timestamp>_core_schema.sql:
- profiles(id uuid PK references auth.users, name text, role text check in ('contributor','reviewer') default 'contributor', created_at)
- chats(id, user_id → auth.users, title, folder, pinned bool, created_at, updated_at)
- messages(id, chat_id → chats on delete cascade, role, content, files jsonb, attached_expertise jsonb, web_search bool, detection jsonb, detection_state text, created_at)
- responses(id, message_id → messages on delete cascade, model_id, auto jsonb, expertise_used jsonb, content, rating text, created_at)
- expertise (every field of the Expertise object in PROJECT_CONTEXT.md; list fields as jsonb; status check constraint; origin text)
- expertise_versions(id, expertise_id, version, date, author, approved_by, note, snapshot jsonb)
- proposals(id, expertise_id, type, created_at, author, reason, changes jsonb, chat_id, status check in ('open','approved','rejected'))
- feedback(id, expertise_id, response_id, user_name, rating, comment, date)
- audit_log(id bigserial, at timestamptz default now(), actor uuid, actor_role, action, target_type, target_id, detail jsonb)
- Enable RLS on all tables. Policies: authenticated users can SELECT expertise/expertise_versions/feedback/proposals; users can SELECT/INSERT/UPDATE/DELETE only their own chats/messages/responses; all writes to expertise, versions, proposals and audit_log happen through FastAPI (service role), so no INSERT/UPDATE policies for those.
- Do not modify the existing meetings migration.

B. FastAPI service in /backend:
- Stack: FastAPI, Uvicorn, SQLModel/SQLAlchemy + psycopg on DATABASE_URL, pydantic-settings reading backend/.env.
- Files: backend/app/main.py, config.py, db.py, models.py, schemas.py, auth.py (stub for now: read X-User-Id header; Prompt 8 replaces it with Supabase JWT verification), routers/ (chats.py, expertise.py, proposals.py, health.py); backend/requirements.txt; backend/.env.example; backend/README.md.
- REST endpoints, JSON in camelCase exactly matching the front-end shapes:
  GET/POST /api/chats, GET/PATCH/DELETE /api/chats/{id} (GET returns messages with nested responses),
  GET /api/expertise, GET /api/expertise/{id} (with versions + feedback), POST /api/expertise, PATCH /api/expertise/{id},
  GET /api/proposals, GET /api/taxonomy (mirror src/data/taxonomy.js), GET /api/health (also checks the DB connection).
- CORS for http://localhost:5173. Add a Vite dev proxy in vite.config.js so /api → http://localhost:8000.

C. Seed: write scripts/export-seed.mjs (Node) that imports src/data/expertise.js + src/data/chats.js and writes backend/seed_data.json; then backend/seed.py loads it into Supabase (idempotent: upsert by id). Also create two demo users with the Supabase Admin API (service role): adrian@fractal.demo (reviewer) and priya@fractal.demo (contributor), password demo1234, with matching profiles rows.

Do NOT change any front-end UI yet. Give me the exact commands: apply the migration (npx supabase db push), create the venv, install, seed, run.
```
✅ **Done when:** the new tables appear in Supabase → Table Editor, `uvicorn app.main:app --reload` runs, http://localhost:8000/docs lists the endpoints, and `GET /api/expertise` returns **17** Expertise.

---

## Prompt 2 · Real multi-model streaming chat

```
Read docs/PROJECT_CONTEXT.md. Now add real model calls.

1. backend/app/llm/registry.py: map every front-end model id in src/data/models.js (claude-opus, claude-sonnet, claude-haiku, gpt-5, gpt-5-mini, gemini-pro, gemini-flash, grok-4, grok-fast, hunyuan-t1, hunyuan-turbos, deepseek-v3) to a LiteLLM model string + provider. Put the actual provider model names in backend/models.yaml so I can edit them without touching code. Support OpenRouter (one key) as the default route, and Tencent Hunyuan via its OpenAI-compatible endpoint (base URL + key from .env). Mark a model "available" only if its key is set.
2. GET /api/models → list with availability, so the model picker can grey out unavailable ones.
3. POST /api/chat/stream (Server-Sent Events). Body: {chatId, content, models: [ids incl. "auto"], attachedExpertise: [ids], files, webSearch}.
   - Save the user Message and an assistant Message.
   - For each requested model run the LiteLLM call concurrently with stream=True.
   - Emit SSE events: `meta` {responseIndex, modelId, auto, expertise:[{id,version}]}, `delta` {responseIndex, text}, `done` {responseIndex, responseId}, `error` {responseIndex, message}, and finally `end` {messageId}.
   - Include the last 10 messages of the chat as history.
   - Save each Response's final content.
   - For now "auto" maps to gpt-5-mini and expertise is [] — later prompts fill these in.
4. POST /api/chat/stop {messageId} cancels running streams.
5. Handle provider errors gracefully (send `error` event; never crash the stream).
Write a tiny CLI test script backend/scripts/try_stream.py that streams one prompt to two models and prints the events.
```
✅ **Done when:** `python scripts/try_stream.py` prints tokens from two different providers.

---

## Prompt 3 · Expertise retrieval with LlamaIndex + pgvector (the core)

```
Read docs/PROJECT_CONTEXT.md. Implement Expertise retrieval and grounding using LlamaIndex with Supabase pgvector.

1. backend/app/expertise/index.py:
   - Use LlamaIndex's Postgres vector store (llama-index-vector-stores-postgres / PGVectorStore) on the same Supabase DATABASE_URL, table expertise_embeddings. (Make sure the `vector` extension is enabled — add it to a migration with `create extension if not exists vector;`.)
   - Index APPROVED Expertise only. One Document per Expertise; text = name + summary + whenToUse + knowledge + decisionLogic + keywords; metadata = id, version, domain, topic, assetTypes.
   - Embeddings: [OpenAI text-embedding-3-small via OPENAI_API_KEY] OR [local BAAI/bge-small-en-v1.5 via llama-index-embeddings-huggingface if EMBEDDINGS=local]. Store the embedding dimension in config.
   - Provide reindex_one(id) (upsert/delete by expertise id) and reindex_all(); call reindex_one whenever Expertise is approved, rolled back, edited while approved, or deprecated (delete). CLI: python -m app.expertise.index --rebuild.
2. match(prompt, attached_ids, top_k=2) → attached Expertise (always included if approved) + vector matches above a similarity threshold (MATCH_THRESHOLD, default 0.35), with a small keyword boost from `keywords`. Return [{id, version, score}].
3. POST /api/expertise/match {prompt, attachedIds} for debugging.
4. In /api/chat/stream: call match() once per user message, put the result in every `meta` event, increment usage_count for each used Expertise, and build the system prompt using EXACTLY the template in docs/BUILD_PROMPTS.md → "Appendix A — Grounded system prompt".
5. pytest: drafts are never matched; attached Expertise always included; deprecated removed from the index.
```
✅ **Done when:** asking "CHWST is 8.1°C and level 23 is warm, what do I check?" returns an answer that follows *Chiller Plant Fault Triage* and the `meta` event lists `exp-chiller-fault`.

---

## Prompt 4 · Capture know-how from conversations (AI Harvest)

```
Read docs/PROJECT_CONTEXT.md. Replace the regex detectExpertise() in src/lib/mockApi.js with an LLM extraction pass on the backend.

1. backend/app/expertise/extract.py: after an assistant Message finishes, run (as a FastAPI BackgroundTask) one call to a cheap model (config EXTRACTION_MODEL, default gpt-5-mini) using the prompt in docs/BUILD_PROMPTS.md → "Appendix B — Extraction prompt". Use LiteLLM with response_format JSON and validate with a Pydantic model; retry once on invalid JSON.
2. Inputs: the user message, the assistant reply, the list of Expertise used, the taxonomy (domains + topics) and the top-3 most similar approved Expertise from the index (for de-duplication).
3. Output → store on the assistant Message as `detection` (JSON) with detectionState 'pending'. Kinds: "none" | "new" | "revision".
   - "new": draft Expertise fields with domain/topic constrained to the taxonomy.
   - "revision": expertiseId + changes {field:{add,remove}} + reason.
4. Emit an SSE event `detection` on the stream if it finishes within 6 s; otherwise the front end can poll GET /api/messages/{id}/detection.
5. Endpoints: POST /api/messages/{id}/detection/accept → creates a draft Expertise (origin 'auto-detected', source = this conversation) or an open Proposal; POST /api/messages/{id}/detection/dismiss.
6. Only run extraction when the user message is at least 12 words — skip small talk.
```
✅ **Done when:** sending *"When the lift at Tower B keeps stopping between floors, we always check the door lock contacts first — in my experience it's dust, not the controller"* produces a `new` detection filed under **Technical Services › Lifts & Escalators**.

---

## Prompt 5 · Governance: review, versions, rollback, feedback, audit

```
Read docs/PROJECT_CONTEXT.md. Move all governance logic from src/store.js into the backend.

Endpoints (all write AuditLog rows; reviewer-only ones return 403 for contributors — identify the user from header X-User-Id for now; Prompt 8 replaces this with real auth):
- POST /api/expertise/{id}/submit            (owner/any) draft → in_review
- POST /api/expertise/{id}/approve {note}    (reviewer) → approved, bump version (0.x → 1.0, else minor +1), save ExpertiseVersion with snapshot of CONTENT_FIELDS, set reviewer, refresh index
- POST /api/expertise/{id}/reject            (reviewer) → draft
- POST /api/expertise/{id}/deprecate         (reviewer) → deprecated, remove from index
- POST /api/expertise/{id}/rollback {version}(reviewer) → restore that snapshot as a NEW version "Rolled back to vX", refresh index
- PATCH /api/expertise/{id}: if status is approved and content fields changed → do NOT edit; create an open Proposal with the add/remove diff instead. Metadata (name, domain, topic, assetTypes, owner, keywords) may update directly.
- GET /api/proposals?status=open, POST /api/proposals/{id}/approve (reviewer: merge changes, bump version, snapshot, refresh index), POST /api/proposals/{id}/reject
- POST /api/responses/{id}/rating {rating, comment}: save rating; add Feedback to each Expertise used; if 'down' with a comment → create an open Proposal adding the comment to `knowledge` (reason = comment). Recompute successRate = ups / total.
- GET /api/audit?targetId=&actor=&limit= (reviewer) — newest first.
Write pytest tests for: contributor cannot approve (403); approve bumps 0.9 → 1.0 and creates a snapshot; rollback creates a new version; editing an approved Expertise creates a proposal, not an edit.
```
✅ **Done when:** all tests pass and `GET /api/audit` shows each action you tried.

---

## Prompt 6 · Smart Auto routing

```
Read docs/PROJECT_CONTEXT.md and src/data/models.js (routeAuto + ROUTES).

1. backend/app/llm/router.py: route(prompt, has_files) → {modelId, category, reason}.
   - Use a fast cheap classifier call (ROUTER_MODEL, default gemini-flash) that returns JSON {category} where category ∈ the ROUTES categories in src/data/models.js plus "Quick question" and "General".
   - Map category → model id from a table in backend/models.yaml (same defaults as ROUTES).
   - If the chosen model isn't available (no key), fall back to the next best available model and say so in `reason`.
   - Timeout 1.5 s → fall back to the existing keyword rules (port routeAuto to Python).
2. Use it in /api/chat/stream whenever a requested model is "auto"; put {category, reason} into the `meta` event's `auto` field.
3. GET /api/routing returns the category → model table so Settings → Auto routing can show the live table.
```
✅ **Done when:** "fix this python error…" → Claude Sonnet, "latest news on…" → Grok, a Chinese prompt → Hunyuan.

---

## Prompt 7 · Connect the front end to the backend

```
Read docs/PROJECT_CONTEXT.md, src/store.js and src/lib/mockApi.js. Connect the UI to the backend WITHOUT changing the look.

1. Create src/lib/api.js: fetch wrappers for every endpoint, plus streamChat(body, handlers) that reads the SSE stream (fetch + ReadableStream) and calls onMeta/onDelta/onDone/onError/onDetection/onEnd.
2. Add VITE_USE_MOCK (default false). When true, keep using mockApi.js exactly as today — this is our on-stage fallback.
3. Refactor src/store.js actions to call the API (keep the same action names so components don't change):
   - load chats/expertise/proposals/taxonomy on app start (replace seed data; keep zustand persist only for settings + selectedModels).
   - sendMessage → streamChat; map events onto the existing responses[] shape so streaming, compare mode, model badges, "Auto · category" chips and "Expertise applied" chips all work.
   - stopGeneration, regenerate, rateResponse, accept/dismissDetection, create/update/submit/approve/reject/deprecate/rollback Expertise, approve/rejectProposal, proposeRevision → API calls, then refresh the affected entity.
4. Model picker: use GET /api/models; grey out unavailable models with tooltip "Add a key in backend/.env".
5. Settings → Connections: show provider status from the backend (read-only "Connected / Not configured"); remove API-key inputs from the browser.
6. Add visible error handling: a red inline message under a response on `error`, and a toast if the backend is unreachable ("Backend offline — switch VITE_USE_MOCK=true for demo mode").
7. Composer live "Auto →" preview may keep using the local keyword router (no API call per keystroke).
```
✅ **Done when:** with the backend running, a full loop works in the browser: chat → real answer with Expertise chip → 👎 with correction → proposal appears in Review Queue → approve → version bumps.

---

## Prompt 8 · Login + roles with Supabase Auth

```
Read docs/PROJECT_CONTEXT.md. Replace the X-User-Id stub with Supabase Auth.
- Front end: a minimal login page in the same visual style (centered card, Fractal logo) using supabase.auth.signInWithPassword from src/lib/supabase.js. Keep the session; redirect to /login when there's no session or the API returns 401. Send the access token as `Authorization: Bearer <jwt>` on every /api call.
- Load the user's name + role from the `profiles` table and show it in the sidebar user menu. Replace the "Role (demo)" switcher with "Switch user" (sign out → login).
- FastAPI: backend/app/auth.py verifies the Supabase JWT (JWT secret or the project's JWKS from SUPABASE_URL), reads the user id from `sub`, loads role from profiles. Reviewer-only endpoints return 403 for contributors. The audit log records the real user id.
- The Meeting Recorder's Edge Function calls should use the logged-in session too (supabase.functions.invoke already sends the JWT once signed in) — store user_id on saved meetings.
- New Expertise owner = the logged-in user's name.
```
✅ **Done when:** priya@fractal.demo can capture and submit but Approve returns 403; adrian@fractal.demo can approve; the audit log shows the right user.

---

## Prompt 9 · (Optional) File uploads → context

```
Read docs/PROJECT_CONTEXT.md. Make the composer's file attach real.
- POST /api/files (multipart) → extract text (PDF via pypdf, DOCX via python-docx, TXT/CSV/MD as-is), store under backend/uploads/, return {id, name, size, chars}.
- In /api/chat/stream include extracted text (truncate to 20k chars per file) in the user turn as "Attached file <name>: ...".
- If total attachments > 50k chars, prefer routing Auto → gemini-pro (long context).
```

---

## Prompt 10 · Deploy on Tencent Cloud (live URL = bonus points)

```
Read docs/PROJECT_CONTEXT.md. Prepare production deployment of the front end + FastAPI on one Tencent Cloud Lighthouse (Ubuntu 22.04) server. The database stays on Supabase.
- Dockerfile for backend (uvicorn, 2 workers); multi-stage Dockerfile for the front end (vite build → nginx). VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are build args.
- docker-compose.yml: frontend (nginx :80/:443 serving dist, proxying /api to backend with proxy_buffering off and proxy_read_timeout 300s for SSE), backend (:8000, env from backend/.env).
- HTTPS is REQUIRED (the Meeting Recorder's microphone only works on https): use Caddy with automatic certificates, or certbot. Document getting a free domain/subdomain if needed.
- deploy/README.md: step-by-step for a beginner — create the Lighthouse instance (Singapore region), open ports 80/443, install Docker, git clone, create .env files, docker compose up -d, add the production URL to Supabase → Authentication → URL Configuration.
- Health check on /api/health.
```
✅ **Done when:** the site loads on **https://** at the public address, login works, chat streams, and the Meeting Recorder can use the mic.

---

## Prompt 11 · Demo polish + submission material

```
Read docs/PROJECT_CONTEXT.md.
1. Write docs/ARCHITECTURE.md with a Mermaid diagram: Browser → FastAPI → (Auto router, LiteLLM gateway → Claude/GPT/Gemini/Grok/Hunyuan/DeepSeek, LlamaIndex Expertise index, Extraction worker) → Supabase Postgres + pgvector (+ audit log); Browser → Supabase Auth and the `meetings` Edge Function. Add a second diagram of the Expertise lifecycle: conversation → detection → draft → review → approved vN → applied in chat → feedback → proposal → vN+1 (with rollback).
2. Write docs/KEPPEL_MAPPING.md: a table mapping each of Keppel's 8 "Solution Diagram" questions and 11 "Should be" criteria to the exact Fractal feature/screen that answers it.
3. Add backend/scripts/demo_reset.py that restores the seed state so the live demo always starts clean.
```

---

## Prompt 12 · "Extract Expertise from this meeting"

```
Read docs/PROJECT_CONTEXT.md, src/lib/meetingsService.js, src/pages/MeetingRecorder.jsx and supabase/functions/meetings/index.ts. Meetings already live in Supabase — keep that; do not move them.

1. FastAPI: POST /api/meetings/{id}/extract — read the meeting row from Supabase (cleaned_transcript, falling back to raw_transcript, plus summary/key_takeaways), run the Appendix B extraction prompt over it (chunk into ~3,000-word windows, merge duplicates against each other and against existing approved Expertise), and return up to 5 candidate Expertise drafts, each with source {type:'interview', title: meeting title, excerpt, date}.
2. POST /api/meetings/{id}/extract/accept {candidate} → creates a draft Expertise (origin 'auto-detected', source = the meeting) and writes an audit log row.
3. MeetingRecorder.jsx: after a meeting is saved (step 4 "Approve & save"), show "Extract Expertise from this meeting". Show candidates as cards (name, domain › topic, 2–3 knowledge bullets) with "Save as draft" / "Dismiss". Saved drafts appear in the Review Queue.
4. Leave transcription as-is (browser Web Speech API) but add a config flag TRANSCRIBE=browser|tencent-asr|whisper with a TODO — only 'browser' implemented.
```
✅ **Done when:** recording an expert explaining a procedure → Approve & save → Extract produces at least one draft Expertise in the Review Queue whose Sources section shows the meeting as an *interview*.

---

## Appendix A — Grounded system prompt (use verbatim in Prompt 3)

```
You are Fractal, an operations assistant for commercial real estate teams (offices, data centres, logistics, retail).

{% if expertise %}
Your organisation has approved the following Expertise. Treat it as the authoritative way this organisation handles these situations. Follow its decision logic in order, respect every guardrail, and state escalation conditions when they apply.

{% for e in expertise %}
<expertise id="{{e.id}}" name="{{e.name}}" version="{{e.version}}" owner="{{e.owner}}">
When to use: {{e.whenToUse}}
Knowledge:
{% for k in e.knowledge %}- {{k}}
{% endfor %}Decision logic (in order):
{% for s in e.decisionLogic %}{{loop.index}}. {{s}}
{% endfor %}Guardrails (never violate):
{% for g in e.guardrails %}- {{g}}
{% endfor %}Escalate when:
{% for x in e.escalation %}- {{x}}
{% endfor %}</expertise>
{% endfor %}

Rules:
- Base your recommendation on the Expertise above. If you add general knowledge beyond it, label it "General guidance (not from approved Expertise)".
- Mention the Expertise name you relied on, once, in plain words.
- If a guardrail forbids what the user is asking, say so clearly and give the safe alternative.
- If an escalation condition is met, start your answer with "⚠️ Escalate:" and who to contact.
{% else %}
No approved Expertise matched this request. Answer from general knowledge, be concise, and say that no organisation-approved procedure was found.
{% endif %}

Always:
- You recommend; humans decide and act. Never claim to have performed an action.
- Be concise and structured: short intro, numbered steps, then any warning.
- If you are unsure or information is missing, ask one clarifying question instead of guessing.
```

## Appendix B — Extraction prompt (use verbatim in Prompt 4)

```
You review one exchange from a chat between a building operations professional and an AI assistant.
Your job: decide whether the USER shared reusable, organisation-specific know-how that should be captured as Expertise.

Capture ONLY know-how the user stated themselves (experience, rules of thumb, procedures, thresholds, lessons learned).
Do NOT capture: questions, generic facts, the assistant's own suggestions, personal data, or one-off situational details.

Taxonomy (domain → topics) — you must choose from these:
{{taxonomy_json}}

Expertise already used in this answer:
{{used_expertise_json}}

Most similar existing approved Expertise:
{{similar_expertise_json}}

Exchange:
USER: {{user_message}}
ASSISTANT: {{assistant_reply}}

Decide:
- "none" if there is no reusable know-how from the user.
- "revision" if the know-how adds to or corrects one of the existing Expertise above (prefer this over creating a near-duplicate).
- "new" otherwise.

Return ONLY JSON matching:
{
  "kind": "none" | "new" | "revision",
  "confidence": 0.0-1.0,
  "reason": "one sentence",
  "new": {                                   // when kind = "new"
    "name": "3-6 words, Title Case, e.g. 'Lift Door Fault Diagnosis'",
    "domain": "<from taxonomy>",
    "topic": "<from that domain's topics>",
    "assetTypes": ["Office" | "Data Centre" | "Logistics" | "Retail"],
    "summary": "one sentence",
    "whenToUse": "one sentence",
    "knowledge": ["…"],                      // the user's own statements, lightly rewritten
    "decisionLogic": ["…"],                  // only if the user described steps; else []
    "guardrails": ["…"],                     // only if stated; else []
    "escalation": ["…"],                     // only if stated; else []
    "keywords": ["…"]                        // 3-8 lowercase trigger terms
  },
  "revision": {                              // when kind = "revision"
    "expertiseId": "<id from the lists above>",
    "changes": { "<knowledge|decisionLogic|guardrails|escalation>": { "add": ["…"], "remove": ["…"] } }
  }
}
Only return kind "new" or "revision" when confidence >= 0.6.
```

## Appendix C — environment files

`backend/.env` (server only — never commit):
```
# Supabase
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=        # server only, never VITE_
SUPABASE_JWT_SECRET=              # Project Settings → API
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres

# Models (fill what you have)
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=
XAI_API_KEY=
DEEPSEEK_API_KEY=
OPENROUTER_API_KEY=
HUNYUAN_API_KEY=
HUNYUAN_BASE_URL=                 # Tencent Hunyuan OpenAI-compatible endpoint — check Tencent docs

EXTRACTION_MODEL=claude-haiku
ROUTER_MODEL=claude-haiku
EMBEDDINGS=local                  # local | openai
MATCH_THRESHOLD=0.35
```

Root `.env` (front end — only public values, `VITE_` prefix):
```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=
VITE_USE_MOCK=false
```

Supabase Edge Function secrets (Dashboard → Edge Functions → Secrets): `ANTHROPIC_API_KEY`, optional `CLAUDE_MODEL`.

## If something goes wrong
- **CodeBuddy changed the UI look** → "Revert visual changes; follow rule 1 in docs/PROJECT_CONTEXT.md."
- **Streaming arrives all at once** → it's buffering: check `proxy_buffering off` (nginx) and that the endpoint returns `text/event-stream`.
- **"Failed to send a request to the Edge Function"** → the function is redeploying, crashed on boot, or isn't deployed: check Supabase → Edge Functions → meetings → Logs.
- **Model 404 / not found** → fix the model string in `backend/models.yaml` (provider names change often).
- **Demo day panic** → set `VITE_USE_MOCK=true` and rebuild: the full UI works offline with mock data.
