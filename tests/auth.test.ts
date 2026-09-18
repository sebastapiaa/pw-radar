import { test, before } from "node:test";
import assert from "node:assert/strict";

let auth: typeof import("../src/lib/auth");

before(async () => {
  process.env.AUTH_SECRET = "test-secret-that-is-at-least-32-characters-long";
  process.env.AUTH_PASSWORD = "correct horse battery staple";
  delete process.env.AUTH_MICROSOFT_ENTRA_ID_ID;
  auth = await import("../src/lib/auth");
});

test("session token round-trips and rejects tampering", async () => {
  const token = await auth.createSessionToken({ actor: "entra:abc", name: "Seb", email: "s@perimeterwatch.com", mode: "entra" });
  const s = await auth.readSessionToken(token);
  assert.equal(s?.actor, "entra:abc");
  assert.equal(s?.mode, "entra");
  assert.equal(await auth.readSessionToken(token.slice(0, -2) + "xx"), null);
  assert.equal(await auth.readSessionToken(undefined), null);
});

test("password check is exact and mode resolves from env", () => {
  assert.equal(auth.checkPassword("correct horse battery staple"), true);
  assert.equal(auth.checkPassword("correct horse battery"), false);
  assert.equal(auth.authMode(), "password");
});
