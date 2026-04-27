import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { STATUS_BUCKETS, bucketForStatus, caseExprForBucket } from './policy-status-buckets.js';

test('bucketForStatus: maps Active - In Force to performing', () => {
  assert.equal(bucketForStatus('Active - In Force'), 'performing');
});

test('bucketForStatus: maps Canceled to canceled', () => {
  assert.equal(bucketForStatus('Canceled'), 'canceled');
});

test('bucketForStatus: maps Declined to declined', () => {
  assert.equal(bucketForStatus('Declined'), 'declined');
});

test('bucketForStatus: maps Pending - Requirements Missing to unknown', () => {
  assert.equal(bucketForStatus('Pending - Requirements Missing'), 'unknown');
});

test('bucketForStatus: handles MIssing typo variant', () => {
  assert.equal(bucketForStatus('Pending - Requirements MIssing'), 'unknown');
});

test('bucketForStatus: returns null for empty/unknown values', () => {
  assert.equal(bucketForStatus(''), null);
  assert.equal(bucketForStatus(null), null);
  assert.equal(bucketForStatus('Some Random Status'), null);
});

test('STATUS_BUCKETS: 4 buckets defined', () => {
  assert.deepEqual(Object.keys(STATUS_BUCKETS).sort(), ['canceled', 'declined', 'performing', 'unknown'].sort());
});

test('caseExprForBucket: produces a SQL CASE expression', () => {
  const expr = caseExprForBucket('p.policy_status');
  assert.match(expr, /^\(CASE/);
  assert.match(expr, /WHEN p\.policy_status IN/);
  assert.match(expr, /THEN 'performing'/);
  assert.match(expr, /ELSE NULL END\)$/);
});
