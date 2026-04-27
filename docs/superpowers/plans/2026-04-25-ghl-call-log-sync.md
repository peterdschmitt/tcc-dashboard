# GHL Call Log Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a one-way sync that pushes every callable lead from the Call Logs Google Sheet into GoHighLevel as a contact, running as a Vercel cron job inside the TCC Dashboard app.

**Architecture:** Three-layer module structure under `src/lib/ghl/`: pure utility functions (filter, matcher, field-mapping, note-formatter, row-hash) at the bottom; a `client.js` module wrapping the GHL REST API with auth/retry/rate-limit at the middle; an orchestration `sync.js` and two thin Next.js API routes (`/api/cron/ghl-sync`, `/api/ghl-backfill`) at the top. State lives in three new tabs in the Goals sheet. Dry-run mode and a kill-switch env var gate live writes.

**Tech Stack:** Next.js 14 App Router, Node 18+, `googleapis` (already in repo), `crypto` (Node built-in for hashing), GHL LeadConnector v2 REST API, Vercel cron.

**Spec:** `docs/superpowers/specs/2026-04-25-ghl-call-log-sync-design.md`

**Testing approach (project-specific note):** This codebase has no test framework installed. Per the spec, validation strategy is: (a) inline Node assertion scripts via `node -e` for pure functions, (b) `GHL_SYNC_DRY_RUN=true` for end-to-end safety, (c) smoke test in a GHL test sub-account before flipping to production location. Each task below uses these mechanisms in place of a unit-test runner.

---

## File Structure

### New files (created by this plan)

```
src/lib/ghl/
├── levenshtein.js          # Pure: edit distance for fuzzy name match
├── row-hash.js             # Pure: sha256 idempotency key
├── filter.js               # Pure: exclude rules (campaign list + missing phone)
├── note-formatter.js       # Pure: activity-note string builder
├── field-mapping.js        # Pure: Call-Log row → GHL contact patch
├── matcher.js              # Pure: tier 1/2/3 ladder (uses injected search fns)
├── client.js               # I/O: GHL REST wrapper (auth, retry, rate limit)
├── sheet-state.js          # I/O: read/write Sync Log, Possible Merges, watermark, excluded campaigns
└── sync.js                 # Orchestration: processSingleRow + processBatch

src/app/api/
├── cron/ghl-sync/route.js  # Cron entrypoint (every 10 min)
└── ghl-backfill/route.js   # One-shot backfill by date range

scripts/
├── ghl-bootstrap-fields.js # One-time: create the 28 custom fields in GHL
└── ghl-init-tabs.js        # One-time: create the 3 new tabs in Goals sheet
```

### Modified files

```
vercel.json                 # add cron schedule + maxDuration for new routes
CLAUDE.md                   # append "GHL Call Log Sync" docs section
```

### Files explicitly NOT touched

- `src/components/**` — no UI in V1
- `src/app/api/dashboard/**`, `commission*`, `crm/**`, `daily-summary/**` — economics/dashboard untouched
- `src/lib/sheets.js`, `src/lib/snapshots.js`, `src/lib/baselines.js` — read-only consumers
- Sheet1, Merged tab, Call Logs sheet — never written to

---

## Phase 1 — Pure Utilities (no I/O, no API, no GHL)

### Task 1: Levenshtein distance utility

**Files:**
- Create: `src/lib/ghl/levenshtein.js`

- [ ] **Step 1: Define the expected behavior**

The function must return:
- `0` for identical strings (case-insensitive)
- `1` for one substitution / insertion / deletion
- `2+` for larger differences

Edge cases: empty string vs anything, undefined inputs treated as empty.

- [ ] **Step 2: Implement**

```javascript
// src/lib/ghl/levenshtein.js
/**
 * Case-insensitive Levenshtein edit distance.
 * Returns the minimum number of single-character edits (insertions,
 * deletions, substitutions) required to change `a` into `b`.
 * undefined/null inputs are treated as empty strings.
 */
export function levenshtein(a, b) {
  const s = (a ?? '').toLowerCase();
  const t = (b ?? '').toLowerCase();
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;

  const prev = new Array(t.length + 1);
  const curr = new Array(t.length + 1);
  for (let j = 0; j <= t.length; j++) prev[j] = j;

  for (let i = 1; i <= s.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,        // insert
        prev[j] + 1,            // delete
        prev[j - 1] + cost      // substitute
      );
    }
    for (let j = 0; j <= t.length; j++) prev[j] = curr[j];
  }
  return prev[t.length];
}
```

- [ ] **Step 3: Verify**

Run from project root:

```bash
node --input-type=module -e "
import('./src/lib/ghl/levenshtein.js').then(({ levenshtein }) => {
  const cases = [
    ['John', 'John', 0],
    ['John', 'Jon', 1],
    ['John', 'Jhon', 2],
    ['', 'abc', 3],
    ['Smith', 'smith', 0],
    [null, undefined, 0],
    ['John', 'Sara', 4],
  ];
  let ok = 0;
  for (const [a, b, expected] of cases) {
    const got = levenshtein(a, b);
    if (got === expected) ok++;
    else console.error('FAIL', a, b, 'expected', expected, 'got', got);
  }
  console.log(ok + '/' + cases.length + ' passed');
  if (ok !== cases.length) process.exit(1);
});
"
```

Expected output: `7/7 passed`

- [ ] **Step 4: Commit**

```bash
git add src/lib/ghl/levenshtein.js
git commit -m "feat(ghl-sync): add Levenshtein distance utility for fuzzy name matching"
```

---

### Task 2: Row hash utility (idempotency key)

**Files:**
- Create: `src/lib/ghl/row-hash.js`

- [ ] **Step 1: Define the expected behavior**

Given a Call Log row object, produce a stable sha256 hex string from `{Lead Id, Date, Phone, Duration}`. Must be deterministic — same input always yields same hash. Used as the idempotency key in the Sync Log.

- [ ] **Step 2: Implement**

```javascript
// src/lib/ghl/row-hash.js
import { createHash } from 'node:crypto';

/**
 * Stable sha256 hash of a Call Log row, used as idempotency key.
 * Composed from `Lead Id`, `Date`, `Phone`, and `Duration` — the four
 * fields that together uniquely identify a single call attempt.
 */
export function rowHash(row) {
  const parts = [
    row['Lead Id'] ?? '',
    row['Date'] ?? '',
    row['Phone'] ?? '',
    row['Duration'] ?? '',
  ].map(v => String(v).trim());
  return createHash('sha256').update(parts.join('|')).digest('hex');
}
```

- [ ] **Step 3: Verify**

```bash
node --input-type=module -e "
import('./src/lib/ghl/row-hash.js').then(({ rowHash }) => {
  const a = rowHash({ 'Lead Id': '1', 'Date': '2026-04-25', 'Phone': '555-1234', 'Duration': '47' });
  const b = rowHash({ 'Lead Id': '1', 'Date': '2026-04-25', 'Phone': '555-1234', 'Duration': '47' });
  const c = rowHash({ 'Lead Id': '1', 'Date': '2026-04-25', 'Phone': '555-1234', 'Duration': '48' });
  if (a !== b) { console.error('FAIL: same input gave different hashes'); process.exit(1); }
  if (a === c) { console.error('FAIL: different input gave same hash'); process.exit(1); }
  if (a.length !== 64) { console.error('FAIL: hash not 64 hex chars'); process.exit(1); }
  console.log('rowHash OK:', a.slice(0, 12) + '…');
});
"
```

Expected: `rowHash OK: <12 hex chars>…`

- [ ] **Step 4: Commit**

```bash
git add src/lib/ghl/row-hash.js
git commit -m "feat(ghl-sync): add row-hash utility for sync idempotency"
```

---

### Task 3: Filter logic (exclusions + missing phone)

**Files:**
- Create: `src/lib/ghl/filter.js`

- [ ] **Step 1: Define expected behavior**

`shouldProcessRow(row, excludedCampaigns, syncedHashes)` returns:
- `{ ok: false, reason: 'missing_phone' }` if Phone is blank/whitespace
- `{ ok: false, reason: 'excluded_campaign' }` if Campaign matches an excluded entry (matching on Campaign exact, or Campaign+Subcampaign exact when Subcampaign is set on the rule)
- `{ ok: false, reason: 'already_synced' }` if `rowHash(row)` is in `syncedHashes` Set
- `{ ok: true }` otherwise

`excludedCampaigns` is an array like `[{ Campaign: 'Test', Subcampaign: '' }, { Campaign: 'BCL', Subcampaign: 'Internal' }]`.

- [ ] **Step 2: Implement**

```javascript
// src/lib/ghl/filter.js
import { rowHash } from './row-hash.js';

/**
 * Decide whether a Call Log row should be processed.
 * @param row Call Log row object (keyed by header name)
 * @param excludedCampaigns array of { Campaign, Subcampaign } rules
 * @param syncedHashes Set<string> of row hashes already in Sync Log
 */
export function shouldProcessRow(row, excludedCampaigns, syncedHashes) {
  const phone = (row['Phone'] ?? '').trim();
  if (!phone) return { ok: false, reason: 'missing_phone' };

  const campaign = (row['Campaign'] ?? '').trim();
  const subcampaign = (row['Subcampaign'] ?? '').trim();
  for (const rule of excludedCampaigns ?? []) {
    const ruleCampaign = (rule.Campaign ?? '').trim();
    const ruleSubcampaign = (rule.Subcampaign ?? '').trim();
    if (!ruleCampaign) continue;
    if (campaign !== ruleCampaign) continue;
    // Subcampaign-scoped rule: must match. Empty rule subcampaign = applies to whole campaign.
    if (ruleSubcampaign && ruleSubcampaign !== subcampaign) continue;
    return { ok: false, reason: 'excluded_campaign' };
  }

  const hash = rowHash(row);
  if (syncedHashes && syncedHashes.has(hash)) {
    return { ok: false, reason: 'already_synced' };
  }

  return { ok: true };
}
```

- [ ] **Step 3: Verify**

```bash
node --input-type=module -e "
import('./src/lib/ghl/filter.js').then(({ shouldProcessRow }) => {
  const cases = [
    [{ 'Phone': '', 'Campaign': 'BCL' }, [], new Set(), 'missing_phone'],
    [{ 'Phone': '   ', 'Campaign': 'BCL' }, [], new Set(), 'missing_phone'],
    [{ 'Phone': '555-1', 'Campaign': 'Test' }, [{ Campaign: 'Test', Subcampaign: '' }], new Set(), 'excluded_campaign'],
    [{ 'Phone': '555-1', 'Campaign': 'BCL', 'Subcampaign': 'Internal' }, [{ Campaign: 'BCL', Subcampaign: 'Internal' }], new Set(), 'excluded_campaign'],
    [{ 'Phone': '555-1', 'Campaign': 'BCL', 'Subcampaign': 'Public' }, [{ Campaign: 'BCL', Subcampaign: 'Internal' }], new Set(), null],
    [{ 'Phone': '555-1', 'Campaign': 'BCL', 'Lead Id': 'X', 'Date': 'D', 'Duration': '1' }, [], new Set(), null],
  ];
  let ok = 0;
  for (const [row, excl, hashes, expected] of cases) {
    const r = shouldProcessRow(row, excl, hashes);
    const got = r.ok ? null : r.reason;
    if (got === expected) ok++;
    else console.error('FAIL', JSON.stringify(row), 'expected', expected, 'got', got);
  }
  console.log(ok + '/' + cases.length + ' passed');
  if (ok !== cases.length) process.exit(1);
});
"
```

Expected: `6/6 passed`

- [ ] **Step 4: Commit**

```bash
git add src/lib/ghl/filter.js
git commit -m "feat(ghl-sync): add row filter (exclusions + missing-phone + dedup-hash)"
```

---

### Task 4: Activity note formatter

**Files:**
- Create: `src/lib/ghl/note-formatter.js`

- [ ] **Step 1: Define expected behavior**

`formatNote(row)` returns the multi-line string the spec describes in §6.6:

```
📞 2026-04-25 14:32 — BCL / SubcampaignX (Attempt #2)
   Status: Answered | Type: Inbound | Duration: 47s | Hold: 8s
   Rep: John D. | Caller ID: 555-1234 | Hangup: Caller via SIP
   Lead ID: 8847291 | Client ID: 449281
   Details: Spoke briefly, requested callback
   🎙️ https://recording.example.com/abc123
```

The Recording line is omitted when `row['Recording']` is blank. The Details line is omitted when `row['Details']` is blank. All other lines always render even if individual fields are blank.

- [ ] **Step 2: Implement**

```javascript
// src/lib/ghl/note-formatter.js
/**
 * Format a single Call Log row as a multi-line activity note for GHL.
 * Recording and Details lines are omitted when blank; other lines always render.
 */
export function formatNote(row) {
  const v = (k) => (row[k] ?? '').toString().trim();
  const lines = [];

  // Header line: 📞 Date — Campaign / Subcampaign (Attempt #N)
  const header = `📞 ${v('Date')} — ${v('Campaign')} / ${v('Subcampaign')} (Attempt #${v('Attempt')})`;
  lines.push(header);

  lines.push(`   Status: ${v('Call Status')} | Type: ${v('Call Type')} | Duration: ${v('Duration')}s | Hold: ${v('HoldTime')}s`);
  lines.push(`   Rep: ${v('Rep')} | Caller ID: ${v('Caller ID')} | Hangup: ${v('Hangup')} via ${v('Hangup Source')}`);
  lines.push(`   Lead ID: ${v('Lead Id')} | Client ID: ${v('Client ID')}`);

  if (v('Details')) lines.push(`   Details: ${v('Details')}`);
  if (v('Recording')) lines.push(`   🎙️ ${v('Recording')}`);

  return lines.join('\n');
}
```

- [ ] **Step 3: Verify**

```bash
node --input-type=module -e "
import('./src/lib/ghl/note-formatter.js').then(({ formatNote }) => {
  const row = {
    'Date': '2026-04-25 14:32', 'Campaign': 'BCL', 'Subcampaign': 'SubX', 'Attempt': '2',
    'Call Status': 'Answered', 'Call Type': 'Inbound', 'Duration': '47', 'HoldTime': '8',
    'Rep': 'John D.', 'Caller ID': '555-1234', 'Hangup': 'Caller', 'Hangup Source': 'SIP',
    'Lead Id': '8847291', 'Client ID': '449281',
    'Details': 'Spoke briefly', 'Recording': 'https://rec/abc'
  };
  const out = formatNote(row);
  if (!out.includes('📞 2026-04-25 14:32 — BCL / SubX (Attempt #2)')) { console.error('FAIL header'); process.exit(1); }
  if (!out.includes('Details: Spoke briefly')) { console.error('FAIL details'); process.exit(1); }
  if (!out.includes('🎙️ https://rec/abc')) { console.error('FAIL recording'); process.exit(1); }

  const out2 = formatNote({ ...row, 'Details': '', 'Recording': '' });
  if (out2.includes('Details:') || out2.includes('🎙️')) { console.error('FAIL omit'); process.exit(1); }
  console.log('formatNote OK');
});
"
```

Expected: `formatNote OK`

- [ ] **Step 4: Commit**

```bash
git add src/lib/ghl/note-formatter.js
git commit -m "feat(ghl-sync): add activity-note formatter"
```

---

### Task 5: Field mapping — row to GHL contact patch

**Files:**
- Create: `src/lib/ghl/field-mapping.js`

- [ ] **Step 1: Define expected behavior**

`buildContactPatch(row, { isNewContact })` returns an object describing what to write to GHL:

```javascript
{
  native: {
    firstName, lastName, phone, state, country, source
  },
  customFields: {  // keyed by stable internal field name (mapped to GHL field IDs by client.js)
    'firstLeadId': ..., 'firstClientId': ..., ... (only when isNewContact === true)
    'lastLeadId': ..., 'lastClientId': ..., ... (always)
    'totalCallAttempts': ... (handled at orchestration layer, see Task 11)
  },
  tags: ['publisher:BCL', 'state:CA', 'callable:yes'],
  callableNegationTag: 'callable:no'  // tag to remove when adding callable:yes (and vice versa)
}
```

Native fields are only sent on `isNewContact === true`. On Tier 1 match (existing contact), the spec says "keep existing — never overwrite" for First/Last/State/Country/Source. Phone is handled separately in client.js (additionalPhones append).

`firstX` custom fields are only included when `isNewContact === true`.
`lastX` custom fields are included on every call.

- [ ] **Step 2: Implement**

Define the canonical custom field name list as exported constants so the bootstrap script (Task 24) and client.js (Task 9) share one source of truth.

```javascript
// src/lib/ghl/field-mapping.js

// Canonical internal names for custom fields. The bootstrap script
// creates GHL fields with these exact display names; client.js resolves
// them to GHL field IDs at runtime.
export const FIRST_FIELDS = [
  ['firstLeadId',        'First Lead ID'],
  ['firstClientId',      'First Client ID'],
  ['firstCallDate',      'First Call Date'],
  ['firstCampaign',      'First Campaign'],
  ['firstSubcampaign',   'First Subcampaign'],
  ['firstCallerId',      'First Caller ID'],
  ['firstInboundSource', 'First Inbound Source'],
  ['firstImportDate',    'First Import Date'],
  ['firstRep',           'First Rep'],
];

export const LAST_FIELDS = [
  ['lastLeadId',         'Last Lead ID'],
  ['lastClientId',       'Last Client ID'],
  ['lastCallDate',       'Last Call Date'],
  ['lastRep',            'Last Rep'],
  ['lastCampaign',       'Last Campaign'],
  ['lastSubcampaign',    'Last Subcampaign'],
  ['lastCallerId',       'Last Caller ID'],
  ['lastImportDate',     'Last Import Date'],
  ['lastCallStatus',     'Last Call Status'],
  ['lastCallType',       'Last Call Type'],
  ['lastCallDuration',   'Last Call Duration (s)'],
  ['lastHoldTime',       'Last Hold Time (s)'],
  ['lastHangup',         'Last Hangup'],
  ['lastHangupSource',   'Last Hangup Source'],
  ['lastCallDetails',    'Last Call Details'],
  ['lastRecordingUrl',   'Last Recording URL'],
  ['lastAttemptNumber',  'Last Attempt #'],
  ['currentlyCallable',  'Currently Callable'],
];

export const COMPUTED_FIELDS = [
  ['totalCallAttempts',  'Total Call Attempts'],
];

export const ALL_CUSTOM_FIELDS = [...FIRST_FIELDS, ...LAST_FIELDS, ...COMPUTED_FIELDS];

const FIRST_SOURCE_COLUMNS = {
  firstLeadId: 'Lead Id',
  firstClientId: 'Client ID',
  firstCallDate: 'Date',
  firstCampaign: 'Campaign',
  firstSubcampaign: 'Subcampaign',
  firstCallerId: 'Caller ID',
  firstInboundSource: 'Inbound Source',
  firstImportDate: 'Import Date',
  firstRep: 'Rep',
};

const LAST_SOURCE_COLUMNS = {
  lastLeadId: 'Lead Id',
  lastClientId: 'Client ID',
  lastCallDate: 'Date',
  lastRep: 'Rep',
  lastCampaign: 'Campaign',
  lastSubcampaign: 'Subcampaign',
  lastCallerId: 'Caller ID',
  lastImportDate: 'Import Date',
  lastCallStatus: 'Call Status',
  lastCallType: 'Call Type',
  lastCallDuration: 'Duration',
  lastHoldTime: 'HoldTime',
  lastHangup: 'Hangup',
  lastHangupSource: 'Hangup Source',
  lastCallDetails: 'Details',
  lastRecordingUrl: 'Recording',
  lastAttemptNumber: 'Attempt',
  currentlyCallable: 'Is Callable',
};

/**
 * Build a contact patch from a Call Log row.
 * @param row Call Log row
 * @param opts.isNewContact when true, includes native fields and "First *" customs
 */
export function buildContactPatch(row, { isNewContact }) {
  const v = (k) => (row[k] ?? '').toString().trim();

  const native = isNewContact ? {
    firstName: v('First'),
    lastName: v('Last'),
    phone: v('Phone'),
    state: v('State'),
    country: v('Country'),
    source: v('Inbound Source'),
  } : {};

  const customFields = {};

  if (isNewContact) {
    for (const [internalName] of FIRST_FIELDS) {
      customFields[internalName] = v(FIRST_SOURCE_COLUMNS[internalName]);
    }
  }

  for (const [internalName] of LAST_FIELDS) {
    customFields[internalName] = v(LAST_SOURCE_COLUMNS[internalName]);
  }

  // Tags
  const tags = [];
  const campaign = v('Campaign');
  const state = v('State');
  const isCallable = v('Is Callable').toLowerCase() === 'yes' || v('Is Callable').toLowerCase() === 'true';
  if (campaign) tags.push(`publisher:${campaign}`);
  if (state) tags.push(`state:${state}`);
  tags.push(isCallable ? 'callable:yes' : 'callable:no');

  const callableNegationTag = isCallable ? 'callable:no' : 'callable:yes';

  return { native, customFields, tags, callableNegationTag };
}
```

- [ ] **Step 3: Verify**

```bash
node --input-type=module -e "
import('./src/lib/ghl/field-mapping.js').then(({ buildContactPatch, ALL_CUSTOM_FIELDS }) => {
  if (ALL_CUSTOM_FIELDS.length !== 28) { console.error('FAIL: expected 28 custom fields, got', ALL_CUSTOM_FIELDS.length); process.exit(1); }
  const row = { 'First': 'John', 'Last': 'Smith', 'Phone': '555', 'State': 'CA', 'Country': 'US', 'Inbound Source': 'BCL', 'Lead Id': 'L1', 'Client ID': 'C1', 'Date': 'D', 'Campaign': 'BCL', 'Subcampaign': 'X', 'Caller ID': 'CID', 'Import Date': 'I', 'Rep': 'R', 'Call Status': 'Answered', 'Call Type': 'Inbound', 'Duration': '47', 'HoldTime': '8', 'Hangup': 'Caller', 'Hangup Source': 'SIP', 'Details': 'D', 'Recording': 'R', 'Attempt': '1', 'Is Callable': 'Yes' };
  const newP = buildContactPatch(row, { isNewContact: true });
  const exP = buildContactPatch(row, { isNewContact: false });
  if (newP.native.firstName !== 'John') { console.error('FAIL native firstName'); process.exit(1); }
  if (Object.keys(exP.native).length !== 0) { console.error('FAIL existing should not include native'); process.exit(1); }
  if (newP.customFields.firstLeadId !== 'L1') { console.error('FAIL firstLeadId'); process.exit(1); }
  if (exP.customFields.firstLeadId !== undefined) { console.error('FAIL existing should not include firstX'); process.exit(1); }
  if (exP.customFields.lastCallStatus !== 'Answered') { console.error('FAIL lastCallStatus'); process.exit(1); }
  if (!newP.tags.includes('publisher:BCL')) { console.error('FAIL publisher tag'); process.exit(1); }
  if (!newP.tags.includes('state:CA')) { console.error('FAIL state tag'); process.exit(1); }
  if (!newP.tags.includes('callable:yes')) { console.error('FAIL callable tag'); process.exit(1); }
  if (newP.callableNegationTag !== 'callable:no') { console.error('FAIL negation'); process.exit(1); }
  console.log('field-mapping OK');
});
"
```

Expected: `field-mapping OK`

- [ ] **Step 4: Commit**

```bash
git add src/lib/ghl/field-mapping.js
git commit -m "feat(ghl-sync): add field mapping (Call Log row → GHL patch)"
```

---

### Task 6: Tiered matcher (T1 phone / T2 fuzzy / T3 new)

**Files:**
- Create: `src/lib/ghl/matcher.js`

- [ ] **Step 1: Define expected behavior**

`matchContact(row, deps)` where `deps = { searchByPhone, searchByNameAndState }` returns:

- `{ tier: 1, contact }` — phone exact match
- `{ tier: 2, contact }` — name+state fuzzy match (Levenshtein ≤1 on first AND last, exact state)
- `{ tier: 3, contact: null }` — no match

Both `searchByPhone(phone)` and `searchByNameAndState(first, last, state)` are async functions injected as deps; they return either a contact object `{ id, firstName, lastName, phone, state, ... }` or `null`. Matcher itself is pure logic over those callbacks — easy to test with stubs.

`searchByNameAndState` returns *the best fuzzy match meeting the threshold*, not all candidates. Caller (client.js) does the candidate filtering using `levenshtein()`.

- [ ] **Step 2: Implement**

```javascript
// src/lib/ghl/matcher.js
/**
 * Tiered matching ladder. Returns { tier: 1|2|3, contact: object|null }.
 * @param row Call Log row
 * @param deps.searchByPhone async fn(phone) -> contact|null
 * @param deps.searchByNameAndState async fn(first, last, state) -> contact|null
 */
export async function matchContact(row, { searchByPhone, searchByNameAndState }) {
  const phone = (row['Phone'] ?? '').trim();
  const first = (row['First'] ?? '').trim();
  const last  = (row['Last']  ?? '').trim();
  const state = (row['State'] ?? '').trim();

  if (phone) {
    const t1 = await searchByPhone(phone);
    if (t1) return { tier: 1, contact: t1 };
  }

  if (first && last && state) {
    const t2 = await searchByNameAndState(first, last, state);
    if (t2) return { tier: 2, contact: t2 };
  }

  return { tier: 3, contact: null };
}
```

- [ ] **Step 3: Verify**

```bash
node --input-type=module -e "
import('./src/lib/ghl/matcher.js').then(async ({ matchContact }) => {
  const row = { 'Phone': '555-1', 'First': 'John', 'Last': 'Smith', 'State': 'CA' };
  const t1 = await matchContact(row, {
    searchByPhone: async () => ({ id: 'X' }),
    searchByNameAndState: async () => null,
  });
  if (t1.tier !== 1 || t1.contact.id !== 'X') { console.error('FAIL T1'); process.exit(1); }

  const t2 = await matchContact(row, {
    searchByPhone: async () => null,
    searchByNameAndState: async () => ({ id: 'Y' }),
  });
  if (t2.tier !== 2 || t2.contact.id !== 'Y') { console.error('FAIL T2'); process.exit(1); }

  const t3 = await matchContact(row, {
    searchByPhone: async () => null,
    searchByNameAndState: async () => null,
  });
  if (t3.tier !== 3 || t3.contact !== null) { console.error('FAIL T3'); process.exit(1); }

  // No phone and no name → tier 3
  const noKeys = await matchContact({ 'Phone': '', 'First': '', 'Last': '', 'State': '' }, {
    searchByPhone: async () => { throw new Error('should not be called'); },
    searchByNameAndState: async () => { throw new Error('should not be called'); },
  });
  if (noKeys.tier !== 3) { console.error('FAIL no-keys'); process.exit(1); }

  console.log('matcher OK');
});
"
```

Expected: `matcher OK`

- [ ] **Step 4: Commit**

```bash
git add src/lib/ghl/matcher.js
git commit -m "feat(ghl-sync): add tiered matching ladder (phone / name+state / new)"
```

---

## Phase 2 — GHL Client (REST API wrapper)

### Task 7: GHL client — base fetch wrapper with auth, retry, rate limit

**Files:**
- Create: `src/lib/ghl/client.js`

- [ ] **Step 1: Define expected behavior**

A class or factory function `createGhlClient({ token, locationId, dryRun })` that exposes:

- `request(method, path, body?)` — internal: adds auth headers, handles 429/5xx retry with exponential backoff (1s/2s/4s, max 3 retries), inserts 50ms delay between successful calls (rate-limit defensiveness)
- Higher-level methods will be added in subsequent tasks

In `dryRun` mode, *write* methods (POST/PUT/DELETE) skip the HTTP call and return a synthetic `{ dryRun: true }` response. *Read* methods (GET) still execute (we need real lookup results to compute the right action).

GHL API base: `https://services.leadconnectorhq.com`
Required headers: `Authorization: Bearer <token>`, `Version: 2021-07-28`, `Content-Type: application/json`, `Accept: application/json`

- [ ] **Step 2: Implement (initial scaffold)**

```javascript
// src/lib/ghl/client.js
const GHL_BASE = 'https://services.leadconnectorhq.com';
const VERSION = '2021-07-28';
const INTER_CALL_DELAY_MS = 50;
const MAX_RETRIES = 3;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function createGhlClient({ token, locationId, dryRun = false }) {
  if (!token) throw new Error('GHL client: token is required');
  if (!locationId) throw new Error('GHL client: locationId is required');

  let lastCallAt = 0;

  async function rateLimit() {
    const since = Date.now() - lastCallAt;
    if (since < INTER_CALL_DELAY_MS) await sleep(INTER_CALL_DELAY_MS - since);
    lastCallAt = Date.now();
  }

  async function request(method, path, body) {
    const isWrite = method !== 'GET';
    if (dryRun && isWrite) {
      return { dryRun: true, method, path, body };
    }

    let lastErr;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await rateLimit();
      const url = path.startsWith('http') ? path : `${GHL_BASE}${path}`;
      const res = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Version': VERSION,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`GHL ${method} ${path} → ${res.status}`);
        if (attempt < MAX_RETRIES) {
          await sleep(1000 * Math.pow(2, attempt)); // 1s, 2s, 4s
          continue;
        }
        throw lastErr;
      }

      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (res.status >= 400) {
        const err = new Error(`GHL ${method} ${path} → ${res.status}: ${text}`);
        err.status = res.status;
        err.body = data;
        throw err;
      }
      return data;
    }
    throw lastErr;
  }

  return {
    request,
    locationId,
    dryRun,
    // methods added in subsequent tasks
  };
}
```

- [ ] **Step 3: Verify (dry-run path only — no live GHL call yet)**

```bash
node --input-type=module -e "
import('./src/lib/ghl/client.js').then(async ({ createGhlClient }) => {
  const c = createGhlClient({ token: 't', locationId: 'L', dryRun: true });
  const r = await c.request('POST', '/contacts/', { foo: 1 });
  if (!r.dryRun) { console.error('FAIL dryRun'); process.exit(1); }
  try {
    createGhlClient({ token: '', locationId: 'L' });
    console.error('FAIL should have thrown'); process.exit(1);
  } catch (e) {
    if (!e.message.includes('token')) { console.error('FAIL wrong error'); process.exit(1); }
  }
  console.log('client scaffold OK');
});
"
```

Expected: `client scaffold OK`

- [ ] **Step 4: Commit**

```bash
git add src/lib/ghl/client.js
git commit -m "feat(ghl-sync): add GHL client scaffold (auth, retry, rate limit, dry-run)"
```

---

### Task 8: GHL client — custom field name → ID resolver

**Files:**
- Modify: `src/lib/ghl/client.js`

- [ ] **Step 1: Define expected behavior**

Add `client.resolveCustomFields()` — fetches all custom fields from GHL once, builds an internal Map of `display name → field ID`, caches the result on the client instance. Subsequent `getCustomFieldId(internalName)` calls look up via `ALL_CUSTOM_FIELDS` (display name) → cached ID. Throws if any expected field is not yet created in GHL — operator must run the bootstrap script first (Task 24).

GHL endpoint: `GET /locations/{locationId}/customFields`
Response shape (per GHL docs): `{ customFields: [{ id, name, fieldKey, dataType, ... }, ...] }`

- [ ] **Step 2: Implement (extend client.js)**

Add to the returned object in `client.js`:

```javascript
// Add inside createGhlClient, after `let lastCallAt = 0;`:
let customFieldCache = null; // Map<displayName, fieldId>

async function resolveCustomFields() {
  if (customFieldCache) return customFieldCache;
  const data = await request('GET', `/locations/${locationId}/customFields`);
  const list = data.customFields ?? [];
  customFieldCache = new Map(list.map(f => [f.name, f.id]));
  return customFieldCache;
}

function getCustomFieldId(internalName, allFields) {
  // allFields is ALL_CUSTOM_FIELDS from field-mapping.js
  const entry = allFields.find(([k]) => k === internalName);
  if (!entry) throw new Error(`Unknown internal field name: ${internalName}`);
  const displayName = entry[1];
  if (!customFieldCache) throw new Error('Call resolveCustomFields() before getCustomFieldId()');
  const id = customFieldCache.get(displayName);
  if (!id) throw new Error(`GHL custom field "${displayName}" not found — run scripts/ghl-bootstrap-fields.js`);
  return id;
}
```

And add `resolveCustomFields, getCustomFieldId` to the returned object.

- [ ] **Step 3: Verify (live, requires GHL_API_TOKEN + GHL_LOCATION_ID set)**

```bash
node --input-type=module -e "
import('dotenv/config').catch(()=>{});
import('./src/lib/ghl/client.js').then(async ({ createGhlClient }) => {
  if (!process.env.GHL_API_TOKEN || !process.env.GHL_LOCATION_ID) {
    console.log('SKIP — set GHL_API_TOKEN and GHL_LOCATION_ID first'); return;
  }
  const c = createGhlClient({ token: process.env.GHL_API_TOKEN, locationId: process.env.GHL_LOCATION_ID });
  const map = await c.resolveCustomFields();
  console.log('Found', map.size, 'custom fields in GHL');
});
" 2>&1 | tail -3
```

Note: `dotenv` is not in package.json — set env vars inline if needed: `GHL_API_TOKEN=... GHL_LOCATION_ID=... node ...`. Expected output: count of fields (will be 0 before bootstrap script runs in Task 24).

- [ ] **Step 4: Commit**

```bash
git add src/lib/ghl/client.js
git commit -m "feat(ghl-sync): add custom field resolver to GHL client"
```

---

### Task 9: GHL client — search by phone

**Files:**
- Modify: `src/lib/ghl/client.js`

- [ ] **Step 1: Define expected behavior**

`client.searchByPhone(phone)` returns the first matching contact `{ id, firstName, lastName, phone, additionalPhones, state, ... }` or `null`.

GHL endpoint: `GET /contacts/?locationId={id}&query={phone}` — returns `{ contacts: [...] }`. Phone search may match in `phone` or `additionalPhones`. Normalize phone (strip non-digits) before comparison to avoid format mismatches.

- [ ] **Step 2: Implement (extend client.js)**

```javascript
function normalizePhone(p) {
  return (p ?? '').toString().replace(/\D/g, '');
}

async function searchByPhone(phone) {
  const target = normalizePhone(phone);
  if (!target) return null;
  const data = await request('GET', `/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(phone)}`);
  const contacts = data.contacts ?? [];
  for (const c of contacts) {
    const candidates = [c.phone, ...(c.additionalPhones ?? [])].map(normalizePhone);
    if (candidates.includes(target)) return c;
  }
  return null;
}
```

Add `searchByPhone, normalizePhone` to the returned object.

- [ ] **Step 3: Verify (manual, against GHL test sub-account if available)**

Create one test contact in GHL with phone `5551234567`. Then:

```bash
GHL_API_TOKEN=... GHL_LOCATION_ID=... node --input-type=module -e "
import('./src/lib/ghl/client.js').then(async ({ createGhlClient }) => {
  const c = createGhlClient({ token: process.env.GHL_API_TOKEN, locationId: process.env.GHL_LOCATION_ID });
  const hit = await c.searchByPhone('(555) 123-4567');
  console.log('hit:', hit ? hit.id : null);
  const miss = await c.searchByPhone('5550000000');
  console.log('miss:', miss);
});
"
```

Expected: `hit: <some-id>`, `miss: null`. (Skip if no test contact exists; flag for later smoke test.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/ghl/client.js
git commit -m "feat(ghl-sync): add searchByPhone (Tier 1 match)"
```

---

### Task 10: GHL client — search by name and state (Tier 2)

**Files:**
- Modify: `src/lib/ghl/client.js`

- [ ] **Step 1: Define expected behavior**

`client.searchByNameAndState(firstName, lastName, state)` returns a contact if a candidate is found where:
- `levenshtein(firstName, candidate.firstName) ≤ 1`
- `levenshtein(lastName, candidate.lastName) ≤ 1`
- `candidate.state === state` (exact, case-insensitive)

Returns `null` otherwise. If multiple match, return the first (deterministic).

GHL endpoint: `GET /contacts/?locationId={id}&query={firstName lastName}` — returns up to ~20 results. We filter client-side using levenshtein.

- [ ] **Step 2: Implement (extend client.js)**

Add `import { levenshtein } from './levenshtein.js';` at the top of the file.

```javascript
async function searchByNameAndState(firstName, lastName, state) {
  if (!firstName || !lastName || !state) return null;
  const query = `${firstName} ${lastName}`;
  const data = await request('GET', `/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(query)}`);
  const contacts = data.contacts ?? [];
  const targetState = state.toLowerCase();
  for (const c of contacts) {
    const cState = (c.state ?? '').toLowerCase();
    if (cState !== targetState) continue;
    if (levenshtein(c.firstName ?? '', firstName) > 1) continue;
    if (levenshtein(c.lastName  ?? '', lastName)  > 1) continue;
    return c;
  }
  return null;
}
```

Add `searchByNameAndState` to the returned object.

- [ ] **Step 3: Verify**

Manual smoke test against test sub-account: create contact "John Smith / CA / 5551111111". Then:

```bash
GHL_API_TOKEN=... GHL_LOCATION_ID=... node --input-type=module -e "
import('./src/lib/ghl/client.js').then(async ({ createGhlClient }) => {
  const c = createGhlClient({ token: process.env.GHL_API_TOKEN, locationId: process.env.GHL_LOCATION_ID });
  const fuzzy = await c.searchByNameAndState('Jon', 'Smith', 'CA');  // edit-distance 1 on first
  console.log('fuzzy:', fuzzy ? fuzzy.id : null);
  const wrongState = await c.searchByNameAndState('John', 'Smith', 'TX');
  console.log('wrong state:', wrongState);
});
"
```

Expected: `fuzzy: <id>`, `wrong state: null`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ghl/client.js
git commit -m "feat(ghl-sync): add searchByNameAndState (Tier 2 fuzzy match)"
```

---

### Task 11: GHL client — create / update contact

**Files:**
- Modify: `src/lib/ghl/client.js`

- [ ] **Step 1: Define expected behavior**

Add three methods:

1. `createContact({ native, customFields, tags }, allCustomFieldsList)` — POST `/contacts/`. Resolves custom field internal names to GHL IDs via `getCustomFieldId`. Returns the new contact `{ id, ... }`. Sets `locationId`. In dry-run, returns `{ dryRun: true, id: 'dry-run-id' }`.

2. `updateContact(contactId, { customFields, tags, removeTag, additionalPhone, incrementTotalAttempts }, allCustomFieldsList, currentContact)` — PUT `/contacts/{id}`. `currentContact` is the contact returned from search (used to compute current `totalCallAttempts` and merge `additionalPhones`). Increments `totalCallAttempts` by 1. Adds new tags via union with existing, removes `removeTag` if present. If `additionalPhone` is given and isn't already the primary or in additionalPhones (after normalize), append to additionalPhones.

3. `addNote(contactId, body)` — POST `/contacts/{contactId}/notes` with `{ body, contactId }` payload.

GHL request body shapes (from LeadConnector v2 docs):
- Create: `{ locationId, firstName, lastName, phone, state, country, source, customFields: [{ id, value }], tags: [...] }`
- Update: `{ firstName, lastName, customFields: [{ id, value }], tags: [...], additionalPhones: [...] }`
- Note:   `{ body, contactId }` (POST to `/contacts/{contactId}/notes`)

GHL note: tags on update *replace* the list. To add without losing existing tags, fetch current tags from `currentContact.tags` and union.

- [ ] **Step 2: Implement (extend client.js)**

Add `import { ALL_CUSTOM_FIELDS } from './field-mapping.js';` (so callers don't need to pass it):

```javascript
function buildCustomFieldsArray(customFieldsObj) {
  // { internalName: value, ... } → [{ id, value }, ...]
  const out = [];
  for (const [internalName, value] of Object.entries(customFieldsObj ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    const id = getCustomFieldId(internalName, ALL_CUSTOM_FIELDS);
    out.push({ id, value });
  }
  return out;
}

async function createContact({ native, customFields, tags }) {
  const body = {
    locationId,
    ...native,
    customFields: buildCustomFieldsArray(customFields),
    tags: tags ?? [],
  };
  const data = await request('POST', '/contacts/', body);
  if (data.dryRun) return { id: `dry-run-${Date.now()}`, dryRun: true };
  return data.contact ?? data;
}

async function updateContact(contactId, patch, currentContact) {
  const { customFields = {}, tags = [], removeTag, additionalPhone } = patch;

  // Tags: union with existing, then remove the negation tag if present
  const existingTags = new Set(currentContact?.tags ?? []);
  for (const t of tags) existingTags.add(t);
  if (removeTag) existingTags.delete(removeTag);

  // Additional phones: append if not already present (normalized comparison)
  let additionalPhones = currentContact?.additionalPhones ?? [];
  if (additionalPhone) {
    const target = normalizePhone(additionalPhone);
    const primary = normalizePhone(currentContact?.phone ?? '');
    const have = additionalPhones.map(normalizePhone);
    if (target && target !== primary && !have.includes(target)) {
      additionalPhones = [...additionalPhones, additionalPhone];
    }
  }

  // totalCallAttempts: read existing from currentContact.customFields, increment
  let totalAttempts = 1;
  const existingCf = currentContact?.customFields ?? [];
  await resolveCustomFields(); // ensure cache
  const totalAttemptsId = getCustomFieldId('totalCallAttempts', ALL_CUSTOM_FIELDS);
  const existingTotal = existingCf.find(cf => cf.id === totalAttemptsId);
  if (existingTotal && !isNaN(parseInt(existingTotal.value))) {
    totalAttempts = parseInt(existingTotal.value) + 1;
  }
  customFields.totalCallAttempts = String(totalAttempts);

  const body = {
    customFields: buildCustomFieldsArray(customFields),
    tags: [...existingTags],
    additionalPhones,
  };

  const data = await request('PUT', `/contacts/${contactId}`, body);
  if (data.dryRun) return { id: contactId, dryRun: true };
  return data.contact ?? data;
}

async function addNote(contactId, body) {
  const data = await request('POST', `/contacts/${contactId}/notes`, { body, contactId });
  return data;
}
```

Add `createContact, updateContact, addNote` to the returned object.

- [ ] **Step 3: Verify (manual smoke test)**

```bash
GHL_API_TOKEN=... GHL_LOCATION_ID=... node --input-type=module -e "
import('./src/lib/ghl/client.js').then(async ({ createGhlClient }) => {
  const c = createGhlClient({ token: process.env.GHL_API_TOKEN, locationId: process.env.GHL_LOCATION_ID, dryRun: true });
  await c.resolveCustomFields().catch(() => {});  // ok if 0 fields exist yet
  const created = await c.createContact({ native: { firstName: 'Test', lastName: 'Dryrun', phone: '5550000', state: 'CA', country: 'US', source: 'Test' }, customFields: {}, tags: ['test'] });
  console.log('dry-run create:', created);
});
"
```

Expected: `{ id: 'dry-run-...', dryRun: true }`.

Live test will happen in Task 24+ after bootstrap script creates the custom fields.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ghl/client.js
git commit -m "feat(ghl-sync): add createContact, updateContact, addNote"
```

---

## Phase 3 — Sheet State I/O

### Task 12: Init the three new tabs in the Goals sheet

**Files:**
- Create: `scripts/ghl-init-tabs.js`

- [ ] **Step 1: Define expected behavior**

A standalone Node script (`node scripts/ghl-init-tabs.js`) that ensures three tabs exist in `GOALS_SHEET_ID`:

1. `GHL Sync Log` — headers per spec §7.1: `Timestamp, Row Hash, Lead Id, Phone, First, Last, State, Tier, Action, GHL Contact ID, Error, High Water Mark` (last column holds the watermark in row 2 only)
2. `GHL Possible Merges` — headers per spec §7.2: `Timestamp, Existing GHL Contact ID, Existing Name, Existing Phone, New GHL Contact ID, New Name, New Phone, State, Reviewed`
3. `GHL Excluded Campaigns` — headers per spec §7.3: `Campaign, Subcampaign, Reason, Added Date`

If a tab already exists, skip. If headers are missing/wrong, prompt operator to fix manually (don't auto-overwrite — destructive).

- [ ] **Step 2: Implement**

```javascript
// scripts/ghl-init-tabs.js
// Run: node scripts/ghl-init-tabs.js
// Requires: GOALS_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_KEY in env.
import 'dotenv/config'; // optional; falls through if not installed
import { getSheetsClient } from '../src/lib/sheets.js';

const TABS = {
  'GHL Sync Log': ['Timestamp', 'Row Hash', 'Lead Id', 'Phone', 'First', 'Last', 'State', 'Tier', 'Action', 'GHL Contact ID', 'Error', 'High Water Mark'],
  'GHL Possible Merges': ['Timestamp', 'Existing GHL Contact ID', 'Existing Name', 'Existing Phone', 'New GHL Contact ID', 'New Name', 'New Phone', 'State', 'Reviewed'],
  'GHL Excluded Campaigns': ['Campaign', 'Subcampaign', 'Reason', 'Added Date'],
};

async function main() {
  const sheetId = process.env.GOALS_SHEET_ID;
  if (!sheetId) throw new Error('GOALS_SHEET_ID not set');
  const sheets = await getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const existingTabs = new Set(meta.data.sheets.map(s => s.properties.title));

  const requests = [];
  for (const tabName of Object.keys(TABS)) {
    if (existingTabs.has(tabName)) {
      console.log(`✓ exists: ${tabName}`);
      continue;
    }
    requests.push({ addSheet: { properties: { title: tabName } } });
  }

  if (requests.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests },
    });
    console.log(`Created ${requests.length} new tab(s)`);
  }

  // Write headers for any tab whose first row is empty
  for (const [tabName, headers] of Object.entries(TABS)) {
    const r = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${tabName}!A1:Z1` });
    const existingHeaders = (r.data.values?.[0] ?? []).filter(Boolean);
    if (existingHeaders.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `${tabName}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [headers] },
      });
      console.log(`✓ wrote headers: ${tabName}`);
    } else if (existingHeaders.length !== headers.length || existingHeaders.some((h, i) => h !== headers[i])) {
      console.warn(`⚠ headers differ on ${tabName} — manual review needed. Expected:`, headers, 'Found:', existingHeaders);
    }
  }
  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Verify**

```bash
node scripts/ghl-init-tabs.js
```

Expected output: 3 lines of "Created" or "exists" + 3 lines of "wrote headers" or "exists" + "Done." Manually verify in the Goals sheet that the three tabs are present with correct headers.

- [ ] **Step 4: Commit**

```bash
git add scripts/ghl-init-tabs.js
git commit -m "feat(ghl-sync): add one-time script to init Sync Log / Possible Merges / Excluded Campaigns tabs"
```

---

### Task 13: Sheet state — read excluded campaigns and synced hashes

**Files:**
- Create: `src/lib/ghl/sheet-state.js`

- [ ] **Step 1: Define expected behavior**

Module exports:

- `readExcludedCampaigns()` → `[{ Campaign, Subcampaign, Reason, AddedDate }, ...]` (reads "GHL Excluded Campaigns" tab)
- `readSyncedHashes()` → `Set<string>` of all `Row Hash` values in "GHL Sync Log"
- `readWatermark()` → string (the high-water-mark `Import Date`) or empty string if none yet
- `writeWatermark(value)` → updates row 2 col `High Water Mark` of "GHL Sync Log"
- `appendSyncLog(entry)` → appends one row to "GHL Sync Log"
- `appendPossibleMerge(entry)` → appends one row to "GHL Possible Merges"
- `readNewCallLogRows(watermark)` → reads `CALLLOGS_SHEET_ID/Report` and returns rows where `Import Date > watermark` (string compare on ISO-formatted dates; treat empty watermark as "all rows")

- [ ] **Step 2: Implement**

```javascript
// src/lib/ghl/sheet-state.js
import { readRawSheet, appendRow, getSheetsClient } from '../sheets.js';

const GOALS_SHEET = () => process.env.GOALS_SHEET_ID;
const CALLLOGS_SHEET = () => process.env.CALLLOGS_SHEET_ID;
const CALLLOGS_TAB = () => process.env.CALLLOGS_TAB_NAME || 'Report';

const SYNC_LOG_TAB = 'GHL Sync Log';
const POSSIBLE_MERGES_TAB = 'GHL Possible Merges';
const EXCLUDED_TAB = 'GHL Excluded Campaigns';

const SYNC_LOG_HEADERS = ['Timestamp', 'Row Hash', 'Lead Id', 'Phone', 'First', 'Last', 'State', 'Tier', 'Action', 'GHL Contact ID', 'Error', 'High Water Mark'];
const POSSIBLE_MERGES_HEADERS = ['Timestamp', 'Existing GHL Contact ID', 'Existing Name', 'Existing Phone', 'New GHL Contact ID', 'New Name', 'New Phone', 'State', 'Reviewed'];

export async function readExcludedCampaigns() {
  const { data } = await readRawSheet(GOALS_SHEET(), EXCLUDED_TAB);
  return data;
}

export async function readSyncedHashes() {
  const { data } = await readRawSheet(GOALS_SHEET(), SYNC_LOG_TAB);
  return new Set(data.map(r => r['Row Hash']).filter(Boolean));
}

export async function readWatermark() {
  const sheets = await getSheetsClient();
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: GOALS_SHEET(),
    range: `${SYNC_LOG_TAB}!L2:L2`, // column L = "High Water Mark"
  });
  return r.data.values?.[0]?.[0] ?? '';
}

export async function writeWatermark(value) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: GOALS_SHEET(),
    range: `${SYNC_LOG_TAB}!L2`,
    valueInputOption: 'RAW',
    requestBody: { values: [[value]] },
  });
}

export async function appendSyncLog(entry) {
  await appendRow(GOALS_SHEET(), SYNC_LOG_TAB, SYNC_LOG_HEADERS, entry);
}

export async function appendPossibleMerge(entry) {
  await appendRow(GOALS_SHEET(), POSSIBLE_MERGES_TAB, POSSIBLE_MERGES_HEADERS, entry);
}

export async function readNewCallLogRows(watermark) {
  const { data } = await readRawSheet(CALLLOGS_SHEET(), CALLLOGS_TAB());
  if (!watermark) return data;
  return data.filter(r => (r['Import Date'] ?? '') > watermark);
}
```

- [ ] **Step 3: Verify**

Requires the tabs from Task 12 to exist. With env vars set:

```bash
GOALS_SHEET_ID=... CALLLOGS_SHEET_ID=... GOOGLE_SERVICE_ACCOUNT_KEY='...' node --input-type=module -e "
import('./src/lib/ghl/sheet-state.js').then(async (m) => {
  console.log('excluded:', (await m.readExcludedCampaigns()).length, 'rows');
  console.log('synced hashes:', (await m.readSyncedHashes()).size);
  console.log('watermark:', JSON.stringify(await m.readWatermark()));
  await m.writeWatermark('2026-04-25T00:00:00Z');
  console.log('after write:', JSON.stringify(await m.readWatermark()));
  await m.writeWatermark(''); // reset
  const rows = await m.readNewCallLogRows('');
  console.log('call log rows total:', rows.length);
});
"
```

Expected: counts and watermark round-trip correctly.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ghl/sheet-state.js
git commit -m "feat(ghl-sync): add sheet-state helpers (read/write Sync Log, Possible Merges, watermark)"
```

---

## Phase 4 — Orchestration

### Task 14: processSingleRow — the per-row pipeline

**Files:**
- Create: `src/lib/ghl/sync.js`

- [ ] **Step 1: Define expected behavior**

`processSingleRow(row, deps)` runs filter → match → write → log for one Call Log row.

`deps = { client, excludedCampaigns, syncedHashes, dryRun }`. Returns `{ tier, action, contactId, error }` and writes one row to the Sync Log via `deps.appendSyncLog`.

Action values:
- `'created'` — Tier 3, new GHL contact created
- `'attached'` — Tier 1, activity added to existing
- `'created+possible-merge'` — Tier 2, new contact created and a row written to Possible Merges
- `'skipped:missing_phone'` / `'skipped:excluded_campaign'` / `'skipped:already_synced'`
- `'error'` — exception thrown; `error` field populated

- [ ] **Step 2: Implement**

```javascript
// src/lib/ghl/sync.js
import { shouldProcessRow } from './filter.js';
import { matchContact } from './matcher.js';
import { buildContactPatch } from './field-mapping.js';
import { formatNote } from './note-formatter.js';
import { rowHash } from './row-hash.js';
import { appendSyncLog, appendPossibleMerge } from './sheet-state.js';

export async function processSingleRow(row, deps) {
  const { client, excludedCampaigns, syncedHashes } = deps;
  const hash = rowHash(row);
  const baseLogEntry = {
    'Timestamp': new Date().toISOString(),
    'Row Hash': hash,
    'Lead Id': row['Lead Id'] ?? '',
    'Phone': row['Phone'] ?? '',
    'First': row['First'] ?? '',
    'Last': row['Last'] ?? '',
    'State': row['State'] ?? '',
  };

  // 1. Filter
  const filterResult = shouldProcessRow(row, excludedCampaigns, syncedHashes);
  if (!filterResult.ok) {
    const action = `skipped:${filterResult.reason}`;
    await appendSyncLog({ ...baseLogEntry, 'Tier': '', 'Action': action, 'GHL Contact ID': '', 'Error': '' });
    return { tier: null, action, contactId: null, error: null };
  }

  try {
    // 2. Match
    const match = await matchContact(row, {
      searchByPhone: client.searchByPhone,
      searchByNameAndState: client.searchByNameAndState,
    });

    let contactId, action;
    const note = formatNote(row);

    if (match.tier === 1) {
      // Attach to existing
      const patch = buildContactPatch(row, { isNewContact: false });
      const updated = await client.updateContact(match.contact.id, {
        customFields: patch.customFields,
        tags: patch.tags,
        removeTag: patch.callableNegationTag,
        additionalPhone: row['Phone'],
      }, match.contact);
      await client.addNote(match.contact.id, note);
      contactId = updated.id;
      action = 'attached';

    } else if (match.tier === 2) {
      // Create new + flag for review
      const patch = buildContactPatch(row, { isNewContact: true });
      const created = await client.createContact(patch);
      await client.addNote(created.id, note);
      contactId = created.id;
      action = 'created+possible-merge';

      await appendPossibleMerge({
        'Timestamp': new Date().toISOString(),
        'Existing GHL Contact ID': match.contact.id,
        'Existing Name': `${match.contact.firstName ?? ''} ${match.contact.lastName ?? ''}`.trim(),
        'Existing Phone': match.contact.phone ?? '',
        'New GHL Contact ID': created.id,
        'New Name': `${row['First'] ?? ''} ${row['Last'] ?? ''}`.trim(),
        'New Phone': row['Phone'] ?? '',
        'State': row['State'] ?? '',
        'Reviewed': '',
      });

    } else {
      // Tier 3: net-new
      const patch = buildContactPatch(row, { isNewContact: true });
      const created = await client.createContact(patch);
      await client.addNote(created.id, note);
      contactId = created.id;
      action = 'created';
    }

    await appendSyncLog({ ...baseLogEntry, 'Tier': String(match.tier), 'Action': action, 'GHL Contact ID': contactId, 'Error': '' });
    return { tier: match.tier, action, contactId, error: null };

  } catch (err) {
    const errMsg = (err.message ?? String(err)).slice(0, 500);
    await appendSyncLog({ ...baseLogEntry, 'Tier': '', 'Action': 'error', 'GHL Contact ID': '', 'Error': errMsg });
    return { tier: null, action: 'error', contactId: null, error: errMsg };
  }
}
```

- [ ] **Step 3: Verify**

This task's verification is integrated with Task 15 (processBatch) — single-row execution will be exercised end-to-end there.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ghl/sync.js
git commit -m "feat(ghl-sync): add per-row sync pipeline (filter → match → write → log)"
```

---

### Task 15: processBatch — loop with continue-on-error and watermark advance

**Files:**
- Modify: `src/lib/ghl/sync.js`

- [ ] **Step 1: Define expected behavior**

`processBatch({ rows, client, dryRun })`:

1. Reads excluded campaigns and synced hashes from sheet-state once at the start
2. Iterates rows, calling `processSingleRow` for each
3. Tracks max `Import Date` seen among successfully-processed rows (excluding errors and skips? — include skips, since they're "decided" outcomes; exclude errors, so we retry next run)
4. On batch completion, if at least one non-error row was processed, advance the watermark to that max Import Date
5. Returns summary: `{ total, created, attached, possibleMerges, skipped, errors }`

Critical: a single bad row never aborts the loop. Catch per-row exceptions inside `processSingleRow` (already handled in Task 14).

- [ ] **Step 2: Implement (append to sync.js)**

```javascript
import { readExcludedCampaigns, readSyncedHashes, writeWatermark } from './sheet-state.js';

export async function processBatch({ rows, client, dryRun = false }) {
  const excludedCampaigns = await readExcludedCampaigns();
  const syncedHashes = await readSyncedHashes();

  const summary = { total: rows.length, created: 0, attached: 0, possibleMerges: 0, skipped: 0, errors: 0 };
  let maxImportDate = '';

  for (const row of rows) {
    const result = await processSingleRow(row, { client, excludedCampaigns, syncedHashes, dryRun });
    if (result.action === 'created') summary.created++;
    else if (result.action === 'attached') summary.attached++;
    else if (result.action === 'created+possible-merge') { summary.created++; summary.possibleMerges++; }
    else if (result.action.startsWith('skipped:')) summary.skipped++;
    else if (result.action === 'error') summary.errors++;

    // Track watermark on non-error outcomes
    if (result.action !== 'error') {
      const importDate = row['Import Date'] ?? '';
      if (importDate > maxImportDate) maxImportDate = importDate;
    }

    // Add this row's hash to in-memory set so a duplicate row inside the same batch
    // (rare but possible) is caught
    const { rowHash } = await import('./row-hash.js');
    syncedHashes.add(rowHash(row));
  }

  if (maxImportDate && !dryRun) {
    await writeWatermark(maxImportDate);
  }

  return summary;
}
```

- [ ] **Step 3: Verify (dry-run end-to-end with a stubbed client)**

```bash
node --input-type=module -e "
import('./src/lib/ghl/sync.js').then(async ({ processBatch }) => {
  const stubClient = {
    searchByPhone: async () => null,
    searchByNameAndState: async () => null,
    createContact: async () => ({ id: 'STUB-CREATED-' + Math.random(), dryRun: true }),
    updateContact: async (id) => ({ id, dryRun: true }),
    addNote: async () => ({ dryRun: true }),
  };
  // CAUTION: this writes to the real Sync Log sheet. Only run after Task 12 completes.
  // Skipping the full end-to-end here — see Task 17 for full smoke test.
  console.log('processBatch wired up — full smoke test deferred to dry-run rollout');
});
"
```

(Live verification happens in Task 17 / rollout.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/ghl/sync.js
git commit -m "feat(ghl-sync): add batch processing with continue-on-error + watermark advance"
```

---

## Phase 5 — API Routes

### Task 16: /api/cron/ghl-sync route

**Files:**
- Create: `src/app/api/cron/ghl-sync/route.js`

- [ ] **Step 1: Define expected behavior**

`GET /api/cron/ghl-sync`:

1. Verify `Authorization: Bearer <CRON_SECRET>` header (or `?secret=` query param fallback). If `CRON_SECRET` is not set, allow (matches existing pattern in this repo). Else require match.
2. If `GHL_SYNC_ENABLED !== 'true'`, return `{ skipped: 'kill switch' }` 200.
3. If `GHL_API_TOKEN` or `GHL_LOCATION_ID` is missing, return 500 with clear error.
4. Read watermark, then read new Call Log rows since watermark.
5. Build the GHL client (with dry-run flag from `GHL_SYNC_DRY_RUN`).
6. Resolve custom fields once (warms cache, fails fast if bootstrap not run).
7. Call `processBatch`. Return summary as JSON.

- [ ] **Step 2: Implement**

```javascript
// src/app/api/cron/ghl-sync/route.js
import { NextResponse } from 'next/server';
import { createGhlClient } from '@/lib/ghl/client';
import { readWatermark, readNewCallLogRows } from '@/lib/ghl/sheet-state';
import { processBatch } from '@/lib/ghl/sync';

export const maxDuration = 60;

export async function GET(req) {
  // Auth gate
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

  // Kill switch
  if (process.env.GHL_SYNC_ENABLED !== 'true') {
    return NextResponse.json({ skipped: 'kill switch (GHL_SYNC_ENABLED != true)' });
  }

  const token = process.env.GHL_API_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!token || !locationId) {
    return NextResponse.json({ error: 'GHL_API_TOKEN and GHL_LOCATION_ID required' }, { status: 500 });
  }

  const dryRun = process.env.GHL_SYNC_DRY_RUN === 'true';

  try {
    const client = createGhlClient({ token, locationId, dryRun });
    await client.resolveCustomFields(); // fails fast if bootstrap not run

    const watermark = await readWatermark();
    const rows = await readNewCallLogRows(watermark);

    if (rows.length === 0) {
      return NextResponse.json({ ok: true, dryRun, watermark, summary: { total: 0 } });
    }

    const summary = await processBatch({ rows, client, dryRun });
    return NextResponse.json({ ok: true, dryRun, watermark, summary });
  } catch (err) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 3: Verify (local dev server)**

```bash
# Terminal 1
npm run dev

# Terminal 2 — kill switch should make this skip
curl -s "http://localhost:3000/api/cron/ghl-sync" | python3 -m json.tool
# Expected: { "skipped": "kill switch ..." }  (because GHL_SYNC_ENABLED defaults are not set or false)

# Set GHL_SYNC_ENABLED=true in .env.local, restart dev, retry — should error on missing custom fields if bootstrap not yet run
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/ghl-sync/route.js
git commit -m "feat(ghl-sync): add /api/cron/ghl-sync endpoint with auth + kill switch"
```

---

### Task 17: /api/ghl-backfill route (one-shot historical loader)

**Files:**
- Create: `src/app/api/ghl-backfill/route.js`

- [ ] **Step 1: Define expected behavior**

`GET /api/ghl-backfill?start=YYYY-MM-DD&end=YYYY-MM-DD`:

1. Same auth gate as cron (CRON_SECRET).
2. Same env-var requirements.
3. Reads ALL call log rows, filters in-memory to those whose `Date` falls in [start, end].
4. Calls `processBatch` — same idempotency guarantees apply (row-hash dedup prevents re-creation if you run twice).
5. Does NOT advance the watermark (backfill is a separate axis from cron). Pass `{ ...processBatch opts, advanceWatermark: false }` — for that, we need a small extension to processBatch.

- [ ] **Step 2: Extend processBatch with `advanceWatermark` flag**

In `src/lib/ghl/sync.js`, modify `processBatch` signature and watermark write:

```javascript
export async function processBatch({ rows, client, dryRun = false, advanceWatermark = true }) {
  // ... unchanged body ...

  if (maxImportDate && !dryRun && advanceWatermark) {
    await writeWatermark(maxImportDate);
  }

  return summary;
}
```

- [ ] **Step 3: Implement the route**

```javascript
// src/app/api/ghl-backfill/route.js
import { NextResponse } from 'next/server';
import { createGhlClient } from '@/lib/ghl/client';
import { readRawSheet } from '@/lib/sheets';
import { processBatch } from '@/lib/ghl/sync';

export const maxDuration = 60;

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

  const url = new URL(req.url);
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  if (!start || !end) return NextResponse.json({ error: 'start and end query params required (YYYY-MM-DD)' }, { status: 400 });

  if (process.env.GHL_SYNC_ENABLED !== 'true') {
    return NextResponse.json({ skipped: 'kill switch (GHL_SYNC_ENABLED != true)' });
  }
  const token = process.env.GHL_API_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!token || !locationId) {
    return NextResponse.json({ error: 'GHL_API_TOKEN and GHL_LOCATION_ID required' }, { status: 500 });
  }
  const dryRun = process.env.GHL_SYNC_DRY_RUN === 'true';

  try {
    const client = createGhlClient({ token, locationId, dryRun });
    await client.resolveCustomFields();

    const sheetId = process.env.CALLLOGS_SHEET_ID;
    const tab = process.env.CALLLOGS_TAB_NAME || 'Report';
    const { data } = await readRawSheet(sheetId, tab);
    const rows = data.filter(r => {
      const d = (r['Date'] ?? '').slice(0, 10);
      return d >= start && d <= end;
    });

    const summary = await processBatch({ rows, client, dryRun, advanceWatermark: false });
    return NextResponse.json({ ok: true, dryRun, range: { start, end }, summary });
  } catch (err) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 4: Verify**

```bash
# With dev server running, dry-run a small range:
curl -s "http://localhost:3000/api/ghl-backfill?start=2026-04-24&end=2026-04-25&secret=$CRON_SECRET" | python3 -m json.tool
```

Expected: `{ ok: true, dryRun: true, range: {...}, summary: { total: N, ... } }`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/ghl-backfill/route.js src/lib/ghl/sync.js
git commit -m "feat(ghl-sync): add /api/ghl-backfill for historical loading"
```

---

### Task 18: vercel.json — add cron schedule + maxDuration

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Define expected behavior**

Add `/api/cron/ghl-sync` cron entry (every 10 min) and `maxDuration: 60` for both new routes.

- [ ] **Step 2: Implement**

Edit `vercel.json` so `functions` includes:

```json
"src/app/api/cron/ghl-sync/route.js": { "maxDuration": 60 },
"src/app/api/ghl-backfill/route.js": { "maxDuration": 60 }
```

And `crons` array gets a new entry:

```json
{ "path": "/api/cron/ghl-sync", "schedule": "*/10 * * * *" }
```

- [ ] **Step 3: Verify**

```bash
node -e "console.log(JSON.parse(require('fs').readFileSync('vercel.json', 'utf8')))" | grep -E "ghl-sync|ghl-backfill"
```

Expected: 3 lines mentioning the new routes.

- [ ] **Step 4: Commit**

```bash
git add vercel.json
git commit -m "feat(ghl-sync): wire cron schedule + maxDuration in vercel.json"
```

---

## Phase 6 — Bootstrap & Documentation

### Task 19: Bootstrap script — create the 28 GHL custom fields

**Files:**
- Create: `scripts/ghl-bootstrap-fields.js`

- [ ] **Step 1: Define expected behavior**

A standalone Node script that ensures all 28 custom fields from `ALL_CUSTOM_FIELDS` exist in GHL. For each field:

- If a field with the same `name` already exists, skip
- Otherwise, create via `POST /locations/{locationId}/customFields` with `{ name, dataType: 'TEXT', model: 'contact', placeholder: '' }` (TEXT type works for everything; numeric fields can be migrated later if needed)

Idempotent — safe to run multiple times.

- [ ] **Step 2: Implement**

```javascript
// scripts/ghl-bootstrap-fields.js
// Run: GHL_API_TOKEN=... GHL_LOCATION_ID=... node scripts/ghl-bootstrap-fields.js
import { createGhlClient } from '../src/lib/ghl/client.js';
import { ALL_CUSTOM_FIELDS } from '../src/lib/ghl/field-mapping.js';

async function main() {
  const token = process.env.GHL_API_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!token || !locationId) throw new Error('GHL_API_TOKEN and GHL_LOCATION_ID required');

  const client = createGhlClient({ token, locationId });
  const existing = await client.resolveCustomFields(); // Map<name, id>
  console.log(`Found ${existing.size} existing custom fields in GHL.`);

  let created = 0, skipped = 0;
  for (const [internalName, displayName] of ALL_CUSTOM_FIELDS) {
    if (existing.has(displayName)) {
      console.log(`✓ exists: ${displayName}`);
      skipped++;
      continue;
    }
    const body = { name: displayName, dataType: 'TEXT', model: 'contact', placeholder: '' };
    await client.request('POST', `/locations/${locationId}/customFields`, body);
    console.log(`+ created: ${displayName}`);
    created++;
  }
  console.log(`Done. Created ${created}, skipped ${skipped}.`);
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Verify**

```bash
GHL_API_TOKEN=... GHL_LOCATION_ID=... node scripts/ghl-bootstrap-fields.js
```

Expected first run: `Created 28, skipped 0.` Second run: `Created 0, skipped 28.` Verify in GHL UI: Settings → Custom Fields.

- [ ] **Step 4: Commit**

```bash
git add scripts/ghl-bootstrap-fields.js
git commit -m "feat(ghl-sync): add one-time bootstrap script for 28 GHL custom fields"
```

---

### Task 20: Append GHL Sync section to CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Define expected behavior**

Append a new section to `CLAUDE.md` documenting the GHL Call Log Sync — same style as the existing "Recent Changes" sections. Include: env vars, cron schedule, the three new tabs, the kill switch, dry-run mode, the bootstrap commands, where to look when something breaks (Sync Log).

- [ ] **Step 2: Implement**

Open `CLAUDE.md` and append (after the last "Recent Changes" section):

```markdown
## Recent Changes (Apr 2026 — GHL)

### GoHighLevel Call Log Sync

One-way sync from `CALLLOGS_SHEET_ID` into GHL contacts. Sheets remains the source of truth; GHL is a downstream destination for workflow automation. See spec at `docs/superpowers/specs/2026-04-25-ghl-call-log-sync-design.md` and plan at `docs/superpowers/plans/2026-04-25-ghl-call-log-sync.md`.

**Env vars:**
- `GHL_API_TOKEN` — Private Integration Token from GHL Settings → Private Integrations
- `GHL_LOCATION_ID` — sub-account location ID
- `GHL_SYNC_ENABLED=true|false` — kill switch (default off-effect: skip)
- `GHL_SYNC_DRY_RUN=true|false` — log actions without writing to GHL

**Cron:** `/api/cron/ghl-sync` runs every 10 min (configured in `vercel.json`). Backfill via `GET /api/ghl-backfill?start=YYYY-MM-DD&end=YYYY-MM-DD` (gated by `CRON_SECRET`).

**Sheet tabs (in `GOALS_SHEET_ID`):**
- `GHL Sync Log` — every processed row, success or failure. Column L row 2 is the high-water mark.
- `GHL Possible Merges` — Tier 2 fuzzy matches needing manual review
- `GHL Excluded Campaigns` — campaign codes to skip

**Matching ladder (in code: `src/lib/ghl/matcher.js`):**
1. Phone exact → attach activity to existing contact
2. First+Last (Levenshtein ≤1 each) + State exact → create new contact + log to Possible Merges
3. No match → create new contact

**One-time setup commands:**
```bash
node scripts/ghl-init-tabs.js              # creates the 3 tabs in Goals sheet
GHL_API_TOKEN=... GHL_LOCATION_ID=... node scripts/ghl-bootstrap-fields.js  # creates 28 custom fields in GHL
```

**Debugging:** start at `GHL Sync Log` tab — every row's outcome is logged with action, contact ID, tier, and error message if any. Errored rows can be retried by deleting their Sync Log entry; the row-hash dedup prevents duplicates on success.
```

- [ ] **Step 3: Verify**

```bash
grep -c "GoHighLevel Call Log Sync" CLAUDE.md
```

Expected: `1`

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(ghl-sync): document GHL Call Log Sync in CLAUDE.md"
```

---

## Phase 7 — Rollout (manual, no code)

### Task 21: Rollout step 1 — bootstrap on test sub-account

- [ ] **Step 1:** Create or identify a "TCC Test" sub-location in GHL.
- [ ] **Step 2:** Generate a Private Integration Token for that test location with the scopes from spec §8.4. Update `.env.local`: `GHL_LOCATION_ID=<test-location-id>`.
- [ ] **Step 3:** Run `node scripts/ghl-init-tabs.js` (the Goals sheet tabs are shared regardless of location).
- [ ] **Step 4:** Run `GHL_API_TOKEN=... GHL_LOCATION_ID=<test> node scripts/ghl-bootstrap-fields.js`. Verify 28 fields appear in GHL test sub-account UI.

---

### Task 22: Rollout step 2 — dry run for 24h

- [ ] **Step 1:** Confirm `.env.local` has `GHL_SYNC_ENABLED=true` and `GHL_SYNC_DRY_RUN=true`.
- [ ] **Step 2:** Deploy to Vercel (production or preview): `vercel --prod` (or push to main if auto-deploy is wired). Set the same env vars in the Vercel dashboard.
- [ ] **Step 3:** Wait one full cron tick (10 min). Open `GHL Sync Log` tab — confirm new rows appear with `Action` values like `created` / `attached` / `skipped:*` and zero `error` entries.
- [ ] **Step 4:** Verify in GHL test sub-account UI: zero new contacts (because dry-run blocks writes).
- [ ] **Step 5:** Let it run 24 hours. Spot-check Sync Log periodically.

---

### Task 23: Rollout step 3 — go live on test sub-account

- [ ] **Step 1:** Set `GHL_SYNC_DRY_RUN=false` in Vercel + redeploy.
- [ ] **Step 2:** Wait 10 min. Verify in GHL test sub-account that contacts are appearing with correct names, phones, custom fields, tags, and notes.
- [ ] **Step 3:** Spot-check 5 contacts in GHL: open each, verify activity timeline has notes, verify First/Last custom fields are set, verify Last fields update on subsequent calls (will require waiting for a contact to receive a 2nd call).
- [ ] **Step 4:** Check `GHL Possible Merges` tab — if any rows, walk through them manually in GHL.
- [ ] **Step 5:** Let it run 24 hours.

---

### Task 24: Rollout step 4 — flip to production GHL location

- [ ] **Step 1:** Generate a Private Integration Token for the production GHL location.
- [ ] **Step 2:** Run `GHL_API_TOKEN=<prod-token> GHL_LOCATION_ID=<prod-location> node scripts/ghl-bootstrap-fields.js` to create the 28 custom fields in production.
- [ ] **Step 3:** Update Vercel env vars: `GHL_API_TOKEN` and `GHL_LOCATION_ID` to production values.
- [ ] **Step 4:** Truncate the `GHL Sync Log` tab (delete all rows except header) — fresh start for prod. Reset watermark cell L2 to empty.
- [ ] **Step 5:** Redeploy. Wait 10 min. Verify contacts appear in production GHL.

---

### Task 25: Rollout step 5 — backfill 90 days of history

- [ ] **Step 1:** Confirm production sync has been live and stable for at least 24 hours.
- [ ] **Step 2:** Run backfill in chunks (avoid 60s function timeout):

```bash
for week in 1 2 3 4 5 6 7 8 9 10 11 12 13; do
  start=$(date -u -v-${week}w +%Y-%m-%d)
  prev=$(date -u -v-$((week-1))w +%Y-%m-%d)
  echo "Backfilling $start to $prev"
  curl -s "https://<your-vercel-domain>/api/ghl-backfill?start=$start&end=$prev&secret=$CRON_SECRET" | python3 -m json.tool
  sleep 10
done
```

- [ ] **Step 3:** After all weeks complete, verify total contact count in GHL roughly matches expected unique-Lead-Id count over the period.

---

### Task 26: V2 handoff — Peter configures GHL workflows

- [ ] **Step 1:** Inside GHL, build the welcome-SMS workflow that fires on contact creation when `Currently Callable = yes`. Use the custom fields populated by V1 (e.g., `First Campaign`, `First Call Status`).
- [ ] **Step 2:** Build the no-answer follow-up workflow triggered when `Total Call Attempts >= 3` and `Last Call Status = No Answer`.
- [ ] **Step 3:** Build the retention/post-sale flow if/when sales data flows into GHL (V3 work, separate plan).

These workflows are configured *inside* GHL — no code change needed. V1 has populated everything they need to read.

---

## Self-Review Notes (for plan author)

After writing the plan, I checked it against the spec — every section in the spec maps to one or more tasks:

| Spec section | Task(s) |
|---|---|
| §1 Purpose | Implicit (the whole plan) |
| §2 Scope | T1–T25 (in scope); explicitly out-of-scope items not in plan |
| §3 Architecture | T1–T15 (modules); T16–T18 (routes/cron) |
| §4 Matching ladder | T6 (matcher), T9–T10 (search fns) |
| §5 Filtering rules | T3 (filter) |
| §6 Field mapping | T5 (mapping module), T11 (write methods) |
| §7 Sheet additions | T12 (tab init), T13 (read/write helpers) |
| §8 Infrastructure | T7–T11 (client), T16–T17 (routes), T18 (vercel.json), T19 (bootstrap) |
| §9 Reliability | T7 (retry/rate limit), T15 (continue-on-error + watermark) |
| §10 Testing strategy | Embedded in each task verify step + T22 (dry-run) + T23 (smoke test) |
| §11 Rollout plan | T21–T26 (all rollout phases) |
| §12 File layout | File Structure section above |

**Placeholder scan:** No "TBD" / "TODO" / "implement later" / "appropriate error handling" / etc. The note about "Activity note: Notes vs Conversations surface" from spec §13 was decided implicitly (Notes API used in T11).

**Type consistency:** `processSingleRow`, `processBatch`, `createGhlClient`, `searchByPhone`, `searchByNameAndState`, `createContact`, `updateContact`, `addNote`, `resolveCustomFields`, `getCustomFieldId`, `buildContactPatch`, `formatNote`, `rowHash`, `levenshtein`, `shouldProcessRow`, `matchContact` — all consistent across tasks. Custom field internal names (`firstLeadId`, `lastCallDate`, etc.) are defined in T5 and referenced unchanged in T8, T11, T19.
