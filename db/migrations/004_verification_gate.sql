-- Verification gate (docs/ARCHITECTURE.md §Verification gate).
-- Every decision is persisted per run so analytics can show kill/flag rates
-- per check and per topic. Companies carry the latest gate state so the UI
-- can render flags and Seb can approve.

create table gate_decisions (
  id              bigserial primary key,
  run_id          uuid not null,
  zi_company_id   text not null references companies(zi_company_id),
  check_name      text not null,   -- 'hierarchy' | 'liveness' | 'industry' | 'location' | 'distress' | 'model_review' | 'corroboration'
  verdict         text not null check (verdict in ('pass','flag','kill','skipped')),
  reason          text,            -- machine reason, e.g. 'security_vendor', 'domain_dead'
  evidence        jsonb,           -- company-level facts only, never contact PII
  created_at      timestamptz not null default now()
);

create index on gate_decisions (run_id, check_name);
create index on gate_decisions (zi_company_id, created_at desc);

alter table companies
  add column parent_company_id  text,          -- operating entity signals roll up to, if any
  add column location_type      text,          -- 'hq' | 'branch' | null (unknown)
  add column industry_ids       text[] not null default '{}',
  add column employment_trend   text,          -- 'stable_or_growing' | 'shrinking' | null
  add column gate_status        text not null default 'pending'
                                check (gate_status in ('pending','passed','flagged','killed','approved')),
  add column gate_reason        text,
  add column gate_reviewed_by   text,
  add column gate_reviewed_at   timestamptz;

create index on companies (gate_status);

-- Dead-marking now carries a reason from a fixed taxonomy.
alter table outcomes
  add column reason text
    check (reason is null or reason in
      ('dead_company','wrong_entity','competitor','bad_fit','already_covered','other'));
