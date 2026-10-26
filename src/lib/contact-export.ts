import { db } from "./db";
import { decryptPII } from "./crypto";
import { SUPPRESSING_TAGS } from "./contact-lists";
import { sizeBand } from "./format";
import type { Sql } from "postgres";

export interface ExportContact {
  zi_contact_id: string;
  zi_company_id: string;
  full_name: string;
  title: string | null;
  email_enc: Buffer;
  phone_enc: Buffer | null;
  company_name: string;
  employee_count: number | null;
  score: number;
  why_now: string | null;
  scope: string | null;
}

/** Shared by preview counts and download; run context comes from its saved list. */
export async function exportContacts(runId: string | null = null, sql: Sql = db()): Promise<ExportContact[]> {
  return sql<ExportContact[]>`
    with context as (
      select w.zi_company_id, w.score, w.why_now from weekly_shortlist w
      join runs r using (run_id)
      where w.run_id = ${runId}::uuid and r.contact_list_version = 1
      union all
      (select distinct on (zi_company_id) zi_company_id, score, why_now
       from findings where ${runId}::uuid is null and created_at > now() - interval '30 days'
       order by zi_company_id, score desc, created_at desc)
    )
    select k.zi_contact_id, k.zi_company_id, k.full_name, k.title, k.email_enc, k.phone_enc,
      c.name as company_name, c.employee_count, b.score, b.why_now,
      (select string_agg(distinct sc.name, '; ') from signals s join scopes sc on s.topic = any(sc.intent_topics)
       where s.zi_company_id = c.zi_company_id) as scope
    from contacts k join companies c using (zi_company_id) join context b using (zi_company_id)
    where k.email_enc is not null and k.purge_after > now()
      and (${runId}::uuid is null or exists (select 1 from shortlist_contacts p
        where p.run_id = ${runId}::uuid and p.zi_contact_id = k.zi_contact_id and p.zi_company_id = k.zi_company_id))
      and c.gate_status in ('passed','approved')
      and not (c.tags && ${SUPPRESSING_TAGS}::text[])
      and not exists (select 1 from unnest(c.tags) t where t like 'partner:%' or t like 'excluded:%')
      and not (k.tags && ${SUPPRESSING_TAGS}::text[])
      and coalesce((select status <> 'dead' from outcomes o where o.zi_company_id = c.zi_company_id
        order by o.noted_at desc, o.id desc limit 1), true)
    order by b.score desc, c.name, k.full_name`;
}

export function csvField(value: string, phone = false): string {
  // A validated international number is data, and must retain its leading +.
  const safePhone = phone && /^\+?[\d ()\-\.]{5,30}$/.test(value);
  const safe = !safePhone && /^[=+\-@\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Fail the download explicitly on corruption; never silently omit a selected person. */
export function salesloftCSV(rows: ExportContact[], name: string): string {
  const header = ['first_name','last_name','email_address','title','company_name','phone','tags',
    'radar_export','radar_why_now','radar_score','radar_size_band','radar_scope'];
  const lines = [header.join(',')];
  for (const r of rows) {
    const [first, ...rest] = r.full_name.trim().split(/\s+/);
    const email = decryptPII(r.email_enc);
    const phone = r.phone_enc ? decryptPII(r.phone_enc) : '';
    if (!email) throw new Error('A selected contact has no readable email.');
    lines.push([first, rest.join(' '), email, r.title ?? '', r.company_name, phone, name, name,
      r.why_now ?? '', String(r.score), sizeBand(r.employee_count === null ? null : Number(r.employee_count)), r.scope ?? '']
      .map((value, index) => csvField(value, index === 5)).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}
