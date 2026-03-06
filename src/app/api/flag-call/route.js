export const dynamic = 'force-dynamic';
import { writeCell } from '@/lib/sheets';
import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const { rowIndex, value } = await request.json();
    if (!rowIndex) return NextResponse.json({ error: 'rowIndex required' }, { status: 400 });
    const allowed = new Set(['N', 'Y', '']);
    if (!allowed.has((value || '').toUpperCase().trim()) && value !== '') {
      return NextResponse.json({ error: 'value must be N, Y, or empty string' }, { status: 400 });
    }
    await writeCell(
      process.env.CALLLOGS_SHEET_ID,
      process.env.CALLLOGS_TAB_NAME || 'Report',
      rowIndex,
      'Billable Override',
      (value || '').toUpperCase().trim()
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('flag-call error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
