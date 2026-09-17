# ZoomInfo Integration

Source of truth: https://gtm.ai/docs/mcp — ZoomInfo's own docs for their MCP server.
GTM.AI is ZoomInfo's brand for this layer. The server is at `https://mcp.zoominfo.com/mcp`.

## Account state (verified 2026-08-31)

| Thing | Value |
|---|---|
| Plan | Advanced, 3 seats (all assigned) |
| Bulk credits | 10,100 total, 1,221 used, **8,879 remaining** |
| Monthly exports | 3,000/mo, replenishes 1st Pacific |
| Intent topics | 6 per the plan sheet; **22 configured** per live `lookup` on 2026-09-17 (see `docs/ARCHITECTURE.md`) |

**MCP requires bulk data credits and does not work with recurring monthly credits.**
The 3,000 monthly export pool is invisible to this project. Budget against 8,879 only.

Usage is visible at Admin Portal → Usage → Data Credit Dashboard (bulk) and AI Credit
Dashboard (AI actions).

### Baseline for Phase 1 acceptance

Admin Portal → Usage, data up to **2026-09-17 08:34 EST**: bulk credits **1,122 used,
8,878 remaining**. That is one credit below the 8,879 recorded at scoping (2026-08-31);
"Credits Used Per Application" attributes 1 credit to "API" in the last 90 days. The
timestamp precedes the first authenticated Radar call (≈08:41 EST the same day), so the
credit is not from this project. Unexplained; watch whether it recurs. Phase 1 passes
only if this number is still 8,878 after three daily runs.

### Where credits can be spent (2026-09-17)

Exactly three code paths call a paid tool, and each records its spend in `runs`:

| Path | Job name in `runs` | Guard |
|---|---|---|
| Sunday worker `workers/weekly.ts` | `weekly` | `CREDIT_CEILING` 150 per run, checked before each batch |
| Dashboard "Get email & phone" click | `enrich-click` | 1 contact per click, 400/month soft cap in `src/lib/actions.ts` |
| (none yet) research tools | — | AI action credits, not wired |

The daily worker, "Find people", the findings list and the export never spend.

## Credit model

| Call | Cost |
|---|---|
| Search, Lookup, Find Similar, Recommended Contacts | **free** |
| Enrich Companies / Contacts | 1 bulk credit per *new* record |
| Enrich Company Signals | 1 bulk credit **per signal returned** |
| Account Research / Contact Research | 5–15 AI action credits per call |
| Conversation Intelligence | min 9 AI action credits per call |

Enrichment tools process up to 25 records per call, which caps per-call spend.

### Records Under Management

Once enriched, a record enters RUM for **12 months** and re-enriching it costs nothing
in that window. RUM is tracked **at the organization level**, so anything a colleague
already pulled is already paid for.

This is the single most important fact for cost control. The daily loop gets cheaper the
longer it runs, because the same companies keep reappearing. Budget for the discovery
edge, not steady state.

There is no cost preview before a call. You cannot ask what something will cost; you can
only structure calls so the ceiling is known.

### Budget

Rough plan: ~15 companies on the Sunday shortlist, a few signals and a few contacts each,
lands near 90 credits a week. Under 5,000 a year against 8,879 available. Comfortable,
but only if the daily loop stays on free calls.

**Per-user credit cap, set 2026-09-17** on Seb's user (the delegated user for the Radar
app) in Admin Portal → Users → User Management → edit user → Subscription:

| Setting | Value |
|---|---|
| Product | SalesOS: Advanced+ Bundle |
| Credit Limit | Limit to 500, reset monthly (was 1,000) |
| AI Action Credits | Limit to 200, reset monthly (was Unlimited) |

500 is from the budget above: ~90/week planned, ~400/month at the discovery edge,
~100 spare for manual use, 6,000/year inside the 8,879 balance. 200 AI credits is a
judgement call: 13–40 research clicks a month, none of them automated.

`ASSUMPTION`: the dialog does not say whether "Credit Limit" governs bulk credits (which
MCP spends) or the monthly pool (which MCP cannot touch). The Phase 2 acceptance test
reconciles our `credits_spent` against the bulk balance; if a run near the cap is not
refused, the cap is not protecting Radar and the per-run ceiling in `workers/weekly.ts`
is the only real guard. No separate "API Access" toggle is visible in User Management on
this plan; access is proven by the working token exchange.

## Tool discovery

Do **not** hardcode tool names from these docs or from memory. ZoomInfo adds tools to the
server and they appear at the start of the next session. Instead:

1. Read the live list at https://gtm.ai/docs/mcp/tools — it documents each tool and its cost.
2. Have the client enumerate tools at startup and assert the ones you depend on exist.
3. Map them into the roles in `src/lib/zoominfo.ts` (`searchCompanies`, `searchSignals`,
   `recommendedContacts`, `enrichSignals`, `enrichContacts`).

The open question that shaped the daily job was: **is there a free search path that
surfaces which companies are spiking on intent, with paid enrichment only to pull signal
detail?**

**Answered 2026-09-17 from https://gtm.ai/docs/mcp/tools (docs, not yet a live call):
yes.** `search-intent` is documented as "Free. Search Intent consumes no bulk data
credits." It takes topics (required) plus signal-strength, industry, employee-count and
geography filters, and returns company name and basic profile, the topics being
researched, and a composite signal score. `search-scoops` is likewise free, filtered by
scoop type, topic, department, publication date and the standard company filters, and
returns the scoop description, event type and publication date. The design holds as
written. Per-signal detail beyond what search returns (`enrich-company-signals`, 1 credit
per signal returned) stays weekly and shortlist-only.

Two caveats from the same docs. Free scoops "count toward your record and request
limits", so there is a rate ceiling to discover empirically. And `find-recommended-contacts`
returns full contact detail, email and direct dial included, for free; it is personalised
to the authenticating user's history, and "shared credentials reduce recommendation
quality", so a service account will get weaker recommendations than Seb's own login.

### Live tool list (verified 2026-09-17, `npm run zi:discover`, client-credentials auth)

The server's names differ from the docs: underscores, and `get_recommended_contacts`
rather than `find-recommended-contacts`. `ROLE_TO_TOOL` in `src/lib/zoominfo.ts` is
now verified against this list; `search_companies_v2` and `search_contacts_v2` exist but
describe themselves as deprecated in favour of the originals. Full descriptions and
input schemas are snapshotted in `docs/zoominfo/tools-list-2026-09-17.txt` (schemas
only, no data). Re-run discovery with `--describe` to refresh it.

```
account_research        browse_audiences        browse_engagements
contact_research        conversation_intelligence
enrich_companies        enrich_company_signals  enrich_contacts
find_similar_companies  find_similar_contacts   get_audience
get_gtm_context         get_recommended_contacts
lookup                  search_companies        search_companies_v2 (deprecated)
search_contacts         search_contacts_v2 (deprecated)
search_intent           search_scoops           submit_feedback
update_gtm_context
```

What the live descriptions say about the calls the workers depend on:

- `search_intent` — "CREDITS: Free to use." Requires 1–50 `topics`, exact names from
  `lookup` with `fieldName: "intent-topics"`. Filters: `signalScoreMin/Max` (60–100),
  `audienceStrengthMin/Max` (A largest … E smallest), `signalStartDate/EndDate`,
  `employeeRangeMin/Max` or `employeeCount` bands, `state`, `metroRegion`, `zipCode` +
  `zipCodeRadiusMiles`, industry codes. `pageSize` up to 100, pagination capped at
  10,000 records. Sort by `-signalScore` or `-signalDate`. Results carry topic, signal
  score, audience strength, signal date and category. **Leave `findRecommendedContacts`
  false**: it inlines contact data and risks timeouts, and the daily job must not carry
  contacts anyway.
- `search_scoops` — "does not consume any Credits. Each Scoop returned counts towards
  the customer's Record Limit and a successful response counts towards the Request
  Limit." Filters: `scoopTypes` (enum incl. New Hire, Executive Move, Management Move,
  Hiring Plans, Open Position, Pain Point, Project, Funding, M&A, Layoffs, Facilities
  Relocation / Expansion), `department` (enum incl. Information Technology, C-Suite),
  `publishedStartDate`, `description` keywords, plus the standard company filters.
  Default sort `-originalPublishedDate`.
- `get_recommended_contacts` — "CREDITS: Free to use." Requires `ziCompanyId` and
  `useCaseType`; use `PROSPECTING` (has cold-start support). Returns up to 100 ranked
  contacts with `score`, `reRankingScore` and `meta` explaining the reference person.
  Contact detail (email, direct dial) is the separate, paid `enrich_contacts` step. The
  docs page claiming free email and phone was wrong; the live tool says otherwise.
  Live shape (2026-09-17): `{ recommendations: [{ zoominfoContactId, attributes: { rank,
  score, reRankingScore, recommendedPersonBrief }, meta: { sourceType,
  referencePersonId, referencePersonBrief } }] }`. The brief is
  `"Name, Title | management_level: [X] | seniority: X | job_function: [X] |
  department: [X] | industry: [...] | revenue_range: ... | employee_range: ..."`, which
  is enough to pick the buying committee before spending anything.
- `enrich_company_signals` — 1–10 company ids per call, `signalTypes` subset of
  INTENT / NEWS / SCOOP. "Charges data credits for any records returned for companies
  not currently under management. Companies enriched within the prior 12 months do not
  incur additional charges." Each signal returned is a record. Weekly, shortlist only.
- `enrich_contacts` — up to 10 contacts per call (the docs said 25; the live schema
  says 10). Identify by `personId` from recommendations.
- Every tool accepts an optional `userIntent` string (10–500 chars) "used by ZoomInfo
  for audit and personalization." Send a fixed, PII-free description of the job.

Observed on the first full daily run (2026-09-17):

- **Intent publishes weekly.** All 4,326 intent signals in a 7-day window carried one
  `signalDate` (2026-09-12, a Friday). Expect the next drop around 2026-09-19.
- **Audience strength has an F grade** below E. Undocumented; weighted 0.4.
- Intent ids look like `<hash>#<companyId>#<yyyymmdd>`; scoop ids are numeric. Both
  are stable and used for dedupe.
- `search_intent` takes `employeeRangeMin/Max` as strings and `metroRegion` as a
  comma-separated string; `search_scoops` takes integers and a `metroRegions` array.
  The wrappers in `src/lib/search.ts` handle the difference.
- `search_companies` by `companyIdList` (≤50 ids) returns name, website, employeeCount
  (as a string), city, state ("California"), country ("United States"), revenue. No
  industry field.
- 73 calls and ~4,400 records in one run drew no rate-limit or record-limit error.
  The limits exist per the tool description; their size is still unknown.
- The `lookup` tool enumerates `intent-topics`, `scoop-types`, `scoop-topics`,
  `metro-regions`, `states`, `employee-count`, `tech-products` and more. Use it once at
  worker startup for exact filter values rather than hardcoding strings.

## Authentication

Two modes:

- **User OAuth** — each user authenticates with their own credentials. Good for Seb's
  personal use in Claude or the CLI. Expires. Useless for cron.
- **App-level** — Developer Portal → Create new **MCP app** → authentication method
  **Client Credentials** → delegated user. Verified 2026-09-17: this exists on the
  Advanced plan. The app "PerimeterWatch Radar" is created with Seb as delegated user,
  so his entitlements, credit pool, cap and contact personalisation apply. The portal
  issues a client id and a client secret (no private key, no username). It also offers
  a 24-hour bearer token for cURL testing; that is local-only and never goes to Railway.

  The gateway advertises its OAuth metadata, fetched without credentials:

  ```
  GET https://mcp.zoominfo.com/.well-known/oauth-authorization-server
  token_endpoint: https://okta-login.zoominfo.com/oauth2/default/v1/token
  token_endpoint_auth_methods_supported: client_secret_basic, client_secret_post
  scopes_supported: openid profile zi_api email offline_access zi_mcp api:data:mcp
  ```

  The client exchanges id + secret for a token with `grant_type=client_credentials`
  and `scope=api:data:mcp` (`ZI_SCOPE`, adjustable). `ASSUMPTION`: the metadata lists
  only `authorization_code` and `refresh_token` under grant types; the client-credentials
  grant is what the portal's app type implies, and `npm run zi:discover` is the test. If
  Okta answers `unsupported_grant_type` or `invalid_scope`, try `zi_mcp` as the scope
  first, then ask the CSM.

Entitlements are enforced server-side per the authenticating identity. The 6-topic intent
limit applies regardless of how you call in.

## Failure modes to handle

- Entitlement errors: a tool exists but this contract cannot call it. Log and degrade,
  do not retry.
- Credit exhaustion mid-run: stop the run, alert, do not partially write.
- Token expiry: app credentials still need refresh handling.
- Empty results: normal on most weekdays. Not an error. Suppress the notification.
