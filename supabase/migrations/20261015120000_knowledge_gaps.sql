-- Knowledge gaps (backend/app/gaps.py): chat questions that no approved Expertise answered
-- (no match, or only a weak one). Similar questions merge into one row, so the Review Queue can
-- show the most-asked gaps first. Additive only: one new table, nothing existing changes.

create table if not exists public.knowledge_gaps (
    id                     text primary key,
    question               text not null,
    domain                 text,
    kind                   text not null default 'none',       -- none | weak
    best_score             real not null default 0,
    nearest_expertise_id   text,
    nearest_expertise_name text,
    status                 text not null default 'open',       -- open | drafting | resolved | dismissed
    ask_count              integer not null default 1,
    askers                 jsonb not null default '[]'::jsonb, -- [{id, name}]
    examples               jsonb not null default '[]'::jsonb, -- [{question, asker, chatId, at}]
    embedding              jsonb,                              -- question embedding, for merging
    expertise_id           text references public.expertise(id) on delete set null,
    resolved_by            text,
    resolution             text,
    created_at             timestamptz not null default now(),
    last_asked_at          timestamptz not null default now()
);

create index if not exists knowledge_gaps_status_idx on public.knowledge_gaps (status, last_asked_at desc);
create index if not exists knowledge_gaps_expertise_idx on public.knowledge_gaps (expertise_id);

-- Service role only (all reads and writes go through FastAPI), like the other tables.
alter table public.knowledge_gaps enable row level security;
