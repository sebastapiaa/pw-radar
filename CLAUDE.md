# Radar (PerimeterWatch Radar)

Internal lead-timing dashboard for PerimeterWatch BD. You are picking up a fully
scoped project; do not re-derive decisions that are already made.

**Start every session by reading `HANDOFF.md`**, then follow `docs/ROADMAP.md`.
**Seb's priority override, 2026-10-26:** finish the on-platform contact-list workflow
first (choose eligible companies → deterministic buying committee → review saved people
→ Salesloft export), ahead of weekly-service setup and the remaining audit backlog.
This was explicitly requested in a secondary Codex session; see
`docs/CONTACT_LISTS.md` for implementation, validation and rollout instructions.
Local checks passed (36 tests, typecheck, production build); migration 007 and
deployment are still pending in the main session. No paid calls were made.
Phase 2 has not been declared accepted. Do not silently revert this priority to the
old "create radar-weekly next" instruction. After contact-list acceptance, return to
the remaining roadmap and security work. Other phase acceptance rules still apply.

Hard rules that survive every session:
- No outreach in any form: no sending, no drafting, no suggested messaging.
- The daily worker spends zero credits. `freeOnly: true` stays. Ever.
- No contact PII to the model API, to Telegram, or to logs.
- Export is Salesloft person-import CSV only.
- Agents propose, Seb approves. The selection layer stays deterministic code.
- Contact lists persist exact contact IDs in `shortlist_contacts`; never reconstruct
  a run's people by joining every enriched contact at its companies. Migration 007
  must be applied before deploying this version of the app or weekly worker.
- Keep completed/uncertain paid work out of automatic retries. Credits are a
  conservative upper bound recorded before each paid request, including failures.

Keep the docs current: when a decision is made or a phase passes, update `HANDOFF.md`
(Answered section) and the relevant doc in the same commit. The docs are the project's
memory across sessions; a decision that isn't written down will be lost.
