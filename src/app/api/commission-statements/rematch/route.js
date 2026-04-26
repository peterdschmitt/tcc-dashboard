export const dynamic = 'force-dynamic';
import { fetchSheet, getSheetsClient, invalidateCache } from '@/lib/sheets';
import { fuzzyMatchPolicyholder } from '@/lib/utils';
import { NextResponse } from 'next/server';
import { rebuildStatementRecords } from '@/lib/statement-records-io';

/**
 * Re-matches every ledger row against the current sales tracker.
 * Priority:
 *   1. Exact policy # in tracker (highest — overrides any prior fuzzy match)
 *   2. Fuzzy name+agent fallback (only if no exact match)
 *
 * GET  — preview changes (dry run)
 * POST — write updates back to the ledger sheet
 */

function buildFuzzyInput(ledgerRow) {
  return {
    'Policy No.': (ledgerRow['Policy #'] || '').trim(),
    'Insured':    (ledgerRow['Insured Name'] || '').trim(),
    'Agent':      (ledgerRow['Agent'] || '').trim(),
  };
}

function recompute(ledgerRow, salesRows, trackerPolicyNums) {
  const rawPn = (ledgerRow['Policy #'] || '').trim();

  // Tier 1: exact policy # match
  if (rawPn && trackerPolicyNums.has(rawPn)) {
    return { matched: rawPn, matchType: 'policy_number', confidence: 1.0 };
  }

  // Tier 2: fuzzy name+agent
  const match = fuzzyMatchPolicyholder(buildFuzzyInput(ledgerRow), salesRows);
  if (match?.row) {
    return {
      matched: (match.row['Policy #'] || '').trim(),
      matchType: match.matchType || 'name_agent',
      confidence: match.confidence || 0,
    };
  }

  return { matched: '', matchType: 'unmatched', confidence: 0 };
}

export async function GET() {
  try {
    const salesSheetId = process.env.SALES_SHEET_ID;
    const ledgerTab = process.env.COMMISSION_LEDGER_TAB || 'Commission Ledger';

    const [salesRows, ledger] = await Promise.all([
      fetchSheet(salesSheetId, process.env.SALES_TAB_NAME || 'Sheet1', 0),
      fetchSheet(salesSheetId, ledgerTab, 0),
    ]);

    const trackerPolicyNums = new Set(salesRows.map(r => (r['Policy #'] || '').trim()).filter(Boolean));

    const changes = [];
    let exactFixed = 0, fuzzyChanged = 0, noChange = 0, stillUnmatched = 0;

    for (let i = 0; i < ledger.length; i++) {
      const r = ledger[i];
      const newMatch = recompute(r, salesRows, trackerPolicyNums);
      const oldMatched = (r['Matched Policy #'] || '').trim();
      const oldType = (r['Match Type'] || '').trim();

      if (newMatch.matched !== oldMatched || newMatch.matchType !== oldType) {
        const wasExact = newMatch.matchType === 'policy_number' && oldType !== 'policy_number';
        if (wasExact) exactFixed++;
        else if (newMatch.matched && newMatch.matched !== oldMatched) fuzzyChanged++;
        changes.push({
          rowIndex: i,
          policyNumber: (r['Policy #'] || '').trim(),
          insured: (r['Insured Name'] || '').trim(),
          oldMatched, oldType,
          newMatched: newMatch.matched,
          newType: newMatch.matchType,
          newConfidence: +newMatch.confidence.toFixed(2),
        });
      } else {
        noChange++;
      }

      if (newMatch.matchType === 'unmatched') stillUnmatched++;
    }

    return NextResponse.json({
      totalLedgerRows: ledger.length,
      changes: changes.length,
      exactPolicyFixed: exactFixed,
      fuzzyChanged,
      noChange,
      stillUnmatched,
      preview: changes.slice(0, 50),
    });
  } catch (err) {
    console.error('[rematch] GET error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST() {
  try {
    const salesSheetId = process.env.SALES_SHEET_ID;
    const ledgerTab = process.env.COMMISSION_LEDGER_TAB || 'Commission Ledger';

    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: salesSheetId, range: ledgerTab });
    const allValues = res.data.values || [];
    if (allValues.length < 2) return NextResponse.json({ message: 'No ledger rows', updated: 0 });

    const header = allValues[0];
    const dataRows = allValues.slice(1);
    const col = {
      policyNum:     header.indexOf('Policy #'),
      insuredName:   header.indexOf('Insured Name'),
      agent:         header.indexOf('Agent'),
      matchedPolicy: header.indexOf('Matched Policy #'),
      matchType:     header.indexOf('Match Type'),
      confidence:    header.indexOf('Match Confidence'),
    };

    const salesRows = await fetchSheet(salesSheetId, process.env.SALES_TAB_NAME || 'Sheet1', 0);
    const trackerPolicyNums = new Set(salesRows.map(r => (r['Policy #'] || '').trim()).filter(Boolean));

    const rowAsObj = row => ({
      'Policy #':     row[col.policyNum] || '',
      'Insured Name': row[col.insuredName] || '',
      'Agent':        row[col.agent] || '',
    });

    let updated = 0, exactFixed = 0;
    const newRows = dataRows.map(row => {
      const r = rowAsObj(row);
      const nm = recompute(r, salesRows, trackerPolicyNums);
      const oldMatched = (row[col.matchedPolicy] || '').trim();
      const oldType    = (row[col.matchType]   || '').trim();
      if (nm.matched !== oldMatched || nm.matchType !== oldType) {
        if (nm.matchType === 'policy_number' && oldType !== 'policy_number') exactFixed++;
        updated++;
        const copy = [...row];
        copy[col.matchedPolicy] = nm.matched;
        copy[col.matchType] = nm.matchType;
        copy[col.confidence] = String(nm.confidence.toFixed(2));
        return copy;
      }
      return row;
    });

    if (updated === 0) return NextResponse.json({ message: 'No changes needed', updated: 0 });

    await sheets.spreadsheets.values.update({
      spreadsheetId: salesSheetId,
      range: ledgerTab,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [header, ...newRows] },
    });
    invalidateCache(salesSheetId, ledgerTab);

    console.log(`[rematch] Updated ${updated} rows (${exactFixed} upgraded to exact policy match)`);
    let rebuildResult = null;
    try {
      rebuildResult = await rebuildStatementRecords();
    } catch (e) {
      console.error('[statement-records] rebuild failed (non-fatal):', e.message);
    }
    return NextResponse.json({ message: `Updated ${updated} rows`, updated, exactPolicyFixed: exactFixed, statementRecordsRebuild: rebuildResult });
  } catch (err) {
    console.error('[rematch] POST error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
