import { NextResponse, type NextRequest } from "next/server";
import { authMode, beginEntraLogin, PKCE_COOKIE_NAME } from "@/lib/auth";
import { callbackUrl } from "../callback-url";

export async function GET(req: NextRequest) {
  if (authMode() !== "entra") {
    return NextResponse.redirect(new URL("/login?error=Microsoft+sign-in+is+not+configured", req.url));
  }
  const { url, pkceCookie } = await beginEntraLogin(callbackUrl(req));
  const res = NextResponse.redirect(url);
  res.cookies.set(PKCE_COOKIE_NAME, pkceCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/",
    maxAge: 600,
  });
  return res;
}
