import { google } from 'googleapis';

let cachedAuth = null;
const cache = {};

export async function getAuth() {
  if (cachedAuth) return cachedAuth;
  let credentials;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  } else {
    credentials = {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    };
  }
  cachedAuth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return cachedAuth;
}

// ─── WRITE HELPERS ─────────────────────────────────

export async function getSheetsClient() {
  const auth = await getAuth();
  return google.sheets({ version: 'v4', auth });
}

/** Read raw rows (with headers) from a tab */
export async function readRawSheet(sheetId, tabName) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: tabName });
  const rows = res.data.values || [];
  if (rows.length < 1) return { headers: [], data: [], headerIdx: 0 };

  // Find header row (same logic as fetchSheet)
  let headerIdx = 0, bestScore = 0;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const score = (rows[i] || []).filter(c => { const t = (c || '').trim(); return t.length > 0 && t.length < 60; }).length;
    if (score > bestScore) { bestScore = score; headerIdx = i; }
  }
  const headers = rows[headerIdx].map(h => (h || '').trim());
  const data = rows.slice(headerIdx + 1).map((row, ri) => {
    const obj = { _rowIndex: headerIdx + 1 + ri + 1 }; // 1-based sheet row number
    headers.forEach((h, i) => { if (h) obj[h] = (row[i] || '').trim(); });
    return obj;
  });
  return { headers, data, headerIdx };
}

/** Append a row to a tab */
export async function appendRow(sheetId, tabName, headers, values) {
  const sheets = await getSheetsClient();
  const row = headers.map(h => values[h] || '');
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: tabName,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
  invalidateCache(sheetId, tabName);
}

/** Update a specific row (1-based row number) */
export async function updateRow(sheetId, tabName, rowNumber, headers, values) {
  const sheets = await getSheetsClient();
  const row = headers.map(h => values[h] ?? '');
  const lastCol = String.fromCharCode(64 + headers.length); // A=1, B=2, etc
  const range = `${tabName}!A${rowNumber}:${lastCol}${rowNumber}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });
  invalidateCache(sheetId, tabName);
}

/** Delete a row by clearing it (or shifting up) */
export async function deleteRow(sheetId, tabName, rowNumber) {
  const sheets = await getSheetsClient();
  // Get sheet GID first
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const sheet = meta.data.sheets.find(s => s.properties.title === tabName);
  if (!sheet) throw new Error('Tab not found: ' + tabName);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId: sheet.properties.sheetId,
            dimension: 'ROWS',
            startIndex: rowNumber - 1, // 0-based
            endIndex: rowNumber,
          }
        }
      }]
    }
  });
  invalidateCache(sheetId, tabName);
}

export async function fetchSheet(sheetId, tabName, ttl) {
  const cacheTTL = ttl || parseInt(process.env.CACHE_TTL || '900');
  const key = `${sheetId}:${tabName}`;
  const now = Date.now();
  if (cache[key] && now - cache[key].ts < cacheTTL * 1000) return cache[key].data;

  const auth = await getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: tabName });
  const rows = res.data.values || [];
  if (rows.length < 2) return [];

  // Find the header row: scan first 15 rows, pick the one with the
  // most non-empty cells that are short (under 60 chars = likely labels)
  let headerIdx = 0;
  let bestScore = 0;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const row = rows[i] || [];
    const score = row.filter(c => {
      const t = (c || '').trim();
      return t.length > 0 && t.length < 60;
    }).length;
    if (score > bestScore) {
      bestScore = score;
      headerIdx = i;
    }
  }

  console.log('[sheets] ' + tabName + ': header at row ' + headerIdx + ', cols = ' + rows[headerIdx].filter(Boolean).join(' | '));

  const headers = rows[headerIdx].map(h => (h || '').trim());
  const data = rows.slice(headerIdx + 1).filter(r => r.some(c => c)).map(row => {
    const obj = {};
    headers.forEach((h, i) => { if (h) obj[h] = (row[i] || '').trim(); });
    return obj;
  });

  cache[key] = { data, ts: now };
  return data;
}

export function invalidateCache(sheetId, tabName) {
  delete cache[`${sheetId}:${tabName}`];
}
