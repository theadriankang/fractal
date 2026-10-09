-- Domain-scoped contribution: a contributor may only capture / propose / edit Expertise in the
-- taxonomy domains they are a recognised expert in (src/lib/permissions.js, backend/app/capture).
-- Reviewers keep an empty list: they approve every domain but do not author content.
alter table public.profiles
  add column if not exists domains text[] not null default '{}';

comment on column public.profiles.domains is
  'Taxonomy domains (src/data/taxonomy.js) this user is an expert in; gates contributions for role=contributor.';
