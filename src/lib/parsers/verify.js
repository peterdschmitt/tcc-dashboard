// Schema + sanity validation for parsed carrier statements.
// Used by the nightly /api/cron/verify-parsers cron to detect parser drift
// (e.g. carrier silently changed format, parser code accidentally broke).
//
// We deliberately do NOT do exact-snapshot diffs: real statements vary
// month to month, so we'd get false positives. Instead we assert structural
// invariants that should hold for every successful parse.

const SANITY_MAX_TOTAL = 1_000_000;        // $1M max total per statement
const SANITY_MAX_SINGLE_AMOUNT = 50_000;   // $50K max for any single line item

function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

/**
 * Validate a parsed statement output.
 * @param {string} expectedCarrier - the carrier we asked the parser to detect (from sheet)
 * @param {object} parsed - { carrier, statementDate, payPeriod, records, agentSummary } from parseStatement()
 * @returns {{ ok: boolean, checks: Array<{name, ok, detail?}>, summary: string }}
 */
export function validateParsedStatement(expectedCarrier, parsed) {
  const checks = [];
  const records = parsed?.records || [];

  // 1. Parser returned data at all
  checks.push({
    name: 'records returned',
    ok: records.length > 0,
    detail: records.length > 0 ? `${records.length} records` : 'parser returned 0 records',
  });

  // 2. Carrier detection matches what the methodology sheet expected
  const detected = String(parsed?.carrier || '').toLowerCase();
  const expected = String(expectedCarrier || '').toLowerCase();
  // Allow loose match — "AIG Corebridge" sheet vs "AIG" parser output is fine
  const carrierMatches = !expected || !detected ||
    detected.includes(expected.split(' ')[0]) || expected.includes(detected.split(' ')[0]);
  checks.push({
    name: 'carrier detection',
    ok: carrierMatches,
    detail: carrierMatches ? `detected "${parsed?.carrier}"` : `expected "${expectedCarrier}", detected "${parsed?.carrier}"`,
  });

  // 3. Every record has a policy number
  const missingPolicy = records.filter(r => !String(r.policyNumber || '').trim()).length;
  checks.push({
    name: 'policy numbers present',
    ok: missingPolicy === 0,
    detail: missingPolicy === 0 ? 'all records have policy #' : `${missingPolicy} of ${records.length} records missing policy #`,
  });

  // 4. Every record has either an insured name OR is explicitly an override / summary line
  const missingName = records.filter(r =>
    !String(r.insuredName || '').trim() && r.section !== 'override'
  ).length;
  checks.push({
    name: 'insured names present',
    ok: missingName === 0,
    detail: missingName === 0 ? 'all non-override records have insured name' : `${missingName} records missing insured name`,
  });

  // 5. Every record has SOME amount (advance, commission, or net) — not all zero
  const allZeroAmount = records.filter(r =>
    num(r.advanceAmount) === 0 && num(r.commissionAmount) === 0 && num(r.netCommission) === 0
  ).length;
  checks.push({
    name: 'records have non-zero amounts',
    ok: allZeroAmount === 0,
    detail: allZeroAmount === 0 ? 'all records have a payment amount' : `${allZeroAmount} of ${records.length} records have all-zero amounts`,
  });

  // 6. Total advance/commission within sanity range
  const totalAmount = records.reduce((s, r) =>
    s + num(r.advanceAmount) + num(r.commissionAmount), 0);
  const totalSane = totalAmount > 0 && totalAmount <= SANITY_MAX_TOTAL;
  checks.push({
    name: 'total amount within sanity range',
    ok: totalSane,
    detail: `total $${totalAmount.toFixed(2)} (max ${SANITY_MAX_TOTAL.toLocaleString('en-US', { style: 'currency', currency: 'USD' })})`,
  });

  // 7. No single line item exceeds the per-item sanity ceiling
  const oversized = records.filter(r =>
    Math.abs(num(r.advanceAmount)) > SANITY_MAX_SINGLE_AMOUNT ||
    Math.abs(num(r.commissionAmount)) > SANITY_MAX_SINGLE_AMOUNT
  );
  checks.push({
    name: 'no oversized line items',
    ok: oversized.length === 0,
    detail: oversized.length === 0
      ? 'all line items within range'
      : `${oversized.length} line items exceed $${SANITY_MAX_SINGLE_AMOUNT.toLocaleString()}: ${oversized.slice(0, 3).map(r => `${r.policyNumber || '?'}=$${Math.max(num(r.advanceAmount), num(r.commissionAmount))}`).join(', ')}`,
  });

  const failed = checks.filter(c => !c.ok);
  const ok = failed.length === 0;
  const summary = ok
    ? `✓ all ${checks.length} checks passed (${records.length} records, total $${totalAmount.toFixed(2)})`
    : `✗ ${failed.length} of ${checks.length} checks failed: ${failed.map(c => c.name).join('; ')}`;

  return { ok, checks, summary };
}
