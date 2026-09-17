import { contactsForCompany, notesFor, signalsForCompany, companyById } from "@/lib/queries";
import { addNote, setCompanyTags, setOutcome } from "@/lib/actions";
import { fmtDate } from "@/lib/format";
import ContactRowView from "./ContactRow";

/**
 * Expanded card content: signals with their scope, contacts (masked), notes,
 * tags, outcome buttons. Server component; each form posts to a server action.
 */
export default async function CardBody({ companyId, back }: { companyId: string; back: string }) {
  const [signals, contacts, notes, company] = await Promise.all([
    signalsForCompany(companyId, 12),
    contactsForCompany(companyId),
    notesFor("company", companyId),
    companyById(companyId),
  ]);

  return (
    <div className="card-body">
      <section>
        <h3 className="eyebrow">Signals</h3>
        {signals.length === 0 ? (
          <p className="muted">None stored.</p>
        ) : (
          <ul className="signals">
            {signals.map((s) => (
              <li key={s.id}>
                <span className="kind">{s.kind}</span>
                {s.kind === "intent" ? (
                  <>
                    <span className="topic">{s.topic}</span>
                    <span className="muted">
                      {s.rawScore ?? "—"}
                      {s.audienceStrength ?? ""} · {fmtDate(s.signalDate)}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="topic">{s.topic}</span>
                    <span className="headline">
                      {s.link ? (
                        <a href={s.link} target="_blank" rel="noreferrer noopener">
                          {s.headline}
                        </a>
                      ) : (
                        s.headline
                      )}
                    </span>
                    <span className="muted">{fmtDate(s.signalDate)}</span>
                  </>
                )}
                {s.scopeName && (
                  <span className="scope">
                    → <i>{s.scopeName}</i>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="eyebrow">People</h3>
        {contacts.length === 0 ? (
          <p className="muted">No contacts yet. The Sunday run enriches the shortlist.</p>
        ) : (
          <ul className="contacts">
            {contacts.map((c) => (
              <ContactRowView key={c.id} contact={c} back={back} />
            ))}
          </ul>
        )}
      </section>

      <section className="two-col">
        <div>
          <h3 className="eyebrow">Outcome</h3>
          <form action={setOutcome} className="row">
            <input type="hidden" name="companyId" value={companyId} />
            <input type="hidden" name="back" value={back} />
            {["contacted", "replied", "meeting", "dead"].map((s) => (
              <button key={s} type="submit" name="status" value={s} className="button small">
                {s}
              </button>
            ))}
          </form>
          <h3 className="eyebrow">Tags</h3>
          <form action={setCompanyTags} className="row">
            <input type="hidden" name="companyId" value={companyId} />
            <input type="hidden" name="back" value={back} />
            <input
              type="text"
              name="tags"
              defaultValue={company?.tags.join(", ") ?? ""}
              placeholder="client, do-not-contact, partner:name, event:name"
              aria-label="Tags, comma separated"
            />
            <button type="submit" className="button small">
              Save tags
            </button>
          </form>
        </div>
        <div>
          <h3 className="eyebrow">Notes</h3>
          <form action={addNote} className="stack">
            <input type="hidden" name="entityType" value="company" />
            <input type="hidden" name="entityId" value={companyId} />
            <input type="hidden" name="back" value={back} />
            <textarea name="body" rows={2} placeholder="Add a note" aria-label="Note" />
            <button type="submit" className="button small">
              Add note
            </button>
          </form>
          {notes.length > 0 && (
            <ul className="notes">
              {notes.slice(0, 5).map((n) => (
                <li key={n.id}>
                  <span className="muted">{fmtDate(n.createdAt)}</span> {n.body}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
