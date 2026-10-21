import Link from "next/link";
import Shell from "../components/Shell";
import ExportForm from "../components/ExportForm";
import { exportsList, nextExportName } from "@/lib/exports";
import { db } from "@/lib/db";
import { fmtInt } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Export history: every CSV that ever left, by name, with its size and
 * source list. Plus the general export (everyone with an email, last 30 days)
 * for when a list was not built first.
 */
export default async function ExportsPage() {
  const [exports, suggested, [{ n: available }]] = await Promise.all([
    exportsList(100),
    nextExportName(),
    db()<{ n: number }[]>`
      select count(*)::int as n from contacts k join companies c using (zi_company_id)
      where k.email_enc is not null and c.gate_status <> 'killed'
        and exists (select 1 from findings f where f.zi_company_id = c.zi_company_id and f.created_at > now() - interval '30 days')`,
  ]);

  return (
    <Shell>
      <main>
        <header className="page-head">
          <p className="eyebrow">NO.007 / exports</p>
          <h1>Everything that left, by name.</h1>
          <p className="lede">
            Each export is tagged <code>pwradar</code> plus its own name in the Salesloft CSV, so you can filter all of
            Radar&apos;s people or one batch. Accounts and people show which export they went out in.
          </p>
        </header>

        <section className="panel">
          <header className="panel-head">
            <h2>Export everyone with an email</h2>
            <span className="muted">{fmtInt(available)} people across the current list</span>
          </header>
          <ExportForm suggestedName={suggested} count={available} />
          <p className="muted small">
            For a chosen set, tick companies on <Link href="/findings">Findings</Link> or use a list on{" "}
            <Link href="/weekly">Weekly</Link>; those exports are scoped to that list.
          </p>
        </section>

        <section className="panel" style={{ marginTop: 12 }}>
          <header className="panel-head">
            <h2>History</h2>
            <span className="muted">{exports.length ? `${exports.length} exports` : "none yet"}</span>
          </header>
          {exports.length === 0 ? (
            <p className="muted">No exports recorded. Exports made before 2026-10-21 were logged without names.</p>
          ) : (
            <table className="plain">
              <thead>
                <tr className="muted small">
                  <td>name</td>
                  <td>date</td>
                  <td className="num">people</td>
                  <td className="num">companies</td>
                  <td>source</td>
                  <td>note</td>
                </tr>
              </thead>
              <tbody>
                {exports.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <b>{e.name}</b>
                    </td>
                    <td>{e.createdAt.slice(0, 16).replace("T", " ")}</td>
                    <td className="num">{fmtInt(e.recordCount)}</td>
                    <td className="num">{fmtInt(e.companies)}</td>
                    <td>
                      {e.runId ? (
                        <Link href={`/weekly?run=${e.runId}`}>{e.runJob === "outreach" ? "outreach list" : "Sunday list"}</Link>
                      ) : (
                        <span className="muted">all with email</span>
                      )}
                    </td>
                    <td className="muted">{e.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </Shell>
  );
}
