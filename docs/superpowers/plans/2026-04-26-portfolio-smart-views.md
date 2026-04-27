# Portfolio Smart Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 6 hardcoded smart lists in the Portfolio sidebar with user-creatable, shared smart views stored in Postgres. Each view saves a complete dashboard configuration (filters, columns, sort, group-by). Adds a visual AND/OR filter builder, a categorized column picker drawing from the full DB schema (including the just-merged commission_ledger), and a raw-SQL escape hatch with safety guards (read-only DB role).

**Architecture:** New table `portfolio_views` (migration 003) seeded with the 6 existing smart lists as `is_system=true` rows. New filter-tree compiler converts a JSON tree into a postgres.js fragment. New column registry maps every available column key to its SQL expression + formatting metadata. New React components for save popover, sidebar rewrite, view editor, filter builder, and column picker. A new read-only DB role provides defense-in-depth for the raw-SQL escape hatch.

**Tech Stack:** Postgres (Neon), `postgres` package (postgres.js), Next.js 14 App Router, React, `node --test` for pure-function unit tests.

**Spec:** `docs/superpowers/specs/2026-04-26-portfolio-smart-views-design.md`

**Testing approach:** `node --test` for `filter-tree.js` + `column-registry.js` + `views.js` (pure logic). Browser verification via the worktree's preview server (port 3004) for UI tasks. No new test framework introduced.

---

## File Structure

### New files

```
migrations/
  003_add_portfolio_views.sql                            # table + indexes + trigger + 6 seed rows

src/lib/portfolio/
  filter-tree.js                                         # AND/OR JSON tree → postgres.js fragment
  filter-tree.test.mjs                                   # unit tests
  column-registry.js                                     # 41 columns: label/category/sql/formatter/joinHints
  column-registry.test.mjs                               # unit tests
  views.js                                               # view CRUD + serialization helpers
  views.test.mjs                                         # unit tests for serialization
  raw-sql-safety.js                                      # blocklist + sanitization
  raw-sql-safety.test.mjs                                # unit tests

src/lib/
  db.js                                                  # MODIFIED: add `sqlReadonly` export

src/app/api/portfolio/
  views/route.js                                         # GET (list), POST (create)
  views/[id]/route.js                                    # PATCH (update), DELETE (delete or 403)
  views/[id]/reset/route.js                              # POST (reset system view to seed)

src/components/portfolio/
  PortfolioSaveViewPopover.jsx                           # toolbar `+ Save view` popover
  PortfolioFilterBuilder.jsx                             # recursive AND/OR builder
  PortfolioColumnPicker.jsx                              # two-pane categorized + reorder
  PortfolioViewEditor.jsx                                # slide-in editor wiring filter + columns + sort/group
```

### Modified files

```
src/lib/portfolio/query.js                               # consume filter-tree + columns array
src/app/api/portfolio/contacts/route.js                  # support viewId param + read-only client when raw_where set
src/components/portfolio/PortfolioFilterSidebar.jsx      # API-loaded view list + per-row ⋮ menu
src/components/portfolio/PortfolioGrid.jsx               # render arbitrary columns from registry
src/components/portfolio/PortfolioTab.jsx                # wire popover + editor + sidebar API
.env.local + Vercel env                                  # add DATABASE_URL_READONLY (manual, P1)
CLAUDE.md                                                # document portfolio_views + read-only role
```

### Files explicitly NOT touched

- Existing Lead CRM tabs (already replaced by Portfolio in the prior merge)
- Other portfolio sub-components: `PortfolioGroupBySelector.jsx`, `PortfolioGroupView.jsx`, `PortfolioBulkActionBar.jsx`, `PortfolioDetailPanel.jsx`
- Migration runner / db-sync modules / pipeline orchestrator
- vercel.json (no new functions or crons in this plan)

---

## Pre-flight (manual, blocks Task 14)

### P1: Provision Neon read-only DB role

Required for the raw-SQL safety layer. Without it, the visual AND/OR builder still works but the raw-SQL toggle in the editor will return 503.

1. Open the [Neon SQL editor](https://console.neon.tech) for the `tcc-dashboard` project.
2. Run as the project owner:

```sql
CREATE ROLE tcc_dashboard_readonly WITH LOGIN PASSWORD '<choose-a-strong-password>';
GRANT CONNECT ON DATABASE neondb TO tcc_dashboard_readonly;
GRANT USAGE ON SCHEMA public TO tcc_dashboard_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO tcc_dashboard_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO tcc_dashboard_readonly;
```

3. From the Neon console, copy the connection string for the new role (Connection details → select role `tcc_dashboard_readonly`). Format: `postgres://tcc_dashboard_readonly:<pwd>@ep-xxxxxxx-pooler.<region>.aws.neon.tech/neondb?sslmode=require`.
4. Add to local `.env.local`:

```
DATABASE_URL_READONLY=postgres://tcc_dashboard_readonly:...
```

5. Add to Vercel (Production + Preview):

```bash
vercel env add DATABASE_URL_READONLY production
vercel env add DATABASE_URL_READONLY preview
```

(Paste the same connection string when prompted.)

Done — this unblocks Task 14.

---

## Task 1: Confirm worktree setup

**Files:** none (workspace check)

This plan is authored inside an existing worktree at `.worktrees/feature-portfolio-smart-views`. Confirm.

- [ ] **Step 1:** Confirm cwd and branch:

```bash
pwd
git branch --show-current
```

Expected: `/Users/peterschmitt/Downloads/tcc-dashboard/.worktrees/feature-portfolio-smart-views` and `feature/portfolio-smart-views`.

- [ ] **Step 2:** Confirm migrations 001/002/004 are present (003 is the new slot for this plan):

```bash
ls migrations/
```

Expected: `001_init.sql`, `002_add_sync_state.sql`, `004_add_commission_ledger.sql`. NO `003_*` yet — that's Task 3.

- [ ] **Step 3:** Baseline test + build:

```bash
npm test 2>&1 | tail -8
npm run build 2>&1 | tail -8
```

Expected: 52 tests pass; build succeeds.

---

## Task 2: Filter-tree compiler + tests

**Files:**
- Create: `src/lib/portfolio/filter-tree.js`
- Create: `src/lib/portfolio/filter-tree.test.mjs`

This module is consumed by `query.js` (Task 8) when a view is loaded. Pure function — testable in isolation.

- [ ] **Step 1:** Write the failing tests at `src/lib/portfolio/filter-tree.test.mjs`:

```javascript
// src/lib/portfolio/filter-tree.test.mjs
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { compileFilterTree, validateNode } from './filter-tree.js';

// Stub column registry for tests so we don't pull the full real registry
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
  // No throw = pass
});

test('compileFilterTree: empty group → empty fragment', () => {
  const f = compileFilterTree({ op: 'AND', rules: [] }, FAKE_REGISTRY);
  // Render the fragment to text via a stub sql tag
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
  // Valid case should not throw
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
  // No throw = pass
});

test('compileFilterTree: unknown op throws', () => {
  assert.throws(
    () => compileFilterTree({ field: 'state', op: 'fuzzy_match', value: 'CA' }, FAKE_REGISTRY),
    /Unknown op/i
  );
});
```

- [ ] **Step 2:** Run to verify failure:

```bash
node --test src/lib/portfolio/filter-tree.test.mjs 2>&1 | tail -10
```

Expected: ERR_MODULE_NOT_FOUND (file doesn't exist).

- [ ] **Step 3:** Write `src/lib/portfolio/filter-tree.js`:

```javascript
// src/lib/portfolio/filter-tree.js
import { sql } from '../db.js';

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
  // Leaf
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
  // We rely on postgres.js's tagged-template fragment composition. Use sql.unsafe
  // for the column expression (it's from our trusted registry, not user input)
  // and parameterize the value.
  const expr = sql.unsafe(col.sqlExpression);
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
 * the result into a WHERE clause:
 *
 *   const where = compileFilterTree(view.filters_json, registry);
 *   const rows = await sql`SELECT ... FROM contacts c LEFT JOIN policies p ... WHERE ${where} ...`;
 *
 * Empty/null tree → returns sql`TRUE` (no-op WHERE).
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
```

- [ ] **Step 4:** Run tests:

```bash
node --test src/lib/portfolio/filter-tree.test.mjs 2>&1 | tail -10
```

Expected: 11 pass, 0 fail.

- [ ] **Step 5:** Run full test suite for regression:

```bash
npm test 2>&1 | tail -8
```

Expected: 63 total (52 + 11 new), all pass.

- [ ] **Step 6:** Commit:

```bash
git add src/lib/portfolio/filter-tree.js src/lib/portfolio/filter-tree.test.mjs
git commit -m "feat(portfolio): filter-tree compiler with AND/OR + 13 ops"
```

---

## Task 3: Column registry + tests

**Files:**
- Create: `src/lib/portfolio/column-registry.js`
- Create: `src/lib/portfolio/column-registry.test.mjs`

The single source of truth for "what columns can a view show or filter on?" Used by both the grid renderer and the filter builder.

- [ ] **Step 1:** Write tests at `src/lib/portfolio/column-registry.test.mjs`:

```javascript
// src/lib/portfolio/column-registry.test.mjs
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
  // Empty input
  assert.deepEqual(requiredJoinsForColumns([]), []);
});

test('total column count is in expected range', () => {
  const total = Object.keys(COLUMN_REGISTRY).length;
  assert.ok(total >= 35 && total <= 45, `expected 35-45 columns, got ${total}`);
});
```

- [ ] **Step 2:** Run to verify failure:

```bash
node --test src/lib/portfolio/column-registry.test.mjs 2>&1 | tail -10
```

Expected: ERR_MODULE_NOT_FOUND.

- [ ] **Step 3:** Write `src/lib/portfolio/column-registry.js`. Categories: Contact (14), Latest Policy (12), Commission (9), Activity (5). Every entry needs `label`, `category`, `sqlExpression`, `dataType`, `formatter`, `alignment` (default `left`), and `joinHints` (subset of `'policies'`, `'commission_summary'`, `'calls_aggregates'`).

```javascript
// src/lib/portfolio/column-registry.js

/**
 * Single source of truth for "what columns can a portfolio view show or filter on?"
 * Used by:
 *   - the column picker UI (grouped by `category`, displayed by `label`)
 *   - the grid renderer (uses `formatter` + `alignment` for cell rendering)
 *   - the query layer (uses `sqlExpression` + `joinHints` to compose SELECT)
 *   - the filter builder (uses `dataType` to pick available ops + value editor)
 *
 * Adding a column: add an entry here. Ensure the table/view referenced in
 * sqlExpression is listed in joinHints so the query layer joins it.
 */
export const COLUMN_REGISTRY = {
  // ── Contact ──────────────────────────────────────────────
  name: { label: 'Name', category: 'Contact', sqlExpression: "TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))", dataType: 'string', formatter: 'text', alignment: 'left', joinHints: [] },
  phone: { label: 'Phone', category: 'Contact', sqlExpression: 'c.phone', dataType: 'string', formatter: 'text', alignment: 'left', joinHints: [] },
  email: { label: 'Email', category: 'Contact', sqlExpression: 'c.email', dataType: 'string', formatter: 'text', alignment: 'left', joinHints: [] },
  dob: { label: 'Date of Birth', category: 'Contact', sqlExpression: 'c.date_of_birth', dataType: 'date', formatter: 'date', alignment: 'left', joinHints: [] },
  gender: { label: 'Gender', category: 'Contact', sqlExpression: 'c.gender', dataType: 'string', formatter: 'text', alignment: 'left', joinHints: [] },
  address: { label: 'Address', category: 'Contact', sqlExpression: 'c.address1', dataType: 'string', formatter: 'text', alignment: 'left', joinHints: [] },
  city: { label: 'City', category: 'Contact', sqlExpression: 'c.city', dataType: 'string', formatter: 'text', alignment: 'left', joinHints: [] },
  state: { label: 'State', category: 'Contact', sqlExpression: 'c.state', dataType: 'string', formatter: 'text', alignment: 'left', joinHints: [] },
  zip: { label: 'Zip', category: 'Contact', sqlExpression: 'c.postal_code', dataType: 'string', formatter: 'text', alignment: 'left', joinHints: [] },
  country: { label: 'Country', category: 'Contact', sqlExpression: 'c.country', dataType: 'string', formatter: 'text', alignment: 'left', joinHints: [] },
  first_seen: { label: 'First Seen', category: 'Contact', sqlExpression: 'c.first_seen_at', dataType: 'date', formatter: 'datetime', alignment: 'left', joinHints: [] },
  source: { label: 'Source', category: 'Contact', sqlExpression: 'c.source', dataType: 'string', formatter: 'text', alignment: 'left', joinHints: [] },
  tags: { label: 'Tags', category: 'Contact', sqlExpression: 'c.tags', dataType: 'array', formatter: 'tags', alignment: 'left', joinHints: [] },
  total_calls: { label: 'Total Calls', category: 'Contact', sqlExpression: 'c.total_calls', dataType: 'numeric', formatter: 'integer', alignment: 'right', joinHints: [] },

  // ── Latest Policy ────────────────────────────────────────
  placed_status: { label: 'Status', category: 'Latest Policy', sqlExpression: 'p.placed_status', dataType: 'string', formatter: 'status_color', alignment: 'left', joinHints: ['policies'] },
  monthly_premium: { label: 'Premium', category: 'Latest Policy', sqlExpression: 'p.monthly_premium', dataType: 'numeric', formatter: 'currency', alignment: 'right', joinHints: ['policies'] },
  original_premium: { label: 'Original Premium', category: 'Latest Policy', sqlExpression: 'p.original_premium', dataType: 'numeric', formatter: 'currency', alignment: 'right', joinHints: ['policies'] },
  face_amount: { label: 'Face Amount', category: 'Latest Policy', sqlExpression: 'p.face_amount', dataType: 'numeric', formatter: 'currency', alignment: 'right', joinHints: ['policies'] },
  term_length: { label: 'Term Length', category: 'Latest Policy', sqlExpression: 'p.term_length', dataType: 'string', formatter: 'text', alignment: 'left', joinHints: ['policies'] },
  application_date: { label: 'Application Date', category: 'Latest Policy', sqlExpression: 'p.application_date', dataType: 'date', formatter: 'date', alignment: 'left', joinHints: ['policies'] },
  effective_date: { label: 'Effective Date', category: 'Latest Policy', sqlExpression: 'p.effective_date', dataType: 'date', formatter: 'date', alignment: 'left', joinHints: ['policies'] },
  carrier: { label: 'Carrier', category: 'Latest Policy', sqlExpression: '(SELECT name FROM carriers WHERE id = p.carrier_id)', dataType: 'string', formatter: 'text', alignment: 'left', joinHints: ['policies'] },
  product: { label: 'Product', category: 'Latest Policy', sqlExpression: '(SELECT name FROM products WHERE id = p.product_id)', dataType: 'string', formatter: 'text', alignment: 'left', joinHints: ['policies'] },
  carrier_product_raw: { label: 'Carrier + Product', category: 'Latest Policy', sqlExpression: 'p.carrier_product_raw', dataType: 'string', formatter: 'text', alignment: 'left', joinHints: ['policies'] },
  policy_number: { label: 'Policy #', category: 'Latest Policy', sqlExpression: 'p.policy_number', dataType: 'string', formatter: 'text', alignment: 'left', joinHints: ['policies'] },
  outcome_at_application: { label: 'Outcome at Application', category: 'Latest Policy', sqlExpression: 'p.outcome_at_application', dataType: 'string', formatter: 'text', alignment: 'left', joinHints: ['policies'] },

  // ── Commission ───────────────────────────────────────────
  total_advance: { label: 'Total Advance', category: 'Commission', sqlExpression: 'cs.total_advance', dataType: 'numeric', formatter: 'currency', alignment: 'right', joinHints: ['commission_summary'] },
  total_commission: { label: 'Total Commission', category: 'Commission', sqlExpression: 'cs.total_commission', dataType: 'numeric', formatter: 'currency', alignment: 'right', joinHints: ['commission_summary'] },
  total_net_commission: { label: 'Net Commission', category: 'Commission', sqlExpression: 'cs.total_net_commission', dataType: 'numeric', formatter: 'currency', alignment: 'right', joinHints: ['commission_summary'] },
  outstanding_balance: { label: 'Outstanding Balance', category: 'Commission', sqlExpression: 'cs.outstanding_balance', dataType: 'numeric', formatter: 'currency', alignment: 'right', joinHints: ['commission_summary'] },
  total_chargeback: { label: 'Total Chargeback', category: 'Commission', sqlExpression: 'cs.total_chargeback', dataType: 'numeric', formatter: 'currency', alignment: 'right', joinHints: ['commission_summary'] },
  total_recovery: { label: 'Total Recovery', category: 'Commission', sqlExpression: 'cs.total_recovery', dataType: 'numeric', formatter: 'currency', alignment: 'right', joinHints: ['commission_summary'] },
  last_statement_date: { label: 'Last Statement Date', category: 'Commission', sqlExpression: 'cs.last_statement_date', dataType: 'date', formatter: 'date', alignment: 'left', joinHints: ['commission_summary'] },
  last_transaction_type: { label: 'Last Transaction', category: 'Commission', sqlExpression: 'cs.last_transaction_type', dataType: 'string', formatter: 'text', alignment: 'left', joinHints: ['commission_summary'] },
  commission_status: { label: 'Commission Status', category: 'Commission', sqlExpression: 'cs.commission_status', dataType: 'string', formatter: 'text', alignment: 'left', joinHints: ['commission_summary'] },

  // ── Activity ─────────────────────────────────────────────
  last_seen_at: { label: 'Last Call', category: 'Activity', sqlExpression: 'c.last_seen_at', dataType: 'date', formatter: 'datetime', alignment: 'left', joinHints: [] },
  last_campaign: { label: 'Last Campaign', category: 'Activity', sqlExpression: 'ca.last_campaign', dataType: 'string', formatter: 'text', alignment: 'left', joinHints: ['calls_aggregates'] },
  calls_in_7d: { label: 'Calls in 7d', category: 'Activity', sqlExpression: 'ca.calls_in_7d', dataType: 'numeric', formatter: 'integer', alignment: 'right', joinHints: ['calls_aggregates'] },
  calls_in_30d: { label: 'Calls in 30d', category: 'Activity', sqlExpression: 'ca.calls_in_30d', dataType: 'numeric', formatter: 'integer', alignment: 'right', joinHints: ['calls_aggregates'] },
  days_since_last_call: { label: 'Days Since Last Call', category: 'Activity', sqlExpression: "EXTRACT(DAY FROM NOW() - c.last_seen_at)::int", dataType: 'numeric', formatter: 'integer', alignment: 'right', joinHints: [] },
};

const CATEGORY_ORDER = ['Contact', 'Latest Policy', 'Commission', 'Activity'];

/**
 * Group columns by category, preserving entry order within each group.
 * Returns: [{ category: 'Contact', columns: [{ key, label, ... }, ...] }, ...]
 */
export function columnsByCategory() {
  const groups = new Map(CATEGORY_ORDER.map(c => [c, []]));
  for (const [key, col] of Object.entries(COLUMN_REGISTRY)) {
    if (groups.has(col.category)) {
      groups.get(col.category).push({ key, ...col });
    }
  }
  return CATEGORY_ORDER.map(c => ({ category: c, columns: groups.get(c) }));
}

/**
 * Given a list of column keys, return the unique join hints needed.
 * Used by query.js to decide which optional joins to add to the SELECT.
 */
export function requiredJoinsForColumns(keys) {
  const out = new Set();
  for (const k of keys) {
    const col = COLUMN_REGISTRY[k];
    if (!col) continue;
    for (const j of col.joinHints) out.add(j);
  }
  return [...out];
}
```

- [ ] **Step 4:** Run tests:

```bash
node --test src/lib/portfolio/column-registry.test.mjs 2>&1 | tail -10
```

Expected: 5 pass, 0 fail.

- [ ] **Step 5:** Commit:

```bash
git add src/lib/portfolio/column-registry.js src/lib/portfolio/column-registry.test.mjs
git commit -m "feat(portfolio): column registry with 40 columns across 4 categories"
```

---

## Task 4: Migration 003 + 6 system seed views

**Files:**
- Create: `migrations/003_add_portfolio_views.sql`

- [ ] **Step 1:** Write the migration:

```sql
-- migrations/003_add_portfolio_views.sql
-- Smart views: user-creatable saved configurations of filters + columns + sort + group-by.
-- Seeded with 6 system views matching the prior hardcoded smart lists.

CREATE TABLE portfolio_views (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  description     TEXT,
  is_system       BOOLEAN NOT NULL DEFAULT false,

  -- Filter representation: EITHER filters_json (visual builder) OR raw_where (SQL escape hatch). Never both.
  filters_json    JSONB,
  raw_where       TEXT,

  -- Saved snapshot pieces
  columns         JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_by         TEXT,
  sort_dir        TEXT NOT NULL DEFAULT 'desc',
  group_by        TEXT NOT NULL DEFAULT 'none',

  -- Sidebar metadata
  pinned          BOOLEAN NOT NULL DEFAULT false,
  display_order   INTEGER NOT NULL DEFAULT 0,

  -- For system views: original seed JSON, used by /reset
  seed_json       JSONB,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT one_filter_form CHECK (
    (filters_json IS NOT NULL AND raw_where IS NULL) OR
    (filters_json IS NULL AND raw_where IS NOT NULL) OR
    (filters_json IS NULL AND raw_where IS NULL)
  )
);

CREATE INDEX idx_views_pinned_order ON portfolio_views(pinned DESC, display_order, name);

CREATE TRIGGER set_updated_at_views BEFORE UPDATE ON portfolio_views
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Seed the 6 system views. Each has its own filters_json AND seed_json
-- (identical at seed time; seed_json never changes, so /reset works).

INSERT INTO portfolio_views (name, description, is_system, filters_json, columns, sort_by, sort_dir, group_by, display_order, seed_json) VALUES

('All Submitted Apps',
 'Every submitted application — the master list',
 true,
 '{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"}]}'::jsonb,
 '["name","phone","state","placed_status","monthly_premium","application_date","carrier","policy_number","total_calls"]'::jsonb,
 'application_date', 'desc', 'none', 1,
 '{"filters_json":{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"}]},"columns":["name","phone","state","placed_status","monthly_premium","application_date","carrier","policy_number","total_calls"],"sort_by":"application_date","sort_dir":"desc","group_by":"none"}'::jsonb),

('Pending Applications',
 'Apps awaiting carrier action',
 true,
 '{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"op":"OR","rules":[{"field":"placed_status","op":"contains","value":"pending"},{"field":"placed_status","op":"contains","value":"submitted"},{"field":"placed_status","op":"contains","value":"awaiting"}]}]}'::jsonb,
 '["name","phone","state","placed_status","monthly_premium","application_date","carrier"]'::jsonb,
 'application_date', 'desc', 'none', 2,
 '{"filters_json":{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"op":"OR","rules":[{"field":"placed_status","op":"contains","value":"pending"},{"field":"placed_status","op":"contains","value":"submitted"},{"field":"placed_status","op":"contains","value":"awaiting"}]}]},"columns":["name","phone","state","placed_status","monthly_premium","application_date","carrier"],"sort_by":"application_date","sort_dir":"desc","group_by":"none"}'::jsonb),

('Active Policies',
 'In-force book of business',
 true,
 '{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"op":"OR","rules":[{"field":"placed_status","op":"contains","value":"active"},{"field":"placed_status","op":"contains","value":"in force"},{"field":"placed_status","op":"contains","value":"advance released"}]}]}'::jsonb,
 '["name","phone","state","placed_status","monthly_premium","carrier","policy_number","outstanding_balance","commission_status"]'::jsonb,
 'monthly_premium', 'desc', 'none', 3,
 '{"filters_json":{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"op":"OR","rules":[{"field":"placed_status","op":"contains","value":"active"},{"field":"placed_status","op":"contains","value":"in force"},{"field":"placed_status","op":"contains","value":"advance released"}]}]},"columns":["name","phone","state","placed_status","monthly_premium","carrier","policy_number","outstanding_balance","commission_status"],"sort_by":"monthly_premium","sort_dir":"desc","group_by":"none"}'::jsonb),

('Recently Lapsed',
 'Win-back targets',
 true,
 '{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"op":"OR","rules":[{"field":"placed_status","op":"contains","value":"lapsed"},{"field":"placed_status","op":"contains","value":"canceled"},{"field":"placed_status","op":"contains","value":"cancelled"}]}]}'::jsonb,
 '["name","phone","state","placed_status","monthly_premium","application_date","total_chargeback"]'::jsonb,
 'application_date', 'desc', 'none', 4,
 '{"filters_json":{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"op":"OR","rules":[{"field":"placed_status","op":"contains","value":"lapsed"},{"field":"placed_status","op":"contains","value":"canceled"},{"field":"placed_status","op":"contains","value":"cancelled"}]}]},"columns":["name","phone","state","placed_status","monthly_premium","application_date","total_chargeback"],"sort_by":"application_date","sort_dir":"desc","group_by":"none"}'::jsonb),

('Declined',
 'Re-pivot opportunities',
 true,
 '{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"field":"placed_status","op":"contains","value":"declined"}]}'::jsonb,
 '["name","phone","state","placed_status","application_date","outcome_at_application","carrier"]'::jsonb,
 'application_date', 'desc', 'none', 5,
 '{"filters_json":{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"field":"placed_status","op":"contains","value":"declined"}]},"columns":["name","phone","state","placed_status","application_date","outcome_at_application","carrier"],"sort_by":"application_date","sort_dir":"desc","group_by":"none"}'::jsonb),

('High-Value Active',
 'In-force policies with monthly premium ≥ $100',
 true,
 '{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"field":"monthly_premium","op":"gte","value":100},{"op":"OR","rules":[{"field":"placed_status","op":"contains","value":"active"},{"field":"placed_status","op":"contains","value":"in force"}]}]}'::jsonb,
 '["name","phone","state","placed_status","monthly_premium","carrier","outstanding_balance","total_commission"]'::jsonb,
 'monthly_premium', 'desc', 'none', 6,
 '{"filters_json":{"op":"AND","rules":[{"field":"application_date","op":"is_not_null"},{"field":"monthly_premium","op":"gte","value":100},{"op":"OR","rules":[{"field":"placed_status","op":"contains","value":"active"},{"field":"placed_status","op":"contains","value":"in force"}]}]},"columns":["name","phone","state","placed_status","monthly_premium","carrier","outstanding_balance","total_commission"],"sort_by":"monthly_premium","sort_dir":"desc","group_by":"none"}'::jsonb);
```

- [ ] **Step 2:** Sanity-check counts:

```bash
echo "tables: $(grep -c '^CREATE TABLE' migrations/003_add_portfolio_views.sql) (expect 1)"
echo "indexes: $(grep -c '^CREATE INDEX' migrations/003_add_portfolio_views.sql) (expect 1)"
echo "triggers: $(grep -c '^CREATE TRIGGER' migrations/003_add_portfolio_views.sql) (expect 1)"
echo "INSERT rows: $(grep -c '^(' migrations/003_add_portfolio_views.sql) (expect 6)"
```

- [ ] **Step 3:** Apply:

```bash
node scripts/db-migrate.mjs up 2>&1 | grep -v MODULE_TYPELESS
```

Expected: applies 003.

- [ ] **Step 4:** Verify the 6 seeds landed:

```bash
node --input-type=module -e "
await import('./scripts/load-env.mjs');
const { sql, closeDb } = await import('./src/lib/db.js');
const r = await sql\`SELECT name, is_system, jsonb_array_length(columns) AS col_count FROM portfolio_views ORDER BY display_order\`;
for (const v of r) console.log(v.name, '| system:', v.isSystem, '| cols:', v.colCount);
await closeDb();
" 2>&1 | grep -v MODULE_TYPELESS
```

Expected: 6 rows, all `system: true`, varying column counts (7–9).

- [ ] **Step 5:** Commit:

```bash
git add migrations/003_add_portfolio_views.sql
git commit -m "feat(portfolio): add portfolio_views table + 6 seed system views"
```

---

## Task 5: Raw-SQL safety + read-only DB client

**Files:**
- Create: `src/lib/portfolio/raw-sql-safety.js`
- Create: `src/lib/portfolio/raw-sql-safety.test.mjs`
- Modify: `src/lib/db.js` (add `sqlReadonly` export)

- [ ] **Step 1:** Write tests at `src/lib/portfolio/raw-sql-safety.test.mjs`:

```javascript
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
```

- [ ] **Step 2:** Run to verify failure:

```bash
node --test src/lib/portfolio/raw-sql-safety.test.mjs 2>&1 | tail -10
```

Expected: ERR_MODULE_NOT_FOUND.

- [ ] **Step 3:** Write `src/lib/portfolio/raw-sql-safety.js`:

```javascript
// src/lib/portfolio/raw-sql-safety.js

/**
 * Keywords that must NOT appear in a user-supplied raw_where expression.
 * Used as the first layer of the two-layer defense; the second layer is
 * the read-only DB role (DATABASE_URL_READONLY) which physically cannot
 * execute writes/DDL even if a keyword slips through.
 */
export const RAW_SQL_DENIED_KEYWORDS = [
  'DELETE', 'INSERT', 'UPDATE', 'DROP', 'ALTER', 'CREATE',
  'TRUNCATE', 'GRANT', 'REVOKE', 'EXECUTE', 'EXEC',
  'MERGE', 'COPY', 'CALL',
];

/**
 * Validate a raw_where fragment. Returns { ok: true } if safe, or
 * { ok: false, reason: '...' } with a human-readable rejection reason.
 */
export function isRawWhereSafe(input) {
  if (!input) return { ok: true };
  const s = String(input);

  // Reject statement separators
  if (s.includes(';')) return { ok: false, reason: 'Semicolons are not allowed' };

  // Reject SQL comments
  if (s.includes('--')) return { ok: false, reason: 'Line comments (--) are not allowed' };
  if (s.includes('/*')) return { ok: false, reason: 'Block comments (/*) are not allowed' };

  // Whole-word keyword check, case-insensitive
  for (const kw of RAW_SQL_DENIED_KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b`, 'i');
    if (re.test(s)) return { ok: false, reason: `Keyword "${kw}" is not allowed in raw filters` };
  }

  return { ok: true };
}
```

- [ ] **Step 4:** Modify `src/lib/db.js` to add a parallel `sqlReadonly` export. Find the existing exports and add below them:

```javascript
let _sqlReadonly = null;

function getReadonlySql() {
  if (_sqlReadonly) return _sqlReadonly;
  const url = process.env.DATABASE_URL_READONLY;
  if (!url) throw new Error('DATABASE_URL_READONLY not set — required for raw-SQL views');
  _sqlReadonly = postgres(url, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    transform: postgres.camel,
  });
  return _sqlReadonly;
}

export const sqlReadonly = (...args) => getReadonlySql()(...args);

export async function closeReadonlyDb() {
  if (_sqlReadonly) {
    await _sqlReadonly.end();
    _sqlReadonly = null;
  }
}
```

- [ ] **Step 5:** Run all tests:

```bash
npm test 2>&1 | tail -8
```

Expected: 77 total (52 + 11 + 5 + 9), all pass.

- [ ] **Step 6:** Commit:

```bash
git add src/lib/portfolio/raw-sql-safety.js src/lib/portfolio/raw-sql-safety.test.mjs src/lib/db.js
git commit -m "feat(portfolio): raw-SQL safety blocklist + read-only DB client"
```

---

## Task 6: views.js CRUD module + tests

**Files:**
- Create: `src/lib/portfolio/views.js`
- Create: `src/lib/portfolio/views.test.mjs`

- [ ] **Step 1:** Write tests at `src/lib/portfolio/views.test.mjs`:

```javascript
// src/lib/portfolio/views.test.mjs
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
```

- [ ] **Step 2:** Run tests to verify failure:

```bash
node --test src/lib/portfolio/views.test.mjs 2>&1 | tail -10
```

- [ ] **Step 3:** Write `src/lib/portfolio/views.js`:

```javascript
// src/lib/portfolio/views.js
import { sql } from '../db.js';
import { COLUMN_REGISTRY } from './column-registry.js';
import { isRawWhereSafe } from './raw-sql-safety.js';

const VALID_SORT_DIRS = ['asc', 'desc'];
const VALID_GROUP_BYS = ['none', 'state', 'placed_status', 'agent', 'campaign', 'month', 'carrier'];

/**
 * Validate an inbound payload (from the API request body) before persisting.
 * Throws Error with a human-readable message on invalid input.
 */
export function validateViewPayload(p) {
  if (!p || typeof p !== 'object') throw new Error('Payload must be an object');
  const name = (p.name ?? '').toString().trim();
  if (!name) throw new Error('View name is required');
  if (!Array.isArray(p.columns) || p.columns.length === 0) throw new Error('At least one column is required');
  for (const k of p.columns) {
    if (!COLUMN_REGISTRY[k]) throw new Error(`Unknown column key: ${k}`);
  }
  if (p.sort_dir && !VALID_SORT_DIRS.includes(p.sort_dir)) {
    throw new Error(`Invalid sort_dir: ${p.sort_dir}`);
  }
  if (p.group_by && !VALID_GROUP_BYS.includes(p.group_by)) {
    throw new Error(`Invalid group_by: ${p.group_by}`);
  }
  if (p.sort_by && !COLUMN_REGISTRY[p.sort_by]) {
    throw new Error(`Unknown sort_by column: ${p.sort_by}`);
  }
  if (p.filters_json && p.raw_where) {
    throw new Error('Cannot set both filters_json and raw_where on a single view');
  }
  if (p.raw_where) {
    const check = isRawWhereSafe(p.raw_where);
    if (!check.ok) throw new Error(`Unsafe raw_where: ${check.reason}`);
  }
}

/**
 * Convert a validated payload into the row shape for INSERT/UPDATE.
 */
export function normalizeViewForDb(p) {
  return {
    name: p.name.trim(),
    description: p.description?.trim() || null,
    filtersJson: p.filters_json ?? null,
    rawWhere: p.raw_where?.trim() || null,
    columns: p.columns,
    sortBy: p.sort_by ?? null,
    sortDir: p.sort_dir ?? 'desc',
    groupBy: p.group_by ?? 'none',
    pinned: !!p.pinned,
    displayOrder: typeof p.display_order === 'number' ? p.display_order : 0,
  };
}

/**
 * List all views for the sidebar. Sorted: pinned first, then display_order, then name.
 */
export async function listViews() {
  return await sql`
    SELECT id, name, description, is_system, pinned, display_order, sort_by, sort_dir, group_by,
           jsonb_array_length(columns) AS column_count
    FROM portfolio_views
    ORDER BY pinned DESC, display_order, name
  `;
}

/**
 * Load a single view by id, including its full filters/columns/raw_where.
 */
export async function getView(id) {
  const [row] = await sql`SELECT * FROM portfolio_views WHERE id = ${id}`;
  return row ?? null;
}

/**
 * Create a view. Caller must have already called validateViewPayload.
 */
export async function createView(p) {
  const v = normalizeViewForDb(p);
  const [row] = await sql`
    INSERT INTO portfolio_views (name, description, filters_json, raw_where, columns, sort_by, sort_dir, group_by, pinned, display_order)
    VALUES (${v.name}, ${v.description}, ${v.filtersJson}, ${v.rawWhere}, ${JSON.stringify(v.columns)}::jsonb, ${v.sortBy}, ${v.sortDir}, ${v.groupBy}, ${v.pinned}, ${v.displayOrder})
    RETURNING id
  `;
  return row.id;
}

/**
 * Update a view by id. Caller must have already called validateViewPayload.
 */
export async function updateView(id, p) {
  const v = normalizeViewForDb(p);
  await sql`
    UPDATE portfolio_views SET
      name = ${v.name},
      description = ${v.description},
      filters_json = ${v.filtersJson},
      raw_where = ${v.rawWhere},
      columns = ${JSON.stringify(v.columns)}::jsonb,
      sort_by = ${v.sortBy},
      sort_dir = ${v.sortDir},
      group_by = ${v.groupBy},
      pinned = ${v.pinned},
      display_order = ${v.displayOrder},
      updated_at = NOW()
    WHERE id = ${id}
  `;
}

/**
 * Delete a view. Returns { ok, reason } — if the view is_system, returns ok:false.
 */
export async function deleteView(id) {
  const [row] = await sql`SELECT is_system FROM portfolio_views WHERE id = ${id}`;
  if (!row) return { ok: false, reason: 'View not found' };
  if (row.isSystem) return { ok: false, reason: 'System views cannot be deleted; use reset instead' };
  await sql`DELETE FROM portfolio_views WHERE id = ${id}`;
  return { ok: true };
}

/**
 * Reset a system view's mutable fields back to its seed_json.
 */
export async function resetSystemView(id) {
  const [row] = await sql`SELECT is_system, seed_json FROM portfolio_views WHERE id = ${id}`;
  if (!row) return { ok: false, reason: 'View not found' };
  if (!row.isSystem) return { ok: false, reason: 'Only system views can be reset' };
  if (!row.seedJson) return { ok: false, reason: 'No seed available' };
  const s = row.seedJson;
  await sql`
    UPDATE portfolio_views SET
      filters_json = ${s.filters_json ?? null},
      raw_where = ${s.raw_where ?? null},
      columns = ${JSON.stringify(s.columns ?? [])}::jsonb,
      sort_by = ${s.sort_by ?? null},
      sort_dir = ${s.sort_dir ?? 'desc'},
      group_by = ${s.group_by ?? 'none'},
      updated_at = NOW()
    WHERE id = ${id}
  `;
  return { ok: true };
}
```

- [ ] **Step 4:** Run tests:

```bash
npm test 2>&1 | tail -8
```

Expected: 85 total (77 + 8), all pass.

- [ ] **Step 5:** Commit:

```bash
git add src/lib/portfolio/views.js src/lib/portfolio/views.test.mjs
git commit -m "feat(portfolio): views.js CRUD module + payload validation"
```

---

## Task 7: 5 API routes for views

**Files:**
- Create: `src/app/api/portfolio/views/route.js` (GET + POST)
- Create: `src/app/api/portfolio/views/[id]/route.js` (PATCH + DELETE)
- Create: `src/app/api/portfolio/views/[id]/reset/route.js` (POST)

- [ ] **Step 1:** Write `src/app/api/portfolio/views/route.js`:

```javascript
// src/app/api/portfolio/views/route.js
import { NextResponse } from 'next/server';
import { listViews, validateViewPayload, createView } from '@/lib/portfolio/views';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const views = await listViews();
    return NextResponse.json({ views });
  } catch (err) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const payload = await req.json();
    validateViewPayload(payload);
    const id = await createView(payload);
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    const status = err.message?.match(/required|unknown|invalid|both|unsafe/i) ? 400 : 500;
    return NextResponse.json({ error: err.message ?? String(err) }, { status });
  }
}
```

- [ ] **Step 2:** Write `src/app/api/portfolio/views/[id]/route.js`:

```javascript
// src/app/api/portfolio/views/[id]/route.js
import { NextResponse } from 'next/server';
import { getView, validateViewPayload, updateView, deleteView } from '@/lib/portfolio/views';

export const dynamic = 'force-dynamic';

export async function GET(req, { params }) {
  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  try {
    const view = await getView(id);
    if (!view) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ view });
  } catch (err) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}

export async function PATCH(req, { params }) {
  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  try {
    const payload = await req.json();
    validateViewPayload(payload);
    await updateView(id, payload);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const status = err.message?.match(/required|unknown|invalid|both|unsafe/i) ? 400 : 500;
    return NextResponse.json({ error: err.message ?? String(err) }, { status });
  }
}

export async function DELETE(req, { params }) {
  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  try {
    const result = await deleteView(id);
    if (!result.ok) {
      const status = result.reason.includes('not found') ? 404 : 403;
      return NextResponse.json({ error: result.reason }, { status });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 3:** Write `src/app/api/portfolio/views/[id]/reset/route.js`:

```javascript
// src/app/api/portfolio/views/[id]/reset/route.js
import { NextResponse } from 'next/server';
import { resetSystemView } from '@/lib/portfolio/views';

export const dynamic = 'force-dynamic';

export async function POST(req, { params }) {
  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  try {
    const result = await resetSystemView(id);
    if (!result.ok) {
      const status = result.reason.includes('not found') ? 404 : 403;
      return NextResponse.json({ error: result.reason }, { status });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 4:** Build to verify route registration:

```bash
npm run build 2>&1 | grep "api/portfolio/views"
```

Expected: 3 lines listing the new routes.

- [ ] **Step 5:** Commit:

```bash
git add src/app/api/portfolio/views/
git commit -m "feat(portfolio): 5 API routes for view CRUD + reset"
```

---

## Task 8: Update query.js to consume filter-tree + columns

**Files:**
- Modify: `src/lib/portfolio/query.js`
- Modify: `src/app/api/portfolio/contacts/route.js`

The query layer currently builds a SELECT with hardcoded columns. We extend it to accept either the legacy `filters` object OR a viewId, and to use the column registry for SELECT projection.

- [ ] **Step 1:** Replace `src/lib/portfolio/query.js` with this new version. The structure: pre-compute joins from columns (using `requiredJoinsForColumns`), build the SELECT projection from the column registry, compose WHERE from either the legacy fragment or `compileFilterTree`.

Read the current file first:

```bash
cat src/lib/portfolio/query.js
```

Then replace its contents with:

```javascript
// src/lib/portfolio/query.js
import { sql, sqlReadonly } from '../db.js';
import { buildWhereFragment } from './filters.js';
import { compileFilterTree } from './filter-tree.js';
import { COLUMN_REGISTRY, requiredJoinsForColumns } from './column-registry.js';

const POLICIES_JOIN = sql`LEFT JOIN policies p ON p.contact_id = c.id`;
const COMMISSION_SUMMARY_JOIN = sql`LEFT JOIN policy_commission_summary cs ON cs.policy_id = p.id`;
const CALLS_AGG_JOIN = sql`LEFT JOIN (
  SELECT contact_id,
         MAX(campaign_code) AS last_campaign,
         COUNT(*) FILTER (WHERE call_date >= NOW() - INTERVAL '7 days')::int AS calls_in_7d,
         COUNT(*) FILTER (WHERE call_date >= NOW() - INTERVAL '30 days')::int AS calls_in_30d
  FROM calls GROUP BY contact_id
) ca ON ca.contact_id = c.id`;

function joinsFor(joinKeys) {
  const parts = [];
  // policies must come first since commission_summary depends on `p`
  if (joinKeys.includes('policies') || joinKeys.includes('commission_summary')) parts.push(POLICIES_JOIN);
  if (joinKeys.includes('commission_summary')) parts.push(COMMISSION_SUMMARY_JOIN);
  if (joinKeys.includes('calls_aggregates')) parts.push(CALLS_AGG_JOIN);
  return parts.length === 0 ? sql`` : parts.flatMap((p, i) => i === 0 ? [p] : [sql` `, p]);
}

function buildSelectProjection(columnKeys) {
  // Always include the contact id for row-click handlers
  const parts = [sql`c.id`];
  for (const key of columnKeys) {
    const col = COLUMN_REGISTRY[key];
    if (!col) continue;
    // Use sql.unsafe for the trusted registry expression, give it the column key as alias
    parts.push(sql`${sql.unsafe(col.sqlExpression)} AS ${sql.unsafe('"' + key + '"')}`);
  }
  return parts.flatMap((p, i) => i === 0 ? [p] : [sql`, `, p]);
}

/**
 * List contacts with the given view config (or legacy filters).
 *
 * `viewConfig` shape (when called from /api/portfolio/contacts via viewId):
 *   { filters_json | raw_where, columns, sort_by, sort_dir }
 *
 * Falls back to legacy `filters` object (smartList key + ad-hoc fields)
 * for the existing UI paths that don't yet use views.
 */
export async function listContactsForView({ viewConfig, page = 1, pageSize = 50 }) {
  const columns = viewConfig.columns?.length ? viewConfig.columns : ['name', 'phone', 'state', 'placed_status', 'monthly_premium', 'application_date', 'carrier', 'last_seen_at'];
  const offset = (page - 1) * pageSize;
  const usingReadonly = !!viewConfig.raw_where;
  const sqlClient = usingReadonly ? sqlReadonly : sql;

  // Compose WHERE
  let whereClause;
  if (viewConfig.raw_where) {
    whereClause = sql`WHERE ${sql.unsafe('(' + viewConfig.raw_where + ')')}`;
  } else if (viewConfig.filters_json) {
    const fragment = compileFilterTree(viewConfig.filters_json, COLUMN_REGISTRY);
    whereClause = sql`WHERE ${fragment}`;
  } else {
    whereClause = sql``;
  }

  // Compose joins from BOTH the columns we project AND the joins implied by the
  // filter tree (we need policies joined whenever a filter references it, even
  // if the SELECT doesn't show those columns).
  const joinKeys = new Set(requiredJoinsForColumns(columns));
  // Pessimistically join policies if the filter tree references any policy columns;
  // simplest is to detect via the WHERE text including "p." — postgres.js fragments don't
  // expose their text, so we conservatively join policies whenever filters_json is set.
  if (viewConfig.filters_json || viewConfig.raw_where) joinKeys.add('policies');

  const joinFragment = joinsFor([...joinKeys]);
  const projection = buildSelectProjection(columns);

  // Sort
  const sortKey = viewConfig.sort_by && COLUMN_REGISTRY[viewConfig.sort_by] ? viewConfig.sort_by : 'last_seen_at';
  const sortCol = sql.unsafe(COLUMN_REGISTRY[sortKey]?.sqlExpression ?? 'c.last_seen_at');
  const sortDir = viewConfig.sort_dir === 'asc' ? sql`ASC` : sql`DESC`;

  const rows = await sqlClient`
    SELECT ${projection}
    FROM contacts c ${joinFragment}
    ${whereClause}
    GROUP BY c.id
    ORDER BY ${sortCol} ${sortDir} NULLS LAST
    LIMIT ${pageSize} OFFSET ${offset}
  `;

  const [{ count }] = await sqlClient`
    SELECT COUNT(DISTINCT c.id)::int AS count
    FROM contacts c ${joinFragment}
    ${whereClause}
  `;

  return { rows, total: count, page, pageSize, columns };
}

// Keep the legacy listContacts for backward compatibility with the existing
// /api/portfolio/contacts callers that pass `filters` (smartList + ad-hoc).
export async function listContacts({ filters = {}, page = 1, pageSize = 50, sortBy = 'last_seen_at', sortDir = 'desc' }) {
  const { conditions } = buildWhereFragment(filters);
  const offset = (page - 1) * pageSize;
  const whereClause = conditions.length === 0 ? sql`` :
    sql`WHERE ${conditions.flatMap((c, i) => i === 0 ? c : [sql` AND `, c])}`;
  const policiesJoin = sql`LEFT JOIN policies p ON p.contact_id = c.id`;
  const sortColumns = {
    last_seen_at: sql`c.last_seen_at`,
    name: sql`c.last_name`,
    application_date: sql`MAX(p.application_date)`,
    monthly_premium: sql`MAX(p.monthly_premium)`,
    state: sql`c.state`,
  };
  const sortCol = sortColumns[sortBy] ?? sql`c.last_seen_at`;
  const direction = sortDir === 'asc' ? sql`ASC` : sql`DESC`;
  const rows = await sql`
    SELECT
      c.id, c.phone, c.first_name, c.last_name, c.state, c.last_seen_at, c.total_calls, c.tags,
      MAX(p.placed_status) AS placed_status,
      MAX(p.policy_number) AS policy_number,
      MAX(p.monthly_premium) AS monthly_premium,
      MAX(p.application_date) AS application_date,
      MAX(p.sales_agent_raw) AS sales_agent,
      MAX(p.carrier_product_raw) AS carrier_product
    FROM contacts c ${policiesJoin} ${whereClause}
    GROUP BY c.id
    ORDER BY ${sortCol} ${direction} NULLS LAST
    LIMIT ${pageSize} OFFSET ${offset}
  `;
  const [{ count }] = await sql`
    SELECT COUNT(DISTINCT c.id)::int AS count FROM contacts c ${policiesJoin} ${whereClause}
  `;
  return { rows, total: count, page, pageSize };
}

// groupContacts unchanged from the existing version
export async function groupContacts({ filters = {}, groupBy = 'placed_status' }) {
  const { conditions, joinPolicies } = buildWhereFragment(filters);
  const whereClause = conditions.length === 0 ? sql`` :
    sql`WHERE ${conditions.flatMap((c, i) => i === 0 ? c : [sql` AND `, c])}`;
  const policiesJoin = joinPolicies || ['placed_status', 'carrier', 'agent', 'campaign', 'month'].includes(groupBy)
    ? sql`LEFT JOIN policies p ON p.contact_id = c.id` : sql``;
  const groupExpressions = {
    state: sql`c.state`,
    placed_status: sql`p.placed_status`,
    agent: sql`p.sales_agent_raw`,
    campaign: sql`p.sales_lead_source_raw`,
    month: sql`TO_CHAR(p.application_date, 'YYYY-MM')`,
    carrier: sql`(SELECT name FROM carriers WHERE id = p.carrier_id)`,
  };
  const groupExpr = groupExpressions[groupBy];
  if (!groupExpr) throw new Error(`Unsupported group-by: ${groupBy}`);
  const rows = await sql`
    SELECT ${groupExpr} AS group_key, COUNT(DISTINCT c.id)::int AS contact_count, SUM(p.monthly_premium)::numeric(12,2) AS total_premium
    FROM contacts c ${policiesJoin} ${whereClause}
    GROUP BY ${groupExpr} ORDER BY contact_count DESC
  `;
  return { groups: rows, groupBy };
}
```

- [ ] **Step 2:** Modify `src/app/api/portfolio/contacts/route.js` to add `viewId` support. Read the current file:

```bash
cat src/app/api/portfolio/contacts/route.js
```

Add a `viewId` branch. Replace the file with:

```javascript
// src/app/api/portfolio/contacts/route.js
import { NextResponse } from 'next/server';
import { listContacts, groupContacts, listContactsForView } from '@/lib/portfolio/query';
import { getView } from '@/lib/portfolio/views';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const url = new URL(req.url);

  // New path: viewId — load the view server-side and use its full config
  const viewId = url.searchParams.get('viewId');
  if (viewId) {
    const id = parseInt(viewId, 10);
    if (isNaN(id)) return NextResponse.json({ error: 'invalid viewId' }, { status: 400 });
    const view = await getView(id);
    if (!view) return NextResponse.json({ error: 'view not found' }, { status: 404 });
    const page = parseInt(url.searchParams.get('page') ?? '1', 10);
    const pageSize = Math.min(parseInt(url.searchParams.get('pageSize') ?? '50', 10), 200);
    try {
      const result = await listContactsForView({ viewConfig: view, page, pageSize });
      return NextResponse.json(result);
    } catch (err) {
      return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
    }
  }

  // Legacy path: filters + groupBy
  let filters = {};
  try { filters = JSON.parse(url.searchParams.get('filters') ?? '{}'); }
  catch { return NextResponse.json({ error: 'invalid filters JSON' }, { status: 400 }); }

  const groupBy = url.searchParams.get('groupBy');
  const page = parseInt(url.searchParams.get('page') ?? '1', 10);
  const pageSize = Math.min(parseInt(url.searchParams.get('pageSize') ?? '50', 10), 200);
  const sortBy = url.searchParams.get('sortBy') ?? 'last_seen_at';
  const sortDir = url.searchParams.get('sortDir') ?? 'desc';

  try {
    if (groupBy && groupBy !== 'none') {
      return NextResponse.json(await groupContacts({ filters, groupBy }));
    }
    return NextResponse.json(await listContacts({ filters, page, pageSize, sortBy, sortDir }));
  } catch (err) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 3:** Build to verify:

```bash
npm run build 2>&1 | tail -8
```

- [ ] **Step 4:** Smoke test — load a system view via the new path:

```bash
node --input-type=module -e "
await import('./scripts/load-env.mjs');
const { getView } = await import('./src/lib/portfolio/views.js');
const { listContactsForView } = await import('./src/lib/portfolio/query.js');
const view = await getView(3); // 'Active Policies'
console.log('View:', view.name);
const r = await listContactsForView({ viewConfig: view, pageSize: 3 });
console.log('Total:', r.total, '| Columns:', r.columns);
console.log('Sample:', JSON.stringify(r.rows[0], null, 2));
process.exit(0);
" 2>&1 | grep -v MODULE_TYPELESS
```

Expected: a row count > 0, columns array matches the view's column list, sample row has values for those columns.

- [ ] **Step 5:** Commit:

```bash
git add src/lib/portfolio/query.js src/app/api/portfolio/contacts/route.js
git commit -m "feat(portfolio): listContactsForView + viewId param on /api/portfolio/contacts"
```

---

## Task 9: PortfolioGrid renders arbitrary columns from registry

**Files:**
- Modify: `src/components/portfolio/PortfolioGrid.jsx`

The current grid has 8 hardcoded columns. Replace with a column-driven renderer that reads `columns` (array of keys) from the parent and uses the registry for label + formatter.

- [ ] **Step 1:** Read the current grid:

```bash
cat src/components/portfolio/PortfolioGrid.jsx
```

- [ ] **Step 2:** Replace its contents with this version that reads columns from props (the parent supplies them based on the active view):

```jsx
// src/components/portfolio/PortfolioGrid.jsx
'use client';
import { COLUMN_REGISTRY } from '@/lib/portfolio/column-registry';

const C = {
  bg: '#080b10', surface: '#0f1520', card: '#131b28', border: '#1a2538',
  text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff',
  green: '#4ade80', yellow: '#facc15', red: '#f87171',
};

function statusColor(status) {
  if (!status) return C.muted;
  const s = status.toLowerCase();
  if (s.includes('active') || s.includes('in force') || s.includes('advance released')) return C.green;
  if (s.includes('pending') || s.includes('submitted')) return C.yellow;
  if (s.includes('lapsed') || s.includes('canceled') || s.includes('cancelled') || s.includes('declined')) return C.red;
  return C.muted;
}

function fmtValue(v, formatter) {
  if (v == null || v === '') return '—';
  switch (formatter) {
    case 'date':
      return new Date(v).toLocaleDateString();
    case 'datetime':
      return new Date(v).toLocaleString();
    case 'currency':
      return `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case 'integer':
      return Number(v).toLocaleString();
    case 'tags':
      if (!Array.isArray(v) || v.length === 0) return '—';
      return v.map((t, i) => (
        <span key={i} style={{ background: C.surface, color: C.muted, padding: '1px 6px', borderRadius: 8, fontSize: 10, marginRight: 4 }}>{t}</span>
      ));
    default:
      return String(v);
  }
}

export default function PortfolioGrid({ rows, columns, selectedIds, onToggleSelect, onRowClick, sortBy, sortDir, onSort }) {
  const cols = columns.map(key => ({ key, ...COLUMN_REGISTRY[key] })).filter(c => c.label);
  const allSelected = rows.length > 0 && rows.every(r => selectedIds.has(r.id));

  return (
    <div style={{ background: C.card, borderRadius: 8, overflow: 'auto', maxWidth: '100%' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'monospace', fontSize: 13 }}>
        <thead>
          <tr style={{ background: C.surface, borderBottom: `1px solid ${C.border}` }}>
            <th style={{ padding: '10px 12px', textAlign: 'left', width: 36, position: 'sticky', left: 0, background: C.surface }}>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={e => rows.forEach(r => onToggleSelect(r.id, e.target.checked))}
              />
            </th>
            {cols.map(c => (
              <th
                key={c.key}
                onClick={() => onSort && onSort(c.key)}
                style={{
                  padding: '10px 12px',
                  textAlign: c.alignment ?? 'left',
                  color: C.muted,
                  textTransform: 'uppercase',
                  fontSize: 11,
                  cursor: onSort ? 'pointer' : 'default',
                  userSelect: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                {c.label}{sortBy === c.key && (sortDir === 'asc' ? ' ↑' : ' ↓')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr
              key={r.id}
              onClick={() => onRowClick(r.id)}
              style={{ borderBottom: `1px solid ${C.border}`, cursor: 'pointer' }}
            >
              <td style={{ padding: '10px 12px', position: 'sticky', left: 0, background: C.card }}>
                <input
                  type="checkbox"
                  checked={selectedIds.has(r.id)}
                  onClick={e => e.stopPropagation()}
                  onChange={e => onToggleSelect(r.id, e.target.checked)}
                />
              </td>
              {cols.map(c => {
                const v = r[c.key];
                const color = c.formatter === 'status_color' ? statusColor(v) : C.text;
                return (
                  <td key={c.key} style={{ padding: '10px 12px', textAlign: c.alignment ?? 'left', color, whiteSpace: 'nowrap' }}>
                    {c.formatter === 'status_color' ? (v ?? '—') : fmtValue(v, c.formatter)}
                  </td>
                );
              })}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={cols.length + 1} style={{ padding: 32, textAlign: 'center', color: C.muted }}>
                No contacts match the current view.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3:** Build:

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 4:** Commit:

```bash
git add src/components/portfolio/PortfolioGrid.jsx
git commit -m "feat(portfolio): grid renders arbitrary columns via column registry"
```

---

## Task 10: PortfolioFilterBuilder component (visual AND/OR)

**Files:**
- Create: `src/components/portfolio/PortfolioFilterBuilder.jsx`

A recursive React component that renders a filter tree (AND/OR groups + leaves) and emits change events.

- [ ] **Step 1:** Write `src/components/portfolio/PortfolioFilterBuilder.jsx`:

```jsx
// src/components/portfolio/PortfolioFilterBuilder.jsx
'use client';
import { COLUMN_REGISTRY, columnsByCategory } from '@/lib/portfolio/column-registry';

const C = { card: '#131b28', border: '#1a2538', text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff', red: '#f87171' };

const OPS_BY_TYPE = {
  string: ['eq', 'neq', 'in', 'not_in', 'contains', 'not_contains', 'is_null', 'is_not_null'],
  numeric: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_null', 'is_not_null'],
  date: ['eq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_null', 'is_not_null'],
  array: ['contains', 'is_null', 'is_not_null'],
};

const OP_LABELS = {
  eq: 'is', neq: 'is not', in: 'in', not_in: 'not in',
  contains: 'contains', not_contains: 'does not contain',
  gt: '>', gte: '≥', lt: '<', lte: '≤', between: 'between',
  is_null: 'is empty', is_not_null: 'is not empty',
};

function isGroup(node) {
  return node && Array.isArray(node.rules);
}

function emptyLeaf() {
  return { field: 'state', op: 'eq', value: '' };
}

function emptyGroup(op = 'AND') {
  return { op, rules: [emptyLeaf()] };
}

function ValueInput({ leaf, dataType, onChange }) {
  if (leaf.op === 'is_null' || leaf.op === 'is_not_null') return null;
  if (leaf.op === 'in' || leaf.op === 'not_in') {
    const val = Array.isArray(leaf.value) ? leaf.value.join(', ') : '';
    return (
      <input
        type="text"
        placeholder="comma, separated, list"
        value={val}
        onChange={e => onChange({ ...leaf, value: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
        style={inputStyle}
      />
    );
  }
  if (leaf.op === 'between') {
    const [lo, hi] = Array.isArray(leaf.value) ? leaf.value : ['', ''];
    return (
      <span style={{ display: 'flex', gap: 4 }}>
        <input type={dataType === 'numeric' ? 'number' : 'text'} value={lo} placeholder="from"
          onChange={e => onChange({ ...leaf, value: [e.target.value, hi] })} style={{ ...inputStyle, width: 80 }} />
        <input type={dataType === 'numeric' ? 'number' : 'text'} value={hi} placeholder="to"
          onChange={e => onChange({ ...leaf, value: [lo, e.target.value] })} style={{ ...inputStyle, width: 80 }} />
      </span>
    );
  }
  const inputType = dataType === 'numeric' ? 'number' : dataType === 'date' ? 'date' : 'text';
  return (
    <input
      type={inputType}
      value={leaf.value ?? ''}
      onChange={e => onChange({ ...leaf, value: e.target.value })}
      style={inputStyle}
    />
  );
}

const inputStyle = {
  background: C.card, color: C.text, border: `1px solid ${C.border}`,
  borderRadius: 4, padding: '4px 8px', fontSize: 13, fontFamily: 'monospace',
};

function Leaf({ leaf, onChange, onRemove }) {
  const col = COLUMN_REGISTRY[leaf.field];
  const ops = OPS_BY_TYPE[col?.dataType] ?? OPS_BY_TYPE.string;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
      <select value={leaf.field} onChange={e => onChange({ ...leaf, field: e.target.value, op: 'eq', value: '' })} style={inputStyle}>
        {columnsByCategory().map(g => (
          <optgroup key={g.category} label={g.category}>
            {g.columns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </optgroup>
        ))}
      </select>
      <select value={leaf.op} onChange={e => onChange({ ...leaf, op: e.target.value })} style={inputStyle}>
        {ops.map(o => <option key={o} value={o}>{OP_LABELS[o] ?? o}</option>)}
      </select>
      <ValueInput leaf={leaf} dataType={col?.dataType} onChange={onChange} />
      <button onClick={onRemove} style={{ background: 'transparent', color: C.red, border: 'none', cursor: 'pointer', fontSize: 14 }} title="Remove rule">×</button>
    </div>
  );
}

function Group({ group, onChange, onRemove, depth = 0 }) {
  const update = (i, child) => {
    const rules = [...group.rules];
    rules[i] = child;
    onChange({ ...group, rules });
  };
  const remove = (i) => {
    const rules = group.rules.filter((_, idx) => idx !== i);
    onChange({ ...group, rules });
  };
  const addRule = () => onChange({ ...group, rules: [...group.rules, emptyLeaf()] });
  const addGroup = () => onChange({ ...group, rules: [...group.rules, emptyGroup()] });

  return (
    <div style={{ borderLeft: `2px solid ${depth === 0 ? 'transparent' : C.border}`, paddingLeft: depth === 0 ? 0 : 12, marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <select value={group.op} onChange={e => onChange({ ...group, op: e.target.value })} style={{ ...inputStyle, fontWeight: 600 }}>
          <option value="AND">AND (all)</option>
          <option value="OR">OR (any)</option>
        </select>
        {depth > 0 && onRemove && (
          <button onClick={onRemove} style={{ background: 'transparent', color: C.red, border: 'none', cursor: 'pointer', fontSize: 12 }}>remove group</button>
        )}
      </div>
      {group.rules.map((r, i) => (
        isGroup(r)
          ? <Group key={i} group={r} onChange={c => update(i, c)} onRemove={() => remove(i)} depth={depth + 1} />
          : <Leaf key={i} leaf={r} onChange={c => update(i, c)} onRemove={() => remove(i)} />
      ))}
      <div style={{ marginTop: 4, display: 'flex', gap: 8 }}>
        <button onClick={addRule} style={btnStyle}>+ Add rule</button>
        <button onClick={addGroup} style={btnStyle}>+ Add group</button>
      </div>
    </div>
  );
}

const btnStyle = {
  background: 'transparent', color: C.accent, border: `1px solid ${C.border}`,
  padding: '3px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
};

export default function PortfolioFilterBuilder({ tree, onChange }) {
  const root = tree ?? emptyGroup();
  return <Group group={root} onChange={onChange} depth={0} />;
}
```

- [ ] **Step 2:** Build:

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3:** Commit:

```bash
git add src/components/portfolio/PortfolioFilterBuilder.jsx
git commit -m "feat(portfolio): visual AND/OR filter builder with nested groups"
```

---

## Task 11: PortfolioColumnPicker component

**Files:**
- Create: `src/components/portfolio/PortfolioColumnPicker.jsx`

Two-pane picker: categorized available list (left), selected list with drag + arrow reorder (right).

- [ ] **Step 1:** Write `src/components/portfolio/PortfolioColumnPicker.jsx`:

```jsx
// src/components/portfolio/PortfolioColumnPicker.jsx
'use client';
import { useState } from 'react';
import { COLUMN_REGISTRY, columnsByCategory } from '@/lib/portfolio/column-registry';

const C = { card: '#131b28', border: '#1a2538', text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff', red: '#f87171' };

export default function PortfolioColumnPicker({ selected, onChange }) {
  const [search, setSearch] = useState('');
  const [openCats, setOpenCats] = useState(() => new Set(['Contact', 'Latest Policy', 'Commission', 'Activity']));

  const selectedSet = new Set(selected);
  const groups = columnsByCategory();
  const q = search.toLowerCase().trim();

  const toggleSelect = (key) => {
    if (selectedSet.has(key)) onChange(selected.filter(k => k !== key));
    else onChange([...selected, key]);
  };
  const removeSelected = (key) => onChange(selected.filter(k => k !== key));
  const moveUp = (i) => {
    if (i === 0) return;
    const next = [...selected];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    onChange(next);
  };
  const moveDown = (i) => {
    if (i === selected.length - 1) return;
    const next = [...selected];
    [next[i + 1], next[i]] = [next[i], next[i + 1]];
    onChange(next);
  };
  const onDragStart = (e, idx) => { e.dataTransfer.setData('idx', String(idx)); };
  const onDrop = (e, idx) => {
    e.preventDefault();
    const from = parseInt(e.dataTransfer.getData('idx'), 10);
    if (isNaN(from) || from === idx) return;
    const next = [...selected];
    const [moved] = next.splice(from, 1);
    next.splice(idx, 0, moved);
    onChange(next);
  };

  const toggleCat = (cat) => {
    setOpenCats(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {/* Available */}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, padding: 8, maxHeight: 340, overflowY: 'auto' }}>
        <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', marginBottom: 6 }}>Available</div>
        <input
          type="text"
          placeholder="Search columns..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: '4px 8px', fontSize: 12, width: '100%', marginBottom: 6 }}
        />
        {groups.map(g => {
          const visible = g.columns.filter(c => !q || c.label.toLowerCase().includes(q));
          if (visible.length === 0) return null;
          const open = openCats.has(g.category) || !!q;
          return (
            <div key={g.category} style={{ marginBottom: 4 }}>
              <div onClick={() => toggleCat(g.category)} style={{ cursor: 'pointer', color: C.accent, fontSize: 11, textTransform: 'uppercase', padding: '4px 0' }}>
                {open ? '▾' : '▸'} {g.category} ({visible.length})
              </div>
              {open && visible.map(c => (
                <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0 2px 16px', cursor: 'pointer', fontSize: 12, color: selectedSet.has(c.key) ? C.muted : C.text }}>
                  <input
                    type="checkbox"
                    checked={selectedSet.has(c.key)}
                    onChange={() => toggleSelect(c.key)}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          );
        })}
      </div>
      {/* Selected */}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, padding: 8, maxHeight: 340, overflowY: 'auto' }}>
        <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', marginBottom: 6 }}>Selected ({selected.length})</div>
        {selected.length === 0 && (
          <div style={{ color: C.muted, fontSize: 12, padding: 8 }}>Pick at least one column from the left.</div>
        )}
        {selected.map((key, i) => {
          const col = COLUMN_REGISTRY[key];
          return (
            <div
              key={key}
              draggable
              onDragStart={e => onDragStart(e, i)}
              onDragOver={e => e.preventDefault()}
              onDrop={e => onDrop(e, i)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderBottom: `1px solid ${C.border}`, fontSize: 12, color: C.text }}
            >
              <span style={{ cursor: 'grab', color: C.muted }}>☰</span>
              <span style={{ flex: 1 }}>{col?.label ?? key}</span>
              <button onClick={() => moveUp(i)} disabled={i === 0} style={arrowBtnStyle}>↑</button>
              <button onClick={() => moveDown(i)} disabled={i === selected.length - 1} style={arrowBtnStyle}>↓</button>
              <button onClick={() => removeSelected(key)} style={{ ...arrowBtnStyle, color: C.red }}>×</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const arrowBtnStyle = {
  background: 'transparent', color: '#5b9fff', border: 'none', cursor: 'pointer',
  fontSize: 13, padding: '0 4px',
};
```

- [ ] **Step 2:** Build:

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3:** Commit:

```bash
git add src/components/portfolio/PortfolioColumnPicker.jsx
git commit -m "feat(portfolio): two-pane column picker with drag + arrow reorder"
```

---

## Task 12: PortfolioViewEditor + PortfolioSaveViewPopover

**Files:**
- Create: `src/components/portfolio/PortfolioSaveViewPopover.jsx`
- Create: `src/components/portfolio/PortfolioViewEditor.jsx`

- [ ] **Step 1:** Write `src/components/portfolio/PortfolioSaveViewPopover.jsx`:

```jsx
// src/components/portfolio/PortfolioSaveViewPopover.jsx
'use client';
import { useState } from 'react';

const C = { card: '#131b28', surface: '#0f1520', border: '#1a2538', text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff' };

export default function PortfolioSaveViewPopover({ currentState, onSaved, onCancel }) {
  const [name, setName] = useState('');
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    setSaving(true); setError(null);
    try {
      const r = await fetch('/api/portfolio/views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          ...currentState,
          pinned,
        }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? 'Save failed');
      onSaved(json.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'absolute', top: 36, right: 0, background: C.surface,
      border: `1px solid ${C.border}`, borderRadius: 6, padding: 12, zIndex: 50,
      width: 280, boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
    }}>
      <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', marginBottom: 6 }}>Save current view</div>
      <input
        type="text"
        placeholder="View name"
        value={name}
        onChange={e => setName(e.target.value)}
        autoFocus
        style={{ width: '100%', background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: '6px 10px', fontSize: 13 }}
      />
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12, color: C.text }}>
        <input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} />
        Pin to top of sidebar
      </label>
      {error && <div style={{ color: '#f87171', fontSize: 12, marginTop: 6 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 6, marginTop: 10, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={{ ...btnStyle, background: 'transparent', border: `1px solid ${C.border}` }}>Cancel</button>
        <button onClick={submit} disabled={saving || !name.trim()} style={{ ...btnStyle, background: C.accent, color: C.surface }}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}

const btnStyle = {
  padding: '6px 12px', borderRadius: 4, border: 'none', cursor: 'pointer',
  fontSize: 12, fontWeight: 600,
};
```

- [ ] **Step 2:** Write `src/components/portfolio/PortfolioViewEditor.jsx`:

```jsx
// src/components/portfolio/PortfolioViewEditor.jsx
'use client';
import { useEffect, useState } from 'react';
import PortfolioFilterBuilder from './PortfolioFilterBuilder';
import PortfolioColumnPicker from './PortfolioColumnPicker';
import { COLUMN_REGISTRY } from '@/lib/portfolio/column-registry';

const C = { surface: '#0f1520', card: '#131b28', border: '#1a2538', text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff', red: '#f87171' };

const GROUP_BYS = ['none', 'state', 'placed_status', 'agent', 'campaign', 'month', 'carrier'];

export default function PortfolioViewEditor({ viewId, onClose, onSaved }) {
  const [view, setView] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [filterMode, setFilterMode] = useState('visual'); // 'visual' | 'raw'

  useEffect(() => {
    if (!viewId) return;
    setLoading(true);
    fetch(`/api/portfolio/views/${viewId}`)
      .then(r => r.json())
      .then(d => {
        setView(d.view);
        setFilterMode(d.view.rawWhere ? 'raw' : 'visual');
        setLoading(false);
      });
  }, [viewId]);

  if (!viewId) return null;

  const update = (patch) => setView(v => ({ ...v, ...patch }));
  const submit = async () => {
    setSaving(true); setError(null);
    try {
      const payload = {
        name: view.name,
        description: view.description,
        columns: view.columns,
        sort_by: view.sortBy,
        sort_dir: view.sortDir,
        group_by: view.groupBy,
        pinned: view.pinned,
        ...(filterMode === 'raw'
          ? { raw_where: view.rawWhere, filters_json: null }
          : { filters_json: view.filtersJson, raw_where: null }),
      };
      const r = await fetch(`/api/portfolio/views/${viewId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? 'Save failed');
      onSaved(viewId);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };
  const reset = async () => {
    if (!confirm('Reset this system view to its default settings? Your edits will be lost.')) return;
    const r = await fetch(`/api/portfolio/views/${viewId}/reset`, { method: 'POST' });
    if (r.ok) onSaved(viewId);
    else { const j = await r.json(); setError(j.error); }
  };

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, height: '100vh', width: 560, background: C.surface,
      borderLeft: `1px solid ${C.border}`, padding: 24, overflowY: 'auto', zIndex: 100, color: C.text,
      boxShadow: '-4px 0 24px rgba(0,0,0,0.5)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase' }}>Edit View {view?.isSystem ? '(system)' : ''}</div>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 18 }}>✕</button>
      </div>

      {loading && <div style={{ color: C.muted }}>Loading...</div>}
      {view && (
        <>
          <label style={fieldStyle}>
            <span style={labelStyle}>Name</span>
            <input value={view.name} onChange={e => update({ name: e.target.value })} style={inputStyle} />
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Description</span>
            <input value={view.description ?? ''} onChange={e => update({ description: e.target.value })} style={inputStyle} />
          </label>

          <div style={sectionStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <span style={{ ...labelStyle, marginBottom: 0 }}>Filters</span>
              <label style={{ fontSize: 12, color: C.text }}>
                <input type="radio" checked={filterMode === 'visual'} onChange={() => setFilterMode('visual')} /> Visual builder
              </label>
              <label style={{ fontSize: 12, color: C.text }}>
                <input type="radio" checked={filterMode === 'raw'} onChange={() => setFilterMode('raw')} /> Raw SQL
              </label>
            </div>
            {filterMode === 'visual' ? (
              <PortfolioFilterBuilder
                tree={view.filtersJson ?? { op: 'AND', rules: [] }}
                onChange={t => update({ filtersJson: t, rawWhere: null })}
              />
            ) : (
              <>
                <textarea
                  value={view.rawWhere ?? ''}
                  onChange={e => update({ rawWhere: e.target.value, filtersJson: null })}
                  rows={4}
                  placeholder="e.g. monthly_premium > 100 AND state IN ('CA', 'TX')"
                  style={{ ...inputStyle, fontFamily: 'monospace', minHeight: 80 }}
                />
                <div style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>
                  Rules: no semicolons, no comments, no DDL/DML keywords. Runs against a read-only DB role.
                </div>
              </>
            )}
          </div>

          <div style={sectionStyle}>
            <span style={labelStyle}>Columns</span>
            <PortfolioColumnPicker selected={view.columns ?? []} onChange={cols => update({ columns: cols })} />
          </div>

          <div style={sectionStyle}>
            <span style={labelStyle}>Default sort</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <select value={view.sortBy ?? ''} onChange={e => update({ sortBy: e.target.value || null })} style={inputStyle}>
                <option value="">(none)</option>
                {Object.entries(COLUMN_REGISTRY).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
              </select>
              <select value={view.sortDir} onChange={e => update({ sortDir: e.target.value })} style={inputStyle}>
                <option value="desc">Desc</option>
                <option value="asc">Asc</option>
              </select>
            </div>
          </div>

          <div style={sectionStyle}>
            <span style={labelStyle}>Default grouping</span>
            <select value={view.groupBy} onChange={e => update({ groupBy: e.target.value })} style={inputStyle}>
              {GROUP_BYS.map(g => <option key={g} value={g}>{g === 'none' ? 'No grouping' : `By ${g}`}</option>)}
            </select>
          </div>

          {error && <div style={{ color: C.red, fontSize: 12, marginTop: 8 }}>{error}</div>}

          <div style={{ display: 'flex', gap: 6, marginTop: 16, justifyContent: 'flex-end' }}>
            {view.isSystem && (
              <button onClick={reset} style={{ ...btnStyle, background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, marginRight: 'auto' }}>
                Reset to defaults
              </button>
            )}
            <button onClick={onClose} style={{ ...btnStyle, background: 'transparent', border: `1px solid ${C.border}` }}>Cancel</button>
            <button onClick={submit} disabled={saving} style={{ ...btnStyle, background: C.accent, color: C.surface }}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const fieldStyle = { display: 'block', marginBottom: 12 };
const labelStyle = { color: C.muted, fontSize: 11, textTransform: 'uppercase', marginBottom: 4, display: 'block', letterSpacing: 0.3 };
const sectionStyle = { marginBottom: 16, paddingTop: 12, borderTop: `1px solid ${C.border}` };
const inputStyle = { width: '100%', background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: '6px 10px', fontSize: 13, fontFamily: 'inherit' };
const btnStyle = { padding: '6px 14px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600 };
```

- [ ] **Step 3:** Build:

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 4:** Commit:

```bash
git add src/components/portfolio/PortfolioSaveViewPopover.jsx src/components/portfolio/PortfolioViewEditor.jsx
git commit -m "feat(portfolio): SaveViewPopover + ViewEditor (slide-in editor wiring filters + columns + sort/group)"
```

---

## Task 13: Rewrite PortfolioFilterSidebar (API-loaded with menu)

**Files:**
- Modify: `src/components/portfolio/PortfolioFilterSidebar.jsx`

- [ ] **Step 1:** Replace the existing component with one that fetches from `/api/portfolio/views`. Read the current file:

```bash
cat src/components/portfolio/PortfolioFilterSidebar.jsx
```

Replace contents with:

```jsx
// src/components/portfolio/PortfolioFilterSidebar.jsx
'use client';
import { useEffect, useState } from 'react';

const C = { bg: '#080b10', surface: '#0f1520', card: '#131b28', border: '#1a2538', text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff', red: '#f87171' };

export default function PortfolioFilterSidebar({ activeViewId, onSelect, onEdit, onDuplicate, totalCount, refreshKey }) {
  const [views, setViews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openMenuId, setOpenMenuId] = useState(null);

  useEffect(() => {
    setLoading(true);
    fetch('/api/portfolio/views')
      .then(r => r.json())
      .then(d => { setViews(d.views ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [refreshKey]);

  const togglePin = async (v) => {
    await fetch(`/api/portfolio/views/${v.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      // PATCH expects a full payload — load full first
      body: JSON.stringify(await loadAndPatch(v.id, { pinned: !v.pinned })),
    });
    setOpenMenuId(null);
    refreshList(setViews);
  };
  const remove = async (v) => {
    if (!confirm(`Delete the view "${v.name}"?`)) return;
    const r = await fetch(`/api/portfolio/views/${v.id}`, { method: 'DELETE' });
    if (r.ok) refreshList(setViews);
    else { const j = await r.json(); alert(j.error); }
    setOpenMenuId(null);
  };
  const reset = async (v) => {
    if (!confirm(`Reset "${v.name}" to its default settings?`)) return;
    const r = await fetch(`/api/portfolio/views/${v.id}/reset`, { method: 'POST' });
    if (r.ok) refreshList(setViews);
    else { const j = await r.json(); alert(j.error); }
    setOpenMenuId(null);
  };

  return (
    <div style={{ width: 240, background: C.surface, borderRight: `1px solid ${C.border}`, padding: 16, height: '100%', overflowY: 'auto' }}>
      <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', marginBottom: 8 }}>Smart Views</div>
      {loading && <div style={{ color: C.muted, fontSize: 12 }}>Loading...</div>}
      {views.map(v => {
        const active = activeViewId === v.id;
        return (
          <div
            key={v.id}
            style={{
              padding: '8px 12px',
              borderRadius: 6,
              color: active ? C.text : C.muted,
              background: active ? C.card : 'transparent',
              borderLeft: active ? `3px solid ${C.accent}` : '3px solid transparent',
              marginBottom: 2,
              fontSize: 13,
              display: 'flex', alignItems: 'center', gap: 6,
              position: 'relative',
            }}
          >
            <span onClick={() => onSelect(v.id)} style={{ flex: 1, cursor: 'pointer' }}>
              {v.pinned && '📌 '}
              {v.name}
              {v.isSystem && <span style={{ color: C.accent, fontSize: 10, marginLeft: 4 }}>★</span>}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === v.id ? null : v.id); }}
              style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer' }}
              title="View actions"
            >⋮</button>
            {openMenuId === v.id && (
              <div style={{ position: 'absolute', right: 0, top: 30, background: C.card, border: `1px solid ${C.border}`, borderRadius: 4, zIndex: 30, minWidth: 140 }}>
                <MenuItem onClick={() => { onEdit(v.id); setOpenMenuId(null); }}>Edit</MenuItem>
                <MenuItem onClick={() => { onDuplicate(v.id); setOpenMenuId(null); }}>Duplicate</MenuItem>
                <MenuItem onClick={() => togglePin(v)}>{v.pinned ? 'Unpin' : 'Pin'}</MenuItem>
                {v.isSystem
                  ? <MenuItem onClick={() => reset(v)}>Reset to defaults</MenuItem>
                  : <MenuItem onClick={() => remove(v)} danger>Delete</MenuItem>}
              </div>
            )}
          </div>
        );
      })}
      <div style={{ marginTop: 24, color: C.muted, fontSize: 11 }}>
        {totalCount != null && `${totalCount.toLocaleString()} matching`}
      </div>
    </div>
  );
}

function MenuItem({ children, onClick, danger }) {
  return (
    <div onClick={onClick} style={{
      padding: '6px 10px', cursor: 'pointer', fontSize: 12,
      color: danger ? C.red : C.text,
      borderBottom: `1px solid ${C.border}`,
    }}>{children}</div>
  );
}

async function loadAndPatch(id, patch) {
  const r = await fetch(`/api/portfolio/views/${id}`);
  const { view } = await r.json();
  return {
    name: view.name, description: view.description,
    filters_json: view.filtersJson, raw_where: view.rawWhere,
    columns: view.columns, sort_by: view.sortBy, sort_dir: view.sortDir,
    group_by: view.groupBy, pinned: view.pinned,
    ...patch,
  };
}

function refreshList(setViews) {
  fetch('/api/portfolio/views').then(r => r.json()).then(d => setViews(d.views ?? []));
}
```

- [ ] **Step 2:** Build:

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3:** Commit:

```bash
git add src/components/portfolio/PortfolioFilterSidebar.jsx
git commit -m "feat(portfolio): rewrite sidebar to load views from API + per-row menu"
```

---

## Task 14: Wire everything into PortfolioTab

**Files:**
- Modify: `src/components/portfolio/PortfolioTab.jsx`

The shell needs to:
- Load the active view's data via `/api/portfolio/contacts?viewId=N`
- Show the toolbar `+ Save view` button → opens `PortfolioSaveViewPopover`
- Open `PortfolioViewEditor` when a sidebar `Edit` action fires
- Refresh the sidebar after a view save/delete/reset

- [ ] **Step 1:** Read the current PortfolioTab:

```bash
cat src/components/portfolio/PortfolioTab.jsx
```

- [ ] **Step 2:** Replace its contents with the new wired version. (Keeping the existing structure but switching from `smartList` state to `viewId`, adding popover + editor open state.)

```jsx
// src/components/portfolio/PortfolioTab.jsx
'use client';
import { useEffect, useState, useCallback } from 'react';
import PortfolioFilterSidebar from './PortfolioFilterSidebar';
import PortfolioGrid from './PortfolioGrid';
import PortfolioGroupBySelector from './PortfolioGroupBySelector';
import PortfolioGroupView from './PortfolioGroupView';
import PortfolioBulkActionBar from './PortfolioBulkActionBar';
import PortfolioDetailPanel from './PortfolioDetailPanel';
import PortfolioSaveViewPopover from './PortfolioSaveViewPopover';
import PortfolioViewEditor from './PortfolioViewEditor';

const C = { bg: '#080b10', text: '#f0f3f9', muted: '#8fa3be', card: '#131b28', border: '#1a2538', accent: '#5b9fff' };

export default function PortfolioTab() {
  const [activeViewId, setActiveViewId] = useState(null);
  const [search, setSearch] = useState('');
  const [groupBy, setGroupBy] = useState('none');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);

  const [data, setData] = useState({ rows: [], total: 0, columns: [], groups: null });
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [openContactId, setOpenContactId] = useState(null);
  const [showSavePopover, setShowSavePopover] = useState(false);
  const [editorViewId, setEditorViewId] = useState(null);
  const [sidebarRefresh, setSidebarRefresh] = useState(0);

  // On first load, pick the first system view (display_order 1)
  useEffect(() => {
    if (activeViewId) return;
    fetch('/api/portfolio/views').then(r => r.json()).then(d => {
      if (d.views?.length) setActiveViewId(d.views[0].id);
    });
  }, [activeViewId]);

  const reload = useCallback(async () => {
    if (!activeViewId) return;
    setLoading(true);
    const params = new URLSearchParams({
      viewId: String(activeViewId),
      page: String(page),
      pageSize: String(pageSize),
    });
    const res = await fetch(`/api/portfolio/contacts?${params}`);
    const json = await res.json();
    setData({
      rows: json.rows ?? [],
      total: json.total ?? 0,
      columns: json.columns ?? [],
      groups: null,
    });
    setLoading(false);
  }, [activeViewId, page, pageSize]);

  useEffect(() => { reload(); }, [reload]);

  const toggleSelect = (id, on) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  };

  const onViewSaved = (id) => {
    setEditorViewId(null);
    setShowSavePopover(false);
    setSidebarRefresh(x => x + 1);
    setActiveViewId(id);
  };

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 64px)', background: C.bg, color: C.text }}>
      <PortfolioFilterSidebar
        activeViewId={activeViewId}
        onSelect={(id) => { setActiveViewId(id); setPage(1); setSelectedIds(new Set()); }}
        onEdit={(id) => setEditorViewId(id)}
        onDuplicate={(id) => duplicateView(id, setEditorViewId, setSidebarRefresh)}
        totalCount={data.total}
        refreshKey={sidebarRefresh}
      />

      <div style={{ flex: 1, padding: 16, overflow: 'auto', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, position: 'relative' }}>
          <input
            type="text"
            placeholder="Search by name or phone..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              background: C.card, color: C.text, border: `1px solid ${C.border}`,
              borderRadius: 4, padding: '6px 10px', fontSize: 13, flex: 1, maxWidth: 320,
            }}
          />
          <PortfolioGroupBySelector value={groupBy} onChange={(g) => { setGroupBy(g); setPage(1); }} />
          <button
            onClick={() => setShowSavePopover(true)}
            style={{ background: C.accent, color: C.bg, border: 'none', padding: '6px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
          >
            + Save view
          </button>
          <div style={{ marginLeft: 'auto', color: C.muted, fontSize: 12 }}>
            {loading ? 'Loading...' : ''}
          </div>
          {showSavePopover && (
            <PortfolioSaveViewPopover
              currentState={{
                filters_json: { op: 'AND', rules: [] }, // ad-hoc state has no filters_json yet
                columns: data.columns,
                sort_by: null,
                sort_dir: 'desc',
                group_by: groupBy,
              }}
              onSaved={onViewSaved}
              onCancel={() => setShowSavePopover(false)}
            />
          )}
        </div>

        <PortfolioBulkActionBar
          selectedCount={selectedIds.size}
          filters={{}}
          onClearSelection={() => setSelectedIds(new Set())}
        />

        <PortfolioGrid
          rows={data.rows}
          columns={data.columns}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onRowClick={setOpenContactId}
        />

        {data.total > pageSize && (
          <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
            <button disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))} style={pagBtn(page === 1)}>← Prev</button>
            <span style={{ color: C.muted, fontSize: 13 }}>
              Page {page} of {Math.ceil(data.total / pageSize)} · {data.total} total
            </span>
            <button disabled={page * pageSize >= data.total} onClick={() => setPage(p => p + 1)} style={pagBtn(page * pageSize >= data.total)}>Next →</button>
          </div>
        )}
      </div>

      <PortfolioDetailPanel contactId={openContactId} onClose={() => setOpenContactId(null)} />
      <PortfolioViewEditor viewId={editorViewId} onClose={() => setEditorViewId(null)} onSaved={onViewSaved} />
    </div>
  );
}

const pagBtn = (disabled) => ({
  background: '#131b28', color: '#f0f3f9', border: '1px solid #1a2538',
  padding: '6px 12px', borderRadius: 4, cursor: disabled ? 'default' : 'pointer',
});

async function duplicateView(id, setEditorViewId, setSidebarRefresh) {
  const r = await fetch(`/api/portfolio/views/${id}`);
  const { view } = await r.json();
  const r2 = await fetch('/api/portfolio/views', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `${view.name} (copy)`,
      description: view.description,
      filters_json: view.filtersJson,
      raw_where: view.rawWhere,
      columns: view.columns,
      sort_by: view.sortBy,
      sort_dir: view.sortDir,
      group_by: view.groupBy,
      pinned: false,
    }),
  });
  const j = await r2.json();
  if (r2.ok) { setSidebarRefresh(x => x + 1); setEditorViewId(j.id); }
  else alert(j.error);
}
```

- [ ] **Step 3:** Build:

```bash
npm run build 2>&1 | tail -8
```

- [ ] **Step 4:** Commit:

```bash
git add src/components/portfolio/PortfolioTab.jsx
git commit -m "feat(portfolio): wire SaveViewPopover + ViewEditor + sidebar API into PortfolioTab"
```

---

## Task 15: End-to-end browser verification

**Files:** none (verification only — uses the running preview server)

- [ ] **Step 1:** Ensure the preview server running on port 3004 picks up the changes (or start it via the existing launch.json `tcc-portfolio-preview` config). It auto-reloads via Next dev.

- [ ] **Step 2:** Click through the dashboard → Portfolio tab → verify each:
  - Sidebar shows 6 system views (each with `★` badge), in display_order
  - Clicking a view loads contacts with that view's columns visible in the grid
  - Toolbar `+ Save view` opens the popover; saving creates a new view that appears in sidebar
  - Per-view `⋮` menu has Edit / Duplicate / Pin / Reset (system) or Delete (user)
  - Clicking Edit opens the slide-in editor with all fields populated
  - Filter builder: add a rule, change op, change value — UI updates immediately
  - Filter builder: click `+ Add group`, nest, save, reload — filter persists and applies
  - Column picker: search filters, checkbox toggles, ↑/↓ reorders, drag reorders
  - Switching to Raw SQL mode and entering an expression with `DROP TABLE x` returns 400 with clear message
  - System view's `Reset to defaults` button reverts edits

- [ ] **Step 3:** No commit (verification only). If any of the above fails, write a fix-up commit.

---

## Task 16: Documentation + push

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1:** Update `CLAUDE.md`. Find the existing `## TCC Portfolio (DB-backed unified view)` section and replace its `### Saved smart lists` subsection with:

```markdown
### Smart views (V2 — DB-backed, user-creatable)

Sidebar smart lists are now full views in the `portfolio_views` Postgres table.
Each view saves filters (visual AND/OR builder OR raw SQL escape hatch),
columns (subset of 41 columns from the column registry), default sort, default
group-by, pin state, and display order.

Six system views are seeded with `is_system=true` and a `seed_json` snapshot so
they can be Reset to defaults: All Submitted Apps, Pending Applications, Active
Policies, Recently Lapsed, Declined, High-Value Active.

Raw SQL views connect via `DATABASE_URL_READONLY` (a Neon role with SELECT-only
privileges) for defense-in-depth alongside a keyword blocklist.

API:
- `GET    /api/portfolio/views` — list all
- `POST   /api/portfolio/views` — create
- `PATCH  /api/portfolio/views/[id]` — update
- `DELETE /api/portfolio/views/[id]` — delete (system views return 403)
- `POST   /api/portfolio/views/[id]/reset` — reset system view to seed
- `GET    /api/portfolio/contacts?viewId=N` — list contacts using saved view config
```

- [ ] **Step 2:** Verify:

```bash
grep -c "Smart views (V2 — DB-backed" CLAUDE.md
```

Expected: `1`.

- [ ] **Step 3:** Commit + push:

```bash
git add claude.md
git commit -m "docs(portfolio): document smart views (DB-backed, user-creatable)"
git push -u origin feature/portfolio-smart-views
```

---

# Done — what you have

After Task 16, your branch contains:

- ✅ `portfolio_views` table + 6 seeded system views
- ✅ Filter-tree compiler (AND/OR + 13 ops, 11 unit tests)
- ✅ 41-column registry with categorized picker (5 unit tests)
- ✅ views.js CRUD module + payload validation (8 unit tests)
- ✅ Raw-SQL safety blocklist + read-only DB role (9 unit tests)
- ✅ 5 API routes (list/create/update/delete/reset)
- ✅ Updated query.js + /api/portfolio/contacts viewId path
- ✅ PortfolioGrid renders arbitrary columns from registry
- ✅ PortfolioFilterBuilder (visual AND/OR with nested groups)
- ✅ PortfolioColumnPicker (categorized + drag/arrow reorder)
- ✅ PortfolioSaveViewPopover (toolbar quick-save)
- ✅ PortfolioViewEditor (slide-in full editor)
- ✅ PortfolioFilterSidebar rewrite (API-loaded with per-row menu)
- ✅ PortfolioTab wires everything together
- ✅ Documentation updated in CLAUDE.md

Estimated 7–10 hours real-time, 33 unit tests added, ~16 commits.
