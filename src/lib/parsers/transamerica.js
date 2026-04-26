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

  // TA sends two report shapes — detect which one this file is so we can
  // map the right column names. The "as earned" report uses combined
  // Insured Name + Comm type / Comm Amount / Earned Adv Amount columns;
  // the "advance" report uses split Insured Last/First Name + Description /
  // Commission Amount / Advance Amount columns.
  const isAsEarned = ('Comm type' in colIdx) || ('Earned Adv Amount' in colIdx);

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

    // Insured name: as-earned report has a single combined column;
    // advance report has split last/first columns.
    let insuredName;
    if (isAsEarned) {
      insuredName = col(row, 'Insured Name');
    } else {
      const insuredLast = col(row, 'Insured Last Name');
      const insuredFirst = col(row, 'Insured First Name');
      insuredName = insuredLast + (insuredFirst ? ', ' + insuredFirst : '');
    }

    // Description / transaction type column differs between reports.
    const description = isAsEarned ? col(row, 'Comm type') : col(row, 'Description');

    // Writing + commission agent: as-earned has combined "Writing Agent Name",
    // advance has split last/first.
    let agentName, commAgentName;
    const writingNumber = col(row, 'Writing Agent Number');
    const commAgentNumber = col(row, 'Commission Agent Number');
    if (isAsEarned) {
      agentName = col(row, 'Writing Agent Name');
      commAgentName = col(row, 'Commission Agent Name');
    } else {
      const writingLast = col(row, 'Writing Agent Last Name');
      const writingFirst = col(row, 'Writing Agent First Name');
      const commAgentLast = col(row, 'Commission Agent Last Name');
      const commAgentFirst = col(row, 'Commission Agent First Name');
      agentName = (writingLast ? writingLast + (writingFirst ? ', ' + writingFirst : '') : '')
        || (commAgentLast ? commAgentLast + (commAgentFirst ? ', ' + commAgentFirst : '') : '');
      commAgentName = commAgentLast + (commAgentFirst ? ', ' + commAgentFirst : '');
    }

    // Statement date column is "Transaction Date" on advance reports,
    // "Statement Date" on as-earned reports. Excel serial numbers in both.
    const dateColName = isAsEarned ? 'Statement Date' : 'Transaction Date';
    let txnDate = row[colIdx[dateColName]];
    if (typeof txnDate === 'number') {
      const d = new Date((txnDate - 25569) * 86400000);
      txnDate = d.toLocaleDateString('en-US');
    } else {
      txnDate = String(txnDate || '').trim();
    }
    if (!statementDate && txnDate) statementDate = txnDate;

    // Numeric fields — names differ between report types.
    const commPrem = isAsEarned
      ? colNum(row, 'Comm Premium or Gross Comm')
      : colNum(row, 'Commission Premium');
    const splitPct = isAsEarned ? colNum(row, 'Split%') : colNum(row, 'Split %');
    const commPct = isAsEarned ? colNum(row, 'Comm%') : colNum(row, 'Commission %');
    const advPct = isAsEarned ? colNum(row, 'Earned Adv %') : colNum(row, 'Adv %');
    const commAmount = isAsEarned ? colNum(row, 'Comm Amount') : colNum(row, 'Commission Amount');
    // For as-earned reports, "Earned Adv Amount" represents the portion of
    // commission applied AGAINST the existing advance (not a new advance
    // payment). Keep advanceAmount=0 for as-earned records to avoid inflating
    // Total Advances in the rollup; the as-earned amount lives in commissionAmount.
    const advanceAmount = isAsEarned ? 0 : colNum(row, 'Advance Amount');
    const earnedAdvAmount = isAsEarned ? colNum(row, 'Earned Adv Amount') : 0;
    const netCommission = isAsEarned ? 0 : colNum(row, 'Net Commission Amount');
    const chargeback = isAsEarned ? 0 : colNum(row, 'Writing Agent Chargeback');
    const recovery = isAsEarned ? 0 : colNum(row, 'Writing Agent Less Recovery Amount');
    const endingBalance = isAsEarned ? 0 : colNum(row, 'Writing Agent Ending Balance');

    // Determine transaction type from description / Comm type.
    let transactionType = isAsEarned ? 'as_earned' : 'advance';
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

    // Aggregate agent totals — fall back through writing # → commission #
    // → commission name when both numbers are blank.
    const agentKey = writingNumber || commAgentNumber || commAgentName;
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
