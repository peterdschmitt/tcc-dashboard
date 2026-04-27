import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { COLUMN_REGISTRY, columnsByCategory, requiredJoinsForColumns } from './column-registry.js';

test('registry has expected categories', () => {
  const cats = new Set(Object.values(COLUMN_REGISTRY).map(c => c.category));
  assert.ok(cats.has('Contact'));
  assert.ok(cats.has('Latest Policy'));
  assert.ok(cats.has('Commission'));
  assert.ok(cats.has('Activity'));
});

test('every entry has required fields', () => {
  for (const [key, col] of Object.entries(COLUMN_REGISTRY)) {
    assert.ok(col.label, `${key} missing label`);
    assert.ok(col.category, `${key} missing category`);
    assert.ok(col.sqlExpression, `${key} missing sqlExpression`);
    assert.ok(col.dataType, `${key} missing dataType`);
    assert.ok(col.formatter, `${key} missing formatter`);
  }
});

test('columnsByCategory returns ordered groups', () => {
  const groups = columnsByCategory();
  assert.ok(Array.isArray(groups));
  const cats = groups.map(g => g.category);
  assert.deepEqual(cats, ['Contact', 'Latest Policy', 'Commission', 'Activity']);
  for (const g of groups) assert.ok(g.columns.length > 0);
});

test('requiredJoinsForColumns infers from column join hints', () => {
  assert.deepEqual(requiredJoinsForColumns(['name', 'phone']).sort(), []);
  assert.ok(requiredJoinsForColumns(['monthly_premium']).includes('policies'));
  assert.ok(requiredJoinsForColumns(['outstanding_balance']).includes('commission_summary'));
  assert.ok(requiredJoinsForColumns(['calls_in_7d']).includes('calls_aggregates'));
  assert.deepEqual(requiredJoinsForColumns([]), []);
});

test('total column count is in expected range', () => {
  const total = Object.keys(COLUMN_REGISTRY).length;
  assert.ok(total >= 35 && total <= 45, `expected 35-45 columns, got ${total}`);
});
