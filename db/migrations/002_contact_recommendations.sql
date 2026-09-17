-- Contacts can now exist without enrichment: the free recommendation call gives
-- name, title, department, seniority and a rank. Email/phone arrive only when
-- someone pays (Sunday job for the shortlist, or a click on the account page).
alter table contacts
  add column tier        text,      -- 'security' | 'it' | 'csuite' | 'other'
  add column department  text,
  add column rec_rank    integer,
  add column rec_score   numeric,
  add column recommended_at timestamptz;

create index on contacts (zi_company_id, enriched_at);
