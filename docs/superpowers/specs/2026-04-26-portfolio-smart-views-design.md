# Portfolio Smart Views — Design Spec

**Date:** 2026-04-26
**Status:** Approved
**Scope:** User-creatable, shared smart views in the Portfolio tab. Each view saves a complete dashboard configuration (filters, columns, sort, group-by) that any team member can apply with one click. Replaces the current 6 hardcoded smart lists with an editable, extensible system.

## Goal

Let anyone on the team save a working configuration of the Portfolio (which contacts they're looking at, which columns are visible, how they're sorted/grouped) as a named "view," and let everyone else restore that exact configuration with a click.

## Out of scope (V2 territory)

These are explicitly NOT in V1 to keep the project focused:

- Per-user permissions / ACLs — every user can edit every view
- Version history / undo on view edits
- Activity log (who changed what when)
- Per-user favorites (pinning is global)
- Deep-link sharing via URL (e.g., `/portfolio?view=42`)
- Bulk actions on multiple views at once
- Field-level access controls

## Prerequisite (separate spec/plan)

Smart views needs commission-related fields available in Postgres. The Commission Ledger Google Sheet must be synced into a new `commission_ledger` table (and an aggregated per-policy view) before this spec can ship in full. That sync is mechanical and gets its own short spec/plan — see future doc `docs/superpowers/specs/2026-04-26-commission-ledger-sync-design.md`.

This spec assumes that table and aggregation exist. If the ledger sync is delayed, V1 of smart views ships with all non-commission columns/filters working, and the commission category appears empty until the sync lands.

---

## Architecture

### Storage

New Postgres table `portfolio_views`. Shared across all dashboard users (no auth model in this app). Migration `003_add_portfolio_views.sql` creates the table and seeds the 6 existing smart lists as `is_system=true` rows.

### Backend

| Path | Purpose |
|---|---|
| `GET /api/portfolio/views` | List all views (sorted by pinned + display_order + name) |
| `POST /api/portfolio/views` | Create a view |
| `PATCH /api/portfolio/views/:id` | Update name, filters, columns, sort, group, pinned |
| `DELETE /api/portfolio/views/:id` | Delete a user view; system views return 403 |
| `POST /api/portfolio/views/:id/reset` | Reset a system view's filters/columns/sort/group to its `seed_json` |
| `GET /api/portfolio/contacts` (existing) | Extended to accept either the legacy `filters` query param or a new `viewId=N` param. When `viewId` is set, the route loads the view server-side and applies its filters_json or raw_where. |

New module `src/lib/portfolio/views.js` for view CRUD + serialization helpers. Existing `src/lib/portfolio/query.js` extended to consume the richer filter format (AND/OR tree from `compileFilterTree`) instead of the simple flat filters object.

### Frontend

| Component | Status | Purpose |
|---|---|---|
| `PortfolioFilterSidebar.jsx` | Rewritten | Loads views from `/api/portfolio/views`. Per-row `⋮` menu (Edit / Duplicate / Pin / Delete or Reset). System views get a `★` badge. |
| `PortfolioSaveViewPopover.jsx` | New | Toolbar `+ Save view` button → small popover (name + pin checkbox). POSTs current state. |
| `PortfolioViewEditor.jsx` | New | Slide-in editor (~520px, drag-resizable) with all fields. |
| `PortfolioFilterBuilder.jsx` | New | The visual AND/OR builder — recursive tree of groups + leaves. |
| `PortfolioColumnPicker.jsx` | New | Two-pane picker: categorized available columns (left) + selected columns (right) with drag handles + ↑/↓ buttons. |
| `PortfolioGrid.jsx` | Modified | Renders arbitrary column lists from a config rather than the current 8 hardcoded columns. Uses the column registry for label / formatter / alignment. |
| `PortfolioTab.jsx` | Modified | Wires the new sidebar API loads, the toolbar save button, and the editor open/close state. |

---

## Data model

### Table: `portfolio_views`

```sql
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
```

### `filters_json` shape — AND/OR nested tree

```json
{
  "op": "AND",
  "rules": [
    { "field": "state", "op": "in", "value": ["CA", "TX"] },
    { "field": "monthly_premium", "op": "gte", "value": 100 },
    {
      "op": "OR",
      "rules": [
        { "field": "placed_status", "op": "contains", "value": "active" },
        { "field": "placed_status", "op": "contains", "value": "in force" }
      ]
    }
  ]
}
```

Per-leaf supported `op` values: `eq`, `neq`, `in`, `not_in`, `contains`, `not_contains`, `gt`, `gte`, `lt`, `lte`, `between`, `is_null`, `is_not_null`. The compiler in `src/lib/portfolio/filter-tree.js` translates each leaf into a postgres.js fragment with parameterized values.

### `columns` shape — ordered list of column keys

```json
["name", "phone", "state", "placed_status", "monthly_premium", "outstanding_balance", "agent", "last_seen_at"]
```

Each key resolves through the column registry to `{ label, sqlExpression, formatter, alignment, width, joinHints }`.

### `raw_where` shape — string fragment

```
monthly_premium > 100 AND state IN ('CA', 'TX')
```

A user-supplied SQL `WHERE` expression. Validated server-side (Section: Raw SQL safety) before being composed.

### Seed rows for the 6 system views

Each gets `is_system=true` and `seed_json` populated with its own initial state. Names match the current sidebar entries. Filter trees are equivalent to the current hardcoded smart lists in `src/lib/portfolio/filters.js`.

| Name | filters_json (compact) |
|---|---|
| All Submitted Apps | `{op:'AND', rules:[{field:'application_date', op:'is_not_null'}]}` |
| Pending Applications | + status contains 'pending' OR 'submitted' OR 'awaiting' |
| Active Policies | + status contains 'active' OR 'in force' OR 'advance released' |
| Recently Lapsed | + status contains 'lapsed' OR 'canceled' OR 'cancelled' |
| Declined | + status contains 'declined' |
| High-Value Active | Active Policies' rules + monthly_premium >= 100 |

---

## Column registry

Module: `src/lib/portfolio/column-registry.js` (new)

A single exported object mapping column keys to metadata. Categories used for grouping in the picker:

### Contact (14 columns)

`name`, `phone`, `email`, `dob`, `gender`, `address`, `city`, `state`, `zip`, `country`, `first_seen`, `source`, `tags`, `total_calls`

### Latest Policy (13 columns)

`placed_status`, `monthly_premium`, `original_premium`, `face_amount`, `term_length`, `application_date`, `effective_date`, `carrier`, `product`, `carrier_product_raw`, `policy_number`, `carrier_policy_number`, `outcome_at_application`

### Commission (9 columns; available after ledger-sync ships)

`total_advance`, `total_commission`, `net_commission`, `outstanding_balance`, `last_statement_date`, `last_transaction_type`, `chargeback_total`, `recovery_total`, `commission_status` (Paid / Partial / Unpaid / Charged-Back)

### Activity (5 columns)

`last_seen_at`, `last_campaign`, `calls_in_7d`, `calls_in_30d`, `days_since_last_call`

Each registry entry includes:
- `label` — human-readable column header
- `category` — for the picker grouping
- `sqlExpression` — postgres.js fragment that produces the value (e.g., `c.first_name || ' ' || c.last_name` for `name`)
- `joinHints` — which tables must be joined (`policies`, `commission_ledger_summary`, `calls_aggregates`) — the query layer adds joins on demand
- `formatter` — `'date' | 'datetime' | 'currency' | 'integer' | 'tags' | 'status_color' | 'text'` — drives client-side rendering
- `alignment` — `'left' | 'right' | 'center'`
- `width` — initial column width in pixels (user can drag-resize, V2)

The same registry is used by both the column picker and the grid renderer — single source of truth.

---

## Filter expression evaluator

Module: `src/lib/portfolio/filter-tree.js` (new)

Single entry point: `compileFilterTree(node) → postgresJsFragment`. Recursive walk:

- `op === 'AND' | 'OR'` → recursively compile children, join with the operator, wrap in parens
- Leaf → look up `field` in the column registry → emit `<sqlExpression> <op> ${value}` with parameterization

Unknown ops or fields throw — the API route catches and returns 400.

Tested with `node --test`: every op, nesting, edge cases (empty rule list → no-op, unknown op → throws, unknown field → throws). Pure function, easy to verify.

---

## UI — three interaction surfaces

### 1. Toolbar `+ Save view` button (next to Group By)

Click → small popover:

```
  Name:   [________________]
  □ Pin to top of sidebar

  [Save] [Cancel]
```

POSTs the current filters/columns/sort/group-by state. New view appears in sidebar.

### 2. Sidebar — view list with per-row actions

Same look as today. Each entry has a hover-revealed `⋮` menu:
- **Edit** → opens the full editor (slide-in)
- **Duplicate** → opens editor pre-filled, name auto-suffixed `(copy)`
- **Pin / Unpin**
- **Delete** (user views) or **Reset to defaults** (system views)

System views show a small `★` badge. Pinned views float to the top; rest sort alphabetically.

### 3. Full editor — slide-in panel from the right

Same slide-in pattern as the Contact Detail panel. ~520px wide, drag-resizable, persisted width via localStorage key `portfolio.viewEditor.width`. Layout:

```
─────────────────────────────────────
  Edit View                       [✕]
─────────────────────────────────────
  Name:        [Active Policies      ]
  Description: [optional, 1 line     ]

  ── Filters ─────────────────────────
  ◉ Visual builder   ○ Raw SQL

  [AND ▾]
   ├─ Field [State ▾]  Op [in ▾]  Value [CA, TX        ] [×]
   ├─ Field [Premium ▾] Op [≥ ▾]  Value [100           ] [×]
   ├─ [+ Add rule]   [+ Add group]
   └─ ...

  ── Columns ─────────────────────────
  Available                  Selected
  ▾ Contact                  ☰ Name        ↑↓ ×
    □ Email                  ☰ Phone       ↑↓ ×
    □ DOB                    ☰ State       ↑↓ ×
    ...                      ...
  ▾ Latest Policy
  ▾ Commission
  ▾ Activity
  [Search columns...]

  ── Default sort ────────────────────
  Sort by [Last Seen ▾]  [Desc ▾]

  ── Default grouping ────────────────
  Group by [No grouping ▾]

  [Save] [Cancel]   [Reset to defaults] (system views only)
```

The Visual / Raw SQL toggle: when "Raw SQL" is selected, the visual filter builder collapses and a textarea appears with helper text explaining the safe-syntax rules.

### Filter builder details

Recursive React component `PortfolioFilterBuilder`. State shape mirrors `filters_json`. Each rule has:
- **Field selector** — searchable dropdown showing all column registry entries grouped by category
- **Op selector** — populated based on the field's data type (string fields show `eq/neq/in/not_in/contains/not_contains/is_null/is_not_null`; numeric show `eq/neq/gt/gte/lt/lte/between`; date shows `eq/gt/gte/lt/lte/between/is_null`)
- **Value input** — type-aware: chips for `in`/`not_in`, two date pickers for `between`, single input for the rest

`[+ Add rule]` appends a new leaf at the current group's level. `[+ Add group]` adds a nested group with its own AND/OR toggle. Group operator (AND/OR) is a small dropdown at the top of each group.

### Column picker details

Component `PortfolioColumnPicker`. Two panes side by side:
- **Available** (left) — collapsible category headers (Contact, Latest Policy, Commission, Activity). Each entry is a checkbox. Top has a search box that filters all categories by column label substring. Already-selected columns are checked and grey'd.
- **Selected** (right) — vertical list of selected columns in order. Each row has a drag handle (☰), the column label, and a `×` to remove. Drag to reorder OR use `↑/↓` arrow buttons (keyboard-accessible). The order in this pane = the column order in the grid.

---

## Raw SQL safety

V1 uses a two-layer defense:

### Layer 1 — keyword/character blocklist

Any input containing the following is rejected with 400 before it ever reaches the DB:
- `;`
- Comment markers `--` and `/*`
- Reserved keywords (case-insensitive whole-word match): `DELETE`, `INSERT`, `UPDATE`, `DROP`, `ALTER`, `CREATE`, `TRUNCATE`, `GRANT`, `REVOKE`, `EXECUTE`, `EXEC`, `MERGE`, `COPY`, `CALL`, `DO`

### Layer 2 — read-only DB role

A separate Neon role (`tcc_dashboard_readonly`) is provisioned with `SELECT` privileges only on the relevant tables. Its connection string is added to Vercel as `DATABASE_URL_READONLY`.

`src/lib/db.js` is extended with a second exported helper:

```js
export const sqlReadonly = (...args) => getReadonlySql()(...args);
```

The `/api/portfolio/contacts` route (and `/export`) routes any query that includes a view's `raw_where` through `sqlReadonly` instead of `sql`. So even if a malicious or buggy WHERE expression slips past Layer 1 blocklist, the database itself rejects writes.

### Pre-flight

The plan includes a manual setup step:

```sql
-- Run in Neon SQL editor as the project owner, ONCE.
CREATE ROLE tcc_dashboard_readonly WITH LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE neondb TO tcc_dashboard_readonly;
GRANT USAGE ON SCHEMA public TO tcc_dashboard_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO tcc_dashboard_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO tcc_dashboard_readonly;
```

The connection string for this role goes into Vercel env vars as `DATABASE_URL_READONLY`, both Production and Preview scopes.

---

## Migration & seeding

`migrations/003_add_portfolio_views.sql` does both:

1. Creates `portfolio_views` table + indexes + trigger
2. Inserts 6 system seed rows mirroring the current hardcoded smart lists. Their `seed_json` is populated with the same data so a future `/reset` works.

No separate seeding script — keeping the migration self-contained means new environments (e.g., a fresh Neon branch) come up with the same defaults automatically.

---

## Acceptance criteria

1. A new Portfolio user opens the dashboard → sees the same 6 smart lists in the sidebar as today (now backed by the DB, with `★` system badges)
2. Clicking a view applies its filters, columns, sort, and group-by — the dashboard fully restores that saved state
3. Selecting filters/columns/sort/group ad-hoc and clicking `+ Save view` → naming the view → it appears in the sidebar and is accessible to all users
4. Editing a user-created view from the `⋮` menu opens the slide-in editor; saving overwrites the view
5. Editing a system view is allowed; clicking "Reset to defaults" reverts it to its seeded `seed_json`
6. Deleting a user view removes it; deleting a system view is forbidden (button doesn't appear or returns 403)
7. The visual filter builder supports nested AND/OR groups; the column picker supports drag + arrow reordering; both reflect in the saved view
8. Switching the editor's filter mode to "Raw SQL" lets the user type a WHERE fragment; submitting an expression containing a denylisted keyword returns a clear validation error
9. A view with `raw_where` runs against the read-only DB role; even a typo writes nothing
10. `npm run build` passes; `npm test` passes (filter-tree + column-registry unit tests included)

---

## Estimate

Roughly **7–10 hours** of work, broken across these natural commits:

1. Migration + seeds (~1h)
2. `views.js` CRUD module + 5 API routes (~1.5h)
3. Column registry + integration into existing query layer (~1h)
4. Filter-tree compiler + tests (~1h)
5. Sidebar rewrite (load from API, action menu) (~1h)
6. Save-view popover + toolbar wiring (~0.5h)
7. View editor shell + filter builder + column picker + sort/group selectors (~2.5h)
8. Raw SQL toggle + read-only client + safety layer (~1h)
9. Pre-flight: Neon read-only role setup, env var config (~0.5h)

Real-world drift: probably 10–14h once edge cases surface.
