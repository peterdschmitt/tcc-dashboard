/**
 * TransAmerica Life Insurance Company commission statement parser.
 *
 * Parses XLS advance reports with columns:
 *   Commission Agent Last/First Name, Commission Agent Number, Transaction Date,
 *   Policy Number, Insured Last/First Name, Description, Writing Agent Last/First Name,
 *   Writing Agent Number, Commission Premium, Split%, Commission%, Adv%,
 *   Advance Amount, Commission Amount, Net Commission Amount,
 *   Writing Agent Chargeback, Writing Agent Balance Forward,
 *   Writing Agent Less Recovery Amount, Writing Agent Ending Balance, etc.
 *
 * Descriptions: "OW Placed Adv" = override advance, "Placed Adv" = agent advance,
 *   "Chargeback" = cancellation chargeback, "Recovery" = recovery
 *
 * File naming: TA Advance report M.D.YY.xls
 */

export const carrierId = 'transamerica';
export const carrierNames = ['TransAmerica', 'Transamerica Life Insurance'];

/**
 * Detect if this is a TransAmerica advance report.
 */
export function canParse(text, filename) {
  const hasFilename = /TA\s+Advance/i.test(filename) || /transamerica/i.test(filename);
  const hasHeaders = /Commission Agent.*Policy Number.*Insured.*Advance Amount/i.test(text);
  const hasTA = /Transamerica Life Insurance/i.test(text);
  return hasFilename || hasHeaders || hasTA;
}

/**
 * Parse TransAmerica XLS advance report.
 * @param {Buffer} buffer - File buffer (XLS format)
 * @param {string} text - Pre-extracted text (from xlsx parsing)
 * @param {object} workbook - Parsed xlsx workbook object (if available)
 * @returns {ParsedStatement}
 */
export async function parse(buffer, text, workbook) {
  // If no workbook provided, parse from buffer
  let wb = workbook;
  if (!wb) {
    const { read } = await import('xlsx');
    wb = read(buffer, { type: 'buffer' });
  }

  const { utils } = await import('xlsx');
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (rows.length < 2) return { statementDate: '', payPeriod: '', agentSummary: [], records: [] };

  // Find header row
  const headerRow = rows[0];
  const colIdx = {};
  headerRow.forEach((h, i) => { if (h) colIdx[String(h).trim()] = i; });

  const records = [];
  const agentTotals = {};
  let statementDate = '';

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 5) continue;

    const policyNumber = String(row[colIdx['Policy Number']] || '').trim();
    if (!policyNumber) continue;

    const insuredLast = String(row[colIdx['Insured Last Name']] || '').trim();
    const insuredFirst = String(row[colIdx['Insured First Name']] || '').trim();
    const description = String(row[colIdx['Description']] || '').trim();
    const writingLast = String(row[colIdx['Writing Agent Last Name']] || '').trim();
    const writingFirst = String(row[colIdx['Writing Agent First Name']] || '').trim();
    const writingNumber = String(row[colIdx['Writing Agent Number']] || '').trim();
    const commAgentLast = String(row[colIdx['Commission Agent Last Name']] || '').trim();
    const commAgentFirst = String(row[colIdx['Commission Agent First Name']] || '').trim();

    // Parse transaction date (may be Excel serial number)
    let txnDate = row[colIdx['Transaction Date']];
    if (typeof txnDate === 'number') {
      // Excel serial date → JS date
      const d = new Date((txnDate - 25569) * 86400000);
      txnDate = d.toLocaleDateString('en-US');
      if (!statementDate) statementDate = txnDate;
    } else {
      txnDate = String(txnDate || '');
      if (!statementDate && txnDate) statementDate = txnDate;
    }

    const commPrem = parseNum(row[colIdx['Commission Premium']]);
    const splitPct = parseNum(row[colIdx['Split %']]);
    const commPct = parseNum(row[colIdx['Commission %']]);
    const advPct = parseNum(row[colIdx['Adv %']]);
    const advanceAmount = parseNum(row[colIdx['Advance Amount']]);
    const commAmount = parseNum(row[colIdx['Commission Amount']]);
    const netCommission = parseNum(row[colIdx['Net Commission Amount']]);
    const chargeback = parseNum(row[colIdx['Writing Agent Chargeback']]);
    const recovery = parseNum(row[colIdx['Writing Agent Less Recovery Amount']]);
    const endingBalance = parseNum(row[colIdx['Writing Agent Ending Balance']]);

    // Determine transaction type from Description
    let transactionType = 'advance';
    let isCancellation = false;
    const descLower = description.toLowerCase();
    if (descLower.includes('chargeback') || descLower.includes('cancel')) {
      transactionType = 'chargeback';
      isCancellation = true;
    } else if (descLower.includes('recovery') || descLower.includes('recov')) {
      transactionType = 'recovery';
    } else if (descLower.includes('ow ') || descLower.includes('override') || descLower.includes('overwrite')) {
      transactionType = 'override';
    }

    // Use the main commission amount — advance for advances, negative for chargebacks
    const amount = advanceAmount || commAmount || netCommission || 0;
    const finalAmount = isCancellation ? -Math.abs(amount) : amount;

    const insuredName = insuredLast + (insuredFirst ? ', ' + insuredFirst : '');
    const agentName = writingLast + (writingFirst ? ', ' + writingFirst : '') || commAgentLast + (commAgentFirst ? ', ' + commAgentFirst : '');
    const commAgentName = commAgentLast + (commAgentFirst ? ', ' + commAgentFirst : '');
    const commAgentNumber = String(row[colIdx['Commission Agent Number']] || '').trim();

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
      netCommission: netCommission,
      outstandingBalance: endingBalance,
      chargebackAmount: chargeback,
      recoveryAmount: recovery,
      splitPct,
      commissionPct: commPct,
      advancePct: advPct,
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

function parseNum(val) {
  if (val == null || val === '') return 0;
  if (typeof val === 'number') return val;
  const clean = String(val).replace(/[$,\s"]/g, '').replace(/[()]/g, m => m === '(' ? '-' : '');
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}
