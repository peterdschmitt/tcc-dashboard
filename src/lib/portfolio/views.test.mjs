import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateViewPayload, normalizeViewForDb } from './views.js';

test('validateViewPayload: rejects empty name', () => {
  assert.throws(() => validateViewPayload({ name: '', columns: ['name'] }), /name/i);
});

test('validateViewPayload: rejects no columns', () => {
  assert.throws(() => validateViewPayload({ name: 'x', columns: [] }), /column/i);
});

test('validateViewPayload: rejects unknown sort_dir', () => {
  assert.throws(() => validateViewPayload({ name: 'x', columns: ['name'], sort_dir: 'sideways' }), /sort_dir/i);
});

test('validateViewPayload: rejects both filters_json AND raw_where', () => {
  assert.throws(() => validateViewPayload({
    name: 'x',
    columns: ['name'],
    filters_json: { op: 'AND', rules: [] },
    raw_where: 'x > 1',
  }), /both/i);
});

test('validateViewPayload: accepts minimal valid payload', () => {
  validateViewPayload({ name: 'My View', columns: ['name', 'phone'] });
});

test('normalizeViewForDb: defaults filter form when neither set', () => {
  const v = normalizeViewForDb({ name: 'x', columns: ['name'] });
  assert.equal(v.filtersJson, null);
  assert.equal(v.rawWhere, null);
});

test('normalizeViewForDb: trims name', () => {
  const v = normalizeViewForDb({ name: '  Active  ', columns: ['name'] });
  assert.equal(v.name, 'Active');
});

test('normalizeViewForDb: defaults sort_dir to desc, group_by to none', () => {
  const v = normalizeViewForDb({ name: 'x', columns: ['name'] });
  assert.equal(v.sortDir, 'desc');
  assert.equal(v.groupBy, 'none');
});
