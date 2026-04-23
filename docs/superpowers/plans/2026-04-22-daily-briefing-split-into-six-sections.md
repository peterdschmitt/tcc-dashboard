# Split Daily Overview into Six Standalone Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single "Daily Overview" Section (which contains all 19 metrics + internal blue divider rows + inline per-section summary rows) with **six standalone Sections** — Agent Availability, Sales & Conversion, Call Volume, Revenue, Cost Efficiency, Virtual Agent — each structured exactly like the existing "Publisher Performance" Section (its own card, its own blue title, its own AI narrative paragraph, its own mini-table).

**Architecture:** Frontend-only refactor in `DailySummaryPage.jsx`. The backend work from the prior attempt (commit `c428835`, which makes `tableSummaries.dailyOverview` an object with six string keys) is kept as-is — the new layout consumes the same data shape. The inline-summary row code from commit `02aa755` is removed; its behavior is superseded by the new six-section layout. Legacy string-shape fallback is preserved for any cached old narratives.

**Tech Stack:** Next.js 14 App Router, inline React styles, existing `Section` component. No new dependencies. No backend changes.

**Supersedes:** [docs/superpowers/plans/2026-04-22-daily-briefing-section-summaries.md](docs/superpowers/plans/2026-04-22-daily-briefing-section-summaries.md).

**Project convention note:** No test framework. Verification is via curl + browser inspection.

---

## File Structure

**Modified files only (no new files):**
- `src/components/DailySummaryPage.jsx` — replace the existing Daily Overview Section block with six new Section blocks using a shared internal render helper.

**Data contract (unchanged from prior work):**
- `viewTS.dailyOverview` is either a string (legacy cache) or an object with keys `availability`, `sales`, `calls`, `revenue`, `cost`, `va`. Keys correspond to the `section` field already present on each metric in the `metrics` array.

---

### Task 1: Refactor Daily Overview into six standalone Sections

**Files:**
- Modify: `src/components/DailySummaryPage.jsx` — replace the block starting at approximately line 261 (`{/* ─── TABLE 1: DAILY OVERVIEW ─── */}`) through line 392 (the `</Section>` closing the current Daily Overview).

- [ ] **Step 1: Locate the current block to replace**

Open `src/components/DailySummaryPage.jsx` and identify the block to replace. It starts with the comment `{/* ─── TABLE 1: DAILY OVERVIEW` and ends with the closing `)}` of the `<Section title="Daily Overview">`. Currently around lines 261–392. The `metrics` array definition and `sectionLabels` map defined inside the IIFE (lines 285–316) will be moved outward so the new layout can reuse them across six Sections.

- [ ] **Step 2: Replace the block**

Replace the entire block (the comment line, the conditional guard, and the whole `<Section title="Daily Overview">...</Section>`) with this new structure:

```jsx
      {/* ─── SIX STANDALONE SECTIONS (Agent Availability, Sales & Conversion, Call Volume, Revenue, Cost Efficiency, Virtual Agent) ─── */}
      {(viewData?.dailyOverview || data.dailyOverview) && Object.keys(viewData?.dailyOverview || data.dailyOverview || {}).length > 0 && (() => {
        const ov = viewData?.dailyOverview || data.dailyOverview;
        const dates = Object.keys(ov).sort();
        const numDays = dates.length || 1;
        const dayNames = dates.map(d => {
          const dt = new Date(d + 'T12:00:00');
          return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        });

        const thresholdColor = (val, goal, lower) => {
          if (!goal || val == null) return C.text;
          const ratio = lower ? (val === 0 ? 2 : goal / val) : val / goal;
          if (ratio >= 1) return C.green;
          if (ratio >= 0.8) return C.yellow;
          return C.red;
        };

        const metrics = [
          // ─ AGENT AVAILABILITY ─
          { key: 'agentCount', label: 'Agents Logged In', format: fmt, section: 'availability' },
          { key: 'availPct', label: 'Avg Availability', format: fmtP, goal: 70, isAvg: true, section: 'availability' },
          { key: 'talkTimeSec', label: 'Total Talk Time', format: fmtTime, section: 'availability' },
          { key: 'loggedInSec', label: 'Total Logged In', format: fmtTime, section: 'availability' },
          // ─ SALES & CONVERSION ─
          { key: 'salesPerAgent', label: 'Sales per Agent', format: v => v != null ? v.toFixed(1) : '—', goal: 2.5, isAvg: true, section: 'sales' },
          { key: 'sales', label: 'Sales (Apps)', format: fmt, goal: 5, section: 'sales' },
          { key: 'billables', label: 'Billable Calls', format: fmt, goal: 35, section: 'sales' },
          { key: 'closeRate', label: 'Conversion Rate', format: fmtP, goal: 22.5, isAvg: true, section: 'sales' },
          // ─ CALLS ─
          { key: 'calls', label: 'Total Calls', format: fmt, goal: 50, section: 'calls' },
          { key: 'billableRate', label: 'Billable Rate', format: fmtP, goal: 65, isAvg: true, section: 'calls' },
          // ─ REVENUE ─
          { key: 'premium', label: 'Premium', format: v => fmtD(v), goal: 500, section: 'revenue' },
          { key: 'gar', label: 'Gross Adv Revenue', format: v => fmtD(v), goal: 4000, section: 'revenue' },
          { key: 'commission', label: 'Commission', format: v => fmtD(v), goal: 1200, section: 'revenue' },
          { key: 'nar', label: 'Net Revenue', format: v => fmtD(v), goal: 2000, section: 'revenue' },
          // ─ COST EFFICIENCY (lower is better) ─
          { key: 'spend', label: 'Lead Spend', format: v => fmtD(v), goal: 1500, lower: true, section: 'cost' },
          { key: 'cpa', label: 'CPA', format: v => fmtD(v), goal: 200, lower: true, isAvg: true, section: 'cost' },
          { key: 'rpc', label: 'RPC', format: v => fmtD(v, 2), goal: 35, lower: true, isAvg: true, section: 'cost' },
          { key: 'avgPremium', label: 'Avg Premium', format: v => fmtD(v), goal: 70, isAvg: true, section: 'cost' },
          // ─ VIRTUAL AGENT ─
          { key: 'vaCalls', label: 'VA Calls', format: fmt, goal: 100, section: 'va' },
          { key: 'vaTransfers', label: 'VA Transfers', format: fmt, section: 'va' },
          { key: 'vaTransferRate', label: 'VA Transfer Rate', format: fmtP, goal: 30, isAvg: true, section: 'va' },
        ];

        const sectionDefs = [
          { key: 'availability', title: isWeekly ? 'Weekly Agent Availability' : 'Agent Availability' },
          { key: 'sales',        title: isWeekly ? 'Weekly Sales & Conversion' : 'Sales & Conversion' },
          { key: 'calls',        title: isWeekly ? 'Weekly Call Volume' : 'Call Volume' },
          { key: 'revenue',      title: isWeekly ? 'Weekly Revenue' : 'Revenue' },
          { key: 'cost',         title: isWeekly ? 'Weekly Cost Efficiency' : 'Cost Efficiency' },
          { key: 'va',           title: isWeekly ? 'Weekly Virtual Agent' : 'Virtual Agent' },
        ];

        const dailyOverviewSummaries = viewTS?.dailyOverview;
        const legacyString = typeof dailyOverviewSummaries === 'string' ? dailyOverviewSummaries : null;

        const renderSectionTable = (sectionKey) => {
          const rows = metrics.filter(m => m.section === sectionKey);
          return (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ padding: '6px 10px', color: C.muted, fontSize: 9, textTransform: 'uppercase', textAlign: 'left', borderBottom: `1px solid ${C.border}` }}>Metric</th>
                    {dayNames.map((d, i) => (
                      <th key={i} style={{ padding: '6px 10px', color: C.accent, fontSize: 9, textTransform: 'uppercase', textAlign: 'center', borderBottom: `1px solid ${C.border}` }}>{d}</th>
                    ))}
                    <th style={{ padding: '6px 10px', color: C.text, fontSize: 9, textTransform: 'uppercase', textAlign: 'center', borderBottom: `1px solid ${C.border}`, fontWeight: 700 }}>{dates.length > 1 ? 'Total/Avg' : 'Total'}</th>
                    <th style={{ padding: '6px 10px', color: C.muted, fontSize: 9, textTransform: 'uppercase', textAlign: 'center', borderBottom: `1px solid ${C.border}` }}>Goal</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(m => {
                    const vals = dates.map(d => ov[d]?.[m.key] || 0);
                    const total = vals.reduce((s, v) => s + v, 0);
                    const summary = m.isAvg ? total / numDays : total;
                    const goalCompare = m.isAvg ? m.goal : (m.goal ? m.goal * numDays : null);

                    return (
                      <tr key={m.key}>
                        <td style={{ padding: '5px 10px', color: C.text, fontSize: 11, fontWeight: 600, borderBottom: `1px solid ${C.border}22` }}>
                          {m.label}
                          {m.lower && <span style={{ fontSize: 8, color: C.muted, marginLeft: 4 }}>↓</span>}
                        </td>
                        {vals.map((v, i) => (
                          <td key={i} style={{
                            padding: '5px 10px',
                            color: m.goal ? thresholdColor(v, m.goal, m.lower) : C.text,
                            fontSize: 11, fontFamily: C.mono, textAlign: 'center',
                            borderBottom: `1px solid ${C.border}22`,
                          }}>
                            {m.format(v)}
                          </td>
                        ))}
                        <td style={{
                          padding: '5px 10px',
                          color: goalCompare ? thresholdColor(summary, goalCompare, m.lower) : C.accent,
                          fontSize: 11, fontFamily: C.mono, textAlign: 'center', fontWeight: 700,
                          borderBottom: `1px solid ${C.border}22`,
                        }}>
                          {m.format(summary)}
                        </td>
                        <td style={{ padding: '5px 10px', color: C.muted, fontSize: 10, fontFamily: C.mono, textAlign: 'center', borderBottom: `1px solid ${C.border}22` }}>
                          {m.goal ? (m.key === 'closeRate' || m.key === 'billableRate' || m.key === 'vaTransferRate' ? m.goal + '%' : m.key === 'avgPremium' || m.key === 'cpa' || m.key === 'rpc' || m.key === 'spend' || m.key === 'premium' || m.key === 'gar' || m.key === 'commission' || m.key === 'nar' ? '$' + m.goal.toLocaleString() : m.goal) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        };

        return (
          <>
            {legacyString && (
              <Section title={isWeekly ? 'Weekly Daily Overview' : 'Daily Overview'}>
                <p style={aiInsightStyle}>{legacyString}</p>
              </Section>
            )}
            {sectionDefs.map(s => {
              const narrative = dailyOverviewSummaries && typeof dailyOverviewSummaries === 'object'
                ? dailyOverviewSummaries[s.key]
                : null;
              return (
                <Section key={s.key} title={s.title}>
                  {narrative && <p style={aiInsightStyle}>{narrative}</p>}
                  {renderSectionTable(s.key)}
                </Section>
              );
            })}
          </>
        );
      })()}
```

Key behaviors:
- Legacy string-shape cache still renders as one paragraph inside a "Daily Overview" Section above the six new Sections (so old cached narratives don't look broken during the transition).
- When the cache is fresh (object shape), no umbrella Section is shown — only the six standalone Sections.
- Each section's table has the same columns (Metric / day columns / Total-or-Avg / Goal), same threshold colors, same lower-is-better arrow.
- Each Section shows its own AI narrative above its own table, matching the Publisher Performance / Carrier Breakdown pattern.
- The six Sections render in the declared order: Availability → Sales → Calls → Revenue → Cost → VA.
- Virtual Agent Section renders every day regardless of activity (per user preference — all days since 2026-04-09 have VA data).

- [ ] **Step 3: Syntax check**

```bash
cd /Users/peterschmitt/Downloads/tcc-dashboard && node --check src/components/DailySummaryPage.jsx 2>&1 | head -5
```

`node --check` doesn't understand JSX. The better check is the Next.js dev server compile. If the dev server is running, save the file and check its log for compile errors. If anything is broken, HMR prints a red error in the terminal. Fix inline and retry.

A lightweight static sanity check: `grep -c "Section title" src/components/DailySummaryPage.jsx` — should be 8 (the six new sections + the legacy-string umbrella + any Sections already present elsewhere like Alerts; the absolute count isn't critical, just that it changed from before).

- [ ] **Step 4: Verify browser rendering on a fresh-cache date**

Fetch today's date:

```bash
curl -s --max-time 30 "http://localhost:3006/api/daily-summary?start=2026-04-21&end=2026-04-21" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
do = d.get('tableSummaries',{}).get('dailyOverview')
print('type:', type(do).__name__)
if isinstance(do, dict):
    for k in ['availability','sales','calls','revenue','cost','va']:
        present = k in do and do[k]
        print(f'  {k}: {\"OK\" if present else \"MISSING\"}')
"
```

Expected: `type: dict`, all six keys OK.

Then open the page in the browser at `http://localhost:3006/` → daily-brief tab. You should see six separate cards (Agent Availability, Sales & Conversion, Call Volume, Revenue, Cost Efficiency, Virtual Agent), each with its own blue title, its own narrative paragraph, and its own table. Publisher Performance, Carrier Breakdown, Agent Activity, Policy Status Pipeline remain below those six.

- [ ] **Step 5: Verify legacy-cache fallback**

Pick a date whose cache is pre-object-shape. If no such cache rows exist (because Task 3 of the prior plan regenerated all of them), simulate one by editing a row in the `AI Summary Cache` tab: find any row, change its `TableSummaries` JSON so `dailyOverview` is `"this is a legacy string summary"` (a plain string instead of an object). Save. Then hit daily-summary for that date (clear in-memory cache first via `curl -X POST http://localhost:3006/api/clear-cache`).

Expected in the browser: one "Daily Overview" Section card at the top containing that string as a paragraph, followed by the six sub-Sections with empty narratives but populated tables.

If simulating is too fiddly, skip this step and rely on the `typeof === 'string'` guard being correct from visual inspection of the code.

- [ ] **Step 6: Commit**

```bash
git add src/components/DailySummaryPage.jsx
git commit -m "Split Daily Overview into six standalone Sections (each like Publisher Performance)"
```

---

### Task 2: Remove now-dead inline-summary code path

**Files:**
- Modify: `src/components/DailySummaryPage.jsx` — the previous attempt's inline-summary row block is now dead code inside the Section that we just replaced, so Task 1's rewrite already removes it. This task is a final grep check to make sure nothing lingers.

- [ ] **Step 1: Confirm no stray references to the removed approach**

```bash
grep -n "sectionSummary\|'-sum'" src/components/DailySummaryPage.jsx
```

Expected: no matches. If any match is found, delete that code path — it's orphaned from the prior attempt.

- [ ] **Step 2: If anything was cleaned up, commit**

If the grep returned matches and you deleted them:

```bash
git add src/components/DailySummaryPage.jsx
git commit -m "Remove orphaned inline-summary row code from earlier section-summary attempt"
```

If the grep returned no matches, skip this commit. Task 1 already cleaned everything.

---

### Task 3: Cross-date visual verification

**Files:** (no code changes)

- [ ] **Step 1: Load three contrasting dates in the browser**

Open `http://localhost:3006/` → daily-brief tab. Load each of these dates using the date picker:

- **2026-04-20** — high-activity day. Confirm all six Sections have substantive narratives citing baselines. Confirm the Virtual Agent Section renders with the "no meaningful activity" sentence and its table showing zeros.
- **2026-04-21** — today, moderate activity.
- **2026-04-10** — mid-range day with VA data (per user note: "all days since 4/9 have data").

For each date, visually verify:
- Six new cards in the order: Agent Availability, Sales & Conversion, Call Volume, Revenue, Cost Efficiency, Virtual Agent.
- Each card has an italic/muted narrative above its table (unless the narrative is absent, which is allowed).
- Each card's table only shows the rows for that section.
- The Executive Summary card still renders at the top, unchanged.
- Publisher Performance, Carrier Breakdown, Agent Activity, Policy Status Pipeline still render below, unchanged.

- [ ] **Step 2: Weekly view sanity check**

Toggle to "Week in Review" and confirm the six Sections still render with weekly-prefixed titles (`Weekly Agent Availability`, `Weekly Sales & Conversion`, etc.) and multi-day columns in each table.

If anything looks off — missing section, duplicated column, broken threshold color — report it and iterate on Task 1.

---

## Verification at end of plan

After Tasks 1–3:

1. The daily-brief tab shows six separate Section cards in place of the single "Daily Overview" card.
2. Each Section card has its own AI narrative paragraph and its own mini-table.
3. Legacy string-shape caches (if any) still render gracefully in an umbrella "Daily Overview" Section.
4. Weekly view works with weekly-prefixed section titles.
5. No existing Sections (Executive Summary, Publishers, Carriers, Agents, Pipeline, Alerts) were touched.

---

## Out of scope

- No changes to the backend (`route.js` already returns the object shape).
- No changes to the email template (it can keep its current layout).
- No per-section AI Rules customization in the sheet; single `dailyOverview` rule applies to all six.
- No changes to the `Section` component itself, the color tokens, or the `aiInsightStyle` formatting.
- No reordering of the bottom Sections (Publishers, Carriers, Agents, Pipeline).
