// src/app/api/portfolio/contacts/route.js
import { NextResponse } from 'next/server';
import { listContacts, groupContacts, listContactsForView } from '@/lib/portfolio/query';
import { getView } from '@/lib/portfolio/views';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const url = new URL(req.url);

  // New path: viewId — load the view server-side and use its full config
  const viewId = url.searchParams.get('viewId');
  if (viewId) {
    const id = parseInt(viewId, 10);
    if (isNaN(id)) return NextResponse.json({ error: 'invalid viewId' }, { status: 400 });
    const view = await getView(id);
    if (!view) return NextResponse.json({ error: 'view not found' }, { status: 404 });
    const page = parseInt(url.searchParams.get('page') ?? '1', 10);
    const pageSize = Math.min(parseInt(url.searchParams.get('pageSize') ?? '50', 10), 200);
    try {
      const result = await listContactsForView({ viewConfig: view, page, pageSize });
      return NextResponse.json(result);
    } catch (err) {
      return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
    }
  }

  // Legacy path: filters + groupBy
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
      return NextResponse.json(await groupContacts({ filters, groupBy }));
    }
    return NextResponse.json(await listContacts({ filters, page, pageSize, sortBy, sortDir }));
  } catch (err) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}
