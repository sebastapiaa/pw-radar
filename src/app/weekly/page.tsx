import Link from "next/link";
import Shell from "../components/Shell";
import ContactRowView from "../components/ContactRow";
import { weeklyRuns, weeklyShortlist, weekDigestStats } from "@/lib/queries";
import { nextExportName } from "@/lib/exports";
import { fmtInt, sizeBand } from "@/lib/format";
import ExportForm from "../components/ExportForm";
import ListProgress from "../components/ListProgress";
import { exportContacts } from "@/lib/contact-export";
import { MONTHLY_CREDIT_CAP } from "@/lib/limits";
import { UUID_RE } from "@/lib/contact-lists";
import { requireSession } from "@/lib/session";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Weekly digest: the Sunday run's shortlist with the buying committee for
 * each account, and a one-click Salesloft export of that week's contacts.
 * Older weeks selectable by run.
 */
export default async function WeeklyPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const { run } = await searchParams;
  if (run && !UUID_RE.test(run)) notFound();
  const session = await requireSession();
  const [runs, stats, suggestedName] = await Promise.all([weeklyRuns(12, run ?? null), weekDigestStats(), nextExportName()]);
  const current = run ? runs.find((r) => r.runId === run) ?? null : runs[0] ?? null;
  if (run && !current) notFound();
  const shortlist = current ? await weeklyShortlist(current.runId) : [];
  const ready = current?.listVersion === 1 ? await exportContacts(current.runId) : [];
  const withEmail = ready.length;
  const readyIds = new Set(ready.map((c) => c.zi_contact_id));
  const remaining = shortlist.filter((s) => ['pending','failed','processing'].includes(s.contactStatus)).length;
  const back = current ? `/weekly?run=${current.runId}` : "/weekly";

  return (
    <Shell>
      <main>
        <header className="page-head">
          <p className="eyebrow">NO.006 / contact lists</p>
          <h1>
            {current ? (
              <>
                <span className="brand-red">{fmtInt(withEmail)}</span> contacts ready to export.
              </>
            ) : (
              <>No lists yet.</>
            )}
          </h1>
          <p className="lede">
            Review IT leaders, security leaders and relevant executives from the accounts you chose.
            Build a list by selecting eligible companies on <Link href="/findings">Findings</Link>.
            Each list keeps its selected people and can be exported to Salesloft.
          </p>
        </header>

        <section className="tiles">
          <Tile label="New this week" value={fmtInt(stats.newThisWeek)} hint="accounts surfaced, gate-cleared" />
          <Tile label="Contacts with email" value={fmtInt(withEmail)} hint={current ? "eligible people in this saved list" : ""} />
          <Tile label="Credit upper bound this month" value={fmtInt(stats.creditsMonth)} hint={`of ${fmtInt(MONTHLY_CREDIT_CAP)} cap`} />
          <Tile label="Awaiting approval" value={fmtInt(stats.flaggedAwaiting)} hint="flagged on the gate" href="/gate" />
        </section>

        {current && (
          <div className="digest-bar">
            <span className="muted small">
              {current.startedAt.slice(0, 16).replace("T", " ")} UTC · {current.status} · {fmtInt(shortlist.length)}{" "}
              accounts · up to {fmtInt(current.creditsSpent)} credits
            </span>
            <span className="row">
              {runs.length > 1 && (
                <form method="get" action="/weekly" className="inline-form">
                  <select name="run" defaultValue={current.runId} aria-label="Week">
                    {runs.map((r) => (
                      <option key={r.runId} value={r.runId}>
                        {r.startedAt.slice(0, 16).replace('T', ' ')} · {r.job === "outreach" ? "chosen accounts" : "Sunday"} · {r.status} · {r.shortlist} accounts
                      </option>
                    ))}
                  </select>{" "}
                  <button type="submit" className="button small ghost">
                    Show
                  </button>
                </form>
              )}
              <ExportForm runId={current.runId} suggestedName={suggestedName} count={withEmail} compact />
            </span>
          </div>
        )}

        {current?.listVersion === 0 && <p className="panel muted">This older list has no saved contact selection. Create a new list from <Link href="/findings">Findings</Link> to review and export the exact people selected.</p>}
        {current?.job === 'outreach' && current.listVersion === 1 && current.actor === session.actor && remaining > 0 && (
          <ListProgress runId={current.runId} remaining={remaining} />
        )}

        {!current ? (
          <section className="panel">
            <p className="muted">
              No Sunday run and no outreach list yet. Tick companies on the <Link href="/findings">findings list</Link>{" "}
              and press &ldquo;Build contact list&rdquo; to make one now.
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
                <p className="muted small">{s.contactStatus} · {s.contactsPicked} selected · {s.contacts.filter((c) => readyIds.has(c.id)).length} ready to export</p>
                {s.contactError && <p className="error small">{s.contactError}</p>}
                {s.contacts.length === 0 ? (
                  <p className="muted small">
                    {s.contactStatus === 'complete' ? 'No eligible buying committee was found in the recommendations.' : 'No contacts have been selected for this account yet.'}
                  </p>
                ) : (
                  <ul className="contacts">
                    {s.contacts.map((c) => (
                      <ContactRowView key={c.id} contact={c} back={back} allowEnrich={false} exportReady={readyIds.has(c.id)} />
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
