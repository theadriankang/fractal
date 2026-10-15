-- Knowledge-gap tracking: what a real question needed that no approved Expertise covers.
-- Rows are written by the weighing engine (app/weigh/engine.py via app/knowledge_gaps.py)
-- whenever it names a gap while weighing a question against the Expertise it found.
-- Repeats of the same gap text bump `hits` instead of creating a new row, so a knowledge
-- gap that keeps coming up stands out from one asked once and never again. Writes go
-- through the FastAPI service role only (same pattern as data_reports).
create table if not exists public.knowledge_gaps (
  id                     text primary key,
  text                   text not null default '',
  normalized             text not null default '',
  domains                jsonb not null default '[]'::jsonb,
  question               text not null default '',
  status                 text not null default 'open',
  hits                   integer not null default 1,
  first_seen             timestamptz not null default now(),
  last_seen              timestamptz not null default now(),
  resolved_expertise_id  text
);

create unique index if not exists knowledge_gaps_normalized_idx on public.knowledge_gaps (normalized);
create index if not exists knowledge_gaps_status_hits_idx on public.knowledge_gaps (status, hits desc, last_seen desc);

alter table public.knowledge_gaps enable row level security;
-- Everyone authenticated can read the gap list (mirrors data_reports_select).
create policy "knowledge_gaps_select" on public.knowledge_gaps
  for select to authenticated using (true);
-- No INSERT/UPDATE/DELETE policies -- all writes go through the FastAPI service role.
