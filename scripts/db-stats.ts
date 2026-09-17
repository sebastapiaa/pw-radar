/**
 * Read-only diagnostics after a run. Counts and distributions only; no company
 * names, no contact data.
 *
 *   npm run db:stats
 */

import { db, closeDb } from "../src/lib/db";

async function main() {
  const sql = db();
  try {
    const runs = await sql`
      select job, status, started_at, finished_at, companies_seen, signals_seen,
             findings_written, credits_spent
      from runs order by started_at desc limit 5`;
    console.log("runs:", JSON.stringify(runs, null, 0));

    const scores = await sql`
      select count(*)::int as findings,
             percentile_cont(0.5) within group (order by score) as p50,
             percentile_cont(0.9) within group (order by score) as p90,
             max(score) as max, min(score) as min,
             count(*) filter (where score >= 60)::int as ge60,
             count(*) filter (where score >= 70)::int as ge70,
             count(*) filter (where score >= 80)::int as ge80,
             count(*) filter (where signal_count >= 2)::int as stacked,
             count(*) filter (where stack_bonus > 1)::int as distinct_stacked
      from findings`;
    console.log("findings:", JSON.stringify(scores[0]));

    const geo = await sql`
      select coalesce(state, '(null)') as state, count(*)::int as n
      from companies group by 1 order by 2 desc limit 10`;
    console.log("companies by state:", JSON.stringify(geo));

    const size = await sql`
      select case
        when employee_count is null then '(null)'
        when employee_count < 100 then '<100'
        when employee_count < 500 then '100-499'
        when employee_count < 1000 then '500-999'
        when employee_count <= 5000 then '1000-5000'
        else '>5000' end as band, count(*)::int as n
      from companies group by 1 order by 1`;
    console.log("companies by size band:", JSON.stringify(size));

    const kinds = await sql`
      select signal_kind, count(*)::int as n, count(distinct zi_company_id)::int as companies,
             min(signal_date) as oldest, max(signal_date) as newest
      from signals group by 1`;
    console.log("signals by kind:", JSON.stringify(kinds));

    const topics = await sql`
      select signal_kind, topic, count(*)::int as n
      from signals group by 1, 2 order by 3 desc limit 30`;
    console.log("signals by topic:");
    for (const t of topics) console.log(`  ${String(t.n).padStart(5)}  ${t.signal_kind}  ${t.topic}`);

    const aud = await sql`
      select audience_strength, count(*)::int as n,
             round(avg(raw_score))::int as avg_score
      from signals where signal_kind = 'intent' group by 1 order by 1`;
    console.log("intent by audience:", JSON.stringify(aud));

    const age = await sql`
      select (current_date - signal_date) as age_days, count(*)::int as n
      from signals group by 1 order by 1`;
    console.log("signals by age (days):", JSON.stringify(age));
  } finally {
    await closeDb();
  }
}

main().catch((err: Error) => {
  console.error(`stats failed: ${err.message}`);
  process.exit(1);
});
