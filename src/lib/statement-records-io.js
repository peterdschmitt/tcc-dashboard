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
