import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSummary } from "../src/lib/summary";
import type { SignalRow } from "../src/lib/queries";

const sig = (over: Partial<SignalRow>): SignalRow => ({
  id: 1,
  kind: "intent",
  topic: null,
  headline: null,
  rawScore: null,
  audienceStrength: null,
  signalDate: "2026-09-12",
  scopeName: null,
  scopeSlug: null,
  link: null,
  ...over,
});

test("summary groups core intent by scope, demotes ambient, and frames by size band", () => {
  const parts = buildSummary(
    [
      sig({ id: 1, topic: "Security Information & Event Management (SIEM)", scopeName: "SIEM Co-Management" }),
      sig({ id: 2, topic: "Managed Detection & Response (MDR)", scopeName: "Managed SOC" }),
      sig({ id: 3, topic: "Data Breach" }),
      sig({ id: 4, kind: "scoop", topic: "Open Position", headline: "Acme is seeking a SOC Analyst. (San Diego, California, United States)" }),
    ],
    1500
  );
  const text = parts.map((p) => p.text).join(" | ");
  assert.ok(text.includes("Researching SIEM"), text);
  assert.ok(text.includes("Researching MDR"), text);
  assert.ok(text.includes("Also reading on Data Breach"), text);
  assert.ok(text.includes("Open Position (2026-09-12): Acme is seeking a SOC Analyst."), text);
  assert.ok(text.includes("Over 1,000 staff"), text);
  assert.deepEqual(parts[0].signalIds, [1]);
});

test("summary is empty when there are no signals", () => {
  assert.deepEqual(buildSummary([], 300), []);
});
