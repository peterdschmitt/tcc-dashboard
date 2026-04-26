// src/lib/db-sync/calls.js
import { createHash } from 'node:crypto';
import { sql } from '../db.js';
import { readRawSheet } from '../sheets.js';
import { normalizePhone, parseCallLogDate } from './contacts.js';

function rowHash(row) {
  const parts = [row['Lead Id'] ?? '', row['Date'] ?? '', row['Phone'] ?? '', row['Duration'] ?? ''];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

/**
 * Sync calls from Call Logs. Idempotent via row_hash UNIQUE.
 * Resolves contact_id by phone, campaign_id by Campaign code, agent_id by Rep name.
 */
export async function syncCalls() {
  const sheetId = process.env.CALLLOGS_SHEET_ID;
  const tab = process.env.CALLLOGS_TAB_NAME || 'Report';
  if (!sheetId) throw new Error('CALLLOGS_SHEET_ID not set');

  // Pre-load FK lookups
  const contactsByPhone = new Map();
  for (const c of await sql`SELECT id, phone FROM contacts`) contactsByPhone.set(c.phone, c.id);
  const campaigns = new Map();
  for (const c of await sql`SELECT id, code FROM campaigns`) campaigns.set(c.code, c.id);
  const agents = new Map();
  for (const a of await sql`SELECT id, canonical_name FROM agents`) agents.set(a.canonicalName, a.id);

  const { data } = await readRawSheet(sheetId, tab);
  let inserted = 0, skipped = 0;

  for (const row of data) {
    const phone = normalizePhone(row['Phone']);
    const contactId = contactsByPhone.get(phone);
    if (!contactId) { skipped++; continue; }

    const code = (row['Campaign'] ?? '').trim();
    const campaignId = code ? (campaigns.get(code) ?? null) : null;
    const repName = (row['Rep'] ?? '').trim();
    const agentId = repName ? (agents.get(repName) ?? null) : null;

    const callDate = parseCallLogDate(row['Date']);
    if (!callDate) { skipped++; continue; }

    const durStr = (row['Duration'] ?? '').toString().trim();
    let durSec = null;
    // Handle "h:mm:ss" or "mm:ss" or seconds-as-int
    if (/^\d+:\d+(:\d+)?$/.test(durStr)) {
      const parts = durStr.split(':').map(p => parseInt(p, 10));
      durSec = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
    } else {
      const n = parseInt(durStr, 10);
      durSec = isNaN(n) ? null : n;
    }

    try {
      await sql`
        INSERT INTO calls (
          contact_id, campaign_id, agent_id,
          call_date, campaign_code, subcampaign, rep_name, phone_raw,
          attempt_number, caller_id, inbound_source, lead_id, client_id,
          call_status, is_callable, duration_seconds, call_type, details,
          hangup, hold_time, hangup_source, recording_url, import_date,
          row_hash
        ) VALUES (
          ${contactId}, ${campaignId}, ${agentId},
          ${callDate}, ${code || null}, ${row['Subcampaign'] || null}, ${repName || null}, ${row['Phone'] || null},
          ${parseInt(row['Attempt'] ?? '0', 10) || null}, ${row['Caller ID'] || null}, ${row['Inbound Source'] || null}, ${row['Lead Id'] || null}, ${row['Client ID'] || null},
          ${row['Call Status'] || null}, ${(row['Is Callable'] ?? '').toLowerCase().startsWith('y')}, ${durSec}, ${row['Call Type'] || null}, ${row['Details'] || null},
          ${row['Hangup'] || null}, ${row['HoldTime'] || null}, ${row['Hangup Source'] || null}, ${row['Recording'] || null}, ${parseCallLogDate(row['Import Date'])},
          ${rowHash(row)}
        )
        ON CONFLICT (row_hash) DO NOTHING
      `;
      inserted++;
    } catch (e) {
      skipped++;
    }
  }

  return { processed: data.length, inserted, skipped };
}
