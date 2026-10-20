-- The Sunday run's shortlist, kept per run so the weekly digest page can show
-- exactly what was chosen, in what order, and export that week's contacts.
create table weekly_shortlist (
  run_id            uuid not null,
  zi_company_id     text not null references companies(zi_company_id),
  rank              integer not null,
  score             numeric not null,
  why_now           text,
  contacts_picked   integer not null default 0,
  contacts_enriched integer not null default 0,
  created_at        timestamptz not null default now(),
  primary key (run_id, zi_company_id)
);

create index on weekly_shortlist (run_id, rank);
