// src/lib/db-sync/campaigns.js
import { sql } from '../db.js';
import { readRawSheet } from '../sheets.js';

/**
 * Sync campaigns from Goals sheet "Publisher Pricing" tab.
 * Idempotent: upsert by `code`. Updates pricing fields if changed.
 *
 * Returns { processed, inserted, updated }.
 */
export async function syncCampaigns() {
  const sheetId = process.env.GOALS_SHEET_ID;
  const tab = process.env.GOALS_PRICING_TAB || 'Publisher Pricing';
  if (!sheetId) throw new Error('GOALS_SHEET_ID not set');

  const { data } = await readRawSheet(sheetId, tab);
  let inserted = 0, updated = 0;

  for (const row of data) {
    const code = (row['Campaign Code'] ?? '').trim();
    if (!code) continue;
    const vendor = (row['Vendor'] ?? '').trim() || null;
    const priceStr = (row['Price per Billable Call ($)'] ?? '').toString().replace(/[^0-9.]/g, '');
    const price = priceStr ? parseFloat(priceStr) : null;
    const bufferSecs = parseInt(row['Buffer (seconds)'] ?? '0', 10) || null;
    const category = (row['Category'] ?? '').trim() || null;
    const status = (row['Status'] ?? 'active').trim() || 'active';

    const result = await sql`
      INSERT INTO campaigns (code, vendor, price_per_billable_call, buffer_seconds, category, status)
      VALUES (${code}, ${vendor}, ${price}, ${bufferSecs}, ${category}, ${status})
      ON CONFLICT (code) DO UPDATE SET
        vendor = EXCLUDED.vendor,
        price_per_billable_call = EXCLUDED.price_per_billable_call,
        buffer_seconds = EXCLUDED.buffer_seconds,
        category = EXCLUDED.category,
        status = EXCLUDED.status,
        updated_at = NOW()
      RETURNING (xmax = 0) AS inserted
    `;
    if (result[0]?.inserted) inserted++;
    else updated++;
  }

  return { processed: data.length, inserted, updated };
}
