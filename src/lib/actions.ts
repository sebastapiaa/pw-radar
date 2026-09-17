"use server";

/**
 * Server actions behind the dashboard forms. Every write records the actor
 * from the session. No ZoomInfo calls happen here; the dashboard never
 * spends credits by itself.
 */

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "./db";
import { requireSession } from "./session";
import { decryptPII } from "./crypto";

const OUTCOMES = new Set(["contacted", "replied", "meeting", "dead"]);
const TAG_RE = /^[a-z0-9][a-z0-9:_.-]{0,39}$/;

function parseTags(raw: string): string[] {
  return [...new Set(
    raw
      .split(/[,\s]+/)
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t && TAG_RE.test(t))
  )];
}

export async function addNote(formData: FormData) {
  const s = await requireSession();
  const entityType = String(formData.get("entityType")) === "contact" ? "contact" : "company";
  const entityId = String(formData.get("entityId") ?? "");
  const body = String(formData.get("body") ?? "").trim().slice(0, 4000);
  const back = String(formData.get("back") ?? "/");
  if (!entityId || !body) return;
  await db()`
    insert into notes (entity_type, entity_id, actor, body)
    values (${entityType}, ${entityId}, ${s.actor}, ${body})`;
  revalidatePath(back);
}

export async function setCompanyTags(formData: FormData) {
  await requireSession();
  const companyId = String(formData.get("companyId") ?? "");
  const tags = parseTags(String(formData.get("tags") ?? ""));
  const back = String(formData.get("back") ?? "/");
  if (!companyId) return;
  await db()`update companies set tags = ${tags} where zi_company_id = ${companyId}`;
  revalidatePath("/");
  revalidatePath(back);
}

export async function setContactTags(formData: FormData) {
  await requireSession();
  const contactId = String(formData.get("contactId") ?? "");
  const tags = parseTags(String(formData.get("tags") ?? ""));
  const back = String(formData.get("back") ?? "/");
  if (!contactId) return;
  await db()`update contacts set tags = ${tags} where zi_contact_id = ${contactId}`;
  revalidatePath(back);
}

export async function setOutcome(formData: FormData) {
  const s = await requireSession();
  const companyId = String(formData.get("companyId") ?? "");
  const status = String(formData.get("status") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, 1000) || null;
  const back = String(formData.get("back") ?? "/");
  if (!companyId || !OUTCOMES.has(status)) return;
  const sql = db();
  await sql.begin(async (tx) => {
    await tx`
      insert into outcomes (zi_company_id, actor, status, note)
      values (${companyId}, ${s.actor}, ${status}, ${note})`;
    if (status === "contacted" || status === "meeting") {
      // Working it: keep it off the cold list for 90 days.
      await tx`
        insert into suppressions (zi_company_id, suppressed_until, reason)
        values (${companyId}, now() + interval '90 days', 'contacted')
        on conflict (zi_company_id) do update
          set suppressed_until = greatest(suppressions.suppressed_until, excluded.suppressed_until),
              reason = 'contacted'`;
    }
  });
  revalidatePath("/");
  revalidatePath(back);
}

/**
 * Manual account seeding for warm leads and partner intros. Outside the
 * automated geography on purpose. Id is 'manual:<uuid>'; source 'manual'.
 */
export async function seedAccount(formData: FormData) {
  await requireSession();
  const name = String(formData.get("name") ?? "").trim().slice(0, 200);
  const domain = String(formData.get("domain") ?? "").trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").slice(0, 200) || null;
  const employeeCount = Number(formData.get("employeeCount")) || null;
  const city = String(formData.get("city") ?? "").trim().slice(0, 100) || null;
  const state = String(formData.get("state") ?? "").trim().toUpperCase().slice(0, 2) || null;
  const sourceTag = parseTags(String(formData.get("sourceTag") ?? ""))[0];
  const note = String(formData.get("note") ?? "").trim().slice(0, 4000);
  if (!name || !sourceTag) redirect("/accounts/new?error=Name+and+a+source+tag+are+required");

  const id = `manual:${randomUUID()}`;
  const sql = db();
  const s = await requireSession();
  await sql.begin(async (tx) => {
    await tx`
      insert into companies (zi_company_id, name, domain, employee_count, city, state, source, tags)
      values (${id}, ${name}, ${domain}, ${employeeCount}, ${city}, ${state}, 'manual', ${[sourceTag]})`;
    if (note) {
      await tx`insert into notes (entity_type, entity_id, actor, body) values ('company', ${id}, ${s.actor}, ${note})`;
    }
  });
  revalidatePath("/");
  redirect(`/accounts/${encodeURIComponent(id)}`);
}

/**
 * FREE. Pull the recommended people for an account into the People list:
 * names, titles, tiers. Nothing is spent. Only works for ZoomInfo-sourced
 * accounts; manual ones have no ZoomInfo id.
 */
export async function findPeople(formData: FormData) {
  await requireSession();
  const companyId = String(formData.get("companyId") ?? "");
  const back = String(formData.get("back") ?? "/");
  if (!companyId || companyId.startsWith("manual:")) return;
  const { storeRecommendations, zoomInfoFromEnv } = await import("./enrich");
  const client = zoomInfoFromEnv(true);
  await client.discoverTools();
  client.assertRoles(["recommendedContacts"]);
  await storeRecommendations(client, companyId);
  revalidatePath(back);
}

/** Monthly credit cap mirrors the ZoomInfo per-user cap; leave headroom for the Sunday job. */
const CLICK_CREDIT_SOFT_CAP = 400;

/**
 * PAID. One credit (at most) for one person's email and direct dial. Counted
 * in `runs` as job 'enrich-click' so the credit totals on the home page and
 * the Admin Portal reconciliation include it.
 */
export async function enrichOne(contactId: string): Promise<{ ok: boolean; message: string }> {
  const s = await requireSession();
  const sql = db();
  const [row] = await sql<{ zi_company_id: string; enriched_at: Date | null }[]>`
    select zi_company_id, enriched_at from contacts where zi_contact_id = ${contactId}`;
  if (!row) return { ok: false, message: "Unknown contact." };
  if (row.zi_company_id.startsWith("manual:")) return { ok: false, message: "Manual accounts cannot be enriched." };

  const [{ n: monthSpend }] = await sql<{ n: number }[]>`
    select coalesce(sum(credits_spent), 0)::int as n from runs
    where started_at > date_trunc('month', now())`;
  if (monthSpend >= CLICK_CREDIT_SOFT_CAP) {
    return { ok: false, message: `Monthly credit soft cap reached (${monthSpend}). Ask before raising it.` };
  }

  const [{ run_id: runId }] = await sql<{ run_id: string }[]>`
    insert into runs (job) values ('enrich-click') returning run_id`;
  try {
    const { storeEnrichment, zoomInfoFromEnv } = await import("./enrich");
    const client = zoomInfoFromEnv(false);
    await client.discoverTools();
    client.assertRoles(["enrichContacts"]);
    const r = await storeEnrichment(client, row.zi_company_id, [contactId]);
    await sql`
      update runs set finished_at = now(), status = 'ok', credits_spent = ${r.records},
        companies_seen = 1, error = ${`actor=${s.actor}`}
      where run_id = ${runId}`;
    revalidatePath(`/accounts/${encodeURIComponent(row.zi_company_id)}`);
    return r.withEmail
      ? { ok: true, message: "Email and phone stored." }
      : { ok: true, message: "ZoomInfo returned no verified email for this person." };
  } catch (err) {
    await sql`
      update runs set finished_at = now(), status = 'failed', error = ${(err as Error).message.slice(0, 500)}
      where run_id = ${runId}`;
    return { ok: false, message: (err as Error).message.slice(0, 200) };
  }
}

/**
 * Reveal one contact's email and phone. Logged in export_log with
 * included_pii = true so the audit trail covers on-screen reveals too.
 */
export async function revealContact(contactId: string): Promise<{ email: string | null; phone: string | null }> {
  const s = await requireSession();
  const sql = db();
  const [r] = await sql<{ email_enc: Buffer | null; phone_enc: Buffer | null }[]>`
    select email_enc, phone_enc from contacts where zi_contact_id = ${contactId}`;
  if (!r) return { email: null, phone: null };
  await sql`
    insert into export_log (actor, record_count, filter_json, included_pii)
    values (${s.actor}, 1, ${sql.json({ reveal: contactId })}, true)`;
  return {
    email: r.email_enc ? decryptPII(r.email_enc) : null,
    phone: r.phone_enc ? decryptPII(r.phone_enc) : null,
  };
}
