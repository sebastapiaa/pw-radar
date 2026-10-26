# Contact lists — secondary-session handoff, 2026-10-26

## Priority and ownership

Seb explicitly asked to prioritize the right contacts directly on the platform,
then address the rest of the audit. This is a secondary Codex session; HANDOFF.md,
CLAUDE.md and ROADMAP.md carry the same override so the main session can pick it up.
No commit, push, production database migration, deployment or paid enrichment was
performed here. Weekly hosting and Phase 2 acceptance remain pending.

## Implemented locally

- Findings only selects ZoomInfo accounts with gate status passed/approved, a latest
  passing corroboration check, no exclusion/partner/client/do-not-contact tags and
  no latest dead outcome. The server checks eligibility again during processing.
- The deterministic committee covers security leadership, IT leadership and relevant
  executives (CEO/CFO/COO/CIO/CTO/CISO, owners, founders, managing partners, president).
  Junior security staff, physical security, unrelated executives, board members and
  duplicate recommendation IDs are not used as filler. Existing tier coverage and
  ranking remain in place. This does not change company scoring.
- `runs` stores actor, people-per-company and list version. `shortlist_contacts`
  stores the picked IDs before paid work; `/weekly`, now labelled Contact lists,
  reviews those people and shows exactly which are exportable. Existing good,
  unexpired emails are reused without a paid request.
- Company work has pending/processing/complete/failed/uncertain/skipped states.
  Duplicate/concurrent requests cannot claim completed or processing work again.
  Lists are immediately saved; return to Contact lists to continue pending work or
  free-step failures after leaving the page. Only the creating actor can continue.
  Requests still processing are left alone for ten minutes. On an explicit continue,
  stale processing work becomes uncertain even if no paid marker was persisted.
  Uncertain paid work is never retried automatically. Review saved contacts and the
  provider's portal before deciding whether to make a new list.
- The saved people-per-company value is enforced server-side. Every dashboard or
  weekly paid batch checks the shared monthly soft cap under a database advisory
  lock and increments the requested-record upper bound before the provider call.
  Failures retain that upper bound; actual RUM spend may be lower. Saving a list
  and reusing cached contacts remain free even at the cap; only batches needing
  paid data stop when the shared limit is reached. A list begun in
  an earlier database billing month cannot spend in a new one: create a new list.
  Monthly boundaries still use the database's month, as before; portal reconciliation
  and an explicit Pacific-time billing policy remain follow-up work.
- Exports retain the saved company score/why-now after findings age out of 30 days.
  General exports still use the current 30-day window. Both use the same current
  expiry/suppression rules as their preview counts. Decryption failures abort the
  download with no export-history entry; empty lists cannot consume an export name.
  Valid international phone numbers retain `+`; formula-like text is still escaped.
- Refreshing enrichment replaces old email/phone values, so a new DNC response
  cannot preserve an old callable number. Returned company/contact IDs are checked
  against the request. The encryption key is validated before any paid call.
- Weekly worker code saves the same exact committee and uses the shared credit guard.
  Its deployment/schedule and paid acceptance were not exercised in this session.
- The review page loads people/history in batches for the whole list, avoiding two
  round trips per company when reviewing a large selection.
- Fresh schema snapshot includes migrations 003/004/007, fixing the audit's missing
  verification-gate objects. Existing databases receive the additive migration 007.

## Validation

- Free `npm run zi:discover`: passed 2026-10-26, 24 live tools, existing roles present.
- Regression suite uses an ephemeral PGlite PostgreSQL engine, synthetic contacts,
  injected sessions/provider responses and the real server-action implementation.
  It never uses the production DATABASE_URL or performs a real paid call.
- Covers exact membership, saved historical context, cached emails, duplicate and
  concurrent requests, per-company limits, gate/exclusion checks, monthly cap changes,
  failed paid-call accounting, continuation without paid replay, foreign/completed
  runs, retention, DNC updates, CSV safety and fresh/incremental schema agreement.
- Final local verification, 2026-10-26: `npm test` **36/36 passed**;
  `npm run typecheck` passed; `npm run build` passed; `git diff --check` passed.
  No live browser/hosting acceptance, production migration or Salesloft import was
  performed. The live platform still requires the rollout below.

## Main-session rollout and acceptance

1. Review this working-tree diff together with any main-session changes. These changes
   are not committed or pushed. Keep migration 007 and the code in the same rollout.
2. Apply the additive migration with `npm run db:apply` against the intended database
   before deploying the updated dashboard or weekly worker. Do not use `--reset-runs`
   or `--reseed`; existing records and export history must remain intact.
3. Deploy the dashboard using the main session's normal workflow. Verify Vercel has
   DATABASE_URL, ZI_CLIENT_ID/ZI_CLIENT_SECRET, PII_ENCRYPTION_KEY and existing auth
   configuration. Do not print their values. Budget defaults remain 1500/month and
   300 companies; the soft cap is 50 below the monthly cap.
4. On Findings, select a few eligible companies, choose 1–5 people each and click
   Build contact list. Review the named people/titles/tiers on Contact lists. Names
   still arrive with paid enrichment because current free recommendations omit them.
5. Confirm review/exportable counts, exclusions, and CSV rows agree; reveal remains
   an explicit logged action. A partial list can export its eligible saved contacts.
   Check actual bulk-credit delta in ZoomInfo; application counts are upper bounds.
6. Validate the single export-name tag and radar_* custom fields in the actual
   Salesloft import mapping. This session did not access or import into Salesloft.
7. Record production acceptance in HANDOFF.md and this file, then return to the
   deferred audit backlog and remaining roadmap phases. No phase is accepted merely
   because local checks pass.

## Deferred audit work

- Production dependency audit reported one critical and four high findings (Next.js,
  sharp, PostCSS, source-map-js and Zod). Upgrade and verify; this session did not do
  dependency remediation. PGlite was added as a development-only test dependency.
- Microsoft-mode middleware accepts a signed PKCE token as a page session; unify
  session validation before enabling Microsoft sign-in. Existing shared-password
  deployment was the last recorded mode; hosting state was not inspected here.
- Export GET mutates history; make creation POST-based, serialize name/rate checks,
  and provide usable download errors/retry handling without losing the list.
- Verify retention scheduling, service regions, distributed login throttling and
  redaction of all upstream errors in workers/diagnostic scripts.
- Exact membership cannot be recovered for old version-0 runs. Do not backfill them
  with every enriched contact from their companies. Recreate those lists explicitly.
- Production/browser acceptance, Salesloft-specific mapping, scheduled weekly hosting
  and portal credit reconciliation remain required. These are not claimed complete.
