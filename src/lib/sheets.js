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
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return cachedAuth;
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
