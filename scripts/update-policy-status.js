const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

// Load env vars from .env.local
const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');
const envVars = {};
envContent.split('\n').forEach(line => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx === -1) return;
  envVars[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
});

async function main() {
  const credentials = JSON.parse(envVars.GOOGLE_SERVICE_ACCOUNT_KEY);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const sheetId = envVars.SALES_SHEET_ID;
  const tabName = envVars.SALES_TAB_NAME || 'Sheet1';

  console.log(`Reading sheet: ${sheetId}, tab: ${tabName}`);

  // Read all data
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: tabName });
  const rows = res.data.values || [];

  // Find header row
  let headerIdx = 0, bestScore = 0;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const score = (rows[i] || []).filter(c => { const t = (c || '').trim(); return t.length > 0 && t.length < 60; }).length;
    if (score > bestScore) { bestScore = score; headerIdx = i; }
  }
  const headers = rows[headerIdx].map(h => (h || '').trim());
  console.log(`Header row: ${headerIdx + 1}`);

  // Find Policy Status column
  let policyStatusCol = headers.indexOf('Policy Status');
  console.log(`Policy Status column index: ${policyStatusCol} (letter: ${String.fromCharCode(65 + policyStatusCol)})`);

  // Find Policy # column and Last Name column
  const policyCol = headers.indexOf('Policy #');
  const lastNameCol = headers.indexOf('Last Name');
  console.log(`Policy # column: ${policyCol}, Last Name column: ${lastNameCol}`);

  // Search for our target policies
  const targets = [
    { lastName: 'PICOU', policyNum: '6260047070', newStatus: 'Cancelled' },
    { lastName: 'WILLIAMS', policyNum: '6260048701', newStatus: 'Cancelled' },
    { lastName: 'ZACCARDI', policyNum: '7260020002', newStatus: 'Cancelled' },
  ];

  for (const target of targets) {
    let found = false;
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const lastName = (row[lastNameCol] || '').trim().toUpperCase();
      const policyNum = (row[policyCol] || '').trim();
      
      if (policyNum === target.policyNum || lastName === target.lastName) {
        const sheetRow = i + 1; // 1-based
        const currentStatus = (row[policyStatusCol] || '').trim();
        const firstName = headers.indexOf('First Name') >= 0 ? (row[headers.indexOf('First Name')] || '').trim() : '';
        console.log(`\nFOUND: ${firstName} ${lastName} | Policy: ${policyNum} | Row: ${sheetRow} | Current Status: "${currentStatus}"`);
        
        // Only update if it's an AIG policy matching our target
        if (policyNum === target.policyNum) {
          const colLetter = colIndexToLetter(policyStatusCol + 1);
          const range = `${tabName}!${colLetter}${sheetRow}`;
          console.log(`  → Writing "${target.newStatus}" to ${range}`);
          await sheets.spreadsheets.values.update({
            spreadsheetId: sheetId,
            range,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[target.newStatus]] },
          });
          console.log(`  ✓ Updated successfully`);
          found = true;
        } else {
          console.log(`  → Last name match but policy # doesn't match (${policyNum} vs ${target.policyNum}), checking next...`);
        }
      }
    }
    if (!found) {
      console.log(`\n⚠ NOT FOUND in sheet: ${target.lastName} (policy ${target.policyNum})`);
    }
  }

  console.log('\nDone!');
}

function colIndexToLetter(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
