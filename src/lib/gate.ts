/**
 * Verification gate. Runs between shortlist selection and enrichment in the
 * Sunday worker, on every candidate, before any credit is spent.
 * See docs/ARCHITECTURE.md §Verification gate for the design and the
 * calibration rule: anything ambiguous FLAGS; only unambiguous facts KILL.
 *
 * Deterministic checks (free ZoomInfo subset filters + stored signals + DNS):
 *   industry      kill  security vendor by industry; MSP/MSSP → partner:candidate
 *   location      flag  HQ not in California (branch of a non-local company)
 *   liveness      flag  domain unresolved / headcount shrinking; kill only when
 *                       all three liveness signals agree the company is dead
 *   distress      kill  explicit "acquired by" / bankruptcy / shutdown headline
 *                 flag  layoffs, divestiture, ambiguous M&A
 *   hierarchy     pass  same-domain proxy records a likely parent; never kills
 * Model review    flag  claude-haiku-4-5, company-level data only; never kills
 * Corroboration   flag  <2 distinct core signal keys: listed, not enriched
 *
 * Every decision is persisted in gate_decisions per run (unless dryRun).
 */

import { promises as dns } from "node:dns";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type postgres from "postgres";
import { ZoomInfoClient } from "./zoominfo";
import { USER_INTENT, DISTRESS_TYPES } from "./search";
import { AMBIENT_TOPICS, canonicalTopic } from "./scoring";
import { PROFILE_MODEL } from "./profile";

export type Verdict = "pass" | "flag" | "kill" | "skipped";

export interface Decision {
  check: string;
  verdict: Verdict;
  reason: string | null;
  evidence: Record<string, unknown>;
}

export interface Candidate {
  companyId: string;
  name: string;
  domain: string | null;
  employeeCount: number | null;
  state: string | null;
}

export interface GateResult {
  companyId: string;
  decisions: Decision[];
  overall: "passed" | "flagged" | "killed";
  reason: string | null;
  /** Tags to apply on kill. */
  tags: string[];
  parentCompanyId: string | null;
  locationType: "hq" | "branch" | null;
  employmentTrend: "stable_or_growing" | "shrinking" | null;
  industryIds: string[];
  corroborated: boolean;
}

export const SECURITY_INDUSTRIES = ["software.security", "bizservice.security"];
export const MSP_INDUSTRIES = ["bizservice.techconsulting"];
/** Seb's decision 2026-09-17: education is out of the ICP entirely. */
export const EDUCATION_INDUSTRIES = ["education", "education.k12", "education.university"];
/**
 * Provider-sounding names. Tuned on the 2026-09-17 dry run, where TeamLogic
 * IT, VectorUSA, Neudesic, Calance and Phoenix Group Information Systems sat
 * in the IT-services industry without matching the first pattern. The
 * case-sensitive "IT" word catches "TeamLogic IT" without matching "it".
 */
const PROVIDER_NAME_RE = /\b(msp|mssp|managed (it|services?|security)|it services|it solutions|it consulting|it group|cyber ?security|infosec|security (services|solutions|consult)|information (systems|technolog(y|ies))|technolog(y|ies) (solutions|services|partners|group)|network(s|ing)? (solutions|services)|computer (services|solutions)|systems? integrat|tech(nology)? consult|cloud (services|solutions)|logic it)\b/i;
const PROVIDER_NAME_CS_RE = /\bIT\b|\bMSP\b|\bMSSP\b/;
/** Known provider brands that no pattern would catch; grown from dry-run review. */
const PROVIDER_NAMES = new Set(["vectorusa", "calance", "neudesic", "scalenorth"]);

export function looksLikeProvider(name: string): boolean {
  const n = name.trim();
  return PROVIDER_NAME_RE.test(n) || PROVIDER_NAME_CS_RE.test(n) || PROVIDER_NAMES.has(n.toLowerCase().replace(/[^a-z]/g, ""));
}
const ACQUIRED_RE = /\b(has been acquired|was acquired|to be acquired|agreed to be acquired|acquired by|completes? (its )?acquisition of|filed for (chapter 11|chapter 7|bankruptcy)|bankruptcy|ceas(e|es|ed|ing) operations|shut(s|ting)? down|going out of business|winding down)\b/i;
const ACQUIRER_RE = /\b(acquires|acquired|has acquired|completes? (the )?acquisition of|to acquire|agreed to acquire)\b/i;
const SHRINK_THRESHOLD = -15; // one-year employee growth rate, percent

type Sql = ReturnType<typeof postgres>;

export interface GateOptions {
  dryRun?: boolean;
  anthropic?: Anthropic | null;
  /** Corroboration floor: distinct core signal keys required to enrich. */
  corroborationMin?: number;
}

export async function runGate(
  client: ZoomInfoClient,
  sql: Sql,
  runId: string | null,
  candidates: Candidate[],
  opts: GateOptions = {}
): Promise<GateResult[]> {
  const ids = candidates.map((c) => c.companyId);
  const results = new Map<string, GateResult>(
    candidates.map((c) => [
      c.companyId,
      {
        companyId: c.companyId,
        decisions: [],
        overall: "passed",
        reason: null,
        tags: [],
        parentCompanyId: null,
        locationType: null,
        employmentTrend: null,
        industryIds: [],
        corroborated: false,
      },
    ])
  );
  const byId = new Map(candidates.map((c) => [c.companyId, c]));

  // ---- batch subset filters (free), 50 ids per call ----
  // Growth is asked both ways: "≥ threshold" and "≤ threshold". A company in
  // neither set has no growth data and must not be read as shrinking
  // (calibration: the first dry run flagged 15% of accounts that way).
  const [securityIds, mspIds, hqIds, growIds, shrinkIds, eduIndustryIds, eduTypeIds] = await Promise.all([
    subset(client, ids, { industryList: SECURITY_INDUSTRIES }),
    subset(client, ids, { industryList: MSP_INDUSTRIES }),
    subset(client, ids, { locationSearchType: "HQ", state: "usa.california" }),
    subset(client, ids, { oneYearEmployeeGrowthRateMinimum: SHRINK_THRESHOLD }),
    subset(client, ids, { oneYearEmployeeGrowthRateMaximum: SHRINK_THRESHOLD }),
    subset(client, ids, { industryList: EDUCATION_INDUSTRIES }),
    subset(client, ids, { companyTypeList: ["education"] }),
  ]);

  // ---- stored signals for liveness/distress/corroboration ----
  type SignalLite = { zi_company_id: string; signal_kind: string; topic: string | null; headline: string | null; signal_date: Date | null };
  const signalRows = await sql<SignalLite[]>`
    select zi_company_id, signal_kind, topic, headline, signal_date from signals
    where zi_company_id = any(${ids}) and signal_date > current_date - 180`;
  const signalsBy = new Map<string, SignalLite[]>();
  for (const r of signalRows) {
    const l: SignalLite[] = signalsBy.get(r.zi_company_id) ?? [];
    l.push(r);
    signalsBy.set(r.zi_company_id, l);
  }

  // ---- DNS, concurrency-limited ----
  const dnsOk = new Map<string, boolean | null>();
  await mapLimit(candidates, 8, async (c) => {
    dnsOk.set(c.companyId, c.domain ? await domainResolves(c.domain) : null);
  });

  const corroborationMin = opts.corroborationMin ?? 2;
  const now = Date.now();

  for (const c of candidates) {
    const r = results.get(c.companyId)!;
    const sigs = signalsBy.get(c.companyId) ?? [];
    const nameProvider = looksLikeProvider(c.name);

    // industry
    if (eduIndustryIds.has(c.companyId) || eduTypeIds.has(c.companyId)) {
      r.industryIds.push(...EDUCATION_INDUSTRIES.filter(() => eduIndustryIds.has(c.companyId)));
      r.decisions.push({ check: "industry", verdict: "kill", reason: "education", evidence: { byIndustry: eduIndustryIds.has(c.companyId), byCompanyType: eduTypeIds.has(c.companyId) } });
      r.tags.push("excluded:education");
    } else if (securityIds.has(c.companyId)) {
      r.industryIds.push(...SECURITY_INDUSTRIES);
      r.decisions.push({ check: "industry", verdict: "kill", reason: "security_vendor", evidence: { industries: SECURITY_INDUSTRIES, nameMatch: nameProvider } });
      r.tags.push("excluded:security-vendor");
    } else if (mspIds.has(c.companyId) && nameProvider) {
      // "Custom Software & IT Services" plus a provider-sounding name: an MSP.
      r.industryIds.push(...MSP_INDUSTRIES);
      r.decisions.push({ check: "industry", verdict: "kill", reason: "msp_candidate", evidence: { industries: MSP_INDUSTRIES, nameMatch: true } });
      r.tags.push("partner:candidate");
    } else if (mspIds.has(c.companyId)) {
      // The industry alone also covers plain software shops: ambiguous, so flag.
      r.industryIds.push(...MSP_INDUSTRIES);
      r.decisions.push({ check: "industry", verdict: "flag", reason: "it_services_industry", evidence: { industries: MSP_INDUSTRIES, nameMatch: false } });
    } else if (nameProvider) {
      r.decisions.push({ check: "industry", verdict: "flag", reason: "name_suggests_provider", evidence: { name: c.name } });
    } else {
      r.decisions.push({ check: "industry", verdict: "pass", reason: null, evidence: {} });
    }

    // location
    const hq = hqIds.has(c.companyId);
    r.locationType = hq ? "hq" : "branch";
    r.decisions.push(
      hq
        ? { check: "location", verdict: "pass", reason: null, evidence: { hqState: "CA" } }
        : { check: "location", verdict: "flag", reason: "not_hq_in_ca", evidence: { recordedState: c.state } }
    );

    // liveness
    const resolves = dnsOk.get(c.companyId) ?? null;
    const growing = growIds.has(c.companyId);
    const shrinking = !growing && shrinkIds.has(c.companyId);
    r.employmentTrend = growing ? "stable_or_growing" : shrinking ? "shrinking" : null;
    const recentPostings = sigs.filter(
      (s) => s.signal_kind === "scoop" && /open position|hiring plans/i.test(s.topic ?? "") && ageDays(s.signal_date, now) <= 90
    ).length;
    const recentAnything = sigs.filter((s) => ageDays(s.signal_date, now) <= 90).length;
    const liveEvidence = { domain: c.domain, domainResolves: resolves, employmentTrend: r.employmentTrend, jobPostings90d: recentPostings, signals90d: recentAnything };
    if (resolves === false && shrinking && recentAnything === 0) {
      r.decisions.push({ check: "liveness", verdict: "kill", reason: "dead_company", evidence: liveEvidence });
      r.tags.push("excluded:dead");
    } else if (resolves === false) {
      r.decisions.push({ check: "liveness", verdict: "flag", reason: "domain_unresolved", evidence: liveEvidence });
    } else if (shrinking) {
      r.decisions.push({ check: "liveness", verdict: "flag", reason: "shrinking_headcount", evidence: liveEvidence });
    } else {
      r.decisions.push({ check: "liveness", verdict: "pass", reason: null, evidence: liveEvidence });
    }

    // distress
    const distress = sigs.filter((s) => s.signal_kind === "scoop" && DISTRESS_TYPES.has(s.topic ?? ""));
    const explicit = distress.find((s) => ACQUIRED_RE.test(s.headline ?? "") && !ACQUIRER_RE.test(s.headline ?? ""));
    if (explicit) {
      const reason = /bankrupt|chapter/i.test(explicit.headline ?? "") ? "bankruptcy" : /ceas|shut|winding|out of business/i.test(explicit.headline ?? "") ? "shutdown" : "acquired";
      r.decisions.push({ check: "distress", verdict: "kill", reason, evidence: { headline: explicit.headline, date: iso(explicit.signal_date) } });
      r.tags.push(`excluded:${reason}`);
    } else if (distress.length) {
      r.decisions.push({ check: "distress", verdict: "flag", reason: "distress_signal", evidence: { events: distress.slice(0, 3).map((d) => ({ type: d.topic, headline: d.headline, date: iso(d.signal_date) })) } });
    } else {
      r.decisions.push({ check: "distress", verdict: "pass", reason: null, evidence: {} });
    }

    // corroboration
    const keys = new Set(
      sigs
        .filter((s) => ageDays(s.signal_date, now) <= 30)
        .filter((s) => !(s.signal_kind === "intent" && AMBIENT_TOPICS.has(s.topic ?? "")))
        .filter((s) => !(s.signal_kind === "scoop" && DISTRESS_TYPES.has(s.topic ?? "")))
        .map((s) => `${s.signal_kind}:${s.signal_kind === "intent" ? canonicalTopic(s.topic ?? "") : s.topic ?? ""}`)
    );
    r.corroborated = keys.size >= corroborationMin;
    r.decisions.push({
      check: "corroboration",
      verdict: r.corroborated ? "pass" : "flag",
      reason: r.corroborated ? null : "single_signal",
      evidence: { distinctCoreSignals: keys.size, keys: [...keys].slice(0, 8) },
    });
  }

  // hierarchy proxy: same-domain entities, only for candidates still alive
  const alive = candidates.filter((c) => c.domain && !results.get(c.companyId)!.decisions.some((d) => d.verdict === "kill"));
  await mapLimit(alive, 4, async (c) => {
    const r = results.get(c.companyId)!;
    try {
      const rows = await client.callJson<{ data?: { id: string; attributes?: Record<string, unknown> }[] }>("hierarchyProxy", {
        companyWebsite: `https://${c.domain}`,
        pageSize: 10,
        userIntent: USER_INTENT,
      });
      const others = (rows.data ?? []).filter((d) => String(d.id) !== c.companyId);
      const bigger = others
        .map((d) => ({ id: String(d.id), n: Number(d.attributes?.employeeCount ?? 0), name: String(d.attributes?.name ?? "") }))
        .filter((d) => d.n > (c.employeeCount ?? 0))
        .sort((a, b) => b.n - a.n)[0];
      if (bigger) {
        r.parentCompanyId = bigger.id;
        r.decisions.push({ check: "hierarchy", verdict: "pass", reason: "rolled_up", evidence: { parent: bigger.id, parentName: bigger.name, parentEmployees: bigger.n, sameDomainEntities: others.length + 1 } });
      } else {
        r.decisions.push({ check: "hierarchy", verdict: "pass", reason: null, evidence: { sameDomainEntities: others.length + 1 } });
      }
    } catch (err) {
      r.decisions.push({ check: "hierarchy", verdict: "skipped", reason: "lookup_failed", evidence: { error: (err as Error).message.slice(0, 120) } });
    }
  });
  for (const c of candidates) {
    const r = results.get(c.companyId)!;
    if (!r.decisions.some((d) => d.check === "hierarchy")) {
      r.decisions.push({ check: "hierarchy", verdict: "skipped", reason: c.domain ? "killed_earlier" : "no_domain", evidence: {} });
    }
  }

  // model review: flag only, company-level data only, skipped without a key
  for (const c of candidates) {
    const r = results.get(c.companyId)!;
    if (r.decisions.some((d) => d.verdict === "kill")) {
      r.decisions.push({ check: "model_review", verdict: "skipped", reason: "killed_earlier", evidence: {} });
      continue;
    }
    if (!opts.anthropic) {
      r.decisions.push({ check: "model_review", verdict: "skipped", reason: "no_api_key", evidence: {} });
      continue;
    }
    try {
      const review = await modelReview(opts.anthropic, c, r, signalsBy.get(c.companyId) ?? []);
      r.decisions.push({ check: "model_review", verdict: review.verdict, reason: review.reason, evidence: { evidence_fields: review.evidence_fields } });
    } catch (err) {
      r.decisions.push({ check: "model_review", verdict: "skipped", reason: "model_error", evidence: { error: (err as Error).message.slice(0, 120) } });
    }
  }

  // overall
  for (const r of results.values()) {
    const kill = r.decisions.find((d) => d.verdict === "kill");
    const flag = r.decisions.find((d) => d.verdict === "flag" && d.check !== "corroboration");
    if (kill) {
      r.overall = "killed";
      r.reason = kill.reason;
    } else if (flag) {
      r.overall = "flagged";
      r.reason = flag.reason;
    } else {
      r.overall = "passed";
      r.reason = null;
    }
  }

  if (!opts.dryRun && runId) await persist(sql, runId, [...results.values()], byId);
  return [...results.values()];
}

async function persist(sql: Sql, runId: string, results: GateResult[], byId: Map<string, Candidate>) {
  await sql.begin(async (tx) => {
    for (const r of results) {
      for (const d of r.decisions) {
        await tx`
          insert into gate_decisions (run_id, zi_company_id, check_name, verdict, reason, evidence)
          values (${runId}, ${r.companyId}, ${d.check}, ${d.verdict}, ${d.reason}, ${tx.json(d.evidence as never)})`;
      }
      // Seb's approval outranks the gate, kills included: a restored account is
      // not re-killed by the same facts. The decision rows still record what
      // the gate would have done, so an override stays visible in analytics.
      await tx`
        update companies set
          parent_company_id = ${r.parentCompanyId},
          location_type = ${r.locationType},
          employment_trend = ${r.employmentTrend},
          industry_ids = ${r.industryIds},
          gate_status = case when gate_status = 'approved' then 'approved' else ${r.overall} end,
          gate_reason = case when gate_status = 'approved' then gate_reason else ${r.reason} end,
          tags = case when gate_status = 'approved' then tags
                      else (select array(select distinct t from unnest(tags || ${r.tags}::text[]) t)) end
        where zi_company_id = ${r.companyId}`;
      const [{ approved }] = await tx<{ approved: boolean }[]>`
        select gate_status = 'approved' as approved from companies where zi_company_id = ${r.companyId}`;
      if (r.overall === "killed" && !approved) {
        await tx`
          insert into suppressions (zi_company_id, suppressed_until, reason)
          values (${r.companyId}, now() + interval '365 days', 'manual')
          on conflict (zi_company_id) do update
            set suppressed_until = greatest(suppressions.suppressed_until, excluded.suppressed_until)`;
      }
      void byId;
    }
  });
}

/** Ids from `ids` that ZoomInfo returns when the filter is applied. 50 per call. */
async function subset(client: ZoomInfoClient, ids: string[], filter: Record<string, unknown>): Promise<Set<string>> {
  const out = new Set<string>();
  const numeric = ids.map(Number).filter(Number.isFinite);
  for (let i = 0; i < numeric.length; i += 50) {
    const batch = numeric.slice(i, i + 50);
    const res = await client.callJson<{ data?: { id: string }[] }>("searchCompanies", {
      companyIdList: batch,
      ...filter,
      pageSize: 50,
      userIntent: USER_INTENT,
    });
    for (const d of res.data ?? []) out.add(String(d.id));
  }
  return out;
}

async function domainResolves(domain: string): Promise<boolean> {
  try {
    await dns.lookup(domain);
    return true;
  } catch {
    try {
      await dns.resolveMx(domain);
      return true;
    } catch {
      return false;
    }
  }
}

// ---------- model review ----------

const Review = z.object({
  verdict: z.enum(["pass", "flag"]),
  reason: z.string(),
  evidence_fields: z.array(z.string()),
});

const REVIEW_SYSTEM = `You review prospect accounts for a Southern California managed security provider before any money is spent researching them. You see company-level facts and the automated gate's evidence. Decide whether the account is a plausible prospect for co-managed security services (managed SOC, SIEM, cloud security, pen testing, GRC).

You may PASS or FLAG. You may never reject. Flag when something in the evidence makes the account look like: a security vendor or IT service provider itself; a subsidiary, branch or shell rather than the operating company; a company in the middle of being acquired or wound down; an entity whose signals are probably noise (e.g. a university department, a government body, a staffing agency). Otherwise pass.

Rules: use only the facts given; never name or refer to any individual person; no outreach language. Return a one-sentence reason and list the evidence field names you relied on.`;

async function modelReview(anthropic: Anthropic, c: Candidate, r: GateResult, sigs: { signal_kind: string; topic: string | null; headline: string | null; signal_date: Date | null }[]) {
  const facts = {
    name: c.name,
    domain: c.domain,
    employeeCount: c.employeeCount,
    state: c.state,
    locationType: r.locationType,
    employmentTrend: r.employmentTrend,
    industryIds: r.industryIds,
    parentCompanyId: r.parentCompanyId,
    gateEvidence: r.decisions.map((d) => ({ check: d.check, verdict: d.verdict, reason: d.reason })),
    signals: sigs.slice(0, 20).map((s) => ({ kind: s.signal_kind, topic: s.topic, headline: s.headline?.slice(0, 160), date: iso(s.signal_date) })),
  };
  const res = await anthropic.messages.parse({
    model: PROFILE_MODEL,
    max_tokens: 600,
    system: REVIEW_SYSTEM,
    messages: [{ role: "user", content: JSON.stringify(facts, null, 1) }],
    output_config: { format: zodOutputFormat(Review) },
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) return { verdict: "pass" as const, reason: "model_no_output", evidence_fields: [] };
  return res.parsed_output;
}

// ---------- helpers ----------

function ageDays(d: Date | null, now: number): number {
  return d ? (now - new Date(d).getTime()) / 86_400_000 : 9999;
}

function iso(d: Date | null): string | null {
  return d ? new Date(d).toISOString().slice(0, 10) : null;
}

async function mapLimit<T>(items: T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/** Human-readable gate summary for logs and the report script. Counts only. */
export function summarize(results: GateResult[]) {
  const byCheck: Record<string, Record<string, number>> = {};
  const byReason: Record<string, number> = {};
  for (const r of results) {
    for (const d of r.decisions) {
      byCheck[d.check] ??= {};
      byCheck[d.check][d.verdict] = (byCheck[d.check][d.verdict] ?? 0) + 1;
      if (d.reason && d.verdict !== "pass") byReason[`${d.check}/${d.verdict}/${d.reason}`] = (byReason[`${d.check}/${d.verdict}/${d.reason}`] ?? 0) + 1;
    }
  }
  const overall = { passed: 0, flagged: 0, killed: 0 };
  for (const r of results) overall[r.overall]++;
  return { overall, byCheck, byReason };
}
