/**
 * Google Drive organization utilities for commission statement files.
 *
 * Manages carrier subfolders, standardized naming, file moves,
 * and content-based duplicate detection.
 */

import { getDriveClient } from './sheets.js';

// ─── Carrier → subfolder name mapping ─────────────────────────
export const CARRIER_FOLDERS = {
  'aig':               'AIG Corebridge',
  'transamerica':      'Transamerica',
  'american-amicable': 'American Amicable',
  'cica':              'CICA',
};

// ─── Folder management ────────────────────────────────────────

/**
 * Ensure carrier subfolders exist under the parent folder.
 * Creates any missing folders idempotently.
 * @returns {Object} Map of carrierId → Google Drive folderId
 */
export async function ensureCarrierFolders(drive, parentFolderId) {
  const folderMap = {};

  for (const [carrierId, folderName] of Object.entries(CARRIER_FOLDERS)) {
    // Check if folder already exists
    const existing = await drive.files.list({
      q: `'${parentFolderId}' in parents and name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name)',
      pageSize: 1,
    });

    if (existing.data.files && existing.data.files.length > 0) {
      folderMap[carrierId] = existing.data.files[0].id;
    } else {
      // Create the folder
      const created = await drive.files.create({
        requestBody: {
          name: folderName,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [parentFolderId],
        },
        fields: 'id',
      });
      folderMap[carrierId] = created.data.id;
      console.log(`[organize] Created folder: ${folderName} (${created.data.id})`);
    }
  }

  return folderMap;
}

// ─── Standardized naming ──────────────────────────────────────

/**
 * Normalize a pay period string to YYYY-MM format.
 * Handles formats like "03-01-2026 to 03-14-2026", "3/5/2026", "March 2026", etc.
 */
function normalizePayPeriod(payPeriod) {
  if (!payPeriod) return null;
  const s = String(payPeriod).trim();

  // "03-01-2026 to 03-14-2026" → take the first date
  const rangeMatch = s.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (rangeMatch) {
    const month = rangeMatch[1].padStart(2, '0');
    return `${rangeMatch[3]}-${month}`;
  }

  // "2026-03-15" or "2026-03"
  const isoMatch = s.match(/(\d{4})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}`;

  // "March 2026"
  const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
  const nameMatch = s.match(/([a-z]+)\s+(\d{4})/i);
  if (nameMatch) {
    const m = months[nameMatch[1].toLowerCase().substring(0, 3)];
    if (m) return `${nameMatch[2]}-${m}`;
  }

  return null;
}

/**
 * Normalize a date string to YYYY-MM-DD.
 */
function normalizeDate(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr).trim();

  // "2026-03-15"
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  // "03/15/2026" or "3-15-2026"
  const usMatch = s.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (usMatch) {
    return `${usMatch[3]}-${usMatch[1].padStart(2, '0')}-${usMatch[2].padStart(2, '0')}`;
  }

  return null;
}

/**
 * Sanitize a filename for safe use in Drive (remove special chars but keep readability).
 */
function sanitizeFilename(name) {
  // Strip the extension first
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.substring(0, dot) : name;
  // Replace unsafe chars with dashes, collapse multiples
  return base.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
}

/**
 * Build a standardized filename for a commission statement.
 * Format: {CarrierShort}_{YYYY-MM}_{YYYY-MM-DD}_{sanitized-original}.{ext}
 * Example: AIG_2026-03_2026-03-15_agent-commission-report.pdf
 */
export function buildStandardFilename(carrierId, payPeriod, statementDate, originalFilename) {
  const carrierShort = {
    'aig': 'AIG',
    'transamerica': 'Transamerica',
    'american-amicable': 'AmAmicable',
    'cica': 'CICA',
  }[carrierId] || carrierId.toUpperCase();

  const period = normalizePayPeriod(payPeriod)
    || normalizePayPeriod(statementDate)
    || new Date().toISOString().substring(0, 7);

  const stmtDate = normalizeDate(statementDate)
    || normalizeDate(payPeriod)
    || new Date().toISOString().substring(0, 10);

  const ext = originalFilename.includes('.')
    ? originalFilename.substring(originalFilename.lastIndexOf('.')).toLowerCase()
    : '';

  const sanitized = sanitizeFilename(originalFilename);

  return `${carrierShort}_${period}_${stmtDate}_${sanitized}${ext}`;
}

// ─── File operations ──────────────────────────────────────────

/**
 * Move a file to a new folder and optionally rename it.
 * Uses a single Drive API call (update with addParents/removeParents).
 */
export async function moveFileToCarrierFolder(drive, fileId, targetFolderId, newName, currentParentId) {
  const updateParams = {
    fileId,
    addParents: targetFolderId,
    removeParents: currentParentId,
    fields: 'id, name, parents',
  };
  if (newName) {
    updateParams.requestBody = { name: newName };
  }
  const result = await drive.files.update(updateParams);
  return result.data;
}

/**
 * List all files in the root folder AND all carrier subfolders.
 * Returns { rootFiles: [...], subfolderFiles: { carrierId: [...] }, folderMap: { carrierId: folderId } }
 */
export async function listAllCommissionFiles(drive, parentFolderId) {
  const SUPPORTED_EXTENSIONS = ['.pdf', '.xlsx', '.xls', '.csv'];

  const filterSupported = (files) =>
    (files || []).filter(f => {
      const name = (f.name || '').toLowerCase();
      return SUPPORTED_EXTENSIONS.some(e => name.endsWith(e));
    });

  // List files in root folder (not in subfolders)
  const rootRes = await drive.files.list({
    q: `'${parentFolderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
    fields: 'files(id, name, mimeType, size, createdTime, modifiedTime, parents)',
    orderBy: 'name',
    pageSize: 500,
  });
  const rootFiles = filterSupported(rootRes.data.files);

  // Find carrier subfolders
  const foldersRes = await drive.files.list({
    q: `'${parentFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    pageSize: 20,
  });

  // Build reverse map: folderId → carrierId
  const folderMap = {};
  const reverseMap = {};
  for (const folder of (foldersRes.data.files || [])) {
    for (const [cid, name] of Object.entries(CARRIER_FOLDERS)) {
      if (folder.name === name) {
        folderMap[cid] = folder.id;
        reverseMap[folder.id] = cid;
        break;
      }
    }
  }

  // List files in each subfolder
  const subfolderFiles = {};
  for (const [carrierId, folderId] of Object.entries(folderMap)) {
    const subRes = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
      fields: 'files(id, name, mimeType, size, createdTime, modifiedTime, parents)',
      orderBy: 'name',
      pageSize: 500,
    });
    subfolderFiles[carrierId] = filterSupported(subRes.data.files);
  }

  return { rootFiles, subfolderFiles, folderMap };
}

// ─── Duplicate detection ──────────────────────────────────────

/**
 * Compute a content fingerprint for a parsed commission statement.
 * Used to detect duplicates even when filenames differ.
 */
export function computeContentFingerprint(carrierId, payPeriod, recordCount, totalAmount) {
  const period = normalizePayPeriod(payPeriod) || 'unknown';
  const amount = typeof totalAmount === 'number' ? totalAmount.toFixed(2) : '0.00';
  return `${carrierId}|${period}|${recordCount}|${amount}`;
}

/**
 * Check if a statement is a duplicate by comparing its fingerprint against existing statements.
 * @param {string} fingerprint — from computeContentFingerprint
 * @param {Array} existingStatements — rows from the Commission Statements sheet
 * @returns {{ isDuplicate: boolean, matchedFile: string|null }}
 */
export function checkDuplicate(fingerprint, existingStatements) {
  for (const stmt of existingStatements) {
    const existingFp = stmt['Content Hash'] || '';
    if (existingFp && existingFp === fingerprint) {
      return { isDuplicate: true, matchedFile: stmt['File Name'] || stmt['Organized Filename'] || 'unknown' };
    }
  }
  // Also check partial match: same carrier + period with similar record count
  const [carrier, period, countStr] = fingerprint.split('|');
  const count = parseInt(countStr, 10);
  for (const stmt of existingStatements) {
    const existingFp = stmt['Content Hash'] || '';
    if (!existingFp) continue;
    const [eCarrier, ePeriod, eCountStr] = existingFp.split('|');
    if (eCarrier === carrier && ePeriod === period) {
      const eCount = parseInt(eCountStr, 10);
      if (Math.abs(count - eCount) <= Math.max(count, eCount) * 0.1) {
        return {
          isDuplicate: true,
          matchedFile: stmt['File Name'] || stmt['Organized Filename'] || 'unknown',
          isPartialMatch: true,
        };
      }
    }
  }
  return { isDuplicate: false, matchedFile: null };
}
