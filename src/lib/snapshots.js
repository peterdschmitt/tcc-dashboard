// src/lib/snapshots.js
import { ensureTabExists, getSheetsClient, fetchSheet, appendRow, invalidateCache } from './sheets';

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

/** Ensure the three Daily Snapshots tabs exist on GOALS_SHEET_ID, creating any that are missing. */
export async function ensureSnapshotTabs() {
  const sheetId = process.env.GOALS_SHEET_ID;
  if (!sheetId) throw new Error('GOALS_SHEET_ID not set');
  const created = [];
  for (const [tab, headers] of Object.entries(TAB_HEADERS)) {
    const wasCreated = await ensureTabExists(sheetId, tab, headers);
    if (wasCreated) created.push(tab);
  }
  return { sheetId, created };
}

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
    invalidateCache(sheetId, tabName);
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
