import { notFound } from "next/navigation";
import Shell from "../../components/Shell";
import CardBody from "../../components/CardBody";
import ProfileText from "../../components/ProfileText";
import { companyById, findingHistory, outcomesFor, profileFor, signalsForCompany, sizeBand } from "@/lib/queries";
import { fmtDate, fmtInt } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Account profile: description with highlighted signal phrases linked to
 * scopes (once the Sunday run has generated one), people, signal history,
 * outcomes. Everything on the card, plus the full history.
 */
export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  const company = await companyById(id);
  if (!company) notFound();

  const [profile, history, outcomes, signals] = await Promise.all([
    profileFor(id),
    findingHistory(id),
    outcomesFor(id),
    signalsForCompany(id, 60),
  ]);
  const back = `/accounts/${encodeURIComponent(id)}`;

  return (
    <Shell eyebrow="NO.002 / account">
      <main className="account">
        <header className="account-head">
          <h1>{company.name}</h1>
          <p className="muted">
            {company.domain ?? "no domain"} · {sizeBand(company.employeeCount)} · {fmtInt(company.employeeCount)} staff ·{" "}
            {[company.city, company.state].filter(Boolean).join(", ") || "location unknown"} · source {company.source} ·
            first seen {fmtDate(company.firstSeenAt)}
            {company.tags.length > 0 && <> · tags {company.tags.join(", ")}</>}
          </p>
        </header>

        <section className="profile">
          <h2 className="eyebrow">Profile</h2>
          {profile ? (
            <>
              <ProfileText body={profile.body} signals={signals} />
              <p className="muted small">
                Generated {profile.generatedAt} by {profile.model} from stored signals only. Highlights link to the scope
                they map to.
              </p>
            </>
          ) : (
            <p className="muted">
              No generated description yet. Profiles are written for the weekly shortlist from stored signals and
              PerimeterWatch&apos;s scopes; nothing here is invented.
            </p>
          )}
        </section>

        <CardBody companyId={id} back={back} />

        <section className="two-col">
          <div>
            <h2 className="eyebrow">Finding history</h2>
            {history.length === 0 ? (
              <p className="muted">Never surfaced.</p>
            ) : (
              <table className="plain">
                <tbody>
                  {history.map((h, i) => (
                    <tr key={i}>
                      <td>{h.createdAt}</td>
                      <td className="num">{h.score}</td>
                      <td className="muted">{h.whyNow}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div>
            <h2 className="eyebrow">Outcomes</h2>
            {outcomes.length === 0 ? (
              <p className="muted">None recorded.</p>
            ) : (
              <table className="plain">
                <tbody>
                  {outcomes.map((o, i) => (
                    <tr key={i}>
                      <td>{fmtDate(o.notedAt)}</td>
                      <td>{o.status}</td>
                      <td className="muted">{o.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </main>
    </Shell>
  );
}
