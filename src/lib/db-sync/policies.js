// src/lib/db-sync/policies.js
import { createHash } from 'node:crypto';
import { sql } from '../db.js';
import { readRawSheet } from '../sheets.js';
import { normalizePhone, parseSalesDate } from './contacts.js';
import { parseCarrierProductPayout } from './carriers-products.js';

/**
 * Compute a stable hash for a sales row. Used for idempotent inserts.
 */
function rowHash(row) {
  const parts = [row['Policy #'] ?? '', row['Phone Number (US format)'] ?? '', row['Application Submitted Date'] ?? '', row['Carrier + Product + Payout'] ?? ''];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

function parseNumeric(s) {
  if (!s) return null;
  const cleaned = s.toString().replace(/[^0-9.]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

/**
 * Sync policies from Sales Tracker. Each row in the sheet becomes one
 * policies row. Idempotent via source_row_hash UNIQUE constraint.
 *
 * Resolves FKs:
 *   - contact_id by normalized phone
 *   - carrier_id + product_id by parsing "Carrier + Product + Payout"
 *   - sales_lead_source_campaign_id by Lead Source matching campaigns.code
 *   - agent_id by Agent matching agents.canonical_name
 */
export async function syncPolicies() {
  const sheetId = process.env.SALES_SHEET_ID;
  const tab = process.env.SALES_TAB_NAME || 'Sheet1';
  if (!sheetId) throw new Error('SALES_SHEET_ID not set');

  // Pre-load FK lookup tables
  const carriers = new Map();
  const productsByCarrier = new Map();
  const carrierRows = await sql`SELECT id, name FROM carriers`;
  for (const c of carrierRows) carriers.set(c.name, c.id);
  const productRows = await sql`SELECT id, carrier_id, name FROM products`;
  for (const p of productRows) {
    if (!productsByCarrier.has(p.carrierId)) productsByCarrier.set(p.carrierId, new Map());
    productsByCarrier.get(p.carrierId).set(p.name, p.id);
  }

  const campaigns = new Map();
  const campaignRows = await sql`SELECT id, code FROM campaigns`;
  for (const c of campaignRows) campaigns.set(c.code, c.id);

  const agents = new Map();
  const agentRows = await sql`SELECT id, canonical_name FROM agents`;
  for (const a of agentRows) agents.set(a.canonicalName, a.id);

  const contactsByPhone = new Map();
  const contactRows = await sql`SELECT id, phone FROM contacts`;
  for (const c of contactRows) contactsByPhone.set(c.phone, c.id);

  const { data } = await readRawSheet(sheetId, tab);
  let inserted = 0, updated = 0, skipped = 0;

  for (const row of data) {
    const phone = normalizePhone(row['Phone Number (US format)']);
    const contactId = contactsByPhone.get(phone);
    if (!contactId) { skipped++; continue; }

    const carrierProductRaw = (row['Carrier + Product + Payout'] ?? '').trim();
    const parsed = parseCarrierProductPayout(carrierProductRaw);
    const carrierId = parsed?.carrier ? (carriers.get(parsed.carrier) ?? null) : null;
    const productId = (carrierId && parsed?.product) ? (productsByCarrier.get(carrierId)?.get(parsed.product) ?? null) : null;

    const leadSource = (row['Lead Source'] ?? '').trim();
    const campaignId = leadSource ? (campaigns.get(leadSource) ?? null) : null;

    const agentName = (row['Agent'] ?? '').trim();
    const agentId = agentName ? (agents.get(agentName) ?? null) : null;

    const hash = rowHash(row);

    const r = await sql`
      INSERT INTO policies (
        contact_id, carrier_id, product_id, sales_lead_source_campaign_id, agent_id,
        policy_number, carrier_product_raw,
        monthly_premium, face_amount, term_length,
        placed_status, outcome_at_application,
        application_date, effective_date,
        sales_lead_source_raw, sales_agent_raw, sales_notes,
        payment_type, payment_frequency, draft_day, ssn_billing_match,
        beneficiary_first_name, beneficiary_last_name, beneficiary_relationship,
        source_row_hash
      ) VALUES (
        ${contactId}, ${carrierId}, ${productId}, ${campaignId}, ${agentId},
        ${row['Policy #'] || null}, ${carrierProductRaw || null},
        ${parseNumeric(row['Monthly Premium'])}, ${parseNumeric(row['Face Amount'])}, ${row['Term Length'] || null},
        ${row['Placed?'] || null}, ${row['Outcome at Application Submission'] || null},
        ${parseSalesDate(row['Application Submitted Date'])}, ${parseSalesDate(row['Effective Date'])},
        ${leadSource || null}, ${agentName || null}, ${row['Sales Notes'] || null},
        ${row['Payment Type'] || null}, ${row['Payment Frequency'] || null}, ${row['Draft Day'] || null}, ${row['Social Security Billing Match'] || null},
        ${row['Beneficiary - First Name'] || null}, ${row['Beneficiary - Last Name'] || null}, ${row['Relationship to Insured'] || null},
        ${hash}
      )
      ON CONFLICT (source_row_hash) DO UPDATE SET
        placed_status = EXCLUDED.placed_status,
        monthly_premium = EXCLUDED.monthly_premium,
        effective_date = EXCLUDED.effective_date,
        sales_notes = EXCLUDED.sales_notes,
        updated_at = NOW()
      RETURNING (xmax = 0) AS inserted
    `;
    if (r[0]?.inserted) inserted++;
    else updated++;
  }

  return { processed: data.length, inserted, updated, skipped };
}
