import Link from "next/link";
import type { FindingRow } from "@/lib/queries";
import { sizeBand } from "@/lib/queries";
import { ageLabel, fmtInt, warmth } from "@/lib/format";
import CardBody from "./CardBody";

/**
 * One row of the ranked list. The accent colour is data: it warms with
 * freshness (docs/DESIGN.md §Signature element). Age is also written out so
 * colour is never the only channel. Expands in place via <details>; the name
 * is a link straight to the account page.
 */
export default function FindingCard({ finding: f, position }: { finding: FindingRow; position: string }) {
  const w = warmth(f.ageDays);
  const href = `/accounts/${encodeURIComponent(f.companyId)}`;
  return (
    <li className="finding" style={{ ["--warmth" as string]: w }}>
      <details>
        <summary>
          <span className="pos">{position}</span>
          <span className="heat" aria-hidden="true" />
          <span className="name">
            <Link href={href}>{f.name}</Link>
            {f.source === "manual" && <span className="pill">manual</span>}
            {f.lastOutcome && <span className="pill">{f.lastOutcome}</span>}
          </span>
          <span className="score">{f.score}</span>
          <span className="meta">{f.whyNow ?? "No current signal."}</span>
          <span className="facts">
            {sizeBand(f.employeeCount)} · {fmtInt(f.employeeCount)} staff · {f.city ?? "—"} ·{" "}
            <span className="age">{ageLabel(f.ageDays)}</span>
            {f.contactCount > 0 && <> · {f.contactCount} contacts</>}
            {f.noteCount > 0 && <> · {f.noteCount} notes</>}
            {f.tags.length > 0 && <> · {f.tags.join(", ")}</>}
          </span>
        </summary>
        <CardBody companyId={f.companyId} back="/findings" />
        <p className="card-foot">
          <Link href={href} className="button small">
            Open account
          </Link>
          <span className="muted small">
            fit {f.icpFit} · strength {f.signalStrength.toFixed(2)} · recency {f.recencyDecay.toFixed(2)} · stack{" "}
            {f.stackBonus.toFixed(2)} · {f.signalCount} signals
          </span>
        </p>
      </details>
    </li>
  );
}
