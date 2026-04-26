// scripts/ghl-init-tabs.js
// Run: node --env-file=.env.local scripts/ghl-init-tabs.js
// Requires: GOALS_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_KEY in env.
import { getSheetsClient } from '../src/lib/sheets.js';

const TABS = {
  'GHL Sync Log': ['Timestamp', 'Row Hash', 'Lead Id', 'Phone', 'First', 'Last', 'State', 'Tier', 'Action', 'GHL Contact ID', 'Error', 'High Water Mark'],
  'GHL Possible Merges': ['Timestamp', 'Existing GHL Contact ID', 'Existing Name', 'Existing Phone', 'New GHL Contact ID', 'New Name', 'New Phone', 'State', 'Reviewed'],
  'GHL Excluded Campaigns': ['Campaign', 'Subcampaign', 'Reason', 'Added Date'],
};

async function main() {
  const sheetId = process.env.GOALS_SHEET_ID;
  if (!sheetId) throw new Error('GOALS_SHEET_ID not set');
  const sheets = await getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const existingTabs = new Set(meta.data.sheets.map(s => s.properties.title));

  const requests = [];
  for (const tabName of Object.keys(TABS)) {
    if (existingTabs.has(tabName)) {
      console.log(`✓ exists: ${tabName}`);
      continue;
    }
    requests.push({ addSheet: { properties: { title: tabName } } });
  }

  if (requests.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests },
    });
    console.log(`Created ${requests.length} new tab(s)`);
  }

  // Write headers for any tab whose first row is empty
  for (const [tabName, headers] of Object.entries(TABS)) {
    const r = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${tabName}!A1:Z1` });
    const existingHeaders = (r.data.values?.[0] ?? []).filter(Boolean);
    if (existingHeaders.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `${tabName}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [headers] },
      });
      console.log(`✓ wrote headers: ${tabName}`);
    } else if (existingHeaders.length !== headers.length || existingHeaders.some((h, i) => h !== headers[i])) {
      console.warn(`⚠ headers differ on ${tabName} — manual review needed. Expected:`, headers, 'Found:', existingHeaders);
    }
  }
  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
