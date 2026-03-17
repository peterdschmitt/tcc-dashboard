export const dynamic = 'force-dynamic';
import { fetchSheet, readRawSheet, getSheetsClient, invalidateCache, writeCell } from '@/lib/sheets';
import { fuzzyMatchPolicyholder } from '@/lib/utils';
import { parseStatement } from '@/lib/parsers/index';
import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

// Commission Ledger column headers
const LEDGER_HEADERS = [
  'Transaction ID', 'Statement Date', 'Processing Date', 'Carrier',
  'Policy #', 'Insured Name', 'Agent', 'Transaction Type',
  'Premium', 'Commission Amount', 'Outstanding Balance',
  'Matched Policy #', 'Match Type', 'Match Confidence', 'Status',
  'Statement File', 'Notes',
];

// Commission Statements (metadata) headers
const STATEMENTS_HEADERS = [
  'Statement ID', 'Upload Date', 'Carrier', 'Statement Period',
  'File Name', 'File Type', 'Total Records', 'Matched', 'Unmatched',
  'Pending Review', 'Total Advances', 'Total Recoveries', 'Net Amount',
  'Cancellations Detected', 'Status',
];

export async function POST(request) {
  try {
    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get('file');
    const carrierHint = formData.get('carrier') || null;
    const dryRun = formData.get('dryRun') === 'true';

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const filename = file.name || 'unknown';
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileType = filename.toLowerCase().endsWith('.pdf') ? 'PDF'
      : filename.toLowerCase().match(/\.xlsx?$/) ? 'XLSX'
      : filename.toLowerCase().endsWith('.csv') ? 'CSV'
      : 'Unknown';

    console.log(`[commission-upload] Processing ${filename} (${fileType}, ${buffer.length} bytes)`);

    // Step 1: Parse the statement using carrier-specific parser
    const parsed = await parseStatement(buffer, filename, carrierHint === 'auto' ? null : carrierHint);
    console.log(`[commission-upload] Parsed ${parsed.records.length} records from ${parsed.carrier}`);

    // Step 2: Fetch sales tracker for matching
    const salesTab = process.env.SALES_TAB_NAME || 'Sheet1';
    const salesRows = await fetchSheet(process.env.SALES_SHEET_ID, salesTab, 0);

    // Enrich records with agent names from parsed agent summary
    const agentMap = {};
    (parsed.agentSummary || []).forEach(a => {
      agentMap[a.agentId] = a.agentName;
    });

    // Step 3: Match each record to policies and classify
    const statementId = randomUUID();
    const processingDate = new Date().toISOString().split('T')[0];
    const matchedRecords = [];
    const unmatchedRecords = [];
    const cancellationAlerts = [];
    let matchCount = 0, unmatchCount = 0, pendingCount = 0;
    let totalAdvances = 0, totalRecoveries = 0, cancellationsDetected = 0;

    for (const record of parsed.records) {
      // Enrich agent name
      if (record.agentId && agentMap[record.agentId]) {
        record.agent = agentMap[record.agentId];
      }

      // Track totals
      if (record.commissionAmount > 0) totalAdvances += record.commissionAmount;
      if (record.commissionAmount < 0) totalRecoveries += Math.abs(record.commissionAmount);

      // Match to sales tracker using existing fuzzy matching
      // Build a carrier-like record for the fuzzy matcher
      const carrierRecord = {
        'Policy No.': record.policyNumber,
        'Insured': record.insuredName,
        'Agent': record.agent,
      };
      const matchResult = fuzzyMatchPolicyholder(carrierRecord, salesRows);

      const transactionId = randomUUID();
      let matchedPolicy = null;
      let matchType = 'unmatched';
      let matchConfidence = 0;
      let status = 'unmatched';

      if (matchResult) {
        matchedPolicy = matchResult.row['Policy #'] || '';
        matchType = matchResult.matchType;
        matchConfidence = matchResult.confidence;

        if (matchConfidence >= 0.85) {
          status = 'auto_matched';
          matchCount++;
        } else if (matchConfidence >= 0.55) {
          status = 'pending_review';
          pendingCount++;
        } else {
          status = 'unmatched';
          unmatchCount++;
        }
      } else {
        unmatchCount++;
      }

      // Detect cancellations (override to pending_review for safety)
      if (record.cancellationIndicator && status !== 'unmatched') {
        cancellationsDetected++;
        // Even auto_matched cancellations need human approval
        if (status === 'auto_matched') {
          status = 'pending_review';
          matchCount--;
          pendingCount++;
        }

        const currentStatus = matchResult?.row?.['Policy Status']?.trim()
          || matchResult?.row?.['Placed?']?.trim()
          || 'Unknown';

        cancellationAlerts.push({
          transactionId,
          policyNumber: record.policyNumber,
          insuredName: record.insuredName,
          agent: record.agent,
          recoveryAmount: record.commissionAmount,
          outstandingBalance: record.outstandingBalance,
          currentPolicyStatus: currentStatus,
          matchedPolicy,
          matchConfidence,
        });
      }

      const enrichedRecord = {
        transactionId,
        policyNumber: record.policyNumber,
        insuredName: record.insuredName,
        agent: record.agent,
        agentId: record.agentId,
        transactionType: record.transactionType,
        commType: record.commType,
        premium: record.premium,
        commissionAmount: record.commissionAmount,
        outstandingBalance: record.outstandingBalance,
        product: record.product,
        effDate: record.effDate,
        matchedPolicy,
        matchType,
        matchConfidence,
        status,
        cancellationIndicator: record.cancellationIndicator || false,
        section: record.section,
      };

      if (status === 'unmatched') {
        unmatchedRecords.push(enrichedRecord);
      } else {
        matchedRecords.push(enrichedRecord);
      }
    }

    const netAmount = totalAdvances - totalRecoveries;
    const totalRecords = parsed.records.length;

    // Step 4: Write to Google Sheets (unless dry run)
    if (!dryRun && totalRecords > 0) {
      const sheets = await getSheetsClient();
      const salesSheetId = process.env.SALES_SHEET_ID;
      const ledgerTab = process.env.COMMISSION_LEDGER_TAB || 'Commission Ledger';
      const statementsTab = process.env.COMMISSION_STATEMENTS_TAB || 'Commission Statements';

      // Batch append all ledger rows
      const allRecords = [...matchedRecords, ...unmatchedRecords];
      const ledgerRows = allRecords.map(r => [
        r.transactionId,
        parsed.statementDate || parsed.payPeriod || processingDate,
        processingDate,
        parsed.carrier,
        r.policyNumber,
        r.insuredName,
        r.agent,
        r.transactionType,
        r.premium?.toFixed(2) || '0.00',
        r.commissionAmount?.toFixed(2) || '0.00',
        r.outstandingBalance?.toFixed(2) || '0.00',
        r.matchedPolicy || '',
        r.matchType,
        r.matchConfidence?.toFixed(2) || '0.00',
        r.status,
        filename,
        r.cancellationIndicator ? 'Cancellation detected - pending review' : '',
      ]);

      await sheets.spreadsheets.values.append({
        spreadsheetId: salesSheetId,
        range: ledgerTab,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: ledgerRows },
      });
      console.log(`[commission-upload] Wrote ${ledgerRows.length} ledger rows`);

      // Write statement metadata row
      const stmtRow = [
        statementId,
        new Date().toISOString(),
        parsed.carrier,
        parsed.payPeriod || parsed.statementDate,
        filename,
        fileType,
        totalRecords.toString(),
        matchCount.toString(),
        unmatchCount.toString(),
        pendingCount.toString(),
        totalAdvances.toFixed(2),
        totalRecoveries.toFixed(2),
        netAmount.toFixed(2),
        cancellationsDetected.toString(),
        'processed',
      ];

      await sheets.spreadsheets.values.append({
        spreadsheetId: salesSheetId,
        range: statementsTab,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [stmtRow] },
      });
      console.log(`[commission-upload] Wrote statement metadata`);

      // Invalidate caches
      invalidateCache(salesSheetId, ledgerTab);
      invalidateCache(salesSheetId, statementsTab);
    }

    return NextResponse.json({
      success: true,
      dryRun,
      statementId,
      carrier: parsed.carrier,
      payPeriod: parsed.payPeriod,
      statementDate: parsed.statementDate,
      summary: {
        totalRecords,
        matched: matchCount,
        unmatched: unmatchCount,
        pendingReview: pendingCount,
        totalAdvances: Math.round(totalAdvances * 100) / 100,
        totalRecoveries: Math.round(totalRecoveries * 100) / 100,
        netAmount: Math.round(netAmount * 100) / 100,
        cancellationsDetected,
      },
      records: matchedRecords,
      unmatchedRecords,
      cancellationAlerts,
      agentSummary: parsed.agentSummary || [],
    });
  } catch (error) {
    console.error('[commission-upload] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
