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
  // Exclude error entries so the next run retries them. A row's hash
  // sticks in the dedup set only after a successful (non-error) outcome.
  return new Set(
    data
      .filter(r => r['Action'] !== 'error')
      .map(r => r['Row Hash'])
      .filter(Boolean)
  );
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

/**
 * Batch-append multiple rows to a sheet tab in a single API call.
 * Used to avoid hitting Google Sheets' 60-writes/min quota during
 * large backfills. Falls back to single appendRow if only one entry.
 */
async function appendRowsBatch(sheetId, tabName, headers, entries) {
  if (!entries || entries.length === 0) return;
  if (entries.length === 1) {
    await appendRow(sheetId, tabName, headers, entries[0]);
    return;
  }
  const sheets = await getSheetsClient();
  const values = entries.map(entry => headers.map(h => entry[h] ?? ''));
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: tabName,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });
}

export async function appendSyncLogBatch(entries) {
  await appendRowsBatch(GOALS_SHEET(), SYNC_LOG_TAB, SYNC_LOG_HEADERS, entries);
}

export async function appendPossibleMergeBatch(entries) {
  await appendRowsBatch(GOALS_SHEET(), POSSIBLE_MERGES_TAB, POSSIBLE_MERGES_HEADERS, entries);
}

/**
 * Parse a Call Log date string (e.g. "04/24/2026 9:17:02 AM") into a
 * Unix timestamp (ms). Returns 0 for empty/unparseable input.
 *
 * Why this exists: Call Logs use MM/DD/YYYY h:mm[:ss] AM/PM format,
 * which doesn't sort correctly as a string. We parse to timestamp
 * for any date comparison (watermark, backfill range filtering).
 */
export function parseCallLogDate(s) {
  if (!s) return 0;
  const t = Date.parse(s);
  return isNaN(t) ? 0 : t;
}

/**
 * Returns rows from the Call Logs sheet whose `Date` column parses to
 * a timestamp strictly greater than the watermark (also parsed). Empty
 * watermark returns all rows.
 *
 * Note: we use `Date` (the actual call timestamp), not `Import Date`,
 * because Import Date can be ancient (the dialer's "first imported"
 * date for a lead can be years old even when the row was just added).
 */
export async function readNewCallLogRows(watermark) {
  const { data } = await readRawSheet(CALLLOGS_SHEET(), CALLLOGS_TAB());
  const wmTs = parseCallLogDate(watermark);
  if (!wmTs) return data;
  return data.filter(r => parseCallLogDate(r['Date']) > wmTs);
}
