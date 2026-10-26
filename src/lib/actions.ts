"use server";

/**
 * Server actions behind the dashboard forms. Every write records the actor
 * from the session. Paid contact calls require an explicit user action.
 */

import { randomUUID } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "./db";
import { requireSession } from "./session";
import { decryptPII, assertPIIKey } from "./crypto";
import { chargeCredits, committeeEmailCount, contactsNeedingEnrichment, eligibleCompanies, peoplePerCompany, saveCommittee, UUID_RE } from "./contact-lists";
import { exportContacts } from "./contact-export";

import { DEAD_REASONS } from "./taxonomy";
import { MONTHLY_SOFT_CAP, OUTREACH_MAX_COMPANIES } from "./limits";

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
  revalidateTag("home");
  revalidateTag("findings");
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
  const reasonRaw = String(formData.get("reason") ?? "");
  const back = String(formData.get("back") ?? "/");
  if (!companyId || !OUTCOMES.has(status)) return;
  // Dead requires a reason from the taxonomy; "other" requires a note.
  const reason = (DEAD_REASONS as readonly string[]).includes(reasonRaw) ? reasonRaw : null;
  if (status === "dead" && (!reason || (reason === "other" && !note))) {
    redirect(`${back}?error=${encodeURIComponent("Marking dead needs a reason (and a note for 'other').")}`);
  }
  const sql = db();
  await sql.begin(async (tx) => {
    await tx`
      insert into outcomes (zi_company_id, actor, status, note, reason)
      values (${companyId}, ${s.actor}, ${status}, ${note}, ${status === "dead" ? reason : null})`;
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
  revalidateTag("home");
  revalidateTag("findings");
}

/**
 * Seb approves a gate-flagged account for enrichment. Recorded with actor and
 * time; the next Sunday run treats it as passed unless the gate now kills it.
 */
export async function approveGate(formData: FormData) {
  const s = await requireSession();
  const companyId = String(formData.get("companyId") ?? "");
  const back = String(formData.get("back") ?? "/");
  if (!companyId) return;
  const sql = db();
  await sql.begin(async (tx) => {
    // Flagged → approved. Killed → restored: the exclusion tags and the gate's
    // suppression come off too, and the approval is recorded so the next gate
    // run does not re-kill it silently (persist() keeps 'approved' unless a
    // new kill fires, which is logged in gate_decisions either way).
    await tx`
      update companies set
        gate_status = 'approved', gate_reviewed_by = ${s.actor}, gate_reviewed_at = now(),
        tags = array(select t from unnest(tags) t where t not like 'excluded:%' and t <> 'partner:candidate')
      where zi_company_id = ${companyId} and gate_status in ('flagged','pending','passed','killed')`;
    await tx`delete from suppressions where zi_company_id = ${companyId} and reason = 'manual'`;
    await tx`
      insert into notes (entity_type, entity_id, actor, body)
      values ('company', ${companyId}, ${s.actor}, 'Gate decision overridden: approved / restored to list.')`;
  });
  revalidatePath(back);
  revalidatePath("/");
  revalidateTag("findings");
  revalidateTag("home");
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

/** Single clicks stop at the same soft cap as batch runs. */
const CLICK_CREDIT_SOFT_CAP = MONTHLY_SOFT_CAP;

/**
 * PAID. One credit (at most) for one person's email and direct dial. Counted
 * in `runs` as job 'enrich-click' so the credit totals on the home page and
 * the Admin Portal reconciliation include it.
 */
export async function enrichOne(contactId: string): Promise<{ ok: boolean; message: string }> {
  const s = await requireSession();
  const sql = db();
  const [row] = await sql<{ zi_company_id: string; allowed: boolean }[]>`
    select zi_company_id, not (tags && array['client','do-not-contact']) as allowed
    from contacts where zi_contact_id = ${contactId}`;
  if (!row) return { ok: false, message: "Unknown contact." };
  if (!row.allowed || !(await eligibleCompanies([row.zi_company_id])).length) {
    return { ok: false, message: "This account needs gate approval and corroborating signals, and must not be excluded." };
  }
  if (!(await contactsNeedingEnrichment(row.zi_company_id, [contactId])).length) {
    return { ok: true, message: "Contact details are already available. No credits used." };
  }

  const [{ n: monthSpend }] = await sql<{ n: number }[]>`
    select coalesce(sum(credits_spent), 0)::int as n from runs
    where started_at > date_trunc('month', now())`;
  if (monthSpend >= CLICK_CREDIT_SOFT_CAP) {
    return { ok: false, message: `Monthly credit soft cap reached (${monthSpend}). Ask before raising it.` };
  }

  const [{ run_id: runId }] = await sql<{ run_id: string }[]>`
    insert into runs (job, actor) values ('enrich-click', ${s.actor}) returning run_id`;
  try {
    const { storeEnrichment, zoomInfoFromEnv } = await import("./enrich");
    const client = zoomInfoFromEnv(false);
    await client.discoverTools();
    client.assertRoles(["enrichContacts"]);
    assertPIIKey();
    await chargeCredits(runId, 1);
    const r = await storeEnrichment(client, row.zi_company_id, [contactId]);
    await sql`
      update runs set finished_at = now(), status = 'ok',
        companies_seen = 1, error = ${`actor=${s.actor}`}
      where run_id = ${runId}`;
    revalidatePath(`/accounts/${encodeURIComponent(row.zi_company_id)}`);
    return r.withEmail
      ? { ok: true, message: "Email and phone stored." }
      : { ok: true, message: "ZoomInfo returned no verified email for this person." };
  } catch {
    await sql`
      update runs set finished_at = now(), status = 'failed', error = 'Contact enrichment failed; attempted credit upper bound retained.'
      where run_id = ${runId}`;
    return { ok: false, message: "Contact details could not be retrieved. Any attempted credit charge is recorded; review the account before retrying." };
  }
}

// ---------- outreach list: Seb picks companies, we get the committee and export ----------

export interface OutreachStart {
  ok: boolean;
  runId?: string;
  companies?: number;
  ceiling?: number;
  message: string;
}

/**
 * Create an outreach run for the chosen companies. Records them in
 * weekly_shortlist under a run with job 'outreach' so the Weekly page and the
 * export treat it exactly like a Sunday run. Spends nothing yet.
 */
export async function startOutreach(companyIds: string[], perCompany: number): Promise<OutreachStart> {
  const s = await requireSession();
  const ids = [...new Set(companyIds.filter((id) => /^\d+$/.test(id)))];
  const n = peoplePerCompany(perCompany);
  if (!ids.length) return { ok: false, message: "Select at least one ZoomInfo-sourced company." };
  const sql = db();
  const all = await eligibleCompanies(ids);
  if (!all.length) return { ok: false, message: "Select gate-cleared accounts with corroborating signals. Review flagged accounts on Gate first." };
  // Over the cap: take the highest-scoring companies, not the first ticked.
  all.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const rows = all.slice(0, OUTREACH_MAX_COMPANIES);
  // Saving a list and reusing cached contacts are free, including at the cap.
  // The shared guard checks the actual requested batch before any paid call.
  const runId = await sql.begin(async (tx) => {
    const [{ run_id: id }] = await tx<{ run_id: string }[]>`
      insert into runs (job, actor, contacts_per_company, contact_list_version, companies_seen)
      values ('outreach', ${s.actor}, ${n}, 1, ${rows.length}) returning run_id`;
    await tx`insert into weekly_shortlist (run_id, zi_company_id, rank, score, why_now, contact_status)
      select ${id}, chosen.company_id, chosen.rank::int, chosen.score, chosen.why_now, 'pending'
      from unnest(${rows.map((r) => r.zi_company_id)}::text[], ${rows.map((r) => r.score)}::numeric[],
        ${rows.map((r) => r.why_now)}::text[]) with ordinality as chosen(company_id, score, why_now, rank)`;
    return id;
  });
  return { ok: true, runId, companies: rows.length, ceiling: rows.length * n, message: `Run created for ${rows.length} companies.` };
}

/** Company ids in an outreach run, rank order. */
export async function outreachMembers(runId: string): Promise<string[]> {
  await requireSession();
  if (!UUID_RE.test(runId)) return [];
  const rows = await db()<{ zi_company_id: string }[]>`
    select w.zi_company_id from weekly_shortlist w join runs r using (run_id)
    where w.run_id = ${runId} and r.job = 'outreach' and r.contact_list_version = 1
      and w.contact_status in ('pending','failed') order by w.rank`;
  return rows.map((r) => r.zi_company_id);
}

export interface OutreachStep {
  ok: boolean;
  done: { companyId: string; picked: number; withEmail: number; credits: number; error?: string }[];
  creditsSoFar: number;
  message?: string;
}

/**
 * Enrich the committee for a few companies of an outreach run. Called
 * repeatedly from the browser with small batches so no request runs long.
 * Credits are counted before the paid call as a conservative upper bound.
 */
export async function enrichOutreachBatch(runId: string, companyIds: string[]): Promise<OutreachStep> {
  const session = await requireSession();
  if (!UUID_RE.test(runId)) return { ok: false, done: [], creditsSoFar: 0, message: "Bad run id." };
  const sql = db();
  const [run] = await sql<{ credits_spent: number; status: string; contacts_per_company: number; actor: string }[]>`
    select credits_spent, status, contacts_per_company, actor from runs
    where run_id = ${runId} and job = 'outreach' and contact_list_version = 1`;
  if (!run) return { ok: false, done: [], creditsSoFar: 0, message: "Unknown run." };
  if (run.actor !== session.actor || run.status !== 'running') return { ok: false, done: [], creditsSoFar: Number(run.credits_spent), message: "This list is not available for processing." };
  const { storeRecommendations, selectCommittee, storeEnrichment, zoomInfoFromEnv } = await import("./enrich");
  assertPIIKey();
  const client = zoomInfoFromEnv(false);
  await client.discoverTools();
  client.assertRoles(["recommendedContacts", "enrichContacts"]);

  const done: OutreachStep["done"] = [];
  for (const companyId of [...new Set(companyIds)].slice(0, 3)) {
    // Claim once, so duplicate requests cannot repeat a completed/active company.
    const [claim] = await sql<{ zi_company_id: string }[]>`
      update weekly_shortlist set contact_status = 'processing', contact_error = null,
        processing_started_at = now(), paid_started_at = null
      where run_id = ${runId} and zi_company_id = ${companyId} and contact_status in ('pending','failed')
      returning zi_company_id`;
    if (!claim) continue;
    let attemptedCredits = 0;
    try {
      if (!(await eligibleCompanies([companyId])).length) {
        await sql`update weekly_shortlist set contact_status = 'skipped', contact_error = 'Account no longer meets the selection rules.'
          where run_id = ${runId} and zi_company_id = ${companyId}`;
        done.push({ companyId, picked: 0, withEmail: 0, credits: 0, error: "Account no longer meets the selection rules." });
        continue;
      }
      const { recs } = await storeRecommendations(client, companyId);
      const picked = selectCommittee(recs, run.contacts_per_company);
      const ids = picked.map((p) => p.contactId);
      await saveCommittee(sql, runId, companyId, ids);
      const needed = await contactsNeedingEnrichment(companyId, ids);
      if (needed.length) {
        if (!(await eligibleCompanies([companyId])).length) throw new Error('Account eligibility changed.');
        await chargeCredits(runId, needed.length);
        attemptedCredits = needed.length;
        await sql`update weekly_shortlist set paid_started_at = now() where run_id = ${runId} and zi_company_id = ${companyId}`;
        const r = await storeEnrichment(client, companyId, needed);
        if (r.records < needed.length) throw new Error("Some selected contacts were not returned.");
      }
      const withEmail = await committeeEmailCount(runId, companyId);
      await sql`update weekly_shortlist set contacts_enriched = ${withEmail}, contact_status = 'complete'
        where run_id = ${runId} and zi_company_id = ${companyId}`;
      done.push({ companyId, picked: ids.length, withEmail, credits: attemptedCredits });
    } catch {
      const message = attemptedCredits
        ? "Enrichment was interrupted or incomplete. Saved contacts remain available. Paid work will not retry automatically."
        : "Contacts could not be prepared. Check account eligibility, service configuration and the monthly credit limit before continuing.";
      const withEmail = await committeeEmailCount(runId, companyId);
      await sql`update weekly_shortlist set contact_status = ${attemptedCredits ? 'uncertain' : 'failed'}, contact_error = ${message}, contacts_enriched = ${withEmail}
        where run_id = ${runId} and zi_company_id = ${companyId}`;
      done.push({ companyId, picked: 0, withEmail, credits: attemptedCredits, error: message });
      if (attemptedCredits) break;
    }
  }
  const [updated] = await sql<{ credits_spent: number }[]>`select credits_spent from runs where run_id = ${runId}`;
  return { ok: true, done, creditsSoFar: Number(updated.credits_spent) };
}

export async function finishOutreach(runId: string): Promise<{ withEmail: number; credits: number; exportName: string; status: string }> {
  const session = await requireSession();
  if (!UUID_RE.test(runId)) throw new Error("Bad run id.");
  const sql = db();
  await sql`update runs r set
    status = case
      when exists (select 1 from weekly_shortlist w where w.run_id = r.run_id and w.contact_status in ('pending','processing')) then 'running'
      when exists (select 1 from weekly_shortlist w where w.run_id = r.run_id and w.contact_status <> 'complete') then 'partial'
      else 'ok' end,
    finished_at = case when exists (select 1 from weekly_shortlist w where w.run_id = r.run_id and w.contact_status in ('pending','processing')) then null else now() end
    where run_id = ${runId} and job = 'outreach' and actor = ${session.actor}`;
  const [r] = await sql<{ credits_spent: number; status: string; actor: string }[]>`
    select credits_spent, status, actor from runs where run_id = ${runId} and job = 'outreach'`;
  if (!r || r.actor !== session.actor) throw new Error('This list is not available for processing.');
  const ready = await exportContacts(runId);
  const { nextExportName } = await import("./exports");
  revalidateTag("findings");
  revalidateTag("home");
  revalidatePath("/weekly");
  return { withEmail: ready.length, credits: Number(r.credits_spent), exportName: await nextExportName(), status: r.status };
}

/** Explicit continuation processes only untouched companies or free-step failures. */
export async function resumeOutreach(runId: string): Promise<string[]> {
  const session = await requireSession();
  if (!UUID_RE.test(runId)) throw new Error("Bad run id.");
  const sql = db();
  const [run] = await sql<{ actor: string }[]>`select actor from runs where run_id = ${runId} and job = 'outreach' and contact_list_version = 1`;
  if (!run || run.actor !== session.actor) throw new Error("This list is not available for processing.");
  // A timed-out request may have reached the provider. Never replay that paid work.
  await sql`update weekly_shortlist set contact_status = 'uncertain',
    contact_error = 'The previous request was interrupted. Paid work is not retried automatically.'
    where run_id = ${runId} and contact_status = 'processing' and processing_started_at < now() - interval '10 minutes'`;
  await sql`update runs set status = 'running', finished_at = null where run_id = ${runId}`;
  return outreachMembers(runId);
}

/**
 * Reveal one contact's email and phone. Logged in export_log with
 * included_pii = true so the audit trail covers on-screen reveals too.
 */
export async function revealContact(contactId: string): Promise<{ email: string | null; phone: string | null }> {
  const s = await requireSession();
  const sql = db();
  const [r] = await sql<{ email_enc: Buffer | null; phone_enc: Buffer | null }[]>`
    select email_enc, phone_enc from contacts where zi_contact_id = ${contactId} and purge_after > now()`;
  if (!r) return { email: null, phone: null };
  await sql`
    insert into export_log (actor, record_count, filter_json, included_pii)
    values (${s.actor}, 1, ${sql.json({ reveal: contactId })}, true)`;
  return {
    email: r.email_enc ? decryptPII(r.email_enc) : null,
    phone: r.phone_enc ? decryptPII(r.phone_enc) : null,
  };
}
