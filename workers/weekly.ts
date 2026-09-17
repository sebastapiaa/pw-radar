/**
 * Sunday worker. Railway cron, 17:00 PT.
 *
 * Question this job answers: "what is the best of the last seven days, ranked,
 * ready to work Monday." This is NOT a rerun of the daily job with a wider
 * window: it queries the findings the daily job already wrote.
 *
 * This is the only job that spends credits. It enriches the top N and nothing
 * else. Everything below the cut stays free and stays in the database.
 *
 * Per company on the shortlist:
 *   1. get_recommended_contacts (FREE): ranked people with title, level and
 *      department in the brief. Pick the buying committee from that.
 *   2. enrich_contacts (PAID, 1 credit per record not under management) for
 *      the picked contacts only. Email and phone encrypted before insert.
 *   3. enrich_company_signals is NOT called. The daily job already stores
 *      intent and scoop detail from free search. Revisit only if a profile
 *      needs more than the stored signals give it.
 *   4. Profile description via the Anthropic API, company-level data only,
 *      cached in account_profiles.
 *
 * Hard stop: CREDIT_CEILING per run. Counted as an upper bound (every enriched
 * record counts as 1; RUM makes some free). Reconcile against the Admin
 * Portal after each run.
 */

import Anthropic from "@anthropic-ai/sdk";
import { ZoomInfoClient, CreditError } from "../src/lib/zoominfo";
import { db, closeDb } from "../src/lib/db";
import { notifyWeekly } from "../src/lib/notify";
import { selectCommittee, storeRecommendations, storeEnrichment } from "../src/lib/enrich";
import { generateProfile, type ProfileSignal } from "../src/lib/profile";

/** Tune against real output. Higher means more credits, not more insight. */
const SHORTLIST_SIZE = Number(process.env.SHORTLIST_SIZE ?? 15);
/** Contacts per company to enrich. ~90 credits/week assumes 3–5. */
const CONTACTS_PER_COMPANY = 5;
/** Abort the run rather than exceed this. A bug costs one run, not the year. */
const CREDIT_CEILING = Number(process.env.CREDIT_CEILING ?? 150);
const SUPPRESSING_TAGS = ["client", "do-not-contact"];

async function main() {
  const sql = db();
  const client = new ZoomInfoClient({
    clientId: requireEnv("ZI_CLIENT_ID"),
    clientSecret: requireEnv("ZI_CLIENT_SECRET"),
    tokenUrl: process.env.ZI_TOKEN_URL,
    scope: process.env.ZI_SCOPE,
    freeOnly: false, // this job is allowed to spend
  });
  await client.discoverTools();
  client.assertRoles(["recommendedContacts", "enrichContacts"]);

  const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

  const [{ run_id: runId }] = await sql<{ run_id: string }[]>`
    insert into runs (job) values ('weekly') returning run_id`;

  const stats = { shortlist: 0, weekTotal: 0, contactsPicked: 0, contactsEnriched: 0, creditsSpent: 0, profiles: 0, profilesRejected: 0 };

  try {
    // Shortlist: best score per company over the last 7 days, excluding anything
    // already being worked, tagged out, or enriched in the last 30 days.
    const shortlist = await sql<{ zi_company_id: string; score: number; name: string }[]>`
      with best as (
        select distinct on (zi_company_id) zi_company_id, score
        from findings where created_at > now() - interval '7 days'
        order by zi_company_id, score desc
      )
      select b.zi_company_id, b.score, c.name
      from best b join companies c using (zi_company_id)
      where c.source = 'zoominfo'
        and not (c.tags && ${SUPPRESSING_TAGS}::text[])
        and not exists (select 1 from unnest(c.tags) t where t like 'partner:%')
        and not exists (select 1 from outcomes o where o.zi_company_id = b.zi_company_id
                          and o.status in ('contacted','replied','meeting','dead'))
        and not exists (select 1 from contacts k where k.zi_company_id = b.zi_company_id
                          and k.enriched_at > now() - interval '30 days')
      order by b.score desc
      limit ${SHORTLIST_SIZE}`;
    const [{ n: weekTotal }] = await sql<{ n: number }[]>`
      select count(distinct zi_company_id)::int as n from findings where created_at > now() - interval '7 days'`;
    stats.shortlist = shortlist.length;
    stats.weekTotal = weekTotal;

    for (const company of shortlist) {
      // 1. Free recommendations stored for everyone (names, titles, tiers), then
      //    the buying committee selected from them.
      const { recs } = await storeRecommendations(client, company.zi_company_id);
      const picked = selectCommittee(recs, CONTACTS_PER_COMPANY);
      stats.contactsPicked += picked.length;
      if (!picked.length) continue;

      // 2. Ceiling check before spending. Upper bound: every record could be new.
      if (stats.creditsSpent + picked.length > CREDIT_CEILING) {
        throw new CreditError(
          `Credit ceiling ${CREDIT_CEILING} would be exceeded (spent ${stats.creditsSpent}, next batch ${picked.length}). Aborting.`
        );
      }

      // 3. Paid enrichment, encrypted on insert inside storeEnrichment().
      const r = await storeEnrichment(client, company.zi_company_id, picked.map((p) => p.contactId));
      stats.creditsSpent += r.records;
      stats.contactsEnriched += r.records;
      await sql`update runs set credits_spent = ${stats.creditsSpent} where run_id = ${runId}`;

      // 4. Profile, company-level data only.
      if (anthropic) {
        const ok = await writeProfile(sql, anthropic, company.zi_company_id);
        if (ok) stats.profiles++;
        else stats.profilesRejected++;
      }
    }

    await sql`
      update runs set finished_at = now(), status = 'ok', companies_seen = ${stats.shortlist},
        findings_written = 0, credits_spent = ${stats.creditsSpent}
      where run_id = ${runId}`;

    if (process.env.TELEGRAM_BOT_TOKEN) {
      await notifyWeekly(
        {
          botToken: requireEnv("TELEGRAM_BOT_TOKEN"),
          chatId: requireEnv("TELEGRAM_CHAT_ID"),
          dashboardUrl: requireEnv("DASHBOARD_URL"),
        },
        stats.shortlist,
        stats.weekTotal,
        stats.creditsSpent
      );
    }
    console.log(JSON.stringify({ job: "weekly", runId, ...stats }));
  } catch (err) {
    await sql`
      update runs set finished_at = now(), status = 'failed', credits_spent = ${stats.creditsSpent},
        error = ${(err as Error).message}
      where run_id = ${runId}`;
    throw err;
  } finally {
    await closeDb();
  }
}

async function writeProfile(sql: ReturnType<typeof db>, anthropic: Anthropic, companyId: string): Promise<boolean> {
  const [c] = await sql<Record<string, unknown>[]>`
    select name, domain, employee_count, city, state from companies where zi_company_id = ${companyId}`;
  if (!c) return false;
  const signals = await sql<Record<string, unknown>[]>`
    select s.id, s.signal_kind, s.topic, s.headline, s.raw_score, s.audience_strength, s.signal_date,
           (select slug from scopes where s.topic = any(intent_topics) limit 1) as scope_slug
    from signals s where s.zi_company_id = ${companyId}
      and s.signal_date > current_date - 60
    order by s.signal_date desc limit 40`;
  const scopes = await sql<Record<string, unknown>[]>`
    select slug, name, description, intent_topics from scopes order by id`;
  const n = c.employee_count === null ? null : Number(c.employee_count);
  const band = !n ? "unknown" : n < 500 ? "100-499" : n < 1000 ? "500-999" : "1000-5000";

  const result = await generateProfile(anthropic, {
    name: String(c.name),
    domain: (c.domain as string) ?? null,
    employeeCount: n,
    city: (c.city as string) ?? null,
    state: (c.state as string) ?? null,
    sizeBand: band,
    signals: signals.map<ProfileSignal>((s) => ({
      id: Number(s.id),
      kind: String(s.signal_kind),
      topic: (s.topic as string) ?? null,
      headline: (s.headline as string) ?? null,
      rawScore: s.raw_score === null ? null : Number(s.raw_score),
      audienceStrength: (s.audience_strength as string) ?? null,
      signalDate: s.signal_date ? new Date(s.signal_date as string).toISOString().slice(0, 10) : null,
      scopeSlug: (s.scope_slug as string) ?? null,
    })),
    scopes: scopes.map((s) => ({
      slug: String(s.slug),
      name: String(s.name),
      description: (s.description as string) ?? null,
      topics: (s.intent_topics as string[]) ?? [],
    })),
  });
  if (!result) return false;
  await sql`
    insert into account_profiles (zi_company_id, body, model, generated_at)
    values (${companyId}, ${sql.json(result.output as never)}, ${result.model}, now())
    on conflict (zi_company_id) do update
      set body = excluded.body, model = excluded.model, generated_at = now()`;
  return true;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

main().catch((err) => {
  console.error(JSON.stringify({ job: "weekly", error: err.message }));
  process.exit(1);
});
