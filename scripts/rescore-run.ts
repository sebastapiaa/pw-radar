/**
 * Recompute score components and why_now for the findings of ONE run, in
 * place, from stored signals. No ZoomInfo calls, no suppression changes, no
 * new rows. Rows that fall below SURFACE_THRESHOLD are deleted (and their
 * 'surfaced' suppression released) so the list matches the scorer.
 *
 *   npm run rescore:run            # latest daily run
 *   npm run rescore:run -- <run_id>
 */

import { db, closeDb } from "../src/lib/db";
import { scoreCompany, whyNow, SURFACE_THRESHOLD, type RawSignal } from "../src/lib/scoring";

async function main() {
  const sql = db();
  try {
    const runId =
      process.argv[2] ??
      (await sql<{ run_id: string }[]>`select run_id from runs where job = 'daily' order by started_at desc limit 1`)[0]?.run_id;
    if (!runId) throw new Error("no daily run");
    const findings = await sql<{ id: number; zi_company_id: string; created_at: Date; score: number; employee_count: number | null; state: string | null }[]>`
      select f.id, f.zi_company_id, f.created_at, f.score, c.employee_count, c.state
      from findings f join companies c using (zi_company_id) where f.run_id = ${runId}`;
    let updated = 0;
    let dropped = 0;
    for (const f of findings) {
      const rows = await sql<{ signal_kind: "intent" | "scoop" | "news"; topic: string | null; headline: string | null; raw_score: string | null; audience_strength: string | null; signal_date: Date | null }[]>`
        select signal_kind, topic, headline, raw_score, audience_strength, signal_date from signals
        where zi_company_id = ${f.zi_company_id} and signal_date > ${f.created_at}::date - 7`;
      const signals: RawSignal[] = rows.map((s) => ({
        kind: s.signal_kind,
        topic: s.topic ?? undefined,
        headline: s.headline ?? undefined,
        rawScore: s.raw_score === null ? undefined : Number(s.raw_score),
        audienceStrength: s.audience_strength ?? undefined,
        signalDate: s.signal_date ? new Date(s.signal_date) : undefined,
      }));
      const now = new Date(f.created_at);
      const c = scoreCompany({ employeeCount: f.employee_count ?? undefined, state: f.state ?? undefined, country: "US" }, signals, now);
      if (c.score < SURFACE_THRESHOLD) {
        await sql`delete from findings where id = ${f.id}`;
        await sql`delete from suppressions where zi_company_id = ${f.zi_company_id} and reason = 'surfaced' and suppressed_until > now() + interval '29 days'`;
        dropped++;
        console.log(`  dropped ${f.zi_company_id}: ${f.score} -> ${c.score}`);
        continue;
      }
      await sql`
        update findings set score = ${c.score}, icp_fit = ${c.icpFit}, signal_strength = ${c.signalStrength},
          recency_decay = ${c.recencyDecay}, stack_bonus = ${c.stackBonus}, signal_count = ${c.signalCount},
          why_now = ${whyNow(signals, now)}
        where id = ${f.id}`;
      if (c.score !== Number(f.score)) console.log(`  ${f.zi_company_id}: ${f.score} -> ${c.score}`);
      updated++;
    }
    await sql`update runs set findings_written = ${updated} where run_id = ${runId}`;
    console.log(JSON.stringify({ job: "rescore-run", runId, updated, dropped }));
  } finally {
    await closeDb();
  }
}

main().catch((e: Error) => {
  console.error(`rescore-run failed: ${e.message}`);
  process.exit(1);
});
