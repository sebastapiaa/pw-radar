import { NextResponse, type NextRequest } from "next/server";
import {
  completeEntraLogin,
  createSessionToken,
  readPkceCookie,
  sessionCookieOptions,
  PKCE_COOKIE_NAME,
  SESSION_COOKIE,
} from "@/lib/auth";
import { callbackUrl } from "../../callback-url";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error_description") ?? url.searchParams.get("error");

  const fail = (msg: string) => {
    const res = NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(msg)}`, req.url));
    res.cookies.delete(PKCE_COOKIE_NAME);
    return res;
  };

  if (providerError) return fail(providerError.slice(0, 200));
  if (!code || !state) return fail("Missing sign-in response.");

  const pkce = await readPkceCookie(req.cookies.get(PKCE_COOKIE_NAME)?.value);
  if (!pkce) return fail("Sign-in session expired. Try again.");

  try {
    const session = await completeEntraLogin(code, state, pkce, callbackUrl(req));
    const res = NextResponse.redirect(new URL("/", req.url));
    res.cookies.set(SESSION_COOKIE, await createSessionToken(session), sessionCookieOptions());
    res.cookies.delete(PKCE_COOKIE_NAME);
    return res;
  } catch (err) {
    return fail((err as Error).message);
  }
}
