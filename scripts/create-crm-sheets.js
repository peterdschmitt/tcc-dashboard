#!/usr/bin/env node
/**
 * Adds CRM tabs to existing TCC Google Sheets.
 *
 * Layout:
 *   CALLLOGS_SHEET  → "Leads" tab
 *   SALES_SHEET     → "Policyholders" tab, "Outreach Tasks" tab
 *   GOALS_SHEET     → "Lapse Reasons Config" tab, "Business Health" tab, "Persistency Metrics" tab
 *
 * Usage: node scripts/create-crm-sheets.js
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

// Tab definitions: which existing sheet to add each tab to
const TABS_TO_CREATE = [
  {
    sheetIdEnvKey: 'CALLLOGS_SHEET_ID',
    sheetName: 'Call Logs',
    tabName: 'Leads',
    headers: [
      'Lead ID', 'Phone Number', 'Lead Name', 'Lead Source', 'First Contact Date',
      'Primary Agent', 'Status', 'Last Contact Date', 'Conversion Date', 'Policy Number',
      'Follow-Up Due', 'Attempts', 'Notes', 'Assignment History', 'Tags',
      'Do Not Call', 'Source Lead ID',
    ],
  },
  {
    sheetIdEnvKey: 'SALES_SHEET_ID',
    sheetName: 'Sales/Policy Tracker',
    tabName: 'Policyholders',
    headers: [
      'Policy Number', 'Name', 'Status', 'Carrier Status', 'Status Change Reason',
      'Status Change Date', 'Carrier', 'Product', 'Issue Date', 'Effective Date',
      'Submitted Date', 'Agent', 'Premium Amount', 'Last Premium Date',
      'Outreach Attempts', 'Last Outreach Date', 'Last Outreach Method',
      'Last Outreach Result', 'Notes', 'Phone', 'Email', 'Birthdate',
      'Address 1', 'Address 2', 'City', 'State', 'Zip',
      'Writing No', 'Split', 'Issued State', 'Enrollment', 'MS Plan',
      'Carrier Notes', 'Last Sync Date',
    ],
  },
  {
    sheetIdEnvKey: 'SALES_SHEET_ID',
    sheetName: 'Sales/Policy Tracker',
    tabName: 'Outreach Tasks',
    headers: [
      'Task ID', 'Type', 'Entity ID', 'Entity Type', 'Assigned Agent',
      'Due Date', 'Status', 'Created Date', 'Completed Date',
      'Method', 'Result', 'Notes', 'Attempts',
    ],
  },
  {
    sheetIdEnvKey: 'GOALS_SHEET_ID',
    sheetName: 'Goals',
    tabName: 'Lapse Reasons Config',
    headers: [
      'Reason Code', 'Display Name', 'Category', 'Is Recoverable', 'Urgency', 'Notes',
    ],
    seedData: [
      ['Non-Payment', 'Non-Payment', 'External', 'Y', 'High', 'Customer stopped paying premiums'],
      ['Customer-Cancelled', 'Customer Cancelled', 'External', 'Y', 'Medium', 'Customer requested cancellation'],
      ['NSF', 'NSF (Non-Sufficient Funds)', 'External', 'Y', 'High', 'Payment returned NSF'],
      ['Not-Taken', 'Not Taken', 'Internal', 'N', 'Low', 'Policy was never placed/taken'],
      ['Replaced', 'Replaced', 'External', 'N', 'Low', 'Customer replaced with another policy'],
      ['Deceased', 'Deceased', 'External', 'N', 'Low', 'Policyholder deceased'],
      ['Moved', 'Moved / Unreachable', 'External', 'Y', 'Medium', 'Customer moved, cannot reach'],
      ['Other', 'Other', 'Internal', 'Y', 'Medium', 'Other reason — see notes'],
    ],
  },
  {
    sheetIdEnvKey: 'GOALS_SHEET_ID',
    sheetName: 'Goals',
    tabName: 'Business Health',
    headers: [
      'Date', 'Total Active Members', 'Total Premium in Force', 'At-Risk Members',
      'Lapsed This Period', 'Lapse Rate', 'Top Lapse Reason',
      'Win-Back Attempts', 'Win-Back Successes', 'Revenue at Risk',
    ],
  },
  {
    sheetIdEnvKey: 'GOALS_SHEET_ID',
    sheetName: 'Goals',
    tabName: 'Persistency Metrics',
    headers: [
      'Period', 'Carrier', 'Product', 'Agent', 'Active Members',
      'New Issues', 'Lapses', '13-Month Persistency %', 'Avg Lifespan',
      'Churn Rate', 'Last Updated',
    ],
  },
  {
    sheetIdEnvKey: 'GOALS_SHEET_ID',
    sheetName: 'Goals',
    tabName: 'Sync Log',
    headers: [
      'Sync Date', 'Policies Processed', 'New Policies', 'Updated',
      'Status Changes', 'Lapse Events', 'Reinstatements', 'Errors', 'Details',
    ],
  },
];

function columnLetter(n) {
  let result = '';
  while (n > 0) {
    n--;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

async function addTab(sheetsClient, spreadsheetId, tabDef) {
  // Step 1: Add the new tab (sheet) to the spreadsheet
  const addRes = await sheetsClient.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: tabDef.tabName,
              gridProperties: {
                frozenRowCount: 1,
              },
            },
          },
        },
      ],
    },
  });

  const newSheetId = addRes.data.replies[0].addSheet.properties.sheetId;

  // Step 2: Write headers
  await sheetsClient.spreadsheets.values.update({
    spreadsheetId,
    range: `'${tabDef.tabName}'!A1:${columnLetter(tabDef.headers.length)}1`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [tabDef.headers],
    },
  });

  // Step 3: Format header row
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

  // Step 4: Seed data if provided
  if (tabDef.seedData && tabDef.seedData.length > 0) {
    await sheetsClient.spreadsheets.values.append({
      spreadsheetId,
      range: `'${tabDef.tabName}'!A2`,
      valueInputOption: 'RAW',
      requestBody: {
        values: tabDef.seedData,
      },
    });
  }
}

async function main() {
  console.log('🔧 TCC CRM — Adding tabs to existing Google Sheets...\n');

  const auth = await getAuth();
  const sheetsClient = google.sheets({ version: 'v4', auth });

  let success = 0;
  let skipped = 0;

  for (const tabDef of TABS_TO_CREATE) {
    const spreadsheetId = envVars[tabDef.sheetIdEnvKey];
    if (!spreadsheetId) {
      console.log(`  ⚠ Skipping "${tabDef.tabName}" — ${tabDef.sheetIdEnvKey} not set in .env.local`);
      skipped++;
      continue;
    }

    process.stdout.write(`  Adding "${tabDef.tabName}" to ${tabDef.sheetName} (${tabDef.sheetIdEnvKey})...`);
    try {
      // Check if tab already exists
      const meta = await sheetsClient.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
      const existingTabs = meta.data.sheets.map(s => s.properties.title);

      if (existingTabs.includes(tabDef.tabName)) {
        console.log(` ⏭ Already exists, skipping`);
        skipped++;
        continue;
      }

      await addTab(sheetsClient, spreadsheetId, tabDef);
      console.log(` ✅`);
      success++;
    } catch (e) {
      console.log(` ❌ ${e.message}`);
    }
  }

  console.log(`\n✅ Done! ${success} tabs created, ${skipped} skipped.`);
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  Tab mapping (for .env.local — already uses existing Sheet IDs):');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('  CALLLOGS_SHEET_ID  → "Leads" tab');
  console.log('  SALES_SHEET_ID     → "Policyholders" tab, "Outreach Tasks" tab');
  console.log('  GOALS_SHEET_ID     → "Lapse Reasons Config" tab, "Business Health" tab, "Persistency Metrics" tab, "Sync Log" tab');
  console.log('\n  .env.local tab name variables to add:\n');
  console.log('  LEADS_TAB_NAME=Leads');
  console.log('  POLICYHOLDER_TAB_NAME=Policyholders');
  console.log('  TASKS_TAB_NAME=Outreach Tasks');
  console.log('  LAPSE_REASONS_TAB_NAME=Lapse Reasons Config');
  console.log('  HEALTH_TAB_NAME=Business Health');
  console.log('  PERSISTENCY_TAB_NAME=Persistency Metrics');
  console.log('  SYNC_LOG_TAB_NAME=Sync Log');
  console.log('');
}

main().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
