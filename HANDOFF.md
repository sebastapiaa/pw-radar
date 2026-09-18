# Radar — Handoff Brief

You are picking up a project that was scoped in a Claude chat session. This file is the
entry point. Read it fully, then read the seven files in `docs/` before writing code.
`docs/ROADMAP.md` defines the target architecture, the build phases and their acceptance
tests; follow its order. `docs/CONTEXT.md` carries the sales context, the accounts/scopes
product concept, and the no-outreach rule.

## Who this is for

Seb, business development at **PerimeterWatch**, a San Diego MSSP selling MDR, SIEM,
cloud security, audit and penetration testing. The model is **co-managed security**:
relieving strain on clients' internal IT teams, not replacing them — which shapes how
signals are read and how openers are pitched (see `docs/ARCHITECTURE.md` §ICP). He runs
a separate agency (TSM Advisory
Group) and is comfortable in Next.js, Postgres and Railway. Write for someone who knows
the stack. Do not explain React.

## What we are building

A private lead-timing console. ZoomInfo surfaces companies that look like they are in
market for security services **right now**; the dashboard shows them ranked, with the
evidence for why, and the people to call.

Three surfaces:

1. **Dashboard** (Next.js, desktop-first) — ranked findings, viewer, CSV export, analytics.
2. **Daily job** — scans for new signals, writes findings, pings Telegram if anything cleared threshold.
3. **Sunday job** — ranks the week, enriches only the shortlist, pings a digest to start Monday.

The name is **Radar** (PerimeterWatch Radar): a perimeter instrument that detects
approaching signals and whose blips fade with time — which is literally the UI's decay
ramp. It deliberately does NOT use the *Watch suffix; ThreatWatch and CloudWatch are
client-facing service lines, and an internal tool sharing that suffix would blur the
catalog.

## Non-negotiables

- **Search is free, enrichment is not.** The whole design exists to keep the daily loop
  on free calls and spend credits only on a small weekly shortlist. Do not "simplify" this
  by enriching everything. See `docs/ZOOMINFO.md`.
- **No PII in Telegram.** Messages carry counts and a link, never names, emails or phones.
- **No ZoomInfo credentials in the browser.** Every ZoomInfo call is server-side.
- **This holds regulated personal data.** Contact emails and direct dials are personal
  data under CCPA and GDPR. `docs/SECURITY.md` is a requirement, not a suggestion.

## Current state

Scaffold plus a working ZoomInfo client. Nothing is deployed. Files present are
structure, schema, docs and stubs with real logic where the design is settled and `TODO`
where it is not.

Phase 0 progress (2026-09-17): credentials issued and in local `.env` (never committed);
tool mapping verified live; Railway Postgres provisioned, `db/schema.sql` and
`db/seed_scopes.sql` applied via `npm run db:apply` (11 tables, 8 scopes). Local work
uses Railway's public TCP proxy URL; the deployed workers will get the internal
`DATABASE_URL`. Credit caps set: 500 bulk/month, 200 AI actions/month (see
`docs/ZOOMINFO.md` §Budget).

**Phase 0 accepted 2026-09-17.** Current phase: **Phase 1, daily worker**, runs 1 and 2
of 3 done (2026-09-17 local + Railway manual, 2026-09-18 scheduled), all at 0 credits.
Run 3 is the 2026-09-19 06:00 PT cron; then check the bulk balance is still 8,878.
Tuning aids: `npm run db:stats`, `npm run rescore` (whole window, replaces the latest
run's rows; prefer `npm run rescore:run` which recomputes one run in place),
`npm run db:apply -- --reset-runs`. After each daily run until the gate is in the
daily job: `npm run gate:report -- --apply --pending` (free apart from the model
review; cents).

Deployed 2026-09-17: GitHub `sebastapiaa/pw-radar`, Railway cron `radar-daily`
(manual run verified), Vercel project for the dashboard. Phase 3 first cut is built
(see `docs/ROADMAP.md` Phase 3 progress); Vercel needs `AUTH_SECRET`, `DASHBOARD_URL`
and either the Entra vars or `AUTH_PASSWORD` before the wall lets anyone in (Seb set
the password mode on 2026-09-17; app registration in Entra was not attempted). Phase 2
(Sunday worker, retention, profiles) is written but has never run; it must not run
before Phase 1 passes, and its first run needs `ANTHROPIC_API_KEY` and
`PII_ENCRYPTION_KEY` in the Railway service.

Local toolchain verified (2026-09-17): `npm install`, `npm run typecheck` and
`npm run dev` all work. `src/app/` holds a placeholder root page that only proves Next
runs; it is not the dashboard and carries no product logic. `next.config.ts` pins
`outputFileTracingRoot` to the project folder. `.env` is created from `.env.example`
with empty values.

## Order of work

1. ~~Verify ZoomInfo MCP tool names against the live server.~~ Done 2026-09-17; rerun
   `npm run zi:discover` at the start of any session that touches the client.
2. ~~Register an app for machine credentials.~~ Done 2026-09-17 (MCP app, Client
   Credentials).
3. ~~Stand up Postgres and run `db/schema.sql`.~~ Done 2026-09-17 (`npm run db:apply`).
4. Build the daily worker, verify it runs on free calls only, confirm against the credit
   dashboard that the balance did not move.
5. Build the Sunday worker with enrichment.
6. Build the dashboard.
7. Telegram bot last. It is the easiest piece and the least important.

## Open questions Seb still needs to answer

- The typeface license: the brand uses a Helvetica-class grotesque plus an italic serif
  accent. Confirm with the studio what is licensed before shipping; `docs/DESIGN.md`
  names the fallback.
- Intent topics: the account has 22 configured (live lookup, 2026-09-17), not the six
  the plan sheet said. Seb approved the 22-topic-to-scope mapping in
  `docs/ARCHITECTURE.md` on 2026-09-17. Still unexplained: why the plan sheet said six.
- Whether Scoops are entitled on his contract. The `search_scoops` tool is present and
  `lookup` returns 24 scoop types; a real search in Phase 1 is the final proof.

## Answered (2026-09)

- Intent is visible through free search. Verified 2026-09-17 against the live server:
  `search_intent` and `search_scoops` both declare themselves free in their tool
  descriptions. The daily-loop design holds. Details in `docs/ZOOMINFO.md`.
- Machine credentials exist: Developer Portal → MCP app → Client Credentials, app
  "PerimeterWatch Radar", delegated user Seb. Auth is an OAuth client-credentials
  exchange against ZoomInfo's Okta issuer; implemented in `src/lib/zoominfo.ts` and
  proven by `npm run zi:discover` (22 live tools, all worker roles mapped and present).
  `ROLE_TO_TOOL` is verified, not provisional. Live schemas are in `docs/zoominfo/`.
- Recommended contacts are free but return ids and ranking metadata only; email and
  direct dial come from paid `enrich_contacts` (10 per call, not 25). The weekly
  budget in `docs/ZOOMINFO.md` still holds because RUM makes repeats free.

- Education is out of the ICP (Seb, 2026-09-17): K-12, colleges and universities, and
  anything ZoomInfo types as "education" are killed by the verification gate and
  tagged `excluded:education`. Government is not excluded (not asked).
- ICP: 100–5,000 employees, Southern California, full buying committee (IT leadership,
  security leadership, C-suite). Details and the size-band analytics requirement are in
  `docs/ARCHITECTURE.md` §ICP. Constants already updated in `src/lib/scoring.ts`.
- Standalone: no CRM integration, CSV export only.
- Build order (2026-09-17): Seb chose to build Phase 3 (dashboard) while Phase 1's
  two scheduled runs complete, and to write Phase 2 without running it until Phase 1
  passes. Phase gating on *running* credit-spending code is unchanged.
- Sign-in (2026-09-17): PerimeterWatch is a Microsoft 365 tenant (SPF includes
  spf.protection.outlook.com). Auth is Microsoft Entra ID, single tenant, any
  @perimeterwatch.com work account, with a shared-password gate as fallback if app
  registration turns out to be admin-only. Provider chosen by env at runtime.
- Where `ANTHROPIC_API_KEY` lives (2026-09-18): local `.env` and, once created, the
  `radar-weekly` Railway service (gate model review, optional profiles). Not on
  `radar-daily` (never calls a model) and not on Vercel today. If any in-UI model
  action ships (profile regeneration, research buttons), the key must go into Vercel's
  environment at that moment. `docs/SECURITY.md` applies to Vercel for the dashboard.
- Hosting (2026-09-17): dashboard on Vercel, Postgres and cron workers on Railway.
  See `docs/ARCHITECTURE.md` §Stack for the cron schedules in UTC and the two
  database URLs.
- No outreach in any form, in any phase. The former drafted-openers phase was removed.
- Product concept: connected account and scope objects, with signal phrases highlighted
  in the profile. See `docs/CONTEXT.md` and `docs/DESIGN.md`.
- Account state via notes and tags on accounts and contacts; tags drive suppression.
- Export: Salesloft person-import CSV only. No generic CSV, no other formats.
- Profile descriptions: the model-generated paragraph (Anthropic API, `claude-haiku-4-5`,
  span-grounded, company-level data only) is built but **optional and off by default**
  as of 2026-09-17; Seb questioned whether it is needed. The account page shows a
  deterministic summary from stored signals (`src/lib/summary.ts`) unless a generated
  profile exists. Decide after a few weeks of use.
- Verification gate (2026-09-17, Seb's spec): free deterministic checks + a
  flag-only model review + a corroboration floor run on every Sunday candidate before
  any credit; every decision persisted; flags need Seb's approval on `/gate`; dead
  marking needs a taxonomy reason. There is **no free corporate-hierarchy source** in
  ZoomInfo's MCP; hierarchy is a same-domain proxy that records a parent and never
  kills. Acceptance test in `docs/ROADMAP.md` Phase 2b. Design in
  `docs/ARCHITECTURE.md` §Verification gate. Calibration dry run: `npm run gate:report`;
  the 2026-09-17 run (11 kills, all vendors/providers; 23 flags) is recorded in the
  roadmap and awaits Seb's review as acceptance step 5.
- People (2026-09-17): every ZoomInfo-sourced account can pull its recommended people
  for free (names, titles, buying-committee tier); email and phone are a per-person
  paid click or the Sunday batch. Credits stay behind a click or the Sunday job.
- Two services documents are in, distilled into `docs/SERVICES.md`, with the `scopes`
  seed at `db/seed_scopes.sql` and a vendor list feeding a technographic fit signal.
  Only the proof points listed in SERVICES.md may appear in generated profiles.
- Branding: sampled directly from studio assets. Red #FF4944, grey #BABABA, off-white
  #FEFEFE, ink #060606, numbered-microlabel device, serif-italic emphasis. Full tokens
  and rules in `docs/DESIGN.md`. Only the typeface license remains open.
- Proven vertical: legal / professional services (client identity classified, see
  `docs/CONTEXT.md`). Channel partnership in progress with an out-of-state MSP; manual
  account seeding must exist for partner intros and event leads.

## Verified facts you can rely on

These were confirmed against ZoomInfo's own documentation and Seb's own admin screens
during scoping. They are not guesses.

- Bulk credits are enabled. 8,879 remaining of 10,100.
- 3,000 monthly export credits also exist. **MCP cannot use them.** Ignore that pool.
- Plan shows as "SalesOS: Advanced+ Bundle" in User Management: 3 seats, 22 configured
  intent topics (the scoping sheet said 6; the live lookup says 22).
- MCP is included with all ZoomInfo subscriptions at no extra cost.

Everything else in these docs that is marked `ASSUMPTION` has not been verified.
