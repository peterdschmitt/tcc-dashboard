# TCC Dashboard Memory

## Project Overview
Next.js 14 app (App Router) for final expense insurance call center BI. Dark theme, single-file Dashboard.jsx (~1152 lines).

## Key Files
- [src/components/Dashboard.jsx](../src/components/Dashboard.jsx) — All UI, 1152 lines, monolithic
- [src/app/api/dashboard/route.js](../src/app/api/dashboard/route.js) — Main data API
- [src/app/api/goals/route.js](../src/app/api/goals/route.js) — Goals with fallback defaults
- [src/app/api/settings/route.js](../src/app/api/settings/route.js) — CRUD for sheet rows
- [src/lib/sheets.js](../src/lib/sheets.js) — Google Sheets auth + caching
- [src/lib/utils.js](../src/lib/utils.js) — Date parsing, fuzzy name matching, commission calc

## Daily Drill-Down Calls Table Columns (current)
Campaign, Agent, Status, Call Type, Duration, Buffer, Billable?, Cost, $/Call, State, Phone, Lead ID

## Call Logs Column Name Note
The column header is `Lead Id` (capital I, lowercase d) — use `r['Lead Id']` in code, NOT `r['Lead ID']`.

## Known Bugs (from code review, 2026-03-06)

### Critical
- **AgentPerformanceTab**: Dashboard.jsx ~line 788 calls `/api/agent-performance` which doesn't exist → tab hangs forever
- **Clear Cache button**: Dashboard.jsx ~line 1115 calls `/api/clear-cache` which doesn't exist → button silently fails
- **Column letter bug**: sheets.js:71 uses `String.fromCharCode(64 + headers.length)` — breaks for >26 columns

### Medium
- **Agent goals key**: Dashboard.jsx ~line 474 uses `goals?.agent` but should be `goals?.agents` (plural) → agent goal bars don't show
- **PnlTab dateRange**: PnlTab component uses `dateRange` variable not passed as prop → undefined reference
- **Trends conversionRate**: trends/page.js ~line 482 uses `cg.conversionRate` but goals API returns `cg.close_rate` → reference line missing

### Low
- `goalBg()` uses hardcoded 0.8 threshold; tiles use `meta.yellow` (configurable) — slight inconsistency
- `parseFlexDate()` in utils.js doesn't validate date ranges (e.g., month 13 accepted)
- `calcCommission()` fails for short 1-word carrier names (AIG) due to 40% overlap threshold

## Architecture Notes
- Cache TTL: 900s (env CACHE_TTL), in-memory per process
- 4 Google Sheets: SALES, CALLLOGS, COMMISSION, GOALS (with 3 tabs)
- Fuzzy agent name matching between call logs and policy tracker
- Commission: GIWL = premium × 1.5, others = premium × 3
- GAR: premium × 9 months (6 for CICA)

## User Preferences
- User reviews project without asking for immediate changes
- Prefers detailed technical summaries
