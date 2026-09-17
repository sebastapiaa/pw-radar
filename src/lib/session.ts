/**
 * Server-side session access for pages, server actions and route handlers.
 * The middleware already redirected anonymous requests, so a null here is a
 * programming error, not an expected state; requireSession() throws.
 */

import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE, type Session } from "./auth";

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  return readSessionToken(jar.get(SESSION_COOKIE)?.value);
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new Error("Not signed in");
  return s;
}
