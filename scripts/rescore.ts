/**
 * Recompute scores from stored signals. No ZoomInfo calls.
 *
 * Tuning aid: change src/lib/scoring.ts, run this, look at the distribution.
 * Prints counts and topic combinations only, never company names.
 *
 *   npm run rescore                    # distribution over the last WINDOW days
 *   npm run rescore -- --threshold 60  # what-if threshold
 *   npm run rescore -- --write         # replace findings + suppressions of the latest run
 */

import { db, closeDb } from "../src/lib/db";
import { scoreCompany, SURFACE_THRESHOLD, whyNow, type RawSignal } from "../src/lib/scoring";

const WINDOW_DAYS = 7;
const SUPPRESS_DAYS = 30;

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const tIdx = args.indexOf("--threshold");
  const threshold = tIdx >= 0 ? Number(args[tIdx + 1]) : SURFACE_THRESHOLD;

  const sql = db();
  try {
    const rows = await sql<
      {
        zi_company_id: string;
        employee_count: number | null;
        state: string | null;
        signal_kind: "intent" | "scoop" | "news";
        topic: string | null;
        headline: string | null;
        raw_score: string | null;
        audience_strength: string | null;
        signal_date: Date | null;
      }[]
    >`
      select s.zi_company_id, c.employee_count, c.state, s.signal_kind, s.topic, s.headline,
             s.raw_score, s.audience_strength, s.signal_date
      from signals s join companies c using (zi_company_id)
      where s.signal_date >= current_date - ${WINDOW_DAYS}::int`;

    const byCompany = new Map<string, { facts: { employeeCount?: number; state?: string }; signals: RawSignal[] }>();
    for (const r of rows) {
      let b = byCompany.get(r.zi_company_id);
      if (!b) {
        b = { facts: { employeeCount: r.employee_count ?? undefined, state: r.state ?? undefined }, signals: [] };
        byCompany.set(r.zi_company_id, b);
      }
      b.signals.push({
        kind: r.signal_kind,
        topic: r.topic ?? undefined,
        headline: r.headline ?? undefined,
        rawScore: r.raw_score === null ? undefined : Number(r.raw_score),
        audienceStrength: r.audience_strength ?? undefined,
        signalDate: r.signal_date ? new Date(r.signal_date) : undefined,
      });
    }

    const now = new Date();
    const scored = [...byCompany.entries()].map(([id, b]) => ({
      id,
      facts: b.facts,
      signals: b.signals,
      c: scoreCompany({ employeeCount: b.facts.employeeCount, state: b.facts.state, country: "US" }, b.signals, now),
    }));
    scored.sort((a, b) => b.c.score - a.c.score);

    const above = scored.filter((s) => s.c.score >= threshold);
    console.log(`companies with signals in window: ${scored.length}`);
    console.log(`threshold ${threshold}: ${above.length} surface`);
    for (const t of [45, 50, 55, 60, 65, 70, 80, 90]) {
      console.log(`  >= ${t}: ${scored.filter((s) => s.c.score >= t).length}`);
    }
    const band = (n?: number) => (!n ? "?" : n < 500 ? "100-499" : n < 1000 ? "500-999" : "1000-5000");
    const bands = new Map<string, number>();
    for (const s of above) bands.set(band(s.facts.employeeCount), (bands.get(band(s.facts.employeeCount)) ?? 0) + 1);
    console.log(`  by size band: ${JSON.stringify([...bands])}`);

    console.log(`\ntop 25 at threshold ${threshold} (score | band | signals):`);
    for (const s of above.slice(0, 25)) {
      const sig = s.signals
        .map((x) => (x.kind === "intent" ? `${x.topic} ${x.rawScore}${x.audienceStrength}` : `[${x.kind}:${x.topic}]`))
        .join(", ");
      console.log(`  ${String(s.c.score).padStart(4)} | ${band(s.facts.employeeCount).padEnd(9)} | ${sig}`);
    }

    console.log(`\nbottom 10 above threshold:`);
    for (const s of above.slice(-10)) {
      const sig = s.signals
        .map((x) => (x.kind === "intent" ? `${x.topic} ${x.rawScore}${x.audienceStrength}` : `[${x.kind}:${x.topic}]`))
        .join(", ");
      console.log(`  ${String(s.c.score).padStart(4)} | ${band(s.facts.employeeCount).padEnd(9)} | ${sig}`);
    }

    if (write) {
      const [run] = await sql<{ run_id: string }[]>`
        select run_id from runs where job = 'daily' order by started_at desc limit 1`;
      if (!run) throw new Error("no daily run to rewrite");
      await sql.begin(async (tx) => {
        await tx`delete from findings where run_id = ${run.run_id}`;
        await tx`delete from suppressions where reason = 'surfaced'`;
        for (const s of above) {
          await tx`
            insert into findings (zi_company_id, run_id, score, icp_fit, signal_strength,
                                  recency_decay, stack_bonus, signal_count, why_now)
            values (${s.id}, ${run.run_id}, ${s.c.score}, ${s.c.icpFit}, ${s.c.signalStrength},
                    ${s.c.recencyDecay}, ${s.c.stackBonus}, ${s.c.signalCount}, ${whyNow(s.signals, now)})`;
          await tx`
            insert into suppressions (zi_company_id, suppressed_until, reason)
            values (${s.id}, now() + ${`${SUPPRESS_DAYS} days`}::interval, 'surfaced')
            on conflict (zi_company_id) do update
              set suppressed_until = excluded.suppressed_until, reason = 'surfaced'`;
        }
        await tx`update runs set findings_written = ${above.length} where run_id = ${run.run_id}`;
      });
      console.log(`\nwrote ${above.length} findings for run ${run.run_id}`);
    }
  } finally {
    await closeDb();
  }
}

main().catch((err: Error) => {
  console.error(`rescore failed: ${err.message}`);
  process.exit(1);
});
