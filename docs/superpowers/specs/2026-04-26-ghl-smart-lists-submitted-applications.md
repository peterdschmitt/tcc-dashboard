# GHL Smart Lists — Submitted Applications

**Date:** 2026-04-26
**Audience:** Operator clicking through the GHL UI to build these
**GHL Sandbox:** `BXMHAsqFnhseDHUumJBE`
**Production:** TBD (apply same designs after switching `GHL_LOCATION_ID`)

---

## Why this exists

After syncing call log + sales/policy data into GHL, we need pre-built smart lists that surface the right contacts for each daily workflow:

- Who's awaiting carrier decision and needs a chase call?
- Who lapsed recently and is ripe for win-back?
- Who's in the active book of business?
- Which declined applications can be re-pivoted to another carrier?
- Who are the high-value VIPs?

GHL's smart lists are filter-based saved queries. Each filter combines custom fields, tags, and dates to narrow the contact universe. This doc gives the exact recipes.

## The canonical "submitted application" filter

```
Application Submitted Date  is not empty
```

**Coverage:** 100% of Sales Tracker rows have this populated (verified live: 262/262). All other "is the app submitted" indicators (`Policy #`, `Carrier + Product + Payout`, `Monthly Premium`) also have 100% coverage today, but `Application Submitted Date` is the most semantically clear and most durable as the process evolves.

This filter goes into every smart list below.

---

## 1. Master: All Submitted Applications

The base universe. Every other list below is a sub-segment.

**Filters:**

```
Application Submitted Date  is not empty
```

**Display columns** (order matters in GHL):

- Name (default)
- Phone (default)
- `Application Submitted Date`
- `Carrier + Product + Payout`
- `Monthly Premium`
- `Placed Status`
- `Sales Agent`
- `Policy #`

**Sort:** `Application Submitted Date` descending (newest first)

**Use:** the morning glance — what was submitted yesterday, what's in the pipeline overall.

---

## 2. Pending Applications

Apps submitted but not yet active. These are stuck in carrier review or pending agent work to push them through.

**Filters (Match All for the first; Match Any for the status block):**

```
Application Submitted Date  is not empty
─────────────────────────────────────
[Match Any block:]
Placed Status               contains   pending
Placed Status               contains   submitted
Placed Status               contains   awaiting
```

**Display columns:**

- Name
- Phone
- `Application Submitted Date`
- `Carrier + Product + Payout`
- `Monthly Premium`
- `Placed Status`
- `Sales Agent`

**Sort:** `Application Submitted Date` ascending (oldest pending = highest priority)

**Daily action:** scan top of list. Anything pending more than 7 days → assign chase call.

---

## 3. Active Policies

Your book of business. Anyone currently paying premium.

**Filters:**

```
Application Submitted Date  is not empty
─────────────────────────────────────
[Match Any block:]
Placed Status               contains   active
Placed Status               contains   in force
Placed Status               contains   advance released
```

**Display columns:**

- Name
- Phone
- `Effective Date`
- `Carrier + Product + Payout`
- `Monthly Premium`
- `Sales Agent`
- `Sales Lead Source`

**Sort:** `Monthly Premium` descending (highest-value first)

**Use:** retention universe. Source for VIP segmentation, anniversary touchpoints, referral asks.

---

## 4. Recently Lapsed / Canceled — Win-Back Targets ⭐

Highest-leverage list for retention work. Recently lapsed contacts are statistically more likely to reactivate than long-cold ones.

**Filters:**

```
Application Submitted Date  is not empty
─────────────────────────────────────
[Match Any block:]
Placed Status               contains   lapsed
Placed Status               contains   canceled
Placed Status               contains   cancelled
Placed Status               contains   terminated
Placed Status               contains   not taken
─────────────────────────────────────
Carrier Status Date         in last 60 days
   (only add this filter if Merged tab is fully populated;
    omit otherwise — Carrier Status Date is partial today)
```

**Display columns:**

- Name
- Phone
- `Effective Date`
- `Carrier + Product + Payout`
- `Monthly Premium`
- `Placed Status`
- `Carrier Status Date`
- `Sales Agent`

**Sort:** `Carrier Status Date` descending (most recent lapse first)

**Use:** target with retention SMS or callback within 30 days of lapse.

---

## 5. Declined Applications — Re-Pivot Opportunities

Contacts declined by one carrier — many can be successfully re-pivoted to a different carrier (e.g., American Amicable decline → CICA GIWL).

**Filters:**

```
Application Submitted Date  is not empty
Placed Status               contains   declined
```

**Display columns:**

- Name
- Phone
- `Application Submitted Date`
- `Carrier + Product + Payout`
- `Outcome at Application`
- `Sales Notes`
- `Sales Agent`

**Sort:** `Application Submitted Date` descending

**Use:** weekly review — your agents already do this manually; this list makes it systematic.

---

## 6. High-Value Active — VIP Treatment

Customers worth extra retention investment.

**Filters:**

```
Application Submitted Date  is not empty
─────────────────────────────────────
[Match Any block:]
Placed Status               contains   active
Placed Status               contains   in force
Placed Status               contains   advance released
─────────────────────────────────────
Monthly Premium             greater than   100
```

**Display columns:**

- Name
- Phone
- `Monthly Premium`
- `Effective Date`
- `Carrier + Product + Payout`
- `Sales Agent`

**Sort:** `Monthly Premium` descending

**Use:** proactive check-ins, anniversary touches, referral asks. Your highest-leverage retention segment.

---

## How to build each one in GHL UI

Steps are the same for every list:

1. **Contacts → Smart Lists** (sidebar)
2. Click **+ New Smart List** (top right)
3. Click **+ Add Filter**:
   - Search the field name
   - Select operator (`is not empty`, `contains`, `greater than`, etc.)
   - Enter value where applicable
4. Repeat for each filter row above
5. For **Match Any** blocks, click **+ Add Group** (or similar — GHL UI varies by version) and set the group operator to `Match Any`
6. Click **Add/Hide Columns** → check the recommended columns
7. Click a column header to set the default sort, or use the Sort dropdown
8. **Save Smart List** with the exact name from above (so this doc cross-references cleanly)
9. Pin to sidebar if used daily

---

## Field reference — every field this doc relies on

All exist in the GHL sandbox (created by `scripts/ghl-bootstrap-fields.js` on `feature/ghl-call-log-sync` branch):

| Smart-list field name | Source column in Sales Tracker / Call Logs | Type |
|---|---|---|
| `Application Submitted Date` | `Application Submitted Date` | TEXT (formatted as MM-DD-YYYY) |
| `Policy #` | `Policy #` | TEXT |
| `Placed Status` | `Placed?` | TEXT (freeform — agents write notes here) |
| `Carrier + Product + Payout` | `Carrier + Product + Payout` | TEXT |
| `Monthly Premium` | `Monthly Premium` | TEXT (numeric — use `greater than` etc.) |
| `Effective Date` | `Effective Date` | TEXT |
| `Sales Agent` | `Agent` | TEXT |
| `Sales Lead Source` | `Lead Source` | TEXT |
| `Sales Notes` | `Sales Notes` | TEXT |
| `Outcome at Application` | `Outcome at Application Submission` | TEXT |
| `Carrier Status` | `Carrier Status` (Merged tab only) | TEXT |
| `Carrier Status Date` | `Carrier Status Date` (Merged tab only) | DATE |

Note: `Monthly Premium` was created as a TEXT custom field. GHL's `greater than` operator should still work on numeric strings, but if the comparison misbehaves, try recreating the field as a Numeric type (rare — usually fine).

---

## Caveats

1. **Partial backfill:** the call log + sales backfill is paused at ~34% (~1,900 of 6,652 call rows synced; sales sync hasn't completed). These smart lists work correctly today against the contacts that DID sync. Once the GHL rate-limit cooldown clears and we resume the backfill, the lists auto-populate.

2. **`Placed Status` is messy text:** agents write things like `"2/6- advance released"` or `"1/29- agent unable to reconnect for pivot sale"`. The `contains` operator handles this — `contains "advance released"` matches the first example. If we ever want clean filtering, we'd switch to `Carrier Status` (clean values: `Active`, `Pending`, `Canceled`, etc.) once the Merged tab is fully populated for all 262 records.

3. **GHL is weak at grouping:** smart lists filter well but can't pivot/group. For "submitted apps grouped by Sales Agent," you'd save one list per agent. This is exactly the gap the planned Portfolio UI in the DB foundation project is designed to fix.

---

## Maintenance

Each smart list is a saved query in GHL — no code, no deploys. To add or modify:

- Tweak filters in the GHL UI directly. Changes take effect immediately.
- Update this doc when you make changes that should outlive a rebuild.
- If GHL's UI changes operators or labels in a future release, this doc may need updating. The Filter recipes are stable; the menu paths in step 1–9 above may drift.

## Future smart lists to consider (V2)

- **By Sales Agent** — one smart list per active agent (manual, but scales to 5–10 agents)
- **By Carrier** — segment active book by carrier for carrier-specific campaigns
- **Time cohorts** — submitted this week / month / quarter for forecasting and trends
- **Aging buckets** — pending > 30 days, > 60 days, > 90 days
- **Cross-sell candidates** — active customers without a particular product type (e.g., "active with no term policy")
