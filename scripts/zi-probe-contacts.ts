/**
 * Dev-only probe for get_recommended_contacts (free). Takes the top finding's
 * company, asks for 5 recommendations, writes the raw payload to PROBE_OUT and
 * prints structure only. Business contact data: scratchpad only, never commit.
 *
 *   PROBE_OUT=<scratch> npx tsx --env-file-if-exists=.env scripts/zi-probe-contacts.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ZoomInfoClient } from "../src/lib/zoominfo";
import { db, closeDb } from "../src/lib/db";
import { USER_INTENT } from "../src/lib/search";

async function main() {
  const out = process.env.PROBE_OUT ?? "probe-out";
  mkdirSync(out, { recursive: true });
  const sql = db();
  const [top] = await sql<{ zi_company_id: string }[]>`
    select zi_company_id from findings order by score desc limit 1`;
  await closeDb();
  if (!top) throw new Error("no findings to probe with");

  const client = new ZoomInfoClient({
    clientId: requireEnv("ZI_CLIENT_ID"),
    clientSecret: requireEnv("ZI_CLIENT_SECRET"),
    tokenUrl: process.env.ZI_TOKEN_URL,
    scope: process.env.ZI_SCOPE,
    freeOnly: true,
  });
  await client.discoverTools();
  client.assertRoles(["recommendedContacts"]);

  const res = await client.call<unknown>("recommendedContacts", {
    ziCompanyId: Number(top.zi_company_id),
    useCaseType: "PROSPECTING",
    pageSize: 5,
    userIntent: USER_INTENT,
  });
  writeFileSync(join(out, "get_recommended_contacts.json"), JSON.stringify(res, null, 2));

  const p = res as { content?: { type: string; text?: string }[]; isError?: boolean };
  const text = p.content?.find((c) => c.type === "text")?.text ?? "";
  console.log(`isError=${p.isError ?? false}`);
  const brace = text.search(/[{[]/);
  console.log(`preamble: ${text.slice(0, Math.max(brace, 0)).replace(/\s+/g, " ").slice(0, 200)}`);
  if (brace < 0) return console.log(text.slice(0, 300));
  walk(JSON.parse(text.slice(brace)), "  ", 0);
}

function walk(v: unknown, indent: string, depth: number) {
  if (depth > 5) return;
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
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

main().catch((err: Error) => {
  console.error(`probe failed: ${err.message}`);
  process.exit(1);
});
