/**
 * Contact recommendation (free) and contact enrichment (PAID) wrappers.
 * Weekly worker only. Nothing in here may be imported by the daily worker.
 *
 * get_recommended_contacts shape verified live 2026-09-17:
 *   { recommendations: [{ zoominfoContactId, attributes: { rank, score,
 *     reRankingScore, recommendedPersonBrief }, meta: {...} }] }
 *   recommendedPersonBrief = "Name, Title | management_level: [X] | seniority: X
 *     | job_function: [X] | department: [X] | industry: [...] | ..."
 *
 * enrich_contacts numbered-key shape was verified in Oct 2026. Unknown
 * responses stop the list before any further paid batches.
 */

import { ZoomInfoClient } from "./zoominfo";
import { USER_INTENT } from "./search";

export interface Recommendation {
  contactId: string;
  rank: number;
  score: number;
  reRankingScore: number;
  name: string;
  title: string;
  managementLevel: string;
  department: string;
  jobFunction: string;
  tier: "it" | "security" | "csuite" | "other";
  brief: string;
}

export async function recommendedContacts(
  client: ZoomInfoClient,
  companyId: string,
  pageSize = 25
): Promise<Recommendation[]> {
  const res = await client.callJson<{ recommendations?: Record<string, unknown>[] }>("recommendedContacts", {
    ziCompanyId: Number(companyId),
    useCaseType: "PROSPECTING",
    pageSize,
    userIntent: USER_INTENT,
  });
  return (res.recommendations ?? []).map((r) => {
    const a = (r.attributes ?? {}) as Record<string, unknown>;
    const brief = String(a.recommendedPersonBrief ?? "");
    const parsed = parseBrief(brief);
    return {
      contactId: String(r.zoominfoContactId ?? ""),
      rank: Number(a.rank ?? 0),
      score: Number(a.score ?? 0),
      reRankingScore: Number(a.reRankingScore ?? -1),
      ...parsed,
      tier: classifyTier(parsed),
      brief,
    };
  }).filter((r) => r.contactId);
}

/**
 * Two brief formats have been seen live:
 *   2026-09-17  "Name, Title | management_level: [X] | seniority: X | ..."
 *   2026-10-19  "This data describes the job position of a person: job_title: Title | management_level: [X] | ..."
 * The second carries NO name: names now come only from paid enrichment, and
 * the UI shows the title until then. Handle both.
 */
export function parseBrief(brief: string) {
  const [head, ...fields] = brief.split("|").map((s) => s.trim());
  const get = (key: string) => {
    const f = fields.find((x) => x.toLowerCase().startsWith(`${key}:`));
    return f ? f.slice(key.length + 1).replace(/[[\]]/g, "").trim() : "";
  };
  let name = "";
  let title = "";
  const jt = head.match(/job_title:\s*(.*)$/i);
  if (jt) {
    title = jt[1].trim();
  } else {
    const comma = head.indexOf(",");
    name = comma >= 0 ? head.slice(0, comma).trim() : head.trim();
    title = comma >= 0 ? head.slice(comma + 1).trim() : "";
    if (/^this data describes/i.test(name)) name = "";
  }
  return {
    name,
    title,
    managementLevel: get("management_level"),
    department: get("department"),
    jobFunction: get("job_function"),
  };
}

const SECURITY_RE = /\b(security|ciso|infosec|soc|cyber|risk|compliance|grc)\b/i;
const CSUITE_RE = /\b(ceo|cfo|coo|cio|cto|ciso|owner|founder|managing partner)\b|\bchief (executive|financial|operating|information security|information|technology|security|risk|compliance) officer\b|^(co-)?president\b/i;
const IT_TITLE_RE = /\b(it|information technology|infrastructure|network|networking|systems|cloud|technology|helpdesk|service desk|end user)\b/i;
const NOT_IT_RE = /\b(software|product|data science|machine learning|qa|quality|r&d|research|design)\b/i;
const LEADER_RE = /\b(director|vp|vice president|manager|head|lead|c-level|c level)\b/i;

/**
 * Buying committee per docs/ARCHITECTURE.md §ICP: IT leadership, security
 * leadership, relevant C-suite. Everyone else is "other" and never selected.
 *
 * Tuned against live recommendations 2026-09-17: ZoomInfo writes "C-Level"
 * with a hyphen; "Engineering & Technical" is mostly software engineering,
 * which is not the IT buyer, so IT needs the Information Technology
 * department or an infrastructure-flavoured title, and never a software one.
 * Board members are excluded outright.
 */
export function classifyTier(p: { title: string; managementLevel: string; department: string; jobFunction: string }): Recommendation["tier"] {
  const t = `${p.title} ${p.jobFunction}`;
  if (/board/i.test(p.managementLevel)) return "other";
  const leader = LEADER_RE.test(`${p.managementLevel} ${p.title}`) || CSUITE_RE.test(p.title);
  if (SECURITY_RE.test(t) && leader && !/physical security|loss prevention|security guard/i.test(t)) return "security";
  if (CSUITE_RE.test(p.title) || (/c[- ]level/i.test(p.managementLevel) && !p.title &&
      /finance|operations|information technology/i.test(`${p.department} ${p.jobFunction}`))) return "csuite";
  const itDept = /information technology/i.test(p.department);
  const itTitle = IT_TITLE_RE.test(t) && !NOT_IT_RE.test(t);
  if ((itDept || itTitle) && !NOT_IT_RE.test(t) && LEADER_RE.test(`${p.managementLevel} ${p.title}`)) return "it";
  return "other";
}

/**
 * Pick up to `max` contacts covering the three tiers: round-robin one per
 * tier (security, IT, C-suite) in recommendation order, then a second pass,
 * so a five-person cap never misses a whole tier. "other" is never picked.
 * Free step; nothing here spends.
 */
export function selectCommittee(recs: Recommendation[], max = 5): Recommendation[] {
  const unique = [...new Map(recs.map((r) => [r.contactId, r])).values()];
  const ordered = unique.sort((a, b) =>
    (b.reRankingScore >= 0 && a.reRankingScore >= 0 ? b.reRankingScore - a.reRankingScore : 0) || a.rank - b.rank
  );
  const queues: Record<"security" | "it" | "csuite", Recommendation[]> = {
    security: ordered.filter((r) => r.tier === "security"),
    it: ordered.filter((r) => r.tier === "it"),
    csuite: ordered.filter((r) => r.tier === "csuite"),
  };
  const picked: Recommendation[] = [];
  let progress = true;
  while (picked.length < max && progress) {
    progress = false;
    for (const tier of ["security", "it", "csuite"] as const) {
      const next = queues[tier].shift();
      if (next && picked.length < max) {
        picked.push(next);
        progress = true;
      }
    }
  }
  return picked;
}

export interface EnrichedContact {
  contactId: string;
  firstName: string;
  lastName: string;
  title: string | null;
  managementLevel: string | null;
  email: string | null;
  phone: string | null;
  accuracy: number | null;
  companyId: string | null;
}

/**
 * PAID. 1 bulk credit per contact not already under management (12 months).
 * Max 10 per call. Do-not-call flags are honoured here: a flagged number is
 * dropped before it can ever be stored.
 */
export async function enrichContacts(client: ZoomInfoClient, contactIds: string[]): Promise<EnrichedContact[]> {
  const out: EnrichedContact[] = [];
  for (let i = 0; i < contactIds.length; i += 10) {
    const batch = contactIds.slice(i, i + 10);
    const res = await client.callJson<unknown>("enrichContacts", {
      contacts: batch.map((personId) => ({ personId })),
      requiredFields: [
        "firstName",
        "lastName",
        "email",
        "phone",
        "mobilePhone",
        "jobTitle",
        "managementLevel",
        "contactAccuracyScore",
        "zoominfoCompanyId",
        "directPhoneDoNotCall",
        "mobilePhoneDoNotCall",
      ],
      userIntent: USER_INTENT,
    });
    out.push(...parseEnriched(res));
  }
  return out;
}

/**
 * Accepts the live shape, verified from Seb's first paid click on 2026-09-18:
 *   { contact_1: {...}, contact_2: {...}, totalEnriched: n, totalErrors: n }
 * plus the envelopes the docs suggested ({data:[...]}, {results:[...]},
 * {contacts:[...]}, bare array) in case ZoomInfo changes it back.
 */
export function parseEnriched(res: unknown): EnrichedContact[] {
  const root = (res ?? {}) as Record<string, unknown>;
  let list: unknown = Array.isArray(res) ? res : root.data ?? root.results ?? root.contacts ?? root.enriched ?? root.result;
  if (!Array.isArray(list)) {
    const numbered = Object.keys(root)
      .filter((k) => /^contact_\d+$/.test(k))
      .sort((a, b) => Number(a.slice(8)) - Number(b.slice(8)))
      .map((k) => root[k])
      .filter((v) => v && typeof v === "object");
    if (numbered.length || typeof root.totalEnriched === "number") list = numbered;
  }
  if (!Array.isArray(list)) {
    throw new Error(
      `enrich_contacts: unrecognised response shape (keys: ${Object.keys(root).join(",")}). Aborting before further spend.`
    );
  }
  return list.map((row) => {
    const r = row as Record<string, unknown>;
    // Numbered entries may wrap the record one level down ({ data: {...} } or { result: {...} }).
    const a = ((r.attributes ?? r.data ?? r.result ?? r) as Record<string, unknown>) ?? {};
    const directDnc = a.directPhoneDoNotCall === true || a.directPhoneDoNotCall === "true";
    const mobileDnc = a.mobilePhoneDoNotCall === true || a.mobilePhoneDoNotCall === "true";
    const direct = directDnc ? null : str(a.phone ?? a.directPhone);
    const mobile = mobileDnc ? null : str(a.mobilePhone);
    return {
      contactId: String(r.id ?? a.id ?? a.personId ?? a.zoominfoContactId ?? ""),
      firstName: str(a.firstName) ?? "",
      lastName: str(a.lastName) ?? "",
      title: str(a.jobTitle ?? a.title),
      managementLevel: str(a.managementLevel),
      email: str(a.email),
      phone: direct ?? mobile,
      accuracy: a.contactAccuracyScore === undefined ? null : Number(a.contactAccuracyScore),
      companyId: str(a.zoominfoCompanyId ?? a.companyId),
    };
  }).filter((c) => c.contactId);
}

function str(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  return String(v);
}

// ---------- storage, shared by the Sunday job and the dashboard actions ----------

import { db } from "./db";
import { encryptPII, assertPIIKey } from "./crypto";
import { SUPPRESSING_TAGS } from "./contact-lists";
import type { Sql } from "postgres";

/** Retention window for enriched contact PII. Confirm with Seb. */
export const PII_RETENTION_DAYS = 180;

/**
 * FREE. Fetch recommendations for a company and store everyone as a contact
 * row with name, title, tier and rank but no email/phone. Returns how many
 * rows were written. Safe to call from a click; spends nothing.
 */
export async function storeRecommendations(
  client: ZoomInfoClient,
  companyId: string,
  limit = 25
): Promise<{ stored: number; recs: Recommendation[] }> {
  const recs = await recommendedContacts(client, companyId, limit);
  const sql = db();
  let n = 0;
  for (const r of recs) {
    // Name may be empty (ZoomInfo dropped it from the brief in Oct 2026); an
    // enriched name on the existing row is never overwritten by an empty one.
    await sql`
      insert into contacts (zi_contact_id, zi_company_id, full_name, title, seniority, department,
                            tier, rec_rank, rec_score, recommended_at)
      values (${r.contactId}, ${companyId}, ${r.name}, ${r.title || null}, ${r.managementLevel || null},
              ${r.department || null}, ${r.tier}, ${r.rank}, ${r.reRankingScore >= 0 ? r.reRankingScore : r.score},
              now())
      on conflict (zi_contact_id) do update
        set full_name = case when excluded.full_name = '' then contacts.full_name else excluded.full_name end,
            title = coalesce(nullif(excluded.title, ''), contacts.title),
            seniority = coalesce(excluded.seniority, contacts.seniority),
            department = coalesce(excluded.department, contacts.department),
            tier = excluded.tier, rec_rank = excluded.rec_rank, rec_score = excluded.rec_score,
            recommended_at = now()`;
    n++;
  }
  const allowed = await sql<{ zi_contact_id: string }[]>`
    select zi_contact_id from contacts where zi_company_id = ${companyId}
      and zi_contact_id = any(${recs.map((r) => r.contactId)})
      and not (tags && ${SUPPRESSING_TAGS}::text[])`;
  const allowedIds = new Set(allowed.map((r) => r.zi_contact_id));
  return { stored: n, recs: recs.filter((r) => allowedIds.has(r.contactId)) };
}

/**
 * PAID. Enrich the given contacts and store email/phone encrypted. Returns the
 * number of records returned. Callers charge the requested count in `runs`
 * before the call, including failures (RUM can make the actual spend lower).
 */
export async function storeEnrichment(
  client: ZoomInfoClient,
  companyId: string,
  contactIds: string[],
  sql: Sql = db()
): Promise<{ records: number; withEmail: number }> {
  assertPIIKey();
  const enriched = await enrichContacts(client, contactIds);
  if (new Set(enriched.map((c) => c.contactId)).size !== enriched.length ||
      enriched.some((c) => !contactIds.includes(c.contactId) || (c.companyId && c.companyId !== companyId))) {
    throw new Error("ZoomInfo returned a contact outside the selected company. No contact details were saved.");
  }
  let withEmail = 0;
  for (const c of enriched) {
    const fullName = `${c.firstName} ${c.lastName}`.trim();
    if (c.email) withEmail++;
    await sql`
      insert into contacts (zi_contact_id, zi_company_id, full_name, title, seniority,
                            email_enc, phone_enc, enriched_at, purge_after)
      values (${c.contactId}, ${companyId}, ${fullName}, ${c.title}, ${c.managementLevel},
              ${c.email ? encryptPII(c.email) : null}, ${c.phone ? encryptPII(c.phone) : null},
              now(), now() + ${`${PII_RETENTION_DAYS} days`}::interval)
      on conflict (zi_contact_id) do update
        set full_name = case when excluded.full_name = '' then contacts.full_name else excluded.full_name end,
            title = coalesce(excluded.title, contacts.title),
            seniority = coalesce(excluded.seniority, contacts.seniority),
            email_enc = excluded.email_enc,
            phone_enc = excluded.phone_enc,
            enriched_at = now(),
            purge_after = excluded.purge_after`;
  }
  return { records: enriched.length, withEmail };
}

export function zoomInfoFromEnv(freeOnly: boolean): ZoomInfoClient {
  const need = (k: string) => {
    const v = process.env[k];
    if (!v) throw new Error(`${k} is not set`);
    return v;
  };
  return new ZoomInfoClient({
    clientId: need("ZI_CLIENT_ID"),
    clientSecret: need("ZI_CLIENT_SECRET"),
    tokenUrl: process.env.ZI_TOKEN_URL,
    scope: process.env.ZI_SCOPE,
    freeOnly,
  });
}
