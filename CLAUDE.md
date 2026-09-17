# Radar (PerimeterWatch Radar)

Internal lead-timing dashboard for PerimeterWatch BD. You are picking up a fully
scoped project; do not re-derive decisions that are already made.

**Start every session by reading `HANDOFF.md`**, then work strictly in the phase order
of `docs/ROADMAP.md`. Each phase has an acceptance test; do not start a phase before
the previous one passes. When Seb asks "what's next," answer from the roadmap's current
phase.

Hard rules that survive every session:
- No outreach in any form: no sending, no drafting, no suggested messaging.
- The daily worker spends zero credits. `freeOnly: true` stays. Ever.
- No contact PII to the model API, to Telegram, or to logs.
- Export is Salesloft person-import CSV only.
- Agents propose, Seb approves. The selection layer stays deterministic code.

Keep the docs current: when a decision is made or a phase passes, update `HANDOFF.md`
(Answered section) and the relevant doc in the same commit. The docs are the project's
memory across sessions; a decision that isn't written down will be lost.
