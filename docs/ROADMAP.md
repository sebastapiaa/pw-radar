# Roadmap: From Scaffold to Running System

This file defines the target architecture and the order to build it. `HANDOFF.md` says
what exists; this says what "done" means, in phases, each with an acceptance test. Do not
start a phase before the previous one passes.

## Target architecture (v1, the running thing)

One repo, four Railway services, one Postgres.

```
┌─ Railway project ────────────────────────────────────────────────┐
│                                                                  │
│  web        Next.js dashboard + API routes     (always on)       │
│  daily      workers/daily.ts    cron 0 6 * * *       PT          │
│  weekly     workers/weekly.ts   cron 0 17 * * 0      PT          │
│  retention  workers/retention.ts cron 0 3 * * *      PT          │
│                                                                  │
│  postgres   one database, schema in db/schema.sql                │
└──────────────────────────────────────────────────────────────────┘
        │                          │
        ▼                          ▼
  ZoomInfo MCP              Telegram Bot API
  mcp.zoominfo.com/mcp      counts + deep link only
  app-level credentials
```

All four services share the repo and env vars; the crons run `npm run job:*` and exit.
Railway cron requires the service to exit cleanly, so workers must not hold connections
open. The web service is the only one with a public domain, and every route on it is
behind auth.

Data flow, end to end:

```
daily:   search (free) → score → companies/signals/findings → suppressions
                                        │
weekly:  top 15 of week ──→ recommendedContacts (free)
                        ──→ enrichContacts / enrichSignals (bulk credits)
                        ──→ contacts (PII encrypted) → Telegram digest
                                        │
web:     ranked list ← findings ← components stored per row
         card expand → contacts (decrypted server-side, masked by default)
         outcomes written by Seb → feeds analytics and, later, Phase 8
         CSV export → export_log audit row
```

## Phase 0 — Prerequisites

Nothing else starts until these pass.

1. **Credentials.** Register an app in the ZoomInfo Developer Portal or the API/MCP tab.
   Store client id, private key, username in Railway env. If the tab does not exist on
   the Advanced plan, stop and resolve with the CSM before writing more code.
2. **Tool mapping.** Read https://gtm.ai/docs/mcp/tools, run `discoverTools()` against
   the live server, fill `ROLE_TO_TOOL` in `src/lib/zoominfo.ts`. Resolve the open
   question in `docs/ZOOMINFO.md`: is intent visible through free search, or only via
   paid signal enrichment? Write the answer into that doc.
3. **Database.** Provision Postgres, run `db/schema.sql`.
4. **Credit cap.** Admin Portal → Users → User Management: hard per-user limit on the
   service account. Suggested: 500/month.

**Accept when:** `discoverTools()` returns a list, all five roles assert, schema applied,
cap visible in admin.

**Accepted 2026-09-17.** `npm run zi:discover` passes (22 live tools, six worker roles
mapped), `npm run db:apply` applied schema and seed, caps set to 500 bulk / 200 AI per
month. Notes and assumptions in `docs/ZOOMINFO.md`.

## Phase 1 — Daily worker

Implement the TODOs in `workers/daily.ts`. One search per intent topic and per scoop
type, scoped to the ICP band; intersect on company id; score; write; suppress; exit.

**Accept when:** three consecutive daily runs complete, findings appear in the DB, and
the bulk credit balance in Admin Portal has not moved at all. If it moved, a paid tool
leaked into the free path; find it before continuing.

**Progress 2026-09-17, run 1 of 3.** `npm run job:daily` implemented and run locally:
73 free calls, 2,424 companies, 4,420 signals, ~4.5 minutes, `credits_spent` 0.
Baseline bulk balance before the run: 8,878 (see `docs/ZOOMINFO.md`). What the first
run taught, all now in code and docs:

- Intent is a **weekly batch**: every intent signal carried the same date. "New since
  yesterday" is scoops on six days and the intent drop on one. Signals are stored once
  by ZoomInfo's id (`db/migrations/001`), so the same batch is not re-inserted daily.
- Seven topics are **ambient** (Data Breach, Cyber Threats, Zero-Day Threat, Fraud
  Protection, ATP, Data Center Migration, and ZoomInfo's generic legal "Compliance"):
  each returned hundreds of companies a week. They weigh 0.45 and stack at half value,
  so they can support a core signal but never surface a company alone. MFA/2FA and
  Network Security/Appliance are aliased for stacking.
- `SURFACE_THRESHOLD` raised 45 → 60 (`src/lib/scoring.ts` has the distribution).
- Geography and size filters hold: 2,424 of 2,424 companies in CA and in band.

Deployed the same day: repo on GitHub (`sebastapiaa/pw-radar`), Railway cron service
`radar-daily` (`0 13 * * *` UTC, start command `npm run job:daily`, variables set by
reference to the Postgres service). A manual "Run now" completed in 79 s with status
ok, 2,424 companies, 4,420 signals, 0 new findings (all suppressed from the morning
run, batch deduped by id), 0 credits. Two build lessons: do not set a custom
`npm ci` build command (collides with Railway's node_modules cache mount), and
`tsx` must be a runtime dependency.

Remaining for acceptance: the scheduled runs on 2026-09-18 and 2026-09-19, then a
balance check that still reads 8,878.

## Phase 2 — Weekly worker

Implement `workers/weekly.ts`: shortlist from existing findings, contacts via the free
recommendation call, enrichment for the shortlist only, PII encrypted on insert,
`credits_spent` counted, hard per-run ceiling (suggested: 150) that aborts and alerts.

Also write `workers/retention.ts`: null out `email_enc`/`phone_enc` where
`purge_after < now()`. Small, but it is a Phase 2 deliverable, not a someday.

The Sunday run also generates the shortlist's profile descriptions via the Anthropic
API (`claude-haiku-4-5`, company-level data only, span-grounded output — see
`docs/ARCHITECTURE.md` §AI-generated profile descriptions) and caches them in
`account_profiles`.

**Accept when:** one Sunday run enriches ≤15 companies, our `credits_spent` count matches
the Admin Portal delta within a few credits, and a second run the same week spends near
zero (RUM working).

### Phase 2b — Verification gate (added 2026-09-17)

Between shortlist selection and enrichment, on every candidate, before any credit:
deterministic pre-checks on free data (industry exclusion, HQ-vs-branch, liveness,
distress, same-domain hierarchy proxy), a model review that may flag but never kill,
and a corroboration floor (≥2 distinct core signal keys to enrich). Every decision is
persisted in `gate_decisions`. Design in `docs/ARCHITECTURE.md` §Verification gate.

**Accept when**, in one full Sunday cycle:

1. Every shortlist candidate has one row in `gate_decisions` per check (industry,
   location, liveness, distress, hierarchy, model_review, corroboration) with a
   verdict and, for non-pass verdicts, a machine reason.
2. `enrich_contacts` was called only for accounts whose gate status is `passed` or
   `approved` and whose corroboration check passed. Query: no contact with
   `enriched_at` in the run window belongs to a company with gate_status `flagged`
   or `killed` at that time, unless a `gate_reviewed_by` approval precedes it.
3. At least one flagged account renders on the dashboard with its reason and an
   "Approve for enrichment" control, and stays unenriched until approved.
4. The Admin Portal bulk-credit delta for the run matches `runs.credits_spent` within
   a few credits.
5. Calibration: the retroactive dry run (`npm run gate:report`) over the accounts
   already in the database has been reviewed by Seb, and no check killed a real
   prospect. Killed accounts are tagged and suppressed; anything ambiguous is a flag.

**Calibration dry run 2026-09-17** (310 accounts with findings, model review off, 38 s,
free): 276 passed, 23 flagged, 11 killed. Kills: 5 security vendors by industry
(Doppel, GoGuardian, Halcyon, Drata, Varutra) and 6 IT providers by industry plus a
provider-style name (TeamLogic IT, VectorUSA, Neudesic, Calance, ScaleNorth, Phoenix
Group Information Systems), the latter tagged `partner:candidate`. Flags: 10
IT-services-industry companies that are not providers (MedImpact, The Trade Desk,
Canon Medical, Kratos, …), 11 shrinking headcount, 2 unresolved domains (a school
district and a Marine unit). Two checks were loosened during calibration: "not in the
growth subset" is no longer read as shrinking (a second subset positively identifies
decline; no data = pass), and the IT-services industry alone flags instead of kills.
Corroboration floor: 137 of 310 have ≥2 distinct core signals; 121 would enrich with no
approval needed. Seb to review the list; it is the acceptance step 5 above.

**Written 2026-09-17, NOT RUN** (by Seb's decision: write ahead, run only after Phase 1
passes). `workers/weekly.ts`, `workers/retention.ts`, `src/lib/enrich.ts`,
`src/lib/profile.ts`. Design notes from the build:

- Shortlist = best score per company over 7 days, excluding tagged-out, any recorded
  outcome, and companies enriched in the last 30 days. `SHORTLIST_SIZE` 15,
  `CONTACTS_PER_COMPANY` 5, `CREDIT_CEILING` 150 (env-overridable). The ceiling is
  checked *before* each enrich batch using the upper bound (every record new).
- `get_recommended_contacts` (free) returns a `recommendedPersonBrief` string carrying
  name, title, management level, department and job function, so the buying committee
  (security, IT leadership, C-suite) is selected from free data and only those 5 are
  enriched. Verified live on 2026-09-17.
- `enrich_contacts` response shape is unverified (paid). `parseEnriched()` accepts the
  usual envelopes and aborts loudly otherwise, so a surprise costs one call.
  `directPhoneDoNotCall` / `mobilePhoneDoNotCall` are honoured before storage.
- `enrich_company_signals` is deliberately not called: the daily job already stores
  intent and scoop detail from free search.
- Profiles: `claude-haiku-4-5` via `messages.parse` with a zod output format. The model
  returns quotes, not offsets; offsets are computed here and any span whose quote,
  signal id or scope slug does not check out is dropped. Text matching outreach
  patterns rejects the whole profile. Untested until `ANTHROPIC_API_KEY` exists.
- Retention job ran once against the live DB: purged 0, as expected with no contacts.

## Phase 3 — Dashboard

Next.js, per `docs/DESIGN.md` and the accounts/scopes concept in `docs/CONTEXT.md`. In
order: auth wall, ranked findings list with the decay ramp, **account profile view**
(description with intent phrases highlighted and linked to the matching scope, people,
signal history), card expand with contacts (masked until revealed, reveal logged),
**notes and tags on accounts and contacts** (tags `client`, `do-not-contact`,
`partner:*` suppress from surfacing), **manual account seeding** with a source tag for
warm leads and partner intros, outcome buttons (contacted / replied / meeting / dead),
CSV export **in Salesloft person-import format only** (see `docs/ARCHITECTURE.md`
§Export) behind a server route with an `export_log` row and rate limit. Seed the
`scopes` table with PerimeterWatch's services mapped to the configured intent topics
(22 live as of 2026-09-17; already seeded in Phase 0).

**Accept when:** Seb works a Monday from it without opening ZoomInfo's UI.

**Progress 2026-09-17 (built ahead of Phase 1 acceptance by Seb's decision, see
HANDOFF).** First cut of every item above is in `src/app/`:

- Auth wall: `src/middleware.ts` + `src/lib/auth.ts`. Microsoft Entra ID (single
  tenant, any @perimeterwatch.com account) or shared password, chosen by env. Signed
  12h cookie, httpOnly/secure/lax. Hand-rolled OIDC+PKCE on `jose` rather than Auth.js
  v5, which is still beta.
- Ranked list `/` with the decay ramp (`--warmth` → `color-mix` in OKLCH from brand red
  to cool), `007/042` numbering, age written out beside the colour, expand in place via
  `<details>` with signals → scope, masked contacts with logged reveal, notes, tags,
  outcome buttons. Tags `client`, `do-not-contact`, `partner:*` hide the row.
- Account profile `/accounts/[id]`: generated prose with highlighted spans (renders
  once Phase 2 writes `account_profiles`; spans citing no stored signal are dropped),
  people, finding history, outcomes.
- Manual seeding `/accounts/new` with required source tag; `/scopes` catalog.
- Export `/api/export`: Salesloft person-import CSV only, decrypt at export, row in
  `export_log`, 5/hour/actor. Custom-field names still to verify in the PerimeterWatch
  Salesloft instance.
- Outcome `contacted`/`meeting` also suppresses the company for 90 days.

Verified with curl against the live database: redirect, login, list (200 rows), account
page, scopes, seeding page, export headers, logout. Form actions (notes, tags, outcomes,
seeding) need a browser click-through. Not yet: analytics (Phase 4), light-theme polish,
Apple HIG review (docs/DESIGN.md says after the build).

**Second cut, same day, after Seb's review ("bland", "no contacts = no point"):**

- Home page `/` is the Monday view: hero count, four tiles, top 10 accounts, topics
  firing this week, business events this week, accounts being worked plus manual
  seeds, and the last three machine runs. The full ranked list moved to `/findings`.
  Row names link straight to the account page.
- Account page rebuilt: score badge, "Why now" (generated profile if present, else a
  deterministic summary from `src/lib/summary.ts`, every phrase traceable to a stored
  signal), People, signal table with scope, history; side panel with outcome, tags,
  notes.
- **People model changed.** The free recommendation call carries name, title,
  department and seniority, so every surfaced account can have its people for free:
  "Find people · free" stores up to 25 with a buying-committee tier
  (`db/migrations/002`). Email and phone are a per-person click, "Get email & phone ·
  1 credit", counted in `runs` as job `enrich-click` with a 400/month soft cap in
  code. The Sunday job does the same in bulk for the top 15. The top 10 accounts were
  seeded with people (245 rows, 0 credits) on 2026-09-17.
- The dashboard now calls ZoomInfo server-side, so Vercel needs the `ZI_*` variables
  and `PII_ENCRYPTION_KEY` as well as the auth ones.
- The Anthropic profile is now optional by design (Seb's question); the deterministic
  summary is the default and the model paragraph, if ever enabled, replaces it.

**Latency pass, same day.** Measured locally before: `/findings` 834 ms and 3.1 MB
with ~1,600 queries per load (every row rendered its expanded body), `/` 262 ms with
~15 queries. Changes: card bodies load on first open via one server action;
home and findings data cached 60 s (`unstable_cache`, tags `home`/`findings`,
invalidated by every write action; workers rely on the TTL); header stats collapsed to
one query; indexes on `signals(zi_company_id, signal_date)` and `findings(created_at,
zi_company_id)` (migration 003). `npm run perf <base-url>` measures any deployment.
Unit tests: `npm test` (node:test via tsx) covers scoring, summary, committee
selection, enrichment parsing, auth tokens and gate summaries. Still open: pinning
Vercel's function region to Railway's Postgres region (Vercel runs iad1 today).

## Phase 4 — Analytics

Queries over own tables, charts on the dashboard: findings per week per topic, dead
topics among the six, shortlist→contacted rate, credit burn vs. remaining, median days
from first signal to contacted. Build the last two first; they change behavior.

**Accept when:** the six-topic review can be argued from the charts alone.

## Phase 5 — Telegram

Wire `src/lib/notify.ts` into both workers. Bot via BotFather, token in env, chat id
captured once. Deep links land on authed routes.

**Accept when:** a silent weekday sends nothing, a finding day sends one message with a
working link, Sunday sends the digest. No PII in any message, verified by reading them.

**v1 is done here.** A very good filter: who to call and why, every Monday, no ZoomInfo
UI. It writes nothing, sends nothing to prospects, decides nothing.

---

## The agentic layers

Order matters: each layer needs the previous one's data or trust. The selection layer —
what surfaces and how it ranks — stays deterministic code through all of them. Agents
propose; Seb approves; nothing changes silently.

## Phase 6 — Research on demand

A button on each shortlisted card triggers ZoomInfo's Account Research agent (5–15 AI
credits per call) and renders the brief in the expanded card, cached in a new
`research_briefs` table so a re-open costs nothing. Click-triggered only; never called
from a worker. Show estimated cost on the button.

**Accept when:** a brief renders in-card, a second open hits cache, AI credit spend in
Admin Portal matches clicks.

## Phase 7 — Closed loop

Needs roughly 3 months of outcomes data. Two parts:

1. **Fitted weights.** Compare score components against outcomes. Replace the guessed
   half-life, stack bonus and audience weights with values fitted to what converted for
   PerimeterWatch. Rerun quarterly. This can be a notebook before it is a feature.
2. **Proposal agent.** Monthly, an agent reads the analytics and proposes at most: swap
   one intent topic, adjust one ICP bound, adjust threshold. Each proposal shows its
   evidence and lands as a pending change Seb approves or rejects in the dashboard.
   Approved changes are versioned in a `config_changes` table so any ranking can be
   explained against the config that produced it. Topic swaps reset the ZoomInfo intent
   baseline; the proposal must say so.

**Accept when:** first fitted weights ship behind a config version, and the agent's
proposals are reviewable with evidence, rejectable, and logged.

## Credit governance across all phases

| Pool | Budget | Enforced by |
|---|---|---|
| Bulk (8,879 left) | ≤150/run weekly, ≤500/month total | per-run ceiling + admin cap |
| AI actions | click-triggered only, cost shown on button | UI + admin cap |
| Monthly exports (3,000) | unused by this system | n/a — MCP cannot spend them |

Reconcile own counts against the Admin Portal weekly. Divergence means an unaccounted
paid call; treat it as a bug, not drift.

## Out of scope at every phase

Outreach of any kind — no sending, no drafting, no suggested messaging. This system is
prospecting only; see `docs/CONTEXT.md`. Agent-initiated spend. Agent-modified scoring
without an approved, versioned config change. CRM integration (standalone, CSV out
only). A mobile app.
