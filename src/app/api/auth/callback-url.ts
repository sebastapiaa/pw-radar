import type { NextRequest } from "next/server";

/**
 * The redirect URI registered in Entra. Prefer DASHBOARD_URL so the value is
 * stable behind Vercel preview hosts; fall back to the request origin locally.
 */
export function callbackUrl(req: NextRequest): string {
  const base = process.env.DASHBOARD_URL?.replace(/\/$/, "") || new URL(req.url).origin;
  return `${base}/api/auth/callback/microsoft-entra-id`;
}
