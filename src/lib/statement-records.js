// Pure functions only — no imports, no side effects. Safe to load with node --test.

export const STATEMENT_HOLDERS_TAB = process.env.STATEMENT_HOLDERS_TAB || 'Statement Records — Holders';
export const STATEMENT_PERIODS_TAB = process.env.STATEMENT_PERIODS_TAB || 'Statement Records — Periods';

export const HOLDERS_HEADERS = [
  'Holder Key', 'Insured Name', 'Policies', 'Policy Count', 'Carriers',
  'Statement Count', 'First Period', 'Last Period',
  'Total Advances', 'Total Commissions', 'Total Chargebacks', 'Total Recoveries',
  'Net Total', 'Outstanding Balance', 'Expected Net', 'Variance',
  'Agents', 'Status', 'Last Rebuilt',
];

export const PERIODS_HEADERS = [
  'Row Key', 'Holder Key', 'Insured Name', 'Policy #', 'Carrier',
  'Statement Period', 'Statement Date', 'Statement File', 'Statement File ID',
  'Premium', 'Advance Amount', 'Commission Amount', 'Chargeback Amount', 'Recovery Amount',
  'Net Impact', 'Outstanding Balance', 'Line Item Count', 'Notes',
];

// Variance status thresholds in dollars. Tune as needed.
export const VARIANCE_THRESHOLDS = { green: 10, yellow: 50 };

// Suffixes stripped during name normalization.
const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

function normalizeNamePart(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')   // strip punctuation including apostrophes, hyphens, periods
    .trim()
    .split(/\s+/)
    .filter(tok => tok.length > 1 && !NAME_SUFFIXES.has(tok))  // drop initials (single chars) and suffixes
    .join('');
}

export function buildHolderKey(firstName, lastName) {
  const first = normalizeNamePart(firstName);
  const last = normalizeNamePart(lastName);
  return `${last}|${first}`;
}

function splitInsuredName(insuredName) {
  const s = String(insuredName || '').trim();
  if (!s) return { first: '', last: '' };
  if (s.includes(',')) {
    const [last, first] = s.split(',').map(p => p.trim());
    return { first: first || '', last: last || '' };
  }
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { first: '', last: parts[0] };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

export function groupLedgerByHolder(ledgerRows) {
  const map = new Map();
  for (const row of ledgerRows) {
    const { first, last } = splitInsuredName(row.insuredName);
    const key = buildHolderKey(first, last);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}
