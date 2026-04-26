// src/lib/ghl/sheet-state.js
import { readRawSheet, appendRow, getSheetsClient } from '../sheets.js';

const GOALS_SHEET = () => process.env.GOALS_SHEET_ID;
const CALLLOGS_SHEET = () => process.env.CALLLOGS_SHEET_ID;
const CALLLOGS_TAB = () => process.env.CALLLOGS_TAB_NAME || 'Report';

const SYNC_LOG_TAB = 'GHL Sync Log';
const POSSIBLE_MERGES_TAB = 'GHL Possible Merges';
const EXCLUDED_TAB = 'GHL Excluded Campaigns';

const SYNC_LOG_HEADERS = ['Timestamp', 'Row Hash', 'Lead Id', 'Phone', 'First', 'Last', 'State', 'Tier', 'Action', 'GHL Contact ID', 'Error', 'High Water Mark'];
const POSSIBLE_MERGES_HEADERS = ['Timestamp', 'Existing GHL Contact ID', 'Existing Name', 'Existing Phone', 'New GHL Contact ID', 'New Name', 'New Phone', 'State', 'Reviewed'];

export async function readExcludedCampaigns() {
  const { data } = await readRawSheet(GOALS_SHEET(), EXCLUDED_TAB);
  return data;
}

export async function readSyncedHashes() {
  const { data } = await readRawSheet(GOALS_SHEET(), SYNC_LOG_TAB);
  return new Set(data.map(r => r['Row Hash']).filter(Boolean));
}

export async function readWatermark() {
  const sheets = await getSheetsClient();
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: GOALS_SHEET(),
    range: `${SYNC_LOG_TAB}!L2:L2`, // column L = "High Water Mark"
  });
  return r.data.values?.[0]?.[0] ?? '';
}

export async function writeWatermark(value) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: GOALS_SHEET(),
    range: `${SYNC_LOG_TAB}!L2`,
    valueInputOption: 'RAW',
    requestBody: { values: [[value]] },
  });
}

export async function appendSyncLog(entry) {
  await appendRow(GOALS_SHEET(), SYNC_LOG_TAB, SYNC_LOG_HEADERS, entry);
}

export async function appendPossibleMerge(entry) {
  await appendRow(GOALS_SHEET(), POSSIBLE_MERGES_TAB, POSSIBLE_MERGES_HEADERS, entry);
}

export async function readNewCallLogRows(watermark) {
  const { data } = await readRawSheet(CALLLOGS_SHEET(), CALLLOGS_TAB());
  if (!watermark) return data;
  return data.filter(r => (r['Import Date'] ?? '') > watermark);
}
