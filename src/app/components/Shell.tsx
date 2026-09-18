import Link from "next/link";
import type { ReactNode } from "react";
import { getSession } from "@/lib/session";

/** Authenticated page chrome: brand, primary nav, sign-out. Counts live on the home page. */
export default async function Shell({ children }: { children: ReactNode }) {
  const session = await getSession();
  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand">
          <span className="brand-red">Radar</span>
          <span className="brand-sub">PerimeterWatch</span>
        </Link>
        <nav className="nav">
          <Link href="/">Home</Link>
          <Link href="/findings">Findings</Link>
          <Link href="/gate">Gate</Link>
          <Link href="/scopes">Scopes</Link>
          <Link href="/accounts/new">Add account</Link>
          <a href="/api/export" title="Salesloft person-import CSV, shortlist contacts">
            Export
          </a>
        </nav>
        <form method="post" action="/api/auth/logout" className="inline-form">
          <button type="submit" className="link muted" title={session?.email ?? session?.name}>
            Sign out
          </button>
        </form>
      </header>
      {children}
    </>
  );
}
