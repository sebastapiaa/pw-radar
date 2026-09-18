"use client";

import { useState } from "react";
import Link from "next/link";
import type { FindingRow } from "@/lib/queries";
import { ageLabel, fmtInt, sizeBand, warmth } from "@/lib/format";
import CardBody from "./CardBody";

/**
 * One row of the ranked list. The accent colour is data: it warms with
 * freshness (docs/DESIGN.md §Signature element). Age is also written out so
 * colour is never the only channel. Expands in place; the body loads on the
 * first open. The name is a link straight to the account page.
 */
export default function FindingCard({ finding: f, position }: { finding: FindingRow; position: string }) {
  const [open, setOpen] = useState(false);
  const w = warmth(f.ageDays);
  const href = `/accounts/${encodeURIComponent(f.companyId)}`;
  return (
    <li className="finding" style={{ ["--warmth" as string]: w }}>
      <details open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>
          <span className="pos">{position}</span>
          <span className="heat" aria-hidden="true" />
          <span className="name">
            <Link href={href} onClick={(e) => e.stopPropagation()}>
              {f.name}
            </Link>
            {f.source === "manual" && <span className="pill">manual</span>}
            {f.lastOutcome && <span className="pill">{f.lastOutcome}</span>}
            {f.gateStatus === "flagged" && (
              <span className="pill flag" title={f.gateReason ?? ""}>
                flagged
              </span>
            )}
          </span>
          <span className="score">{f.score}</span>
          <span className="meta">{f.whyNow ?? "No current signal."}</span>
          <span className="facts">
            {sizeBand(f.employeeCount)} · {fmtInt(f.employeeCount)} staff · {f.city ?? "—"} ·{" "}
            <span className="age">{ageLabel(f.ageDays)}</span>
            {f.contactCount > 0 && <> · {f.contactCount} people</>}
            {f.noteCount > 0 && <> · {f.noteCount} notes</>}
            {f.tags.length > 0 && <> · {f.tags.join(", ")}</>}
          </span>
        </summary>
        <CardBody companyId={f.companyId} back="/findings" open={open} />
        {open && (
          <p className="card-foot">
            <Link href={href} className="button small">
              Open account
            </Link>
            <span className="muted small">
              fit {f.icpFit} · strength {f.signalStrength.toFixed(2)} · recency {f.recencyDecay.toFixed(2)} · stack{" "}
              {f.stackBonus.toFixed(2)} · {f.signalCount} signals
            </span>
          </p>
        )}
      </details>
    </li>
  );
}
