# Deploying Fractal (free tier)

| Part | Host | Notes |
|---|---|---|
| Website (React/Vite) | Vercel | `vercel.json` at the repo root; builds `dist/` |
| Backend (FastAPI) | Google Cloud Run | `backend/Dockerfile`; redeploys on every push to `main` |
| Database, Auth, Edge Function `meetings` | Supabase | unchanged |

## 1. Backend — Google Cloud Run
1. Google Cloud project with billing enabled (the free tier covers demo traffic).
2. Cloud Run → **Deploy container** → **Service** → "Continuously deploy from a repository" → connect GitHub repo `theadriankang/fractal`, branch `^main$`, build type **Dockerfile**, source location `/backend/Dockerfile`.
3. Region `asia-southeast1` (Singapore, next to Supabase). Authentication: **Allow unauthenticated** (the access code protects it). Memory **1 GiB**, CPU 1, minimum instances 0, maximum 3, request timeout 300 s.
4. Variables & Secrets → add:
   - `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY` (same values as `backend/.env`)
   - `ACCESS_CODE` — the shared code you give judges
   - `RATE_LIMIT_PER_MINUTE` — e.g. `20`
   - `CORS_ORIGINS` — JSON list, e.g. `["https://fractal-xxxx.vercel.app"]`
5. The service URL looks like `https://fractal-backend-xxxx.asia-southeast1.run.app` — check `/api/health`.
6. Every push to `main` rebuilds and redeploys automatically (Cloud Build trigger). Older revisions stay available for rollback.

## 2. Website — Vercel
1. Add New → Project → import the GitHub repo. Framework: Vite (auto).
2. Environment variables:
   - `VITE_API_BASE` = the Cloud Run URL from step 1.5 (no trailing slash)
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (same as the root `.env.local`)
3. Deploy. Every push to `main` redeploys automatically.
4. Put the Vercel URL into the Cloud Run service's `CORS_ORIGINS` (Edit & deploy new revision).

## Demo safety
- `ACCESS_CODE` gates every `/api` call except `/api/health` and `/api/access/check`.
- `RATE_LIMIT_PER_MINUTE` limits model-calling endpoints per visitor IP.
- Also set a monthly spend limit in the Anthropic console and OpenRouter.
- On stage, `VITE_USE_MOCK=true` still works as an offline fallback.
