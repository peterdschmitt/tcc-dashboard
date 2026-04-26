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
