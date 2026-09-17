/**
 * Sunday worker. Railway cron, 17:00 PT.
 *
 * Question this job answers: "what is the best of the last seven days, ranked,
 * ready to work Monday." This is NOT a rerun of the daily job with a wider
 * window — it queries the findings the daily job already wrote.
 *
 * This is the only job that spends credits. It enriches the top N and nothing
 * else. Everything below the cut stays free and stays in the database.
 */

import { ZoomInfoClient } from "../src/lib/zoominfo";
import { notifyWeekly } from "../src/lib/notify";
import { encryptPII } from "../src/lib/crypto";

/** Tune against real output. Higher means more credits, not more insight. */
const SHORTLIST_SIZE = 15;

/** Retention window for enriched contact PII. Confirm with Seb. */
const PII_RETENTION_DAYS = 180;

async function main() {
  const client = new ZoomInfoClient({
    clientId: requireEnv("ZI_CLIENT_ID"),
    clientSecret: requireEnv("ZI_CLIENT_SECRET"),
    tokenUrl: process.env.ZI_TOKEN_URL,
    scope: process.env.ZI_SCOPE,
    freeOnly: false, // this job is allowed to spend
  });

  await client.discoverTools();
  client.assertRoles(["recommendedContacts", "enrichSignals", "enrichContacts"]);

  // TODO: select the top SHORTLIST_SIZE from `findings` over the last 7 days,
  // best score per company (not per run), excluding anything already marked
  // 'contacted' in `outcomes`.

  // TODO: for the shortlist only:
  //   1. recommendedContacts (FREE) to get names, titles and the ranking
  //      metadata explaining why each person was surfaced.
  //   2. enrichContacts (1 credit per NEW record) for email and direct dial.
  //      RUM means anything enriched org-wide in the last 12 months is free.
  //      Batch: enrichment takes up to 25 records per call.
  //   3. enrichSignals only where the daily job could not get signal detail
  //      for free. 1 credit PER SIGNAL — this is the easiest place to overspend.

  // TODO: encrypt before insert. Never write plaintext to contacts.email_enc.
  //   email_enc: encryptPII(contact.email)
  //   phone_enc: encryptPII(contact.phone)
  //   purge_after: now + PII_RETENTION_DAYS

  // TODO: increment runs.credits_spent as you go. ZoomInfo gives no cost
  // preview, so our own count is the only running total we have. Reconcile it
  // against the Admin Portal dashboard weekly — if they diverge, something is
  // calling a paid tool we did not account for.

  // TODO: hard stop. If credits_spent exceeds a per-run ceiling, abort and
  // alert rather than continuing. A bug should cost one run, not the year.

  const shortlistCount = 0; // placeholder
  const weekTotal = 0;
  const creditsSpent = 0;

  await notifyWeekly(
    {
      botToken: requireEnv("TELEGRAM_BOT_TOKEN"),
      chatId: requireEnv("TELEGRAM_CHAT_ID"),
      dashboardUrl: requireEnv("DASHBOARD_URL"),
    },
    shortlistCount,
    weekTotal,
    creditsSpent
  );

  console.log(JSON.stringify({ job: "weekly", shortlistCount, weekTotal, creditsSpent }));
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
