// Carrier Parsers methodology table — human-readable documentation of how
// each carrier statement gets parsed. Lives in the Goals sheet so non-engineers
// can review and edit it. The actual parser code is in src/lib/parsers/<carrier>.js;
// this tab documents what those parsers do and is the source of truth for the
// parser regression tests (see tests/fixtures/<carrier>/).

import { ensureTabExists, getSheetsClient, fetchSheet } from './sheets';

export const CARRIER_PARSERS_TAB = process.env.CARRIER_PARSERS_TAB || 'Carrier Parsers';

export const CARRIER_PARSERS_HEADERS = [
  'Carrier',
  'File Pattern',
  'Format',
  'Source Columns / Regions Extracted',
  'Transaction Type Rules',
  'Status Mapping',
  'Known Quirks',
  'Last Verified',
  'Last Status',
  'Last Mismatch Detail',
  'Owner',
];

// Initial seed data, derived from reading the existing parsers in src/lib/parsers/.
// Update this when adding a new carrier or when methodology changes; the seeder
// is idempotent and only inserts a row if the carrier doesn't already exist.
export const INITIAL_CARRIER_ROWS = [
  {
    'Carrier': 'AIG Corebridge',
    'File Pattern': 'PDF whose text contains "American General Life Insurance"',
    'Format': 'PDF (fixed-width text)',
    'Source Columns / Regions Extracted':
      'Annualization section: Policy #, Insured Name, Premium, Commission %, Advance Rate, Commission Activity. ' +
      'Override section: Upline %, Override $.',
    'Transaction Type Rules':
      'GENERICATTAD + positive comm activity → advance. ' +
      'GENERICATTAD + negative → chargeback (full clawback of advance). ' +
      'GENERICATTAE + negative → recovery clawback (earned commission taken back).',
    'Status Mapping': 'Active → In Force; Lapsed → Declined; Pending → Submitted - Pending',
    'Known Quirks':
      'First commission % is the basis rate, not the advance rate. ' +
      'Bare number like "75" (no % sign) is the advance rate.',
    'Last Verified': '2026-04-26',
    'Last Status': 'not yet tested',
    'Last Mismatch Detail': '',
    'Owner': 'Peter',
  },
  {
    'Carrier': 'TransAmerica',
    'File Pattern': '*.xls / *.xlsx / *.csv with an "Advance Amount" column',
    'Format': 'XLS / XLSX / CSV',
    'Source Columns / Regions Extracted':
      'Policy #, Insured Name, Premium, Advance Amount, Commission Amount, Net Commission, Commission %, Advance %, Agent Number, Agent Name.',
    'Transaction Type Rules':
      'Description containing "OW " or "override" → override section. ' +
      'Otherwise → advance. ' +
      'Final amount = Advance Amount || Commission Amount || Net Commission.',
    'Status Mapping': 'Active → In Force',
    'Known Quirks':
      'Statement Date column is often blank — period parsed from filename instead via periodFromFile() (e.g. "TA As Earned 1.30.26.xls" → 2026-01).',
    'Last Verified': '2026-04-26',
    'Last Status': 'not yet tested',
    'Last Mismatch Detail': '',
    'Owner': 'Peter',
  },
  {
    'Carrier': 'American Amicable',
    'File Pattern': '*.csv where row description contains "DELIVR"',
    'Format': 'CSV',
    'Source Columns / Regions Extracted':
      'Policy #, Insured Name, Premium, Commission Amount.',
    'Transaction Type Rules': 'All rows treated as advance.',
    'Status Mapping': 'Active → In Force',
    'Known Quirks':
      'Same source CSV sometimes appears twice — once with raw filename and once with Drive-organize prefix (e.g. AmAmicable_2026-02_2026-02-17_*.csv). Auto-dedup catches via filename normalization.',
    'Last Verified': '2026-04-26',
    'Last Status': 'not yet tested',
    'Last Mismatch Detail': '',
    'Owner': 'Peter',
  },
  {
    'Carrier': 'CICA',
    'File Pattern': 'Filename contains "CICA" (typically *.xlsx)',
    'Format': 'XLSX',
    'Source Columns / Regions Extracted':
      'Policy #, Insured Name, Advance Amount.',
    'Transaction Type Rules': 'All rows treated as advance.',
    'Status Mapping': 'Active → In Force',
    'Known Quirks': '',
    'Last Verified': '2026-04-26',
    'Last Status': 'not yet tested',
    'Last Mismatch Detail': '',
    'Owner': 'Peter',
  },
];

export async function ensureCarrierParsersTab() {
  const sheetId = process.env.GOALS_SHEET_ID;
  if (!sheetId) throw new Error('GOALS_SHEET_ID env var is required');
  await ensureTabExists(sheetId, CARRIER_PARSERS_TAB, CARRIER_PARSERS_HEADERS);
  return { tab: CARRIER_PARSERS_TAB };
}

/**
 * Idempotent seed: appends rows for any carrier in INITIAL_CARRIER_ROWS that
 * isn't already present (matched by Carrier name, case-insensitive). Existing
 * rows are never overwritten — manual edits to the sheet are preserved.
 */
export async function seedInitialCarrierRows() {
  const sheetId = process.env.GOALS_SHEET_ID;
  if (!sheetId) throw new Error('GOALS_SHEET_ID env var is required');

  const existing = await fetchSheet(sheetId, CARRIER_PARSERS_TAB, 0);
  const haveCarriers = new Set(existing.map(r => String(r['Carrier'] || '').trim().toLowerCase()));

  const toAdd = INITIAL_CARRIER_ROWS.filter(r => !haveCarriers.has(r['Carrier'].toLowerCase()));
  if (toAdd.length === 0) return { added: 0, skipped: INITIAL_CARRIER_ROWS.length };

  const sheets = await getSheetsClient();
  const values = toAdd.map(row => CARRIER_PARSERS_HEADERS.map(h => row[h] ?? ''));
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `'${CARRIER_PARSERS_TAB}'!A2`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });
  return { added: toAdd.length, skipped: INITIAL_CARRIER_ROWS.length - toAdd.length };
}
