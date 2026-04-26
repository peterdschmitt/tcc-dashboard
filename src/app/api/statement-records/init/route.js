import { NextResponse } from 'next/server';
import { ensureStatementRecordTabs } from '@/lib/statement-records-io';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const result = await ensureStatementRecordTabs();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Convenience: allow GET for one-time browser invocation.
export async function GET() {
  return POST();
}
