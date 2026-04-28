// src/app/api/portfolio/export-view/route.js
// Export the active view's data in the requested format.
//   ?viewId=N&format=csv|xlsx|json|dialer
//
// CSV / XLSX honor the view's column list (same as the grid).
// Dialer always uses ChaseData fields (phone, firstName, lastName, state)
// regardless of which view's columns are configured.
// JSON returns the rows as-is.

import * as XLSX from 'xlsx';
import { getView } from '@/lib/portfolio/views';
import { listContactsForView } from '@/lib/portfolio/query';
import { COLUMN_REGISTRY } from '@/lib/portfolio/column-registry';

export const dynamic = 'force-dynamic';

const MAX_ROWS = 5000;

function camelKey(snake) {
  return snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function csvEscape(v) {
  if (v == null) return '';
  const s = Array.isArray(v) ? v.join('|') : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(rows, columns) {
  const headers = columns.map(k => COLUMN_REGISTRY[k]?.label ?? k);
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(columns.map(k => csvEscape(row[camelKey(k)])).join(','));
  }
  return lines.join('\r\n');
}

function rowsToXlsx(rows, columns) {
  const headers = columns.map(k => COLUMN_REGISTRY[k]?.label ?? k);
  const data = [headers, ...rows.map(row => columns.map(k => {
    const v = row[camelKey(k)];
    return Array.isArray(v) ? v.join('|') : (v ?? '');
  }))];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Portfolio');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function rowsToDialerCsv(rows) {
  // ChaseData expects: Phone, FirstName, LastName, State (header required)
  const lines = ['Phone,FirstName,LastName,State'];
  for (const r of rows) {
    // Names not directly in row.* unless the view selected them — fall back to splitting `name`
    let firstName = '', lastName = '';
    if (r.name) {
      const parts = String(r.name).trim().split(/\s+/);
      firstName = parts[0] ?? '';
      lastName = parts.slice(1).join(' ');
    }
    const phone = (r.phone ?? '').toString().replace(/\D/g, '');
    lines.push([
      csvEscape(phone),
      csvEscape(firstName),
      csvEscape(lastName),
      csvEscape(r.state ?? ''),
    ].join(','));
  }
  return lines.join('\r\n');
}

export async function GET(req) {
  const url = new URL(req.url);
  const viewId = parseInt(url.searchParams.get('viewId') ?? '', 10);
  const format = (url.searchParams.get('format') ?? 'csv').toLowerCase();

  if (isNaN(viewId)) return new Response('viewId required', { status: 400 });
  if (!['csv', 'xlsx', 'json', 'dialer'].includes(format)) {
    return new Response(`unknown format: ${format}`, { status: 400 });
  }

  const view = await getView(viewId);
  if (!view) return new Response('view not found', { status: 404 });

  // For dialer mode we need name + phone + state regardless of view's columns
  const cols = format === 'dialer'
    ? ['name', 'phone', 'state']
    : (view.columns?.length ? view.columns : ['name', 'phone', 'state', 'placed_status', 'monthly_premium']);

  const result = await listContactsForView({
    viewConfig: { ...view, columns: cols },
    page: 1,
    pageSize: MAX_ROWS,
  });

  const date = new Date().toISOString().slice(0, 10);
  const safeName = (view.name || 'export').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const baseFilename = `portfolio-${safeName}-${date}`;

  if (format === 'json') {
    return new Response(JSON.stringify({ view: view.name, count: result.total, rows: result.rows }, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${baseFilename}.json"`,
      },
    });
  }

  if (format === 'csv') {
    const csv = rowsToCsv(result.rows, view.columns);
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${baseFilename}.csv"`,
      },
    });
  }

  if (format === 'dialer') {
    const csv = rowsToDialerCsv(result.rows);
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${baseFilename}-dialer.csv"`,
      },
    });
  }

  // xlsx
  const buf = rowsToXlsx(result.rows, view.columns);
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${baseFilename}.xlsx"`,
    },
  });
}
