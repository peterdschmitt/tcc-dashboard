export const dynamic = 'force-dynamic';
import { fetchSheet } from '@/lib/sheets';
import { calcCommission } from '@/lib/utils';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const salesSheetId = process.env.SALES_SHEET_ID;
    const ledgerTab = process.env.COMMISSION_LEDGER_TAB || 'Commission Ledger';

    const [salesRows, ledgerRows, commRows] = await Promise.all([
      fetchSheet(salesSheetId, process.env.SALES_TAB_NAME || 'Sheet1', 0),
      fetchSheet(salesSheetId, ledgerTab, 60),
      fetchSheet(process.env.COMMISSION_SHEET_ID, process.env.COMMISSION_TAB_NAME || 'Sheet1', 3600),
    ]);

    // Commission rate lookup
    const commRates = commRows.map(r => ({
      carrier: r['Carrier']?.trim(),
      product: r['Product']?.trim(),
      ageRange: r['Age range']?.trim() || r['Age Range']?.trim() || 'n/a',
      commissionRate: parseFloat((r['Commission Rate'] || '0').replace('%', '')) / 100,
    }));

    // Build policy map from sales tracker
    const policyMap = {};
    for (const sr of salesRows) {
      const pn = (sr['Policy #'] || '').trim();
      if (!pn) continue;
      const carrier = (sr['Carrier + Product + Payout'] || '').split(',')[0]?.trim() || '';
      const product = (sr['Carrier + Product + Payout'] || '').split(',').slice(1).join(',').split(',')[0]?.trim() || '';
      const premium = parseFloat(sr['Monthly Premium']) || 0;
      const commResult = calcCommission(premium, carrier, product, 0, commRates);
      const expectedComm = commResult.matched ? premium * commResult.rate * 9 : premium * 9;

      policyMap[pn] = {
        policyNumber: pn,
        insuredName: `${sr['First Name'] || ''} ${sr['Last Name'] || ''}`.trim(),
        carrier,
        product,
        premium,
        agent: sr['Agent'] || '',
        status: sr['Policy Status']?.trim() || sr['Placed?']?.trim() || '',
        submitDate: sr['Application Submitted Date']?.trim() || '',
        effectiveDate: sr['Effective Date']?.trim() || '',
        expectedCommission: Math.round(expectedComm * 100) / 100,
        totalPaid: 0,
        totalClawback: 0,
        netReceived: 0,
        entries: 0,
        source: 'tracker', // originated from sales tracker
      };
    }

    // Aggregate ledger entries + track unmatched
    const unmatchedLedger = [];
    for (const lr of ledgerRows) {
      const matchedPn = (lr['Matched Policy #'] || '').trim();
      const rawPn = (lr['Policy #'] || '').trim();
      const amount = parseFloat(lr['Commission Amount']) || 0;

      if (matchedPn && policyMap[matchedPn]) {
        if (amount > 0) policyMap[matchedPn].totalPaid += amount;
        else policyMap[matchedPn].totalClawback += Math.abs(amount);
        policyMap[matchedPn].entries++;
      } else {
        // Ledger entry with no matching sales tracker policy
        unmatchedLedger.push({
          policyNumber: rawPn,
          insuredName: lr['Insured Name'] || '',
          agent: lr['Agent'] || '',
          carrier: lr['Carrier'] || '',
          transactionType: lr['Transaction Type'] || '',
          commissionAmount: amount,
          statementDate: lr['Statement Date'] || '',
          statementFile: lr['Statement File'] || '',
          matchType: lr['Match Type'] || 'none',
        });
      }
    }

    // Build final policy list with commission status
    const policies = Object.values(policyMap).map(p => {
      const netReceived = Math.round((p.totalPaid - p.totalClawback) * 100) / 100;
      let commissionStatus;
      if (p.entries === 0) commissionStatus = 'pending';
      else if (p.totalClawback > 0) commissionStatus = 'clawback';
      else commissionStatus = 'active';

      return {
        ...p,
        netReceived,
        totalPaid: Math.round(p.totalPaid * 100) / 100,
        totalClawback: Math.round(p.totalClawback * 100) / 100,
        balance: Math.round((p.expectedCommission - p.totalPaid + p.totalClawback) * 100) / 100,
        commissionStatus,
      };
    });

    // Summary counts
    const withComm = policies.filter(p => p.entries > 0);
    const pending = policies.filter(p => p.commissionStatus === 'pending');
    const clawbacks = policies.filter(p => p.commissionStatus === 'clawback');

    return NextResponse.json({
      policies,
      unmatchedLedger,
      summary: {
        totalPolicies: policies.length,
        withCommission: withComm.length,
        pending: pending.length,
        clawbacks: clawbacks.length,
        orphaned: unmatchedLedger.length,
        totalPremium: Math.round(policies.reduce((s, p) => s + p.premium, 0) * 100) / 100,
        totalExpected: Math.round(policies.reduce((s, p) => s + p.expectedCommission, 0) * 100) / 100,
        totalReceived: Math.round(withComm.reduce((s, p) => s + p.netReceived, 0) * 100) / 100,
        pendingPremium: Math.round(pending.reduce((s, p) => s + p.premium, 0) * 100) / 100,
      },
    });
  } catch (error) {
    console.error('[combined-policies] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
