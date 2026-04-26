// src/lib/ghl/row-hash.js
import { createHash } from 'node:crypto';

/**
 * Stable sha256 hash of a Call Log row, used as idempotency key.
 * Composed from `Lead Id`, `Date`, `Phone`, and `Duration` — the four
 * fields that together uniquely identify a single call attempt.
 */
export function rowHash(row) {
  const parts = [
    row['Lead Id'] ?? '',
    row['Date'] ?? '',
    row['Phone'] ?? '',
    row['Duration'] ?? '',
  ].map(v => String(v).trim());
  return createHash('sha256').update(parts.join('|')).digest('hex');
}
