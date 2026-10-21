import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { decryptPII } from "@/lib/crypto";
import { sizeBand } from "@/lib/format";
import { EXPORT_NAME_RE, nextExportName } from "@/lib/exports";

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
const SUPPRESSING_TAGS = ["client", "do-not-contact"];

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", req.url));

  const url = new URL(req.url);
  const runId = url.searchParams.get("run");
  if (runId && !/^[0-9a-f-]{36}$/i.test(runId)) return new NextResponse("Bad run id", { status: 400 });
  const requestedName = url.searchParams.get("name")?.trim() ?? "";
  if (requestedName && !EXPORT_NAME_RE.test(requestedName)) {
    return new NextResponse("Export name must be 2-40 letters, digits, dash or underscore.", { status: 400 });
  }
  const note = url.searchParams.get("note")?.trim().slice(0, 500) || null;

  const sql = db();
  const [{ n: recent }] = await sql<{ n: number }[]>`
    select count(*)::int as n from exports where actor = ${session.actor} and created_at > now() - interval '1 hour'`;
  if (recent >= RATE_LIMIT_PER_HOUR) {
    return new NextResponse("Export rate limit reached. Try again in an hour.", { status: 429 });
  }

  const name = requestedName || (await nextExportName());
  const [dup] = await sql<{ id: number }[]>`select id from exports where name = ${name}`;
  if (dup) return new NextResponse(`An export named ${name} already exists. Choose another name.`, { status: 409 });

  const rows = await sql<Record<string, unknown>[]>`
    with best as (
      select distinct on (zi_company_id) zi_company_id, score, why_now
      from findings where created_at > now() - interval '30 days'
        and (${runId ?? null}::uuid is null
             or zi_company_id in (select zi_company_id from weekly_shortlist where run_id = ${runId ?? null}::uuid))
      order by zi_company_id, score desc
    )
    select k.zi_contact_id, k.zi_company_id, k.full_name, k.title, k.email_enc, k.phone_enc,
           c.name as company_name, c.employee_count, b.score, b.why_now,
           (select string_agg(distinct sc.name, '; ')
              from signals s join scopes sc on s.topic = any(sc.intent_topics)
             where s.zi_company_id = c.zi_company_id) as scope
    from contacts k
    join companies c using (zi_company_id)
    join best b using (zi_company_id)
    where k.email_enc is not null
      and not (c.tags && ${SUPPRESSING_TAGS}::text[])
      and not exists (select 1 from unnest(c.tags) t where t like 'partner:%' or t like 'excluded:%')
      and not (k.tags && ${SUPPRESSING_TAGS}::text[])
    order by b.score desc, c.name, k.full_name`;

  const header = [
    "first_name",
    "last_name",
    "email_address",
    "title",
    "company_name",
    "phone",
    "tags",
    "radar_export",
    "radar_why_now",
    "radar_score",
    "radar_size_band",
    "radar_scope",
  ];
  const lines = [header.join(",")];
  const included: { contactId: string; companyId: string }[] = [];
  for (const r of rows) {
    const [first, ...rest] = String(r.full_name ?? "").split(" ");
    let email = "";
    let phone = "";
    try {
      email = r.email_enc ? decryptPII(r.email_enc as Buffer) : "";
      phone = r.phone_enc ? decryptPII(r.phone_enc as Buffer) : "";
    } catch {
      continue;
    }
    if (!email) continue;
    lines.push(
      [
        first,
        rest.join(" "),
        email,
        String(r.title ?? ""),
        String(r.company_name),
        phone,
        name,
        name,
        String(r.why_now ?? ""),
        String(r.score),
        sizeBand(r.employee_count === null ? null : Number(r.employee_count)),
        String(r.scope ?? ""),
      ]
        .map(csv)
        .join(",")
    );
    included.push({ contactId: String(r.zi_contact_id), companyId: String(r.zi_company_id) });
  }

  await sql.begin(async (tx) => {
    const [e] = await tx<{ id: number }[]>`
      insert into exports (name, actor, run_id, record_count, note)
      values (${name}, ${session.actor}, ${runId ?? null}, ${included.length}, ${note})
      returning id`;
    for (const i of included) {
      await tx`insert into export_items (export_id, zi_contact_id, zi_company_id) values (${e.id}, ${i.contactId}, ${i.companyId}) on conflict do nothing`;
    }
    await tx`
      insert into export_log (actor, record_count, filter_json, included_pii)
      values (${session.actor}, ${included.length}, ${tx.json({ export: "salesloft", name, window_days: 30, run: runId })}, true)`;
  });

  return new NextResponse(lines.join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}-salesloft.csv"`,
      "cache-control": "no-store",
    },
  });
}

function csv(v: string): string {
  // Neutralise spreadsheet formula injection, then quote.
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}
