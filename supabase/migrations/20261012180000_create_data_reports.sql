-- Data Insights: automated analysis reports generated from any uploaded tabular data
-- (domain-agnostic — not specific to energy or any single Intelligence Pill). Each report
-- is a point-in-time snapshot kept historically so trends build up over successive runs.
-- Writes go through the FastAPI service role only (same pattern as expertise/proposals).
create table if not exists public.data_reports (
  id              text primary key,
  title           text not null default '',
  source_filename text not null default '',
  domains         jsonb not null default '[]'::jsonb,
  html            text not null default '',
  top_issues      jsonb not null default '[]'::jsonb,
  raw_metrics     jsonb not null default '{}'::jsonb,
  created_by      text,
  created_at      timestamptz not null default now()
);

create index if not exists data_reports_created_idx on public.data_reports (created_at desc);

alter table public.data_reports enable row level security;
-- Everyone authenticated can read past reports (mirrors expertise_select).
create policy "data_reports_select" on public.data_reports
  for select to authenticated using (true);
-- No INSERT/UPDATE/DELETE policies — all writes go through the FastAPI service role.
