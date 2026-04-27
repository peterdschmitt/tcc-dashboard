# TCC Dashboard — Project Documentation

## Overview

The **True Choice Coverage (TCC) Dashboard** is a Next.js web application that provides real-time business intelligence for a final expense insurance call center. It pulls data from multiple Google Sheets (sales tracker, call logs, commission rates, publisher pricing, and goals) and renders an interactive dark-themed analytics dashboard.

**Stack:** Next.js 14 (App Router), React, Google Sheets API, Recharts (trends page)  
**Runtime:** Node.js, localhost:3000  
**Design:** Dark theme (#080b10 background), monospace data, color-coded metrics  

---

## Project Structure

```
tcc-dashboard/
├── src/
│   ├── app/
│   │   ├── page.js                    # Main entry — fetches data, renders Dashboard
│   │   ├── trends/page.js             # Trends page — Recharts time-series charts
│   │   ├── settings/page.js           # Settings page — edit sheets data in-browser
│   │   └── api/
│   │       ├── dashboard/route.js         # Main API — joins sales + calls + commissions + pricing
│   │       ├── goals/route.js             # Goals API — company & agent daily targets
│   │       ├── settings/route.js          # Settings API — CRUD for sheet rows
│   │       ├── agent-performance/route.js # Agent Performance API — reads AGENT_PERF_SHEET_ID
│   │       └── clear-cache/route.js       # Cache invalidation endpoint
│   ├── components/
│   │   └── Dashboard.jsx              # All dashboard UI (~1150 lines, single-file component)
│   └── lib/
│       ├── sheets.js                  # Google Sheets auth, read, write, cache
│       └── utils.js                   # Date parsing, agent matching, commission calc
├── .env.local                         # Environment variables (see below)
├── package.json
└── claude.md                          # This file
```

---

## Environment Variables (.env.local)

```bash
# Google Service Account (JSON key or individual fields)
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}
# OR:
GOOGLE_CLIENT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."

# Sheet IDs
SALES_SHEET_ID=<Google Sheet ID for policy/sales tracker>
CALLLOGS_SHEET_ID=<Google Sheet ID for call logs>
COMMISSION_SHEET_ID=<Google Sheet ID for commission rate table>
GOALS_SHEET_ID=<Google Sheet ID for goals + pricing>
AGENT_PERF_SHEET_ID=<Google Sheet ID for agent performance dialer report>

# Tab Names (optional — defaults shown)
SALES_TAB_NAME=Sheet1
CALLLOGS_TAB_NAME=Report
COMMISSION_TAB_NAME=Sheet1
GOALS_PRICING_TAB=Publisher Pricing
GOALS_COMPANY_TAB=Company Daily Goals
GOALS_AGENT_TAB=Agent Daily Goals
GOALS_CARRIER_TAB=Carrier Daily Goals
GOALS_PUBLISHER_TAB=Publisher Daily Goals
AGENT_PERF_TAB_NAME=Report
```

---

## Google Sheets Structure

### Sales/Policy Tracker (`SALES_SHEET_ID`)
Columns: Agent, Lead Source, Application Submitted Date, Payment Type, Payment Frequency, Social Security Billing Match, First Name, Last Name, Gender, Date of Birth, Phone Number, Email Address, Street Address, City, State, Zip Code, Text Friendly, Policy #, Effective Date, Carrier + Product + Payout, Face Amount, Term Length, Monthly Premium, Outcome at Application Submission, Placed?, Sales Notes, Submission ID

### Call Logs (`CALLLOGS_SHEET_ID`)
Columns: Date, Rep, Campaign, Subcampaign, Phone, State, Country, Attempt, Caller ID, Inbound Source, Lead Id, Client ID, Last, First, Import Date, Call Status, Is Callable, Duration, Call Type, Details, Hangup, HoldTime, Hangup Source, Recording

**Note:** The column header is `Lead Id` (capital I, lowercase d) — use `r['Lead Id']` when referencing in code.

### Commission Rates (`COMMISSION_SHEET_ID`)
Columns: Carrier, Product, Age Range, Commission Rate

### Goals Sheet (`GOALS_SHEET_ID`) — Multiple Tabs

**Publisher Pricing tab:**
Columns: Campaign Code, Vendor, Price per Billable Call ($), Buffer (seconds), Category, Status

**Company Daily Goals tab:**
| Metric | Value |
|--------|-------|
| Apps Submitted | 5 |
| Policies Placed | 3 |
| Total Calls | 50 |
| Billable Calls | 35 |
| Billable Rate | 65 |
| Monthly Premium | 500 |
| Gross Adv Revenue | 4000 |
| Lead Spend | 1500 |
| Agent Commission | 1000 |
| Net Revenue | 2000 |
| CPA | 250 |
| RPC | 35 |
| Close Rate | 5 |
| Placement Rate | 80 |
| Premium:Cost | 2.5 |
| Avg Premium | 70 |

**Agent Daily Goals tab:**
Columns: Agent Name, Premium/Day ($), Apps/Day, Placed/Day, Placement Rate (%), CPA Target ($), Conversion Rate (%), Notes

---

## API Routes

### GET /api/dashboard?start=YYYY-MM-DD&end=YYYY-MM-DD

Returns `{ policies, calls, pnl, meta }`.

**Processing pipeline:**
1. Fetches 4 sheets in parallel (sales, calls, commissions, pricing)
2. Parses policies: extracts carrier/product from "Carrier + Product + Payout" field (comma-separated), calculates commission (premium × 3, or × 1.5 for GIWL products), calculates gross advanced revenue (premium × 9 months, or × 6 for CICA)
3. Parses calls: matches campaign codes to pricing, determines billable status (duration > buffer threshold), calculates cost per billable call
4. Fuzzy-matches agent names between call logs and policy tracker (handles nicknames like Bill→William)
5. Builds P&L by publisher: aggregates calls, spend, sales, premium, commissions, calculates derived metrics (CPA, RPC, close rate, billable rate, net revenue)
6. Filters by date range
7. Returns combined data

**Key business rules:**
- `isPlaced`: status in ['Advance Released', 'Active - In Force', 'Submitted - Pending']
- `isBillable`: call duration (seconds) > publisher's buffer threshold
- `cost`: billable ? pricePerCall : 0
- `commission`: GIWL products = premium × 1.5; all others = premium × 3
- `grossAdvancedRevenue`: premium × advanceMonths (9 for most, 6 for CICA)
- `netRevenue`: grossAdvancedRevenue - leadSpend - totalCommission

### GET /api/goals

Returns `{ company: {}, agents: {} }`.

**Company goals:** Reads "Company Daily Goals" tab, normalizes metric names to snake_case, applies alias mapping for flexible naming, fills in fallback defaults for any missing metrics.

**Agent goals:** Reads "Agent Daily Goals" tab, returns per-agent targets for apps/day, premium/day, close rate.

**Goal key normalization:** The API handles any format from the sheet — "Conversion Rate", "conversion_rate", "conversionRate", "Close Rate" all map to `close_rate`. Strips `$`, `%`, `x` from values.

**Fallback defaults** (used when sheet rows are missing):
```
cpa: 250, rpc: 35, close_rate: 5, placement_rate: 80, billable_rate: 65,
avg_premium: 70, apps_submitted: 5, policies_placed: 3, total_calls: 50,
billable_calls: 35, monthly_premium: 500, gross_adv_revenue: 4000,
lead_spend: 1500, agent_commission: 1000, net_revenue: 2000, premium_cost_ratio: 2.5
```

### GET/POST/PUT/DELETE /api/settings?section=<section>

CRUD operations for sheet data (pricing, companyGoals, agentGoals, commission). Used by the Settings page for in-browser editing.

---

## Dashboard UI (Dashboard.jsx)

Single-file React component (~760 lines) with inline styles. No CSS files or Tailwind.

### Color System
```js
const C = {
  bg: '#080b10',        // Page background
  surface: '#0f1520',   // Header/nav background
  card: '#131b28',      // Card backgrounds
  border: '#1a2538',    // Borders
  text: '#f0f3f9',      // Primary text
  muted: '#8fa3be',     // Secondary text
  accent: '#5b9fff',    // Blue accent (tabs, totals)
  green: '#4ade80',     // Positive values, goals met
  greenDim: '#0a2e1a',  // Green tile background
  yellow: '#facc15',    // Warning, 80-99% of goal
  yellowDim: '#2e2a0a', // Yellow tile background
  red: '#f87171',       // Negative values, <80% of goal
  redDim: '#2e0a0a',    // Red tile background
};
```

### Tab Structure

**Daily Activity** — GoalComparison (16 tiles) → Daily Breakdown table (click row → call-level drill-down with KPI cards + call detail table + policy table)

**Daily drill-down call table columns:** Campaign, Agent, Status, Call Type, Duration, Buffer, Billable?, Cost, $/Call, State, Phone, Lead ID

**Publishers** — GoalComparison (16 tiles) → Publisher Performance table with totals row (click row → publisher drill-down with KPI cards + agent breakdown + carrier breakdown)

**Agents** — GoalComparison (16 tiles) → Agent Rankings table with totals row and premium goal progress bars (click row → agent drill-down with KPI cards + by carrier + by lead source + recent policies)

**Carriers** — GoalComparison (16 tiles) → Carrier/Product Overview table with totals row (click row → carrier drill-down with KPI cards + by agent + policies list)

**P&L Report** — Publisher P&L Detail table (NO GoalComparison tiles — removed intentionally to avoid redundancy with the P&L grid that existed previously)

### GoalComparison Component

16 metrics in 3 rows with color-coded backgrounds and progress bars:

**Row 1 — Volume (5 tiles):**
Apps Submitted, Policies Placed, Total Calls, Billable Calls, Billable Rate

**Row 2 — Revenue & Spend (5 tiles):**
Monthly Premium, Gross Adv Revenue, Lead Spend (↓), Agent Commission, Net Revenue

**Row 3 — Efficiency (6 tiles):**
CPA (↓), RPC (↓), Close Rate, Placement Rate, Premium:Cost, Avg Premium

**Color logic:**
- ≥100% of goal → green (#4ade80 text, #0a2e1a background)
- 80-99% of goal → yellow (#facc15 text, #2e2a0a background)
- <80% of goal → red (#f87171 text, #2e0a0a background)
- "Lower is better" (↓) metrics: ratio is inverted (goal/actual instead of actual/goal)

**Visual specs:**
- Tile padding: 8px 12px (compact)
- Value font: 16px, weight 800, with textShadow glow
- Label font: 8px, color #c4d5e8, uppercase
- Goal text: 9px, color #b0c4de
- Progress bar: 4px height, 140px width
- Row gap: 8px, tile gap: 8px

### Shared Components

- `KPICard` — Top-border colored card with label, large value, optional goal/subtitle
- `ProgressBar` — Thin horizontal bar showing % to goal
- `SortableTable` — Click column headers to sort, supports totals row, row click handlers
- `Section` — Card container with uppercase title header
- `Breadcrumb` — Navigation trail for drill-down views

### Date Range Presets

Yesterday, Today, 7D, 30D, MTD, All, Custom (date pickers)

The `All` preset uses 2020-01-01 to 2030-12-31. Date range changes trigger a full data reload.

---

## Trends Page (/trends)

Recharts-based time-series visualizations with the same dark theme. Uses `LineChart`, `BarChart`, `AreaChart`, `ComposedChart` from recharts. Fetches the same `/api/dashboard` endpoint with `All` date range and aggregates data by day for charting.

---

## Settings Page (/settings)

In-browser CRUD editor for the 4 sheet sections (Publisher Pricing, Company Goals, Agent Goals, Commission Rates). Edits write directly back to Google Sheets via the Settings API.

---

## Key Business Concepts

**Billable Call:** A call whose duration exceeds the publisher's buffer threshold. Only billable calls generate lead spend charges.

**CPA (Cost Per Acquisition):** Total lead spend ÷ number of policies placed. Lower is better.

**RPC (Revenue Per Call):** Total lead spend ÷ total calls. Lower is better.

**Close Rate:** Policies placed ÷ billable calls × 100.

**Placement Rate:** Policies placed ÷ apps submitted × 100.

**Premium:Cost Ratio:** Total monthly premium ÷ total lead spend. Higher is better.

**Gross Advanced Revenue (GAR):** Monthly premium × advance months (9 standard, 6 for CICA). Represents the upfront revenue from the carrier.

**Net Revenue:** GAR - Lead Spend - Agent Commission.

**Commission:** Monthly premium × 3 (standard) or × 1.5 (GIWL products).

---

## Current Carriers

- American Amicable (Senior Choice Final Expense — Immediate, Graded, Easy Term)
- American Amicable - Occidental Life (same products)
- TransAmerica (FE Express, FE Express Graded)
- AIG Corebridge (SIWL Legacy Max, SIWL Legacy, GIWL)
- Baltimore Life (iProvide FE)
- CICA (FE Standard, FE GI)

---

## Current Publishers

BCL ($45/call, 120s buffer), HIW ($45, 60s), TV FEX ($72, 45s), TV TERM ($53, 15s), SDLT ($40, 120s), SDIB ($40, 90s), CEM ($40, 90s), INU ($35, 90s), SUM ($40, 120s), CTV ($55, 10s), CEM 90 ($45, 15s), plus several zero-cost sources (LIFE, Referral, Health1-3).

---

## Development Commands

```bash
# Start dev server
cd ~/Downloads/tcc-dashboard && npm run dev

# Clean restart (clears Next.js cache)
cd ~/Downloads/tcc-dashboard && rm -rf .next && npm run dev

# Verify goal tiles are present
grep "GoalComparison" src/components/Dashboard.jsx

# Check goals API output
curl http://localhost:3000/api/goals | python3 -m json.tool

# Check dashboard API output
curl "http://localhost:3000/api/dashboard?start=2026-02-01&end=2026-02-28" | python3 -m json.tool | head -50
```

---

## File Update Procedure

When Claude provides updated files, the reliable method is a bash installer script using base64 encoding:

```bash
bash ~/Downloads/install-tiles.sh
cd ~/Downloads/tcc-dashboard && rm -rf .next && npm run dev
```

Direct file downloads from Claude's interface may not overwrite existing files (macOS saves them as `Dashboard (1).jsx` etc). The base64 installer script writes files directly and bypasses this issue.

---

## Recent Changes (Feb 2026)

1. **16 Goal Tiles** — Expanded from 6 to 16 metrics across 3 rows (Volume, Revenue & Spend, Efficiency). Applied to Daily, Publishers, Agents, Carriers tabs. NOT on P&L.
2. **Brightened Colors** — Green #4ade80, Yellow #facc15, Red #f87171. Brighter labels (#c4d5e8) and goal text (#b0c4de). Font weight 800 with text glow.
3. **Compact Tiles** — Reduced padding (8px/12px), smaller fonts (16px values, 8px labels), thinner progress bars (4px).
4. **Goals API Resilience** — Alias mapping for flexible sheet naming, fallback defaults for all 16 metrics, strips symbols from values.
5. **Daily Drill-Down** — Click any day row → see all calls for that day with billable/non-billable breakdown, KPI cards, and policy submissions.
6. **Publisher/Agent/Carrier Drill-Downs** — Click any row → detailed sub-view with breakdowns by agent, carrier, lead source.
7. **Commission Calculation Fix** — GIWL products use 1.5× multiplier instead of 3×.
8. **Removed P&L Duplicate Tiles** — P&L tab shows only the Publisher P&L Detail table (old P&L Summary grid was removed as redundant with GoalComparison).
9. **Removed Daily KPI Card Row** — Old row of 7 KPICards on Daily tab was removed as redundant with the 16 GoalComparison tiles above.

## Recent Changes (Mar 2026)

1. **Lead ID in Daily Drill-Down** — `Lead Id` field from call logs is now mapped in the call object and shown as a column in the daily drill-down calls table.
2. **Removed Caller and Client ID columns** — Daily drill-down calls table now shows: Campaign, Agent, Status, Call Type, Duration, Buffer, Billable?, Cost, $/Call, State, Phone, Lead ID.
3. **Agent Performance tab** — Reads from `AGENT_PERF_SHEET_ID` (dialer report sheet). Must be set in Vercel environment variables for the tab to work in production.
4. **CRM System** — Lead CRM, Retention Dashboard, Business Health tabs with carrier sync integration.
5. **Carrier Reconciliation API** — `/api/crm/compare` compares DetailedProduction carrier report against Application tracker, shows record-level differences and economic impact.
6. **Merged Economics Tab** — Carrier-corrected economics system. The dashboard reads from a `Merged` tab (set via `SALES_TAB_NAME=Merged`) that mirrors Sheet1 but with carrier-corrected premium and status values. Original Sheet1 is preserved as historical record.

## Recent Changes (Apr 2026)

1. **Historical Baselines System** — Daily snapshots of company, per-agent, and per-campaign metrics are written to three tabs in the Goals sheet (`Daily Snapshots Company`, `Daily Snapshots Agents`, `Daily Snapshots Campaigns`) every time `/api/daily-summary` runs in daily mode for a single date. A pure library `src/lib/baselines.js` computes `prev`, `avg7`, `avg30`, `stdev30`, `z`, `trend7`, `bestInN`, `worstInN`, `deltaPct`, and `window` per metric from those snapshots. The daily briefing reads the snapshots, builds a `BASELINES:` block covering company + top 5 agents (by today's premium) + top 8 campaigns (by today's spend), and injects it into the GPT-4o context so narratives can cite 30-day deltas and z-score anomalies.
2. **Dual-Signal Alerts** — `computeAlerts` in `src/app/api/daily-summary/route.js` now returns two alert kinds. `goal-miss` alerts (unchanged logic, tagged with `kind: 'goal-miss'`) fire when a metric ratio vs the company goal falls below the yellow/red threshold. `historical-anomaly` alerts (new, tagged with `kind: 'historical-anomaly'`) fire when the metric's z-score vs its own 30-day baseline exceeds ±1.5 (yellow) or ±2.5 (red), or when the day is the worst in 14. Lower-is-better metrics (CPA, RPC) invert the z direction.
3. **Snapshot Endpoints** — `/api/snapshots/init` creates the three tabs with headers if missing. `/api/snapshots/write?date=YYYY-MM-DD` writes one day's snapshot by calling daily-summary internally and projecting the result into the row builders (idempotent: delete matching date rows, then append fresh). `/api/cron/backfill-snapshots?start=YYYY-MM-DD&end=YYYY-MM-DD` iterates a date range calling the single-day write endpoint. Both write endpoints are gated behind `CRON_SECRET` (only enforced when the env var is set, so local dev is frictionless).
4. **Delta Chips** — The daily summary email (`src/lib/email-templates.js`) and the DailySummaryPage component (`src/components/DailySummaryPage.jsx`) now render a small `↑/↓ N% vs 30d` chip next to each KPI value. The chip reads `summary.baselines.company.<metricKey>.deltaPct`, colors green/red based on the metric's "higher/lower is better" convention, and shows muted gray when the delta is under 5%.
5. **Snapshot Schema** — Three tab headers are defined as exported arrays in `src/lib/snapshots.js`: `SNAP_COMPANY_HEADERS` (18 fields), `SNAP_AGENT_HEADERS` (17), `SNAP_CAMPAIGN_HEADERS` (17). Writers skip zero-activity rows (agents with 0 apps and 0 premium; campaigns with 0 calls, 0 sales, 0 spend). Company row is always written.

---

## Merged Economics Architecture

### Data Flow
```
Sheet1 (original agent-submitted data, never modified)
    ↓ (copied once as baseline)
Merged tab (carrier-corrected, dashboard reads this via SALES_TAB_NAME)
    ↑ (updated by carrier sync with updateMerged=true)
Carrier Report (DetailedProduction)

Change History tab (append-only audit log of every field change)
```

### How It Works
- **First sync**: Copies all Sheet1 data → Merged tab, adds 7 audit columns
- **Subsequent syncs**: Matches carrier records to Merged rows using 3-tier matching (policy number → name+agent fuzzy → no match), updates economics where different
- **Trigger**: POST `/api/crm/carrier-sync` with `{ updateMerged: true }` in body (checkbox in Retention tab sync bar)
- **Dashboard reads**: All 6 economics API routes read from `SALES_TAB_NAME` env var, which now points to `Merged`

### Merged Tab Columns (7 audit columns appended after Sheet1 columns)
| Column | Purpose |
|--------|---------|
| `Original Premium` | Agent-submitted premium, set once on first carrier override, never overwritten |
| `Original Placed Status` | Original `Placed?` value before carrier correction |
| `Carrier Policy #` | Carrier's internal policy number (for cross-reference) |
| `Carrier Status` | Raw carrier status (Active, Canceled, Declined, Pending) |
| `Carrier Status Date` | Date carrier status was last seen/changed |
| `Last Sync Date` | When this row was last checked against carrier data |
| `Sync Notes` | Human-readable change log with dates |

### Change History Tab (append-only audit log)
Headers: Date, Policy #, Carrier Policy #, Insured Name, Agent, Field Changed, Old Value, New Value, Source

### Matching Strategy
- **Tier 1**: Exact match on `Policy #` (Sales) vs `Policy No.` (Carrier) — works for AIG, Transamerica
- **Tier 2**: Fuzzy name+agent match — Last name (exact or edit distance ≤1) + First name (exact, nickname, starts-with, or edit distance ≤1) + optional agent match for confidence boost. Handles American Amicable which uses different policy numbering systems.
- **Minimum confidence**: 55% (score/90) required for Tier 2 matches

### Status Mapping (Carrier → Placed?)
- `Active`, `Reinstated` → `Active - In Force`
- `Pending` → `Submitted - Pending`
- `Canceled`, `Cancelled`, `Terminated`, `Lapsed`, `Declined`, `Not Taken`, `Rejected` → `Declined`

### Reverting to Original Data
To temporarily use original agent-submitted data: change `SALES_TAB_NAME=Sheet1` in `.env.local` and restart. All economics APIs will read from the unmodified Sheet1.

---

## TCC Database (Postgres on Neon)

Replaced Sheets-as-database for the Portfolio UI and future features.

### Connection

- Provider: Neon (10GB free tier, branchable serverless Postgres)
- Library: `postgres` (postgres.js, no ORM, raw SQL via tagged-template literals)
- Module: `src/lib/db.js` exports `sql` (tagged template), `closeDb()`, `rawClient()`
- Env: `DATABASE_URL` in `.env.local` and Vercel env

### Schema

8 entity tables + `_migrations` + `sync_state`:

- `contacts` (phone-keyed, parent of calls + policies)
- `calls` (FK contact, campaign, agent; row_hash for idempotent sync)
- `policies` (FK contact, carrier, product, campaign, agent; source_row_hash for idempotent sync)
- `commission_ledger` (FK policy, carrier, agent; per-transaction commission events synced from the Commission Ledger sheet tab inside SALES_SHEET_ID)
- `campaigns`, `carriers`, `products`, `agents` (reference data)

Plus the `policy_commission_summary` VIEW that aggregates ledger rows per policy (total advance, total commission, outstanding balance, last statement date, current status, etc.).

### Usage

```javascript
import { sql } from '@/lib/db';
const contacts = await sql`SELECT id, first_name, last_name FROM contacts WHERE state = ${state} LIMIT 50`;
// returns array with camelCase keys (firstName, lastName)
```

### Migrations

```bash
node --env-file=.env.local scripts/db-migrate.mjs status   # list
node --env-file=.env.local scripts/db-migrate.mjs up       # apply pending
```

V1 has no rollback — write a forward migration to fix issues.

---

## TCC Portfolio (DB-backed unified view)

Replaces the old Lead CRM + Retention Dashboard + Business Health tabs
with a single Portfolio tab. Reads from Postgres for sub-second response.

### Components (`src/components/portfolio/`)

- `PortfolioTab.jsx` — main shell, hosts state + wires children
- `PortfolioFilterSidebar.jsx` — saved smart-list selector
- `PortfolioGrid.jsx` — sortable selectable contact table
- `PortfolioGroupBySelector.jsx` + `PortfolioGroupView.jsx` — pivot grouping
- `PortfolioBulkActionBar.jsx` — appears when rows selected; export, dialer
- `PortfolioDetailPanel.jsx` — slide-in contact detail (replaces old modals)

### API endpoints (`src/app/api/portfolio/`)

- `GET /contacts?filters=...&groupBy=...&page=...&sortBy=...&sortDir=...`
  Returns `{ rows, total, page, pageSize }` for flat view, or
  `{ groups, groupBy }` when groupBy is set
- `GET /contact/[id]` — full contact record with policies + calls
- `GET /export?filters=...` — general CSV export
- `GET /dialer-export?filters=...` — ChaseData-format CSV

### Saved smart lists (hardcoded for V1; user-defined deferred)

Defined in `src/lib/portfolio/filters.js`:

- `all_submitted` — `application_date IS NOT NULL`
- `pending` — submitted + status contains pending/submitted/awaiting
- `active_policies` — submitted + status contains active/in force/advance
- `recently_lapsed` — submitted + status contains lapsed/canceled
- `declined` — submitted + status contains declined
- `high_value` — active + monthly premium > $100

### Group-by dimensions

`none`, `placed_status`, `carrier`, `agent`, `campaign`, `state`, `month`

### Bulk actions

- **Export CSV** — general columns (name, phone, status, premium, etc.)
- **Push to Dialer (CSV)** — ChaseData import format (Phone, FirstName, LastName, State)
- **Trigger Workflow** — V2 (placeholder in UI)
