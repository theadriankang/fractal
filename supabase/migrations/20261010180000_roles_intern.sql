-- Accounts & domain-scoped permissions (src/lib/permissions.js, backend/app/capture).
--   reviewer    — sees and decides every queue item; never authors
--   contributor — domain expert: contributes AND reviews, only in `domains`, never their own work
--   intern      — uses approved Expertise; cannot contribute or review

comment on column public.profiles.domains is
  'Taxonomy domains (src/data/taxonomy.js) this user is an expert in; scopes contributing and reviewing for role=contributor.';

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('contributor', 'reviewer', 'intern'));
