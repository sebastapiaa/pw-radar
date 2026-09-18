import { test } from "node:test";
import assert from "node:assert/strict";
import {
  icpFit,
  signalStrength,
  recencyDecay,
  stackBonus,
  scoreCompany,
  whyNow,
  canonicalTopic,
  topicWeight,
  SURFACE_THRESHOLD,
  type RawSignal,
} from "../src/lib/scoring";

const d = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000);

test("icpFit is binary on band and geography", () => {
  assert.equal(icpFit({ employeeCount: 250, state: "CA", country: "US" }), 1);
  assert.equal(icpFit({ employeeCount: 50, state: "CA", country: "US" }), 0);
  assert.equal(icpFit({ employeeCount: 6000, state: "CA", country: "US" }), 0);
  assert.equal(icpFit({ employeeCount: 250, state: "NV", country: "US" }), 0);
  assert.equal(icpFit({ employeeCount: 250 }), 1, "unknown geography passes; the query already filtered");
});

test("ambient topics can never surface alone", () => {
  const s: RawSignal[] = [{ kind: "intent", topic: "Data Breach", rawScore: 100, audienceStrength: "A", signalDate: d(0) }];
  const c = scoreCompany({ employeeCount: 500, state: "CA", country: "US" }, s);
  assert.ok(c.score < SURFACE_THRESHOLD, `ambient alone scored ${c.score}`);
  assert.equal(topicWeight("Data Breach"), 0.45);
  assert.equal(topicWeight("Penetration Testing"), 1);
});

test("a single strong fresh core signal clears the threshold; a weaker one does not", () => {
  const strong: RawSignal[] = [{ kind: "intent", topic: "Security Information & Event Management (SIEM)", rawScore: 97, audienceStrength: "A", signalDate: d(1) }];
  const weak: RawSignal[] = [{ kind: "intent", topic: "Multifactor Authentication", rawScore: 82, audienceStrength: "B", signalDate: d(5) }];
  const f = { employeeCount: 800, state: "CA", country: "US" };
  assert.ok(scoreCompany(f, strong).score >= SURFACE_THRESHOLD);
  assert.ok(scoreCompany(f, weak).score < SURFACE_THRESHOLD);
});

test("MFA and 2FA are one signal for stacking; SIEM plus a job post is two", () => {
  const mfa: RawSignal[] = [
    { kind: "intent", topic: "Multifactor Authentication", rawScore: 90, signalDate: d(1) },
    { kind: "intent", topic: "Two-Factor Authentication", rawScore: 90, signalDate: d(1) },
  ];
  assert.equal(stackBonus(mfa), 1.0);
  assert.equal(canonicalTopic("Two-Factor Authentication"), "Multifactor Authentication");
  const mixed: RawSignal[] = [
    { kind: "intent", topic: "Security Information & Event Management (SIEM)", rawScore: 90, signalDate: d(1) },
    { kind: "scoop", topic: "Open Position", headline: "hiring a SOC analyst", signalDate: d(2) },
  ];
  assert.equal(stackBonus(mixed), 1.35);
});

test("job postings weigh more at 1,000+ employees", () => {
  const s: RawSignal[] = [{ kind: "scoop", topic: "Open Position", headline: "SOC analyst", signalDate: d(1) }];
  assert.equal(signalStrength(s, { employeeCount: 300 }), 0.8);
  assert.equal(signalStrength(s, { employeeCount: 1500 }), 0.95);
});

test("recency decays with a 10 day half-life from the freshest signal", () => {
  const s: RawSignal[] = [{ kind: "intent", topic: "x", signalDate: d(10) }, { kind: "intent", topic: "y", signalDate: d(30) }];
  const r = recencyDecay(s);
  assert.ok(Math.abs(r - 0.5) < 0.01, `expected ~0.5, got ${r}`);
});

test("whyNow leads with events, then core intent, and pushes ambient topics last", () => {
  const s: RawSignal[] = [
    { kind: "intent", topic: "Data Breach", signalDate: d(1) },
    { kind: "intent", topic: "SIEM", signalDate: d(9) },
    { kind: "scoop", topic: "Open Position", headline: "VP of IT", signalDate: d(2) },
    { kind: "intent", topic: "Two-Factor Authentication", signalDate: d(3) },
    { kind: "intent", topic: "Multifactor Authentication", signalDate: d(3) },
  ];
  const text = whyNow(s);
  const parts = text.split(" · ");
  assert.equal(parts[0], "VP of IT, 2d ago", text);
  assert.equal(parts[1], "Two-Factor Authentication intent, 3d ago", text);
  assert.equal(parts[2], "SIEM intent, 9d ago", text);
  assert.ok(!text.includes("Data Breach"), "ambient should not make the top three here");
  assert.equal(whyNow([]), "No current signal.");
});
