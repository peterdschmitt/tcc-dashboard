// src/lib/db.js
import postgres from 'postgres';

let _sql = null;

/**
 * Lazily initialize the postgres client. Importing this module does NOT
 * open a connection; the first query does. Subsequent calls reuse the
 * same connection pool.
 *
 * Pool size 10 is appropriate for Vercel's serverless model — each
 * function invocation gets its own pool, and 10 is comfortable on
 * Neon's free tier (~100 concurrent connections allowed).
 *
 * `transform: postgres.camel` returns column values with camelCase keys
 * (firstName instead of first_name) to match the existing JS code style.
 */
function getSql() {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  _sql = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    transform: postgres.camel,
  });
  return _sql;
}

/**
 * Tagged-template helper for parameterized queries.
 *   const rows = await sql`SELECT * FROM contacts WHERE phone = ${phone}`;
 *
 * Postgres.js handles parameter binding automatically (no SQL injection
 * risk), and returns an array of row objects.
 */
export const sql = (...args) => getSql()(...args);

/**
 * Close the connection pool. Used by scripts that need to exit cleanly.
 */
export async function closeDb() {
  if (_sql) {
    await _sql.end();
    _sql = null;
  }
}

/**
 * Direct access to the underlying postgres.js client for advanced use
 * cases like .unsafe() (multi-statement DDL execution).
 */
export const rawClient = () => getSql();

/**
 * Helper to create an unsafe SQL fragment (e.g., for column references that
 * cannot be parameterized). This must be called only when the caller is
 * certain the input is safe and comes from trusted sources (like the
 * portfolio registry which is populated from schema introspection).
 */
export const sqlUnsafe = (expr) => getSql().unsafe(expr);
