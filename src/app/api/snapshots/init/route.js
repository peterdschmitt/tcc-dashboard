import { NextResponse } from 'next/server';
import { ensureSnapshotTabs } from '@/lib/snapshots';

export async function GET() {
  try {
    const result = await ensureSnapshotTabs();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
