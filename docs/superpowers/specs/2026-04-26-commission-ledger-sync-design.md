# Commission Ledger → Postgres Sync — Design Spec

**Date:** 2026-04-26
**Status:** Approved
**Scope:** Add a sync module that mirrors the `Commission Ledger` Google Sheet tab into a new Postgres table, plus an aggregation view that rolls up per-policy totals. Wired into the existing pipeline orchestrator so it runs alongside the other sync modules every 30 min.

## Goal

Make commission data (advances, chargebacks, recoveries, outstanding balances) queryable from Postgres so the upcoming Smart Views feature can filter and display it. Also positions a future cleanup where the existing Commission Status / Period Revenue / Carrier Balances tabs can read from the DB instead of the sheets.

## Out of scope

- Rewriting the existing CommissionStatusTable, PeriodRevenueTable, CarrierBalancesTable to use the DB. They keep reading from sheets unchanged. (Future cleanup once smart views proves the DB-backed path.)
- Two-way sync (DB → sheet). One-way only.
- Statement-file-level metadata (Statement File / Statement Date come along as columns but we don't model statements as their own entity).

## Source

Existing Google Sheet — `COMMISSION_SHEET_ID` / `COMMISSION_TAB_NAME` env vars (currently `Commission Ledger` tab in the commission statements sheet). Columns (per `CLAUDE.md` and existing code):

```
Transaction ID | Statement Date | Processing Date | Carrier | Policy # |
Insured Name | Agent | Agent ID | Transaction Type | Description | Product |
Issue Date | Premium | Commission % | Advance % | Advance Amount |
Commission Amount | Net Commission | Outstanding Balance | Chargeback Amount |
Recovery Amount | Net Impact | Matched Policy # | Match Type | Match Confidence |
Status | Statement File | Notes
```

The existing `/api/cron/rebuild-statement-records` job already maintains this tab (deduping, matching, etc.). We sync from it AS-IS — the carrier-statements pipeline is the source of truth for ledger data.

## Architecture

### New Postgres table

```sql
CREATE TABLE commission_ledger (
  id                      SERIAL PRIMARY KEY,
  policy_id               INTEGER REFERENCES policies(id) ON DELETE SET NULL,
  carrier_id              INTEGER REFERENCES carriers(id) ON DELETE SET NULL,
  agent_id                INTEGER REFERENCES agents(id) ON DELETE SET NULL,

  -- Identifiers from the source row
  transaction_id          TEXT,
  source_policy_number    TEXT,                     -- "Policy #" col (carrier-supplied)
  matched_policy_number   TEXT,                     -- "Matched Policy #" col (post-match resolution)
  carrier_name_raw        TEXT,
  insured_name_raw        TEXT,
  agent_name_raw          TEXT,
  agent_id_raw            TEXT,
  product_raw             TEXT,

  -- Transaction details
  transaction_type        TEXT,                     -- "advance" | "commission" | "chargeback" | "recovery" | "reversal" | etc.
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

  -- Match metadata (from the existing reconciliation logic)
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
```

### Per-policy aggregation view

```sql
CREATE VIEW policy_commission_summary AS
SELECT
  p.id AS policy_id,
  p.policy_number,
  COALESCE(SUM(cl.advance_amount),       0) AS total_advance,
  COALESCE(SUM(cl.commission_amount),    0) AS total_commission,
  COALESCE(SUM(cl.net_commission),       0) AS total_net_commission,
  COALESCE(SUM(cl.chargeback_amount),    0) AS total_chargeback,
  COALESCE(SUM(cl.recovery_amount),      0) AS total_recovery,
  COALESCE(SUM(cl.net_impact),           0) AS total_net_impact,
  -- "Outstanding balance" is the LATEST value seen, not a sum (it represents current state)
  (SELECT outstanding_balance FROM commission_ledger
   WHERE policy_id = p.id ORDER BY statement_date DESC NULLS LAST LIMIT 1) AS outstanding_balance,
  MAX(cl.statement_date) AS last_statement_date,
  -- "Last transaction type" is the type of the most recent transaction
  (SELECT transaction_type FROM commission_ledger
   WHERE policy_id = p.id ORDER BY statement_date DESC NULLS LAST LIMIT 1) AS last_transaction_type,
  -- Status rollup: derived from the latest transaction's `status` column
  (SELECT status FROM commission_ledger
   WHERE policy_id = p.id ORDER BY statement_date DESC NULLS LAST LIMIT 1) AS commission_status,
  COUNT(cl.id) AS ledger_row_count
FROM policies p
LEFT JOIN commission_ledger cl ON cl.policy_id = p.id
GROUP BY p.id, p.policy_number;
```

A plain (non-materialized) view. Each query against it re-aggregates, but the `commission_ledger` table won't be huge (low thousands of rows, not millions) and the indexes on `policy_id` keep aggregation fast. If performance becomes a problem later, switch to a materialized view refreshed at the end of each sync run.

### New sync module

`src/lib/db-sync/commission-ledger.js` — mirrors the pattern in `policies.js` and `calls.js`:

```js
export async function syncCommissionLedger() {
  // 1. Read sheet
  // 2. Pre-load lookup maps: policies-by-policy-number, carriers-by-name, agents-by-name
  // 3. For each row:
  //    - Compute row_hash = sha256(transaction_id + statement_date + amount fields)
  //    - Resolve FKs (policy_id from matched_policy_number → policies.policy_number; carrier_id; agent_id)
  //    - INSERT ... ON CONFLICT (source_row_hash) DO UPDATE on the dynamic fields (status, notes, matched_policy_number)
  //      — the money fields and dates are immutable per transaction so we don't need to touch them on update.
  // 4. Return { processed, inserted, updated, skipped, fkResolved, fkUnresolved }.
}
```

Same shape as the other sync modules: pure data transform + UPSERT. Continue-on-error per row (log to `sync_state` like the others). Returns counts for the pipeline orchestrator's success/error reporting.

### Integration with existing pipeline

`src/lib/db-sync/pipeline.js` (existing) gets one new entry in its sequential array:

```js
['commission_ledger', syncCommissionLedger],
```

Inserted AFTER `'policies'` (since FK resolution depends on policies being present) and BEFORE `'refresh_denorms'`.

### `sync_state` tracking

The existing `sync_state` table already supports per-source last-sync timestamps and error tracking. The new module uses `source_key='commission_ledger'`. No schema changes.

## Migration

`migrations/004_add_commission_ledger.sql` (single migration creates both the table + view).

## FK resolution

The Commission Ledger has carrier names like "American Amicable" / "Transamerica" matching `carriers.name`. Agents like "William Shansky" matching `agents.canonical_name`. Policy numbers in the `Matched Policy #` column matching `policies.policy_number`.

If a match fails (carrier not in DB, agent typo, unmatched policy), the FK is left NULL and we increment `fkUnresolved`. The row still gets ingested — we keep the raw text in `*_raw` columns so smart-view queries can fall back to text matching if needed.

## Idempotency

`source_row_hash` is computed from `(transaction_id || statement_date || advance_amount || commission_amount || chargeback_amount || recovery_amount)`. Two reasons:

1. The carrier-statements pipeline sometimes regenerates the ledger with the same transactions but different row IDs. Hashing the actual transaction content catches duplicates.
2. If a row gets corrected (rare — usually adds), the hash changes and we insert a new row instead of overwriting.

`UNIQUE` constraint on `source_row_hash` + `ON CONFLICT (source_row_hash) DO UPDATE` gives idempotent upsert.

## Acceptance criteria

1. Migration creates `commission_ledger` table + 5 indexes + trigger + `policy_commission_summary` view
2. Running `syncCommissionLedger()` once with the live ledger inserts ~all rows (whatever count is in the source) with FK resolution rate > 90% on policy_id (most rows have a matched policy number)
3. Re-running is idempotent — `inserted=0, updated=N or 0` on the second run
4. The pipeline orchestrator includes the new step and `sync_state` shows `success` after a full run
5. `SELECT * FROM policy_commission_summary WHERE policy_id = X` returns one row per policy with rolled-up totals
6. `npm run build` passes; `npm test` passes

## Estimate

~3 hours of work:

1. Migration `004_add_commission_ledger.sql` — table, indexes, view (~30 min)
2. `commission-ledger.js` sync module mirroring `policies.js` (~1.5 hours)
3. Pipeline integration + smoke test (~30 min)
4. Documentation update in CLAUDE.md (~30 min)
