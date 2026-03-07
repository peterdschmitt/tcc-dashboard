export const dynamic = 'force-dynamic';
import { fetchSheet } from '@/lib/sheets';
import { parseFlexDate } from '@/lib/utils';
import { NextResponse } from 'next/server';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('start');
    const endDate = searchParams.get('end');

    const [policyholdersRaw, healthRaw, tasksRaw] = await Promise.all([
      fetchSheet(process.env.SALES_SHEET_ID, process.env.POLICYHOLDER_TAB_NAME || 'Policyholders', 120),
      fetchSheet(process.env.GOALS_SHEET_ID, process.env.HEALTH_TAB_NAME || 'Business Health', 120).catch(() => []),
      fetchSheet(process.env.SALES_SHEET_ID, process.env.TASKS_TAB_NAME || 'Outreach Tasks', 120).catch(() => []),
    ]);

    // Count current statuses
    const statusCounts = {};
    const carrierCounts = {};
    const agentCounts = {};
    const lapseReasons = {};
    let totalActiveMembers = 0;
    let totalActivePremium = 0;
    let totalAtRiskMembers = 0;
    let totalAtRiskPremium = 0;
    let lapsedThisPeriod = 0;

    const today = new Date();
    const startTs = startDate ? new Date(startDate).getTime() : 0;
    const endTs = endDate ? new Date(endDate).getTime() : Date.now();

    policyholdersRaw.forEach(r => {
      const status = r['Status']?.trim() || 'Active';
      const carrier = r['Carrier']?.trim() || 'Unknown';
      const agent = r['Agent']?.trim() || 'Unknown';
      const premium = parseFloat(r['Premium Amount']) || 0;

      // Count by status
      statusCounts[status] = (statusCounts[status] || 0) + 1;

      // Count by carrier
      if (!carrierCounts[carrier]) {
        carrierCounts[carrier] = { active: 0, lapsed: 0, atRisk: 0, premium: 0 };
      }
      if (!agentCounts[agent]) {
        agentCounts[agent] = { active: 0, lapsed: 0, atRisk: 0, premium: 0 };
      }

      // Aggregate metrics
      if (status === 'Active') {
        totalActiveMembers++;
        totalActivePremium += premium;
        carrierCounts[carrier].active++;
        agentCounts[agent].active++;
        carrierCounts[carrier].premium += premium;
        agentCounts[agent].premium += premium;
      } else if (status === 'At-Risk') {
        totalAtRiskMembers++;
        totalAtRiskPremium += premium;
        carrierCounts[carrier].atRisk++;
        agentCounts[agent].atRisk++;
      } else if (status === 'Lapsed') {
        carrierCounts[carrier].lapsed++;
        agentCounts[agent].lapsed++;

        // Count lapsed in date range
        const statusChangeDate = parseFlexDate(r['Status Change Date']);
        if (statusChangeDate) {
          const changeTs = new Date(statusChangeDate).getTime();
          if (changeTs >= startTs && changeTs <= endTs) {
            lapsedThisPeriod++;
            const reason = r['Status Change Reason']?.trim() || 'Unknown';
            lapseReasons[reason] = (lapseReasons[reason] || 0) + 1;
          }
        }
      }
    });

    // Calculate lapse rate
    const totalMembers = totalActiveMembers + lapsedThisPeriod;
    const lapseRate = totalMembers > 0 ? (lapsedThisPeriod / totalMembers * 100) : 0;

    // Calculate average premium
    const avgPremium = totalActiveMembers > 0 ? totalActivePremium / totalActiveMembers : 0;

    // Revenue at risk
    const revenueAtRisk = totalAtRiskMembers * avgPremium;

    // Win-back stats
    let winBackAttempts = 0;
    let winBackSuccesses = 0;
    tasksRaw.forEach(t => {
      if ((t['Type'] || '').toLowerCase() === 'win-back') {
        winBackAttempts++;
        if ((t['Status'] || '').toLowerCase() === 'completed') {
          winBackSuccesses++;
        }
      }
    });

    // Lapse reasons array
    const lapseReasonsArray = Object.entries(lapseReasons).map(([reason, count]) => ({
      reason,
      count,
    }));

    // By carrier array
    const byCarrier = Object.entries(carrierCounts).map(([name, data]) => ({
      carrier: name,
      ...data,
    }));

    // By agent array
    const byAgent = Object.entries(agentCounts).map(([name, data]) => ({
      agent: name,
      ...data,
    }));

    // Time series from health sheet
    const timeSeries = healthRaw
      .map(r => ({
        date: parseFlexDate(r['Date']) || '',
        activeMembers: parseInt(r['Active Members']) || 0,
        lapsedMembers: parseInt(r['Lapsed Members']) || 0,
        atRiskMembers: parseInt(r['At-Risk Members']) || 0,
        activePremium: parseFloat(r['Active Premium']) || 0,
      }))
      .filter(row => row.date)
      .sort((a, b) => a.date.localeCompare(b.date));

    const current = {
      activeMembers: totalActiveMembers,
      totalActivePremium,
      atRiskMembers: totalAtRiskMembers,
      atRiskPremium: totalAtRiskPremium,
      lapsedThisPeriod,
      lapseRate: parseFloat(lapseRate.toFixed(2)),
      revenueAtRisk: parseFloat(revenueAtRisk.toFixed(2)),
      avgPremium: parseFloat(avgPremium.toFixed(2)),
      winBackAttempts,
      winBackSuccesses,
    };

    return NextResponse.json({
      current,
      timeSeries,
      lapseReasons: lapseReasonsArray,
      byCarrier,
      byAgent,
    });
  } catch (error) {
    console.error('[crm/metrics/business-health] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
