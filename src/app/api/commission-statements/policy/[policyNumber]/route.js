export const dynamic = 'force-dynamic';
import { fetchSheet } from '@/lib/sheets';
import { NextResponse } from 'next/server';

export async function GET(request, { params }) {
  try {
    const { policyNumber } = await params;

    if (!policyNumber) {
      return NextResponse.json({ error: 'policyNumber required' }, { status: 400 });
    }

    const salesSheetId = process.env.SALES_SHEET_ID;
    const ledgerTab = process.env.COMMISSION_LEDGER_TAB || 'Commission Ledger';
    const salesTab = process.env.SALES_TAB_NAME || 'Sheet1';

    const [ledgerRows, salesRows] = await Promise.all([
      fetchSheet(salesSheetId, ledgerTab, 60),
      fetchSheet(salesSheetId, salesTab, 0),
    ]);

    // Find matching ledger entries (by carrier policy # or matched policy #)
    const entries = ledgerRows
      .filter(r =>
        (r['Policy #'] || '').trim() === policyNumber ||
        (r['Matched Policy #'] || '').trim() === policyNumber
      )
      .map(r => ({
        transactionId: r['Transaction ID'],
        statementDate: r['Statement Date'],
        processingDate: r['Processing Date'],
        carrier: r['Carrier'],
        policyNumber: r['Policy #'],
        insuredName: r['Insured Name'],
        agent: r['Agent'],
        transactionType: r['Transaction Type'],
        premium: parseFloat(r['Premium']) || 0,
        commissionAmount: parseFloat(r['Commission Amount']) || 0,
        outstandingBalance: parseFloat(r['Outstanding Balance']) || 0,
        matchedPolicy: r['Matched Policy #'],
        matchType: r['Match Type'],
        matchConfidence: parseFloat(r['Match Confidence']) || 0,
        status: r['Status'],
        statementFile: r['Statement File'],
        notes: r['Notes'],
      }));

    // Find the sales row for context
    const salesRow = salesRows.find(r => (r['Policy #'] || '').trim() === policyNumber);
    const policyInfo = salesRow ? {
      insuredName: `${salesRow['First Name'] || ''} ${salesRow['Last Name'] || ''}`.trim(),
      carrier: (salesRow['Carrier + Product + Payout'] || '').split(',')[0]?.trim() || '',
      product: (salesRow['Carrier + Product + Payout'] || '').split(',').slice(1).join(',').split(',')[0]?.trim() || '',
      premium: parseFloat(salesRow['Monthly Premium']) || 0,
      agent: salesRow['Agent'] || '',
      status: salesRow['Policy Status']?.trim() || salesRow['Placed?']?.trim() || '',
    } : null;

    // Calculate totals
    const totalPaid = entries.filter(e => e.commissionAmount > 0).reduce((s, e) => s + e.commissionAmount, 0);
    const totalClawback = entries.filter(e => e.commissionAmount < 0).reduce((s, e) => s + Math.abs(e.commissionAmount), 0);

    return NextResponse.json({
      policyNumber,
      policyInfo,
      entries,
      totalPaid: Math.round(totalPaid * 100) / 100,
      totalClawback: Math.round(totalClawback * 100) / 100,
      netCommission: Math.round((totalPaid - totalClawback) * 100) / 100,
    });
  } catch (error) {
    console.error('[commission-policy] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
