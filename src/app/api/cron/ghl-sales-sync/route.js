// src/app/api/cron/ghl-sales-sync/route.js
//
// Cron entrypoint for the standalone Sales Tracker → GHL sync. Runs
// alongside /api/cron/ghl-sync (call log sync) every 10 min, but with
// a 5-min offset so the two crons don't double-write to GHL contacts
// in the same window. Same auth, kill switch, and dry-run gates as
// the call log sync.
import { NextResponse } from 'next/server';
import { createGhlClient } from '@/lib/ghl/client';
import { readAllSalesRecords, processSalesBatch } from '@/lib/ghl/sales-sync';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(req) {
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
    const rows = await readAllSalesRecords();
    if (rows.length === 0) {
      return NextResponse.json({ ok: true, dryRun, summary: { total: 0 } });
    }
    const summary = await processSalesBatch({ rows, client, dryRun });
    return NextResponse.json({ ok: true, dryRun, summary });
  } catch (err) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}
