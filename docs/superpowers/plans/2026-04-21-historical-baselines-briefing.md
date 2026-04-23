# Historical Baselines & Smarter Briefing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the daily/weekly briefing from "static goal comparison" to "performance relative to historical baselines at company, agent, and campaign level," so the AI narrative can cite WoW deltas, z‑score anomalies, and best/worst‑in‑N signals for specific agents and publishers.

**Architecture:** Append a one‑row‑per‑day snapshot to three new Google Sheet tabs (company, per‑agent, per‑campaign) every time the daily summary runs. A new `baselines.js` library reads those tabs to compute prev / avg7 / avg30 / stdev30 / z / trend7 / bestInN / worstInN per metric. The briefing API injects a baseline block into the GPT‑4o context, `computeAlerts` gains a second "historical‑anomaly" signal, and the email + DailySummaryPage render delta chips next to KPIs. A one‑time backfill endpoint replays the last 90 days so baselines are useful on day one.

**Tech Stack:** Next.js 14 App Router, googleapis (Sheets v4), OpenAI SDK, Resend, Recharts. No new runtime dependencies. Stays within the existing "all persistence is Sheets" pattern.

**Project convention note:** This repo has no test framework (Jest/Vitest are absent from `package.json`). Each task's verification step uses `curl` against the dev server plus a manual check of the affected Google Sheet tab — same rigor, different medium. Do **not** introduce a test framework for this feature; it would be scope creep.

---

## File Structure

**New files:**
- `src/lib/snapshots.js` — schema, row builders, idempotent writer, reader for the 3 snapshot tabs.
- `src/lib/baselines.js` — pure functions: `computeBaseline(values)`, `buildBaselineBlock(…)`. No I/O.
- `src/app/api/snapshots/write/route.js` — POST/GET endpoint that triggers a snapshot write for a given date (used by daily-summary and for ad-hoc testing).
- `src/app/api/cron/backfill-snapshots/route.js` — iterates day‑by‑day calling the write endpoint. Secret‑gated.

**Modified files:**
- `src/app/api/daily-summary/route.js` — call the snapshot writer; read baselines; inject `BASELINES:` block into `liveContext`; upgrade `computeAlerts` to also flag historical anomalies; return baselines in the JSON response.
- `src/lib/email-templates.js` — render delta chips on KPI cards and on the alerts table.
- `src/components/DailySummaryPage.jsx` — render delta chips on KPI cards.
- `vercel.json` — add `maxDuration: 60` for the new backfill route.

---

## Shared references (used across tasks)

**Snapshot tab names (constants live in `src/lib/snapshots.js`):**

```js
export const SNAP_COMPANY_TAB = process.env.SNAP_COMPANY_TAB || 'Daily Snapshots Company';
export const SNAP_AGENTS_TAB  = process.env.SNAP_AGENTS_TAB  || 'Daily Snapshots Agents';
export const SNAP_CAMPAIGNS_TAB = process.env.SNAP_CAMPAIGNS_TAB || 'Daily Snapshots Campaigns';
export const SNAP_SHEET_ID = process.env.GOALS_SHEET_ID; // re-use goals sheet, same as AI cache
```

**Column schemas:**

```js
export const SNAP_COMPANY_HEADERS = [
  'date','apps','placed','calls','billable','billableRate',
  'premium','gar','leadSpend','commission','netRevenue',
  'cpa','rpc','closeRate','placementRate','premCost','avgPremium',
  'generatedAt',
];

export const SNAP_AGENT_HEADERS = [
  'date','agent','apps','placed','premium','gar','commission',
  'availPct','pausePct','loggedInSec','talkTimeSec','dialed','connects',
  'salesPerHour','premiumPerApp','closeRate',
  'generatedAt',
];

export const SNAP_CAMPAIGN_HEADERS = [
  'date','campaign','vendor','calls','billable','billableRate',
  'spend','sales','premium','gar','commission','netRevenue',
  'cpa','rpc','closeRate','premCost',
  'generatedAt',
];
```

**Zero-activity rule:** Skip writing an agent row when `apps === 0 && premium === 0`. Skip writing a campaign row when `calls === 0 && sales === 0 && spend === 0`. Company row is always written.

---

### Task 1: Create snapshots library — tab bootstrap

**Files:**
- Create: `src/lib/snapshots.js`

- [ ] **Step 1: Create the library with constants and `ensureSnapshotTabs()`**

```js
// src/lib/snapshots.js
import { getSheetsClient } from './sheets';

export const SNAP_COMPANY_TAB = process.env.SNAP_COMPANY_TAB || 'Daily Snapshots Company';
export const SNAP_AGENTS_TAB  = process.env.SNAP_AGENTS_TAB  || 'Daily Snapshots Agents';
export const SNAP_CAMPAIGNS_TAB = process.env.SNAP_CAMPAIGNS_TAB || 'Daily Snapshots Campaigns';

export const SNAP_COMPANY_HEADERS = [
  'date','apps','placed','calls','billable','billableRate',
  'premium','gar','leadSpend','commission','netRevenue',
  'cpa','rpc','closeRate','placementRate','premCost','avgPremium',
  'generatedAt',
];
export const SNAP_AGENT_HEADERS = [
  'date','agent','apps','placed','premium','gar','commission',
  'availPct','pausePct','loggedInSec','talkTimeSec','dialed','connects',
  'salesPerHour','premiumPerApp','closeRate',
  'generatedAt',
];
export const SNAP_CAMPAIGN_HEADERS = [
  'date','campaign','vendor','calls','billable','billableRate',
  'spend','sales','premium','gar','commission','netRevenue',
  'cpa','rpc','closeRate','premCost',
  'generatedAt',
];

const TAB_HEADERS = {
  [SNAP_COMPANY_TAB]: SNAP_COMPANY_HEADERS,
  [SNAP_AGENTS_TAB]:  SNAP_AGENT_HEADERS,
  [SNAP_CAMPAIGNS_TAB]: SNAP_CAMPAIGN_HEADERS,
};

export async function ensureSnapshotTabs() {
  const sheetId = process.env.GOALS_SHEET_ID;
  if (!sheetId) throw new Error('GOALS_SHEET_ID not set');
  const sheets = await getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const existing = new Set(meta.data.sheets.map(s => s.properties.title));
  const created = [];

  for (const [tab, headers] of Object.entries(TAB_HEADERS)) {
    if (existing.has(tab)) continue;
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `'${tab}'!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [headers] },
    });
    created.push(tab);
  }
  return { sheetId, existing: [...existing], created };
}
```

- [ ] **Step 2: Create a tiny init endpoint to exercise the bootstrap**

**Files:**
- Create: `src/app/api/snapshots/init/route.js`

```js
import { NextResponse } from 'next/server';
import { ensureSnapshotTabs } from '@/lib/snapshots';

export async function GET() {
  try {
    const result = await ensureSnapshotTabs();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Start the dev server and verify**

Run in one terminal: `cd ~/Downloads/tcc-dashboard && npm run dev`
Run in another:     `curl -s http://localhost:3003/api/snapshots/init | python3 -m json.tool`

Expected: `{ "ok": true, "sheetId": "<id>", "existing": [...], "created": ["Daily Snapshots Company", "Daily Snapshots Agents", "Daily Snapshots Campaigns"] }` on the first call. On the second call, `created` is `[]`.

Open the Goals Google Sheet in the browser. Three new tabs should exist, each with exactly the headers defined above.

- [ ] **Step 4: Commit**

```bash
git add src/lib/snapshots.js src/app/api/snapshots/init/route.js
git commit -m "Add Daily Snapshots tabs and bootstrap endpoint"
```

---

### Task 2: Snapshot row builders

**Files:**
- Modify: `src/lib/snapshots.js` — add row builders.

- [ ] **Step 1: Add `buildCompanyRow`, `buildAgentRows`, `buildCampaignRows`**

Append to `src/lib/snapshots.js`:

```js
const round = (n, d = 2) => {
  if (n == null || !isFinite(n)) return 0;
  const m = Math.pow(10, d);
  return Math.round(n * m) / m;
};

/**
 * Input shape mirrors what /api/daily-summary computes internally.
 * All fields are numbers unless noted.
 */
export function buildCompanyRow(date, m) {
  return {
    date,
    apps: m.apps | 0,
    placed: m.placed | 0,
    calls: m.totalCalls | 0,
    billable: m.billable | 0,
    billableRate: round(m.billableRate),
    premium: round(m.totalPremium),
    gar: round(m.totalGAR),
    leadSpend: round(m.totalLeadSpend),
    commission: round(m.totalComm),
    netRevenue: round(m.netRevenue),
    cpa: round(m.cpa),
    rpc: round(m.rpc),
    closeRate: round(m.closeRate),
    placementRate: round(m.placementRate),
    premCost: round(m.premCost),
    avgPremium: round(m.avgPremium),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * byAgent: { [agentName]: { apps, placed, premium, gar, commission } }
 * agentPerf: [{ rep, availPct, pausePct, loggedIn, talkTime, dialed, connects, ... }]
 *            (loggedIn/talkTime are seconds, as produced by /api/agent-performance)
 */
export function buildAgentRows(date, byAgent, agentPerf = []) {
  const perfByRep = new Map();
  for (const a of agentPerf) if (a && a.rep) perfByRep.set(String(a.rep).trim().toLowerCase(), a);

  const rows = [];
  const now = new Date().toISOString();
  for (const [agent, v] of Object.entries(byAgent || {})) {
    const perf = perfByRep.get(String(agent).trim().toLowerCase()) || {};
    const apps = v.apps | 0;
    const premium = round(v.premium || 0);
    if (apps === 0 && premium === 0) continue; // zero-activity skip

    const loggedInSec = perf.loggedIn || 0;
    const hoursAvailable = loggedInSec > 0 && perf.availPct != null
      ? (loggedInSec * (perf.availPct / 100)) / 3600
      : 0;

    rows.push({
      date,
      agent,
      apps,
      placed: v.placed | 0,
      premium,
      gar: round(v.gar || 0),
      commission: round(v.commission || 0),
      availPct: round(perf.availPct || 0),
      pausePct: round(perf.pausePct || 0),
      loggedInSec: loggedInSec | 0,
      talkTimeSec: (perf.talkTime || 0) | 0,
      dialed: perf.dialed || 0,
      connects: perf.connects || 0,
      salesPerHour: hoursAvailable > 0 ? round(apps / hoursAvailable) : 0,
      premiumPerApp: apps > 0 ? round(premium / apps) : 0,
      closeRate: 0, // close rate is a funnel metric; left 0 at agent-day level
      generatedAt: now,
    });
  }
  return rows;
}

/**
 * byCampaign: { [code]: { vendor, calls, billable, billableRate, spend, sales,
 *                         premium, gar, commission, netRevenue, cpa, rpc,
 *                         closeRate } }
 */
export function buildCampaignRows(date, byCampaign) {
  const rows = [];
  const now = new Date().toISOString();
  for (const [code, c] of Object.entries(byCampaign || {})) {
    const calls = c.calls | 0;
    const sales = c.sales | 0;
    const spend = round(c.spend || 0);
    if (calls === 0 && sales === 0 && spend === 0) continue;

    const premium = round(c.premium || 0);
    rows.push({
      date,
      campaign: code,
      vendor: c.vendor || '',
      calls,
      billable: c.billable | 0,
      billableRate: round(c.billableRate || 0),
      spend,
      sales,
      premium,
      gar: round(c.gar || 0),
      commission: round(c.commission || 0),
      netRevenue: round(c.netRevenue || 0),
      cpa: round(c.cpa || 0),
      rpc: round(c.rpc || 0),
      closeRate: round(c.closeRate || 0),
      premCost: spend > 0 ? round(premium / spend) : 0,
      generatedAt: now,
    });
  }
  return rows;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/snapshots.js
git commit -m "Add snapshot row builders for company, agents, campaigns"
```

---

### Task 3: Idempotent snapshot writer

**Files:**
- Modify: `src/lib/snapshots.js` — add `writeSnapshots()`.

- [ ] **Step 1: Add writer**

Append to `src/lib/snapshots.js`:

```js
import { fetchSheet, appendRow } from './sheets';

/**
 * For a given date, delete any existing rows whose `date` matches, then append
 * the fresh rows. Deletion is done in descending row order so indices stay stable.
 */
async function upsertRowsForDate(sheetId, tabName, headers, date, rows) {
  const sheets = await getSheetsClient();
  // Read current rows (including empty tab case)
  let existing = [];
  try { existing = await fetchSheet(sheetId, tabName, 0); } catch { existing = []; }

  const toDelete = existing
    .filter(r => r.date === date)
    .map(r => r._rowIndex)
    .sort((a, b) => b - a); // descending so earlier indices don't shift

  if (toDelete.length > 0) {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const sheet = meta.data.sheets.find(s => s.properties.title === tabName);
    if (!sheet) throw new Error('Tab not found: ' + tabName);
    const sheetGid = sheet.properties.sheetId;

    const requests = toDelete.map(rowNum => ({
      deleteDimension: {
        range: {
          sheetId: sheetGid,
          dimension: 'ROWS',
          startIndex: rowNum - 1,
          endIndex: rowNum,
        },
      },
    }));
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests },
    });
  }

  for (const row of rows) {
    await appendRow(sheetId, tabName, headers, row);
  }
}

/**
 * Write all three snapshot tabs for one date.
 * `companyRow` is a single object; `agentRows` / `campaignRows` are arrays.
 */
export async function writeSnapshots(date, companyRow, agentRows, campaignRows) {
  await ensureSnapshotTabs();
  const sheetId = process.env.GOALS_SHEET_ID;
  await upsertRowsForDate(sheetId, SNAP_COMPANY_TAB, SNAP_COMPANY_HEADERS, date, [companyRow]);
  await upsertRowsForDate(sheetId, SNAP_AGENTS_TAB, SNAP_AGENT_HEADERS, date, agentRows);
  await upsertRowsForDate(sheetId, SNAP_CAMPAIGNS_TAB, SNAP_CAMPAIGN_HEADERS, date, campaignRows);
  return {
    date,
    companyWritten: 1,
    agentsWritten: agentRows.length,
    campaignsWritten: campaignRows.length,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/snapshots.js
git commit -m "Add idempotent snapshot upsert (delete-then-append by date)"
```

---

### Task 4: `/api/snapshots/write` endpoint

**Files:**
- Create: `src/app/api/snapshots/write/route.js`

- [ ] **Step 1: Implement the endpoint**

The endpoint accepts `?date=YYYY-MM-DD`, calls the existing `/api/daily-summary` for that single day, projects the result into snapshot rows, and writes them.

```js
// src/app/api/snapshots/write/route.js
import { NextResponse } from 'next/server';
import {
  buildCompanyRow, buildAgentRows, buildCampaignRows, writeSnapshots,
} from '@/lib/snapshots';

function getBaseUrl() {
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:' + (process.env.PORT || 3003);
}

async function writeForDate(baseUrl, date) {
  const res = await fetch(`${baseUrl}/api/daily-summary?start=${date}&end=${date}&mode=daily`);
  if (!res.ok) throw new Error(`daily-summary ${res.status} for ${date}`);
  const s = await res.json();

  const m = {
    apps: s.sales?.total || 0,
    placed: s.sales?.placed || 0,
    totalCalls: s.calls?.total || 0,
    billable: s.calls?.billable || 0,
    billableRate: s.calls?.billableRate || 0,
    totalPremium: s.financials?.totalPremium || 0,
    totalGAR: s.financials?.gar || 0,
    totalLeadSpend: s.financials?.leadSpend || 0,
    totalComm: s.financials?.commission || 0,
    netRevenue: s.financials?.netRevenue || 0,
    cpa: s.financials?.cpa || 0,
    rpc: s.financials?.rpc || 0,
    closeRate: s.financials?.closeRate || 0,
    placementRate: s.financials?.placementRate || 0,
    premCost: s.financials?.premCost || 0,
    avgPremium: s.financials?.avgPremium || 0,
  };

  const companyRow = buildCompanyRow(date, m);
  const agentRows = buildAgentRows(date, s.sales?.byAgent || {}, s.agentPerf || []);
  const campaignRows = buildCampaignRows(date, s.sales?.byCampaign || {});
  return writeSnapshots(date, companyRow, agentRows, campaignRows);
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');
    if (!date) return NextResponse.json({ error: 'date=YYYY-MM-DD required' }, { status: 400 });
    const result = await writeForDate(getBaseUrl(), date);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

```

- [ ] **Step 2: Verify a single day end-to-end**

Pick a known-good recent business day (e.g. `2026-04-20`).

Run: `curl -s "http://localhost:3003/api/snapshots/write?date=2026-04-20" | python3 -m json.tool`

Expected: `{ "ok": true, "date": "2026-04-20", "companyWritten": 1, "agentsWritten": <n>, "campaignsWritten": <n> }`.

Open each of the three tabs and verify the row for `2026-04-20` exists with non-zero values. Re-run the curl and verify the row count does NOT grow (idempotent).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/snapshots/write/route.js
git commit -m "Add /api/snapshots/write endpoint (single-date snapshot upsert)"
```

---

### Task 5: Backfill endpoint

**Files:**
- Create: `src/app/api/cron/backfill-snapshots/route.js`
- Modify: `vercel.json` — add `maxDuration`.

- [ ] **Step 1: Implement the backfill route**

```js
// src/app/api/cron/backfill-snapshots/route.js
import { NextResponse } from 'next/server';

function getBaseUrl() {
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:' + (process.env.PORT || 3003);
}

function daysBetween(startISO, endISO) {
  const out = [];
  const cur = new Date(startISO + 'T00:00:00Z');
  const end = new Date(endISO + 'T00:00:00Z');
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export async function GET(request) {
  if (process.env.CRON_SECRET) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }
  try {
    const { searchParams } = new URL(request.url);
    const start = searchParams.get('start');
    const end = searchParams.get('end');
    if (!start || !end) {
      return NextResponse.json({ error: 'start=YYYY-MM-DD&end=YYYY-MM-DD required' }, { status: 400 });
    }
    const baseUrl = getBaseUrl();
    const dates = daysBetween(start, end);
    const results = [];
    for (const d of dates) {
      try {
        const res = await fetch(`${baseUrl}/api/snapshots/write?date=${d}`);
        const body = await res.json();
        results.push({ date: d, ...body });
      } catch (err) {
        results.push({ date: d, error: err.message });
      }
    }
    return NextResponse.json({
      ok: true,
      count: results.length,
      failed: results.filter(r => r.error || !r.ok).length,
      results,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Add `maxDuration` entry in `vercel.json`**

Add inside the existing `functions` object:

```json
"src/app/api/cron/backfill-snapshots/route.js": { "maxDuration": 60 }
```

- [ ] **Step 3: Verify backfill over a 3-day range first**

```bash
curl -s "http://localhost:3003/api/cron/backfill-snapshots?start=2026-04-18&end=2026-04-20" | python3 -m json.tool
```

Expected: `ok: true, count: 3, failed: 0`, with three results objects. Verify tabs contain exactly three distinct `date` values for the range.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/backfill-snapshots/route.js vercel.json
git commit -m "Add /api/cron/backfill-snapshots endpoint with CRON_SECRET gate"
```

---

### Task 6: `baselines.js` — pure stats library

**Files:**
- Create: `src/lib/baselines.js`

- [ ] **Step 1: Implement the pure functions**

```js
// src/lib/baselines.js
// Pure stats — no I/O. Inputs are arrays of { date, value } sorted ascending.

function mean(xs) {
  if (!xs.length) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function stdev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1);
  return Math.sqrt(v);
}

function trendSlope(xs) {
  // Simple linear regression slope over index. Returns per-step slope.
  const n = xs.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = mean(xs);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - mx) * (xs[i] - my);
    den += (i - mx) * (i - mx);
  }
  return den === 0 ? 0 : num / den;
}

/**
 * series: array of { date, value } sorted ascending by date. `today` is the
 * most recent date's value. Values for "missing" days should be omitted from
 * the series entirely (we do not impute zeros).
 *
 * Returns a baseline summary for a single metric:
 *   { today, prev, avg7, avg30, stdev30, z, trend7, bestInN, worstInN, deltaPct }
 */
export function computeBaseline(series, { bestWorstWindow = 14 } = {}) {
  if (!series || !series.length) {
    return { today: 0, prev: null, avg7: null, avg30: null, stdev30: null,
             z: null, trend7: null, bestInN: false, worstInN: false, deltaPct: null };
  }
  const asc = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const today = asc[asc.length - 1].value;
  const prev = asc.length >= 2 ? asc[asc.length - 2].value : null;

  const last7  = asc.slice(-8, -1).map(x => x.value);   // 7 days before today
  const last30 = asc.slice(-31, -1).map(x => x.value);  // 30 days before today
  const avg7   = last7.length  ? mean(last7)  : null;
  const avg30  = last30.length ? mean(last30) : null;
  const sd30   = last30.length ? stdev(last30) : null;
  const z = (sd30 != null && sd30 > 0) ? (today - avg30) / sd30 : null;

  const trend7 = last7.length >= 2 ? trendSlope(last7) : null;

  const window = asc.slice(-bestWorstWindow); // inclusive of today
  const values = window.map(x => x.value);
  const bestInN  = values.length > 1 && today >= Math.max(...values);
  const worstInN = values.length > 1 && today <= Math.min(...values);

  const deltaPct = (avg30 != null && avg30 !== 0) ? (today - avg30) / avg30 : null;

  return { today, prev, avg7, avg30, stdev30: sd30, z, trend7, bestInN, worstInN, deltaPct };
}

/**
 * Build a compact, GPT-friendly baseline block for the prompt.
 *   company: { [metric]: baselineObject }
 *   topAgents: [{ agent, baseline: { [metric]: baselineObject } }]  (<=5)
 *   topCampaigns: [{ campaign, baseline: { [metric]: baselineObject } }] (<=8)
 */
export function buildBaselineBlock({ company = {}, topAgents = [], topCampaigns = [] }) {
  const lines = [];

  const fmtB = (b) => {
    if (!b) return 'n/a';
    const parts = [];
    parts.push(`today=${round(b.today)}`);
    if (b.avg7  != null) parts.push(`avg7=${round(b.avg7)}`);
    if (b.avg30 != null) parts.push(`avg30=${round(b.avg30)}`);
    if (b.z     != null) parts.push(`z=${round(b.z, 2)}`);
    if (b.deltaPct != null) parts.push(`Δ30=${(b.deltaPct * 100).toFixed(0)}%`);
    if (b.bestInN)  parts.push('BEST_IN_14');
    if (b.worstInN) parts.push('WORST_IN_14');
    return parts.join(' ');
  };

  lines.push('COMPANY BASELINES:');
  for (const [metric, b] of Object.entries(company)) lines.push(`  ${metric}: ${fmtB(b)}`);

  if (topAgents.length) {
    lines.push('AGENT BASELINES (top by today premium):');
    for (const a of topAgents) {
      const parts = Object.entries(a.baseline).map(([m, b]) => `${m}=${fmtB(b)}`).join('; ');
      lines.push(`  ${a.agent}: ${parts}`);
    }
  }
  if (topCampaigns.length) {
    lines.push('CAMPAIGN BASELINES (top by today spend):');
    for (const c of topCampaigns) {
      const parts = Object.entries(c.baseline).map(([m, b]) => `${m}=${fmtB(b)}`).join('; ');
      lines.push(`  ${c.campaign}: ${parts}`);
    }
  }

  return lines.join('\n');
}

function round(n, d = 2) {
  if (n == null || !isFinite(n)) return 'n/a';
  const m = Math.pow(10, d);
  return Math.round(n * m) / m;
}
```

- [ ] **Step 2: Smoke-test the math with an inline node one-liner**

Run (one line):

```bash
node -e "const {computeBaseline}=require('./src/lib/baselines.js'); const s=Array.from({length:30},(_,i)=>({date:'2026-03-'+String(i+1).padStart(2,'0'),value:100+(i%5)})); s.push({date:'2026-04-01',value:200}); console.log(computeBaseline(s))"
```

Expected: `today` is 200, `avg30` is ~102, `z` is a large positive number (say > 5), `bestInN: true`, `worstInN: false`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/baselines.js
git commit -m "Add baselines.js (pure stats + GPT prompt block builder)"
```

---

### Task 7: Baseline reader helper

**Files:**
- Modify: `src/lib/snapshots.js` — add readers that return the series shape needed by `computeBaseline`.

- [ ] **Step 1: Add `readCompanySeries`, `readAgentSeries`, `readCampaignSeries`**

Append to `src/lib/snapshots.js`:

```js
/**
 * Returns rows up to and including `asOfDate`, sorted ascending.
 * Numeric columns are cast to numbers.
 */
async function readSnapshotTab(tabName, asOfDate) {
  const sheetId = process.env.GOALS_SHEET_ID;
  let rows = [];
  try { rows = await fetchSheet(sheetId, tabName, 60); } catch { return []; }
  return rows
    .filter(r => r.date && r.date <= asOfDate)
    .map(r => {
      const o = {};
      for (const [k, v] of Object.entries(r)) {
        if (k === '_rowIndex' || k === 'date' || k === 'agent' || k === 'campaign' || k === 'vendor' || k === 'generatedAt') {
          o[k] = v;
        } else {
          const n = Number(v);
          o[k] = isFinite(n) ? n : 0;
        }
      }
      return o;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function readCompanySeries(asOfDate, metric) {
  const rows = await readSnapshotTab(SNAP_COMPANY_TAB, asOfDate);
  return rows.map(r => ({ date: r.date, value: r[metric] ?? 0 }));
}

export async function readAgentSeries(asOfDate, agent, metric) {
  const rows = await readSnapshotTab(SNAP_AGENTS_TAB, asOfDate);
  return rows
    .filter(r => r.agent === agent)
    .map(r => ({ date: r.date, value: r[metric] ?? 0 }));
}

export async function readCampaignSeries(asOfDate, campaign, metric) {
  const rows = await readSnapshotTab(SNAP_CAMPAIGNS_TAB, asOfDate);
  return rows
    .filter(r => r.campaign === campaign)
    .map(r => ({ date: r.date, value: r[metric] ?? 0 }));
}

/** Return { agents: [names], campaigns: [codes] } for rows on `date`. */
export async function readEntitiesOnDate(date) {
  const [agentsRows, campaignRows] = await Promise.all([
    readSnapshotTab(SNAP_AGENTS_TAB, date),
    readSnapshotTab(SNAP_CAMPAIGNS_TAB, date),
  ]);
  const agents = [...new Set(agentsRows.filter(r => r.date === date).map(r => r.agent))];
  const campaigns = [...new Set(campaignRows.filter(r => r.date === date).map(r => r.campaign))];
  return { agents, campaigns };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/snapshots.js
git commit -m "Add snapshot readers for company/agent/campaign series"
```

---

### Task 8: Wire snapshot write into `/api/daily-summary`

**Files:**
- Modify: `src/app/api/daily-summary/route.js`

- [ ] **Step 1: Import the builders**

Near the other imports at the top of `src/app/api/daily-summary/route.js`, add:

```js
import {
  buildCompanyRow, buildAgentRows, buildCampaignRows, writeSnapshots,
} from '@/lib/snapshots';
```

- [ ] **Step 2: Write snapshot after metric computation (daily mode only)**

Locate the block that ends with `const allAlerts = [...companyAlerts, ...agentAlerts];` (around line 189). Immediately **after** that line, insert:

```js
    // ─── SNAPSHOT WRITE (daily mode only, single-day requests) ───
    if (mode === 'daily' && startDate === endDate) {
      try {
        const metricsForSnap = {
          apps, placed: placed.length, totalCalls, billable, billableRate,
          totalPremium, totalGAR, totalLeadSpend, totalComm, netRevenue,
          cpa, rpc, closeRate, placementRate, premCost, avgPremium,
        };
        const companyRow = buildCompanyRow(startDate, metricsForSnap);
        const agentRows = buildAgentRows(startDate, byAgent, agentPerf);
        const campaignRows = buildCampaignRows(startDate, byCampaign);
        await writeSnapshots(startDate, companyRow, agentRows, campaignRows);
        console.log(`[daily-summary] Wrote snapshots for ${startDate}`);
      } catch (e) {
        console.warn('[daily-summary] Snapshot write failed:', e.message);
      }
    }
```

- [ ] **Step 3: Verify**

Start the dev server (or restart it so the import refresh picks up).

```bash
curl -s "http://localhost:3003/api/daily-summary?start=2026-04-20&end=2026-04-20" > /tmp/ds.json
echo $?
head -c 200 /tmp/ds.json
```

Expected: 0 exit, JSON payload. Check the dev server log for `Wrote snapshots for 2026-04-20`. Verify the company tab shows exactly one row for that date (idempotency from Task 3).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/daily-summary/route.js
git commit -m "Write snapshots when daily-summary runs in single-date daily mode"
```

---

### Task 9: Compute baselines inside `/api/daily-summary`

**Files:**
- Modify: `src/app/api/daily-summary/route.js`

- [ ] **Step 1: Add imports**

Add to the imports:

```js
import {
  readCompanySeries, readAgentSeries, readCampaignSeries,
} from '@/lib/snapshots';
import { computeBaseline, buildBaselineBlock } from '@/lib/baselines';
```

- [ ] **Step 2: Compute baselines for company + top agents + top campaigns**

Insert this block **before** the `// ─── BUILD NARRATIVE CONTEXT ───` comment (around line 276):

```js
    // ─── HISTORICAL BASELINES ───
    // Only meaningful for single-date daily mode; skip for weekly ranges.
    let baselines = { company: {}, topAgents: [], topCampaigns: [] };
    let baselineBlock = '';
    if (mode === 'daily' && startDate === endDate) {
      try {
        const asOf = startDate;
        const companyMetrics = ['apps','placed','calls','billable','premium','gar','leadSpend','commission','netRevenue','cpa','rpc','closeRate','placementRate','billableRate','avgPremium','premCost'];
        for (const m of companyMetrics) {
          const series = await readCompanySeries(asOf, m);
          baselines.company[m] = computeBaseline(series);
        }

        // Top 5 agents today by premium
        const topAgentNames = Object.entries(byAgent)
          .sort((a, b) => (b[1].premium || 0) - (a[1].premium || 0))
          .slice(0, 5)
          .map(([n]) => n);
        const agentMetrics = ['apps','premium','gar','availPct','talkTimeSec','salesPerHour'];
        for (const name of topAgentNames) {
          const bl = {};
          for (const m of agentMetrics) {
            const s = await readAgentSeries(asOf, name, m);
            bl[m] = computeBaseline(s);
          }
          baselines.topAgents.push({ agent: name, baseline: bl });
        }

        // Top 8 campaigns today by spend
        const topCampaignCodes = Object.entries(byCampaign)
          .sort((a, b) => (b[1].spend || 0) - (a[1].spend || 0))
          .slice(0, 8)
          .map(([c]) => c);
        const campaignMetricsList = ['calls','billable','spend','sales','premium','gar','cpa','rpc','closeRate','netRevenue'];
        for (const code of topCampaignCodes) {
          const bl = {};
          for (const m of campaignMetricsList) {
            const s = await readCampaignSeries(asOf, code, m);
            bl[m] = computeBaseline(s);
          }
          baselines.topCampaigns.push({ campaign: code, baseline: bl });
        }

        baselineBlock = buildBaselineBlock(baselines);
      } catch (e) {
        console.warn('[daily-summary] Baseline compute failed:', e.message);
      }
    }
```

- [ ] **Step 3: Inject `baselineBlock` into `liveContext`**

Find the `const liveContext = \`DAILY SUMMARY DATA for ${date}:` template literal (around line 277) and change the closing backtick so the baseline block is appended. Replace:

```js
${agentPerf.length > 0 ? 'AGENT DIALER: ' + agentPerf.map(a => `${a.rep}: avail ${a.availPct?.toFixed(1) || '?'}%, pause ${a.pausePct?.toFixed(1) || '?'}%, logged in ${a.loggedInStr || '?'}, talk time ${a.talkTimeStr || '?'}, ${a.dialed || 0} dials, ${a.connects || 0} connects`).join('; ') : ''}`;
```

with:

```js
${agentPerf.length > 0 ? 'AGENT DIALER: ' + agentPerf.map(a => `${a.rep}: avail ${a.availPct?.toFixed(1) || '?'}%, pause ${a.pausePct?.toFixed(1) || '?'}%, logged in ${a.loggedInStr || '?'}, talk time ${a.talkTimeStr || '?'}, ${a.dialed || 0} dials, ${a.connects || 0} connects`).join('; ') : ''}
${baselineBlock ? '\n' + baselineBlock : ''}`;
```

- [ ] **Step 4: Include baselines in the response**

Find the `return NextResponse.json({ ... })` at the end of the handler and add a `baselines` field alongside `narrative`:

```js
      narrative,
      tableSummaries,
      baselines,
```

- [ ] **Step 5: Verify**

First ensure Task 5's 3-day backfill ran (so there's enough history). Then:

```bash
curl -s "http://localhost:3003/api/daily-summary?start=2026-04-20&end=2026-04-20" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(json.dumps(d.get('baselines',{}).get('company',{}).get('cpa',{}), indent=2))"
```

Expected: an object with `today`, `avg7`, `avg30`, `z` fields (nulls are fine until more days are backfilled).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/daily-summary/route.js
git commit -m "Compute baselines and inject BASELINES block into AI context"
```

---

### Task 10: Upgrade `computeAlerts` with historical-anomaly signal

**Files:**
- Modify: `src/app/api/daily-summary/route.js`

- [ ] **Step 1: Change `computeAlerts` to return typed alerts and add a second pass**

Locate `function computeAlerts(metrics, goals, companyMeta)` (line 24). Replace the whole function with:

```js
function computeAlerts(metrics, goals, companyMeta, companyBaselines = {}) {
  const alerts = [];
  const metricDefs = [
    { key: 'apps_submitted',     label: 'Apps Submitted',     actual: metrics.apps,          snapKey: 'apps' },
    { key: 'policies_placed',    label: 'Policies Placed',    actual: metrics.placed,        snapKey: 'placed' },
    { key: 'total_calls',        label: 'Total Calls',        actual: metrics.totalCalls,    snapKey: 'calls' },
    { key: 'billable_calls',     label: 'Billable Calls',     actual: metrics.billable,      snapKey: 'billable' },
    { key: 'billable_rate',      label: 'Billable Rate',      actual: metrics.billableRate,  snapKey: 'billableRate', isRate: true },
    { key: 'monthly_premium',    label: 'Monthly Premium',    actual: metrics.totalPremium,  snapKey: 'premium' },
    { key: 'gross_adv_revenue',  label: 'Gross Adv Revenue',  actual: metrics.totalGAR,      snapKey: 'gar' },
    { key: 'lead_spend',         label: 'Lead Spend',         actual: metrics.totalLeadSpend, snapKey: 'leadSpend' },
    { key: 'agent_commission',   label: 'Agent Commission',   actual: metrics.totalComm,     snapKey: 'commission' },
    { key: 'net_revenue',        label: 'Net Revenue',        actual: metrics.netRevenue,    snapKey: 'netRevenue' },
    { key: 'cpa',                label: 'CPA',                actual: metrics.cpa,           snapKey: 'cpa',         isRate: true },
    { key: 'rpc',                label: 'RPC',                actual: metrics.rpc,           snapKey: 'rpc',         isRate: true },
    { key: 'close_rate',         label: 'Close Rate',         actual: metrics.closeRate,     snapKey: 'closeRate',   isRate: true },
    { key: 'placement_rate',     label: 'Placement Rate',     actual: metrics.placementRate, snapKey: 'placementRate', isRate: true },
    { key: 'premium_cost_ratio', label: 'Premium:Cost',       actual: metrics.premCost,      snapKey: 'premCost',    isRate: true },
    { key: 'avg_premium',        label: 'Avg Premium',        actual: metrics.avgPremium,    snapKey: 'avgPremium',  isRate: true },
  ];

  for (const m of metricDefs) {
    const meta = companyMeta[m.key] || {};
    const lower = meta.lower || false;
    const yellowPct = (meta.yellow || 80) / 100;

    // Goal-based alert
    const goal = goals[m.key];
    if (goal && m.actual) {
      const ratio = lower ? goal / m.actual : m.actual / goal;
      if (ratio < yellowPct) {
        alerts.push({ kind: 'goal-miss', metric: m.label, actual: m.actual, goal, status: 'red', lower });
      } else if (ratio < 1) {
        alerts.push({ kind: 'goal-miss', metric: m.label, actual: m.actual, goal, status: 'yellow', lower });
      }
    }

    // Historical-anomaly alert (independent of goal)
    const b = companyBaselines[m.snapKey];
    if (b && b.z != null) {
      // For "lower is better" metrics, a high z (spike up) is bad; for normal metrics, a low z (drop) is bad.
      const badZ = lower ? b.z : -b.z;
      if (badZ >= 1.5 || b.worstInN) {
        alerts.push({
          kind: 'historical-anomaly',
          metric: m.label,
          actual: m.actual,
          status: badZ >= 2.5 ? 'red' : 'yellow',
          lower,
          z: b.z,
          avg30: b.avg30,
          worstInN: b.worstInN || false,
        });
      }
    }
  }

  return alerts;
}
```

- [ ] **Step 2: Pass baselines into the call site**

Find `const companyAlerts = computeAlerts({ ... }, cg, cm);` (around line 183). Move both that call and the subsequent `const allAlerts = [...companyAlerts, ...agentAlerts];` line to AFTER the `baselines` compute block (from Task 9). Also move the Task 8 snapshot-write block so it runs AFTER the moved `allAlerts` assignment (ordering: agent-alerts → baselines → company-alerts → allAlerts → snapshot-write → BUILD NARRATIVE CONTEXT). Change the `computeAlerts` call to:

```js
    const companyAlerts = computeAlerts({
      apps, placed: placed.length, totalCalls, billable, billableRate,
      totalPremium, totalGAR, totalLeadSpend, totalComm, netRevenue,
      cpa, rpc, closeRate, placementRate, premCost, avgPremium,
    }, cg, cm, baselines.company);
```

Then re-compute `allAlerts = [...companyAlerts, ...agentAlerts];` immediately after.

- [ ] **Step 3: Verify**

```bash
curl -s "http://localhost:3003/api/daily-summary?start=2026-04-20&end=2026-04-20" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(json.dumps([a for a in d.get('alerts',[]) if a.get('kind')=='historical-anomaly'], indent=2))"
```

Expected: either an empty list (if today was unremarkable) or alerts with `kind: 'historical-anomaly'`, `z`, `avg30`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/daily-summary/route.js
git commit -m "Add historical-anomaly alerts (z-score + worst-in-14) alongside goal-miss"
```

---

### Task 11: Teach the AI system prompt to use baselines

**Files:**
- Modify: `src/app/api/daily-summary/route.js`

- [ ] **Step 1: Extend the system prompt**

Locate the `role: 'system'` content string (starts with `You are a senior insurance call center performance analyst.`). Replace the `ANALYSIS RULES:` block with:

```
ANALYSIS RULES:
- Do NOT just restate numbers. Identify CAUSES and CORRELATIONS.
- Use the COMPANY/AGENT/CAMPAIGN BASELINES block: always compare today to avg7/avg30, call out z-scores, and flag "best/worst in 14" events.
- When a day had high sales, explain what was different using the baseline deltas (more agents available vs their 30-day norm? a campaign spiked conversion vs its avg30?).
- When a day was weak, explain what broke down in baseline terms (which agent's availability dropped vs their norm; which campaign went from producing to burning cash).
- Prefer percentage deltas vs avg30 ("CPA 27% worse than 30-day avg") over raw numbers alone.
- Be specific: name the agent or campaign, cite today's value and the baseline comparator.
- Do NOT mention "policies placed" or "placement rate."
- Return ONLY valid JSON — no markdown, no code fences, no extra text.
```

- [ ] **Step 2: Extend the user prompt's per-section questions**

In the user-message content, replace each section question with the baseline-aware version:

- `DAILY OVERVIEW — ...` → add the phrase "**Relate today's values to avg7/avg30; call out any z > 1.5 or best/worst-in-14.**" after the existing question.
- `PUBLISHER PERFORMANCE — ...` → add "**Identify each campaign's delta vs its own avg30. A campaign producing above its norm is worth scaling; one spending above its norm with sales below its norm is bleeding.**"
- `AGENT ACTIVITY — ...` → add "**For each top agent, compare today's apps/premium/availPct to their avg30. Flag agents having a materially worse day than their own baseline.**"

- [ ] **Step 3: Verify a fresh generation**

Delete today's cached AI row (manually in the `AI Summary Cache` tab) OR temporarily bypass the cache by changing `cacheHit` to `false` in the route. Then:

```bash
curl -s "http://localhost:3003/api/daily-summary?start=2026-04-20&end=2026-04-20" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('narrative',''));print('---');print((d.get('tableSummaries') or {}).get('publishers',''))"
```

Expected: narrative mentions historical context (words like "vs 30-day avg", "worst in", "up/down N%", z-score citations, or specific agent/campaign delta comparisons). If the narrative is still purely descriptive, the baselines block isn't reaching the prompt — re-check Task 9 Step 3.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/daily-summary/route.js
git commit -m "Teach briefing AI to cite baselines, deltas, and best/worst-in-N"
```

---

### Task 12: Delta chips in email template

**Files:**
- Modify: `src/lib/email-templates.js`

- [ ] **Step 1: Accept `baselines` and render a delta chip helper**

At the top of `buildDailySummaryEmail`, change the destructure and add a chip helper:

```js
export function buildDailySummaryEmail(summary) {
  const { date, sales, financials, calls, agentPerf, alerts, baselines } = summary;
  const fmt = (n, d = 0) => n != null ? n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
  const fmtD = (n, d = 0) => n != null ? (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
  const fmtP = n => n != null ? n.toFixed(1) + '%' : '—';

  // Delta chip: ↑N% in green if good, ↓N% in red if bad. `lower=true` inverts (CPA going up is bad).
  const deltaChip = (metricKey, lower = false) => {
    const b = baselines?.company?.[metricKey];
    if (!b || b.deltaPct == null) return '';
    const pct = b.deltaPct * 100;
    const goodUp = !lower;
    const isGood = goodUp ? pct >= 0 : pct <= 0;
    const color = Math.abs(pct) < 5 ? '#8fa3be' : (isGood ? '#4ade80' : '#f87171');
    const arrow = pct >= 0 ? '↑' : '↓';
    return `<span style="color:${color};font-size:10px;margin-left:6px">${arrow}${Math.abs(pct).toFixed(0)}% vs 30d</span>`;
  };
```

- [ ] **Step 2: Add the chip to each of the four KPI cards**

In the KPI cards block (currently around lines 67–84 in the pre-change file), change each of the four value `<div>` lines:

```html
<div style="color:#f0f3f9;font-size:20px;font-weight:800;margin-top:4px">${fmtD(financials.cpa)}${deltaChip('cpa', true)}</div>
```

```html
<div style="color:#4ade80;font-size:20px;font-weight:800;margin-top:4px">${fmtD(financials.gar)}${deltaChip('gar')}</div>
```

```html
<div style="color:${financials.netRevenue >= 0 ? '#4ade80' : '#f87171'};font-size:20px;font-weight:800;margin-top:4px">${fmtD(financials.netRevenue)}${deltaChip('netRevenue')}</div>
```

```html
<div style="color:#f0f3f9;font-size:20px;font-weight:800;margin-top:4px">${fmtP(financials.closeRate)}${deltaChip('closeRate')}</div>
```

- [ ] **Step 3: Verify the email rendering**

Use the dev-only cron trigger route (or open `/daily-summary` page) to inspect. If the cron route is secret-gated, temporarily bypass by running with no `CRON_SECRET` locally. Alternatively, hit daily-summary directly and save HTML:

```bash
curl -s "http://localhost:3003/api/daily-summary?start=2026-04-20&end=2026-04-20" > /tmp/s.json
node -e "const fs=require('fs');const {buildDailySummaryEmail}=require('./src/lib/email-templates.js');fs.writeFileSync('/tmp/email.html', buildDailySummaryEmail(JSON.parse(fs.readFileSync('/tmp/s.json'))))"
open /tmp/email.html
```

Expected: KPI cards show a small `↑N% vs 30d` / `↓N% vs 30d` chip next to each value. CPA chip turning red when CPA went UP (because `lower=true`). Gross Revenue chip green when GAR went up.

- [ ] **Step 4: Commit**

```bash
git add src/lib/email-templates.js
git commit -m "Render WoW/30-day delta chips on daily summary email KPI cards"
```

---

### Task 13: Delta chips in DailySummaryPage

**Files:**
- Modify: `src/components/DailySummaryPage.jsx`

- [ ] **Step 1: Add a `DeltaChip` component and thread `baselines` through**

Inside `src/components/DailySummaryPage.jsx`, right after the existing `KPI` component definition (around line 23), add:

```jsx
function DeltaChip({ baseline, lower = false }) {
  if (!baseline || baseline.deltaPct == null) return null;
  const pct = baseline.deltaPct * 100;
  const isGood = lower ? pct <= 0 : pct >= 0;
  const color = Math.abs(pct) < 5 ? C.muted : (isGood ? C.green : C.red);
  const arrow = pct >= 0 ? '↑' : '↓';
  return (
    <span style={{ color, fontSize: 10, marginLeft: 6, fontFamily: C.sans, fontWeight: 500 }}>
      {arrow}{Math.abs(pct).toFixed(0)}% vs 30d
    </span>
  );
}
```

- [ ] **Step 2: Modify the `KPI` component to accept an optional chip child**

Replace the `KPI` component with:

```jsx
function KPI({ label, value, color, chip }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 16px', flex: '1 1 140px', minWidth: 140 }}>
      <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || C.text, marginTop: 4, fontFamily: C.mono }}>
        {value}{chip}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Pass chips to the KPI calls**

Find each `<KPI ... />` call in the financials row (search for `label="CPA"`, `label="Gross Revenue"`, etc.) and add the `chip` prop using the data in `summary.baselines`:

```jsx
<KPI label="CPA" value={fmtD(financials.cpa)}
     chip={<DeltaChip baseline={summary.baselines?.company?.cpa} lower />} />
<KPI label="Gross Revenue" value={fmtD(financials.gar)} color={C.green}
     chip={<DeltaChip baseline={summary.baselines?.company?.gar} />} />
<KPI label="Net Revenue" value={fmtD(financials.netRevenue)} color={financials.netRevenue >= 0 ? C.green : C.red}
     chip={<DeltaChip baseline={summary.baselines?.company?.netRevenue} />} />
<KPI label="Close Rate" value={fmtP(financials.closeRate)}
     chip={<DeltaChip baseline={summary.baselines?.company?.closeRate} />} />
```

(If the existing JSX has different KPI labels or props, preserve those and only add the `chip` prop and `DeltaChip` wrapping.)

- [ ] **Step 4: Verify in the browser**

Visit `http://localhost:3003/daily-summary` (or whatever route renders `DailySummaryPage`). Select a recent date. KPI cards should show the chips. Hover / inspect to confirm colors: CPA rising → red arrow; GAR rising → green arrow.

- [ ] **Step 5: Commit**

```bash
git add src/components/DailySummaryPage.jsx
git commit -m "Render baseline delta chips on DailySummaryPage KPI cards"
```

---

### Task 14: Backfill snapshots from earliest call date

**Files:** (no code changes — operational task)

- [ ] **Step 1: Use the discovered range**

Earliest call-log date is `2026-02-02` (first day where both policies AND calls exist). Backfilling earlier than this would pollute baselines with zero-call days (infinite CPA, undefined close rate). Range:

- start = `2026-02-02`
- end = `2026-04-20` (yesterday — today is 2026-04-21, don't overwrite in-progress day)

That's ~79 days.

- [ ] **Step 2: Run the backfill in chunks of 15 days**

15-day chunks keep the Vercel 60s cap comfortable. Against the local dev server:

```bash
for START in 2026-02-02 2026-02-17 2026-03-04 2026-03-19 2026-04-03 2026-04-18; do
  END=$(python3 -c "from datetime import date,timedelta;print((date.fromisoformat('$START')+timedelta(days=14)).isoformat())")
  if [ "$END" \> "2026-04-20" ]; then END=2026-04-20; fi
  echo "--- $START to $END ---"
  curl -s "http://localhost:3003/api/cron/backfill-snapshots?start=$START&end=$END" \
    | python3 -c "import sys,json;d=json.load(sys.stdin);print('count=%d failed=%d'%(d.get('count',0),d.get('failed',0)))"
done
```

Expected: each chunk reports `count=15 failed=0` (last chunk may be shorter). If any chunk reports failures, rerun it with a narrower range to find the bad day.

- [ ] **Step 3: Sanity check the three tabs**

- Company tab: ~90 rows, one per business day (weekends may have very small or zero rows, which is fine).
- Agents tab: several hundred rows; verify at least one row for each known agent.
- Campaigns tab: several hundred rows; verify every active publisher code from `byCampaign` is present at least once.

- [ ] **Step 4: Regenerate today's briefing with full baselines available**

Delete today's row (if any) from the `AI Summary Cache` tab. Then:

```bash
curl -s "http://localhost:3003/api/daily-summary?start=2026-04-21&end=2026-04-21" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('narrative',''))"
```

Expected: narrative now cites real 30-day averages and z-scores for specific agents/campaigns.

- [ ] **Step 5: Commit the backfill log (optional)**

No code change to commit. You may optionally capture the verification output in a short note:

```bash
git commit --allow-empty -m "Backfill snapshots 2026-02-02 to 2026-04-20 (~79 days)"
```

---

### Task 15: Deploy-time documentation update

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Append a "Recent Changes (Apr 2026)" entry documenting the new system**

Find the most recent "## Recent Changes (Mar 2026)" section in `CLAUDE.md` and add a new section beneath it:

```markdown
## Recent Changes (Apr 2026)

1. **Historical Baselines System** — Daily snapshots of company, per-agent, and per-campaign metrics are written to three tabs in the Goals sheet (`Daily Snapshots Company`, `Daily Snapshots Agents`, `Daily Snapshots Campaigns`) by `/api/daily-summary` on each daily-mode run. A pure library `src/lib/baselines.js` computes `prev`, `avg7`, `avg30`, `stdev30`, `z`, `trend7`, `bestInN`, and `worstInN` per metric. The daily briefing injects a `BASELINES:` block into the GPT-4o context, so narratives can cite WoW deltas and z-score anomalies.
2. **Dual-Signal Alerts** — `computeAlerts` now returns both `goal-miss` alerts (unchanged behavior) AND `historical-anomaly` alerts triggered when a metric's z-score vs its own 30-day history exceeds ±1.5, or when the day is the worst in 14.
3. **Backfill Endpoint** — `/api/cron/backfill-snapshots?start=YYYY-MM-DD&end=YYYY-MM-DD` iterates a date range calling `/api/snapshots/write` per day. Secret-gated via `CRON_SECRET`.
4. **Delta Chips** — Daily summary email and `DailySummaryPage` now show a `↑/↓ N% vs 30d` chip on each KPI card, colored red/green based on direction and the metric's "higher/lower is better" convention.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "Document baselines system in CLAUDE.md"
```

---

## Verification at the end

After all 15 tasks, confirm the following all work from a cold browser session:

1. `http://localhost:3003/api/snapshots/init` → `ok: true`, tabs exist.
2. `http://localhost:3003/api/snapshots/write?date=2026-04-20` → `ok: true`, idempotent on re-run.
3. Today's daily summary response includes a populated `baselines` field AND a narrative that cites 30-day averages or z-scores.
4. Email render (Task 12 Step 3) shows delta chips.
5. DailySummaryPage shows delta chips.
6. At least one `historical-anomaly` alert exists in the response when a metric clearly outperforms or underperforms history.

If any of those six items fails, walk back to the last successful task and diagnose before proceeding.

---

## Out of scope (explicitly not in v1)

- Weekly-mode baseline comparisons (today's baselines only fire when `mode === 'daily'` and `start === end`). Weekly summaries keep their current behavior. Add in v2 once we see how v1 reads.
- Per-carrier baselines (we snapshot carrier data only indirectly via agent/campaign). Add in v2 if needed.
- Imputing zeros for missing days. Series simply skip missing dates; averages are over present days only.
- Migrating off Google Sheets.
