/**
 * American Amicable (and Occidental Life) commission statement parser.
 *
 * Parses CSV advance reports with format:
 *   RptDate,WritingAgent,Policy,Insured,Plan,IssDate,Sex,Age,Anz Prem,PFee Prem,
 *   Pln,Adv Rate,Com Rate,Adj Rate,Advance,Adv PFee,Adv Bal,Action,Freq
 *
 * Actions: DELIVR = advance on delivery, PAIDFR = paid first premium, CANCEL = cancellation
 *
 * File naming: Advances_XXXXXXXXXX_DDMonYY.csv (e.g., Advances_0001168827_05Feb26.csv)
 */

export const carrierId = 'american-amicable';
export const carrierNames = ['American Amicable', 'Occidental Life'];

/**
 * Detect if this is an American Amicable advance report CSV.
 */
export function canParse(text, filename) {
  const hasAdvancesFilename = /Advances_\d+_\d+\w+\d+\.csv/i.test(filename);
  const hasHeaders = /RptDate.*WritingAgent.*Policy.*Insured.*Plan/i.test(text);
  const hasAmicableAction = /DELIVR|PAIDFR|CANCEL/i.test(text);
  return hasAdvancesFilename || (hasHeaders && hasAmicableAction);
}

/**
 * Parse American Amicable CSV advance report.
 * @param {Buffer} buffer - File buffer
 * @param {string} text - Pre-extracted text
 * @returns {ParsedStatement}
 */
export async function parse(buffer, text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  if (lines.length < 2) return { statementDate: '', payPeriod: '', agentSummary: [], records: [] };

  // Parse header row
  const headers = parseCSVRow(lines[0]);
  const colIdx = {};
  headers.forEach((h, i) => { colIdx[h.trim()] = i; });

  const records = [];
  const agentTotals = {};
  let statementDate = '';

  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVRow(lines[i]);
    if (!row || row.length < 5) continue;

    const rptDate = cleanVal(row[colIdx['RptDate']]);
    const writingAgent = cleanVal(row[colIdx['WritingAgent']]);
    const policy = cleanVal(row[colIdx['Policy']]);
    const insured = cleanVal(row[colIdx['Insured']]);
    const plan = cleanVal(row[colIdx['Plan']]);
    const action = cleanVal(row[colIdx['Action']]);

    // Skip note rows (recalculated advance, difference, empty policy)
    if (!policy || !insured || !rptDate) continue;

    if (!statementDate) statementDate = rptDate;

    const anzPrem = parseAmount(row[colIdx['Anz Prem']]);
    const advance = parseAmount(row[colIdx['Advance']]);
    const advBal = parseAmount(row[colIdx['Adv Bal']]);
    const advRate = parseAmount(row[colIdx['Adv Rate']]);
    const comRate = parseAmount(row[colIdx['Com Rate']]);
    const issDate = cleanVal(row[colIdx['IssDate']]);

    // Determine transaction type from Action
    const isCancellation = /CANCEL|LAPSE|CHARGEBACK/i.test(action);
    let transactionType = 'advance';
    if (isCancellation) transactionType = 'chargeback';
    else if (/RECOV|EARNED/i.test(action)) transactionType = 'recovery';

    // Parse insured name (format: "LAST,FIRST M")
    const nameParts = insured.replace(/"/g, '').split(',');
    const lastName = (nameParts[0] || '').trim();
    const firstName = (nameParts[1] || '').trim();

    const commissionAmount = isCancellation ? -Math.abs(advance) : advance;

    records.push({
      policyNumber: policy,
      insuredName: lastName + (firstName ? ', ' + firstName : ''),
      agent: '',
      agentId: writingAgent,
      effDate: issDate,
      transactionType,
      commType: action,
      premium: anzPrem,
      premiumPaid: 0,
      commissionAmount,
      outstandingBalance: advBal,
      product: plan,
      cancellationIndicator: isCancellation,
      section: 'advance',
      rawLine: lines[i],
    });

    // Aggregate agent totals
    if (!agentTotals[writingAgent]) {
      agentTotals[writingAgent] = { agentId: writingAgent, agentName: writingAgent, totalPaid: 0, totalRecovered: 0, netCommission: 0 };
    }
    if (commissionAmount >= 0) agentTotals[writingAgent].totalPaid += commissionAmount;
    else agentTotals[writingAgent].totalRecovered += commissionAmount;
  }

  const agentSummary = Object.values(agentTotals).map(a => ({
    ...a,
    netCommission: a.totalPaid + a.totalRecovered,
  }));

  return {
    carrier: 'American Amicable',
    statementDate,
    payPeriod: statementDate,
    agentSummary,
    records,
  };
}

/** Parse a CSV row handling quoted fields with commas */
function parseCSVRow(line) {
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
}

/** Clean Excel-formatted values: ="0001168827" → 0001168827 */
function cleanVal(val) {
  if (!val) return '';
  return val.replace(/^="?|"?$/g, '').trim();
}

/** Parse a dollar/number string */
function parseAmount(val) {
  if (!val) return 0;
  const clean = val.replace(/[$,"\s=]/g, '').replace(/[()]/g, m => m === '(' ? '-' : '');
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}
