import { NextResponse } from 'next/server';
import {
  buildCompanyRow, buildAgentRows, buildCampaignRows, writeSnapshots,
} from '@/lib/snapshots';

function getBaseUrl() {
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:' + (process.env.PORT || 3003);
}

async function writeForDate(baseUrl, date) {
  const res = await fetch(`${baseUrl}/api/daily-summary?start=${date}&end=${date}&mode=daily`);
  if (!res.ok) throw new Error(`daily-summary ${res.status} for ${date}`);
  const s = await res.json();

  const m = {
    apps: s.sales?.total || 0,
    placed: s.sales?.placed || 0,
    totalCalls: s.calls?.total || 0,
    billable: s.calls?.billable || 0,
    billableRate: s.calls?.billableRate || 0,
    totalPremium: s.financials?.totalPremium || 0,
    totalGAR: s.financials?.gar || 0,
    totalLeadSpend: s.financials?.leadSpend || 0,
    totalComm: s.financials?.commission || 0,
    netRevenue: s.financials?.netRevenue || 0,
    cpa: s.financials?.cpa || 0,
    rpc: s.financials?.rpc || 0,
    closeRate: s.financials?.closeRate || 0,
    placementRate: s.financials?.placementRate || 0,
    premCost: s.financials?.premCost || 0,
    avgPremium: s.financials?.avgPremium || 0,
  };

  const companyRow = buildCompanyRow(date, m);
  const agentRows = buildAgentRows(date, s.sales?.byAgent || {}, s.agentPerf || []);
  const campaignRows = buildCampaignRows(date, s.sales?.byCampaign || {});
  return writeSnapshots(date, companyRow, agentRows, campaignRows);
}

export async function GET(request) {
  if (process.env.CRON_SECRET) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');
    if (!date) return NextResponse.json({ error: 'date=YYYY-MM-DD required' }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
    }
    const result = await writeForDate(getBaseUrl(), date);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
