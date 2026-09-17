import Link from "next/link";

export default function NotFound() {
  return (
    <main className="narrow">
      <p className="eyebrow">NO.404</p>
      <h1>Nothing here.</h1>
      <p className="muted">
        The account or page does not exist. <Link href="/">Back to home</Link>
      </p>
    </main>
  );
}
