# AI Analyst — Rich Conversely Report Extraction

**Date:** 2026-04-24
**Surface:** AI Analyst pane (`src/components/AiAnalystPane.jsx` + `src/components/InsightHero.jsx`)
**Problem owner:** Peter

## Problem

The AI Analyst pane renders a compressed synthesis of Conversely reports. Conversely produces rich markdown covering 10+ structural sections (Volume, Funnel, Campaign Performance, Agent Performance, Root Cause Isolation, Top 3 Problems, Top 3 Opportunities, "If I Only Did 3 Things", Follow-Up Data Needed, Evidence Tables). The synthesis layer at `src/app/api/ai-analyst/insights/route.js` forces GPT-4o into an 8-bucket JSON schema with hard caps (anomalies/breaches/actions ≤3, themes/wins ≤2, examples ≤4). The rest of the report — evidence tables, root-cause isolation, quantified opportunity lifts, follow-up data requests — is dropped before it reaches the UI.

The raw markdown (`result.result_message`) is already fetched by the route; it is simply never surfaced to the client.

## Goals

1. Surface four high-value sections that currently have no UI slot: **Top Problems**, **Top Opportunities**, **Next Week Actions** (the "If I Only Did 3 Things" list), **Follow-Up Data Needed**.
2. Preserve markdown evidence tables verbatim, with zero LLM round-trip (no paraphrasing risk).
3. Expose the full raw report as a "Full Analysis" drill-down with a section-jump TOC, so nothing is truly lost — everything the agent wrote is reachable.
4. Do all of this within a single existing LLM call (no new cost).

## Non-goals

- Changing how Conversely generates reports.
- Changing the Daily Brief (`DailySummaryPage.jsx`) — same report feeds it, but separate work.
- Replacing the existing chip layout. The current headline / KPI / bucket flow stays exactly as it is.
- Adding a second LLM call or a more expensive model.

## Architecture

### Data flow (after change)

```
Conversely API
  └─ fetchLatestResultForAgent(agentId)
         returns { result_message, run_date, ... }

/api/ai-analyst/insights (route.js)
  ├─ 1. extractMarkdownTables(result_message) → [{ title, markdown }]  (pure regex, no LLM)
  ├─ 2. GPT-4o synthesis call with EXPANDED schema
  │     (input: result_message + priority list; output: structured buckets only —
  │      rawMarkdown is NOT asked from GPT, it's attached server-side after the call)
  └─ 3. response = { ...synthesisJson, evidenceTables, rawMarkdown }

InsightHero.jsx
  ├─ Headline / KPIs / Top Action         (unchanged)
  ├─ "All insights" expandable             (extended: 10 buckets instead of 6)
  └─ "Full Analysis" expandable            (NEW: TOC + rendered markdown)
```

### Why pre-extract tables

Markdown tables round-tripped through `JSON.stringify` → GPT → JSON output reliably suffer drift: alignment markers get stripped, cells get paraphrased, columns get reordered. Pre-extracting with a regex and attaching them *as strings* to the response, outside the LLM call, guarantees byte-perfect preservation.

## JSON schema changes

### Existing fields (unchanged shape)
`headline`, `kpis`, `topAction`, `anomalies`, `breaches`, `actions`, `themes`, `wins`, `examples`, `meta`.

### Existing field caps (raised)
- `anomalies`: 3 → 5
- `examples`: 4 → 6
- `themes`: 2 → 3
- `wins`: 2 → 3
- `breaches`, `actions`: unchanged (3 each — already the right size)

### New fields

```jsonc
{
  "topProblems": [
    { "rank": 1, "title": "...", "scope": "...", "evidence": "..." }
  ],  // max 3

  "topOpportunities": [
    { "rank": 1, "title": "...", "lift": "+1 sale, -$69 CPA", "evidence": "..." }
  ],  // max 3

  "nextWeekActions": [
    { "rank": 1, "action": "...", "evidence": "..." }
  ],  // max 3

  "followUpDataNeeded": [
    { "dataNeeded": "...", "why": "...", "currentEvidence": "..." }
  ],  // max 5

  "evidenceTables": [
    { "title": "Disposition Distribution — HIW", "markdown": "| ... |" }
  ],  // no cap — pass-through from the server-side extractor

  "rawMarkdown": "string — full result_message, verbatim"
}
```

The `evidenceTables` and `rawMarkdown` fields bypass the LLM. The GPT prompt does not ask for them; the server attaches them after the call returns.

### Prompt changes

The existing `CRITICAL RULES` block already says "Do NOT summarize away the agent's specific examples, names, quotes, or numbers." Extend it with:

- "For `topProblems`, `topOpportunities`, `nextWeekActions`, `followUpDataNeeded`: these correspond to explicit sections in the report. If the report contains a section titled "Top 3 Problems", "Top 3 Opportunities", "If I Only Did 3 Things Next Week", or "Follow-Up Data Needed" (or any clear variant), extract from that section. Do not invent items; return an empty array if the section is absent."
- "Preserve numeric evidence verbatim. `lift` in `topOpportunities` should carry the report's own quantification (e.g., '+1 sale, CPA $240 → $171')."

### Token budget

Current `max_tokens: 2000`. With 4 new buckets (max 3-5 items each, each item ~2-4 short strings), worst-case output grows ~600-900 tokens. Raise to `max_tokens: 3000`. We do *not* include `rawMarkdown` in the GPT output, so the biggest payload (the full report) never counts against output tokens.

## Markdown table extractor

Pure regex, no LLM:

```
Rules
- Detect blocks: line starting with `|`, followed by a `|---|---|...|` separator line, followed by ≥1 row.
- Capture an optional heading: the most recent line before the block matching `^#{1,4}\s+.+` or `^[A-Z].{0,80}$` within 5 lines back.
- Walk cells; strip surrounding whitespace but preserve the markdown string exactly.
- Skip orphan `|` lines (no separator).
- Require ≥2 rows (header + 1 data) to emit a table.
```

Implemented as a small helper in `insights/route.js`. Returns `[{ title: string | null, markdown: string }]` where `markdown` is the full table block, line breaks and all.

## UI changes — InsightHero.jsx

### New buckets in the existing `allOpen` panel

Four new `<Bucket>` components, each with an item renderer. Rendering mirrors the existing style (fontSize 11, muted evidence italic with `↳` prefix). Ordered:

1. ⚠ Anomalies *(existing)*
2. 🚨 Threshold Breaches *(existing)*
3. 🎯 Actions *(existing)*
4. 🔥 Top Problems *(NEW)* — rank prefix, title bold, scope chip, evidence
5. 💎 Top Opportunities *(NEW)* — rank prefix, title bold, lift chip (green), evidence
6. 📅 Next Week Actions *(NEW)* — rank prefix, action text, evidence
7. ❓ Follow-Up Data Needed *(NEW)* — data-needed bold, why muted, currentEvidence italic
8. 🔁 Sustained Themes *(existing)*
9. ✓ Wins *(existing)*
10. 💬 Examples & Quotes *(existing)*

Count summary line in the expandable header adds the four new counts.

### Full Analysis section

A second collapsible section below "All insights":

```
▶ Full Analysis · 11 sections · 8 tables
```

When expanded:
- Section TOC bar at top — each heading (extracted from `rawMarkdown`) becomes a clickable chip that scrolls the viewer to that heading.
- Rendered markdown body using `react-markdown` + `remark-gfm` (GFM gives us table rendering).
- Tables styled with the project's existing dark-theme palette (border `#1a2538`, header background `#0f1520`).
- Code-block and inline-code styling inherited from existing text formatter.

The TOC is built from the same `parseSections` logic already present in `src/app/api/ai-analyst/route.js:158`. Extract that function into a shared helper (e.g., `src/lib/parse-sections.js`) so both the server route and the new client-side Full Analysis viewer can import it. No behavior change to the existing caller.

## Dependency addition

`package.json` gains:
- `react-markdown` (latest, ~25KB gzipped)
- `remark-gfm` (latest, ~7KB gzipped — required for table rendering)

No other dependency impact. Both are maintained, widely used, and license-compatible.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| GPT output exceeds `max_tokens` with the new schema | Raise to 3000; the largest payload (`rawMarkdown`) is not asked from GPT |
| Table extractor misses tables with unusual whitespace | Defensive regex + require separator row; test against the pasted sample report |
| Markdown rendering breaks dashboard dark theme | Custom component overrides for `table`, `thead`, `td`, `code` matching existing `C.*` palette |
| `react-markdown` adds ~32KB to initial bundle | Dynamic import the Full Analysis viewer so it loads only when expanded |
| New buckets are empty when the report lacks those sections | Prompt rule: return empty array if the section is absent. Buckets with zero items don't render (existing `Bucket` short-circuits on empty) |

## Testing

- **Unit-level:** Extractor run against the sample Conversely report the user pasted; expect 8+ tables detected, each with exact byte-preservation.
- **Integration:** Hit `/api/ai-analyst/insights?category=sales_execution&force=1` against a live Conversely agent; verify response shape, non-empty new buckets, `evidenceTables.length > 0`, `rawMarkdown.length > 0`.
- **Visual:** Expand "All insights" — verify 10 buckets render in order, new buckets show rank/lift chips correctly. Expand "Full Analysis" — verify TOC jumps work, tables render with dark-theme styling, no layout breaks.
- **Regression:** Existing 6 buckets still render identically; headline/KPI/topAction block untouched.

## Out of scope (follow-up work)

- Same treatment for the Daily Brief (`DailySummaryPage.jsx`) — if this lands well, apply the same pattern there.
- Surfacing `result_data` from the Conversely API (still fetched by `fetchLatestByEntity` but not exposed through this pipeline). That's a separate negotiation with Conversely about structured payload stability.
- Persisting the expanded synthesis to a sheet or DB for historical analysis.

## Success criteria

- The "All insights" panel shows 10 sections instead of 6, with the four new sections populated for the sample report.
- Evidence tables render as HTML tables in the Full Analysis panel, byte-identical to the markdown Conversely produced.
- Total Conversely-report content visible in the UI goes from ~20-25% today to ≥95% (headline chips + full analysis combined).
- No regression: existing users' muscle memory (headline + chips) still works identically.
- LLM cost per pane load unchanged (same single GPT-4o call).
