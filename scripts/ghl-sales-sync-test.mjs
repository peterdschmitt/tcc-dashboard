// scripts/ghl-sales-sync-test.mjs
// Tiny controlled live test of processSalesBatch.
//
// Usage:
//   node --env-file=.env.local scripts/ghl-sales-sync-test.mjs [--limit=10] [--live]
//
// Defaults: limit=10, dryRun=true. Bypasses the cron route so we can
// test end-to-end without HTTP overhead.

import { createGhlClient } from '../src/lib/ghl/client.js';
import { readAllSalesRecords, processSalesBatch } from '../src/lib/ghl/sales-sync.js';

function parseArgs() {
  const args = { limit: 10, live: false };
  for (const a of process.argv.slice(2)) {
    if (a === '--live') args.live = true;
    else if (a.startsWith('--limit=')) args.limit = parseInt(a.slice(8), 10);
  }
  return args;
}

async function main() {
  const { limit, live } = parseArgs();
  const dryRun = !live;
  console.log(`Sales sync test: limit=${limit}, dryRun=${dryRun}`);

  const client = createGhlClient({
    token: process.env.GHL_API_TOKEN,
    locationId: process.env.GHL_LOCATION_ID,
    dryRun,
  });

  const all = await readAllSalesRecords();
  const rows = all.slice(0, limit);
  console.log(`Selected ${rows.length} of ${all.length} sales records.`);
  if (!rows.length) return;

  const t0 = Date.now();
  const summary = await processSalesBatch({ rows, client, dryRun });
  const elapsedMs = Date.now() - t0;

  console.log('Summary:', summary);
  console.log(`Elapsed: ${(elapsedMs / 1000).toFixed(1)}s (${(elapsedMs / rows.length).toFixed(0)}ms/row)`);
}

main().catch(e => { console.error(e); process.exit(1); });
