// src/lib/ghl/sync.js
import { shouldProcessRow } from './filter.js';
import { matchContact } from './matcher.js';
import { buildContactPatch } from './field-mapping.js';
import { buildPolicyPatch, SALES_PHONE_COLUMN } from './sales-mapping.js';
import { formatNote } from './note-formatter.js';
import { rowHash } from './row-hash.js';
import { appendSyncLogBatch, appendPossibleMergeBatch, readExcludedCampaigns, readSyncedHashes, writeWatermark, parseCallLogDate } from './sheet-state.js';
import { readRawSheet } from '../sheets.js';

/**
 * Normalize a phone string to 10 digits (strip non-digits, drop leading "1"
 * for 11-digit US numbers). Mirrors client.js's normalizePhone but lives
 * here too so we can build a phone→sales map without a client instance.
 */
function normalizePhone(p) {
  let s = (p ?? '').toString().replace(/\D/g, '');
  if (s.length === 11 && s.startsWith('1')) s = s.slice(1);
  return s;
}

/**
 * Read all sales records from SALES_SHEET_ID/SALES_TAB_NAME and build a
 * Map<normalized-phone, salesRecord>. Used by processBatch to enrich
 * call-log rows with policy data when phones match.
 *
 * Cached implicitly by sheets.js's caching layer.
 */
export async function buildSalesPhoneMap() {
  const sheetId = process.env.SALES_SHEET_ID;
  const tab = process.env.SALES_TAB_NAME || 'Sheet1';
  if (!sheetId) return new Map();
  const { data } = await readRawSheet(sheetId, tab);
  const map = new Map();
  for (const r of data) {
    const phone = normalizePhone(r[SALES_PHONE_COLUMN]);
    if (phone.length === 10) map.set(phone, r);
  }
  return map;
}

export async function processSingleRow(row, deps) {
  const { client, excludedCampaigns, syncedHashes, phoneToSales } = deps;
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

  // Look up sales/policy enrichment data for this row's phone, if any.
  // phoneToSales is a Map<normalized-phone, salesRecord> built once per
  // batch in processBatch. When present, the policy patch is merged into
  // the contact patch so policy custom fields land alongside call-log fields.
  const policyPatch = (() => {
    if (!phoneToSales) return null;
    const normalized = normalizePhone(row['Phone']);
    if (!normalized) return null;
    const sales = phoneToSales.get(normalized);
    return sales ? buildPolicyPatch(sales) : null;
  })();

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
      const mergedFields = policyPatch
        ? { ...patch.customFields, ...policyPatch.customFields }
        : patch.customFields;
      const updated = await client.updateContact(match.contact.id, {
        customFields: mergedFields,
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
      // Merge policy patch into the new contact: customFields and any
      // address/email enrichment that the call log doesn't have.
      const mergedFields = policyPatch
        ? { ...patch.customFields, ...policyPatch.customFields }
        : patch.customFields;
      const mergedNative = policyPatch
        ? { ...patch.native, ...policyPatch.nativeEnrichment }
        : patch.native;
      const created = await client.createContact({
        native: mergedNative,
        customFields: mergedFields,
        tags: patch.tags,
      });
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
      const mergedFields = policyPatch
        ? { ...newPatch.customFields, ...policyPatch.customFields }
        : newPatch.customFields;
      const mergedNative = policyPatch
        ? { ...newPatch.native, ...policyPatch.nativeEnrichment }
        : newPatch.native;
      const created = await client.createContact({
        native: mergedNative,
        customFields: mergedFields,
        tags: newPatch.tags,
      });

      if (created._dedupedExisting) {
        const t1Patch = buildContactPatch(row, { isNewContact: false });
        const t1MergedFields = policyPatch
          ? { ...t1Patch.customFields, ...policyPatch.customFields }
          : t1Patch.customFields;
        const updated = await client.updateContact(created.id, {
          customFields: t1MergedFields,
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
  // Build phone→sales map once per batch. processSingleRow consults it
  // to enrich call-log contacts with policy data when a phone matches
  // a Sales Tracker record. Returns an empty Map if SALES_SHEET_ID is
  // unset (e.g., test env), making enrichment a no-op gracefully.
  const phoneToSales = await buildSalesPhoneMap();

  const summary = { total: rows.length, created: 0, attached: 0, possibleMerges: 0, skipped: 0, errors: 0 };
  // Track watermark as both a timestamp (for comparison) and the original
  // Date string (for human-readable storage in the sheet).
  let maxDateTs = 0;
  let maxDateStr = '';

  const syncLogEntries = [];
  const possibleMergeEntries = [];

  for (const row of rows) {
    const { result, syncLogEntry, possibleMergeEntry } = await processSingleRow(row, { client, excludedCampaigns, syncedHashes, dryRun, phoneToSales });
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
