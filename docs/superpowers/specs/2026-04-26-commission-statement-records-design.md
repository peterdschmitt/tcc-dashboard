# Commission Statement Records — Design Spec

**Date:** 2026-04-26
**Status:** Draft — pending implementation plan
**Owner:** Peter Schmitt

## Problem

We are diagnosing discrepancies between the agency commission statements we receive from carriers and what the business is manually recording in the sales tracker. The raw per-line ledger entries already exist in the `Commission Ledger` tab, but there is no precomputed, browseable surface that organizes them per policy holder per statement period. Today, finding "what did the carrier pay us for Jane Doe across all statements?" requires either ad-hoc filtering of the ledger or recomputing rollups on every page load.

## Goal

Build a three-level browseable view of carrier statement data, with the rollups persisted to the Sales sheet so reads are instant and rebuilds are explicit.

- **Level 1 (master)** — one row per policy holder, aggregated across all carriers and statement periods.
- **Level 2 (leaves)** — one row per `(policy holder × statement file × policy #)`, the per-period view the user described as the "lowest level."
- **Level 3 (raw)** — the underlying line items from `Commission Ledger` for one statement, surfaced live in the drill-down (not persisted as a new tab).

The master view lives prominently inside the existing `Commission Statements` tab as a new sub-view. A globally-mounted slide-out drawer makes Level 2 reachable from any of the six commission-related tables in the dashboard.

## Non-goals

- Editing statement data from the new view. Edits flow through the existing statement upload / approval pipelines.
- Fuzzy name reconciliation across holder records. v1 uses deterministic normalization only; merging visibly-distinct holders that are actually the same person is a manual / future task.
- Replacing the existing `Commission Reconciliation` view, which compares carrier vs. ledger at the policy level. The new view sits alongside it and addresses a different question (per-holder roll-up across periods).

## Architecture

```
Statement upload / Drive sync
        │
        ▼
Commission Ledger tab (raw line items — already exists)
        │
        ▼
Rollup builder (new — src/lib/statement-records.js)
        │
        ├─► Statement Records — Holders   (Level 1 master)
        └─► Statement Records — Periods   (Level 2 leaves)
                  │
                  ▼
        /api/statement-records/* (read-only)
                  │
        ┌─────────┴─────────┐
        ▼                   ▼
  Commission Statements      StatementRecordDrawer
  master view (new)         (mounted globally,
                             opened from any of
                             the 6 commission tables)
```

The rebuild is idempotent: it reads the entire `Commission Ledger`, recomputes both rollup tabs, and overwrites them. There is no incremental update path in v1.

## Sheet schemas

Two new tabs in the Sales sheet (`SALES_SHEET_ID`).

### `Statement Records — Holders` — one row per policy holder

| Column | Notes |
|---|---|
| `Holder Key` | Stable ID = normalized `last\|first` (lowercased, punctuation stripped, suffixes and middle initials removed). Idempotent upsert key. |
| `Insured Name` | Display name |
| `Policies` | Comma-joined policy numbers across carriers |
| `Policy Count` | int |
| `Carriers` | Comma-joined unique carriers |
| `Statement Count` | distinct statement files this holder appears in |
| `First Period` | e.g. `2026-02` |
| `Last Period` | e.g. `2026-04` |
| `Total Advances` | sum |
| `Total Commissions` | sum |
| `Total Chargebacks` | sum |
| `Total Recoveries` | sum |
| `Net Total` | Advances + Commissions − Chargebacks + Recoveries |
| `Outstanding Balance` | latest from most recent statement for this holder |
| `Expected Net` | from sales tracker (premium × multiplier; 1.5× for GIWL, 3× standard). Blank if no policy match. |
| `Variance` | Net Total − Expected Net. Blank if Expected Net is blank. |
| `Agents` | comma-joined writing agents from sales tracker |
| `Status` | derived: `healthy` / `chargeback` / `outstanding` / `variance` / `unmatched` |
| `Last Rebuilt` | ISO timestamp |

### `Statement Records — Periods` — one row per `(holder × statement file × policy #)`

| Column | Notes |
|---|---|
| `Row Key` | `${holderKey}\|${statementFile}\|${policyNumber}` — idempotent upsert key |
| `Holder Key` | FK to master |
| `Insured Name` | |
| `Policy #` | |
| `Carrier` | |
| `Statement Period` | e.g. `2026-03` |
| `Statement Date` | from the ledger row |
| `Statement File` | filename |
| `Statement File ID` | Drive file ID (for "View original PDF" link) |
| `Premium` | sum of line items in this statement for this policy |
| `Advance Amount` | |
| `Commission Amount` | |
| `Chargeback Amount` | |
| `Recovery Amount` | |
| `Net Impact` | |
| `Outstanding Balance` | latest from this statement |
| `Line Item Count` | for "3 lines — click for raw" hint in the drawer |
| `Notes` | concatenated unique notes |

Level 3 is not persisted. The raw line items are queried live from `Commission Ledger` filtered by `Statement File = X AND Insured Name = Y` when the user expands a Level 2 row.

### Env vars

```
STATEMENT_HOLDERS_TAB=Statement Records — Holders
STATEMENT_PERIODS_TAB=Statement Records — Periods
```

## Library — `src/lib/statement-records.js`

Pure functions, table-driven unit tests:

- `buildHolderKey(firstName, lastName)` — normalized stable ID. Lowercases, strips punctuation, strips middle initials and suffixes (Jr, Sr, II, III, IV), produces `last|first`.
- `groupLedgerByHolder(ledgerRows)` — returns `Map<holderKey, ledgerRows[]>`.
- `buildHolderRow(holderKey, ledgerRows, salesRows)` — produces one Holders-tab row, including `Expected Net` and `Variance`. `salesRows` is the array of matching rows from the sales tracker for this holder (multi-policy holders have >1).
- `buildPeriodRows(holderKey, ledgerRows)` — produces N Periods-tab rows, one per `(statement file × policy #)`.
- `rebuildStatementRecords()` — composer: fetches ledger + sales, groups, builds, idempotently overwrites both tabs. Returns `{ holders, periods, durationMs }`.

Variance status thresholds (constants in this file, easy to tune):

```js
export const VARIANCE_THRESHOLDS = { green: 10, yellow: 50 }; // dollars
```

## APIs — `src/app/api/statement-records/`

| Method & path | Purpose | Returns |
|---|---|---|
| `POST /api/statement-records/init` | Create the two tabs with headers if missing | `{ created: [...] }` |
| `POST /api/statement-records/rebuild` | Recompute both tabs from `Commission Ledger`. Body: `{ holderKey?: string }` for optional partial rebuild. Gated by `CRON_SECRET` if env var is set. | `{ holders: N, periods: M, durationMs }` |
| `GET /api/statement-records` | Master list. Query: `?search=&status=&sort=&dir=` | `{ holders: [...], lastRebuilt }` |
| `GET /api/statement-records/[holderKey]` | Drawer data: holder summary + all period rows | `{ holder, periods }` |
| `GET /api/statement-records/lines?statementFile=&insuredName=` | Level 3 raw line items, live from `Commission Ledger` | `{ lines, statement: { fileId, period } }` |

## UI — master view

Add a new sub-tab pill inside `CommissionStatementsTab.jsx` in the **first** position, label `Holder Records`. Final order:

```
[Holder Records] [Upload] [Statements] [Reconciliation] [Waterfall] [Pending Review]
```

**Layout:**

- **KPI row:** `Total Holders` · `Total Advances` · `Total Chargebacks` · `Outstanding` · `Total Variance` (variance KPI colored red/yellow/green using `VARIANCE_THRESHOLDS`).
- **Toolbar:** search box (filter by holder name or policy #), status filter chips (`All` `Variance ≠ 0` `Chargebacks` `Outstanding > 0` `Healthy` `Unmatched`), `Rebuild rollups` button, "Last rebuilt: 2 min ago" muted text.
- **`SortableTable`** with the 17 Holders-tab columns. Variance column color-coded per the thresholds.
- **Row click** opens `StatementRecordDrawer`.

## UI — `StatementRecordDrawer`

New component at `src/components/StatementRecordDrawer.jsx`. Slide-out from right edge, ~65% viewport width, dark theme. Mounted **once at the `Dashboard.jsx` top level** so it is reachable from any tab.

**Drawer content:**

1. **Header** — Holder name, policy badges, carrier badges. Link `Open in Holder Records ↗` (closes drawer + switches to `Commission Statements` tab focused on this holder).
2. **KPI row** — Net Total, Variance, Outstanding, # Statements.
3. **Periods table** — sortable, columns: `Statement File` `Carrier` `Period` `Policy #` `Premium` `Adv` `Chgbk` `Rec` `Net` `Lines (n)`. Click any row → expands an inline detail panel below.
4. **Inline detail panel** (Level 3) — appears when a period row is clicked. Lists the raw line items from `Commission Ledger` for that statement+holder. Includes `View original PDF ↗` link to the Drive file.

**Drawer state mechanism:**

A new React context `StatementRecordDrawerContext` provided at `Dashboard.jsx`:

```js
const { openDrawer } = useStatementRecordDrawer();
openDrawer({ holderName: 'Jane Doe', policyNumber: 'A12345' });
```

The provider computes the holder key from `holderName` using `buildHolderKey(...)` (the same normalization the rebuild uses), then calls `GET /api/statement-records/[holderKey]`. If `policyNumber` is supplied, it is forwarded as `?policyNumber=` and the API uses it as a tiebreaker (returning only the holder whose `Policies` cell contains that policy #) when multiple normalized-name collisions exist. The drawer renders itself when state is non-null.

## Click-through wiring

Pattern: trailing `Statements` column with a small `📄` icon button per row. Consistent across all six tables, doesn't disturb existing row-click handlers.

```jsx
<td>
  <button onClick={(e) => {
    e.stopPropagation();
    openDrawer({ holderName: r.insuredName, policyNumber: r.policyNumber });
  }}>📄</button>
</td>
```

Files to touch (one column add per file):

1. `src/components/CommissionStatusTable.jsx`
2. `src/components/tabs/CommissionReconciliationTab.jsx`
3. `src/components/PeriodRevenueTable.jsx`
4. `src/components/CarrierBalancesTable.jsx`
5. `src/components/tabs/CombinedPoliciesTab.jsx`
6. `src/components/Dashboard.jsx` — Daily Activity drill-down policy table

Header tooltip: "View carrier statement records for this customer".

## Refresh hooks

`rebuildStatementRecords()` is called synchronously at the end of every route that mutates `Commission Ledger`, so the UI sees fresh rollups immediately:

| Existing route | Hook |
|---|---|
| `POST /api/commission-statements/upload` | call after ledger write |
| `POST /api/commission-statements/sync-drive` | call once after batch completes |
| `POST /api/commission-statements/dedup` | call after dedup writes |
| `POST /api/commission-statements/approve` | call after approval write |
| `POST /api/commission-statements/rematch` | call after rematch writes |

Plus a defensive daily cron at 02:00 via the existing cron pattern (`/api/cron/rebuild-statement-records`) — catches anything that slipped past the inline hooks.

The manual `Rebuild rollups` button on the master view covers the on-demand case.

## Edge cases

| Case | Handling |
|---|---|
| **Name variants** ("John A. Doe" vs "JOHN DOE" vs "Doe, John") | `buildHolderKey` lowercases, strips punctuation, strips middle initials and suffixes (Jr/Sr/II/III/IV), produces `last\|first`. Deterministic only, no fuzzy in v1. |
| **Unmatched ledger entries** (carrier names a holder with no policy in sales tracker) | Still appears in Holders tab. `Policies = ""`, `Expected Net = ""`, `Variance = ""`, `Status = unmatched`. |
| **Multi-policy holders** | Holder row aggregates across policies; Period rows keep per-policy breakdown. |
| **Same name, different person** (collision) | Click-through always passes `policyNumber` when available. Drawer scopes to the holder row whose `Policies` contains that policy #, breaking ties. |
| **Click from a row with no statement records yet** | Drawer renders an empty state: "No carrier statements found for this customer yet." |
| **Statement reprocessed / deleted** | Idempotent rebuild handles this — full rewrite of both tabs each time. Stale rows are dropped. |
| **Variance thresholds** | Green ≤ $10, yellow $10–$50, red > $50. Constants in `statement-records.js`, easy to tune. |
| **Concurrent rebuilds** | Acceptable race for v1 (last write wins). Future: in-process lock. |

## Testing

- **Unit tests** (Vitest, new) for `src/lib/statement-records.js` — pure functions, table-driven:
  - `buildHolderKey`: suffixes, initials, punctuation, casing, comma-form
  - `groupLedgerByHolder`: dedup by key, multi-policy
  - `buildHolderRow`: with/without sales match, GIWL multiplier, variance sign
  - `buildPeriodRows`: multi-line statement collapses to one period row per `(file × policy)`
- **API smoke test** — hit `/api/statement-records/rebuild` then `/api/statement-records` and assert non-empty `holders` with expected shape.
- **Manual UI smoke** — verify drawer opens from each of the six tables; verify `policyNumber` collision scoping with a synthetic duplicate name.

## Open questions

None at design time. Tunable constants (variance thresholds, drawer width) are hardcoded in v1 with comments noting they can be promoted to env vars or a settings tab later.
