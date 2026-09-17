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
 * enrich_contacts shape is NOT yet verified (paid; first call happens in the
 * first Sunday run). parseEnriched() accepts the common ZoomInfo envelopes and
 * throws loudly if it recognises nothing, so a shape surprise costs one call.
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

function parseBrief(brief: string) {
  const [head, ...fields] = brief.split("|").map((s) => s.trim());
  const comma = head.indexOf(",");
  const name = comma >= 0 ? head.slice(0, comma).trim() : head;
  const title = comma >= 0 ? head.slice(comma + 1).trim() : "";
  const get = (key: string) => {
    const f = fields.find((x) => x.toLowerCase().startsWith(`${key}:`));
    return f ? f.slice(key.length + 1).replace(/[[\]]/g, "").trim() : "";
  };
  return {
    name,
    title,
    managementLevel: get("management_level"),
    department: get("department"),
    jobFunction: get("job_function"),
  };
}

const SECURITY_RE = /\b(security|ciso|infosec|soc|cyber|risk|compliance|grc)\b/i;
const CSUITE_RE = /\b(ceo|cfo|coo|cio|cto|ciso|president|owner|founder|managing partner|chief)\b/i;
const IT_TITLE_RE = /\b(it|information technology|infrastructure|network|networking|systems|cloud|technology|helpdesk|service desk|end user)\b/i;
const NOT_IT_RE = /\b(software|product|data science|machine learning|qa|quality|r&d|research|design)\b/i;
const LEADER_RE = /\b(director|vp|vice president|manager|head|lead|c-level|c level)\b/i;

/**
 * Buying committee per docs/ARCHITECTURE.md §ICP: IT leadership, security
 * leadership, C-suite. Everyone else is "other" and only used as filler.
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
  if (SECURITY_RE.test(t)) return "security";
  if (/c[- ]level/i.test(p.managementLevel) || CSUITE_RE.test(p.title)) return "csuite";
  const itDept = /information technology/i.test(p.department);
  const itTitle = IT_TITLE_RE.test(t) && !NOT_IT_RE.test(t);
  if ((itDept || itTitle) && !NOT_IT_RE.test(t) && LEADER_RE.test(`${p.managementLevel} ${p.title}`)) return "it";
  return "other";
}

/**
 * Pick up to `max` contacts covering the three tiers, in recommendation order
 * within each tier. Free step; nothing here spends.
 */
export function selectCommittee(recs: Recommendation[], max = 5): Recommendation[] {
  const ordered = [...recs].sort((a, b) =>
    (b.reRankingScore >= 0 && a.reRankingScore >= 0 ? b.reRankingScore - a.reRankingScore : 0) || a.rank - b.rank
  );
  const quota: Record<Recommendation["tier"], number> = { it: 2, security: 2, csuite: 2, other: 0 };
  const picked: Recommendation[] = [];
  for (const tier of ["security", "it", "csuite"] as const) {
    for (const r of ordered) {
      if (picked.length >= max) break;
      if (r.tier === tier && quota[tier] > 0 && !picked.includes(r)) {
        picked.push(r);
        quota[tier]--;
      }
    }
  }
  for (const r of ordered) {
    if (picked.length >= max) break;
    if (!picked.includes(r) && r.tier !== "other") picked.push(r);
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

/** Accepts {data:[{id,attributes}]}, {results:[...]}, {contacts:[...]} or a bare array. */
export function parseEnriched(res: unknown): EnrichedContact[] {
  const root = res as Record<string, unknown>;
  const list: unknown =
    Array.isArray(res) ? res : root.data ?? root.results ?? root.contacts ?? root.enriched ?? root.result;
  if (!Array.isArray(list)) {
    throw new Error(
      `enrich_contacts: unrecognised response shape (keys: ${Object.keys(root ?? {}).join(",")}). Aborting before further spend.`
    );
  }
  return list.map((row) => {
    const r = row as Record<string, unknown>;
    const a = ((r.attributes ?? r.data ?? r) as Record<string, unknown>) ?? {};
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
import { encryptPII } from "./crypto";

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
    if (!r.name) continue;
    await sql`
      insert into contacts (zi_contact_id, zi_company_id, full_name, title, seniority, department,
                            tier, rec_rank, rec_score, recommended_at)
      values (${r.contactId}, ${companyId}, ${r.name}, ${r.title || null}, ${r.managementLevel || null},
              ${r.department || null}, ${r.tier}, ${r.rank}, ${r.reRankingScore >= 0 ? r.reRankingScore : r.score},
              now())
      on conflict (zi_contact_id) do update
        set full_name = excluded.full_name,
            title = coalesce(contacts.title, excluded.title),
            seniority = coalesce(excluded.seniority, contacts.seniority),
            department = coalesce(excluded.department, contacts.department),
            tier = excluded.tier, rec_rank = excluded.rec_rank, rec_score = excluded.rec_score,
            recommended_at = now()`;
    n++;
  }
  return { stored: n, recs };
}

/**
 * PAID. Enrich the given contacts and store email/phone encrypted. Returns the
 * number of records returned by ZoomInfo, which is the upper bound on credits
 * spent (records already under management are free). Caller records it in
 * `runs`.
 */
export async function storeEnrichment(
  client: ZoomInfoClient,
  companyId: string,
  contactIds: string[]
): Promise<{ records: number; withEmail: number }> {
  const enriched = await enrichContacts(client, contactIds);
  const sql = db();
  let withEmail = 0;
  for (const c of enriched) {
    const fullName = `${c.firstName} ${c.lastName}`.trim();
    if (c.email) withEmail++;
    await sql`
      insert into contacts (zi_contact_id, zi_company_id, full_name, title, seniority,
                            email_enc, phone_enc, enriched_at, purge_after)
      values (${c.contactId}, ${companyId}, ${fullName || "Unknown"}, ${c.title}, ${c.managementLevel},
              ${c.email ? encryptPII(c.email) : null}, ${c.phone ? encryptPII(c.phone) : null},
              now(), now() + ${`${PII_RETENTION_DAYS} days`}::interval)
      on conflict (zi_contact_id) do update
        set full_name = case when excluded.full_name = 'Unknown' then contacts.full_name else excluded.full_name end,
            title = coalesce(excluded.title, contacts.title),
            seniority = coalesce(excluded.seniority, contacts.seniority),
            email_enc = coalesce(excluded.email_enc, contacts.email_enc),
            phone_enc = coalesce(excluded.phone_enc, contacts.phone_enc),
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
