import { NextResponse, type NextRequest } from "next/server";
import { authMode, checkPassword, createSessionToken, sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth";

/** Crude brute-force brake: per-process, per-IP, 5 attempts per 15 minutes. */
const attempts = new Map<string, { n: number; reset: number }>();

export async function POST(req: NextRequest) {
  if (authMode() !== "password") {
    return NextResponse.redirect(new URL("/login?error=Password+sign-in+is+not+enabled", req.url), 303);
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const now = Date.now();
  const a = attempts.get(ip);
  if (a && a.reset > now && a.n >= 5) {
    return NextResponse.redirect(new URL("/login?error=Too+many+attempts.+Wait+15+minutes.", req.url), 303);
  }

  const form = await req.formData();
  const candidate = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "/");

  if (!checkPassword(candidate)) {
    attempts.set(ip, { n: (a && a.reset > now ? a.n : 0) + 1, reset: a && a.reset > now ? a.reset : now + 15 * 60_000 });
    return NextResponse.redirect(new URL("/login?error=Wrong+password", req.url), 303);
  }

  attempts.delete(ip);
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const res = NextResponse.redirect(new URL(safeNext, req.url), 303);
  res.cookies.set(
    SESSION_COOKIE,
    await createSessionToken({ actor: "password-user", name: "Radar user", mode: "password" }),
    sessionCookieOptions()
  );
  return res;
}
