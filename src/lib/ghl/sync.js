// src/lib/ghl/sync.js
import { shouldProcessRow } from './filter.js';
import { matchContact } from './matcher.js';
import { buildContactPatch } from './field-mapping.js';
import { formatNote } from './note-formatter.js';
import { rowHash } from './row-hash.js';
import { appendSyncLog, appendPossibleMerge, readExcludedCampaigns, readSyncedHashes, writeWatermark } from './sheet-state.js';

export async function processSingleRow(row, deps) {
  const { client, excludedCampaigns, syncedHashes } = deps;
  const hash = rowHash(row);
  const baseLogEntry = {
    'Timestamp': new Date().toISOString(),
    'Row Hash': hash,
    'Lead Id': row['Lead Id'] ?? '',
    'Phone': row['Phone'] ?? '',
    'First': row['First'] ?? '',
    'Last': row['Last'] ?? '',
    'State': row['State'] ?? '',
  };

  // 1. Filter
  const filterResult = shouldProcessRow(row, excludedCampaigns, syncedHashes);
  if (!filterResult.ok) {
    const action = `skipped:${filterResult.reason}`;
    await appendSyncLog({ ...baseLogEntry, 'Tier': '', 'Action': action, 'GHL Contact ID': '', 'Error': '' });
    return { tier: null, action, contactId: null, error: null };
  }

  try {
    // 2. Match
    const match = await matchContact(row, {
      searchByPhone: client.searchByPhone,
      searchByNameAndState: client.searchByNameAndState,
    });

    let contactId, action;
    const note = formatNote(row);

    if (match.tier === 1) {
      // Attach to existing
      const patch = buildContactPatch(row, { isNewContact: false });
      const updated = await client.updateContact(match.contact.id, {
        customFields: patch.customFields,
        tags: patch.tags,
        removeTag: patch.callableNegationTag,
        additionalPhone: row['Phone'],
      }, match.contact);
      await client.addNote(match.contact.id, note);
      contactId = updated.id;
      action = 'attached';

    } else if (match.tier === 2) {
      // Create new + flag for review
      const patch = buildContactPatch(row, { isNewContact: true });
      const created = await client.createContact(patch);
      await client.addNote(created.id, note);
      contactId = created.id;
      action = 'created+possible-merge';

      await appendPossibleMerge({
        'Timestamp': new Date().toISOString(),
        'Existing GHL Contact ID': match.contact.id,
        'Existing Name': `${match.contact.firstName ?? ''} ${match.contact.lastName ?? ''}`.trim(),
        'Existing Phone': match.contact.phone ?? '',
        'New GHL Contact ID': created.id,
        'New Name': `${row['First'] ?? ''} ${row['Last'] ?? ''}`.trim(),
        'New Phone': row['Phone'] ?? '',
        'State': row['State'] ?? '',
        'Reviewed': '',
      });

    } else {
      // Tier 3: net-new
      const patch = buildContactPatch(row, { isNewContact: true });
      const created = await client.createContact(patch);
      await client.addNote(created.id, note);
      contactId = created.id;
      action = 'created';
    }

    await appendSyncLog({ ...baseLogEntry, 'Tier': String(match.tier), 'Action': action, 'GHL Contact ID': contactId, 'Error': '' });
    return { tier: match.tier, action, contactId, error: null };

  } catch (err) {
    const errMsg = (err.message ?? String(err)).slice(0, 500);
    await appendSyncLog({ ...baseLogEntry, 'Tier': '', 'Action': 'error', 'GHL Contact ID': '', 'Error': errMsg });
    return { tier: null, action: 'error', contactId: null, error: errMsg };
  }
}

export async function processBatch({ rows, client, dryRun = false, advanceWatermark = true }) {
  const excludedCampaigns = await readExcludedCampaigns();
  const syncedHashes = await readSyncedHashes();

  const summary = { total: rows.length, created: 0, attached: 0, possibleMerges: 0, skipped: 0, errors: 0 };
  let maxImportDate = '';

  for (const row of rows) {
    const result = await processSingleRow(row, { client, excludedCampaigns, syncedHashes, dryRun });
    if (result.action === 'created') summary.created++;
    else if (result.action === 'attached') summary.attached++;
    else if (result.action === 'created+possible-merge') { summary.created++; summary.possibleMerges++; }
    else if (result.action.startsWith('skipped:')) summary.skipped++;
    else if (result.action === 'error') summary.errors++;

    // Track watermark on non-error outcomes
    if (result.action !== 'error') {
      const importDate = row['Import Date'] ?? '';
      if (importDate > maxImportDate) maxImportDate = importDate;
    }

    // Add this row's hash to in-memory set so a duplicate row inside the same batch
    // (rare but possible) is caught
    syncedHashes.add(rowHash(row));
  }

  if (maxImportDate && !dryRun && advanceWatermark) {
    await writeWatermark(maxImportDate);
  }

  return summary;
}
