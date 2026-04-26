# TCC Database Foundation — Design Spec

**Status:** Draft for review
**Author:** Peter Schmitt (with Claude)
**Date:** 2026-04-26
**Target:** TCC Dashboard (Next.js 14, Vercel)
**Branch:** new branch off `main` (does NOT depend on the open `feature/ghl-call-log-sync` work)

---

## 1. Why this exists

The TCC Dashboard currently uses Google Sheets as both system-of-record and read-time data source. Every page load against the dashboard, P&L view, retention dashboard, and any new feature reads directly from the Sheets API and joins data in memory.

This worked at small scale but is starting to bend:

- 3–5 second page loads as the data grows
- Google Sheets API quotas now affect production code paths (the GHL sync hit them repeatedly during backfill)
- In-memory joins across Sales Tracker + Call Logs + Goals + Commissions are duplicated across multiple API routes
- Every new UI requirement (Portfolio view, smart lists, saved searches) is harder to build because the data layer fights the work

This spec lays the foundation for a **real relational database** alongside the existing Sheets infrastructure. After this ships:

- Sheets remain canonical (humans keep editing them)
- Postgres is a fast, indexed read-replica of the merged view
- The Portfolio UI (next spec) reads from Postgres
- The GHL sync can later read from Postgres instead of Sheets

This spec ships the **database itself, schema, and connection module**. Nothing in the existing dashboard touches it yet. Sync (project #2) and UI (project #3) come in subsequent specs.

## 2. Scope

### In scope (this spec)

- Provision a Postgres database on Neon, free tier
- Define the V1 schema (7 entity tables + 1 housekeeping table) via SQL migration files
- Build a tiny migration runner (apply pending, track applied in `_migrations` table)
- Build a `db.js` module that exposes a singleton `postgres` client + `sql` tagged-template helper
- Add `DATABASE_URL` to `.env.local` and document the same env var for Vercel
- Verify with a hello-world query

### Explicitly out of scope (separate specs)

- **Project #2:** Sheets → DB sync (cron-driven; populates the tables from Sales Tracker, Call Logs, Goals)
- **Project #3:** Portfolio UI (the new tab that replaces Lead CRM + Retention + Business Health)
- **Project #4:** Rewire existing GHL sync to read from DB instead of Sheets
- **Migration of existing dashboard features** off Sheets-direct (deferred — V1 keeps both reads alive)

### Constraints

- Do not break the existing Sheets-based dashboard. All current API routes continue to work unchanged.
- Do not require schema changes for migration coexistence. The new DB sits alongside.
- Plain JavaScript (the codebase uses no TypeScript). Postgres library and migration runner must work without TS.
- Match existing code style: ESM imports, JSDoc comments, single-purpose modules.

## 3. Tech stack decisions (rationale)

### Provider: Neon

- 10 GB free tier comfortably fits all of TCC's data (Call Logs are ~6,652 rows, Sales 262 rows, scaling to maybe 100k rows over years — well under)
- Serverless Postgres with sub-100ms cold starts
- Branchable databases: `prod`, `dev`, `preview` branches off the same DB. Enables testing migrations on a copy of prod data without risk.
- Integrates with Vercel via marketplace; one-click env var injection

### Library: `postgres` (postgres.js)

Chosen over Prisma / Drizzle / Kysely because:
- The codebase is plain JS, not TypeScript. ORM type-safety benefits don't apply.
- Schema is small (~7 tables). The maintenance burden of an ORM exceeds the value.
- Engineers (and future Claude) can read and debug raw SQL trivially. ORM-generated queries add a layer of indirection.
- Tagged-template literals make queries readable and parameterized: `` sql`SELECT * FROM contacts WHERE phone = ${phone}` `` is both safe and obvious.

### Migrations: plain SQL files + tiny runner

- `migrations/001_init.sql`, `migrations/002_xxx.sql`, etc.
- Runner tracks applied filenames in a `_migrations` table; applies any not-yet-applied in alphabetical order
- No ORM-driven schema diffing — explicit SQL keeps reviewability high
- ~50 LOC for the runner

## 4. Schema

### Entity-relationship overview

```
                ┌── carriers ──┬── products
                │              │
contacts ───────┼── policies ──┘
   │            │       ▲
   │            │       │ FK: campaign_id (sales_lead_source)
   │            │       │ FK: agent_id (sales_agent)
   │            │       │ FK: carrier_id, product_id
   │            │
   ├── calls ───┼── campaigns
   │            │
   │            └── agents
   │
   └── (commissions: V2)
```

### Tables and columns (initial migration)

#### `contacts`

```sql
CREATE TABLE contacts (
  id              SERIAL PRIMARY KEY,
  phone           TEXT NOT NULL UNIQUE,             -- normalized 10-digit US
  first_name      TEXT,
  last_name       TEXT,
  email           TEXT,
  date_of_birth   DATE,
  gender          TEXT,
  address1        TEXT,
  city            TEXT,
  state           TEXT,
  postal_code     TEXT,
  country         TEXT DEFAULT 'US',

  -- Origin
  first_seen_at   TIMESTAMPTZ,                      -- when first call/contact arrived
  source          TEXT,                             -- first inbound source

  -- Denormalized current state (for fast portfolio filtering — recomputed by sync)
  last_seen_at    TIMESTAMPTZ,
  total_calls     INTEGER NOT NULL DEFAULT 0,
  is_callable     BOOLEAN,
  tags            TEXT[] NOT NULL DEFAULT '{}',     -- e.g., ['publisher:BCL', 'state:CA', 'callable:yes']

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_contacts_state ON contacts(state);
CREATE INDEX idx_contacts_last_seen ON contacts(last_seen_at DESC);
CREATE INDEX idx_contacts_tags ON contacts USING GIN (tags);
```

**Phone normalization rule:** strip non-digits, drop leading "1" for 11-digit US numbers (matches the GHL sync's `normalizePhone` logic). Stored as 10 digits, no formatting.

#### `calls`

```sql
CREATE TABLE calls (
  id                  SERIAL PRIMARY KEY,
  contact_id          INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  campaign_id         INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  agent_id            INTEGER REFERENCES agents(id) ON DELETE SET NULL,

  -- Call data
  call_date           TIMESTAMPTZ NOT NULL,
  campaign_code       TEXT,                          -- raw from sheet, even when campaign_id is null
  subcampaign         TEXT,
  rep_name            TEXT,                          -- raw rep name, even when agent_id is null
  phone_raw           TEXT,                          -- as recorded in sheet
  attempt_number      INTEGER,
  caller_id           TEXT,
  inbound_source      TEXT,
  lead_id             TEXT,
  client_id           TEXT,
  call_status         TEXT,
  is_callable         BOOLEAN,
  duration_seconds    INTEGER,
  call_type           TEXT,
  details             TEXT,
  hangup              TEXT,
  hold_time           TEXT,
  hangup_source       TEXT,
  recording_url       TEXT,
  import_date         TIMESTAMPTZ,

  -- Idempotency for sync
  row_hash            TEXT NOT NULL UNIQUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_calls_contact ON calls(contact_id);
CREATE INDEX idx_calls_date ON calls(call_date DESC);
CREATE INDEX idx_calls_campaign ON calls(campaign_id);
CREATE INDEX idx_calls_agent ON calls(agent_id);
```

**Why `campaign_code` AND `campaign_id`:** during sync, if the row's campaign isn't yet in the `campaigns` table, we still record the raw code. Sync can backfill the FK on a later run.

**`row_hash`:** sha256 of `lead_id + date + phone + duration` (matches the GHL sync's existing scheme). Allows idempotent inserts during incremental sync.

#### `policies`

```sql
CREATE TABLE policies (
  id                          SERIAL PRIMARY KEY,
  contact_id                  INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  carrier_id                  INTEGER REFERENCES carriers(id) ON DELETE SET NULL,
  product_id                  INTEGER REFERENCES products(id) ON DELETE SET NULL,
  sales_lead_source_campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  agent_id                    INTEGER REFERENCES agents(id) ON DELETE SET NULL,

  -- Identity
  policy_number               TEXT,
  carrier_policy_number       TEXT,                  -- from Merged tab
  carrier_product_raw         TEXT,                  -- soft-split fallback (legacy "Carrier + Product + Payout" string)

  -- Premium / Coverage
  monthly_premium             NUMERIC(10, 2),
  original_premium            NUMERIC(10, 2),        -- from Merged tab
  face_amount                 NUMERIC(12, 2),
  term_length                 TEXT,

  -- Status
  placed_status               TEXT,                  -- raw "Placed?" from sheet
  original_placed_status      TEXT,                  -- from Merged tab
  carrier_status              TEXT,                  -- from Merged tab
  carrier_status_date         DATE,
  outcome_at_application      TEXT,

  -- Dates
  application_date            DATE,
  effective_date              DATE,
  last_carrier_sync_date      TIMESTAMPTZ,

  -- Sales context (raw values; FKs above)
  sales_lead_source_raw       TEXT,
  sales_agent_raw             TEXT,
  sales_notes                 TEXT,
  carrier_sync_notes          TEXT,                  -- from Merged tab

  -- Payment
  payment_type                TEXT,
  payment_frequency           TEXT,
  draft_day                   TEXT,
  ssn_billing_match           TEXT,

  -- Beneficiary
  beneficiary_first_name      TEXT,
  beneficiary_last_name       TEXT,
  beneficiary_relationship    TEXT,

  -- Idempotency
  source_row_hash             TEXT NOT NULL UNIQUE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_policies_contact ON policies(contact_id);
CREATE INDEX idx_policies_status ON policies(placed_status);
CREATE INDEX idx_policies_premium ON policies(monthly_premium);
CREATE INDEX idx_policies_carrier ON policies(carrier_id);
CREATE INDEX idx_policies_agent ON policies(agent_id);
CREATE INDEX idx_policies_app_date ON policies(application_date DESC);
```

**Soft split for `carrier_product_raw`:** the sync parses "Carrier, Product" strings into `carrier_id` + `product_id` via best-effort matching. Unmatched values keep the raw string for manual review later. New entries always populate both.

#### `campaigns`

```sql
CREATE TABLE campaigns (
  id                          SERIAL PRIMARY KEY,
  code                        TEXT NOT NULL UNIQUE,  -- e.g., 'BCL', 'HIW', 'Referral'
  vendor                      TEXT,                  -- vendor name from Publisher Pricing
  category                    TEXT,                  -- 'paid_publisher' | 'internal_transfer'
  price_per_billable_call     NUMERIC(10, 2),
  buffer_seconds              INTEGER,
  status                      TEXT NOT NULL DEFAULT 'active',
  notes                       TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### `carriers`

```sql
CREATE TABLE carriers (
  id                  SERIAL PRIMARY KEY,
  name                TEXT NOT NULL UNIQUE,          -- canonical name, e.g., 'American Amicable'
  display_name        TEXT,                          -- pretty name, e.g., 'American Amicable - Occidental Life'
  status              TEXT NOT NULL DEFAULT 'active',
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### `products`

```sql
CREATE TABLE products (
  id                      SERIAL PRIMARY KEY,
  carrier_id              INTEGER NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  name                    TEXT NOT NULL,             -- e.g., 'Senior Choice Final Expense - Immediate'
  product_type            TEXT,                      -- 'whole_life' | 'term' | 'GIWL' | etc.
  payout_structure        TEXT,                      -- e.g., '100% Day 1', '30%/70%/100%'
  default_advance_months  INTEGER,                   -- 9 (standard) or 6 (CICA)
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (carrier_id, name)
);

CREATE INDEX idx_products_carrier ON products(carrier_id);
```

#### `agents`

```sql
CREATE TABLE agents (
  id                  SERIAL PRIMARY KEY,
  canonical_name      TEXT NOT NULL UNIQUE,          -- 'William Shansky'
  nicknames           TEXT[] NOT NULL DEFAULT '{}',  -- ['Bill Shansky', 'Bill', 'W. Shansky'] — for fuzzy matching
  email               TEXT,
  hire_date           DATE,
  status              TEXT NOT NULL DEFAULT 'active', -- 'active' | 'inactive'
  daily_premium_goal  NUMERIC(10, 2),
  daily_apps_goal     INTEGER,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agents_nicknames ON agents USING GIN (nicknames);
```

**Why nicknames as an array:** the existing dashboard fuzzy-matches agent names between Call Logs (where they appear as Rep) and Sales Tracker (where they appear as Agent) using a list of known aliases ("Bill" → "William"). The array preserves that capability.

#### `_migrations` (housekeeping)

```sql
CREATE TABLE _migrations (
  filename            TEXT PRIMARY KEY,
  applied_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

The migration runner inserts a row when a file is applied; on the next run, it reads existing filenames and skips them.

### `updated_at` triggers

For each table that has `updated_at`, add a trigger to auto-bump it on row update. Single shared trigger function:

```sql
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Repeated per table:
CREATE TRIGGER set_updated_at BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
-- ... and policies, campaigns, carriers, products, agents
```

## 5. `db.js` module

Thin wrapper around the `postgres` library exposing a singleton client and a query helper.

**File:** `src/lib/db.js`

```javascript
import postgres from 'postgres';

let _sql = null;

/**
 * Singleton postgres client. Lazy-initialized so `import` of this module
 * doesn't open a connection until first query.
 */
function getSql() {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  _sql = postgres(url, {
    max: 10,                    // pool size
    idle_timeout: 20,           // seconds
    connect_timeout: 10,
    transform: postgres.camel,  // optional: convert snake_case columns to camelCase in JS
  });
  return _sql;
}

/**
 * Tagged-template helper for parameterized queries.
 * Usage: const rows = await sql`SELECT * FROM contacts WHERE phone = ${phone}`;
 */
export const sql = (...args) => getSql()(...args);

/**
 * Close the connection pool. Used by scripts that need to exit cleanly.
 */
export async function closeDb() {
  if (_sql) {
    await _sql.end();
    _sql = null;
  }
}
```

**Connection pool size:** `max: 10` is appropriate for Vercel's serverless model — each function invocation gets its own pool, and 10 connections per concurrent invocation is comfortable on Neon's free tier (which allows up to ~100 concurrent connections).

**`transform: postgres.camel`:** rows come back with camelCase keys (`firstName` instead of `first_name`). Optional but matches existing JS code style.

## 6. Migration runner

**File:** `scripts/db-migrate.mjs`

```javascript
// Run: node --env-file=.env.local scripts/db-migrate.mjs [up|down|status]
import { sql, closeDb } from '../src/lib/db.js';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const MIGRATIONS_DIR = 'migrations';

async function ensureMigrationsTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

async function listAppliedFilenames() {
  const rows = await sql`SELECT filename FROM _migrations ORDER BY filename`;
  return new Set(rows.map(r => r.filename));
}

async function listMigrationFiles() {
  const all = await readdir(MIGRATIONS_DIR);
  return all.filter(f => f.endsWith('.sql')).sort();
}

async function applyMigration(filename) {
  const path = join(MIGRATIONS_DIR, filename);
  const sqlText = await readFile(path, 'utf8');
  console.log(`Applying ${filename}...`);
  await sql.unsafe(sqlText); // .unsafe needed for multi-statement DDL
  await sql`INSERT INTO _migrations (filename) VALUES (${filename})`;
  console.log(`  ✓ ${filename}`);
}

async function up() {
  await ensureMigrationsTable();
  const applied = await listAppliedFilenames();
  const all = await listMigrationFiles();
  const pending = all.filter(f => !applied.has(f));
  if (pending.length === 0) {
    console.log('No pending migrations.');
    return;
  }
  console.log(`${pending.length} pending migration(s):`);
  for (const f of pending) await applyMigration(f);
  console.log('Done.');
}

async function status() {
  await ensureMigrationsTable();
  const applied = await listAppliedFilenames();
  const all = await listMigrationFiles();
  for (const f of all) {
    console.log(applied.has(f) ? `✓ ${f}` : `· ${f} (pending)`);
  }
}

async function main() {
  const cmd = process.argv[2] ?? 'up';
  if (cmd === 'up') await up();
  else if (cmd === 'status') await status();
  else { console.error(`Unknown command: ${cmd}. Use 'up' or 'status'.`); process.exit(1); }
}

main()
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => closeDb());
```

**Rollback** is intentionally NOT in V1. Down-migrations are easy to get wrong and rarely needed — the typical workflow is "write a new forward migration that fixes the issue." Adding `down` later is trivial if it becomes necessary.

## 7. File structure

New files:

```
migrations/
  001_init.sql                           # creates all 8 tables, indexes, triggers

src/lib/
  db.js                                  # singleton client + sql helper

scripts/
  db-migrate.mjs                         # apply pending migrations
```

Modified files:

```
.env.local                               # adds DATABASE_URL=postgres://...
.env.local.example (if it exists)        # documents DATABASE_URL with placeholder
package.json                             # adds 'postgres' dependency
CLAUDE.md                                # adds 'TCC Database' docs section
```

## 8. Setup steps (one-time, manual)

1. Create a Neon account (free)
2. Create a project named `tcc-dashboard`
3. Copy the connection string (looks like `postgres://user:pass@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require`)
4. Add to local `.env.local`: `DATABASE_URL=<the connection string>`
5. Run `npm install postgres`
6. Run `node --env-file=.env.local scripts/db-migrate.mjs up` — applies the initial schema
7. Verify: `node --env-file=.env.local --input-type=module -e "import('./src/lib/db.js').then(({sql}) => sql\`SELECT COUNT(*) FROM contacts\`).then(r => console.log(r))"`

For Vercel deploy: paste the same `DATABASE_URL` into Vercel's environment variables (Project Settings → Environment Variables).

## 9. Testing strategy

This codebase has no test framework. Verification via inline node scripts (matches the GHL sync pattern):

- After migration runs: confirm all 8 tables exist via `\dt` equivalent (`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`)
- Confirm indexes exist
- Smoke insert + read on each table to verify FKs work as expected
- Verify `updated_at` trigger fires on UPDATE

These checks are step-by-step in the implementation plan; this spec just specifies that they happen.

## 10. Reliability and operational notes

- **Connections:** Neon's free tier allows ~100 connections. With pool size 10, we're comfortable up to ~10 concurrent function invocations. If we ever scale up, bump pool size or use Neon's connection pooler endpoint.
- **Cold starts:** Neon's serverless mode sleeps the DB after ~5 min of idle. First query after sleep takes ~500ms. Acceptable for our usage pattern.
- **Backups:** Neon provides 7 days of point-in-time recovery on free tier. No manual backup needed for V1.
- **Branching:** Neon supports branching — `prod`, `dev`, `preview` databases off the same root. We can create a `dev` branch when needed and run destructive migrations against it first.

## 11. Migration rollout plan

1. **Build (this spec)** — DB provisioned, schema applied, db.js working, hello-world query succeeds
2. **Project #2: Sheets → DB sync** (separate spec) — populates the tables from existing Sheets data
3. **Project #3: Portfolio UI** (separate spec) — first feature consuming the DB
4. **Project #4: GHL sync rewire** (separate spec) — switches GHL sync to read from DB instead of Sheets
5. **Eventual deprecation:** other dashboard features can migrate to DB reads incrementally; Sheets remains the canonical edit surface

## 12. Open questions / deferred decisions

- **`commissions` table** — deferred to a later spec when we're ready to track per-payment commission history. For V1, commission *amounts* live as columns on `policies` if needed.
- **Soft-delete pattern** — V1 uses hard deletes via `ON DELETE CASCADE`. If audit trails for deleted records become important, we add `deleted_at` columns and switch to soft-delete. Deferred.
- **`contacts.tags` storage** — current design uses Postgres array (`TEXT[]`). Alternative would be a join table `contact_tags(contact_id, tag)`. Array is simpler and sufficient for V1; revisit if filtering performance suffers with many tags.
- **Daily metrics tables** — the existing `Daily Snapshots` sheet tabs may eventually want their own DB tables. Out of scope for the foundation; bring up when we touch the snapshots system.
- **Data retention** — no automated archival. If row counts grow large enough to matter (millions), we'd add archival tables and a retention policy. Not relevant for V1.

## 13. What this spec deliberately does NOT do

- Doesn't sync any real data. Tables are empty after migration.
- Doesn't change any existing dashboard behavior. The Sheets-based code paths continue exactly as today.
- Doesn't introduce TypeScript or any new framework.
- Doesn't add an admin UI for inspecting the DB. Use `psql`, Neon's console, or DBeaver.
