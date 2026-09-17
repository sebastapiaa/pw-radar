import type { ProfileBody, SignalRow } from "@/lib/queries";
import { fmtDate } from "@/lib/format";

/**
 * Render generated profile prose with signal phrases highlighted. Each span
 * cites a stored signal id and a scope slug; spans that cite nothing stored
 * are dropped here as a second guard (the first is at insert time).
 * Highlight = tint + underline, never colour alone. Hover names the scope
 * and the signal behind it.
 */
export default function ProfileText({ body, signals }: { body: ProfileBody; signals: SignalRow[] }) {
  const byId = new Map(signals.map((s) => [s.id, s]));
  const spans = [...body.spans]
    .filter((sp) => byId.has(sp.signal_id) && sp.start >= 0 && sp.end > sp.start && sp.end <= body.text.length)
    .sort((a, b) => a.start - b.start);

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  spans.forEach((sp, i) => {
    if (sp.start < cursor) return; // overlapping span; skip
    if (sp.start > cursor) parts.push(body.text.slice(cursor, sp.start));
    const sig = byId.get(sp.signal_id)!;
    const title = `${sig.scopeName ?? sp.scope_slug} — ${sig.kind}: ${sig.topic ?? sig.headline ?? ""}${
      sig.rawScore ? ` ${sig.rawScore}${sig.audienceStrength ?? ""}` : ""
    } · ${fmtDate(sig.signalDate)}`;
    parts.push(
      <mark key={i} className="hl" title={title} data-scope={sp.scope_slug}>
        {body.text.slice(sp.start, sp.end)}
      </mark>
    );
    cursor = sp.end;
  });
  if (cursor < body.text.length) parts.push(body.text.slice(cursor));

  return <p className="prose">{parts}</p>;
}
