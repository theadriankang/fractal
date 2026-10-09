-- Columns the front end already uses but the core schema lacked, so the Library, Review Queue
-- and Chats can read from and write to Supabase without losing fields (BUILD_PROMPTS Prompt 7).

-- Demo sign-in identifies accounts by email until Supabase Auth (Prompt 8) sends a JWT.
alter table public.profiles add column if not exists email text;
create unique index if not exists profiles_email_idx on public.profiles (lower(email));

-- Provenance of captured know-how and the account that contributed it (four-eyes rule).
alter table public.expertise add column if not exists capture jsonb;
alter table public.expertise add column if not exists author_id text;

alter table public.proposals add column if not exists author_id text;
alter table public.proposals add column if not exists capture jsonb;
alter table public.proposals add column if not exists sources jsonb not null default '[]'::jsonb;
alter table public.proposals add column if not exists meeting_id text;
alter table public.proposals add column if not exists meeting_title text;

-- What a confirmed capture card produced (draft Expertise or proposal id) and what it still needs.
alter table public.messages add column if not exists detection_result text;
alter table public.messages add column if not exists detection_missing jsonb not null default '[]'::jsonb;

-- Feedback links back to the conversation it came from.
alter table public.feedback add column if not exists chat_id text;
