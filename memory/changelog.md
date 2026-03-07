# TCC Dashboard Changelog

## Session: 2026-03-06

### New Features

#### Billable Override (Call Logs)
- **Problem**: Calls flagged billable by duration/buffer logic sometimes fail quality review and shouldn't be charged.
- **Solution**: Added `Billable Override` column to the Call Logs Google Sheet.
  - `N` = force non-billable regardless of duration
  - `Y` = force billable regardless of duration
  - blank = auto-compute (inbound + duration > buffer)
- **Files changed**:
  - `src/lib/sheets.js` — added `writeCell()`, `colIndexToLetter()` helpers; `_rowIndex` on every `fetchSheet` row
  - `src/app/api/dashboard/route.js` — reads `Billable Override` column, computes `isBillable` with override logic
  - `src/app/api/flag-call/route.js` — new POST endpoint, writes override value to sheet
  - `src/components/Dashboard.jsx` — flag button column in DailyActivityTab call drill-down

#### Salary Agent Flag
- **Problem**: Some agents are on salary and owe $0 commission, but the dashboard was calculating commission for everyone.
- **Solution**: `Commission Type` column in Agent Daily Goals tab.
  - Value `"Salary"` → commission = $0 on all policies
  - Value `"Commission"` (default) → normal commission calculation
- **Files changed**:
  - `src/app/api/dashboard/route.js` — fetches agentGoalsRaw, builds `salaryAgents` Set, sets `commission=0` for salaried
  - `src/app/api/goals/route.js` — exposes `commissionType` per agent
  - `src/components/Dashboard.jsx` — SALARY badge in rankings table and drill-down; Commission KPI suppressed for salary agents
  - `src/app/settings/page.js` — Commission Type renders as dropdown (Commission/Salary) via `DROPDOWN_FIELDS`

#### Auto-Sync Agent Goals Tab
- **Problem**: New agents from sales/call log data weren't appearing in Agent Daily Goals tab.
- **Solution**:
  - Fire-and-forget `ensureAgentsExist()` on every dashboard API call (adds new agents only)
  - `/api/sync-agents` POST endpoint for full historical rebuild from both sheets
  - "Sync Agents from History" button in Settings > Agent Daily Goals
- **Sync pipeline** (4 steps):
  1. Delete broken rows (Agent Name = "Commission" from earlier bug)
  2. Delete duplicate rows (non-canonical names that fuzzy-resolve to a canonical — e.g., "Bill Shansky" → deleted because "William Shansky" is canonical)
  3. Add any missing canonical agents with full-width rows + `Commission Type = Commission`
  4. Backfill `Commission Type` for existing rows where it was blank
- **Files changed**:
  - `src/lib/sheets.js` — rewrote `ensureAgentsExist()` with broken-sheet detection; added `AGENT_GOALS_HEADERS` constant
  - `src/app/api/sync-agents/route.js` — new endpoint with full 4-step pipeline
  - `src/app/settings/page.js` — sync button, toast shows added/deleted/backfilled counts

#### Fuzzy Name Matching Improvements (utils.js)
- **Problem**: "Bill Shansky" and "William Shansky" appeared as duplicate rows; "Micheal P" didn't resolve to "Michael Parks".
- **Changes to `fuzzyMatchAgent()`**:
  - Added `levenshtein()` edit-distance function
  - Added edit-distance ≤ 1 first-name matching (handles "Micheal" → "Michael")
  - Added single-word name matching with nickname expansion (handles "Bill" → "William Shansky" when uniquely resolved)
  - Added `kari → karina` to NICKNAMES map (handles "Kari M" → "Karina Maso")
- **File changed**: `src/lib/utils.js`

#### Commission Calculation — Sheet Rates
- **Problem**: `calcCommission()` was imported but never called; all commissions were hardcoded as `premium × 3`.
- **Solution**: `calcCommission()` now called in dashboard route with carrier/product/age from policy row.
  - Falls back to `premium × 3` (or × 1.5 for GIWL) only when no sheet rate matches.
  - `commissionRate` decimal field added to every policy object (e.g., `1.35` = 135%).
- **Files changed**:
  - `src/app/api/dashboard/route.js` — wired up `calcCommission()`, added `commissionRate` to policy object
  - `src/components/Dashboard.jsx` — "Recent Policies — Commission Verification" table in agent drill-down: shows Age, Rate%, Commission$ columns

#### Full Policy Record Fields
- **Problem**: Policy objects only had ~10 fields; firstName/lastName/phone/email/city/zip etc. were missing.
- **Solution**: Extracted all 16 application & policy fields from raw sheet rows.
- **New fields on policy objects**: `firstName`, `lastName`, `gender`, `dob`, `phone` (formatted US), `email`, `address`, `city`, `zip`, `textFriendly`, `policyNumber`, `termLength`, `paymentType`, `paymentFrequency`, `ssnMatch`
- **Files changed**:
  - `src/app/api/dashboard/route.js` — extracts all fields
  - `src/components/Dashboard.jsx` — All Policies table expanded to 22 columns

#### Commissions Tab (new)
- **Purpose**: Day-by-day view of commission obligations for payroll/accounting.
- **Summary view**: KPI cards + Daily Commission Summary table
  - Columns: Date | Policies | Total Premium | Avg Rate | Commission $ | Agents
  - TOTAL row at bottom (blue accent, bold)
- **Drill-down** (click any day): per-policy detail
  - Columns: Agent | First | Last | Carrier | Product | Age | Premium | Rate | Commission $ | Status
  - TOTAL footer row
  - Salaried agents shown as $0 / "Salary" (not hidden)
- **File changed**: `src/components/Dashboard.jsx` — added `CommissionsTab` component, registered in TABS array and render switch

---

## Bug Fixes

### `ensureAgentsExist()` — Broken Sheet State (Critical)
- **Root cause**: When running on an empty tab, `headers = []`, so both `nameCol` and `commTypeIdx` resolved to index 0. Every agent row was written as `['Commission']`, overwriting the name slot.
- **Fix**: Detect missing Agent Name column via `hasAgentNameCol` check; if missing (empty or broken), write full `AGENT_GOALS_HEADERS` to A1 first. Build rows using `new Array(headers.length).fill('')` so every column lands in the correct position.

### Commission Type Dropdown (Settings)
- **Change**: Added `DROPDOWN_FIELDS` constant to settings/page.js. Any column whose header matches a key gets rendered as `<select>` instead of `<input>`. Added `select:focus` to global CSS. Also applies to `Status` column in Publisher Pricing.
