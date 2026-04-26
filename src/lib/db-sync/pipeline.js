// src/lib/db-sync/pipeline.js
import { sql } from '../db.js';
import { syncCampaigns } from './campaigns.js';
import { syncCarriersAndProducts } from './carriers-products.js';
import { syncAgents } from './agents.js';
import { syncContacts } from './contacts.js';
import { syncPolicies } from './policies.js';
import { syncCalls } from './calls.js';
import { refreshContactDenorms } from './refresh-denorms.js';

/**
 * Run the full Sheets → DB sync pipeline in dependency order.
 * Reference data first (campaigns, carriers/products, agents),
 * then transactional data (contacts, policies, calls),
 * then denorm refresh.
 */
export async function runFullSync() {
  const overall = { startedAt: new Date().toISOString(), steps: {} };

  for (const [key, fn] of [
    ['campaigns', syncCampaigns],
    ['carriers_products', syncCarriersAndProducts],
    ['agents', syncAgents],
    ['contacts', syncContacts],
    ['policies', syncPolicies],
    ['calls', syncCalls],
    ['refresh_denorms', refreshContactDenorms],
  ]) {
    const t0 = Date.now();
    try {
      const result = await fn();
      const elapsedMs = Date.now() - t0;
      overall.steps[key] = { ok: true, elapsedMs, ...result };
      await sql`
        INSERT INTO sync_state (source_key, last_sync_at, last_run_status, rows_processed, rows_errored)
        VALUES (${key}, NOW(), 'success', ${result.processed ?? result.inserted ?? 0}, 0)
        ON CONFLICT (source_key) DO UPDATE SET
          last_sync_at = NOW(),
          last_run_status = 'success',
          last_error = NULL,
          rows_processed = EXCLUDED.rows_processed,
          rows_errored = 0,
          updated_at = NOW()
      `;
    } catch (e) {
      const elapsedMs = Date.now() - t0;
      overall.steps[key] = { ok: false, elapsedMs, error: e.message };
      await sql`
        INSERT INTO sync_state (source_key, last_sync_at, last_run_status, last_error, rows_errored)
        VALUES (${key}, NOW(), 'error', ${e.message}, 1)
        ON CONFLICT (source_key) DO UPDATE SET
          last_sync_at = NOW(),
          last_run_status = 'error',
          last_error = EXCLUDED.last_error,
          rows_errored = sync_state.rows_errored + 1,
          updated_at = NOW()
      `;
      // Continue to next step — don't abort the whole pipeline on one source's failure
    }
  }

  overall.finishedAt = new Date().toISOString();
  return overall;
}
