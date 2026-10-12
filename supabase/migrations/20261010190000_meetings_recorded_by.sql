-- Meeting Recorder: record who recorded and saved each meeting.
-- `user_id` (auth.users) is filled by the `meetings` Edge Function when the request carries a real
-- Supabase session. Until Supabase Auth replaces the demo sign-in, the demo account is kept here
-- as text (demo ids such as 'u-hafiz' are not auth.users rows, so they can't go in user_id).
alter table public.meetings
  add column if not exists recorded_by    text not null default '',  -- display name, e.g. 'Hafiz Rahman'
  add column if not exists recorded_by_id text not null default '';  -- account id (demo id or auth uid)

create index if not exists meetings_recorded_by_idx on public.meetings (recorded_by_id);
