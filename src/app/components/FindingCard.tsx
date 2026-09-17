import Link from "next/link";
import type { FindingRow } from "@/lib/queries";
import { sizeBand } from "@/lib/queries";
import { ageLabel, fmtInt, warmth } from "@/lib/format";
import CardBody from "./CardBody";

/**
 * One row of the ranked list. The accent colour is data: it warms with
 * freshness (docs/DESIGN.md §Signature element). Age is also written out so
 * colour is never the only channel. Expands in place via <details>.
 */
export default function FindingCard({ finding: f, position }: { finding: FindingRow; position: string }) {
  const w = warmth(f.ageDays);
  return (
    <li className="finding" style={{ ["--warmth" as string]: w }}>
      <details>
        <summary>
          <span className="pos">{position}</span>
          <span className="heat" aria-hidden="true" />
          <span className="name">
            {f.name}
            {f.source === "manual" && <span className="pill">manual</span>}
            {f.lastOutcome && <span className="pill">{f.lastOutcome}</span>}
          </span>
          <span className="score">
            score <b>{f.score}</b>
          </span>
          <span className="meta">
            {f.whyNow ?? "No current signal."}
          </span>
          <span className="facts">
            {sizeBand(f.employeeCount)} · {fmtInt(f.employeeCount)} staff · {f.city ?? "—"} ·{" "}
            <span className="age">{ageLabel(f.ageDays)}</span>
            {f.contactCount > 0 && <> · {f.contactCount} contacts</>}
            {f.tags.length > 0 && <> · {f.tags.join(", ")}</>}
          </span>
        </summary>
        <CardBody companyId={f.companyId} back="/" />
        <p className="card-foot">
          <Link href={`/accounts/${encodeURIComponent(f.companyId)}`}>Open account profile →</Link>
          <span className="muted">
            fit {f.icpFit} · strength {f.signalStrength.toFixed(2)} · recency {f.recencyDecay.toFixed(2)} · stack{" "}
            {f.stackBonus.toFixed(2)} · {f.signalCount} signals
          </span>
        </p>
      </details>
    </li>
  );
}
