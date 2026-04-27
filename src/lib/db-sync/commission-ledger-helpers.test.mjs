import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { rowHash, parseDate, parseMoney, parsePct, normalizeText } from './commission-ledger-helpers.js';

test('rowHash: stable for identical input', () => {
  const r = { 'Transaction ID': 'T1', 'Statement Date': '2026-04-01', 'Advance Amount': '100', 'Commission Amount': '100', 'Chargeback Amount': '0', 'Recovery Amount': '0' };
  assert.equal(rowHash(r), rowHash({ ...r }));
});

test('rowHash: differs when amount differs', () => {
  const a = { 'Transaction ID': 'T1', 'Statement Date': '2026-04-01', 'Advance Amount': '100', 'Commission Amount': '100', 'Chargeback Amount': '0', 'Recovery Amount': '0' };
  const b = { ...a, 'Advance Amount': '200' };
  assert.notEqual(rowHash(a), rowHash(b));
});

test('rowHash: missing fields treated as empty', () => {
  const a = { 'Transaction ID': 'T1', 'Statement Date': '2026-04-01' };
  const b = { 'Transaction ID': 'T1', 'Statement Date': '2026-04-01', 'Advance Amount': '', 'Commission Amount': '', 'Chargeback Amount': '', 'Recovery Amount': '' };
  assert.equal(rowHash(a), rowHash(b));
});

test('parseDate: MM/DD/YYYY → Date', () => {
  const d = parseDate('4/1/2026');
  assert.ok(d instanceof Date);
  assert.equal(d.getUTCFullYear(), 2026);
  assert.equal(d.getUTCMonth(), 3); // April = 3
  assert.equal(d.getUTCDate(), 1);
});

test('parseDate: ISO YYYY-MM-DD → Date', () => {
  const d = parseDate('2026-04-01');
  assert.ok(d instanceof Date);
});

test('parseDate: MM/DD/YY (2-digit year) expands to 20YY', () => {
  const d = parseDate('04/03/26');
  assert.ok(d instanceof Date);
  assert.equal(d.getUTCFullYear(), 2026);
  assert.equal(d.getUTCMonth(), 3); // April
  assert.equal(d.getUTCDate(), 3);
});

test('parseDate: MM-DD-YY (2-digit year, dashes) expands to 20YY', () => {
  const d = parseDate('04-03-26');
  assert.ok(d instanceof Date);
  assert.equal(d.getUTCFullYear(), 2026);
});

test('parseDate: empty/garbage → null', () => {
  assert.equal(parseDate(''), null);
  assert.equal(parseDate(null), null);
  assert.equal(parseDate(undefined), null);
  assert.equal(parseDate('not a date'), null);
});

test('parseMoney: strips $ and commas', () => {
  assert.equal(parseMoney('$1,234.56'), 1234.56);
  assert.equal(parseMoney('100'), 100);
  assert.equal(parseMoney('100.00'), 100);
});

test('parseMoney: handles negative and parens', () => {
  assert.equal(parseMoney('-50.25'), -50.25);
  assert.equal(parseMoney('($50.25)'), -50.25);
});

test('parseMoney: empty/garbage → null', () => {
  assert.equal(parseMoney(''), null);
  assert.equal(parseMoney(null), null);
  assert.equal(parseMoney('not a number'), null);
});

test('parsePct: 75% → 0.75 (decimal)', () => {
  assert.equal(parsePct('75%'), 0.75);
  assert.equal(parsePct('75'), 0.75);   // bare number assumed pct
  assert.equal(parsePct('0.75'), 0.75); // already decimal stays decimal
});

test('parsePct: empty → null', () => {
  assert.equal(parsePct(''), null);
  assert.equal(parsePct(null), null);
});

test('normalizeText: trims and collapses whitespace, returns null for empty', () => {
  assert.equal(normalizeText('  hello  world  '), 'hello world');
  assert.equal(normalizeText(''), null);
  assert.equal(normalizeText('   '), null);
  assert.equal(normalizeText(null), null);
});
