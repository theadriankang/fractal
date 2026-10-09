-- Add profiles.email so the backend can identify users by email (X-User-Email)
-- before Supabase Auth JWT replaces the stub. Nullable + unique so existing
-- rows are not forced to backfill.
alter table public.profiles
  add column if not exists email text;

create unique index if not exists profiles_email_uidx
  on public.profiles (email)
  where email is not null;

-- Add chat_id to feedback (POST /api/expertise/{id}/feedback accepts chatId).
alter table public.feedback
  add column if not exists chat_id text;

