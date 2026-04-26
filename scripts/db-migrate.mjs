// scripts/db-migrate.mjs
// Run:
//   node scripts/db-migrate.mjs            # apply pending (default 'up')
//   node scripts/db-migrate.mjs status     # list applied + pending
//
// Reads .env.local via scripts/load-env.mjs (more lenient than Node's
// --env-file flag — preserves \\n escapes inside the GOOGLE_SERVICE_ACCOUNT_KEY
// JSON value).
//
// Migrations are .sql files in migrations/, applied alphabetically.
// Applied filenames are tracked in the _migrations table; subsequent
// runs skip files already applied. No rollback in V1 — write a new
// forward migration to fix issues.

import './load-env.mjs';
import { sql, closeDb, rawClient } from '../src/lib/db.js';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const MIGRATIONS_DIR = 'migrations';

async function ensureMigrationsTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

async function listAppliedFilenames() {
  const rows = await sql`SELECT filename FROM _migrations ORDER BY filename`;
  return new Set(rows.map(r => r.filename));
}

async function listMigrationFiles() {
  const all = await readdir(MIGRATIONS_DIR);
  return all.filter(f => f.endsWith('.sql')).sort();
}

async function applyMigration(filename) {
  const path = join(MIGRATIONS_DIR, filename);
  const sqlText = await readFile(path, 'utf8');
  console.log(`Applying ${filename}...`);
  const client = rawClient();
  await client.unsafe(sqlText); // .unsafe needed for multi-statement DDL
  await sql`INSERT INTO _migrations (filename) VALUES (${filename})`;
  console.log(`  ✓ ${filename}`);
}

async function up() {
  await ensureMigrationsTable();
  const applied = await listAppliedFilenames();
  const all = await listMigrationFiles();
  const pending = all.filter(f => !applied.has(f));
  if (pending.length === 0) {
    console.log('No pending migrations.');
    return;
  }
  console.log(`${pending.length} pending migration(s):`);
  for (const f of pending) await applyMigration(f);
  console.log('Done.');
}

async function status() {
  await ensureMigrationsTable();
  const applied = await listAppliedFilenames();
  const all = await listMigrationFiles();
  if (all.length === 0) { console.log('No migration files.'); return; }
  for (const f of all) console.log(applied.has(f) ? `✓ ${f}` : `· ${f} (pending)`);
}

async function main() {
  const cmd = process.argv[2] ?? 'up';
  if (cmd === 'up') await up();
  else if (cmd === 'status') await status();
  else { console.error(`Unknown command: ${cmd}. Use 'up' or 'status'.`); process.exit(1); }
}

main()
  .catch(e => { console.error('FATAL:', e); process.exitCode = 1; })
  .finally(() => closeDb());
