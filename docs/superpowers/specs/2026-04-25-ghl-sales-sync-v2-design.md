# GHL Sales Sync — V2 Design Spec

**Status:** Draft, captures design decisions from 2026-04-25 conversation
**Author:** Peter Schmitt (with Claude)
**Builds on:** `docs/superpowers/specs/2026-04-25-ghl-call-log-sync-design.md` (V1)
**Branch (V1 implementation):** `feature/ghl-call-log-sync` — pushed to origin, 23 commits, validated against the TCC Sandbox sub-account

---

## 1. Why this exists

V1 (Call Log sync) lands every caller in GHL with their **call** data — who they are, what publisher, attempts, recordings, callable status. But it does not land their **policy** data — carrier, product, premium, commission rate, policy #, placed status. That's the most important context for retention, follow-up, and net-revenue workflows.

A contact in GHL without "they bought a TransAmerica policy for $36/mo and it lapsed" is missing the data the user actually needs to run retention SMS, win-back sequences, and commission visibility.

This V2 spec adds the Sales Tracker as a second data source flowing into the same GHL contacts.

## 2. Why a *separate* sync rather than extending V1

V1's call log sync is *event-driven* — a new call log row triggers processing for that one row. Adding sales data in-line works for the **backfill** scenario (one-shot run over all rows, with all sales data joined by phone), but it has a real gap going forward:

> Day 0: Lead calls (no sales record yet) → V1 creates contact without policy data
> Day 10: Agent submits application → Sales Tracker gets a new row
> Day 10+: V1 cron runs but only sees *new call log rows*. The Day-0 contact never gets revisited. Its GHL state stays out-of-date forever.

The fix is a **second cooperating sync** that watches the Sales Tracker independently, finds matching GHL contacts by phone, and updates them — handling the "sale-after-call" case V1 can't.

The two syncs run side-by-side, each owning its data source, neither knowing about the other's timing. The contact in GHL stays current regardless of which side moves first.

## 3. Records evolve over time — design must handle updates, not just creates

This is the core insight from the planning conversation. A sales record is *not* write-once; multiple fields change post-submission:

```
Day 10 — Application submitted
         Placed? = "Submitted - Pending"
         Premium = $63.37
         Policy # = (empty)
Day 14 — Carrier issues advance
         Placed? = "2/14 - advance released"
Day 18 — Policy goes active
         Placed? = "Active - In Force"
         Policy # = M3171599 (newly assigned)
Day 60 — Customer lapses
         Placed? = "Lapsed"
         Premium = (carrier-corrected, possibly different)
```

Plus carrier-corrected fields when `SALES_TAB_NAME=Merged`:
- `Carrier Status` (Active → Lapsed → Reinstated…)
- `Carrier Policy #` (assigned post-submission)
- Carrier-corrected `Monthly Premium` (when carrier reconciles agent-submitted data)
- `Last Sync Date` (when carrier last touched the record)

The user explicitly confirmed: *"status will change. there may be a few more."* — meaning we should expect arbitrary additional fields to change over time.

## 4. Design that handles "any field can change"

### 4.1 Always overwrite custom fields, every cron tick

Each cron run iterates all sales records (262 today, small dataset) and writes the *current* values to GHL custom fields. If the data hasn't changed, the GHL update is a no-op write (cheap). If something changed, GHL reflects it within ~10 minutes.

This way we never have to enumerate which fields can change — the data update path is universal. New fields added to Sales Tracker later just need a one-line addition to the field map.

### 4.2 Generate transition *notes* only for high-signal changes

Notes are permanent timeline entries — generating one for every field change would be noisy. The default note-trigger set is:

| Field change detected | Note format |
|---|---|
| `Placed?` changes | `📋 Status: Submitted - Pending → Active - In Force` |
| `Monthly Premium` changes | `💵 Premium: $63.37 → $51.39 (carrier correction)` |
| `Policy #` newly assigned (was empty, now set) | `🆔 Policy # assigned: M3171599` |
| `Effective Date` changes | `📅 Effective date: 02-18-2026 → 02-25-2026` |

Other field changes (Sales Notes, Beneficiary, Draft Day, Face Amount, Term Length…) update the custom fields silently. The full audit trail already lives in the existing `Change History` tab on the Sales sheet — we don't need to duplicate it in GHL.

### 4.3 Change detection — read GHL contact before update

To know whether a field changed, the sync compares the incoming Sales Tracker values to whatever's currently on the GHL contact. Per cron tick:

1. Read all 262 sales records from `SALES_TAB_NAME` tab
2. For each record:
   - Find matching GHL contact by phone (using the same `normalizePhone` helper from V1 client)
   - If no match: contact doesn't exist yet — log to "Sales without GHL contact" review tab and skip (the user can manually create or wait for the lead to call)
   - If match: read GHL contact (custom fields current state)
   - Build the patch: 25+ policy custom fields with current Sales Tracker values
   - Update GHL contact with patch (PUT — overwrites)
   - Diff specific high-signal fields against pre-update GHL values; emit notes for transitions
3. Log outcome to `GHL Sales Sync Log` tab (audit trail mirroring V1's pattern)

Reading-then-writing is two API calls per record per tick. With 262 records, that's well under GHL rate limits.

## 5. Source-of-truth decision: switch `SALES_TAB_NAME` to `Merged`

`SALES_TAB_NAME` currently points to `Sheet1` — agent-submitted data, not carrier-corrected. The dashboard's economics already read from this env var, so the same value drives both Dashboard and the new Sales sync.

**Decision: switch to `SALES_TAB_NAME=Merged`** so:
- Dashboard P&L reflects carrier-corrected premium/status
- Sales sync pushes carrier-corrected data into GHL
- Single source of truth across the stack

`Sheet1` remains preserved as the historical agent-submitted record (per existing CLAUDE.md design).

## 6. Field mapping — Sales Tracker columns to GHL custom fields

Maximum-coverage approach (matches V1's "ship everything, prune later" instinct):

| GHL Custom Field | Sales Tracker Column |
|---|---|
| `Policy #` | `Policy #` |
| `Carrier Policy #` | `Carrier Policy #` *(Merged tab only)* |
| `Carrier + Product + Payout` | `Carrier + Product + Payout` |
| `Monthly Premium` | `Monthly Premium` |
| `Original Premium` | `Original Premium` *(Merged tab only)* |
| `Face Amount` | `Face Amount` |
| `Term Length` | `Term Length` |
| `Placed Status` | `Placed?` |
| `Original Placed Status` | `Original Placed Status` *(Merged tab only)* |
| `Carrier Status` | `Carrier Status` *(Merged tab only)* |
| `Carrier Status Date` | `Carrier Status Date` *(Merged tab only)* |
| `Application Submitted Date` | `Application Submitted Date` |
| `Effective Date` | `Effective Date` |
| `Last Sync Date` | `Last Sync Date` *(Merged tab only)* |
| `Sales Lead Source` | `Lead Source` |
| `Sales Agent` | `Agent` |
| `Outcome at Application` | `Outcome at Application Submission` |
| `Sales Notes` | `Sales Notes` |
| `Sync Notes` | `Sync Notes` *(Merged tab only)* |
| `Payment Type` | `Payment Type` |
| `Payment Frequency` | `Payment Frequency` |
| `Draft Day` | `Draft Day` |
| `SSN Billing Match` | `Social Security Billing Match` |
| `Date of Birth` | `Date of Birth` |
| `Gender` | `Gender` |
| `Beneficiary First Name` | `Beneficiary - First Name` |
| `Beneficiary Last Name` | `Beneficiary - Last Name` |
| `Beneficiary Relationship` | `Relationship to Insured` |

~28 new custom fields (some `Merged`-only). Bootstrap script needs updating to create them in GHL.

Native GHL fields also enriched on Sales sync (when no V1 match yet existed):
- `firstName`, `lastName` from Sales Tracker if more complete than what's on the GHL contact
- `email`, `address1`, `city`, `state`, `postalCode` (since Sales Tracker has full address while Call Logs have only state)

## 7. Phone-match coverage

From the analysis run on 2026-04-25:
- 262 sales records total
- 243 (93%) have a phone that matches a call log row → those auto-link to existing GHL contacts via phone
- 7 don't match (likely referrals or transfers — phones the dialer never logged) → they'd need either:
  - **A new GHL contact created from the sales record** (Sales sync acts as fallback creator), or
  - **Logged to a "Sales without GHL contact" review tab** for manual handling

Decision: **create new contacts** for unmatched sales records. Same pattern as V1 — no manual gates. Use sales record as the contact identity source (firstName, lastName, phone, address).

## 8. Implementation phases

The user wants the full historical load *with* policy data baked in. Sequence:

1. **Phase A — Batch-write optimization** (~20 min)
   - Refactor `appendSyncLog` and `appendPossibleMerge` to batch within `processBatch`
   - Single `batchUpdate` write per cron run instead of per-row
   - Removes the Sheets quota ceiling that limited V1 to ~134 rows/run
2. **Phase B — Add Sales Tracker enrichment to V1 call log sync** (~25 min)
   - Read sales records once at start of batch into `phoneToSales` map
   - For each call log row processed, after determining tier and creating/attaching contact, also patch in policy custom fields if `phoneToSales` has the phone
   - Handles backfill (covers all historical) and forward "call-after-sale" scenario
3. **Phase C — Build standalone Sales Tracker sync** (~30 min)
   - New `src/lib/ghl/sales-sync.js` mirroring V1's `sync.js` pattern
   - New `/api/cron/ghl-sales-sync` route
   - Reads all sales records, finds GHL contacts by phone, applies patches + transition notes
   - Handles ongoing "sale-after-call" scenario
4. **Phase D — Switch `SALES_TAB_NAME` to `Merged`** (~5 min)
   - Update `.env.local` and Vercel env vars
   - Verify dashboard still works (existing economics read from this var)
5. **Phase E — Bootstrap new custom fields** (~5 min)
   - Extend `field-mapping.js` with the policy fields
   - Run `scripts/ghl-bootstrap-fields.js` again — idempotent, creates only the new ones
6. **Phase F — Run full historical backfill** (~30 min with batch-writes)
   - All 6,652 call log rows + 262 sales records → every GHL contact lands with the full picture (call data + policy data, where applicable)
   - Sandbox now reflects what production should look like
7. **Phase G — User verification + production rollout** (manual, separate session)

Total autonomous build time: ~90 min for the new code, plus ~30 min for the backfill run.

## 9. Open / deferred items

- **V3 — GHL workflows** (welcome SMS, retention sequences, win-back) — Peter configures inside GHL UI using the populated custom fields
- **Audit trail mirror** — option to also mirror existing `Change History` Sales-sheet rows into GHL notes; deferred until we know it's needed
- **Reconciliation report** — periodic check that GHL state matches Sales Tracker truth; deferred until we see drift in practice
- **Sales record updates that delete a contact's previous data** (e.g., a sale gets retracted) — current design overwrites with current values; if a sale is removed from Sales Tracker entirely, GHL custom fields stay populated with stale data. Solution: track "last seen" set of sales record keys; when a record disappears, clear its GHL fields. Deferred — rare in practice.

## 10. Constraints and known limits

- **Google Sheets API write quota** (60/min/user) — Phase A's batch-write fix is required before any large-scale operation; without it, we cap at ~50 rows/min
- **GHL native phone-dedup** — V1 already handles this via `_dedupedExisting` recovery path; Sales sync inherits the same client and benefits from the same fix
- **Phone normalization** — V1's `normalizePhone` strips leading `1` for 11-digit US numbers; Sales sync uses the same helper, so phone-join is consistent across both syncs
