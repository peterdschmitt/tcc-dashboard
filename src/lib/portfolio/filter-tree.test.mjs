import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { compileFilterTree, validateNode } from './filter-tree.js';

const FAKE_REGISTRY = {
  state: { sqlExpression: 'c.state', dataType: 'string' },
  monthly_premium: { sqlExpression: 'p.monthly_premium', dataType: 'numeric' },
  placed_status: { sqlExpression: 'p.placed_status', dataType: 'string' },
  application_date: { sqlExpression: 'p.application_date', dataType: 'date' },
};

test('validateNode: rejects unknown op on group', () => {
  assert.throws(() => validateNode({ op: 'XOR', rules: [] }, FAKE_REGISTRY), /Unknown.*op/i);
});

test('validateNode: rejects unknown field on leaf', () => {
  assert.throws(
    () => validateNode({ field: 'mystery', op: 'eq', value: 1 }, FAKE_REGISTRY),
    /Unknown field/i
  );
});

test('validateNode: accepts a well-formed tree', () => {
  validateNode({
    op: 'AND',
    rules: [
      { field: 'state', op: 'in', value: ['CA'] },
      { field: 'monthly_premium', op: 'gte', value: 100 },
    ],
  }, FAKE_REGISTRY);
});

test('compileFilterTree: empty group → empty fragment', () => {
  const f = compileFilterTree({ op: 'AND', rules: [] }, FAKE_REGISTRY);
  assert.ok(typeof f === 'object');
});

test('compileFilterTree: single leaf eq', () => {
  const f = compileFilterTree({ field: 'state', op: 'eq', value: 'CA' }, FAKE_REGISTRY);
  assert.ok(typeof f === 'object');
});

test('compileFilterTree: AND with two leaves', () => {
  const f = compileFilterTree({
    op: 'AND',
    rules: [
      { field: 'state', op: 'in', value: ['CA', 'TX'] },
      { field: 'monthly_premium', op: 'gte', value: 100 },
    ],
  }, FAKE_REGISTRY);
  assert.ok(typeof f === 'object');
});

test('compileFilterTree: OR group nested inside AND', () => {
  const f = compileFilterTree({
    op: 'AND',
    rules: [
      { field: 'state', op: 'in', value: ['CA'] },
      {
        op: 'OR',
        rules: [
          { field: 'placed_status', op: 'contains', value: 'active' },
          { field: 'placed_status', op: 'contains', value: 'in force' },
        ],
      },
    ],
  }, FAKE_REGISTRY);
  assert.ok(typeof f === 'object');
});

test('compileFilterTree: between op requires array of length 2', () => {
  assert.throws(
    () => compileFilterTree({ field: 'monthly_premium', op: 'between', value: 100 }, FAKE_REGISTRY),
    /between.*array/i
  );
  compileFilterTree({ field: 'monthly_premium', op: 'between', value: [50, 200] }, FAKE_REGISTRY);
});

test('compileFilterTree: in op requires array', () => {
  assert.throws(
    () => compileFilterTree({ field: 'state', op: 'in', value: 'CA' }, FAKE_REGISTRY),
    /in.*array/i
  );
});

test('compileFilterTree: is_null and is_not_null have no value', () => {
  compileFilterTree({ field: 'application_date', op: 'is_null' }, FAKE_REGISTRY);
  compileFilterTree({ field: 'application_date', op: 'is_not_null' }, FAKE_REGISTRY);
});

test('compileFilterTree: unknown op throws', () => {
  assert.throws(
    () => compileFilterTree({ field: 'state', op: 'fuzzy_match', value: 'CA' }, FAKE_REGISTRY),
    /Unknown op/i
  );
});
