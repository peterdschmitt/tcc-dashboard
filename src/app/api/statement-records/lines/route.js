import { NextResponse } from 'next/server';
import { fetchSheet } from '@/lib/sheets';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const statementFile = searchParams.get('statementFile') || '';
    const insuredName = searchParams.get('insuredName') || '';
    if (!statementFile || !insuredName) {
      return NextResponse.json({ error: 'statementFile and insuredName required' }, { status: 400 });
    }

    const sheetId = process.env.SALES_SHEET_ID;
    const ledgerTab = process.env.COMMISSION_LEDGER_TAB || 'Commission Ledger';
    const rows = await fetchSheet(sheetId, ledgerTab, 60);

    const wantName = insuredName.trim().toLowerCase();
    const lines = rows
      .filter(r =>
        (r['Statement File'] || '') === statementFile &&
        (r['Insured Name'] || '').trim().toLowerCase() === wantName
      )
      .map(r => ({
        transactionId: r['Transaction ID'] || '',
        statementDate: r['Statement Date'] || '',
        transactionType: r['Transaction Type'] || '',
        description: r['Description'] || '',
        product: r['Product'] || '',
        policyNumber: r['Policy #'] || '',
        premium: parseFloat(r['Premium']) || 0,
        commissionPct: r['Commission %'] === '' ? null : (parseFloat(r['Commission %']) || 0),
        advancePct: r['Advance %'] === '' ? null : (parseFloat(r['Advance %']) || 0),
        advanceAmount: parseFloat(r['Advance Amount']) || 0,
        commissionAmount: parseFloat(r['Commission Amount']) || 0,
        chargebackAmount: parseFloat(r['Chargeback Amount']) || 0,
        recoveryAmount: parseFloat(r['Recovery Amount']) || 0,
        outstandingBalance: parseFloat(r['Outstanding Balance']) || 0,
        notes: r['Notes'] || '',
      }));

    const fileId = lines[0] ? rows.find(r => r['Statement File'] === statementFile)?.['Statement File ID'] || '' : '';
    return NextResponse.json({ lines, statement: { file: statementFile, fileId } });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
