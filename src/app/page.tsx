import Link from "next/link";
import Shell from "./components/Shell";
import FindingCard from "./components/FindingCard";
import { rankedFindings } from "@/lib/queries";
import { ordinal } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Home() {
  const findings = await rankedFindings(200);

  return (
    <Shell eyebrow="NO.001 / findings">
      <main className="list">
        {findings.length === 0 ? (
          <p className="empty">No new signals in the last 30 days.</p>
        ) : (
          <ol className="findings">
            {findings.map((f, i) => (
              <FindingCard key={f.companyId} finding={f} position={ordinal(i + 1, findings.length)} />
            ))}
          </ol>
        )}
        <p className="foot muted">
          Ranked by score = fit × strength × recency × stack. Warmer accent means fresher signal.{" "}
          <Link href="/scopes">Scopes</Link>
        </p>
      </main>
    </Shell>
  );
}
