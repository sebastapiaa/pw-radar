/**
 * Apply db/schema.sql and db/seed_scopes.sql to DATABASE_URL.
 *
 * Idempotent at the file level: the schema is skipped if the `companies` table
 * already exists, the seed is skipped if `scopes` already has rows. Prints table
 * names and row counts only; never prints connection details.
 *
 *   npm run db:apply
 *   npm run db:apply -- --reseed       # truncate scopes and reload db/seed_scopes.sql
 *   npm run db:apply -- --reset-runs   # wipe run data (runs, signals, findings,
 *                                      # suppressions, companies without tags/notes).
 *                                      # Tuning aid before Phase 1 acceptance only.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Fill it in .env (see .env.example).");

  const sql = postgres(url, { ssl: "prefer", max: 1, onnotice: () => {} });

  try {
    const [{ exists: hasSchema }] = await sql<{ exists: boolean }[]>`
      select exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'companies'
      )`;

    const migrationFiles = readdirSync("db/migrations").filter((f) => f.endsWith(".sql")).sort();

    if (hasSchema) {
      console.log("schema: already applied, skipping db/schema.sql");
    } else {
      await sql.file("db/schema.sql");
      // A fresh schema.sql already contains every migration's effect.
      for (const f of migrationFiles) await sql`insert into schema_migrations (name) values (${f})`;
      console.log(`schema: applied db/schema.sql (includes ${migrationFiles.length} migrations)`);
    }

    // Older databases: make sure the tracking table exists, then apply what is missing.
    await sql`create table if not exists schema_migrations (
      name text primary key, applied_at timestamptz not null default now())`;
    const applied = new Set(
      (await sql<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name)
    );
    for (const f of migrationFiles) {
      if (applied.has(f)) continue;
      await sql.begin(async (tx) => {
        await tx.file(join("db/migrations", f));
        await tx`insert into schema_migrations (name) values (${f})`;
      });
      console.log(`migration: applied ${f}`);
    }

    if (process.argv.includes("--reset-runs")) {
      await sql.begin(async (tx) => {
        await tx`delete from findings`;
        await tx`delete from suppressions where reason = 'surfaced'`;
        await tx`delete from signals`;
        await tx`delete from runs`;
        // Keep any company Seb has tagged or annotated; those are his state, not ours.
        await tx`delete from companies c
                 where cardinality(c.tags) = 0 and source = 'zoominfo'
                   and not exists (select 1 from notes n where n.entity_type = 'company' and n.entity_id = c.zi_company_id)
                   and not exists (select 1 from outcomes o where o.zi_company_id = c.zi_company_id)
                   and not exists (select 1 from contacts k where k.zi_company_id = c.zi_company_id)`;
      });
      console.log("reset: cleared runs, signals, findings, surfaced suppressions, untouched companies");
    }

    if (process.argv.includes("--reseed")) {
      // scopes has no dependents; account_profiles reference scope slugs by value only.
      await sql`truncate scopes restart identity`;
      console.log("seed: truncated scopes (--reseed)");
    }

    const [{ count: scopeCount }] = await sql<{ count: string }[]>`select count(*) from scopes`;
    if (Number(scopeCount) > 0) {
      console.log(`seed: scopes already has ${scopeCount} rows, skipping db/seed_scopes.sql`);
    } else {
      await sql.file("db/seed_scopes.sql");
      console.log("seed: applied db/seed_scopes.sql");
    }

    const tables = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' order by table_name`;
    console.log(`\ntables (${tables.length}):`);
    for (const t of tables) {
      const [{ count }] = await sql.unsafe<{ count: string }[]>(
        `select count(*) as count from "${t.table_name}"`
      );
      console.log(`  ${t.table_name.padEnd(18)} ${count} rows`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err: Error) => {
  console.error(`db apply failed: ${err.message}`);
  process.exit(1);
});
