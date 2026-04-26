# TCC Portfolio Full Build Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** End-to-end build of the TCC Portfolio system. Replaces the existing Lead CRM, Retention Dashboard, and Business Health tabs with a unified GHL-style Portfolio view backed by a real Postgres database, with all data flowing automatically from Google Sheets.

**Architecture:** Three layers built bottom-up in a single plan: (1) **DB Foundation** — Postgres on Neon, 7 entity tables + migration runner. (2) **Sheets → DB Sync** — cron-driven incremental sync that mirrors Sales Tracker, Call Logs, Goals, and pricing sheets into normalized DB tables. (3) **Portfolio UI** — new dashboard tab with pivot-grouping smart lists, drill-in contact details, and bulk export to CSV / dialer queue.

**Tech Stack:** Neon (serverless Postgres, free tier), `postgres` npm package (postgres.js, no ORM), plain JS ESM, Next.js 14 App Router, Node 20+ `--env-file` flag, React, Vercel.

**Specs this plan implements:**
- `docs/superpowers/specs/2026-04-26-tcc-database-foundation-design.md` (Phase 1)
- Sheets → DB sync and Portfolio UI specs are **embedded inline** in Phase 2 and Phase 3 below — they were brainstormed in the same session as the foundation spec but never extracted into separate spec docs. This plan IS the combined spec + implementation guide for those phases.

**What this plan deliberately does NOT include:**
- DB → GHL sync rewire (the existing Sheets → GHL sync at `src/lib/ghl/` keeps running unchanged; rewiring it to read from DB instead of Sheets is a future plan, not blocking)
- Migrating other dashboard features (P&L, Commissions, Snapshots, Daily Summary) off Sheets-direct reads (they keep working unchanged)
- Adding any new GHL custom fields, workflows, or smart lists

---

## How this plan is organized

Three phases, executed in strict order. Each phase ends with working software.

| Phase | What ships | Estimate |
|---|---|---:|
| **1. Foundation** (T1–T9) | Postgres provisioned, schema applied, db.js + migration runner | ~6–10h |
| **2. Sheets → DB Sync** (T10–T20) | All 7 tables populated from Sheets, kept fresh by cron | ~10–14h |
| **3. Portfolio UI** (T21–T34) | New Portfolio tab replacing Lead CRM + Retention + Business Health | ~14–20h |
| **Total** | Full system end-to-end | **~30–44h** |

**Branching:** Single feature branch off `main`: `feature/portfolio-build`. Created in Task 1, used throughout.

**Pre-flight (manual, you do this; blocks T6 onward):**
- **P1.** Sign up for Neon at https://neon.tech, create project `tcc-dashboard`, copy the connection string, paste it into `.env.local` as `DATABASE_URL=...`
- **P2.** Confirm `main` is clean (`git status` shows working tree clean) before T1.

---

## File Structure (all phases)

### Phase 1 — Foundation

```
src/lib/
  db.js                            # Singleton postgres client + sql helper

migrations/
  001_init.sql                     # Initial schema: 7 entity tables + indexes + triggers

scripts/
  db-migrate.mjs                   # Migration runner (up + status)
```

### Phase 2 — Sheets → DB Sync

```
src/lib/db-sync/
  campaigns.js                     # Sync from Goals "Publisher Pricing" tab
  carriers-products.js             # Parse + sync from "Carrier + Product + Payout" strings
  agents.js                        # Sync from Goals "Agent Daily Goals" tab
  contacts.js                      # Build/update contacts from Sales + Call Logs
  policies.js                      # Sync from Sales Tracker
  calls.js                         # Sync from Call Logs
  refresh-denorms.js               # Recompute contacts.last_seen_at, total_calls, tags, is_callable
  pipeline.js                      # Orchestrates all the above in correct dependency order

src/app/api/cron/db-sync/route.js  # Cron entry — incremental sync
src/app/api/db-backfill/route.js   # One-shot full reload (manual trigger)

migrations/
  002_add_sync_state.sql           # Tracks last-sync timestamps per source
```

### Phase 3 — Portfolio UI

```
src/lib/portfolio/
  query.js                         # SQL builders: contacts list, contact detail, groupings
  filters.js                       # Filter spec → SQL WHERE clause translator
  exports.js                       # CSV export builders (general + ChaseData dialer format)

src/app/api/portfolio/
  contacts/route.js                # GET — list with filters, group-by, pagination
  contact/[id]/route.js            # GET — single contact full record
  export/route.js                  # GET — CSV download
  dialer-export/route.js           # GET — ChaseData-format CSV download

src/components/portfolio/
  PortfolioTab.jsx                 # Main shell
  PortfolioFilterSidebar.jsx       # Saved smart lists + filter builder
  PortfolioGrid.jsx                # Sortable, selectable contact table
  PortfolioGroupBySelector.jsx     # Pivot dimension picker
  PortfolioDetailPanel.jsx         # Slide-in contact detail (replaces existing modals)
  PortfolioBulkActionBar.jsx       # Export, dialer, future workflow trigger

src/components/Dashboard.jsx       # MODIFY — replace 3 tabs with single PortfolioTab
```

### Modified files summary

```
.env.local                         # adds DATABASE_URL (manual, P1)
package.json                       # adds 'postgres' dependency (T2)
vercel.json                        # adds db-sync cron schedule (T18)
claude.md                          # adds DB + Portfolio docs sections (T9, T34)
src/components/Dashboard.jsx       # tab structure changes (T33)
```

### Files explicitly NOT touched

- Anything under `src/lib/ghl/` (existing GHL sync keeps running)
- Other API routes (`/api/dashboard`, `/api/commission*`, `/api/daily-summary`, etc.)
- Existing tabs other than Lead CRM, Retention, Business Health
- Sheets data — read-only throughout this plan

---

# PHASE 1 — DB FOUNDATION

This phase ships a working database, schema, and connection module. Nothing in the dashboard reads from the DB yet; that comes in Phase 2 / 3.

## Task 1: Set up branch off main

**Files:** none (workspace setup)

- [ ] **Step 1:** From `/Users/peterschmitt/Downloads/tcc-dashboard`, confirm clean state on `main`:

```bash
cd /Users/peterschmitt/Downloads/tcc-dashboard
git status
git branch --show-current
```

Expected: branch is `main`, working tree clean. If on a different branch, run `git checkout main && git pull`.

- [ ] **Step 2:** Verify `.worktrees/` is gitignored:

```bash
git check-ignore -v .worktrees/dummy
```

Expected: a line confirming the ignore rule. If empty, stop and ask.

- [ ] **Step 3:** Create worktree on new branch:

```bash
git worktree add .worktrees/feature-portfolio-build -b feature/portfolio-build
cd .worktrees/feature-portfolio-build
```

- [ ] **Step 4:** Symlink `.env.local`:

```bash
ln -s /Users/peterschmitt/Downloads/tcc-dashboard/.env.local .env.local
ls -la .env.local
```

Expected: symlink pointing at the main checkout's `.env.local`.

- [ ] **Step 5:** Install dependencies:

```bash
npm install --silent
```

- [ ] **Step 6:** Run baseline build to confirm tree is clean:

```bash
npm run build 2>&1 | tail -10
```

Expected: build succeeds. If it fails for unrelated reasons (e.g., missing other env vars), note it but proceed.

---

## Task 2: Add the `postgres` library

**Files:**
- Modify: `package.json` (dependencies)

- [ ] **Step 1:** Install:

```bash
npm install postgres
```

- [ ] **Step 2:** Verify the install:

```bash
node --input-type=module -e "import postgres from 'postgres'; console.log('postgres loaded:', typeof postgres);"
```

Expected: `postgres loaded: function`. (`MODULE_TYPELESS_PACKAGE_JSON` warning is harmless throughout this plan.)

- [ ] **Step 3:** Commit:

```bash
git add package.json package-lock.json
git commit -m "feat(db): add postgres library dependency"
```

---

## Task 3: Create `src/lib/db.js`

**Files:**
- Create: `src/lib/db.js`

- [ ] **Step 1:** Write `src/lib/db.js` with **exactly** this content:

```javascript
// src/lib/db.js
import postgres from 'postgres';

let _sql = null;

/**
 * Lazily initialize the postgres client. Importing this module does NOT
 * open a connection; the first query does. Subsequent calls reuse the
 * same connection pool.
 *
 * Pool size 10 is appropriate for Vercel's serverless model — each
 * function invocation gets its own pool, and 10 is comfortable on
 * Neon's free tier (~100 concurrent connections allowed).
 *
 * `transform: postgres.camel` returns column values with camelCase keys
 * (firstName instead of first_name) to match the existing JS code style.
 */
function getSql() {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  _sql = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    transform: postgres.camel,
  });
  return _sql;
}

/**
 * Tagged-template helper for parameterized queries.
 *   const rows = await sql`SELECT * FROM contacts WHERE phone = ${phone}`;
 *
 * Postgres.js handles parameter binding automatically (no SQL injection
 * risk), and returns an array of row objects.
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

/**
 * Direct access to the underlying postgres.js client for advanced use
 * cases like .unsafe() (multi-statement DDL execution).
 */
export const rawClient = () => getSql();
```

- [ ] **Step 2:** Verify exports:

```bash
node --input-type=module -e "
import('./src/lib/db.js').then((m) => {
  console.log('exports:', Object.keys(m).join(', '));
  if (typeof m.sql !== 'function' || typeof m.closeDb !== 'function' || typeof m.rawClient !== 'function') { console.error('FAIL'); process.exit(1); }
  console.log('db.js exports OK');
});
"
```

Expected: `exports: sql, closeDb, rawClient` and `db.js exports OK`.

- [ ] **Step 3:** Verify helpful error when DATABASE_URL is missing:

```bash
node --input-type=module -e "
import('./src/lib/db.js').then(async ({ sql }) => {
  try { await sql\`SELECT 1\`; console.error('FAIL'); process.exit(1); }
  catch (e) { if (!e.message.includes('DATABASE_URL not set')) { console.error('FAIL: wrong error:', e.message); process.exit(1); } console.log('OK'); }
});
"
```

Expected: `OK`.

- [ ] **Step 4:** Commit:

```bash
git add src/lib/db.js
git commit -m "feat(db): add db.js singleton client + sql tagged-template helper"
```

---

## Task 4: Write `migrations/001_init.sql`

**Files:**
- Create: `migrations/001_init.sql`

- [ ] **Step 1:** Create directory:

```bash
mkdir -p migrations
```

- [ ] **Step 2:** Write `migrations/001_init.sql` with **exactly** this content:

```sql
-- migrations/001_init.sql
-- TCC Portfolio Foundation: 7 entity tables + supporting infrastructure.

-- Shared trigger function: bumps updated_at on row update
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- carriers (must come before products which FKs to it)
CREATE TABLE carriers (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  display_name    TEXT,
  status          TEXT NOT NULL DEFAULT 'active',
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER set_updated_at_carriers BEFORE UPDATE ON carriers
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- products (carrier × product)
CREATE TABLE products (
  id                      SERIAL PRIMARY KEY,
  carrier_id              INTEGER NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  name                    TEXT NOT NULL,
  product_type            TEXT,
  payout_structure        TEXT,
  default_advance_months  INTEGER,
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (carrier_id, name)
);
CREATE INDEX idx_products_carrier ON products(carrier_id);
CREATE TRIGGER set_updated_at_products BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- campaigns (publishers + internal sources)
CREATE TABLE campaigns (
  id                          SERIAL PRIMARY KEY,
  code                        TEXT NOT NULL UNIQUE,
  vendor                      TEXT,
  category                    TEXT,
  price_per_billable_call     NUMERIC(10, 2),
  buffer_seconds              INTEGER,
  status                      TEXT NOT NULL DEFAULT 'active',
  notes                       TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER set_updated_at_campaigns BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- agents
CREATE TABLE agents (
  id                  SERIAL PRIMARY KEY,
  canonical_name      TEXT NOT NULL UNIQUE,
  nicknames           TEXT[] NOT NULL DEFAULT '{}',
  email               TEXT,
  hire_date           DATE,
  status              TEXT NOT NULL DEFAULT 'active',
  daily_premium_goal  NUMERIC(10, 2),
  daily_apps_goal     INTEGER,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_agents_nicknames ON agents USING GIN (nicknames);
CREATE TRIGGER set_updated_at_agents BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- contacts (phone-keyed)
CREATE TABLE contacts (
  id              SERIAL PRIMARY KEY,
  phone           TEXT NOT NULL UNIQUE,
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
  first_seen_at   TIMESTAMPTZ,
  source          TEXT,
  last_seen_at    TIMESTAMPTZ,
  total_calls     INTEGER NOT NULL DEFAULT 0,
  is_callable     BOOLEAN,
  tags            TEXT[] NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_contacts_state ON contacts(state);
CREATE INDEX idx_contacts_last_seen ON contacts(last_seen_at DESC);
CREATE INDEX idx_contacts_tags ON contacts USING GIN (tags);
CREATE TRIGGER set_updated_at_contacts BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- calls
CREATE TABLE calls (
  id                  SERIAL PRIMARY KEY,
  contact_id          INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  campaign_id         INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  agent_id            INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  call_date           TIMESTAMPTZ NOT NULL,
  campaign_code       TEXT,
  subcampaign         TEXT,
  rep_name            TEXT,
  phone_raw           TEXT,
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
  row_hash            TEXT NOT NULL UNIQUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_calls_contact ON calls(contact_id);
CREATE INDEX idx_calls_date ON calls(call_date DESC);
CREATE INDEX idx_calls_campaign ON calls(campaign_id);
CREATE INDEX idx_calls_agent ON calls(agent_id);

-- policies
CREATE TABLE policies (
  id                              SERIAL PRIMARY KEY,
  contact_id                      INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  carrier_id                      INTEGER REFERENCES carriers(id) ON DELETE SET NULL,
  product_id                      INTEGER REFERENCES products(id) ON DELETE SET NULL,
  sales_lead_source_campaign_id   INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  agent_id                        INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  policy_number                   TEXT,
  carrier_policy_number           TEXT,
  carrier_product_raw             TEXT,
  monthly_premium                 NUMERIC(10, 2),
  original_premium                NUMERIC(10, 2),
  face_amount                     NUMERIC(12, 2),
  term_length                     TEXT,
  placed_status                   TEXT,
  original_placed_status          TEXT,
  carrier_status                  TEXT,
  carrier_status_date             DATE,
  outcome_at_application          TEXT,
  application_date                DATE,
  effective_date                  DATE,
  last_carrier_sync_date          TIMESTAMPTZ,
  sales_lead_source_raw           TEXT,
  sales_agent_raw                 TEXT,
  sales_notes                     TEXT,
  carrier_sync_notes              TEXT,
  payment_type                    TEXT,
  payment_frequency               TEXT,
  draft_day                       TEXT,
  ssn_billing_match               TEXT,
  beneficiary_first_name          TEXT,
  beneficiary_last_name           TEXT,
  beneficiary_relationship        TEXT,
  source_row_hash                 TEXT NOT NULL UNIQUE,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_policies_contact ON policies(contact_id);
CREATE INDEX idx_policies_status ON policies(placed_status);
CREATE INDEX idx_policies_premium ON policies(monthly_premium);
CREATE INDEX idx_policies_carrier ON policies(carrier_id);
CREATE INDEX idx_policies_agent ON policies(agent_id);
CREATE INDEX idx_policies_app_date ON policies(application_date DESC);
CREATE TRIGGER set_updated_at_policies BEFORE UPDATE ON policies
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
```

- [ ] **Step 3:** Sanity-check counts:

```bash
grep -c "^CREATE TABLE" migrations/001_init.sql      # expect 7
grep -c "^CREATE INDEX" migrations/001_init.sql      # expect 15
grep -c "^CREATE TRIGGER" migrations/001_init.sql    # expect 6 (calls has no updated_at)
```

If counts differ, re-check file content matches Step 2.

- [ ] **Step 4:** Commit:

```bash
git add migrations/001_init.sql
git commit -m "feat(db): initial schema migration (7 tables + 15 indexes + 6 triggers)"
```

---

## Task 5: Migration runner `scripts/db-migrate.mjs`

**Files:**
- Create: `scripts/db-migrate.mjs`

- [ ] **Step 1:** Confirm `scripts/` exists or create it:

```bash
ls scripts/ 2>/dev/null || mkdir scripts
```

- [ ] **Step 2:** Write `scripts/db-migrate.mjs` with **exactly** this content:

```javascript
// scripts/db-migrate.mjs
// Run:
//   node --env-file=.env.local scripts/db-migrate.mjs            # apply pending (default 'up')
//   node --env-file=.env.local scripts/db-migrate.mjs status     # list applied + pending
//
// Migrations are .sql files in migrations/, applied alphabetically.
// Applied filenames are tracked in the _migrations table; subsequent
// runs skip files already applied. No rollback in V1 — write a new
// forward migration to fix issues.

import { sql, closeDb, rawClient } from '../src/lib/db.js';
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
  const client = rawClient();
  await client.unsafe(sqlText); // .unsafe needed for multi-statement DDL
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
  if (all.length === 0) { console.log('No migration files.'); return; }
  for (const f of all) console.log(applied.has(f) ? `✓ ${f}` : `· ${f} (pending)`);
}

async function main() {
  const cmd = process.argv[2] ?? 'up';
  if (cmd === 'up') await up();
  else if (cmd === 'status') await status();
  else { console.error(`Unknown command: ${cmd}. Use 'up' or 'status'.`); process.exit(1); }
}

main()
  .catch(e => { console.error('FATAL:', e); process.exitCode = 1; })
  .finally(() => closeDb());
```

- [ ] **Step 3:** Verify it errors helpfully when DATABASE_URL is missing:

```bash
node scripts/db-migrate.mjs status 2>&1 | head -5
```

Expected: error mentioning `DATABASE_URL not set`.

- [ ] **Step 4:** Commit:

```bash
git add scripts/db-migrate.mjs
git commit -m "feat(db): migration runner (up + status)"
```

---

## Task 6: Apply the initial migration (LIVE — requires DATABASE_URL set in .env.local)

**Files:** none (operational task)

This task requires Pre-flight P1 done. If it isn't, **stop** — Peter creates Neon project + adds DATABASE_URL to .env.local first.

- [ ] **Step 1:** Confirm DATABASE_URL is set:

```bash
grep "^DATABASE_URL=" .env.local | sed 's/=.*/=<set>/'
```

Expected: `DATABASE_URL=<set>`.

- [ ] **Step 2:** Status (should show pending):

```bash
node --env-file=.env.local scripts/db-migrate.mjs status
```

Expected: `· 001_init.sql (pending)`.

- [ ] **Step 3:** Apply:

```bash
node --env-file=.env.local scripts/db-migrate.mjs up
```

Expected: `1 pending migration(s):` then `Applying 001_init.sql...` then `✓ 001_init.sql` then `Done.`.

- [ ] **Step 4:** Re-run status (idempotency):

```bash
node --env-file=.env.local scripts/db-migrate.mjs status
```

Expected: `✓ 001_init.sql`.

- [ ] **Step 5:** Re-run up (no-op):

```bash
node --env-file=.env.local scripts/db-migrate.mjs up
```

Expected: `No pending migrations.`.

- [ ] **Step 6:** Verify all 8 tables exist (7 entity + `_migrations`):

```bash
node --env-file=.env.local --input-type=module -e "
import('./src/lib/db.js').then(async ({ sql, closeDb }) => {
  const rows = await sql\`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename\`;
  const names = rows.map(r => r.tablename);
  console.log('Tables:', names.join(', '));
  const expected = ['_migrations', 'agents', 'calls', 'campaigns', 'carriers', 'contacts', 'policies', 'products'];
  const missing = expected.filter(t => !names.includes(t));
  if (missing.length) { console.error('MISSING:', missing.join(', ')); process.exit(1); }
  console.log(rows.length, 'tables OK (expected 8)');
  await closeDb();
});
"
```

Expected: 8 tables listed, then `8 tables OK (expected 8)`.

- [ ] **Step 7:** No commit (operational task only).

---

## Task 7: Smoke test (insert + read on every table; FKs + triggers + CASCADE)

**Files:** none (creates a temp script, runs it, deletes it)

- [ ] **Step 1:** Write `/tmp/db-smoke-test.mjs`:

```bash
cat > /tmp/db-smoke-test.mjs <<'EOF'
import { sql, closeDb } from './src/lib/db.js';

async function run() {
  const [carrier] = await sql`INSERT INTO carriers (name, display_name) VALUES ('Smoke Test Carrier', 'STC') RETURNING id, name, created_at, updated_at`;
  console.log('carrier:', carrier);
  if (!carrier.createdAt) throw new Error('camelCase transform broken');

  const [product] = await sql`INSERT INTO products (carrier_id, name, product_type, default_advance_months) VALUES (${carrier.id}, 'STP', 'whole_life', 9) RETURNING id, carrier_id`;
  if (product.carrierId !== carrier.id) throw new Error('FK roundtrip broken');

  const [campaign] = await sql`INSERT INTO campaigns (code, vendor, category, price_per_billable_call, buffer_seconds) VALUES ('SMOKE', 'V', 'paid_publisher', 45.00, 60) RETURNING id, code`;
  const [agent] = await sql`INSERT INTO agents (canonical_name, nicknames) VALUES ('Smoke Agent', ARRAY['Smokey']) RETURNING id, nicknames`;
  if (!Array.isArray(agent.nicknames)) throw new Error('array roundtrip broken');

  const [contact] = await sql`INSERT INTO contacts (phone, first_name, last_name, state, tags) VALUES ('5555555555', 'Smoke', 'Test', 'CA', ARRAY['publisher:SMOKE']) RETURNING id, phone, tags`;
  const [call] = await sql`INSERT INTO calls (contact_id, campaign_id, agent_id, call_date, campaign_code, rep_name, phone_raw, call_status, duration_seconds, row_hash) VALUES (${contact.id}, ${campaign.id}, ${agent.id}, NOW(), 'SMOKE', 'Smoke Agent', '5555555555', 'Answered', 47, 'smoke-1') RETURNING id`;
  const [policy] = await sql`INSERT INTO policies (contact_id, carrier_id, product_id, sales_lead_source_campaign_id, agent_id, policy_number, monthly_premium, placed_status, source_row_hash) VALUES (${contact.id}, ${carrier.id}, ${product.id}, ${campaign.id}, ${agent.id}, 'SMOKE-001', 50.00, 'Submitted - Pending', 'smoke-policy-1') RETURNING id, monthly_premium`;
  if (policy.monthlyPremium === undefined) throw new Error('numeric column missing');

  // updated_at trigger
  const before = carrier.updatedAt;
  await new Promise(r => setTimeout(r, 50));
  await sql`UPDATE carriers SET notes = 'updated' WHERE id = ${carrier.id}`;
  const [after] = await sql`SELECT updated_at FROM carriers WHERE id = ${carrier.id}`;
  if (after.updatedAt <= before) throw new Error('updated_at trigger did not fire');
  console.log('updated_at trigger: OK');

  // ON DELETE CASCADE
  await sql`DELETE FROM contacts WHERE id = ${contact.id}`;
  const [{ count: callCount }] = await sql`SELECT COUNT(*)::int AS count FROM calls WHERE id = ${call.id}`;
  const [{ count: policyCount }] = await sql`SELECT COUNT(*)::int AS count FROM policies WHERE id = ${policy.id}`;
  if (callCount !== 0 || policyCount !== 0) throw new Error('ON DELETE CASCADE did not work');
  console.log('CASCADE: OK');

  await sql`DELETE FROM products WHERE id = ${product.id}`;
  await sql`DELETE FROM carriers WHERE id = ${carrier.id}`;
  await sql`DELETE FROM campaigns WHERE id = ${campaign.id}`;
  await sql`DELETE FROM agents WHERE id = ${agent.id}`;
  console.log('\nALL SMOKE TESTS PASSED ✓');
}

run().catch(e => { console.error('FAIL:', e.message); process.exit(1); }).finally(() => closeDb());
EOF
```

- [ ] **Step 2:** Run:

```bash
node --env-file=.env.local /tmp/db-smoke-test.mjs
```

Expected: ends with `ALL SMOKE TESTS PASSED ✓`.

- [ ] **Step 3:** Cleanup:

```bash
rm /tmp/db-smoke-test.mjs
```

- [ ] **Step 4:** No commit (verification only).

---

## Task 8: Document the foundation in `claude.md`

**Files:**
- Modify: `claude.md`

- [ ] **Step 1:** Append this section to the END of `claude.md`:

```markdown

---

## TCC Database (Postgres on Neon)

Replaced Sheets-as-database for the Portfolio UI and future features.

### Connection

- Provider: Neon (10GB free tier, branchable serverless Postgres)
- Library: `postgres` (postgres.js, no ORM, raw SQL via tagged-template literals)
- Module: `src/lib/db.js` exports `sql` (tagged template), `closeDb()`, `rawClient()`
- Env: `DATABASE_URL` in `.env.local` and Vercel env

### Schema

7 entity tables + `_migrations`:

- `contacts` (phone-keyed, parent of calls + policies)
- `calls` (FK contact, campaign, agent; row_hash for idempotent sync)
- `policies` (FK contact, carrier, product, campaign, agent; source_row_hash for idempotent sync)
- `campaigns`, `carriers`, `products`, `agents` (reference data)

### Usage

```javascript
import { sql } from '@/lib/db';
const contacts = await sql`SELECT id, first_name, last_name FROM contacts WHERE state = ${state} LIMIT 50`;
// returns array with camelCase keys (firstName, lastName)
```

### Migrations

```bash
node --env-file=.env.local scripts/db-migrate.mjs status   # list
node --env-file=.env.local scripts/db-migrate.mjs up       # apply pending
```

V1 has no rollback — write a forward migration to fix issues.
```

- [ ] **Step 2:** Verify:

```bash
grep -c "TCC Database (Postgres on Neon)" claude.md
```

Expected: `1`.

- [ ] **Step 3:** Commit:

```bash
git add claude.md
git commit -m "docs(db): document TCC Database in claude.md"
```

---

## Task 9: Phase 1 push

**Files:** none

- [ ] **Step 1:** Push:

```bash
git push -u origin feature/portfolio-build
```

Expected: branch created on remote with PR creation hint.

**Phase 1 complete.** You now have a working Postgres database with empty tables and a connection module. Phase 2 populates the tables.

---

# PHASE 2 — SHEETS → DB SYNC

This phase ships the data plumbing: read from existing Sheets, transform, write to Postgres. After this phase, the DB tables mirror your Sheets data and stay fresh via cron.

## Phase 2 spec (embedded)

**Sources to read:**
- Sales Tracker (`SALES_SHEET_ID`, `SALES_TAB_NAME` — typically `Sheet1` or `Merged`)
- Call Logs (`CALLLOGS_SHEET_ID`, `CALLLOGS_TAB_NAME` — `Report`)
- Goals sheet — Publisher Pricing tab + Agent Daily Goals tab

**Transformations:**
- **Phone normalization:** strip non-digits, drop leading "1" for 11-digit US numbers (matches existing GHL sync logic)
- **Carrier+Product+Payout parsing:** soft split — try comma+dash patterns to extract carrier name, product name, payout structure. If parse fails, keep original string in `policies.carrier_product_raw` and leave FKs null.
- **Agent fuzzy match:** join Sales Tracker `Agent` and Call Logs `Rep` against `agents.canonical_name` and `agents.nicknames` array using Postgres `=` and `ANY()` semantics.
- **Date parsing:** Sales Tracker uses `MM-DD-YYYY`, Call Logs use `MM/DD/YYYY h:mm[:ss] AM/PM`. Use `Date.parse()` with format coercion.

**Sync model:**
- **Reference data first:** carriers, products, campaigns, agents (these need to exist before contacts/policies/calls can FK to them)
- **Then transactional data:** contacts, policies, calls
- **Idempotent:** uses `source_row_hash` on policies and `row_hash` on calls — re-running produces no duplicates
- **Incremental:** cron runs every 30 min; tracks last-sync watermark per source in a small state table

**Failure model:** continue-on-error per row. Log errors to a sync log tab on the existing Goals sheet (matches the existing GHL sync's pattern). Failed rows retry on next run.

---

## Task 10: Add migration `002_add_sync_state.sql`

**Files:**
- Create: `migrations/002_add_sync_state.sql`

- [ ] **Step 1:** Write `migrations/002_add_sync_state.sql`:

```sql
-- migrations/002_add_sync_state.sql
-- Track per-source sync watermarks so the cron can do incremental sync.

CREATE TABLE sync_state (
  source_key      TEXT PRIMARY KEY,    -- e.g. 'sales_tracker', 'call_logs', 'campaigns'
  last_sync_at    TIMESTAMPTZ,
  last_watermark  TEXT,                -- arbitrary string (e.g. max import_date)
  last_run_status TEXT,                -- 'success' | 'partial' | 'error'
  last_error      TEXT,
  rows_processed  INTEGER NOT NULL DEFAULT 0,
  rows_errored    INTEGER NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_updated_at_sync_state BEFORE UPDATE ON sync_state
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
```

- [ ] **Step 2:** Apply:

```bash
node --env-file=.env.local scripts/db-migrate.mjs up
```

Expected: applies `002_add_sync_state.sql`.

- [ ] **Step 3:** Verify:

```bash
node --env-file=.env.local --input-type=module -e "
import('./src/lib/db.js').then(async ({ sql, closeDb }) => {
  const rows = await sql\`SELECT tablename FROM pg_tables WHERE tablename = 'sync_state'\`;
  if (rows.length !== 1) { console.error('FAIL'); process.exit(1); }
  console.log('sync_state OK');
  await closeDb();
});
"
```

- [ ] **Step 4:** Commit:

```bash
git add migrations/002_add_sync_state.sql
git commit -m "feat(db-sync): add sync_state tracking table"
```

---

## Task 11: Sync — campaigns (from Publisher Pricing tab)

**Files:**
- Create: `src/lib/db-sync/campaigns.js`

- [ ] **Step 1:** Write `src/lib/db-sync/campaigns.js`:

```javascript
// src/lib/db-sync/campaigns.js
import { sql } from '../db.js';
import { readRawSheet } from '../sheets.js';

/**
 * Sync campaigns from Goals sheet "Publisher Pricing" tab.
 * Idempotent: upsert by `code`. Updates pricing fields if changed.
 *
 * Returns { processed, inserted, updated }.
 */
export async function syncCampaigns() {
  const sheetId = process.env.GOALS_SHEET_ID;
  const tab = process.env.GOALS_PRICING_TAB || 'Publisher Pricing';
  if (!sheetId) throw new Error('GOALS_SHEET_ID not set');

  const { data } = await readRawSheet(sheetId, tab);
  let inserted = 0, updated = 0;

  for (const row of data) {
    const code = (row['Campaign Code'] ?? '').trim();
    if (!code) continue;
    const vendor = (row['Vendor'] ?? '').trim() || null;
    const priceStr = (row['Price per Billable Call ($)'] ?? '').toString().replace(/[^0-9.]/g, '');
    const price = priceStr ? parseFloat(priceStr) : null;
    const bufferSecs = parseInt(row['Buffer (seconds)'] ?? '0', 10) || null;
    const category = (row['Category'] ?? '').trim() || null;
    const status = (row['Status'] ?? 'active').trim() || 'active';

    const result = await sql`
      INSERT INTO campaigns (code, vendor, price_per_billable_call, buffer_seconds, category, status)
      VALUES (${code}, ${vendor}, ${price}, ${bufferSecs}, ${category}, ${status})
      ON CONFLICT (code) DO UPDATE SET
        vendor = EXCLUDED.vendor,
        price_per_billable_call = EXCLUDED.price_per_billable_call,
        buffer_seconds = EXCLUDED.buffer_seconds,
        category = EXCLUDED.category,
        status = EXCLUDED.status,
        updated_at = NOW()
      RETURNING (xmax = 0) AS inserted
    `;
    if (result[0]?.inserted) inserted++;
    else updated++;
  }

  return { processed: data.length, inserted, updated };
}
```

- [ ] **Step 2:** Verify (live — reads Sheets):

```bash
node --env-file=.env.local --input-type=module -e "
import('./src/lib/db-sync/campaigns.js').then(async ({ syncCampaigns }) => {
  const r = await syncCampaigns();
  console.log('Result:', r);
  // Verify rows landed
  const { sql } = await import('./src/lib/db.js');
  const rows = await sql\`SELECT code, vendor FROM campaigns ORDER BY code\`;
  console.log('Campaigns in DB:', rows.length);
  for (const r of rows.slice(0, 5)) console.log(' ', r.code, '/', r.vendor);
  process.exit(0);
});
"
```

Expected: `Result: { processed: N, inserted: N, updated: 0 }` on first run; second run shows `updated: N`.

- [ ] **Step 3:** Commit:

```bash
git add src/lib/db-sync/campaigns.js
git commit -m "feat(db-sync): sync campaigns from Publisher Pricing tab"
```

---

## Task 12: Sync — carriers + products (parsed from "Carrier + Product + Payout")

**Files:**
- Create: `src/lib/db-sync/carriers-products.js`

- [ ] **Step 1:** Write `src/lib/db-sync/carriers-products.js`:

```javascript
// src/lib/db-sync/carriers-products.js
import { sql } from '../db.js';
import { readRawSheet } from '../sheets.js';

/**
 * Parse "Carrier + Product + Payout" string into structured parts.
 * Examples:
 *   "American Amicable - Senior Choice Immediate - 100% Day 1"
 *      → { carrier: "American Amicable", product: "Senior Choice Immediate", payout: "100% Day 1" }
 *   "American Amicable, American Amicable Senior Choice"
 *      → { carrier: "American Amicable", product: "American Amicable Senior Choice", payout: null }
 *   "American Amicable"
 *      → { carrier: "American Amicable", product: null, payout: null }
 */
export function parseCarrierProductPayout(raw) {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  // Try " - " split first (most structured format)
  if (s.includes(' - ')) {
    const parts = s.split(' - ').map(p => p.trim());
    return { carrier: parts[0] || null, product: parts[1] || null, payout: parts.slice(2).join(' - ') || null };
  }
  // Fall back to comma split
  if (s.includes(',')) {
    const parts = s.split(',').map(p => p.trim());
    return { carrier: parts[0] || null, product: parts[1] || null, payout: parts[2] || null };
  }
  // Just the carrier name
  return { carrier: s, product: null, payout: null };
}

/**
 * Sync carriers + products from Sales Tracker rows. Reads "Carrier + Product +
 * Payout" column, parses, upserts into both tables.
 *
 * Returns { processed, carriersUpserted, productsUpserted, parseFailures }.
 */
export async function syncCarriersAndProducts() {
  const sheetId = process.env.SALES_SHEET_ID;
  const tab = process.env.SALES_TAB_NAME || 'Sheet1';
  if (!sheetId) throw new Error('SALES_SHEET_ID not set');

  const { data } = await readRawSheet(sheetId, tab);
  const carrierSet = new Map(); // canonical name → { display_name, productSet }

  let parseFailures = 0;
  for (const row of data) {
    const raw = (row['Carrier + Product + Payout'] ?? '').trim();
    if (!raw) continue;
    const parsed = parseCarrierProductPayout(raw);
    if (!parsed?.carrier) { parseFailures++; continue; }
    if (!carrierSet.has(parsed.carrier)) carrierSet.set(parsed.carrier, { displayName: raw, productSet: new Map() });
    if (parsed.product) {
      const c = carrierSet.get(parsed.carrier);
      if (!c.productSet.has(parsed.product)) c.productSet.set(parsed.product, parsed.payout);
    }
  }

  let carriersUpserted = 0, productsUpserted = 0;

  for (const [carrierName, info] of carrierSet) {
    const [carrier] = await sql`
      INSERT INTO carriers (name, display_name)
      VALUES (${carrierName}, ${info.displayName})
      ON CONFLICT (name) DO UPDATE SET updated_at = NOW()
      RETURNING id
    `;
    carriersUpserted++;
    for (const [productName, payoutStructure] of info.productSet) {
      await sql`
        INSERT INTO products (carrier_id, name, payout_structure)
        VALUES (${carrier.id}, ${productName}, ${payoutStructure})
        ON CONFLICT (carrier_id, name) DO UPDATE SET
          payout_structure = EXCLUDED.payout_structure,
          updated_at = NOW()
      `;
      productsUpserted++;
    }
  }

  return { processed: data.length, carriersUpserted, productsUpserted, parseFailures };
}
```

- [ ] **Step 2:** Verify:

```bash
node --env-file=.env.local --input-type=module -e "
import('./src/lib/db-sync/carriers-products.js').then(async ({ syncCarriersAndProducts, parseCarrierProductPayout }) => {
  // Unit-check the parser
  const cases = [
    ['American Amicable - Senior Choice Immediate - 100% Day 1', 'American Amicable', 'Senior Choice Immediate', '100% Day 1'],
    ['American Amicable, American Amicable Senior Choice', 'American Amicable', 'American Amicable Senior Choice', null],
    ['American Amicable', 'American Amicable', null, null],
    ['', null, null, null],
  ];
  for (const [input, ec, ep, epay] of cases) {
    const r = parseCarrierProductPayout(input);
    if (input === '') { if (r !== null) { console.error('FAIL empty', r); process.exit(1); } continue; }
    if (r.carrier !== ec || r.product !== ep || r.payout !== epay) { console.error('FAIL', input, '→', r); process.exit(1); }
  }
  console.log('parser OK');

  const r = await syncCarriersAndProducts();
  console.log('Sync result:', r);
  const { sql } = await import('./src/lib/db.js');
  const carriers = await sql\`SELECT COUNT(*)::int AS n FROM carriers\`;
  const products = await sql\`SELECT COUNT(*)::int AS n FROM products\`;
  console.log('Carriers in DB:', carriers[0].n, '| Products:', products[0].n);
  process.exit(0);
});
"
```

Expected: `parser OK`, then sync result with `carriersUpserted` ~4–6 and `productsUpserted` ~10–15.

- [ ] **Step 3:** Commit:

```bash
git add src/lib/db-sync/carriers-products.js
git commit -m "feat(db-sync): parse + sync carriers and products from Sales Tracker"
```

---

## Task 13: Sync — agents

**Files:**
- Create: `src/lib/db-sync/agents.js`

- [ ] **Step 1:** Write `src/lib/db-sync/agents.js`:

```javascript
// src/lib/db-sync/agents.js
import { sql } from '../db.js';
import { readRawSheet } from '../sheets.js';

/**
 * Sync agents from:
 *   - Goals sheet "Agent Daily Goals" tab (canonical names + goals)
 *   - Sales Tracker `Agent` column (any agent who's written a policy)
 *   - Call Logs `Rep` column (any rep who's worked a call)
 *
 * Strategy: collect ALL distinct names from these three sources, upsert
 * by canonical_name. The Goals tab is authoritative for canonical_name +
 * goals; other sources contribute names that go into nicknames if they
 * don't match the canonical list directly.
 *
 * Returns { processed, inserted, updated }.
 */
export async function syncAgents() {
  const goalsId = process.env.GOALS_SHEET_ID;
  const goalsTab = process.env.GOALS_AGENT_TAB || 'Agent Daily Goals';
  const salesId = process.env.SALES_SHEET_ID;
  const salesTab = process.env.SALES_TAB_NAME || 'Sheet1';
  const callLogsId = process.env.CALLLOGS_SHEET_ID;
  const callLogsTab = process.env.CALLLOGS_TAB_NAME || 'Report';

  // Authoritative list from Goals
  const { data: goalsData } = await readRawSheet(goalsId, goalsTab);
  const canonical = new Map(); // name → { goals }
  for (const row of goalsData) {
    const name = (row['Agent Name'] ?? '').trim();
    if (!name) continue;
    canonical.set(name, {
      dailyPremiumGoal: parseFloat((row['Premium/Day ($)'] ?? '0').toString().replace(/[^0-9.]/g, '')) || null,
      dailyAppsGoal: parseInt(row['Apps/Day'] ?? '0', 10) || null,
    });
  }

  // Other names from Sales + Call Logs
  const otherNames = new Set();
  const { data: salesData } = await readRawSheet(salesId, salesTab);
  for (const row of salesData) {
    const n = (row['Agent'] ?? '').trim();
    if (n && !canonical.has(n)) otherNames.add(n);
  }
  const { data: callData } = await readRawSheet(callLogsId, callLogsTab);
  for (const row of callData) {
    const n = (row['Rep'] ?? '').trim();
    if (n && !canonical.has(n)) otherNames.add(n);
  }

  let inserted = 0, updated = 0;

  // Insert canonical agents
  for (const [name, goals] of canonical) {
    const r = await sql`
      INSERT INTO agents (canonical_name, daily_premium_goal, daily_apps_goal)
      VALUES (${name}, ${goals.dailyPremiumGoal}, ${goals.dailyAppsGoal})
      ON CONFLICT (canonical_name) DO UPDATE SET
        daily_premium_goal = EXCLUDED.daily_premium_goal,
        daily_apps_goal = EXCLUDED.daily_apps_goal,
        updated_at = NOW()
      RETURNING (xmax = 0) AS inserted
    `;
    if (r[0]?.inserted) inserted++;
    else updated++;
  }

  // Insert non-canonical names. They go in as their own row with no goals;
  // an operator can later merge them by hand if they're nicknames of a canonical agent.
  for (const name of otherNames) {
    const r = await sql`
      INSERT INTO agents (canonical_name)
      VALUES (${name})
      ON CONFLICT (canonical_name) DO NOTHING
      RETURNING id
    `;
    if (r.length > 0) inserted++;
  }

  return { processed: canonical.size + otherNames.size, inserted, updated };
}
```

- [ ] **Step 2:** Verify:

```bash
node --env-file=.env.local --input-type=module -e "
import('./src/lib/db-sync/agents.js').then(async ({ syncAgents }) => {
  const r = await syncAgents();
  console.log('Result:', r);
  const { sql } = await import('./src/lib/db.js');
  const rows = await sql\`SELECT canonical_name, daily_premium_goal FROM agents ORDER BY canonical_name\`;
  console.log('Agents in DB:', rows.length);
  for (const a of rows.slice(0, 10)) console.log(' ', a.canonicalName, '/', a.dailyPremiumGoal);
  process.exit(0);
});
"
```

Expected: ~5–15 agents (varies based on data volume).

- [ ] **Step 3:** Commit:

```bash
git add src/lib/db-sync/agents.js
git commit -m "feat(db-sync): sync agents from Goals + Sales + Call Logs"
```

---

## Task 14: Sync — contacts (from Sales Tracker + Call Logs, phone-keyed)

**Files:**
- Create: `src/lib/db-sync/contacts.js`

- [ ] **Step 1:** Write `src/lib/db-sync/contacts.js`:

```javascript
// src/lib/db-sync/contacts.js
import { sql } from '../db.js';
import { readRawSheet } from '../sheets.js';

/**
 * Normalize a phone number: strip non-digits, drop leading "1" for
 * 11-digit US numbers. Returns 10-digit string or empty.
 */
export function normalizePhone(p) {
  let s = (p ?? '').toString().replace(/\D/g, '');
  if (s.length === 11 && s.startsWith('1')) s = s.slice(1);
  return s.length === 10 ? s : '';
}

/**
 * Parse Call Log MM/DD/YYYY h:mm[:ss] AM/PM date string to a JS Date.
 * Returns null if unparseable.
 */
export function parseCallLogDate(s) {
  if (!s) return null;
  const t = Date.parse(s);
  return isNaN(t) ? null : new Date(t);
}

/**
 * Parse Sales Tracker MM-DD-YYYY date string to a JS Date.
 */
export function parseSalesDate(s) {
  if (!s) return null;
  const cleaned = s.toString().trim();
  if (!cleaned) return null;
  // Convert MM-DD-YYYY to MM/DD/YYYY for Date.parse
  const t = Date.parse(cleaned.replace(/-/g, '/'));
  return isNaN(t) ? null : new Date(t);
}

/**
 * Sync contacts from Sales Tracker + Call Logs. Phone-keyed dedup.
 *
 * For each unique phone:
 *   - If sales record exists: prefer its identity fields (full name, email,
 *     address, DOB, gender)
 *   - If only call log entries: take what's there (first/last name, state)
 *   - Always default country='US' if not set
 *
 * Returns { processed, inserted, updated, skipped }.
 */
export async function syncContacts() {
  const salesId = process.env.SALES_SHEET_ID;
  const salesTab = process.env.SALES_TAB_NAME || 'Sheet1';
  const callLogsId = process.env.CALLLOGS_SHEET_ID;
  const callLogsTab = process.env.CALLLOGS_TAB_NAME || 'Report';

  // Build a phone → identity map. Sales takes precedence for richer fields.
  const identityByPhone = new Map();

  const { data: callData } = await readRawSheet(callLogsId, callLogsTab);
  for (const row of callData) {
    const phone = normalizePhone(row['Phone']);
    if (!phone) continue;
    if (!identityByPhone.has(phone)) {
      identityByPhone.set(phone, {
        firstName: (row['First'] ?? '').trim() || null,
        lastName: (row['Last'] ?? '').trim() || null,
        state: (row['State'] ?? '').trim() || null,
        country: (row['Country'] ?? '').trim() || 'US',
        source: (row['Inbound Source'] ?? '').trim() || null,
        firstSeenAt: parseCallLogDate(row['Date']) || null,
      });
    }
  }

  const { data: salesData } = await readRawSheet(salesId, salesTab);
  for (const row of salesData) {
    const phone = normalizePhone(row['Phone Number (US format)']);
    if (!phone) continue;
    const existing = identityByPhone.get(phone) ?? {};
    identityByPhone.set(phone, {
      ...existing,
      firstName: (row['First Name'] ?? existing.firstName ?? '').trim() || existing.firstName || null,
      lastName: (row['Last Name'] ?? existing.lastName ?? '').trim() || existing.lastName || null,
      email: (row['Email Address'] ?? '').trim() || existing.email || null,
      dateOfBirth: parseSalesDate(row['Date of Birth']) || existing.dateOfBirth || null,
      gender: (row['Gender'] ?? '').trim() || existing.gender || null,
      address1: (row['Street Address'] ?? '').trim() || existing.address1 || null,
      city: (row['City'] ?? '').trim() || existing.city || null,
      state: (row['State'] ?? existing.state ?? '').trim() || existing.state || null,
      postalCode: (row['Zip Code'] ?? '').trim() || existing.postalCode || null,
      country: (row['Country'] ?? existing.country ?? 'US').trim() || existing.country || 'US',
    });
  }

  let inserted = 0, updated = 0;

  for (const [phone, ident] of identityByPhone) {
    const r = await sql`
      INSERT INTO contacts (phone, first_name, last_name, email, date_of_birth, gender, address1, city, state, postal_code, country, first_seen_at, source)
      VALUES (${phone}, ${ident.firstName}, ${ident.lastName}, ${ident.email}, ${ident.dateOfBirth}, ${ident.gender}, ${ident.address1}, ${ident.city}, ${ident.state}, ${ident.postalCode}, ${ident.country}, ${ident.firstSeenAt}, ${ident.source})
      ON CONFLICT (phone) DO UPDATE SET
        first_name = COALESCE(contacts.first_name, EXCLUDED.first_name),
        last_name = COALESCE(contacts.last_name, EXCLUDED.last_name),
        email = COALESCE(EXCLUDED.email, contacts.email),
        date_of_birth = COALESCE(EXCLUDED.date_of_birth, contacts.date_of_birth),
        gender = COALESCE(EXCLUDED.gender, contacts.gender),
        address1 = COALESCE(EXCLUDED.address1, contacts.address1),
        city = COALESCE(EXCLUDED.city, contacts.city),
        state = COALESCE(EXCLUDED.state, contacts.state),
        postal_code = COALESCE(EXCLUDED.postal_code, contacts.postal_code),
        updated_at = NOW()
      RETURNING (xmax = 0) AS inserted
    `;
    if (r[0]?.inserted) inserted++;
    else updated++;
  }

  return { processed: identityByPhone.size, inserted, updated };
}
```

- [ ] **Step 2:** Verify:

```bash
node --env-file=.env.local --input-type=module -e "
import('./src/lib/db-sync/contacts.js').then(async ({ syncContacts, normalizePhone }) => {
  // Unit-check normalize
  if (normalizePhone('+1 (555) 123-4567') !== '5551234567') { console.error('FAIL normalize 11-digit'); process.exit(1); }
  if (normalizePhone('555-123-4567') !== '5551234567') { console.error('FAIL normalize 10-digit'); process.exit(1); }
  if (normalizePhone('') !== '') { console.error('FAIL normalize empty'); process.exit(1); }
  if (normalizePhone('5551234') !== '') { console.error('FAIL normalize too-short'); process.exit(1); }

  const r = await syncContacts();
  console.log('Result:', r);
  const { sql } = await import('./src/lib/db.js');
  const [{ n: total }] = await sql\`SELECT COUNT(*)::int AS n FROM contacts\`;
  const [{ n: withEmail }] = await sql\`SELECT COUNT(*)::int AS n FROM contacts WHERE email IS NOT NULL\`;
  console.log('Total contacts:', total, '| With email:', withEmail);
  process.exit(0);
});
"
```

Expected: ~3,000–4,000 contacts (one per unique phone across both sources), of which ~250+ have email (from Sales Tracker rows).

- [ ] **Step 3:** Commit:

```bash
git add src/lib/db-sync/contacts.js
git commit -m "feat(db-sync): sync contacts from Sales + Call Logs (phone-keyed)"
```

---

## Task 15: Sync — policies (from Sales Tracker)

**Files:**
- Create: `src/lib/db-sync/policies.js`

- [ ] **Step 1:** Write `src/lib/db-sync/policies.js`:

```javascript
// src/lib/db-sync/policies.js
import { createHash } from 'node:crypto';
import { sql } from '../db.js';
import { readRawSheet } from '../sheets.js';
import { normalizePhone, parseSalesDate } from './contacts.js';
import { parseCarrierProductPayout } from './carriers-products.js';

/**
 * Compute a stable hash for a sales row. Used for idempotent inserts.
 */
function rowHash(row) {
  const parts = [row['Policy #'] ?? '', row['Phone Number (US format)'] ?? '', row['Application Submitted Date'] ?? '', row['Carrier + Product + Payout'] ?? ''];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

function parseNumeric(s) {
  if (!s) return null;
  const cleaned = s.toString().replace(/[^0-9.]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

/**
 * Sync policies from Sales Tracker. Each row in the sheet becomes one
 * policies row. Idempotent via source_row_hash UNIQUE constraint.
 *
 * Resolves FKs:
 *   - contact_id by normalized phone
 *   - carrier_id + product_id by parsing "Carrier + Product + Payout"
 *   - sales_lead_source_campaign_id by Lead Source matching campaigns.code
 *   - agent_id by Agent matching agents.canonical_name
 */
export async function syncPolicies() {
  const sheetId = process.env.SALES_SHEET_ID;
  const tab = process.env.SALES_TAB_NAME || 'Sheet1';
  if (!sheetId) throw new Error('SALES_SHEET_ID not set');

  // Pre-load FK lookup tables
  const carriers = new Map();
  const productsByCarrier = new Map();
  const carrierRows = await sql`SELECT id, name FROM carriers`;
  for (const c of carrierRows) carriers.set(c.name, c.id);
  const productRows = await sql`SELECT id, carrier_id, name FROM products`;
  for (const p of productRows) {
    if (!productsByCarrier.has(p.carrierId)) productsByCarrier.set(p.carrierId, new Map());
    productsByCarrier.get(p.carrierId).set(p.name, p.id);
  }

  const campaigns = new Map();
  const campaignRows = await sql`SELECT id, code FROM campaigns`;
  for (const c of campaignRows) campaigns.set(c.code, c.id);

  const agents = new Map();
  const agentRows = await sql`SELECT id, canonical_name FROM agents`;
  for (const a of agentRows) agents.set(a.canonicalName, a.id);

  const contactsByPhone = new Map();
  const contactRows = await sql`SELECT id, phone FROM contacts`;
  for (const c of contactRows) contactsByPhone.set(c.phone, c.id);

  const { data } = await readRawSheet(sheetId, tab);
  let inserted = 0, updated = 0, skipped = 0;

  for (const row of data) {
    const phone = normalizePhone(row['Phone Number (US format)']);
    const contactId = contactsByPhone.get(phone);
    if (!contactId) { skipped++; continue; }

    const carrierProductRaw = (row['Carrier + Product + Payout'] ?? '').trim();
    const parsed = parseCarrierProductPayout(carrierProductRaw);
    const carrierId = parsed?.carrier ? (carriers.get(parsed.carrier) ?? null) : null;
    const productId = (carrierId && parsed?.product) ? (productsByCarrier.get(carrierId)?.get(parsed.product) ?? null) : null;

    const leadSource = (row['Lead Source'] ?? '').trim();
    const campaignId = leadSource ? (campaigns.get(leadSource) ?? null) : null;

    const agentName = (row['Agent'] ?? '').trim();
    const agentId = agentName ? (agents.get(agentName) ?? null) : null;

    const hash = rowHash(row);

    const r = await sql`
      INSERT INTO policies (
        contact_id, carrier_id, product_id, sales_lead_source_campaign_id, agent_id,
        policy_number, carrier_product_raw,
        monthly_premium, face_amount, term_length,
        placed_status, outcome_at_application,
        application_date, effective_date,
        sales_lead_source_raw, sales_agent_raw, sales_notes,
        payment_type, payment_frequency, draft_day, ssn_billing_match,
        beneficiary_first_name, beneficiary_last_name, beneficiary_relationship,
        source_row_hash
      ) VALUES (
        ${contactId}, ${carrierId}, ${productId}, ${campaignId}, ${agentId},
        ${row['Policy #'] || null}, ${carrierProductRaw || null},
        ${parseNumeric(row['Monthly Premium'])}, ${parseNumeric(row['Face Amount'])}, ${row['Term Length'] || null},
        ${row['Placed?'] || null}, ${row['Outcome at Application Submission'] || null},
        ${parseSalesDate(row['Application Submitted Date'])}, ${parseSalesDate(row['Effective Date'])},
        ${leadSource || null}, ${agentName || null}, ${row['Sales Notes'] || null},
        ${row['Payment Type'] || null}, ${row['Payment Frequency'] || null}, ${row['Draft Day'] || null}, ${row['Social Security Billing Match'] || null},
        ${row['Beneficiary - First Name'] || null}, ${row['Beneficiary - Last Name'] || null}, ${row['Relationship to Insured'] || null},
        ${hash}
      )
      ON CONFLICT (source_row_hash) DO UPDATE SET
        placed_status = EXCLUDED.placed_status,
        monthly_premium = EXCLUDED.monthly_premium,
        effective_date = EXCLUDED.effective_date,
        sales_notes = EXCLUDED.sales_notes,
        updated_at = NOW()
      RETURNING (xmax = 0) AS inserted
    `;
    if (r[0]?.inserted) inserted++;
    else updated++;
  }

  return { processed: data.length, inserted, updated, skipped };
}
```

- [ ] **Step 2:** Verify:

```bash
node --env-file=.env.local --input-type=module -e "
import('./src/lib/db-sync/policies.js').then(async ({ syncPolicies }) => {
  const r = await syncPolicies();
  console.log('Result:', r);
  const { sql } = await import('./src/lib/db.js');
  const [{ n: total }] = await sql\`SELECT COUNT(*)::int AS n FROM policies\`;
  const [{ n: withCarrier }] = await sql\`SELECT COUNT(*)::int AS n FROM policies WHERE carrier_id IS NOT NULL\`;
  console.log('Total policies:', total, '| With FK carrier:', withCarrier);
  process.exit(0);
});
"
```

Expected: ~262 policies inserted; FK carrier resolved on most.

- [ ] **Step 3:** Commit:

```bash
git add src/lib/db-sync/policies.js
git commit -m "feat(db-sync): sync policies from Sales Tracker (idempotent via row hash)"
```

---

## Task 16: Sync — calls (from Call Logs)

**Files:**
- Create: `src/lib/db-sync/calls.js`

- [ ] **Step 1:** Write `src/lib/db-sync/calls.js`:

```javascript
// src/lib/db-sync/calls.js
import { createHash } from 'node:crypto';
import { sql } from '../db.js';
import { readRawSheet } from '../sheets.js';
import { normalizePhone, parseCallLogDate } from './contacts.js';

function rowHash(row) {
  const parts = [row['Lead Id'] ?? '', row['Date'] ?? '', row['Phone'] ?? '', row['Duration'] ?? ''];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

/**
 * Sync calls from Call Logs. Idempotent via row_hash UNIQUE.
 * Resolves contact_id by phone, campaign_id by Campaign code, agent_id by Rep name.
 */
export async function syncCalls() {
  const sheetId = process.env.CALLLOGS_SHEET_ID;
  const tab = process.env.CALLLOGS_TAB_NAME || 'Report';
  if (!sheetId) throw new Error('CALLLOGS_SHEET_ID not set');

  // Pre-load FK lookups
  const contactsByPhone = new Map();
  for (const c of await sql`SELECT id, phone FROM contacts`) contactsByPhone.set(c.phone, c.id);
  const campaigns = new Map();
  for (const c of await sql`SELECT id, code FROM campaigns`) campaigns.set(c.code, c.id);
  const agents = new Map();
  for (const a of await sql`SELECT id, canonical_name FROM agents`) agents.set(a.canonicalName, a.id);

  const { data } = await readRawSheet(sheetId, tab);
  let inserted = 0, skipped = 0;

  for (const row of data) {
    const phone = normalizePhone(row['Phone']);
    const contactId = contactsByPhone.get(phone);
    if (!contactId) { skipped++; continue; }

    const code = (row['Campaign'] ?? '').trim();
    const campaignId = code ? (campaigns.get(code) ?? null) : null;
    const repName = (row['Rep'] ?? '').trim();
    const agentId = repName ? (agents.get(repName) ?? null) : null;

    const callDate = parseCallLogDate(row['Date']);
    if (!callDate) { skipped++; continue; }

    const durStr = (row['Duration'] ?? '').toString().trim();
    let durSec = null;
    // Handle "h:mm:ss" or "mm:ss" or seconds-as-int
    if (/^\d+:\d+(:\d+)?$/.test(durStr)) {
      const parts = durStr.split(':').map(p => parseInt(p, 10));
      durSec = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
    } else {
      const n = parseInt(durStr, 10);
      durSec = isNaN(n) ? null : n;
    }

    try {
      await sql`
        INSERT INTO calls (
          contact_id, campaign_id, agent_id,
          call_date, campaign_code, subcampaign, rep_name, phone_raw,
          attempt_number, caller_id, inbound_source, lead_id, client_id,
          call_status, is_callable, duration_seconds, call_type, details,
          hangup, hold_time, hangup_source, recording_url, import_date,
          row_hash
        ) VALUES (
          ${contactId}, ${campaignId}, ${agentId},
          ${callDate}, ${code || null}, ${row['Subcampaign'] || null}, ${repName || null}, ${row['Phone'] || null},
          ${parseInt(row['Attempt'] ?? '0', 10) || null}, ${row['Caller ID'] || null}, ${row['Inbound Source'] || null}, ${row['Lead Id'] || null}, ${row['Client ID'] || null},
          ${row['Call Status'] || null}, ${(row['Is Callable'] ?? '').toLowerCase().startsWith('y')}, ${durSec}, ${row['Call Type'] || null}, ${row['Details'] || null},
          ${row['Hangup'] || null}, ${row['HoldTime'] || null}, ${row['Hangup Source'] || null}, ${row['Recording'] || null}, ${parseCallLogDate(row['Import Date'])},
          ${rowHash(row)}
        )
        ON CONFLICT (row_hash) DO NOTHING
      `;
      inserted++;
    } catch (e) {
      skipped++;
    }
  }

  return { processed: data.length, inserted, skipped };
}
```

- [ ] **Step 2:** Verify:

```bash
node --env-file=.env.local --input-type=module -e "
import('./src/lib/db-sync/calls.js').then(async ({ syncCalls }) => {
  const r = await syncCalls();
  console.log('Result:', r);
  const { sql } = await import('./src/lib/db.js');
  const [{ n: total }] = await sql\`SELECT COUNT(*)::int AS n FROM calls\`;
  const [{ n: withFk }] = await sql\`SELECT COUNT(*)::int AS n FROM calls WHERE campaign_id IS NOT NULL\`;
  console.log('Total calls:', total, '| With FK campaign:', withFk);
  process.exit(0);
});
" 2>&1 | tail -10
```

Expected: ~6,000 calls inserted; majority have FK campaign resolved.

- [ ] **Step 3:** Commit:

```bash
git add src/lib/db-sync/calls.js
git commit -m "feat(db-sync): sync calls from Call Logs (idempotent via row hash)"
```

---

## Task 17: Refresh denormalized contact state

**Files:**
- Create: `src/lib/db-sync/refresh-denorms.js`

- [ ] **Step 1:** Write `src/lib/db-sync/refresh-denorms.js`:

```javascript
// src/lib/db-sync/refresh-denorms.js
import { sql } from '../db.js';

/**
 * Recompute denormalized state on contacts:
 *   - last_seen_at = max(call_date) over the contact's calls
 *   - total_calls = count of calls
 *   - is_callable = latest call's is_callable
 *   - tags = ['publisher:<latest campaign>', 'state:<state>', 'callable:yes|no']
 *
 * Called after calls + policies are synced. Run as a single SQL UPDATE
 * for performance (vs. iterating per-contact in JS).
 */
export async function refreshContactDenorms() {
  const t0 = Date.now();
  await sql`
    UPDATE contacts c SET
      last_seen_at = stats.last_call,
      total_calls = stats.call_count,
      is_callable = stats.is_callable,
      tags = COALESCE(stats.tags, '{}'),
      updated_at = NOW()
    FROM (
      SELECT
        c.id AS contact_id,
        MAX(ca.call_date) AS last_call,
        COUNT(ca.id)::int AS call_count,
        BOOL_OR(ca.is_callable) AS is_callable,
        ARRAY(
          SELECT DISTINCT t FROM unnest(ARRAY[
            CASE WHEN c.state IS NOT NULL THEN 'state:' || c.state END,
            CASE WHEN BOOL_OR(ca.is_callable) THEN 'callable:yes' ELSE 'callable:no' END,
            CASE WHEN MAX(ca.campaign_code) IS NOT NULL THEN 'publisher:' || MAX(ca.campaign_code) END
          ]) AS t WHERE t IS NOT NULL
        ) AS tags
      FROM contacts c
      LEFT JOIN calls ca ON ca.contact_id = c.id
      GROUP BY c.id, c.state
    ) AS stats
    WHERE c.id = stats.contact_id
  `;
  return { elapsedMs: Date.now() - t0 };
}
```

- [ ] **Step 2:** Verify:

```bash
node --env-file=.env.local --input-type=module -e "
import('./src/lib/db-sync/refresh-denorms.js').then(async ({ refreshContactDenorms }) => {
  const r = await refreshContactDenorms();
  console.log('Refresh:', r);
  const { sql } = await import('./src/lib/db.js');
  const [{ avg, max }] = await sql\`SELECT AVG(total_calls)::numeric(10,2) AS avg, MAX(total_calls) AS max FROM contacts\`;
  const [{ tagged }] = await sql\`SELECT COUNT(*)::int AS tagged FROM contacts WHERE array_length(tags, 1) > 0\`;
  console.log('Avg calls per contact:', avg, '| Max:', max, '| Tagged contacts:', tagged);
  process.exit(0);
});
"
```

Expected: refresh completes in <5 sec; avg calls > 1; most contacts have tags.

- [ ] **Step 3:** Commit:

```bash
git add src/lib/db-sync/refresh-denorms.js
git commit -m "feat(db-sync): refresh denormalized contact state (last_seen_at, tags, etc.)"
```

---

## Task 18: Pipeline orchestrator + cron route + backfill route

**Files:**
- Create: `src/lib/db-sync/pipeline.js`
- Create: `src/app/api/cron/db-sync/route.js`
- Create: `src/app/api/db-backfill/route.js`
- Modify: `vercel.json` (add cron + maxDuration)

- [ ] **Step 1:** Write `src/lib/db-sync/pipeline.js`:

```javascript
// src/lib/db-sync/pipeline.js
import { sql } from '../db.js';
import { syncCampaigns } from './campaigns.js';
import { syncCarriersAndProducts } from './carriers-products.js';
import { syncAgents } from './agents.js';
import { syncContacts } from './contacts.js';
import { syncPolicies } from './policies.js';
import { syncCalls } from './calls.js';
import { refreshContactDenorms } from './refresh-denorms.js';

/**
 * Run the full Sheets → DB sync pipeline in dependency order.
 * Reference data first (campaigns, carriers/products, agents),
 * then transactional data (contacts, policies, calls),
 * then denorm refresh.
 */
export async function runFullSync() {
  const overall = { startedAt: new Date().toISOString(), steps: {} };

  for (const [key, fn] of [
    ['campaigns', syncCampaigns],
    ['carriers_products', syncCarriersAndProducts],
    ['agents', syncAgents],
    ['contacts', syncContacts],
    ['policies', syncPolicies],
    ['calls', syncCalls],
    ['refresh_denorms', refreshContactDenorms],
  ]) {
    const t0 = Date.now();
    try {
      const result = await fn();
      const elapsedMs = Date.now() - t0;
      overall.steps[key] = { ok: true, elapsedMs, ...result };
      await sql`
        INSERT INTO sync_state (source_key, last_sync_at, last_run_status, rows_processed, rows_errored)
        VALUES (${key}, NOW(), 'success', ${result.processed ?? result.inserted ?? 0}, 0)
        ON CONFLICT (source_key) DO UPDATE SET
          last_sync_at = NOW(),
          last_run_status = 'success',
          last_error = NULL,
          rows_processed = EXCLUDED.rows_processed,
          rows_errored = 0,
          updated_at = NOW()
      `;
    } catch (e) {
      const elapsedMs = Date.now() - t0;
      overall.steps[key] = { ok: false, elapsedMs, error: e.message };
      await sql`
        INSERT INTO sync_state (source_key, last_sync_at, last_run_status, last_error, rows_errored)
        VALUES (${key}, NOW(), 'error', ${e.message}, 1)
        ON CONFLICT (source_key) DO UPDATE SET
          last_sync_at = NOW(),
          last_run_status = 'error',
          last_error = EXCLUDED.last_error,
          rows_errored = sync_state.rows_errored + 1,
          updated_at = NOW()
      `;
      // Continue to next step — don't abort the whole pipeline on one source's failure
    }
  }

  overall.finishedAt = new Date().toISOString();
  return overall;
}
```

- [ ] **Step 2:** Write `src/app/api/cron/db-sync/route.js`:

```javascript
// src/app/api/cron/db-sync/route.js
import { NextResponse } from 'next/server';
import { runFullSync } from '@/lib/db-sync/pipeline';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization') ?? '';
    const url = new URL(req.url);
    const queryToken = url.searchParams.get('secret') ?? '';
    const headerToken = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (headerToken !== cronSecret && queryToken !== cronSecret) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  try {
    const result = await runFullSync();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 3:** Write `src/app/api/db-backfill/route.js`:

```javascript
// src/app/api/db-backfill/route.js
// Manual one-shot full sync. Same as cron but always runs, no kill switch.
import { NextResponse } from 'next/server';
import { runFullSync } from '@/lib/db-sync/pipeline';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization') ?? '';
    const url = new URL(req.url);
    const queryToken = url.searchParams.get('secret') ?? '';
    const headerToken = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (headerToken !== cronSecret && queryToken !== cronSecret) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }
  try {
    const result = await runFullSync();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 4:** Update `vercel.json`. Read it first, then add:

```bash
cat vercel.json
```

In the `functions` object, add:
```json
"src/app/api/cron/db-sync/route.js": { "maxDuration": 60 },
"src/app/api/db-backfill/route.js": { "maxDuration": 60 }
```

In the `crons` array, add:
```json
{ "path": "/api/cron/db-sync", "schedule": "*/30 * * * *" }
```

Use the Edit tool to make these surgical changes; do not rewrite the whole file.

- [ ] **Step 5:** Verify build:

```bash
npm run build 2>&1 | tail -10
```

Expected: build succeeds, both new routes in the route table.

- [ ] **Step 6:** Run the full pipeline locally:

```bash
node --env-file=.env.local --input-type=module -e "
import('./src/lib/db-sync/pipeline.js').then(async ({ runFullSync }) => {
  const r = await runFullSync();
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
});
" 2>&1 | tail -50
```

Expected: each step shows `ok: true` with `elapsedMs` and counts. Total runtime <60 sec.

- [ ] **Step 7:** Commit:

```bash
git add src/lib/db-sync/pipeline.js src/app/api/cron/db-sync/route.js src/app/api/db-backfill/route.js vercel.json
git commit -m "feat(db-sync): pipeline orchestrator + cron + backfill routes"
```

---

## Task 19: Phase 2 sanity check + push

**Files:** none

- [ ] **Step 1:** End-to-end sanity check:

```bash
node --env-file=.env.local --input-type=module -e "
import('./src/lib/db.js').then(async ({ sql, closeDb }) => {
  const [{ contacts }] = await sql\`SELECT COUNT(*)::int AS contacts FROM contacts\`;
  const [{ calls }] = await sql\`SELECT COUNT(*)::int AS calls FROM calls\`;
  const [{ policies }] = await sql\`SELECT COUNT(*)::int AS policies FROM policies\`;
  const [{ campaigns }] = await sql\`SELECT COUNT(*)::int AS campaigns FROM campaigns\`;
  const [{ carriers }] = await sql\`SELECT COUNT(*)::int AS carriers FROM carriers\`;
  const [{ products }] = await sql\`SELECT COUNT(*)::int AS products FROM products\`;
  const [{ agents }] = await sql\`SELECT COUNT(*)::int AS agents FROM agents\`;
  console.log('═══════════════════════════════════════════');
  console.log(' DB POPULATION');
  console.log('═══════════════════════════════════════════');
  console.log(' contacts: ', contacts);
  console.log(' calls:    ', calls);
  console.log(' policies: ', policies);
  console.log(' campaigns:', campaigns);
  console.log(' carriers: ', carriers);
  console.log(' products: ', products);
  console.log(' agents:   ', agents);
  await closeDb();
});
"
```

Expected: contacts ~3,500, calls ~6,500, policies ~262, campaigns ~10–20, carriers ~4–6, products ~10–15, agents ~5–15.

- [ ] **Step 2:** Push:

```bash
git push
```

**Phase 2 complete.** DB is fully populated from Sheets and stays fresh via the every-30-min cron. Phase 3 builds the UI on top.

---

# PHASE 3 — PORTFOLIO UI

This phase ships the new Portfolio tab that replaces Lead CRM + Retention Dashboard + Business Health. Reads from the DB (fast), supports pivot grouping, drill-in detail, and bulk export.

## Phase 3 spec (embedded)

**The user experience:**
- Single tab "Portfolio" replaces 3 existing CRM tabs in the dashboard
- Left sidebar: list of saved smart-list views (e.g., "All Submitted", "Active Policies", "Recently Lapsed"). Default views are seeded; users can save new ones (V2 — for now, hardcode the defaults).
- Top toolbar: search box, group-by dropdown, filter chips, bulk-action button row (visible when rows selected)
- Main panel: contact grid OR group-summary view, depending on group-by selection
- When a contact row is clicked: slide-in detail panel with full record (call timeline, policy info, notes)

**Data flow:**
- API endpoint `GET /api/portfolio/contacts?filters=...&groupBy=...&page=...&pageSize=...` returns the visible page of contacts
- API endpoint `GET /api/portfolio/contact/:id` returns the full record (joins contacts + policies + calls)
- API endpoint `GET /api/portfolio/export?filters=...` returns a CSV of the filtered set
- API endpoint `GET /api/portfolio/dialer-export?filters=...` returns a ChaseData-format CSV

**Filter spec (the `filters=` query param JSON):**
```javascript
{
  smartList: 'all_submitted' | 'active_policies' | 'recently_lapsed' | 'pending' | 'declined' | 'high_value' | null,
  search: 'john',                  // free-text matched on first_name, last_name, phone
  state: ['CA', 'TX'],
  carrierId: 1,
  agentId: 2,
  campaignId: 3,
  placedStatusContains: 'pending',
  premiumMin: 50,
  premiumMax: 200,
}
```

**Group-by dropdown options:**
- `none` (default — flat list)
- `state`
- `carrier` (joined to carriers table)
- `placed_status` (raw text from policies)
- `agent`
- `campaign` (sales lead source)
- `month` (application_date truncated to month)

When grouped, the response shape switches from `{ contacts: [...] }` to `{ groups: [{ key, count, sumPremium, sampleContacts: [...3] }] }`. Clicking a group drills into a flat list filtered to that group.

---

## Task 20: API — `GET /api/portfolio/contacts` (list with filters + grouping)

**Files:**
- Create: `src/lib/portfolio/filters.js`
- Create: `src/lib/portfolio/query.js`
- Create: `src/app/api/portfolio/contacts/route.js`

- [ ] **Step 1:** Write `src/lib/portfolio/filters.js`:

```javascript
// src/lib/portfolio/filters.js
// Translate a filters object (from query string) into SQL WHERE clauses
// using postgres.js's tagged-template fragments for safe parameterization.

import { sql } from '../db.js';

/**
 * Smart list definitions: each maps to additional filter conditions.
 * Keep these in sync with the UI sidebar (`PortfolioFilterSidebar.jsx`).
 */
const SMART_LISTS = {
  all_submitted: { applicationDateNotNull: true },
  active_policies: { applicationDateNotNull: true, placedStatusContains: ['active', 'in force', 'advance released'] },
  recently_lapsed: { applicationDateNotNull: true, placedStatusContains: ['lapsed', 'canceled', 'cancelled'] },
  pending: { applicationDateNotNull: true, placedStatusContains: ['pending', 'submitted', 'awaiting'] },
  declined: { applicationDateNotNull: true, placedStatusContains: ['declined'] },
  high_value: { applicationDateNotNull: true, placedStatusContains: ['active', 'in force'], premiumMin: 100 },
};

/**
 * Build a WHERE clause fragment for the given filters.
 * Returns { where: <fragment>, joinPolicies: bool, joinCarriers: bool, ... }.
 *
 * Caller composes with the final query.
 */
export function buildWhereFragment(filters = {}) {
  const f = { ...filters };
  if (f.smartList && SMART_LISTS[f.smartList]) Object.assign(f, SMART_LISTS[f.smartList]);

  const conditions = [];
  let joinPolicies = false;
  let joinCarriers = false;

  if (f.applicationDateNotNull) { joinPolicies = true; conditions.push(sql`p.application_date IS NOT NULL`); }
  if (f.placedStatusContains && f.placedStatusContains.length) {
    joinPolicies = true;
    const orParts = f.placedStatusContains.map(s => sql`LOWER(p.placed_status) LIKE ${'%' + s.toLowerCase() + '%'}`);
    conditions.push(sql`(${orParts.flatMap((c, i) => i === 0 ? c : [sql` OR `, c])})`);
  }
  if (f.search) {
    const q = '%' + f.search.toLowerCase() + '%';
    conditions.push(sql`(LOWER(c.first_name) LIKE ${q} OR LOWER(c.last_name) LIKE ${q} OR c.phone LIKE ${'%' + f.search + '%'})`);
  }
  if (f.state && f.state.length) conditions.push(sql`c.state = ANY(${f.state})`);
  if (f.carrierId) { joinPolicies = true; conditions.push(sql`p.carrier_id = ${f.carrierId}`); }
  if (f.agentId) { joinPolicies = true; conditions.push(sql`p.agent_id = ${f.agentId}`); }
  if (f.campaignId) { joinPolicies = true; conditions.push(sql`p.sales_lead_source_campaign_id = ${f.campaignId}`); }
  if (f.premiumMin != null) { joinPolicies = true; conditions.push(sql`p.monthly_premium >= ${f.premiumMin}`); }
  if (f.premiumMax != null) { joinPolicies = true; conditions.push(sql`p.monthly_premium <= ${f.premiumMax}`); }

  return { conditions, joinPolicies, joinCarriers };
}
```

- [ ] **Step 2:** Write `src/lib/portfolio/query.js`:

```javascript
// src/lib/portfolio/query.js
import { sql } from '../db.js';
import { buildWhereFragment } from './filters.js';

/**
 * Compose a SELECT against contacts (LEFT JOIN policies if needed) with
 * the given filter conditions and pagination. Returns { rows, total }.
 */
export async function listContacts({ filters = {}, page = 1, pageSize = 50, sortBy = 'last_seen_at', sortDir = 'desc' }) {
  const { conditions, joinPolicies } = buildWhereFragment(filters);
  const offset = (page - 1) * pageSize;

  const whereClause = conditions.length === 0 ? sql`` :
    sql`WHERE ${conditions.flatMap((c, i) => i === 0 ? c : [sql` AND `, c])}`;

  const policiesJoin = joinPolicies ? sql`LEFT JOIN policies p ON p.contact_id = c.id` : sql``;

  // Pick a sort column safely
  const sortColumns = {
    last_seen_at: sql`c.last_seen_at`,
    name: sql`c.last_name`,
    application_date: sql`MAX(p.application_date)`,
    monthly_premium: sql`MAX(p.monthly_premium)`,
    state: sql`c.state`,
  };
  const sortCol = sortColumns[sortBy] ?? sql`c.last_seen_at`;
  const sortDirection = sortDir === 'asc' ? sql`ASC` : sql`DESC`;

  const rows = await sql`
    SELECT
      c.id, c.phone, c.first_name, c.last_name, c.state, c.last_seen_at, c.total_calls, c.tags,
      MAX(p.placed_status) AS placed_status,
      MAX(p.policy_number) AS policy_number,
      MAX(p.monthly_premium) AS monthly_premium,
      MAX(p.application_date) AS application_date,
      MAX(p.sales_agent_raw) AS sales_agent,
      MAX(p.carrier_product_raw) AS carrier_product
    FROM contacts c
    ${policiesJoin}
    ${whereClause}
    GROUP BY c.id
    ORDER BY ${sortCol} ${sortDirection} NULLS LAST
    LIMIT ${pageSize} OFFSET ${offset}
  `;

  const [{ count }] = await sql`
    SELECT COUNT(DISTINCT c.id)::int AS count
    FROM contacts c
    ${policiesJoin}
    ${whereClause}
  `;

  return { rows, total: count, page, pageSize };
}

/**
 * Group contacts by the given dimension. Returns groups with counts +
 * sample contacts.
 */
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
    SELECT
      ${groupExpr} AS group_key,
      COUNT(DISTINCT c.id)::int AS contact_count,
      SUM(p.monthly_premium)::numeric(12,2) AS total_premium
    FROM contacts c
    ${policiesJoin}
    ${whereClause}
    GROUP BY ${groupExpr}
    ORDER BY contact_count DESC
  `;

  return { groups: rows, groupBy };
}
```

- [ ] **Step 3:** Write `src/app/api/portfolio/contacts/route.js`:

```javascript
// src/app/api/portfolio/contacts/route.js
import { NextResponse } from 'next/server';
import { listContacts, groupContacts } from '@/lib/portfolio/query';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const url = new URL(req.url);
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
      const result = await groupContacts({ filters, groupBy });
      return NextResponse.json(result);
    }
    const result = await listContacts({ filters, page, pageSize, sortBy, sortDir });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 4:** Verify with curl (start dev server first):

```bash
npm run dev > /tmp/dev.log 2>&1 &
DEV_PID=$!
sleep 5
curl -s 'http://localhost:3000/api/portfolio/contacts?filters=%7B%22smartList%22%3A%22all_submitted%22%7D&pageSize=5' | python3 -m json.tool | head -50
kill $DEV_PID 2>/dev/null
```

Expected: a JSON response with `rows` array (5 contacts) and `total` count (~262).

- [ ] **Step 5:** Commit:

```bash
git add src/lib/portfolio/filters.js src/lib/portfolio/query.js src/app/api/portfolio/contacts/route.js
git commit -m "feat(portfolio): GET /api/portfolio/contacts with filters + groupBy"
```

---

## Task 21: API — `GET /api/portfolio/contact/[id]` (single contact full record)

**Files:**
- Create: `src/app/api/portfolio/contact/[id]/route.js`

- [ ] **Step 1:** Write `src/app/api/portfolio/contact/[id]/route.js`:

```javascript
// src/app/api/portfolio/contact/[id]/route.js
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req, { params }) {
  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  try {
    const [contact] = await sql`SELECT * FROM contacts WHERE id = ${id}`;
    if (!contact) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const policies = await sql`
      SELECT p.*, c.name AS carrier_name, pr.name AS product_name, a.canonical_name AS agent_name
      FROM policies p
      LEFT JOIN carriers c ON c.id = p.carrier_id
      LEFT JOIN products pr ON pr.id = p.product_id
      LEFT JOIN agents a ON a.id = p.agent_id
      WHERE p.contact_id = ${id}
      ORDER BY p.application_date DESC NULLS LAST
    `;

    const calls = await sql`
      SELECT ca.*, cm.code AS campaign_code_resolved, a.canonical_name AS agent_name
      FROM calls ca
      LEFT JOIN campaigns cm ON cm.id = ca.campaign_id
      LEFT JOIN agents a ON a.id = ca.agent_id
      WHERE ca.contact_id = ${id}
      ORDER BY ca.call_date DESC
      LIMIT 100
    `;

    return NextResponse.json({ contact, policies, calls });
  } catch (err) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 2:** Verify (after starting dev server):

```bash
npm run dev > /tmp/dev.log 2>&1 &
DEV_PID=$!
sleep 5
# Pick any contact id from earlier list endpoint
CONTACT_ID=$(curl -s 'http://localhost:3000/api/portfolio/contacts?filters=%7B%22smartList%22%3A%22all_submitted%22%7D&pageSize=1' | python3 -c "import sys, json; print(json.load(sys.stdin)['rows'][0]['id'])")
echo "Testing contact id: $CONTACT_ID"
curl -s "http://localhost:3000/api/portfolio/contact/$CONTACT_ID" | python3 -m json.tool | head -30
kill $DEV_PID 2>/dev/null
```

Expected: contact + policies + calls JSON.

- [ ] **Step 3:** Commit:

```bash
git add src/app/api/portfolio/contact
git commit -m "feat(portfolio): GET /api/portfolio/contact/[id] with policies + calls"
```

---

## Task 22: API — CSV exports (general + ChaseData dialer format)

**Files:**
- Create: `src/lib/portfolio/exports.js`
- Create: `src/app/api/portfolio/export/route.js`
- Create: `src/app/api/portfolio/dialer-export/route.js`

- [ ] **Step 1:** Write `src/lib/portfolio/exports.js`:

```javascript
// src/lib/portfolio/exports.js
/**
 * Convert an array of objects to a CSV string. Quotes values containing
 * commas, quotes, or newlines per RFC 4180.
 */
export function toCsv(rows, columns) {
  const escape = (v) => {
    if (v == null) return '';
    const s = v instanceof Date ? v.toISOString() : String(v);
    if (/[,\"\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const header = columns.map(c => c.label).join(',');
  const body = rows.map(r => columns.map(c => escape(r[c.key])).join(',')).join('\n');
  return header + '\n' + body + '\n';
}

/**
 * General-purpose contact export columns.
 */
export const CONTACT_EXPORT_COLUMNS = [
  { key: 'phone', label: 'Phone' },
  { key: 'firstName', label: 'First Name' },
  { key: 'lastName', label: 'Last Name' },
  { key: 'state', label: 'State' },
  { key: 'lastSeenAt', label: 'Last Seen' },
  { key: 'totalCalls', label: 'Total Calls' },
  { key: 'placedStatus', label: 'Placed Status' },
  { key: 'policyNumber', label: 'Policy #' },
  { key: 'monthlyPremium', label: 'Monthly Premium' },
  { key: 'applicationDate', label: 'Application Date' },
  { key: 'salesAgent', label: 'Sales Agent' },
  { key: 'carrierProduct', label: 'Carrier + Product' },
];

/**
 * ChaseData dialer import format. Confirmed by reviewing typical ChaseData
 * import templates: phone is the main required column. Optional first
 * name, last name, state are supported. ChaseData accepts comma or tab
 * separated; we use comma.
 */
export const DIALER_EXPORT_COLUMNS = [
  { key: 'phone', label: 'Phone' },
  { key: 'firstName', label: 'FirstName' },
  { key: 'lastName', label: 'LastName' },
  { key: 'state', label: 'State' },
];
```

- [ ] **Step 2:** Write `src/app/api/portfolio/export/route.js`:

```javascript
// src/app/api/portfolio/export/route.js
import { listContacts } from '@/lib/portfolio/query';
import { toCsv, CONTACT_EXPORT_COLUMNS } from '@/lib/portfolio/exports';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const url = new URL(req.url);
  let filters = {};
  try { filters = JSON.parse(url.searchParams.get('filters') ?? '{}'); }
  catch { return new Response('invalid filters JSON', { status: 400 }); }

  // Pull all matching rows up to 5000 (cap for safety)
  const { rows } = await listContacts({ filters, page: 1, pageSize: 5000 });
  const csv = toCsv(rows, CONTACT_EXPORT_COLUMNS);

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="portfolio-export-${new Date().toISOString().slice(0,10)}.csv"`,
    },
  });
}
```

- [ ] **Step 3:** Write `src/app/api/portfolio/dialer-export/route.js`:

```javascript
// src/app/api/portfolio/dialer-export/route.js
import { listContacts } from '@/lib/portfolio/query';
import { toCsv, DIALER_EXPORT_COLUMNS } from '@/lib/portfolio/exports';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const url = new URL(req.url);
  let filters = {};
  try { filters = JSON.parse(url.searchParams.get('filters') ?? '{}'); }
  catch { return new Response('invalid filters JSON', { status: 400 }); }

  const { rows } = await listContacts({ filters, page: 1, pageSize: 5000 });
  const csv = toCsv(rows, DIALER_EXPORT_COLUMNS);

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="dialer-list-${new Date().toISOString().slice(0,10)}.csv"`,
    },
  });
}
```

- [ ] **Step 4:** Verify both:

```bash
npm run dev > /tmp/dev.log 2>&1 &
DEV_PID=$!
sleep 5
echo "--- general export (first 5 lines) ---"
curl -s 'http://localhost:3000/api/portfolio/export?filters=%7B%22smartList%22%3A%22all_submitted%22%7D' | head -5
echo "--- dialer export (first 5 lines) ---"
curl -s 'http://localhost:3000/api/portfolio/dialer-export?filters=%7B%22smartList%22%3A%22all_submitted%22%7D' | head -5
kill $DEV_PID 2>/dev/null
```

Expected: CSV header line + data lines.

- [ ] **Step 5:** Commit:

```bash
git add src/lib/portfolio/exports.js src/app/api/portfolio/export src/app/api/portfolio/dialer-export
git commit -m "feat(portfolio): CSV exports (general + ChaseData dialer format)"
```

---

## Task 23: Component — `PortfolioGrid.jsx`

**Files:**
- Create: `src/components/portfolio/PortfolioGrid.jsx`

- [ ] **Step 1:** Write `src/components/portfolio/PortfolioGrid.jsx`:

```jsx
// src/components/portfolio/PortfolioGrid.jsx
'use client';
import { useState } from 'react';

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

export default function PortfolioGrid({ rows, selectedIds, onToggleSelect, onRowClick, sortBy, sortDir, onSort }) {
  const cols = [
    { key: 'name', label: 'Name', sortable: true },
    { key: 'phone', label: 'Phone' },
    { key: 'state', label: 'State', sortable: true },
    { key: 'placed_status', label: 'Status' },
    { key: 'monthly_premium', label: 'Premium', sortable: true, align: 'right' },
    { key: 'application_date', label: 'Submitted', sortable: true },
    { key: 'sales_agent', label: 'Agent' },
    { key: 'last_seen_at', label: 'Last Call', sortable: true },
  ];

  const allSelected = rows.length > 0 && rows.every(r => selectedIds.has(r.id));

  return (
    <div style={{ background: C.card, borderRadius: 8, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'monospace', fontSize: 13 }}>
        <thead>
          <tr style={{ background: C.surface, borderBottom: `1px solid ${C.border}` }}>
            <th style={{ padding: '10px 12px', textAlign: 'left', width: 36 }}>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={e => rows.forEach(r => onToggleSelect(r.id, e.target.checked))}
              />
            </th>
            {cols.map(c => (
              <th
                key={c.key}
                onClick={() => c.sortable && onSort(c.key)}
                style={{
                  padding: '10px 12px',
                  textAlign: c.align ?? 'left',
                  color: C.muted,
                  textTransform: 'uppercase',
                  fontSize: 11,
                  cursor: c.sortable ? 'pointer' : 'default',
                  userSelect: 'none',
                }}
              >
                {c.label}{sortBy === c.key && (sortDir === 'asc' ? ' ↑' : ' ↓')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const name = `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim() || '(no name)';
            return (
              <tr
                key={r.id}
                onClick={() => onRowClick(r.id)}
                style={{ borderBottom: `1px solid ${C.border}`, cursor: 'pointer' }}
              >
                <td style={{ padding: '10px 12px' }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(r.id)}
                    onClick={e => e.stopPropagation()}
                    onChange={e => onToggleSelect(r.id, e.target.checked)}
                  />
                </td>
                <td style={{ padding: '10px 12px', color: C.text }}>{name}</td>
                <td style={{ padding: '10px 12px', color: C.muted }}>{r.phone}</td>
                <td style={{ padding: '10px 12px', color: C.text }}>{r.state ?? ''}</td>
                <td style={{ padding: '10px 12px', color: statusColor(r.placedStatus) }}>{r.placedStatus ?? '—'}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: C.text }}>
                  {r.monthlyPremium != null ? `$${Number(r.monthlyPremium).toFixed(2)}` : '—'}
                </td>
                <td style={{ padding: '10px 12px', color: C.muted }}>
                  {r.applicationDate ? new Date(r.applicationDate).toLocaleDateString() : '—'}
                </td>
                <td style={{ padding: '10px 12px', color: C.muted }}>{r.salesAgent ?? '—'}</td>
                <td style={{ padding: '10px 12px', color: C.muted }}>
                  {r.lastSeenAt ? new Date(r.lastSeenAt).toLocaleDateString() : '—'}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={cols.length + 1} style={{ padding: 32, textAlign: 'center', color: C.muted }}>
                No contacts match the current filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2:** Verify build:

```bash
npm run build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 3:** Commit:

```bash
git add src/components/portfolio/PortfolioGrid.jsx
git commit -m "feat(portfolio): PortfolioGrid component (sortable, selectable contact table)"
```

---

## Task 24: Component — `PortfolioFilterSidebar.jsx`

**Files:**
- Create: `src/components/portfolio/PortfolioFilterSidebar.jsx`

- [ ] **Step 1:** Write `src/components/portfolio/PortfolioFilterSidebar.jsx`:

```jsx
// src/components/portfolio/PortfolioFilterSidebar.jsx
'use client';

const C = { bg: '#080b10', surface: '#0f1520', card: '#131b28', border: '#1a2538', text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff' };

const SMART_LISTS = [
  { key: null, label: 'All Contacts' },
  { key: 'all_submitted', label: 'All Submitted Apps' },
  { key: 'pending', label: 'Pending Applications' },
  { key: 'active_policies', label: 'Active Policies' },
  { key: 'recently_lapsed', label: 'Recently Lapsed' },
  { key: 'declined', label: 'Declined' },
  { key: 'high_value', label: 'High-Value Active' },
];

export default function PortfolioFilterSidebar({ activeSmartList, onSmartListChange, totalCount }) {
  return (
    <div style={{ width: 240, background: C.surface, borderRight: `1px solid ${C.border}`, padding: 16, height: '100%' }}>
      <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', marginBottom: 8 }}>Smart Lists</div>
      {SMART_LISTS.map(sl => {
        const active = activeSmartList === sl.key;
        return (
          <div
            key={sl.key ?? 'all'}
            onClick={() => onSmartListChange(sl.key)}
            style={{
              padding: '8px 12px',
              borderRadius: 6,
              cursor: 'pointer',
              color: active ? C.text : C.muted,
              background: active ? C.card : 'transparent',
              borderLeft: active ? `3px solid ${C.accent}` : '3px solid transparent',
              marginBottom: 2,
              fontSize: 13,
            }}
          >
            {sl.label}
          </div>
        );
      })}
      <div style={{ marginTop: 24, color: C.muted, fontSize: 11 }}>
        {totalCount != null && `${totalCount.toLocaleString()} matching`}
      </div>
    </div>
  );
}
```

- [ ] **Step 2:** Build check:

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3:** Commit:

```bash
git add src/components/portfolio/PortfolioFilterSidebar.jsx
git commit -m "feat(portfolio): PortfolioFilterSidebar (smart list selector)"
```

---

## Task 25: Component — `PortfolioBulkActionBar.jsx`

**Files:**
- Create: `src/components/portfolio/PortfolioBulkActionBar.jsx`

- [ ] **Step 1:** Write `src/components/portfolio/PortfolioBulkActionBar.jsx`:

```jsx
// src/components/portfolio/PortfolioBulkActionBar.jsx
'use client';

const C = { bg: '#080b10', surface: '#0f1520', card: '#131b28', border: '#1a2538', text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff' };

export default function PortfolioBulkActionBar({ selectedCount, filters, onClearSelection }) {
  if (selectedCount === 0) return null;
  const filtersParam = encodeURIComponent(JSON.stringify(filters));
  const exportUrl = `/api/portfolio/export?filters=${filtersParam}`;
  const dialerUrl = `/api/portfolio/dialer-export?filters=${filtersParam}`;
  return (
    <div style={{
      background: C.accent, color: C.bg, padding: '10px 16px', borderRadius: 6,
      display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12, fontSize: 13,
    }}>
      <span style={{ fontWeight: 600 }}>{selectedCount} selected</span>
      <a href={exportUrl} download style={{ color: C.bg, textDecoration: 'underline', fontWeight: 500 }}>
        Export CSV
      </a>
      <a href={dialerUrl} download style={{ color: C.bg, textDecoration: 'underline', fontWeight: 500 }}>
        Push to Dialer (CSV)
      </a>
      <span style={{ color: C.bg, opacity: 0.5, fontSize: 11 }}>
        Trigger Workflow (V2)
      </span>
      <button
        onClick={onClearSelection}
        style={{
          marginLeft: 'auto', background: 'transparent', color: C.bg,
          border: `1px solid ${C.bg}`, padding: '4px 10px', borderRadius: 4,
          cursor: 'pointer', fontSize: 12,
        }}
      >
        Clear
      </button>
    </div>
  );
}
```

- [ ] **Step 2:** Commit:

```bash
git add src/components/portfolio/PortfolioBulkActionBar.jsx
git commit -m "feat(portfolio): PortfolioBulkActionBar (export + dialer + future workflow)"
```

---

## Task 26: Component — `PortfolioDetailPanel.jsx`

**Files:**
- Create: `src/components/portfolio/PortfolioDetailPanel.jsx`

- [ ] **Step 1:** Write `src/components/portfolio/PortfolioDetailPanel.jsx`:

```jsx
// src/components/portfolio/PortfolioDetailPanel.jsx
'use client';
import { useEffect, useState } from 'react';

const C = { bg: '#080b10', surface: '#0f1520', card: '#131b28', border: '#1a2538', text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff', green: '#4ade80', yellow: '#facc15', red: '#f87171' };

function statusColor(s) {
  if (!s) return C.muted;
  const x = s.toLowerCase();
  if (x.includes('active') || x.includes('in force') || x.includes('advance')) return C.green;
  if (x.includes('pending') || x.includes('submitted')) return C.yellow;
  if (x.includes('lapsed') || x.includes('canceled') || x.includes('declined')) return C.red;
  return C.muted;
}

export default function PortfolioDetailPanel({ contactId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!contactId) return;
    setLoading(true);
    fetch(`/api/portfolio/contact/${contactId}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [contactId]);

  if (!contactId) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, height: '100vh', width: 480, background: C.surface,
      borderLeft: `1px solid ${C.border}`, padding: 24, overflowY: 'auto', zIndex: 100, color: C.text,
      boxShadow: '-4px 0 24px rgba(0,0,0,0.5)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase' }}>Contact Detail</div>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 18 }}>✕</button>
      </div>
      {loading && <div style={{ color: C.muted }}>Loading...</div>}
      {data?.contact && (
        <>
          <h2 style={{ fontSize: 22, margin: '0 0 4px 0' }}>
            {(data.contact.firstName || '') + ' ' + (data.contact.lastName || '')}
          </h2>
          <div style={{ color: C.muted, fontSize: 13, marginBottom: 16 }}>
            {data.contact.phone} {data.contact.email ? '• ' + data.contact.email : ''}
          </div>
          <div style={{ color: C.muted, fontSize: 13, marginBottom: 24 }}>
            {[data.contact.address1, data.contact.city, data.contact.state, data.contact.postalCode].filter(Boolean).join(', ') || '(no address)'}
          </div>

          {/* Policies */}
          <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', marginBottom: 8 }}>
            Policies ({data.policies.length})
          </div>
          {data.policies.length === 0 && <div style={{ color: C.muted, fontSize: 13, marginBottom: 24 }}>No policies on file.</div>}
          {data.policies.map(p => (
            <div key={p.id} style={{ background: C.card, padding: 12, borderRadius: 6, marginBottom: 12, borderLeft: `3px solid ${statusColor(p.placedStatus)}` }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{p.policyNumber || '(no policy #)'}</div>
              <div style={{ color: C.muted, fontSize: 12 }}>{p.carrierProductRaw || `${p.carrierName} / ${p.productName}`}</div>
              <div style={{ marginTop: 4, fontSize: 12 }}>
                <span style={{ color: statusColor(p.placedStatus) }}>{p.placedStatus || 'no status'}</span>
                {p.monthlyPremium && <span style={{ marginLeft: 12, color: C.text }}>${Number(p.monthlyPremium).toFixed(2)}/mo</span>}
              </div>
              <div style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>
                Submitted: {p.applicationDate ? new Date(p.applicationDate).toLocaleDateString() : '—'}
                {' · '}Effective: {p.effectiveDate ? new Date(p.effectiveDate).toLocaleDateString() : '—'}
                {' · '}Agent: {p.agentName || p.salesAgentRaw || '—'}
              </div>
            </div>
          ))}

          {/* Calls */}
          <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', margin: '24px 0 8px 0' }}>
            Recent Calls ({data.calls.length})
          </div>
          {data.calls.slice(0, 20).map(ca => (
            <div key={ca.id} style={{ borderBottom: `1px solid ${C.border}`, padding: '8px 0', fontSize: 12 }}>
              <div style={{ color: C.text }}>
                {new Date(ca.callDate).toLocaleString()}
                {' • '}{ca.campaignCode || '—'}
                {' • '}{ca.callStatus || '—'}
                {ca.durationSeconds && ` • ${ca.durationSeconds}s`}
              </div>
              <div style={{ color: C.muted }}>
                Rep: {ca.repName || '—'}{ca.recordingUrl && ' • '}
                {ca.recordingUrl && <a href={ca.recordingUrl} target="_blank" rel="noreferrer" style={{ color: C.accent }}>Recording</a>}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2:** Commit:

```bash
git add src/components/portfolio/PortfolioDetailPanel.jsx
git commit -m "feat(portfolio): PortfolioDetailPanel (slide-in contact detail)"
```

---

## Task 27: Component — `PortfolioGroupBySelector.jsx` + `PortfolioGroupView.jsx`

**Files:**
- Create: `src/components/portfolio/PortfolioGroupBySelector.jsx`
- Create: `src/components/portfolio/PortfolioGroupView.jsx`

- [ ] **Step 1:** Write `src/components/portfolio/PortfolioGroupBySelector.jsx`:

```jsx
// src/components/portfolio/PortfolioGroupBySelector.jsx
'use client';

const C = { surface: '#0f1520', card: '#131b28', border: '#1a2538', text: '#f0f3f9', muted: '#8fa3be' };

const OPTIONS = [
  { value: 'none', label: 'No Grouping' },
  { value: 'placed_status', label: 'By Status' },
  { value: 'carrier', label: 'By Carrier' },
  { value: 'agent', label: 'By Agent' },
  { value: 'campaign', label: 'By Lead Source' },
  { value: 'state', label: 'By State' },
  { value: 'month', label: 'By Submission Month' },
];

export default function PortfolioGroupBySelector({ value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <label style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase' }}>Group by:</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          background: C.card, color: C.text, border: `1px solid ${C.border}`,
          borderRadius: 4, padding: '4px 8px', fontSize: 13,
        }}
      >
        {OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
```

- [ ] **Step 2:** Write `src/components/portfolio/PortfolioGroupView.jsx`:

```jsx
// src/components/portfolio/PortfolioGroupView.jsx
'use client';

const C = { card: '#131b28', border: '#1a2538', text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff' };

export default function PortfolioGroupView({ groups, onGroupClick }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
      {groups.map(g => (
        <div
          key={g.groupKey ?? '(blank)'}
          onClick={() => onGroupClick(g.groupKey)}
          style={{
            background: C.card, borderRadius: 6, padding: 16, cursor: 'pointer',
            border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.accent}`,
          }}
        >
          <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', marginBottom: 4 }}>
            {g.groupKey ?? '(no value)'}
          </div>
          <div style={{ color: C.text, fontSize: 24, fontWeight: 600 }}>{g.contactCount}</div>
          <div style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>
            contacts{g.totalPremium ? ` · $${Number(g.totalPremium).toFixed(2)}/mo total` : ''}
          </div>
        </div>
      ))}
      {groups.length === 0 && (
        <div style={{ color: C.muted, gridColumn: '1 / -1', textAlign: 'center', padding: 32 }}>
          No groups in current view.
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3:** Commit:

```bash
git add src/components/portfolio/PortfolioGroupBySelector.jsx src/components/portfolio/PortfolioGroupView.jsx
git commit -m "feat(portfolio): group-by selector + group view tile grid"
```

---

## Task 28: Component — `PortfolioTab.jsx` (main shell wiring everything)

**Files:**
- Create: `src/components/portfolio/PortfolioTab.jsx`

- [ ] **Step 1:** Write `src/components/portfolio/PortfolioTab.jsx`:

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

const C = { bg: '#080b10', text: '#f0f3f9', muted: '#8fa3be', card: '#131b28', border: '#1a2538' };

export default function PortfolioTab() {
  const [smartList, setSmartList] = useState('all_submitted');
  const [search, setSearch] = useState('');
  const [groupBy, setGroupBy] = useState('none');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [sortBy, setSortBy] = useState('last_seen_at');
  const [sortDir, setSortDir] = useState('desc');

  const [data, setData] = useState({ rows: [], total: 0, groups: null });
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [openContactId, setOpenContactId] = useState(null);

  const filters = { smartList, search: search || undefined };

  const reload = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      filters: JSON.stringify(filters),
      page: String(page), pageSize: String(pageSize),
      sortBy, sortDir,
    });
    if (groupBy !== 'none') params.set('groupBy', groupBy);
    const res = await fetch(`/api/portfolio/contacts?${params}`);
    const json = await res.json();
    if (json.groups) setData({ groups: json.groups, rows: [], total: json.groups.length });
    else setData({ rows: json.rows ?? [], total: json.total ?? 0, groups: null });
    setLoading(false);
  }, [smartList, search, groupBy, page, pageSize, sortBy, sortDir]);

  useEffect(() => { reload(); }, [reload]);

  const toggleSelect = (id, on) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  };
  const toggleSort = (col) => {
    if (col === sortBy) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('desc'); }
  };

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 64px)', background: C.bg, color: C.text }}>
      <PortfolioFilterSidebar
        activeSmartList={smartList}
        onSmartListChange={(k) => { setSmartList(k); setPage(1); setSelectedIds(new Set()); }}
        totalCount={data.total}
      />

      <div style={{ flex: 1, padding: 16, overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
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
          <div style={{ marginLeft: 'auto', color: C.muted, fontSize: 12 }}>
            {loading ? 'Loading...' : ''}
          </div>
        </div>

        <PortfolioBulkActionBar
          selectedCount={selectedIds.size}
          filters={filters}
          onClearSelection={() => setSelectedIds(new Set())}
        />

        {data.groups ? (
          <PortfolioGroupView
            groups={data.groups}
            onGroupClick={(key) => {
              setGroupBy('none');
              setSearch(key ?? '');
              setPage(1);
            }}
          />
        ) : (
          <PortfolioGrid
            rows={data.rows}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onRowClick={setOpenContactId}
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={toggleSort}
          />
        )}

        {!data.groups && data.total > pageSize && (
          <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              disabled={page === 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              style={{ background: C.card, color: C.text, border: `1px solid ${C.border}`, padding: '6px 12px', borderRadius: 4, cursor: page === 1 ? 'default' : 'pointer' }}
            >
              ← Prev
            </button>
            <span style={{ color: C.muted, fontSize: 13 }}>
              Page {page} of {Math.ceil(data.total / pageSize)} · {data.total} total
            </span>
            <button
              disabled={page * pageSize >= data.total}
              onClick={() => setPage(p => p + 1)}
              style={{ background: C.card, color: C.text, border: `1px solid ${C.border}`, padding: '6px 12px', borderRadius: 4, cursor: page * pageSize >= data.total ? 'default' : 'pointer' }}
            >
              Next →
            </button>
          </div>
        )}
      </div>

      <PortfolioDetailPanel contactId={openContactId} onClose={() => setOpenContactId(null)} />
    </div>
  );
}
```

- [ ] **Step 2:** Build check:

```bash
npm run build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 3:** Commit:

```bash
git add src/components/portfolio/PortfolioTab.jsx
git commit -m "feat(portfolio): PortfolioTab main shell wiring all components"
```

---

## Task 29: Wire `PortfolioTab` into `Dashboard.jsx` — replace 3 tabs

**Files:**
- Modify: `src/components/Dashboard.jsx`

- [ ] **Step 1:** Read the current `Dashboard.jsx` tab structure:

```bash
grep -n "LeadCRMTab\|RetentionDashboardTab\|BusinessHealthTab" src/components/Dashboard.jsx
```

This shows where the 3 existing tabs are wired in.

- [ ] **Step 2:** Open `src/components/Dashboard.jsx`. Find:
  - The import lines for `LeadCRMTab`, `RetentionDashboardTab`, `BusinessHealthTab`
  - The tab definitions (likely an array or switch in a render function)

Replace those imports with:

```javascript
import PortfolioTab from './portfolio/PortfolioTab';
```

In the tab definitions, replace the three tab entries (Lead CRM, Retention Dashboard, Business Health) with one entry:

```javascript
{ key: 'portfolio', label: 'Portfolio', component: PortfolioTab }
```

Place this `Portfolio` tab where the previous Lead CRM tab was in tab order.

- [ ] **Step 3:** Verify the dashboard still builds:

```bash
npm run build 2>&1 | tail -15
```

Expected: build succeeds. If it fails because of missing imports of the old tabs elsewhere in the file, find and remove those references — the old tabs are gone.

- [ ] **Step 4:** Manual smoke test:

```bash
npm run dev > /tmp/dev.log 2>&1 &
DEV_PID=$!
sleep 5
echo "Dashboard URL: http://localhost:3000"
echo "Open in browser, click 'Portfolio' tab, verify the new view loads."
echo "Press enter to kill dev server when done..."
read
kill $DEV_PID 2>/dev/null
```

- [ ] **Step 5:** Commit:

```bash
git add src/components/Dashboard.jsx
git commit -m "feat(portfolio): replace Lead CRM + Retention + Business Health tabs with PortfolioTab"
```

---

## Task 30: Document Portfolio in `claude.md`

**Files:**
- Modify: `claude.md`

- [ ] **Step 1:** Append to the END of `claude.md`:

```markdown

---

## TCC Portfolio (DB-backed unified view)

Replaces the old Lead CRM + Retention Dashboard + Business Health tabs
with a single Portfolio tab. Reads from Postgres for sub-second response.

### Components (`src/components/portfolio/`)

- `PortfolioTab.jsx` — main shell, hosts state + wires children
- `PortfolioFilterSidebar.jsx` — saved smart-list selector
- `PortfolioGrid.jsx` — sortable selectable contact table
- `PortfolioGroupBySelector.jsx` + `PortfolioGroupView.jsx` — pivot grouping
- `PortfolioBulkActionBar.jsx` — appears when rows selected; export, dialer
- `PortfolioDetailPanel.jsx` — slide-in contact detail (replaces old modals)

### API endpoints (`src/app/api/portfolio/`)

- `GET /contacts?filters=...&groupBy=...&page=...&sortBy=...&sortDir=...`
  Returns `{ rows, total, page, pageSize }` for flat view, or
  `{ groups, groupBy }` when groupBy is set
- `GET /contact/[id]` — full contact record with policies + calls
- `GET /export?filters=...` — general CSV export
- `GET /dialer-export?filters=...` — ChaseData-format CSV

### Saved smart lists (hardcoded for V1; user-defined deferred)

Defined in `src/lib/portfolio/filters.js`:

- `all_submitted` — `application_date IS NOT NULL`
- `pending` — submitted + status contains pending/submitted/awaiting
- `active_policies` — submitted + status contains active/in force/advance
- `recently_lapsed` — submitted + status contains lapsed/canceled
- `declined` — submitted + status contains declined
- `high_value` — active + monthly premium > $100

### Group-by dimensions

`none`, `placed_status`, `carrier`, `agent`, `campaign`, `state`, `month`

### Bulk actions

- **Export CSV** — general columns (name, phone, status, premium, etc.)
- **Push to Dialer (CSV)** — ChaseData import format (Phone, FirstName, LastName, State)
- **Trigger Workflow** — V2 (placeholder in UI)
```

- [ ] **Step 2:** Verify:

```bash
grep -c "TCC Portfolio (DB-backed unified view)" claude.md
```

Expected: `1`.

- [ ] **Step 3:** Commit:

```bash
git add claude.md
git commit -m "docs(portfolio): document Portfolio in claude.md"
```

---

## Task 31: Push everything

**Files:** none

- [ ] **Step 1:** Push:

```bash
git push
```

- [ ] **Step 2:** Print PR URL:

```bash
echo "PR: https://github.com/peterdschmitt/tcc-dashboard/pull/new/feature/portfolio-build"
```

---

# Done — what you have

After T31, your branch contains:

- ✅ Postgres on Neon, schema applied, migration runner working
- ✅ Full Sheets → DB sync running every 30 min via Vercel cron
- ✅ Manual `/api/db-backfill` endpoint for one-shot full reload
- ✅ New Portfolio tab replacing 3 old CRM tabs
- ✅ 6 hardcoded smart lists (all_submitted, pending, active, lapsed, declined, high_value)
- ✅ 7 pivot grouping dimensions (status, carrier, agent, campaign, state, month, none)
- ✅ Bulk actions: CSV export, ChaseData dialer CSV
- ✅ Slide-in contact detail with policies + calls timeline
- ✅ Updated CLAUDE.md docs covering DB + Portfolio

**Total estimated work: ~30–44 hours.**

When you merge to `main` and deploy to Vercel:
1. Set `DATABASE_URL` in Vercel env (Production)
2. Verify the cron `/api/cron/db-sync` is registered in Vercel's cron list
3. Hit `/api/db-backfill?secret=$CRON_SECRET` once to seed prod data
4. Open the dashboard in production, click Portfolio tab → all 3,500+ contacts visible

---

## Self-Review Notes

**Spec coverage:** Each phase has its own embedded spec section above. Coverage:

| Item | Implementing task |
|---|---|
| DB schema (7 tables + indexes + triggers) | T4 + T6 |
| db.js singleton client | T3 |
| Migration runner | T5 |
| Foundation smoke test | T7 |
| Sync state tracking | T10 |
| Reference data sync (campaigns, carriers, products, agents) | T11–T13 |
| Contact + policy + call sync | T14–T16 |
| Denormalized state refresh | T17 |
| Pipeline orchestrator + cron + backfill routes | T18 |
| Filter spec | T20 (`src/lib/portfolio/filters.js`) |
| API: contacts list + grouping | T20 |
| API: single contact detail | T21 |
| API: CSV exports (general + dialer) | T22 |
| Grid component | T23 |
| Sidebar with smart lists | T24 |
| Bulk action bar | T25 |
| Detail panel | T26 |
| Group-by selector + view | T27 |
| Main tab wiring | T28 |
| Replace old 3 tabs in Dashboard.jsx | T29 |
| Documentation | T8 (DB) + T30 (Portfolio) |
| Branch push | T9 + T19 + T31 |

**Placeholder scan:** No "TBD", no "implement later", no vague "appropriate error handling". Every code block is complete and concrete.

**Type / name consistency:**
- Module names: `db-sync/campaigns.js`, `db-sync/carriers-products.js`, etc. — referenced consistently across pipeline.js (T18) and individual sync files (T11–T17)
- API route paths: `/api/portfolio/contacts`, `/api/portfolio/contact/[id]`, `/api/portfolio/export`, `/api/portfolio/dialer-export` — referenced consistently from components (T23–T28)
- Smart list keys: `all_submitted`, `active_policies`, `recently_lapsed`, `pending`, `declined`, `high_value` — defined in `src/lib/portfolio/filters.js` (T20), referenced in `PortfolioFilterSidebar.jsx` (T24)
- Group-by keys: `none`, `placed_status`, `carrier`, `agent`, `campaign`, `state`, `month` — defined in `src/lib/portfolio/query.js` (T20), referenced in `PortfolioGroupBySelector.jsx` (T27)
- Color palette `C` repeated across components — could be DRY-extracted to `src/components/portfolio/_colors.js` later but kept inline for clarity in V1

**Things deliberately deferred to future work (acknowledged, not gaps):**
- User-defined saved smart lists (V1 hardcodes the 6 defaults)
- Workflow-trigger bulk action (V2 placeholder in UI)
- DB → GHL sync rewire (existing Sheets→GHL keeps running)
- Migrating other dashboard features (P&L, Commissions, Snapshots) off Sheets-direct reads
- Tracking last-watermark per-source for true incremental sync (currently does full re-read each tick — fine for the data volume, idempotent via row-hash)

The plan is self-contained: a fresh Claude session pointed at this file can complete all 31 tasks (after Pre-flight P1 — operator creates Neon project + sets DATABASE_URL).
