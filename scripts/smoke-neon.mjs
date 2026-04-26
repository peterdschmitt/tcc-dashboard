// Smoke test for Neon connectivity.
// Run: node --env-file=.env.local scripts/smoke-neon.mjs
import { sql, pingDatabase } from '../src/lib/db.js';

async function main() {
  const ok = await pingDatabase();
  if (!ok) {
    console.error('FAIL — pingDatabase returned false');
    process.exit(1);
  }
  const rows = await sql`SELECT now() AS now, current_database() AS db, current_user AS usr, version() AS pg`;
  const r = rows[0];
  console.log('Connected to Neon:');
  console.log('  database:', r.db);
  console.log('  user:    ', r.usr);
  console.log('  now:     ', r.now);
  console.log('  pg:      ', String(r.pg).slice(0, 60) + '…');
  console.log('PASS');
}

main().catch(err => {
  console.error('FAIL —', err.message);
  process.exit(1);
});
