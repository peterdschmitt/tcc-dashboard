// src/app/api/db-backfill/route.js
// Manual one-shot full sync. Same as cron but always runs, no kill switch.
import { NextResponse } from 'next/server';
import { runFullSync } from '@/lib/db-sync/pipeline';

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
  try {
    const result = await runFullSync();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}
