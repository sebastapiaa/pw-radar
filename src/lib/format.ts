/** Presentation helpers shared by server and client components. No data access. */

/** 0 = decayed, 1 = fresh. ~10 day half-life, matches recencyDecay in scoring. */
export function warmth(ageDays: number | null): number {
  if (ageDays === null) return 0.2;
  return Math.pow(0.5, Math.max(ageDays, 0) / 10);
}

export function ageLabel(ageDays: number | null): string {
  if (ageDays === null) return "no date";
  if (ageDays === 0) return "today";
  if (ageDays === 1) return "1 day";
  return `${ageDays} days`;
}

/** 007/042 form. Position and total, per docs/DESIGN.md §Numbering. */
export function ordinal(i: number, total: number): string {
  const w = Math.max(3, String(total).length);
  return `${String(i).padStart(w, "0")}/${String(total).padStart(w, "0")}`;
}

export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US");
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}
