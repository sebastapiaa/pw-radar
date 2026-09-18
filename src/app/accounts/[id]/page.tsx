import Link from "next/link";
import { notFound } from "next/navigation";
import Shell from "../../components/Shell";
import ProfileText from "../../components/ProfileText";
import ContactRowView from "../../components/ContactRow";
import {
  companyById,
  contactsForCompany,
  findingHistory,
  notesFor,
  outcomesFor,
  profileFor,
  signalsForCompany,
  sizeBand,
} from "@/lib/queries";
import { addNote, setCompanyTags, setOutcome, findPeople, approveGate } from "@/lib/actions";
import { gateDecisionsFor } from "@/lib/queries";
import { buildSummary } from "@/lib/summary";
import { ageLabel, fmtDate, fmtInt, warmth } from "@/lib/format";
import { DEAD_REASONS, DEAD_LABELS } from "@/lib/taxonomy";

export const dynamic = "force-dynamic";

/**
 * Account profile. Left: what we know and why now (summary, signals, people,
 * history). Right: what Seb does about it (outcome, tags, notes).
 */
export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id: raw } = await params;
  const { error } = await searchParams;
  const id = decodeURIComponent(raw);
  const company = await companyById(id);
  if (!company) notFound();

  const [profile, history, outcomes, signals, contacts, notes, gate] = await Promise.all([
    profileFor(id),
    findingHistory(id),
    outcomesFor(id),
    signalsForCompany(id, 60),
    contactsForCompany(id),
    notesFor("company", id),
    gateDecisionsFor(id),
  ]);
  const back = `/accounts/${encodeURIComponent(id)}`;
  const latest = history[0] ?? null;
  const freshest = signals.find((s) => s.signalDate)?.signalDate ?? null;
  const ageDays = freshest ? Math.max(0, Math.round((Date.now() - new Date(freshest).getTime()) / 86_400_000)) : null;
  const summary = buildSummary(signals, company.employeeCount);
  const lastOutcome = outcomes[0] ?? null;
  const intents = signals.filter((s) => s.kind === "intent");
  const scoops = signals.filter((s) => s.kind !== "intent");

  return (
    <Shell>
      <main className="account" style={{ ["--warmth" as string]: warmth(ageDays) }}>
        <header className="account-head">
          <p className="eyebrow">
            <Link href="/findings">Findings</Link> / account
          </p>
          <div className="title-row">
            <h1>{company.name}</h1>
            {latest && (
              <span className="score-badge" title="Latest score">
                {latest.score}
              </span>
            )}
          </div>
          <p className="facts">
            {company.domain ? (
              <a href={`https://${company.domain}`} target="_blank" rel="noreferrer noopener">
                {company.domain}
              </a>
            ) : (
              "no domain"
            )}
            {" · "}
            {sizeBand(company.employeeCount)} · {fmtInt(company.employeeCount)} staff ·{" "}
            {[company.city, company.state].filter(Boolean).join(", ") || "location unknown"}
            {" · "}
            <span className="age">freshest signal {ageLabel(ageDays)}</span>
            {lastOutcome && <span className="pill">{lastOutcome.status}</span>}
            {company.tags.map((t) => (
              <span key={t} className="pill">
                {t}
              </span>
            ))}
          </p>
        </header>

        {error && <p className="error">{error}</p>}

        {company.gateStatus === "flagged" && (
          <div className="banner">
            <span>
              <b>Flagged by the verification gate:</b> {company.gateReason ?? "see checks"}.{" "}
              <span className="muted">Not enriched until approved.</span>
            </span>
            <form action={approveGate}>
              <input type="hidden" name="companyId" value={id} />
              <input type="hidden" name="back" value={back} />
              <button type="submit" className="button small">
                Approve for enrichment
              </button>
            </form>
          </div>
        )}
        {company.gateStatus === "killed" && (
          <div className="banner killed">
            <span>
              <b>Excluded by the verification gate:</b> {company.gateReason}. Hidden from the list; suppressed for a year.
            </span>
          </div>
        )}
        {company.gateStatus === "approved" && (
          <p className="gate-facts">Gate flag approved by you. The next Sunday run may enrich this account.</p>
        )}

        <div className="account-grid">
          <div className="account-main">
            <section className="panel">
              <header className="panel-head">
                <h2>Why now</h2>
                {freshest && <span className="muted">as of {freshest}</span>}
              </header>
              {profile ? (
                <>
                  <ProfileText body={profile.body} signals={signals} />
                  <p className="muted small">Generated {profile.generatedAt} from stored signals only. Hover a highlight for its source.</p>
                </>
              ) : summary.length === 0 ? (
                <p className="muted">No signals stored for this account.</p>
              ) : (
                <ul className="summary">
                  {summary.map((p, i) => (
                    <li key={i}>
                      {p.text}
                      {p.scopeName && (
                        <span className="scope">
                          {" "}
                          → <i>{p.scopeName}</i>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel">
              <header className="panel-head">
                <h2>People</h2>
                <span className="muted">
                  {contacts.length
                    ? `${contacts.filter((c) => c.enrichedAt).length} of ${contacts.length} with email`
                    : "none yet"}
                </span>
              </header>
              {company.source === "manual" ? (
                <p className="muted">Manual account: no ZoomInfo id, so no recommendations. Add people in notes.</p>
              ) : contacts.length === 0 ? (
                <form action={findPeople} className="row">
                  <input type="hidden" name="companyId" value={id} />
                  <input type="hidden" name="back" value={back} />
                  <button type="submit" className="button small">
                    Find people · free
                  </button>
                  <span className="muted small">
                    ZoomInfo&apos;s recommended contacts: names, titles and who is the buyer. Email and phone are one
                    credit each, on request.
                  </span>
                </form>
              ) : (
                <>
                  <ul className="contacts">
                    {contacts
                      .filter((c) => c.tier !== "other")
                      .map((c) => (
                        <ContactRowView key={c.id} contact={c} back={back} />
                      ))}
                  </ul>
                  {contacts.some((c) => c.tier === "other") && (
                    <details className="others">
                      <summary className="muted small">
                        {contacts.filter((c) => c.tier === "other").length} more outside the buying committee
                      </summary>
                      <ul className="contacts">
                        {contacts
                          .filter((c) => c.tier === "other")
                          .map((c) => (
                            <ContactRowView key={c.id} contact={c} back={back} />
                          ))}
                      </ul>
                    </details>
                  )}
                  <form action={findPeople} className="row">
                    <input type="hidden" name="companyId" value={id} />
                    <input type="hidden" name="back" value={back} />
                    <button type="submit" className="link muted small">
                      Refresh recommendations · free
                    </button>
                  </form>
                </>
              )}
            </section>

            <section className="panel">
              <header className="panel-head">
                <h2>Signals</h2>
                <span className="muted">
                  {intents.length} intent · {scoops.length} events
                </span>
              </header>
              {signals.length === 0 ? (
                <p className="muted">None stored.</p>
              ) : (
                <table className="signals-table">
                  <tbody>
                    {signals.map((s) => (
                      <tr key={s.id}>
                        <td className="date">{fmtDate(s.signalDate)}</td>
                        <td className="kind">{s.kind}</td>
                        <td>
                          {s.kind === "intent" ? (
                            <>
                              <b>{s.topic}</b>
                              <span className="muted">
                                {" "}
                                {s.rawScore ?? "—"}
                                {s.audienceStrength ?? ""}
                              </span>
                            </>
                          ) : (
                            <>
                              <b>{s.topic}</b>{" "}
                              {s.link ? (
                                <a href={s.link} target="_blank" rel="noreferrer noopener">
                                  {s.headline}
                                </a>
                              ) : (
                                s.headline
                              )}
                            </>
                          )}
                        </td>
                        <td className="scope">{s.scopeName && <i>{s.scopeName}</i>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {(gate.length > 0 || company.locationType || company.parentCompanyId) && (
              <section className="panel">
                <header className="panel-head">
                  <h2>Verification</h2>
                  <span className="muted">{gate[0]?.createdAt ?? ""}</span>
                </header>
                <p className="gate-facts">
                  {company.locationType && <>location {company.locationType} · </>}
                  {company.employmentTrend && <>headcount {company.employmentTrend.replace(/_/g, " ")} · </>}
                  {company.parentCompanyId && (
                    <>
                      rolls up to{" "}
                      <Link href={`/accounts/${encodeURIComponent(company.parentCompanyId)}`}>{company.parentCompanyId}</Link>
                    </>
                  )}
                </p>
                {gate.length > 0 && (
                  <table className="plain">
                    <tbody>
                      {gate.map((g, i) => (
                        <tr key={i}>
                          <td>{g.check}</td>
                          <td className={g.verdict === "kill" ? "error" : g.verdict === "flag" ? "muted" : ""}>{g.verdict}</td>
                          <td className="muted">{g.reason ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            )}

            <section className="panel">
              <header className="panel-head">
                <h2>History</h2>
                <span className="muted">score per run</span>
              </header>
              {history.length === 0 ? (
                <p className="muted">Never surfaced.</p>
              ) : (
                <table className="plain">
                  <tbody>
                    {history.map((h, i) => (
                      <tr key={i}>
                        <td>{h.createdAt}</td>
                        <td className="num">
                          <b>{h.score}</b>
                        </td>
                        <td className="muted">{h.whyNow}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>

          <aside className="account-side">
            <section className="panel">
              <h2>Outcome</h2>
              <form action={setOutcome} className="stack">
                <input type="hidden" name="companyId" value={id} />
                <input type="hidden" name="back" value={back} />
                <div className="row">
                  {["contacted", "replied", "meeting"].map((s) => (
                    <button
                      key={s}
                      type="submit"
                      name="status"
                      value={s}
                      className={`button small${lastOutcome?.status === s ? " current" : ""}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <input type="text" name="note" placeholder="Optional note with the outcome" aria-label="Outcome note" />
              </form>
              <details className="others">
                <summary className="muted small">Mark dead (needs a reason)</summary>
                <form action={setOutcome} className="stack" style={{ marginTop: 8 }}>
                  <input type="hidden" name="companyId" value={id} />
                  <input type="hidden" name="back" value={back} />
                  <input type="hidden" name="status" value="dead" />
                  <label>
                    Why
                    <select name="reason" required defaultValue="">
                      <option value="" disabled>
                        Choose a reason
                      </option>
                      {DEAD_REASONS.map((r) => (
                        <option key={r} value={r}>
                          {DEAD_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <input type="text" name="note" placeholder="Note (required for 'other')" aria-label="Dead note" />
                  <button type="submit" className="button small ghost">
                    Mark dead
                  </button>
                </form>
              </details>
              {outcomes.length > 0 && (
                <ul className="timeline">
                  {outcomes.map((o, i) => (
                    <li key={i}>
                      <span className="muted">{fmtDate(o.notedAt)}</span> <b>{o.status}</b>
                      {o.note && <span className="muted"> · {o.note}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel">
              <h2>Tags</h2>
              <form action={setCompanyTags} className="stack">
                <input type="hidden" name="companyId" value={id} />
                <input type="hidden" name="back" value={back} />
                <input
                  type="text"
                  name="tags"
                  defaultValue={company.tags.join(", ")}
                  placeholder="client, do-not-contact, partner:name, event:name"
                  aria-label="Tags, comma separated"
                />
                <button type="submit" className="button small">
                  Save tags
                </button>
              </form>
              <p className="muted small">client, do-not-contact and partner:* hide the account from the list.</p>
            </section>

            <section className="panel">
              <h2>Notes</h2>
              <form action={addNote} className="stack">
                <input type="hidden" name="entityType" value="company" />
                <input type="hidden" name="entityId" value={id} />
                <input type="hidden" name="back" value={back} />
                <textarea name="body" rows={3} placeholder="What you learned, who said what" aria-label="Note" />
                <button type="submit" className="button small">
                  Add note
                </button>
              </form>
              {notes.length > 0 && (
                <ul className="timeline">
                  {notes.map((n) => (
                    <li key={n.id}>
                      <span className="muted">{fmtDate(n.createdAt)}</span> {n.body}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <p className="muted small">
              Source {company.source} · first seen {fmtDate(company.firstSeenAt)} · last seen {fmtDate(company.lastSeenAt)}
            </p>
          </aside>
        </div>
      </main>
    </Shell>
  );
}
