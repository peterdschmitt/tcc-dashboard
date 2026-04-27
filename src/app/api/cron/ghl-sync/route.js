// src/app/api/cron/ghl-sync/route.js
import { NextResponse } from 'next/server';
import { createGhlClient } from '@/lib/ghl/client';
import { readWatermark, readNewCallLogRows } from '@/lib/ghl/sheet-state';
import { processBatch } from '@/lib/ghl/sync';

export const maxDuration = 60;
// Don't prerender at build time — this route makes live GHL API calls
// and would time out the static export step.
export const dynamic = 'force-dynamic';

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

    // Vercel functions are capped at 60s. processBatch flushes its sync
    // log + advances the watermark only at the END — if we time out
    // mid-batch, GHL still gets the writes but the sheet doesn't, and
    // the watermark never advances, so the next invocation re-processes
    // the same rows. Cap each invocation at 12 rows (~3.5s each = ~42s
    // of GHL work + ~5s for final flush, leaving margin under the 60s
    // ceiling). The cron runs every 10 min so the backlog drains over
    // hours regardless.
    const PER_INVOCATION_ROW_LIMIT = 12;
    const chunk = rows.slice(0, PER_INVOCATION_ROW_LIMIT);
    const summary = await processBatch({ rows: chunk, client, dryRun });
    return NextResponse.json({ ok: true, dryRun, watermark, summary, processed: chunk.length, remaining: rows.length - chunk.length });
  } catch (err) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}
