-- Save the actual committee, not just its company. Existing lists cannot be
-- reconstructed accurately, so version 0 lists remain history only.
alter table runs
  add column actor text,
  add column contacts_per_company integer check (contacts_per_company between 1 and 5),
  add column contact_list_version integer not null default 0;

alter table weekly_shortlist
  add column contact_status text not null default 'legacy'
    check (contact_status in ('legacy','pending','processing','complete','failed','uncertain','skipped')),
  add column contact_error text,
  add column processing_started_at timestamptz,
  add column paid_started_at timestamptz;

create table shortlist_contacts (
  run_id uuid not null,
  zi_company_id text not null,
  zi_contact_id text not null references contacts(zi_contact_id),
  rank integer not null,
  primary key (run_id, zi_contact_id),
  foreign key (run_id, zi_company_id)
    references weekly_shortlist(run_id, zi_company_id) on delete cascade
);
create index on shortlist_contacts (run_id, zi_company_id, rank);
