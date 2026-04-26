// Dedup logic for the Commission Ledger tab. Extracted so it can be
// called inline from upload + sync-drive routes (auto-dedup) in addition
// to the manual /api/commission-statements/dedup endpoint.
//
// The same row-keying rules live here once and are referenced by both the
// preview (GET) and write (POST) sides of the dedup route.

import { getSheetsClient, invalidateCache } from './sheets';

// "01/06/2026" / "1/6/2026" / "2026-01-06" → "2026-01-06"
export function normalizeDate(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  const mdy = s.match(/^(\d{1,2})[\-\/](\d{1,2})[\-\/](\d{4})/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  const ymd = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  return s;
}

// "$336.96", "336.96", " 336.96 ", "336.96000" → "336.96"
export function normalizeAmount(raw) {
  const n = parseFloat(String(raw || '').replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? '0' : n.toFixed(2);
}

// Strip Drive-organize prefix and fold separators so the same source file
// uploaded under different names collapses to the same key.
export function normalizeFilename(raw) {
  if (!raw) return '';
  let s = String(raw).trim()
    .replace(/^(AmAmicable|AIG|CICA|Transamerica)_\d{4}-\d{2}_\d{4}-\d{2}-\d{2}_/i, '')
    .toLowerCase();
  s = s.replace(/\.(pdf|csv|xlsx?|xls)$/i, '');
  s = s.replace(/[\s\-_.]+/g, '');
  return s;
}

function buildPrimaryKey(get) {
  return [
    (get('Policy #') || '').trim(),
    normalizeDate(get('Statement Date') || ''),
    normalizeAmount(get('Commission Amount')),
    (get('Transaction Type') || '').trim().toLowerCase(),
    (get('Agent ID') || '').trim(),
  ].join('|');
}

function buildFileKey(get) {
  const file = normalizeFilename(get('Statement File') || '');
  if (!file) return null;
  return [
    (get('Policy #') || '').trim(),
    normalizeAmount(get('Commission Amount')),
    (get('Transaction Type') || '').trim().toLowerCase(),
    (get('Agent ID') || '').trim(),
    file,
  ].join('|');
}

/**
 * Idempotent dedup of the Commission Ledger.
 * - Reads the entire tab
 * - Detects duplicates using primary key (policy + date + amount + type + agentId)
 *   with a fallback file key (same minus date, plus normalized filename) for
 *   re-ingests of the same file under a different name.
 * - Clears + rewrites the tab with unique rows only when removals are needed.
 * - Returns { removed, before, after }. Does NOT trigger a Holder Records rebuild;
 *   callers do that themselves so they can sequence it with their own logic.
 */
export async function dedupLedger() {
  const salesSheetId = process.env.SALES_SHEET_ID;
  if (!salesSheetId) throw new Error('SALES_SHEET_ID env var is required');
  const ledgerTab = process.env.COMMISSION_LEDGER_TAB || 'Commission Ledger';

  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: salesSheetId,
    range: ledgerTab,
  });
  const allValues = res.data.values || [];
  if (allValues.length < 2) return { removed: 0, before: 0, after: 0 };

  const headerRow = allValues[0];
  const dataRows = allValues.slice(1);
  const headerIdx = new Map(headerRow.map((h, i) => [h, i]));
  const get = (row) => (name) => row[headerIdx.get(name)] ?? '';

  const seen = new Set();
  const seenFile = new Set();
  const uniqueRows = [];
  let removed = 0;
  for (const row of dataRows) {
    const accessor = get(row);
    const key = buildPrimaryKey(accessor);
    const fk = buildFileKey(accessor);
    if (seen.has(key)) { removed++; continue; }
    if (fk && seenFile.has(fk)) { removed++; continue; }
    seen.add(key);
    if (fk) seenFile.add(fk);
    uniqueRows.push(row);
  }

  if (removed === 0) return { removed: 0, before: dataRows.length, after: dataRows.length };

  await sheets.spreadsheets.values.clear({
    spreadsheetId: salesSheetId,
    range: ledgerTab,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: salesSheetId,
    range: ledgerTab,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [headerRow, ...uniqueRows] },
  });
  invalidateCache(salesSheetId, ledgerTab);
  console.log(`[dedup] Removed ${removed} duplicate rows from ${ledgerTab} (${dataRows.length} → ${uniqueRows.length})`);
  return { removed, before: dataRows.length, after: uniqueRows.length };
}
