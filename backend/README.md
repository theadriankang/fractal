# Fractal Backend (FastAPI)

AI service for the Fractal platform. Talks to Supabase Postgres via `DATABASE_URL`
and answers chat for the three Claude models (`claude-opus`, `claude-sonnet`,
`claude-haiku`). Every other model, and the whole UI when `VITE_USE_MOCK=true`,
still uses the front-end mock in `src/lib/mockApi.js`.

## Setup

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env   # fill in DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY
```

## Run (dev)

```bash
.venv/bin/uvicorn app.main:app --reload --port 8000
```

The API is served at `http://localhost:8000/api/*`. Vite proxies `/api` to port 8000.
Restart uvicorn after editing `.env`; `--reload` only watches Python files.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/health` | `{status, database, claude}` — DB connectivity + whether Claude is configured |
| GET    | `/api/models` | Models this backend serves, with availability |
| POST   | `/api/chat/stream` | Streams one model's answer as Server-Sent Events |
| POST   | `/api/files` | Stores one chat attachment (multipart `file`) and returns its id |
| GET    | `/api/taxonomy` | Domain → topics taxonomy (mirrors `src/data/taxonomy.js`) |
| GET    | `/api/expertise` | List all expertise |
| GET    | `/api/expertise/{id}` | Single expertise with versions + feedback |
| POST   | `/api/expertise` | Create expertise |
| PATCH  | `/api/expertise/{id}` | Update expertise |
| GET    | `/api/proposals` | List proposals |
| GET    | `/api/chats` | List chats for the current user (with messages + responses) |
| POST   | `/api/chats` | Create a chat |
| GET    | `/api/chats/{id}` | Get a single chat |
| PATCH  | `/api/chats/{id}` | Update chat title / folder / pinned |
| DELETE | `/api/chats/{id}` | Delete a chat |
| POST   | `/api/expertise/extract` | Know-how capture: did the user share reusable know-how in this exchange? (contributors only) |

### `POST /api/chat/stream`

Body:

```json
{
  "model": "claude-sonnet",
  "messages": [{"role": "user", "content": "CHWST is 8.1 °C, what do I check?", "files": ["<id from /api/files>"]}],
  "expertise": [{"id": "exp-chiller-fault", "name": "...", "version": "1.3", "status": "approved", "...": "..."}]
}
```

Events, in order: `meta {expertise: [{id, version}]}` (the Expertise actually applied), then
`delta {text}` repeatedly, then `done {stopReason, model}` or `error {message}`.

### Attachments (`POST /api/files`)

The composer uploads each file as soon as it is picked; messages keep only the returned
`{id, name, size, kind}`. Accepted: PDF, DOCX, TXT, MD, CSV, PNG, JPG; up to 10 MB each and
5 per message. Files are stored under `backend/uploads/<id>/` (git-ignored) with their
extracted text, and re-read on every chat turn, so follow-up questions still see them.

- **Claude** gets PDFs and images natively (it reads scanned pages and figures), and
  DOCX/text files as text documents (first 100,000 characters). The conversation prefix is
  prompt-cached, so files resent on later turns bill at cache-read rates.
- **Other models** get the extracted text (first 20,000 characters per file) as
  `<attached_file name="...">` blocks; images are noted but not shown to them yet.
- Truncation is stated in the text the model receives. Unknown or deleted file ids become a
  "no longer available" note instead of an error.

## Know-how capture (`POST /api/expertise/extract`)

After a chat answer finishes, the front end sends the last few turns, the taxonomy and up to 5
similar approved Expertise. One Claude call (`EXTRACTION_MODEL`, default `claude-haiku-5-5`)
proposes `none | new | revision` with an evidence quote per line; `app/capture/extract.py`
then validates everything in plain Python:

- domain/topic must exist in the taxonomy; a revision must name a real candidate Expertise
- every line's quote must actually come from the **user's** words (not the assistant's) — otherwise it is dropped
- lines already in the target Expertise are dropped; confidence < `EXTRACTION_THRESHOLD` (0.6) → `none`
- **domain scope:** reviewers get 403; for contributors the result carries `allowed` — true only if the
  target domain is one of the user's expert domains (`profiles.domains`, migration `20261010140000_profiles_expert_domains.sql`)

Until Supabase Auth lands the user (`name, role, domains`) is sent in the request body; once JWT auth
exists it must come from the verified profile instead.

```bash
.venv/bin/pip install pytest
.venv/bin/python -m pytest -q tests                # offline: validation + access rules (Claude stubbed)
.venv/bin/python -m scripts.eval_capture           # live: 20 realistic messages, prints a score (needs ANTHROPIC_API_KEY)
```

## Auth (stub)

All chats/expertise endpoints read the `X-User-Id` header (a Supabase user UUID) and look up
the matching `profiles` row. Prompt 8 replaces this with full Supabase JWT verification.

## How answers are built

- **Model ids.** `app/llm/claude.py` maps the front-end ids to `claude-opus-5-5`, `claude-sonnet-5-5`
  and `claude-haiku-5-5`, called through the official Anthropic SDK with streaming.
- **Grounding.** The system prompt is Appendix A of `docs/BUILD_PROMPTS.md` (`app/prompts.py`).
  Only Expertise with `status: "approved"` is injected; anything else in the request is ignored.
- **Effort.** `CLAUDE_EFFORT` (default `medium`) sets how hard Claude thinks before answering.
- **Refusals.** Opus and Sonnet requests opt into server-side fallbacks
  (`fallbacks: "default"`), so a safety-classifier decline is retried on a fallback model
  automatically. If the whole chain declines, the UI shows an error.

## Seed

```bash
# From the repo root — generate seed_data.json from the front-end mock data
node scripts/export-seed.mjs

# From backend/ — load it into Supabase + create demo users
python seed.py
```

Demo users:
- `adrian@fractal.demo` (reviewer) — password `demo1234`
- `priya@fractal.demo` (contributor) — password `demo1234`

## Current limitations

- Expertise matching is still the front end's keyword match. Prompt 3 replaces it.
- Attachments live on the backend's local disk (`backend/uploads/`), not Supabase Storage, and
  are never deleted. Non-Claude models can't see images yet. Web search is not implemented.
- GPT, Gemini, Grok, Hunyuan and DeepSeek are still mocked.
