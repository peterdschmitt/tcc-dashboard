// src/lib/portfolio/filter-tree.js
import { sql, sqlUnsafe } from '../db.js';

const VALID_GROUP_OPS = new Set(['AND', 'OR']);
const VALID_LEAF_OPS = new Set([
  'eq', 'neq', 'in', 'not_in', 'contains', 'not_contains',
  'gt', 'gte', 'lt', 'lte', 'between', 'is_null', 'is_not_null',
]);
const NO_VALUE_OPS = new Set(['is_null', 'is_not_null']);
const ARRAY_VALUE_OPS = new Set(['in', 'not_in', 'between']);

function isGroup(node) {
  return node && typeof node === 'object' && Array.isArray(node.rules);
}

/**
 * Validate a filter-tree node against the column registry. Throws on:
 *   - unknown op
 *   - unknown field on a leaf
 *   - leaf value shape mismatch (e.g. between with non-array)
 */
export function validateNode(node, registry) {
  if (!node || typeof node !== 'object') {
    throw new Error('Invalid filter node: not an object');
  }
  if (isGroup(node)) {
    if (!VALID_GROUP_OPS.has(node.op)) {
      throw new Error(`Unknown group op: ${node.op}`);
    }
    for (const child of node.rules) validateNode(child, registry);
    return;
  }
  if (!registry[node.field]) {
    throw new Error(`Unknown field: ${node.field}`);
  }
  if (!VALID_LEAF_OPS.has(node.op)) {
    throw new Error(`Unknown op: ${node.op}`);
  }
  if (NO_VALUE_OPS.has(node.op)) return;
  if (ARRAY_VALUE_OPS.has(node.op)) {
    if (!Array.isArray(node.value)) {
      throw new Error(`Op ${node.op} requires an array value`);
    }
    if (node.op === 'between' && node.value.length !== 2) {
      throw new Error(`Op between requires an array of length 2`);
    }
  }
}

function compileLeaf(leaf, registry) {
  const col = registry[leaf.field];
  // sqlUnsafe() creates a fragment from the real db.js client; fragments
  // created here compose correctly with other sql fragments in WHERE clauses.
  const expr = sqlUnsafe(col.sqlExpression);
  switch (leaf.op) {
    case 'eq': return sql`${expr} = ${leaf.value}`;
    case 'neq': return sql`${expr} != ${leaf.value}`;
    case 'in': return sql`${expr} = ANY(${leaf.value})`;
    case 'not_in': return sql`NOT (${expr} = ANY(${leaf.value}))`;
    case 'contains': return sql`LOWER(${expr}::text) LIKE ${'%' + String(leaf.value).toLowerCase() + '%'}`;
    case 'not_contains': return sql`LOWER(${expr}::text) NOT LIKE ${'%' + String(leaf.value).toLowerCase() + '%'}`;
    case 'gt': return sql`${expr} > ${leaf.value}`;
    case 'gte': return sql`${expr} >= ${leaf.value}`;
    case 'lt': return sql`${expr} < ${leaf.value}`;
    case 'lte': return sql`${expr} <= ${leaf.value}`;
    case 'between': return sql`${expr} BETWEEN ${leaf.value[0]} AND ${leaf.value[1]}`;
    case 'is_null': return sql`${expr} IS NULL`;
    case 'is_not_null': return sql`${expr} IS NOT NULL`;
    default: throw new Error(`Unknown op: ${leaf.op}`);
  }
}

/**
 * Compile a filter tree into a postgres.js sql fragment. Caller composes
 * the result into a WHERE clause by using the fragment with the real db.js sql:
 *
 *   import { sql } from '@/lib/db.js';
 *   const where = compileFilterTree(view.filters_json, registry);
 *   const rows = await sql`SELECT ... FROM contacts c LEFT JOIN policies p ... WHERE ${where} ...`;
 *
 * Empty/null tree → returns sql`TRUE` (no-op WHERE that composes safely).
 */
export function compileFilterTree(node, registry) {
  if (!node) return sql`TRUE`;
  validateNode(node, registry);
  if (isGroup(node)) {
    if (node.rules.length === 0) return sql`TRUE`;
    if (node.rules.length === 1) return compileFilterTree(node.rules[0], registry);
    const parts = node.rules.map(r => compileFilterTree(r, registry));
    const joiner = node.op === 'OR' ? sql` OR ` : sql` AND `;
    const composed = parts.flatMap((p, i) => i === 0 ? [p] : [joiner, p]);
    return sql`(${composed})`;
  }
  return compileLeaf(node, registry);
}
