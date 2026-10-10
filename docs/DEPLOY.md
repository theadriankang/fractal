# Deploying Fractal (free tier)

| Part | Host | Notes |
|---|---|---|
| Website (React/Vite) | Vercel | `vercel.json` at the repo root; builds `dist/` |
| Backend (FastAPI) | Hugging Face Space (Docker, CPU basic) | `deploy/hf-space/` — the Space pulls `main` from GitHub at build time |
| Database, Auth, Edge Function `meetings` | Supabase | unchanged |

## 1. Backend — Hugging Face Space
1. New Space → SDK **Docker** → hardware **CPU basic** → visibility **Public** (Vercel must reach it; the access code protects it).
2. Add the two files from `deploy/hf-space/` (`Dockerfile`, `README.md`) to the Space.
3. Space → Settings → **Variables and secrets** → add as *Secrets*:
   - `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY` (same values as `backend/.env`)
   - `ACCESS_CODE` — the shared code you give judges
   - `RATE_LIMIT_PER_MINUTE` — e.g. `20`
   - `CORS_ORIGINS` — JSON list, e.g. `["https://fractal-xxxx.vercel.app"]`
4. The backend URL is `https://<hf-username>-<space-name>.hf.space` — check `/api/health`.
5. New backend code: merge to `main`, then Space → Settings → **Factory reboot**.

## 2. Website — Vercel
1. Add New → Project → import the GitHub repo. Framework: Vite (auto).
2. Environment variables:
   - `VITE_API_BASE` = the Space URL from step 1.4 (no trailing slash)
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (same as the root `.env.local`)
3. Deploy. Every push to `main` redeploys automatically.
4. Put the Vercel URL into the Space's `CORS_ORIGINS` and factory-reboot the Space.

## Demo safety
- `ACCESS_CODE` gates every `/api` call except `/api/health` and `/api/access/check`.
- `RATE_LIMIT_PER_MINUTE` limits model-calling endpoints per visitor IP.
- Also set a monthly spend limit in the Anthropic console and OpenRouter.
- On stage, `VITE_USE_MOCK=true` still works as an offline fallback.
