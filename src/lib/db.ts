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
    // Never let the driver print connection details or row data.
    debug: false,
  });
  return client;
}

export async function closeDb() {
  if (client) {
    await client.end({ timeout: 5 });
    client = null;
  }
}
