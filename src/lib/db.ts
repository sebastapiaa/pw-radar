/**
 * Postgres connection. One lazy singleton per process.
 *
 * Railway's internal DATABASE_URL is used in deployed workers; locally the
 * public TCP proxy URL is in .env. Both go through the same code path.
 */

import postgres from "postgres";

let client: ReturnType<typeof postgres> | null = null;

export function db() {
  if (client) return client;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  client = postgres(url, {
    ssl: "prefer",
    max: 4,
    onnotice: () => {},
    // DB_DEBUG=1 logs one line per query (SQL text only, no parameters, no
    // rows) so page query counts can be measured. Off in production.
    debug: process.env.DB_DEBUG === "1" ? (_conn, query) => console.log(`[q] ${query.slice(0, 80).replace(/\s+/g, " ")}`) : false,
  });
  return client;
}

export async function closeDb() {
  if (client) {
    await client.end({ timeout: 5 });
    client = null;
  }
}
