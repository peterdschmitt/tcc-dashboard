import { ensureTabExists, fetchSheet, getSheetsClient, invalidateCache } from './sheets';
import {
  STATEMENT_HOLDERS_TAB, STATEMENT_PERIODS_TAB,
  HOLDERS_HEADERS, PERIODS_HEADERS,
  buildHolderKey, groupLedgerByHolder, buildHolderRow, buildPeriodRows,
} from './statement-records.js';

const SALES_SHEET_ID_KEY = 'SALES_SHEET_ID';
const LEDGER_TAB_KEY = 'COMMISSION_LEDGER_TAB';

export async function ensureStatementRecordTabs() {
  const sheetId = process.env[SALES_SHEET_ID_KEY];
  if (!sheetId) throw new Error(`${SALES_SHEET_ID_KEY} env var is required`);
  await ensureTabExists(sheetId, STATEMENT_HOLDERS_TAB, HOLDERS_HEADERS);
  await ensureTabExists(sheetId, STATEMENT_PERIODS_TAB, PERIODS_HEADERS);
  return { tabs: [STATEMENT_HOLDERS_TAB, STATEMENT_PERIODS_TAB] };
}

// Match the existing /api/commission-statements GET projection so we share the same shape.
function projectLedgerRow(r) {
  return {
    insuredName: r['Insured Name'] || '',
    policyNumber: (r['Matched Policy #'] || r['Policy #'] || '').trim(),
    carrier: r['Carrier'] || '',
    statementDate: r['Statement Date'] || '',
    statementFile: r['Statement File'] || '',
    statementFileId: r['Statement File ID'] || '',
    premium: parseFloat(r['Premium']) || 0,
    advanceAmount: parseFloat(r['Advance Amount']) || 0,
    commissionAmount: parseFloat(r['Commission Amount']) || 0,
    chargebackAmount: parseFloat(r['Chargeback Amount']) || 0,
    recoveryAmount: parseFloat(r['Recovery Amount']) || 0,
    outstandingBalance: parseFloat(r['Outstanding Balance']) || 0,
    netImpact: parseFloat(r['Net Impact']) || 0,
    agent: r['Agent'] || '',
    notes: r['Notes'] || '',
  };
}

function projectSalesRow(sr) {
  return {
    firstName: sr['First Name'] || '',
    lastName: sr['Last Name'] || '',
    'Policy #': sr['Policy #'] || '',
    'Carrier + Product + Payout': sr['Carrier + Product + Payout'] || '',
    'Monthly Premium': sr['Monthly Premium'] || '0',
    'Agent': sr['Agent'] || '',
  };
}

async function overwriteTab(sheetId, tabName, headers, rows) {
  // Two-step: clear data range (keep header row), then bulk-write all rows in one batchUpdate.
  const sheets = await getSheetsClient();
  // Clear everything below the header row (row 2 onward, all columns).
  await sheets.spreadsheets.values.clear({
    spreadsheetId: sheetId,
    range: `'${tabName}'!A2:ZZ`,
  });
  if (rows.length === 0) {
    invalidateCache(sheetId, tabName);
    return;
  }
  const values = rows.map(row => headers.map(h => {
    const v = row[h];
    if (v === null || v === undefined) return '';
    return v;
  }));
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `'${tabName}'!A2`,
    valueInputOption: 'RAW',
    requestBody: { values },
  });
  invalidateCache(sheetId, tabName);
}

export async function rebuildStatementRecords() {
  const sheetId = process.env[SALES_SHEET_ID_KEY];
  if (!sheetId) throw new Error(`${SALES_SHEET_ID_KEY} env var is required`);
  const ledgerTab = process.env[LEDGER_TAB_KEY] || 'Commission Ledger';
  const salesTab = process.env.SALES_TAB_NAME || 'Sheet1';

  const t0 = Date.now();
  await ensureStatementRecordTabs();

  const [ledgerRaw, salesRaw] = await Promise.all([
    fetchSheet(sheetId, ledgerTab, 0),
    fetchSheet(sheetId, salesTab, 0),
  ]);

  const ledger = ledgerRaw.map(projectLedgerRow);
  const salesRows = salesRaw.map(projectSalesRow);

  // Index sales rows by holder key for lookup during rebuild.
  const salesByHolder = new Map();
  for (const sr of salesRows) {
    const key = buildHolderKey(sr.firstName, sr.lastName);
    if (!salesByHolder.has(key)) salesByHolder.set(key, []);
    salesByHolder.get(key).push(sr);
  }

  const grouped = groupLedgerByHolder(ledger);
  const lastRebuiltIso = new Date().toISOString();
  const holderRows = [];
  const periodRows = [];
  for (const [holderKey, lines] of grouped) {
    const matchedSales = salesByHolder.get(holderKey) || [];
    holderRows.push(buildHolderRow(holderKey, lines, matchedSales, lastRebuiltIso));
    periodRows.push(...buildPeriodRows(holderKey, lines));
  }

  await overwriteTab(sheetId, STATEMENT_HOLDERS_TAB, HOLDERS_HEADERS, holderRows);
  await overwriteTab(sheetId, STATEMENT_PERIODS_TAB, PERIODS_HEADERS, periodRows);

  return { holders: holderRows.length, periods: periodRows.length, durationMs: Date.now() - t0 };
}
