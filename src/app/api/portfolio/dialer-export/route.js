// src/app/api/portfolio/dialer-export/route.js
import { listContacts } from '@/lib/portfolio/query';
import { toCsv, DIALER_EXPORT_COLUMNS } from '@/lib/portfolio/exports';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const url = new URL(req.url);
  let filters = {};
  try { filters = JSON.parse(url.searchParams.get('filters') ?? '{}'); }
  catch { return new Response('invalid filters JSON', { status: 400 }); }

  const { rows } = await listContacts({ filters, page: 1, pageSize: 5000 });
  const csv = toCsv(rows, DIALER_EXPORT_COLUMNS);

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="dialer-list-${new Date().toISOString().slice(0,10)}.csv"`,
    },
  });
}
