// src/lib/db-sync/commission-ledger.js
import { sql } from '../db.js';
import { readRawSheet } from '../sheets.js';
import { rowHash, parseDate, parseMoney, parsePct, normalizeText } from './commission-ledger-helpers.js';

/**
 * Sync the Commission Ledger Google Sheet into the commission_ledger
 * Postgres table. Idempotent via source_row_hash. Resolves FKs:
 *   - policy_id by Matched Policy # → policies.policy_number
 *     (falls back to source Policy # if Matched is empty)
 *   - carrier_id by Carrier name → carriers.name (case-sensitive)
 *   - agent_id by Agent name → agents.canonical_name
 *
 * Source: the Commission Ledger lives as a tab inside the Sales Tracker
 * sheet (SALES_SHEET_ID + COMMISSION_LEDGER_TAB), not the standalone
 * commission rate-table sheet.
 *
 * Returns { processed, inserted, updated, skipped, fkResolved, fkUnresolved }.
 *
 * Note on rounding: commission_pct and advance_pct from the sheet may
 * exceed the column's NUMERIC(7, 4) precision. Rounded to 4 decimals
 * before insert.
 */
export async function syncCommissionLedger() {
  const sheetId = process.env.SALES_SHEET_ID;
  const tab = process.env.COMMISSION_LEDGER_TAB || 'Commission Ledger';
  if (!sheetId) throw new Error('SALES_SHEET_ID not set');

  // Pre-load FK lookup maps
  const policiesByNumber = new Map();
  for (const p of await sql`SELECT id, policy_number FROM policies WHERE policy_number IS NOT NULL AND policy_number != ''`) {
    policiesByNumber.set(p.policyNumber, p.id);
  }
  const carriersByName = new Map();
  for (const c of await sql`SELECT id, name FROM carriers`) carriersByName.set(c.name, c.id);
  const agentsByName = new Map();
  for (const a of await sql`SELECT id, canonical_name FROM agents`) agentsByName.set(a.canonicalName, a.id);

  const { data } = await readRawSheet(sheetId, tab);
  let inserted = 0, updated = 0, skipped = 0, fkResolved = 0, fkUnresolved = 0;

  for (const row of data) {
    const txId = (row['Transaction ID'] ?? '').toString().trim();
    if (!txId) { skipped++; continue; }

    // FK resolution
    const matchedPolicyNumber = (row['Matched Policy #'] ?? '').toString().trim() || null;
    const sourcePolicyNumber = (row['Policy #'] ?? '').toString().trim() || null;
    const lookupPolicy = matchedPolicyNumber || sourcePolicyNumber;
    const policyId = lookupPolicy ? (policiesByNumber.get(lookupPolicy) ?? null) : null;

    const carrierName = (row['Carrier'] ?? '').toString().trim();
    const carrierId = carrierName ? (carriersByName.get(carrierName) ?? null) : null;

    const agentName = (row['Agent'] ?? '').toString().trim();
    const agentId = agentName ? (agentsByName.get(agentName) ?? null) : null;

    if (policyId) fkResolved++; else fkUnresolved++;

    const hash = rowHash(row);

    // Round percentages to 4 dp to fit NUMERIC(7, 4)
    const commissionPct = parsePct(row['Commission %']);
    const advancePct = parsePct(row['Advance %']);
    const commissionPctRounded = commissionPct == null ? null : Math.round(commissionPct * 10000) / 10000;
    const advancePctRounded = advancePct == null ? null : Math.round(advancePct * 10000) / 10000;

    const r = await sql`
      INSERT INTO commission_ledger (
        policy_id, carrier_id, agent_id,
        transaction_id, source_policy_number, matched_policy_number,
        carrier_name_raw, insured_name_raw, agent_name_raw, agent_id_raw, product_raw,
        transaction_type, description,
        statement_date, processing_date, issue_date,
        premium, commission_pct, advance_pct,
        advance_amount, commission_amount, net_commission, outstanding_balance,
        chargeback_amount, recovery_amount, net_impact,
        match_type, match_confidence, status, statement_file, notes,
        source_row_hash
      ) VALUES (
        ${policyId}, ${carrierId}, ${agentId},
        ${txId}, ${sourcePolicyNumber}, ${matchedPolicyNumber},
        ${normalizeText(row['Carrier'])}, ${normalizeText(row['Insured Name'])}, ${normalizeText(row['Agent'])}, ${normalizeText(row['Agent ID'])}, ${normalizeText(row['Product'])},
        ${normalizeText(row['Transaction Type'])}, ${normalizeText(row['Description'])},
        ${parseDate(row['Statement Date'])}, ${parseDate(row['Processing Date'])}, ${parseDate(row['Issue Date'])},
        ${parseMoney(row['Premium'])}, ${commissionPctRounded}, ${advancePctRounded},
        ${parseMoney(row['Advance Amount'])}, ${parseMoney(row['Commission Amount'])}, ${parseMoney(row['Net Commission'])}, ${parseMoney(row['Outstanding Balance'])},
        ${parseMoney(row['Chargeback Amount'])}, ${parseMoney(row['Recovery Amount'])}, ${parseMoney(row['Net Impact'])},
        ${normalizeText(row['Match Type'])}, ${normalizeText(row['Match Confidence'])}, ${normalizeText(row['Status'])}, ${normalizeText(row['Statement File'])}, ${normalizeText(row['Notes'])},
        ${hash}
      )
      ON CONFLICT (source_row_hash) DO UPDATE SET
        status = EXCLUDED.status,
        notes = EXCLUDED.notes,
        matched_policy_number = EXCLUDED.matched_policy_number,
        policy_id = EXCLUDED.policy_id,
        match_type = EXCLUDED.match_type,
        match_confidence = EXCLUDED.match_confidence,
        updated_at = NOW()
      RETURNING (xmax = 0) AS inserted
    `;
    if (r[0]?.inserted) inserted++;
    else updated++;
  }

  return { processed: data.length, inserted, updated, skipped, fkResolved, fkUnresolved };
}
