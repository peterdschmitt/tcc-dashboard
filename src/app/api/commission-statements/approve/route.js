export const dynamic = 'force-dynamic';
import { readRawSheet, getSheetsClient, writeCell, invalidateCache } from '@/lib/sheets';
import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const body = await request.json();
    const { actions } = body;

    if (!actions || !Array.isArray(actions) || actions.length === 0) {
      return NextResponse.json({ error: 'actions array required' }, { status: 400 });
    }

    const salesSheetId = process.env.SALES_SHEET_ID;
    const ledgerTab = process.env.COMMISSION_LEDGER_TAB || 'Commission Ledger';
    const salesTab = process.env.SALES_TAB_NAME || 'Sheet1';
    const changeHistoryTab = process.env.CHANGE_HISTORY_TAB || 'Change History';

    // Read ledger to find rows by transaction ID
    const { headers: ledgerHeaders, data: ledgerData } = await readRawSheet(salesSheetId, ledgerTab);
    const statusColIdx = ledgerHeaders.indexOf('Status');
    const matchedPolicyColIdx = ledgerHeaders.indexOf('Matched Policy #');
    const notesColIdx = ledgerHeaders.indexOf('Notes');

    // Read sales tracker for Policy Status updates
    const { headers: salesHeaders, data: salesData } = await readRawSheet(salesSheetId, salesTab);

    const sheets = await getSheetsClient();
    const results = [];
    const changeHistoryRows = [];

    for (const action of actions) {
      const { transactionId, action: actionType, manualPolicyNumber, notes } = action;

      // Find the ledger row
      const ledgerRow = ledgerData.find(r => r['Transaction ID'] === transactionId);
      if (!ledgerRow) {
        results.push({ transactionId, success: false, error: 'Transaction not found' });
        continue;
      }

      const rowIndex = ledgerRow._rowIndex;
      const policyNumber = ledgerRow['Policy #'];
      const insuredName = ledgerRow['Insured Name'];

      try {
        if (actionType === 'approve_match' || actionType === 'approve_cancel') {
          // Update ledger status to 'approved'
          await writeCell(salesSheetId, ledgerTab, rowIndex, 'Status', 'approved');

          if (notes) {
            await writeCell(salesSheetId, ledgerTab, rowIndex, 'Notes', notes);
          }

          // If approve_cancel: update Policy Status in sales tracker
          if (actionType === 'approve_cancel') {
            const matchedPolicy = manualPolicyNumber || ledgerRow['Matched Policy #'];
            if (matchedPolicy) {
              // Find the sales row
              const salesRow = salesData.find(r => (r['Policy #'] || '').trim() === matchedPolicy);
              if (salesRow) {
                const oldStatus = salesRow['Policy Status']?.trim() || salesRow['Placed?']?.trim() || 'Unknown';
                await writeCell(salesSheetId, salesTab, salesRow._rowIndex, 'Policy Status', 'Cancelled');

                // Append to Change History
                changeHistoryRows.push([
                  new Date().toISOString().split('T')[0],
                  matchedPolicy,
                  policyNumber,
                  insuredName,
                  salesRow['Agent'] || '',
                  'Policy Status',
                  oldStatus,
                  'Cancelled',
                  'Commission Statement',
                ]);
              }
            }
          }

          results.push({ transactionId, success: true, action: actionType });
        } else if (actionType === 'reject_match' || actionType === 'reject_cancel') {
          await writeCell(salesSheetId, ledgerTab, rowIndex, 'Status', 'rejected');
          if (notes) {
            await writeCell(salesSheetId, ledgerTab, rowIndex, 'Notes', notes);
          }
          results.push({ transactionId, success: true, action: actionType });
        } else if (actionType === 'manual_match') {
          if (!manualPolicyNumber) {
            results.push({ transactionId, success: false, error: 'manualPolicyNumber required' });
            continue;
          }
          await writeCell(salesSheetId, ledgerTab, rowIndex, 'Matched Policy #', manualPolicyNumber);
          await writeCell(salesSheetId, ledgerTab, rowIndex, 'Match Type', 'manual');
          await writeCell(salesSheetId, ledgerTab, rowIndex, 'Match Confidence', '1.00');
          await writeCell(salesSheetId, ledgerTab, rowIndex, 'Status', 'approved');
          if (notes) {
            await writeCell(salesSheetId, ledgerTab, rowIndex, 'Notes', notes);
          }
          results.push({ transactionId, success: true, action: actionType });
        } else {
          results.push({ transactionId, success: false, error: `Unknown action: ${actionType}` });
        }
      } catch (err) {
        results.push({ transactionId, success: false, error: err.message });
      }
    }

    // Batch write change history rows
    if (changeHistoryRows.length > 0) {
      const goalsSheetId = process.env.GOALS_SHEET_ID;
      try {
        await sheets.spreadsheets.values.append({
          spreadsheetId: goalsSheetId,
          range: changeHistoryTab,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: changeHistoryRows },
        });
      } catch (e) {
        console.warn(`[commission-approve] Could not write change history: ${e.message}`);
      }
    }

    // Invalidate caches
    invalidateCache(salesSheetId, ledgerTab);
    invalidateCache(salesSheetId, salesTab);

    const successCount = results.filter(r => r.success).length;
    return NextResponse.json({
      success: true,
      updated: successCount,
      errors: results.filter(r => !r.success),
      results,
    });
  } catch (error) {
    console.error('[commission-approve] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
