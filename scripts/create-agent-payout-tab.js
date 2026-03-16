#!/usr/bin/env node
/**
 * Creates the "Agent Payout Rates" tab on the GOALS_SHEET.
 *
 * This tab stores the multiplier the agency pays agents per product type.
 * It is separate from the Commission Rates sheet which stores carrier payout rates.
 *
 * Columns: Product Type | Multiplier
 * Default rows: Standard = 3, GIWL = 1.5
 *
 * Usage: node scripts/create-agent-payout-tab.js
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
  const key = trimmed.slice(0, eqIdx).trim();
  const val = trimmed.slice(eqIdx + 1).trim();
  envVars[key] = val;
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

const TAB_NAME = envVars.AGENT_PAYOUT_TAB || 'Agent Payout Rates';
const SHEET_ID = envVars.GOALS_SHEET_ID;

async function main() {
  if (!SHEET_ID) {
    console.error('GOALS_SHEET_ID not set in .env.local');
    process.exit(1);
  }

  const auth = await getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // Check if tab already exists
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const existing = meta.data.sheets.find(s => s.properties.title === TAB_NAME);

  if (existing) {
    console.log(`Tab "${TAB_NAME}" already exists — skipping creation.`);
    console.log('If you want to reset it, delete the tab manually first.');
    return;
  }

  // Create the tab
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [{
        addSheet: { properties: { title: TAB_NAME } }
      }]
    }
  });
  console.log(`Created tab "${TAB_NAME}"`);

  // Write headers + default data
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TAB_NAME}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [
        ['Product Type', 'Multiplier'],
        ['Standard', '3'],
        ['GIWL', '1.5'],
      ]
    }
  });

  console.log('Wrote default payout rates:');
  console.log('  Standard  → 3x monthly premium');
  console.log('  GIWL      → 1.5x monthly premium');
  console.log(`\nDone! Tab "${TAB_NAME}" is ready on Goals sheet.`);
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
