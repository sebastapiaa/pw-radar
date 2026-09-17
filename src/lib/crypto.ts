/**
 * Application-layer encryption for contact PII.
 *
 * Postgres is already encrypted at rest. This is the second layer: if someone
 * gets a database dump, they should not get a call list. The key lives in
 * Railway env, separate from the database credential.
 *
 * Only email and phone go through here. Company name, domain and signals are
 * not personal data and encrypting them makes dashboard queries painful for
 * no gain. See docs/SECURITY.md.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";

function key(): Buffer {
  const raw = process.env.PII_ENCRYPTION_KEY;
  if (!raw) throw new Error("PII_ENCRYPTION_KEY is not set");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("PII_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  return k;
}

/** Layout: [12B iv][16B auth tag][ciphertext] */
export function encryptPII(plaintext: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

export function decryptPII(blob: Buffer): string {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const ct = blob.subarray(28);
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/** For list views that should show shape without revealing the value. */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return "•••";
  const head = user.slice(0, 1);
  return `${head}${"•".repeat(Math.max(user.length - 1, 2))}@${domain}`;
}

/** Generate a key: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" */
