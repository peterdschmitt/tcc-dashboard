export const dynamic = 'force-dynamic';
import { fetchSheet, getSheetsClient, invalidateCache } from '@/lib/sheets';
import { NextResponse } from 'next/server';

/**
 * GET  /api/commission-statements/dedup          — preview duplicates (dry run)
 * POST /api/commission-statements/dedup          — remove duplicates from ledger sheet
 */

// Normalize "01/06/2026" / "1/6/2026" / "2026-01-06" → "2026-01-06"
function normalizeDate(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  const mdy = s.match(/^(\d{1,2})[\-\/](\d{1,2})[\-\/](\d{4})/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  const ymd = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  return s;
}
// Normalize "$336.96", "336.96", " 336.96 ", "336.96000" → "336.96"
function normalizeAmount(raw) {
  const n = parseFloat(String(raw || '').replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? '0' : n.toFixed(2);
}
// Strip common organize-prefix so "Transamerica_2026-02_2026-02-03_X.xls" and "X.xls" collapse to the same core filename.
// Also fold spaces/hyphens/underscores/dots together — organize rename replaces spaces with hyphens,
// so "TA Advance report 2.4.26.xls" and "TA-Advance-report-2.4.26.xls" should compare equal.
function normalizeFilename(raw) {
  if (!raw) return '';
  let s = String(raw).trim()
    .replace(/^(AmAmicable|AIG|CICA|Transamerica)_\d{4}-\d{2}_\d{4}-\d{2}-\d{2}_/i, '')
    .toLowerCase();
  s = s.replace(/\.(pdf|csv|xlsx?|xls)$/i, '');
  s = s.replace(/[\s\-_.]+/g, '');
  return s;
}
// Primary key — exact match required
function buildKey(row) {
  return [
    (row['Policy #'] || '').trim(),
    normalizeDate(row['Statement Date'] || ''),
    normalizeAmount(row['Commission Amount']),
    (row['Transaction Type'] || '').trim().toLowerCase(),
    (row['Agent ID'] || '').trim(),
  ].join('|');
}
// Fallback key — same policy + amount + type + agent + same source file (ignoring org-prefix),
// used only when the primary key didn't match but the row is clearly the same payment.
function buildFileKey(row) {
  const file = normalizeFilename(row['Statement File'] || '');
  if (!file) return null;
  return [
    (row['Policy #'] || '').trim(),
    normalizeAmount(row['Commission Amount']),
    (row['Transaction Type'] || '').trim().toLowerCase(),
    (row['Agent ID'] || '').trim(),
    file,
  ].join('|');
}

export async function GET() {
  try {
    const salesSheetId = process.env.SALES_SHEET_ID;
    const ledgerTab = process.env.COMMISSION_LEDGER_TAB || 'Commission Ledger';
    const rows = await fetchSheet(salesSheetId, ledgerTab, 0);

    const seen = new Map();
    const seenFile = new Map();
    const duplicates = [];
    for (let i = 0; i < rows.length; i++) {
      const key = buildKey(rows[i]);
      const fk = buildFileKey(rows[i]);
      let dupOfRow = null;
      if (seen.has(key))         dupOfRow = seen.get(key);
      else if (fk && seenFile.has(fk)) dupOfRow = seenFile.get(fk);

      if (dupOfRow !== null) {
        duplicates.push({
          rowIndex: i,
          policyNumber: (rows[i]['Policy #'] || '').trim(),
          statementDate: (rows[i]['Statement Date'] || '').trim(),
          amount: rows[i]['Commission Amount'] || '0',
          type: rows[i]['Transaction Type'] || '',
          file: (rows[i]['Statement File'] || '').trim(),
          firstSeenRow: dupOfRow,
        });
      } else {
        seen.set(key, i);
        if (fk) seenFile.set(fk, i);
      }
    }

    return NextResponse.json({
      totalRows: rows.length,
      uniqueRows: seen.size,
      duplicateRows: duplicates.length,
      duplicates: duplicates.slice(0, 50), // preview first 50
    });
  } catch (error) {
    console.error('[dedup] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST() {
  try {
    const salesSheetId = process.env.SALES_SHEET_ID;
    const ledgerTab = process.env.COMMISSION_LEDGER_TAB || 'Commission Ledger';

    // Fetch raw values (with header row)
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: salesSheetId,
      range: ledgerTab,
    });
    const allValues = res.data.values || [];
    if (allValues.length < 2) {
      return NextResponse.json({ message: 'No data rows to dedup', removed: 0 });
    }

    const headerRow = allValues[0];
    const dataRows = allValues.slice(1);

    // Find column indices for dedup key
    const colIdx = {
      policyNum: headerRow.indexOf('Policy #'),
      stmtDate: headerRow.indexOf('Statement Date'),
      commAmount: headerRow.indexOf('Commission Amount'),
      txnType: headerRow.indexOf('Transaction Type'),
      agentId: headerRow.indexOf('Agent ID'),
      stmtFile: headerRow.indexOf('Statement File'),
    };

    function rowKey(row) {
      return [
        (row[colIdx.policyNum] || '').trim(),
        normalizeDate(row[colIdx.stmtDate] || ''),
        normalizeAmount(row[colIdx.commAmount]),
        (row[colIdx.txnType] || '').trim().toLowerCase(),
        (row[colIdx.agentId] || '').trim(),
      ].join('|');
    }
    function rowFileKey(row) {
      const file = normalizeFilename(row[colIdx.stmtFile] || '');
      if (!file) return null;
      return [
        (row[colIdx.policyNum] || '').trim(),
        normalizeAmount(row[colIdx.commAmount]),
        (row[colIdx.txnType] || '').trim().toLowerCase(),
        (row[colIdx.agentId] || '').trim(),
        file,
      ].join('|');
    }

    const seen = new Set();
    const seenFile = new Set();
    const uniqueRows = [];
    let removed = 0;
    for (const row of dataRows) {
      const key = rowKey(row);
      const fk = rowFileKey(row);
      if (seen.has(key))                  { removed++; continue; }
      if (fk && seenFile.has(fk))         { removed++; continue; }
      seen.add(key);
      if (fk) seenFile.add(fk);
      uniqueRows.push(row);
    }

    if (removed === 0) {
      return NextResponse.json({ message: 'No duplicates found', removed: 0 });
    }

    // Clear the sheet and rewrite with deduped data
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

    return NextResponse.json({
      message: `Removed ${removed} duplicate rows`,
      removed,
      before: dataRows.length,
      after: uniqueRows.length,
    });
  } catch (error) {
    console.error('[dedup] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
