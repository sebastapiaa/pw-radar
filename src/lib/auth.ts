/**
 * Authentication. Two modes, chosen by environment:
 *
 *   Microsoft Entra ID (preferred): AUTH_MICROSOFT_ENTRA_ID_ID, _SECRET, _TENANT set.
 *     Single-tenant OpenID Connect with PKCE. Anyone with a work account in the
 *     PerimeterWatch tenant can sign in; the tenant id and email domain are both
 *     checked on the id_token, so a token from any other tenant is rejected.
 *
 *   Shared password (fallback): AUTH_PASSWORD set, Entra vars absent.
 *     One secret, compared in constant time. Actor identity is the literal
 *     "password-user"; per-person audit trails need the Entra mode.
 *
 * Sessions are a signed JWT (HS256, AUTH_SECRET) in an httpOnly, secure,
 * sameSite=lax cookie, 12 hours. No session table. See docs/SECURITY.md.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify, createRemoteJWKSet } from "jose";

export const SESSION_COOKIE = "radar_session";
export const SESSION_HOURS = 12;
const PKCE_COOKIE = "radar_pkce";

export interface Session {
  /** Stable actor id written to notes, outcomes and export_log. */
  actor: string;
  name: string;
  email?: string;
  mode: "entra" | "password";
}

export type AuthMode = "entra" | "password" | "unconfigured";

export function authMode(): AuthMode {
  if (
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID &&
    process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET &&
    process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT
  ) {
    return "entra";
  }
  if (process.env.AUTH_PASSWORD) return "password";
  return "unconfigured";
}

function secretKey(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be set and at least 32 characters");
  return new TextEncoder().encode(s);
}

// ---------- session cookie ----------

export async function createSessionToken(session: Session): Promise<string> {
  return new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secretKey());
}

export async function readSessionToken(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (typeof payload.actor !== "string" || typeof payload.name !== "string") return null;
    return {
      actor: payload.actor,
      name: payload.name,
      email: typeof payload.email === "string" ? payload.email : undefined,
      mode: payload.mode === "entra" ? "entra" : "password",
    };
  } catch {
    return null;
  }
}

export function sessionCookieOptions(maxAgeSeconds = SESSION_HOURS * 3600) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

// ---------- password mode ----------

export function checkPassword(candidate: string): boolean {
  const expected = process.env.AUTH_PASSWORD ?? "";
  if (!expected) return false;
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

// ---------- Microsoft Entra ID (OIDC + PKCE) ----------

const ALLOWED_EMAIL_DOMAIN = (process.env.AUTH_ALLOWED_DOMAIN ?? "perimeterwatch.com").toLowerCase();

function entraConfig() {
  const clientId = process.env.AUTH_MICROSOFT_ENTRA_ID_ID!;
  const clientSecret = process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET!;
  const tenant = process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT!;
  const issuer = `https://login.microsoftonline.com/${tenant}/v2.0`;
  return {
    clientId,
    clientSecret,
    tenant,
    issuer,
    authorizeUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    jwks: createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`)),
  };
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface PkceState {
  verifier: string;
  state: string;
  nonce: string;
}

/** Build the redirect to Microsoft and the short-lived PKCE cookie value. */
export async function beginEntraLogin(redirectUri: string): Promise<{ url: string; pkceCookie: string }> {
  const cfg = entraConfig();
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(16));
  const nonce = base64url(randomBytes(16));

  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: "openid profile email",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  // The PKCE state rides in a signed, short-lived cookie so it survives the round trip.
  const pkceCookie = await new SignJWT({ verifier, state, nonce } satisfies PkceState)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(secretKey());

  return { url: `${cfg.authorizeUrl}?${params}`, pkceCookie };
}

export const PKCE_COOKIE_NAME = PKCE_COOKIE;

export async function readPkceCookie(value: string | undefined): Promise<PkceState | null> {
  if (!value) return null;
  try {
    const { payload } = await jwtVerify(value, secretKey(), { algorithms: ["HS256"] });
    if (typeof payload.verifier !== "string" || typeof payload.state !== "string" || typeof payload.nonce !== "string") {
      return null;
    }
    return { verifier: payload.verifier, state: payload.state, nonce: payload.nonce };
  } catch {
    return null;
  }
}

/**
 * Exchange the code, validate the id_token against the tenant's keys, and
 * enforce tenant + email domain. Returns a Session or throws with a reason
 * safe to show the user.
 */
export async function completeEntraLogin(
  code: string,
  state: string,
  pkce: PkceState,
  redirectUri: string
): Promise<Session> {
  if (state !== pkce.state) throw new Error("Sign-in state mismatch. Try again.");
  const cfg = entraConfig();

  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: pkce.verifier,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!res.ok || !json.id_token) {
    throw new Error(`Microsoft sign-in failed (${json.error ?? res.status}).`);
  }

  const { payload } = await jwtVerify(json.id_token, cfg.jwks, {
    issuer: cfg.issuer,
    audience: cfg.clientId,
  });

  if (payload.nonce !== pkce.nonce) throw new Error("Sign-in nonce mismatch. Try again.");
  if (payload.tid !== cfg.tenant) throw new Error("This account is not in the PerimeterWatch tenant.");

  const email = String(payload.preferred_username ?? payload.email ?? "").toLowerCase();
  if (!email.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)) {
    throw new Error(`Only @${ALLOWED_EMAIL_DOMAIN} accounts can sign in.`);
  }

  const oid = typeof payload.oid === "string" ? payload.oid : email;
  return {
    actor: `entra:${oid}`,
    name: typeof payload.name === "string" ? payload.name : email,
    email,
    mode: "entra",
  };
}
