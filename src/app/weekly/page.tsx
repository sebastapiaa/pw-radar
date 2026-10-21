import Link from "next/link";
import Shell from "../components/Shell";
import ContactRowView from "../components/ContactRow";
import { weeklyRuns, weeklyShortlist, weekDigestStats } from "@/lib/queries";
import { fmtInt, sizeBand } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Weekly digest: the Sunday run's shortlist with the buying committee for
 * each account, and a one-click Salesloft export of that week's contacts.
 * Older weeks selectable by run.
 */
export default async function WeeklyPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const { run } = await searchParams;
  const [runs, stats] = await Promise.all([weeklyRuns(8), weekDigestStats()]);
  const current = runs.find((r) => r.runId === run) ?? runs[0] ?? null;
  const shortlist = current ? await weeklyShortlist(current.runId) : [];
  const withEmail = shortlist.reduce((n, s) => n + s.contacts.length, 0);
  const back = current ? `/weekly?run=${current.runId}` : "/weekly";

  return (
    <Shell>
      <main>
        <header className="page-head">
          <p className="eyebrow">NO.006 / weekly digest</p>
          <h1>
            {current ? (
              <>
                {current.job === "outreach" ? "Outreach list" : "Week"} of {current.startedAt.slice(0, 10)}:{" "}
                <span className="brand-red">{fmtInt(shortlist.length)}</span> accounts ready to work.
              </>
            ) : (
              <>No lists yet.</>
            )}
          </h1>
          <p className="lede">
            Every Sunday the job ranks the week, clears the gate, pulls the buying committee for the top accounts and
            pays for their email and phone. You can also build a list yourself by ticking companies on{" "}
            <Link href="/findings">Findings</Link>. Either way, this page is the result, with the export Salesloft needs.
          </p>
        </header>

        <section className="tiles">
          <Tile label="New this week" value={fmtInt(stats.newThisWeek)} hint="accounts surfaced, gate-cleared" />
          <Tile label="Contacts with email" value={fmtInt(withEmail)} hint={current ? "in this week's shortlist" : ""} />
          <Tile label="Credits this month" value={fmtInt(stats.creditsMonth)} hint="of 500 cap" />
          <Tile label="Awaiting approval" value={fmtInt(stats.flaggedAwaiting)} hint="flagged on the gate" href="/gate" />
        </section>

        {current && (
          <div className="digest-bar">
            <span className="muted small">
              run {current.startedAt.slice(0, 16).replace("T", " ")} UTC · {current.status} · {fmtInt(current.candidates)}{" "}
              candidates · {fmtInt(current.creditsSpent)} credits
            </span>
            <span className="row">
              {runs.length > 1 && (
                <form method="get" action="/weekly" className="inline-form">
                  <select name="run" defaultValue={current.runId} aria-label="Week">
                    {runs.map((r) => (
                      <option key={r.runId} value={r.runId}>
                        {r.startedAt.slice(0, 10)} · {r.job === "outreach" ? "outreach" : "Sunday"} · {r.shortlist} accounts
                      </option>
                    ))}
                  </select>{" "}
                  <button type="submit" className="button small ghost">
                    Show
                  </button>
                </form>
              )}
              <a
                className={`button small${withEmail === 0 ? " disabled" : ""}`}
                href={`/api/export?run=${current.runId}`}
                aria-disabled={withEmail === 0}
                title="Salesloft person-import CSV: this week's contacts with email"
              >
                Export {fmtInt(withEmail)} contacts to Salesloft
              </a>
            </span>
          </div>
        )}

        {!current ? (
          <section className="panel">
            <p className="muted">
              No Sunday run and no outreach list yet. Tick companies on the <Link href="/findings">findings list</Link>{" "}
              and press &ldquo;Get contacts &amp; build export&rdquo; to make one now.
            </p>
          </section>
        ) : shortlist.length === 0 ? (
          <section className="panel">
            <p className="muted">The run finished but shortlisted nothing. Check the gate queue and the run log.</p>
          </section>
        ) : (
          <ol className="digest">
            {shortlist.map((s) => (
              <li key={s.companyId} className="panel">
                <header className="digest-head">
                  <span className="pos">{String(s.rank).padStart(2, "0")}</span>
                  <span className="body">
                    <Link href={`/accounts/${encodeURIComponent(s.companyId)}`} className="name">
                      {s.name}
                    </Link>
                    <span className="muted small">
                      {sizeBand(s.employeeCount)} · {fmtInt(s.employeeCount)} staff · {s.city ?? "—"}
                      {s.lastOutcome && <span className="pill">{s.lastOutcome}</span>}
                      {s.gateStatus === "approved" && <span className="pill">approved by you</span>}
                    </span>
                  </span>
                  <span className="score">{s.score}</span>
                </header>
                {s.whyNow && <p className="why">{s.whyNow}</p>}
                {s.contacts.length === 0 ? (
                  <p className="muted small">
                    {s.contactsPicked} picked, none enriched with an email. Open the account to retry people.
                  </p>
                ) : (
                  <ul className="contacts">
                    {s.contacts.map((c) => (
                      <ContactRowView key={c.id} contact={c} back={back} />
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
      </main>
    </Shell>
  );
}

function Tile({ label, value, hint, href }: { label: string; value: string; hint?: string; href?: string }) {
  const body = (
    <>
      <p className="eyebrow">{label}</p>
      <p className="value">{value}</p>
      {hint && <p className="hint">{hint}</p>}
    </>
  );
  return href ? (
    <Link href={href} className="tile link-tile">
      {body}
    </Link>
  ) : (
    <div className="tile">{body}</div>
  );
}
