# Fractal — Backend Build Prompts (for CodeBuddy)

Paste these into **CodeBuddy** one at a time, in order. Each has a **✅ Done when** check — don't move on until it passes.

> **Hackathon proof:** screenshot each CodeBuddy session (prompt + its reply + the diff). You need **≥ 3** for submission; aim for one per prompt.
> Commit after every prompt: `git add -A && git commit -m "<what changed>" && git push`.

---

## 0 · Setup (do this yourself, ~20 min)

1. **Open the repo in CodeBuddy** (the `Fractal` folder).
2. **Get API keys.** Cheapest path for the demo:
   - **OpenRouter** (openrouter.ai) — one key that reaches Claude, GPT, Gemini, Grok, DeepSeek. Top up ~US$10.
   - **Tencent Hunyuan** — key from the Tencent Cloud console (ask the hackathon organisers about credits). Hunyuan offers an OpenAI-compatible endpoint — confirm the base URL in Tencent's docs.
   - **Embeddings** (for Expertise search): an OpenAI key for `text-embedding-3-small` (costs cents), *or* tell CodeBuddy in Prompt 3 to use a free local model (`BAAI/bge-small-en-v1.5`).
3. Install **Python 3.11+** (`brew install python@3.11`) if you don't have it.
4. Keep `docs/PROJECT_CONTEXT.md` open — every prompt refers to it.

---

## Prompt 1 · Backend skeleton + database

```
Read docs/PROJECT_CONTEXT.md first, then src/data/expertise.js, src/data/taxonomy.js and src/store.js.

Create a Python FastAPI backend in /backend:
- Stack: FastAPI, Uvicorn, SQLModel on SQLite (backend/fractal.db), pydantic-settings for config from backend/.env.
- Files: backend/app/main.py, config.py, db.py, models.py, schemas.py, routers/ (chats.py, expertise.py, proposals.py, health.py), seed.py; backend/requirements.txt; backend/.env.example; backend/README.md.
- Tables (SQLModel): User(id, name, role: contributor|reviewer), Chat(id, title, folder, pinned, created_at, updated_at),
  Message(id, chat_id, role, content, files JSON, attached_expertise JSON, web_search, created_at),
  Response(id, message_id, model_id, auto JSON, expertise_used JSON [{id,version}], content, rating, created_at),
  Expertise (all fields from the Expertise object in PROJECT_CONTEXT.md; list fields as JSON columns),
  ExpertiseVersion(id, expertise_id, version, date, author, approved_by, note, snapshot JSON),
  Proposal(id, expertise_id, type, created_at, author, reason, changes JSON, chat_id, status: open|approved|rejected),
  Feedback(id, expertise_id, response_id, user, rating, comment, date),
  AuditLog(id, at, actor, actor_role, action, target_type, target_id, detail JSON).
- seed.py: export the seed data from src/data/expertise.js and src/data/chats.js into backend/seed_data.json (write a small Node script scripts/export-seed.mjs that imports those modules and writes JSON), then load it into SQLite. Seed two users: "Adrian Kang" (reviewer) and "Priya S" (contributor).
- REST endpoints (JSON, camelCase field names exactly matching the front-end shapes):
  GET/POST /api/chats, GET/PATCH/DELETE /api/chats/{id} (GET returns messages with nested responses),
  GET /api/expertise, GET /api/expertise/{id} (includes versions + feedback), POST /api/expertise, PATCH /api/expertise/{id},
  GET /api/proposals, GET /api/taxonomy (mirror src/data/taxonomy.js), GET /api/health.
- CORS for http://localhost:5173. Add a Vite dev proxy in vite.config.js so /api → http://localhost:8000.
- Do NOT change any front-end UI yet.
Give me the exact commands to create a venv, install, seed and run.
```
✅ **Done when:** `uvicorn app.main:app --reload` runs, and http://localhost:8000/docs lists the endpoints; `GET /api/expertise` returns 17 Expertise.

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

## Prompt 3 · Expertise retrieval with LlamaIndex (the core)

```
Read docs/PROJECT_CONTEXT.md. Implement Expertise retrieval and grounding using LlamaIndex.

1. backend/app/expertise/index.py:
   - Build a LlamaIndex VectorStoreIndex over APPROVED Expertise only. One Document per Expertise; text = name + summary + whenToUse + knowledge + decisionLogic + keywords; metadata = id, version, domain, topic, assetTypes.
   - Embeddings: [OpenAI text-embedding-3-small via OPENAI_API_KEY] OR [local BAAI/bge-small-en-v1.5 via llama-index-embeddings-huggingface if EMBEDDINGS=local].
   - Persist the index to backend/storage/; rebuild on startup if missing, and refresh a single document whenever Expertise is approved, rolled back, edited (when approved), or deprecated (remove it).
2. match(prompt, attached_ids, top_k=2) → returns attached Expertise (always included if approved) + vector matches above a similarity threshold (start at 0.35, configurable), combined with a keyword boost from the `keywords` field. Return [{id, version, score}].
3. POST /api/expertise/match {prompt, attachedIds} for debugging.
4. In /api/chat/stream: call match() once per user message, put the result in every `meta` event, increment usageCount for each used Expertise, and build the system prompt using EXACTLY the template in docs/BUILD_PROMPTS.md → "Appendix A — Grounded system prompt".
5. Unit tests (pytest) for: drafts are never matched; attached Expertise is always included; deprecated is removed from the index.
```
✅ **Done when:** asking "CHWST is 8.1°C and level 23 is warm, what do I check?" returns an answer that follows *Chiller Plant Fault Triage* steps and the `meta` event lists `exp-chiller-fault`.

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

## Prompt 8 · Login + roles

```
Read docs/PROJECT_CONTEXT.md. Add simple authentication.
- Backend: POST /api/auth/login {email, password} → JWT (HS256, secret in .env, 12 h expiry); GET /api/auth/me. Seed users: adrian@fractal.demo (reviewer), priya@fractal.demo (contributor), password "demo1234" for both. Replace X-User-Id with the JWT on every endpoint; keep role checks server-side.
- Front end: a minimal login page in the same visual style (centered card, Fractal logo); store the token; redirect to /login when 401. Replace the "Role (demo)" switcher in the user menu with "Switch user" (logs out → login), and show the real role under the name.
- Expertise owner on new drafts = the logged-in user.
```
✅ **Done when:** Priya can capture and submit but the Approve button returns 403; Adrian can approve.

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
Read docs/PROJECT_CONTEXT.md. Prepare production deployment for a single Tencent Cloud Lighthouse (Ubuntu 22.04) server.
- Dockerfile for backend (uvicorn, 2 workers), multi-stage Dockerfile for the front end (vite build → nginx).
- docker-compose.yml: frontend (nginx :80 serving dist, proxying /api to backend with SSE buffering OFF: proxy_buffering off; proxy_read_timeout 300s), backend (:8000, volume for fractal.db + storage/ + uploads/).
- deploy/README.md: step-by-step for a beginner — create Lighthouse instance, open port 80/443 in the firewall, install Docker, git clone, copy .env, docker compose up -d, optional free HTTPS with Caddy or certbot.
- A /api/health check used by docker compose.
```
✅ **Done when:** the site loads on the server's public IP and streaming works.

---

## Prompt 11 · Demo polish + submission material

```
Read docs/PROJECT_CONTEXT.md.
1. Write docs/ARCHITECTURE.md with a Mermaid diagram: Browser → FastAPI → (Auto router, LiteLLM gateway → Claude/GPT/Gemini/Grok/Hunyuan/DeepSeek, LlamaIndex Expertise index, Extraction worker) → SQLite (+ audit log). Add a second diagram of the Expertise lifecycle: conversation → detection → draft → review → approved vN → applied in chat → feedback → proposal → vN+1 (with rollback).
2. Write docs/KEPPEL_MAPPING.md: a table mapping each of Keppel's 8 "Solution Diagram" questions and 11 "Should be" criteria to the exact Fractal feature/screen that answers it.
3. Add backend/scripts/demo_reset.py that restores the seed state so the live demo always starts clean.
```

---

## Prompt 12 · Meetings → backend + "Extract Expertise from this meeting"

```
Read docs/PROJECT_CONTEXT.md, src/lib/meetingsService.js, src/hooks/useMeetingRecorder.js and src/pages/MeetingRecorder.jsx.

1. Move meetings into the FastAPI backend: table Meeting(id, user_id, title, transcript_text, duration, created_at, updated_at) and endpoints GET/POST /api/meetings, PATCH/DELETE /api/meetings/{id} (owner-only, role-checked like everything else). Rewrite src/lib/meetingsService.js to call these endpoints with the SAME function names and return shapes (createMeeting, updateMeeting, listMeetings, deleteMeeting) so the UI does not change. Keep the localStorage fallback when VITE_USE_MOCK=true. Then remove @supabase/supabase-js, src/lib/supabase.js and supabase/ (and the "Saved to Supabase" label → "Saved").
2. Add POST /api/meetings/{id}/extract: run the Appendix B extraction prompt over the transcript (chunk into ~3,000-word windows, merge duplicates) and return up to 5 candidate Expertise drafts, each with source {type:'interview', title: meeting title, excerpt, date}.
3. In MeetingRecorder.jsx, when status is 'done' show a button "Extract Expertise from this meeting" above the chat. Show the candidates as cards (name, domain › topic, 2-3 knowledge bullets) each with "Save as draft" / "Dismiss". Saved drafts go to the Review Queue with origin 'auto-detected' and the meeting as the source.
4. Swap the browser speech API for server-side transcription later: leave a TODO and a config flag TRANSCRIBE=browser|tencent-asr|whisper; implement only 'browser' now.
```
✅ **Done when:** recording an expert explaining a procedure produces at least one draft Expertise in the Review Queue whose Sources section shows the meeting as an *interview*.

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

## Appendix C — `.env.example` (backend)

```
OPENROUTER_API_KEY=
HUNYUAN_API_KEY=
HUNYUAN_BASE_URL=            # Tencent Hunyuan OpenAI-compatible endpoint — check Tencent docs
OPENAI_API_KEY=              # embeddings (or set EMBEDDINGS=local)
EMBEDDINGS=openai            # openai | local
EXTRACTION_MODEL=gpt-5-mini
ROUTER_MODEL=gemini-flash
MATCH_THRESHOLD=0.35
JWT_SECRET=change-me
```

## If something goes wrong
- **CodeBuddy changed the UI look** → "Revert visual changes; follow rule 1 in docs/PROJECT_CONTEXT.md."
- **Streaming arrives all at once** → it's buffering: check `proxy_buffering off` (nginx) and that the endpoint returns `text/event-stream`.
- **Model 404 / not found** → fix the model string in `backend/models.yaml` (provider names change often).
- **Demo day panic** → set `VITE_USE_MOCK=true` and rebuild: the full UI works offline with mock data.
