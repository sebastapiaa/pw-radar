import Link from "next/link";
import Shell from "../components/Shell";
import { flaggedAwaiting, latestGateSummary } from "@/lib/queries";
import { approveGate } from "@/lib/actions";
import { fmtInt } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Verification gate: what the last run killed and flagged, per check and
 * per topic, and the accounts waiting for Seb's approval before enrichment.
 */
export default async function GatePage() {
  const [summary, flagged] = await Promise.all([latestGateSummary(), flaggedAwaiting(50)]);

  return (
    <Shell>
      <main>
        <header className="page-head">
          <p className="eyebrow">NO.005 / verification gate</p>
          <h1>Nothing gets a credit until it clears the gate.</h1>
          <p className="lede">
            Free checks kill the unambiguous (security vendors, dead or acquired companies) and flag the rest for you.
            Flagged accounts stay listed and are not enriched until you approve them here.
          </p>
        </header>

        <section className="panel">
          <header className="panel-head">
            <h2>Awaiting your approval</h2>
            <span className="muted">{flagged.length ? `${flagged.length} accounts` : "none"}</span>
          </header>
          {flagged.length === 0 ? (
            <p className="muted">No flagged accounts. The gate runs with every Sunday job.</p>
          ) : (
            <ul className="flagged">
              {flagged.map((f) => (
                <li key={f.companyId}>
                  <span className="body">
                    <Link href={`/accounts/${encodeURIComponent(f.companyId)}`} className="name">
                      {f.name}
                    </Link>
                    <span className="muted">
                      {f.decisions
                        .filter((d) => d.verdict === "flag")
                        .map((d) => `${d.check}: ${d.reason}`)
                        .join(" · ") || f.reason}
                    </span>
                  </span>
                  <span className="score">{f.score ?? "—"}</span>
                  <form action={approveGate}>
                    <input type="hidden" name="companyId" value={f.companyId} />
                    <input type="hidden" name="back" value="/gate" />
                    <button type="submit" className="button small">
                      Approve for enrichment
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>

        {summary && (
          <div className="home-grid" style={{ marginTop: 12 }}>
            <section className="panel">
              <header className="panel-head">
                <h2>Last gate run</h2>
                <span className="muted">{summary.startedAt.slice(0, 16).replace("T", " ")} UTC</span>
              </header>
              <table className="plain">
                <tbody>
                  <tr>
                    <td>Candidates</td>
                    <td className="num">{fmtInt(summary.candidates)}</td>
                  </tr>
                  <tr>
                    <td>Passed</td>
                    <td className="num">{fmtInt(summary.passed)}</td>
                  </tr>
                  <tr>
                    <td>Flagged</td>
                    <td className="num">{fmtInt(summary.flagged)}</td>
                  </tr>
                  <tr>
                    <td>Killed</td>
                    <td className="num">{fmtInt(summary.killed)}</td>
                  </tr>
                </tbody>
              </table>
              <h3 className="eyebrow">By check</h3>
              <table className="plain">
                <tbody>
                  {summary.byCheck.map((c) => (
                    <tr key={`${c.check}-${c.verdict}`}>
                      <td>{c.check}</td>
                      <td>{c.verdict}</td>
                      <td className="num">{fmtInt(c.n)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section className="panel">
              <header className="panel-head">
                <h2>Reasons</h2>
              </header>
              <table className="plain">
                <tbody>
                  {summary.reasons.map((r) => (
                    <tr key={`${r.check}-${r.verdict}-${r.reason}`}>
                      <td>{r.check}</td>
                      <td>{r.verdict}</td>
                      <td>{r.reason}</td>
                      <td className="num">{fmtInt(r.n)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section className="panel span-2">
              <header className="panel-head">
                <h2>By topic</h2>
                <span className="muted">kill and flag rates among candidates with that intent</span>
              </header>
              <table className="plain">
                <tbody>
                  {summary.perTopic.map((t) => (
                    <tr key={t.topic}>
                      <td>{t.topic}</td>
                      <td className="num">{fmtInt(t.candidates)}</td>
                      <td className="num muted">{t.killed} killed</td>
                      <td className="num muted">{t.flagged} flagged</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        )}
      </main>
    </Shell>
  );
}
