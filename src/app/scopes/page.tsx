import Shell from "../components/Shell";
import { scopesList } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** The scopes catalog: PerimeterWatch services and the intent topics each maps to. */
export default async function ScopesPage() {
  const scopes = await scopesList();
  return (
    <Shell>
      <main className="narrow">
        <header className="page-head">
          <p className="eyebrow">NO.004 / scopes</p>
          <h1>What we sell, and what it looks like when they want it.</h1>
          <p className="lede">
            Each service line is bundled with the ZoomInfo intent topics that point to it. Signals on an account resolve
            to one of these.
          </p>
        </header>
        <ol className="scopes">
          {scopes.map((s, i) => (
            <li key={s.slug} className="panel">
              <p className="eyebrow">NO.{String(i + 1).padStart(3, "0")}</p>
              <h2>{s.name}</h2>
              <p>{s.description}</p>
              <p className="topics">
                {s.topics.map((t) => (
                  <span key={t} className="pill">
                    {t}
                  </span>
                ))}
              </p>
            </li>
          ))}
        </ol>
      </main>
    </Shell>
  );
}
