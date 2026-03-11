import { google } from 'googleapis';

let cachedAuth = null;
const cache = {};
const inflight = {}; // Request coalescing: reuse in-flight promises for the same sheet+tab

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
  // TTL=0 means "no cache" — but we still coalesce concurrent requests.
  // TTL=undefined/null uses the env default.
  const cacheTTL = ttl === 0 ? 0 : (ttl || parseInt(process.env.CACHE_TTL || '900'));
  const key = `${sheetId}:${tabName}`;
  const now = Date.now();

  // Return cached data if still fresh
  if (cacheTTL > 0 && cache[key] && now - cache[key].ts < cacheTTL * 1000) return cache[key].data;

  // Request coalescing: if an identical fetch is already in-flight, reuse it
  // This prevents parallel calls (e.g. page load + goals + agent-perf) from
  // each making their own Google API request for the same sheet
  if (inflight[key]) return inflight[key];

  const promise = (async () => {
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
    const rawDataRows = rows.slice(headerIdx + 1);
    const data = rawDataRows.reduce((acc, row, ri) => {
      if (!row.some(c => c)) return acc;
      const obj = { _rowIndex: headerIdx + ri + 2 }; // 1-based sheet row number
      headers.forEach((h, i) => { if (h) obj[h] = (row[i] || '').trim(); });
      acc.push(obj);
      return acc;
    }, []);

    // Always cache the result (even for TTL=0 routes, other routes benefit)
    cache[key] = { data, ts: Date.now() };
    return data;
  })();

  inflight[key] = promise;
  try {
    return await promise;
  } finally {
    delete inflight[key];
  }
}

export function colIndexToLetter(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/** Write a single cell by column name, auto-creating the column header if missing */
export async function writeCell(sheetId, tabName, rowIndex, colName, value) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: tabName });
  const rows = res.data.values || [];

  let headerIdx = 0, bestScore = 0;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const score = (rows[i] || []).filter(c => { const t = (c || '').trim(); return t.length > 0 && t.length < 60; }).length;
    if (score > bestScore) { bestScore = score; headerIdx = i; }
  }

  const headers = (rows[headerIdx] || []).map(h => (h || '').trim());
  let colIdx = headers.indexOf(colName);

  if (colIdx === -1) {
    colIdx = headers.length;
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${tabName}!${colIndexToLetter(colIdx + 1)}${headerIdx + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[colName]] },
    });
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${tabName}!${colIndexToLetter(colIdx + 1)}${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[value]] },
  });

  invalidateCache(sheetId, tabName);
}

// Standard header structure for the Agent Daily Goals tab
const AGENT_GOALS_HEADERS = [
  'Agent Name', 'Premium/Day ($)', 'Apps/Day', 'Placed/Day',
  'Placement Rate (%)', 'CPA Target ($)', 'Conversion Rate (%)', 'Notes', 'Commission Type',
];

/**
 * Ensure all agents in agentNames have a row in the Agent Goals tab.
 * Handles empty sheets, broken sheets (missing Agent Name column), and adds Commission Type.
 * Defaults new agents to "Commission".
 */
export async function ensureAgentsExist(sheetId, tabName, agentNames, existingRows) {
  const existing = new Set(
    existingRows.map(r => (r['Agent Name'] || r['Agent'] || r['Name'] || '').trim().toLowerCase())
  );
  const missing = agentNames.filter(n => n && !existing.has(n.toLowerCase()));
  if (missing.length === 0) return;

  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: tabName });
  const rows = res.data.values || [];

  // Locate header row
  let headerIdx = 0, bestScore = 0;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const score = (rows[i] || []).filter(c => { const t = (c || '').trim(); return t.length > 0 && t.length < 60; }).length;
    if (score > bestScore) { bestScore = score; headerIdx = i; }
  }
  let headers = (rows[headerIdx] || []).map(h => (h || '').trim());

  // If sheet is empty OR missing Agent Name column (broken state), write standard headers
  const hasAgentNameCol = headers.some(h => ['Agent Name', 'Agent', 'Name'].includes(h));
  if (!hasAgentNameCol) {
    headers = [...AGENT_GOALS_HEADERS];
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${tabName}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [headers] },
    });
    headerIdx = 0;
    console.log(`[sheets] Wrote standard headers to ${tabName}`);
  } else if (!headers.includes('Commission Type')) {
    // Headers exist and are correct — just add the Commission Type column
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${tabName}!${colIndexToLetter(headers.length + 1)}${headerIdx + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['Commission Type']] },
    });
    headers.push('Commission Type');
  }

  const nameCol = Math.max(0, headers.findIndex(h => ['Agent Name', 'Agent', 'Name'].includes(h)));
  const commTypeIdx = headers.indexOf('Commission Type');

  // Build full-width rows so every column lands in the right position
  const newRows = missing.map(name => {
    const row = new Array(headers.length).fill('');
    row[nameCol] = name;
    if (commTypeIdx >= 0) row[commTypeIdx] = 'Commission';
    return row;
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: tabName,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: newRows },
  });

  invalidateCache(sheetId, tabName);
  console.log(`[sheets] Added ${missing.length} new agent(s) to ${tabName}:`, missing.join(', '));
}

export function invalidateCache(sheetId, tabName) {
  delete cache[`${sheetId}:${tabName}`];
}

export function clearAllCache() {
  Object.keys(cache).forEach(k => delete cache[k]);
}
