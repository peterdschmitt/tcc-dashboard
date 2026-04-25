# GHL Call Log Sync — Design Spec

**Status:** Draft for review
**Author:** Peter Schmitt (with Claude)
**Date:** 2026-04-25
**Target:** TCC Dashboard (Next.js, Vercel)

---

## 1. Purpose

Push every callable lead that lands in the Call Logs Google Sheet into GoHighLevel as a contact, so GHL workflows (SMS, email, retention sequences) can chase leads automatically and stop them from slipping through the cracks.

Google Sheets remains the system of record for everything — dashboard analytics, P&L, commissions, carrier sync, snapshots — and is unchanged by this work. GHL becomes a downstream destination, not a replacement.

## 2. Scope

### In scope (V1)

- One-way sync: Google Sheets → GoHighLevel
- Trigger: new rows in `CALLLOGS_SHEET_ID`
- Tiered matching to deduplicate humans (phone exact → name+state fuzzy → new contact)
- Maximalist field mapping: every Call Logs column lands somewhere in GHL (native field, custom field, tag, or activity note)
- Configurable campaign exclusion list
- Audit trail in three new tabs in the Goals sheet
- Backfill endpoint for historical Call Logs data
- Dry-run mode and kill switch for safe rollout

### Explicitly out of scope (V1)

- Two-way sync (GHL → Sheets) — Sheets is unilaterally upstream
- GHL workflow content itself (welcome SMS, follow-up sequences) — Peter configures these inside GHL after V1 ships
- Pipeline / opportunity sync (replacing the Sales Tracker) — V3+
- Retention/policyholder workflows — V3+
- Dialer integration — current dialer untouched
- Dashboard reading from GHL — dashboard continues reading from Sheets

## 3. Architecture

### Data flow

```
Vercel cron (every 10 min)
        │
        ▼
/api/cron/ghl-sync (gated by CRON_SECRET)
        │
        ▼
1. Read new rows from CALLLOGS sheet
   (Import Date > high-water mark)
        │
        ▼
2. EXCLUSION FILTER — for each row:
   - skip if Campaign ∈ "GHL Excluded Campaigns" tab
   - skip if Phone is blank
   - skip if hash already in "GHL Sync Log"
        │
        ▼
3. MATCHING LADDER — for each surviving row:

   ┌─ Tier 1: phone exact match in GHL?
   │           ──► YES → attach activity to that contact
   │
   ├─ Tier 2: first + last + state fuzzy match?
   │           (Levenshtein ≤1 on names, exact state)
   │           ──► YES → create new contact AND log to "GHL Possible Merges"
   │
   └─ Tier 3: no match ──► create new contact
        │
        ▼
4. WRITE BACK to GHL:
   - Native fields (first/last/phone/state/country/source)
   - "First *" custom fields (set once on creation)
   - "Last *" custom fields (overwrite on every call)
   - Increment "Total Call Attempts"
   - Add tags: publisher:{X}, state:{X}, callable:yes|no
   - Append per-call activity note
        │
        ▼
5. WRITE outcome row to "GHL Sync Log":
   timestamp | row hash | Lead Id | phone | first | last | state |
   tier matched | action taken | GHL contact ID | error (if any)
```

### Technology stack

- **Runtime:** Next.js API route on Vercel (matches existing TCC stack)
- **Cron:** Vercel cron via `vercel.json` (matches existing `/api/cron/backfill-snapshots` pattern)
- **Sheets I/O:** existing `src/lib/sheets.js`
- **GHL auth:** Private Integration Token (single location)
- **Audit trail:** new tabs appended to existing `GOALS_SHEET_ID`

## 4. Matching Ladder (Dedupe Logic)

The fundamental challenge: the same human can have multiple phone numbers. We accept that pure phone-dedupe creates duplicates, and use a tiered match with confidence scoring — the same pattern your `carrier-sync` flow already uses.

| Tier | Match rule | Confidence | Action |
|------|------------|------------|--------|
| 1 | Phone exact match in GHL | High | Attach activity to existing contact. Done. |
| 2 | Phone not in GHL **but** Levenshtein distance ≤1 on First Name **and** Levenshtein distance ≤1 on Last Name **and** State exact match | Medium | Create new GHL contact **and** write a row to `GHL Possible Merges` tab listing both contact IDs for human review |
| 3 | No match at any tier | — | Create new GHL contact |

Tier 2 deliberately does *not* auto-merge. Silent merges of two different "John Smith"s in California would cause workflows to fire SMS at the wrong human. The review tab gives Peter a weekly cleanup queue where he can manually merge inside GHL with one click when the match is correct.

**State match is required.** Without it, "John Smith CA" and "John Smith FL" would be considered the same person — almost always wrong.

## 5. Filtering Rules

A call row is processed if and only if:

1. **Phone is present** (non-empty after trimming) — defensive baseline
2. **Campaign code is not in the `GHL Excluded Campaigns` tab** — configurable, currently empty
3. **Row hash not already in `GHL Sync Log`** — idempotency guard

Internal-transfer sources (LIFE, Referral, Health1, Health2, Health3) are *not* excluded — they're real leads. They flow through the same matching ladder, where Tier 1 phone-dedupe naturally consolidates them onto existing contacts when the same human had previously called from a paid publisher.

## 6. Field Mapping

Every Call Logs column lands somewhere. Easier to drop unused fields later than to backfill missing ones.

### 6.1 Native GHL fields

| Call Log column | GHL field | Behavior |
|---|---|---|
| First | First Name | Set once on contact creation |
| Last | Last Name | Set once |
| Phone | Phone (primary) | On new contact (Tier 3): set as primary. On Tier 1 match: keep existing primary; if the new phone differs, append to "Additional Phones". Never overwrite the primary. |
| State | State | Set once |
| Country | Country | Set once |
| Inbound Source | Source | Set once |

### 6.2 Custom fields — "First *" set (set once, never overwritten)

These freeze the lead's origin story.

| Custom field | Source column |
|---|---|
| First Lead ID | Lead Id |
| First Client ID | Client ID |
| First Call Date | Date |
| First Campaign | Campaign |
| First Subcampaign | Subcampaign |
| First Caller ID | Caller ID |
| First Inbound Source | Inbound Source |
| First Import Date | Import Date |
| First Rep | Rep |

### 6.3 Custom fields — "Last *" set (overwritten on every new call row)

These reflect "where is this lead right now" — workflow conditions read from these.

| Custom field | Source column |
|---|---|
| Last Lead ID | Lead Id |
| Last Client ID | Client ID |
| Last Call Date | Date |
| Last Rep | Rep |
| Last Campaign | Campaign |
| Last Subcampaign | Subcampaign |
| Last Caller ID | Caller ID |
| Last Import Date | Import Date |
| Last Call Status | Call Status |
| Last Call Type | Call Type |
| Last Call Duration (s) | Duration |
| Last Hold Time (s) | HoldTime |
| Last Hangup | Hangup |
| Last Hangup Source | Hangup Source |
| Last Call Details | Details |
| Last Recording URL | Recording |
| Last Attempt # | Attempt |
| Currently Callable | Is Callable |

### 6.4 Custom fields — Computed

| Custom field | Computation |
|---|---|
| Total Call Attempts | Count of all sync log rows with this contact's phone |

### 6.5 Tags

Lean tagging — only what drives workflow segmentation. GHL deduplicates tags automatically.

- `publisher:{Campaign}` — e.g., `publisher:BCL`, `publisher:HIW`, `publisher:Referral`
- `state:{State}` — e.g., `state:CA`, `state:TX`
- `callable:yes` / `callable:no` — kept current with `Currently Callable`; on flip, the opposite tag is removed

Other dimensions (Rep, Subcampaign, Call Status) live in custom fields where workflows can read them precisely.

### 6.6 Activity note (per call row, never overwritten)

Every processed call writes a note to the contact's GHL conversation/timeline:

```
📞 2026-04-25 14:32 — BCL / SubcampaignX (Attempt #2)
   Status: Answered | Type: Inbound | Duration: 47s | Hold: 8s
   Rep: John D. | Caller ID: 555-1234 | Hangup: Caller via SIP
   Lead ID: 8847291 | Client ID: 449281
   Details: Spoke briefly, requested callback
   🎙️ https://recording.example.com/abc123
```

The recording line is omitted when no Recording URL is present. The Details line is omitted when blank.

## 7. Sheet Additions

Three new tabs added to the existing `GOALS_SHEET_ID`. No changes to any existing tab.

### 7.1 `GHL Sync Log` (append-only audit trail)

| Column | Purpose |
|---|---|
| Timestamp | When this row was processed |
| Row Hash | `sha256(Lead Id + Date + Phone + Duration)` — idempotency key |
| Lead Id | From Call Log |
| Phone | From Call Log |
| First | From Call Log |
| Last | From Call Log |
| State | From Call Log |
| Tier | 1, 2, or 3 — which matching tier triggered |
| Action | "created" / "attached" / "skipped:reason" / "error" |
| GHL Contact ID | The contact that was created or attached to |
| Error | Empty on success; error message on failure |

A single dedicated cell in this tab (or a sibling `GHL Sync State` mini-tab) holds the **high-water mark** — the most recent `Import Date` we've successfully processed. The cron run starts by reading rows where `Import Date > high-water mark`.

### 7.2 `GHL Possible Merges` (Tier 2 review queue)

| Column | Purpose |
|---|---|
| Timestamp | When the possible match was detected |
| Existing GHL Contact ID | The contact already in GHL |
| Existing Name | First Last from existing contact |
| Existing Phone | Primary phone of existing contact |
| New GHL Contact ID | The contact we just created |
| New Name | First Last from the new row |
| New Phone | Phone from the new row |
| State | Common state value |
| Reviewed | Empty until Peter sets to "yes" — flips to "merged" or "kept-separate" |

Peter glances at this weekly. For each unreviewed row, he opens both contacts in GHL, decides if they're the same human, and either merges them (one-click in GHL) or marks "kept-separate".

### 7.3 `GHL Excluded Campaigns` (configurable filter)

| Column | Purpose |
|---|---|
| Campaign | Code to exclude (matches Call Log `Campaign` exactly) |
| Subcampaign | Optional — if set, excludes only this subcampaign within the campaign |
| Reason | Free-text note for future Peter |
| Added Date | When this exclusion was added |

Currently empty. Sync reads this tab on every run.

## 8. Infrastructure

### 8.1 Endpoints

| Endpoint | Purpose | Auth |
|---|---|---|
| `GET /api/cron/ghl-sync` | Vercel cron — process new rows | `CRON_SECRET` |
| `GET /api/ghl-backfill?start=YYYY-MM-DD&end=YYYY-MM-DD` | One-time historical load | `CRON_SECRET` |

Both endpoints share the same core processing logic in a pure library at `src/lib/ghl-sync.js`. The cron route fetches new-since-watermark rows; the backfill route fetches a date range. Both apply the same filter, matching, and write logic — and both are idempotent via the row-hash dedup.

### 8.2 Cron schedule

`vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cron/ghl-sync", "schedule": "*/10 * * * *" }
  ]
}
```

### 8.3 Environment variables

```
GHL_API_TOKEN=<Private Integration Token from GHL Settings → Private Integrations>
GHL_LOCATION_ID=<location ID from GHL>
GHL_SYNC_ENABLED=true        # kill switch — set false to halt sync without redeploy
GHL_SYNC_DRY_RUN=true        # log actions but don't write to GHL — flip to false after dry-run period
```

`CRON_SECRET`, `GOALS_SHEET_ID`, `CALLLOGS_SHEET_ID` already exist.

### 8.4 GHL Private Integration scopes

Required scopes when creating the token:

- `contacts.readonly`, `contacts.write`
- `conversations.write` (for activity notes)
- `locations/customFields.readonly`, `locations/customFields.write`
- `locations/tags.write`

### 8.5 GHL custom field setup (one-time, manual)

Before V1 goes live, the 28 custom fields listed in §6.2–§6.4 need to exist in GHL (9 in the "First *" set, 18 in the "Last *" set, 1 computed). Two options:

- **A.** Manual creation via GHL UI (Settings → Custom Fields)
- **B.** A one-time setup script `scripts/ghl-bootstrap-fields.js` that creates them via the API

**Decision: B.** A bootstrap script is documented in code, repeatable across environments (e.g., test sub-account), and avoids typo-induced field-name drift between GHL and the sync code.

## 9. Reliability

### 9.1 Idempotency

Two complementary mechanisms:

- **Watermark** (high-water-mark `Import Date`): cheap fast-filter to fetch only new rows
- **Row hash** (`sha256(Lead Id + Date + Phone + Duration)`): correctness guarantee — even if the same row is fetched twice, it processes once

A row is considered "already processed" if its hash exists in `GHL Sync Log` regardless of the action recorded (created / attached / skipped / error). On retry of an errored row, the operator should manually clear the corresponding sync log row before the next cron tick.

### 9.2 Rate limiting

- GHL v2 API limit: ~100 requests per 10 seconds per location
- Expected volume: hundreds of call rows/day → well under the limit
- Defensive: 50ms inter-call delay; token-bucket guard at 80 req/10s as a soft ceiling

### 9.3 Retry behavior

| Failure | Behavior |
|---|---|
| GHL 429 (rate limit) | Exponential backoff (1s, 2s, 4s); 3 retries |
| GHL 5xx | Exponential backoff; 3 retries |
| GHL 4xx (validation) | Log to Sync Log with error message; skip row; continue batch |
| Sheets read failure | Fail whole run; do not advance watermark |
| GHL auth failure | Fail whole run loudly; no retries (kill-switch territory) |
| Per-row unexpected exception | Log to Sync Log with error; continue with remaining rows |

A single bad row never kills the batch.

### 9.4 Watermark advancement

The watermark only advances after the entire batch completes. If the run fails mid-batch:

- Successfully written rows have their hash in Sync Log → they will be skipped on the next run
- Unwritten rows will be re-fetched and re-attempted

This means "at-least-once" delivery; the row-hash dedup makes it effectively "exactly-once" in outcome.

## 10. Testing Strategy

### 10.1 Unit tests (Vitest, matching existing `src/lib/*` test patterns)

- Matching ladder: covers Tier 1, Tier 2 (with various edit-distance cases), Tier 3, and edge cases (missing names, missing state)
- Exclusion filter: campaign-only and campaign+subcampaign cases
- Row hash: stability across runs, change-on-data-change
- Field mapping: every Call Log column lands in expected target
- Activity note formatter: Recording-line and Details-line conditional rendering

### 10.2 Dry-run integration test

Set `GHL_SYNC_DRY_RUN=true`. Run against real Sheets + real Call Logs. Verify:

- Sync Log is populated with intended actions
- Zero GHL API write calls (assertable via outbound HTTP mock or by checking GHL didn't change)
- Watermark advances correctly

### 10.3 Smoke test in GHL test sub-account

Create a "TCC Test" sub-location in GHL. Run sync against it for first week. Verify:

- Contacts appear with correct field values
- Tier 2 cases populate `GHL Possible Merges` correctly
- Multi-call contacts accumulate notes correctly without overwriting earlier ones
- Tags accumulate without duplicates

After smoke verification, switch `GHL_LOCATION_ID` to production location.

## 11. Rollout Plan

1. **Build + unit tests** pass locally and on Vercel
2. **Bootstrap GHL custom fields** in test sub-location via `scripts/ghl-bootstrap-fields.js`
3. **Deploy** with `GHL_SYNC_ENABLED=true` and `GHL_SYNC_DRY_RUN=true` for 24 hours; confirm Sync Log content and matching tier distribution look right
4. **Bootstrap GHL custom fields** in production location
5. **Flip** `GHL_SYNC_DRY_RUN=false`; live for 24 hours on prod; monitor `GHL Possible Merges` and Sync Log error rate
6. **Run backfill** for last 90 days via `/api/ghl-backfill`
7. **V2 (separate work):** Peter configures GHL workflows (welcome SMS, follow-up sequences, retention triggers) using the custom fields and tags this V1 populates

## 12. File Layout

New files:

```
src/
├── app/
│   └── api/
│       ├── cron/
│       │   └── ghl-sync/route.js          # cron entrypoint
│       └── ghl-backfill/route.js           # backfill entrypoint
└── lib/
    ├── ghl-client.js                       # thin GHL API wrapper (auth, retry, rate limit)
    ├── ghl-sync.js                         # core processing logic (filter + match + write)
    ├── ghl-field-mapping.js                # Call Log → GHL field map (§6)
    └── ghl-matcher.js                      # tiered match logic (§4)

scripts/
└── ghl-bootstrap-fields.js                 # one-time custom-field creator

tests/
├── ghl-matcher.test.js
├── ghl-sync.test.js
└── ghl-field-mapping.test.js
```

Modified files:

```
vercel.json                                 # add /api/cron/ghl-sync schedule
.env.local.example                          # document new env vars
CLAUDE.md                                   # add GHL Sync section
```

No changes to `src/components/`, the dashboard, the existing economics pipeline, or any other API route.

## 13. Open Questions / Decisions Deferred to Implementation

- Exact GHL custom field IDs vs. names — depends on what `ghl-bootstrap-fields.js` returns; mapping module reads from a config object generated by the bootstrap script
- Activity note: whether to use GHL "Notes" or "Conversations" surface — TBD during implementation; both are addressable, "Notes" is simpler, "Conversations" gives a nicer UI; default to Notes unless implementation reveals a reason to use Conversations
- Whether the watermark cell lives in the Sync Log tab (e.g., row 1) or a separate `GHL Sync State` mini-tab — cosmetic, decide during implementation

These do not block the design.
