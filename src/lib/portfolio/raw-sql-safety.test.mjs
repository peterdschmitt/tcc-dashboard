// src/lib/portfolio/raw-sql-safety.test.mjs
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { isRawWhereSafe, RAW_SQL_DENIED_KEYWORDS } from './raw-sql-safety.js';

test('isRawWhereSafe: simple expression OK', () => {
  assert.equal(isRawWhereSafe("monthly_premium > 100").ok, true);
});

test('isRawWhereSafe: state IN list OK', () => {
  assert.equal(isRawWhereSafe("state IN ('CA', 'TX')").ok, true);
});

test('isRawWhereSafe: rejects semicolon', () => {
  const r = isRawWhereSafe("1=1; DROP TABLE policies");
  assert.equal(r.ok, false);
  assert.match(r.reason, /semicolon/i);
});

test('isRawWhereSafe: rejects DROP keyword case-insensitive', () => {
  for (const variant of ['DROP TABLE x', 'drop table x', 'DrOp table x']) {
    const r = isRawWhereSafe(variant);
    assert.equal(r.ok, false, `should reject: ${variant}`);
  }
});

test('isRawWhereSafe: rejects all denied keywords', () => {
  for (const kw of RAW_SQL_DENIED_KEYWORDS) {
    const r = isRawWhereSafe(`x = 1 AND ${kw} y`);
    assert.equal(r.ok, false, `should reject keyword: ${kw}`);
  }
});

test('isRawWhereSafe: rejects line comment --', () => {
  assert.equal(isRawWhereSafe("x > 1 -- bad").ok, false);
});

test('isRawWhereSafe: rejects block comment /*', () => {
  assert.equal(isRawWhereSafe("x > 1 /* bad */").ok, false);
});

test('isRawWhereSafe: empty input OK (treated as no filter)', () => {
  assert.equal(isRawWhereSafe('').ok, true);
  assert.equal(isRawWhereSafe(null).ok, true);
  assert.equal(isRawWhereSafe(undefined).ok, true);
});

test('isRawWhereSafe: word-boundary keyword check (substring not enough)', () => {
  // "deleted_at" should NOT match the DELETE keyword (whole-word check)
  assert.equal(isRawWhereSafe("deleted_at IS NULL").ok, true);
});
