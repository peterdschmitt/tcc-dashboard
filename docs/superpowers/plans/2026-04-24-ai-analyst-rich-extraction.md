# AI Analyst Rich Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the AI Analyst pane to surface the full qualitative depth of Conversely reports — all structural sections, evidence tables, opportunity math, follow-up questions — rendered always-visible with typography hierarchy (no icons, no collapsibles, no item caps).

**Architecture:** Server-side, pre-extract markdown tables with regex (bypasses LLM for fidelity) and expand the GPT-4o synthesis schema with 4 new buckets plus uncapped item arrays. Client-side, remove the `allOpen` collapsible wrapper, drop emoji icons, apply a four-tier typography scale, and render a new "Full Analysis" section with `react-markdown` + `remark-gfm`.

**Tech Stack:** Next.js 14 App Router, React, OpenAI SDK (GPT-4o), Conversely external API, `react-markdown`, `remark-gfm`.

**Note on testing:** This project has no test framework (no Jest/Vitest/Mocha installed; no `*.test.*` files). Verification uses small Node scripts for pure functions (run via `node script.mjs`) and the dev server + `curl`/browser for integration. Do NOT introduce a test runner as part of this work — it's out of scope.

---

## File Structure

**Create:**
- `src/lib/parse-sections.js` — shared helper (extracted from `ai-analyst/route.js`) used by both server route and client viewer
- `src/lib/extract-markdown-tables.js` — regex-based table extractor (pure, no LLM)
- `src/components/FullAnalysis.jsx` — always-visible Full Analysis section: TOC chips + `react-markdown` body with dark-theme component overrides

**Modify:**
- `package.json` — add `react-markdown`, `remark-gfm`
- `src/app/api/ai-analyst/route.js` — replace inline `parseSections` with import from `src/lib/parse-sections.js` (behavior unchanged)
- `src/app/api/ai-analyst/insights/route.js` — expanded JSON schema (4 new buckets, uncapped arrays), pre-extract tables, attach `rawMarkdown` + `evidenceTables` to response, raise `max_tokens` to 8000
- `src/components/InsightHero.jsx` — remove `allOpen` collapsible, remove emoji icons, apply typography scale, add 4 new bucket renderers, mount `<FullAnalysis>` at the bottom

---

## Task 1: Add markdown dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install deps**

Run:
```bash
cd /Users/peterschmitt/Downloads/tcc-dashboard && npm install react-markdown remark-gfm
```

Expected output: `added N packages`, no errors. If a peer-dependency warning about React 18 appears for `react-markdown`, that's OK — both packages support React 18.

- [ ] **Step 2: Verify versions landed in package.json**

Run:
```bash
grep -E "react-markdown|remark-gfm" /Users/peterschmitt/Downloads/tcc-dashboard/package.json
```

Expected output: two lines showing the new deps with versions, e.g. `"react-markdown": "^9.x.x"` and `"remark-gfm": "^4.x.x"`.

- [ ] **Step 3: Commit**

```bash
cd /Users/peterschmitt/Downloads/tcc-dashboard
git add package.json package-lock.json
git commit -m "chore: add react-markdown + remark-gfm for rich Conversely report rendering"
```

---

## Task 2: Extract `parseSections` into shared helper

**Files:**
- Create: `src/lib/parse-sections.js`
- Modify: `src/app/api/ai-analyst/route.js` (remove inline function, import from lib)
- Create: `scripts/smoke-parse-sections.mjs` (temporary verification script; delete after Task 8)

- [ ] **Step 1: Write the smoke script first (fails until Step 2 lands)**

Create `scripts/smoke-parse-sections.mjs`:

```javascript
import { parseSections } from '../src/lib/parse-sections.js';

const input = `# Section One

Some content.

## Section Two

More.

**BOLD HEADING**

Content.

3) Numbered Section

Stuff.`;

const out = parseSections(input);
console.log(JSON.stringify(out, null, 2));

const titles = out.map(s => s.title);
const expected = ['Section One', 'Section Two', 'BOLD HEADING', 'Numbered Section'];
const ok = expected.every(t => titles.includes(t));
if (!ok) {
  console.error('FAIL — missing titles. Got:', titles);
  process.exit(1);
}
console.log('PASS');
```

- [ ] **Step 2: Run smoke script to confirm it fails (module not found)**

Run:
```bash
cd /Users/peterschmitt/Downloads/tcc-dashboard && node scripts/smoke-parse-sections.mjs
```

Expected: error about `Cannot find module '../src/lib/parse-sections.js'`.

- [ ] **Step 3: Create `src/lib/parse-sections.js`**

Copy the `parseSections` function from `src/app/api/ai-analyst/route.js` (currently at line 158) into a new file:

```javascript
export function parseSections(content) {
  if (!content) return [];

  const lines = content.split('\n');
  const sections = [];
  let charIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.length > 0) {
      let sectionTitle = null;

      const mdMatch = trimmed.match(/^#{1,3}\s+(.+)/);
      if (mdMatch) {
        sectionTitle = mdMatch[1].trim();
      }

      if (!sectionTitle) {
        const boldMatch = trimmed.match(/^\*\*(.+?)\*\*$/);
        if (boldMatch) {
          sectionTitle = boldMatch[1].trim();
        }
      }

      if (!sectionTitle) {
        const numMatch = trimmed.match(/^\d+[.)]\s+(.+)/);
        if (numMatch && trimmed.length < 80) {
          sectionTitle = numMatch[1].trim();
        }
      }

      if (!sectionTitle && trimmed.length >= 3 && trimmed.length < 80) {
        const stripped = trimmed.replace(/[^a-zA-Z\s]/g, '').trim();
        if (stripped.length >= 3 && stripped === stripped.toUpperCase() && /[A-Z]/.test(stripped)) {
          sectionTitle = trimmed;
        }
      }

      if (!sectionTitle && trimmed.length < 80 && trimmed.length >= 3) {
        if (trimmed.endsWith(':') && !trimmed.includes(',')) {
          sectionTitle = trimmed.replace(/:$/, '').trim();
        }
      }

      if (sectionTitle) {
        sectionTitle = sectionTitle.replace(/[#*_]/g, '').trim();
        if (sectionTitle.length > 0) {
          sections.push({
            id: `section-${sections.length}`,
            title: sectionTitle,
            startIndex: charIndex,
          });
        }
      }
    }

    charIndex += line.length + 1;
  }

  return sections;
}
```

- [ ] **Step 4: Re-run smoke script to confirm PASS**

Run:
```bash
cd /Users/peterschmitt/Downloads/tcc-dashboard && node scripts/smoke-parse-sections.mjs
```

Expected: final line `PASS`.

- [ ] **Step 5: Replace inline function in the route with an import**

In `src/app/api/ai-analyst/route.js`:

1. At the top of the imports (around line 1-12), add:
   ```javascript
   import { parseSections } from '@/lib/parse-sections';
   ```
2. Delete the inline `parseSections` function block (currently lines 158-220). Keep a blank line where it was.

- [ ] **Step 6: Verify the route still compiles**

Run:
```bash
cd /Users/peterschmitt/Downloads/tcc-dashboard && npm run build 2>&1 | tail -30
```

Expected: build completes without errors. (First build may take 30-60s.) If you see `Module not found: Can't resolve '@/lib/parse-sections'`, verify the file path and the `@/*` alias in `jsconfig.json`/`tsconfig.json`.

- [ ] **Step 7: Commit**

```bash
cd /Users/peterschmitt/Downloads/tcc-dashboard
git add src/lib/parse-sections.js src/app/api/ai-analyst/route.js scripts/smoke-parse-sections.mjs
git commit -m "refactor: extract parseSections into src/lib for reuse"
```

---

## Task 3: Build markdown table extractor

**Files:**
- Create: `src/lib/extract-markdown-tables.js`
- Create: `scripts/smoke-extract-tables.mjs` (temporary; delete after Task 8)

- [ ] **Step 1: Write the smoke script first**

Create `scripts/smoke-extract-tables.mjs`:

```javascript
import { extractMarkdownTables } from '../src/lib/extract-markdown-tables.js';

const sample = `# Sample Report

Some prose here.

## Campaign Performance

| Campaign | Calls | Sales |
|---|---:|---:|
| HIW | 45 | 3 |
| HT FEX | 2 | 0 |

More prose.

Disposition Distribution (campaign-level)

| Disposition | Count | % |
|---|---:|---:|
| Sale | 3 | 6.67% |
| Quote Only | 9 | 20.00% |
| Bad Transfer | 9 | 20.00% |

Final prose paragraph.
`;

const tables = extractMarkdownTables(sample);
console.log(JSON.stringify(tables, null, 2));

if (tables.length !== 2) {
  console.error(`FAIL — expected 2 tables, got ${tables.length}`);
  process.exit(1);
}
if (!tables[0].markdown.includes('| HIW | 45 | 3 |')) {
  console.error('FAIL — first table missing HIW row verbatim');
  process.exit(1);
}
if (!tables[1].markdown.includes('| Bad Transfer | 9 | 20.00% |')) {
  console.error('FAIL — second table missing Bad Transfer row verbatim');
  process.exit(1);
}
if (tables[0].title !== 'Campaign Performance') {
  console.error(`FAIL — first table title expected "Campaign Performance", got "${tables[0].title}"`);
  process.exit(1);
}
if (tables[1].title !== 'Disposition Distribution (campaign-level)') {
  console.error(`FAIL — second table title expected "Disposition Distribution (campaign-level)", got "${tables[1].title}"`);
  process.exit(1);
}
console.log('PASS');
```

- [ ] **Step 2: Run smoke script to confirm it fails (module not found)**

Run:
```bash
cd /Users/peterschmitt/Downloads/tcc-dashboard && node scripts/smoke-extract-tables.mjs
```

Expected: error about `Cannot find module '../src/lib/extract-markdown-tables.js'`.

- [ ] **Step 3: Implement the extractor**

Create `src/lib/extract-markdown-tables.js`:

```javascript
// Detect and extract markdown tables from a string, preserving byte-exact content.
// A "table" is a line starting with `|`, followed immediately by a separator
// line (e.g., |---|---|), followed by one or more data rows starting with `|`.

const SEP_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/;

function lineStartsTableRow(line) {
  return line.trim().startsWith('|');
}

function findTitleBackFrom(lines, start) {
  // Walk backwards up to 5 non-empty lines looking for a plausible title.
  // Accepts: markdown heading (# / ##), bold (**...**), or a short capitalized
  // standalone line. Stops at the first non-empty, non-title line.
  let stepsBack = 0;
  for (let i = start - 1; i >= 0 && stepsBack < 5; i--) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t) continue;
    stepsBack++;

    const mdMatch = t.match(/^#{1,4}\s+(.+)$/);
    if (mdMatch) return mdMatch[1].trim();

    const boldMatch = t.match(/^\*\*(.+?)\*\*$/);
    if (boldMatch) return boldMatch[1].trim();

    if (t.length < 120 && /^[A-Z(]/.test(t) && !t.includes('|') && !t.endsWith('.')) {
      return t.replace(/[:.]+$/, '').trim();
    }
    // First non-empty, non-title line → stop searching.
    return null;
  }
  return null;
}

export function extractMarkdownTables(markdown) {
  if (!markdown || typeof markdown !== 'string') return [];
  const lines = markdown.split('\n');
  const tables = [];
  let i = 0;

  while (i < lines.length) {
    if (!lineStartsTableRow(lines[i])) {
      i++;
      continue;
    }
    const sepIdx = i + 1;
    if (sepIdx >= lines.length || !SEP_RE.test(lines[sepIdx])) {
      i++;
      continue;
    }

    let end = sepIdx + 1;
    while (end < lines.length && lineStartsTableRow(lines[end])) end++;

    if (end - sepIdx < 2) {
      i++;
      continue;
    }

    const title = findTitleBackFrom(lines, i);
    const tableMarkdown = lines.slice(i, end).join('\n');
    tables.push({ title, markdown: tableMarkdown });
    i = end;
  }

  return tables;
}
```

- [ ] **Step 4: Re-run smoke script to confirm PASS**

Run:
```bash
cd /Users/peterschmitt/Downloads/tcc-dashboard && node scripts/smoke-extract-tables.mjs
```

Expected: final line `PASS`.

- [ ] **Step 5: Commit**

```bash
cd /Users/peterschmitt/Downloads/tcc-dashboard
git add src/lib/extract-markdown-tables.js scripts/smoke-extract-tables.mjs
git commit -m "feat: add markdown table extractor for lossless evidence preservation"
```

---

## Task 4: Expand insights API JSON schema (no caps, new buckets, raw passthrough)

**Files:**
- Modify: `src/app/api/ai-analyst/insights/route.js`

- [ ] **Step 1: Add the import for the table extractor**

At the top of `src/app/api/ai-analyst/insights/route.js`, add after the existing imports:

```javascript
import { extractMarkdownTables } from '@/lib/extract-markdown-tables';
```

- [ ] **Step 2: Replace `buildSystemPrompt()` with the expanded version**

Replace the entire `buildSystemPrompt()` function (currently lines 32-82) with:

```javascript
function buildSystemPrompt() {
  return `You are a synthesis layer over a CONVERSELY.AI analyst report. Your job is to extract the report's findings into a structured JSON object — preserving the qualitative depth, examples, and verbatim evidence the agent already wrote.

CRITICAL RULES
- Do NOT summarize away the agent's specific examples, names, quotes, or numbers. Carry them through verbatim or near-verbatim into the "evidence" field of each item.
- Do NOT invent insights that aren't in the report. If a bucket has nothing, return an empty array.
- The "headline" must reference the highest-ranked priority item that has strong signal in today's report. Severity-override items (marked OVERRIDE in the priority list) jump the queue when present.
- Down-weight any insight whose underlying segment has fewer than ~5 billable calls.
- Prefer specifics over generalities ("HIW × Michael close rate 17% vs HIW × Kari 39% — same campaign, different outcome" beats "rep performance varies").

RETURN EVERY ITEM THE REPORT CONTAINS
For every array field below (anomalies, breaches, actions, topProblems, topOpportunities, nextWeekActions, followUpDataNeeded, themes, wins, examples): return every item the report contains. Do NOT cap, do NOT select a "top N", do NOT merge items to save space. If the report has 7 problems, return 7. If it has 12 examples, return 12. Only the "kpis" array has a soft cap of 6 for layout reasons.

SECTION MAPPING
For topProblems, topOpportunities, nextWeekActions, followUpDataNeeded: these correspond to explicit sections in the report. If the report contains a section titled "Top 3 Problems", "Top 3 Opportunities", "If I Only Did 3 Things Next Week", or "Follow-Up Data Needed" (or any clear variant of these — the number in the title may differ), extract every item from that section. Do not invent items; return an empty array if the section is absent.

PRESERVE NUMERIC EVIDENCE VERBATIM
The "lift" field in topOpportunities should carry the report's own quantification, e.g. "+1 sale, CPA $240 → $171 (-$69)". The "evidence" fields should carry specific numbers, names, and segment breakdowns verbatim from the report.

OUTPUT SHAPE — return STRICT JSON matching exactly:
{
  "headline": {
    "text": "string — one sentence (max ~30 words). Lead with the SPECIFIC finding, then the implication.",
    "severity": "red" | "yellow" | "green" | "info",
    "priorityRank": 1-8,
    "priorityMatched": "string — copy the priority item label that this headline ties to",
    "wasOverride": boolean
  },
  "kpis": [
    { "label": "string (≤8 chars)", "value": "string with unit", "trend": "up" | "down" | null }
  ],
  "topAction": "string — single most actionable next step (max ~20 words)",
  "anomalies": [
    { "text": "string — what's anomalous", "severity": "red" | "yellow" | "info", "evidence": "string — verbatim or near-verbatim from the report. Include numbers, names, segment." }
  ],
  "breaches": [
    { "text": "string — which threshold was crossed", "severity": "red" | "yellow", "evidence": "string — actual vs goal with specifics" }
  ],
  "actions": [
    { "text": "string — imperative action", "rank": 1-3, "evidence": "string — why this action, citing the report's reasoning" }
  ],
  "topProblems": [
    { "rank": 1, "title": "string — the problem statement", "scope": "string — e.g. 'Overall' or 'HIW' or 'Michael P'", "evidence": "string — verbatim evidence from the report" }
  ],
  "topOpportunities": [
    { "rank": 1, "title": "string — the opportunity", "lift": "string — quantified delta from the report, e.g. '+1 sale, CPA $240 → $171'", "evidence": "string — verbatim evidence" }
  ],
  "nextWeekActions": [
    { "rank": 1, "action": "string — the actionable next step", "evidence": "string — why this is the next step, citing the report" }
  ],
  "followUpDataNeeded": [
    { "dataNeeded": "string — what additional data is needed", "why": "string — why it matters", "currentEvidence": "string — what in today's report signals this gap" }
  ],
  "themes": [
    { "text": "string — the recurring theme", "daysObserved": number | null, "evidence": "string — examples or quotes that illustrate the theme" }
  ],
  "wins": [
    { "text": "string — what's working", "evidence": "string — specifics from the report" }
  ],
  "examples": [
    { "type": "quote" | "case" | "archetype", "text": "string — verbatim quote, case description, or archetype name", "context": "string — what makes this notable" }
  ]
}

LIMITS
- kpis: max 6 (soft cap for layout)
- All other arrays: NO CAP. Return every item the report contains.

Return ONLY the JSON. No markdown fences, no commentary.`;
}
```

- [ ] **Step 3: Raise `max_tokens` in the GPT call**

In the same file, locate the `openai.chat.completions.create` call (currently around lines 119-130). Change `max_tokens: 2000` to `max_tokens: 8000`. The final call block should read:

```javascript
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildUserMessage({
        category, date, todayReport: result.result_message, priorityList,
      }) },
    ],
    temperature: 0.2,
    max_tokens: 8000,
  });
```

- [ ] **Step 4: Attach `evidenceTables` and `rawMarkdown` to the response**

In the same file, locate the `return { ...parsed, meta: {...} }` block at the end of `runSynthesis()` (currently around lines 141-153). Replace the return with:

```javascript
  const evidenceTables = extractMarkdownTables(result.result_message);

  return {
    ...parsed,
    evidenceTables,
    rawMarkdown: result.result_message,
    meta: {
      source: 'conversely',
      agentId,
      date,
      runDate: result.run_date,
      synthesisMs,
      rawReportLength: result.result_message.length,
      evidenceTableCount: evidenceTables.length,
      modelUsed: 'gpt-4o',
    },
  };
```

- [ ] **Step 5: Update the no-report fallback to include new empty fields**

In the same file, locate the early-return when `!result || !result.result_message` (currently lines 103-112). Replace with:

```javascript
  if (!result || !result.result_message) {
    return {
      headline: {
        text: `No report available from ${category} agent for ${date}.`,
        severity: 'info', priorityRank: null, priorityMatched: null, wasOverride: false,
      },
      kpis: [], topAction: null, anomalies: [], breaches: [],
      actions: [], themes: [], wins: [], examples: [],
      topProblems: [], topOpportunities: [], nextWeekActions: [], followUpDataNeeded: [],
      evidenceTables: [], rawMarkdown: '',
      meta: { source: 'no-report', agentId, date },
    };
  }
```

- [ ] **Step 6: Build and verify the route compiles**

Run:
```bash
cd /Users/peterschmitt/Downloads/tcc-dashboard && npm run build 2>&1 | tail -20
```

Expected: build completes without errors.

- [ ] **Step 7: Integration-test the route against a live Conversely agent**

Start the dev server in a separate terminal (or background):
```bash
cd /Users/peterschmitt/Downloads/tcc-dashboard && npm run dev
```

Wait for `Ready in X.Xs`. Then in another terminal:
```bash
curl -s "http://localhost:3000/api/ai-analyst/insights?category=sales_execution&force=1" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('Keys:', sorted(d.keys()))
print('evidenceTables count:', len(d.get('evidenceTables') or []))
print('rawMarkdown length:', len(d.get('rawMarkdown') or ''))
print('topProblems count:', len(d.get('topProblems') or []))
print('topOpportunities count:', len(d.get('topOpportunities') or []))
print('nextWeekActions count:', len(d.get('nextWeekActions') or []))
print('followUpDataNeeded count:', len(d.get('followUpDataNeeded') or []))
print('anomalies count:', len(d.get('anomalies') or []))
print('examples count:', len(d.get('examples') or []))
if d.get('evidenceTables'):
    print('First table title:', d['evidenceTables'][0].get('title'))
    print('First table starts:', (d['evidenceTables'][0].get('markdown') or '')[:80])
"
```

Expected: all expected keys present, `evidenceTables count` > 0, `rawMarkdown length` > 500, and at least one of the new buckets non-empty (assumes Conversely returned a current report for that category). If all buckets are empty and `rawMarkdown` is non-empty, the prompt change may not have taken effect — re-check Step 2. If the request 503s with "CONVERSELY_API_BASE_URL and CONVERSELY_API_KEY must be set", configure those env vars in `.env.local` before retrying.

- [ ] **Step 8: Commit**

```bash
cd /Users/peterschmitt/Downloads/tcc-dashboard
git add src/app/api/ai-analyst/insights/route.js
git commit -m "feat(insights): expand schema with 4 new buckets, uncap arrays, pass through raw markdown + evidence tables"
```

---

## Task 5: Rewrite `InsightHero.jsx` — remove collapsibles, remove icons, apply typography scale

**Files:**
- Modify: `src/components/InsightHero.jsx`

- [ ] **Step 1: Replace the entire file contents**

Overwrite `src/components/InsightHero.jsx` with:

```javascript
'use client';
import { useState, useEffect, lazy, Suspense } from 'react';

const FullAnalysis = lazy(() => import('./FullAnalysis'));

const C = {
  bg: '#080b10', surface: '#0f1520', card: '#131b28', border: '#1a2538',
  text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff',
  green: '#4ade80', greenDim: '#0a2e1a',
  yellow: '#facc15', yellowDim: '#2e2a0a',
  red: '#f87171', redDim: '#2e0a0a',
  mono: "'SF Mono', 'Fira Code', monospace",
  sans: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
};

const SEVERITY_COLOR = {
  red: { bar: C.red, label: C.red, dim: C.redDim },
  yellow: { bar: C.yellow, label: C.yellow, dim: C.yellowDim },
  green: { bar: C.green, label: C.green, dim: C.greenDim },
  info: { bar: C.accent, label: C.accent, dim: C.accent + '22' },
};

// ────────────── Typography tokens ──────────────
const T = {
  sectionHeading: {
    fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2,
    color: C.accent, fontFamily: C.sans,
    borderBottom: `1px solid ${C.border}`, paddingBottom: 6,
    marginTop: 28, marginBottom: 12,
  },
  itemTitle: {
    fontSize: 13, fontWeight: 700, color: C.text, fontFamily: C.sans,
    lineHeight: 1.45, marginBottom: 4,
  },
  itemRank: {
    display: 'inline-block', fontSize: 12, fontWeight: 800,
    color: C.accent, fontFamily: C.mono, marginRight: 8,
  },
  itemSubpoint: {
    fontSize: 11, fontWeight: 600, color: C.muted,
    fontFamily: C.sans, marginBottom: 3,
  },
  itemEvidence: {
    fontSize: 12, fontWeight: 400, color: C.text,
    fontFamily: C.sans, lineHeight: 1.5,
    paddingLeft: 12, marginLeft: 4, marginTop: 4,
    borderLeft: `2px solid ${C.border}`,
    opacity: 0.88,
  },
  item: { marginBottom: 14 },
};

function Chip({ text, severity }) {
  const sev = SEVERITY_COLOR[severity] || SEVERITY_COLOR.info;
  return (
    <span style={{
      display: 'inline-block', padding: '1px 6px', borderRadius: 3,
      fontSize: 9, fontWeight: 600, fontFamily: C.mono,
      background: sev.dim, color: sev.label, marginLeft: 6, whiteSpace: 'nowrap',
    }}>{text}</span>
  );
}

function Skeleton() {
  return (
    <div style={{ background: C.card, borderLeft: `4px solid ${C.border}`, borderRadius: 6, padding: '14px 16px', marginBottom: 16 }}>
      <div style={{ height: 10, background: C.border, borderRadius: 3, width: 120, marginBottom: 8 }} />
      <div style={{ height: 18, background: C.border, borderRadius: 3, width: '85%', marginBottom: 6 }} />
      <div style={{ height: 18, background: C.border, borderRadius: 3, width: '60%' }} />
      <div style={{ marginTop: 14, color: C.muted, fontSize: 11, fontFamily: C.mono }}>
        Synthesizing insights from today's report…
      </div>
    </div>
  );
}

function Bucket({ title, items, render }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <div style={T.sectionHeading}>{title}</div>
      <div>
        {items.map((it, i) => <div key={i} style={T.item}>{render(it)}</div>)}
      </div>
    </div>
  );
}

export default function InsightHero({ category, date }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!category) return;
    setLoading(true);
    setError(null);
    setData(null);

    const url = `/api/ai-analyst/insights?category=${encodeURIComponent(category)}${date ? `&date=${encodeURIComponent(date)}` : ''}`;
    fetch(url)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); setData(null); }
        else setData(d);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [category, date]);

  if (loading) return <Skeleton />;
  if (error) {
    return (
      <div style={{ background: C.card, borderLeft: `4px solid ${C.muted}`, borderRadius: 6, padding: '12px 14px', marginBottom: 16, color: C.muted, fontSize: 11 }}>
        Insight synthesis unavailable: {error}
      </div>
    );
  }
  if (!data || !data.headline) return null;

  const sev = SEVERITY_COLOR[data.headline.severity] || SEVERITY_COLOR.info;
  const headlineLabel =
    data.headline.severity === 'red' ? 'HEADLINE — RED'
    : data.headline.severity === 'yellow' ? 'HEADLINE — YELLOW'
    : data.headline.severity === 'green' ? 'HEADLINE — GREEN'
    : 'HEADLINE';

  return (
    <div style={{
      background: C.card, borderLeft: `4px solid ${sev.bar}`,
      borderRadius: 6, padding: '18px 20px', marginBottom: 16,
      position: 'relative', fontFamily: C.sans,
    }}>
      {/* Headline block */}
      <div style={{ position: 'absolute', top: 14, right: 16, display: 'flex', gap: 4, alignItems: 'center' }}>
        <button title="Helpful headline" style={voteBtnStyle}>Helpful</button>
        <button title="Not helpful" style={voteBtnStyle}>Not helpful</button>
        <span title={`Matched #${data.headline.priorityRank}: ${data.headline.priorityMatched || 'n/a'}${data.headline.wasOverride ? ' (severity override)' : ''}`}
              style={{ color: C.muted, fontSize: 12, cursor: 'help', padding: '0 4px' }}>info</span>
      </div>

      <div style={{
        fontSize: 11, fontWeight: 800, color: sev.label,
        textTransform: 'uppercase', letterSpacing: 1.4, marginBottom: 8,
      }}>
        {headlineLabel}
      </div>

      <div style={{ fontSize: 15, lineHeight: 1.55, color: C.text, fontWeight: 600, paddingRight: 160 }}>
        {data.headline.text}
      </div>

      {/* KPI row + Top Action */}
      {(data.kpis?.length > 0 || data.topAction) && (
        <div style={{
          display: 'flex', marginTop: 14, borderTop: `1px solid ${C.border}`,
          paddingTop: 12, alignItems: 'stretch', flexWrap: 'wrap', gap: 12,
        }}>
          {(data.kpis || []).map((kpi, i) => {
            const trendColor = kpi.trend === 'up' ? C.green : kpi.trend === 'down' ? C.red : C.text;
            const trendArrow = kpi.trend === 'up' ? ' ↑' : kpi.trend === 'down' ? ' ↓' : '';
            return (
              <div key={i} style={{ paddingRight: 20, marginRight: 8, borderRight: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700 }}>{kpi.label}</div>
                <div style={{ fontFamily: C.mono, fontSize: 17, fontWeight: 800, color: trendColor, marginTop: 2 }}>
                  {kpi.value}{trendArrow}
                </div>
              </div>
            );
          })}
          {data.topAction && (
            <div style={{ flex: 1, minWidth: 220, paddingLeft: 4, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div style={{ fontSize: 9, color: C.accent, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 800 }}>Top Action</div>
              <div style={{ fontSize: 13, color: C.text, marginTop: 3, lineHeight: 1.4, fontWeight: 600 }}>{data.topAction}</div>
            </div>
          )}
        </div>
      )}

      {/* Always-visible sections */}
      <div>
        <Bucket title="Anomalies" items={data.anomalies} render={(it) => (
          <>
            <div style={T.itemTitle}>
              {it.text}
              {it.severity && <Chip text={it.severity} severity={it.severity} />}
            </div>
            {it.evidence && <div style={T.itemEvidence}>{it.evidence}</div>}
          </>
        )} />

        <Bucket title="Threshold Breaches" items={data.breaches} render={(it) => (
          <>
            <div style={T.itemTitle}>
              {it.text}
              {it.severity && <Chip text={it.severity} severity={it.severity} />}
            </div>
            {it.evidence && <div style={T.itemEvidence}>{it.evidence}</div>}
          </>
        )} />

        <Bucket title="Top Problems" items={data.topProblems} render={(it) => (
          <>
            <div style={T.itemTitle}>
              {it.rank && <span style={T.itemRank}>{it.rank}.</span>}
              {it.title}
            </div>
            {it.scope && <div style={T.itemSubpoint}>Scope: {it.scope}</div>}
            {it.evidence && <div style={T.itemEvidence}>{it.evidence}</div>}
          </>
        )} />

        <Bucket title="Top Opportunities" items={data.topOpportunities} render={(it) => (
          <>
            <div style={T.itemTitle}>
              {it.rank && <span style={T.itemRank}>{it.rank}.</span>}
              {it.title}
            </div>
            {it.lift && <div style={{ ...T.itemSubpoint, color: C.green }}>Lift: {it.lift}</div>}
            {it.evidence && <div style={T.itemEvidence}>{it.evidence}</div>}
          </>
        )} />

        <Bucket title="Actions" items={data.actions} render={(it) => (
          <>
            <div style={T.itemTitle}>
              {it.rank && <span style={T.itemRank}>{it.rank}.</span>}
              {it.text}
            </div>
            {it.evidence && <div style={T.itemEvidence}>{it.evidence}</div>}
          </>
        )} />

        <Bucket title="Next Week Actions" items={data.nextWeekActions} render={(it) => (
          <>
            <div style={T.itemTitle}>
              {it.rank && <span style={T.itemRank}>{it.rank}.</span>}
              {it.action}
            </div>
            {it.evidence && <div style={T.itemEvidence}>{it.evidence}</div>}
          </>
        )} />

        <Bucket title="Follow-Up Data Needed" items={data.followUpDataNeeded} render={(it) => (
          <>
            <div style={T.itemTitle}>{it.dataNeeded}</div>
            {it.why && <div style={T.itemSubpoint}>Why: {it.why}</div>}
            {it.currentEvidence && <div style={T.itemEvidence}>{it.currentEvidence}</div>}
          </>
        )} />

        <Bucket title="Sustained Themes" items={data.themes} render={(it) => (
          <>
            <div style={T.itemTitle}>
              {it.text}
              {it.daysObserved && <Chip text={`${it.daysObserved} days`} severity="yellow" />}
            </div>
            {it.evidence && <div style={T.itemEvidence}>{it.evidence}</div>}
          </>
        )} />

        <Bucket title="Wins" items={data.wins} render={(it) => (
          <>
            <div style={{ ...T.itemTitle, color: C.green }}>{it.text}</div>
            {it.evidence && <div style={T.itemEvidence}>{it.evidence}</div>}
          </>
        )} />

        <Bucket title="Examples & Quotes" items={data.examples} render={(it) => (
          <div style={{ borderLeft: `2px solid ${C.accent}44`, paddingLeft: 10 }}>
            <div style={{ fontSize: 9, color: C.accent, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 800 }}>{it.type || 'note'}</div>
            <div style={{ ...T.itemTitle, marginTop: 3 }}>{it.text}</div>
            {it.context && <div style={T.itemSubpoint}>{it.context}</div>}
          </div>
        )} />

        {(data.rawMarkdown || (data.evidenceTables && data.evidenceTables.length > 0)) && (
          <Suspense fallback={<div style={{ ...T.itemSubpoint, marginTop: 20 }}>Loading full analysis…</div>}>
            <FullAnalysis
              rawMarkdown={data.rawMarkdown}
              evidenceTables={data.evidenceTables}
              meta={data.meta}
            />
          </Suspense>
        )}

        {data.meta?.synthesisMs && (
          <div style={{
            marginTop: 20, paddingTop: 10, borderTop: `1px solid ${C.border}`,
            color: C.muted, fontSize: 10, fontFamily: C.mono, textAlign: 'right',
          }}>
            synthesized in {(data.meta.synthesisMs / 1000).toFixed(1)}s
            {' · '}{data.cached ? 'cached' : 'fresh'}
            {data.meta.evidenceTableCount != null && ` · ${data.meta.evidenceTableCount} tables extracted`}
          </div>
        )}
      </div>
    </div>
  );
}

const voteBtnStyle = {
  background: 'transparent', border: `1px solid ${C.border}`,
  color: C.muted, borderRadius: 4, padding: '3px 8px', fontSize: 10,
  cursor: 'pointer', fontFamily: C.sans,
};
```

- [ ] **Step 2: Verify it compiles (expected to fail until Task 6 lands `FullAnalysis`)**

Run:
```bash
cd /Users/peterschmitt/Downloads/tcc-dashboard && npm run build 2>&1 | tail -10
```

Expected: build fails with a "Module not found: Can't resolve './FullAnalysis'" error. That's fine — we'll create it in Task 6. If any OTHER error appears (typo, unused import, JSX mismatch), fix it before proceeding.

- [ ] **Step 3: Commit**

```bash
cd /Users/peterschmitt/Downloads/tcc-dashboard
git add src/components/InsightHero.jsx
git commit -m "feat(InsightHero): remove collapsibles + icons, add typography scale, render 10 always-visible buckets"
```

---

## Task 6: Create `FullAnalysis.jsx` component

**Files:**
- Create: `src/components/FullAnalysis.jsx`

- [ ] **Step 1: Create the component**

Write `src/components/FullAnalysis.jsx`:

```javascript
'use client';
import { useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { parseSections } from '@/lib/parse-sections';

const C = {
  bg: '#080b10', surface: '#0f1520', card: '#131b28', border: '#1a2538',
  text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff',
  mono: "'SF Mono', 'Fira Code', monospace",
  sans: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
};

const headingStyle = {
  fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2,
  color: C.accent, fontFamily: C.sans,
  borderBottom: `1px solid ${C.border}`, paddingBottom: 6,
  marginTop: 28, marginBottom: 12,
};

const markdownComponents = {
  table: ({ node, ...props }) => (
    <div style={{ overflowX: 'auto', margin: '12px 0' }}>
      <table {...props} style={{
        borderCollapse: 'collapse', width: '100%', fontFamily: C.sans, fontSize: 12,
        border: `1px solid ${C.border}`,
      }} />
    </div>
  ),
  thead: ({ node, ...props }) => (
    <thead {...props} style={{ background: C.surface }} />
  ),
  th: ({ node, ...props }) => (
    <th {...props} style={{
      padding: '8px 10px', textAlign: 'left', color: C.muted,
      fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6,
      borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}`,
    }} />
  ),
  td: ({ node, ...props }) => (
    <td {...props} style={{
      padding: '7px 10px', color: C.text, fontFamily: C.mono, fontSize: 12,
      borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}`,
      verticalAlign: 'top',
    }} />
  ),
  h1: ({ node, ...props }) => <h3 {...props} style={{ fontSize: 16, fontWeight: 800, color: C.text, marginTop: 20, marginBottom: 8 }} />,
  h2: ({ node, ...props }) => <h4 {...props} style={{ fontSize: 14, fontWeight: 700, color: C.text, marginTop: 16, marginBottom: 6 }} />,
  h3: ({ node, ...props }) => <h5 {...props} style={{ fontSize: 13, fontWeight: 700, color: C.text, marginTop: 14, marginBottom: 6 }} />,
  h4: ({ node, ...props }) => <h6 {...props} style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 12, marginBottom: 4 }} />,
  p:  ({ node, ...props }) => <p  {...props} style={{ fontSize: 12, lineHeight: 1.55, color: C.text, margin: '6px 0' }} />,
  ul: ({ node, ...props }) => <ul {...props} style={{ fontSize: 12, lineHeight: 1.55, color: C.text, paddingLeft: 22, margin: '6px 0' }} />,
  ol: ({ node, ...props }) => <ol {...props} style={{ fontSize: 12, lineHeight: 1.55, color: C.text, paddingLeft: 22, margin: '6px 0' }} />,
  li: ({ node, ...props }) => <li {...props} style={{ margin: '3px 0' }} />,
  code: ({ node, inline, ...props }) => inline
    ? <code {...props} style={{ fontFamily: C.mono, fontSize: 11, background: C.surface, padding: '1px 4px', borderRadius: 3, color: C.accent }} />
    : <code {...props} style={{ fontFamily: C.mono, fontSize: 11, display: 'block', background: C.surface, padding: 10, borderRadius: 4, color: C.text, overflowX: 'auto' }} />,
  strong: ({ node, ...props }) => <strong {...props} style={{ color: C.text, fontWeight: 700 }} />,
  hr: () => <hr style={{ border: 'none', borderTop: `1px solid ${C.border}`, margin: '16px 0' }} />,
};

export default function FullAnalysis({ rawMarkdown, evidenceTables, meta }) {
  const containerRef = useRef(null);
  const sections = useMemo(() => parseSections(rawMarkdown || ''), [rawMarkdown]);

  if (!rawMarkdown && (!evidenceTables || evidenceTables.length === 0)) return null;

  // TOC chips scroll to the first rendered heading/bold-lead node matching the section title text.
  // We don't inject anchors into the markdown; we match by textContent after render.
  const scrollToSection = (title) => {
    if (!containerRef.current) return;
    const target = Array.from(containerRef.current.querySelectorAll('h3, h4, h5, h6, p strong'))
      .find(node => (node.textContent || '').trim() === title);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div style={{ marginTop: 8 }}>
      <div style={headingStyle}>Full Analysis</div>

      <div style={{ color: C.muted, fontSize: 11, fontFamily: C.mono, marginBottom: 10 }}>
        {sections.length} section{sections.length === 1 ? '' : 's'}
        {' · '}{(evidenceTables || []).length} evidence table{(evidenceTables || []).length === 1 ? '' : 's'}
      </div>

      {sections.length > 0 && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14,
          padding: '8px 10px', background: C.bg, borderRadius: 4,
          border: `1px solid ${C.border}`,
        }}>
          {sections.map(s => (
            <button key={s.id} onClick={() => scrollToSection(s.title)} style={{
              background: 'transparent', border: `1px solid ${C.border}`,
              color: C.muted, borderRadius: 3, padding: '3px 8px', fontSize: 10,
              cursor: 'pointer', fontFamily: C.sans, whiteSpace: 'nowrap',
            }}>{s.title}</button>
          ))}
        </div>
      )}

      <div ref={containerRef} style={{
        background: C.bg, padding: '14px 18px', borderRadius: 4,
        border: `1px solid ${C.border}`, fontFamily: C.sans,
      }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {rawMarkdown || ''}
        </ReactMarkdown>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build and verify**

Run:
```bash
cd /Users/peterschmitt/Downloads/tcc-dashboard && npm run build 2>&1 | tail -15
```

Expected: build completes successfully, no `Module not found` errors. If the build warns about `react-markdown`'s ESM exports or Next.js server/client boundary, verify the `'use client';` directive is at the top of the file.

- [ ] **Step 3: Commit**

```bash
cd /Users/peterschmitt/Downloads/tcc-dashboard
git add src/components/FullAnalysis.jsx
git commit -m "feat(FullAnalysis): render raw Conversely markdown with TOC + dark-theme tables"
```

---

## Task 7: End-to-end verification in dev server

**Files:** none modified in this task.

- [ ] **Step 1: Start the dev server**

Run (leave it running in its own terminal or use `run_in_background`):
```bash
cd /Users/peterschmitt/Downloads/tcc-dashboard && npm run dev
```

Wait for `Ready in X.Xs`. Note the port (default 3000; project sometimes uses 3003 per the codebase).

- [ ] **Step 2: Hit each of the 8 insight categories via curl**

For each category, run:
```bash
for cat in funnel_analyzer lead_quality volume_capacity sales_execution profitability funnel_health mix_product agent_deep_dive; do
  echo "=== $cat ==="
  curl -s "http://localhost:3000/api/ai-analyst/insights?category=$cat&force=1" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    print(f\"  headline: {d.get('headline', {}).get('text', '(none)')[:80]}\")
    print(f\"  problems: {len(d.get('topProblems') or [])}  opps: {len(d.get('topOpportunities') or [])}  nextWeek: {len(d.get('nextWeekActions') or [])}  followUp: {len(d.get('followUpDataNeeded') or [])}\")
    print(f\"  anomalies: {len(d.get('anomalies') or [])}  actions: {len(d.get('actions') or [])}  examples: {len(d.get('examples') or [])}\")
    print(f\"  tables: {len(d.get('evidenceTables') or [])}  rawMd: {len(d.get('rawMarkdown') or '')}\")
except Exception as e:
    print(f'  ERROR parsing: {e}')
"
done
```

Expected: every category returns a headline plus non-zero `rawMd` length (assuming Conversely has reports for all 8). Categories without a recent report will show `(none)` and zero counts — that's a legitimate Conversely state, not a bug.

- [ ] **Step 3: Open the AI Analyst pane in the browser**

Open `http://localhost:3000` (or whichever port `npm run dev` announced). Navigate to the AI Analyst pane. For each of the 8 category tabs, verify visually:

1. Headline block renders with `HEADLINE — RED/YELLOW/GREEN` text (no emoji).
2. KPI row renders below the headline.
3. Every non-empty bucket renders inline — no `▶` toggles, no expandable wrappers.
4. Bucket headings are uppercase accent-blue with bottom borders.
5. Item titles (13px bold) are clearly larger than subpoints (11px muted) and evidence (12px with left border).
6. No emoji appear anywhere in section headings.
7. "Full Analysis" section appears at the bottom with TOC chips and rendered markdown including tables styled with the dark theme.
8. Scrolling a TOC chip jumps to the corresponding heading in the markdown body.

If any of these fail, note the category + failure, diagnose in the source, fix, and re-verify.

- [ ] **Step 4: Stop the dev server**

In the terminal running `npm run dev`, send `Ctrl+C`. (If it was backgrounded, kill the process.)

- [ ] **Step 5: Delete the temporary smoke scripts**

Run:
```bash
cd /Users/peterschmitt/Downloads/tcc-dashboard
rm scripts/smoke-parse-sections.mjs scripts/smoke-extract-tables.mjs
# Clean up the scripts dir if it's now empty
rmdir scripts 2>/dev/null || true
```

- [ ] **Step 6: Final commit**

```bash
cd /Users/peterschmitt/Downloads/tcc-dashboard
git add -A
git commit -m "chore: remove temporary smoke scripts after verification"
```

---

## Rollback plan

If a problem surfaces in production that can't be fixed quickly:

```bash
cd /Users/peterschmitt/Downloads/tcc-dashboard
git log --oneline -10
# Identify the first commit in this feature (Task 1 — "chore: add react-markdown...")
git revert <first-commit>..HEAD  # reverts all feature commits
```

Each task committed independently, so individual changes can also be reverted in isolation if the issue narrows to one layer (e.g., only the UI rewrite in Task 5 needs rollback while the expanded API stays).
