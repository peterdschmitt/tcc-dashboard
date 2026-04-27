# Commission Ledger Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync the `Commission Ledger` Google Sheet into a new Postgres `commission_ledger` table + a `policy_commission_summary` view that aggregates per-policy totals. Wire the new sync into the existing pipeline so it runs alongside the other 7 sync modules every 30 min.

**Architecture:** New migration creates table + indexes + trigger + view. New `src/lib/db-sync/commission-ledger.js` module mirrors the structure of `policies.js` and `calls.js`: pre-load FK lookup maps, iterate sheet rows, hash each row, upsert with `ON CONFLICT (source_row_hash) DO UPDATE`. Pipeline orchestrator gets one new entry inserted between `policies` and `refresh_denorms`.

**Tech Stack:** Postgres (Neon), `postgres` npm package (postgres.js), Next.js 14, Node 20+, `node --test` for pure-function unit tests.

**Spec:** `docs/superpowers/specs/2026-04-26-commission-ledger-sync-design.md`

**Testing approach:** Unit tests via `node --test` for pure helpers (row-hashing, FK resolution). Integration testing via `node --input-type=module` ad-hoc scripts that load env via `scripts/load-env.mjs` and run the sync against the live Neon DB. No new test framework needed.

---

## File Structure

### New files (created by this plan)

```
migrations/
  004_add_commission_ledger.sql                  # table + 5 indexes + trigger + view

src/lib/db-sync/
  commission-ledger.js                           # sync module (mirrors policies.js)
  commission-ledger-helpers.js                   # pure helpers: row-hash + parsers
  commission-ledger-helpers.test.mjs             # node --test unit tests for helpers
```

### Modified files

```
src/lib/db-sync/pipeline.js                      # add commission_ledger to the orchestration array
CLAUDE.md                                        # add "Commission Ledger Sync" subsection under DB section
```

### Files explicitly NOT touched

- `src/components/`, any UI component
- `src/app/api/` other than the existing cron route which auto-picks up the pipeline change
- `vercel.json` — no new function or cron entry; uses the existing `/api/cron/db-sync` schedule
- The existing Commission Statements / Period Revenue / Carrier Balances tabs (they keep reading from sheets unchanged)

---

## Pre-flight (no manual steps)

This plan needs no manual provisioning — `DATABASE_URL` is already in `.env.local` and Vercel env from the portfolio work that just merged. The Commission Ledger sheet (`COMMISSION_SHEET_ID` / `COMMISSION_TAB_NAME` env vars) is already configured. Migration runner (`scripts/db-migrate.mjs`) and env loader (`scripts/load-env.mjs`) are already in the repo.

---

## Task 1: Confirm the worktree is set up

**Files:** none (workspace check)

This plan was created inside an existing worktree. Confirm.

- [ ] **Step 1:** Confirm cwd and branch:

```bash
pwd
git branch --show-current
```

Expected: `/Users/peterschmitt/Downloads/tcc-dashboard/.worktrees/feature-commission-ledger-sync` and `feature/commission-ledger-sync`.

- [ ] **Step 2:** Confirm `.env.local` symlink + `node_modules` present:

```bash
ls -la .env.local node_modules/.bin/next
```

Expected: `.env.local` is a symlink to the main checkout; `next` binary exists.

- [ ] **Step 3:** Confirm migrations + env loader + db.js present:

```bash
ls migrations/ scripts/load-env.mjs src/lib/db.js src/lib/db-sync/policies.js
```

Expected: all four exist. (These came from the merged portfolio work.)

- [ ] **Step 4:** Baseline build:

```bash
npm run build 2>&1 | tail -8
```

Expected: build succeeds.

---

## Task 2: Inspect the source sheet to verify column names

**Files:** none (read-only investigation)

The sync module needs exact column names from the source Commission Ledger tab. The CLAUDE.md docs show one set of names, but the actual sheet may differ. Confirm before coding.

- [ ] **Step 1:** Print the current column headers from the live sheet:

```bash
node --input-type=module -e "
await import('./scripts/load-env.mjs');
const { readRawSheet } = await import('./src/lib/sheets.js');
const { headers } = await readRawSheet(process.env.COMMISSION_SHEET_ID, process.env.COMMISSION_TAB_NAME || 'Sheet1');
console.log(JSON.stringify(headers, null, 2));
" 2>&1 | grep -v MODULE_TYPELESS
```

Expected output: a JSON array of column names. Verify these match (or note differences from) the spec's expected list:

```
Transaction ID | Statement Date | Processing Date | Carrier | Policy #
Insured Name | Agent | Agent ID | Transaction Type | Description | Product
Issue Date | Premium | Commission % | Advance % | Advance Amount
Commission Amount | Net Commission | Outstanding Balance | Chargeback Amount
Recovery Amount | Net Impact | Matched Policy # | Match Type | Match Confidence
Status | Statement File | Notes
```

If column names differ, note the actual names — Task 6 (sync module) will need them. Do NOT proceed if any of `Transaction ID`, `Matched Policy #`, `Carrier`, `Statement Date`, `Advance Amount`, `Commission Amount`, `Outstanding Balance`, `Status` are missing — they're load-bearing.

- [ ] **Step 2:** Sample a row to confirm the data shape:

```bash
node --input-type=module -e "
await import('./scripts/load-env.mjs');
const { readRawSheet } = await import('./src/lib/sheets.js');
const { data } = await readRawSheet(process.env.COMMISSION_SHEET_ID, process.env.COMMISSION_TAB_NAME || 'Sheet1');
console.log('Total rows:', data.length);
console.log('First non-empty row:', JSON.stringify(data.find(r => r['Transaction ID']) || data[0], null, 2));
" 2>&1 | grep -v MODULE_TYPELESS
```

Expected: a count (probably hundreds to a few thousand) and a row object with realistic values. Note the format of date fields and money fields.

- [ ] **Step 3:** No commit (investigation only).

---

## Task 3: Write `migrations/004_add_commission_ledger.sql`

**Files:**
- Create: `migrations/004_add_commission_ledger.sql`

- [ ] **Step 1:** Write the migration with **exactly** this content:

```sql
-- migrations/004_add_commission_ledger.sql
-- Per-transaction commission ledger synced from Google Sheets, plus a
-- per-policy aggregation view used by the Portfolio smart-views feature.

CREATE TABLE commission_ledger (
  id                      SERIAL PRIMARY KEY,
  policy_id               INTEGER REFERENCES policies(id) ON DELETE SET NULL,
  carrier_id              INTEGER REFERENCES carriers(id) ON DELETE SET NULL,
  agent_id                INTEGER REFERENCES agents(id) ON DELETE SET NULL,

  -- Identifiers from the source row (kept as raw text for fallback matching)
  transaction_id          TEXT,
  source_policy_number    TEXT,
  matched_policy_number   TEXT,
  carrier_name_raw        TEXT,
  insured_name_raw        TEXT,
  agent_name_raw          TEXT,
  agent_id_raw            TEXT,
  product_raw             TEXT,

  -- Transaction details
  transaction_type        TEXT,
  description             TEXT,
  statement_date          DATE,
  processing_date         DATE,
  issue_date              DATE,

  -- Money fields
  premium                 NUMERIC(12, 2),
  commission_pct          NUMERIC(7, 4),
  advance_pct             NUMERIC(7, 4),
  advance_amount          NUMERIC(12, 2),
  commission_amount       NUMERIC(12, 2),
  net_commission          NUMERIC(12, 2),
  outstanding_balance     NUMERIC(12, 2),
  chargeback_amount       NUMERIC(12, 2),
  recovery_amount         NUMERIC(12, 2),
  net_impact              NUMERIC(12, 2),

  -- Match metadata
  match_type              TEXT,
  match_confidence        TEXT,
  status                  TEXT,
  statement_file          TEXT,
  notes                   TEXT,

  -- Idempotency + housekeeping
  source_row_hash         TEXT NOT NULL UNIQUE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ledger_policy ON commission_ledger(policy_id);
CREATE INDEX idx_ledger_carrier ON commission_ledger(carrier_id);
CREATE INDEX idx_ledger_agent ON commission_ledger(agent_id);
CREATE INDEX idx_ledger_statement_date ON commission_ledger(statement_date);
CREATE INDEX idx_ledger_status ON commission_ledger(status);

CREATE TRIGGER set_updated_at_ledger BEFORE UPDATE ON commission_ledger
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE VIEW policy_commission_summary AS
SELECT
  p.id AS policy_id,
  p.policy_number,
  COALESCE(SUM(cl.advance_amount),       0)::numeric(14, 2) AS total_advance,
  COALESCE(SUM(cl.commission_amount),    0)::numeric(14, 2) AS total_commission,
  COALESCE(SUM(cl.net_commission),       0)::numeric(14, 2) AS total_net_commission,
  COALESCE(SUM(cl.chargeback_amount),    0)::numeric(14, 2) AS total_chargeback,
  COALESCE(SUM(cl.recovery_amount),      0)::numeric(14, 2) AS total_recovery,
  COALESCE(SUM(cl.net_impact),           0)::numeric(14, 2) AS total_net_impact,
  (SELECT outstanding_balance FROM commission_ledger
   WHERE policy_id = p.id ORDER BY statement_date DESC NULLS LAST LIMIT 1) AS outstanding_balance,
  MAX(cl.statement_date) AS last_statement_date,
  (SELECT transaction_type FROM commission_ledger
   WHERE policy_id = p.id ORDER BY statement_date DESC NULLS LAST LIMIT 1) AS last_transaction_type,
  (SELECT status FROM commission_ledger
   WHERE policy_id = p.id ORDER BY statement_date DESC NULLS LAST LIMIT 1) AS commission_status,
  COUNT(cl.id)::int AS ledger_row_count
FROM policies p
LEFT JOIN commission_ledger cl ON cl.policy_id = p.id
GROUP BY p.id, p.policy_number;
```

- [ ] **Step 2:** Sanity-check counts:

```bash
echo "tables: $(grep -c '^CREATE TABLE' migrations/004_add_commission_ledger.sql) (expect 1)"
echo "indexes: $(grep -c '^CREATE INDEX' migrations/004_add_commission_ledger.sql) (expect 5)"
echo "triggers: $(grep -c '^CREATE TRIGGER' migrations/004_add_commission_ledger.sql) (expect 1)"
echo "views: $(grep -c '^CREATE VIEW' migrations/004_add_commission_ledger.sql) (expect 1)"
```

If counts differ, re-check Step 1 content.

- [ ] **Step 3:** Commit:

```bash
git add migrations/004_add_commission_ledger.sql
git commit -m "feat(commission): add commission_ledger table + policy summary view migration"
```

---

## Task 4: Apply migration to Neon

**Files:** none (operational task)

- [ ] **Step 1:** Status:

```bash
node scripts/db-migrate.mjs status 2>&1 | grep -v MODULE_TYPELESS
```

Expected: `001_init.sql` ✓, `002_add_sync_state.sql` ✓, `003_add_portfolio_views.sql` (only if Smart Views plan ran first; otherwise absent), and `· 004_add_commission_ledger.sql (pending)`.

- [ ] **Step 2:** Apply:

```bash
node scripts/db-migrate.mjs up 2>&1 | grep -v MODULE_TYPELESS
```

Expected: `1 pending migration(s):` then `Applying 004_add_commission_ledger.sql...` then `✓ 004_add_commission_ledger.sql` then `Done.`.

- [ ] **Step 3:** Verify table + view exist:

```bash
node --input-type=module -e "
await import('./scripts/load-env.mjs');
const { sql, closeDb } = await import('./src/lib/db.js');
const tables = await sql\`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='commission_ledger'\`;
const views = await sql\`SELECT viewname FROM pg_views WHERE schemaname='public' AND viewname='policy_commission_summary'\`;
console.log('Table commission_ledger:', tables.length === 1 ? 'OK' : 'MISSING');
console.log('View policy_commission_summary:', views.length === 1 ? 'OK' : 'MISSING');
const cols = await sql\`SELECT column_name FROM information_schema.columns WHERE table_name='commission_ledger' ORDER BY ordinal_position\`;
console.log('Column count:', cols.length, '(expect ~33)');
await closeDb();
" 2>&1 | grep -v MODULE_TYPELESS
```

Expected: Table OK, View OK, Column count ~33.

- [ ] **Step 4:** No commit (operational only).

---

## Task 5: Smoke-test the table + view

**Files:** none (creates a temp script, runs it, deletes it)

- [ ] **Step 1:** Write `./ledger-smoke-test.mjs` (in the worktree root so relative imports work):

```bash
cat > ledger-smoke-test.mjs <<'EOF'
import './scripts/load-env.mjs';
import { sql, closeDb } from './src/lib/db.js';

async function run() {
  // Pick an existing policy to attach ledger rows to (or create one)
  let [policy] = await sql`SELECT id, policy_number FROM policies LIMIT 1`;
  if (!policy) {
    const [contact] = await sql`INSERT INTO contacts (phone) VALUES ('5550000001') RETURNING id`;
    [policy] = await sql`INSERT INTO policies (contact_id, policy_number, source_row_hash) VALUES (${contact.id}, 'SMOKE-001', 'smoke-policy-1') RETURNING id, policy_number`;
  }

  // Insert two ledger rows for that policy: an advance and a chargeback
  const [row1] = await sql`
    INSERT INTO commission_ledger (
      policy_id, transaction_type, statement_date, advance_amount, commission_amount, net_impact, source_row_hash, status
    ) VALUES (${policy.id}, 'advance', '2026-04-01', 100.00, 100.00, 100.00, 'smoke-1', 'paid')
    RETURNING id
  `;
  const [row2] = await sql`
    INSERT INTO commission_ledger (
      policy_id, transaction_type, statement_date, chargeback_amount, net_impact, source_row_hash, status
    ) VALUES (${policy.id}, 'chargeback', '2026-04-15', 30.00, -30.00, 'smoke-2', 'chargeback')
    RETURNING id
  `;

  // Query the aggregation view
  const [summary] = await sql`SELECT * FROM policy_commission_summary WHERE policy_id = ${policy.id}`;
  console.log('Summary:', summary);
  if (summary.totalAdvance !== '100.00') throw new Error('total_advance wrong: ' + summary.totalAdvance);
  if (summary.totalChargeback !== '30.00') throw new Error('total_chargeback wrong: ' + summary.totalChargeback);
  if (summary.totalNetImpact !== '70.00') throw new Error('total_net_impact wrong: ' + summary.totalNetImpact);
  if (summary.commissionStatus !== 'chargeback') throw new Error('commission_status wrong: ' + summary.commissionStatus);
  if (summary.lastTransactionType !== 'chargeback') throw new Error('last_transaction_type wrong: ' + summary.lastTransactionType);
  if (summary.ledgerRowCount !== 2) throw new Error('ledger_row_count wrong: ' + summary.ledgerRowCount);
  console.log('Aggregation: OK');

  // ON DELETE SET NULL test: deleting the policy should NOT delete ledger rows but should null their FK
  if (policy.policyNumber === 'SMOKE-001') {
    // Only delete if we created it (otherwise leave the real policy alone)
    await sql`DELETE FROM policies WHERE id = ${policy.id}`;
    const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM commission_ledger WHERE id IN (${row1.id}, ${row2.id})`;
    if (count !== 2) throw new Error('SET NULL did not preserve ledger rows: ' + count);
    const [{ nullCount }] = await sql`SELECT COUNT(*)::int AS null_count FROM commission_ledger WHERE id IN (${row1.id}, ${row2.id}) AND policy_id IS NULL`;
    if (nullCount !== 2) throw new Error('SET NULL did not null FK: ' + nullCount);
    console.log('ON DELETE SET NULL: OK');

    // Cleanup
    await sql`DELETE FROM commission_ledger WHERE id IN (${row1.id}, ${row2.id})`;
    await sql`DELETE FROM contacts WHERE phone = '5550000001'`;
  } else {
    // Just clean the test ledger rows
    await sql`DELETE FROM commission_ledger WHERE id IN (${row1.id}, ${row2.id})`;
  }

  console.log('\nALL LEDGER SMOKE TESTS PASSED ✓');
}

run().catch(e => { console.error('FAIL:', e.message); process.exit(1); }).finally(() => closeDb());
EOF
echo "smoke test written"
```

- [ ] **Step 2:** Run:

```bash
node ledger-smoke-test.mjs 2>&1 | grep -v MODULE_TYPELESS
```

Expected: ends with `ALL LEDGER SMOKE TESTS PASSED ✓`.

- [ ] **Step 3:** Cleanup:

```bash
rm ledger-smoke-test.mjs
```

- [ ] **Step 4:** No commit (verification only).

---

## Task 6: Write pure helpers `commission-ledger-helpers.js`

**Files:**
- Create: `src/lib/db-sync/commission-ledger-helpers.js`
- Create: `src/lib/db-sync/commission-ledger-helpers.test.mjs`

These pure functions are the testable parts of the sync module. Writing them first (TDD) lets us nail down behaviors before the larger orchestration in Task 7.

- [ ] **Step 1:** Write the failing tests at `src/lib/db-sync/commission-ledger-helpers.test.mjs`:

```javascript
// src/lib/db-sync/commission-ledger-helpers.test.mjs
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
```

- [ ] **Step 2:** Run tests to verify they fail (module doesn't exist yet):

```bash
node --test src/lib/db-sync/commission-ledger-helpers.test.mjs 2>&1 | tail -10
```

Expected: ERR_MODULE_NOT_FOUND or similar — the helper file isn't written yet.

- [ ] **Step 3:** Write `src/lib/db-sync/commission-ledger-helpers.js`:

```javascript
// src/lib/db-sync/commission-ledger-helpers.js
import { createHash } from 'node:crypto';

/**
 * Compute a stable hash for a ledger row. Used as the unique idempotency
 * key. Includes the transaction ID + statement date + the four money
 * fields that uniquely identify the financial event.
 */
export function rowHash(row) {
  const parts = [
    row['Transaction ID'] ?? '',
    row['Statement Date'] ?? '',
    row['Advance Amount'] ?? '',
    row['Commission Amount'] ?? '',
    row['Chargeback Amount'] ?? '',
    row['Recovery Amount'] ?? '',
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

/**
 * Parse a date string into a JS Date (UTC midnight). Handles MM/DD/YYYY,
 * MM-DD-YYYY, ISO YYYY-MM-DD, and MM/DD/YY (2-digit year — assumes 20YY
 * since this is forward-looking commission data, not historical archives).
 * Returns null for empty/invalid input.
 */
export function parseDate(s) {
  if (!s) return null;
  let cleaned = s.toString().trim();
  if (!cleaned) return null;
  // Expand 2-digit year MM/DD/YY → MM/DD/20YY (handles ledger Issue Date format)
  const twoDigitYear = cleaned.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2})$/);
  if (twoDigitYear) {
    cleaned = `${twoDigitYear[1]}/${twoDigitYear[2]}/20${twoDigitYear[3]}`;
  }
  // Try ISO first
  let t = Date.parse(cleaned);
  if (!isNaN(t)) return new Date(t);
  // Try MM/DD/YYYY by replacing - with /
  t = Date.parse(cleaned.replace(/-/g, '/'));
  return isNaN(t) ? null : new Date(t);
}

/**
 * Parse a money string into a JS number. Strips $, commas, whitespace.
 * Treats parenthesized values as negative ("($50.25)" → -50.25).
 * Returns null for empty/garbage input.
 */
export function parseMoney(s) {
  if (s == null) return null;
  let str = s.toString().trim();
  if (!str) return null;
  let negative = false;
  if (str.startsWith('(') && str.endsWith(')')) {
    negative = true;
    str = str.slice(1, -1);
  }
  // Strip currency + commas + whitespace
  const cleaned = str.replace(/[$,\s]/g, '');
  const n = parseFloat(cleaned);
  if (isNaN(n)) return null;
  return negative ? -n : n;
}

/**
 * Parse a percentage string into a decimal. "75%" or "75" → 0.75,
 * "0.75" → 0.75. Returns null for empty.
 */
export function parsePct(s) {
  if (s == null) return null;
  const str = s.toString().trim();
  if (!str) return null;
  const cleaned = str.replace(/[%\s]/g, '');
  const n = parseFloat(cleaned);
  if (isNaN(n)) return null;
  // If the raw number is > 1, assume it was meant as percentage (75 → 0.75)
  return n > 1 ? n / 100 : n;
}

/**
 * Normalize a free-text field: trim, collapse whitespace, return null for
 * empty/whitespace-only. Used for raw_*_name fields where empty should
 * land as NULL in the DB rather than empty string.
 */
export function normalizeText(s) {
  if (s == null) return null;
  const cleaned = s.toString().trim().replace(/\s+/g, ' ');
  return cleaned ? cleaned : null;
}
```

- [ ] **Step 4:** Re-run tests to verify they pass:

```bash
node --test src/lib/db-sync/commission-ledger-helpers.test.mjs 2>&1 | tail -10
```

Expected: `pass` count matches the test count (14), `fail 0`.

- [ ] **Step 5:** Commit:

```bash
git add src/lib/db-sync/commission-ledger-helpers.js src/lib/db-sync/commission-ledger-helpers.test.mjs
git commit -m "feat(commission): add commission-ledger helpers with unit tests"
```

---

## Task 7: Write the sync module `commission-ledger.js`

**Files:**
- Create: `src/lib/db-sync/commission-ledger.js`

This module orchestrates: read sheet → resolve FKs → upsert each row. Mirrors the structure of `policies.js`.

- [ ] **Step 1:** Write `src/lib/db-sync/commission-ledger.js`:

```javascript
// src/lib/db-sync/commission-ledger.js
import { sql } from '../db.js';
import { readRawSheet } from '../sheets.js';
import { rowHash, parseDate, parseMoney, parsePct, normalizeText } from './commission-ledger-helpers.js';

/**
 * Sync the Commission Ledger Google Sheet into the commission_ledger
 * Postgres table. Idempotent via source_row_hash. Resolves FKs:
 *   - policy_id by Matched Policy # → policies.policy_number
 *     (falls back to source Policy # if Matched is empty)
 *   - carrier_id by Carrier name → carriers.name (case-sensitive)
 *   - agent_id by Agent name → agents.canonical_name
 *
 * Returns { processed, inserted, updated, skipped, fkResolved, fkUnresolved }.
 *
 * Note on rounding: commission_pct and advance_pct from the sheet may exceed
 * the column's NUMERIC(7, 4) precision (e.g. very long decimals). We round
 * to 4 decimal places before insert.
 */
export async function syncCommissionLedger() {
  // Commission Ledger is a tab WITHIN the Sales Tracker sheet (not the
  // standalone Commission rate-table sheet). The COMMISSION_SHEET_ID env
  // var points at the rate table; the ledger lives in SALES_SHEET_ID.
  const sheetId = process.env.SALES_SHEET_ID;
  const tab = process.env.COMMISSION_LEDGER_TAB || 'Commission Ledger';
  if (!sheetId) throw new Error('SALES_SHEET_ID not set');

  // Pre-load FK lookup maps
  const policiesByNumber = new Map();
  for (const p of await sql`SELECT id, policy_number FROM policies WHERE policy_number IS NOT NULL AND policy_number != ''`) {
    policiesByNumber.set(p.policyNumber, p.id);
  }
  const carriersByName = new Map();
  for (const c of await sql`SELECT id, name FROM carriers`) carriersByName.set(c.name, c.id);
  const agentsByName = new Map();
  for (const a of await sql`SELECT id, canonical_name FROM agents`) agentsByName.set(a.canonicalName, a.id);

  const { data } = await readRawSheet(sheetId, tab);
  let inserted = 0, updated = 0, skipped = 0, fkResolved = 0, fkUnresolved = 0;

  for (const row of data) {
    const txId = (row['Transaction ID'] ?? '').toString().trim();
    if (!txId) { skipped++; continue; }

    // FK resolution
    const matchedPolicyNumber = (row['Matched Policy #'] ?? '').toString().trim() || null;
    const sourcePolicyNumber = (row['Policy #'] ?? '').toString().trim() || null;
    const lookupPolicy = matchedPolicyNumber || sourcePolicyNumber;
    const policyId = lookupPolicy ? (policiesByNumber.get(lookupPolicy) ?? null) : null;

    const carrierName = (row['Carrier'] ?? '').toString().trim();
    const carrierId = carrierName ? (carriersByName.get(carrierName) ?? null) : null;

    const agentName = (row['Agent'] ?? '').toString().trim();
    const agentId = agentName ? (agentsByName.get(agentName) ?? null) : null;

    if (policyId) fkResolved++; else fkUnresolved++;

    const hash = rowHash(row);

    // Round percentages to 4 dp to fit NUMERIC(7, 4)
    const commissionPct = parsePct(row['Commission %']);
    const advancePct = parsePct(row['Advance %']);
    const commissionPctRounded = commissionPct == null ? null : Math.round(commissionPct * 10000) / 10000;
    const advancePctRounded = advancePct == null ? null : Math.round(advancePct * 10000) / 10000;

    const r = await sql`
      INSERT INTO commission_ledger (
        policy_id, carrier_id, agent_id,
        transaction_id, source_policy_number, matched_policy_number,
        carrier_name_raw, insured_name_raw, agent_name_raw, agent_id_raw, product_raw,
        transaction_type, description,
        statement_date, processing_date, issue_date,
        premium, commission_pct, advance_pct,
        advance_amount, commission_amount, net_commission, outstanding_balance,
        chargeback_amount, recovery_amount, net_impact,
        match_type, match_confidence, status, statement_file, notes,
        source_row_hash
      ) VALUES (
        ${policyId}, ${carrierId}, ${agentId},
        ${txId}, ${sourcePolicyNumber}, ${matchedPolicyNumber},
        ${normalizeText(row['Carrier'])}, ${normalizeText(row['Insured Name'])}, ${normalizeText(row['Agent'])}, ${normalizeText(row['Agent ID'])}, ${normalizeText(row['Product'])},
        ${normalizeText(row['Transaction Type'])}, ${normalizeText(row['Description'])},
        ${parseDate(row['Statement Date'])}, ${parseDate(row['Processing Date'])}, ${parseDate(row['Issue Date'])},
        ${parseMoney(row['Premium'])}, ${commissionPctRounded}, ${advancePctRounded},
        ${parseMoney(row['Advance Amount'])}, ${parseMoney(row['Commission Amount'])}, ${parseMoney(row['Net Commission'])}, ${parseMoney(row['Outstanding Balance'])},
        ${parseMoney(row['Chargeback Amount'])}, ${parseMoney(row['Recovery Amount'])}, ${parseMoney(row['Net Impact'])},
        ${normalizeText(row['Match Type'])}, ${normalizeText(row['Match Confidence'])}, ${normalizeText(row['Status'])}, ${normalizeText(row['Statement File'])}, ${normalizeText(row['Notes'])},
        ${hash}
      )
      ON CONFLICT (source_row_hash) DO UPDATE SET
        status = EXCLUDED.status,
        notes = EXCLUDED.notes,
        matched_policy_number = EXCLUDED.matched_policy_number,
        policy_id = EXCLUDED.policy_id,
        match_type = EXCLUDED.match_type,
        match_confidence = EXCLUDED.match_confidence,
        updated_at = NOW()
      RETURNING (xmax = 0) AS inserted
    `;
    if (r[0]?.inserted) inserted++;
    else updated++;
  }

  return { processed: data.length, inserted, updated, skipped, fkResolved, fkUnresolved };
}
```

- [ ] **Step 2:** Verify it loads + exports correctly:

```bash
node --input-type=module -e "
import('./src/lib/db-sync/commission-ledger.js').then(m => {
  console.log('exports:', Object.keys(m).join(', '));
  if (typeof m.syncCommissionLedger !== 'function') { console.error('FAIL'); process.exit(1); }
  console.log('OK');
});
" 2>&1 | grep -v MODULE_TYPELESS
```

Expected: `exports: syncCommissionLedger` then `OK`.

- [ ] **Step 3:** Commit:

```bash
git add src/lib/db-sync/commission-ledger.js
git commit -m "feat(commission): add commission-ledger sync module"
```

---

## Task 8: Run the sync against live data

**Files:** none (verification)

- [ ] **Step 1:** Run the sync once and capture metrics:

```bash
node --input-type=module -e "
await import('./scripts/load-env.mjs');
const { syncCommissionLedger } = await import('./src/lib/db-sync/commission-ledger.js');
const r = await syncCommissionLedger();
console.log('Result:', r);
const { sql, closeDb } = await import('./src/lib/db.js');
const [{ n: total }] = await sql\`SELECT COUNT(*)::int AS n FROM commission_ledger\`;
const [{ n: withPolicy }] = await sql\`SELECT COUNT(*)::int AS n FROM commission_ledger WHERE policy_id IS NOT NULL\`;
const [{ n: withCarrier }] = await sql\`SELECT COUNT(*)::int AS n FROM commission_ledger WHERE carrier_id IS NOT NULL\`;
console.log('Total:', total, '| With FK policy:', withPolicy, '| With FK carrier:', withCarrier);
await closeDb();
" 2>&1 | grep -v MODULE_TYPELESS
```

Expected: a few hundred to a few thousand rows ingested, `processed === inserted + updated + skipped`. FK policy resolution rate > 80% (most rows have a matched policy number; some won't and that's fine — those FKs are NULL but data still ingested). Skipped rows are those with no Transaction ID.

- [ ] **Step 2:** Re-run for idempotency:

```bash
node --input-type=module -e "
await import('./scripts/load-env.mjs');
const { syncCommissionLedger } = await import('./src/lib/db-sync/commission-ledger.js');
console.log(await syncCommissionLedger());
" 2>&1 | grep -v MODULE_TYPELESS
```

Expected: `inserted: 0, updated: N, skipped: M` (everything was already there).

- [ ] **Step 3:** Sample the aggregation view:

```bash
node --input-type=module -e "
await import('./scripts/load-env.mjs');
const { sql, closeDb } = await import('./src/lib/db.js');
const top = await sql\`SELECT * FROM policy_commission_summary WHERE ledger_row_count > 0 ORDER BY total_commission DESC LIMIT 5\`;
for (const r of top) console.log(r.policyNumber, '| commission:', r.totalCommission, '| outstanding:', r.outstandingBalance, '| status:', r.commissionStatus);
await closeDb();
" 2>&1 | grep -v MODULE_TYPELESS
```

Expected: 5 rows of real policies with realistic commission values.

- [ ] **Step 4:** No commit (verification only).

---

## Task 9: Wire into pipeline orchestrator

**Files:**
- Modify: `src/lib/db-sync/pipeline.js`

- [ ] **Step 1:** Read the current file:

```bash
cat src/lib/db-sync/pipeline.js | head -30
```

You'll see the orchestration array around lines 18–28. Each entry is `[key, fn]`.

- [ ] **Step 2:** Add the import line. Find this block at the top of the file:

```jsx
import { sql } from '../db.js';
import { syncCampaigns } from './campaigns.js';
import { syncCarriersAndProducts } from './carriers-products.js';
import { syncAgents } from './agents.js';
import { syncContacts } from './contacts.js';
import { syncPolicies } from './policies.js';
import { syncCalls } from './calls.js';
import { refreshContactDenorms } from './refresh-denorms.js';
```

Add one line after `syncCalls`:

```jsx
import { sql } from '../db.js';
import { syncCampaigns } from './campaigns.js';
import { syncCarriersAndProducts } from './carriers-products.js';
import { syncAgents } from './agents.js';
import { syncContacts } from './contacts.js';
import { syncPolicies } from './policies.js';
import { syncCalls } from './calls.js';
import { syncCommissionLedger } from './commission-ledger.js';
import { refreshContactDenorms } from './refresh-denorms.js';
```

- [ ] **Step 3:** Add the new step to the orchestration array. Find:

```jsx
  for (const [key, fn] of [
    ['campaigns', syncCampaigns],
    ['carriers_products', syncCarriersAndProducts],
    ['agents', syncAgents],
    ['contacts', syncContacts],
    ['policies', syncPolicies],
    ['calls', syncCalls],
    ['refresh_denorms', refreshContactDenorms],
  ]) {
```

Insert one entry between `'calls'` and `'refresh_denorms'`:

```jsx
  for (const [key, fn] of [
    ['campaigns', syncCampaigns],
    ['carriers_products', syncCarriersAndProducts],
    ['agents', syncAgents],
    ['contacts', syncContacts],
    ['policies', syncPolicies],
    ['calls', syncCalls],
    ['commission_ledger', syncCommissionLedger],
    ['refresh_denorms', refreshContactDenorms],
  ]) {
```

The order matters: `commission_ledger` must run AFTER `policies` (depends on policies for FK resolution) and BEFORE `refresh_denorms` (refresh-denorms is the last step).

- [ ] **Step 4:** Build to verify import wiring:

```bash
npm run build 2>&1 | tail -8
```

Expected: succeeds.

- [ ] **Step 5:** Commit:

```bash
git add src/lib/db-sync/pipeline.js
git commit -m "feat(commission): wire commission-ledger sync into pipeline orchestrator"
```

---

## Task 10: Run the full pipeline end-to-end

**Files:** none (verification)

- [ ] **Step 1:** Run the full pipeline:

```bash
node --input-type=module -e "
await import('./scripts/load-env.mjs');
const { runFullSync } = await import('./src/lib/db-sync/pipeline.js');
const r = await runFullSync();
console.log(JSON.stringify(r, null, 2));
" 2>&1 | grep -v MODULE_TYPELESS | tail -50
```

Expected: each step shows `ok: true` including the new `commission_ledger` step. Total runtime should be similar to before (commission ledger has fewer rows than calls/contacts).

- [ ] **Step 2:** Verify `sync_state` recorded the success:

```bash
node --input-type=module -e "
await import('./scripts/load-env.mjs');
const { sql, closeDb } = await import('./src/lib/db.js');
const r = await sql\`SELECT source_key, last_sync_at, last_run_status, rows_processed FROM sync_state ORDER BY source_key\`;
for (const s of r) console.log(s.sourceKey, '|', s.lastRunStatus, '|', s.rowsProcessed, 'rows', '| at', s.lastSyncAt);
await closeDb();
" 2>&1 | grep -v MODULE_TYPELESS
```

Expected: 8 source_key entries (the original 7 + new `commission_ledger`), all `success`.

- [ ] **Step 3:** No commit (verification only).

---

## Task 11: Document in `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1:** Find the existing "TCC Database (Postgres on Neon)" section in `CLAUDE.md` and identify the "Schema" subsection. Currently it lists 7 entity tables.

- [ ] **Step 2:** Use Edit to update the "Schema" subsection. Find:

```markdown
### Schema

7 entity tables + `_migrations`:

- `contacts` (phone-keyed, parent of calls + policies)
- `calls` (FK contact, campaign, agent; row_hash for idempotent sync)
- `policies` (FK contact, carrier, product, campaign, agent; source_row_hash for idempotent sync)
- `campaigns`, `carriers`, `products`, `agents` (reference data)
```

Replace with:

```markdown
### Schema

8 entity tables + `_migrations` + `sync_state`:

- `contacts` (phone-keyed, parent of calls + policies)
- `calls` (FK contact, campaign, agent; row_hash for idempotent sync)
- `policies` (FK contact, carrier, product, campaign, agent; source_row_hash for idempotent sync)
- `commission_ledger` (FK policy, carrier, agent; per-transaction commission events synced from the Commission Ledger sheet)
- `campaigns`, `carriers`, `products`, `agents` (reference data)

Plus the `policy_commission_summary` VIEW that aggregates ledger rows per policy (total advance, total commission, outstanding balance, last statement date, current status, etc.).
```

- [ ] **Step 3:** Verify the edit landed:

```bash
grep -A1 "8 entity tables" CLAUDE.md
```

Expected: the new heading + the line below.

- [ ] **Step 4:** Commit:

```bash
git add claude.md
git commit -m "docs(commission): document commission_ledger table + summary view"
```

(Note: macOS case-insensitive filesystem means `CLAUDE.md` and `claude.md` are the same file. Git tracks it as `claude.md` lowercase.)

---

## Task 12: Push the branch

**Files:** none

- [ ] **Step 1:** Push:

```bash
git push -u origin feature/commission-ledger-sync
```

Expected: branch pushed; PR creation hint printed.

**Phase 1 of the smart-views project is done.** The DB now has commission data, the pipeline keeps it fresh every 30 min, and the per-policy aggregation view is ready to be consumed by the upcoming Smart Views feature.

---

# Done — what you have

After Task 12, your branch contains:

- ✅ New `commission_ledger` table (33 columns, 5 indexes, 1 trigger)
- ✅ New `policy_commission_summary` VIEW that aggregates ledger rows per policy
- ✅ New sync module mirroring the existing `policies.js` pattern
- ✅ 12 unit tests for pure helpers (rowHash, parseDate, parseMoney, parsePct, normalizeText)
- ✅ Pipeline orchestrator wired (8 sync steps now, was 7)
- ✅ End-to-end verified: live ledger rows in DB, per-policy aggregation works
- ✅ Documentation updated in CLAUDE.md
