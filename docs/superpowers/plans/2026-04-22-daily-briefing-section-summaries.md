# Daily Briefing Per-Section Summaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single "Daily Overview" AI paragraph with six per-section summaries (Agent Availability, Sales & Conversion, Call Volume, Revenue, Cost Efficiency, Virtual Agent), each rendered as a muted-italic row directly under its existing blue section heading in the table.

**Architecture:** Two-file surgical change. Backend (`src/app/api/daily-summary/route.js`) rewrites the GPT-4o prompt so `tableSummaries.dailyOverview` becomes an object with six string keys instead of a single string. Frontend (`src/components/DailySummaryPage.jsx`) inserts a new `<tr>` after each existing divider row when the summary for that section is present. Both sides accept the legacy string shape for backward cache compatibility (no cache migration needed).

**Tech Stack:** Next.js 14 App Router, OpenAI SDK (gpt-4o), inline React styles. No new dependencies. Project has no test framework — verification is curl + browser.

**Project convention note:** Verification is via `curl` against the dev server plus manual browser inspection. Do **not** introduce Jest/Vitest for this feature.

Design spec: [`docs/superpowers/specs/2026-04-22-daily-briefing-section-summaries-design.md`](../specs/2026-04-22-daily-briefing-section-summaries-design.md).

---

## File Structure

**Modified files only (no new files):**
- `src/app/api/daily-summary/route.js` — change system prompt, user prompt, and the output-parsing block that fills `tableSummaries.dailyOverview`.
- `src/components/DailySummaryPage.jsx` — add summary row rendering inside the Daily Overview table; preserve legacy string fallback.

**Shared contract between files:**
- `tableSummaries.dailyOverview` is either a string (legacy) or an object with keys: `availability`, `sales`, `calls`, `revenue`, `cost`, `va`. Those six keys match the existing `section` field values already present in the `metrics` array at [src/components/DailySummaryPage.jsx:285-312](src/components/DailySummaryPage.jsx).

---

### Task 1: Backend — rewrite prompt and output schema

**Files:**
- Modify: `src/app/api/daily-summary/route.js` — two prompt edits and one parser edit.

- [ ] **Step 1: Extend the system prompt's `ANALYSIS RULES:` block**

Locate the `role: 'system'` content string (starts at approximately [line 465](src/app/api/daily-summary/route.js)). Find this line inside the `ANALYSIS RULES:` block:

```
- Do NOT mention "policies placed" or "placement rate."
- Return ONLY valid JSON — no markdown, no code fences, no extra text.
```

Insert a new rule between those two lines (keeping both), so the block ends with:

```
- Do NOT mention "policies placed" or "placement rate."
- For dailyOverview, write SIX separate section summaries, each focused ONLY on the metrics named in its sub-prompt. Do NOT repeat the same fact in multiple sections. If the avg30 baseline is null for a metric, say "insufficient history" rather than inventing a comparison.
- Return ONLY valid JSON — no markdown, no code fences, no extra text.
```

- [ ] **Step 2: Replace the user prompt's `DAILY OVERVIEW` section with six sub-prompts**

Locate this block at approximately [line 491-492](src/app/api/daily-summary/route.js):

```
DAILY OVERVIEW — What made the best day(s) the best? What broke down on weak days? Correlate agent availability, talk time, billable calls, and conversion rate to sales output. Relate today's values to avg7/avg30; call out any z > 1.5 or best/worst-in-14. 3-4 sentences.
${buildRulePrompt('dailyOverview', 'Correlate availability and talk time to sales. Identify the best and worst days and explain WHY.')}
```

Replace it with:

```
DAILY OVERVIEW — Write SIX short summaries, one per section of the Daily Overview table. Each is 1-3 sentences, grounded ONLY in the metrics listed for that section. Compare to avg7/avg30 when those baselines exist; say "insufficient history" when they do not.

  availability: Agents Logged In, Avg Availability, Total Talk Time, Total Logged In.
  sales: Sales per Agent, Sales (Apps), Billable Calls, Conversion Rate. Name the top-producing agent(s).
  calls: Total Calls, Billable Rate. Compare both to 30-day averages; flag any driving campaign.
  revenue: Premium, Gross Adv Revenue, Commission, Net Revenue. Compare each to its 30-day average.
  cost: Lead Spend, CPA, RPC, Avg Premium. Lead Spend / CPA / RPC are lower-is-better; compare each to its 30-day average.
  va: VA Calls, VA Transfers, VA Transfer Rate. If all three are zero, write "Virtual agent had no meaningful activity today." and nothing else.

${buildRulePrompt('dailyOverview', 'Correlate availability and talk time to sales. Be specific per section and do not repeat facts across sections.')}
```

- [ ] **Step 3: Replace the JSON schema block at the bottom of the user prompt**

Still in the same `role: 'user'` content, locate the `Return ONLY a JSON object:` block at approximately [lines 506-514](src/app/api/daily-summary/route.js):

```
Return ONLY a JSON object:
{
  "executive": "3-4 sentence executive summary focused on what drove the best results and what held us back. Be specific and actionable.",
  "dailyOverview": "3-4 sentences answering: what drove the best day vs the worst day?",
  "publishers": "3-4 sentences on publisher ROI — who produces vs who burns cash.",
  "carriers": "2-3 sentences on carrier economics and conversion.",
  "agents": "3-4 sentences on agent productivity — who converts and why.",
  "pipeline": "2-3 sentences on what the status mix reveals."
}
```

Replace with:

```
Return ONLY a JSON object:
{
  "executive": "3-4 sentence executive summary focused on what drove the best results and what held us back. Be specific and actionable.",
  "dailyOverview": {
    "availability": "1-3 sentences on Agents Logged In, Avg Availability, Talk Time, Logged-in Time. Cite 30-day averages where available.",
    "sales": "1-3 sentences on Sales per Agent, Apps, Billable Calls, Conversion Rate. Name the top producer.",
    "calls": "1-3 sentences on Total Calls and Billable Rate vs 30-day averages.",
    "revenue": "1-3 sentences on Premium, GAR, Commission, Net Revenue each vs its 30-day average.",
    "cost": "1-3 sentences on Lead Spend, CPA, RPC, Avg Premium each vs its 30-day average.",
    "va": "1-2 sentences on VA activity, or 'Virtual agent had no meaningful activity today.' if all three VA metrics are zero."
  },
  "publishers": "3-4 sentences on publisher ROI — who produces vs who burns cash.",
  "carriers": "2-3 sentences on carrier economics and conversion.",
  "agents": "3-4 sentences on agent productivity — who converts and why.",
  "pipeline": "2-3 sentences on what the status mix reveals."
}
```

- [ ] **Step 4: Update the parser to accept an object OR a string for `dailyOverview`**

Locate the parse block at approximately [lines 520-531](src/app/api/daily-summary/route.js):

```js
try {
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    const parsed = JSON.parse(jsonMatch[0]);
    narrative = parsed.executive || '';
    tableSummaries = {
      dailyOverview: parsed.dailyOverview || '',
      publishers: parsed.publishers || '',
      carriers: parsed.carriers || '',
      agents: parsed.agents || '',
      pipeline: parsed.pipeline || '',
    };
  } else {
    narrative = rawText;
  }
} catch (parseErr) {
  console.warn('[daily-summary] JSON parse failed, using raw text:', parseErr.message);
  narrative = rawText;
}
```

Replace with:

```js
try {
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    const parsed = JSON.parse(jsonMatch[0]);
    narrative = parsed.executive || '';
    // dailyOverview can be an object (new format) or a string (legacy / model noncompliance)
    let dailyOverview = parsed.dailyOverview;
    if (dailyOverview && typeof dailyOverview === 'object') {
      const allowedKeys = ['availability', 'sales', 'calls', 'revenue', 'cost', 'va'];
      const cleaned = {};
      for (const k of allowedKeys) {
        if (typeof dailyOverview[k] === 'string') cleaned[k] = dailyOverview[k];
      }
      dailyOverview = cleaned;
    } else if (typeof dailyOverview !== 'string') {
      dailyOverview = '';
    }
    tableSummaries = {
      dailyOverview,
      publishers: parsed.publishers || '',
      carriers: parsed.carriers || '',
      agents: parsed.agents || '',
      pipeline: parsed.pipeline || '',
    };
  } else {
    narrative = rawText;
  }
} catch (parseErr) {
  console.warn('[daily-summary] JSON parse failed, using raw text:', parseErr.message);
  narrative = rawText;
}
```

Why the `allowedKeys` filter: prevents surprise keys the model might invent from leaking into the frontend.

- [ ] **Step 5: Verify a fresh generation returns the object shape**

Dev server must be running (port 3006 from the prior session, or start fresh with `npm run dev` and note the port).

Since AI narratives are cached per `date|mode` in the `AI Summary Cache` tab, delete the row for today's date before testing. The debug endpoint from the prior session lives at `src/app/api/snapshots/debug-clear-cache/route.js` — reuse it if still present, or delete the row manually in the Google Sheet. Then flush the in-memory fetch cache:

```bash
curl -s -X POST http://localhost:3006/api/clear-cache
```

Then regenerate:

```bash
curl -s --max-time 120 "http://localhost:3006/api/daily-summary?start=2026-04-21&end=2026-04-21" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
ts = d.get('tableSummaries', {})
do = ts.get('dailyOverview')
print('dailyOverview type:', type(do).__name__)
if isinstance(do, dict):
    for k in ['availability','sales','calls','revenue','cost','va']:
        v = do.get(k, '<missing>')
        print(f'  {k}: {str(v)[:120]}')
else:
    print('  value:', str(do)[:200])
"
```

Expected:
- `dailyOverview type: dict`
- Each of the six keys has a string value of 1–3 sentences.
- No surprise extra keys printed.

If `dailyOverview type: str`, the model ignored the schema — rerun once (GPT-4o is non-deterministic at temperature 0.4). If it's `str` repeatedly, check Step 3's JSON schema replacement.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/daily-summary/route.js
git commit -m "Split daily overview narrative into six per-section summaries"
```

---

### Task 2: Frontend — render per-section summary rows

**Files:**
- Modify: `src/components/DailySummaryPage.jsx` — insert one new row type inside the Daily Overview table.

- [ ] **Step 1: Update the table render to insert a summary row after each divider**

Locate the existing block at approximately [lines 340-355](src/components/DailySummaryPage.jsx):

```jsx
// Section divider row
let divider = null;
if (m.section !== lastSection) {
  lastSection = m.section;
  divider = (
    <tr key={m.section + '-div'}>
      <td colSpan={dates.length + 3} style={{ padding: '8px 10px 4px', fontSize: 8, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: 1, borderBottom: `1px solid ${C.border}44` }}>
        {sectionLabels[m.section]}
      </td>
    </tr>
  );
}

return (
  <React.Fragment key={m.key}>
    {divider}
    <tr>
      ...
```

Replace the whole block (from `// Section divider row` through `{divider}` in the fragment) with:

```jsx
// Section divider row + optional per-section summary row
let divider = null;
let sectionSummary = null;
if (m.section !== lastSection) {
  lastSection = m.section;
  divider = (
    <tr key={m.section + '-div'}>
      <td colSpan={dates.length + 3} style={{ padding: '8px 10px 4px', fontSize: 8, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: 1, borderBottom: `1px solid ${C.border}44` }}>
        {sectionLabels[m.section]}
      </td>
    </tr>
  );
  const do_ = tableSummaries?.dailyOverview;
  const summaryText = do_ && typeof do_ === 'object' ? do_[m.section] : null;
  if (summaryText) {
    sectionSummary = (
      <tr key={m.section + '-sum'}>
        <td colSpan={dates.length + 3} style={{
          padding: '4px 14px 10px',
          fontSize: 11,
          color: C.muted,
          fontStyle: 'italic',
          lineHeight: 1.5,
          borderBottom: `1px solid ${C.border}22`,
        }}>
          {summaryText}
        </td>
      </tr>
    );
  }
}

return (
  <React.Fragment key={m.key}>
    {divider}
    {sectionSummary}
    <tr>
      ...
```

Make sure `tableSummaries` is already in scope at this point — it's destructured earlier in the component from `data`. If it isn't, add `const tableSummaries = data?.tableSummaries;` at the top of the component render function. (Check by searching for `tableSummaries` in the file: it's referenced for the other four section summaries that render below each table.)

- [ ] **Step 2: Preserve legacy string-shape rendering above the table**

Find where the top-of-table "Daily Overview" summary is currently rendered. It sits near the opening of the `<Section title={isWeekly ? "Weekly Daily Overview" : "Daily Overview"}>` block at approximately [line 263](src/components/DailySummaryPage.jsx). Look for a block that reads `tableSummaries?.dailyOverview` and renders it as a paragraph (if one exists — the exact rendering may already live elsewhere; if the component currently does not render it above the table and only shows it somewhere else, skip this step).

If it IS rendered above the table, wrap the render with a type guard so it only shows for the legacy string shape:

```jsx
{typeof tableSummaries?.dailyOverview === 'string' && tableSummaries.dailyOverview && (
  <p style={{ /* existing styles */ }}>
    {tableSummaries.dailyOverview}
  </p>
)}
```

If the component currently renders the dailyOverview string in a different place (e.g. below the table, or as part of an Alerts panel), apply the same `typeof === 'string'` guard wherever it appears. The goal: object-shape never renders as a paragraph, string-shape still does.

To find every usage: `grep -n "dailyOverview" src/components/DailySummaryPage.jsx` and audit each hit.

- [ ] **Step 3: Verify legacy string fallback still renders cleanly**

Restart the dev server OR rely on HMR (component changes hot-reload; API route changes do not). Visit the page at `http://localhost:3006/` and navigate to the daily-brief tab.

Pick a date that currently has a CACHED legacy string summary (e.g. an older date not regenerated after Task 1 — check the `AI Summary Cache` tab in the Goals sheet for rows where `TableSummaries` contains `"dailyOverview":"`). Load that date in the date picker.

Expected: the Daily Overview table renders exactly as today. The legacy string paragraph appears wherever it did before (above or adjacent to the table). No extra rows inside the table. No crashes.

- [ ] **Step 4: Verify new object-shape renders per-section rows**

Load the page for today's date (whose cache was regenerated in Task 1 Step 5). In the browser:

- Scroll to the Daily Overview table.
- Confirm that each of the six blue headings (Agent Availability, Sales & Conversion, Call Volume, Revenue, Cost Efficiency, Virtual Agent) is immediately followed by a muted-italic row spanning all columns.
- Each italic row should contain 1–3 sentences specific to that section.
- The metric rows still appear beneath each italic row.

If any section is missing its italic row, check that the AI returned a string for that key in Task 1 Step 5's output. If it did but the row is absent, inspect the JSX guard `if (summaryText)` — empty strings correctly skip rendering.

Also, a quick grep-style check that the rendering path matches:

```bash
curl -s "http://localhost:3006/daily-summary" 2>/dev/null || true
# The page may not have a direct URL; if not, open the dashboard and click daily-brief.
```

- [ ] **Step 5: Commit**

```bash
git add src/components/DailySummaryPage.jsx
git commit -m "Render per-section summaries under each Daily Overview section heading"
```

---

### Task 3: End-to-end verification on multiple dates

**Files:** (no code changes — operational task)

- [ ] **Step 1: Regenerate summaries for three representative dates**

Pick three contrasting dates from the backfilled range:
- A recent high-activity day (e.g. 2026-04-20)
- A recent zero-call day (e.g. 2026-04-19 weekend)
- A mid-range day (e.g. 2026-03-15)

For each, delete the existing cache row from the `AI Summary Cache` tab (or use the debug-clear-cache route if it's still present), flush in-memory cache, and regenerate:

```bash
for D in 2026-04-20 2026-04-19 2026-03-15; do
  echo "--- $D ---"
  # Delete cache row for this date — adjust path if the debug route was removed
  curl -s "http://localhost:3006/api/snapshots/debug-clear-cache?date=$D" 2>/dev/null || true
  curl -s -X POST "http://localhost:3006/api/clear-cache" -o /dev/null
  curl -s --max-time 120 "http://localhost:3006/api/daily-summary?start=$D&end=$D" \
    | python3 -c "
import sys, json
d = json.load(sys.stdin)
do = d.get('tableSummaries',{}).get('dailyOverview')
if isinstance(do, dict):
    for k in ['availability','sales','calls','revenue','cost','va']:
        print(f'  {k}: {(do.get(k,\"\") or \"<empty>\")[:100]}')
else:
    print('  LEGACY STRING:', str(do)[:100])
"
done
```

Expected:
- All three dates print `dict` keys.
- High-activity day has substantive sentences citing baseline deltas.
- Zero-call day's `calls` section should note the zero or "insufficient data" gracefully.
- VA section on a no-VA day should return the single "no meaningful activity" sentence.

- [ ] **Step 2: Visual inspection in the browser**

For each of the three dates, load the page, scroll through the Daily Overview table, and confirm:
- Six italic summary rows, one per section.
- No section is missing its summary row except when `va` returns the fallback sentence (which should still render).
- No layout glitches (column widths preserved, section dividers intact, threshold colors on numeric cells unchanged).

- [ ] **Step 3: Commit an empty marker (optional)**

No code change in this task. Optionally capture the verification:

```bash
git commit --allow-empty -m "Verify per-section summaries on 2026-04-20, 2026-04-19, 2026-03-15"
```

Skip this step if the project conventions prefer no empty commits.

---

### Task 4: Clean up the debug-clear-cache route (housekeeping)

**Files:**
- Delete: `src/app/api/snapshots/debug-clear-cache/route.js` (if it still exists from the prior baselines session).

This debug route was created during troubleshooting and should not ship. Confirm it's not imported anywhere:

- [ ] **Step 1: Check if the debug route exists and is referenced**

```bash
ls src/app/api/snapshots/debug-clear-cache/route.js 2>/dev/null && echo "EXISTS" || echo "ALREADY_REMOVED"
grep -r "debug-clear-cache" src/ --include="*.js" --include="*.jsx"
```

If the file does not exist, skip the rest of this task.
If the grep returns any hits outside the route file itself, investigate before deleting.

- [ ] **Step 2: Delete and commit**

```bash
rm src/app/api/snapshots/debug-clear-cache/route.js
git add -A
git commit -m "Remove debug-clear-cache route (ad-hoc troubleshooting leftover)"
```

---

## Verification at end of plan

After Tasks 1–4:

1. `curl -s "http://localhost:3006/api/daily-summary?start=2026-04-21&end=2026-04-21"` → `tableSummaries.dailyOverview` is an object with six string keys.
2. Browser → daily-brief tab → each of six blue section headings has one muted-italic row directly below it.
3. A legacy cached date (if any still exist) renders its string dailyOverview above the table without crashing and without creating phantom per-section rows inside the table.
4. `ls src/app/api/snapshots/debug-clear-cache/` → does not exist.

---

## Out of scope (not in this plan)

- Per-section customization in the `AI Analysis Rules` sheet. One `dailyOverview` rule still applies to all six sub-summaries. Can add `daily_availability`, `daily_sales`, etc. entries to the sheet and to `ruleMap` later without schema changes.
- Email template changes (the email does not render the per-section table; leave the email narrative as a single paragraph).
- Splitting `publishers`, `carriers`, `agents`, or `pipeline` into sub-sections.
- Any changes to the metrics array, goal thresholds, or threshold color logic.
