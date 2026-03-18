export const dynamic = 'force-dynamic';
import { fetchSheet } from '@/lib/sheets';
import { calcCommission } from '@/lib/utils';
import { NextResponse } from 'next/server';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const view = searchParams.get('view') || 'statements';
    const carrierFilter = searchParams.get('carrier');
    const policyFilter = searchParams.get('policyNumber');

    const salesSheetId = process.env.SALES_SHEET_ID;
    const ledgerTab = process.env.COMMISSION_LEDGER_TAB || 'Commission Ledger';
    const statementsTab = process.env.COMMISSION_STATEMENTS_TAB || 'Commission Statements';

    // ─── Statements view ───────────────────────────────────
    if (view === 'statements') {
      const rows = await fetchSheet(salesSheetId, statementsTab, 60);
      const statements = rows.map(r => ({
        statementId: r['Statement ID'],
        uploadDate: r['Upload Date'],
        carrier: r['Carrier'],
        statementPeriod: r['Statement Period'],
        fileName: r['File Name'],
        fileType: r['File Type'],
        totalRecords: parseInt(r['Total Records']) || 0,
        matched: parseInt(r['Matched']) || 0,
        unmatched: parseInt(r['Unmatched']) || 0,
        pendingReview: parseInt(r['Pending Review']) || 0,
        totalAdvances: parseFloat(r['Total Advances']) || 0,
        totalRecoveries: parseFloat(r['Total Recoveries']) || 0,
        netAmount: parseFloat(r['Net Amount']) || 0,
        cancellationsDetected: parseInt(r['Cancellations Detected']) || 0,
        status: r['Status'],
      }));
      return NextResponse.json({ statements });
    }

    // ─── Ledger view ───────────────────────────────────────
    if (view === 'ledger') {
      const rows = await fetchSheet(salesSheetId, ledgerTab, 60);
      let entries = rows.map(r => ({
        // Core identity
        transactionId: r['Transaction ID'],
        statementDate: r['Statement Date'],
        processingDate: r['Processing Date'],
        carrier: r['Carrier'],
        policyNumber: r['Policy #'],
        insuredName: r['Insured Name'],
        // Agent info
        agent: r['Writing Agent'] || r['Agent'] || '',  // backwards compat with old column name
        agentId: r['Writing Agent ID'] || '',
        commissionAgent: r['Commission Agent'] || '',
        commissionAgentId: r['Commission Agent ID'] || '',
        // Transaction classification
        transactionType: r['Transaction Type'],
        description: r['Description'] || '',
        productCode: r['Product Code'] || '',
        // Dates
        issueDate: r['Issue Date'] || '',
        // Premiums
        premium: parseFloat(r['Premium (Annual)'] || r['Premium']) || 0,  // backwards compat
        premiumModal: parseFloat(r['Premium (Modal)']) || 0,
        // Rates
        splitPct: r['Split %'] ? parseFloat(r['Split %']) : null,
        commissionPct: r['Commission %'] ? parseFloat(r['Commission %']) : null,
        advancePct: r['Advance %'] ? parseFloat(r['Advance %']) : null,
        adjRate: r['Adjustment Rate'] ? parseFloat(r['Adjustment Rate']) : null,
        // Amounts
        advanceAmount: parseFloat(r['Advance Amount']) || 0,
        commissionAmount: parseFloat(r['Commission Amount']) || 0,
        netCommission: parseFloat(r['Net Commission']) || 0,
        outstandingBalance: parseFloat(r['Outstanding Balance']) || 0,
        chargebackAmount: parseFloat(r['Chargeback Amount']) || 0,
        recoveryAmount: parseFloat(r['Recovery Amount']) || 0,
        // Policy details
        frequency: r['Payment Frequency'] || '',
        policyFee: parseFloat(r['Policy Fee']) || 0,
        age: r['Age'] || '',
        gender: r['Gender'] || '',
        // Matching
        matchedPolicy: r['Matched Policy #'],
        matchType: r['Match Type'],
        matchConfidence: parseFloat(r['Match Confidence']) || 0,
        status: r['Status'],
        // Metadata
        statementFile: r['Statement File'],
        notes: r['Notes'],
      }));

      // Apply filters
      if (carrierFilter) entries = entries.filter(e => e.carrier.toLowerCase().includes(carrierFilter.toLowerCase()));
      if (policyFilter) entries = entries.filter(e => e.policyNumber === policyFilter || e.matchedPolicy === policyFilter);

      const summary = {
        totalEntries: entries.length,
        totalAdvances: entries.filter(e => e.commissionAmount > 0).reduce((s, e) => s + e.commissionAmount, 0),
        totalRecoveries: entries.filter(e => e.commissionAmount < 0).reduce((s, e) => s + Math.abs(e.commissionAmount), 0),
        byCarrier: {},
        byType: {},
      };

      entries.forEach(e => {
        if (!summary.byCarrier[e.carrier]) summary.byCarrier[e.carrier] = { advances: 0, recoveries: 0, count: 0 };
        summary.byCarrier[e.carrier].count++;
        if (e.commissionAmount > 0) summary.byCarrier[e.carrier].advances += e.commissionAmount;
        else summary.byCarrier[e.carrier].recoveries += Math.abs(e.commissionAmount);

        if (!summary.byType[e.transactionType]) summary.byType[e.transactionType] = 0;
        summary.byType[e.transactionType]++;
      });

      return NextResponse.json({ entries, summary });
    }

    // ─── Pending review view ───────────────────────────────
    if (view === 'pending') {
      const rows = await fetchSheet(salesSheetId, ledgerTab, 60);
      const pending = rows
        .filter(r => r['Status'] === 'pending_review')
        .map(r => ({
          transactionId: r['Transaction ID'],
          statementDate: r['Statement Date'],
          carrier: r['Carrier'],
          policyNumber: r['Policy #'],
          insuredName: r['Insured Name'],
          agent: r['Agent'],
          transactionType: r['Transaction Type'],
          commissionAmount: parseFloat(r['Commission Amount']) || 0,
          outstandingBalance: parseFloat(r['Outstanding Balance']) || 0,
          matchedPolicy: r['Matched Policy #'],
          matchType: r['Match Type'],
          matchConfidence: parseFloat(r['Match Confidence']) || 0,
          notes: r['Notes'],
          statementFile: r['Statement File'],
        }));
      return NextResponse.json({ pendingReviews: pending });
    }

    // ─── Reconciliation view ───────────────────────────────
    if (view === 'reconciliation') {
      const [ledgerRows, salesRows, commRows] = await Promise.all([
        fetchSheet(salesSheetId, ledgerTab, 60),
        fetchSheet(salesSheetId, process.env.SALES_TAB_NAME || 'Sheet1', 0),
        fetchSheet(process.env.COMMISSION_SHEET_ID, process.env.COMMISSION_TAB_NAME || 'Sheet1', 3600),
      ]);

      // Build per-policy commission balance
      const policyMap = {};

      // Add all sales tracker policies
      for (const sr of salesRows) {
        const pn = (sr['Policy #'] || '').trim();
        if (!pn) continue;
        const carrier = (sr['Carrier + Product + Payout'] || '').split(',')[0]?.trim() || '';
        const product = (sr['Carrier + Product + Payout'] || '').split(',').slice(1).join(',').split(',')[0]?.trim() || '';
        const premium = parseFloat(sr['Monthly Premium']) || 0;

        // Calculate expected commission
        const commRates = commRows.map(r => ({
          carrier: r['Carrier']?.trim(),
          product: r['Product']?.trim(),
          ageRange: r['Age range']?.trim() || r['Age Range']?.trim() || 'n/a',
          commissionRate: parseFloat((r['Commission Rate'] || '0').replace('%', '')) / 100,
        }));
        const commResult = calcCommission(premium, carrier, product, 0, commRates);
        const expectedComm = commResult.matched ? premium * commResult.rate * 9 : premium * 9; // rough estimate

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
        };
      }

      // Aggregate ledger entries
      for (const lr of ledgerRows) {
        const matchedPn = (lr['Matched Policy #'] || '').trim();
        const amount = parseFloat(lr['Commission Amount']) || 0;
        if (matchedPn && policyMap[matchedPn]) {
          if (amount > 0) policyMap[matchedPn].totalPaid += amount;
          else policyMap[matchedPn].totalClawback += Math.abs(amount);
          policyMap[matchedPn].entries++;
        }
      }

      // Calculate net and filter to policies with commission activity
      const policies = Object.values(policyMap).map(p => ({
        ...p,
        netReceived: Math.round((p.totalPaid - p.totalClawback) * 100) / 100,
        totalPaid: Math.round(p.totalPaid * 100) / 100,
        totalClawback: Math.round(p.totalClawback * 100) / 100,
        balance: Math.round((p.expectedCommission - p.totalPaid + p.totalClawback) * 100) / 100,
      }));

      const withActivity = policies.filter(p => p.entries > 0);
      const totalExpected = withActivity.reduce((s, p) => s + p.expectedCommission, 0);
      const totalReceived = withActivity.reduce((s, p) => s + p.netReceived, 0);

      return NextResponse.json({
        policies: withActivity,
        summary: {
          totalPolicies: withActivity.length,
          totalExpected: Math.round(totalExpected * 100) / 100,
          totalReceived: Math.round(totalReceived * 100) / 100,
          variance: Math.round((totalReceived - totalExpected) * 100) / 100,
          discrepancies: withActivity.filter(p => Math.abs(p.balance) > 1).length,
        },
      });
    }

    return NextResponse.json({ error: 'Unknown view: ' + view }, { status: 400 });
  } catch (error) {
    console.error('[commission-statements] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
