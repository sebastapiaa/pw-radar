import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize, looksLikeProvider, type GateResult } from "../src/lib/gate";

const res = (over: Partial<GateResult>): GateResult => ({
  companyId: "1",
  decisions: [],
  overall: "passed",
  reason: null,
  tags: [],
  parentCompanyId: null,
  locationType: null,
  employmentTrend: null,
  industryIds: [],
  corroborated: true,
  ...over,
});

test("summarize counts per check, per reason and overall", () => {
  const s = summarize([
    res({ overall: "killed", decisions: [{ check: "industry", verdict: "kill", reason: "security_vendor", evidence: {} }] }),
    res({ overall: "flagged", decisions: [{ check: "liveness", verdict: "flag", reason: "shrinking_headcount", evidence: {} }, { check: "industry", verdict: "pass", reason: null, evidence: {} }] }),
    res({ overall: "passed", decisions: [{ check: "industry", verdict: "pass", reason: null, evidence: {} }] }),
  ]);
  assert.deepEqual(s.overall, { passed: 1, flagged: 1, killed: 1 });
  assert.equal(s.byCheck.industry.pass, 2);
  assert.equal(s.byCheck.industry.kill, 1);
  assert.equal(s.byReason["liveness/flag/shrinking_headcount"], 1);
});

test("provider name pattern catches IT providers seen in the dry run and spares operating companies", () => {
  for (const n of ["TeamLogic IT", "VectorUSA", "Phoenix Group Information Systems", "Acme Managed Services", "Calance", "Neudesic", "Sunset Cyber Security LLC"]) {
    assert.ok(looksLikeProvider(n), `expected provider: ${n}`);
  }
  for (const n of ["MedImpact Healthcare", "Newegg", "The Trade Desk", "Canon Medical Systems USA, Inc.", "Houlihan Lokey", "Make it Happen Events"]) {
    assert.ok(!looksLikeProvider(n), `expected not provider: ${n}`);
  }
});
