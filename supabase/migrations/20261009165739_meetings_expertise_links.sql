-- Meeting Recorder: store the takeaway → Expertise routing chosen by the category selector
-- (and confirmed by the user) on each approved meeting, as an audit trail for the Review Queue proposals it created.
alter table public.meetings
  add column if not exists expertise_links jsonb not null default '[]'::jsonb;
  -- [{ "takeaway_index", "expertise_id" (null = new Expertise), "expertise_name", "field", "entry", "confidence" }]
