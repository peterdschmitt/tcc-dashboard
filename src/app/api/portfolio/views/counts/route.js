// src/app/api/portfolio/views/counts/route.js
// Returns { counts: { <viewId>: <rowCount> } } — one COUNT(DISTINCT c.id) per view.
// Used by the sidebar to show per-view counts and aggregate parent counts.
// Counts are computed in parallel; total latency ≈ slowest single COUNT (~80ms).

import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { listViews, getView } from '@/lib/portfolio/views';
import { listContactsForView } from '@/lib/portfolio/query';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const views = await listViews();
    // Run all counts in parallel via listContactsForView with pageSize=1
    // (each call internally runs SELECT + COUNT; we just throw away the rows).
    const results = await Promise.all(views.map(async (v) => {
      try {
        const cfg = await getView(v.id);
        const r = await listContactsForView({ viewConfig: cfg, page: 1, pageSize: 1 });
        return [v.id, r.total];
      } catch {
        return [v.id, null]; // null indicates query error — sidebar will hide the count
      }
    }));
    const counts = Object.fromEntries(results);
    return NextResponse.json({ counts });
  } catch (err) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}
