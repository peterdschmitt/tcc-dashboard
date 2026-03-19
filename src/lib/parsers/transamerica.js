/**
 * TransAmerica Life Insurance Company commission statement parser.
 *
 * Handles both XLS/XLSX and CSV advance/as-earned reports.
 * Common headers include:
 *   Commission Agent Last/First Name, Commission Agent Business Name,
 *   Commission Agent Number, Statutory Company Name, Transaction Date,
 *   Policy Number, Insured Last/First Name, Description,
 *   Writing Agent Last/First Name, Writing Agent Business Name,
 *   Writing Agent Number, Commission Premium, Split%, Commission%, Adv%,
 *   Advance Amount, Commission Amount, Net Commission Amount,
 *   Writing Agent Chargeback, Writing Agent Ending Balance, etc.
 *
 * File naming: "TA Advance report M.D.YY.xls", "TA As Earned M.D.YY.xls",
 *   "Advances_0007009097_DDMonYY.csv"
 */

export const carrierId = 'transamerica';
export const carrierNames = ['TransAmerica', 'Transamerica Life Insurance'];

export function canParse(text, filename) {
  const hasFilename = /TA\s+(Advance|As\s+Earned)/i.test(filename)
    || /transamerica/i.test(filename)
    || /^Advances_\d+/i.test(filename);
  const hasHeaders = /Commission Agent.*Policy Number/i.test(text);
  const hasTA = /Transamerica Life Insurance/i.test(text);
  return hasFilename || hasHeaders || hasTA;
}

export async function parse(buffer, text, workbook) {
  // Get rows — from workbook (XLS/XLSX) or parse CSV text directly
  let rows;
  if (workbook) {
    const { utils } = await import('xlsx');
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = utils.sheet_to_json(sheet, { header: 1, defval: '' });
  } else if (buffer && (buffer.length > 0)) {
    // Try xlsx first (handles CSV too), fall back to manual CSV parse
    try {
      const { read, utils } = await import('xlsx');
      const wb = read(buffer, { type: 'buffer' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      rows = utils.sheet_to_json(sheet, { header: 1, defval: '' });
    } catch {
      rows = parseCSVText(text || buffer.toString('utf-8'));
    }
  } else {
    rows = parseCSVText(text);
  }

  if (!rows || rows.length < 2) return { statementDate: '', payPeriod: '', agentSummary: [], records: [] };

  // Find header row — look for row containing "Policy Number"
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const rowText = rows[i].map(c => String(c)).join('|');
    if (/Policy Number/i.test(rowText)) { headerIdx = i; break; }
  }
  if (headerIdx < 0) {
    console.warn('[transamerica] Could not find header row with "Policy Number"');
    return { statementDate: '', payPeriod: '', agentSummary: [], records: [] };
  }

  // Build column index (case-insensitive, trimmed)
  const headerRow = rows[headerIdx];
  const colIdx = {};
  headerRow.forEach((h, i) => {
    const key = String(h).trim();
    if (key) colIdx[key] = i;
  });

  // Helper to get column by name
  const col = (row, name) => {
    const idx = colIdx[name];
    return idx != null ? String(row[idx] ?? '').trim() : '';
  };
  const colNum = (row, name) => {
    const idx = colIdx[name];
    return idx != null ? parseNum(row[idx]) : 0;
  };

  const records = [];
  const agentTotals = {};
  let statementDate = '';

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 5) continue;

    const policyNumber = col(row, 'Policy Number');
    if (!policyNumber) continue;

    const insuredLast = col(row, 'Insured Last Name');
    const insuredFirst = col(row, 'Insured First Name');
    const description = col(row, 'Description');
    const writingLast = col(row, 'Writing Agent Last Name');
    const writingFirst = col(row, 'Writing Agent First Name');
    const writingNumber = col(row, 'Writing Agent Number');
    const commAgentLast = col(row, 'Commission Agent Last Name');
    const commAgentFirst = col(row, 'Commission Agent First Name');
    const commAgentNumber = col(row, 'Commission Agent Number');

    // Parse transaction date
    let txnDate = row[colIdx['Transaction Date']];
    if (typeof txnDate === 'number') {
      const d = new Date((txnDate - 25569) * 86400000);
      txnDate = d.toLocaleDateString('en-US');
    } else {
      txnDate = String(txnDate || '').trim();
    }
    if (!statementDate && txnDate) statementDate = txnDate;

    const commPrem = colNum(row, 'Commission Premium');
    const splitPct = colNum(row, 'Split %');
    const commPct = colNum(row, 'Commission %');
    const advPct = colNum(row, 'Adv %');
    const advanceAmount = colNum(row, 'Advance Amount');
    const commAmount = colNum(row, 'Commission Amount');
    const netCommission = colNum(row, 'Net Commission Amount');
    const chargeback = colNum(row, 'Writing Agent Chargeback');
    const recovery = colNum(row, 'Writing Agent Less Recovery Amount');
    const endingBalance = colNum(row, 'Writing Agent Ending Balance');

    // Determine transaction type from Description
    let transactionType = 'advance';
    let isCancellation = false;
    const descLower = description.toLowerCase();
    if (descLower.includes('chargeback') || descLower.includes('cancel')) {
      transactionType = 'chargeback';
      isCancellation = true;
    } else if (descLower.includes('recovery') || descLower.includes('recov')) {
      transactionType = 'recovery';
    } else if (descLower.includes('as earned') || descLower.includes('earned')) {
      transactionType = 'as_earned';
    } else if (descLower.includes('ow ') || descLower.includes('override') || descLower.includes('overwrite')) {
      transactionType = 'override';
    }

    const amount = advanceAmount || commAmount || netCommission || 0;
    const finalAmount = isCancellation ? -Math.abs(amount) : amount;

    const insuredName = insuredLast + (insuredFirst ? ', ' + insuredFirst : '');
    const agentName = (writingLast ? writingLast + (writingFirst ? ', ' + writingFirst : '') : '')
      || (commAgentLast ? commAgentLast + (commAgentFirst ? ', ' + commAgentFirst : '') : '');
    const commAgentName = commAgentLast + (commAgentFirst ? ', ' + commAgentFirst : '');

    records.push({
      policyNumber,
      insuredName,
      agent: agentName,
      agentId: writingNumber,
      commissionAgent: commAgentName,
      commissionAgentId: commAgentNumber,
      effDate: txnDate,
      transactionType,
      commType: description,
      premium: commPrem,
      premiumPaid: 0,
      commissionAmount: finalAmount,
      netCommission,
      outstandingBalance: endingBalance,
      chargebackAmount: chargeback,
      recoveryAmount: recovery,
      splitPct,
      commissionPct: commPct,
      advancePct: advPct,
      advanceAmount: advanceAmount,
      product: '',
      cancellationIndicator: isCancellation,
      section: descLower.includes('ow ') || descLower.includes('override') ? 'override' : 'advance',
      rawLine: JSON.stringify(row),
    });

    // Aggregate agent totals
    const agentKey = writingNumber || commAgentLast;
    if (agentKey) {
      if (!agentTotals[agentKey]) {
        agentTotals[agentKey] = { agentId: agentKey, agentName: agentName, totalPaid: 0, totalRecovered: 0, netCommission: 0 };
      }
      if (finalAmount >= 0) agentTotals[agentKey].totalPaid += finalAmount;
      else agentTotals[agentKey].totalRecovered += finalAmount;
    }
  }

  const agentSummary = Object.values(agentTotals).map(a => ({
    ...a,
    netCommission: a.totalPaid + a.totalRecovered,
  }));

  return {
    carrier: 'TransAmerica',
    statementDate,
    payPeriod: statementDate,
    agentSummary,
    records,
  };
}

/** Manual CSV parser for when xlsx can't handle the file */
function parseCSVText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  return lines.map(line => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { result.push(current); current = ''; continue; }
      current += ch;
    }
    result.push(current);
    return result;
  });
}

function parseNum(val) {
  if (val == null || val === '') return 0;
  if (typeof val === 'number') return val;
  const clean = String(val).replace(/[$,\s"]/g, '').replace(/[()]/g, m => m === '(' ? '-' : '');
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}
