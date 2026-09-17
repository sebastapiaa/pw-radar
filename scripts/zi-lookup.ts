/**
 * Print ZoomInfo reference values the workers filter on. Free call. Reference
 * data only, no company or contact records.
 *
 *   npm run zi:lookup                 # intent topics, scoop types, scoop topics
 *   npm run zi:lookup -- metro-regions san     # any field, optional fuzzy match
 */

import { ZoomInfoClient } from "../src/lib/zoominfo";

const DEFAULT_FIELDS = [
  { fieldName: "intent-topics" },
  { fieldName: "scoop-types" },
  { fieldName: "scoop-topics" },
];

async function main() {
  const [fieldName, fuzzyMatch] = process.argv.slice(2);
  const fields = fieldName ? [{ fieldName, ...(fuzzyMatch ? { fuzzyMatch } : {}) }] : DEFAULT_FIELDS;

  const client = new ZoomInfoClient({
    clientId: requireEnv("ZI_CLIENT_ID"),
    clientSecret: requireEnv("ZI_CLIENT_SECRET"),
    tokenUrl: process.env.ZI_TOKEN_URL,
    scope: process.env.ZI_SCOPE,
    bearerToken: process.env.ZI_BEARER_TOKEN || undefined,
    freeOnly: true,
  });
  await client.discoverTools();
  client.assertRoles(["lookup"]);

  const result = await client.call<unknown>("lookup", {
    fields,
    userIntent: "Radar internal tool: enumerate reference filter values for scheduled signal searches.",
  });
  console.log(JSON.stringify(result, null, 2));
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. Fill it in .env (see .env.example).`);
  return v;
}

main().catch((err: Error) => {
  console.error(`lookup failed: ${err.message}`);
  process.exit(1);
});
