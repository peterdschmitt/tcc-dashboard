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
│   │       ├── dashboard/route.js     # Main API — joins sales + calls + commissions + pricing
│   │       ├── goals/route.js         # Goals API — company & agent daily targets
│   │       └── settings/route.js      # Settings API — CRUD for sheet rows
│   ├── components/
│   │   └── Dashboard.jsx              # All dashboard UI (760 lines, single-file component)
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

# Tab Names (optional — defaults shown)
SALES_TAB_NAME=Sheet1
CALLLOGS_TAB_NAME=Report
COMMISSION_TAB_NAME=Sheet1
GOALS_PRICING_TAB=Publisher Pricing
COMPANY_GOALS_TAB=Company Daily Goals
AGENT_GOALS_TAB=Agent Daily Goals
```

---

## Google Sheets Structure

### Sales/Policy Tracker (`SALES_SHEET_ID`)
Columns: Agent, Lead Source, Application Submitted Date, Payment Type, Payment Frequency, Social Security Billing Match, First Name, Last Name, Gender, Date of Birth, Phone Number, Email Address, Street Address, City, State, Zip Code, Text Friendly, Policy #, Effective Date, Carrier + Product + Payout, Face Amount, Term Length, Monthly Premium, Outcome at Application Submission, Placed?, Sales Notes, Submission ID

### Call Logs (`CALLLOGS_SHEET_ID`)
Columns: Date, Rep, Campaign, Subcampaign, Phone, State, Country, Attempt, Caller ID, Inbound Source, Lead ID, Client ID, Last, First, Import Date, Call Status, Is Callable, Duration, Call Type, Details, Hangup, HoldTime, Hangup Source, Recording

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
