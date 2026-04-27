import { createHash } from 'node:crypto';

/**
 * Compute a stable hash for a ledger row. Used as the unique idempotency
 * key. Includes the transaction ID + statement date + the four money
 * fields that uniquely identify the financial event.
 */
export function rowHash(row) {
  const parts = [
    row['Transaction ID'] ?? '',
    row['Statement Date'] ?? '',
    row['Advance Amount'] ?? '',
    row['Commission Amount'] ?? '',
    row['Chargeback Amount'] ?? '',
    row['Recovery Amount'] ?? '',
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

/**
 * Parse a date string into a JS Date (UTC midnight). Handles MM/DD/YYYY,
 * MM-DD-YYYY, ISO YYYY-MM-DD, and MM/DD/YY (2-digit year — assumes 20YY
 * since this is forward-looking commission data, not historical archives).
 * Returns null for empty/invalid input.
 */
export function parseDate(s) {
  if (!s) return null;
  let cleaned = s.toString().trim();
  if (!cleaned) return null;
  // Expand 2-digit year MM/DD/YY → MM/DD/20YY (handles ledger Issue Date format)
  const twoDigitYear = cleaned.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2})$/);
  if (twoDigitYear) {
    cleaned = `${twoDigitYear[1]}/${twoDigitYear[2]}/20${twoDigitYear[3]}`;
  }
  // Try ISO first
  let t = Date.parse(cleaned);
  if (!isNaN(t)) return new Date(t);
  // Try MM/DD/YYYY by replacing - with /
  t = Date.parse(cleaned.replace(/-/g, '/'));
  return isNaN(t) ? null : new Date(t);
}

/**
 * Parse a money string into a JS number. Strips $, commas, whitespace.
 * Treats parenthesized values as negative ("($50.25)" → -50.25).
 * Returns null for empty/garbage input.
 */
export function parseMoney(s) {
  if (s == null) return null;
  let str = s.toString().trim();
  if (!str) return null;
  let negative = false;
  if (str.startsWith('(') && str.endsWith(')')) {
    negative = true;
    str = str.slice(1, -1);
  }
  // Strip currency + commas + whitespace
  const cleaned = str.replace(/[$,\s]/g, '');
  const n = parseFloat(cleaned);
  if (isNaN(n)) return null;
  return negative ? -n : n;
}

/**
 * Parse a percentage string into a decimal. "75%" or "75" → 0.75,
 * "0.75" → 0.75. Returns null for empty.
 */
export function parsePct(s) {
  if (s == null) return null;
  const str = s.toString().trim();
  if (!str) return null;
  const cleaned = str.replace(/[%\s]/g, '');
  const n = parseFloat(cleaned);
  if (isNaN(n)) return null;
  // If the raw number is > 1, assume it was meant as percentage (75 → 0.75)
  return n > 1 ? n / 100 : n;
}

/**
 * Normalize a free-text field: trim, collapse whitespace, return null for
 * empty/whitespace-only. Used for raw_*_name fields where empty should
 * land as NULL in the DB rather than empty string.
 */
export function normalizeText(s) {
  if (s == null) return null;
  const cleaned = s.toString().trim().replace(/\s+/g, ' ');
  return cleaned ? cleaned : null;
}
