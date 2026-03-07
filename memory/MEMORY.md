# TCC Dashboard Memory

## Project Overview
Next.js 14 app (App Router) for final expense insurance call center BI. Dark theme, single-file Dashboard.jsx (~1300+ lines, monolithic).

## Key Files
- [src/components/Dashboard.jsx](../src/components/Dashboard.jsx) — All UI, tabs, drill-downs
- [src/app/api/dashboard/route.js](../src/app/api/dashboard/route.js) — Main data API
- [src/app/api/goals/route.js](../src/app/api/goals/route.js) — Goals with fallback defaults
- [src/app/api/settings/route.js](../src/app/api/settings/route.js) — CRUD for sheet rows
- [src/app/api/flag-call/route.js](../src/app/api/flag-call/route.js) — POST: write Billable Override to call log sheet
- [src/app/api/sync-agents/route.js](../src/app/api/sync-agents/route.js) — POST: sync Agent Daily Goals tab from history
- [src/app/settings/page.js](../src/app/settings/page.js) — Settings UI with editable tables
- [src/lib/sheets.js](../src/lib/sheets.js) — Google Sheets auth, read/write, cache
- [src/lib/utils.js](../src/lib/utils.js) — Date parsing, fuzzy name matching, commission calc

## Tab Navigation (TABS array, Dashboard.jsx line ~13)
daily | publishers | agents | carriers | pnl | agent-perf | policies-detail | commissions

## Architecture Notes
- Cache TTL: 900s (env CACHE_TTL), in-memory per process
- 4 Google Sheets: SALES, CALLLOGS, COMMISSION, GOALS (with Publisher Pricing, Company Daily Goals, Agent Daily Goals tabs)
- Fuzzy agent name matching between call logs and policy tracker (utils.js `fuzzyMatchAgent`)
- Commission: uses `calcCommission()` from utils.js with carrier/product/age matching against Commission Rates sheet; falls back to GIWL=premium×1.5, others=premium×3
- GAR: premium × 9 months (6 for CICA)

---

## Features Implemented (this session)

### Billable Override
- Added `Billable Override` column to Call Logs sheet (N=force non-billable, Y=force billable, blank=auto)
- `/api/flag-call` POST endpoint writes override to sheet via `writeCell()`
- Dashboard DailyActivityTab: flag button per call row, optimistic UI update
- `isBillable` logic: `overrideRaw === 'N' ? false : overrideRaw === 'Y' ? true : computedBillable`

### Salary/Commission Agent Flag
- `Commission Type` column added to Agent Daily Goals tab (values: "Commission" or "Salary")
- Salaried agents: `commission = 0`, shown with SALARY badge in Agents tab
- Settings page: Commission Type renders as dropdown (not free text)
- `salaryAgents` Set built in dashboard route from Agent Daily Goals tab

### Auto-Sync Agents
- Fire-and-forget `ensureAgentsExist()` call on every dashboard API load (new agents only)
- `/api/sync-agents` POST endpoint for full historical rebuild:
  1. Pulls canonical names from sales sheet + call logs (fuzzy-deduped)
  2. Deletes broken rows (Agent Name = "Commission" from earlier bug)
  3. Deletes duplicate rows (non-canonical names that fuzzy-resolve to a canonical)
  4. Adds missing agents with full-width rows + Commission Type = "Commission"
  5. Backfills Commission Type for any existing blank rows
- Settings page: "Sync Agents from History" button (Agent Daily Goals tab only)
- Toast shows: added N · removed N duplicate(s) · fixed Commission Type for N

### Commission Calculation Fix
- `calcCommission()` now wired up in dashboard route (was imported but unused)
- Falls back to hardcoded multipliers if no sheet rate matched
- `commissionRate` (decimal, e.g. 3.0 = 300%) added to every policy object

### Policy Record Fields
- All application fields now extracted in route.js: firstName, lastName, gender, dob, phone (formatted), email, address, city, zip, textFriendly, policyNumber, termLength, paymentType, paymentFrequency, ssnMatch
- All Policies table: 22 columns including all above fields

### Commissions Tab (new)
- KPI cards: Total Commission, Total Premium, Avg Rate, Commission Agents, Salary Agents
- Daily Commission Summary table with TOTAL row at bottom (using `totalsRow` prop)
- Click a day → drill-down: individual policies with Agent, Carrier, Product, Age, Premium, Rate%, Commission$, Status
- Drill-down also has TOTAL footer row

---

## Known Bugs / Caveats

### Still Present
- **AgentPerformanceTab**: calls `/api/agent-performance` which doesn't exist → tab hangs
- **Clear Cache button**: calls `/api/clear-cache` which doesn't exist → silently fails
- **Column letter bug**: sheets.js updateRow uses `String.fromCharCode(64 + headers.length)` — breaks for >26 columns

### Fixed This Session
- `ensureAgentsExist()` broken sheet state: was writing "Commission" to column A (agent name column) when tab was empty — fixed by detecting missing Agent Name column and writing full standard headers first
- `fuzzyMatchAgent()` didn't handle single-word names (Bill → William Shansky) or typos (Micheal P → Michael Parks) — fixed with edit-distance + nickname expansion
- Commission calculation was hardcoded `premium × 3` everywhere — now uses sheet rates via `calcCommission()`

---

## Fuzzy Name Matching (utils.js)
NICKNAMES map includes: bill→william, will→william, mike→michael, kari→karina, and more.
Single-word names matched only when uniquely resolving (prevents false positives).
Edit distance ≤ 1 handles typos like "Micheal" → "Michael".

## Call Logs Column Name Note
Column header is `Lead Id` (capital I, lowercase d) — use `r['Lead Id']` NOT `r['Lead ID']`.

## Settings Page Dropdowns
`DROPDOWN_FIELDS` constant in settings/page.js maps column names to select options:
- `Commission Type`: ["Commission", "Salary"]
- `Status`: ["Active", "Inactive"]
Add new entries here to make any column a dropdown in the editable table.

## User Preferences
- Prefers proposals before implementation for new UI features
- Prefers detailed technical summaries
- Concise responses preferred
