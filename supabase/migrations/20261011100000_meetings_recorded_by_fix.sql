-- Re-applies 20261010190000_meetings_recorded_by.sql. Two different migrations were created with the
-- same version (20261010190000), so Supabase only ran one of them. Everything here is idempotent.
alter table public.meetings
  add column if not exists recorded_by    text not null default '',
  add column if not exists recorded_by_id text not null default '';

create index if not exists meetings_recorded_by_idx on public.meetings (recorded_by_id);
