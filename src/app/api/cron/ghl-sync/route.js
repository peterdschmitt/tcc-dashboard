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

    const summary = await processBatch({ rows, client, dryRun });
    return NextResponse.json({ ok: true, dryRun, watermark, summary });
  } catch (err) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}
