import Link from "next/link";
import type { ReactNode } from "react";
import { headerStats } from "@/lib/queries";
import { getSession } from "@/lib/session";
import { fmtInt } from "@/lib/format";

/** Authenticated page chrome: header strip with counts, nav, sign-out. */
export default async function Shell({ children, eyebrow }: { children: ReactNode; eyebrow?: string }) {
  const [stats, session] = await Promise.all([headerStats(), getSession()]);
  const lastRun = stats.lastRunAt ? new Date(stats.lastRunAt) : null;
  const lastRunLabel = lastRun
    ? `${lastRun.toISOString().slice(0, 10)} ${stats.lastRunStatus === "ok" ? "" : `(${stats.lastRunStatus})`}`.trim()
    : "never";

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <Link href="/">
            <span className="brand-red">Radar</span>
          </Link>
          {eyebrow && <span className="eyebrow inline">{eyebrow}</span>}
        </div>
        <nav className="stats">
          <span>
            this week <b>{fmtInt(stats.thisWeek)}</b>
          </span>
          <span>
            credits this week <b>{fmtInt(stats.creditsSpentWeek)}</b>
          </span>
          <span>
            last run <b>{lastRunLabel}</b>
          </span>
          <Link href="/accounts/new">+ account</Link>
          <a href="/api/export" title="Salesloft person-import CSV, shortlist contacts">
            export
          </a>
          <form method="post" action="/api/auth/logout" className="inline-form">
            <button type="submit" className="link" title={session?.email ?? session?.name}>
              sign out
            </button>
          </form>
        </nav>
      </header>
      {children}
    </>
  );
}
