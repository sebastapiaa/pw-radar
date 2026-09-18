/**
 * Read queries for the dashboard. Server-only. Contact PII never leaves this
 * module in plaintext except through revealContact() in actions.ts, which logs.
 */

import { unstable_cache } from "next/cache";
import { db } from "./db";
import { maskEmail } from "./crypto";

export const SUPPRESSING_TAGS = ["client", "do-not-contact"];
export const LIST_WINDOW_DAYS = 30;

export { sizeBand, type SizeBand } from "./format";

export interface FindingRow {
  findingId: number;
  companyId: string;
  name: string;
  domain: string | null;
  employeeCount: number | null;
  city: string | null;
  state: string | null;
  source: string;
  tags: string[];
  score: number;
  signalCount: number;
  icpFit: number;
  signalStrength: number;
  recencyDecay: number;
  stackBonus: number;
  whyNow: string | null;
  freshestSignal: string | null; // ISO date
  ageDays: number | null;
  lastOutcome: string | null;
  contactCount: number;
  noteCount: number;
  gateStatus: string;
  gateReason: string | null;
}

/**
 * Best finding per company over the window, ranked. Companies tagged client,
 * do-not-contact, partner:* or excluded:* are hidden even if a finding exists
 * from before the tag was applied. Gate-killed accounts are hidden too.
 */
export async function rankedFindings(limit = 200): Promise<FindingRow[]> {
  const sql = db();
  const rows = await sql<Record<string, unknown>[]>`
    with best as (
      select distinct on (zi_company_id) *
      from findings
      where created_at > now() - ${`${LIST_WINDOW_DAYS} days`}::interval
      order by zi_company_id, score desc, created_at desc
    )
    select b.id as finding_id, b.zi_company_id, c.name, c.domain, c.employee_count, c.city, c.state,
           c.source, c.tags, c.gate_status, c.gate_reason, b.score, b.signal_count, b.icp_fit, b.signal_strength,
           b.recency_decay, b.stack_bonus, b.why_now,
           (select max(signal_date) from signals s where s.zi_company_id = b.zi_company_id) as freshest,
           (select status from outcomes o where o.zi_company_id = b.zi_company_id
              order by noted_at desc limit 1) as last_outcome,
           (select count(*) from contacts k where k.zi_company_id = b.zi_company_id)::int as contact_count,
           (select count(*) from notes n where n.entity_type = 'company' and n.entity_id = b.zi_company_id)::int as note_count
    from best b join companies c using (zi_company_id)
    where not (c.tags && ${SUPPRESSING_TAGS}::text[])
      and c.gate_status <> 'killed'
      and not exists (select 1 from unnest(c.tags) t where t like 'partner:%' or t like 'excluded:%')
    order by b.score desc, freshest desc nulls last
    limit ${limit}`;
  return rows.map(toFindingRow);
}

/**
 * Cached for 60s and invalidated by every write action (revalidateTag).
 * The workers write outside Next, so the TTL covers those; a run's new
 * findings appear within a minute.
 */
export const cachedRankedFindings = unstable_cache(
  async (limit: number) => rankedFindings(limit),
  ["ranked-findings"],
  { revalidate: 60, tags: ["findings"] }
);

function toFindingRow(r: Record<string, unknown>): FindingRow {
  const freshest = r.freshest ? new Date(r.freshest as string) : null;
  return {
    findingId: Number(r.finding_id),
    companyId: String(r.zi_company_id),
    name: String(r.name),
    domain: (r.domain as string) ?? null,
    employeeCount: r.employee_count === null ? null : Number(r.employee_count),
    city: (r.city as string) ?? null,
    state: (r.state as string) ?? null,
    source: String(r.source),
    tags: (r.tags as string[]) ?? [],
    score: Number(r.score),
    signalCount: Number(r.signal_count),
    icpFit: Number(r.icp_fit),
    signalStrength: Number(r.signal_strength),
    recencyDecay: Number(r.recency_decay),
    stackBonus: Number(r.stack_bonus),
    whyNow: (r.why_now as string) ?? null,
    freshestSignal: freshest ? freshest.toISOString().slice(0, 10) : null,
    ageDays: freshest ? Math.max(0, Math.round((Date.now() - freshest.getTime()) / 86_400_000)) : null,
    lastOutcome: (r.last_outcome as string) ?? null,
    contactCount: Number(r.contact_count ?? 0),
    noteCount: Number(r.note_count ?? 0),
    gateStatus: String(r.gate_status ?? "pending"),
    gateReason: (r.gate_reason as string) ?? null,
  };
}

export interface SignalRow {
  id: number;
  kind: string;
  topic: string | null;
  headline: string | null;
  rawScore: number | null;
  audienceStrength: string | null;
  signalDate: string | null;
  scopeName: string | null;
  scopeSlug: string | null;
  link: string | null;
}

export async function signalsForCompany(companyId: string, limit = 40): Promise<SignalRow[]> {
  const sql = db();
  const rows = await sql<Record<string, unknown>[]>`
    select s.id, s.signal_kind, s.topic, s.headline, s.raw_score, s.audience_strength, s.signal_date,
           sc.name as scope_name, sc.slug as scope_slug,
           s.raw->'attributes'->>'link' as link
    from signals s
    left join lateral (
      select name, slug from scopes where s.topic = any(intent_topics) limit 1
    ) sc on true
    where s.zi_company_id = ${companyId}
    order by s.signal_date desc nulls last, s.raw_score desc nulls last
    limit ${limit}`;
  return rows.map((r) => ({
    id: Number(r.id),
    kind: String(r.signal_kind),
    topic: (r.topic as string) ?? null,
    headline: (r.headline as string) ?? null,
    rawScore: r.raw_score === null ? null : Number(r.raw_score),
    audienceStrength: (r.audience_strength as string) ?? null,
    signalDate: r.signal_date ? new Date(r.signal_date as string).toISOString().slice(0, 10) : null,
    scopeName: (r.scope_name as string) ?? null,
    scopeSlug: (r.scope_slug as string) ?? null,
    link: (r.link as string) ?? null,
  }));
}

export interface ContactRow {
  id: string;
  fullName: string;
  title: string | null;
  seniority: string | null;
  department: string | null;
  tier: string | null;
  recRank: number | null;
  emailMasked: string | null;
  hasPhone: boolean;
  tags: string[];
  enrichedAt: string | null;
}

/**
 * Masked by default. Plaintext only via revealContact() in actions.ts.
 * Order: buying-committee tiers first, then recommendation rank.
 */
export async function contactsForCompany(companyId: string): Promise<ContactRow[]> {
  const sql = db();
  const rows = await sql<Record<string, unknown>[]>`
    select zi_contact_id, full_name, title, seniority, department, tier, rec_rank,
           email_enc, phone_enc, tags, enriched_at
    from contacts where zi_company_id = ${companyId}
    order by case tier when 'security' then 0 when 'it' then 1 when 'csuite' then 2 else 3 end,
             rec_rank nulls last, full_name`;
  const { decryptPII } = await import("./crypto");
  return rows.map((r) => {
    let emailMasked: string | null = null;
    if (r.email_enc) {
      try {
        emailMasked = maskEmail(decryptPII(r.email_enc as Buffer));
      } catch {
        emailMasked = "•••";
      }
    }
    return {
      id: String(r.zi_contact_id),
      fullName: String(r.full_name),
      title: (r.title as string) ?? null,
      seniority: (r.seniority as string) ?? null,
      department: (r.department as string) ?? null,
      tier: (r.tier as string) ?? null,
      recRank: r.rec_rank === null || r.rec_rank === undefined ? null : Number(r.rec_rank),
      emailMasked,
      hasPhone: !!r.phone_enc,
      tags: (r.tags as string[]) ?? [],
      enrichedAt: r.enriched_at ? new Date(r.enriched_at as string).toISOString().slice(0, 10) : null,
    };
  });
}

export interface NoteRow {
  id: number;
  actor: string;
  body: string;
  createdAt: string;
}

export async function notesFor(entityType: "company" | "contact", entityId: string): Promise<NoteRow[]> {
  const sql = db();
  const rows = await sql<Record<string, unknown>[]>`
    select id, actor, body, created_at from notes
    where entity_type = ${entityType} and entity_id = ${entityId}
    order by created_at desc limit 50`;
  return rows.map((r) => ({
    id: Number(r.id),
    actor: String(r.actor),
    body: String(r.body),
    createdAt: new Date(r.created_at as string).toISOString(),
  }));
}

export interface OutcomeRow {
  status: string;
  actor: string;
  notedAt: string;
  note: string | null;
}

export async function outcomesFor(companyId: string): Promise<OutcomeRow[]> {
  const sql = db();
  const rows = await sql<Record<string, unknown>[]>`
    select status, actor, noted_at, note from outcomes
    where zi_company_id = ${companyId} order by noted_at desc limit 20`;
  return rows.map((r) => ({
    status: String(r.status),
    actor: String(r.actor),
    notedAt: new Date(r.noted_at as string).toISOString(),
    note: (r.note as string) ?? null,
  }));
}

export interface CompanyRow {
  companyId: string;
  name: string;
  domain: string | null;
  employeeCount: number | null;
  industry: string | null;
  city: string | null;
  state: string | null;
  source: string;
  tags: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  gateStatus?: string;
  gateReason?: string | null;
  parentCompanyId?: string | null;
  locationType?: string | null;
  employmentTrend?: string | null;
}

export async function companyById(companyId: string): Promise<CompanyRow | null> {
  const sql = db();
  const [r] = await sql<Record<string, unknown>[]>`
    select zi_company_id, name, domain, employee_count, industry, city, state, source, tags,
           first_seen_at, last_seen_at, gate_status, gate_reason, parent_company_id, location_type, employment_trend
    from companies where zi_company_id = ${companyId}`;
  if (!r) return null;
  return {
    gateStatus: String(r.gate_status ?? "pending"),
    gateReason: (r.gate_reason as string) ?? null,
    parentCompanyId: (r.parent_company_id as string) ?? null,
    locationType: (r.location_type as string) ?? null,
    employmentTrend: (r.employment_trend as string) ?? null,
    companyId: String(r.zi_company_id),
    name: String(r.name),
    domain: (r.domain as string) ?? null,
    employeeCount: r.employee_count === null ? null : Number(r.employee_count),
    industry: (r.industry as string) ?? null,
    city: (r.city as string) ?? null,
    state: (r.state as string) ?? null,
    source: String(r.source),
    tags: (r.tags as string[]) ?? [],
    firstSeenAt: new Date(r.first_seen_at as string).toISOString(),
    lastSeenAt: new Date(r.last_seen_at as string).toISOString(),
  };
}

export interface FindingHistoryRow {
  score: number;
  signalCount: number;
  whyNow: string | null;
  createdAt: string;
}

export async function findingHistory(companyId: string): Promise<FindingHistoryRow[]> {
  const sql = db();
  const rows = await sql<Record<string, unknown>[]>`
    select score, signal_count, why_now, created_at from findings
    where zi_company_id = ${companyId} order by created_at desc limit 30`;
  return rows.map((r) => ({
    score: Number(r.score),
    signalCount: Number(r.signal_count),
    whyNow: (r.why_now as string) ?? null,
    createdAt: new Date(r.created_at as string).toISOString().slice(0, 10),
  }));
}

export interface ProfileBody {
  text: string;
  spans: { start: number; end: number; signal_id: number; scope_slug: string }[];
}

export async function profileFor(companyId: string): Promise<{ body: ProfileBody; model: string; generatedAt: string } | null> {
  const sql = db();
  const [r] = await sql<Record<string, unknown>[]>`
    select body, model, generated_at from account_profiles where zi_company_id = ${companyId}`;
  if (!r) return null;
  return {
    body: r.body as ProfileBody,
    model: String(r.model),
    generatedAt: new Date(r.generated_at as string).toISOString().slice(0, 10),
  };
}

export interface HeaderStats {
  thisWeek: number;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  creditsSpentWeek: number;
}

/** One round trip for the four header numbers. */
export async function headerStats(): Promise<HeaderStats> {
  const sql = db();
  const [r] = await sql<{ this_week: number; last_run_at: Date | null; last_run_status: string | null; credits_week: number }[]>`
    select
      (select count(distinct zi_company_id)::int from findings where created_at > now() - interval '7 days') as this_week,
      (select started_at from runs order by started_at desc limit 1) as last_run_at,
      (select status from runs order by started_at desc limit 1) as last_run_status,
      (select coalesce(sum(credits_spent), 0)::int from runs where started_at > now() - interval '7 days') as credits_week`;
  return {
    thisWeek: r?.this_week ?? 0,
    lastRunAt: r?.last_run_at ? new Date(r.last_run_at).toISOString() : null,
    lastRunStatus: r?.last_run_status ?? null,
    creditsSpentWeek: r?.credits_week ?? 0,
  };
}

export interface HomeData {
  stats: HeaderStats;
  top: FindingRow[];
  scoops: ScoopEvent[];
  topics: TopicCount[];
  working: WorkingRow[];
  runs: RunRow[];
  seeded: CompanyRow[];
  gate: GateSummary | null;
}

async function homeData(): Promise<HomeData> {
  const [stats, top, scoops, topics, working, runs, seeded, gate] = await Promise.all([
    headerStats(),
    rankedFindings(10),
    recentScoops(7, 8),
    topicsThisWeek(7),
    workingAccounts(6),
    recentRuns(3),
    seededAccounts(5),
    latestGateSummary(),
  ]);
  return { stats, top, scoops, topics, working, runs, seeded, gate };
}

/** Whole home page in one cached unit. 60s TTL, invalidated on writes. */
export const cachedHomeData = unstable_cache(homeData, ["home-data"], { revalidate: 60, tags: ["home", "findings"] });

// ---------- verification gate ----------

export interface GateSummary {
  runId: string;
  startedAt: string;
  candidates: number;
  passed: number;
  flagged: number;
  killed: number;
  awaitingApproval: number;
  byCheck: { check: string; verdict: string; n: number }[];
  reasons: { check: string; verdict: string; reason: string; n: number }[];
  perTopic: { topic: string; candidates: number; killed: number; flagged: number }[];
}

export async function latestGateSummary(): Promise<GateSummary | null> {
  const sql = db();
  const [run] = await sql<{ run_id: string; started_at: Date }[]>`
    select run_id, started_at from runs
    where run_id in (select distinct run_id from gate_decisions)
    order by started_at desc limit 1`;
  if (!run) return null;
  const byCheck = await sql<{ check: string; verdict: string; n: number }[]>`
    select check_name as check, verdict, count(*)::int as n from gate_decisions
    where run_id = ${run.run_id} group by 1, 2 order by 1, 2`;
  const reasons = await sql<{ check: string; verdict: string; reason: string; n: number }[]>`
    select check_name as check, verdict, reason, count(*)::int as n from gate_decisions
    where run_id = ${run.run_id} and verdict in ('kill','flag') and reason is not null
    group by 1, 2, 3 order by 4 desc limit 20`;
  const [overall] = await sql<{ candidates: number; passed: number; flagged: number; killed: number }[]>`
    with per_company as (
      select zi_company_id,
             bool_or(verdict = 'kill') as killed,
             bool_or(verdict = 'flag' and check_name <> 'corroboration') as flagged
      from gate_decisions where run_id = ${run.run_id} group by 1)
    select count(*)::int as candidates,
           count(*) filter (where not killed and not flagged)::int as passed,
           count(*) filter (where flagged and not killed)::int as flagged,
           count(*) filter (where killed)::int as killed
    from per_company`;
  const [{ n: awaiting }] = await sql<{ n: number }[]>`
    select count(*)::int as n from companies where gate_status = 'flagged'`;
  const perTopic = await sql<{ topic: string; candidates: number; killed: number; flagged: number }[]>`
    with per_company as (
      select zi_company_id,
             bool_or(verdict = 'kill') as killed,
             bool_or(verdict = 'flag' and check_name <> 'corroboration') as flagged
      from gate_decisions where run_id = ${run.run_id} group by 1),
    topics as (
      select distinct s.zi_company_id, s.topic from signals s
      join per_company p using (zi_company_id)
      where s.signal_kind = 'intent' and s.signal_date > current_date - 30)
    select t.topic, count(*)::int as candidates,
           count(*) filter (where p.killed)::int as killed,
           count(*) filter (where p.flagged and not p.killed)::int as flagged
    from topics t join per_company p using (zi_company_id)
    group by 1 order by 2 desc limit 25`;
  return {
    runId: run.run_id,
    startedAt: new Date(run.started_at).toISOString(),
    candidates: overall?.candidates ?? 0,
    passed: overall?.passed ?? 0,
    flagged: overall?.flagged ?? 0,
    killed: overall?.killed ?? 0,
    awaitingApproval: awaiting,
    byCheck,
    reasons,
    perTopic,
  };
}

export interface FlaggedRow {
  companyId: string;
  name: string;
  reason: string | null;
  score: number | null;
  decisions: { check: string; verdict: string; reason: string | null }[];
}

export async function flaggedAwaiting(limit = 50): Promise<FlaggedRow[]> {
  const sql = db();
  const rows = await sql<Record<string, unknown>[]>`
    select c.zi_company_id, c.name, c.gate_reason,
           (select max(score) from findings f where f.zi_company_id = c.zi_company_id
              and f.created_at > now() - interval '30 days') as score,
           (select json_agg(json_build_object('check', d.check_name, 'verdict', d.verdict, 'reason', d.reason) order by d.id)
              from gate_decisions d where d.zi_company_id = c.zi_company_id
                and d.run_id = (select run_id from gate_decisions where zi_company_id = c.zi_company_id order by created_at desc limit 1)) as decisions
    from companies c where c.gate_status = 'flagged'
    order by score desc nulls last limit ${limit}`;
  return rows.map((r) => ({
    companyId: String(r.zi_company_id),
    name: String(r.name),
    reason: (r.gate_reason as string) ?? null,
    score: r.score === null ? null : Number(r.score),
    decisions: (r.decisions as FlaggedRow["decisions"]) ?? [],
  }));
}

export async function gateDecisionsFor(companyId: string): Promise<{ check: string; verdict: string; reason: string | null; createdAt: string }[]> {
  const sql = db();
  const rows = await sql<Record<string, unknown>[]>`
    select check_name, verdict, reason, created_at from gate_decisions
    where zi_company_id = ${companyId}
      and run_id = (select run_id from gate_decisions where zi_company_id = ${companyId} order by created_at desc limit 1)
    order by id`;
  return rows.map((r) => ({
    check: String(r.check_name),
    verdict: String(r.verdict),
    reason: (r.reason as string) ?? null,
    createdAt: new Date(r.created_at as string).toISOString().slice(0, 10),
  }));
}

export interface ScoopEvent {
  signalId: number;
  companyId: string;
  companyName: string;
  employeeCount: number | null;
  type: string | null;
  headline: string | null;
  link: string | null;
  signalDate: string | null;
}

/** Fresh business events this week: job posts, exec moves, projects. */
export async function recentScoops(days = 7, limit = 12): Promise<ScoopEvent[]> {
  const sql = db();
  const rows = await sql<Record<string, unknown>[]>`
    select s.id, s.zi_company_id, c.name, c.employee_count, s.topic, s.headline, s.signal_date,
           s.raw->'attributes'->>'link' as link
    from signals s join companies c using (zi_company_id)
    where s.signal_kind = 'scoop' and s.signal_date > current_date - ${days}::int
      and not (c.tags && ${SUPPRESSING_TAGS}::text[])
    order by s.signal_date desc, s.id desc limit ${limit}`;
  return rows.map((r) => ({
    signalId: Number(r.id),
    companyId: String(r.zi_company_id),
    companyName: String(r.name),
    employeeCount: r.employee_count === null ? null : Number(r.employee_count),
    type: (r.topic as string) ?? null,
    headline: (r.headline as string) ?? null,
    link: (r.link as string) ?? null,
    signalDate: r.signal_date ? new Date(r.signal_date as string).toISOString().slice(0, 10) : null,
  }));
}

export interface TopicCount {
  topic: string;
  scopeName: string | null;
  companies: number;
}

/** Which intent topics fired this week, by distinct company. Core topics only. */
export async function topicsThisWeek(days = 7): Promise<TopicCount[]> {
  const sql = db();
  const rows = await sql<Record<string, unknown>[]>`
    select s.topic, count(distinct s.zi_company_id)::int as companies,
           (select name from scopes where s.topic = any(intent_topics) limit 1) as scope_name
    from signals s
    where s.signal_kind = 'intent' and s.signal_date > current_date - ${days}::int
    group by s.topic order by companies desc`;
  return rows.map((r) => ({
    topic: String(r.topic),
    scopeName: (r.scope_name as string) ?? null,
    companies: Number(r.companies),
  }));
}

export interface WorkingRow {
  companyId: string;
  name: string;
  status: string;
  notedAt: string;
  score: number | null;
}

/** Accounts with a recent outcome: what Seb is actively working. */
export async function workingAccounts(limit = 8): Promise<WorkingRow[]> {
  const sql = db();
  const rows = await sql<Record<string, unknown>[]>`
    select distinct on (o.zi_company_id) o.zi_company_id, c.name, o.status, o.noted_at,
           (select max(score) from findings f where f.zi_company_id = o.zi_company_id) as score
    from outcomes o join companies c using (zi_company_id)
    where o.status <> 'dead'
    order by o.zi_company_id, o.noted_at desc`;
  return rows
    .sort((a, b) => new Date(b.noted_at as string).getTime() - new Date(a.noted_at as string).getTime())
    .slice(0, limit)
    .map((r) => ({
      companyId: String(r.zi_company_id),
      name: String(r.name),
      status: String(r.status),
      notedAt: new Date(r.noted_at as string).toISOString().slice(0, 10),
      score: r.score === null ? null : Number(r.score),
    }));
}

export interface RunRow {
  job: string;
  status: string;
  startedAt: string;
  companiesSeen: number;
  findingsWritten: number;
  creditsSpent: number;
}

export async function recentRuns(limit = 5): Promise<RunRow[]> {
  const sql = db();
  const rows = await sql<Record<string, unknown>[]>`
    select job, status, started_at, companies_seen, findings_written, credits_spent
    from runs order by started_at desc limit ${limit}`;
  return rows.map((r) => ({
    job: String(r.job),
    status: String(r.status),
    startedAt: new Date(r.started_at as string).toISOString(),
    companiesSeen: Number(r.companies_seen ?? 0),
    findingsWritten: Number(r.findings_written ?? 0),
    creditsSpent: Number(r.credits_spent ?? 0),
  }));
}

/** Manually seeded accounts, newest first. */
export async function seededAccounts(limit = 8): Promise<CompanyRow[]> {
  const sql = db();
  const rows = await sql<Record<string, unknown>[]>`
    select zi_company_id, name, domain, employee_count, industry, city, state, source, tags,
           first_seen_at, last_seen_at
    from companies where source = 'manual' order by first_seen_at desc limit ${limit}`;
  return rows.map((r) => ({
    companyId: String(r.zi_company_id),
    name: String(r.name),
    domain: (r.domain as string) ?? null,
    employeeCount: r.employee_count === null ? null : Number(r.employee_count),
    industry: (r.industry as string) ?? null,
    city: (r.city as string) ?? null,
    state: (r.state as string) ?? null,
    source: String(r.source),
    tags: (r.tags as string[]) ?? [],
    firstSeenAt: new Date(r.first_seen_at as string).toISOString(),
    lastSeenAt: new Date(r.last_seen_at as string).toISOString(),
  }));
}

export async function scopesList(): Promise<{ slug: string; name: string; description: string | null; topics: string[] }[]> {
  const sql = db();
  const rows = await sql<Record<string, unknown>[]>`
    select slug, name, description, intent_topics from scopes order by id`;
  return rows.map((r) => ({
    slug: String(r.slug),
    name: String(r.name),
    description: (r.description as string) ?? null,
    topics: (r.intent_topics as string[]) ?? [],
  }));
}
