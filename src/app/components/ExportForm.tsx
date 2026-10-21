/**
 * Name-and-export form. A plain GET form to /api/export so the browser
 * downloads the CSV; the name becomes the Salesloft tag.
 */
export default function ExportForm({
  runId,
  suggestedName,
  count,
  compact,
}: {
  runId?: string | null;
  suggestedName: string;
  count: number;
  compact?: boolean;
}) {
  const disabled = count === 0;
  return (
    <form method="get" action="/api/export" className={`export-form${compact ? " compact" : ""}`}>
      {runId && <input type="hidden" name="run" value={runId} />}
      <label className="inline">
        <span className="muted small">export name</span>
        <input type="text" name="name" defaultValue={suggestedName} pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,39}" title="2-40 letters, digits, dash or underscore" size={14} />
      </label>
      {!compact && (
        <label className="inline">
          <span className="muted small">note</span>
          <input type="text" name="note" placeholder="optional, e.g. Q4 SoCal push" size={24} maxLength={500} />
        </label>
      )}
      <button type="submit" className="button small" disabled={disabled} title={disabled ? "No contacts with email to export" : "Download the Salesloft CSV and record this export"}>
        Export {count} to Salesloft
      </button>
    </form>
  );
}
