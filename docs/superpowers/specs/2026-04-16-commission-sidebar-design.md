# Commission Tracker Sidebar + Status Summary Table — Design Spec

## Overview

Two new features for the TCC Dashboard:

1. **Commission Tracker Sidebar** — A collapsible right-side panel on the main dashboard showing paid vs. unpaid commission status by carrier and policy status, with pie charts, WoW deltas, and drill-down.

2. **Commission Status Summary Table** — A standalone table (accessible via a link/tab) showing the full paid/unpaid breakdown by policy status with all financial columns.

Both pull data from `/api/commission-statements?view=waterfall`.

---

## Feature 1: Commission Tracker Sidebar

### Behavior
- Toggle button in the dashboard header opens/closes the sidebar
- When closed: zero footprint, no layout impact
- When open: slides in from the right, ~420px wide, scrollable, sits outside the 1400px content area
- Persists across tab changes (visible on all tabs)
- Data loads once on open, cached until closed

### Layout (top to bottom)
1. **Header bar** — "Commission Tracker" label + Carrier/Status toggle + close button
2. **Two donut pie charts** side by side:
   - Left: Policy count by status (Active In Force, Active No Comm, Issued, Pending, Canceled, Declined, Other)
   - Right: Commission $ (Received, Clawback, Outstanding)
3. **WoW delta cards** (3 cards):
   - Received this week vs prior (+$ and ▲/▼ %)
   - New apps submitted this week vs prior (+N and %)
   - Balance change (collecting faster/slower)
4. **Grouped table** — toggles between:
   - **Carrier → Status**: Carrier header rows, status sub-rows underneath
   - **Status → Carrier**: Status header rows, carrier sub-rows underneath
5. **Totals row** at bottom

### Table columns
- Status (or Carrier, depending on grouping)
- \# (policy count)
- Paid (green count / red count)
- Received (net $ received from carrier)
- Balance (outstanding $ owed)

### Carrier grouping logic
- "AIG Corebridge" — any carrier string containing "aig" or "corebridge"
- "American Amicable" — any containing "amicable" or "occidental"
- "TransAmerica" — any containing "transamerica"
- "CICA (Checking)" — carrier contains "cica" but NOT "giwl"
- "CICA (Credit/Debit)" — carrier contains "cica" AND "giwl"
- "Baltimore Life" — any containing "baltimore"
- Fallback: raw carrier string

### Status values (from Policy Status column, passed through as-is)
- Active - In Force (green ●)
- Active - No commission paid yet (cyan ●)
- Active - Past Due (green ●)
- Issued, Not yet Active (purple ●)
- Pending - Requirements Missing (yellow ◐)
- Pending - Agent State Appt (yellow ◐)
- Canceled (red ✗) — SEPARATE from Declined
- Declined (orange ✗) — SEPARATE from Canceled
- Initial Pay Failure (gray ◯)
- Unknown (gray ◯)
- not in system yet (gray ◯)
- Pending - Requirements MIssing (yellow ◐) — typo variant, merge with above

### Paid column
- "Paid" = `carrierPaid === true` (any commission ledger entry exists for this policy)
- Displayed as: `15/8` = 15 paid, 8 unpaid (green/red)

### WoW calculation
- "This week" = policies with `submitDate` in the current Mon-Sun period
- "Prior week" = policies with `submitDate` in the previous Mon-Sun period
- Compare: total received, count of new submissions, net balance change
- Show absolute delta + % change, green ▲ or red ▼ based on direction

### Row click drill-down
- Clicking any status row (in Carrier→Status mode) shows the individual policies for that carrier+status combination
- Clicking any carrier row (in Status→Carrier mode) shows the individual policies for that status+carrier combination
- Drill-down shows: Policy #, Insured Name, Premium, Received, Balance, Effective Date, Submit Date
- Back button returns to the grouped view

---

## Feature 2: Commission Status Summary Table

### Access
- New link in the dashboard header (next to Trends/Settings) labeled "Commission Status"
- OR a new tab in the main tab bar

### Layout
- Full-width table matching the dashboard dark theme
- Rows: each unique Policy Status value
- Columns: Status, # Policies, # Paid, # Unpaid, Mo Premium, Expected, Received, Clawback, Net Received, Balance
- Totals row at bottom
- Color-coded: green for active statuses, yellow for pending, red for canceled/declined, gray for unknown/other
- Sorted by policy count descending

### Row click drill-down
- Click any status row to see all policies in that status
- Drill-down table columns: Policy #, Insured Name, Carrier, Agent, Premium, Expected Commission, Received, Clawback, Net Received, Balance, Effective Date, Paid?
- Sortable columns
- Back button to return to summary

---

## Data Source

Both features use: `GET /api/commission-statements?view=waterfall`

Returns per-policy objects with: policyNumber, insuredName, carrier, product, premium, agent, status, submitDate, effectiveDate, expectedCommission, totalPaid, totalClawback, netReceived, balance, carrierPaid (boolean), entries (count)

No new API endpoint needed.

---

## Files to create/modify

### New files
- `src/components/CommissionSidebar.jsx` — The collapsible sidebar component
- `src/components/CommissionStatusTable.jsx` — The standalone summary table

### Modified files
- `src/components/Dashboard.jsx` — Add sidebar toggle button to header, render CommissionSidebar, add state management
- `src/app/page.js` — Pass sidebar state through if needed

---

## Color system (matches existing dashboard)
```
Active statuses: #4ade80 (green)
No commission: #22d3ee (cyan)
Issued/not active: #a78bfa (purple)
Pending: #facc15 (yellow)
Canceled: #f87171 (red)
Declined: #fb923c (orange)
Initial Pay Failure/Unknown/Other: #64748b (gray)
```
