import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHolderKey, groupLedgerByHolder } from './statement-records.js';

test('buildHolderKey: basic last|first lowercase', () => {
  assert.equal(buildHolderKey('Jane', 'Doe'), 'doe|jane');
});

test('buildHolderKey: strips middle initial', () => {
  assert.equal(buildHolderKey('John A.', 'Doe'), 'doe|john');
});

test('buildHolderKey: strips suffix Jr', () => {
  assert.equal(buildHolderKey('John', 'Doe Jr'), 'doe|john');
});

test('buildHolderKey: strips suffix III', () => {
  assert.equal(buildHolderKey('John', 'Doe III'), 'doe|john');
});

test('buildHolderKey: strips punctuation and trims', () => {
  assert.equal(buildHolderKey("  Mary-Anne  ", "O'Brien"), 'obrien|maryanne');
});

test('buildHolderKey: handles ALL CAPS', () => {
  assert.equal(buildHolderKey('JOHN', 'DOE'), 'doe|john');
});

test('buildHolderKey: empty inputs produce empty key segments', () => {
  assert.equal(buildHolderKey('', ''), '|');
});

const sampleLedger = [
  { insuredName: 'Jane Doe', policyNumber: 'A1', commissionAmount: 100 },
  { insuredName: 'JANE DOE', policyNumber: 'A1', commissionAmount: 50 },
  { insuredName: 'John Smith', policyNumber: 'B2', commissionAmount: 200 },
  { insuredName: '', policyNumber: 'C3', commissionAmount: 10 }, // unmatched
];

test('groupLedgerByHolder: collapses casing variants into one bucket', () => {
  const m = groupLedgerByHolder(sampleLedger);
  assert.equal(m.get('doe|jane').length, 2);
});

test('groupLedgerByHolder: separate holders get separate buckets', () => {
  const m = groupLedgerByHolder(sampleLedger);
  assert.equal(m.get('smith|john').length, 1);
});

test('groupLedgerByHolder: blank insured name uses per-policy unmatched bucket', () => {
  const m = groupLedgerByHolder(sampleLedger);
  // C3 row has blank insuredName → bucket key is `|<policyNumber>`
  assert.equal(m.get('|C3').length, 1);
  // legacy bare `|` bucket is no longer used when policyNumber is present
  assert.equal(m.has('|'), false);
});

test('groupLedgerByHolder: blank insured name AND blank policy → bare | bucket', () => {
  const m = groupLedgerByHolder([{ insuredName: '', policyNumber: '' }]);
  assert.equal(m.get('|').length, 1);
});

test('groupLedgerByHolder: distinct blank-name policies do NOT merge into one bucket', () => {
  const ledger = [
    { insuredName: '', policyNumber: 'POL-A' },
    { insuredName: '', policyNumber: 'POL-B' },
    { insuredName: '', policyNumber: 'POL-C' },
  ];
  const m = groupLedgerByHolder(ledger);
  assert.equal(m.size, 3); // three distinct unmatched buckets, not one merged
  assert.equal(m.get('|POL-A').length, 1);
  assert.equal(m.get('|POL-B').length, 1);
  assert.equal(m.get('|POL-C').length, 1);
});

test('groupLedgerByHolder: insuredName as "Last, First" parses correctly', () => {
  const m = groupLedgerByHolder([{ insuredName: 'Doe, Jane', policyNumber: 'X' }]);
  assert.equal(m.has('doe|jane'), true);
});

import { buildHolderRow, deriveStatus } from './statement-records.js';

const ledgerForJane = [
  { insuredName: 'Jane Doe', policyNumber: 'A1', carrier: 'AIG', statementDate: '2026-02-15', statementFile: 'aig-feb.pdf',
    commissionAmount: 0, advanceAmount: 400, chargebackAmount: 0, recoveryAmount: 0, outstandingBalance: 400, agent: 'Bob' },
  { insuredName: 'Jane Doe', policyNumber: 'A1', carrier: 'AIG', statementDate: '2026-04-15', statementFile: 'aig-apr.pdf',
    commissionAmount: 0, advanceAmount: 0, chargebackAmount: 400, recoveryAmount: 0, outstandingBalance: 0, agent: 'Bob' },
];

const salesForJane = [
  { 'Policy #': 'A1', 'Carrier + Product + Payout': 'AIG, SIWL Legacy, 75',
    'Monthly Premium': '89', 'Agent': 'Bob' },
];

test('buildHolderRow: aggregates totals and computes net', () => {
  const row = buildHolderRow('doe|jane', ledgerForJane, salesForJane, '2026-04-26T00:00:00Z');
  assert.equal(row['Total Advances'], 400);
  assert.equal(row['Total Chargebacks'], 400);
  assert.equal(row['Net Total'], 0); // 0 + 400 - 400 + 0
});

test('buildHolderRow: collects unique carriers and policies', () => {
  const row = buildHolderRow('doe|jane', ledgerForJane, salesForJane, '2026-04-26T00:00:00Z');
  assert.equal(row.Carriers, 'AIG');
  assert.equal(row.Policies, 'A1');
});

test('buildHolderRow: counts distinct statement files', () => {
  const row = buildHolderRow('doe|jane', ledgerForJane, salesForJane, '2026-04-26T00:00:00Z');
  assert.equal(row['Statement Count'], 2);
});

test('buildHolderRow: first and last period extracted from statement dates', () => {
  const row = buildHolderRow('doe|jane', ledgerForJane, salesForJane, '2026-04-26T00:00:00Z');
  assert.equal(row['First Period'], '2026-02');
  assert.equal(row['Last Period'], '2026-04');
});

test('buildHolderRow: expected net uses 3x premium standard multiplier', () => {
  const row = buildHolderRow('doe|jane', ledgerForJane, salesForJane, '2026-04-26T00:00:00Z');
  assert.equal(row['Expected Net'], 267); // 89 * 3
  assert.equal(row.Variance, -267); // 0 - 267
});

test('buildHolderRow: GIWL product uses 1.5x multiplier', () => {
  const giwlSales = [{ 'Policy #': 'A1', 'Carrier + Product + Payout': 'AIG, GIWL, 50', 'Monthly Premium': '100', 'Agent': 'Bob' }];
  const row = buildHolderRow('doe|jane', ledgerForJane, giwlSales, '2026-04-26T00:00:00Z');
  assert.equal(row['Expected Net'], 150); // 100 * 1.5
});

test('buildHolderRow: unmatched holder has blank Expected Net and Variance', () => {
  const row = buildHolderRow('doe|jane', ledgerForJane, [], '2026-04-26T00:00:00Z');
  assert.equal(row['Expected Net'], '');
  assert.equal(row.Variance, '');
  assert.equal(row.Status, 'unmatched');
});

test('deriveStatus: chargeback when chargebacks > 0', () => {
  assert.equal(deriveStatus({ chargebacks: 100, outstanding: 0, variance: 0, hasMatch: true }), 'chargeback');
});

test('deriveStatus: outstanding when outstanding > 0 and no chargebacks', () => {
  assert.equal(deriveStatus({ chargebacks: 0, outstanding: 200, variance: 0, hasMatch: true }), 'outstanding');
});

test('deriveStatus: variance when |variance| > yellow threshold', () => {
  assert.equal(deriveStatus({ chargebacks: 0, outstanding: 0, variance: 100, hasMatch: true }), 'variance');
});

test('deriveStatus: healthy when all clean and matched', () => {
  assert.equal(deriveStatus({ chargebacks: 0, outstanding: 0, variance: 5, hasMatch: true }), 'healthy');
});

import { buildPeriodRows } from './statement-records.js';

const multiLineStatement = [
  { insuredName: 'Jane Doe', policyNumber: 'A1', carrier: 'AIG', statementFile: 'aig-feb.pdf',
    statementDate: '2026-02-15', statementFileId: 'drive-abc',
    premium: 89, advanceAmount: 200, commissionAmount: 0, chargebackAmount: 0, recoveryAmount: 0,
    outstandingBalance: 200, notes: 'first-half' },
  { insuredName: 'Jane Doe', policyNumber: 'A1', carrier: 'AIG', statementFile: 'aig-feb.pdf',
    statementDate: '2026-02-15', statementFileId: 'drive-abc',
    premium: 89, advanceAmount: 200, commissionAmount: 0, chargebackAmount: 0, recoveryAmount: 0,
    outstandingBalance: 400, notes: 'second-half' },
  { insuredName: 'Jane Doe', policyNumber: 'A1', carrier: 'AIG', statementFile: 'aig-apr.pdf',
    statementDate: '2026-04-15', statementFileId: 'drive-def',
    premium: 89, advanceAmount: 0, commissionAmount: 0, chargebackAmount: 400, recoveryAmount: 0,
    outstandingBalance: 0, notes: 'lapse' },
];

test('buildPeriodRows: collapses multiple lines from one statement into one row per (file × policy)', () => {
  const rows = buildPeriodRows('doe|jane', multiLineStatement);
  assert.equal(rows.length, 2); // aig-feb.pdf + aig-apr.pdf
});

test('buildPeriodRows: sums per-line amounts within one statement', () => {
  const rows = buildPeriodRows('doe|jane', multiLineStatement);
  const feb = rows.find(r => r['Statement File'] === 'aig-feb.pdf');
  assert.equal(feb['Advance Amount'], 400); // 200 + 200
  assert.equal(feb['Line Item Count'], 2);
});

test('buildPeriodRows: outstanding balance from latest line within statement', () => {
  const rows = buildPeriodRows('doe|jane', multiLineStatement);
  const feb = rows.find(r => r['Statement File'] === 'aig-feb.pdf');
  assert.equal(feb['Outstanding Balance'], 400); // last line's value, not sum
});

test('buildPeriodRows: row key is holderKey|file|policy', () => {
  const rows = buildPeriodRows('doe|jane', multiLineStatement);
  const feb = rows.find(r => r['Statement File'] === 'aig-feb.pdf');
  assert.equal(feb['Row Key'], 'doe|jane|aig-feb.pdf|A1');
});

test('buildPeriodRows: notes concatenated unique', () => {
  const rows = buildPeriodRows('doe|jane', multiLineStatement);
  const feb = rows.find(r => r['Statement File'] === 'aig-feb.pdf');
  assert.equal(feb.Notes, 'first-half; second-half');
});

test('buildPeriodRows: net impact = adv + comm − chgbk + rec', () => {
  const rows = buildPeriodRows('doe|jane', multiLineStatement);
  const apr = rows.find(r => r['Statement File'] === 'aig-apr.pdf');
  assert.equal(apr['Net Impact'], -400);
});

import { periodFromFile } from './statement-records.js';

test('periodFromFile: M.D.YY format extracts year-month', () => {
  assert.equal(periodFromFile('TA As Earned 1.30.26.xls'), '2026-01');
});

test('periodFromFile: M.D.YYYY format extracts year-month', () => {
  assert.equal(periodFromFile('TA As Earned 12.5.2026.xls'), '2026-12');
});

test('periodFromFile: ISO date in filename', () => {
  assert.equal(periodFromFile('report-2026-03-15.pdf'), '2026-03');
});

test('periodFromFile: YYYY-MM in filename', () => {
  assert.equal(periodFromFile('Advances_2026-04_summary.csv'), '2026-04');
});

test('periodFromFile: no recognizable date returns empty string', () => {
  assert.equal(periodFromFile('random_file_no_date.pdf'), '');
});

test('periodFromFile: empty/null input returns empty string', () => {
  assert.equal(periodFromFile(''), '');
  assert.equal(periodFromFile(null), '');
  assert.equal(periodFromFile(undefined), '');
});

test('buildPeriodRows: falls back to filename when statementDate is blank', () => {
  const ledger = [
    { insuredName: 'Jane Doe', policyNumber: 'A1', carrier: 'TA',
      statementFile: 'TA As Earned 1.30.26.xls', statementDate: '',
      premium: 50, advanceAmount: 100, commissionAmount: 0, chargebackAmount: 0,
      recoveryAmount: 0, outstandingBalance: 100, notes: '' },
  ];
  const rows = buildPeriodRows('doe|jane', ledger);
  assert.equal(rows[0]['Statement Period'], '2026-01');
});

test('buildHolderRow: First/Last Period also fall back to filename when dates blank', () => {
  const ledger = [
    { insuredName: 'X', policyNumber: 'P1', carrier: 'TA',
      statementFile: 'TA As Earned 1.30.26.xls', statementDate: '',
      commissionAmount: 0, advanceAmount: 50, chargebackAmount: 0, recoveryAmount: 0, outstandingBalance: 50 },
    { insuredName: 'X', policyNumber: 'P1', carrier: 'TA',
      statementFile: 'TA as earned 3.31.26.xls', statementDate: '',
      commissionAmount: 0, advanceAmount: 50, chargebackAmount: 0, recoveryAmount: 0, outstandingBalance: 100 },
  ];
  const row = buildHolderRow('x|', ledger, [], '2026-04-26T00:00:00Z');
  assert.equal(row['First Period'], '2026-01');
  assert.equal(row['Last Period'], '2026-03');
});
