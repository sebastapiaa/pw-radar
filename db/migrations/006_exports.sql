-- Named exports. export_log stays as the audit trail (reveals, exports, counts);
-- this adds the name Salesloft will see as a tag, and which people left in it.
create table exports (
  id            serial primary key,
  name          text not null unique,          -- e.g. pwradar001; also the Salesloft tag
  actor         text not null,
  run_id        uuid,                          -- weekly/outreach run it was scoped to, if any
  record_count  integer not null default 0,
  note          text,
  created_at    timestamptz not null default now()
);

create table export_items (
  export_id     integer not null references exports(id) on delete cascade,
  zi_contact_id text not null references contacts(zi_contact_id),
  zi_company_id text not null references companies(zi_company_id),
  primary key (export_id, zi_contact_id)
);

create index on export_items (zi_company_id);
create index on export_items (zi_contact_id);
