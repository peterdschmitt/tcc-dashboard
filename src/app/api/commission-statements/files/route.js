export const dynamic = 'force-dynamic';
import { getDriveClient } from '@/lib/sheets';
import { listAllCommissionFiles, CARRIER_FOLDERS } from '@/lib/drive-organize';
import { NextResponse } from 'next/server';

/**
 * GET — List all commission files grouped by carrier subfolder.
 */
export async function GET() {
  try {
    const folderId = process.env.COMMISSION_DRIVE_FOLDER_ID;
    if (!folderId) return NextResponse.json({ error: 'COMMISSION_DRIVE_FOLDER_ID not configured' }, { status: 500 });

    const drive = await getDriveClient();
    const { rootFiles, subfolderFiles, folderMap } = await listAllCommissionFiles(drive, folderId);

    // Build response grouped by carrier
    const carriers = {};
    for (const [carrierId, files] of Object.entries(subfolderFiles)) {
      const carrierName = CARRIER_FOLDERS[carrierId] || carrierId;
      carriers[carrierName] = files.map(f => ({
        id: f.id,
        name: f.name,
        size: f.size ? `${Math.round(parseInt(f.size) / 1024)} KB` : '—',
        modified: f.modifiedTime || f.createdTime || '',
      }));
    }

    // Root files (unorganized)
    const root = rootFiles.map(f => ({
      id: f.id,
      name: f.name,
      size: f.size ? `${Math.round(parseInt(f.size) / 1024)} KB` : '—',
      modified: f.modifiedTime || f.createdTime || '',
    }));

    const totalFiles = Object.values(carriers).reduce((sum, files) => sum + files.length, 0) + root.length;

    return NextResponse.json({
      totalFiles,
      carriers,
      root,
    });
  } catch (error) {
    console.error('[files] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
