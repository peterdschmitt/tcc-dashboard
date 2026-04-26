# Session handoff — Verify GHL Export Correctness

**Date:** 2026-04-26
**Goal of the new session:** Determine whether the data we synced to GoHighLevel matches what's in our source-of-truth Google Sheets, identify any gaps or errors, and (if needed) complete or fix the export.

**Read this doc first.** It's self-contained — you don't need other prior conversation context.

---

## Quick orientation

You (the new session) are picking up a project that:

- Has built a working sync from Google Sheets → GoHighLevel (custom fields, contacts, notes)
- Ran a partial backfill that landed ~1,900 contacts in the GHL sandbox
- Of those, only ~65 have policy/sales data populated (the other ~1,800 are call-only)
- The standalone sales sync **never ran**, so the 197 sales records without call-log phone matches aren't in GHL at all
- The user (Peter) wants confidence that whatever IS in GHL is correct, and a clear answer on what's missing

The GHL UI (his actual interaction surface) shows ~50 contacts in the "submitted applications" smart list. He wants to know: is that 50 right, or is it broken?

---

## What "correct data loaded into GHL" means (5 dimensions)

A complete verification answers all five:

1. **Completeness** — does GHL have every contact it should?
   - Every unique phone in Sales Tracker → should have a GHL contact
   - Every sales record → should have populated policy custom fields on its contact
   - Every call log row → ideally produced/updated a contact

2. **Correctness** — for contacts that exist, are field values accurate vs source?
   - Spot-check: Sales Tracker says Premium=$63.37 → GHL contact's `Monthly Premium` field = $63.37?
   - Same for Carrier, Policy #, Effective Date, Sales Agent, etc.

3. **Field mapping** — did values land in the right custom fields?
   - All 54 custom fields exist in GHL (verified earlier)
   - But did sync code put `Application Submitted Date` into the right field, or did it accidentally write into `First Call Date`?

4. **Tagging** — are tags applied per spec?
   - `publisher:<campaign>` (e.g., `publisher:BCL`)
   - `state:<state>` (e.g., `state:CA`)
   - `callable:yes` or `callable:no`

5. **Activity / notes** — are call notes attached to the contacts?
   - Each call log row should append a timeline note
   - Format: `📞 <date> — <campaign> / <subcampaign> (Attempt #N) ...`
   - Recording URL included when present

A "yes, the export is correct" answer requires green on all 5. Anything else is a finding the user needs to know about.

---

## Known state going in (as of last session, 2026-04-26 ~10am)

### Source data (Google Sheets)

- **Sales Tracker** (`SALES_SHEET_ID`, tab = `Sheet1` per `SALES_TAB_NAME` env var): **262 rows**
  - Every row represents a submitted application (no `submitted` flag — being a row IS the flag)
  - Best column to filter for "submitted" downstream: `Application Submitted Date` (100% coverage)
  - Phone column header is **`Phone Number (US format)`** — note the parenthesized format
  - 80% of `Placed?` values are blank — known data quality issue, not an export problem
- **Call Logs** (`CALLLOGS_SHEET_ID`, tab = `Report`): **6,652 rows**
  - Phone column header is just `Phone`
  - Date format is `MM/DD/YYYY h:mm[:ss] AM/PM`

### GHL state (sandbox `BXMHAsqFnhseDHUumJBE`)

- **Total contacts:** 1,097 (as of last query)
- **Custom fields:** 54 created (28 call-log fields + 26 policy fields)
- **Contacts with `Application Submitted Date` populated:** ~65 (~6% of all contacts; ~25% of the 262 sales records)
- **Contacts with `Placed Status` populated:** ~38 (proportional to Sales Tracker's 80%-blank issue)
- **Sales sync log:** 0 entries — the standalone sales sync was never run

### What ran, what didn't

| Sync | Ran? | Coverage |
|---|---|---|
| Custom field bootstrap | ✅ Yes | All 54 fields in GHL |
| Goals sheet tabs (Sync Log, Possible Merges, Excluded Campaigns) | ✅ Yes | All 3 tabs created |
| Call log sync (V1) | ⚠️ Partial | 2,250 of 6,652 rows; aborted on rate-limit cascade |
| Sales enrichment within call log sync (V2 Phase B) | ⚠️ Partial | Only fired during the 2,250 processed call rows |
| Standalone Sales Tracker sync (V2 Phase C) | ❌ Never | Sales records without phone matches in call logs are NOT in GHL |
| Backfill of remaining 4,400 call log rows | ❌ Paused | GHL hit anti-abuse cooldown; rate limit cleared by end of last session |

### Why coverage is only ~25% on policy fields

The math: of 262 sales records, all 262 have phones. Of those phones:
- **243** also appear in the call logs (93% overlap)
- **19** are sales-only (referrals, internal transfers — never called via the dialer)

The call log sync would have enriched 243 contacts IF it processed all the matching phones. But it only got through 2,250 of 6,652 call log rows, and only ~250 of those happened to match a sales record. The rest (about ~190 sales-record-having phones) are stuck in the unprocessed call log queue OR are sales-only records.

The sales sync alone catches all 262 in one pass — but it never ran.

---

## Files and tools you'll use

### Already in the repo (`feature/ghl-call-log-sync` branch)

- `src/lib/ghl/client.js` — GHL API client (auth, retry, rate limit, all CRUD methods)
- `src/lib/ghl/field-mapping.js` — call-log custom field map (`ALL_CUSTOM_FIELDS` exports)
- `src/lib/ghl/sales-mapping.js` — sales/policy custom field map (`POLICY_FIELDS` exports)
- `src/lib/ghl/sync.js` — call log sync orchestrator (paused mid-run)
- `src/lib/ghl/sales-sync.js` — standalone sales sync (never run!)
- `src/lib/ghl/sheet-state.js` — Sync Log + Possible Merges tab helpers
- `scripts/ghl-full-backfill.mjs` — resumable full backfill (call logs + sales)
- `scripts/ghl-live-test.mjs` — small-batch test harness
- `scripts/ghl-sales-sync-test.mjs` — small-batch sales sync test
- `scripts/ghl-bootstrap-fields.js` — idempotent field creator
- `scripts/ghl-init-tabs.js` — idempotent tab creator (Goals sheet)

### MCP servers available

- The `ghl` MCP server is registered. **Use it for ad-hoc reads** (faster than the API client). For sync code edits, work in the modules above.

### Env vars (in `.env.local`, symlinked into the worktree)

- `GHL_API_TOKEN` — `pit-523fd1fe-b193-43ee-b2b1-7b629cc86cb4` (sandbox-scoped)
- `GHL_LOCATION_ID` — `BXMHAsqFnhseDHUumJBE`
- `GHL_SYNC_ENABLED` — `true`
- `GHL_SYNC_DRY_RUN` — `true`
- `SALES_SHEET_ID`, `CALLLOGS_SHEET_ID`, `GOALS_SHEET_ID` — all set
- `SALES_TAB_NAME` — `Sheet1` (NOT yet `Merged`)

### Rate limits to respect

GHL enforces ~10 req/sec sustained per location, with multi-minute extended cool-downs when exceeded. The client uses 250ms between calls (4/sec) for safety. **If you see HTTP 429, back off ≥60 seconds before retrying.** Do not tight-loop.

---

## Recommended verification plan (run in order)

The user's question is binary: "did the export work correctly or not?" Your job is to give a definitive, evidence-based answer with specific actionable findings.

### Step 1: Confirm GHL is reachable + count baseline

```bash
cd /Users/peterschmitt/Downloads/tcc-dashboard/.worktrees/feature-ghl-call-log-sync

# Probe GHL API
curl -sS -w "\nHTTP %{http_code}\n" \
  -H "Authorization: Bearer $GHL_API_TOKEN" \
  -H "Version: 2021-07-28" \
  "https://services.leadconnectorhq.com/locations/$GHL_LOCATION_ID/customFields" \
  | tail -2

# Expected: HTTP 200 and a customFields array with ~54 entries.
# If 429: stop, wait 5+ minutes, retry. Don't proceed until you get 200.
```

### Step 2: Pull authoritative current state from GHL

Save this script as `/tmp/ghl-state.mjs`, run it, capture the output:

```javascript
// /tmp/ghl-state.mjs
import { createGhlClient } from './src/lib/ghl/client.js';

const c = createGhlClient({ token: process.env.GHL_API_TOKEN, locationId: process.env.GHL_LOCATION_ID });
await c.resolveCustomFields();
const fieldMap = await c.resolveCustomFields();
const idToName = new Map();
for (const [n, id] of fieldMap.entries()) idToName.set(id, n);

const all = [];
let page = 1;
while (true) {
  const data = await c.request('GET', `/contacts/?locationId=${encodeURIComponent(process.env.GHL_LOCATION_ID)}&limit=100&page=${page}`);
  const cs = data.contacts ?? [];
  if (cs.length === 0) break;
  all.push(...cs);
  if (cs.length < 100) break;
  page++;
}
console.log('Total contacts:', all.length);

const counters = {
  'Application Submitted Date': 0, 'Policy #': 0, 'Carrier + Product + Payout': 0,
  'Monthly Premium': 0, 'Sales Agent': 0, 'Placed Status': 0, 'Effective Date': 0,
  'First Call Date': 0, 'Last Call Status': 0, 'Total Call Attempts': 0,
};
const placedBuckets = {};
const carrierCounts = {};
const agentCounts = {};

for (const ct of all) {
  const detail = await c.request('GET', '/contacts/' + ct.id);
  const full = detail.contact ?? detail;
  for (const cf of (full.customFields || [])) {
    const name = idToName.get(cf.id);
    if (counters[name] !== undefined && cf.value && String(cf.value).trim()) counters[name]++;
    if (name === 'Placed Status' && cf.value) {
      const v = String(cf.value).toLowerCase();
      let b = '(other)';
      if (v.match(/active|in force|advance/)) b = 'Active';
      else if (v.match(/lapsed|canceled|cancelled/)) b = 'Lapsed';
      else if (v.includes('declined')) b = 'Declined';
      else if (v.match(/pending|submitted/)) b = 'Pending';
      placedBuckets[b] = (placedBuckets[b] ?? 0) + 1;
    }
    if (name === 'Carrier + Product + Payout' && cf.value) {
      const car = String(cf.value).split(',')[0].split(' - ')[0].trim();
      carrierCounts[car] = (carrierCounts[car] ?? 0) + 1;
    }
    if (name === 'Sales Agent' && cf.value) {
      agentCounts[String(cf.value).trim()] = (agentCounts[String(cf.value).trim()] ?? 0) + 1;
    }
  }
}

console.log('\nField population:');
for (const [k, v] of Object.entries(counters)) console.log(`  ${k.padEnd(30)} ${v}/${all.length}`);
console.log('\nStatus buckets:', placedBuckets);
console.log('Carriers:', carrierCounts);
console.log('Agents:', agentCounts);
```

```bash
node --env-file=.env.local /tmp/ghl-state.mjs
```

This is your **baseline** — share output with the user.

### Step 3: Spot-check 10 random sales records → are they in GHL with correct values?

Save as `/tmp/spot-check.mjs`:

```javascript
import { readRawSheet } from './src/lib/sheets.js';
import { createGhlClient } from './src/lib/ghl/client.js';

function norm(p) { let s = (p ?? '').toString().replace(/\D/g, ''); if (s.length === 11 && s.startsWith('1')) s = s.slice(1); return s; }

const { data: sales } = await readRawSheet(process.env.SALES_SHEET_ID, process.env.SALES_TAB_NAME || 'Sheet1');
// Pick 10 evenly spaced
const indices = Array.from({length: 10}, (_, i) => Math.floor(i * sales.length / 10));
const c = createGhlClient({ token: process.env.GHL_API_TOKEN, locationId: process.env.GHL_LOCATION_ID });
await c.resolveCustomFields();
const fieldMap = await c.resolveCustomFields();
const idToName = new Map();
for (const [n, id] of fieldMap.entries()) idToName.set(id, n);

let inGhl = 0, withPolicy = 0, valuesMatch = 0;

for (const i of indices) {
  const r = sales[i];
  const phone = norm(r['Phone Number (US format)']);
  const name = `${r['First Name'] || ''} ${r['Last Name'] || ''}`.trim();
  const sheetPolicy = r['Policy #'];
  const sheetCarrier = r['Carrier + Product + Payout'];
  const sheetPremium = r['Monthly Premium'];

  console.log(`\n— ${name} / ${phone} / ${sheetPolicy}`);
  console.log(`  Sheet:  ${sheetCarrier} / $${sheetPremium}`);

  const ghl = await c.searchByPhone(phone);
  if (!ghl) { console.log('  → ❌ Not in GHL'); continue; }
  inGhl++;

  const detail = await c.request('GET', '/contacts/' + ghl.id);
  const full = detail.contact ?? detail;
  const cf = full.customFields || [];
  const findV = (n) => { const f = cf.find(x => idToName.get(x.id) === n); return f?.value; };

  const ghlPolicy = findV('Policy #');
  const ghlCarrier = findV('Carrier + Product + Payout');
  const ghlPremium = findV('Monthly Premium');

  if (!ghlPolicy) { console.log('  → ⚠️ In GHL but NO policy data'); continue; }
  withPolicy++;
  console.log(`  GHL:    ${ghlCarrier} / $${ghlPremium}`);

  const m = (sheetPolicy === ghlPolicy) && (sheetCarrier === ghlCarrier) && (String(sheetPremium) === String(ghlPremium));
  if (m) { valuesMatch++; console.log('  → ✓ MATCH'); }
  else console.log('  → ❌ MISMATCH on at least one field');
}

console.log(`\n═══════════════════════════════════`);
console.log(` Summary of 10-record spot-check:`);
console.log(`   In GHL:           ${inGhl}/10`);
console.log(`   With policy data: ${withPolicy}/10`);
console.log(`   Values matched:   ${valuesMatch}/10`);
console.log(`═══════════════════════════════════`);
```

```bash
node --env-file=.env.local /tmp/spot-check.mjs
```

This tells the user: **of 10 random sales records, what's actually in GHL and is it correct?**

### Step 4: Verify activity notes attached on a contact that should have them

Pick any contact ID from Step 3 that was found in GHL and has policy data. Then:

```bash
CID=<contact_id_from_step_3>
curl -sS -H "Authorization: Bearer $GHL_API_TOKEN" -H "Version: 2021-07-28" \
  "https://services.leadconnectorhq.com/contacts/$CID/notes" \
  | python3 -m json.tool | head -40
```

Expected: at least one note in the `notes` array, with `body` matching the spec format `📞 <date> — <campaign> ...`. If notes array is empty, the call-log activity-note layer of the sync didn't fire for this contact.

### Step 5: Verify tags on the same contact

```bash
curl -sS -H "Authorization: Bearer $GHL_API_TOKEN" -H "Version: 2021-07-28" \
  "https://services.leadconnectorhq.com/contacts/$CID" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('Tags:', d['contact'].get('tags', []))"
```

Expected: tags array containing `publisher:<X>`, `state:<X>`, and `callable:yes`-or-`callable:no`. Other tags fine; missing the prefixed ones means tag-application didn't fire.

### Step 6: Decide what to do with findings

Based on Steps 1–5, one of three outcomes:

**Outcome A — All 5 dimensions look correct** (rare given known-paused state):
- Report success
- Identify what's *missing* (the 197 sales records not in GHL)
- Recommend running the sales sync to close the gap

**Outcome B — Values are correct but coverage is partial** (most likely):
- Report: data that IS in GHL is right; significant chunks are missing
- Run the sales sync first (cheapest, gets all 262 sales records into GHL):
  ```bash
  node --env-file=.env.local scripts/ghl-sales-sync-test.mjs --limit=500 --live
  ```
  (--limit=500 covers all 262 records since slice(0, limit) takes them all)
- Optionally resume the call log backfill for the remaining 4,400 rows:
  ```bash
  nohup node --env-file=.env.local scripts/ghl-full-backfill.mjs > /tmp/ghl-backfill.log 2>&1 &
  ```
- After both, re-run Steps 2–5 to verify

**Outcome C — Values mismatch or fields are wrong** (signals a bug):
- Don't proceed with more syncs until the bug is fixed
- Identify which field mapping is broken (look at `src/lib/ghl/field-mapping.js` and `sales-mapping.js`)
- The `transform: postgres.camel` config in db.js doesn't apply here since we're querying GHL directly — but the GHL field IDs in the sync code might be stale if fields were recreated
- Likely cause: field display name changes (we renamed some during V2)

---

## What to deliver back to the user

When verification is complete, hand back a summary like:

```
GHL EXPORT VERIFICATION — 2026-MM-DD

Total GHL contacts:        XXX
Sales records expected:    262
Sales records in GHL:      YYY (Z%)

Spot-check (10 records):
  In GHL:                  X/10
  With policy data:        Y/10
  Values match source:     Z/10

Activity notes:            ✓ verified on sample
Tags:                      ✓ verified on sample

Findings:
- [bullet list of any issues]

Recommended actions:
- [what to do next]
```

Be specific. Numbers > prose. The user will use this to decide whether to invest in fixing GHL or pivot to the DB build (which is the existing comprehensive plan at `docs/superpowers/plans/2026-04-26-tcc-portfolio-full-build-plan.md`).

---

## Things to NOT do in this session

- Don't write new sync code. The existing modules are battle-tested.
- Don't bulk-delete contacts (sandbox or otherwise) without confirming with the user first — the sandbox has working test data.
- Don't change custom field display names — would break the existing sync immediately.
- Don't switch `SALES_TAB_NAME` to `Merged` — only 72 of 262 records are in Merged, you'd lose coverage.
- Don't trigger any GHL workflows (the user hasn't built any yet, but defensively: never auto-trigger).
- Don't invest hours fixing edge cases. Goal is a clear verification report, not perfection.

---

## Open question on direction

The user has two parallel tracks:

1. **Continue with GHL** — fix sync gaps, build smart lists, train team on GHL UI
2. **Pivot to custom Portfolio UI** — build the DB-backed dashboard per `docs/superpowers/plans/2026-04-26-tcc-portfolio-full-build-plan.md`

This verification helps them decide. If GHL data is mostly correct and they trust their workflow, track 1 makes sense. If verification reveals systemic issues OR the user expresses GHL UI fatigue, track 2 is the durable answer.

You don't need to push either direction — just give them the data to decide.

---

## Appendix: Branch and commit context

- **Active branch:** `feature/ghl-call-log-sync`
- **Worktree path:** `/Users/peterschmitt/Downloads/tcc-dashboard/.worktrees/feature-ghl-call-log-sync`
- **Latest commits to know about:**
  - `1a6ddf1` — Removed superseded foundation-only plan
  - `11f0c55` — Added the full Portfolio build plan (foundation + sync + UI)
  - `041325c` — Added GHL Context section to claude.md (MCP rules, rate limit discipline)

The `claude.md` in the worktree has been updated with operating rules for the GHL MCP server. Read it for tooling preferences and confirmation gates on destructive ops.
