import { NextResponse } from 'next/server';
import { fetchSheet } from '@/lib/sheets';
import { STATEMENT_HOLDERS_TAB, STATEMENT_PERIODS_TAB } from '@/lib/statement-records';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  try {
    const { holderKey } = await params;
    if (!holderKey) return NextResponse.json({ error: 'holderKey required' }, { status: 400 });
    const decodedKey = decodeURIComponent(holderKey);
    const policyNumber = new URL(request.url).searchParams.get('policyNumber') || '';

    const sheetId = process.env.SALES_SHEET_ID;
    const [holderRows, periodRows] = await Promise.all([
      fetchSheet(sheetId, STATEMENT_HOLDERS_TAB, 60),
      fetchSheet(sheetId, STATEMENT_PERIODS_TAB, 60),
    ]);

    let candidates = holderRows.filter(r => r['Holder Key'] === decodedKey);
    if (candidates.length > 1 && policyNumber) {
      candidates = candidates.filter(r => (r['Policies'] || '').includes(policyNumber));
    }
    const holder = candidates[0] || null;
    if (!holder) return NextResponse.json({ holder: null, periods: [] });

    const periods = periodRows
      .filter(r => r['Holder Key'] === decodedKey)
      .map(r => {
        const out = { ...r };
        ['Premium', 'Advance Amount', 'Commission Amount', 'Chargeback Amount',
          'Recovery Amount', 'Net Impact', 'Outstanding Balance', 'Line Item Count']
          .forEach(k => out[k] = parseFloat(out[k]) || 0);
        return out;
      })
      .sort((a, b) => String(b['Statement Date'] || '').localeCompare(String(a['Statement Date'] || '')));

    return NextResponse.json({ holder, periods });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
