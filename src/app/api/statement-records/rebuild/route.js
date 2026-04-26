import { NextResponse } from 'next/server';
import { rebuildStatementRecords } from '@/lib/statement-records-io';

export const dynamic = 'force-dynamic';

function checkAuth(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // unset → no auth in local dev
  const header = request.headers.get('authorization') || '';
  const fromQuery = new URL(request.url).searchParams.get('secret') || '';
  const expected = `Bearer ${secret}`;
  return header === expected || fromQuery === secret;
}

export async function POST(request) {
  if (!checkAuth(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const result = await rebuildStatementRecords();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: err.message, stack: err.stack }, { status: 500 });
  }
}

export async function GET(request) {
  return POST(request);
}
