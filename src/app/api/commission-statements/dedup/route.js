export const dynamic = 'force-dynamic';
import { fetchSheet, getSheetsClient, invalidateCache } from '@/lib/sheets';
import { NextResponse } from 'next/server';

/**
 * GET  /api/commission-statements/dedup          — preview duplicates (dry run)
 * POST /api/commission-statements/dedup          — remove duplicates from ledger sheet
 */

function buildKey(row) {
  return [
    (row['Policy #'] || '').trim(),
    (row['Statement Date'] || '').trim(),
    (row['Commission Amount'] || '0').trim(),
    (row['Transaction Type'] || '').trim(),
    (row['Agent ID'] || '').trim(),
  ].join('|');
}

export async function GET() {
  try {
    const salesSheetId = process.env.SALES_SHEET_ID;
    const ledgerTab = process.env.COMMISSION_LEDGER_TAB || 'Commission Ledger';
    const rows = await fetchSheet(salesSheetId, ledgerTab, 0);

    const seen = new Map();
    const duplicates = [];
    for (let i = 0; i < rows.length; i++) {
      const key = buildKey(rows[i]);
      if (seen.has(key)) {
        duplicates.push({
          rowIndex: i,
          policyNumber: (rows[i]['Policy #'] || '').trim(),
          statementDate: (rows[i]['Statement Date'] || '').trim(),
          amount: rows[i]['Commission Amount'] || '0',
          type: rows[i]['Transaction Type'] || '',
          firstSeenRow: seen.get(key),
        });
      } else {
        seen.set(key, i);
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
    };

    function rowKey(row) {
      return [
        (row[colIdx.policyNum] || '').trim(),
        (row[colIdx.stmtDate] || '').trim(),
        (row[colIdx.commAmount] || '0').trim(),
        (row[colIdx.txnType] || '').trim(),
        (row[colIdx.agentId] || '').trim(),
      ].join('|');
    }

    const seen = new Set();
    const uniqueRows = [];
    let removed = 0;
    for (const row of dataRows) {
      const key = rowKey(row);
      if (seen.has(key)) { removed++; continue; }
      seen.add(key);
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
