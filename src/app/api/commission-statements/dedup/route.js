export const dynamic = 'force-dynamic';
import { fetchSheet } from '@/lib/sheets';
import { NextResponse } from 'next/server';
import { rebuildStatementRecords } from '@/lib/statement-records-io';
import { dedupLedger, normalizeDate, normalizeAmount, normalizeFilename } from '@/lib/commission-statements-dedup';

/**
 * GET  /api/commission-statements/dedup  — preview duplicates (dry run)
 * POST /api/commission-statements/dedup  — remove duplicates from ledger sheet
 *
 * The actual dedup logic lives in src/lib/commission-statements-dedup.js so
 * upload + sync-drive routes can call it inline (auto-dedup before rebuild).
 */

function buildKey(row) {
  return [
    (row['Policy #'] || '').trim(),
    normalizeDate(row['Statement Date'] || ''),
    normalizeAmount(row['Commission Amount']),
    (row['Transaction Type'] || '').trim().toLowerCase(),
    (row['Agent ID'] || '').trim(),
  ].join('|');
}
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
      duplicates: duplicates.slice(0, 50),
    });
  } catch (error) {
    console.error('[dedup] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST() {
  try {
    const dedupResult = await dedupLedger();
    if (dedupResult.removed === 0) {
      return NextResponse.json({ message: 'No duplicates found', removed: 0, ...dedupResult });
    }
    let rebuildResult = null;
    try {
      rebuildResult = await rebuildStatementRecords();
    } catch (e) {
      console.error('[statement-records] rebuild failed (non-fatal):', e.message);
    }
    return NextResponse.json({
      message: `Removed ${dedupResult.removed} duplicate rows`,
      ...dedupResult,
      statementRecordsRebuild: rebuildResult,
    });
  } catch (error) {
    console.error('[dedup] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
