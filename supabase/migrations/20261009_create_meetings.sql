-- Meeting Recorder: persisted meetings + transcripts
create table if not exists public.meetings (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title           text not null default 'Untitled meeting',
  transcript_text text not null default '',
  duration        integer not null default 0,          -- seconds
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists meetings_user_created_idx on public.meetings (user_id, created_at desc);

-- keep updated_at fresh on every edit / autosave
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists meetings_touch on public.meetings;
create trigger meetings_touch before update on public.meetings
  for each row execute function public.touch_updated_at();

-- Row Level Security: each user only sees / edits their own meetings
alter table public.meetings enable row level security;

create policy "meetings_select_own" on public.meetings for select using (auth.uid() = user_id);
create policy "meetings_insert_own" on public.meetings for insert with check (auth.uid() = user_id);
create policy "meetings_update_own" on public.meetings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "meetings_delete_own" on public.meetings for delete using (auth.uid() = user_id);
