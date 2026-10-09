-- Meeting Recorder: approved meeting records (applied to project "fractal-meetings").
-- Rows are written only after the user clicks "Approve & Save", via the `meetings` Edge Function.
create table public.meetings (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references auth.users (id) on delete set null,
  title              text not null,
  raw_transcript     text not null,
  cleaned_transcript text not null default '',
  attached_files     jsonb not null default '[]'::jsonb,   -- [{ "filename": "..." }] — files themselves are discarded
  summary            text not null default '',
  key_takeaways      jsonb not null default '[]'::jsonb,   -- ["..."]
  action_items       jsonb not null default '[]'::jsonb,   -- [{ "task", "owner", "due_date" }]
  duration           integer not null default 0,           -- seconds
  status             text not null default 'approved' check (status in ('approved')),
  created_at         timestamptz not null default now()
);
create index meetings_created_idx on public.meetings (created_at desc);

-- RLS on with no policies: the browser can't read/write the table directly.
-- All access goes through the Edge Function (service role).
alter table public.meetings enable row level security;
