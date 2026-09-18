/**
 * Scoring. Deterministic on purpose.
 *
 * An agent that decides each week what matters will drift and burn credits
 * unpredictably. This function you can read, argue with, and change. When Seb
 * says a ranking is wrong, you want to point at a component, not a prompt.
 *
 * Every component is stored alongside the total in `findings`.
 */

export interface RawSignal {
  kind: "intent" | "scoop" | "news";
  topic?: string;
  headline?: string;
  rawScore?: number;
  audienceStrength?: string;
  signalDate?: Date;
}

export interface CompanyFacts {
  employeeCount?: number;
  industry?: string;
  state?: string;
  country?: string;
}

export interface ScoreComponents {
  icpFit: number;
  signalStrength: number;
  recencyDecay: number;
  stackBonus: number;
  score: number;
  signalCount: number;
}

/** Confirmed with Seb 2026-09. Band and geography are settled; metros may need
 *  mapping to ZoomInfo's own location facets at query time. Geography should be
 *  filtered in the search query itself where possible — cheaper than fetching
 *  and discarding. This check is the backstop. */
export const ICP = {
  minEmployees: 100,
  maxEmployees: 5000,
  country: "US",
  state: "CA",
  // Southern California: San Diego, Orange County, LA, Inland Empire, Ventura.
  metros: ["San Diego", "Los Angeles", "Anaheim", "Riverside", "San Bernardino", "Oxnard"],
};

/** Binary for now. Outside the band, it does not surface at all. */
export function icpFit(c: CompanyFacts): number {
  const n = c.employeeCount ?? 0;
  if (n < ICP.minEmployees || n > ICP.maxEmployees) return 0;
  if (c.country && c.country !== ICP.country) return 0;
  if (c.state && c.state !== ICP.state) return 0;
  return 1;
}

/**
 * ZoomInfo reports audience strength as A (largest research group) to E
 * (smallest). Verified against live search_intent payloads 2026-09-17.
 */
const AUDIENCE_WEIGHT: Record<string, number> = {
  a: 1.0,
  b: 0.9,
  c: 0.75,
  d: 0.6,
  e: 0.5,
  f: 0.4, // observed live 2026-09-17; undocumented, treated as below E
};

/**
 * Topic tiers, from the first live run (2026-09-17, docs/ROADMAP.md Phase 1 notes).
 *
 * Ambient topics are things every company reads about: breaches, threats,
 * fraud. They each returned 500+ Southern California companies in one week
 * and say nothing about buying. They may stack on top of a core topic but
 * must not surface a company alone, so their weight keeps a lone ambient
 * signal under SURFACE_THRESHOLD even at score 100, audience A, today.
 * Core topics map to a PerimeterWatch service line and default to 1.0.
 */
const AMBIENT_TOPIC_WEIGHT = 0.45;
export const AMBIENT_TOPICS = new Set([
  "Data Breach",
  "Cyber Threats",
  "Zero-Day Threat",
  "Fraud Protection",
  "Advanced Threat Protection (ATP)",
  "Data Center Migration",
  // ZoomInfo's "Compliance" is the generic legal topic (category Compliance,
  // department Legal), not security compliance. 253 hits in week one.
  "Compliance",
]);

export function topicWeight(topic?: string): number {
  return topic && AMBIENT_TOPICS.has(topic) ? AMBIENT_TOPIC_WEIGHT : 1.0;
}

/**
 * Topics that are one signal under two names. A company researching both
 * MFA and 2FA has one interest, not a stack.
 */
const TOPIC_ALIASES: Record<string, string> = {
  "Two-Factor Authentication": "Multifactor Authentication",
  "Network Security Appliance": "Network Security",
};

export function canonicalTopic(topic?: string): string {
  if (!topic) return "";
  return TOPIC_ALIASES[topic] ?? topic;
}

/** Scoop types that mean "trying to staff security internally". */
const JOB_POSTING_TOPICS = new Set(["Open Position", "Hiring Plans"]);

/**
 * Strongest single signal drives strength; stacking is handled separately.
 *
 * Scoops carry no score from ZoomInfo, so they get a flat 0.8 base: a discrete
 * event is a real signal but a single job post is not an intent spike. Job
 * postings at 1,000+ employees are weighted up per docs/ARCHITECTURE.md §ICP.
 */
export function signalStrength(signals: RawSignal[], facts: CompanyFacts = {}): number {
  if (!signals.length) return 0;
  const large = (facts.employeeCount ?? 0) >= 1000;
  return Math.max(
    ...signals.map((s) => {
      if (s.kind === "intent") {
        const base = Math.min((s.rawScore ?? 60) / 100, 1);
        const aud = AUDIENCE_WEIGHT[(s.audienceStrength ?? "c").toLowerCase()] ?? 0.75;
        return base * aud * 0.9 * topicWeight(s.topic);
      }
      if (s.kind === "scoop") {
        const jobPost = JOB_POSTING_TOPICS.has(s.topic ?? "");
        return jobPost && large ? 0.95 : 0.8;
      }
      return 0.5; // news
    })
  );
}

/** Exponential decay, ~10 day half-life. Timing is the whole product. */
export function recencyDecay(signals: RawSignal[], now = new Date()): number {
  if (!signals.length) return 0;
  const HALF_LIFE_DAYS = 10;
  const freshest = Math.min(
    ...signals.map((s) => {
      if (!s.signalDate) return 30;
      return (now.getTime() - s.signalDate.getTime()) / 86_400_000;
    })
  );
  return Math.pow(0.5, Math.max(freshest, 0) / HALF_LIFE_DAYS);
}

/**
 * The intersection is where the real signal lives. Intent on SIEM plus a new
 * security director beats either alone by a lot. Distinct topics/kinds only —
 * five intent hits on one topic is one signal, not five.
 */
export function stackBonus(signals: RawSignal[]): number {
  const distinct = new Set(
    signals.map((s) => `${s.kind}:${s.kind === "intent" ? canonicalTopic(s.topic) : (s.topic ?? s.headline ?? "")}`)
  );
  const n = distinct.size;
  if (n <= 1) return 1.0;
  // Ambient topics stack at half value: three "Cyber Threats"-class hits on
  // one company are still one weak signal, not a buying committee.
  const ambient = [...distinct].filter((k) => AMBIENT_TOPICS.has(k.slice(k.indexOf(":") + 1))).length;
  const core = n - ambient;
  const effective = core + ambient * 0.5;
  if (effective <= 1) return 1.0;
  return Math.min(1 + 0.35 * (effective - 1), 2.0);
}

export function scoreCompany(
  facts: CompanyFacts,
  signals: RawSignal[],
  now = new Date()
): ScoreComponents {
  const fit = icpFit(facts);
  const strength = signalStrength(signals, facts);
  const decay = recencyDecay(signals, now);
  const stack = stackBonus(signals);
  return {
    icpFit: fit,
    signalStrength: strength,
    recencyDecay: decay,
    stackBonus: stack,
    signalCount: signals.length,
    score: Math.round(fit * strength * decay * stack * 100),
  };
}

/**
 * Below this, it is noise.
 *
 * Set to 60 from the first live week (2026-09-17, 2,424 SoCal companies with
 * signals): a single core-topic intent signal clears it only at score ≥ ~95,
 * audience A, within five days; anything weaker needs a second distinct
 * signal. At 45 the floor was lone MFA hits at 82B. Distribution that week:
 * ≥45: 591, ≥60: 310, ≥70: 209, ≥80: 142, ≥90: 94. `npm run rescore` replays
 * stored signals against a candidate threshold without touching ZoomInfo.
 */
export const SURFACE_THRESHOLD = 60;

/**
 * "Why now", built from stored fields only.
 *
 * Do not hand this to a model with free rein. If you want better prose, pass
 * ONLY these fields and constrain the model to use nothing else. A hallucinated
 * reason in a security pitch is worse than no reason.
 */
export function whyNow(signals: RawSignal[], now = new Date()): string {
  if (!signals.length) return "No current signal.";
  // Real signals first (events and core intent), ambient topics only as filler,
  // freshest first within each group. Duplicate topics collapse to one line.
  const rank = (s: RawSignal) => (s.kind === "scoop" ? 0 : AMBIENT_TOPICS.has(s.topic ?? "") ? 2 : 1);
  const seen = new Set<string>();
  const sorted = [...signals]
    .sort((a, b) => rank(a) - rank(b) || (b.signalDate?.getTime() ?? 0) - (a.signalDate?.getTime() ?? 0))
    .filter((s) => {
      const key = `${s.kind}:${s.kind === "intent" ? canonicalTopic(s.topic) : s.headline ?? s.topic ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const parts = sorted.slice(0, 3).map((s) => {
    const days = s.signalDate
      ? Math.round((now.getTime() - s.signalDate.getTime()) / 86_400_000)
      : null;
    const age = days === null ? "" : days === 0 ? ", today" : `, ${days}d ago`;
    if (s.kind === "scoop" || s.kind === "news") {
      // Headlines carry a trailing "(City, State, Country)"; drop it and cap the length.
      const h = (s.headline ?? "event").replace(/\s*\([^)]*\)\s*\.?$/, "").trim();
      return `${h.length > 120 ? `${h.slice(0, 117)}…` : h}${age}`;
    }
    return `${s.topic ?? "intent"} intent${age}`;
  });
  return parts.join(" · ");
}
