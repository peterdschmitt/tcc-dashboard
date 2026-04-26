// src/app/api/portfolio/contacts/route.js
import { NextResponse } from 'next/server';
import { listContacts, groupContacts } from '@/lib/portfolio/query';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const url = new URL(req.url);
  let filters = {};
  try { filters = JSON.parse(url.searchParams.get('filters') ?? '{}'); }
  catch { return NextResponse.json({ error: 'invalid filters JSON' }, { status: 400 }); }

  const groupBy = url.searchParams.get('groupBy');
  const page = parseInt(url.searchParams.get('page') ?? '1', 10);
  const pageSize = Math.min(parseInt(url.searchParams.get('pageSize') ?? '50', 10), 200);
  const sortBy = url.searchParams.get('sortBy') ?? 'last_seen_at';
  const sortDir = url.searchParams.get('sortDir') ?? 'desc';

  try {
    if (groupBy && groupBy !== 'none') {
      const result = await groupContacts({ filters, groupBy });
      return NextResponse.json(result);
    }
    const result = await listContacts({ filters, page, pageSize, sortBy, sortDir });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}
