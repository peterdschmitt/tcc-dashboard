import { NextResponse } from 'next/server';
import { ensureCarrierParsersTab, seedInitialCarrierRows } from '@/lib/carrier-parsers';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const { tab } = await ensureCarrierParsersTab();
    const seedResult = await seedInitialCarrierRows();
    return NextResponse.json({ ok: true, tab, ...seedResult });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET() {
  return POST();
}
