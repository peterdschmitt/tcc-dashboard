export const dynamic = 'force-dynamic';
import { fetchSheet, getDriveClient, getSheetsClient, invalidateCache } from '@/lib/sheets';
import { fuzzyMatchPolicyholder } from '@/lib/utils';
import { parseStatement } from '@/lib/parsers/index';
import { buildLedgerRow, buildStatementRow } from '@/lib/ledger';
import {
  ensureCarrierFolders, buildStandardFilename, computeContentFingerprint, checkDuplicate,
} from '@/lib/drive-organize';
import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const carrierHint = formData.get('carrier') || null;
    const dryRun = formData.get('dryRun') === 'true';
    const skipDuplicate = formData.get('skipDuplicate') === 'true';

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    const filename = file.name || 'unknown';
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileType = filename.toLowerCase().endsWith('.pdf') ? 'PDF'
      : filename.toLowerCase().match(/\.xlsx?$/) ? 'XLSX'
      : filename.toLowerCase().endsWith('.csv') ? 'CSV' : 'Unknown';

    console.log(`[upload] Processing ${filename} (${fileType}, ${buffer.length} bytes)`);

    // Step 1: Parse
    const parsed = await parseStatement(buffer, filename, carrierHint === 'auto' ? null : carrierHint);
    console.log(`[upload] Parsed ${parsed.records.length} records from ${parsed.carrier}`);

    // Step 2: Fetch sales tracker for matching
    const salesTab = process.env.SALES_TAB_NAME || 'Sheet1';
    const salesRows = await fetchSheet(process.env.SALES_SHEET_ID, salesTab, 0);

    // Agent name enrichment
    const agentMap = {};
    (parsed.agentSummary || []).forEach(a => { agentMap[a.agentId] = a.agentName; });

    // Step 3: Match and classify each record
    const statementId = randomUUID();
    const processingDate = new Date().toISOString().split('T')[0];
    const allEnriched = [];
    const cancellationAlerts = [];
    let matchCount = 0, unmatchCount = 0, pendingCount = 0;
    let totalAdvances = 0, totalRecoveries = 0, cancellationsDetected = 0;

    for (const record of parsed.records) {
      if (record.agentId && agentMap[record.agentId]) record.agent = agentMap[record.agentId];

      if (record.commissionAmount > 0) totalAdvances += record.commissionAmount;
      if (record.commissionAmount < 0) totalRecoveries += Math.abs(record.commissionAmount);

      const matchResult = fuzzyMatchPolicyholder(
        { 'Policy No.': record.policyNumber, 'Insured': record.insuredName, 'Agent': record.agent },
        salesRows
      );

      let matchedPolicy = '', matchType = 'unmatched', matchConfidence = 0, status = 'unmatched';
      if (matchResult) {
        matchedPolicy = matchResult.row['Policy #'] || '';
        matchType = matchResult.matchType;
        matchConfidence = matchResult.confidence;
        if (matchConfidence >= 0.85) { status = 'auto_matched'; matchCount++; }
        else if (matchConfidence >= 0.55) { status = 'pending_review'; pendingCount++; }
        else { unmatchCount++; }
      } else { unmatchCount++; }

      if (record.cancellationIndicator && status !== 'unmatched') {
        cancellationsDetected++;
        if (status === 'auto_matched') { status = 'pending_review'; matchCount--; pendingCount++; }
        cancellationAlerts.push({
          policyNumber: record.policyNumber, insuredName: record.insuredName,
          agent: record.agent, amount: record.commissionAmount, matchedPolicy, matchConfidence,
        });
      }

      record.transactionId = randomUUID();
      record.advanceAmount = record.advanceAmount || (record.commissionAmount > 0 ? record.commissionAmount : 0);

      const row = buildLedgerRow(record, {
        carrier: parsed.carrier, carrierId: parsed.carrierId,
        statementDate: parsed.statementDate || parsed.payPeriod,
        processingDate, filename,
        matchedPolicy, matchType, matchConfidence, status,
        notes: record.cancellationIndicator ? 'Cancellation detected' : '',
      });

      allEnriched.push({ record, row, status });
    }

    const netAmount = totalAdvances - totalRecoveries;
    const totalRecords = parsed.records.length;

    // Step 3b: Content-based duplicate detection
    const contentHash = computeContentFingerprint(
      parsed.carrierId, parsed.payPeriod, totalRecords, netAmount
    );

    let duplicateWarning = null;
    try {
      const salesSheetId = process.env.SALES_SHEET_ID;
      const statementsTab = process.env.COMMISSION_STATEMENTS_TAB || 'Commission Statements';
      const existingStatements = await fetchSheet(salesSheetId, statementsTab, 60);
      const dupCheck = checkDuplicate(contentHash, existingStatements);
      if (dupCheck.isDuplicate && !skipDuplicate) {
        duplicateWarning = {
          message: `This file appears to be a duplicate of "${dupCheck.matchedFile}" (same carrier, pay period, and ${dupCheck.isPartialMatch ? 'similar' : 'identical'} record count).`,
          matchedFile: dupCheck.matchedFile,
          isPartialMatch: dupCheck.isPartialMatch || false,
        };
        if (dryRun) {
          return NextResponse.json({
            success: false, dryRun: true, duplicateWarning,
            carrier: parsed.carrier, payPeriod: parsed.payPeriod,
            summary: { totalRecords, matched: matchCount, unmatched: unmatchCount, pendingReview: pendingCount,
              totalAdvances: Math.round(totalAdvances * 100) / 100,
              totalRecoveries: Math.round(totalRecoveries * 100) / 100,
              netAmount: Math.round(netAmount * 100) / 100, cancellationsDetected },
          });
        }
      }
    } catch (err) {
      console.error('[upload] Duplicate check warning:', err.message);
    }

    // Step 4: Upload file to Drive carrier subfolder
    let driveFileId = '';
    let organizedFilename = '';
    if (!dryRun) {
      try {
        const parentFolderId = process.env.COMMISSION_DRIVE_FOLDER_ID;
        if (parentFolderId && parsed.carrierId) {
          const drive = await getDriveClient();
          const folderMap = await ensureCarrierFolders(drive, parentFolderId);
          const targetFolderId = folderMap[parsed.carrierId];

          if (targetFolderId) {
            organizedFilename = buildStandardFilename(parsed.carrierId, parsed.payPeriod, parsed.statementDate, filename);

            const driveRes = await drive.files.create({
              requestBody: {
                name: organizedFilename,
                parents: [targetFolderId],
              },
              media: {
                mimeType: file.type || 'application/octet-stream',
                body: Readable.from(buffer),
              },
              fields: 'id',
            });
            driveFileId = driveRes.data.id;
            console.log(`[upload] Uploaded to Drive: ${organizedFilename} (${driveFileId})`);
          }
        }
      } catch (err) {
        console.error('[upload] Drive upload warning:', err.message);
      }
    }

    // Step 5: Write to Google Sheets
    if (!dryRun && totalRecords > 0) {
      const sheets = await getSheetsClient();
      const salesSheetId = process.env.SALES_SHEET_ID;
      const ledgerTab = process.env.COMMISSION_LEDGER_TAB || 'Commission Ledger';
      const statementsTab = process.env.COMMISSION_STATEMENTS_TAB || 'Commission Statements';

      const ledgerRows = allEnriched.map(e => e.row);
      await sheets.spreadsheets.values.append({
        spreadsheetId: salesSheetId, range: ledgerTab,
        valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS',
        requestBody: { values: ledgerRows },
      });
      console.log(`[upload] Wrote ${ledgerRows.length} ledger rows`);

      const stmtRow = buildStatementRow({
        statementId, carrier: parsed.carrier,
        payPeriod: parsed.payPeriod, statementDate: parsed.statementDate,
        filename, fileType, totalRecords,
        matched: matchCount, unmatched: unmatchCount, pendingReview: pendingCount,
        totalAdvances, totalRecoveries, netAmount, cancellationsDetected,
        contentHash, driveFileId, organizedFilename,
      });
      await sheets.spreadsheets.values.append({
        spreadsheetId: salesSheetId, range: statementsTab,
        valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [stmtRow] },
      });

      invalidateCache(salesSheetId, ledgerTab);
      invalidateCache(salesSheetId, statementsTab);
    }

    return NextResponse.json({
      success: true, dryRun, statementId,
      carrier: parsed.carrier, payPeriod: parsed.payPeriod,
      organizedFilename,
      duplicateWarning,
      summary: {
        totalRecords, matched: matchCount, unmatched: unmatchCount,
        pendingReview: pendingCount,
        totalAdvances: Math.round(totalAdvances * 100) / 100,
        totalRecoveries: Math.round(totalRecoveries * 100) / 100,
        netAmount: Math.round(netAmount * 100) / 100,
        cancellationsDetected,
      },
      cancellationAlerts,
      agentSummary: parsed.agentSummary || [],
    });
  } catch (error) {
    console.error('[upload] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
