/**
 * Recompute findings.why_now from stored signals with the current whyNow()
 * rules. No ZoomInfo calls, no score changes. Run after changing whyNow().
 *
 *   npm run refresh:why-now
 */

import { db, closeDb } from "../src/lib/db";
import { whyNow, type RawSignal } from "../src/lib/scoring";

async function main() {
  const sql = db();
  try {
    const findings = await sql<{ id: number; zi_company_id: string; created_at: Date }[]>`
      select id, zi_company_id, created_at from findings where created_at > now() - interval '30 days'`;
    const ids = [...new Set(findings.map((f) => f.zi_company_id))];
    const signals = await sql<{ zi_company_id: string; signal_kind: "intent" | "scoop" | "news"; topic: string | null; headline: string | null; raw_score: string | null; audience_strength: string | null; signal_date: Date | null }[]>`
      select zi_company_id, signal_kind, topic, headline, raw_score, audience_strength, signal_date
      from signals where zi_company_id = any(${ids}) and signal_date > current_date - 30`;
    const by = new Map<string, RawSignal[]>();
    for (const s of signals) {
      const l = by.get(s.zi_company_id) ?? [];
      l.push({
        kind: s.signal_kind,
        topic: s.topic ?? undefined,
        headline: s.headline ?? undefined,
        rawScore: s.raw_score === null ? undefined : Number(s.raw_score),
        audienceStrength: s.audience_strength ?? undefined,
        signalDate: s.signal_date ? new Date(s.signal_date) : undefined,
      });
      by.set(s.zi_company_id, l);
    }
    let n = 0;
    await sql.begin(async (tx) => {
      for (const f of findings) {
        const text = whyNow(by.get(f.zi_company_id) ?? [], new Date(f.created_at));
        await tx`update findings set why_now = ${text} where id = ${f.id}`;
        n++;
      }
    });
    console.log(JSON.stringify({ job: "refresh-why-now", updated: n }));
  } finally {
    await closeDb();
  }
}

main().catch((e: Error) => {
  console.error(`refresh failed: ${e.message}`);
  process.exit(1);
});
