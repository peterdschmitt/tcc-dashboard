import { NextResponse } from 'next/server';
import { rebuildStatementRecords } from '@/lib/statement-records-io';

export const dynamic = 'force-dynamic';

function checkAuth(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = request.headers.get('authorization') || '';
  const fromQuery = new URL(request.url).searchParams.get('secret') || '';
  return header === `Bearer ${secret}` || fromQuery === secret;
}

export async function GET(request) {
  if (!checkAuth(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const result = await rebuildStatementRecords();
    return NextResponse.json({ ok: true, ...result, ranAt: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
