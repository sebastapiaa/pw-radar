/**
 * Deterministic account summary, built from stored signals only. No model.
 * This is the fallback shown when no generated profile exists, and the
 * "why now" in prose. Every phrase traces to a stored signal.
 */

import type { SignalRow } from "./queries";
import { AMBIENT_TOPICS } from "./scoring";

export interface SummaryPart {
  text: string;
  scopeName?: string | null;
  signalIds?: number[];
}

export function buildSummary(signals: SignalRow[], employeeCount: number | null): SummaryPart[] {
  const parts: SummaryPart[] = [];
  const intents = signals.filter((s) => s.kind === "intent" && s.topic);
  const scoops = signals.filter((s) => s.kind === "scoop");

  // Core intent grouped by scope, freshest first.
  const byScope = new Map<string, { scope: string | null; topics: Map<string, number[]>; freshest: string | null }>();
  for (const s of intents) {
    if (AMBIENT_TOPICS.has(s.topic!)) continue;
    const key = s.scopeName ?? "—";
    let g = byScope.get(key);
    if (!g) {
      g = { scope: s.scopeName, topics: new Map(), freshest: null };
      byScope.set(key, g);
    }
    const ids = g.topics.get(s.topic!) ?? [];
    ids.push(s.id);
    g.topics.set(s.topic!, ids);
    if (s.signalDate && (!g.freshest || s.signalDate > g.freshest)) g.freshest = s.signalDate;
  }
  const groups = [...byScope.values()].sort((a, b) => (b.freshest ?? "").localeCompare(a.freshest ?? ""));
  for (const g of groups.slice(0, 3)) {
    const topicNames = [...g.topics.keys()].slice(0, 3).map(shortTopic);
    const ids = [...g.topics.values()].flat();
    parts.push({
      text: `Researching ${listJoin(topicNames)}${g.freshest ? ` as of ${g.freshest}` : ""}.`,
      scopeName: g.scope,
      signalIds: ids,
    });
  }

  const ambient = intents.filter((s) => AMBIENT_TOPICS.has(s.topic!));
  if (ambient.length && parts.length) {
    parts.push({
      text: `Also reading on ${listJoin([...new Set(ambient.map((s) => shortTopic(s.topic!)))].slice(0, 3))}.`,
      signalIds: ambient.map((s) => s.id),
    });
  }

  for (const s of scoops.slice(0, 2)) {
    parts.push({
      text: `${s.topic ?? "Event"}${s.signalDate ? ` (${s.signalDate})` : ""}: ${trimHeadline(s.headline)}`,
      signalIds: [s.id],
    });
  }

  if (parts.length) {
    const n = employeeCount ?? 0;
    parts.push({
      text:
        n && n < 500
          ? "Under 500 staff: likely little in place, full-coverage conversation."
          : n >= 1000
            ? "Over 1,000 staff: tools and people exist, augmentation conversation (alert fatigue, 24/7 coverage)."
            : "Mid-band: check which of tooling or headcount is the gap.",
    });
  }
  return parts;
}

function shortTopic(t: string): string {
  return t.replace(/\s*\([^)]*\)\s*$/, "").replace("Security Information & Event Management", "SIEM").replace("Managed Detection & Response", "MDR");
}

function trimHeadline(h: string | null): string {
  if (!h) return "";
  const t = h.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return t.length > 140 ? `${t.slice(0, 137)}…` : t;
}

function listJoin(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
