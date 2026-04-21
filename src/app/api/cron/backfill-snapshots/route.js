import { NextResponse } from 'next/server';

function getBaseUrl() {
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:' + (process.env.PORT || 3003);
}

function daysBetween(startISO, endISO) {
  const out = [];
  const cur = new Date(startISO + 'T00:00:00Z');
  const end = new Date(endISO + 'T00:00:00Z');
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export async function GET(request) {
  if (process.env.CRON_SECRET) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }
  try {
    const { searchParams } = new URL(request.url);
    const start = searchParams.get('start');
    const end = searchParams.get('end');
    if (!start || !end) {
      return NextResponse.json({ error: 'start=YYYY-MM-DD&end=YYYY-MM-DD required' }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      return NextResponse.json({ error: 'start/end must be YYYY-MM-DD' }, { status: 400 });
    }
    const baseUrl = getBaseUrl();
    const dates = daysBetween(start, end);
    const authHeader = process.env.CRON_SECRET ? { Authorization: `Bearer ${process.env.CRON_SECRET}` } : {};
    const results = [];
    for (const d of dates) {
      try {
        const res = await fetch(`${baseUrl}/api/snapshots/write?date=${d}`, { headers: authHeader });
        const body = await res.json();
        results.push({ date: d, ...body });
      } catch (err) {
        results.push({ date: d, error: err.message });
      }
    }
    return NextResponse.json({
      ok: true,
      count: results.length,
      failed: results.filter(r => r.error || !r.ok).length,
      results,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
