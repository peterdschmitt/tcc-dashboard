# Commission Statement Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a three-level browseable view of carrier commission statement data (master holder → per-statement period → raw line items), backed by two new precomputed sheet tabs, with a globally-mounted slide-out drawer reachable from all six commission tables.

**Architecture:** Pure rollup library (testable with `node --test`) + I/O composer that idempotently overwrites two new sheet tabs (`Statement Records — Holders` and `Statement Records — Periods`) from the existing `Commission Ledger`. Five new read/write API routes. New master sub-view inside `CommissionStatementsTab`. New `StatementRecordDrawer` mounted at the `Dashboard.jsx` top level via React context, opened from a small `📄` button added to all six commission-related tables. Rebuild fires after every ledger-mutating route plus a defensive 02:00 daily cron.

**Tech Stack:** Next.js 14 App Router, googleapis sheets v4, React 18, Node `node:test` (built-in, zero new deps).

**Spec:** [docs/superpowers/specs/2026-04-26-commission-statement-records-design.md](../specs/2026-04-26-commission-statement-records-design.md)

---

## File Map

**New files:**
- `src/lib/statement-records.js` — pure functions (no side effects, no imports). Header constants, `buildHolderKey`, `groupLedgerByHolder`, `buildHolderRow`, `buildPeriodRows`, `VARIANCE_THRESHOLDS`, `deriveStatus`.
- `src/lib/statement-records-io.js` — sheet I/O. Imports pure lib + sheets. Exports `ensureStatementRecordTabs`, `rebuildStatementRecords`.
- `src/lib/statement-records.test.mjs` — `node:test` unit tests for the pure lib.
- `src/lib/package.json` — `{"type": "module"}` so Node can load `src/lib/*.js` as ESM during tests.
- `src/app/api/statement-records/init/route.js`
- `src/app/api/statement-records/rebuild/route.js`
- `src/app/api/statement-records/route.js` — GET list
- `src/app/api/statement-records/[holderKey]/route.js`
- `src/app/api/statement-records/lines/route.js`
- `src/app/api/cron/rebuild-statement-records/route.js`
- `src/components/StatementRecordDrawer.jsx`
- `src/contexts/StatementRecordDrawerContext.jsx` — provider + `useStatementRecordDrawer` hook.
- `src/components/HolderRecordsView.jsx` — the master sub-view rendered inside `CommissionStatementsTab`.

**Modified files:**
- `src/components/Dashboard.jsx` — mount `StatementRecordDrawerProvider` + `<StatementRecordDrawer />` at the top of the rendered tree, add `📄` button to the Daily Activity drill-down policy table.
- `src/components/tabs/CommissionStatementsTab.jsx` — add `Holder Records` as the first sub-tab pill.
- `src/components/CommissionStatusTable.jsx` — add `📄` column.
- `src/components/tabs/CommissionReconciliationTab.jsx` — add `📄` column.
- `src/components/PeriodRevenueTable.jsx` — add `📄` column.
- `src/components/CarrierBalancesTable.jsx` — add `📄` column.
- `src/components/tabs/CombinedPoliciesTab.jsx` — add `📄` column.
- `src/app/api/commission-statements/upload/route.js` — call `rebuildStatementRecords()` after ledger write.
- `src/app/api/commission-statements/sync-drive/route.js` — call after batch.
- `src/app/api/commission-statements/dedup/route.js` — call after writes.
- `src/app/api/commission-statements/approve/route.js` — call after writes.
- `src/app/api/commission-statements/rematch/route.js` — call after writes.
- `package.json` — add `"test": "node --test src/lib/*.test.mjs"`.
- `.env.local` — document new optional vars `STATEMENT_HOLDERS_TAB`, `STATEMENT_PERIODS_TAB`.

---

## Task 1: Test infrastructure

**Files:**
- Create: `src/lib/package.json`
- Modify: `package.json`

- [ ] **Step 1: Create nested package.json so Node treats `src/lib/*.js` as ESM during tests**

```bash
cat > src/lib/package.json <<'EOF'
{
  "type": "module"
}
EOF
```

- [ ] **Step 2: Add `test` script to root package.json**

In `package.json`, add to the `scripts` block (between `"start"` and the closing brace):

```json
    "test": "node --test src/lib/*.test.mjs"
```

- [ ] **Step 3: Verify the test script invocation parses (no test files yet, exits non-zero is fine)**

Run: `npm test`
Expected: `no test files found` or similar — confirms the runner is wired.

- [ ] **Step 4: Commit**

```bash
git add src/lib/package.json package.json
git commit -m "chore(test): wire node --test for src/lib pure-function unit tests"
```

---

## Task 2: Library — constants, headers, env

**Files:**
- Create: `src/lib/statement-records.js`

- [ ] **Step 1: Create the pure library file with constants and headers**

```js
// Pure functions only — no imports, no side effects. Safe to load with node --test.

export const STATEMENT_HOLDERS_TAB = process.env.STATEMENT_HOLDERS_TAB || 'Statement Records — Holders';
export const STATEMENT_PERIODS_TAB = process.env.STATEMENT_PERIODS_TAB || 'Statement Records — Periods';

export const HOLDERS_HEADERS = [
  'Holder Key', 'Insured Name', 'Policies', 'Policy Count', 'Carriers',
  'Statement Count', 'First Period', 'Last Period',
  'Total Advances', 'Total Commissions', 'Total Chargebacks', 'Total Recoveries',
  'Net Total', 'Outstanding Balance', 'Expected Net', 'Variance',
  'Agents', 'Status', 'Last Rebuilt',
];

export const PERIODS_HEADERS = [
  'Row Key', 'Holder Key', 'Insured Name', 'Policy #', 'Carrier',
  'Statement Period', 'Statement Date', 'Statement File', 'Statement File ID',
  'Premium', 'Advance Amount', 'Commission Amount', 'Chargeback Amount', 'Recovery Amount',
  'Net Impact', 'Outstanding Balance', 'Line Item Count', 'Notes',
];

// Variance status thresholds in dollars. Tune as needed.
export const VARIANCE_THRESHOLDS = { green: 10, yellow: 50 };

// Suffixes stripped during name normalization.
const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/statement-records.js
git commit -m "feat(statement-records): add pure library scaffold with headers and constants"
```

---

## Task 3: Library — `buildHolderKey` (TDD)

**Files:**
- Create: `src/lib/statement-records.test.mjs`
- Modify: `src/lib/statement-records.js`

- [ ] **Step 1: Write the failing test**

Create `src/lib/statement-records.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHolderKey } from './statement-records.js';

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
```

- [ ] **Step 2: Run test, confirm failure**

Run: `npm test`
Expected: tests fail with `buildHolderKey is not a function` or similar.

- [ ] **Step 3: Implement `buildHolderKey` in the lib**

Append to `src/lib/statement-records.js`:

```js
function normalizeNamePart(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')   // strip punctuation including apostrophes, hyphens, periods
    .trim()
    .split(/\s+/)
    .filter(tok => tok.length > 1 && !NAME_SUFFIXES.has(tok))  // drop initials (single chars) and suffixes
    .join('');
}

export function buildHolderKey(firstName, lastName) {
  const first = normalizeNamePart(firstName);
  const last = normalizeNamePart(lastName);
  return `${last}|${first}`;
}
```

- [ ] **Step 4: Run tests, confirm all pass**

Run: `npm test`
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/statement-records.js src/lib/statement-records.test.mjs
git commit -m "feat(statement-records): buildHolderKey with name normalization (test+impl)"
```

---

## Task 4: Library — `groupLedgerByHolder` (TDD)

**Files:**
- Modify: `src/lib/statement-records.js`
- Modify: `src/lib/statement-records.test.mjs`

- [ ] **Step 1: Write failing tests**

Append to `src/lib/statement-records.test.mjs`:

```js
import { groupLedgerByHolder } from './statement-records.js';

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
```

- [ ] **Step 2: Run tests, confirm failure**

Run: `npm test`
Expected: 4 new tests fail.

- [ ] **Step 3: Implement `groupLedgerByHolder`**

Append to `src/lib/statement-records.js`:

```js
function splitInsuredName(insuredName) {
  const s = String(insuredName || '').trim();
  if (!s) return { first: '', last: '' };
  if (s.includes(',')) {
    const [last, first] = s.split(',').map(p => p.trim());
    return { first: first || '', last: last || '' };
  }
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { first: '', last: parts[0] };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

export function groupLedgerByHolder(ledgerRows) {
  const map = new Map();
  for (const row of ledgerRows) {
    const { first, last } = splitInsuredName(row.insuredName);
    const key = buildHolderKey(first, last);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npm test`
Expected: 11 tests total pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/statement-records.js src/lib/statement-records.test.mjs
git commit -m "feat(statement-records): groupLedgerByHolder with name parsing"
```

---

## Task 5: Library — `buildHolderRow` (TDD)

**Files:**
- Modify: `src/lib/statement-records.js`
- Modify: `src/lib/statement-records.test.mjs`

- [ ] **Step 1: Write failing tests**

Append to `src/lib/statement-records.test.mjs`:

```js
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
```

- [ ] **Step 2: Run tests, confirm failure**

Run: `npm test`
Expected: 11 new tests fail with undefined function errors.

- [ ] **Step 3: Implement `buildHolderRow` and `deriveStatus`**

Append to `src/lib/statement-records.js`:

```js
function periodFromDate(d) {
  const s = String(d || '');
  // ISO date: YYYY-MM-DD → YYYY-MM
  const m = s.match(/^(\d{4})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}`;
  // US date: M/D/YYYY → YYYY-MM
  const u = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (u) return `${u[3]}-${u[1].padStart(2, '0')}`;
  return '';
}

function expectedNetForSalesRow(sr) {
  const premium = parseFloat(sr['Monthly Premium']) || 0;
  const cpp = String(sr['Carrier + Product + Payout'] || '').toLowerCase();
  const multiplier = cpp.includes('giwl') ? 1.5 : 3;
  return premium * multiplier;
}

export function deriveStatus({ chargebacks, outstanding, variance, hasMatch }) {
  if (!hasMatch) return 'unmatched';
  if (chargebacks > 0) return 'chargeback';
  if (outstanding > 0) return 'outstanding';
  if (Math.abs(variance) > VARIANCE_THRESHOLDS.yellow) return 'variance';
  return 'healthy';
}

export function buildHolderRow(holderKey, ledgerRows, salesRows, lastRebuiltIso) {
  const insuredName = ledgerRows[0]?.insuredName || '';
  const policies = [...new Set(ledgerRows.map(r => r.policyNumber).filter(Boolean))];
  const carriers = [...new Set(ledgerRows.map(r => r.carrier).filter(Boolean))];
  const statementFiles = [...new Set(ledgerRows.map(r => r.statementFile).filter(Boolean))];
  const periods = ledgerRows.map(r => periodFromDate(r.statementDate)).filter(Boolean).sort();

  const totalAdvances = ledgerRows.reduce((s, r) => s + (parseFloat(r.advanceAmount) || 0), 0);
  const totalCommissions = ledgerRows.reduce((s, r) => s + (parseFloat(r.commissionAmount) || 0), 0);
  const totalChargebacks = ledgerRows.reduce((s, r) => s + (parseFloat(r.chargebackAmount) || 0), 0);
  const totalRecoveries = ledgerRows.reduce((s, r) => s + (parseFloat(r.recoveryAmount) || 0), 0);
  const netTotal = totalAdvances + totalCommissions - totalChargebacks + totalRecoveries;

  // Outstanding balance from the most recent ledger row (by statementDate desc).
  const sortedDesc = [...ledgerRows].sort((a, b) => String(b.statementDate || '').localeCompare(String(a.statementDate || '')));
  const outstandingBalance = parseFloat(sortedDesc[0]?.outstandingBalance) || 0;

  const hasMatch = salesRows.length > 0;
  const expectedNet = hasMatch ? salesRows.reduce((s, sr) => s + expectedNetForSalesRow(sr), 0) : '';
  const variance = hasMatch ? netTotal - expectedNet : '';
  const agents = hasMatch ? [...new Set(salesRows.map(sr => sr['Agent']).filter(Boolean))].join(', ') : '';

  const status = deriveStatus({
    chargebacks: totalChargebacks,
    outstanding: outstandingBalance,
    variance: typeof variance === 'number' ? variance : 0,
    hasMatch,
  });

  return {
    'Holder Key': holderKey,
    'Insured Name': insuredName,
    'Policies': policies.join(', '),
    'Policy Count': policies.length,
    'Carriers': carriers.join(', '),
    'Statement Count': statementFiles.length,
    'First Period': periods[0] || '',
    'Last Period': periods[periods.length - 1] || '',
    'Total Advances': totalAdvances,
    'Total Commissions': totalCommissions,
    'Total Chargebacks': totalChargebacks,
    'Total Recoveries': totalRecoveries,
    'Net Total': netTotal,
    'Outstanding Balance': outstandingBalance,
    'Expected Net': expectedNet,
    'Variance': variance,
    'Agents': agents,
    'Status': status,
    'Last Rebuilt': lastRebuiltIso,
  };
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npm test`
Expected: 22 tests total pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/statement-records.js src/lib/statement-records.test.mjs
git commit -m "feat(statement-records): buildHolderRow with variance + status derivation"
```

---

## Task 6: Library — `buildPeriodRows` (TDD)

**Files:**
- Modify: `src/lib/statement-records.js`
- Modify: `src/lib/statement-records.test.mjs`

- [ ] **Step 1: Write failing tests**

Append to `src/lib/statement-records.test.mjs`:

```js
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
```

- [ ] **Step 2: Run tests, confirm failure**

Run: `npm test`
Expected: 6 new tests fail with `buildPeriodRows is not a function`.

- [ ] **Step 3: Implement `buildPeriodRows`**

Append to `src/lib/statement-records.js`:

```js
export function buildPeriodRows(holderKey, ledgerRows) {
  // Group ledger rows by (statementFile, policyNumber).
  const groups = new Map();
  for (const r of ledgerRows) {
    const file = r.statementFile || '';
    const policy = r.policyNumber || '';
    const key = `${file}||${policy}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const rows = [];
  for (const [, lines] of groups) {
    const sample = lines[0];
    const last = lines[lines.length - 1];
    const sum = (field) => lines.reduce((s, l) => s + (parseFloat(l[field]) || 0), 0);
    const advance = sum('advanceAmount');
    const commission = sum('commissionAmount');
    const chargeback = sum('chargebackAmount');
    const recovery = sum('recoveryAmount');
    const noteList = [...new Set(lines.map(l => String(l.notes || '').trim()).filter(Boolean))];

    rows.push({
      'Row Key': `${holderKey}|${sample.statementFile || ''}|${sample.policyNumber || ''}`,
      'Holder Key': holderKey,
      'Insured Name': sample.insuredName || '',
      'Policy #': sample.policyNumber || '',
      'Carrier': sample.carrier || '',
      'Statement Period': periodFromDate(sample.statementDate),
      'Statement Date': sample.statementDate || '',
      'Statement File': sample.statementFile || '',
      'Statement File ID': sample.statementFileId || '',
      'Premium': sum('premium'),
      'Advance Amount': advance,
      'Commission Amount': commission,
      'Chargeback Amount': chargeback,
      'Recovery Amount': recovery,
      'Net Impact': advance + commission - chargeback + recovery,
      'Outstanding Balance': parseFloat(last.outstandingBalance) || 0,
      'Line Item Count': lines.length,
      'Notes': noteList.join('; '),
    });
  }
  return rows;
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npm test`
Expected: 28 tests total pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/statement-records.js src/lib/statement-records.test.mjs
git commit -m "feat(statement-records): buildPeriodRows collapses multi-line statements per (file × policy)"
```

---

## Task 7: I/O — `ensureStatementRecordTabs`

**Files:**
- Create: `src/lib/statement-records-io.js`

- [ ] **Step 1: Create the I/O file with the ensure function**

```js
import { ensureTabExists, fetchSheet, getSheetsClient, invalidateCache } from './sheets';
import {
  STATEMENT_HOLDERS_TAB, STATEMENT_PERIODS_TAB,
  HOLDERS_HEADERS, PERIODS_HEADERS,
  buildHolderKey, groupLedgerByHolder, buildHolderRow, buildPeriodRows,
} from './statement-records.js';

const SALES_SHEET_ID_KEY = 'SALES_SHEET_ID';
const LEDGER_TAB_KEY = 'COMMISSION_LEDGER_TAB';

export async function ensureStatementRecordTabs() {
  const sheetId = process.env[SALES_SHEET_ID_KEY];
  if (!sheetId) throw new Error(`${SALES_SHEET_ID_KEY} env var is required`);
  await ensureTabExists(sheetId, STATEMENT_HOLDERS_TAB, HOLDERS_HEADERS);
  await ensureTabExists(sheetId, STATEMENT_PERIODS_TAB, PERIODS_HEADERS);
  return { tabs: [STATEMENT_HOLDERS_TAB, STATEMENT_PERIODS_TAB] };
}
```

- [ ] **Step 2: Verify import resolution by running a quick syntax check**

Run: `node --check src/lib/statement-records-io.js`
Expected: no output (syntax OK).

- [ ] **Step 3: Commit**

```bash
git add src/lib/statement-records-io.js
git commit -m "feat(statement-records): ensureStatementRecordTabs creates Holders + Periods tabs"
```

---

## Task 8: I/O — `rebuildStatementRecords` composer

**Files:**
- Modify: `src/lib/statement-records-io.js`

- [ ] **Step 1: Add the rebuild composer**

Append to `src/lib/statement-records-io.js`:

```js
// Match the existing /api/commission-statements GET projection so we share the same shape.
function projectLedgerRow(r) {
  return {
    insuredName: r['Insured Name'] || '',
    policyNumber: (r['Matched Policy #'] || r['Policy #'] || '').trim(),
    carrier: r['Carrier'] || '',
    statementDate: r['Statement Date'] || '',
    statementFile: r['Statement File'] || '',
    statementFileId: r['Statement File ID'] || '',
    premium: parseFloat(r['Premium']) || 0,
    advanceAmount: parseFloat(r['Advance Amount']) || 0,
    commissionAmount: parseFloat(r['Commission Amount']) || 0,
    chargebackAmount: parseFloat(r['Chargeback Amount']) || 0,
    recoveryAmount: parseFloat(r['Recovery Amount']) || 0,
    outstandingBalance: parseFloat(r['Outstanding Balance']) || 0,
    netImpact: parseFloat(r['Net Impact']) || 0,
    agent: r['Agent'] || '',
    notes: r['Notes'] || '',
  };
}

function projectSalesRow(sr) {
  return {
    firstName: sr['First Name'] || '',
    lastName: sr['Last Name'] || '',
    'Policy #': sr['Policy #'] || '',
    'Carrier + Product + Payout': sr['Carrier + Product + Payout'] || '',
    'Monthly Premium': sr['Monthly Premium'] || '0',
    'Agent': sr['Agent'] || '',
  };
}

async function overwriteTab(sheetId, tabName, headers, rows) {
  // Two-step: clear data range (keep header row), then bulk-write all rows in one batchUpdate.
  const sheets = await getSheetsClient();
  // Clear everything below the header row (row 2 onward, all columns).
  await sheets.spreadsheets.values.clear({
    spreadsheetId: sheetId,
    range: `'${tabName}'!A2:ZZ`,
  });
  if (rows.length === 0) {
    invalidateCache(sheetId, tabName);
    return;
  }
  const values = rows.map(row => headers.map(h => {
    const v = row[h];
    if (v === null || v === undefined) return '';
    return v;
  }));
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `'${tabName}'!A2`,
    valueInputOption: 'RAW',
    requestBody: { values },
  });
  invalidateCache(sheetId, tabName);
}

export async function rebuildStatementRecords() {
  const sheetId = process.env[SALES_SHEET_ID_KEY];
  if (!sheetId) throw new Error(`${SALES_SHEET_ID_KEY} env var is required`);
  const ledgerTab = process.env[LEDGER_TAB_KEY] || 'Commission Ledger';
  const salesTab = process.env.SALES_TAB_NAME || 'Sheet1';

  const t0 = Date.now();
  await ensureStatementRecordTabs();

  const [ledgerRaw, salesRaw] = await Promise.all([
    fetchSheet(sheetId, ledgerTab, 0),
    fetchSheet(sheetId, salesTab, 0),
  ]);

  const ledger = ledgerRaw.map(projectLedgerRow);
  const salesRows = salesRaw.map(projectSalesRow);

  // Index sales rows by holder key for lookup during rebuild.
  const salesByHolder = new Map();
  for (const sr of salesRows) {
    const key = buildHolderKey(sr.firstName, sr.lastName);
    if (!salesByHolder.has(key)) salesByHolder.set(key, []);
    salesByHolder.get(key).push(sr);
  }

  const grouped = groupLedgerByHolder(ledger);
  const lastRebuiltIso = new Date().toISOString();
  const holderRows = [];
  const periodRows = [];
  for (const [holderKey, lines] of grouped) {
    const matchedSales = salesByHolder.get(holderKey) || [];
    holderRows.push(buildHolderRow(holderKey, lines, matchedSales, lastRebuiltIso));
    periodRows.push(...buildPeriodRows(holderKey, lines));
  }

  await overwriteTab(sheetId, STATEMENT_HOLDERS_TAB, HOLDERS_HEADERS, holderRows);
  await overwriteTab(sheetId, STATEMENT_PERIODS_TAB, PERIODS_HEADERS, periodRows);

  return { holders: holderRows.length, periods: periodRows.length, durationMs: Date.now() - t0 };
}
```

- [ ] **Step 2: Verify syntax**

Run: `node --check src/lib/statement-records-io.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/lib/statement-records-io.js
git commit -m "feat(statement-records): rebuildStatementRecords idempotent overwrite of both tabs"
```

---

## Task 9: API — POST `/api/statement-records/init`

**Files:**
- Create: `src/app/api/statement-records/init/route.js`

- [ ] **Step 1: Create the route**

```js
import { NextResponse } from 'next/server';
import { ensureStatementRecordTabs } from '@/lib/statement-records-io';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const result = await ensureStatementRecordTabs();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Convenience: allow GET for one-time browser invocation.
export async function GET() {
  return POST();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/statement-records/init/route.js
git commit -m "feat(statement-records): add POST /api/statement-records/init"
```

---

## Task 10: API — POST `/api/statement-records/rebuild`

**Files:**
- Create: `src/app/api/statement-records/rebuild/route.js`

- [ ] **Step 1: Create the route**

```js
import { NextResponse } from 'next/server';
import { rebuildStatementRecords } from '@/lib/statement-records-io';

export const dynamic = 'force-dynamic';

function checkAuth(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // unset → no auth in local dev
  const header = request.headers.get('authorization') || '';
  const fromQuery = new URL(request.url).searchParams.get('secret') || '';
  const expected = `Bearer ${secret}`;
  return header === expected || fromQuery === secret;
}

export async function POST(request) {
  if (!checkAuth(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const result = await rebuildStatementRecords();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: err.message, stack: err.stack }, { status: 500 });
  }
}

export async function GET(request) {
  return POST(request);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/statement-records/rebuild/route.js
git commit -m "feat(statement-records): add POST /api/statement-records/rebuild with optional CRON_SECRET gate"
```

---

## Task 11: API — GET `/api/statement-records` (list)

**Files:**
- Create: `src/app/api/statement-records/route.js`

- [ ] **Step 1: Create the route**

```js
import { NextResponse } from 'next/server';
import { fetchSheet } from '@/lib/sheets';
import { STATEMENT_HOLDERS_TAB, HOLDERS_HEADERS } from '@/lib/statement-records';

export const dynamic = 'force-dynamic';

function rowToHolder(r) {
  const out = {};
  for (const h of HOLDERS_HEADERS) out[h] = r[h] ?? '';
  // Coerce numerics for consumer convenience.
  ['Policy Count', 'Statement Count', 'Total Advances', 'Total Commissions',
    'Total Chargebacks', 'Total Recoveries', 'Net Total', 'Outstanding Balance']
    .forEach(k => out[k] = parseFloat(out[k]) || 0);
  ['Expected Net', 'Variance'].forEach(k => {
    out[k] = out[k] === '' ? null : (parseFloat(out[k]) || 0);
  });
  return out;
}

export async function GET(request) {
  try {
    const sheetId = process.env.SALES_SHEET_ID;
    const { searchParams } = new URL(request.url);
    const search = (searchParams.get('search') || '').trim().toLowerCase();
    const status = searchParams.get('status') || '';

    const rows = await fetchSheet(sheetId, STATEMENT_HOLDERS_TAB, 60);
    let holders = rows.map(rowToHolder);

    if (search) {
      holders = holders.filter(h =>
        h['Insured Name'].toLowerCase().includes(search) ||
        h['Policies'].toLowerCase().includes(search)
      );
    }
    if (status && status !== 'all') {
      if (status === 'variance') {
        holders = holders.filter(h => h.Variance !== null && Math.abs(h.Variance) > 50);
      } else if (status === 'chargebacks') {
        holders = holders.filter(h => h['Total Chargebacks'] > 0);
      } else if (status === 'outstanding') {
        holders = holders.filter(h => h['Outstanding Balance'] > 0);
      } else {
        holders = holders.filter(h => h.Status === status);
      }
    }

    const lastRebuilt = holders[0]?.['Last Rebuilt'] || null;
    return NextResponse.json({ holders, lastRebuilt });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/statement-records/route.js
git commit -m "feat(statement-records): add GET /api/statement-records (list) with search/status filters"
```

---

## Task 12: API — GET `/api/statement-records/[holderKey]`

**Files:**
- Create: `src/app/api/statement-records/[holderKey]/route.js`

- [ ] **Step 1: Create the route**

```js
import { NextResponse } from 'next/server';
import { fetchSheet } from '@/lib/sheets';
import { STATEMENT_HOLDERS_TAB, STATEMENT_PERIODS_TAB } from '@/lib/statement-records';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  try {
    const { holderKey } = await params;
    if (!holderKey) return NextResponse.json({ error: 'holderKey required' }, { status: 400 });
    const decodedKey = decodeURIComponent(holderKey);
    const policyNumber = new URL(request.url).searchParams.get('policyNumber') || '';

    const sheetId = process.env.SALES_SHEET_ID;
    const [holderRows, periodRows] = await Promise.all([
      fetchSheet(sheetId, STATEMENT_HOLDERS_TAB, 60),
      fetchSheet(sheetId, STATEMENT_PERIODS_TAB, 60),
    ]);

    let candidates = holderRows.filter(r => r['Holder Key'] === decodedKey);
    if (candidates.length > 1 && policyNumber) {
      candidates = candidates.filter(r => (r['Policies'] || '').includes(policyNumber));
    }
    const holder = candidates[0] || null;
    if (!holder) return NextResponse.json({ holder: null, periods: [] });

    const periods = periodRows
      .filter(r => r['Holder Key'] === decodedKey)
      .map(r => {
        const out = { ...r };
        ['Premium', 'Advance Amount', 'Commission Amount', 'Chargeback Amount',
          'Recovery Amount', 'Net Impact', 'Outstanding Balance', 'Line Item Count']
          .forEach(k => out[k] = parseFloat(out[k]) || 0);
        return out;
      })
      .sort((a, b) => String(b['Statement Date'] || '').localeCompare(String(a['Statement Date'] || '')));

    return NextResponse.json({ holder, periods });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/statement-records/\[holderKey\]/route.js
git commit -m "feat(statement-records): add GET /api/statement-records/[holderKey] with policyNumber tiebreaker"
```

---

## Task 13: API — GET `/api/statement-records/lines`

**Files:**
- Create: `src/app/api/statement-records/lines/route.js`

- [ ] **Step 1: Create the route**

```js
import { NextResponse } from 'next/server';
import { fetchSheet } from '@/lib/sheets';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const statementFile = searchParams.get('statementFile') || '';
    const insuredName = searchParams.get('insuredName') || '';
    if (!statementFile || !insuredName) {
      return NextResponse.json({ error: 'statementFile and insuredName required' }, { status: 400 });
    }

    const sheetId = process.env.SALES_SHEET_ID;
    const ledgerTab = process.env.COMMISSION_LEDGER_TAB || 'Commission Ledger';
    const rows = await fetchSheet(sheetId, ledgerTab, 60);

    const wantName = insuredName.trim().toLowerCase();
    const lines = rows
      .filter(r =>
        (r['Statement File'] || '') === statementFile &&
        (r['Insured Name'] || '').trim().toLowerCase() === wantName
      )
      .map(r => ({
        transactionId: r['Transaction ID'] || '',
        statementDate: r['Statement Date'] || '',
        transactionType: r['Transaction Type'] || '',
        description: r['Description'] || '',
        product: r['Product'] || '',
        policyNumber: r['Policy #'] || '',
        premium: parseFloat(r['Premium']) || 0,
        commissionPct: r['Commission %'] === '' ? null : (parseFloat(r['Commission %']) || 0),
        advancePct: r['Advance %'] === '' ? null : (parseFloat(r['Advance %']) || 0),
        advanceAmount: parseFloat(r['Advance Amount']) || 0,
        commissionAmount: parseFloat(r['Commission Amount']) || 0,
        chargebackAmount: parseFloat(r['Chargeback Amount']) || 0,
        recoveryAmount: parseFloat(r['Recovery Amount']) || 0,
        outstandingBalance: parseFloat(r['Outstanding Balance']) || 0,
        notes: r['Notes'] || '',
      }));

    const fileId = lines[0] ? rows.find(r => r['Statement File'] === statementFile)?.['Statement File ID'] || '' : '';
    return NextResponse.json({ lines, statement: { file: statementFile, fileId } });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/statement-records/lines/route.js
git commit -m "feat(statement-records): add GET /api/statement-records/lines (Level 3 raw line items)"
```

---

## Task 14: Initial smoke run — init + rebuild + list

**Files:** none (verification step)

- [ ] **Step 1: Make sure dev server is running**

If not already: `npm run dev` in another terminal. Wait for "Ready" output.

- [ ] **Step 2: Initialize the two new sheet tabs**

Run: `curl -X POST http://localhost:3000/api/statement-records/init`
Expected: `{"ok":true,"created":["Statement Records — Holders","Statement Records — Periods"]}` (or `created: []` if they already exist).

- [ ] **Step 3: Trigger first full rebuild**

Run: `curl -X POST http://localhost:3000/api/statement-records/rebuild`
Expected: `{"ok":true,"holders":N,"periods":M,"durationMs":...}` with N and M > 0 if there is ledger data.

- [ ] **Step 4: List holders**

Run: `curl 'http://localhost:3000/api/statement-records?status=variance' | python3 -m json.tool | head -30`
Expected: `{ "holders": [...], "lastRebuilt": "..." }` with holders that have variance > $50.

- [ ] **Step 5: Pick one holder and fetch its detail**

```bash
HOLDER_KEY=$(curl -s http://localhost:3000/api/statement-records | python3 -c "import sys,json; print(json.load(sys.stdin)['holders'][0]['Holder Key'])")
curl "http://localhost:3000/api/statement-records/$(python3 -c "import urllib.parse; print(urllib.parse.quote('$HOLDER_KEY'))")" | python3 -m json.tool | head -40
```

Expected: `{ "holder": {...}, "periods": [...] }` for that holder.

- [ ] **Step 6: Open the Sales sheet in a browser and visually confirm the two new tabs exist with data populated**

No commit — verification step only.

---

## Task 15: UI — Drawer context provider

**Files:**
- Create: `src/contexts/StatementRecordDrawerContext.jsx`

- [ ] **Step 1: Create the context, provider, and hook**

```jsx
'use client';
import { createContext, useCallback, useContext, useState } from 'react';
import { buildHolderKey } from '@/lib/statement-records';

const Ctx = createContext(null);

function splitName(fullName) {
  const s = String(fullName || '').trim();
  if (!s) return { first: '', last: '' };
  if (s.includes(',')) {
    const [last, first] = s.split(',').map(p => p.trim());
    return { first: first || '', last: last || '' };
  }
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { first: '', last: parts[0] };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

export function StatementRecordDrawerProvider({ children }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ holder: null, periods: [], loading: false, error: null });

  const openDrawer = useCallback(async ({ holderName, policyNumber }) => {
    const { first, last } = splitName(holderName);
    const key = buildHolderKey(first, last);
    setOpen(true);
    setData({ holder: null, periods: [], loading: true, error: null });
    try {
      const qs = policyNumber ? `?policyNumber=${encodeURIComponent(policyNumber)}` : '';
      const res = await fetch(`/api/statement-records/${encodeURIComponent(key)}${qs}`);
      const json = await res.json();
      setData({ holder: json.holder, periods: json.periods || [], loading: false, error: json.error || null });
    } catch (e) {
      setData({ holder: null, periods: [], loading: false, error: e.message });
    }
  }, []);

  const closeDrawer = useCallback(() => setOpen(false), []);

  return (
    <Ctx.Provider value={{ open, data, openDrawer, closeDrawer }}>
      {children}
    </Ctx.Provider>
  );
}

export function useStatementRecordDrawer() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStatementRecordDrawer must be used within StatementRecordDrawerProvider');
  return v;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/contexts/StatementRecordDrawerContext.jsx
git commit -m "feat(statement-records): add drawer context provider + useStatementRecordDrawer hook"
```

---

## Task 16: UI — `StatementRecordDrawer` component

**Files:**
- Create: `src/components/StatementRecordDrawer.jsx`

- [ ] **Step 1: Create the drawer component**

```jsx
'use client';
import { Fragment, useEffect, useState } from 'react';
import { useStatementRecordDrawer } from '@/contexts/StatementRecordDrawerContext';

const C = {
  bg: '#0a0e16', surface: '#0f1520', card: '#131b28', border: '#1a2538',
  text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff',
  green: '#4ade80', yellow: '#facc15', red: '#f87171',
};

const fmt$ = (n) => (n === null || n === undefined || n === '') ? '—' :
  `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function varianceColor(v) {
  if (v === null || v === undefined || v === '') return C.muted;
  const a = Math.abs(Number(v));
  if (a <= 10) return C.green;
  if (a <= 50) return C.yellow;
  return C.red;
}

function PeriodLines({ statementFile, insuredName }) {
  const [lines, setLines] = useState(null);
  const [fileId, setFileId] = useState('');
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/statement-records/lines?statementFile=${encodeURIComponent(statementFile)}&insuredName=${encodeURIComponent(insuredName)}`)
      .then(r => r.json())
      .then(j => { if (!cancelled) { setLines(j.lines || []); setFileId(j.statement?.fileId || ''); } });
    return () => { cancelled = true; };
  }, [statementFile, insuredName]);

  if (lines === null) return <div style={{ color: C.muted, padding: 12 }}>Loading line items…</div>;
  if (lines.length === 0) return <div style={{ color: C.muted, padding: 12 }}>No line items found.</div>;
  return (
    <div style={{ background: C.bg, padding: 12, borderTop: `1px solid ${C.border}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong style={{ color: C.text }}>Raw line items — {statementFile}</strong>
        {fileId && (
          <a href={`https://drive.google.com/file/d/${fileId}/view`} target="_blank" rel="noreferrer"
            style={{ color: C.accent, fontSize: 12 }}>View original PDF ↗</a>
        )}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ color: C.muted, textAlign: 'left' }}>
            <th>Type</th><th>Description</th><th>Policy #</th><th>Premium</th>
            <th>Adv %</th><th>Adv Amt</th><th>Comm Amt</th><th>Chgbk</th><th>Recov</th><th>Outstanding</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} style={{ borderTop: `1px solid ${C.border}`, color: C.text }}>
              <td>{l.transactionType}</td>
              <td>{l.description}</td>
              <td>{l.policyNumber}</td>
              <td>{fmt$(l.premium)}</td>
              <td>{l.advancePct === null ? '—' : `${l.advancePct}%`}</td>
              <td>{fmt$(l.advanceAmount)}</td>
              <td>{fmt$(l.commissionAmount)}</td>
              <td style={{ color: l.chargebackAmount > 0 ? C.red : C.text }}>{fmt$(l.chargebackAmount)}</td>
              <td>{fmt$(l.recoveryAmount)}</td>
              <td>{fmt$(l.outstandingBalance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function StatementRecordDrawer() {
  const { open, data, closeDrawer } = useStatementRecordDrawer();
  const [expanded, setExpanded] = useState(null); // Row Key
  useEffect(() => { if (!open) setExpanded(null); }, [open]);

  if (!open) return null;
  const { holder, periods, loading, error } = data;

  return (
    <>
      <div onClick={closeDrawer} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
      }} />
      <aside style={{
        position: 'fixed', top: 0, right: 0, height: '100vh', width: '65vw', minWidth: 720,
        background: C.surface, borderLeft: `1px solid ${C.border}`, color: C.text,
        zIndex: 1001, overflowY: 'auto',
      }}>
        <header style={{ padding: 16, borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{holder?.['Insured Name'] || (loading ? 'Loading…' : 'No record')}</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
              {holder ? `${holder.Policies} · ${holder.Carriers}` : ''}
            </div>
          </div>
          <button onClick={closeDrawer} style={{
            background: 'transparent', border: `1px solid ${C.border}`, color: C.text,
            padding: '4px 12px', cursor: 'pointer', borderRadius: 4,
          }}>Close ✕</button>
        </header>

        {loading && <div style={{ padding: 24, color: C.muted }}>Loading…</div>}
        {error && <div style={{ padding: 24, color: C.red }}>Error: {error}</div>}
        {!loading && !error && !holder && (
          <div style={{ padding: 24, color: C.muted }}>No carrier statements found for this customer yet.</div>
        )}

        {holder && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, padding: 16 }}>
              {[
                ['Net Total', fmt$(holder['Net Total']), C.text],
                ['Variance', fmt$(holder.Variance), varianceColor(holder.Variance)],
                ['Outstanding', fmt$(holder['Outstanding Balance']), holder['Outstanding Balance'] > 0 ? C.yellow : C.text],
                ['# Statements', String(holder['Statement Count']), C.text],
              ].map(([label, val, color]) => (
                <div key={label} style={{ background: C.card, padding: 12, borderRadius: 4, borderTop: `2px solid ${color}` }}>
                  <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase' }}>{label}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color }}>{val}</div>
                </div>
              ))}
            </div>

            <div style={{ padding: 16 }}>
              <h3 style={{ fontSize: 13, color: C.muted, textTransform: 'uppercase', margin: '0 0 8px 0' }}>
                Statement periods ({periods.length})
              </h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ color: C.muted, textAlign: 'left', borderBottom: `1px solid ${C.border}` }}>
                    <th style={{ padding: 8 }}>File</th><th>Carrier</th><th>Period</th><th>Policy #</th>
                    <th>Premium</th><th>Adv</th><th>Chgbk</th><th>Rec</th><th>Net</th><th>Lines</th>
                  </tr>
                </thead>
                <tbody>
                  {periods.map((p) => {
                    const isOpen = expanded === p['Row Key'];
                    return (
                      <Fragment key={p['Row Key']}>
                        <tr
                          onClick={() => setExpanded(isOpen ? null : p['Row Key'])}
                          style={{ borderBottom: `1px solid ${C.border}`, cursor: 'pointer',
                            background: isOpen ? 'rgba(91,159,255,0.08)' : 'transparent' }}>
                          <td style={{ padding: 8 }}>{p['Statement File']}</td>
                          <td>{p.Carrier}</td>
                          <td>{p['Statement Period']}</td>
                          <td>{p['Policy #']}</td>
                          <td>{fmt$(p.Premium)}</td>
                          <td>{fmt$(p['Advance Amount'])}</td>
                          <td style={{ color: p['Chargeback Amount'] > 0 ? C.red : C.text }}>{fmt$(p['Chargeback Amount'])}</td>
                          <td>{fmt$(p['Recovery Amount'])}</td>
                          <td style={{ color: p['Net Impact'] < 0 ? C.red : C.text }}>{fmt$(p['Net Impact'])}</td>
                          <td>{p['Line Item Count']} {isOpen ? '▼' : '▶'}</td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan={10} style={{ padding: 0 }}>
                              <PeriodLines statementFile={p['Statement File']} insuredName={p['Insured Name']} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/StatementRecordDrawer.jsx
git commit -m "feat(statement-records): add StatementRecordDrawer with expandable Level-3 line items"
```

---

## Task 17: UI — Mount provider + drawer in Dashboard.jsx

**Files:**
- Modify: `src/components/Dashboard.jsx`

- [ ] **Step 1: Locate the top-level return statement of `Dashboard`**

Run: `grep -n "^export default\|return (" src/components/Dashboard.jsx | head -5`

Note the line numbers of the `return (` inside the default export — that's where the provider wraps.

- [ ] **Step 2: Add imports near the top of Dashboard.jsx**

Find the existing `import CommissionStatementsTab from './tabs/CommissionStatementsTab';` line and add immediately after it:

```jsx
import StatementRecordDrawer from './StatementRecordDrawer';
import { StatementRecordDrawerProvider } from '@/contexts/StatementRecordDrawerContext';
```

- [ ] **Step 3: Wrap the top-level returned JSX in the provider and mount the drawer**

Find the outermost `<div>` returned by the `Dashboard` component and wrap it:

```jsx
return (
  <StatementRecordDrawerProvider>
    <div style={...existing...}>
      {/* ...all existing content... */}
    </div>
    <StatementRecordDrawer />
  </StatementRecordDrawerProvider>
);
```

- [ ] **Step 4: Verify the dev server reloads cleanly**

Watch the dev server output. No compile errors expected.

Use preview tools:

```
preview_start (if not running)
preview_eval: window.location.reload()
preview_console_logs (check for errors)
preview_snapshot (verify dashboard still renders)
```

- [ ] **Step 5: Commit**

```bash
git add src/components/Dashboard.jsx
git commit -m "feat(statement-records): mount StatementRecordDrawer + provider at Dashboard root"
```

---

## Task 18: UI — `HolderRecordsView` master sub-view

**Files:**
- Create: `src/components/HolderRecordsView.jsx`

- [ ] **Step 1: Create the view component**

```jsx
'use client';
import { useEffect, useMemo, useState } from 'react';
import { useStatementRecordDrawer } from '@/contexts/StatementRecordDrawerContext';

const C = {
  bg: '#080b10', card: '#131b28', border: '#1a2538',
  text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff',
  green: '#4ade80', yellow: '#facc15', red: '#f87171',
};

const fmt$ = (n) => (n === null || n === undefined || n === '') ? '—' :
  `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function varianceColor(v) {
  if (v === null || v === undefined || v === '') return C.muted;
  const a = Math.abs(Number(v));
  if (a <= 10) return C.green;
  if (a <= 50) return C.yellow;
  return C.red;
}

const STATUS_OPTIONS = [
  ['all', 'All'], ['variance', 'Variance ≠ 0'], ['chargebacks', 'Chargebacks'],
  ['outstanding', 'Outstanding'], ['healthy', 'Healthy'], ['unmatched', 'Unmatched'],
];

const COLUMNS = [
  { key: 'Insured Name', label: 'Holder' },
  { key: 'Policies', label: 'Policies' },
  { key: 'Carriers', label: 'Carriers' },
  { key: 'Statement Count', label: '# Stmts', align: 'right' },
  { key: 'Last Period', label: 'Last' },
  { key: 'Total Advances', label: 'Advances', align: 'right', fmt: fmt$ },
  { key: 'Total Chargebacks', label: 'Chgbks', align: 'right', fmt: fmt$ },
  { key: 'Outstanding Balance', label: 'Outstanding', align: 'right', fmt: fmt$ },
  { key: 'Net Total', label: 'Net', align: 'right', fmt: fmt$ },
  { key: 'Expected Net', label: 'Expected', align: 'right', fmt: fmt$ },
  { key: 'Variance', label: 'Variance', align: 'right', fmt: fmt$ },
  { key: 'Status', label: 'Status' },
];

export default function HolderRecordsView() {
  const { openDrawer } = useStatementRecordDrawer();
  const [holders, setHolders] = useState([]);
  const [lastRebuilt, setLastRebuilt] = useState(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [sortKey, setSortKey] = useState('Net Total');
  const [sortDir, setSortDir] = useState('desc');
  const [loading, setLoading] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  const load = async () => {
    setLoading(true);
    const params = new URLSearchParams({ search, status });
    const res = await fetch(`/api/statement-records?${params}`);
    const json = await res.json();
    setHolders(json.holders || []);
    setLastRebuilt(json.lastRebuilt);
    setLoading(false);
  };

  useEffect(() => { load(); }, [search, status]);

  const sorted = useMemo(() => {
    const arr = [...holders];
    arr.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av;
      return sortDir === 'asc'
        ? String(av || '').localeCompare(String(bv || ''))
        : String(bv || '').localeCompare(String(av || ''));
    });
    return arr;
  }, [holders, sortKey, sortDir]);

  const totals = useMemo(() => {
    return holders.reduce((acc, h) => ({
      advances: acc.advances + h['Total Advances'],
      chargebacks: acc.chargebacks + h['Total Chargebacks'],
      outstanding: acc.outstanding + h['Outstanding Balance'],
      variance: acc.variance + (h.Variance || 0),
    }), { advances: 0, chargebacks: 0, outstanding: 0, variance: 0 });
  }, [holders]);

  const rebuild = async () => {
    setRebuilding(true);
    await fetch('/api/statement-records/rebuild', { method: 'POST' });
    await load();
    setRebuilding(false);
  };

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  return (
    <div style={{ color: C.text }}>
      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 16 }}>
        {[
          ['Total Holders', String(holders.length), C.text],
          ['Total Advances', fmt$(totals.advances), C.green],
          ['Total Chargebacks', fmt$(totals.chargebacks), totals.chargebacks > 0 ? C.red : C.muted],
          ['Outstanding', fmt$(totals.outstanding), totals.outstanding > 0 ? C.yellow : C.muted],
          ['Total Variance', fmt$(totals.variance), varianceColor(totals.variance)],
        ].map(([label, val, color]) => (
          <div key={label} style={{ background: C.card, padding: 12, borderRadius: 4, borderTop: `2px solid ${color}` }}>
            <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase' }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          type="text" placeholder="Search by holder name or policy #" value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text, padding: '6px 10px', borderRadius: 4, minWidth: 280 }}
        />
        {STATUS_OPTIONS.map(([val, label]) => (
          <button key={val} onClick={() => setStatus(val)} style={{
            background: status === val ? C.accent : 'transparent',
            color: status === val ? '#fff' : C.muted,
            border: `1px solid ${status === val ? C.accent : C.border}`,
            padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12,
          }}>{label}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={rebuild} disabled={rebuilding} style={{
          background: C.card, color: C.text, border: `1px solid ${C.border}`,
          padding: '6px 12px', borderRadius: 4, cursor: rebuilding ? 'wait' : 'pointer',
        }}>{rebuilding ? 'Rebuilding…' : 'Rebuild rollups'}</button>
        {lastRebuilt && <span style={{ color: C.muted, fontSize: 11 }}>Last: {lastRebuilt}</span>}
      </div>

      {/* Table */}
      <div style={{ background: C.card, borderRadius: 4, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: C.muted, textAlign: 'left', borderBottom: `1px solid ${C.border}` }}>
              {COLUMNS.map(col => (
                <th key={col.key} onClick={() => toggleSort(col.key)} style={{
                  padding: 8, cursor: 'pointer', textAlign: col.align || 'left',
                }}>
                  {col.label}{sortKey === col.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={COLUMNS.length} style={{ padding: 16, color: C.muted, textAlign: 'center' }}>Loading…</td></tr>}
            {!loading && sorted.map(h => (
              <tr key={h['Holder Key']}
                onClick={() => openDrawer({ holderName: h['Insured Name'], policyNumber: (h.Policies || '').split(',')[0]?.trim() })}
                style={{ borderBottom: `1px solid ${C.border}`, cursor: 'pointer' }}>
                {COLUMNS.map(col => {
                  const v = h[col.key];
                  const display = col.fmt ? col.fmt(v) : (v === null || v === undefined ? '—' : String(v));
                  const color = col.key === 'Variance' ? varianceColor(v) : undefined;
                  return <td key={col.key} style={{ padding: 8, textAlign: col.align || 'left', color }}>{display}</td>;
                })}
              </tr>
            ))}
            {!loading && sorted.length === 0 && (
              <tr><td colSpan={COLUMNS.length} style={{ padding: 16, color: C.muted, textAlign: 'center' }}>No holders match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/HolderRecordsView.jsx
git commit -m "feat(statement-records): add HolderRecordsView master sub-view"
```

---

## Task 19: UI — Add `Holder Records` as first sub-tab in `CommissionStatementsTab`

**Files:**
- Modify: `src/components/tabs/CommissionStatementsTab.jsx`

- [ ] **Step 1: Locate the sub-tab pill block**

Run: `grep -n "Sub-tab toggle\|setSubTab\|subTab" src/components/tabs/CommissionStatementsTab.jsx | head -10`
Note the existing sub-tab IDs and the pill rendering block (around line 343 per earlier scan).

- [ ] **Step 2: Add the import for the new view**

Near the top of `CommissionStatementsTab.jsx`, add:

```jsx
import HolderRecordsView from '@/components/HolderRecordsView';
```

- [ ] **Step 3: Add `holders` to the sub-tab state default and to the pill list**

Find the line that initializes `subTab` (e.g. `useState('upload')`) and change to:

```jsx
const [subTab, setSubTab] = useState('holders');
```

Find the array of sub-tab definitions (look for the pill labels like `Upload`, `Statements`, `Reconciliation`, etc.) and add `{ id: 'holders', label: 'Holder Records' }` as the **first** entry.

- [ ] **Step 4: Render the view when `subTab === 'holders'`**

Find the rendering switch (e.g. `{subTab === 'upload' && ...}`) and add at the top:

```jsx
{subTab === 'holders' && <HolderRecordsView />}
```

- [ ] **Step 5: Verify in browser**

Use preview tools:

```
preview_eval: window.location.reload()
preview_console_logs (check for errors)
preview_snapshot (verify Commission Statements tab now opens with Holder Records sub-view by default)
preview_screenshot (capture for the user)
```

Confirm: tab order is `[Holder Records] [Upload] [Statements] [Reconciliation] [Waterfall] [Pending Review]`.

- [ ] **Step 6: Click a holder row and verify the drawer opens with periods**

Use preview tools:

```
preview_click on a holder row in the Holder Records table
preview_snapshot (verify drawer slides in with KPIs + periods table)
preview_click on a period row (verify line items expand inline)
```

- [ ] **Step 7: Commit**

```bash
git add src/components/tabs/CommissionStatementsTab.jsx
git commit -m "feat(statement-records): add Holder Records as first sub-tab in Commission Statements"
```

---

## Task 20: UI — Click-through wiring across the 6 commission tables

**Files:**
- Modify: `src/components/CommissionStatusTable.jsx`
- Modify: `src/components/tabs/CommissionReconciliationTab.jsx`
- Modify: `src/components/PeriodRevenueTable.jsx`
- Modify: `src/components/CarrierBalancesTable.jsx`
- Modify: `src/components/tabs/CombinedPoliciesTab.jsx`
- Modify: `src/components/Dashboard.jsx` (Daily Activity drill-down policy table only)

For each of the 6 files, the change is identical in shape. Repeat steps 1–4 below per file.

- [ ] **Step 1: Add the hook import to the file**

At the top of the file, after existing imports:

```jsx
import { useStatementRecordDrawer } from '@/contexts/StatementRecordDrawerContext';
```

- [ ] **Step 2: Get `openDrawer` inside the component**

Inside the function component, near the other hook calls:

```jsx
const { openDrawer } = useStatementRecordDrawer();
```

- [ ] **Step 3: Add a `Statements` column header**

Find the `<thead>` table header row and add as the **last** `<th>`:

```jsx
<th title="View carrier statement records for this customer" style={{ padding: 8, textAlign: 'center' }}>📄</th>
```

- [ ] **Step 4: Add the cell in each `<tr>` body row**

For each row, add as the last `<td>`. Identify the row variable's name (`r`, `p`, `o`, etc.) and the field that holds the holder name (commonly `r.insuredName`, `r.client`, `r['Insured Name']`, or a constructed `${r.firstName} ${r.lastName}`) and the policy number (`r.policyNumber` or `r['Policy #']`):

```jsx
<td style={{ textAlign: 'center' }}>
  <button onClick={(e) => {
    e.stopPropagation();
    openDrawer({ holderName: <HOLDER_FIELD>, policyNumber: <POLICY_FIELD> });
  }}
  title="View carrier statements"
  style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 14 }}>📄</button>
</td>
```

Per-file substitutions:

| File | `<HOLDER_FIELD>` | `<POLICY_FIELD>` |
|---|---|---|
| `CommissionStatusTable.jsx` | `p.insuredName ?? \`${p.firstName ?? ''} ${p.lastName ?? ''}\`.trim()` | `p.policyNumber` |
| `CommissionReconciliationTab.jsx` | `r.client` | `r.policyNumber` |
| `PeriodRevenueTable.jsx` | `r.insuredName ?? r.client` | `r.policyNumber` |
| `CarrierBalancesTable.jsx` | `r.insuredName ?? r.holder` | `r.policyNumber` |
| `CombinedPoliciesTab.jsx` | `\`${r.firstName ?? ''} ${r.lastName ?? ''}\`.trim()` | `r.policyNumber ?? r['Policy #']` |
| `Dashboard.jsx` (Daily drill-down policy table) | `\`${p.firstName ?? ''} ${p.lastName ?? ''}\`.trim()` | `p.policyNumber` |

If the actual field names differ from the table, inspect the row object using `console.log` once to confirm — never guess.

- [ ] **Step 5 (after all 6 files): Verify each table renders the new column and the drawer opens**

Use preview tools:

```
preview_eval: window.location.reload()
For each tab — Commission Status, Commission Reconciliation, Period Revenue, Carrier Balances, Combined Policies, Daily Activity drill-down:
  preview_click on the tab
  preview_snapshot (verify 📄 column appears as the last column)
  preview_click on a 📄 button in any row
  preview_snapshot (verify drawer opens for that holder)
  preview_click outside drawer (verify it closes cleanly)
```

If any field substitution is wrong (drawer shows "No carrier statements found" for a holder you know has statements), re-inspect the source row data and fix the field reference.

- [ ] **Step 6: Commit**

```bash
git add src/components/CommissionStatusTable.jsx \
        src/components/tabs/CommissionReconciliationTab.jsx \
        src/components/PeriodRevenueTable.jsx \
        src/components/CarrierBalancesTable.jsx \
        src/components/tabs/CombinedPoliciesTab.jsx \
        src/components/Dashboard.jsx
git commit -m "feat(statement-records): add 📄 click-through column to all 6 commission tables"
```

---

## Task 21: Refresh hooks in 5 ledger-mutating routes

**Files:**
- Modify: `src/app/api/commission-statements/upload/route.js`
- Modify: `src/app/api/commission-statements/sync-drive/route.js`
- Modify: `src/app/api/commission-statements/dedup/route.js`
- Modify: `src/app/api/commission-statements/approve/route.js`
- Modify: `src/app/api/commission-statements/rematch/route.js`

For each of the 5 files, the change is identical:

- [ ] **Step 1: Add the import at the top of the file**

```js
import { rebuildStatementRecords } from '@/lib/statement-records-io';
```

- [ ] **Step 2: Find the success return path**

Locate the `return NextResponse.json({ ... })` that signals successful ledger mutation (usually after the `appendRow`/`updateRow` calls). For routes that return early on dry-run or skip ledger writes, only add the rebuild on the success-with-write path.

- [ ] **Step 3: Add the rebuild call immediately before each successful return**

```js
let rebuildResult = null;
try {
  rebuildResult = await rebuildStatementRecords();
} catch (e) {
  console.error('[statement-records] rebuild failed (non-fatal):', e.message);
}
return NextResponse.json({ ...existingResponseBody, statementRecordsRebuild: rebuildResult });
```

The rebuild is wrapped in try/catch so a rollup failure cannot break the primary statement-processing response. The rebuild result is included in the response body so the UI can surface it if useful.

- [ ] **Step 4 (after all 5 files): Smoke test**

Upload a test statement via the existing UI:

```
preview_click on Commission Statements tab → Upload sub-tab
preview_fill the file input (or use an existing statement file)
preview_click submit
preview_logs (check server output for "[statement-records]" lines)
preview_eval: fetch('/api/statement-records').then(r=>r.json()).then(console.log)
preview_console_logs (verify the holder count increased and lastRebuilt is fresh)
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/commission-statements/upload/route.js \
        src/app/api/commission-statements/sync-drive/route.js \
        src/app/api/commission-statements/dedup/route.js \
        src/app/api/commission-statements/approve/route.js \
        src/app/api/commission-statements/rematch/route.js
git commit -m "feat(statement-records): rebuild rollups inline after every ledger-mutating route"
```

---

## Task 22: Daily cron route

**Files:**
- Create: `src/app/api/cron/rebuild-statement-records/route.js`

- [ ] **Step 1: Locate an existing cron route to mirror**

Run: `ls src/app/api/cron/ && cat src/app/api/cron/backfill-snapshots/route.js 2>&1 | head -20`

This shows the auth pattern (`CRON_SECRET` check) and response shape used by the existing cron routes.

- [ ] **Step 2: Create the new cron route mirroring the existing pattern**

```js
import { NextResponse } from 'next/server';
import { rebuildStatementRecords } from '@/lib/statement-records-io';

export const dynamic = 'force-dynamic';

function checkAuth(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = request.headers.get('authorization') || '';
  const fromQuery = new URL(request.url).searchParams.get('secret') || '';
  return header === `Bearer ${secret}` || fromQuery === secret;
}

export async function GET(request) {
  if (!checkAuth(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const result = await rebuildStatementRecords();
    return NextResponse.json({ ok: true, ...result, ranAt: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Wire the schedule via vercel.json (if the project uses Vercel cron)**

Run: `cat vercel.json 2>&1 | head -30`

If a `crons` array exists, append:

```json
{ "path": "/api/cron/rebuild-statement-records", "schedule": "0 2 * * *" }
```

If no `vercel.json` exists, document in the spec/plan that the schedule needs to be set up at deploy time (no plan action required).

- [ ] **Step 4: Hit the cron route locally to verify**

Run: `curl http://localhost:3000/api/cron/rebuild-statement-records`
Expected: `{"ok":true,"holders":N,"periods":M,...,"ranAt":"..."}`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/rebuild-statement-records/route.js vercel.json
git commit -m "feat(statement-records): add 02:00 daily cron to rebuild rollups defensively"
```

---

## Task 23: End-to-end manual smoke test

**Files:** none (verification step)

- [ ] **Step 1: Open the dashboard**

```
preview_eval: window.location.reload()
preview_snapshot
```

Confirm the dashboard loads cleanly with no console errors.

- [ ] **Step 2: Land on Commission Statements → Holder Records**

```
preview_click Commission Statements tab in nav
preview_snapshot
```

Confirm `Holder Records` is the first sub-tab and is selected by default. KPI row, search box, status chips, holder table all present.

- [ ] **Step 3: Search and filter**

```
preview_fill search box with a known holder's last name
preview_snapshot (verify table filters to that holder)
preview_click "Variance ≠ 0" status chip
preview_snapshot (verify only variance holders shown)
preview_click "All" to reset
```

- [ ] **Step 4: Open drawer from master view**

```
preview_click on a holder row
preview_snapshot (drawer slides in, KPIs render, periods table populated)
preview_click on a period row
preview_snapshot (line items expand inline below the row)
preview_click "View original PDF ↗" link if Statement File ID is populated
```

- [ ] **Step 5: Open drawer from each of the 6 click-through tables**

For each of: Commission Status, Commission Reconciliation (under Commission Statements → Reconciliation), Period Revenue, Carrier Balances, Combined Policies, Daily Activity → drill into a day → click 📄 in the policies table:

```
preview_click on the 📄 button for a row whose holder you know has statement records
preview_snapshot (drawer opens with that holder's data)
preview_click outside drawer to close
```

- [ ] **Step 6: Verify rebuild button works**

```
preview_click "Rebuild rollups" button
preview_snapshot (verify "Rebuilding…" then back to "Rebuild rollups", "Last:" timestamp updates)
preview_logs (no errors in server log)
```

- [ ] **Step 7: Verify auto-rebuild on statement upload**

If a test statement file is available, upload it via Commission Statements → Upload, then immediately switch back to Holder Records and confirm the holder count / last-rebuilt timestamp reflects the new statement.

- [ ] **Step 8: No commit — verification step only.** If issues found, file fix tasks; otherwise the implementation is complete.

---

## Self-review

Run before declaring the plan done:

1. **Spec coverage**
   - Three-level structure (Master / Periods / Lines): Tasks 5/6/13 + UI Tasks 16/18.
   - Two persisted tabs: Tasks 7/8.
   - Five APIs (init/rebuild/list/[holderKey]/lines): Tasks 9/10/11/12/13.
   - Master view as first sub-tab: Tasks 18/19.
   - Drawer mounted globally + opened from 6 tables: Tasks 15/16/17/20.
   - Refresh hooks in 5 routes + daily cron: Tasks 21/22.
   - Edge cases (name normalization, unmatched, multi-policy, name collision tiebreaker): covered in Tasks 3/4/5/12/15.
   - Variance thresholds: defined in Task 2 (`VARIANCE_THRESHOLDS`).
   - Unit + smoke tests: Tasks 3–6 (unit), Task 14 (API smoke), Task 23 (E2E).

2. **No placeholders** — every code block is complete, runnable code; every command has an expected output.

3. **Type/name consistency** — header constants `HOLDERS_HEADERS` / `PERIODS_HEADERS` used in both the lib and the I/O composer; row-object keys match across the lib (`buildHolderRow`/`buildPeriodRows`), API projection (`/route.js`), and UI consumers (`HolderRecordsView`, `StatementRecordDrawer`); function name `rebuildStatementRecords` consistent across rebuild route, cron route, and refresh-hook callsites.
