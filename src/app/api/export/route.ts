import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { EXPORT_NAME_RE, nextExportName } from "@/lib/exports";
import { exportContacts, salesloftCSV } from "@/lib/contact-export";
import { UUID_RE } from "@/lib/contact-lists";

/**
 * The only export: Salesloft person-import CSV. One person per row, contacts
 * of companies that surfaced in the last 30 days and are not tagged out, or,
 * with ?run=<weekly/outreach run id>, only that run's list.
 *
 * Every export is named (?name=, default next pwradar###), recorded in
 * `exports` with the people it contained in `export_items`, and logged in
 * export_log. The CSV `tags` column carries exactly one tag, the export name
 * (e.g. pwradar001); the shared "pwradar" prefix is what filters all of them.
 *
 * Column names follow Salesloft's person import (first_name, last_name,
 * email_address, title, company_name, phone, tags) plus custom fields with
 * the Radar context. Verify custom-field names against the PerimeterWatch
 * Salesloft instance before relying on them (docs/ARCHITECTURE.md §Export).
 */

const RATE_LIMIT_PER_HOUR = 5;

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", req.url));

  const url = new URL(req.url);
  const runId = url.searchParams.get("run");
  if (runId && !UUID_RE.test(runId)) return new NextResponse("Bad run id", { status: 400 });
  const requestedName = url.searchParams.get("name")?.trim() ?? "";
  if (requestedName && !EXPORT_NAME_RE.test(requestedName)) {
    return new NextResponse("Export name must be 2-40 letters, digits, dash or underscore.", { status: 400 });
  }
  const note = url.searchParams.get("note")?.trim().slice(0, 500) || null;

  const sql = db();
  if (runId) {
    const [run] = await sql<{ contact_list_version: number }[]>`select contact_list_version from runs
      where run_id = ${runId} and job in ('weekly','outreach')`;
    if (!run) return new NextResponse("Contact list not found.", { status: 404 });
    if (run.contact_list_version !== 1) return new NextResponse("This older list has no saved contact selection. Build a new list from Findings.", { status: 409 });
  }
  const [{ n: recent }] = await sql<{ n: number }[]>`
    select count(*)::int as n from exports where actor = ${session.actor} and created_at > now() - interval '1 hour'`;
  if (recent >= RATE_LIMIT_PER_HOUR) {
    return new NextResponse("Export rate limit reached. Try again in an hour.", { status: 429 });
  }

  const name = requestedName || (await nextExportName());
  const [dup] = await sql<{ id: number }[]>`select id from exports where name = ${name}`;
  if (dup) return new NextResponse(`An export named ${name} already exists. Choose another name.`, { status: 409 });

  const rows = await exportContacts(runId);
  if (!rows.length) return new NextResponse("No eligible contacts with unexpired email data are available in this list.", { status: 409 });
  let body: string;
  try {
    body = salesloftCSV(rows, name);
  } catch {
    return new NextResponse("Contact details could not be decrypted. Check PII_ENCRYPTION_KEY before downloading again. No export was recorded.", { status: 503 });
  }
  const included = rows.map((r) => ({ contactId: r.zi_contact_id, companyId: r.zi_company_id }));

  await sql.begin(async (tx) => {
    const [e] = await tx<{ id: number }[]>`
      insert into exports (name, actor, run_id, record_count, note)
      values (${name}, ${session.actor}, ${runId ?? null}, ${included.length}, ${note})
      returning id`;
    await tx`insert into export_items (export_id, zi_contact_id, zi_company_id)
      select ${e.id}, person.contact_id, person.company_id
      from unnest(${included.map((i) => i.contactId)}::text[], ${included.map((i) => i.companyId)}::text[])
        as person(contact_id, company_id) on conflict do nothing`;
    await tx`
      insert into export_log (actor, record_count, filter_json, included_pii)
      values (${session.actor}, ${included.length}, ${tx.json({ export: "salesloft", name, window_days: runId ? null : 30, run: runId })}, true)`;
  });

  return new NextResponse(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}-salesloft.csv"`,
      "cache-control": "no-store",
    },
  });
}
