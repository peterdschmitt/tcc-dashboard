export const dynamic = 'force-dynamic';
import { fetchSheet } from '@/lib/sheets';
import { parseFlexDate } from '@/lib/utils';
import { NextResponse } from 'next/server';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period'); // YYYY-MM format
    const carrier = searchParams.get('carrier');
    const product = searchParams.get('product');
    const agent = searchParams.get('agent');

    const metricsRaw = await fetchSheet(
      process.env.GOALS_SHEET_ID,
      process.env.PERSISTENCY_TAB_NAME || 'Persistency Metrics',
      120
    );

    let report = metricsRaw
      .filter(r => r['Date'] && r['Persistency Rate'])
      .map(r => {
        const date = parseFlexDate(r['Date']);
        return {
          date,
          month: date ? date.slice(0, 7) : '',
          carrier: r['Carrier']?.trim() || '',
          product: r['Product']?.trim() || '',
          agent: r['Agent']?.trim() || '',
          issued: parseInt(r['Issued Policies']) || 0,
          lapsed: parseInt(r['Lapsed Policies']) || 0,
          active: parseInt(r['Active Policies']) || 0,
          persistencyRate: parseFloat(r['Persistency Rate']) || 0,
          lapseRate: parseFloat(r['Lapse Rate']) || 0,
          avgDaysActive: parseInt(r['Avg Days Active']) || 0,
        };
      });

    // Apply filters
    if (period) {
      report = report.filter(r => r.month === period);
    }
    if (carrier) {
      report = report.filter(r => r.carrier.toLowerCase().includes(carrier.toLowerCase()));
    }
    if (product) {
      report = report.filter(r => r.product.toLowerCase().includes(product.toLowerCase()));
    }
    if (agent) {
      report = report.filter(r => r.agent.toLowerCase().includes(agent.toLowerCase()));
    }

    // Calculate summary
    let totalIssued = 0;
    let totalLapsed = 0;
    let totalActive = 0;
    let bestCarrier = '';
    let worstCarrier = '';
    let bestPersistency = -1;
    let worstPersistency = 101;
    const carrierMetrics = {};

    report.forEach(r => {
      totalIssued += r.issued;
      totalLapsed += r.lapsed;
      totalActive += r.active;

      if (!carrierMetrics[r.carrier]) {
        carrierMetrics[r.carrier] = { issued: 0, lapsed: 0, active: 0, count: 0, totalPersistency: 0 };
      }
      carrierMetrics[r.carrier].issued += r.issued;
      carrierMetrics[r.carrier].lapsed += r.lapsed;
      carrierMetrics[r.carrier].active += r.active;
      carrierMetrics[r.carrier].count++;
      carrierMetrics[r.carrier].totalPersistency += r.persistencyRate;

      if (r.persistencyRate > bestPersistency) {
        bestPersistency = r.persistencyRate;
        bestCarrier = r.carrier;
      }
      if (r.persistencyRate < worstPersistency) {
        worstPersistency = r.persistencyRate;
        worstCarrier = r.carrier;
      }
    });

    // Calculate average persistency across all carriers
    let avgPersistency = 0;
    if (Object.keys(carrierMetrics).length > 0) {
      const totalPersistency = Object.values(carrierMetrics).reduce(
        (sum, m) => sum + (m.totalPersistency / m.count), 0
      );
      avgPersistency = totalPersistency / Object.keys(carrierMetrics).length;
    }

    const summary = {
      period: period || 'All',
      totalIssued,
      totalLapsed,
      totalActive,
      avgPersistency: parseFloat(avgPersistency.toFixed(2)),
      bestCarrier: bestCarrier || 'N/A',
      worstCarrier: worstCarrier || 'N/A',
      bestPersistency: bestPersistency >= 0 ? parseFloat(bestPersistency.toFixed(2)) : 0,
      worstPersistency: worstPersistency <= 100 ? parseFloat(worstPersistency.toFixed(2)) : 0,
    };

    return NextResponse.json({
      report,
      summary,
    });
  } catch (error) {
    console.error('[crm/metrics/persistency-report] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
