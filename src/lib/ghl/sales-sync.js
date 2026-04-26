// src/lib/ghl/sales-sync.js
//
// Standalone Sales Tracker → GHL sync. Runs independently from the call
// log sync; handles the "sale-after-call" lifecycle (a contact already
// exists from a prior call, then the agent submits an application later
// — the call log sync alone would never revisit the contact, so its
// policy data would stay empty forever).
//
// Per-tick behavior:
// 1. Read all sales records
// 2. For each, find existing GHL contact by phone:
//    - If found: update custom fields with current values (idempotent
//      overwrite). Detect high-signal field transitions (Placed Status,
//      Monthly Premium, Policy #, Effective Date) and emit notes for
//      each one that changed since last sync.
//    - If not found: create a new GHL contact with the sales record as
//      identity (handles the 7 unmatched records that don't have a call
//      log phone — referrals, internal transfers, etc.).
// 3. Batch-write Sales Sync Log entries at end (matches Phase A pattern).

import { buildPolicyPatch, SALES_PHONE_COLUMN } from './sales-mapping.js';
import { ALL_CUSTOM_FIELDS } from './field-mapping.js';
import { readRawSheet, appendRow } from '../sheets.js';
import { getSheetsClient } from '../sheets.js';

const SALES_SYNC_LOG_TAB = 'GHL Sales Sync Log';
const SALES_SYNC_LOG_HEADERS = ['Timestamp', 'Phone', 'First', 'Last', 'Policy #', 'Action', 'GHL Contact ID', 'Notes Added', 'Error'];

/**
 * Fields whose changes warrant a permanent timeline note in GHL.
 * Other field changes overwrite the custom field silently — current
 * state is always visible on the contact card, full audit trail lives
 * in the Sales sheet's Change History tab.
 */
const TRANSITION_FIELDS = [
  { internalName: 'placedStatus',     displayName: 'Placed Status',    icon: '📋', label: 'Status' },
  { internalName: 'monthlyPremium',   displayName: 'Monthly Premium',  icon: '💵', label: 'Premium' },
  { internalName: 'policyNumber',     displayName: 'Policy #',         icon: '🆔', label: 'Policy #' },
  { internalName: 'effectiveDate',    displayName: 'Effective Date',   icon: '📅', label: 'Effective date' },
];

function normalizePhone(p) {
  let s = (p ?? '').toString().replace(/\D/g, '');
  if (s.length === 11 && s.startsWith('1')) s = s.slice(1);
  return s;
}

/**
 * Compare prior GHL custom-field values to incoming policy patch values.
 * Returns an array of human-readable transition note strings for fields
 * in TRANSITION_FIELDS that materially changed.
 *
 * For Policy #: only emit a note when going from blank → set (the initial
 * carrier assignment), not on every value change (carriers occasionally
 * re-key).
 *
 * @param existingCustomFields Array<{id, value}> from GHL contact
 * @param newPolicyCustomFields { internalName: value } from buildPolicyPatch
 * @param fieldIdToName Map<fieldId, displayName>
 */
function detectTransitionNotes(existingCustomFields, newPolicyCustomFields, fieldIdToName, fieldNameToId) {
  const notes = [];
  for (const tf of TRANSITION_FIELDS) {
    const newValue = (newPolicyCustomFields[tf.internalName] ?? '').toString().trim();
    if (!newValue) continue;
    const fieldId = fieldNameToId.get(tf.displayName);
    if (!fieldId) continue;
    const existingEntry = (existingCustomFields ?? []).find(f => f.id === fieldId);
    const oldValue = (existingEntry?.value ?? '').toString().trim();
    if (oldValue === newValue) continue;

    if (tf.internalName === 'policyNumber') {
      // Only note when newly assigned (blank → set), not on re-keying
      if (oldValue === '') notes.push(`${tf.icon} ${tf.label} assigned: ${newValue}`);
    } else if (oldValue === '') {
      notes.push(`${tf.icon} ${tf.label} set: ${newValue}`);
    } else {
      notes.push(`${tf.icon} ${tf.label}: ${oldValue} → ${newValue}`);
    }
  }
  return notes;
}

/**
 * Process one sales record. Idempotent: re-running with unchanged data
 * is a no-op (overwrite-equals-no-change), no spurious notes emitted.
 *
 * Returns { result, logEntry } where result.action ∈
 * { 'updated', 'created', 'updated+notes', 'skipped:missing_phone', 'error' }.
 */
export async function processSingleSale(salesRecord, deps) {
  const { client, fieldNameToId, fieldIdToName } = deps;
  const phone = (salesRecord[SALES_PHONE_COLUMN] ?? '').toString().trim();
  const normalizedPhone = normalizePhone(phone);
  const baseLog = {
    'Timestamp': new Date().toISOString(),
    'Phone': phone,
    'First': salesRecord['First Name'] ?? '',
    'Last': salesRecord['Last Name'] ?? '',
    'Policy #': salesRecord['Policy #'] ?? '',
  };

  if (!normalizedPhone || normalizedPhone.length !== 10) {
    return {
      result: { action: 'skipped:missing_phone', contactId: null, error: null, notesAdded: 0 },
      logEntry: { ...baseLog, 'Action': 'skipped:missing_phone', 'GHL Contact ID': '', 'Notes Added': 0, 'Error': '' },
    };
  }

  try {
    const policyPatch = buildPolicyPatch(salesRecord);
    const existing = await client.searchByPhone(phone);

    if (existing) {
      // Need full record (with customFields) for transition detection
      const detail = await client.request('GET', `/contacts/${existing.id}`);
      const fullExisting = detail.contact ?? detail;

      const transitionNotes = detectTransitionNotes(
        fullExisting.customFields,
        policyPatch.customFields,
        fieldIdToName,
        fieldNameToId,
      );

      // Apply policy patch via updateContact. Note: updateContact's
      // signature requires currentContact for tag/phone merging — we
      // pass the freshly-fetched fullExisting. We don't pass any tags
      // (no new tags from sales sync) so existing tags pass through.
      await client.updateContact(existing.id, {
        customFields: { ...policyPatch.customFields },
        tags: [],
        additionalPhone: undefined,
      }, fullExisting);

      // Native enrichment via direct PUT (updateContact only handles
      // custom fields + tags + phones; we sometimes need to set first
      // name, last name, email, address from sales when call log was sparse).
      const nativeNeedsUpdate = Object.keys(policyPatch.nativeEnrichment).filter(k => {
        const incoming = policyPatch.nativeEnrichment[k];
        const current = fullExisting[k];
        return incoming && incoming !== current;
      });
      if (nativeNeedsUpdate.length > 0) {
        const nativePatch = {};
        for (const k of nativeNeedsUpdate) nativePatch[k] = policyPatch.nativeEnrichment[k];
        // Also fill firstName/lastName from sales if GHL contact has them blank
        if (!fullExisting.firstName && salesRecord['First Name']) nativePatch.firstName = salesRecord['First Name'];
        if (!fullExisting.lastName && salesRecord['Last Name']) nativePatch.lastName = salesRecord['Last Name'];
        await client.request('PUT', `/contacts/${existing.id}`, nativePatch);
      }

      // Emit transition notes
      for (const noteText of transitionNotes) {
        await client.addNote(existing.id, noteText);
      }

      return {
        result: {
          action: transitionNotes.length > 0 ? 'updated+notes' : 'updated',
          contactId: existing.id,
          error: null,
          notesAdded: transitionNotes.length,
        },
        logEntry: {
          ...baseLog,
          'Action': transitionNotes.length > 0 ? 'updated+notes' : 'updated',
          'GHL Contact ID': existing.id,
          'Notes Added': transitionNotes.length,
          'Error': '',
        },
      };
    }

    // No existing contact — create from sales record. Sales record is the
    // identity source; tags use 'source:sales-tracker' to mark origin.
    const native = {
      firstName: salesRecord['First Name'] || '',
      lastName: salesRecord['Last Name'] || '',
      phone: phone,
      state: salesRecord['State'] || '',
      country: 'US',
      source: 'Sales Tracker',
      ...policyPatch.nativeEnrichment,
    };
    // Drop blanks to avoid GHL 422s
    for (const k of Object.keys(native)) {
      if (!native[k]) delete native[k];
    }
    native.country = 'US'; // always include

    const created = await client.createContact({
      native,
      customFields: policyPatch.customFields,
      tags: ['source:sales-tracker'],
    });

    if (created._dedupedExisting) {
      // GHL native dedup found a contact we missed (race or stale index).
      // Fall through to update path on the recovered contact.
      const detail = await client.request('GET', `/contacts/${created.id}`);
      const fullExisting = detail.contact ?? detail;
      await client.updateContact(created.id, {
        customFields: policyPatch.customFields,
        tags: [],
        additionalPhone: undefined,
      }, fullExisting);
      return {
        result: { action: 'updated', contactId: created.id, error: null, notesAdded: 0 },
        logEntry: { ...baseLog, 'Action': 'updated', 'GHL Contact ID': created.id, 'Notes Added': 0, 'Error': '' },
      };
    }

    return {
      result: { action: 'created', contactId: created.id, error: null, notesAdded: 0 },
      logEntry: { ...baseLog, 'Action': 'created', 'GHL Contact ID': created.id, 'Notes Added': 0, 'Error': '' },
    };
  } catch (err) {
    const errMsg = (err.message ?? String(err)).slice(0, 500);
    return {
      result: { action: 'error', contactId: null, error: errMsg, notesAdded: 0 },
      logEntry: { ...baseLog, 'Action': 'error', 'GHL Contact ID': '', 'Notes Added': 0, 'Error': errMsg },
    };
  }
}

/**
 * Process all sales records. Mirrors processBatch shape: continue-on-error,
 * batch-write log at end, return summary.
 */
export async function processSalesBatch({ rows, client, dryRun = false }) {
  // Warm the custom-field cache once and build name↔id maps. processSingleSale
  // uses these to look up existing values for transition detection.
  await client.resolveCustomFields();
  const fieldNameToId = await client.resolveCustomFields();
  const fieldIdToName = new Map();
  for (const [name, id] of fieldNameToId.entries()) fieldIdToName.set(id, name);

  const summary = { total: rows.length, created: 0, updated: 0, updatedWithNotes: 0, totalNotesAdded: 0, skipped: 0, errors: 0 };
  const logEntries = [];

  for (const row of rows) {
    const { result, logEntry } = await processSingleSale(row, { client, fieldNameToId, fieldIdToName, dryRun });
    logEntries.push(logEntry);

    if (result.action === 'created') summary.created++;
    else if (result.action === 'updated') summary.updated++;
    else if (result.action === 'updated+notes') { summary.updated++; summary.updatedWithNotes++; summary.totalNotesAdded += result.notesAdded; }
    else if (result.action.startsWith('skipped:')) summary.skipped++;
    else if (result.action === 'error') summary.errors++;
  }

  // Batch-write log entries (matches Phase A's pattern for the call log sync).
  await ensureSalesSyncLogTab();
  await appendSalesSyncLogBatch(logEntries);

  return summary;
}

/**
 * Ensure the Sales Sync Log tab exists. Idempotent. Created on first
 * processSalesBatch call so we don't have to add it to ghl-init-tabs.js
 * separately.
 */
async function ensureSalesSyncLogTab() {
  const sheetId = process.env.GOALS_SHEET_ID;
  const sheets = await getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const exists = meta.data.sheets.some(s => s.properties.title === SALES_SYNC_LOG_TAB);
  if (exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: SALES_SYNC_LOG_TAB } } }] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${SALES_SYNC_LOG_TAB}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [SALES_SYNC_LOG_HEADERS] },
  });
}

async function appendSalesSyncLogBatch(entries) {
  if (!entries || entries.length === 0) return;
  const sheetId = process.env.GOALS_SHEET_ID;
  const sheets = await getSheetsClient();
  const values = entries.map(entry => SALES_SYNC_LOG_HEADERS.map(h => entry[h] ?? ''));
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: SALES_SYNC_LOG_TAB,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });
}

/**
 * Load all sales records from SALES_SHEET_ID/SALES_TAB_NAME. Used by the
 * /api/cron/ghl-sales-sync route to pass into processSalesBatch.
 */
export async function readAllSalesRecords() {
  const sheetId = process.env.SALES_SHEET_ID;
  const tab = process.env.SALES_TAB_NAME || 'Sheet1';
  if (!sheetId) return [];
  const { data } = await readRawSheet(sheetId, tab);
  return data;
}
