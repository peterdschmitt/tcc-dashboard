// src/lib/snapshots.js
import { ensureTabExists } from './sheets';

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
