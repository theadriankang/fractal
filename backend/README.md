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

### `POST /api/chat/stream`

Body:

```json
{
  "model": "claude-sonnet",
  "messages": [{"role": "user", "content": "CHWST is 8.1 °C, what do I check?"}],
  "expertise": [{"id": "exp-chiller-fault", "name": "...", "version": "1.3", "status": "approved", "...": "..."}]
}
```

Events, in order: `meta {expertise: [{id, version}]}` (the Expertise actually applied), then
`delta {text}` repeatedly, then `done {stopReason, model}` or `error {message}`.

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
- Attached files are not sent to Claude yet; web search is not implemented.
- GPT, Gemini, Grok, Hunyuan and DeepSeek are still mocked.
