-- Feedback loop (docs/FEEDBACK_LOOP.md): 👎 corrections → precise proposals → before/after tests.
-- Proposals from corrections keep their loop metadata (diagnosis, set, testCase, reports, testRun)
-- in one JSON column; each Expertise keeps its saved test questions. feedback.version already exists.
-- Dated after every other migration so it applies cleanly on top of the shared project and on a
-- fresh database (the laptop-only draft used 20261010150000, which sorted before the core schema).

alter table public.proposals add column if not exists loop jsonb;
alter table public.expertise add column if not exists test_cases jsonb not null default '[]'::jsonb;
