import { NextResponse } from 'next/server';
import { fetchAgentDeepDiveWithUniverse } from '@/lib/conversely-api';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const runDate = searchParams.get('runDate') || searchParams.get('date') || undefined;

    // Try the requested run_date first; fall back to latest if empty.
    let bundle = await fetchAgentDeepDiveWithUniverse({ runDate });
    if (!bundle || (!bundle.entities?.length && !bundle.universe?.length)) {
      bundle = await fetchAgentDeepDiveWithUniverse();
    }

    if (!bundle) {
      return NextResponse.json({
        runDate: null,
        entities: [],
        universe: [],
        pending: [],
      });
    }

    return NextResponse.json({
      runDate: bundle.runDate || null,
      dataStartDate: bundle.dataStartDate || null,
      dataEndDate: bundle.dataEndDate || null,
      entityLabel: bundle.entityLabel || null,
      entities: (bundle.entities || []).map(e => ({
        name: e.entityName,
        content: e.resultMessage,
        createdAt: e.createdAt,
      })),
      universe: bundle.universe || [],
      pending: bundle.pending || [],
    });
  } catch (err) {
    console.error('[agent-deep-dive] error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
