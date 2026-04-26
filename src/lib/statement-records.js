// Pure functions only — no imports, no side effects. Safe to load with node --test.

export const STATEMENT_HOLDERS_TAB = process.env.STATEMENT_HOLDERS_TAB || 'Statement Records — Holders';
export const STATEMENT_PERIODS_TAB = process.env.STATEMENT_PERIODS_TAB || 'Statement Records — Periods';

export const HOLDERS_HEADERS = [
  'Holder Key', 'Insured Name', 'Policies', 'Policy Count', 'Carriers',
  'Statement Count', 'First Period', 'Last Period',
  'Total Advances', 'Total Commissions', 'Total Chargebacks', 'Total Recoveries',
  'Net Total', 'Outstanding Balance', 'Expected Net', 'Variance',
  'Agents', 'Status', 'Last Rebuilt',
];

export const PERIODS_HEADERS = [
  'Row Key', 'Holder Key', 'Insured Name', 'Policy #', 'Carrier',
  'Statement Period', 'Statement Date', 'Statement File', 'Statement File ID',
  'Premium', 'Advance Amount', 'Commission Amount', 'Chargeback Amount', 'Recovery Amount',
  'Net Impact', 'Outstanding Balance', 'Line Item Count', 'Notes',
];

// Variance status thresholds in dollars. Tune as needed.
export const VARIANCE_THRESHOLDS = { green: 10, yellow: 50 };

// Suffixes stripped during name normalization.
const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

function normalizeNamePart(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')   // strip punctuation including apostrophes, hyphens, periods
    .trim()
    .split(/\s+/)
    .filter(tok => tok.length > 1 && !NAME_SUFFIXES.has(tok))  // drop initials (single chars) and suffixes
    .join('');
}

export function buildHolderKey(firstName, lastName) {
  const first = normalizeNamePart(firstName);
  const last = normalizeNamePart(lastName);
  return `${last}|${first}`;
}

function splitInsuredName(insuredName) {
  const s = String(insuredName || '').trim();
  if (!s) return { first: '', last: '' };
  if (s.includes(',')) {
    const [last, first] = s.split(',').map(p => p.trim());
    return { first: first || '', last: last || '' };
  }
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { first: '', last: parts[0] };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

export function groupLedgerByHolder(ledgerRows) {
  const map = new Map();
  for (const row of ledgerRows) {
    const { first, last } = splitInsuredName(row.insuredName);
    let key = buildHolderKey(first, last);
    // Without this, all blank-name rows merge into one bucket, mixing
    // distinct policies under different real people. Disambiguate by policy #.
    if (key === '|') {
      const policy = String(row.policyNumber || '').trim();
      if (policy) key = `|${policy}`;
    }
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function periodFromDate(d) {
  const s = String(d || '');
  // ISO date: YYYY-MM-DD → YYYY-MM
  const m = s.match(/^(\d{4})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}`;
  // US date: M/D/YYYY → YYYY-MM
  const u = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (u) return `${u[3]}-${u[1].padStart(2, '0')}`;
  return '';
}

// Carrier statement filenames often embed the period, e.g.
// "TA As Earned 1.30.26.xls", "Advances_2026-04_summary.csv".
// Used as a fallback when the ledger's Statement Date column is empty.
export function periodFromFile(fileName) {
  const s = String(fileName || '');
  if (!s) return '';
  // M.D.YY or M.D.YYYY anywhere in filename
  const dot = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/);
  if (dot) {
    const month = dot[1].padStart(2, '0');
    const yearRaw = dot[3];
    const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
    return `${year}-${month}`;
  }
  // ISO date YYYY-MM-DD
  const iso = s.match(/(\d{4})-(\d{2})-\d{2}/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  // YYYY-MM (must NOT be followed by another digit — that would imply YYYY-MMXX)
  const ym = s.match(/(\d{4})-(\d{2})(?!\d)/);
  if (ym) return `${ym[1]}-${ym[2]}`;
  return '';
}

function periodFor(statementDate, statementFile) {
  return periodFromDate(statementDate) || periodFromFile(statementFile);
}

function expectedNetForSalesRow(sr) {
  const premium = parseFloat(sr['Monthly Premium']) || 0;
  const cpp = String(sr['Carrier + Product + Payout'] || '').toLowerCase();
  const multiplier = cpp.includes('giwl') ? 1.5 : 3;
  return premium * multiplier;
}

export function deriveStatus({ chargebacks, outstanding, variance, hasMatch }) {
  if (!hasMatch) return 'unmatched';
  if (chargebacks > 0) return 'chargeback';
  if (outstanding > 0) return 'outstanding';
  if (Math.abs(variance) > VARIANCE_THRESHOLDS.yellow) return 'variance';
  return 'healthy';
}

export function buildPeriodRows(holderKey, ledgerRows) {
  // Group ledger rows by (statementFile, policyNumber).
  const groups = new Map();
  for (const r of ledgerRows) {
    const file = r.statementFile || '';
    const policy = r.policyNumber || '';
    const key = `${file}||${policy}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const rows = [];
  for (const [, lines] of groups) {
    const sample = lines[0];
    const last = lines[lines.length - 1];
    const sum = (field) => lines.reduce((s, l) => s + (parseFloat(l[field]) || 0), 0);
    const advance = sum('advanceAmount');
    const commission = sum('commissionAmount');
    const chargeback = sum('chargebackAmount');
    const recovery = sum('recoveryAmount');
    const noteList = [...new Set(lines.map(l => String(l.notes || '').trim()).filter(Boolean))];

    rows.push({
      'Row Key': `${holderKey}|${sample.statementFile || ''}|${sample.policyNumber || ''}`,
      'Holder Key': holderKey,
      'Insured Name': sample.insuredName || '',
      'Policy #': sample.policyNumber || '',
      'Carrier': sample.carrier || '',
      'Statement Period': periodFor(sample.statementDate, sample.statementFile),
      'Statement Date': sample.statementDate || '',
      'Statement File': sample.statementFile || '',
      'Statement File ID': sample.statementFileId || '',
      'Premium': sum('premium'),
      'Advance Amount': advance,
      'Commission Amount': commission,
      'Chargeback Amount': chargeback,
      'Recovery Amount': recovery,
      'Net Impact': advance + commission - chargeback + recovery,
      'Outstanding Balance': parseFloat(last.outstandingBalance) || 0,
      'Line Item Count': lines.length,
      'Notes': noteList.join('; '),
    });
  }
  return rows;
}

export function buildHolderRow(holderKey, ledgerRows, salesRows, lastRebuiltIso) {
  const insuredName = ledgerRows[0]?.insuredName || '';
  const policies = [...new Set(ledgerRows.map(r => r.policyNumber).filter(Boolean))];
  const carriers = [...new Set(ledgerRows.map(r => r.carrier).filter(Boolean))];
  const statementFiles = [...new Set(ledgerRows.map(r => r.statementFile).filter(Boolean))];
  const periods = ledgerRows.map(r => periodFor(r.statementDate, r.statementFile)).filter(Boolean).sort();

  const totalAdvances = ledgerRows.reduce((s, r) => s + (parseFloat(r.advanceAmount) || 0), 0);
  const totalCommissions = ledgerRows.reduce((s, r) => s + (parseFloat(r.commissionAmount) || 0), 0);
  const totalChargebacks = ledgerRows.reduce((s, r) => s + (parseFloat(r.chargebackAmount) || 0), 0);
  const totalRecoveries = ledgerRows.reduce((s, r) => s + (parseFloat(r.recoveryAmount) || 0), 0);
  const netTotal = totalAdvances + totalCommissions - totalChargebacks + totalRecoveries;

  // Outstanding balance from the most recent ledger row (by statementDate desc).
  const sortedDesc = [...ledgerRows].sort((a, b) => String(b.statementDate || '').localeCompare(String(a.statementDate || '')));
  const outstandingBalance = parseFloat(sortedDesc[0]?.outstandingBalance) || 0;

  const hasMatch = salesRows.length > 0;
  const expectedNet = hasMatch ? salesRows.reduce((s, sr) => s + expectedNetForSalesRow(sr), 0) : '';
  const variance = hasMatch ? netTotal - expectedNet : '';
  const agents = hasMatch ? [...new Set(salesRows.map(sr => sr['Agent']).filter(Boolean))].join(', ') : '';

  const status = deriveStatus({
    chargebacks: totalChargebacks,
    outstanding: outstandingBalance,
    variance: typeof variance === 'number' ? variance : 0,
    hasMatch,
  });

  return {
    'Holder Key': holderKey,
    'Insured Name': insuredName,
    'Policies': policies.join(', '),
    'Policy Count': policies.length,
    'Carriers': carriers.join(', '),
    'Statement Count': statementFiles.length,
    'First Period': periods[0] || '',
    'Last Period': periods[periods.length - 1] || '',
    'Total Advances': totalAdvances,
    'Total Commissions': totalCommissions,
    'Total Chargebacks': totalChargebacks,
    'Total Recoveries': totalRecoveries,
    'Net Total': netTotal,
    'Outstanding Balance': outstandingBalance,
    'Expected Net': expectedNet,
    'Variance': variance,
    'Agents': agents,
    'Status': status,
    'Last Rebuilt': lastRebuiltIso,
  };
}
