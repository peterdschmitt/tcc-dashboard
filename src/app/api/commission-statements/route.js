export const dynamic = 'force-dynamic';
import { fetchSheet } from '@/lib/sheets';
import { calcCommission, normalizePlacedStatus } from '@/lib/utils';
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
        transactionId: r['Transaction ID'],
        statementDate: r['Statement Date'],
        processingDate: r['Processing Date'] || '',
        carrier: r['Carrier'],
        policyNumber: r['Policy #'],
        insuredName: r['Insured Name'],
        agent: r['Agent'] || '',
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
        matchType: r['Match Type'] || '',
        matchConfidence: parseFloat(r['Match Confidence']) || 0,
        status: r['Status'],
        statementFile: r['Statement File'],
        notes: r['Notes'] || '',
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

      // Deduplicate ledger entries: same policy + date + amount + type = duplicate
      const seenLedger = new Set();
      const dedupedLedger = [];
      let dupesRemoved = 0;
      for (const lr of ledgerRows) {
        const key = [
          (lr['Policy #'] || '').trim(),
          (lr['Statement Date'] || '').trim(),
          (lr['Commission Amount'] || '0').trim(),
          (lr['Transaction Type'] || '').trim(),
          (lr['Agent ID'] || '').trim(),
        ].join('|');
        if (seenLedger.has(key)) { dupesRemoved++; continue; }
        seenLedger.add(key);
        dedupedLedger.push(lr);
      }
      if (dupesRemoved > 0) console.log(`[reconciliation] Removed ${dupesRemoved} duplicate ledger entries`);

      // Build commission rate lookup once
      const commRates = commRows.map(r => ({
        carrier: r['Carrier']?.trim(),
        product: r['Product']?.trim(),
        ageRange: r['Age range']?.trim() || r['Age Range']?.trim() || 'n/a',
        commissionRate: parseFloat((r['Commission Rate'] || '0').replace('%', '')) / 100,
      }));

      // Build per-policy commission balance
      const policyMap = {};

      // Add all sales tracker policies
      for (const sr of salesRows) {
        const pn = (sr['Policy #'] || '').trim();
        if (!pn) continue;
        const carrier = (sr['Carrier + Product + Payout'] || '').split(',')[0]?.trim() || '';
        const product = (sr['Carrier + Product + Payout'] || '').split(',').slice(1).join(',').split(',')[0]?.trim() || '';
        const premium = parseFloat(sr['Monthly Premium']) || 0;

        // Calculate expected commission: premium × commission rate (rate already includes advance months)
        const commResult = calcCommission(premium, carrier, product, 0, commRates);
        // Commission rate from sheet is the advance % (e.g., 135% = premium × 1.35 × advance months)
        // Expected total advance = premium × rate × advance months (typically 9, 6 for CICA)
        const advMonths = commResult.advanceMonths || 9;
        const expectedComm = commResult.matched
          ? premium * commResult.rate * advMonths
          : premium * 9;

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
          commissionRate: commResult.matched ? commResult.rate : null,
          advanceMonths: advMonths,
          totalPaid: 0,
          totalClawback: 0,
          netReceived: 0,
          entries: 0,
        };
      }

      // Aggregate deduped ledger entries
      for (const lr of dedupedLedger) {
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
          duplicatesRemoved: dupesRemoved,
        },
      });
    }

    // ─── Waterfall view ─────────────────────────────────────
    // All policies from sales sheet, enriched with commission + carrier data
    if (view === 'waterfall') {
      // Fetch all data sources in parallel
      const [salesRows, ledgerRows, commRows] = await Promise.all([
        fetchSheet(salesSheetId, process.env.SALES_TAB_NAME || 'Sheet1', 0),
        fetchSheet(salesSheetId, ledgerTab, 60),
        fetchSheet(process.env.COMMISSION_SHEET_ID, process.env.COMMISSION_TAB_NAME || 'Sheet1', 3600),
      ]);

      // Deduplicate ledger
      const seenLedger = new Set();
      const dedupedLedger = [];
      for (const lr of ledgerRows) {
        const key = [
          (lr['Policy #'] || '').trim(),
          (lr['Statement Date'] || '').trim(),
          (lr['Commission Amount'] || '0').trim(),
          (lr['Transaction Type'] || '').trim(),
          (lr['Agent ID'] || '').trim(),
        ].join('|');
        if (seenLedger.has(key)) continue;
        seenLedger.add(key);
        dedupedLedger.push(lr);
      }

      // Commission rates lookup
      const commRates = commRows.map(r => ({
        carrier: r['Carrier']?.trim(),
        product: r['Product']?.trim(),
        ageRange: r['Age range']?.trim() || r['Age Range']?.trim() || 'n/a',
        commissionRate: parseFloat((r['Commission Rate'] || '0').replace('%', '')) / 100,
      }));

      // Build unified policy map from sales tracker
      const policyMap = {};
      for (const sr of salesRows) {
        const pn = (sr['Policy #'] || '').trim();
        if (!pn) continue;
        const carrier = (sr['Carrier + Product + Payout'] || '').split(',')[0]?.trim() || '';
        const product = (sr['Carrier + Product + Payout'] || '').split(',').slice(1).join(',').split(',')[0]?.trim() || '';
        const premium = parseFloat(sr['Monthly Premium']) || 0;

        const commResult = calcCommission(premium, carrier, product, 0, commRates);
        const advMonths = commResult.advanceMonths || 9;
        const expectedComm = commResult.matched ? premium * commResult.rate * advMonths : 0;

        policyMap[pn] = {
          policyNumber: pn,
          insuredName: `${sr['First Name'] || ''} ${sr['Last Name'] || ''}`.trim(),
          carrier,
          product,
          premium,
          agent: sr['Agent'] || '',
          phone: (sr['Phone Number (US format)'] || sr['Phone Number'] || '').trim(),
          textFriendly: sr['Text Friendly']?.trim() || '',
          status: sr['Policy Status']?.trim() || normalizePlacedStatus(sr['Placed?']) || '',
          submitDate: sr['Application Submitted Date']?.trim() || '',
          effectiveDate: sr['Effective Date']?.trim() || '',
          expectedCommission: Math.round(expectedComm * 100) / 100,
          commissionRate: commResult.matched ? commResult.rate : null,
          advanceMonths: advMonths,
          totalPaid: 0,
          totalClawback: 0,
          netReceived: 0,
          entries: 0,
        };
      }

      // Collect all unique months from ledger for column headers
      const allMonths = new Set();

      // Aggregate deduped ledger entries (with monthly breakdown)
      for (const lr of dedupedLedger) {
        const matchedPn = (lr['Matched Policy #'] || '').trim();
        const amount = parseFloat(lr['Commission Amount']) || 0;
        if (matchedPn && policyMap[matchedPn]) {
          if (amount > 0) policyMap[matchedPn].totalPaid += amount;
          else policyMap[matchedPn].totalClawback += Math.abs(amount);
          policyMap[matchedPn].entries++;

          // Monthly breakdown — parse statement date to YYYY-MM
          const rawDate = (lr['Statement Date'] || '').trim();
          let monthKey = null;
          // Try MM/DD/YYYY or M/D/YYYY
          const mdyMatch = rawDate.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
          if (mdyMatch) {
            monthKey = mdyMatch[3] + '-' + mdyMatch[1].padStart(2, '0');
          } else {
            // Try YYYY-MM-DD
            const isoMatch = rawDate.match(/(\d{4})-(\d{1,2})/);
            if (isoMatch) monthKey = isoMatch[1] + '-' + isoMatch[2].padStart(2, '0');
          }
          if (monthKey) {
            allMonths.add(monthKey);
            if (!policyMap[matchedPn].monthlyPayments) policyMap[matchedPn].monthlyPayments = {};
            policyMap[matchedPn].monthlyPayments[monthKey] = (policyMap[matchedPn].monthlyPayments[monthKey] || 0) + amount;
          }
        }
      }

      // Sort months chronologically
      const sortedMonths = [...allMonths].sort();

      // Finalize all policies
      const DECLINED_STATUSES = ['declined'];
      const CANCELED_STATUSES = ['canceled', 'cancelled', 'lapsed'];
      const allPolicies = Object.values(policyMap).map(p => {
        const totalPaid = Math.round(p.totalPaid * 100) / 100;
        const totalClawback = Math.round(p.totalClawback * 100) / 100;
        const netReceived = Math.round((p.totalPaid - p.totalClawback) * 100) / 100;
        const statusLower = (p.status || '').toLowerCase();

        let balance;
        if (DECLINED_STATUSES.includes(statusLower)) {
          // Declined = never issued, nothing owed either way
          balance = 0;
        } else if (CANCELED_STATUSES.includes(statusLower)) {
          // Canceled = carrier advanced us money, we owe back unearned portion
          // If we were paid, balance = negative (liability). If never paid, $0.
          balance = netReceived > 0 ? -netReceived : 0;
        } else {
          // Active/Pending/etc = carrier owes us the difference
          balance = Math.round((p.expectedCommission - totalPaid + totalClawback) * 100) / 100;
        }

        const carrierPaid = p.entries > 0;
        // Round monthly payments
        const monthlyPayments = {};
        if (p.monthlyPayments) {
          for (const [m, amt] of Object.entries(p.monthlyPayments)) {
            monthlyPayments[m] = Math.round(amt * 100) / 100;
          }
        }
        return {
          ...p,
          totalPaid,
          totalClawback,
          netReceived,
          balance, // positive = carrier owes you, negative = overpaid
          carrierPaid, // true if any commission statement entry exists
          hasChargeback: totalClawback > 0,
          unpaid: ['Active - In Force', 'Advance Released'].includes(p.status) && !carrierPaid && p.premium > 0,
          monthlyPayments,
        };
      });

      // Summary
      const totalPremium = allPolicies.reduce((s, p) => s + p.premium, 0);
      const paidCount = allPolicies.filter(p => p.carrierPaid).length;
      const totalExpected = allPolicies.filter(p => p.expectedCommission > 0).reduce((s, p) => s + p.expectedCommission, 0);
      const totalReceived = allPolicies.reduce((s, p) => s + p.netReceived, 0);
      const totalBalance = allPolicies.reduce((s, p) => s + p.balance, 0);

      // By-status breakdown
      const byStatus = {};
      for (const p of allPolicies) {
        const st = p.status || '(No Status)';
        if (!byStatus[st]) byStatus[st] = { count: 0, premium: 0, paid: 0, expected: 0, received: 0, balance: 0 };
        byStatus[st].count++;
        byStatus[st].premium += p.premium;
        if (p.carrierPaid) byStatus[st].paid++;
        byStatus[st].expected += p.expectedCommission;
        byStatus[st].received += p.netReceived;
        byStatus[st].balance += p.balance;
      }

      // Gap analysis
      const unpaidActive = allPolicies.filter(p => p.unpaid);
      const unpaidPending = allPolicies.filter(p => ['Submitted - Pending', 'Pending'].includes(p.status) && !p.carrierPaid);
      const chargebacks = allPolicies.filter(p => p.hasChargeback);

      return NextResponse.json({
        policies: allPolicies,
        months: sortedMonths, // e.g. ['2025-11','2025-12','2026-01',...]
        summary: {
          totalPolicies: allPolicies.length,
          totalPremium: Math.round(totalPremium * 100) / 100,
          paidCount,
          totalExpected: Math.round(totalExpected * 100) / 100,
          totalReceived: Math.round(totalReceived * 100) / 100,
          totalBalance: Math.round(totalBalance * 100) / 100,
        },
        byStatus,
        gaps: {
          unpaidActive: { count: unpaidActive.length, premium: Math.round(unpaidActive.reduce((s, p) => s + p.premium, 0) * 100) / 100 },
          unpaidPending: { count: unpaidPending.length, premium: Math.round(unpaidPending.reduce((s, p) => s + p.premium, 0) * 100) / 100 },
          chargebacks: { count: chargebacks.length, amount: Math.round(chargebacks.reduce((s, p) => s + p.totalClawback, 0) * 100) / 100 },
        },
      });
    }

    // ─── Anticipated Payments view ────────────────────
    // Policies where we expect carrier payment but haven't received it yet
    if (view === 'anticipated') {
      const [salesRows, ledgerRows, commRows] = await Promise.all([
        fetchSheet(salesSheetId, process.env.SALES_TAB_NAME || 'Sheet1', 0),
        fetchSheet(salesSheetId, ledgerTab, 60),
        fetchSheet(process.env.COMMISSION_SHEET_ID, process.env.COMMISSION_TAB_NAME || 'Sheet1', 3600),
      ]);

      // Deduplicate ledger
      const seenLedger = new Set();
      const dedupedLedger = [];
      for (const lr of ledgerRows) {
        const key = [
          (lr['Policy #'] || '').trim(),
          (lr['Statement Date'] || '').trim(),
          (lr['Commission Amount'] || '0').trim(),
          (lr['Transaction Type'] || '').trim(),
          (lr['Agent ID'] || '').trim(),
        ].join('|');
        if (seenLedger.has(key)) continue;
        seenLedger.add(key);
        dedupedLedger.push(lr);
      }

      const commRates = commRows.map(r => ({
        carrier: r['Carrier']?.trim(),
        product: r['Product']?.trim(),
        ageRange: r['Age range']?.trim() || r['Age Range']?.trim() || 'n/a',
        commissionRate: parseFloat((r['Commission Rate'] || '0').replace('%', '')) / 100,
      }));

      // Build policies with commission data
      const policyMap = {};
      for (const sr of salesRows) {
        const pn = (sr['Policy #'] || '').trim();
        if (!pn) continue;
        const carrier = (sr['Carrier + Product + Payout'] || '').split(',')[0]?.trim() || '';
        const product = (sr['Carrier + Product + Payout'] || '').split(',').slice(1).join(',').split(',')[0]?.trim() || '';
        const premium = parseFloat(sr['Monthly Premium']) || 0;
        const commResult = calcCommission(premium, carrier, product, 0, commRates);
        const advMonths = commResult.advanceMonths || 9;
        const expectedComm = commResult.matched ? premium * commResult.rate * advMonths : 0;

        policyMap[pn] = {
          policyNumber: pn,
          insuredName: `${sr['First Name'] || ''} ${sr['Last Name'] || ''}`.trim(),
          carrier, product, premium,
          agent: sr['Agent'] || '',
          phone: (sr['Phone Number (US format)'] || sr['Phone Number'] || '').trim(),
          textFriendly: sr['Text Friendly']?.trim() || '',
          status: sr['Policy Status']?.trim() || normalizePlacedStatus(sr['Placed?']) || '',
          submitDate: sr['Application Submitted Date']?.trim() || '',
          effectiveDate: sr['Effective Date']?.trim() || '',
          outcome: sr['Outcome at Application Submission']?.trim() || '',
          expectedCommission: Math.round(expectedComm * 100) / 100,
          advanceMonths: advMonths,
          commissionRate: commResult.matched ? commResult.rate : null,
          hasPaid: false,
        };
      }

      // Mark policies that have ledger entries
      for (const lr of dedupedLedger) {
        const matchedPn = (lr['Matched Policy #'] || '').trim();
        if (matchedPn && policyMap[matchedPn]) {
          const amount = parseFloat(lr['Commission Amount']) || 0;
          if (amount > 0) policyMap[matchedPn].hasPaid = true;
        }
      }

      // Filter: unpaid + premium > 0
      const allUnpaid = Object.values(policyMap).filter(p => !p.hasPaid && p.premium > 0);

      // Categorize: anticipated (good-standing) vs unlikely
      const ANTICIPATED_STATUSES = ['Active - In Force', 'Advance Released', 'Submitted - Pending', 'Pending', 'Unknown'];
      const HOLD_STATUSES = ['Hold Application', 'NeedReqmnt', 'Initial Premium Not Paid', 'Not Yet Paid'];

      const anticipated = allUnpaid.filter(p => ANTICIPATED_STATUSES.includes(p.status));
      const onHold = allUnpaid.filter(p => HOLD_STATUSES.includes(p.status));
      const unlikely = allUnpaid.filter(p => !ANTICIPATED_STATUSES.includes(p.status) && !HOLD_STATUSES.includes(p.status));

      const sumPolicies = (arr) => ({
        count: arr.length,
        premium: Math.round(arr.reduce((s, p) => s + p.premium, 0) * 100) / 100,
        expectedCommission: Math.round(arr.reduce((s, p) => s + p.expectedCommission, 0) * 100) / 100,
      });

      // Days since submission for aging
      const now = new Date();
      const withAging = [...anticipated, ...onHold, ...unlikely].map(p => {
        let daysSinceSubmit = null;
        if (p.submitDate) {
          const parts = p.submitDate.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
          if (parts) {
            const yr = parts[3].length === 2 ? 2000 + parseInt(parts[3]) : parseInt(parts[3]);
            const dt = new Date(yr, parseInt(parts[1]) - 1, parseInt(parts[2]));
            daysSinceSubmit = Math.floor((now - dt) / 86400000);
          }
        }
        return { ...p, daysSinceSubmit };
      });

      // Aging buckets for anticipated
      const anticipatedWithAge = withAging.filter(p => ANTICIPATED_STATUSES.includes(p.status));
      const aging = {
        '0-30': anticipatedWithAge.filter(p => p.daysSinceSubmit != null && p.daysSinceSubmit <= 30),
        '31-60': anticipatedWithAge.filter(p => p.daysSinceSubmit != null && p.daysSinceSubmit > 30 && p.daysSinceSubmit <= 60),
        '61-90': anticipatedWithAge.filter(p => p.daysSinceSubmit != null && p.daysSinceSubmit > 60 && p.daysSinceSubmit <= 90),
        '90+': anticipatedWithAge.filter(p => p.daysSinceSubmit != null && p.daysSinceSubmit > 90),
        'unknown': anticipatedWithAge.filter(p => p.daysSinceSubmit == null),
      };

      return NextResponse.json({
        policies: withAging,
        summary: {
          total: sumPolicies(allUnpaid),
          anticipated: sumPolicies(anticipated),
          onHold: sumPolicies(onHold),
          unlikely: sumPolicies(unlikely),
        },
        aging: Object.fromEntries(Object.entries(aging).map(([k, arr]) => [k, sumPolicies(arr)])),
        categories: {
          anticipated: ANTICIPATED_STATUSES,
          onHold: HOLD_STATUSES,
        },
      });
    }

    return NextResponse.json({ error: 'Unknown view: ' + view }, { status: 400 });
  } catch (error) {
    console.error('[commission-statements] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
