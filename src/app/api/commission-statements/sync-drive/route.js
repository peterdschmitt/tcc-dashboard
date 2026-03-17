export const dynamic = 'force-dynamic';
import { fetchSheet, getDriveClient, getSheetsClient, invalidateCache } from '@/lib/sheets';
import { fuzzyMatchPolicyholder } from '@/lib/utils';
import { parseStatement, shouldSkip } from '@/lib/parsers/index';
import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

const SUPPORTED_EXTENSIONS = ['.pdf', '.xlsx', '.xls', '.csv'];

/**
 * List files in the Google Drive commission statements folder.
 * Returns { driveFiles[], processedFiles[], newFiles[] }
 */
async function listDriveFiles() {
  const folderId = process.env.COMMISSION_DRIVE_FOLDER_ID;
  if (!folderId) throw new Error('COMMISSION_DRIVE_FOLDER_ID not configured');

  const drive = await getDriveClient();

  // List all files in the folder
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType, size, createdTime, modifiedTime)',
    orderBy: 'createdTime desc',
    pageSize: 100,
  });

  const driveFiles = (res.data.files || []).filter(f => {
    const name = f.name || '';
    const ext = name.toLowerCase();
    // Filter by extension AND skip non-statement files
    return SUPPORTED_EXTENSIONS.some(e => ext.endsWith(e)) && !shouldSkip(name);
  });

  // Get already-processed filenames from Commission Statements tab
  const salesSheetId = process.env.SALES_SHEET_ID;
  const statementsTab = process.env.COMMISSION_STATEMENTS_TAB || 'Commission Statements';
  const statements = await fetchSheet(salesSheetId, statementsTab, 60);
  const processedFiles = new Set(statements.map(s => (s['File Name'] || '').trim()));

  const newFiles = driveFiles.filter(f => !processedFiles.has(f.name));

  return { driveFiles, processedFiles: [...processedFiles], newFiles };
}

/**
 * Download a file from Google Drive as a Buffer.
 */
async function downloadDriveFile(fileId) {
  const drive = await getDriveClient();
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );
  return Buffer.from(res.data);
}

/**
 * Process a single commission statement file (shared logic with upload route).
 */
async function processStatementFile(buffer, filename, carrierHint) {
  const lowerName = filename.toLowerCase();
  const fileType = lowerName.endsWith('.pdf') ? 'PDF'
    : lowerName.endsWith('.xlsx') ? 'XLSX'
    : lowerName.endsWith('.xls') ? 'XLS'
    : lowerName.endsWith('.csv') ? 'CSV'
    : 'Unknown';

  // Step 1: Parse
  const parsed = await parseStatement(buffer, filename, carrierHint);
  console.log(`[drive-sync] Parsed ${parsed.records.length} records from ${parsed.carrier} (${filename})`);

  // Step 2: Fetch sales tracker for matching
  const salesTab = process.env.SALES_TAB_NAME || 'Sheet1';
  const salesRows = await fetchSheet(process.env.SALES_SHEET_ID, salesTab, 0);

  // Enrich records with agent names
  const agentMap = {};
  (parsed.agentSummary || []).forEach(a => { agentMap[a.agentId] = a.agentName; });

  // Step 3: Match and classify
  const statementId = randomUUID();
  const processingDate = new Date().toISOString().split('T')[0];
  const matchedRecords = [];
  const unmatchedRecords = [];
  const cancellationAlerts = [];
  let matchCount = 0, unmatchCount = 0, pendingCount = 0;
  let totalAdvances = 0, totalRecoveries = 0, cancellationsDetected = 0;

  for (const record of parsed.records) {
    if (record.agentId && agentMap[record.agentId]) {
      record.agent = agentMap[record.agentId];
    }

    if (record.commissionAmount > 0) totalAdvances += record.commissionAmount;
    if (record.commissionAmount < 0) totalRecoveries += Math.abs(record.commissionAmount);

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

      if (matchConfidence >= 0.85) { status = 'auto_matched'; matchCount++; }
      else if (matchConfidence >= 0.55) { status = 'pending_review'; pendingCount++; }
      else { status = 'unmatched'; unmatchCount++; }
    } else {
      unmatchCount++;
    }

    if (record.cancellationIndicator && status !== 'unmatched') {
      cancellationsDetected++;
      if (status === 'auto_matched') { status = 'pending_review'; matchCount--; pendingCount++; }

      cancellationAlerts.push({
        transactionId,
        policyNumber: record.policyNumber,
        insuredName: record.insuredName,
        agent: record.agent,
        recoveryAmount: record.commissionAmount,
        outstandingBalance: record.outstandingBalance,
        currentPolicyStatus: matchResult?.row?.['Policy Status']?.trim()
          || matchResult?.row?.['Placed?']?.trim() || 'Unknown',
        matchedPolicy,
        matchConfidence,
      });
    }

    const enrichedRecord = {
      transactionId, policyNumber: record.policyNumber, insuredName: record.insuredName,
      agent: record.agent, agentId: record.agentId, transactionType: record.transactionType,
      commType: record.commType, premium: record.premium, commissionAmount: record.commissionAmount,
      outstandingBalance: record.outstandingBalance, product: record.product, effDate: record.effDate,
      matchedPolicy, matchType, matchConfidence, status,
      cancellationIndicator: record.cancellationIndicator || false, section: record.section,
    };

    if (status === 'unmatched') unmatchedRecords.push(enrichedRecord);
    else matchedRecords.push(enrichedRecord);
  }

  const netAmount = totalAdvances - totalRecoveries;
  const totalRecords = parsed.records.length;

  // Step 4: Write to Google Sheets
  const sheets = await getSheetsClient();
  const salesSheetId = process.env.SALES_SHEET_ID;
  const ledgerTab = process.env.COMMISSION_LEDGER_TAB || 'Commission Ledger';
  const statementsTab = process.env.COMMISSION_STATEMENTS_TAB || 'Commission Statements';

  // Write ledger rows only if there are records
  if (totalRecords > 0) {
    const allRecords = [...matchedRecords, ...unmatchedRecords];
    const ledgerRows = allRecords.map(r => [
      r.transactionId,
      parsed.statementDate || parsed.payPeriod || processingDate,
      processingDate,
      parsed.carrier,
      r.policyNumber, r.insuredName, r.agent, r.transactionType,
      r.premium?.toFixed(2) || '0.00',
      r.commissionAmount?.toFixed(2) || '0.00',
      r.outstandingBalance?.toFixed(2) || '0.00',
      r.matchedPolicy || '', r.matchType,
      r.matchConfidence?.toFixed(2) || '0.00',
      r.status, filename,
      r.cancellationIndicator ? 'Cancellation detected - pending review' : '',
    ]);

    await sheets.spreadsheets.values.append({
      spreadsheetId: salesSheetId, range: ledgerTab,
      valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS',
      requestBody: { values: ledgerRows },
    });
    console.log(`[drive-sync] Wrote ${ledgerRows.length} ledger rows for ${filename}`);
    invalidateCache(salesSheetId, ledgerTab);
  }

  // Always write statement row (marks file as processed for dedup)
  const stmtRow = [
    statementId, new Date().toISOString(), parsed.carrier,
    parsed.payPeriod || parsed.statementDate, filename, fileType,
    totalRecords.toString(), matchCount.toString(), unmatchCount.toString(),
    pendingCount.toString(), totalAdvances.toFixed(2), totalRecoveries.toFixed(2),
    netAmount.toFixed(2), cancellationsDetected.toString(), 'processed',
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: salesSheetId, range: statementsTab,
    valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [stmtRow] },
  });
  invalidateCache(salesSheetId, statementsTab);

  return {
    statementId,
    filename,
    carrier: parsed.carrier,
    payPeriod: parsed.payPeriod,
    summary: {
      totalRecords, matched: matchCount, unmatched: unmatchCount,
      pendingReview: pendingCount,
      totalAdvances: Math.round(totalAdvances * 100) / 100,
      totalRecoveries: Math.round(totalRecoveries * 100) / 100,
      netAmount: Math.round(netAmount * 100) / 100,
      cancellationsDetected,
    },
    cancellationAlerts,
  };
}

/**
 * GET — Preview: list new files in Drive folder (no processing)
 */
export async function GET(request) {
  try {
    // Verify cron secret for automated calls (optional for manual)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    // Allow both cron and manual access

    const { driveFiles, processedFiles, newFiles } = await listDriveFiles();

    return NextResponse.json({
      folderId: process.env.COMMISSION_DRIVE_FOLDER_ID,
      totalInFolder: driveFiles.length,
      alreadyProcessed: processedFiles.length,
      newFilesCount: newFiles.length,
      newFiles: newFiles.map(f => ({
        id: f.id,
        name: f.name,
        size: f.size,
        mimeType: f.mimeType,
        createdTime: f.createdTime,
        modifiedTime: f.modifiedTime,
      })),
    });
  } catch (error) {
    console.error('[drive-sync] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST — Process all new files from Drive folder
 * Also triggered by Vercel cron job
 */
export async function POST(request) {
  try {
    const { newFiles } = await listDriveFiles();

    if (newFiles.length === 0) {
      console.log('[drive-sync] No new files to process');
      return NextResponse.json({
        success: true,
        message: 'No new files to process',
        processed: 0,
        results: [],
      });
    }

    console.log(`[drive-sync] Found ${newFiles.length} new file(s) to process`);

    const results = [];
    const errors = [];

    for (const file of newFiles) {
      try {
        console.log(`[drive-sync] Downloading ${file.name} (${file.size} bytes)...`);
        const buffer = await downloadDriveFile(file.id);

        console.log(`[drive-sync] Processing ${file.name}...`);
        const result = await processStatementFile(buffer, file.name, null);
        results.push(result);
        console.log(`[drive-sync] ✓ ${file.name}: ${result.summary.totalRecords} records, ${result.carrier}`);
      } catch (fileError) {
        console.error(`[drive-sync] ✗ Failed to process ${file.name}:`, fileError.message);
        errors.push({ filename: file.name, error: fileError.message });
      }
    }

    const totalRecords = results.reduce((s, r) => s + r.summary.totalRecords, 0);
    const totalAdvances = results.reduce((s, r) => s + r.summary.totalAdvances, 0);
    const totalRecoveries = results.reduce((s, r) => s + r.summary.totalRecoveries, 0);

    return NextResponse.json({
      success: true,
      processed: results.length,
      failed: errors.length,
      totalRecords,
      totalAdvances: Math.round(totalAdvances * 100) / 100,
      totalRecoveries: Math.round(totalRecoveries * 100) / 100,
      netAmount: Math.round((totalAdvances - totalRecoveries) * 100) / 100,
      results: results.map(r => ({
        filename: r.filename,
        carrier: r.carrier,
        payPeriod: r.payPeriod,
        ...r.summary,
      })),
      errors,
    });
  } catch (error) {
    console.error('[drive-sync] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
