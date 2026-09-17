import { authMode } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  const mode = authMode();

  return (
    <main className="login">
      <p className="eyebrow">NO.000 / sign in</p>
      <h1>
        <span>Radar</span>
      </h1>
      <p className="muted">PerimeterWatch internal. No public pages.</p>

      {error && <p className="error">{error}</p>}

      {mode === "entra" && (
        <a className="button" href="/api/auth/microsoft">
          Sign in with Microsoft
        </a>
      )}

      {mode === "password" && (
        <form method="post" action="/api/auth/password" className="stack">
          <input type="hidden" name="next" value={next ?? "/"} />
          <label>
            Password
            <input type="password" name="password" autoComplete="current-password" autoFocus required />
          </label>
          <button type="submit" className="button">
            Sign in
          </button>
        </form>
      )}

      {mode === "unconfigured" && (
        <p className="error">
          Sign-in is not configured. Set AUTH_SECRET plus either the Microsoft Entra variables or
          AUTH_PASSWORD.
        </p>
      )}
    </main>
  );
}
