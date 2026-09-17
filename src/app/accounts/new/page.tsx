import Shell from "../../components/Shell";
import { seedAccount } from "@/lib/actions";

export const dynamic = "force-dynamic";

/**
 * Manual account seeding: warm leads and partner intros that never came
 * through ZoomInfo. A source tag is required so analytics can separate them.
 */
export default async function NewAccountPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <Shell eyebrow="NO.003 / add account">
      <main className="narrow">
        <h1>Add an account</h1>
        <p className="muted">
          For leads that exist outside the scan: event invitees, partner intros, referrals. They join the same profile,
          notes and analytics. Geography does not apply here.
        </p>
        {error && <p className="error">{error}</p>}
        <form action={seedAccount} className="stack">
          <label>
            Company name
            <input type="text" name="name" required maxLength={200} autoFocus />
          </label>
          <label>
            Domain
            <input type="text" name="domain" placeholder="example.com" maxLength={200} />
          </label>
          <div className="row">
            <label>
              Employees
              <input type="number" name="employeeCount" min={1} max={1000000} />
            </label>
            <label>
              City
              <input type="text" name="city" maxLength={100} />
            </label>
            <label>
              State
              <input type="text" name="state" maxLength={2} placeholder="CA" />
            </label>
          </div>
          <label>
            Source tag
            <input type="text" name="sourceTag" required placeholder="event:padres-2026 or partner:repowerit" />
          </label>
          <label>
            First note
            <textarea name="note" rows={3} placeholder="Who, where, what was said" />
          </label>
          <button type="submit" className="button">
            Add account
          </button>
        </form>
      </main>
    </Shell>
  );
}
