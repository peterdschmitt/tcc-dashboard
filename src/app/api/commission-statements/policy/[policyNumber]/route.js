export const dynamic = 'force-dynamic';
import { fetchSheet } from '@/lib/sheets';
import { NextResponse } from 'next/server';

export async function GET(request, { params }) {
  try {
    const { policyNumber } = await params;
    if (!policyNumber) return NextResponse.json({ error: 'policyNumber required' }, { status: 400 });

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
        agentId: r['Agent ID'] || '',
        transactionType: r['Transaction Type'],
        description: r['Description'] || '',
        product: r['Product'] || '',
        issueDate: r['Issue Date'] || '',
        premium: parseFloat(r['Premium']) || 0,
        commissionPct: r['Commission %'] ? parseFloat(r['Commission %']) : null,
        advancePct: r['Advance %'] ? parseFloat(r['Advance %']) : null,
        advanceAmount: parseFloat(r['Advance Amount']) || 0,
        commissionAmount: parseFloat(r['Commission Amount']) || 0,
        netCommission: parseFloat(r['Net Commission']) || 0,
        outstandingBalance: parseFloat(r['Outstanding Balance']) || 0,
        chargebackAmount: parseFloat(r['Chargeback Amount']) || 0,
        recoveryAmount: parseFloat(r['Recovery Amount']) || 0,
        netImpact: parseFloat(r['Net Impact']) || 0,
        matchedPolicy: r['Matched Policy #'],
        matchType: r['Match Type'],
        matchConfidence: parseFloat(r['Match Confidence']) || 0,
        status: r['Status'],
        statementFile: r['Statement File'],
        notes: r['Notes'],
      }));

    // Find the sales row for context — expanded fields
    const salesRow = salesRows.find(r => (r['Policy #'] || '').trim() === policyNumber);
    const policyInfo = salesRow ? {
      insuredName: `${salesRow['First Name'] || ''} ${salesRow['Last Name'] || ''}`.trim(),
      carrier: (salesRow['Carrier + Product + Payout'] || '').split(',')[0]?.trim() || '',
      product: (salesRow['Carrier + Product + Payout'] || '').split(',').slice(1).join(',').split(',')[0]?.trim() || '',
      premium: parseFloat(salesRow['Monthly Premium']) || 0,
      agent: salesRow['Agent'] || '',
      status: salesRow['Policy Status']?.trim() || salesRow['Placed?']?.trim() || '',
      effectiveDate: salesRow['Effective Date'] || '',
      submitDate: salesRow['Application Submitted Date'] || '',
      faceAmount: salesRow['Face Amount'] || '',
      leadSource: salesRow['Lead Source'] || '',
      paymentType: salesRow['Payment Type'] || '',
      state: salesRow['State'] || '',
      phone: salesRow['Phone Number (US format)'] || salesRow['Phone Number'] || '',
      textFriendly: salesRow['Text Friendly'] || '',
    } : null;

    // Carrier-aggregated comparison data (from most recent entry)
    const sortedByDate = [...entries].sort((a, b) => {
      const da = a.statementDate || '', db = b.statementDate || '';
      return da.localeCompare(db);
    });
    const mostRecent = sortedByDate.length > 0 ? sortedByDate[sortedByDate.length - 1] : null;
    // Use the first advance entry for premium (most reliable)
    const firstAdvance = entries.find(e => e.transactionType === 'advance' && e.premium > 0);

    const carrierData = {
      carrierPremium: firstAdvance?.premium || mostRecent?.premium || null,
      carrierAgent: mostRecent?.agent || null,
      carrierAgentId: mostRecent?.agentId || null,
      carrierProduct: mostRecent?.product || entries.find(e => e.product)?.product || null,
      issueDate: entries.find(e => e.issueDate)?.issueDate || null,
      lastStatementDate: mostRecent?.statementDate || null,
      entryCount: entries.length,
    };

    // Detect mismatches between sale data and carrier data
    const mismatches = [];
    if (policyInfo && carrierData.carrierPremium != null) {
      // Premium comparison — carrier premium is often annual, sale is monthly
      const salePremMonthly = policyInfo.premium;
      const carrierPrem = carrierData.carrierPremium;
      // Check if carrier annual ÷ 12 ≈ sale monthly
      const carrierMonthly = carrierPrem / 12;
      const directMatch = Math.abs(salePremMonthly - carrierPrem) < 0.02;
      const annualMatch = Math.abs(salePremMonthly - carrierMonthly) < 0.02;
      if (!directMatch && !annualMatch && salePremMonthly > 0) {
        mismatches.push({
          field: 'premium',
          sale: salePremMonthly,
          carrier: carrierPrem,
          note: `Sale: $${salePremMonthly}/mo, Carrier: $${carrierPrem} (annual = $${carrierMonthly.toFixed(2)}/mo)`,
        });
      }
    }
    if (policyInfo && carrierData.carrierAgent) {
      const saleAgent = (policyInfo.agent || '').toLowerCase().trim();
      const carrierAgent = (carrierData.carrierAgent || '').toLowerCase().trim();
      // Loose match — check if last names match
      const saleLast = saleAgent.split(/[,\s]+/)[0];
      const carrierLast = carrierAgent.split(/[,\s]+/)[0];
      if (saleLast && carrierLast && saleLast !== carrierLast) {
        mismatches.push({ field: 'agent', sale: policyInfo.agent, carrier: carrierData.carrierAgent });
      }
    }

    // Calculate totals
    const totalPaid = entries.filter(e => e.commissionAmount > 0).reduce((s, e) => s + e.commissionAmount, 0);
    const totalClawback = entries.filter(e => e.commissionAmount < 0).reduce((s, e) => s + Math.abs(e.commissionAmount), 0);
    const totalAdvances = entries.reduce((s, e) => s + e.advanceAmount, 0);
    const totalChargebacks = entries.reduce((s, e) => s + e.chargebackAmount, 0);
    const totalRecoveries = entries.reduce((s, e) => s + e.recoveryAmount, 0);
    const totalNetImpact = entries.reduce((s, e) => s + e.netImpact, 0);

    return NextResponse.json({
      policyNumber,
      policyInfo,
      carrierData,
      mismatches,
      entries,
      totalPaid: Math.round(totalPaid * 100) / 100,
      totalClawback: Math.round(totalClawback * 100) / 100,
      netCommission: Math.round((totalPaid - totalClawback) * 100) / 100,
      totalAdvances: Math.round(totalAdvances * 100) / 100,
      totalChargebacks: Math.round(totalChargebacks * 100) / 100,
      totalRecoveries: Math.round(totalRecoveries * 100) / 100,
      totalNetImpact: Math.round(totalNetImpact * 100) / 100,
    });
  } catch (error) {
    console.error('[commission-policy] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
