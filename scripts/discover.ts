/**
 * Phase 0 acceptance check (docs/ROADMAP.md): authenticate, enumerate the live
 * tool list, and assert every role the workers depend on is mapped and present.
 *
 * Free calls only: tools/list costs nothing. Prints tool names, never payloads.
 *
 *   npm run zi:discover
 */

import { ZoomInfoClient, FREE_ROLES, PAID_ROLES, AI_ROLES, type Role } from "../src/lib/zoominfo";

const WORKER_ROLES: Role[] = [
  "searchCompanies",
  "searchSignals",
  "searchScoops",
  "recommendedContacts",
  "enrichSignals",
  "enrichContacts",
];

async function main() {
  const bearerToken = process.env.ZI_BEARER_TOKEN || undefined;
  const client = new ZoomInfoClient({
    clientId: bearerToken ? "" : requireEnv("ZI_CLIENT_ID"),
    clientSecret: bearerToken ? "" : requireEnv("ZI_CLIENT_SECRET"),
    tokenUrl: process.env.ZI_TOKEN_URL,
    scope: process.env.ZI_SCOPE,
    bearerToken,
    freeOnly: true,
  });

  console.log(bearerToken ? "auth: portal bearer token (test only)" : "auth: client credentials");

  const tools = (await client.discoverTools()).sort();
  const verbose = process.argv.includes("--describe");
  console.log(`\nlive tools (${tools.length}):`);
  for (const t of tools) {
    const desc = client.describeTool(t)?.description?.replace(/\s+/g, " ") ?? "";
    console.log(verbose ? `  ${t}\n      ${desc}` : `  ${t}  ${desc.slice(0, 90)}`);
  }
  if (verbose) {
    // Input schemas describe filters, not data. Useful once, when building the workers.
    for (const t of tools) {
      const schema = client.describeTool(t)?.inputSchema;
      if (schema) console.log(`\n${t} inputSchema:\n${JSON.stringify(schema, null, 2)}`);
    }
  }

  console.log("\nrole mapping:");
  const allRoles: Role[] = [...FREE_ROLES, ...PAID_ROLES, ...AI_ROLES];
  for (const role of allRoles) {
    const tool = client.toolFor(role);
    const state = !tool ? "UNMAPPED" : tools.includes(tool) ? "ok" : "MISSING";
    console.log(`  ${state.padEnd(9)} ${role.padEnd(20)} -> ${tool ?? "-"}`);
  }

  client.assertRoles(WORKER_ROLES);
  console.log("\nPhase 0 tool check: PASS. All worker roles are mapped and present.");
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. Fill it in .env (see .env.example).`);
  return v;
}

main().catch((err: Error) => {
  console.error(`\nPhase 0 tool check: FAIL. ${err.message}`);
  process.exit(1);
});
