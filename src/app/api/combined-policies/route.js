export const dynamic = 'force-dynamic';
import { fetchSheet } from '@/lib/sheets';
import { calcCommission } from '@/lib/utils';
import { NextResponse } from 'next/server';

// Normalize status spelling variants into canonical values
function normalizeStatus(raw) {
  if (!raw) return '';
  const STATUS_MAP = {
    'cancelled': 'Canceled',
    'canceled': 'Canceled',
    'declined': 'Declined',
    'lapsed': 'Lapsed',
    'active - in force': 'Active - In Force',
    'submitted - pending': 'Pending',
    'hold application': 'Hold Application',
    'initial premium not paid': 'Initial Premium Not Paid',
    'needreqmnt': 'NeedReqmnt',
    'unknown': 'Unknown',
    'pending': 'Pending',
    '': 'Unknown',
  };
  return STATUS_MAP[raw.toLowerCase()] || raw;
}

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
        status: normalizeStatus(sr['Policy Status']?.trim() || sr['Placed?']?.trim() || ''),
        submitDate: sr['Application Submitted Date']?.trim() || '',
        effectiveDate: sr['Effective Date']?.trim() || '',
        faceAmount: sr['Face Amount'] || '',
        leadSource: sr['Lead Source'] || '',
        paymentType: sr['Payment Type'] || '',
        state: sr['State'] || '',
        phone: sr['Phone Number'] || '',
        expectedCommission: Math.round(expectedComm * 100) / 100,
        totalPaid: 0,
        totalClawback: 0,
        netReceived: 0,
        entries: 0,
        source: 'tracker',
      };
    }

    // Terminal statuses — policy will never pay out, balance = $0
    const TERMINAL = new Set(['canceled', 'declined', 'lapsed', 'initial premium not paid', 'needreqmnt', 'unknown']);

    // Aggregate ledger entries + track unmatched
    const unmatchedLedger = [];
    for (const lr of ledgerRows) {
      const matchedPn = (lr['Matched Policy #'] || '').trim();
      const rawPn = (lr['Policy #'] || '').trim();
      const amount = parseFloat(lr['Commission Amount']) || 0;
      const carrierBal = parseFloat(lr['Outstanding Balance']) || 0;

      if (matchedPn && policyMap[matchedPn]) {
        if (amount > 0) policyMap[matchedPn].totalPaid += amount;
        else policyMap[matchedPn].totalClawback += Math.abs(amount);
        policyMap[matchedPn].entries++;
        // Track latest carrier balance (last entry wins)
        policyMap[matchedPn].latestCarrierBal = carrierBal;
        policyMap[matchedPn].hasCarrierBal = true;
      } else {
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

    // Build final policy list with commission status and balance logic
    const policies = Object.values(policyMap).map(p => {
      const netReceived = Math.round((p.totalPaid - p.totalClawback) * 100) / 100;
      const isTerminal = TERMINAL.has((p.status || '').toLowerCase());

      // If carrier charged back, policy is effectively cancelled regardless of tracker status
      const hasChargeback = p.totalClawback > 0;
      const effectiveTerminal = isTerminal || hasChargeback;

      // Carrier-inferred statuses: sales tracker statuses that reflect carrier-level outcomes
      const CARRIER_INFERRED = new Set(['hold application', 'declined', 'canceled', 'needreqmnt', 'lapsed', 'initial premium not paid', 'unknown']);
      const isCarrierInferred = CARRIER_INFERRED.has((p.status || '').toLowerCase());

      let commissionStatus;
      if (hasChargeback) commissionStatus = 'clawback';
      else if (isTerminal && p.totalPaid > 0) commissionStatus = 'clawback';
      else if (p.entries > 0 && !isCarrierInferred) commissionStatus = 'active';
      else if (isCarrierInferred) commissionStatus = 'carrierInferred';
      else commissionStatus = 'pending';

      // Balance logic:
      //   Terminal (canceled/declined/lapsed/unknown) → $0 (never getting paid)
      //   Has carrier statement → use carrier's outstanding balance (source of truth)
      //   Has payments but no carrier bal → paid - clawback (what we still owe back)
      //   No payments → expected - clawback (what we expect to receive)
      let balance;
      if (effectiveTerminal) {
        balance = 0;
      } else if (p.hasCarrierBal) {
        balance = Math.round(p.latestCarrierBal * 100) / 100;
      } else if (p.totalPaid > 0) {
        balance = Math.round((p.totalPaid - p.totalClawback) * 100) / 100;
      } else {
        balance = Math.round((p.expectedCommission - p.totalClawback) * 100) / 100;
      }

      // Liability: for chargebacks, the net loss is our liability
      const liability = effectiveTerminal && netReceived < 0 ? netReceived : null;

      return {
        ...p,
        netReceived,
        totalPaid: Math.round(p.totalPaid * 100) / 100,
        totalClawback: Math.round(p.totalClawback * 100) / 100,
        balance,
        balanceSource: isTerminal ? 'terminal' : p.hasCarrierBal ? 'carrier' : 'calculated',
        liability,
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
