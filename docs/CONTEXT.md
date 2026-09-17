# Sales Context

Internal file. Client identities are deliberately abstracted; do not add client names
to this repo. Seb can name names in conversation; the docs stay clean.

## What this system is, restated

Prospecting only. **PerimeterWatch does not do outreach from this system, and the system
must not draft, suggest or send outreach in any form.** It finds companies whose timing
is right, assembles a full-context profile, and hands Seb the evidence. Engagement
happens downstream in **Salesloft** — the boundary is a Salesloft-format CSV export and
nothing else. Radar prospects; Salesloft engages.

## Inputs received from Seb (2026-09)

The two services documents arrived (Defense-as-a-Service one-pager, company
presentation) and are distilled into `docs/SERVICES.md`; the `scopes` seed derived from
them is `db/seed_scopes.sql`. The originals are not committed. A vendor list (network,
SIEM, EDR, email security stacks PerimeterWatch operates) is in SERVICES.md and feeds a
technographic fit signal.

## Proven client profile (identity classified)

Anchor client: a large international **law firm** — several hundred attorneys, 500–1,000
total staff — serving venture-backed technology and life-science companies, with a San
Diego office. Why that profile buys co-managed security, and why it generalizes:

- Law firms hold concentrated sensitive data: deal terms, IP, fund information, client
  privilege. Breach cost is reputational, not just operational.
- Their clients impose security via outside counsel guidelines and security
  questionnaires, so the pressure is commercial and recurring, not just regulatory.
- Wire fraud and BEC target legal workflows specifically (closings, escrow, funds flow).
- Internal IT is small relative to the risk surface, and firms rarely have a CISO below
  the very top tier. 24/7 detection is exactly what they cannot staff.
- Buyer titles skew COO / CIO / Director of IT rather than security leadership.

Takeaway for the ICP: **professional services, legal first**, is a proven vertical in
the 100–5,000 band. Weight it up. Other verticals are unconfirmed; do not hardcode more
until outcomes data says so.

## Channel partnership (in progress)

**RepowerIT** — an MSSP/MSP in the Savannah, Georgia metro (Guyton, GA), 11–50 staff,
compliance-framework focused. Partnership under discussion; likely joint work.

Implications for the build:

- Accounts may arrive **partner-sourced** and outside the Southern California scan
  geography. The geo filter applies to automated discovery, not to accounts added
  manually. Tag partner-sourced accounts (`partner:repowerit`) so analytics can separate
  them.
- RepowerIT itself, and any client it introduces, must never surface as a cold prospect.
  Tag-driven suppression covers this (see below).

## Warm leads exist outside ZoomInfo

Example: event invitees (a Padres game) that never got follow-up. The system needs
**manual account seeding**: add a company by name/domain with a source tag
(`event:padres-2026`), no ZoomInfo discovery required. Manually seeded accounts join the
same profile view and analytics. This is a Phase 3 dashboard feature, not an
afterthought — warm leads decaying in a notes app is the exact failure this tool exists
to prevent.

## Notes, tags, and suppression

Seb's chosen mechanism for account state: **free-form notes and tags on both accounts
and contacts.** No rigid pipeline stages beyond the existing outcomes statuses.

- Tags drive behavior: `client`, `do-not-contact`, `partner:*` suppress an account from
  surfacing; `event:*`, `source:*` mark provenance.
- Notes are append-only with author and timestamp.
- There is no upfront suppression list. Seb tags as he goes and says he'll know if
  something goes wrong. The system's job is to make tagging one click.

## Standalone, confirmed

No CRM integration in any phase. CSV export is the only way data leaves. This removes
the CRM dedupe assumption from early planning entirely.

## The product concept, in Seb's terms

Two connected object types:

1. **Accounts** — the company, its people, its fields, notes, tags, and its signal
   history.
2. **Scopes** — PerimeterWatch's services, each bundled with the intent topics it maps
   to (see the topic table in `docs/ARCHITECTURE.md`).

The connection is rendered, not just stored: an account's profile shows its description
in plain text with the phrases that constitute intent signals **highlighted**, each
highlight tied to the scope it maps to. The profile answers "what do they need from us,
in their own words" at a glance. Treatment details in `docs/DESIGN.md`.
