# Fractal — Architecture

## System architecture & trust boundaries

```mermaid
flowchart TB
    subgraph client["🔓 Untrusted — Browser (React + Vite)"]
        UI["Fractal UI<br/>chat · Expertise catalog · Review Queue · Meeting Recorder"]
    end

    subgraph vercel["Vercel"]
        Static["Static build (dist/)<br/>no secrets — VITE_* public values only"]
    end

    subgraph supabase["🔒 Supabase (ap-southeast-1)"]
        Auth["Supabase Auth<br/>issues JWT"]
        PG[("Postgres + pgvector<br/>chats · expertise · proposals ·<br/>audit_log · expertise_embeddings")]
        EdgeFn["Edge Function: meetings<br/>(Claude insights + save)"]
        RLS{{"Row Level Security<br/>gates direct browser reads"}}
    end

    subgraph cloudrun["🔒 Trusted — Google Cloud Run (asia-southeast1)"]
        API["FastAPI backend<br/>holds: SUPABASE_SERVICE_ROLE_KEY,<br/>ANTHROPIC_API_KEY, OPENROUTER_API_KEY"]
        Router["Auto router<br/>(Claude Haiku classify → model)"]
        Retrieval["Expertise retrieval<br/>(pgvector hybrid search)"]
        Extract["Capture / extraction<br/>(know-how → draft Expertise)"]
        Gov["Governance<br/>(approve/reject/rollback/audit)"]
        API --> Router & Retrieval & Extract & Gov
    end

    subgraph providers["🔓 External model providers"]
        Claude["Anthropic Claude"]
        OR["OpenRouter<br/>(GPT · Gemini · Grok · Hunyuan · DeepSeek)"]
    end

    UI -->|"static assets"| Static
    UI -->|"sign in"| Auth
    UI -->|"SELECT only, RLS-gated<br/>(read own chats, approved Expertise)"| RLS --> PG
    UI -->|"Meeting Recorder save + insights"| EdgeFn --> PG
    UI -->|"/api/* over HTTPS<br/>+ access code + rate limit"| API

    API -->|"service-role writes<br/>(governed tables only)"| PG
    Router --> Claude
    Retrieval -->|"local fastembed, no network call"| Retrieval
    API --> Claude & OR
    EdgeFn --> Claude

    classDef untrusted fill:#fee2e2,stroke:#dc2626
    classDef trusted fill:#dcfce7,stroke:#16a34a
    classDef store fill:#dbeafe,stroke:#2563eb
    class client untrusted
    class cloudrun trusted
    class supabase store
```

**Trust boundaries**
- The browser never holds a provider API key, a Supabase service-role key, or `DATABASE_URL` — only the public `VITE_SUPABASE_ANON_KEY` and the Cloud Run URL.
- Direct browser → Supabase reads are gated by **Row Level Security**: a user can only read their own chats, and only `approved` Expertise (drafts/in-review are invisible outside the backend).
- All writes to `expertise`, `expertise_versions`, `proposals` and `audit_log` go **only** through FastAPI using the service-role key — the browser has no write path to governed data, so "approve" or "rollback" cannot be forged client-side.
- The public demo endpoint is additionally gated by an `ACCESS_CODE` header and a per-IP rate limit (`backend/app/guard.py`), since Cloud Run allows unauthenticated traffic.

**Key design trade-offs**
- **Local embeddings (fastembed) over an API embedding model** — keeps Expertise retrieval working with zero marginal cost and no outbound dependency for the core "AI Harvest" loop, at the cost of lower embedding quality than e.g. `text-embedding-3-small`; the hybrid score adds a keyword boost to compensate.
- **Server-side Smart Auto routing with a client-side keyword fallback** — the router tries a cheap Claude Haiku classification call (better judgment of task type) but falls back to the original regex router within 2.5s so "Auto" never blocks sending a message if a provider is slow or unconfigured.
- **Governance lives entirely in the backend, not the store** — `src/store.js` used to own approve/reject/rollback logic; it's now a thin API client, so the same rules (four-eyes, reviewer-only actions, version bump, audit row) can't be bypassed by editing the front end.
- **Supabase as the single source of truth** — one Postgres instance serves pgvector search, relational data and Auth, trading some flexibility (vs. a dedicated vector DB) for a much simpler ops story inside a hackathon timeline.

## Expertise lifecycle

```mermaid
flowchart LR
    Conv["Conversation<br/>(chat or meeting)"] -->|"≥12 words,<br/>contributor only"| Detect["AI detection<br/>(backend/app/capture/extract.py)"]
    Detect -->|"kind=new,<br/>confidence ≥ 0.6"| Draft["Draft Expertise<br/>(origin: auto-detected)"]
    Detect -->|"kind=revision"| Proposal["Open Proposal<br/>(add/remove diff)"]
    Draft -->|"Submit for review<br/>(readiness checks pass)"| Review["In review"]
    Review -->|"Reviewer or domain expert<br/>(never the author — four eyes)"| Approved["Approved vN<br/>+ snapshot + audit row"]
    Proposal -->|"Reviewer approves"| Approved
    Approved -->|"indexed into pgvector"| Applied["Applied in chat<br/>(grounds the system prompt,<br/>shown as an 'Expertise applied' chip)"]
    Applied -->|"👍 / 👎 + comment"| Feedback["Feedback<br/>(success rate recomputed)"]
    Feedback -->|"👎 with comment"| Proposal
    Approved -->|"Reviewer: rollback"| Approved
    Approved -->|"Reviewer: deprecate"| Deprecated["Deprecated<br/>(removed from index)"]
```

Every transition above (`submit`, `approve`, `reject`, `rollback`, `deprecate`, proposal `approve`/`reject`) writes a row to `audit_log` (`backend/app/governance.py::audit`), giving a complete, queryable history of who changed what Expertise and when (`GET /api/audit`).
