import { fetchSheet } from '@/lib/sheets';
import { NextResponse } from 'next/server';

function parseGoalRow(row, metricColumns) {
  const goals = {};
  metricColumns.forEach(({ key, column }) => {
    const val = parseFloat(row[column]);
    if (!isNaN(val)) goals[key] = val;
  });
  return goals;
}

export async function GET() {
  try {
    const sheetId = process.env.GOALS_SHEET_ID;

    const [companyRows, agentRows, carrierRows, publisherRows, pricingRows] = await Promise.all([
      fetchSheet(sheetId, process.env.GOALS_COMPANY_TAB || 'Company Daily Goals'),
      fetchSheet(sheetId, process.env.GOALS_AGENT_TAB || 'Agent Daily Goals'),
      fetchSheet(sheetId, process.env.GOALS_CARRIER_TAB || 'Carrier Daily Goals'),
      fetchSheet(sheetId, process.env.GOALS_PUBLISHER_TAB || 'Publisher Daily Goals'),
      fetchSheet(sheetId, process.env.GOALS_PRICING_TAB || 'Publisher Pricing'),
    ]);

    // Company goals
    const company = {};
    companyRows.forEach(row => {
      const metric = row['Metric'] || '';
      const value = parseFloat(row['Daily Goal']);
      if (isNaN(value)) return;
      if (metric.includes('Premium')) company.premiumTarget = value;
      if (metric.includes('Applications')) company.appsSubmitted = value;
      if (metric.includes('Policies Placed')) company.policiesPlaced = value;
      if (metric.includes('Placement Rate')) company.placementRate = value;
      if (metric.includes('CPA')) company.cpa = value;
      if (metric.includes('Conversion')) company.conversionRate = value;
    });

    // Agent/Carrier/Publisher goals
    const agentCols = [
      { key: 'premiumTarget', column: 'Premium/Day ($)' },
      { key: 'appsSubmitted', column: 'Apps/Day' },
      { key: 'policiesPlaced', column: 'Placed/Day' },
      { key: 'placementRate', column: 'Placement Rate (%)' },
      { key: 'cpa', column: 'CPA Target ($)' },
      { key: 'conversionRate', column: 'Conversion Rate (%)' },
    ];

    const agentDefaults = {};
    const agentOverrides = {};
    agentRows.forEach(row => {
      const name = (row['Agent Name'] || '').trim();
      if (!name) return;
      const goals = parseGoalRow(row, agentCols);
      if (name === '(DEFAULT)') Object.assign(agentDefaults, goals);
      else if (Object.keys(goals).length > 0) agentOverrides[name] = goals;
    });

    const carrierCols = agentCols.map(c => ({ ...c, column: c.column }));
    const carrierDefaults = {};
    const carrierOverrides = {};
    carrierRows.forEach(row => {
      const name = (row['Carrier'] || '').trim();
      if (!name) return;
      const goals = parseGoalRow(row, carrierCols);
      if (name === '(DEFAULT)') Object.assign(carrierDefaults, goals);
      else if (Object.keys(goals).length > 0) carrierOverrides[name] = goals;
    });

    const publisherOverrides = {};
    publisherRows.forEach(row => {
      const name = (row['Publisher / Lead Source'] || '').trim();
      if (!name) return;
      const goals = parseGoalRow(row, agentCols);
      if (Object.keys(goals).length > 0) publisherOverrides[name] = goals;
    });

    // Publisher pricing
    const pricing = {};
    pricingRows.forEach(row => {
      const code = (row['Campaign Code'] || '').trim();
      const status = (row['Status'] || '').trim();
      if (!code || status === 'Inactive') return;
      pricing[code] = {
        campaignCode: code,
        vendor: (row['Vendor'] || '').trim(),
        fullName: (row['Full Campaign Name'] || '').trim(),
        pricePerCall: parseFloat(row['Price per Billable Call ($)']) || 0,
        buffer: parseInt(row['Buffer (seconds)']) || 0,
        category: (row['Category'] || '').trim(),
        did: (row['Assigned DID'] || '').trim(),
        status,
      };
    });

    return NextResponse.json({
      company,
      agent: { defaults: agentDefaults, overrides: agentOverrides },
      carrier: { defaults: carrierDefaults, overrides: carrierOverrides },
      publisher: { overrides: publisherOverrides },
      pricing,
    });
  } catch (error) {
    console.error('Goals API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
