/**
 * Placeholder root. Proves the Next toolchain runs; it is not the dashboard.
 * The dashboard is Phase 3 in docs/ROADMAP.md and starts only after Phases 0–2 pass.
 */
export default function Home() {
  return (
    <main>
      <p className="eyebrow">NO.000 / scaffold</p>
      <h1>
        <span>Radar</span> is running.
      </h1>
      <p>No dashboard yet. The console is built in Phase 3, after the workers pass.</p>
      <dl>
        <dt>Phase 0</dt>
        <dd>Prerequisites: ZoomInfo credentials, tool mapping, Postgres, credit cap</dd>
        <dt>Phase 1</dt>
        <dd>Daily worker on free calls only</dd>
        <dt>Phase 2</dt>
        <dd>Sunday worker with shortlist enrichment</dd>
        <dt>Phase 3</dt>
        <dd>Dashboard</dd>
      </dl>
    </main>
  );
}
