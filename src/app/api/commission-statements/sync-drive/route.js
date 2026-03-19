export const dynamic = 'force-dynamic';
import { fetchSheet, getDriveClient, getSheetsClient, invalidateCache } from '@/lib/sheets';
import { fuzzyMatchPolicyholder } from '@/lib/utils';
import { parseStatement, shouldSkip } from '@/lib/parsers/index';
import { buildLedgerRow, buildStatementRow } from '@/lib/ledger';
import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

const SUPPORTED_EXTENSIONS = ['.pdf', '.xlsx', '.xls', '.csv'];

async function listDriveFiles() {
  const folderId = process.env.COMMISSION_DRIVE_FOLDER_ID;
  if (!folderId) throw new Error('COMMISSION_DRIVE_FOLDER_ID not configured');

  const drive = await getDriveClient();
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType, size, createdTime, modifiedTime)',
    orderBy: 'createdTime desc',
    pageSize: 200,
  });

  const driveFiles = (res.data.files || []).filter(f => {
    const ext = (f.name || '').toLowerCase();
    return SUPPORTED_EXTENSIONS.some(e => ext.endsWith(e)) && !shouldSkip(f.name);
  });

  // Get already-processed filenames
  const salesSheetId = process.env.SALES_SHEET_ID;
  const statementsTab = process.env.COMMISSION_STATEMENTS_TAB || 'Commission Statements';
  const statements = await fetchSheet(salesSheetId, statementsTab, 60);
  const processedFiles = new Set(statements.map(s => (s['File Name'] || '').trim()));

  const newFiles = driveFiles.filter(f => !processedFiles.has(f.name));
  return { driveFiles, processedFiles: [...processedFiles], newFiles };
}

async function downloadDriveFile(fileId) {
  const drive = await getDriveClient();
  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
  return Buffer.from(res.data);
}

/**
 * Process one file — shared logic used by both sync and upload.
 */
async function processOneFile(buffer, filename, salesRows, driveFileId) {
  const fileType = filename.toLowerCase().endsWith('.pdf') ? 'PDF'
    : filename.toLowerCase().match(/\.xlsx?$/) ? 'XLSX'
    : filename.toLowerCase().endsWith('.csv') ? 'CSV' : 'Unknown';

  const parsed = await parseStatement(buffer, filename, null);
  console.log(`[sync] Parsed ${parsed.records.length} records from ${parsed.carrier} (${filename})`);

  const agentMap = {};
  (parsed.agentSummary || []).forEach(a => { agentMap[a.agentId] = a.agentName; });

  const statementId = randomUUID();
  const processingDate = new Date().toISOString().split('T')[0];
  const ledgerRows = [];
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
    }

    record.transactionId = randomUUID();
    record.advanceAmount = record.advanceAmount || (record.commissionAmount > 0 ? record.commissionAmount : 0);

    const row = buildLedgerRow(record, {
      carrier: parsed.carrier, carrierId: parsed.carrierId,
      statementDate: parsed.statementDate || parsed.payPeriod,
      processingDate, filename,
      matchedPolicy, matchType, matchConfidence, status,
      notes: record.cancellationIndicator ? 'Cancellation detected' : '',
      driveFileId: driveFileId || '',
    });
    ledgerRows.push(row);
  }

  const netAmount = totalAdvances - totalRecoveries;
  const totalRecords = parsed.records.length;

  // Write to sheets
  const sheets = await getSheetsClient();
  const salesSheetId = process.env.SALES_SHEET_ID;
  const ledgerTab = process.env.COMMISSION_LEDGER_TAB || 'Commission Ledger';
  const statementsTab = process.env.COMMISSION_STATEMENTS_TAB || 'Commission Statements';

  if (ledgerRows.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: salesSheetId, range: ledgerTab,
      valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS',
      requestBody: { values: ledgerRows },
    });
    invalidateCache(salesSheetId, ledgerTab);
  }

  const stmtRow = buildStatementRow({
    statementId, carrier: parsed.carrier,
    payPeriod: parsed.payPeriod, statementDate: parsed.statementDate,
    filename, fileType, totalRecords,
    matched: matchCount, unmatched: unmatchCount, pendingReview: pendingCount,
    totalAdvances, totalRecoveries, netAmount, cancellationsDetected,
  });
  await sheets.spreadsheets.values.append({
    spreadsheetId: salesSheetId, range: statementsTab,
    valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [stmtRow] },
  });
  invalidateCache(salesSheetId, statementsTab);

  return {
    statementId, filename, carrier: parsed.carrier, payPeriod: parsed.payPeriod,
    summary: { totalRecords, matched: matchCount, unmatched: unmatchCount, pendingReview: pendingCount,
      totalAdvances: Math.round(totalAdvances * 100) / 100,
      totalRecoveries: Math.round(totalRecoveries * 100) / 100,
      netAmount: Math.round(netAmount * 100) / 100, cancellationsDetected },
  };
}

// GET — list new files in Drive folder
export async function GET() {
  try {
    const { driveFiles, processedFiles, newFiles } = await listDriveFiles();
    return NextResponse.json({
      folderId: process.env.COMMISSION_DRIVE_FOLDER_ID,
      totalInFolder: driveFiles.length,
      alreadyProcessed: processedFiles.length,
      newFilesCount: newFiles.length,
      newFiles: newFiles.map(f => ({ id: f.id, name: f.name, size: f.size, createdTime: f.createdTime })),
    });
  } catch (error) {
    console.error('[sync] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST — process all new files from Drive folder
export async function POST() {
  try {
    const { newFiles } = await listDriveFiles();
    if (newFiles.length === 0) {
      return NextResponse.json({ success: true, message: 'No new files to process', processed: 0, results: [] });
    }

    // Fetch sales rows once for all files
    const salesTab = process.env.SALES_TAB_NAME || 'Sheet1';
    const salesRows = await fetchSheet(process.env.SALES_SHEET_ID, salesTab, 0);

    const results = [];
    const errors = [];

    for (const file of newFiles) {
      try {
        console.log(`[sync] Downloading ${file.name}...`);
        const buffer = await downloadDriveFile(file.id);
        const result = await processOneFile(buffer, file.name, salesRows, file.id);
        results.push(result);
        console.log(`[sync] ✓ ${file.name}: ${result.summary.totalRecords} records`);
      } catch (err) {
        console.error(`[sync] ✗ ${file.name}: ${err.message}`);
        errors.push({ filename: file.name, error: err.message });
      }
    }

    return NextResponse.json({
      success: true,
      processed: results.length,
      failed: errors.length,
      totalRecords: results.reduce((s, r) => s + r.summary.totalRecords, 0),
      results: results.map(r => ({ filename: r.filename, carrier: r.carrier, ...r.summary })),
      errors,
    });
  } catch (error) {
    console.error('[sync] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
