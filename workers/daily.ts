/**
 * Daily worker. Railway cron, 06:00 PT.
 *
 * Question this job answers: "what is new since yesterday."
 *
 * CONSTRAINT: free calls only. The client is constructed with freeOnly:true and
 * will throw on any paid call. Do not remove that flag to "make it complete."
 * The two-tier design is the reason this project fits in 8,879 credits.
 *
 * Verify after the first run: the bulk credit balance in Admin Portal should
 * not have moved. If it did, something in here is calling an enrich tool.
 *
 * Flow: one free intent search per configured topic and one free scoop search
 * per scoop group, all scoped to the ICP; intersect on ZoomInfo company id;
 * fetch firmographics (free) for the icpFit backstop; drop suppressed and
 * tagged accounts; score; write companies, signals, findings; suppress what
 * surfaced for SUPPRESS_DAYS; notify only if something cleared threshold.
 */

import type { TransactionSql } from "postgres";
import { ZoomInfoClient } from "../src/lib/zoominfo";
import { db, closeDb } from "../src/lib/db";
import {
  searchIntent,
  searchScoops,
  companiesByIds,
  SCOOP_GROUPS,
  type IntentHit,
  type ScoopHit,
  type CompanyRecord,
} from "../src/lib/search";
import { scoreCompany, SURFACE_THRESHOLD, whyNow, type RawSignal } from "../src/lib/scoring";
import { notifyDaily } from "../src/lib/notify";

const SUPPRESS_DAYS = 30;
/** Look-back for "new". Overlaps run to run on purpose; suppression dedupes. */
const WINDOW_DAYS = 7;
/** Tags that must never surface as cold prospects. See docs/CONTEXT.md. */
const SUPPRESSING_TAGS = ["client", "do-not-contact"];

async function main() {
  const sql = db();
  const client = new ZoomInfoClient({
    clientId: requireEnv("ZI_CLIENT_ID"),
    clientSecret: requireEnv("ZI_CLIENT_SECRET"),
    tokenUrl: process.env.ZI_TOKEN_URL,
    scope: process.env.ZI_SCOPE,
    freeOnly: true,
  });

  await client.discoverTools();
  client.assertRoles(["searchCompanies", "searchSignals", "searchScoops"]);

  const [{ run_id: runId }] = await sql<{ run_id: string }[]>`
    insert into runs (job) values ('daily') returning run_id`;

  const stats = { companiesSeen: 0, signalsSeen: 0, findingsWritten: 0, calls: 0 };

  try {
    const since = isoDate(new Date(Date.now() - WINDOW_DAYS * 86_400_000));

    // 1. Topics come from the scopes table, never hardcoded.
    const topicRows = await sql<{ topic: string }[]>`
      select distinct unnest(intent_topics) as topic from scopes order by 1`;
    const topics = topicRows.map((r) => r.topic);
    if (!topics.length) throw new Error("scopes table has no intent topics; run npm run db:apply");

    // 2. Searches. One per topic, one per scoop group. All free.
    const intentHits: IntentHit[] = [];
    for (const topic of topics) {
      const hits = await searchIntent(client, topic, since);
      stats.calls++;
      intentHits.push(...hits);
    }
    const scoopHits: ScoopHit[] = [];
    for (const group of SCOOP_GROUPS) {
      const hits = await searchScoops(client, group, since);
      stats.calls++;
      scoopHits.push(...hits);
    }
    stats.signalsSeen = intentHits.length + scoopHits.length;

    // 3. Group by company.
    const byCompany = new Map<string, { intents: IntentHit[]; scoops: ScoopHit[] }>();
    for (const h of intentHits) bucket(byCompany, h.companyId).intents.push(h);
    for (const h of scoopHits) bucket(byCompany, h.companyId).scoops.push(h);
    stats.companiesSeen = byCompany.size;

    if (byCompany.size === 0) {
      await finish(sql, runId, "ok", stats);
      log({ job: "daily", runId, ...stats, surfaced: 0 });
      return;
    }

    // 4. Firmographics for the backstop and the size band. Free.
    const ids = [...byCompany.keys()];
    const facts = await companiesByIds(client, ids);
    stats.calls += Math.ceil(ids.length / 50);

    // 5. Suppressions and tags.
    const suppressed = new Set(
      (
        await sql<{ zi_company_id: string }[]>`
          select zi_company_id from suppressions
          where zi_company_id = any(${ids}) and suppressed_until > now()`
      ).map((r) => r.zi_company_id)
    );
    const tagged = new Set(
      (
        await sql<{ zi_company_id: string }[]>`
          select zi_company_id from companies
          where zi_company_id = any(${ids})
            and (tags && ${SUPPRESSING_TAGS}::text[]
                 or exists (select 1 from unnest(tags) t where t like 'partner:%'))`
      ).map((r) => r.zi_company_id)
    );

    // 6. Write companies and signals for everything observed (trend data),
    //    then score and write findings for what clears threshold.
    const now = new Date();
    const surfaced: { companyId: string; kinds: string[] }[] = [];

    await sql.begin(async (tx) => {
      for (const [companyId, { intents, scoops }] of byCompany) {
        const f = facts.get(companyId);
        const name = f?.name || intents[0]?.companyName || scoops[0]?.companyName || companyId;
        await upsertCompany(tx, companyId, name, f, intents[0]?.website);

        const rawSignals: RawSignal[] = [];
        for (const h of intents) {
          await tx`
            insert into signals (zi_company_id, run_id, signal_kind, topic, raw_score,
                                 audience_strength, signal_date, raw, zi_signal_id)
            values (${companyId}, ${runId}, 'intent', ${h.topic}, ${h.signalScore},
                    ${h.audienceStrength ?? null}, ${isoDate(h.signalDate)},
                    ${tx.json(h.raw as never)}, ${h.signalId || null})
            on conflict (zi_signal_id) where zi_signal_id is not null do nothing`;
          rawSignals.push({
            kind: "intent",
            topic: h.topic,
            rawScore: h.signalScore,
            audienceStrength: h.audienceStrength,
            signalDate: h.signalDate,
          });
        }
        for (const h of scoops) {
          const type = h.scoopTypes[0] ?? "Scoop";
          await tx`
            insert into signals (zi_company_id, run_id, signal_kind, topic, headline,
                                 signal_date, raw, zi_signal_id)
            values (${companyId}, ${runId}, 'scoop', ${type}, ${h.description},
                    ${isoDate(h.publishedDate)}, ${tx.json(h.raw as never)},
                    ${h.scoopId ? `scoop:${h.scoopId}` : null})
            on conflict (zi_signal_id) where zi_signal_id is not null do nothing`;
          rawSignals.push({
            kind: "scoop",
            topic: type,
            headline: h.description,
            signalDate: h.publishedDate,
          });
        }

        if (suppressed.has(companyId) || tagged.has(companyId)) continue;

        const components = scoreCompany(
          {
            employeeCount: f?.employeeCount,
            state: f?.state,
            country: f?.country,
          },
          rawSignals,
          now
        );
        if (components.score < SURFACE_THRESHOLD) continue;

        await tx`
          insert into findings (zi_company_id, run_id, score, icp_fit, signal_strength,
                                recency_decay, stack_bonus, signal_count, why_now)
          values (${companyId}, ${runId}, ${components.score}, ${components.icpFit},
                  ${components.signalStrength}, ${components.recencyDecay},
                  ${components.stackBonus}, ${components.signalCount},
                  ${whyNow(rawSignals, now)})`;
        await tx`
          insert into suppressions (zi_company_id, suppressed_until, reason)
          values (${companyId}, now() + ${`${SUPPRESS_DAYS} days`}::interval, 'surfaced')
          on conflict (zi_company_id) do update
            set suppressed_until = excluded.suppressed_until, reason = 'surfaced'`;
        surfaced.push({ companyId, kinds: [...new Set(rawSignals.map((s) => s.kind))] });
      }
    });
    stats.findingsWritten = surfaced.length;

    await finish(sql, runId, "ok", stats);

    // 7. Silence is correct. Do not notify on an empty run. Telegram is Phase 5;
    //    until its env exists, the run just logs.
    if (surfaced.length > 0 && process.env.TELEGRAM_BOT_TOKEN) {
      await notifyDaily(
        {
          botToken: requireEnv("TELEGRAM_BOT_TOKEN"),
          chatId: requireEnv("TELEGRAM_CHAT_ID"),
          dashboardUrl: requireEnv("DASHBOARD_URL"),
        },
        surfaced.length,
        surfaced.flatMap((s) => s.kinds)
      );
    }

    log({ job: "daily", runId, ...stats, surfaced: surfaced.length });
  } catch (err) {
    await finish(sql, runId, "failed", stats, (err as Error).message);
    throw err;
  } finally {
    await closeDb();
  }
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type Tx = TransactionSql<{}>;

async function upsertCompany(
  tx: Tx,
  id: string,
  name: string,
  f: CompanyRecord | undefined,
  websiteFallback?: string
) {
  const domain = (f?.website ?? websiteFallback)?.replace(/^https?:\/\//, "").replace(/^www\./, "");
  await tx`
    insert into companies (zi_company_id, name, domain, employee_count, city, state)
    values (${id}, ${name}, ${domain ?? null}, ${f?.employeeCount ?? null},
            ${f?.city ?? null}, ${f?.state ?? null})
    on conflict (zi_company_id) do update
      set name = excluded.name,
          domain = coalesce(excluded.domain, companies.domain),
          employee_count = coalesce(excluded.employee_count, companies.employee_count),
          city = coalesce(excluded.city, companies.city),
          state = coalesce(excluded.state, companies.state),
          last_seen_at = now()`;
}

function bucket<T extends { intents: IntentHit[]; scoops: ScoopHit[] }>(
  m: Map<string, T>,
  id: string
): T {
  let b = m.get(id);
  if (!b) {
    b = { intents: [], scoops: [] } as unknown as T;
    m.set(id, b);
  }
  return b;
}

async function finish(
  sql: ReturnType<typeof db>,
  runId: string,
  status: "ok" | "failed",
  s: { companiesSeen: number; signalsSeen: number; findingsWritten: number },
  error?: string
) {
  await sql`
    update runs set finished_at = now(), status = ${status},
      companies_seen = ${s.companiesSeen}, signals_seen = ${s.signalsSeen},
      findings_written = ${s.findingsWritten}, credits_spent = 0,
      error = ${error ?? null}
    where run_id = ${runId}`;
}

function isoDate(d: Date): string {
  return Number.isNaN(d.getTime()) ? isoDate(new Date()) : d.toISOString().slice(0, 10);
}

/** Structured, counts only. Never company names, never payloads. */
function log(o: Record<string, unknown>) {
  console.log(JSON.stringify(o));
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

main().catch((err) => {
  // Never serialize the whole error object; ZoomInfo payloads contain PII.
  console.error(JSON.stringify({ job: "daily", error: err.message }));
  process.exit(1);
});
