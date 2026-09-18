/**
 * Typed wrappers over the free ZoomInfo search tools, with pagination.
 *
 * Shapes verified against live payloads on 2026-09-17 (scripts/zi-probe.ts).
 * Every call in this file is free. Do not add an enrich call here; those live
 * in the weekly worker only.
 *
 * Geography: ZoomInfo's California metro facets are coarse. Southern California
 * is covered by five: Los Angeles, San Diego, Irvine (Orange County), Palm
 * Springs (Inland Empire) and Santa Barbara (Ventura). icpFit() is the backstop.
 */

import { ZoomInfoClient } from "./zoominfo";
import { ICP } from "./scoring";

export const SOCAL_METROS = [
  "usa.california.losangeles",
  "usa.california.sandiego",
  "usa.california.irvine",
  "usa.california.palmsprings",
  "usa.california.santabarbara",
];

/** Fixed, PII-free audit string ZoomInfo asks every call to carry. */
export const USER_INTENT =
  "Radar internal tool: scheduled scan for security buying signals at Southern California companies with 100-5000 employees.";

/**
 * Scoop searches run in two groups. People moves are filtered to the IT
 * department (a new IT VP or an open SOC analyst req is the signal); business
 * events are filtered to security/IT scoop topics so funding rounds at
 * restaurants do not flood the list. Topic ids from `lookup` 2026-09-17.
 */
export const SCOOP_GROUPS = [
  {
    name: "it-people-moves",
    scoopTypes: ["New Hire", "Executive Move", "Management Move", "Open Position", "Hiring Plans"],
    department: ["Information Technology"],
  },
  {
    name: "security-events",
    scoopTypes: ["Pain Point", "Project", "Funding", "Mergers & Acquisitions (M&A)", "Facilities Relocation / Expansion", "Layoffs"],
    scoopTopics: ["52", "136", "163", "222", "227", "31", "135", "300", "306", "1", "22", "57", "21", "30"],
  },
  {
    // Stored for the verification gate's distress check, not for scoring
    // (scoring gives these no weight via topic). No topic filter on purpose.
    name: "distress",
    scoopTypes: ["Mergers & Acquisitions (M&A)", "Divestiture", "Layoffs"],
  },
] as const;

/** Scoop types the gate reads as distress evidence rather than buying signals. */
export { DISTRESS_TYPES } from "./scoring";

/** Scoop types that mean "trying to staff internally"; weighted up at 1,000+. */
export const JOB_POSTING_TYPES = new Set(["Open Position", "Hiring Plans"]);

export interface IntentHit {
  signalId: string;
  companyId: string;
  companyName: string;
  website?: string;
  topic: string;
  category?: string;
  signalScore: number;
  audienceStrength?: string;
  signalDate: Date;
  spikesInDateRange?: number;
  raw: unknown;
}

export interface ScoopHit {
  scoopId: string;
  companyId: string;
  companyName: string;
  description: string;
  link?: string;
  scoopTypes: string[];
  publishedDate: Date;
  raw: unknown;
}

export interface CompanyRecord {
  companyId: string;
  name: string;
  website?: string;
  employeeCount?: number;
  city?: string;
  state?: string; // normalized to 2-letter where known
  country?: string; // normalized to ISO-2 where known
  revenue?: number;
}

interface Paged<T> {
  data: T[];
  meta?: { page?: { number?: number; total?: number }; totalResults?: number };
}

const PAGE_SIZE = 100;
/** Hard stop per query. 5 pages × 100 is far more than a day should ever produce. */
const MAX_PAGES = 5;

export async function searchIntent(
  client: ZoomInfoClient,
  topic: string,
  sinceDate: string,
  minScore = 60
): Promise<IntentHit[]> {
  const hits: IntentHit[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await client.callJson<Paged<Record<string, unknown>>>("searchSignals", {
      topics: [topic],
      signalScoreMin: minScore,
      signalStartDate: sinceDate,
      employeeRangeMin: String(ICP.minEmployees),
      employeeRangeMax: String(ICP.maxEmployees),
      metroRegion: SOCAL_METROS.join(","),
      locationSearchType: "HQ",
      sort: "-signalScore",
      page,
      pageSize: PAGE_SIZE,
      userIntent: USER_INTENT,
    });
    for (const row of res.data ?? []) {
      const a = (row.attributes ?? {}) as Record<string, unknown>;
      const company = (a.company ?? {}) as Record<string, unknown>;
      if (!company.id) continue;
      hits.push({
        signalId: String(row.id ?? ""),
        companyId: String(company.id),
        companyName: String(company.name ?? ""),
        website: optStr(company.website),
        topic: String(a.topic ?? topic),
        category: optStr(a.category),
        signalScore: Number(a.signalScore ?? 0),
        audienceStrength: optStr(a.audienceStrength),
        signalDate: new Date(String(a.signalDate ?? "")),
        spikesInDateRange: optNum(a.spikesInDateRange),
        raw: row,
      });
    }
    if (!hasMorePages(res, page)) break;
  }
  return hits;
}

export async function searchScoops(
  client: ZoomInfoClient,
  group: (typeof SCOOP_GROUPS)[number],
  sinceDate: string
): Promise<ScoopHit[]> {
  const hits: ScoopHit[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const args: Record<string, unknown> = {
      scoopTypes: [...group.scoopTypes],
      publishedStartDate: sinceDate,
      employeeRangeMin: ICP.minEmployees,
      employeeRangeMax: ICP.maxEmployees,
      metroRegions: SOCAL_METROS,
      locationSearchType: "HQ",
      page,
      pageSize: PAGE_SIZE,
      userIntent: USER_INTENT,
    };
    if ("department" in group) args.department = [...group.department];
    if ("scoopTopics" in group) args.scoopTopics = [...group.scoopTopics];

    const res = await client.callJson<Paged<Record<string, unknown>>>("searchScoops", args);
    for (const row of res.data ?? []) {
      const a = (row.attributes ?? {}) as Record<string, unknown>;
      const company = (a.company ?? {}) as Record<string, unknown>;
      if (!company.id) continue;
      const types = ((a.types ?? []) as { type?: string }[]).map((t) => String(t.type ?? ""));
      hits.push({
        scoopId: String(a.id ?? row.id ?? ""),
        companyId: String(company.id),
        companyName: String(company.name ?? ""),
        description: String(a.description ?? ""),
        link: optStr(a.link),
        scoopTypes: types.filter(Boolean),
        publishedDate: new Date(String(a.originalPublishedDate ?? a.publishedDate ?? "")),
        raw: row,
      });
    }
    if (!hasMorePages(res, page)) break;
  }
  return hits;
}

/** Firmographics by id, free, 50 ids per call. */
export async function companiesByIds(
  client: ZoomInfoClient,
  ids: string[]
): Promise<Map<string, CompanyRecord>> {
  const out = new Map<string, CompanyRecord>();
  const numeric = [...new Set(ids)].map(Number).filter(Number.isFinite);
  for (let i = 0; i < numeric.length; i += 50) {
    const batch = numeric.slice(i, i + 50);
    const res = await client.callJson<Paged<Record<string, unknown>>>("searchCompanies", {
      companyIdList: batch,
      pageSize: 50,
      userIntent: USER_INTENT,
    });
    for (const row of res.data ?? []) {
      const a = (row.attributes ?? {}) as Record<string, unknown>;
      const id = String(row.id ?? "");
      if (!id) continue;
      out.set(id, {
        companyId: id,
        name: String(a.name ?? ""),
        website: optStr(a.website),
        employeeCount: optNum(a.employeeCount),
        city: optStr(a.city),
        state: normalizeState(optStr(a.state)),
        country: normalizeCountry(optStr(a.country)),
        revenue: optNum(a.revenue),
      });
    }
  }
  return out;
}

function hasMorePages(res: Paged<unknown>, page: number): boolean {
  const total = res.meta?.totalResults ?? 0;
  const got = res.data?.length ?? 0;
  return got === PAGE_SIZE && page * PAGE_SIZE < total;
}

function optStr(v: unknown): string | undefined {
  return v === null || v === undefined || v === "" ? undefined : String(v);
}

function optNum(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

const STATE_CODES: Record<string, string> = { california: "CA" };

export function normalizeState(s?: string): string | undefined {
  if (!s) return undefined;
  if (s.length === 2) return s.toUpperCase();
  return STATE_CODES[s.toLowerCase()] ?? s;
}

export function normalizeCountry(c?: string): string | undefined {
  if (!c) return undefined;
  const l = c.toLowerCase();
  if (l === "united states" || l === "usa" || l === "us") return "US";
  return c;
}
