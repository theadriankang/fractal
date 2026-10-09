# Fractal backend

FastAPI service the chat UI talks to. So far it answers for the three Claude models
(`claude-opus`, `claude-sonnet`, `claude-haiku`). Every other model, and the whole UI when
`VITE_USE_MOCK=true`, still uses the front-end mock in `src/lib/mockApi.js`.

## Run it

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env          # then put your key in ANTHROPIC_API_KEY
.venv/bin/uvicorn app.main:app --reload --port 8000
```

Then run the front end as usual (`npm run dev` in the repo root). Vite proxies `/api` to port 8000.
Restart uvicorn after editing `.env`; `--reload` only watches Python files.

## Endpoints

| Method | Path | What it does |
|---|---|---|
| GET | `/api/health` | `{ok, claude}`; `claude` is true when a key is configured |
| GET | `/api/models` | Models this backend serves, with availability |
| POST | `/api/chat/stream` | Streams one model's answer as Server-Sent Events |

`POST /api/chat/stream` body:

```json
{
  "model": "claude-sonnet",
  "messages": [{"role": "user", "content": "CHWST is 8.1 °C, what do I check?"}],
  "expertise": [{"id": "exp-chiller-fault", "name": "...", "version": "1.3", "status": "approved", "...": "..."}]
}
```

Events, in order: `meta {expertise: [{id, version}]}` (the Expertise actually applied), then
`delta {text}` repeatedly, then `done {stopReason, model}` or `error {message}`.

## How answers are built

- **Model ids.** `app/llm/claude.py` maps the front-end ids to `claude-opus-5-5`, `claude-sonnet-5-5`
  and `claude-haiku-5-5`, called through the official Anthropic SDK with streaming.
- **Grounding.** The system prompt is Appendix A of `docs/BUILD_PROMPTS.md` (`app/prompts.py`).
  Only Expertise with `status: "approved"` is injected; anything else in the request is ignored.
- **Effort.** `CLAUDE_EFFORT` (default `medium`) sets how hard Claude thinks before answering.
- **Refusals.** Opus and Sonnet requests opt into server-side fallbacks
  (`fallbacks: "default"`), so a safety-classifier decline is retried on a fallback model
  automatically. If the whole chain declines, the UI shows an error.

## Not done yet

- The backend is stateless: the browser sends the conversation history (last 20 turns) and the
  matched Expertise with each request. Chats and Expertise still live in browser storage.
  Prompt 1 in `docs/BUILD_PROMPTS.md` (database) moves them server-side.
- Expertise matching is still the front end's keyword match. Prompt 3 replaces it.
- Attached files are not sent to Claude yet; web search is not implemented.
- GPT, Gemini, Grok, Hunyuan and DeepSeek are still mocked.
