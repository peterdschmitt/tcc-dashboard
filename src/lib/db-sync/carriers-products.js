// src/lib/db-sync/carriers-products.js
import { sql } from '../db.js';
import { readRawSheet } from '../sheets.js';

/**
 * Parse "Carrier + Product + Payout" string into structured parts.
 * Examples:
 *   "American Amicable - Senior Choice Immediate - 100% Day 1"
 *      → { carrier: "American Amicable", product: "Senior Choice Immediate", payout: "100% Day 1" }
 *   "American Amicable, American Amicable Senior Choice"
 *      → { carrier: "American Amicable", product: "American Amicable Senior Choice", payout: null }
 *   "American Amicable"
 *      → { carrier: "American Amicable", product: null, payout: null }
 */
export function parseCarrierProductPayout(raw) {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  // Try " - " split first (most structured format)
  if (s.includes(' - ')) {
    const parts = s.split(' - ').map(p => p.trim());
    return { carrier: parts[0] || null, product: parts[1] || null, payout: parts.slice(2).join(' - ') || null };
  }
  // Fall back to comma split
  if (s.includes(',')) {
    const parts = s.split(',').map(p => p.trim());
    return { carrier: parts[0] || null, product: parts[1] || null, payout: parts[2] || null };
  }
  // Just the carrier name
  return { carrier: s, product: null, payout: null };
}

/**
 * Sync carriers + products from Sales Tracker rows. Reads "Carrier + Product +
 * Payout" column, parses, upserts into both tables.
 *
 * Returns { processed, carriersUpserted, productsUpserted, parseFailures }.
 */
export async function syncCarriersAndProducts() {
  const sheetId = process.env.SALES_SHEET_ID;
  const tab = process.env.SALES_TAB_NAME || 'Sheet1';
  if (!sheetId) throw new Error('SALES_SHEET_ID not set');

  const { data } = await readRawSheet(sheetId, tab);
  const carrierSet = new Map(); // canonical name → { display_name, productSet }

  let parseFailures = 0;
  for (const row of data) {
    const raw = (row['Carrier + Product + Payout'] ?? '').trim();
    if (!raw) continue;
    const parsed = parseCarrierProductPayout(raw);
    if (!parsed?.carrier) { parseFailures++; continue; }
    if (!carrierSet.has(parsed.carrier)) carrierSet.set(parsed.carrier, { displayName: raw, productSet: new Map() });
    if (parsed.product) {
      const c = carrierSet.get(parsed.carrier);
      if (!c.productSet.has(parsed.product)) c.productSet.set(parsed.product, parsed.payout);
    }
  }

  let carriersUpserted = 0, productsUpserted = 0;

  for (const [carrierName, info] of carrierSet) {
    const [carrier] = await sql`
      INSERT INTO carriers (name, display_name)
      VALUES (${carrierName}, ${info.displayName})
      ON CONFLICT (name) DO UPDATE SET updated_at = NOW()
      RETURNING id
    `;
    carriersUpserted++;
    for (const [productName, payoutStructure] of info.productSet) {
      await sql`
        INSERT INTO products (carrier_id, name, payout_structure)
        VALUES (${carrier.id}, ${productName}, ${payoutStructure})
        ON CONFLICT (carrier_id, name) DO UPDATE SET
          payout_structure = EXCLUDED.payout_structure,
          updated_at = NOW()
      `;
      productsUpserted++;
    }
  }

  return { processed: data.length, carriersUpserted, productsUpserted, parseFailures };
}
