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

test('groupLedgerByHolder: blank insured name uses fallback bucket', () => {
  const m = groupLedgerByHolder(sampleLedger);
  // empty key (|) is the unmatched bucket
  assert.equal(m.get('|').length, 1);
});

test('groupLedgerByHolder: insuredName as "Last, First" parses correctly', () => {
  const m = groupLedgerByHolder([{ insuredName: 'Doe, Jane', policyNumber: 'X' }]);
  assert.equal(m.has('doe|jane'), true);
});
