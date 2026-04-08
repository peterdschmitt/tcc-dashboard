export const dynamic = 'force-dynamic';
import { fetchSheet, getDriveClient, getSheetsClient, invalidateCache } from '@/lib/sheets';
import { parseStatement, shouldSkip } from '@/lib/parsers/index';
import {
  ensureCarrierFolders, buildStandardFilename, moveFileToCarrierFolder,
  listAllCommissionFiles, CARRIER_FOLDERS,
} from '@/lib/drive-organize';
import { NextResponse } from 'next/server';

const SUPPORTED_EXTENSIONS = ['.pdf', '.xlsx', '.xls', '.csv'];

/**
 * GET — Dry-run scan: detect carrier for each root-level file, propose moves.
 */
export async function GET() {
  try {
    const folderId = process.env.COMMISSION_DRIVE_FOLDER_ID;
    if (!folderId) return NextResponse.json({ error: 'COMMISSION_DRIVE_FOLDER_ID not configured' }, { status: 500 });

    const drive = await getDriveClient();
    const { rootFiles, subfolderFiles, folderMap } = await listAllCommissionFiles(drive, folderId);

    // For each root file, download and detect carrier
    const proposals = [];
    for (const file of rootFiles) {
      if (shouldSkip(file.name)) continue;

      try {
        const res = await drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(res.data);
        const parsed = await parseStatement(buffer, file.name, null);

        const newName = buildStandardFilename(parsed.carrierId, parsed.payPeriod, parsed.statementDate, file.name);
        const targetFolder = CARRIER_FOLDERS[parsed.carrierId] || 'Unknown';

        proposals.push({
          id: file.id,
          currentName: file.name,
          carrier: parsed.carrier,
          carrierId: parsed.carrierId,
          payPeriod: parsed.payPeriod || '',
          statementDate: parsed.statementDate || '',
          proposedName: newName,
          targetFolder,
          recordCount: parsed.records?.length || 0,
          status: 'will_move',
        });
      } catch (err) {
        proposals.push({
          id: file.id,
          currentName: file.name,
          carrier: null,
          carrierId: null,
          proposedName: null,
          targetFolder: null,
          recordCount: 0,
          status: 'undetected',
          error: err.message,
        });
      }

      // Small delay to avoid Drive API rate limits
      await new Promise(r => setTimeout(r, 200));
    }

    // Count files already in subfolders
    const organizedCount = Object.values(subfolderFiles).reduce((sum, files) => sum + files.length, 0);

    return NextResponse.json({
      rootFilesCount: rootFiles.length,
      alreadyOrganized: organizedCount,
      proposals,
      subfolderSummary: Object.fromEntries(
        Object.entries(subfolderFiles).map(([cid, files]) => [CARRIER_FOLDERS[cid], files.length])
      ),
    });
  } catch (error) {
    console.error('[organize] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST — Execute: create subfolders and move files.
 */
export async function POST() {
  try {
    const folderId = process.env.COMMISSION_DRIVE_FOLDER_ID;
    if (!folderId) return NextResponse.json({ error: 'COMMISSION_DRIVE_FOLDER_ID not configured' }, { status: 500 });

    const drive = await getDriveClient();

    // Step 1: Ensure carrier subfolders exist
    const folderMap = await ensureCarrierFolders(drive, folderId);
    console.log('[organize] Carrier folders:', Object.entries(folderMap).map(([k, v]) => `${k}=${v}`).join(', '));

    // Step 2: List root files
    const { rootFiles } = await listAllCommissionFiles(drive, folderId);

    // Step 3: Process each file
    const results = [];
    const errors = [];
    const movedByCarrier = {};

    for (const file of rootFiles) {
      if (shouldSkip(file.name)) continue;

      try {
        // Download and parse to detect carrier
        const res = await drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(res.data);
        const parsed = await parseStatement(buffer, file.name, null);

        if (!parsed.carrierId || !folderMap[parsed.carrierId]) {
          errors.push({ filename: file.name, error: `Unknown carrier: ${parsed.carrierId}` });
          continue;
        }

        // Build standardized name and move
        const newName = buildStandardFilename(parsed.carrierId, parsed.payPeriod, parsed.statementDate, file.name);
        const targetFolderId = folderMap[parsed.carrierId];

        await moveFileToCarrierFolder(drive, file.id, targetFolderId, newName, folderId);

        movedByCarrier[parsed.carrier] = (movedByCarrier[parsed.carrier] || 0) + 1;
        results.push({
          originalName: file.name,
          newName,
          carrier: parsed.carrier,
          folder: CARRIER_FOLDERS[parsed.carrierId],
        });

        console.log(`[organize] Moved: ${file.name} → ${CARRIER_FOLDERS[parsed.carrierId]}/${newName}`);
      } catch (err) {
        console.error(`[organize] Failed: ${file.name}: ${err.message}`);
        errors.push({ filename: file.name, error: err.message });
      }

      await new Promise(r => setTimeout(r, 200));
    }

    // Step 4: Update Commission Statements sheet with new filenames
    if (results.length > 0) {
      try {
        const salesSheetId = process.env.SALES_SHEET_ID;
        const statementsTab = process.env.COMMISSION_STATEMENTS_TAB || 'Commission Statements';
        const statements = await fetchSheet(salesSheetId, statementsTab, 0);

        if (statements.length > 0) {
          const sheets = await getSheetsClient();
          // Find rows that need updating (match by original filename)
          const renames = new Map(results.map(r => [r.originalName, r.newName]));
          const updates = [];

          // Find the File Name column index
          const headers = Object.keys(statements[0]);
          const fileNameIdx = headers.indexOf('File Name');

          for (let i = 0; i < statements.length; i++) {
            const oldName = statements[i]['File Name'] || '';
            if (renames.has(oldName)) {
              // Row i+2 (1-indexed, skip header)
              const rowNum = i + 2;
              // Update Organized Filename column (column index for new field)
              updates.push({
                range: `'${statementsTab}'!R${rowNum}`,
                values: [[renames.get(oldName)]],
              });
            }
          }

          if (updates.length > 0) {
            await sheets.spreadsheets.values.batchUpdate({
              spreadsheetId: salesSheetId,
              requestBody: {
                valueInputOption: 'USER_ENTERED',
                data: updates,
              },
            });
            invalidateCache(salesSheetId, statementsTab);
            console.log(`[organize] Updated ${updates.length} statement rows with organized filenames`);
          }
        }
      } catch (err) {
        console.error('[organize] Warning: could not update statements sheet:', err.message);
      }
    }

    return NextResponse.json({
      success: true,
      moved: results.length,
      failed: errors.length,
      movedByCarrier,
      results,
      errors,
    });
  } catch (error) {
    console.error('[organize] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
