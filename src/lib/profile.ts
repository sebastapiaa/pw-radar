/**
 * AI-generated account profile descriptions. The one unstructured job in the
 * system. See docs/ARCHITECTURE.md §AI-generated profile descriptions.
 *
 * Boundary, enforced here and not by convention:
 *   - input is company-level only: firmographics, stored signals, size band,
 *     scopes catalog, PerimeterWatch proof points. Contact PII never enters
 *     buildPrompt(); it does not even receive the contacts table.
 *   - output is JSON with quoted spans; each span must cite a stored signal id
 *     and a known scope slug, and its quote must appear verbatim in the text.
 *     Anything else is dropped. If the text reads like outreach, the whole
 *     profile is rejected (no outreach in any form, docs/CONTEXT.md).
 *
 * Model: claude-haiku-4-5 per HANDOFF.md (decided 2026-09). Cents per week.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

export const PROFILE_MODEL = "claude-haiku-4-5";

export interface ProfileSignal {
  id: number;
  kind: string;
  topic: string | null;
  headline: string | null;
  rawScore: number | null;
  audienceStrength: string | null;
  signalDate: string | null;
  scopeSlug: string | null;
}

export interface ProfileInput {
  name: string;
  domain: string | null;
  employeeCount: number | null;
  city: string | null;
  state: string | null;
  sizeBand: string;
  signals: ProfileSignal[];
  scopes: { slug: string; name: string; description: string | null; topics: string[] }[];
}

export interface ProfileOutput {
  text: string;
  spans: { start: number; end: number; signal_id: number; scope_slug: string }[];
}

const Output = z.object({
  text: z.string(),
  spans: z.array(
    z.object({
      quote: z.string(),
      signal_id: z.number().int(),
      scope_slug: z.string(),
    })
  ),
});

/** Only these claims about PerimeterWatch may appear (docs/SERVICES.md). */
const PROOF_POINTS = [
  "own data center certified SOC 1 Type II, SOC 2 Type II, ISO 27001, NIST 800-53, HIPAA and PCI DSS",
  "NIST- and FBI-aligned practice",
  "24/7 monitoring with human analysts",
  "co-managed delivery that reduces load on the client's internal IT team",
];

const SYSTEM = `You write short internal account profiles for a security sales team at PerimeterWatch, a Southern California managed security provider selling co-managed security (managed SOC, SIEM co-management, cloud security, threat hunting, penetration testing, GRC, email and identity security).

Task: describe what this company appears to need from PerimeterWatch, in plain prose, grounded ONLY in the signals provided. The reader is a salesperson deciding whether and how to research the account further.

Hard rules:
- Use only the facts in the input. Do not invent history, technology, incidents, people or numbers.
- Never name or refer to any individual person.
- This is NOT outreach. Do not write a message, email, pitch, opener, subject line, or anything addressed to the company. Third person only.
- Claims about PerimeterWatch are limited to: ${PROOF_POINTS.join("; ")}.
- Under 500 employees usually means "we have little and know we should": full-coverage framing. Over 1,000 usually means "we have tools and people and it still is not working": augmentation framing (alert fatigue, 24/7 coverage headcount cannot staff). Use the size band to pick the framing; say which.
- 90 to 160 words. No headings, no bullet points, no markdown.

Spans: every phrase in your text that reflects a specific signal must be listed in "spans" with the exact quote (verbatim substring of your text), the signal id it came from, and the scope slug that signal maps to. Only phrases that carry a signal get a span. Do not over-highlight; three to six spans is typical.`;

export function buildPrompt(input: ProfileInput): string {
  const signals = input.signals
    .map((s) => {
      const bits = [
        `id=${s.id}`,
        `kind=${s.kind}`,
        s.topic ? `topic="${s.topic}"` : null,
        s.headline ? `headline="${s.headline.replace(/"/g, "'")}"` : null,
        s.rawScore !== null ? `score=${s.rawScore}${s.audienceStrength ?? ""}` : null,
        s.signalDate ? `date=${s.signalDate}` : null,
        s.scopeSlug ? `scope=${s.scopeSlug}` : "scope=none",
      ].filter(Boolean);
      return `- ${bits.join(" ")}`;
    })
    .join("\n");
  const scopes = input.scopes
    .map((s) => `- ${s.slug}: ${s.name}. ${s.description ?? ""} Topics: ${s.topics.join(", ")}`)
    .join("\n");
  return `Company: ${input.name}${input.domain ? ` (${input.domain})` : ""}
Employees: ${input.employeeCount ?? "unknown"} (size band ${input.sizeBand})
Location: ${[input.city, input.state].filter(Boolean).join(", ") || "unknown"}

Stored signals (cite by id):
${signals}

Scopes catalog (cite by slug):
${scopes}`;
}

const OUTREACH_RE = /\b(dear|hi|hello|hey)\s+[A-Z]|subject:|\byou(r)?\b.*\b(we|our)\b.*\b(can|would|could)\b|reach out|let'?s (talk|connect|schedule)|book a (call|meeting)/i;

export async function generateProfile(
  client: Anthropic,
  input: ProfileInput
): Promise<{ output: ProfileOutput; model: string; dropped: number } | null> {
  const response = await client.messages.parse({
    model: PROFILE_MODEL,
    max_tokens: 2000,
    system: SYSTEM,
    messages: [{ role: "user", content: buildPrompt(input) }],
    output_config: { format: zodOutputFormat(Output) },
  });
  if (response.stop_reason === "refusal") return null;
  const parsed = response.parsed_output;
  if (!parsed) return null;

  const text = parsed.text.trim();
  if (!text || OUTREACH_RE.test(text)) return null;

  const signalIds = new Set(input.signals.map((s) => s.id));
  const scopeSlugs = new Set(input.scopes.map((s) => s.slug));
  const spans: ProfileOutput["spans"] = [];
  let dropped = 0;
  let searchFrom = 0;
  for (const sp of parsed.spans) {
    if (!signalIds.has(sp.signal_id) || !scopeSlugs.has(sp.scope_slug) || !sp.quote.trim()) {
      dropped++;
      continue;
    }
    let start = text.indexOf(sp.quote, searchFrom);
    if (start < 0) start = text.indexOf(sp.quote);
    if (start < 0) {
      dropped++;
      continue;
    }
    const end = start + sp.quote.length;
    if (spans.some((x) => start < x.end && end > x.start)) {
      dropped++;
      continue;
    }
    spans.push({ start, end, signal_id: sp.signal_id, scope_slug: sp.scope_slug });
    searchFrom = end;
  }
  spans.sort((a, b) => a.start - b.start);
  return { output: { text, spans }, model: response.model, dropped };
}
