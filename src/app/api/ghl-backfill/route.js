// src/app/api/ghl-backfill/route.js
import { NextResponse } from 'next/server';
import { createGhlClient } from '@/lib/ghl/client';
import { readRawSheet } from '@/lib/sheets';
import { processBatch } from '@/lib/ghl/sync';
import { parseCallLogDate } from '@/lib/ghl/sheet-state';

export const maxDuration = 60;
// Don't prerender at build time — this route makes live GHL API calls
// and would time out the static export step.
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

  const url = new URL(req.url);
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  if (!start || !end) return NextResponse.json({ error: 'start and end query params required (YYYY-MM-DD)' }, { status: 400 });

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
    await client.resolveCustomFields();

    const sheetId = process.env.CALLLOGS_SHEET_ID;
    const tab = process.env.CALLLOGS_TAB_NAME || 'Report';
    const { data } = await readRawSheet(sheetId, tab);

    // Build start/end timestamps from YYYY-MM-DD inputs.
    // start = beginning of `start` day (UTC), end = end of `end` day (UTC).
    const startTs = Date.parse(`${start}T00:00:00Z`);
    const endTs = Date.parse(`${end}T23:59:59.999Z`);
    if (isNaN(startTs) || isNaN(endTs)) {
      return NextResponse.json({ error: 'start and end must be valid YYYY-MM-DD dates' }, { status: 400 });
    }
    const rows = data.filter(r => {
      const ts = parseCallLogDate(r['Date']);
      return ts >= startTs && ts <= endTs;
    });

    const summary = await processBatch({ rows, client, dryRun, advanceWatermark: false });
    return NextResponse.json({ ok: true, dryRun, range: { start, end }, summary });
  } catch (err) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}
