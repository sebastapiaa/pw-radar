import Shell from "../components/Shell";
import { scopesList } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** The scopes catalog: PerimeterWatch services and the intent topics each maps to. */
export default async function ScopesPage() {
  const scopes = await scopesList();
  return (
    <Shell eyebrow="NO.004 / scopes">
      <main className="narrow">
        <h1>Scopes</h1>
        <p className="muted">
          Each service line bundled with the ZoomInfo intent topics that point to it. Highlights in account profiles
          resolve to one of these.
        </p>
        <ol className="scopes">
          {scopes.map((s, i) => (
            <li key={s.slug}>
              <p className="eyebrow">NO.{String(i + 1).padStart(3, "0")}</p>
              <h2>{s.name}</h2>
              <p>{s.description}</p>
              <p className="muted">{s.topics.join(" · ")}</p>
            </li>
          ))}
        </ol>
      </main>
    </Shell>
  );
}
