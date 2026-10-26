import type { Sql } from "postgres";
import { db } from "./db";
import { MONTHLY_SOFT_CAP } from "./limits";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SUPPRESSING_TAGS = ["client", "do-not-contact"];

export function peoplePerCompany(value: number): number {
  return Number.isFinite(value) ? Math.min(5, Math.max(1, Math.floor(value))) : 5;
}

/** One eligibility rule for selection and a last check before paid enrichment. */
export async function eligibleCompanies(ids: string[], sql: Sql = db()) {
  return sql<{ zi_company_id: string; score: number; why_now: string | null }[]>`
    select c.zi_company_id, f.score, f.why_now
    from companies c
    join lateral (
      select score, why_now from findings where zi_company_id = c.zi_company_id
        and created_at > now() - interval '30 days'
      order by score desc, created_at desc limit 1
    ) f on true
    where c.zi_company_id = any(${ids}) and c.source = 'zoominfo'
      and c.gate_status in ('passed','approved')
      and not (c.tags && ${SUPPRESSING_TAGS}::text[])
      and not exists (select 1 from unnest(c.tags) t where t like 'partner:%' or t like 'excluded:%')
      and coalesce((select verdict = 'pass' from gate_decisions d
        where d.zi_company_id = c.zi_company_id and d.check_name = 'corroboration'
        order by d.created_at desc, d.id desc limit 1), false)
      and coalesce((select status <> 'dead' from outcomes o where o.zi_company_id = c.zi_company_id
        order by o.noted_at desc, o.id desc limit 1), true)
    order by f.score desc, c.zi_company_id`;
}

/**
 * Count the maximum possible charge BEFORE calling a paid tool. A shared lock
 * serializes dashboard/weekly credit checks, including simultaneous requests.
 * Failed/ambiguous calls keep their upper bound until portal reconciliation.
 */
export async function chargeCredits(runId: string, count: number, sql: Sql = db()): Promise<void> {
  if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error("Invalid credit charge.");
  if (!Number.isSafeInteger(MONTHLY_SOFT_CAP) || MONTHLY_SOFT_CAP < 1) throw new Error('The monthly credit cap is not configured correctly.');
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(7348729)`;
    const [run] = await tx<{ status: string; current_month: boolean }[]>`
      select status, started_at >= date_trunc('month', now()) as current_month
      from runs where run_id = ${runId} for update`;
    if (!run || run.status !== "running") throw new Error("This contact list is not running.");
    if (!run.current_month) throw new Error("Create a new list to enrich contacts in this billing month.");
    const [{ spent }] = await tx<{ spent: number }[]>`
      select coalesce(sum(credits_spent),0)::int as spent from runs
      where started_at >= date_trunc('month', now())`;
    if (spent + count > MONTHLY_SOFT_CAP) throw new Error("Monthly credit limit reached. Saved contacts are still available.");
    await tx`update runs set credits_spent = credits_spent + ${count} where run_id = ${runId}`;
  });
}

/** Exact picked IDs are written before paid work and survive a failed request. */
export async function saveCommittee(sql: Sql, runId: string, companyId: string, ids: string[]) {
  await sql.begin(async (tx) => {
    await tx`delete from shortlist_contacts where run_id = ${runId} and zi_company_id = ${companyId}`;
    await tx`insert into shortlist_contacts (run_id, zi_company_id, zi_contact_id, rank)
      select ${runId}, ${companyId}, person.id, person.rank::int
      from unnest(${ids}::text[]) with ordinality as person(id, rank) on conflict do nothing`;
    await tx`update weekly_shortlist set contacts_picked = ${ids.length}
      where run_id = ${runId} and zi_company_id = ${companyId}`;
  });
}

/** Reuse usable, unexpired contact data; never pay to fetch it again. */
export async function contactsNeedingEnrichment(companyId: string, ids: string[], sql: Sql = db()): Promise<string[]> {
  const existing = await sql<{ zi_contact_id: string }[]>`
    select zi_contact_id from contacts where zi_company_id = ${companyId}
      and zi_contact_id = any(${ids}) and email_enc is not null
      and purge_after > now()`;
  const cached = new Set(existing.map((r) => r.zi_contact_id));
  return ids.filter((id) => !cached.has(id));
}

export async function committeeEmailCount(runId: string, companyId: string, sql: Sql = db()): Promise<number> {
  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n from shortlist_contacts p join contacts k
      on k.zi_contact_id = p.zi_contact_id and k.zi_company_id = p.zi_company_id
    where p.run_id = ${runId} and p.zi_company_id = ${companyId}
      and k.email_enc is not null and k.purge_after > now()
      and not (k.tags && ${SUPPRESSING_TAGS}::text[])`;
  return n;
}
