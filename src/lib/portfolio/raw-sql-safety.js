// src/lib/portfolio/raw-sql-safety.js

/**
 * Keywords that must NOT appear in a user-supplied raw_where expression.
 * Used as the first layer of the two-layer defense; the second layer is
 * the read-only DB role (DATABASE_URL_READONLY) which physically cannot
 * execute writes/DDL even if a keyword slips through.
 */
export const RAW_SQL_DENIED_KEYWORDS = [
  'DELETE', 'INSERT', 'UPDATE', 'DROP', 'ALTER', 'CREATE',
  'TRUNCATE', 'GRANT', 'REVOKE', 'EXECUTE', 'EXEC',
  'MERGE', 'COPY', 'CALL',
];

/**
 * Validate a raw_where fragment. Returns { ok: true } if safe, or
 * { ok: false, reason: '...' } with a human-readable rejection reason.
 */
export function isRawWhereSafe(input) {
  if (!input) return { ok: true };
  const s = String(input);

  if (s.includes(';')) return { ok: false, reason: 'Semicolons are not allowed' };
  if (s.includes('--')) return { ok: false, reason: 'Line comments (--) are not allowed' };
  if (s.includes('/*')) return { ok: false, reason: 'Block comments (/*) are not allowed' };

  for (const kw of RAW_SQL_DENIED_KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b`, 'i');
    if (re.test(s)) return { ok: false, reason: `Keyword "${kw}" is not allowed in raw filters` };
  }

  return { ok: true };
}
