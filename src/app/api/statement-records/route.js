import { NextResponse } from 'next/server';
import { fetchSheet } from '@/lib/sheets';
import { STATEMENT_HOLDERS_TAB, HOLDERS_HEADERS } from '@/lib/statement-records';

export const dynamic = 'force-dynamic';

function rowToHolder(r) {
  const out = {};
  for (const h of HOLDERS_HEADERS) out[h] = r[h] ?? '';
  // Coerce numerics for consumer convenience.
  ['Policy Count', 'Statement Count', 'Total Advances', 'Total Commissions',
    'Total Chargebacks', 'Total Recoveries', 'Net Total', 'Outstanding Balance']
    .forEach(k => out[k] = parseFloat(out[k]) || 0);
  ['Expected Net', 'Variance'].forEach(k => {
    out[k] = out[k] === '' ? null : (parseFloat(out[k]) || 0);
  });
  return out;
}

export async function GET(request) {
  try {
    const sheetId = process.env.SALES_SHEET_ID;
    const { searchParams } = new URL(request.url);
    const search = (searchParams.get('search') || '').trim().toLowerCase();
    const status = searchParams.get('status') || '';

    const rows = await fetchSheet(sheetId, STATEMENT_HOLDERS_TAB, 60);
    let holders = rows.map(rowToHolder);

    if (search) {
      holders = holders.filter(h =>
        h['Insured Name'].toLowerCase().includes(search) ||
        h['Policies'].toLowerCase().includes(search)
      );
    }
    if (status && status !== 'all') {
      if (status === 'variance') {
        holders = holders.filter(h => h.Variance !== null && Math.abs(h.Variance) > 50);
      } else if (status === 'chargebacks') {
        holders = holders.filter(h => h['Total Chargebacks'] > 0);
      } else if (status === 'outstanding') {
        holders = holders.filter(h => h['Outstanding Balance'] > 0);
      } else {
        holders = holders.filter(h => h.Status === status);
      }
    }

    const lastRebuilt = holders[0]?.['Last Rebuilt'] || null;
    return NextResponse.json({ holders, lastRebuilt });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
