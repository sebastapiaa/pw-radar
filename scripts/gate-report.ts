/**
 * Calibration report: run the verification gate as a DRY RUN over the accounts
 * already in the database (best finding per company, last 30 days) and print
 * what it would kill and flag, with reasons. Free calls only; the model review
 * runs only if ANTHROPIC_API_KEY is set. Nothing is persisted or tagged.
 *
 *   npm run gate:report              # all accounts with findings
 *   npm run gate:report -- 60        # top 60 by score
 *   npm run gate:report -- 60 --names  # include company names (stdout only)
 */

import Anthropic from "@anthropic-ai/sdk";
import { db, closeDb } from "../src/lib/db";
import { zoomInfoFromEnv } from "../src/lib/enrich";
import { runGate, summarize, type Candidate } from "../src/lib/gate";

async function main() {
  const args = process.argv.slice(2);
  const limit = Number(args.find((a) => /^\d+$/.test(a)) ?? 1000);
  const names = args.includes("--names");
  const sql = db();
  try {
    const rows = await sql<{ zi_company_id: string; score: number; name: string; domain: string | null; employee_count: number | null; state: string | null }[]>`
      with best as (
        select distinct on (zi_company_id) zi_company_id, score
        from findings where created_at > now() - interval '30 days'
        order by zi_company_id, score desc
      )
      select b.zi_company_id, b.score, c.name, c.domain, c.employee_count, c.state
      from best b join companies c using (zi_company_id)
      where c.source = 'zoominfo'
      order by b.score desc limit ${limit}`;

    const client = zoomInfoFromEnv(true);
    await client.discoverTools();
    client.assertRoles(["industryFilter", "locationType", "employmentTrend", "hierarchyProxy"]);
    const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

    const candidates = rows.map<Candidate>((c) => ({
      companyId: c.zi_company_id,
      name: c.name,
      domain: c.domain,
      employeeCount: c.employee_count === null ? null : Number(c.employee_count),
      state: c.state,
    }));
    const t0 = Date.now();
    const results = await runGate(client, sql, null, candidates, { dryRun: true, anthropic });
    const s = summarize(results);
    const label = (id: string) => (names ? `${id} ${rows.find((r) => r.zi_company_id === id)?.name ?? ""}` : id);

    console.log(`\ngate dry run over ${results.length} accounts in ${Math.round((Date.now() - t0) / 1000)}s (model review: ${anthropic ? "on" : "off"})`);
    console.log(`overall: ${JSON.stringify(s.overall)}`);
    console.log("\nper check:");
    for (const [check, v] of Object.entries(s.byCheck)) console.log(`  ${check.padEnd(14)} ${JSON.stringify(v)}`);
    console.log("\nnon-pass reasons:");
    for (const [k, n] of Object.entries(s.byReason).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);

    const killed = results.filter((r) => r.overall === "killed");
    console.log(`\nKILLED (${killed.length}):`);
    for (const r of killed) {
      const k = r.decisions.find((d) => d.verdict === "kill")!;
      console.log(`  ${label(r.companyId).padEnd(names ? 50 : 12)} ${k.check}/${k.reason}  ${JSON.stringify(k.evidence).slice(0, 120)}`);
    }
    const flagged = results.filter((r) => r.overall === "flagged");
    console.log(`\nFLAGGED (${flagged.length}), first 40:`);
    for (const r of flagged.slice(0, 40)) {
      const fl = r.decisions.filter((d) => d.verdict === "flag" && d.check !== "corroboration").map((d) => `${d.check}/${d.reason}`);
      console.log(`  ${label(r.companyId).padEnd(names ? 50 : 12)} ${fl.join(", ")}`);
    }
    const unc = results.filter((r) => r.overall !== "killed" && !r.corroborated).length;
    console.log(`\nlisted but not enrichable (single signal): ${unc} of ${results.length - killed.length}`);
    const wouldEnrich = results.filter((r) => r.overall === "passed" && r.corroborated).length;
    console.log(`would enrich without any approval: ${wouldEnrich}`);
  } finally {
    await closeDb();
  }
}

main().catch((e: Error) => {
  console.error(`gate report failed: ${e.message}`);
  process.exit(1);
});
