# AI Analyst — Rich Conversely Report Extraction

**Date:** 2026-04-24
**Surface:** AI Analyst pane (`src/components/AiAnalystPane.jsx` + `src/components/InsightHero.jsx`)
**Problem owner:** Peter

## Problem

The AI Analyst pane renders a compressed synthesis of Conversely reports. Conversely produces rich markdown covering 10+ structural sections (Volume, Funnel, Campaign Performance, Agent Performance, Root Cause Isolation, Top 3 Problems, Top 3 Opportunities, "If I Only Did 3 Things", Follow-Up Data Needed, Evidence Tables). The synthesis layer at `src/app/api/ai-analyst/insights/route.js` forces GPT-4o into an 8-bucket JSON schema with hard caps (anomalies/breaches/actions ≤3, themes/wins ≤2, examples ≤4). The rest of the report — evidence tables, root-cause isolation, quantified opportunity lifts, follow-up data requests — is dropped before it reaches the UI. Additionally, the UI hides most buckets behind an "All insights" expandable, so even the limited content that *is* extracted requires a click to see.

The raw markdown (`result.result_message`) is already fetched by the route; it is simply never surfaced to the client.

## Goals

1. Surface four high-value sections that currently have no UI slot: **Top Problems**, **Top Opportunities**, **Next Week Actions** (the "If I Only Did 3 Things" list), **Follow-Up Data Needed**.
2. Preserve markdown evidence tables verbatim, with zero LLM round-trip (no paraphrasing risk).
3. Expose the full raw report with a section TOC so nothing the agent wrote is lost.
4. Render every section always-visible — no collapsibles, no expandables. The user wants to see the content without clicking.
5. Use typography (not icons) to distinguish section titles from subpoints.
6. Return every item present in the report — no artificial caps on problems, opportunities, actions, examples, etc.
7. Do all of this within a single existing LLM call (no new cost beyond a larger `max_tokens`).

## Non-goals

- Changing how Conversely generates reports.
- Changing the Daily Brief (`DailySummaryPage.jsx`) — same report feeds it, but separate work.
- Adding a second LLM call or a more expensive model.

## Architecture

### Data flow (after change)

```
Conversely API
  └─ fetchLatestResultForAgent(agentId)
         returns { result_message, run_date, ... }

/api/ai-analyst/insights (route.js)
  ├─ 1. extractMarkdownTables(result_message) → [{ title, markdown }]  (pure regex, no LLM)
  ├─ 2. GPT-4o synthesis call with EXPANDED schema, NO item caps
  │     (input: result_message + priority list; output: structured buckets only —
  │      rawMarkdown is NOT asked from GPT, it's attached server-side after the call)
  └─ 3. response = { ...synthesisJson, evidenceTables, rawMarkdown }

InsightHero.jsx
  ├─ Headline block             (always visible)
  ├─ KPI row + Top Action       (always visible)
  ├─ Ten bucket sections        (always visible, stacked, no expandable wrapper)
  └─ Full Analysis section      (always visible: TOC + rendered markdown)
```

### Why pre-extract tables

Markdown tables round-tripped through `JSON.stringify` → GPT → JSON output reliably suffer drift: alignment markers get stripped, cells get paraphrased, columns get reordered. Pre-extracting with a regex and attaching them *as strings* to the response, outside the LLM call, guarantees byte-perfect preservation.

### Why remove item caps

The Conversely report for the sample day contains 3 problems, 3 opportunities, 3 next-week actions, 4 follow-up items, and 8 evidence tables. Future reports may contain more (some dense days may produce 5+ problems, 6+ examples, 10+ evidence tables). Capping discards signal the analyst intentionally flagged. The prompt instructs GPT to **return every item present** in the report without selection or paraphrase compression. The only natural limit is "the report didn't write more."

## JSON schema changes

### Existing fields (shape unchanged)
`headline`, `kpis`, `topAction`, `anomalies`, `breaches`, `actions`, `themes`, `wins`, `examples`, `meta`.

### Existing field caps (removed)
All per-bucket caps are removed. `anomalies`, `breaches`, `actions`, `themes`, `wins`, `examples` each return every item the report contains.

`kpis` keeps a soft cap of 6 for layout reasons — the KPI row is a fixed horizontal band and more than ~6 values wraps awkwardly. Top KPIs chosen by the LLM; the rest appear in the Full Analysis section.

### New fields

```jsonc
{
  "topProblems": [
    { "rank": 1, "title": "...", "scope": "...", "evidence": "..." }
  ],  // NO CAP — return all problems the report identifies

  "topOpportunities": [
    { "rank": 1, "title": "...", "lift": "+1 sale, -$69 CPA", "evidence": "..." }
  ],  // NO CAP

  "nextWeekActions": [
    { "rank": 1, "action": "...", "evidence": "..." }
  ],  // NO CAP

  "followUpDataNeeded": [
    { "dataNeeded": "...", "why": "...", "currentEvidence": "..." }
  ],  // NO CAP

  "evidenceTables": [
    { "title": "Disposition Distribution — HIW", "markdown": "| ... |" }
  ],  // NO CAP — pass-through from the server-side extractor

  "rawMarkdown": "string — full result_message, verbatim"
}
```

The `evidenceTables` and `rawMarkdown` fields bypass the LLM. The GPT prompt does not ask for them; the server attaches them after the call returns.

### Prompt changes

Extend the existing `CRITICAL RULES` block with:

- "For every array field (`anomalies`, `breaches`, `actions`, `topProblems`, `topOpportunities`, `nextWeekActions`, `followUpDataNeeded`, `themes`, `wins`, `examples`): return every item the report contains. Do not cap, select, or merge items to save space. If the report has 7 problems, return 7. If it has 12 examples, return 12."
- "For `topProblems`, `topOpportunities`, `nextWeekActions`, `followUpDataNeeded`: these correspond to explicit sections in the report. If the report contains a section titled 'Top 3 Problems', 'Top 3 Opportunities', 'If I Only Did 3 Things Next Week', or 'Follow-Up Data Needed' (or any clear variant), extract every item from that section. Do not invent items; return an empty array if the section is absent."
- "Preserve numeric evidence verbatim. `lift` in `topOpportunities` should carry the report's own quantification (e.g., '+1 sale, CPA $240 → $171')."

### Token budget

Current `max_tokens: 2000`. With caps removed and new buckets added, worst-case output on a dense report could reach ~5000-6000 tokens. Raise to `max_tokens: 8000` (well within `gpt-4o`'s 16K output ceiling). `rawMarkdown` is not included in the GPT output — it's attached server-side — so the largest payload does not count against output tokens.

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

### Remove the expandable wrappers

- Delete the `allOpen` / `setAllOpen` state and the `▶ All insights` toggle.
- Delete the `Full Analysis ▶` toggle.
- Every section below the headline renders inline, stacked vertically.

### Remove all emoji icons

Current bucket titles ("⚠ Anomalies", "🎯 Actions", "✓ Wins", "💬 Examples & Quotes") drop their emoji prefix. The headline severity-strip indicator at the top (`⚠ / ◐ / ✓ Today's Headline`) also drops its emoji — replaced with a text label like "HEADLINE — RED" / "HEADLINE — YELLOW" / "HEADLINE — GREEN" rendered in the severity color.

### Typography system (distinguish title from subpoints)

The current render uses the same 11px font for both bucket titles and items, which flattens the hierarchy. New scale:

| Element | Style |
|---|---|
| **Section heading** (e.g., "TOP PROBLEMS") | 13px, weight 800, uppercase, letter-spacing 1.2, color `C.accent` (`#5b9fff`), bottom border `1px solid C.border`, padding-bottom 6px, margin-top 20px |
| **Item title** (e.g., "Weak close after quote — S/Q 25%") | 13px, weight 700, color `C.text`, font-family `C.sans`, line-height 1.45, margin-bottom 4px |
| **Item rank prefix** (when present) | Inline, 12px, weight 800, color `C.accent`, font-family `C.mono`, margin-right 8px |
| **Item subpoint** (scope, lift, daysObserved, etc.) | 11px, weight 600, color `C.muted`, margin-bottom 3px |
| **Item evidence** (the `↳` line) | 12px, weight 400, color `C.text` at 0.85 opacity, line-height 1.5, padding-left 16px, no italic, border-left `2px solid C.border` for visual indent |
| **Inter-item spacing** | 14px vertical gap between items within a bucket |
| **Inter-section spacing** | 28px vertical gap between bucket sections |

The italic styling on evidence is removed — italic softens readability on long multi-line strings. The `↳` prefix, border-left indent, and opacity shift carry the "this is supporting detail" cue instead.

### Bucket order (top to bottom, all always-visible)

1. Anomalies
2. Threshold Breaches
3. Top Problems *(new)*
4. Top Opportunities *(new)*
5. Actions
6. Next Week Actions *(new)*
7. Follow-Up Data Needed *(new)*
8. Sustained Themes
9. Wins
10. Examples & Quotes

Empty buckets auto-hide (the existing `Bucket` component already returns `null` on empty `items`).

### Full Analysis section

Below the ten buckets, always visible:

- Section heading: "FULL ANALYSIS" styled identically to bucket headings.
- Secondary line (11px muted): `{n} sections · {m} evidence tables`.
- TOC row: chips of section headings extracted from `rawMarkdown`. Clicking a chip scrolls the markdown body to that heading.
- Rendered markdown body: `react-markdown` + `remark-gfm`. Tables styled with the project's dark-theme palette (border `#1a2538`, header background `#0f1520`, zebra rows optional).
- Max-width constraint on the markdown container to keep long lines readable.

The TOC uses the `parseSections` logic already present in `src/app/api/ai-analyst/route.js:158`. Extract into a shared helper (e.g., `src/lib/parse-sections.js`) so both the server route and the client viewer can import it.

## Scope — every category

The AI Analyst pane renders `<InsightHero category={...} />` for 8 categories (`funnel_analyzer`, `lead_quality`, `volume_capacity`, `sales_execution`, `profitability`, `funnel_health`, `mix_product`, `agent_deep_dive`). Because `InsightHero` is a single shared component consuming a common JSON shape, every change in this spec applies uniformly to all 8 categories. No per-category branching.

## Dependency addition

`package.json` gains:
- `react-markdown` (latest)
- `remark-gfm` (latest — required for table rendering)

Both are maintained, widely used, and license-compatible. Dynamic import the Full Analysis viewer so the markdown runtime (~32KB gzipped combined) loads only when an InsightHero is visible.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| GPT output exceeds `max_tokens` | Raised to 8000; `rawMarkdown` excluded from GPT output |
| Page becomes very long with all sections always open | Expected — the user explicitly wants this. Generous section spacing (28px) and clear typography hierarchy make scrolling navigable |
| Table extractor misses unusual whitespace | Defensive regex + required separator row; test against the sample report |
| Markdown renderer breaks dashboard dark theme | Custom component overrides for `table`/`thead`/`td`/`code`/`h1-h6`/`ul` matching existing `C.*` palette |
| Empty buckets clutter layout | `Bucket` short-circuits on empty items — no empty section renders |

## Testing

- **Unit:** Extractor run against the sample Conversely report; expect 8+ tables detected with byte-preservation.
- **Integration:** Hit `/api/ai-analyst/insights?category=sales_execution&force=1`; verify response shape, non-empty new buckets, no item truncation vs. the report's own counts.
- **Visual:** Open the AI Analyst pane for each of the 8 categories. Confirm no icons, no expandables, every bucket visible, typography scale matches spec, empty buckets absent. Confirm Full Analysis TOC jumps work and tables render.
- **Regression:** Headline / KPI / Top Action block still renders with the same data it does today.

## Out of scope (follow-up work)

- Same treatment for the Daily Brief (`DailySummaryPage.jsx`).
- Surfacing `result_data` from the Conversely API (still fetched by `fetchLatestByEntity` but not exposed through this pipeline). Separate negotiation with Conversely about structured payload stability.
- Persisting the expanded synthesis to a sheet or DB for historical analysis.

## Success criteria

- Every one of the 10 bucket sections renders inline, always visible, no click required.
- No emoji icons appear in bucket or section headings.
- Typography clearly distinguishes section heading > item title > item subpoint > item evidence.
- When the sample report lists 3 problems, the pane shows 3; if a future report lists 7, the pane shows 7 — no caps.
- Evidence tables render byte-identical to the markdown Conversely produced, for every category.
- Total Conversely-report content visible in the UI approaches 100% (headline + all buckets + full analysis combined).
- LLM cost per pane load unchanged (same single GPT-4o call, just a larger `max_tokens` ceiling).
