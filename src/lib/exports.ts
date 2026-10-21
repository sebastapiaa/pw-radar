/**
 * Export naming and history. Names are Salesloft tags, so they must be
 * simple: letters, digits, dash, underscore; 2–40 chars. The default is the
 * next in the pwradar### sequence.
 */

import { db } from "./db";

export const EXPORT_TAG = "pwradar";
export const EXPORT_NAME_RE = /^[a-z0-9][a-z0-9_-]{1,39}$/i;

export async function nextExportName(): Promise<string> {
  const sql = db();
  const [r] = await sql<{ n: number }[]>`
    select coalesce(max(substring(name from '^pwradar(\\d+)$')::int), 0)::int as n
    from exports where name ~ '^pwradar\\d+$'`;
  return `${EXPORT_TAG}${String((r?.n ?? 0) + 1).padStart(3, "0")}`;
}

export interface ExportRow {
  id: number;
  name: string;
  actor: string;
  runId: string | null;
  runJob: string | null;
  recordCount: number;
  companies: number;
  note: string | null;
  createdAt: string;
}

export async function exportsList(limit = 50): Promise<ExportRow[]> {
  const sql = db();
  const rows = await sql<Record<string, unknown>[]>`
    select e.id, e.name, e.actor, e.run_id, r.job as run_job, e.record_count, e.note, e.created_at,
           (select count(distinct zi_company_id)::int from export_items i where i.export_id = e.id) as companies
    from exports e left join runs r on r.run_id = e.run_id
    order by e.created_at desc limit ${limit}`;
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    actor: String(r.actor),
    runId: (r.run_id as string) ?? null,
    runJob: (r.run_job as string) ?? null,
    recordCount: Number(r.record_count ?? 0),
    companies: Number(r.companies ?? 0),
    note: (r.note as string) ?? null,
    createdAt: new Date(r.created_at as string).toISOString(),
  }));
}

export interface CompanyExport {
  name: string;
  createdAt: string;
  people: number;
}

export async function exportsForCompany(companyId: string): Promise<CompanyExport[]> {
  const sql = db();
  const rows = await sql<Record<string, unknown>[]>`
    select e.name, e.created_at, count(*)::int as people
    from export_items i join exports e on e.id = i.export_id
    where i.zi_company_id = ${companyId}
    group by e.id, e.name, e.created_at order by e.created_at desc`;
  return rows.map((r) => ({ name: String(r.name), createdAt: new Date(r.created_at as string).toISOString().slice(0, 10), people: Number(r.people) }));
}

/** contact id -> export names, newest first. */
export async function exportNamesForContacts(contactIds: string[]): Promise<Map<string, string[]>> {
  if (!contactIds.length) return new Map();
  const sql = db();
  const rows = await sql<{ zi_contact_id: string; name: string }[]>`
    select i.zi_contact_id, e.name from export_items i join exports e on e.id = i.export_id
    where i.zi_contact_id = any(${contactIds}) order by e.created_at desc`;
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.zi_contact_id, [...(out.get(r.zi_contact_id) ?? []), r.name]);
  return out;
}
