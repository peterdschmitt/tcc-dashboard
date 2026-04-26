# Portfolio Detail Panel Polish — Design Spec

**Date:** 2026-04-26
**Status:** Approved
**Scope:** Restyle and add resize to `PortfolioDetailPanel.jsx` only. No API or data-model changes.

## Goal

Make the slide-in contact detail panel more scannable by replacing the current free-form header with an explicit labeled-field section, and let the user resize the panel to fit their workflow.

## Out of scope

- User-defined smart views (separate spec/plan, Area A from the same brainstorm session)
- Edit-in-place of contact fields (read-only stays)
- New API endpoints or DB migrations
- Restyling Policies cards or Calls list beyond minor label tightening

## File touched

- `src/components/portfolio/PortfolioDetailPanel.jsx` (the only file modified)

The companion API route at `src/app/api/portfolio/contact/[id]/route.js` already returns every field this design needs — no changes there.

## Layout

Three vertically stacked sections, in order:

### 1. Contact Details (new section, replaces current header block)

A 2-column grid of label/value rows. Labels in `C.muted`, values in `C.text`. Empty values render as `—`.

Fields, in this order, left column then right column:

| Left | Right |
|---|---|
| Phone | Email |
| Date of Birth | Gender |
| Address | City |
| State | Zip |
| Country | First Seen |
| Source | Total Calls |
| Tags (full row) | |

Implementation: a `<div>` with `display: grid; gridTemplateColumns: '1fr 1fr'; gap: 8px 16px`. Each cell is a small `<div>` containing a label `<div>` and a value `<div>`. Tags spans both columns (`gridColumn: '1 / -1'`).

**Value formatting:**
- Date of Birth → `toLocaleDateString()` (no time)
- First Seen → `toLocaleString()` (date + time)
- Total Calls → plain integer
- Tags → row of small chips (each chip: `background: C.card`, `color: C.muted`, `padding: '2px 8px'`, `borderRadius: 10px`, `fontSize: 11px`, gap 6px between chips). Empty array hides the row entirely.

The contact's full name remains as the page-level `<h2>` above this section.

### 2. Policies (existing, light tweaks)

Keep current card style (already structured). Tighten the secondary line into explicit `Status / Premium / Submitted / Effective / Agent` label/value pairs inside each card. The carrier+product line stays as a free-text subtitle.

### 3. Recent Calls (existing, no change)

List unchanged. Keep the current `Date • Campaign • Status • Duration` one-liner format.

## Resize

A 4px-wide drag handle on the panel's left edge. Hover state highlights it with `C.accent`. Mouse-down + drag updates the panel's width in real time (CSS `width` style on the panel root); width is clamped on every move.

- **Min width:** 360px
- **Max width:** 900px
- **Default width:** 480px (current value)

Persist the user's last chosen width to `localStorage` under key `portfolio.detailPanel.width`. On mount, read that key and use it as the initial width if present and within the clamp range.

Implementation outline:

- Add `const [width, setWidth] = useState(() => Number(localStorage.getItem('portfolio.detailPanel.width')) || 480)` (clamp on read).
- Add a sibling `<div>` rendered absolutely at `left: 0` of the panel; mouseDown on it captures the start X and start width, then attaches `mousemove` + `mouseup` listeners to `document`. Move handler computes `newWidth = startWidth - (e.clientX - startX)` (since panel is right-aligned, dragging left grows it). Clamp and set state.
- On mouse-up, persist the final width: `localStorage.setItem('portfolio.detailPanel.width', String(width))`.

## Close

No change. The existing `✕` button in the top-right still calls `onClose` to dismiss the panel.

## Edge cases

- **Stale localStorage value out of range:** clamp on read; if invalid, fall back to 480.
- **SSR safety:** `localStorage` access guarded by `typeof window !== 'undefined'` (the component is `'use client'` but the initial state computation may run during hydration — defensive).
- **Empty data sections:** Contact Details always renders (every contact has at least a phone). Policies and Calls keep their existing empty-state messages.

## Visual continuity

Reuse the existing color palette `C` already defined in the file. No new colors. Font family `monospace` for values (matches grid). Labels stay `text-transform: uppercase` at 11px.

## Acceptance criteria

1. Opening the detail panel shows Contact Details as the first section with all 13 fields visible (or `—` for empty).
2. Dragging the left edge resizes the panel between 360 and 900 pixels.
3. Closing and reopening the panel preserves the last chosen width.
4. The existing close button still dismisses the panel.
5. No regressions in Policies or Calls sections.
6. `npm run build` passes.
