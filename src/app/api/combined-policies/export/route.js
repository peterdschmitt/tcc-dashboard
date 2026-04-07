export const dynamic = 'force-dynamic';
import { fetchSheet } from '@/lib/sheets';
import { calcCommission } from '@/lib/utils';
import { NextResponse } from 'next/server';

function normalizeStatus(raw) {
  if (!raw) return 'Unknown';
  const map = {
    'cancelled': 'Canceled', 'canceled': 'Canceled', 'declined': 'Declined',
    'lapsed': 'Lapsed', 'active - in force': 'Active - In Force',
    'submitted - pending': 'Pending', 'hold application': 'Hold Application',
    'initial premium not paid': 'Initial Premium Not Paid', 'needreqmnt': 'NeedReqmnt',
    'unknown': 'Unknown', 'pending': 'Pending', '': 'Unknown',
  };
  return map[raw.toLowerCase()] || raw;
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

    const commRates = commRows.map(r => ({
      carrier: r['Carrier']?.trim(), product: r['Product']?.trim(),
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
        carrier, product, premium,
        agent: sr['Agent'] || '',
        status: normalizeStatus(sr['Policy Status']?.trim() || sr['Placed?']?.trim() || ''),
        submitDate: sr['Application Submitted Date']?.trim() || '',
        effectiveDate: sr['Effective Date']?.trim() || '',
        faceAmount: sr['Face Amount'] || '',
        leadSource: sr['Lead Source'] || '',
        phone: sr['Phone Number (US format)'] || sr['Phone Number'] || '',
        state: sr['State'] || '',
        expectedCommission: Math.round(expectedComm * 100) / 100,
        annualPremium: Math.round(premium * 12 * 100) / 100,
        ledgerEntries: [],
      };
    }

    // Attach ledger entries to policies
    for (const lr of ledgerRows) {
      const matchedPn = (lr['Matched Policy #'] || '').trim();
      if (matchedPn && policyMap[matchedPn]) {
        policyMap[matchedPn].ledgerEntries.push(lr);
      }
    }

    const TERMINAL = new Set(['canceled', 'declined', 'lapsed', 'initial premium not paid', 'needreqmnt', 'unknown']);

    // Build flat export rows
    const exportRows = [];
    const HEADERS = [
      'Policy #', 'Insured Name', 'Agent', 'Carrier', 'Product', 'Lead Source',
      'State', 'Phone', 'Date', 'Type', 'Description',
      'Mo Premium', 'Anl Premium', 'Face Amount', 'Expected Commission',
      'Commission %', 'Advance %', 'Advance Amount',
      'Commission Amount', 'Chargeback Amount', 'Recovery Amount',
      'Net Impact', 'Carrier Balance', 'Our Balance', 'Delta',
      'Commission Status', 'Sales Status', 'Statement File',
    ];

    for (const p of Object.values(policyMap)) {
      const isTerminal = TERMINAL.has((p.status || '').toLowerCase());
      const entries = p.ledgerEntries || [];

      // Running totals for this policy
      let totalPaid = 0, totalClawback = 0;
      entries.forEach(e => {
        const amt = parseFloat(e['Commission Amount']) || 0;
        if (amt > 0) totalPaid += amt; else totalClawback += Math.abs(amt);
      });
      const netReceived = totalPaid - totalClawback;
      const hasChargeback = totalClawback > 0;
      const commStatus = entries.length === 0 ? 'No Commission'
        : (hasChargeback || (isTerminal && totalPaid > 0)) ? 'Clawback' : 'Comm Active';

      // Calculate balance
      let carrierBal = null;
      if (entries.length > 0) {
        const lastBal = parseFloat(entries[entries.length - 1]['Outstanding Balance']) || 0;
        carrierBal = lastBal;
      }
      let ourBal;
      if (isTerminal || hasChargeback) ourBal = 0;
      else if (totalPaid > 0) ourBal = Math.round((totalPaid - totalClawback) * 100) / 100;
      else ourBal = Math.round((p.expectedCommission - totalClawback) * 100) / 100;
      const delta = carrierBal != null ? Math.round((carrierBal - ourBal) * 100) / 100 : null;

      // SALE row — all policy fields populated
      exportRows.push([
        p.policyNumber, p.insuredName, p.agent, p.carrier, p.product, p.leadSource,
        p.state, p.phone, p.submitDate || p.effectiveDate, 'SALE', '',
        p.premium, p.annualPremium, p.faceAmount, p.expectedCommission,
        '', '', '',
        '', '', '',
        '', carrierBal, ourBal, delta,
        commStatus, p.status, '',
      ]);

      // Carrier transaction rows — repeat policy fields so every row is pivot-ready
      let runningBalance = 0;
      entries.forEach(e => {
        const amt = parseFloat(e['Commission Amount']) || 0;
        const advAmt = parseFloat(e['Advance Amount']) || 0;
        const cbAmt = parseFloat(e['Chargeback Amount']) || 0;
        const recAmt = parseFloat(e['Recovery Amount']) || 0;
        const eBal = parseFloat(e['Outstanding Balance']) || 0;
        runningBalance += amt;

        exportRows.push([
          p.policyNumber, p.insuredName, p.agent, p.carrier, p.product, p.leadSource,
          p.state, p.phone,
          e['Statement Date'] || '', e['Transaction Type'] || '', e['Description'] || '',
          p.premium, parseFloat(e['Premium']) || p.annualPremium, p.faceAmount, p.expectedCommission,
          e['Commission %'] || '', e['Advance %'] || '', advAmt || '',
          amt, cbAmt || '', recAmt || '',
          amt, eBal, runningBalance, eBal ? Math.round((eBal - runningBalance) * 100) / 100 : '',
          commStatus, p.status, e['Statement File'] || '',
        ]);
      });

      // TOTAL rows removed — clean data export without subtotals
    }

    // Build XLSX workbook
    const { utils, write } = await import('xlsx');
    const ws = utils.aoa_to_sheet([HEADERS, ...exportRows]);

    // Set column widths
    ws['!cols'] = HEADERS.map(h => ({ wch: Math.max(h.length + 2, 12) }));

    // Format number columns as numbers (not strings)
    const numCols = new Set([11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
    for (let r = 1; r <= exportRows.length; r++) {
      for (const c of numCols) {
        const addr = utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (cell && cell.v !== '' && cell.v != null && !isNaN(cell.v)) {
          cell.t = 'n';
          cell.z = '#,##0.00';
        }
      }
    }

    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, 'Policy Export');
    const buf = write(wb, { type: 'buffer', bookType: 'xlsx' });

    const date = new Date().toISOString().slice(0, 10);
    return new Response(buf, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="TCC_Policy_Export_${date}.xlsx"`,
      },
    });
  } catch (error) {
    console.error('[export] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
