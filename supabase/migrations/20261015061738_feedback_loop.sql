-- Feedback loop (docs/FEEDBACK_LOOP.md): 👎 corrections → precise proposals → before/after tests.
-- Proposals from corrections keep their loop metadata (diagnosis, set, testCase, reports, testRun)
-- in one JSON column; each Expertise keeps its saved test questions. feedback.version already exists.
-- Applied to the shared project (fractal-meetings) on 15 Oct 2026 under this version. Dated after the
-- core schema so it also applies on a fresh database (the laptop-only draft used 20261010150000).

alter table public.proposals add column if not exists loop jsonb;
alter table public.expertise add column if not exists test_cases jsonb not null default '[]'::jsonb;
