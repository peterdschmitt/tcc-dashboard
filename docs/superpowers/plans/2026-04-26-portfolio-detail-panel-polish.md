# Portfolio Detail Panel Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure `PortfolioDetailPanel.jsx` into three explicit sections (Contact Details / Policies / Calls) with a 2-column labeled-field grid for the contact, and add a draggable resize handle that persists width to `localStorage`.

**Architecture:** Single-file modification. Introduce a small inline `Field` helper component for the labeled rows. Manage width with `useState` + drag listeners on `document` (mousemove + mouseup). Persist to `localStorage` keyed `portfolio.detailPanel.width`. Width clamped to [360, 900] on every move and on read.

**Tech Stack:** React (already in repo), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-26-portfolio-detail-panel-polish-design.md`

**Testing approach (project-specific):** This codebase has `node --test` wired for pure-function unit tests in `src/lib/`, but no React component test framework. Verification for this plan uses: (a) `npm run build` (catches syntax/import errors), (b) browser verification against the running worktree dev server at `http://localhost:3004` after each task.

---

## File Structure

### Files modified

```
src/components/portfolio/PortfolioDetailPanel.jsx   # the only file changed
```

### Files explicitly NOT touched

- `src/app/api/portfolio/contact/[id]/route.js` — already returns every field needed
- Any other portfolio component (Tab, Grid, FilterSidebar, etc.)
- Any DB or sync code

---

## Task 1: Add inline `Field` helper + Contact Details section

**Files:**
- Modify: `src/components/portfolio/PortfolioDetailPanel.jsx`

- [ ] **Step 1:** Read the current file:

```bash
cat src/components/portfolio/PortfolioDetailPanel.jsx | head -50
```

Confirm the file matches the structure documented in the spec (header block of name/phone/email/address, then Policies, then Calls).

- [ ] **Step 2:** Replace the entire file with the new layout. The change introduces:
  - An inline `Field` helper component near the top
  - An inline `formatDate` helper for date formatting
  - A new `Contact Details` section as a 2-column grid replacing the header phone/email/address lines
  - Tags row at the bottom of the grid (spans both columns)

Write the file with **exactly** this content:

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

function fmtDate(v, withTime = false) {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '—';
  return withTime ? d.toLocaleString() : d.toLocaleDateString();
}

function Field({ label, value, span }) {
  return (
    <div style={{ gridColumn: span === 'full' ? '1 / -1' : 'auto' }}>
      <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ color: C.text, fontSize: 13, fontFamily: 'monospace', wordBreak: 'break-word' }}>
        {value == null || value === '' ? '—' : value}
      </div>
    </div>
  );
}

function TagChips({ tags }) {
  if (!tags || tags.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {tags.map((t, i) => (
        <span key={i} style={{ background: C.card, color: C.muted, padding: '2px 8px', borderRadius: 10, fontSize: 11, fontFamily: 'monospace' }}>
          {t}
        </span>
      ))}
    </div>
  );
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

  const c = data?.contact;

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
      {c && (
        <>
          <h2 style={{ fontSize: 22, margin: '0 0 16px 0' }}>
            {(c.firstName || '') + ' ' + (c.lastName || '')}
          </h2>

          {/* Section 1: Contact Details */}
          <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', marginBottom: 8, letterSpacing: 0.3 }}>
            Contact Details
          </div>
          <div style={{ background: C.card, padding: 16, borderRadius: 6, marginBottom: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px' }}>
            <Field label="Phone" value={c.phone} />
            <Field label="Email" value={c.email} />
            <Field label="Date of Birth" value={fmtDate(c.dateOfBirth)} />
            <Field label="Gender" value={c.gender} />
            <Field label="Address" value={c.address1} />
            <Field label="City" value={c.city} />
            <Field label="State" value={c.state} />
            <Field label="Zip" value={c.postalCode} />
            <Field label="Country" value={c.country} />
            <Field label="First Seen" value={fmtDate(c.firstSeenAt, true)} />
            <Field label="Source" value={c.source} />
            <Field label="Total Calls" value={c.totalCalls} />
            {c.tags && c.tags.length > 0 && (
              <Field label="Tags" value={<TagChips tags={c.tags} />} span="full" />
            )}
          </div>

          {/* Section 2: Policies */}
          <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', marginBottom: 8, letterSpacing: 0.3 }}>
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

          {/* Section 3: Recent Calls */}
          <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', margin: '24px 0 8px 0', letterSpacing: 0.3 }}>
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

This commit introduces the new Contact Details grid only. Resize comes in Task 2.

- [ ] **Step 3:** Build to verify syntax:

```bash
npm run build 2>&1 | tail -10
```

Expected: build succeeds. The route table should still include `/api/portfolio/contact/[id]`.

- [ ] **Step 4:** Browser-verify against the running worktree preview (port 3004). Open the dashboard, click the Portfolio tab, click any contact row. Confirm:
  - Contact Details renders as a 2-column grid with all 12+ fields
  - Empty fields show `—` (not blank)
  - Date of Birth shows date only; First Seen shows date + time
  - Tags row only appears if there are tags

If the preview server is not running, start it:

```bash
# (only if not already running)
ls /Users/peterschmitt/Downloads/tcc-dashboard/.claude/launch.json   # confirm tcc-portfolio-preview config exists
```

- [ ] **Step 5:** Commit:

```bash
git add src/components/portfolio/PortfolioDetailPanel.jsx
git commit -m "feat(portfolio): restructure DetailPanel with Contact Details field grid"
```

---

## Task 2: Add draggable resize handle (in-memory only)

**Files:**
- Modify: `src/components/portfolio/PortfolioDetailPanel.jsx`

This task adds the visual drag handle and drag logic. localStorage persistence comes in Task 3.

- [ ] **Step 1:** Inside the component, replace the existing `useState`/`useEffect` hooks block and panel root `<div>` so that:
  - A new `width` state holds the panel width (default 480, range [360, 900])
  - The panel root reads `width` from state
  - A drag handle is rendered as a sibling at `left: 0` of the panel
  - mousedown on the handle attaches mousemove + mouseup listeners to `document`

Find this block in the current file:

```jsx
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

  const c = data?.contact;

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, height: '100vh', width: 480, background: C.surface,
      borderLeft: `1px solid ${C.border}`, padding: 24, overflowY: 'auto', zIndex: 100, color: C.text,
      boxShadow: '-4px 0 24px rgba(0,0,0,0.5)',
    }}>
```

Replace it with:

```jsx
const MIN_WIDTH = 360;
const MAX_WIDTH = 900;
const DEFAULT_WIDTH = 480;

function clampWidth(n) {
  if (typeof n !== 'number' || isNaN(n)) return DEFAULT_WIDTH;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n));
}

export default function PortfolioDetailPanel({ contactId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [hoverHandle, setHoverHandle] = useState(false);

  useEffect(() => {
    if (!contactId) return;
    setLoading(true);
    fetch(`/api/portfolio/contact/${contactId}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [contactId]);

  function startDrag(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const onMove = (ev) => {
      // Panel is right-anchored; dragging LEFT (smaller clientX) grows width.
      const next = clampWidth(startWidth - (ev.clientX - startX));
      setWidth(next);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  if (!contactId) return null;

  const c = data?.contact;

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, height: '100vh', width, background: C.surface,
      borderLeft: `1px solid ${C.border}`, padding: 24, overflowY: 'auto', zIndex: 100, color: C.text,
      boxShadow: '-4px 0 24px rgba(0,0,0,0.5)',
    }}>
      {/* Resize handle */}
      <div
        onMouseDown={startDrag}
        onMouseEnter={() => setHoverHandle(true)}
        onMouseLeave={() => setHoverHandle(false)}
        style={{
          position: 'absolute', top: 0, left: 0, width: 4, height: '100%',
          cursor: 'ew-resize',
          background: hoverHandle ? C.accent : 'transparent',
          transition: 'background 120ms ease',
        }}
        title="Drag to resize"
      />
```

Note: the `MIN_WIDTH`/`MAX_WIDTH`/`DEFAULT_WIDTH` constants and `clampWidth` helper go ABOVE the `export default function` line. The rest of the JSX (closing tags, sections, etc.) stays exactly as written in Task 1.

- [ ] **Step 2:** Build:

```bash
npm run build 2>&1 | tail -10
```

Expected: succeeds.

- [ ] **Step 3:** Browser-verify on `localhost:3004`:
  - Open Portfolio → click contact → panel opens at 480px wide
  - Hover the panel's left edge — handle highlights blue (`C.accent`)
  - Click and drag left → panel grows; drag right → panel shrinks
  - Try to drag past min/max — width clamps at 360 and 900
  - Reload page — panel resets to 480 (no persistence yet — that's Task 3)

- [ ] **Step 4:** Commit:

```bash
git add src/components/portfolio/PortfolioDetailPanel.jsx
git commit -m "feat(portfolio): drag-to-resize handle on DetailPanel left edge"
```

---

## Task 3: Persist last width to localStorage

**Files:**
- Modify: `src/components/portfolio/PortfolioDetailPanel.jsx`

- [ ] **Step 1:** Add a stable `STORAGE_KEY` constant near the top of the file (after the other top-level constants from Task 2):

```jsx
const STORAGE_KEY = 'portfolio.detailPanel.width';
```

- [ ] **Step 2:** Replace this line:

```jsx
  const [width, setWidth] = useState(DEFAULT_WIDTH);
```

with a lazy initializer that reads + clamps localStorage on mount:

```jsx
  const [width, setWidth] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_WIDTH;
    const stored = Number(window.localStorage.getItem(STORAGE_KEY));
    return clampWidth(stored);
  });
```

- [ ] **Step 3:** Persist on drag end. Replace the entire `startDrag` function from Task 2 with this version that tracks the latest width in a closure-local variable:

```jsx
  function startDrag(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    let latestWidth = startWidth;
    const onMove = (ev) => {
      // Panel is right-anchored; dragging LEFT (smaller clientX) grows width.
      latestWidth = clampWidth(startWidth - (ev.clientX - startX));
      setWidth(latestWidth);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      try {
        window.localStorage.setItem(STORAGE_KEY, String(latestWidth));
      } catch {}
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }
```

The key change: `latestWidth` is updated on every `onMove` and read by `onUp` directly — no DOM lookup needed, no stale React state.

- [ ] **Step 4:** Build:

```bash
npm run build 2>&1 | tail -10
```

- [ ] **Step 5:** Browser-verify:
  - Open Portfolio → click contact → drag panel to ~700px wide → release
  - Reload the page (Cmd+R / Ctrl+R)
  - Click another contact → panel opens at ~700px (preserved!)
  - Open browser devtools → Application → Local Storage → confirm `portfolio.detailPanel.width` key exists with the numeric value

- [ ] **Step 6:** Stale-value protection check:
  - In browser devtools, run: `localStorage.setItem('portfolio.detailPanel.width', '99999')`
  - Reload → panel opens at 900 (clamped to MAX_WIDTH)
  - Run: `localStorage.setItem('portfolio.detailPanel.width', 'banana')`
  - Reload → panel opens at 480 (DEFAULT — clampWidth rejects NaN)

- [ ] **Step 7:** Commit:

```bash
git add src/components/portfolio/PortfolioDetailPanel.jsx
git commit -m "feat(portfolio): persist DetailPanel width to localStorage"
```

---

## Task 4: Final verification + push

**Files:** none

- [ ] **Step 1:** Confirm acceptance criteria from the spec:
  1. Detail panel shows Contact Details first with all fields visible (or `—`) ✓
  2. Drag the left edge resizes between 360 and 900 ✓
  3. Closing and reopening preserves chosen width ✓
  4. Existing close button still works ✓
  5. Policies + Calls sections unchanged ✓
  6. `npm run build` passes ✓

Run a final build to be sure:

```bash
npm run build 2>&1 | tail -10
```

- [ ] **Step 2:** Push:

```bash
git push
```

---

# Done

After Task 4 the branch contains 3 new commits implementing the polish, the build passes, and the changes are visible on `feature/portfolio-build` on origin. Pair this with the existing portfolio-build PR (or open one if you haven't yet).
