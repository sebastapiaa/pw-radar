/**
 * Retention purge. Nulls out encrypted email and phone where purge_after has
 * passed. Names and titles stay (they are the account's people list); the
 * reachable-contact data is what has a retention window. See docs/SECURITY.md.
 *
 * Run daily alongside the daily worker, or as its own Railway cron.
 *
 *   npm run job:retention
 */

import { db, closeDb } from "../src/lib/db";

async function main() {
  const sql = db();
  try {
    const rows = await sql<{ zi_contact_id: string }[]>`
      update contacts
      set email_enc = null, phone_enc = null
      where purge_after is not null and purge_after < now()
        and (email_enc is not null or phone_enc is not null)
      returning zi_contact_id`;
    console.log(JSON.stringify({ job: "retention", purged: rows.length }));
  } finally {
    await closeDb();
  }
}

main().catch((err: Error) => {
  console.error(JSON.stringify({ job: "retention", error: err.message }));
  process.exit(1);
});
