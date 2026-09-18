import Link from "next/link";
import Shell from "./components/Shell";
import { cachedHomeData, sizeBand } from "@/lib/queries";
import { ageLabel, fmtInt, warmth } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Home: the Monday view. What is hot, what just happened, what you are
 * working, and whether the machine ran. Everything links into an account.
 * Data comes from one cached unit (60s, invalidated on writes).
 */
export default async function Home() {
  const { stats, top, scoops, topics, working, runs, seeded, gate } = await cachedHomeData();
  const lastRun = runs[0];
  const coreTopics = topics.filter((t) => t.scopeName).slice(0, 8);
  const maxTopic = Math.max(1, ...coreTopics.map((t) => t.companies));
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <Shell>
      <main className="home">
        <section className="hero">
          <p className="eyebrow">NO.000 / {today}</p>
          <h1>
            {stats.thisWeek === 0 ? (
              <>No new signals this week.</>
            ) : (
              <>
                <span className="brand-red">{fmtInt(stats.thisWeek)}</span> {stats.thisWeek === 1 ? "account" : "accounts"} in
                market this week.
              </>
            )}
          </h1>
          <p className="lede">
            Southern California, 100 to 5,000 staff, ranked by fit and timing.{" "}
            <Link href="/findings">See the full list →</Link>
          </p>
        </section>

        <section className="tiles">
          <Tile label="This week" value={fmtInt(stats.thisWeek)} hint="companies surfaced" />
          <Tile label="Top score" value={top[0] ? String(top[0].score) : "—"} hint={top[0]?.name ?? "no findings"} />
          <Tile
            label="Last run"
            value={lastRun ? lastRun.startedAt.slice(0, 10) : "never"}
            hint={lastRun ? `${lastRun.job} · ${lastRun.status} · ${fmtInt(lastRun.companiesSeen)} companies` : ""}
            warn={lastRun?.status === "failed"}
          />
          <Tile
            label="Awaiting approval"
            value={gate ? fmtInt(gate.awaitingApproval) : "—"}
            hint={gate ? `gate: ${gate.killed} killed · ${gate.flagged} flagged` : "gate has not run"}
            href="/gate"
          />
        </section>

        <div className="home-grid">
          <section className="panel span-2">
            <header className="panel-head">
              <h2>Top accounts right now</h2>
              <Link href="/findings">All {fmtInt(stats.thisWeek)} →</Link>
            </header>
            {top.length === 0 ? (
              <p className="muted">Nothing above threshold in the last 30 days.</p>
            ) : (
              <ol className="toplist">
                {top.map((f, i) => (
                  <li key={f.companyId} style={{ ["--warmth" as string]: warmth(f.ageDays) }}>
                    <span className="pos">{String(i + 1).padStart(2, "0")}</span>
                    <span className="heat" aria-hidden="true" />
                    <span className="body">
                      <Link href={`/accounts/${encodeURIComponent(f.companyId)}`} className="name">
                        {f.name}
                      </Link>
                      <span className="why">{f.whyNow}</span>
                      <span className="facts">
                        {sizeBand(f.employeeCount)} · {f.city ?? "—"} · <span className="age">{ageLabel(f.ageDays)}</span>
                        {f.lastOutcome && <span className="pill">{f.lastOutcome}</span>}
                        {f.gateStatus === "flagged" && (
                          <span className="pill flag" title={f.gateReason ?? ""}>
                            flagged
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="score">{f.score}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="panel">
            <header className="panel-head">
              <h2>Topics firing</h2>
              <span className="muted">last 7 days</span>
            </header>
            {coreTopics.length === 0 ? (
              <p className="muted">No intent this week.</p>
            ) : (
              <ul className="bars">
                {coreTopics.map((t) => (
                  <li key={t.topic}>
                    <span className="label" title={t.scopeName ?? ""}>
                      {t.topic.replace(/\s*\([^)]*\)\s*$/, "")}
                    </span>
                    <span className="bar" style={{ width: `${Math.round((t.companies / maxTopic) * 100)}%` }} />
                    <span className="num">{fmtInt(t.companies)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="muted small">
              Distinct companies per topic. <Link href="/scopes">Scopes →</Link>
            </p>
          </section>

          <section className="panel span-2">
            <header className="panel-head">
              <h2>Just happened</h2>
              <span className="muted">business events, last 7 days</span>
            </header>
            {scoops.length === 0 ? (
              <p className="muted">No new events this week.</p>
            ) : (
              <ul className="events">
                {scoops.map((s) => (
                  <li key={s.signalId}>
                    <span className="date">{s.signalDate}</span>
                    <span className="body">
                      <Link href={`/accounts/${encodeURIComponent(s.companyId)}`} className="name">
                        {s.companyName}
                      </Link>
                      <span className="kind">{s.type}</span>
                      <span className="headline">
                        {s.link ? (
                          <a href={s.link} target="_blank" rel="noreferrer noopener">
                            {s.headline}
                          </a>
                        ) : (
                          s.headline
                        )}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <header className="panel-head">
              <h2>Working</h2>
              <Link href="/accounts/new">+ Add account</Link>
            </header>
            {working.length === 0 && seeded.length === 0 ? (
              <p className="muted">Nothing in progress. Mark an outcome on an account and it shows here.</p>
            ) : (
              <ul className="working">
                {working.map((w) => (
                  <li key={w.companyId}>
                    <Link href={`/accounts/${encodeURIComponent(w.companyId)}`}>{w.name}</Link>
                    <span className="pill">{w.status}</span>
                    <span className="muted">{w.notedAt}</span>
                  </li>
                ))}
                {seeded.map((c) => (
                  <li key={c.companyId}>
                    <Link href={`/accounts/${encodeURIComponent(c.companyId)}`}>{c.name}</Link>
                    <span className="pill">{c.tags[0] ?? "manual"}</span>
                    <span className="muted">{c.firstSeenAt.slice(0, 10)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="runs">
          <p className="eyebrow">Machine</p>
          <ul>
            {runs.map((r) => (
              <li key={r.startedAt} className={r.status === "failed" ? "failed" : ""}>
                <span>{r.startedAt.slice(0, 16).replace("T", " ")} UTC</span>
                <span>{r.job}</span>
                <span>{r.status}</span>
                <span>{fmtInt(r.companiesSeen)} companies</span>
                <span>{fmtInt(r.findingsWritten)} new</span>
                <span>{fmtInt(r.creditsSpent)} credits</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </Shell>
  );
}

function Tile({ label, value, hint, warn, href }: { label: string; value: string; hint?: string; warn?: boolean; href?: string }) {
  const body = (
    <>
      <p className="eyebrow">{label}</p>
      <p className="value">{value}</p>
      {hint && <p className="hint">{hint}</p>}
    </>
  );
  return href ? (
    <Link href={href} className={`tile link-tile${warn ? " warn" : ""}`}>
      {body}
    </Link>
  ) : (
    <div className={`tile${warn ? " warn" : ""}`}>{body}</div>
  );
}
