# Daily Briefing — Per-Section Summaries Design

## Summary

Replace the single AI-generated paragraph below the Daily Overview table with **six per-section summaries**, one per blue section heading already present in the table (Agent Availability, Sales & Conversion, Call Volume, Revenue, Cost Efficiency, Virtual Agent). Each summary renders as a muted-italic row directly below its section heading and above that section's metric rows. The existing table layout, colors, column structure, and metric rows are preserved exactly as-is.

## Problem

The Daily Overview table already has six logical sections with blue headings (implemented as divider rows in `DailySummaryPage.jsx`). Below the table sits one AI-generated paragraph from `tableSummaries.dailyOverview` that tries to cover all six sections in 3–4 sentences. The result is either generic ("the day was driven by strong agent performance") or cherry-picks one section at the expense of the others. Users have to re-read the whole paragraph to find commentary relevant to the section they're looking at.

## Goal

Per-section, pointed commentary that grounds each blue heading in its own data slice. A user scanning the Agent Availability section should see a 1–3 sentence narrative about availability, talk time, and logged-in time right there — not buried in a generic paragraph 100 rows below.

## Scope

### In scope

1. Backend: change the GPT-4o prompt in `/api/daily-summary/route.js` so the `dailyOverview` field in the returned JSON is an **object** with six keys (`availability`, `sales`, `calls`, `revenue`, `cost`, `va`) instead of a single string.
2. Frontend: in `src/components/DailySummaryPage.jsx`, after each section divider row in the Daily Overview table, insert a second row that spans all columns and renders `tableSummaries.dailyOverview[section.key]` in muted italic. If that value is absent or empty, render nothing.
3. Backward compatibility: the renderer accepts both shapes — `typeof x === 'string'` is legacy (render once at the top of the table as today), `typeof x === 'object'` is the new format.

### Out of scope

- No changes to the other four AI sections (`publishers`, `carriers`, `agents`, `pipeline`).
- No changes to the existing 19 rows of metrics, their goals, their thresholds, their per-day columns, or the Total/Avg column.
- No changes to table colors, fonts, or the existing blue divider row visuals.
- No per-section AI Rules customization (one `dailyOverview` rule in the `AI Analysis Rules` sheet still applies to all six sub-summaries). Can be added later without schema changes.
- No email template changes (email renders a different layout; keep the existing one-paragraph dailyOverview there).

## Architecture

### Data flow

```
GPT-4o prompt  →  { executive, dailyOverview: { availability, sales, calls, revenue, cost, va }, publishers, carriers, agents, pipeline }
                    |
                    v
AI Summary Cache tab (Goals sheet)   ← JSON-serialized, versioned by schema
                    |
                    v
/api/daily-summary response   →   { narrative, tableSummaries, baselines, ... }
                    |
                    v
DailySummaryPage.jsx renderer   →   per-section row inserted between divider and metric rows
```

### Backend: prompt change

The existing prompt asks for five table-summary keys. The new prompt asks the model to expand `dailyOverview` into an object:

```
Return ONLY a JSON object:
{
  "executive": "3-4 sentence executive summary…",
  "dailyOverview": {
    "availability": "2-3 sentences focused ONLY on agent availability, pause %, logged-in time, and talk time. Compare each to the same agent's 30-day norm when the baseline is available.",
    "sales": "2-3 sentences focused ONLY on apps submitted, sales per agent, billable calls, and conversion rate. Name the top-producing agent(s).",
    "calls": "2-3 sentences focused ONLY on total calls and billable rate. Compare both to the 30-day average. Call out any campaign driving the volume or the drop.",
    "revenue": "2-3 sentences focused ONLY on premium, GAR, commission, and net revenue, each compared to its 30-day average.",
    "cost": "2-3 sentences focused ONLY on lead spend, CPA, RPC, and avg premium, each compared to its 30-day average. Lower-is-better for the first three.",
    "va": "2 sentences on VA calls and transfer rate, or a single 'Virtual agent had no meaningful activity today.' sentence if the counts are zero."
  },
  "publishers": "3-4 sentences…",
  "carriers": "2-3 sentences…",
  "agents": "3-4 sentences…",
  "pipeline": "2-3 sentences…"
}
```

The system prompt gets one additional rule in the `ANALYSIS RULES:` block:

> For `dailyOverview`, write SIX separate section summaries, each focused on the metrics named in its sub-prompt. Do NOT repeat the same fact in multiple sections. Each summary must be grounded in the baselines block when relevant data exists; say "insufficient history" if the avg30 is null.

The user prompt's `DAILY OVERVIEW — ...` section is replaced by a breakdown of the six sub-questions, each pointing at the metrics it should cover. The existing `buildRulePrompt('dailyOverview', ...)` output is prepended so users can still tune behavior via the `AI Analysis Rules` sheet.

### Frontend: row insertion

In `DailySummaryPage.jsx`, locate the block (around line 340) where `divider` is set:

```js
if (m.section !== lastSection) {
  lastSection = m.section;
  divider = (<tr key={m.section + '-div'}>...</tr>);
}
```

After the divider row, insert a second row with the per-section summary when available:

```jsx
{divider}
{divider && typeof tableSummaries?.dailyOverview === 'object' && tableSummaries.dailyOverview[m.section] && (
  <tr key={m.section + '-sum'}>
    <td colSpan={dates.length + 3} style={{
      padding: '4px 14px 10px',
      fontSize: 11,
      color: C.muted,
      fontStyle: 'italic',
      lineHeight: 1.5,
      borderBottom: `1px solid ${C.border}22`,
    }}>
      {tableSummaries.dailyOverview[m.section]}
    </td>
  </tr>
)}
```

If `tableSummaries.dailyOverview` is a string (legacy), render it once above the table exactly as it renders today (no change in existing behavior for cached old rows).

### Cache compatibility

The `AI Summary Cache` tab stores `TableSummaries` as a JSON string. Old rows serialize `dailyOverview` as a string, new rows serialize it as an object. The renderer switches on `typeof`:

- `string` → legacy one-paragraph render above the table (current behavior)
- `object` → per-section renders, no top paragraph

No cache migration needed. Old cached rows keep working; new generations produce the object shape.

### Section-to-metric mapping (reference)

The existing `metrics` array in `DailySummaryPage.jsx` already tags each metric with a `section` key. The prompt expects the AI to ground each sub-summary on the following slices:

| Section key | Metrics it covers |
|-------------|-------------------|
| `availability` | Agents Logged In, Avg Availability, Total Talk Time, Total Logged In |
| `sales` | Sales per Agent, Sales (Apps), Billable Calls, Conversion Rate |
| `calls` | Total Calls, Billable Rate |
| `revenue` | Premium, Gross Adv Revenue, Commission, Net Revenue |
| `cost` | Lead Spend, CPA, RPC, Avg Premium |
| `va` | VA Calls, VA Transfers, VA Transfer Rate |

The `BASELINES:` block injected earlier (Task 9 of the baselines feature) already covers `availPct`, `talkTimeSec`, `apps`, `premium`, `calls`, `billable`, `billableRate`, `gar`, `leadSpend`, `cpa`, `rpc`, `closeRate`, `netRevenue`, and per-agent/per-campaign versions. Section summaries can cite those directly.

## Testing strategy

The project has no test framework. Verification is via curl + browser inspection:

1. **Old cache hit**: hit `/api/daily-summary` for a cached historical date (e.g. 2026-04-15 which was summarized when dailyOverview was still a string). The page should render the old summary as a single paragraph above the table, and the table should look unchanged.
2. **Fresh generation**: delete the AI Summary Cache row for today, call `/api/clear-cache` to flush in-memory, then hit `/api/daily-summary` for today. The response JSON should show `tableSummaries.dailyOverview` as an object with six string keys. Load the page; each blue heading row should be followed by a muted-italic row with 1–3 sentences matching that section's metrics.
3. **Empty section**: for a day with no VA activity, the `va` sub-summary should be the fallback sentence, not absent. Verify it renders without layout glitch.
4. **Legacy string fallback**: as a regression check, pass a mock summary with `tableSummaries.dailyOverview = "legacy string"` and confirm it renders above the table as today (simulated via manually editing the cache row temporarily).

## Failure modes and mitigations

- **Model returns mixed shape** (e.g. four keys as objects, two as strings). Mitigation: renderer's `typeof` check is per-key-access, not per-whole-object. Any string key renders as muted-italic text; any missing key renders nothing. No crash.
- **Model returns `dailyOverview` as a single string despite the new prompt**. Mitigation: legacy path kicks in automatically.
- **Cache collision between old and new shapes for the same date|mode key**. Mitigation: cache write overwrites on new generation (existing behavior), so the next fresh run replaces any legacy row.

## Open questions (none)

No outstanding design questions remain. The data needed by each section is already present in `liveContext` and `baselines`; the change is purely a prompt rewrite + a small renderer addition.
