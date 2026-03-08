const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const envContent = fs.readFileSync(path.join(__dirname, '.env.local'), 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const t = line.trim();
  if (!t || t.startsWith('#')) return;
  const eq = t.indexOf('=');
  if (eq === -1) return;
  env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
});

async function main() {
  const creds = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth });

  console.log('=== Testing Carrier Report Access ===');
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: '1-zzov2DdfIkljGibRbKz9nTXsJqXJOEBIzY1NwBY8rs',
      range: 'Policies!A1:X2'
    });
    console.log('OK - Headers:', (res.data.values[0] || []).join(', '));
  } catch(e) {
    console.log('FAILED:', e.message);
  }

  console.log('\n=== Testing Existing Sheets ===');
  const sheetIds = { SALES: env.SALES_SHEET_ID, CALLLOGS: env.CALLLOGS_SHEET_ID, GOALS: env.GOALS_SHEET_ID };
  for (const [name, id] of Object.entries(sheetIds)) {
    try {
      const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties.title' });
      const tabs = meta.data.sheets.map(s => s.properties.title);
      console.log(name + ' (' + id + '): tabs: ' + tabs.join(', '));
    } catch(e) {
      console.log(name + ': FAILED - ' + e.message);
    }
  }
}
main();
