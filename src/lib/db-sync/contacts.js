// src/lib/db-sync/contacts.js
import { sql } from '../db.js';
import { readRawSheet } from '../sheets.js';

/**
 * Normalize a phone number: strip non-digits, drop leading "1" for
 * 11-digit US numbers. Returns 10-digit string or empty.
 */
export function normalizePhone(p) {
  let s = (p ?? '').toString().replace(/\D/g, '');
  if (s.length === 11 && s.startsWith('1')) s = s.slice(1);
  return s.length === 10 ? s : '';
}

/**
 * Parse Call Log MM/DD/YYYY h:mm[:ss] AM/PM date string to a JS Date.
 * Returns null if unparseable.
 */
export function parseCallLogDate(s) {
  if (!s) return null;
  const t = Date.parse(s);
  return isNaN(t) ? null : new Date(t);
}

/**
 * Parse Sales Tracker MM-DD-YYYY date string to a JS Date.
 */
export function parseSalesDate(s) {
  if (!s) return null;
  const cleaned = s.toString().trim();
  if (!cleaned) return null;
  // Convert MM-DD-YYYY to MM/DD/YYYY for Date.parse
  const t = Date.parse(cleaned.replace(/-/g, '/'));
  return isNaN(t) ? null : new Date(t);
}

/**
 * Sync contacts from Sales Tracker + Call Logs. Phone-keyed dedup.
 *
 * For each unique phone:
 *   - If sales record exists: prefer its identity fields (full name, email,
 *     address, DOB, gender)
 *   - If only call log entries: take what's there (first/last name, state)
 *   - Always default country='US' if not set
 *
 * Returns { processed, inserted, updated, skipped }.
 */
export async function syncContacts() {
  const salesId = process.env.SALES_SHEET_ID;
  const salesTab = process.env.SALES_TAB_NAME || 'Sheet1';
  const callLogsId = process.env.CALLLOGS_SHEET_ID;
  const callLogsTab = process.env.CALLLOGS_TAB_NAME || 'Report';

  // Build a phone → identity map. Sales takes precedence for richer fields.
  const identityByPhone = new Map();

  const { data: callData } = await readRawSheet(callLogsId, callLogsTab);
  for (const row of callData) {
    const phone = normalizePhone(row['Phone']);
    if (!phone) continue;
    if (!identityByPhone.has(phone)) {
      identityByPhone.set(phone, {
        firstName: (row['First'] ?? '').trim() || null,
        lastName: (row['Last'] ?? '').trim() || null,
        state: (row['State'] ?? '').trim() || null,
        country: (row['Country'] ?? '').trim() || 'US',
        source: (row['Inbound Source'] ?? '').trim() || null,
        firstSeenAt: parseCallLogDate(row['Date']) || null,
      });
    }
  }

  const { data: salesData } = await readRawSheet(salesId, salesTab);
  for (const row of salesData) {
    const phone = normalizePhone(row['Phone Number (US format)']);
    if (!phone) continue;
    const existing = identityByPhone.get(phone) ?? {};
    identityByPhone.set(phone, {
      ...existing,
      firstName: (row['First Name'] ?? existing.firstName ?? '').trim() || existing.firstName || null,
      lastName: (row['Last Name'] ?? existing.lastName ?? '').trim() || existing.lastName || null,
      email: (row['Email Address'] ?? '').trim() || existing.email || null,
      dateOfBirth: parseSalesDate(row['Date of Birth']) || existing.dateOfBirth || null,
      gender: (row['Gender'] ?? '').trim() || existing.gender || null,
      address1: (row['Street Address'] ?? '').trim() || existing.address1 || null,
      city: (row['City'] ?? '').trim() || existing.city || null,
      state: (row['State'] ?? existing.state ?? '').trim() || existing.state || null,
      postalCode: (row['Zip Code'] ?? '').trim() || existing.postalCode || null,
      country: (row['Country'] ?? existing.country ?? 'US').trim() || existing.country || 'US',
    });
  }

  let inserted = 0, updated = 0;

  for (const [phone, raw] of identityByPhone) {
    const ident = {
      firstName: raw.firstName ?? null,
      lastName: raw.lastName ?? null,
      email: raw.email ?? null,
      dateOfBirth: raw.dateOfBirth ?? null,
      gender: raw.gender ?? null,
      address1: raw.address1 ?? null,
      city: raw.city ?? null,
      state: raw.state ?? null,
      postalCode: raw.postalCode ?? null,
      country: raw.country ?? 'US',
      firstSeenAt: raw.firstSeenAt ?? null,
      source: raw.source ?? null,
    };
    const r = await sql`
      INSERT INTO contacts (phone, first_name, last_name, email, date_of_birth, gender, address1, city, state, postal_code, country, first_seen_at, source)
      VALUES (${phone}, ${ident.firstName}, ${ident.lastName}, ${ident.email}, ${ident.dateOfBirth}, ${ident.gender}, ${ident.address1}, ${ident.city}, ${ident.state}, ${ident.postalCode}, ${ident.country}, ${ident.firstSeenAt}, ${ident.source})
      ON CONFLICT (phone) DO UPDATE SET
        first_name = COALESCE(contacts.first_name, EXCLUDED.first_name),
        last_name = COALESCE(contacts.last_name, EXCLUDED.last_name),
        email = COALESCE(EXCLUDED.email, contacts.email),
        date_of_birth = COALESCE(EXCLUDED.date_of_birth, contacts.date_of_birth),
        gender = COALESCE(EXCLUDED.gender, contacts.gender),
        address1 = COALESCE(EXCLUDED.address1, contacts.address1),
        city = COALESCE(EXCLUDED.city, contacts.city),
        state = COALESCE(EXCLUDED.state, contacts.state),
        postal_code = COALESCE(EXCLUDED.postal_code, contacts.postal_code),
        updated_at = NOW()
      RETURNING (xmax = 0) AS inserted
    `;
    if (r[0]?.inserted) inserted++;
    else updated++;
  }

  return { processed: identityByPhone.size, inserted, updated };
}
