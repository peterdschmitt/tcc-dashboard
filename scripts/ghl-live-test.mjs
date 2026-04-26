// scripts/ghl-live-test.mjs
// Tiny controlled live test: pick N rows from a date range, run them
// through processBatch with dry-run on by default. Use --live to actually
// write contacts to GHL.
//
// Usage:
//   node --env-file=.env.local scripts/ghl-live-test.mjs [--limit=5] [--date=04/24/2026] [--live]
//
// This bypasses the API route and calls processBatch directly so we can
// control the row count for the first end-to-end smoke test.

import { createGhlClient } from '../src/lib/ghl/client.js';
import { readRawSheet } from '../src/lib/sheets.js';
import { processBatch } from '../src/lib/ghl/sync.js';

function parseArgs() {
  const args = { limit: 5, date: null, live: false };
  for (const a of process.argv.slice(2)) {
    if (a === '--live') args.live = true;
    else if (a.startsWith('--limit=')) args.limit = parseInt(a.slice(8), 10);
    else if (a.startsWith('--date=')) args.date = a.slice(7);
  }
  return args;
}

async function main() {
  const { limit, date, live } = parseArgs();
  const dryRun = !live;
  console.log(`Running live test: limit=${limit}, date=${date ?? 'any'}, dryRun=${dryRun}`);

  const token = process.env.GHL_API_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!token || !locationId) throw new Error('GHL_API_TOKEN and GHL_LOCATION_ID required');

  const client = createGhlClient({ token, locationId, dryRun });
  await client.resolveCustomFields();

  const sheetId = process.env.CALLLOGS_SHEET_ID;
  const tab = process.env.CALLLOGS_TAB_NAME || 'Report';
  const { data } = await readRawSheet(sheetId, tab);

  let candidates = data;
  if (date) {
    candidates = candidates.filter(r => (r['Date'] ?? '').startsWith(date));
  }
  // Prefer rows with valid phone + first/last so we can exercise all tiers.
  candidates = candidates.filter(r => (r['Phone'] ?? '').trim());
  const rows = candidates.slice(0, limit);

  console.log(`Selected ${rows.length} rows.`);
  if (!rows.length) { console.log('Nothing to do.'); return; }

  const t0 = Date.now();
  const summary = await processBatch({ rows, client, dryRun, advanceWatermark: false });
  const elapsedMs = Date.now() - t0;

  console.log('Summary:', summary);
  console.log(`Elapsed: ${(elapsedMs / 1000).toFixed(1)}s (${(elapsedMs / rows.length).toFixed(0)}ms/row)`);
}

main().catch(e => { console.error(e); process.exit(1); });
