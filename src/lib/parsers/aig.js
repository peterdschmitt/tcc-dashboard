/**
 * AIG Corebridge (American General Life Insurance Company) commission statement parser.
 *
 * Parses the fixed-width text PDF format used by AIG for commission statements.
 *
 * Sections:
 *   ANNUALIZATION — advances (AD) and recoveries (AE) for individual policies
 *   OVERRIDE — upline override commissions
 *
 * COMM TYPE codes:
 *   GENERICATTAD = Advance
 *   GENERICATTAE = Recovered/Earned
 *
 * Cancellation indicator: Outstanding Balance = $0.00 AND negative COMM ACTIVITY
 */

export const carrierId = 'aig';
export const carrierNames = ['AIG Corebridge', 'American General Life', 'AIG'];

/**
 * Detect if this is an AIG commission statement.
 */
export function canParse(text, filename) {
  const hasAIG = /AMERICAN GENERAL LIFE INSURANCE/i.test(text);
  const hasAnnualization = /ANNUALIZATION/i.test(text);
  const hasFilename = /aig/i.test(filename);
  return (hasAIG && hasAnnualization) || (hasAIG && hasFilename);
}

/**
 * Parse AIG commission statement.
 * @param {Buffer} buffer - PDF file buffer
 * @param {string} text - Pre-extracted text from PDF
 * @returns {ParsedStatement}
 */
export async function parse(buffer, text) {
  const lines = text.split('\n').map(l => l.trimEnd());

  // Extract pay period from header
  const payPeriodMatch = text.match(/PAY PERIOD FROM\s+([\d-]+)\s+TO\s+([\d-]+)/i);
  const payPeriod = payPeriodMatch ? `${payPeriodMatch[1]} to ${payPeriodMatch[2]}` : '';

  // Extract statement date
  const dateMatch = text.match(/AS OF\s+(\w+\s+\d+,\s+\d+)/i);
  const statementDate = dateMatch ? dateMatch[1] : '';

  const records = [];
  const agentSummary = [];

  let currentSection = null; // 'annualization' or 'override'

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect section markers
    if (/^\s*ANNUALIZATION\s*$/i.test(trimmed)) {
      currentSection = 'annualization';
      continue;
    }
    if (/^\s*OVERRIDE\s*$/i.test(trimmed)) {
      currentSection = 'override';
      continue;
    }

    // Skip header rows and empty lines
    if (!trimmed || /^(CO\s+POLICY|NAME\s+NUMBER|_{5,}|TRANSACTION DETAIL|DETAIL STATEMENT|SUMMARY STATEMENT)/i.test(trimmed)) continue;
    if (/^(AMERICAN GENERAL|THE UNITED STATES|AGENT\/AGENCY|NAME:|SSN\/TAX|PAY PERIOD|PAGE:)/i.test(trimmed)) continue;

    // Parse sub-total lines for agent summary
    const subTotalPaid = trimmed.match(/SUB TOTAL PAID BY\s+(.+?)\/(\w+)\s+\(?\$?([\d,.]+)\)?/i);
    if (subTotalPaid) {
      const existingAgent = agentSummary.find(a => a.agentId === subTotalPaid[2]);
      const amount = -parseAmount(subTotalPaid[3]); // Paid amounts shown as negative in context
      if (existingAgent) {
        existingAgent.totalPaid += amount;
      } else {
        agentSummary.push({
          agentName: subTotalPaid[1].trim(),
          agentId: subTotalPaid[2],
          totalPaid: amount,
          totalRecovered: 0,
          netCommission: 0,
        });
      }
      continue;
    }

    const subTotalRecovered = trimmed.match(/SUB TOTAL RECOVERED BY\s+(.+?)\/(\w+)\s+\(?\$?([\d,.]+)\)?/i);
    if (subTotalRecovered) {
      const existingAgent = agentSummary.find(a => a.agentId === subTotalRecovered[2]);
      const amount = -parseAmount(subTotalRecovered[3]); // Recovered amounts
      if (existingAgent) {
        existingAgent.totalRecovered += amount;
      } else {
        agentSummary.push({
          agentName: subTotalRecovered[1].trim(),
          agentId: subTotalRecovered[2],
          totalPaid: 0,
          totalRecovered: amount,
          netCommission: 0,
        });
      }
      continue;
    }

    // Skip total lines and sub-total lines
    if (/^(SUB TOTAL|TOTAL\s|TOTAL:)/i.test(trimmed)) continue;

    // Parse ANNUALIZATION records
    // Pattern: AGL <policyNum> <insuredName> <effDate> <agentId> <commType> ...amounts...
    if (currentSection === 'annualization') {
      const record = parseAnnualizationLine(trimmed);
      if (record) {
        records.push(record);
        continue;
      }
    }

    // Parse OVERRIDE records
    // Pattern: AGL <policyNum> <product> <insuredName> <dates> <mode> <agentId> <uplineId> <amount> <rate> <overrideComm>
    if (currentSection === 'override') {
      const record = parseOverrideLine(trimmed);
      if (record) {
        records.push(record);
        continue;
      }
    }
  }

  // Post-process: Fix override insured names using annualization records.
  // PDF text extraction sometimes merges product suffix (e.g. "LI" from "WHOLE LIFE")
  // with the insured name (e.g. "LIPICOU" should be "PICOU").
  const annNames = {};
  records.filter(r => r.section === 'annualization').forEach(r => {
    annNames[r.policyNumber] = r.insuredName;
  });
  records.filter(r => r.section === 'override').forEach(r => {
    if (annNames[r.policyNumber]) {
      // Use the correct name from the annualization section
      r.insuredName = annNames[r.policyNumber];
    } else {
      // No annualization record — try stripping known product name suffixes
      // that bleed into the insured name from PDF column merging
      const prefixes = ['LI', 'FE', 'WL', 'UL'];
      for (const p of prefixes) {
        if (r.insuredName.startsWith(p) && r.insuredName.length > p.length + 2) {
          r.insuredName = r.insuredName.substring(p.length);
          break;
        }
      }
    }
  });

  // Calculate net commission for each agent
  agentSummary.forEach(a => {
    a.netCommission = a.totalPaid + a.totalRecovered;
  });

  return {
    statementDate,
    payPeriod,
    agentSummary,
    records,
  };
}

/**
 * Parse an ANNUALIZATION section data line.
 *
 * Expected format (fixed-width-ish):
 *   AGL 6260047070 PICOU 03/04/26 1JH1K GENERICATTAD $0.00 $0.00 100% $1.00 75 $0.00 ($908.04)
 *   AGL 6260056184 PAYNE 03/12/26 1JH1K GENERICATTAD $802.56 $66.88 100% $802.56 75 95% $508.28 $571.82
 */
function parseAnnualizationLine(line) {
  // Match: CO POLICY INSURED DATE AGENT [BGA] COMMTYPE ...amounts... BALANCE ACTIVITY
  const match = line.match(
    /^(AGL?)\s+(\d{7,10})\s+([A-Z][A-Z'-]+(?:\s+[A-Z][A-Z'-]*)*)\s+(\d{2}\/\d{2}\/\d{2})\s+(\w+)\s+(\w*GENERICATT\w+)\s+(.+)$/i
  );
  if (!match) return null;

  const [, co, policyNumber, insuredName, effDate, agentId, commType, amountsStr] = match;

  // Determine transaction type from COMM TYPE
  const isRecovery = /GENERICATTAE/i.test(commType);
  const transactionType = isRecovery ? 'recovery' : 'advance';

  // Parse dollar amounts and percentages from the rest of the line
  const amounts = extractAmounts(amountsStr);
  const pcts = extractPercentages(amountsStr);

  // The last amount is COMM ACTIVITY, second-to-last is OUTSTANDING ADV BALANCE
  const commActivity = amounts.length > 0 ? amounts[amounts.length - 1] : 0;
  const outstandingBalance = amounts.length > 1 ? amounts[amounts.length - 2] : 0;
  const annualPrem = amounts.length > 2 ? amounts[0] : 0;
  const premiumPaid = amounts.length > 3 ? amounts[1] : 0;

  // Percentages: typically [commissionPct, advanceRate, splitPct] but varies
  // Common patterns: "100% $802.56 75 95% $508.28 $571.82"
  //   100% = split/commission basis rate
  //   75 = advance rate (bare number, no %)
  //   95% = commission rate
  const advanceRate = extractBareNumber(amountsStr); // bare number like "75" = advance rate
  const commissionPct = pcts.length > 0 ? pcts[0] : 0;
  const splitPct = pcts.length > 1 ? pcts[1] : 0;

  // Cancellation detection:
  // Outstanding balance = $0.00 AND commission is negative → full clawback
  const isCancellation = Math.abs(outstandingBalance) < 0.01 && commActivity < 0;

  return {
    policyNumber,
    insuredName: insuredName.trim(),
    agent: '', // Will be enriched from agent summary
    agentId,
    effDate,
    transactionType: isCancellation && transactionType === 'advance' ? 'chargeback' : transactionType,
    commType,
    premium: Math.abs(annualPrem),
    premiumPaid: Math.abs(premiumPaid),
    commissionAmount: commActivity,
    outstandingBalance,
    splitPct: commissionPct,  // first % is usually the commission basis rate
    commissionPct: splitPct,  // second % is usually the payout rate
    advancePct: advanceRate,  // bare number is the advance rate
    product: '', // Not available in ANNUALIZATION section
    cancellationIndicator: isCancellation,
    section: 'annualization',
    rawLine: line,
  };
}

/**
 * Parse an OVERRIDE section data line.
 *
 * Expected format:
 *   AGL 6260047070 GUARANTEED ISSUE WHOLE LI PICOU 03/04/26 04/04/26FY 12 1JH1K 1JH6J $0.00 100% ($113.51)
 *   AGL 7260020002 SIMPLINOW LEGACY ZACCARDI 02/03/26 03/03/26FY 12 1K80G 1JH6J $0.00 100% ($88.68)
 */
function parseOverrideLine(line) {
  // Match: CO POLICY PRODUCT INSURED DATE... AGENT UPLINE AMOUNT RATE OVERRIDECOMM
  const match = line.match(
    /^(AGL?)\s+(\d{7,10})\s+(.+?)\s+([A-Z][A-Z'-]+)\s+(\d{2}\/\d{2}\/\d{2})\s+(\d{2}\/\d{2}\/\d{2}\w*)\s+(\d+)\s+(\w+)\s+(\w+)\s+(.+)$/i
  );
  if (!match) return null;

  const [, co, policyNumber, product, insuredName, effDate, trxDate, mode, agentId, uplineId, amountsStr] = match;

  const amounts = extractAmounts(amountsStr);
  const pcts = extractPercentages(amountsStr);
  const overrideComm = amounts.length > 0 ? amounts[amounts.length - 1] : 0;
  const premiumAmount = amounts.length > 1 ? amounts[0] : 0;

  return {
    policyNumber,
    insuredName: insuredName.trim(),
    agent: '',
    agentId,
    commissionAgentId: uplineId,  // Upline agent who receives override
    effDate,
    transactionType: 'override',
    commType: 'OVERRIDE',
    premium: Math.abs(premiumAmount),
    premiumPaid: 0,
    commissionAmount: overrideComm,
    outstandingBalance: 0,
    splitPct: pcts.length > 0 ? pcts[0] : 0,
    commissionPct: pcts.length > 1 ? pcts[1] : 0,
    advancePct: extractBareNumber(amountsStr),
    product: product.trim(),
    cancellationIndicator: overrideComm < 0, // Negative override = clawback on override
    section: 'override',
    rawLine: line,
  };
}

/**
 * Extract all dollar amounts from a string.
 * Handles: $1,234.56, ($1,234.56), -$1,234.56, 1234.56
 */
function extractAmounts(str) {
  const amounts = [];
  // Match parenthesized amounts (negative), dollar amounts, and percentage
  const regex = /\(?\$?([\d,]+\.?\d*)\)?/g;
  let m;
  const parts = str.split(/\s+/);

  for (const part of parts) {
    // Skip percentage values
    if (part.endsWith('%')) continue;

    // Match dollar amounts
    const amountMatch = part.match(/^\(?\$?([\d,]+\.?\d*)\)?$/);
    if (amountMatch) {
      let val = parseFloat(amountMatch[1].replace(/,/g, ''));
      // Negative if wrapped in parentheses or preceded by -
      if (part.startsWith('(') || part.startsWith('-')) {
        val = -val;
      }
      amounts.push(val);
    }
  }

  return amounts;
}

/**
 * Extract percentage values from a string.
 * Matches "100%", "95%", etc. Returns array of numbers.
 */
function extractPercentages(str) {
  const pcts = [];
  const parts = str.split(/\s+/);
  for (const part of parts) {
    const m = part.match(/^(\d+(?:\.\d+)?)%$/);
    if (m) pcts.push(parseFloat(m[1]));
  }
  return pcts;
}

/**
 * Extract a bare number (no $ or %) that represents the advance rate.
 * AIG shows advance rate as just "75" or "9" without any symbol.
 */
function extractBareNumber(str) {
  const parts = str.split(/\s+/);
  for (const part of parts) {
    // Bare number: not a dollar amount, not a percentage, just digits
    if (/^\d{1,3}$/.test(part) && !part.includes('$') && !part.includes('%')) {
      return parseFloat(part);
    }
  }
  return 0;
}

/**
 * Parse a dollar string to number (handles parentheses for negatives).
 */
function parseAmount(str) {
  if (!str) return 0;
  const clean = str.replace(/[$,]/g, '');
  const val = parseFloat(clean);
  return isNaN(val) ? 0 : val;
}
