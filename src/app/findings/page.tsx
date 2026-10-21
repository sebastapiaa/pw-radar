import Shell from "../components/Shell";
import FindingCard from "../components/FindingCard";
import { SelectionProvider, SelectionBar, SelectionControls } from "../components/Selection";
import { OUTREACH_MAX_COMPANIES } from "@/lib/limits";
import { cachedRankedFindings } from "@/lib/queries";
import { ordinal, fmtInt } from "@/lib/format";

export const dynamic = "force-dynamic";

/** The full ranked list. One column, expand in place. docs/DESIGN.md §Layout. */
export default async function FindingsPage() {
  const findings = await cachedRankedFindings(300);
  const selectable = findings.filter((f) => f.source !== "manual");
  const allIds = selectable.map((f) => f.companyId);
  const unflaggedIds = selectable.filter((f) => f.gateStatus !== "flagged").map((f) => f.companyId);

  return (
    <Shell>
      <main className="list">
        <header className="page-head">
          <p className="eyebrow">NO.001 / findings</p>
          <h1>{fmtInt(findings.length)} accounts, ranked.</h1>
          <p className="lede">
            Best score per company over the last 30 days. Warmer accent means fresher signal. Click a row to expand,
            the name to open the account, or tick the box to add it to an outreach list.
          </p>
        </header>
        <SelectionProvider maxCompanies={OUTREACH_MAX_COMPANIES}>
          {findings.length > 0 && <SelectionControls all={allIds} unflagged={unflaggedIds} />}
          {findings.length === 0 ? (
            <p className="empty">No new signals in the last 30 days.</p>
          ) : (
            <ol className="findings">
              {findings.map((f, i) => (
                <FindingCard key={f.companyId} finding={f} position={ordinal(i + 1, findings.length)} />
              ))}
            </ol>
          )}
          <SelectionBar />
        </SelectionProvider>
        <p className="foot muted">Score = fit × strength × recency × stack. Components are shown on each card.</p>
      </main>
    </Shell>
  );
}
