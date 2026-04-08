/**
 * Commission Ledger — single source of truth for column schema and row building.
 *
 * Both the upload route and drive-sync route import from here.
 * Column order is defined ONCE. Row building uses dictionary lookup, not position.
 */

// ─── Master column headers (28 columns) ─────────────────────────
export const LEDGER_HEADERS = [
  'Transaction ID',       // 1
  'Statement Date',       // 2
  'Processing Date',      // 3
  'Carrier',              // 4
  'Policy #',             // 5
  'Insured Name',         // 6
  'Agent',                // 7
  'Agent ID',             // 8
  'Transaction Type',     // 9
  'Description',          // 10
  'Product',              // 11
  'Issue Date',           // 12
  'Premium',              // 13
  'Commission %',         // 14
  'Advance %',            // 15
  'Advance Amount',       // 16
  'Commission Amount',    // 17
  'Net Commission',       // 18
  'Outstanding Balance',  // 19
  'Chargeback Amount',    // 20
  'Recovery Amount',      // 21
  'Net Impact',           // 22 — what you actually kept (advance - chargeback - recovery clawback)
  'Matched Policy #',     // 23
  'Match Type',           // 24
  'Match Confidence',     // 25
  'Status',               // 26
  'Statement File',       // 27
  'Notes',                // 28
];

// ─── Carrier field mapping tables ────────────────────────────────
// Each carrier maps its raw field names → master field names.
// The parsers return objects with carrier-specific keys.
// This module normalizes them.

const CARRIER_MAPS = {
  aig: {
    policyNumber:      'Policy #',
    insuredName:       'Insured Name',
    agent:             'Agent',
    agentId:           'Agent ID',
    effDate:           'Issue Date',
    transactionType:   'Transaction Type',
    commType:          'Description',
    product:           'Product',
    premium:           'Premium',
    commissionPct:     'Commission %',
    advancePct:        'Advance %',
    advanceAmount:     'Advance Amount',
    commissionAmount:  'Commission Amount',
    netCommission:     'Net Commission',
    outstandingBalance:'Outstanding Balance',
    chargebackAmount:  'Chargeback Amount',
    recoveryAmount:    'Recovery Amount',
  },
  transamerica: {
    policyNumber:      'Policy #',
    insuredName:       'Insured Name',
    agent:             'Agent',
    agentId:           'Agent ID',
    effDate:           'Issue Date',
    transactionType:   'Transaction Type',
    commType:          'Description',
    product:           'Product',
    premium:           'Premium',
    commissionPct:     'Commission %',
    advancePct:        'Advance %',
    advanceAmount:     'Advance Amount',
    commissionAmount:  'Commission Amount',
    netCommission:     'Net Commission',
    outstandingBalance:'Outstanding Balance',
    chargebackAmount:  'Chargeback Amount',
    recoveryAmount:    'Recovery Amount',
  },
  'american-amicable': {
    policyNumber:      'Policy #',
    insuredName:       'Insured Name',
    agent:             'Agent',
    agentId:           'Agent ID',
    effDate:           'Issue Date',
    transactionType:   'Transaction Type',
    commType:          'Description',
    product:           'Product',
    premium:           'Premium',
    commissionPct:     'Commission %',
    advancePct:        'Advance %',
    advanceAmount:     'Advance Amount',
    commissionAmount:  'Commission Amount',
    netCommission:     'Net Commission',
    outstandingBalance:'Outstanding Balance',
    chargebackAmount:  'Chargeback Amount',
    recoveryAmount:    'Recovery Amount',
  },
  cica: {
    policyNumber:      'Policy #',
    insuredName:       'Insured Name',
    agent:             'Agent',
    agentId:           'Agent ID',
    effDate:           'Issue Date',
    transactionType:   'Transaction Type',
    commType:          'Description',
    product:           'Product',
    premium:           'Premium',
    commissionPct:     'Commission %',
    advancePct:        'Advance %',
    advanceAmount:     'Advance Amount',
    commissionAmount:  'Commission Amount',
    netCommission:     'Net Commission',
    outstandingBalance:'Outstanding Balance',
    chargebackAmount:  'Chargeback Amount',
    recoveryAmount:    'Recovery Amount',
  },
};

// ─── Date formatting ─────────────────────────────────────────────
function formatDate(val) {
  if (!val) return '';
  // Excel serial number → readable date (handles both number and string "46094")
  const numVal = typeof val === 'number' ? val : (typeof val === 'string' && /^\d{5}$/.test(val.trim()) ? parseInt(val.trim()) : null);
  if (numVal && numVal > 40000 && numVal < 60000) {
    const d = new Date((numVal - 25569) * 86400000);
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  }
  const s = String(val).trim();
  // Already formatted
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) return s;
  // ISO date
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.split('T')[0].split('-');
    return `${parseInt(m)}/${parseInt(d)}/${y}`;
  }
  // Month name format (e.g., "March 13, 2026")
  const monthMatch = s.match(/^(\w+)\s+(\d+),?\s+(\d{4})$/);
  if (monthMatch) {
    const months = { january:1, february:2, march:3, april:4, may:5, june:6,
      july:7, august:8, september:9, october:10, november:11, december:12 };
    const mn = months[monthMatch[1].toLowerCase()];
    if (mn) return `${mn}/${parseInt(monthMatch[2])}/${monthMatch[3]}`;
  }
  return s;
}

// ─── Number formatting ───────────────────────────────────────────
function fmtNum(val) {
  if (val == null || val === '') return '0';
  if (typeof val === 'number') return val.toFixed(2);
  const n = parseFloat(String(val).replace(/[$,]/g, ''));
  return isNaN(n) ? '0' : n.toFixed(2);
}

// ─── Build one ledger row from a parsed record ───────────────────
/**
 * @param {object} record - Parsed record from any carrier parser
 * @param {object} meta - { carrier, carrierId, statementDate, processingDate, filename, matchedPolicy, matchType, matchConfidence, status, notes }
 * @returns {string[]} - Array of exactly 28 strings, one per LEDGER_HEADERS column
 */
export function buildLedgerRow(record, meta) {
  // Build a dictionary of master field → value
  const dict = {};

  // System-generated fields
  dict['Transaction ID']   = record.transactionId || '';
  dict['Statement Date']   = formatDate(meta.statementDate);
  dict['Processing Date']  = meta.processingDate || new Date().toISOString().split('T')[0];
  dict['Carrier']          = meta.carrier || '';
  dict['Statement File']   = meta.filename || '';

  // Matching fields
  dict['Matched Policy #'] = meta.matchedPolicy || '';
  dict['Match Type']       = meta.matchType || '';
  dict['Match Confidence'] = meta.matchConfidence != null ? Number(meta.matchConfidence).toFixed(2) : '0';
  dict['Status']           = meta.status || '';
  const driveUrl = meta.driveFileId ? `https://drive.google.com/file/d/${meta.driveFileId}/view` : '';
  dict['Notes']            = [meta.notes, driveUrl].filter(Boolean).join(' | ');

  // Map carrier fields using the mapping table
  const map = CARRIER_MAPS[meta.carrierId] || CARRIER_MAPS.aig; // fallback
  for (const [parserKey, masterKey] of Object.entries(map)) {
    const val = record[parserKey];
    if (val == null || val === '') continue;

    // Financial fields get number formatting
    if (['Premium', 'Advance Amount', 'Commission Amount', 'Net Commission',
         'Outstanding Balance', 'Chargeback Amount', 'Recovery Amount'].includes(masterKey)) {
      dict[masterKey] = fmtNum(val);
    }
    // Date fields get date formatting
    else if (['Issue Date'].includes(masterKey)) {
      dict[masterKey] = formatDate(val);
    }
    // Rate fields — keep as-is
    else if (['Commission %', 'Advance %'].includes(masterKey)) {
      dict[masterKey] = val != null ? String(val) : '';
    }
    // Everything else is a string
    else {
      dict[masterKey] = String(val);
    }
  }

  // Calculate Net Impact: what you actually kept
  // Positive advance - chargeback - recovery clawback = net financial impact
  const advAmt = parseFloat(dict['Advance Amount'] || '0');
  const cbAmt = parseFloat(dict['Chargeback Amount'] || '0');
  const recAmt = parseFloat(dict['Recovery Amount'] || '0');
  const commAmt = parseFloat(dict['Commission Amount'] || '0');
  // For chargebacks/recoveries: net impact is the commission amount (already negative)
  // For advances: net impact is the advance amount
  // Simplest: net impact = commission amount (covers all cases — positive for advances, negative for chargebacks)
  dict['Net Impact'] = fmtNum(commAmt);

  // Build the row array from headers — guaranteed 28 columns
  return LEDGER_HEADERS.map(header => dict[header] || '');
}

// ─── Statements metadata headers ─────────────────────────────────
export const STATEMENTS_HEADERS = [
  'Statement ID', 'Upload Date', 'Carrier', 'Statement Period',
  'File Name', 'File Type', 'Total Records', 'Matched', 'Unmatched',
  'Pending Review', 'Total Advances', 'Total Recoveries', 'Net Amount',
  'Cancellations Detected', 'Status',
  'Content Hash', 'Drive File ID', 'Organized Filename',
];

export function buildStatementRow(meta) {
  return [
    meta.statementId,
    new Date().toISOString(),
    meta.carrier,
    meta.payPeriod || meta.statementDate || '',
    meta.filename,
    meta.fileType || '',
    String(meta.totalRecords || 0),
    String(meta.matched || 0),
    String(meta.unmatched || 0),
    String(meta.pendingReview || 0),
    fmtNum(meta.totalAdvances),
    fmtNum(meta.totalRecoveries),
    fmtNum(meta.netAmount),
    String(meta.cancellationsDetected || 0),
    'processed',
    meta.contentHash || '',
    meta.driveFileId || '',
    meta.organizedFilename || '',
  ];
}
