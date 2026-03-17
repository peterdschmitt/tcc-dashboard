#!/usr/bin/env node
/**
 * Creates Commission Ledger and Commission Statements tabs on the SALES sheet.
 *
 * Usage: node scripts/create-commission-sheets.js
 */

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

async function getAuth() {
  let credentials;
  if (envVars.GOOGLE_SERVICE_ACCOUNT_KEY) {
    credentials = JSON.parse(envVars.GOOGLE_SERVICE_ACCOUNT_KEY);
  } else {
    credentials = {
      client_email: envVars.GOOGLE_CLIENT_EMAIL,
      private_key: envVars.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    };
  }
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function columnLetter(n) {
  let result = '';
  while (n > 0) {
    n--;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

const TABS_TO_CREATE = [
  {
    sheetIdEnvKey: 'SALES_SHEET_ID',
    sheetName: 'Sales/Policy Tracker',
    tabName: envVars.COMMISSION_LEDGER_TAB || 'Commission Ledger',
    headers: [
      'Transaction ID', 'Statement Date', 'Processing Date', 'Carrier',
      'Policy #', 'Insured Name', 'Agent', 'Transaction Type',
      'Premium', 'Commission Amount', 'Outstanding Balance',
      'Matched Policy #', 'Match Type', 'Match Confidence', 'Status',
      'Statement File', 'Notes',
    ],
  },
  {
    sheetIdEnvKey: 'SALES_SHEET_ID',
    sheetName: 'Sales/Policy Tracker',
    tabName: envVars.COMMISSION_STATEMENTS_TAB || 'Commission Statements',
    headers: [
      'Statement ID', 'Upload Date', 'Carrier', 'Statement Period',
      'File Name', 'File Type', 'Total Records', 'Matched', 'Unmatched',
      'Pending Review', 'Total Advances', 'Total Recoveries', 'Net Amount',
      'Cancellations Detected', 'Status',
    ],
  },
];

async function addTab(sheetsClient, spreadsheetId, tabDef) {
  const addRes = await sheetsClient.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        addSheet: {
          properties: {
            title: tabDef.tabName,
            gridProperties: { frozenRowCount: 1 },
          },
        },
      }],
    },
  });

  const newSheetId = addRes.data.replies[0].addSheet.properties.sheetId;

  await sheetsClient.spreadsheets.values.update({
    spreadsheetId,
    range: `'${tabDef.tabName}'!A1:${columnLetter(tabDef.headers.length)}1`,
    valueInputOption: 'RAW',
    requestBody: { values: [tabDef.headers] },
  });

  await sheetsClient.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId: newSheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.13, green: 0.17, blue: 0.24 },
                textFormat: {
                  bold: true,
                  foregroundColor: { red: 0.94, green: 0.95, blue: 0.98 },
                  fontSize: 10,
                },
              },
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)',
          },
        },
        {
          autoResizeDimensions: {
            dimensions: {
              sheetId: newSheetId,
              dimension: 'COLUMNS',
              startIndex: 0,
              endIndex: tabDef.headers.length,
            },
          },
        },
      ],
    },
  });
}

async function main() {
  console.log('Commission Statement Tabs — Creating on Sales sheet...\n');

  const auth = await getAuth();
  const sheetsClient = google.sheets({ version: 'v4', auth });

  let success = 0, skipped = 0;

  for (const tabDef of TABS_TO_CREATE) {
    const spreadsheetId = envVars[tabDef.sheetIdEnvKey];
    if (!spreadsheetId) {
      console.log(`  Skipping "${tabDef.tabName}" — ${tabDef.sheetIdEnvKey} not set`);
      skipped++;
      continue;
    }

    process.stdout.write(`  Adding "${tabDef.tabName}" to ${tabDef.sheetName}...`);
    try {
      const meta = await sheetsClient.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
      const existingTabs = meta.data.sheets.map(s => s.properties.title);

      if (existingTabs.includes(tabDef.tabName)) {
        console.log(' Already exists, skipping');
        skipped++;
        continue;
      }

      await addTab(sheetsClient, spreadsheetId, tabDef);
      console.log(' Done');
      success++;
    } catch (e) {
      console.log(` Error: ${e.message}`);
    }
  }

  console.log(`\nDone! ${success} tabs created, ${skipped} skipped.`);
  console.log('\n  .env.local variables to add:');
  console.log('  COMMISSION_LEDGER_TAB=Commission Ledger');
  console.log('  COMMISSION_STATEMENTS_TAB=Commission Statements');
  console.log('');
}

main().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
