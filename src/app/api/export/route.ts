import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { decryptPII } from "@/lib/crypto";
import { sizeBand } from "@/lib/queries";

/**
 * The only export: Salesloft person-import CSV. One person per row, contacts
 * of companies that surfaced in the last 30 days and are not tagged out.
 * Decrypted at export time, logged in export_log, rate limited.
 *
 * Column names follow Salesloft's person import (first_name, last_name,
 * email_address, title, company_name, phone) plus custom fields carrying the
 * Radar context. Verify custom-field names against the PerimeterWatch
 * Salesloft instance before relying on them (docs/ARCHITECTURE.md §Export).
 */

const RATE_LIMIT_PER_HOUR = 5;
const SUPPRESSING_TAGS = ["client", "do-not-contact"];

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", req.url));

  const sql = db();
  const [{ n: recent }] = await sql<{ n: number }[]>`
    select count(*)::int as n from export_log
    where actor = ${session.actor} and included_pii and exported_at > now() - interval '1 hour'
      and filter_json ? 'export'`;
  if (recent >= RATE_LIMIT_PER_HOUR) {
    return new NextResponse("Export rate limit reached. Try again in an hour.", { status: 429 });
  }

  const rows = await sql<Record<string, unknown>[]>`
    with best as (
      select distinct on (zi_company_id) zi_company_id, score, why_now
      from findings where created_at > now() - interval '30 days'
      order by zi_company_id, score desc
    )
    select k.zi_contact_id, k.full_name, k.title, k.email_enc, k.phone_enc,
           c.name as company_name, c.employee_count, b.score, b.why_now,
           (select string_agg(distinct sc.name, '; ')
              from signals s join scopes sc on s.topic = any(sc.intent_topics)
             where s.zi_company_id = c.zi_company_id) as scope
    from contacts k
    join companies c using (zi_company_id)
    join best b using (zi_company_id)
    where k.email_enc is not null
      and not (c.tags && ${SUPPRESSING_TAGS}::text[])
      and not exists (select 1 from unnest(c.tags) t where t like 'partner:%')
      and not (k.tags && ${SUPPRESSING_TAGS}::text[])
    order by b.score desc, c.name, k.full_name`;

  const header = [
    "first_name",
    "last_name",
    "email_address",
    "title",
    "company_name",
    "phone",
    "radar_why_now",
    "radar_score",
    "radar_size_band",
    "radar_scope",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const [first, ...rest] = String(r.full_name).split(" ");
    let email = "";
    let phone = "";
    try {
      email = r.email_enc ? decryptPII(r.email_enc as Buffer) : "";
      phone = r.phone_enc ? decryptPII(r.phone_enc as Buffer) : "";
    } catch {
      continue;
    }
    lines.push(
      [
        first,
        rest.join(" "),
        email,
        String(r.title ?? ""),
        String(r.company_name),
        phone,
        String(r.why_now ?? ""),
        String(r.score),
        sizeBand(r.employee_count === null ? null : Number(r.employee_count)),
        String(r.scope ?? ""),
      ]
        .map(csv)
        .join(",")
    );
  }

  await sql`
    insert into export_log (actor, record_count, filter_json, included_pii)
    values (${session.actor}, ${rows.length}, ${sql.json({ export: "salesloft", window_days: 30 })}, true)`;

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(lines.join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="radar-salesloft-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}

function csv(v: string): string {
  // Neutralise spreadsheet formula injection, then quote.
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}
