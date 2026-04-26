// Neon Postgres connection helper.
//
// Uses @neondatabase/serverless's tagged-template `sql` for one-shot queries
// (HTTP fetch under the hood — works in Edge, Vercel functions, and local node).
// For multi-statement transactions or session-scoped state, use `getPool()`.
//
// Env vars (set automatically by the Vercel ↔ Neon integration):
//   DATABASE_URL           — pooled connection string (default for HTTP queries)
//   DATABASE_URL_UNPOOLED  — direct connection string (use for migrations / long txns)
//
// Usage:
//   import { sql } from '@/lib/db';
//   const rows = await sql`SELECT now() AS now`;
//
//   import { getPool } from '@/lib/db';
//   const pool = getPool();
//   const client = await pool.connect();
//   try {
//     await client.query('BEGIN');
//     // ... multiple statements ...
//     await client.query('COMMIT');
//   } finally {
//     client.release();
//   }

import { neon, Pool } from '@neondatabase/serverless';

function getConnectionString() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL (or POSTGRES_URL) is not set. ' +
      'Run `vercel env pull .env.local` or configure Neon in Vercel.'
    );
  }
  return url;
}

// Lazily-initialized HTTP-style query function. Use for one-shot queries.
let _sql = null;
export function sql(...args) {
  if (!_sql) _sql = neon(getConnectionString());
  return _sql(...args);
}

// Lazily-initialized connection pool. Use for transactions or repeated queries
// inside a single request handler. Pool is reused across handler invocations
// in the same warm Vercel function.
let _pool = null;
export function getPool() {
  if (!_pool) {
    _pool = new Pool({ connectionString: getConnectionString() });
  }
  return _pool;
}

// Health check helper — returns true if the database is reachable.
// Useful for /api/health endpoints and smoke tests.
export async function pingDatabase() {
  const rows = await sql`SELECT 1 AS ok`;
  return rows[0]?.ok === 1;
}
