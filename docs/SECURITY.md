# Security Requirements

This dashboard holds enriched business contact data: names, titles, work emails, direct
dials. That is regulated personal data under CCPA and GDPR. It is also being built by an
employee of a managed security provider, so the bar is the one PerimeterWatch would set
for a client. Treat this file as requirements, not advice.

## Threat model

Realistic risks, in order of likelihood:

1. Credentials leak through the repo, the client bundle, or a log line.
2. The dashboard is exposed without auth and gets indexed or scraped.
3. CSV export walks the whole database out the door with no record of it.
4. Contact PII sits in Postgres indefinitely with no retention policy.
5. A compromised Telegram account exposes prospect data from message history.

Not in the threat model: a targeted attacker with Railway account access. If that
happens, this project is not the problem.

## Requirements

### Credentials

- ZoomInfo app credentials live in Railway environment variables. Never in the repo,
  never in `.env` committed, never in a client component.
- Every ZoomInfo call is server-side: route handlers, server actions or the workers.
  The browser must never hold a token.
- Separate credentials for the service account and for Seb's personal use.
- Rotate on any suspicion. Document the rotation steps in the repo.

### Auth

- Every route requires authentication. There are no public pages, not even a landing page.
- Single tenant, small user set. Do not build a user management system; use an identity
  provider or a single-org SSO and move on.
- Session cookies: `httpOnly`, `secure`, `sameSite=lax`, short expiry.

### Data at rest

- Postgres encrypted at rest (Railway default).
- **Additionally encrypt contact PII at the application layer** — email and phone columns
  specifically. Key in Railway env, separate from the DB credential. If someone gets a
  database dump, they should not get a call list. `src/lib/crypto.ts` has the interface.
- Company-level data (name, domain, signals) does not need column encryption. It is not
  personal data and encrypting it makes the dashboard queries painful for no gain.

### Export

- CSV export is a gated server route, never a client-side dump of loaded state.
- Every export writes an audit row: who, when, how many records, which filter.
- Rate limit the export endpoint. A BD tool has no legitimate need for ten exports a minute.
- Consider whether export should include phone numbers at all, or only on an explicit
  second confirmation.

### Retention

- Purge job: delete enriched contact PII after a set window. 180 days is a reasonable
  default; confirm with Seb.
- Company-level signal history can be kept indefinitely. It is the analytics substrate
  and it is not personal data.
- Retention is a scheduled job, not a manual intention. Write it.

### Telegram

- Messages carry a count and a deep link. **No names, no companies, no emails, no phones.**
  Telegram history is not a place prospect data should live, and Seb's phone is not a
  managed device.
- The deep link lands on an authenticated route. If he is not signed in, he signs in.
- Bot token in env, same as everything else.

### Logging

- Never log request or response bodies from ZoomInfo. They contain PII by definition.
- Log tool name, record count, credit-affecting flag, duration, outcome.
- Structured logs, no PII, and check that error handlers do not serialize the whole
  request object into a stack trace.

### Model API boundary

- Profile generation calls the Anthropic API with company-level data only:
  firmographics, signals, size band, scopes catalog. **Contact PII never leaves for the
  model** — no names, emails, phones, not even masked. Enforce it in the function that
  assembles the prompt, not by convention.
- `ANTHROPIC_API_KEY` in Railway env like every other secret, server-side only.

### Dependencies

- Lockfile committed. Dependabot or equivalent on.
- Keep the dependency count low. This is a dashboard, not a platform.

## Deliberately not doing

- Field-level access control. One user, then maybe three. Not worth it.
- SOC 2 style audit logging beyond the export trail. Overkill at this scale.
- Self-hosting the database. Railway Postgres is fine.
