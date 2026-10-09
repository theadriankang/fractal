# Fractal Backend (FastAPI)

AI service for the Fractal platform. Talks to Supabase Postgres via `DATABASE_URL`.

## Setup

```bash
cd backend
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
```

## Run (dev)

```bash
uvicorn app.main:app --reload --port 8000
```

The API is served at `http://localhost:8000/api/*`.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/health` | Health check + DB connectivity |
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

## Auth (stub)

All endpoints read the `X-User-Id` header (a Supabase user UUID) and look up
the matching `profiles` row. Prompt 8 replaces this with full Supabase JWT
verification.

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
