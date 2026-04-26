// src/app/api/ghl-backfill/route.js
import { NextResponse } from 'next/server';
import { createGhlClient } from '@/lib/ghl/client';
import { readRawSheet } from '@/lib/sheets';
import { processBatch } from '@/lib/ghl/sync';

export const maxDuration = 60;

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
    const rows = data.filter(r => {
      const d = (r['Date'] ?? '').slice(0, 10);
      return d >= start && d <= end;
    });

    const summary = await processBatch({ rows, client, dryRun, advanceWatermark: false });
    return NextResponse.json({ ok: true, dryRun, range: { start, end }, summary });
  } catch (err) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}
