-- Radar schema
-- One row per company per run. Trend matters, not just today.

create extension if not exists "pgcrypto";

-- Applied migrations from db/migrations/, by filename. scripts/db-apply.ts
-- records the files that schema.sql already includes on a fresh install.
create table schema_migrations (
  name        text primary key,
  applied_at  timestamptz not null default now()
);

-- Companies seen at least once. Keyed on ZoomInfo's company id.
-- Manually seeded accounts (events, partner intros) use id 'manual:<uuid>' and
-- source 'manual'. Tags drive suppression: 'client', 'do-not-contact' and
-- 'partner:*' must never surface as cold prospects. See docs/CONTEXT.md.
create table companies (
  zi_company_id   text primary key,
  name            text not null,
  domain          text,
  employee_count  integer,
  industry        text,
  city            text,
  state           text,
  source          text not null default 'zoominfo',  -- 'zoominfo' | 'manual'
  tags            text[] not null default '{}',
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now()
);

create index on companies using gin (tags);

-- Every signal observed, every run. Never updated, only appended.
-- signal_kind: 'intent' | 'scoop' | 'news'
create table signals (
  id              bigserial primary key,
  zi_company_id   text not null references companies(zi_company_id),
  run_id          uuid not null,
  signal_kind     text not null,
  topic           text,
  headline        text,
  raw_score       numeric,
  audience_strength text,
  signal_date     date,
  observed_at     timestamptz not null default now(),
  -- the untouched payload, so "why now" can always be rebuilt from source
  raw             jsonb not null,
  -- ZoomInfo's own id. Intent publishes weekly; the same signal seen on
  -- consecutive mornings is stored once. See db/migrations/001.
  zi_signal_id    text
);

create index on signals (zi_company_id, observed_at desc);
create index on signals (run_id);
create index on signals (topic);
create unique index signals_zi_signal_id_key on signals (zi_signal_id) where zi_signal_id is not null;

-- A scored finding: one company, one run, with score components kept separate
-- so a disputed ranking can be debugged rather than argued about.
create table findings (
  id              bigserial primary key,
  zi_company_id   text not null references companies(zi_company_id),
  run_id          uuid not null,
  score           numeric not null,
  icp_fit         numeric not null,
  signal_strength numeric not null,
  recency_decay   numeric not null,
  stack_bonus     numeric not null,
  signal_count    integer not null,
  why_now         text,
  created_at      timestamptz not null default now()
);

create index on findings (run_id, score desc);
create index on findings (zi_company_id, created_at desc);

-- Contacts. email_enc and phone_enc are application-layer encrypted.
-- See docs/SECURITY.md. Never store plaintext in these columns.
create table contacts (
  zi_contact_id   text primary key,
  zi_company_id   text not null references companies(zi_company_id),
  full_name       text not null,
  title           text,
  seniority       text,
  email_enc       bytea,
  phone_enc       bytea,
  enriched_at     timestamptz,   -- null until email/phone were paid for
  purge_after     timestamptz,   -- retention job reads this
  tags            text[] not null default '{}',
  created_at      timestamptz not null default now(),
  -- from the free recommendation call (db/migrations/002)
  tier            text,          -- 'security' | 'it' | 'csuite' | 'other'
  department      text,
  rec_rank        integer,
  rec_score       numeric,
  recommended_at  timestamptz
);

create index on contacts using gin (tags);

create index on contacts (zi_company_id);
create index on contacts (zi_company_id, enriched_at);
create index on contacts (purge_after) where purge_after is not null;

-- Suppression. A company surfaced today should not reappear tomorrow
-- while its intent decays.
create table suppressions (
  zi_company_id   text primary key references companies(zi_company_id),
  suppressed_until timestamptz not null,
  reason          text not null   -- 'surfaced' | 'contacted' | 'manual'
);

-- Job runs. Credit accounting lives here.
create table runs (
  run_id          uuid primary key default gen_random_uuid(),
  job             text not null,  -- 'daily' | 'weekly'
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  status          text not null default 'running',
  companies_seen  integer default 0,
  signals_seen    integer default 0,
  findings_written integer default 0,
  credits_spent   integer default 0,  -- our own count; ZoomInfo gives no preview
  error           text
);

-- Export audit. Every CSV leaving the system is recorded.
create table export_log (
  id              bigserial primary key,
  actor           text not null,
  exported_at     timestamptz not null default now(),
  record_count    integer not null,
  filter_json     jsonb,
  included_pii    boolean not null default false
);

-- Outcome tracking. Seb marks what he acted on; this is what makes
-- signal-to-contacted analytics possible.
create table outcomes (
  id              bigserial primary key,
  zi_company_id   text not null references companies(zi_company_id),
  actor           text not null,
  status          text not null,  -- 'contacted' | 'replied' | 'meeting' | 'dead'
  noted_at        timestamptz not null default now(),
  note            text
);

create index on outcomes (zi_company_id, noted_at desc);

-- Scopes: PerimeterWatch services bundled with the intent topics they map to.
-- The account profile links each highlighted signal to a scope. Seeded by hand.
create table scopes (
  id              serial primary key,
  name            text not null,          -- e.g. 'ThreatWatch MDR'
  slug            text not null unique,
  description     text,
  intent_topics   text[] not null default '{}'
);

-- Free-form notes on accounts and contacts. Append-only.
create table notes (
  id              bigserial primary key,
  entity_type     text not null check (entity_type in ('company','contact')),
  entity_id       text not null,
  actor           text not null,
  body            text not null,
  created_at      timestamptz not null default now()
);

create index on notes (entity_type, entity_id, created_at desc);

-- Cached AI-generated profile descriptions. body holds { text, spans: [{start,
-- end, signal_id, scope_slug}] } — spans citing no stored signal are rejected
-- before insert. Regenerable; keep the latest per company.
create table account_profiles (
  zi_company_id   text primary key references companies(zi_company_id),
  body            jsonb not null,
  model           text not null,
  generated_at    timestamptz not null default now()
);
