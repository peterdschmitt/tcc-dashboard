/**
 * CICA (Citizens Inc / Allegiant) commission statement parser.
 *
 * Parses XLSX statements with columns:
 *   Agent, Agent #, Agent Level, Contract Code, Policy Number, Insured,
 *   Annualized Premium, AnnualizedCommission, Description, Amount Paid,
 *   Check Date, ProcessedDate, Reference, Issue Date, Paid To Date,
 *   Commission Percentage, Plan Name, Totals
 *
 * File naming: "CICA Feb 2026 As Earned Statement.xlsx", "CICA Advanced Statement 3.11.26.xlsx"
 */

export const carrierId = 'cica';
export const carrierNames = ['CICA', 'Citizens Inc', 'Allegiant'];

export function canParse(text, filename) {
  const hasFilename = /cica/i.test(filename) || /allegiant/i.test(filename);
  const hasText = /Allegiant Superior Choice/i.test(text) || /CICA/i.test(text);
  const hasHeaders = /Agent.*Policy Number.*Annualized Premium/i.test(text);
  return hasFilename || hasText || hasHeaders;
}

export async function parse(buffer, text, workbook) {
  let wb = workbook;
  if (!wb) {
    const { read } = await import('xlsx');
    wb = read(buffer, { type: 'buffer' });
  }

  const { utils } = await import('xlsx');
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (rows.length < 2) return { statementDate: '', payPeriod: '', agentSummary: [], records: [] };

  // Find header row — look for row containing "Policy Number"
  let headerIdx = 0;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const rowText = rows[i].map(c => String(c)).join(' ');
    if (/Policy Number/i.test(rowText)) { headerIdx = i; break; }
  }

  const headerRow = rows[headerIdx];
  const colIdx = {};
  headerRow.forEach((h, i) => {
    const key = String(h).trim()
      .replace(/^PAGES\.REPORTS\.CHECKTRANSACTIONREPORT\./i, ''); // strip long prefix
    if (key) colIdx[key] = i;
  });

  const records = [];
  const agentTotals = {};
  let statementDate = '';

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 5) continue;

    // Skip summary rows
    const firstCell = String(row[0] || '').trim();
    if (/^(sub total|final total|total|grand total)$/i.test(firstCell)) continue;
    if (!firstCell && !String(row[colIdx['Policy Number']] || '').trim()) continue;

    const policyNumber = String(row[colIdx['Policy Number']] || '').trim();
    if (!policyNumber) continue;

    const agentName = String(row[colIdx['Agent']] || '').trim();
    const agentNumber = String(row[colIdx['Agent #']] || '').trim();
    const contractCode = String(row[colIdx['Contract Code']] || '').trim();
    const insuredName = String(row[colIdx['Insured']] || '').trim();
    const annualPremium = parseNum(row[colIdx['Annualized Premium']]);
    const annualComm = parseNum(row[colIdx['AnnualizedCommission']]);
    const description = String(row[colIdx['Description']] || '').trim();
    const amountPaid = parseNum(row[colIdx['Amount Paid']]);
    const commPct = parseNum(row[colIdx['Commission Percentage']]);
    const planName = String(row[colIdx['Plan Name']] || '').trim();
    const reference = String(row[colIdx['Reference']] || '').trim();

    // Dates
    let checkDate = parseDate(row[colIdx['Check Date']]);
    let processedDate = parseDate(row[colIdx['ProcessedDate']]);
    let issueDate = parseDate(row[colIdx['Issue Date']]);
    let paidToDate = parseDate(row[colIdx['Paid To Date']]);

    if (!statementDate && checkDate) statementDate = checkDate;

    // Determine transaction type
    let transactionType = 'advance';
    let isCancellation = false;
    const descLower = description.toLowerCase();
    if (descLower.includes('chargeback') || descLower.includes('cancel') || descLower.includes('reversal')) {
      transactionType = 'chargeback';
      isCancellation = true;
    } else if (descLower.includes('recovery') || descLower.includes('recov')) {
      transactionType = 'recovery';
    } else if (descLower.includes('as earned') || descLower.includes('renewal')) {
      transactionType = 'as_earned';
    } else if (descLower.includes('override') || descLower.includes('ow ')) {
      transactionType = 'override';
    }

    const finalAmount = isCancellation ? -Math.abs(amountPaid) : amountPaid;

    records.push({
      policyNumber,
      insuredName,
      agent: agentName,
      agentId: agentNumber,
      commissionAgent: '',
      commissionAgentId: '',
      effDate: issueDate || processedDate || '',
      transactionType,
      commType: description,
      premium: annualPremium,
      premiumPaid: 0,
      commissionAmount: finalAmount,
      netCommission: finalAmount,
      outstandingBalance: 0,
      chargebackAmount: isCancellation ? Math.abs(amountPaid) : 0,
      recoveryAmount: transactionType === 'recovery' ? Math.abs(amountPaid) : 0,
      splitPct: 0,
      commissionPct: commPct,
      advancePct: 0,
      advanceAmount: transactionType === 'advance' ? finalAmount : 0,
      product: planName,
      productCode: contractCode,
      issueDate,
      paidToDate,
      paymentFrequency: '',
      reference,
      cancellationIndicator: isCancellation,
      section: transactionType,
      rawLine: JSON.stringify(row),
    });

    // Aggregate agent totals
    const agentKey = agentNumber || agentName;
    if (agentKey) {
      if (!agentTotals[agentKey]) {
        agentTotals[agentKey] = { agentId: agentKey, agentName, totalPaid: 0, totalRecovered: 0, netCommission: 0 };
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
    carrier: 'CICA',
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

function parseDate(val) {
  if (val == null || val === '') return '';
  if (typeof val === 'number') {
    // Excel serial date
    const d = new Date((val - 25569) * 86400000);
    return d.toLocaleDateString('en-US');
  }
  return String(val).trim();
}
