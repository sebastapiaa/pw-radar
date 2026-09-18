import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTier, selectCommittee, parseEnriched, type Recommendation } from "../src/lib/enrich";

const rec = (over: Partial<Recommendation>): Recommendation => ({
  contactId: "1",
  rank: 1,
  score: 0.5,
  reRankingScore: 0.5,
  name: "X",
  title: "",
  managementLevel: "",
  department: "",
  jobFunction: "",
  tier: "other",
  brief: "",
  ...over,
});

test("tier classification matches ZoomInfo's live brief vocabulary", () => {
  assert.equal(classifyTier({ title: "", managementLevel: "C-Level", department: "C-Suite, Finance", jobFunction: "" }), "csuite");
  assert.equal(classifyTier({ title: "Cloud Infrastructure", managementLevel: "Director", department: "Information Technology", jobFunction: "" }), "it");
  assert.equal(classifyTier({ title: "Software Engineering", managementLevel: "Director", department: "Engineering & Technical", jobFunction: "" }), "other");
  assert.equal(classifyTier({ title: "Information Security", managementLevel: "Manager", department: "Information Technology", jobFunction: "" }), "security");
  assert.equal(classifyTier({ title: "", managementLevel: "Board Members, C-Level", department: "C-Suite", jobFunction: "" }), "other");
  assert.equal(classifyTier({ title: "Quality", managementLevel: "Director", department: "Engineering & Technical", jobFunction: "" }), "other");
});

test("committee selection covers tiers and never fills with 'other'", () => {
  const recs: Recommendation[] = [
    rec({ contactId: "a", rank: 1, tier: "other", reRankingScore: 0.9 }),
    rec({ contactId: "b", rank: 2, tier: "it", reRankingScore: 0.8 }),
    rec({ contactId: "c", rank: 3, tier: "it", reRankingScore: 0.7 }),
    rec({ contactId: "d", rank: 4, tier: "it", reRankingScore: 0.6 }),
    rec({ contactId: "e", rank: 5, tier: "csuite", reRankingScore: 0.5 }),
    rec({ contactId: "f", rank: 6, tier: "security", reRankingScore: 0.4 }),
  ];
  const picked = selectCommittee(recs, 5).map((r) => r.contactId);
  assert.deepEqual(picked.slice(0, 3).sort(), ["b", "e", "f"], "one of each tier first");
  assert.ok(!picked.includes("a"), "other is never picked");
  assert.equal(picked.length, 5);
});

test("enrichment parser accepts common envelopes and rejects unknown shapes", () => {
  const rows = parseEnriched({ data: [{ id: "9", attributes: { firstName: "A", lastName: "B", email: "a@b.com", phone: "1", directPhoneDoNotCall: true, mobilePhone: "2" } }] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].contactId, "9");
  assert.equal(rows[0].phone, "2", "direct is DNC so mobile is used");
  assert.throws(() => parseEnriched({ weird: true }), /unrecognised response shape/);
  assert.equal(parseEnriched([{ personId: "5", firstName: "Z" }])[0].contactId, "5");
});
