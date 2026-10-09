-- Fractal core schema: profiles, chats, messages, responses, expertise,
-- expertise_versions, proposals, feedback, audit_log.
-- RLS enabled on every table; expertise/versions/proposals/audit_log are
-- write-only via the FastAPI service role (no INSERT/UPDATE policies).

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text not null default '',
  role        text not null default 'contributor' check (role in ('contributor', 'reviewer')),
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;
create policy "profiles_select_self" on public.profiles
  for select to authenticated using (true);
create policy "profiles_update_self" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles_insert_self" on public.profiles
  for insert to authenticated with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- chats
-- ---------------------------------------------------------------------------
create table if not exists public.chats (
  id          text primary key default gen_random_uuid()::text,
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null default 'New Chat',
  folder      text,
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists chats_user_idx on public.chats (user_id);
create index if not exists chats_updated_idx on public.chats (updated_at desc);

alter table public.chats enable row level security;
create policy "chats_owner_all" on public.chats
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id               text primary key default gen_random_uuid()::text,
  chat_id          text not null references public.chats (id) on delete cascade,
  role             text not null check (role in ('user', 'assistant')),
  content          text not null default '',
  files            jsonb not null default '[]'::jsonb,
  attached_expertise jsonb not null default '[]'::jsonb,
  web_search       boolean not null default false,
  detection        jsonb,
  detection_state  text,
  created_at       timestamptz not null default now()
);

create index if not exists messages_chat_idx on public.messages (chat_id);

alter table public.messages enable row level security;
create policy "messages_owner_all" on public.messages
  for all to authenticated
  using (
    exists (
      select 1 from public.chats c
      where c.id = messages.chat_id and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.chats c
      where c.id = messages.chat_id and c.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- responses
-- ---------------------------------------------------------------------------
create table if not exists public.responses (
  id              text primary key default gen_random_uuid()::text,
  message_id      text not null references public.messages (id) on delete cascade,
  model_id        text not null default '',
  auto            jsonb,
  expertise_used  jsonb not null default '[]'::jsonb,
  content         text not null default '',
  rating          text check (rating in ('up', 'down') or rating is null),
  created_at      timestamptz not null default now()
);

create index if not exists responses_message_idx on public.responses (message_id);

alter table public.responses enable row level security;
create policy "responses_owner_all" on public.responses
  for all to authenticated
  using (
    exists (
      select 1 from public.messages m
      join public.chats c on c.id = m.chat_id
      where m.id = responses.message_id and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.messages m
      join public.chats c on c.id = m.chat_id
      where m.id = responses.message_id and c.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- expertise
-- ---------------------------------------------------------------------------
create table if not exists public.expertise (
  id              text primary key,
  name            text not null,
  domain          text not null,
  topic           text not null default '',
  asset_types     jsonb not null default '[]'::jsonb,
  related         jsonb not null default '[]'::jsonb,
  status          text not null default 'draft' check (status in ('draft', 'in_review', 'approved', 'deprecated')),
  version         text not null default '0.1',
  owner           text not null default '',
  owner_role      text not null default '',
  reviewer        text,
  keywords        jsonb not null default '[]'::jsonb,
  usage_count     integer not null default 0,
  success_rate    double precision,
  summary         text not null default '',
  when_to_use     text not null default '',
  knowledge       jsonb not null default '[]'::jsonb,
  decision_logic  jsonb not null default '[]'::jsonb,
  guardrails      jsonb not null default '[]'::jsonb,
  escalation      jsonb not null default '[]'::jsonb,
  sources         jsonb not null default '[]'::jsonb,
  feedback        jsonb not null default '[]'::jsonb,
  origin          text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists expertise_status_idx on public.expertise (status);
create index if not exists expertise_domain_idx on public.expertise (domain);

alter table public.expertise enable row level security;
-- Everyone authenticated can read expertise
create policy "expertise_select" on public.expertise
  for select to authenticated using (true);
-- No INSERT/UPDATE/DELETE policies — all writes go through the FastAPI
-- service role (bypasses RLS).

-- ---------------------------------------------------------------------------
-- expertise_versions
-- ---------------------------------------------------------------------------
create table if not exists public.expertise_versions (
  id            text primary key default gen_random_uuid()::text,
  expertise_id  text not null references public.expertise (id) on delete cascade,
  version       text not null,
  date          timestamptz not null default now(),
  author        text not null default '',
  approved_by   text,
  note          text not null default '',
  snapshot      jsonb not null default '{}'::jsonb
);

create index if not exists expertise_versions_exp_idx on public.expertise_versions (expertise_id);

alter table public.expertise_versions enable row level security;
create policy "expertise_versions_select" on public.expertise_versions
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- proposals
-- ---------------------------------------------------------------------------
create table if not exists public.proposals (
  id            text primary key,
  expertise_id  text not null references public.expertise (id) on delete cascade,
  type          text not null default 'revision',
  created_at    timestamptz not null default now(),
  author        text not null default '',
  reason        text not null default '',
  changes       jsonb not null default '{}'::jsonb,
  chat_id       text,
  status        text not null default 'open' check (status in ('open', 'approved', 'rejected'))
);

create index if not exists proposals_expertise_idx on public.proposals (expertise_id);
create index if not exists proposals_status_idx on public.proposals (status);

alter table public.proposals enable row level security;
create policy "proposals_select" on public.proposals
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- feedback
-- ---------------------------------------------------------------------------
create table if not exists public.feedback (
  id            text primary key default gen_random_uuid()::text,
  expertise_id  text not null references public.expertise (id) on delete cascade,
  response_id   text references public.responses (id) on delete set null,
  user_name     text not null default '',
  rating        text not null check (rating in ('up', 'down')),
  comment       text not null default '',
  date          timestamptz not null default now()
);

create index if not exists feedback_expertise_idx on public.feedback (expertise_id);

alter table public.feedback enable row level security;
create policy "feedback_select" on public.feedback
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor       uuid,
  actor_role  text,
  action      text not null default '',
  target_type text,
  target_id   text,
  detail      jsonb not null default '{}'::jsonb
);

create index if not exists audit_log_at_idx on public.audit_log (at desc);

alter table public.audit_log enable row level security;
-- No SELECT policy — only the service role (bypasses RLS) can read/write.
