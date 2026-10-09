-- Feedback loop (docs/FEEDBACK_LOOP.md): 👎 corrections → precise proposals → before/after tests.
-- Today the browser keeps this state (src/store.js) and the backend endpoints are stateless;
-- these columns and tables are where it lands when governance moves server-side (Prompts 5 + 7).
-- RLS on everything; authenticated users may read, all writes go through FastAPI (service role).

-- Feedback records the Expertise version it rated, so health can be compared per version.
alter table public.feedback
  add column if not exists expertise_version text;

create index if not exists feedback_version_idx on public.feedback (expertise_id, expertise_version);

-- Proposals created from 👎 corrections.
alter table public.proposals
  add column if not exists origin        text,                                     -- 'feedback' | 'chat' | 'meeting' | null
  add column if not exists base_version  text,                                     -- version the correction was made against
  add column if not exists diagnosis     text check (diagnosis in ('expertise_wrong', 'expertise_incomplete', 'scope_wrong')),
  add column if not exists confidence    real,
  add column if not exists set_fields    jsonb not null default '{}'::jsonb,       -- e.g. {"whenToUse": "..."}
  add column if not exists report_count  integer not null default 1,
  add column if not exists reports       jsonb not null default '[]'::jsonb,       -- [{user, comment, date, chatId}]
  add column if not exists test_case     jsonb;                                    -- {question, mustDo[], mustNotDo[]}

-- Saved test questions per Expertise: from approved corrections and 👍 answers.
create table if not exists public.test_cases (
  id                text primary key default gen_random_uuid()::text,
  expertise_id      text not null references public.expertise (id) on delete cascade,
  source            text not null check (source in ('correction', 'thumbs_up', 'manual')),
  question          text not null,
  must_do           jsonb not null default '[]'::jsonb,
  must_not_do       jsonb not null default '[]'::jsonb,
  reference_answer  text,
  created_at        timestamptz not null default now()
);

create index if not exists test_cases_expertise_idx on public.test_cases (expertise_id, created_at desc);

alter table public.test_cases enable row level security;
create policy "test_cases_select" on public.test_cases
  for select to authenticated using (true);

-- Before/after runs for a proposal.
create table if not exists public.test_runs (
  id            text primary key default gen_random_uuid()::text,
  proposal_id   text not null references public.proposals (id) on delete cascade,
  base_version  text not null,
  model         text not null,
  grader_model  text not null,
  summary       jsonb not null default '{}'::jsonb,   -- {total, oldPass, newPass, fixed, broke, errors}
  results       jsonb not null default '[]'::jsonb,   -- [{caseId, question, old:{answer, ok, why}, new:{...}, verdict}]
  created_at    timestamptz not null default now()
);

create index if not exists test_runs_proposal_idx on public.test_runs (proposal_id, created_at desc);

alter table public.test_runs enable row level security;
create policy "test_runs_select" on public.test_runs
  for select to authenticated using (true);
