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
    let dupsSkipped = 0;

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

    // Step 5: Write to Google Sheets (with row-level dedup)
    if (!dryRun && totalRecords > 0) {
      const sheets = await getSheetsClient();
      const salesSheetId = process.env.SALES_SHEET_ID;
      const ledgerTab = process.env.COMMISSION_LEDGER_TAB || 'Commission Ledger';
      const statementsTab = process.env.COMMISSION_STATEMENTS_TAB || 'Commission Statements';

      // Row-level dedup: check existing ledger for identical entries
      let existingLedger = [];
      try {
        existingLedger = await fetchSheet(salesSheetId, ledgerTab, 0);
      } catch (e) { /* empty ledger is fine */ }

      const existingKeys = new Set();
      for (const lr of existingLedger) {
        const key = [
          (lr['Policy #'] || '').trim(),
          (lr['Statement Date'] || '').trim(),
          (lr['Commission Amount'] || '0').trim(),
          (lr['Transaction Type'] || '').trim(),
          (lr['Agent ID'] || '').trim(),
        ].join('|');
        existingKeys.add(key);
      }

      // Filter out rows that already exist in the ledger
      const LEDGER_COL = { policyNum: 4, stmtDate: 1, commAmount: 16, txnType: 8, agentId: 7 }; // 0-indexed
      const ledgerRows = allEnriched.map(e => e.row);
      const newRows = ledgerRows.filter(row => {
        const key = [
          (row[LEDGER_COL.policyNum] || '').trim(),
          (row[LEDGER_COL.stmtDate] || '').trim(),
          (row[LEDGER_COL.commAmount] || '0').trim(),
          (row[LEDGER_COL.txnType] || '').trim(),
          (row[LEDGER_COL.agentId] || '').trim(),
        ].join('|');
        return !existingKeys.has(key);
      });

      dupsSkipped = ledgerRows.length - newRows.length;
      if (dupsSkipped > 0) console.log(`[upload] Skipped ${dupsSkipped} duplicate ledger rows`);

      if (newRows.length > 0) {
        await sheets.spreadsheets.values.append({
          spreadsheetId: salesSheetId, range: ledgerTab,
          valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS',
          requestBody: { values: newRows },
        });
      }
      console.log(`[upload] Wrote ${newRows.length} ledger rows (${dupsSkipped} duplicates skipped)`);

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
        duplicatesSkipped: dupsSkipped || 0,
      },
      cancellationAlerts,
      agentSummary: parsed.agentSummary || [],
    });
  } catch (error) {
    console.error('[upload] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
