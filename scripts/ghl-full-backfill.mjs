// scripts/ghl-full-backfill.mjs
// Full historical backfill: all call log rows then all sales records.
//
// Designed to run as a detached background process. Logs progress to
// stdout periodically (every 100 rows for calls, every 25 for sales).
//
// Usage:
//   nohup node --env-file=.env.local scripts/ghl-full-backfill.mjs > /tmp/ghl-backfill.log 2>&1 &

import { createGhlClient } from '../src/lib/ghl/client.js';
import { readRawSheet } from '../src/lib/sheets.js';
import { processSingleRow, buildSalesPhoneMap } from '../src/lib/ghl/sync.js';
import { readExcludedCampaigns, readSyncedHashes, appendSyncLogBatch, appendPossibleMergeBatch, writeWatermark, parseCallLogDate } from '../src/lib/ghl/sheet-state.js';
import { rowHash } from '../src/lib/ghl/row-hash.js';
import { processSalesBatch, readAllSalesRecords } from '../src/lib/ghl/sales-sync.js';

const FLUSH_EVERY = 250; // batch-write sync log every 250 rows so progress is durable

function ts() { return new Date().toISOString().slice(11, 19); }
function log(...args) { console.log(`[${ts()}]`, ...args); }

async function callLogBackfill(client) {
  log('=== Call Log Backfill: starting ===');
  const sheetId = process.env.CALLLOGS_SHEET_ID;
  const tab = process.env.CALLLOGS_TAB_NAME || 'Report';
  const { data: allRows } = await readRawSheet(sheetId, tab);
  log(`Read ${allRows.length} call log rows`);

  await client.resolveCustomFields();
  const excludedCampaigns = await readExcludedCampaigns();
  const syncedHashes = await readSyncedHashes();
  log(`Excluded campaigns: ${excludedCampaigns.length}; pre-existing synced hashes: ${syncedHashes.size}`);

  const phoneToSales = await buildSalesPhoneMap();
  log(`Sales phone map: ${phoneToSales.size} entries`);

  const summary = { total: allRows.length, created: 0, attached: 0, possibleMerges: 0, skipped: 0, errors: 0, enriched: 0 };
  let maxDateTs = 0;
  let maxDateStr = '';
  let pendingLog = [];
  let pendingMerges = [];
  const t0 = Date.now();

  async function flush(reason) {
    if (pendingLog.length > 0) {
      await appendSyncLogBatch(pendingLog);
      pendingLog = [];
    }
    if (pendingMerges.length > 0) {
      await appendPossibleMergeBatch(pendingMerges);
      pendingMerges = [];
    }
    log(`flushed (${reason})`);
  }

  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i];
    const { result, syncLogEntry, possibleMergeEntry } = await processSingleRow(row, {
      client, excludedCampaigns, syncedHashes, phoneToSales, dryRun: false,
    });
    pendingLog.push(syncLogEntry);
    if (possibleMergeEntry) pendingMerges.push(possibleMergeEntry);

    if (result.action === 'created') summary.created++;
    else if (result.action === 'attached') summary.attached++;
    else if (result.action === 'created+possible-merge') { summary.created++; summary.possibleMerges++; }
    else if (result.action.startsWith('skipped:')) summary.skipped++;
    else if (result.action === 'error') summary.errors++;

    // Track if this row's phone matched a sales record
    const phone = (row['Phone'] ?? '').replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
    if (phone.length === 10 && phoneToSales.has(phone) && result.action !== 'error' && !result.action.startsWith('skipped:')) summary.enriched++;

    if (result.action !== 'error') {
      const ts = parseCallLogDate(row['Date'] ?? '');
      if (ts > maxDateTs) { maxDateTs = ts; maxDateStr = row['Date']; }
    }
    syncedHashes.add(rowHash(row));

    if ((i + 1) % FLUSH_EVERY === 0) {
      await flush(`row ${i + 1}/${allRows.length}`);
      const rate = ((i + 1) / ((Date.now() - t0) / 1000)).toFixed(2);
      const remainingSec = ((allRows.length - i - 1) / parseFloat(rate)).toFixed(0);
      log(`progress: ${i + 1}/${allRows.length} | ${rate} rows/s | est remaining: ${remainingSec}s | running totals: created=${summary.created} attached=${summary.attached} skipped=${summary.skipped} errors=${summary.errors} enriched=${summary.enriched}`);
    }
  }
  await flush('end of call log backfill');
  if (maxDateStr) await writeWatermark(maxDateStr);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
  log(`=== Call Log Backfill: DONE in ${elapsed}s ===`);
  log('Summary:', JSON.stringify(summary));
  return summary;
}

async function salesBackfill(client) {
  log('=== Sales Tracker Backfill: starting ===');
  const rows = await readAllSalesRecords();
  log(`Read ${rows.length} sales records`);
  const t0 = Date.now();
  const summary = await processSalesBatch({ rows, client, dryRun: false });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
  log(`=== Sales Tracker Backfill: DONE in ${elapsed}s ===`);
  log('Summary:', JSON.stringify(summary));
  return summary;
}

async function main() {
  const token = process.env.GHL_API_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!token || !locationId) throw new Error('GHL_API_TOKEN and GHL_LOCATION_ID required');

  const client = createGhlClient({ token, locationId });
  const overall = Date.now();

  const callSummary = await callLogBackfill(client);
  const salesSummary = await salesBackfill(client);

  const totalSec = ((Date.now() - overall) / 1000).toFixed(0);
  log(`=== ALL DONE in ${totalSec}s ===`);
  log(`Call summary: ${JSON.stringify(callSummary)}`);
  log(`Sales summary: ${JSON.stringify(salesSummary)}`);
}

main().catch(e => { console.error(`[${ts()}] FATAL:`, e); process.exit(1); });
