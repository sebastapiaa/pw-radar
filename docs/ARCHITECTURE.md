# Architecture

## Stack

Next.js dashboard on **Vercel**, Postgres on Railway, two Railway cron services, a
Telegram bot. One repo, two deploy targets (decided 2026-09-17; the original plan had
the dashboard on Railway too, Seb prefers Vercel for Next.js).

```
Railway cron (daily 06:00 PT)  ─┐
Railway cron (Sunday 17:00 PT) ─┼─→ ZoomInfo MCP ─→ Railway Postgres ─→ Next.js on Vercel
                                │                        │
                                └────────────────────────┴─→ Telegram (counts + link only)
```

Consequences: Vercel reaches Postgres over Railway's public TCP proxy (`DATABASE_PUBLIC_URL`),
the cron services use the internal `DATABASE_URL`. `railway.json` deliberately sets no
start command; each cron service sets its own (`npm run job:daily`, `npm run job:weekly`)
in the Railway UI, and restart policy is NEVER so a failed job does not loop. Railway cron
runs in UTC: 06:00 PT is `0 13 * * *` during daylight time and `0 14 * * *` in winter;
Sunday 17:00 PT is `0 0 * * 1` in daylight time.

## Why two jobs, not one

They ask different questions.

**Daily** is "what is new since yesterday." Wide, cheap, free calls only. Writes findings.
Notifies only if something cleared threshold. Most weekdays this is silent, and that is
correct — intent scores move against a rolling baseline and Scoops publish in bursts, so
a company that qualifies Tuesday usually still qualifies Wednesday. A bot that pings daily
with "0 new" gets muted inside two weeks.

**Sunday** is "what is the best of the last seven days, ranked, ready to work Monday."
This is the only job that spends credits. It takes the top N by score, enriches signals
and contacts for exactly those, and sends a digest.

## Scoring

Score is fit multiplied by timing. Keep it deterministic and in code, not in a model.
You need to be able to explain why a company surfaced, and debug it when it is wrong.

```
score = icp_fit × signal_strength × recency_decay × stack_bonus
```

- `icp_fit` — 0 or 1 initially. Outside the ICP band, it does not surface at all.
- `signal_strength` — normalized from the signal's own score and audience strength.
- `recency_decay` — exponential, half-life around 10 days. Timing is the product.
- `stack_bonus` — multiple distinct signals on one company stack multiplicatively up to
  a cap. **The intersection is where the real signal lives**: a company showing intent on
  SIEM that also just hired a security director is a far better card than either alone.

Store the raw inputs alongside the computed score. When Seb disagrees with a ranking you
want to see the components, not just the total.

## "Why now" copy

Build it from the stored signal record, not freehand from a model. Store topic, score,
audience strength, scoop headline and date; render a sentence from those fields. This
line stays deterministic; no model involved.

## AI-generated profile descriptions

The account profile's prose (see `docs/CONTEXT.md` and `docs/DESIGN.md`) IS
model-generated. This is the one unstructured job in the system: mapping what the
signals say the company needs to what PerimeterWatch offers.

- **Model:** Anthropic API, `claude-haiku-4-5`. At 15–50 profiles a week the cost is
  cents; do not reach for a bigger model until the output demands it. Key in
  `ANTHROPIC_API_KEY`.
- **Input, exhaustively:** company firmographics, the stored signal records, the size
  band, and the scopes catalog (seeded from Seb's services documents). Nothing else.
  **Never contact PII** — no names, emails or phones go to the model; it writes about
  the company, not people.
- **Output contract:** not free prose. JSON with the description text and a spans
  array, each span referencing the signal id and scope slug it derives from, so the UI
  renders highlights without re-parsing. A span citing no stored signal id is rejected
  at parse time. That makes the grounding rule mechanical instead of hoped-for.
- **When:** generated in the Sunday run for the shortlist, cached in
  `account_profiles`, regenerable on demand from the profile view. Not generated
  nightly for everything.

## Export: Salesloft format, nothing else

The only export is a CSV shaped for Salesloft's person import. No generic CSV, no other
formats. One person per row, shortlist contacts only, decrypted at export time, logged
in `export_log`.

Column spec to verify against Salesloft's current import template before building
(Salesloft dedupes on email address): first name, last name, email address, title,
company name, phone, plus custom fields carrying `why_now`, `score`, `size_band` and
`scope` so the context travels with the contact. Verify custom-field naming in the
PerimeterWatch Salesloft instance, not against generic docs.

Worth knowing: ZoomInfo Advanced natively exports emails to Salesloft, so an ad-hoc
path exists inside ZoomInfo's own UI. The dashboard export exists because it carries
the scoring and why-now context that path cannot.

## Verification gate (added 2026-09-17)

Sits in the Sunday worker between shortlist selection and enrichment, runs on every
candidate (twice the shortlist size, so kills do not empty a week), and spends nothing.
Code: `src/lib/gate.ts`. Decisions: `gate_decisions` (one row per candidate per
check per run). Company state: `companies.gate_status` (`pending` → `passed` /
`flagged` / `killed`, plus `approved` when Seb overrides a flag on `/gate`).

**Calibration rule.** Anything ambiguous flags. A kill needs an unambiguous fact from a
deterministic source. The model may flag and never kill. A flagged account stays on the
list with its reason and is simply not enriched until approved. `npm run gate:report`
replays the gate as a dry run over the accounts already in the database so a check that
eats real prospects is caught before a Sunday run does it for real.

| Check | Free source (role in `ROLE_TO_TOOL`) | Kill | Flag |
|---|---|---|---|
| industry | `industryFilter` = `search_companies` subset with `industryList` / `companyTypeList` | `education` (industries education, education.k12, education.university, or company type education; Seb's decision 2026-09-17) → tag `excluded:education`; `security_vendor` (software.security, bizservice.security) → tag `excluded:security-vendor`; `msp_candidate` (bizservice.techconsulting **and** a provider-style name) → tag `partner:candidate` | `it_services_industry` (bizservice.techconsulting without a provider name), `name_suggests_provider` |
| location | `locationType` = `search_companies` subset with `locationSearchType: HQ`, `state: usa.california` | — | `not_hq_in_ca`; records `location_type` hq/branch |
| liveness | DNS (`node:dns`), `employmentTrend` = `search_companies` subset with `oneYearEmployeeGrowthRateMinimum: -15`, `jobPostings` = stored `search_scoops` Open Position / Hiring Plans | `dead_company` only when domain fails AND headcount shrinking AND no signal in 90 days | `domain_unresolved`, `shrinking_headcount` |
| distress | stored `search_scoops` M&A / Divestiture / Layoffs (new daily "distress" group, unweighted in scoring) | `acquired`, `bankruptcy`, `shutdown` when the headline says the company is the target | `distress_signal` (layoffs, divestiture, M&A as acquirer or ambiguous) |
| hierarchy | `hierarchyProxy` = `search_companies` by `companyWebsite`; **no free hierarchy tool exists** (parent filters deprecated, no parent field in output; `enrich_companies` has it but is paid) | never | never; records `parent_company_id` when a larger same-domain entity exists (`rolled_up`) |
| model_review | `claude-haiku-4-5`, `messages.parse`, company-level data only, same grounding rules as profiles | never | free-text reason + `evidence_fields`; `skipped` without an API key |
| corroboration | stored signals, last 30 days | — | `single_signal` when fewer than 2 distinct core signal keys (`kind:canonicalTopic`, ambient and distress excluded); listed, not enriched |

Enrichment happens only for `passed` or `approved` accounts whose corroboration check
passed. Killed accounts are tagged, suppressed for a year, and hidden from the list.
Seb can restore a killed account from its page ("Restore to list"); that sets
`approved`, strips the exclusion tags and the gate suppression, writes a note, and the
gate never re-kills an approved account (its decisions are still logged).

**Dead reasons.** Marking an account dead in the UI requires a reason from a fixed
taxonomy stored in `outcomes.reason`: `dead_company`, `wrong_entity`, `competitor`,
`bad_fit`, `already_covered`, `other` (+ note). These feed Phase 7's fitted weights.

**Analytics.** `/gate` shows the last run's kill/flag counts per check, per reason and
per intent topic, and the queue awaiting approval.

## Deduplication

- Join key is the ZoomInfo company ID. Everything keys off it.
- Cooldown: once surfaced, suppress a company for **30 days** so it does not reappear
  every morning while its intent decays.
- Write one row per company per run, not one row total. You want trend, not just today.
  Analytics depends on this.

## ICP (confirmed with Seb, 2026-09)

- **Size:** 100–5,000 employees.
- **Geography:** Southern California — San Diego, Orange County, LA, Inland Empire,
  Ventura. Filter in the search query where ZoomInfo's facets allow; `icpFit()` is the
  backstop.
- **Buying committee (full, all three tiers):** IT leadership (IT Director/Manager),
  security leadership (CISO/SecOps), and C-suite (CEO/CFO). Expect 3–5 enriched contacts
  per shortlisted company; the ~90 credits/week estimate already assumes this.

**Positioning, and why the top end is wide:** PerimeterWatch sells co-managed security.
It relieves strain on internal IT teams, not just resells at wholesale. An in-house team
is therefore the audience, not a disqualifier: a 2,000-person company with a stretched
three-person IT team drowning in SIEM alerts is a prime prospect. Do not build any logic
that treats existing security staff as a negative signal.

Signals mean different things at different sizes, so **segment analytics by size band**
(100–500, 500–1,000, 1,000–5,000) from day one. Below ~500, intent usually means "we
have nothing and know we should" — full-coverage pitch, buyer often CEO/CFO. Above
~1,000, intent usually means "we have tools and people and it's still not working" —
augmentation pitch: alert fatigue, 24/7 coverage their headcount can't staff. The
segmentation exists to learn which pitch converts where, not to decide whether to cut
the top band.

One signal is extra valuable under this model: **security job postings at larger
companies**. A 1,500-person company hiring a SOC analyst is trying to staff internally —
competition or opening depending on how long the req has sat. Check whether ZoomInfo's
scoop types expose job posting data when the tool mapping is done (Phase 0), and if so,
weight it up for the 1,000+ band.

## Intent topics (live list verified 2026-09-17; scope mapping approved by Seb the same day)

Scoping assumed six slots. The account actually has **22 configured topics**, returned by
`lookup` with `fieldName: "intent-topics"` (`npm run zi:lookup`). Whether the plan
allows 22 or someone configured beyond a soft limit is unknown; `ASSUMPTION` until Seb
checks the intent settings in the admin portal. Swapping topics later resets the
baseline the scores compute against, so leave the set alone once the daily job runs.

Exact names matter: `search_intent` matches on the string. The seed in
`db/seed_scopes.sql` uses these names verbatim. Approved scope mapping (Seb,
2026-09-17; Network Security under Managed SOC and Data Center Migration under Cloud
Services were flagged as judgement calls and accepted as-is):

| Topic (exact ZoomInfo name) | Scope |
|---|---|
| Managed Detection & Response (MDR) | Managed SOC |
| Security Operations Center (SOC) | Managed SOC |
| Advanced Threat Protection (ATP) | Managed SOC |
| Network Security | Managed SOC |
| Network Security Appliance | Managed SOC |
| Security Information & Event Management (SIEM) | SIEM Co-Management |
| Cloud Security | Cloud Services |
| Zero Trust | Cloud Services |
| Data Center Migration | Cloud Services |
| Cyber Threat Hunting | Threat Hunting |
| Cyber Threats | Threat Hunting |
| Zero-Day Threat | Threat Hunting |
| Penetration Testing | Cybersecurity (Pentest & Compliance) |
| Vulnerability Management | Cybersecurity (Pentest & Compliance) |
| Security Patches | Cybersecurity (Pentest & Compliance) |
| Compliance | GRC & Compliance |
| Continuous Controls Monitoring | GRC & Compliance |
| Email Security | Email & User Security |
| Data Breach | Email & User Security |
| Fraud Protection | Email & User Security |
| Multifactor Authentication | Identity & Access |
| Two-Factor Authentication | Identity & Access |

Scoop types available (24): Earnings, Funding, IPO, M&A, Divestiture, Award, Event,
Facilities Relocation / Expansion, Product Launch, Partnership, Hiring Plans, Open
Position, New Hire, Lateral Move, Promotion, Left Company, Layoffs, Management Move,
Executive Move, Pain Point, Project, Commentary, Person-Based, Exit Investment. So yes,
job posting data is exposed (`Open Position`, `Hiring Plans`); see §ICP above.
Security-relevant scoop topic ids for the `scoopTopics` filter: 52 Information
Security, 136 Cyber Security, 163 Security, 222 Threat Intelligence, 227 Authentication,
31 IT Audit / Compliance, 135 Compliance, 300 Privacy, 306 Risk, 1 Cloud, 22 Network,
57 Infrastructure, 21 Data Center, 30 IT Contracts.

## Analytics

All of it is queries against your own tables, since every run is persisted.

- Findings per day, per week, per topic.
- Which topics actually fire, and which of the six are dead weight.
- Signal-to-shortlist rate, shortlist-to-contacted rate.
- Credit burn per week against remaining balance.
- Median time from first signal to Seb marking a company as contacted.

The last two are the ones that will actually change his behavior. Build those first.

## Explicitly out of scope

- Outreach in any form. No sending, no drafting, no suggested messaging. Prospecting
  only; see `docs/CONTEXT.md`.
- CRM integration. Standalone by decision; CSV export is the only way data leaves.
- Any agent that decides what to search for. Deterministic queries with a scoring function
  Seb controls will outperform it and can be debugged. The model's only generative job is
  rendering the "why now" line from stored fields.
- A mobile app. Telegram plus a responsive route covers it.
