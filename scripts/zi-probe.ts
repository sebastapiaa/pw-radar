/**
 * Dev-only probe: one tiny free intent search and one tiny free scoop search,
 * so parsers can be written against real payloads rather than docs.
 *
 * Writes the raw JSON to the path in PROBE_OUT (default: ./probe-out, gitignored)
 * and prints only structural information (keys, counts) to stdout. Company-level
 * data only; the daily worker never requests contacts.
 *
 *   npm run zi:probe
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ZoomInfoClient } from "../src/lib/zoominfo";

const USER_INTENT =
  "Radar internal tool: scheduled scan for security buying signals at Southern California companies with 100-5000 employees.";

async function main() {
  const out = process.env.PROBE_OUT ?? "probe-out";
  mkdirSync(out, { recursive: true });

  const client = new ZoomInfoClient({
    clientId: requireEnv("ZI_CLIENT_ID"),
    clientSecret: requireEnv("ZI_CLIENT_SECRET"),
    tokenUrl: process.env.ZI_TOKEN_URL,
    scope: process.env.ZI_SCOPE,
    freeOnly: true,
  });
  await client.discoverTools();
  client.assertRoles(["searchSignals", "searchScoops"]);

  const since = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);

  const intent = await client.call<unknown>("searchSignals", {
    topics: ["Security Information & Event Management (SIEM)"],
    signalScoreMin: 60,
    signalStartDate: since,
    employeeRangeMin: "100",
    employeeRangeMax: "5000",
    metroRegion: "usa.california.sandiego,usa.california.losangeles,usa.california.irvine",
    locationSearchType: "HQ",
    sort: "-signalScore",
    pageSize: 3,
    userIntent: USER_INTENT,
  });
  writeFileSync(join(out, "search_intent.json"), JSON.stringify(intent, null, 2));
  describe("search_intent", intent);

  const scoops = await client.call<unknown>("searchScoops", {
    scoopTypes: ["New Hire", "Executive Move", "Open Position"],
    department: ["Information Technology"],
    publishedStartDate: since,
    employeeRangeMin: 100,
    employeeRangeMax: 5000,
    metroRegions: ["usa.california.sandiego", "usa.california.losangeles", "usa.california.irvine"],
    locationSearchType: "HQ",
    pageSize: 3,
    userIntent: USER_INTENT,
  });
  writeFileSync(join(out, "search_scoops.json"), JSON.stringify(scoops, null, 2));
  describe("search_scoops", scoops);

  // Firmographics by id, free. The daily worker needs employee count and location
  // for icpFit() and size-band analytics; intent results carry only id/name/website.
  const ids = extractCompanyIds(intent).slice(0, 3);
  if (ids.length) {
    client.assertRoles(["searchCompanies"]);
    const companies = await client.call<unknown>("searchCompanies", {
      companyIdList: ids,
      pageSize: 3,
      userIntent: USER_INTENT,
    });
    writeFileSync(join(out, "search_companies.json"), JSON.stringify(companies, null, 2));
    describe("search_companies (by id)", companies);
  }

  console.log(`\nraw payloads written to ${out}/ (not for commit)`);
}

function extractCompanyIds(payload: unknown): number[] {
  const p = payload as { content?: { type: string; text?: string }[] };
  const text = p.content?.find((c) => c.type === "text")?.text ?? "";
  const brace = text.search(/[{[]/);
  if (brace < 0) return [];
  try {
    const json = JSON.parse(text.slice(brace)) as {
      data?: { attributes?: { company?: { id?: string } } }[];
    };
    return (json.data ?? [])
      .map((d) => Number(d.attributes?.company?.id))
      .filter((n) => Number.isFinite(n));
  } catch {
    return [];
  }
}

/** Print shape only: keys at each level, never values. */
function describe(label: string, payload: unknown) {
  console.log(`\n${label}:`);
  const p = payload as { content?: { type: string; text?: string }[]; isError?: boolean };
  console.log(`  isError=${p.isError ?? false} contentParts=${p.content?.length ?? 0}`);
  const text = p.content?.find((c) => c.type === "text")?.text ?? "";
  const brace = text.search(/[{[]/);
  console.log(`  preamble: ${text.slice(0, Math.max(brace, 0)).replace(/\s+/g, " ").slice(0, 200)}`);
  if (brace < 0) return;
  try {
    const json = JSON.parse(text.slice(brace));
    walk(json, "  ", 0);
  } catch {
    console.log("  (text part is not JSON after the preamble)");
  }
}

function walk(v: unknown, indent: string, depth: number) {
  if (depth > 4) return;
  if (Array.isArray(v)) {
    console.log(`${indent}array(${v.length})`);
    if (v.length) walk(v[0], indent + "  ", depth + 1);
  } else if (v && typeof v === "object") {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const t = Array.isArray(val) ? `array(${val.length})` : val === null ? "null" : typeof val;
      console.log(`${indent}${k}: ${t}`);
      if (val && typeof val === "object") walk(val, indent + "  ", depth + 1);
    }
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. Fill it in .env (see .env.example).`);
  return v;
}

main().catch((err: Error) => {
  console.error(`probe failed: ${err.message}`);
  process.exit(1);
});
