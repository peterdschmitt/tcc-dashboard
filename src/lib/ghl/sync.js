// src/lib/ghl/sync.js
import { shouldProcessRow } from './filter.js';
import { matchContact } from './matcher.js';
import { buildContactPatch } from './field-mapping.js';
import { formatNote } from './note-formatter.js';
import { rowHash } from './row-hash.js';
import { appendSyncLogBatch, appendPossibleMergeBatch, readExcludedCampaigns, readSyncedHashes, writeWatermark, parseCallLogDate } from './sheet-state.js';

export async function processSingleRow(row, deps) {
  const { client, excludedCampaigns, syncedHashes } = deps;
  const hash = rowHash(row);
  const timestamp = new Date().toISOString();
  const baseLogEntry = {
    'Timestamp': timestamp,
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
    const syncLogEntry = { ...baseLogEntry, 'Tier': '', 'Action': action, 'GHL Contact ID': '', 'Error': '' };
    return { result: { tier: null, action, contactId: null, error: null }, syncLogEntry, possibleMergeEntry: null };
  }

  try {
    // 2. Match
    const match = await matchContact(row, {
      searchByPhone: client.searchByPhone,
      searchByNameAndState: client.searchByNameAndState,
    });

    let contactId, action;
    let possibleMergeEntry = null;
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

      possibleMergeEntry = {
        'Timestamp': timestamp,
        'Existing GHL Contact ID': match.contact.id,
        'Existing Name': `${match.contact.firstName ?? ''} ${match.contact.lastName ?? ''}`.trim(),
        'Existing Phone': match.contact.phone ?? '',
        'New GHL Contact ID': created.id,
        'New Name': `${row['First'] ?? ''} ${row['Last'] ?? ''}`.trim(),
        'New Phone': row['Phone'] ?? '',
        'State': row['State'] ?? '',
        'Reviewed': '',
      };

    } else {
      // Tier 3: attempt to create. GHL native phone-dedup may catch a
      // race condition (we created another contact with the same phone
      // in this same batch and GHL's search index hadn't yet reflected
      // it when we ran Tier 1). createContact recovers by returning
      // the existing contact with `_dedupedExisting` flagged; in that
      // case we fall through to Tier 1 logic.
      const newPatch = buildContactPatch(row, { isNewContact: true });
      const created = await client.createContact(newPatch);

      if (created._dedupedExisting) {
        const t1Patch = buildContactPatch(row, { isNewContact: false });
        const updated = await client.updateContact(created.id, {
          customFields: t1Patch.customFields,
          tags: t1Patch.tags,
          removeTag: t1Patch.callableNegationTag,
          additionalPhone: row['Phone'],
        }, created);
        await client.addNote(created.id, note);
        contactId = updated.id;
        action = 'attached'; // dedup recovery → semantically Tier 1
      } else {
        await client.addNote(created.id, note);
        contactId = created.id;
        action = 'created';
      }
    }

    const syncLogEntry = { ...baseLogEntry, 'Tier': String(match.tier), 'Action': action, 'GHL Contact ID': contactId, 'Error': '' };
    return { result: { tier: match.tier, action, contactId, error: null }, syncLogEntry, possibleMergeEntry };

  } catch (err) {
    const errMsg = (err.message ?? String(err)).slice(0, 500);
    const syncLogEntry = { ...baseLogEntry, 'Tier': '', 'Action': 'error', 'GHL Contact ID': '', 'Error': errMsg };
    return { result: { tier: null, action: 'error', contactId: null, error: errMsg }, syncLogEntry, possibleMergeEntry: null };
  }
}

export async function processBatch({ rows, client, dryRun = false, advanceWatermark = true }) {
  const excludedCampaigns = await readExcludedCampaigns();
  const syncedHashes = await readSyncedHashes();

  const summary = { total: rows.length, created: 0, attached: 0, possibleMerges: 0, skipped: 0, errors: 0 };
  // Track watermark as both a timestamp (for comparison) and the original
  // Date string (for human-readable storage in the sheet).
  let maxDateTs = 0;
  let maxDateStr = '';

  const syncLogEntries = [];
  const possibleMergeEntries = [];

  for (const row of rows) {
    const { result, syncLogEntry, possibleMergeEntry } = await processSingleRow(row, { client, excludedCampaigns, syncedHashes, dryRun });
    syncLogEntries.push(syncLogEntry);
    if (possibleMergeEntry) possibleMergeEntries.push(possibleMergeEntry);

    if (result.action === 'created') summary.created++;
    else if (result.action === 'attached') summary.attached++;
    else if (result.action === 'created+possible-merge') { summary.created++; summary.possibleMerges++; }
    else if (result.action.startsWith('skipped:')) summary.skipped++;
    else if (result.action === 'error') summary.errors++;

    // Track watermark on non-error outcomes — uses `Date` (the call's
    // actual time), parsed as a timestamp because Call Logs use a
    // non-sortable MM/DD/YYYY format.
    if (result.action !== 'error') {
      const dateStr = row['Date'] ?? '';
      const ts = parseCallLogDate(dateStr);
      if (ts > maxDateTs) {
        maxDateTs = ts;
        maxDateStr = dateStr;
      }
    }

    // Add this row's hash to in-memory set so a duplicate row inside the same batch
    // (rare but possible) is caught
    syncedHashes.add(rowHash(row));
  }

  // Batch-write all sync log entries and possible merges in a single API call each.
  // This avoids the 60-writes/min Google Sheets quota that would cap large backfills.
  await appendSyncLogBatch(syncLogEntries);
  if (possibleMergeEntries.length > 0) {
    await appendPossibleMergeBatch(possibleMergeEntries);
  }

  if (maxDateStr && !dryRun && advanceWatermark) {
    await writeWatermark(maxDateStr);
  }

  return summary;
}
