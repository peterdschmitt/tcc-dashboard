# TCC Database Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provision a Postgres database (Neon), define the V1 schema (7 entity tables + housekeeping), and ship a connection module + migration runner that the rest of the application can build on. Nothing in the existing dashboard reads from the DB after this lands; sync and UI are separate plans.

**Architecture:** Plain SQL migrations applied by a tiny Node script. Singleton `postgres.js` client behind a `src/lib/db.js` module exposing a tagged-template `sql` helper. No ORM. Schema is normalized: `contacts` (phone-keyed) is parent to `calls` and `policies`; `policies` joins to `carriers`, `products`, `campaigns`, and `agents`.

**Tech Stack:** Neon (serverless Postgres, free tier), `postgres` npm package (postgres.js), plain JavaScript ESM, Node 20+ `--env-file` flag, Vercel for deploy.

**Spec:** `docs/superpowers/plans/../specs/2026-04-26-tcc-database-foundation-design.md`

**Companion artifacts already in this branch:**
- Spec doc: `docs/superpowers/specs/2026-04-26-tcc-database-foundation-design.md`
- This plan: `docs/superpowers/plans/2026-04-26-tcc-database-foundation.md`

---

## Pre-flight (manual, blocks Task 6 onward)

These steps require human hands and credentials. Do them before reaching Task 6.

### P1: Create the Neon database

1. Go to https://neon.tech and sign up (free tier, no card required)
2. Create a project named `tcc-dashboard`
3. Copy the connection string — it looks like:
   ```
   postgres://user:pass@ep-xxxxxxx.us-east-1.aws.neon.tech/neondb?sslmode=require
   ```
4. Paste it into the worktree's `.env.local` as a new line:
   ```
   DATABASE_URL=postgres://user:pass@ep-xxxxxxx.us-east-1.aws.neon.tech/neondb?sslmode=require
   ```
5. Verify with curl that the URL is reachable (informally — actual connection test happens in Task 6):
   ```bash
   psql "$DATABASE_URL" -c "SELECT version();"
   ```
   If `psql` isn't installed locally, skip this — Task 6 verifies via Node.

### P2: Decide on branch strategy

This plan branches off `main`. The current repo has an open branch `feature/ghl-call-log-sync` with unrelated work in flight (GHL sync project). The DB Foundation should live on its own branch so it can merge independently.

```bash
cd /Users/peterschmitt/Downloads/tcc-dashboard
git checkout main
git pull
# Continue to Task 1 from here
```

---

## File Structure

### New files (created by this plan)

```
src/lib/
  db.js                            # Singleton postgres client + sql helper

migrations/
  001_init.sql                     # Initial schema: 7 entity tables + indexes + triggers

scripts/
  db-migrate.mjs                   # Migration runner (up + status)

docs/superpowers/specs/
  2026-04-26-tcc-database-foundation-design.md   # spec (already exists on feature/ghl-call-log-sync; copy or cherry-pick)
docs/superpowers/plans/
  2026-04-26-tcc-database-foundation.md          # this plan (same)
```

### Modified files

```
package.json              # adds 'postgres' dependency
.env.local                # adds DATABASE_URL (manual, P1 above)
CLAUDE.md                 # adds 'TCC Database (Postgres)' section
```

### Files explicitly NOT touched

- Anything under `src/components/`, `src/app/api/`, or any existing `src/lib/*.js` other than the new `db.js`
- The existing GHL sync work (`src/lib/ghl/`, scripts in `scripts/ghl-*`)
- Any sheet (Sales, Call Logs, Goals, etc.) — DB foundation is read-only-by-default for now

---

## Task 1: Set up worktree + branch off main

**Files:** none (workspace setup)

- [ ] **Step 1:** From `/Users/peterschmitt/Downloads/tcc-dashboard` (the main checkout), confirm you're on `main`:

```bash
cd /Users/peterschmitt/Downloads/tcc-dashboard
git status
git branch --show-current
```

Expected: branch is `main`, working tree clean.

If you're on a different branch and the working tree is clean, run `git checkout main && git pull`.

If the working tree is dirty, **stop and report** — don't try to stash or reset; ask the user to clean up first.

- [ ] **Step 2:** Verify the `.worktrees/` dir is gitignored. (It should be — added in a prior commit on `main`. If not, stop and ask.)

```bash
git check-ignore -v .worktrees/dummy
```

Expected: a line like `.gitignore:16:.worktrees/	.worktrees/dummy`. If output is empty, `.worktrees/` is not ignored — stop and ask.

- [ ] **Step 3:** Create a worktree on a new branch:

```bash
git worktree add .worktrees/feature-db-foundation -b feature/db-foundation
cd .worktrees/feature-db-foundation
```

Expected: `Preparing worktree (new branch 'feature/db-foundation')` and a clean tree at the new path.

- [ ] **Step 4:** Symlink `.env.local` from the main checkout into the worktree (so DATABASE_URL set in P1 is visible here):

```bash
ln -s /Users/peterschmitt/Downloads/tcc-dashboard/.env.local .env.local
ls -la .env.local
```

Expected: `lrwxr-xr-x ... .env.local -> /Users/peterschmitt/Downloads/tcc-dashboard/.env.local`

- [ ] **Step 5:** Verify the spec doc is accessible in this worktree:

```bash
ls docs/superpowers/specs/2026-04-26-tcc-database-foundation-design.md 2>&1
```

If "No such file or directory": the spec was committed on a different branch (`feature/ghl-call-log-sync`). Recover it:

```bash
git checkout feature/ghl-call-log-sync -- docs/superpowers/specs/2026-04-26-tcc-database-foundation-design.md docs/superpowers/plans/2026-04-26-tcc-database-foundation.md
git add docs/superpowers/specs/2026-04-26-tcc-database-foundation-design.md docs/superpowers/plans/2026-04-26-tcc-database-foundation.md
git commit -m "docs(db-foundation): bring spec + plan onto db-foundation branch"
```

If it's already there: skip this recovery and proceed.

- [ ] **Step 6:** Run `npm install` in the worktree (so node_modules is present):

```bash
npm install --silent
```

Expected: silent completion (or warnings about peer deps that are unrelated to our work).

---

## Task 2: Add the `postgres` library

**Files:**
- Modify: `package.json` (dependencies section)

- [ ] **Step 1:** Install the `postgres` package as a runtime dependency:

```bash
npm install postgres
```

Expected: `package.json` and `package-lock.json` updated; `node_modules/postgres/` exists.

- [ ] **Step 2:** Verify the install:

```bash
node --input-type=module -e "import postgres from 'postgres'; console.log('postgres version:', postgres.toString().slice(0, 50));"
```

Expected: a line confirming the function loaded without error. (Warning about MODULE_TYPELESS_PACKAGE_JSON is harmless and should be ignored throughout this plan.)

- [ ] **Step 3:** Commit:

```bash
git add package.json package-lock.json
git commit -m "feat(db): add postgres library dependency"
```

---

## Task 3: Create `src/lib/db.js` (singleton client + sql helper)

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
 * Tagged-template helper for parameterized queries. Use as:
 *   const rows = await sql`SELECT * FROM contacts WHERE phone = ${phone}`;
 *
 * Postgres.js handles parameter binding (no SQL injection risk from
 * interpolated values), and returns an array of row objects.
 */
export const sql = (...args) => getSql()(...args);

/**
 * Close the connection pool. Used by scripts that need to exit cleanly.
 * After calling this, the next sql query will reopen the pool.
 */
export async function closeDb() {
  if (_sql) {
    await _sql.end();
    _sql = null;
  }
}

/**
 * Direct access to the underlying postgres.js client for advanced use
 * cases like .unsafe() (multi-statement DDL execution). Most call sites
 * should use the `sql` tagged-template export above.
 */
export const rawClient = () => getSql();
```

- [ ] **Step 2:** Verify the module loads without error:

```bash
node --input-type=module -e "
import('./src/lib/db.js').then((m) => {
  console.log('exports:', Object.keys(m).join(', '));
  if (typeof m.sql !== 'function') { console.error('FAIL: sql export missing'); process.exit(1); }
  if (typeof m.closeDb !== 'function') { console.error('FAIL: closeDb export missing'); process.exit(1); }
  if (typeof m.rawClient !== 'function') { console.error('FAIL: rawClient export missing'); process.exit(1); }
  console.log('db.js exports OK');
});
"
```

Expected output: `exports: sql, closeDb, rawClient` and `db.js exports OK`.

- [ ] **Step 3:** Verify it errors helpfully when DATABASE_URL is missing (without --env-file flag):

```bash
node --input-type=module -e "
import('./src/lib/db.js').then(async ({ sql }) => {
  try {
    await sql\`SELECT 1\`;
    console.error('FAIL: expected error'); process.exit(1);
  } catch (e) {
    if (!e.message.includes('DATABASE_URL not set')) { console.error('FAIL: wrong error:', e.message); process.exit(1); }
    console.log('correct error on missing DATABASE_URL');
  }
});
"
```

Expected: `correct error on missing DATABASE_URL`.

- [ ] **Step 4:** Commit:

```bash
git add src/lib/db.js
git commit -m "feat(db): add db.js singleton client + sql tagged-template helper"
```

---

## Task 4: Create the initial migration file `migrations/001_init.sql`

**Files:**
- Create: `migrations/001_init.sql`

- [ ] **Step 1:** Create the `migrations/` directory:

```bash
mkdir -p migrations
```

- [ ] **Step 2:** Write `migrations/001_init.sql` with **exactly** this content:

```sql
-- migrations/001_init.sql
-- TCC Database Foundation V1: 7 entity tables + supporting infrastructure.
-- See docs/superpowers/specs/2026-04-26-tcc-database-foundation-design.md

-- ─────────────────────────────────────────────────────────────────
-- Shared trigger function: bumps updated_at on row update
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────
-- carriers (must come before products, which FKs to it)
-- ─────────────────────────────────────────────────────────────────

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

-- ─────────────────────────────────────────────────────────────────
-- products (carrier × product)
-- ─────────────────────────────────────────────────────────────────

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

-- ─────────────────────────────────────────────────────────────────
-- campaigns (publishers + internal sources)
-- ─────────────────────────────────────────────────────────────────

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

-- ─────────────────────────────────────────────────────────────────
-- agents (sales agents with nicknames for fuzzy matching)
-- ─────────────────────────────────────────────────────────────────

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

-- ─────────────────────────────────────────────────────────────────
-- contacts (phone-keyed; parent of calls + policies)
-- ─────────────────────────────────────────────────────────────────

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

-- ─────────────────────────────────────────────────────────────────
-- calls (one per call attempt; FK contact, campaign, agent)
-- ─────────────────────────────────────────────────────────────────

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

-- ─────────────────────────────────────────────────────────────────
-- policies (one per submitted application; FK contact, carrier, product, campaign, agent)
-- ─────────────────────────────────────────────────────────────────

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

- [ ] **Step 3:** Sanity-check the file for syntax issues by counting expected statements:

```bash
grep -c "^CREATE TABLE" migrations/001_init.sql
```

Expected: `7` (one for each entity table: carriers, products, campaigns, agents, contacts, calls, policies). Note: `_migrations` is created by the migration runner itself in Task 5, not by this file.

```bash
grep -c "^CREATE INDEX" migrations/001_init.sql
```

Expected: `12` (1 product, 1 agent, 3 contacts, 4 calls, 6 policies = 15... wait, recount):
- products: 1 (idx_products_carrier)
- agents: 1 (idx_agents_nicknames)
- contacts: 3 (idx_contacts_state, idx_contacts_last_seen, idx_contacts_tags)
- calls: 4 (idx_calls_contact, idx_calls_date, idx_calls_campaign, idx_calls_agent)
- policies: 6 (idx_policies_contact, idx_policies_status, idx_policies_premium, idx_policies_carrier, idx_policies_agent, idx_policies_app_date)
- **Total: 15**

So expected output is `15`. If the count differs, re-check the file content matches Step 2 exactly.

```bash
grep -c "^CREATE TRIGGER" migrations/001_init.sql
```

Expected: `6` (carriers, products, campaigns, agents, contacts, policies — note `calls` doesn't have an updated_at column, so no trigger).

- [ ] **Step 4:** Commit:

```bash
git add migrations/001_init.sql
git commit -m "feat(db): add initial schema migration (7 entity tables + indexes + triggers)"
```

---

## Task 5: Create the migration runner `scripts/db-migrate.mjs`

**Files:**
- Create: `scripts/db-migrate.mjs`

- [ ] **Step 1:** Verify `scripts/` exists (it does — created during a prior unrelated task on `main`):

```bash
ls scripts/ 2>/dev/null || mkdir scripts
```

- [ ] **Step 2:** Write `scripts/db-migrate.mjs` with **exactly** this content:

```javascript
// scripts/db-migrate.mjs
// Migration runner for TCC Database Foundation.
//
// Run:
//   node --env-file=.env.local scripts/db-migrate.mjs            # apply pending (default 'up')
//   node --env-file=.env.local scripts/db-migrate.mjs up         # apply pending
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
  // .unsafe() is required for multi-statement DDL. The string is from a
  // file we control (not user input), so SQL injection isn't a concern.
  const client = rawClient();
  await client.unsafe(sqlText);
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
  if (all.length === 0) {
    console.log('No migration files in migrations/.');
    return;
  }
  for (const f of all) {
    console.log(applied.has(f) ? `✓ ${f}` : `· ${f} (pending)`);
  }
}

async function main() {
  const cmd = process.argv[2] ?? 'up';
  if (cmd === 'up') await up();
  else if (cmd === 'status') await status();
  else {
    console.error(`Unknown command: ${cmd}. Use 'up' or 'status'.`);
    process.exit(1);
  }
}

main()
  .catch(e => {
    console.error('FATAL:', e);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
```

- [ ] **Step 3:** Verify it runs without DATABASE_URL set (helpful error):

```bash
node --input-type=module -e "
import('./scripts/db-migrate.mjs').catch(e => console.log('caught:', e.message));
" 2>&1 | head -5
```

Expected: an error mentioning `DATABASE_URL not set`. (The dynamic import path triggers our db.js lazy-init.)

Actually — `db-migrate.mjs` is an entry point, not an importable module. Better verification: just run with no env file and confirm it errors:

```bash
node scripts/db-migrate.mjs status 2>&1 | head -5
```

Expected: a stack trace ending with `DATABASE_URL not set`.

- [ ] **Step 4:** Commit:

```bash
git add scripts/db-migrate.mjs
git commit -m "feat(db): add migration runner (up + status commands)"
```

---

## Task 6: Apply the initial migration (LIVE — requires DATABASE_URL set in .env.local)

**Files:** none (operational task that exercises code from Tasks 1–5)

This task requires Pre-flight P1 to be complete (DATABASE_URL set in `.env.local`).

- [ ] **Step 1:** Confirm DATABASE_URL is set:

```bash
grep "^DATABASE_URL=" .env.local | sed 's/=.*/=<set>/'
```

Expected: `DATABASE_URL=<set>`. If output is empty, **stop** — Pre-flight P1 isn't done. The user needs to provision Neon and add DATABASE_URL to .env.local.

- [ ] **Step 2:** Check status of migrations (should show `001_init.sql` pending):

```bash
node --env-file=.env.local scripts/db-migrate.mjs status
```

Expected output:
```
· 001_init.sql (pending)
```

- [ ] **Step 3:** Apply the migration:

```bash
node --env-file=.env.local scripts/db-migrate.mjs up
```

Expected output:
```
1 pending migration(s):
Applying 001_init.sql...
  ✓ 001_init.sql
Done.
```

- [ ] **Step 4:** Re-run status to confirm idempotency:

```bash
node --env-file=.env.local scripts/db-migrate.mjs status
```

Expected:
```
✓ 001_init.sql
```

- [ ] **Step 5:** Re-run `up` to confirm it's a no-op when nothing is pending:

```bash
node --env-file=.env.local scripts/db-migrate.mjs up
```

Expected:
```
No pending migrations.
```

- [ ] **Step 6:** Verify all 8 expected tables exist (7 entity + `_migrations`):

```bash
node --env-file=.env.local --input-type=module -e "
import('./src/lib/db.js').then(async ({ sql, closeDb }) => {
  const rows = await sql\`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename\`;
  const names = rows.map(r => r.tablename);
  console.log('Tables:', names.join(', '));
  const expected = ['_migrations', 'agents', 'calls', 'campaigns', 'carriers', 'contacts', 'policies', 'products'];
  const missing = expected.filter(t => !names.includes(t));
  if (missing.length) { console.error('MISSING:', missing.join(', ')); process.exit(1); }
  console.log(rows.length, 'tables present (expected 8)');
  await closeDb();
});
"
```

Expected: lists 8 table names, then `8 tables present (expected 8)`. If any are missing, the migration didn't apply cleanly — debug.

- [ ] **Step 7:** Verify all 15 indexes exist:

```bash
node --env-file=.env.local --input-type=module -e "
import('./src/lib/db.js').then(async ({ sql, closeDb }) => {
  const rows = await sql\`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE 'idx_%' ORDER BY indexname\`;
  console.log('Custom indexes:', rows.length);
  for (const r of rows) console.log(' ', r.indexname);
  if (rows.length !== 15) { console.error('Expected 15 idx_* indexes, found', rows.length); process.exit(1); }
  console.log('Index count OK');
  await closeDb();
});
"
```

Expected: 15 lines listing each idx_* name, then `Index count OK`.

- [ ] **Step 8:** Commit (no file changes — but tag the milestone):

There's nothing to commit here (no file changes; this task is operational). Skip the commit step. The verification output above is the "evidence" that the migration applied successfully.

---

## Task 7: End-to-end smoke test (insert + read on every table)

**Files:** none (creates a temporary verification script, runs it, deletes it)

This task confirms FKs, triggers, and the camelCase transform all work as expected.

- [ ] **Step 1:** Create a temporary smoke-test script:

```bash
cat > /tmp/db-smoke-test.mjs <<'EOF'
import { sql, closeDb } from './src/lib/db.js';

async function run() {
  // 1. Insert a carrier
  const [carrier] = await sql`
    INSERT INTO carriers (name, display_name)
    VALUES ('Smoke Test Carrier', 'STC')
    RETURNING id, name, created_at, updated_at
  `;
  console.log('carrier inserted:', carrier);
  if (!carrier.id) throw new Error('carrier.id missing');
  if (!carrier.createdAt) throw new Error('carrier.createdAt missing (camelCase transform broken?)');

  // 2. Insert a product (FK to carrier)
  const [product] = await sql`
    INSERT INTO products (carrier_id, name, product_type, default_advance_months)
    VALUES (${carrier.id}, 'Smoke Test Product', 'whole_life', 9)
    RETURNING id, name, carrier_id
  `;
  console.log('product inserted:', product);
  if (product.carrierId !== carrier.id) throw new Error('product.carrierId mismatch');

  // 3. Insert a campaign
  const [campaign] = await sql`
    INSERT INTO campaigns (code, vendor, category, price_per_billable_call, buffer_seconds)
    VALUES ('SMOKE', 'Smoke Vendor', 'paid_publisher', 45.00, 60)
    RETURNING id, code
  `;
  console.log('campaign inserted:', campaign);

  // 4. Insert an agent
  const [agent] = await sql`
    INSERT INTO agents (canonical_name, nicknames)
    VALUES ('Smoke Agent', ARRAY['Smokey', 'S. Agent'])
    RETURNING id, canonical_name, nicknames
  `;
  console.log('agent inserted:', agent);
  if (!Array.isArray(agent.nicknames) || agent.nicknames.length !== 2) {
    throw new Error('agent.nicknames array roundtrip broken');
  }

  // 5. Insert a contact
  const [contact] = await sql`
    INSERT INTO contacts (phone, first_name, last_name, state, tags)
    VALUES ('5555555555', 'Smoke', 'Test', 'CA', ARRAY['publisher:SMOKE', 'state:CA'])
    RETURNING id, phone, tags
  `;
  console.log('contact inserted:', contact);

  // 6. Insert a call (FK to contact, campaign, agent)
  const [call] = await sql`
    INSERT INTO calls (contact_id, campaign_id, agent_id, call_date, campaign_code, rep_name, phone_raw, call_status, duration_seconds, row_hash)
    VALUES (${contact.id}, ${campaign.id}, ${agent.id}, NOW(), 'SMOKE', 'Smoke Agent', '5555555555', 'Answered', 47, 'smoke-test-hash-1')
    RETURNING id, contact_id, campaign_id, agent_id
  `;
  console.log('call inserted:', call);

  // 7. Insert a policy (FKs to all)
  const [policy] = await sql`
    INSERT INTO policies (contact_id, carrier_id, product_id, sales_lead_source_campaign_id, agent_id, policy_number, monthly_premium, placed_status, source_row_hash)
    VALUES (${contact.id}, ${carrier.id}, ${product.id}, ${campaign.id}, ${agent.id}, 'SMOKE-001', 50.00, 'Submitted - Pending', 'smoke-policy-hash-1')
    RETURNING id, monthly_premium, placed_status
  `;
  console.log('policy inserted:', policy);
  if (policy.monthlyPremium === undefined) throw new Error('policy.monthlyPremium missing');

  // 8. Verify trigger updates `updated_at` on UPDATE
  const before = carrier.updatedAt;
  await new Promise(r => setTimeout(r, 50)); // ensure clock advances
  await sql`UPDATE carriers SET notes = 'updated' WHERE id = ${carrier.id}`;
  const [after] = await sql`SELECT updated_at FROM carriers WHERE id = ${carrier.id}`;
  if (after.updatedAt <= before) {
    throw new Error('updated_at trigger did not fire (before=' + before + ', after=' + after.updatedAt + ')');
  }
  console.log('updated_at trigger fires on UPDATE: OK');

  // 9. Verify ON DELETE CASCADE on contact → calls + policies
  await sql`DELETE FROM contacts WHERE id = ${contact.id}`;
  const [{ count: callCount }] = await sql`SELECT COUNT(*)::int AS count FROM calls WHERE id = ${call.id}`;
  const [{ count: policyCount }] = await sql`SELECT COUNT(*)::int AS count FROM policies WHERE id = ${policy.id}`;
  if (callCount !== 0 || policyCount !== 0) {
    throw new Error('ON DELETE CASCADE did not clear children (calls=' + callCount + ', policies=' + policyCount + ')');
  }
  console.log('ON DELETE CASCADE works: OK');

  // 10. Clean up the smoke test data
  await sql`DELETE FROM products WHERE id = ${product.id}`;
  await sql`DELETE FROM carriers WHERE id = ${carrier.id}`;
  await sql`DELETE FROM campaigns WHERE id = ${campaign.id}`;
  await sql`DELETE FROM agents WHERE id = ${agent.id}`;
  console.log('smoke test cleanup complete');

  console.log('\nALL SMOKE TESTS PASSED ✓');
}

run().catch(e => { console.error('FAIL:', e.message); process.exit(1); }).finally(() => closeDb());
EOF
```

- [ ] **Step 2:** Run the smoke test:

```bash
node --env-file=.env.local /tmp/db-smoke-test.mjs
```

Expected: 10 step output lines and a final `ALL SMOKE TESTS PASSED ✓`. If any step fails, fix the underlying issue (in `migrations/001_init.sql` or `src/lib/db.js`) and re-run.

- [ ] **Step 3:** Delete the temporary script:

```bash
rm /tmp/db-smoke-test.mjs
```

- [ ] **Step 4:** No commit (no file changes in the worktree; the smoke test is verification only).

---

## Task 8: Update CLAUDE.md to document the database

**Files:**
- Modify: `claude.md` (note: lowercase filename — the on-disk name is `CLAUDE.md` but git tracks it as `claude.md` due to macOS case-insensitive filesystem; use whichever the existing repo conventions use)

- [ ] **Step 1:** Determine the actual git-tracked filename:

```bash
git ls-files | grep -i "^claude.md$"
```

Note the exact case. Use whatever `git ls-files` returns. Most likely `claude.md` (lowercase).

- [ ] **Step 2:** Append a new section to the bottom of the file. Read the current end of the file first:

```bash
tail -10 claude.md   # or CLAUDE.md, whatever git ls-files showed
```

Find the LAST `##` section heading. The new section appends AFTER everything, separated by a `---` horizontal rule.

- [ ] **Step 3:** Append this exact content to the file (use the same filename git tracks):

```markdown

---

## TCC Database (Postgres on Neon) — Apr 2026

Foundation for moving TCC Dashboard off Sheets-as-database. See spec at `docs/superpowers/specs/2026-04-26-tcc-database-foundation-design.md`.

### Connection

- Provider: Neon (10GB free tier, branchable)
- Library: `postgres` (postgres.js — no ORM, raw SQL via tagged-template literals)
- Module: `src/lib/db.js` exports `sql` (tagged template), `closeDb()`, `rawClient()`
- Env var: `DATABASE_URL` in `.env.local` and Vercel env

### Schema (V1)

7 entity tables + `_migrations`:

| Table | Purpose | FKs |
|---|---|---|
| `contacts` | One per unique person (phone-keyed) | — (parent) |
| `calls` | One per call attempt | contact, campaign, agent |
| `policies` | One per submitted application | contact, carrier, product, campaign, agent |
| `campaigns` | Publishers + internal sources | — |
| `carriers` | Insurance companies | — (parent of products) |
| `products` | Carrier × product combos | carrier |
| `agents` | Sales agents (with nicknames array for fuzzy matching) | — |
| `_migrations` | Tracks applied SQL migration files | — |

Indexes on the columns Portfolio UI will filter by (state, last_seen_at, tags, placed_status, premium, etc.).

Idempotency: `calls.row_hash` and `policies.source_row_hash` are UNIQUE — re-running the (future) Sheets→DB sync is safe.

### Usage

```javascript
import { sql } from '@/lib/db';

const contacts = await sql`
  SELECT id, first_name, last_name, phone
  FROM contacts
  WHERE state = ${state}
  ORDER BY last_seen_at DESC
  LIMIT 50
`;
// Returns array of objects with camelCase keys (firstName, lastName, lastSeenAt).
```

### Migrations

Plain SQL files in `migrations/`, applied alphabetically:

```bash
node --env-file=.env.local scripts/db-migrate.mjs status   # list applied + pending
node --env-file=.env.local scripts/db-migrate.mjs up       # apply pending
```

Add a new migration: create `migrations/00N_description.sql`, run `up`. The runner tracks applied filenames in the `_migrations` table; re-runs are no-ops.

V1 has no rollback — if a migration is wrong, write a new forward migration that fixes it.

### What is NOT yet implemented (future specs)

- Sheets → DB sync — populates the tables from Sales Tracker, Call Logs, Goals, etc.
- Portfolio UI — new tab consuming the DB (will replace Lead CRM, Retention, Business Health tabs)
- DB → GHL sync — rewires the existing GHL sync to read from DB instead of Sheets
- Other dashboard features migrating off Sheets-direct reads
```

- [ ] **Step 4:** Verify the section was added:

```bash
grep -c "TCC Database (Postgres on Neon)" claude.md
```

Expected: `1`. (Use `CLAUDE.md` if that's what git ls-files showed.)

- [ ] **Step 5:** Commit:

```bash
git add claude.md       # or CLAUDE.md
git commit -m "docs(db): document TCC Database in CLAUDE.md"
```

---

## Task 9: Push the branch

**Files:** none

- [ ] **Step 1:** Push to GitHub:

```bash
git push -u origin feature/db-foundation
```

Expected: a confirmation that the branch was created on the remote, plus a hint URL for opening a pull request.

- [ ] **Step 2:** Print the PR URL:

```bash
echo "PR: https://github.com/peterdschmitt/tcc-dashboard/pull/new/feature/db-foundation"
```

---

## Self-Review Notes (for plan author)

I checked the spec against this plan; coverage:

| Spec section | Implementing task(s) |
|---|---|
| 1. Why this exists | Implicit (the whole plan) |
| 2. Scope (in / out) | Pre-flight + Tasks 1–9 cover "in"; "out of scope" not implemented in this plan |
| 3. Tech stack decisions | Task 2 (postgres lib), Task 3 (db.js), Task 4 (SQL migrations), Task 5 (runner) |
| 4. Schema | Task 4 (full SQL) + Task 6 (verification) |
| 5. db.js module | Task 3 |
| 6. Migration runner | Task 5 |
| 7. File structure | "File Structure" section above + tasks |
| 8. Setup steps | Pre-flight P1 + Task 6 |
| 9. Testing strategy | Tasks 6–7 (verification + smoke test) |
| 10. Reliability/ops | Implicit in db.js's connection config + Neon's defaults |
| 11. Migration rollout plan | This plan ships V1; V2/V3/V4 are separate plans |
| 12. Open questions | Acknowledged in spec; not implemented (out of scope) |
| 13. What spec deliberately does NOT do | Adhered to throughout |

Placeholder scan: no "TBD", no "implement later", no "appropriate error handling". Every code block is complete.

Type/name consistency:
- `sql`, `closeDb`, `rawClient` — used consistently in db.js (Task 3) and db-migrate.mjs (Task 5)
- Table names + column names — used consistently between `001_init.sql` (Task 4), the smoke test (Task 7), and the verification queries (Task 6)
- 8 tables expected: `_migrations`, `agents`, `calls`, `campaigns`, `carriers`, `contacts`, `policies`, `products` — matches Task 6's verification list
- 15 indexes expected: 1 + 1 + 3 + 4 + 6 = 15 ✓ — matches Task 4 Step 3 and Task 6 Step 7

The plan is self-contained: a fresh agent picking it up can complete Tasks 1–9 from this document alone (after the user finishes Pre-flight P1).
