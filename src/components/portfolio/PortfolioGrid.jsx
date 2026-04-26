// src/components/portfolio/PortfolioGrid.jsx
'use client';

const C = {
  bg: '#080b10', surface: '#0f1520', card: '#131b28', border: '#1a2538',
  text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff',
  green: '#4ade80', yellow: '#facc15', red: '#f87171',
};

function statusColor(status) {
  if (!status) return C.muted;
  const s = status.toLowerCase();
  if (s.includes('active') || s.includes('in force') || s.includes('advance released')) return C.green;
  if (s.includes('pending') || s.includes('submitted')) return C.yellow;
  if (s.includes('lapsed') || s.includes('canceled') || s.includes('cancelled') || s.includes('declined')) return C.red;
  return C.muted;
}

export default function PortfolioGrid({ rows, selectedIds, onToggleSelect, onRowClick, sortBy, sortDir, onSort }) {
  const cols = [
    { key: 'name', label: 'Name', sortable: true },
    { key: 'phone', label: 'Phone' },
    { key: 'state', label: 'State', sortable: true },
    { key: 'placed_status', label: 'Status' },
    { key: 'monthly_premium', label: 'Premium', sortable: true, align: 'right' },
    { key: 'application_date', label: 'Submitted', sortable: true },
    { key: 'sales_agent', label: 'Agent' },
    { key: 'last_seen_at', label: 'Last Call', sortable: true },
  ];

  const allSelected = rows.length > 0 && rows.every(r => selectedIds.has(r.id));

  return (
    <div style={{ background: C.card, borderRadius: 8, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'monospace', fontSize: 13 }}>
        <thead>
          <tr style={{ background: C.surface, borderBottom: `1px solid ${C.border}` }}>
            <th style={{ padding: '10px 12px', textAlign: 'left', width: 36 }}>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={e => rows.forEach(r => onToggleSelect(r.id, e.target.checked))}
              />
            </th>
            {cols.map(c => (
              <th
                key={c.key}
                onClick={() => c.sortable && onSort(c.key)}
                style={{
                  padding: '10px 12px',
                  textAlign: c.align ?? 'left',
                  color: C.muted,
                  textTransform: 'uppercase',
                  fontSize: 11,
                  cursor: c.sortable ? 'pointer' : 'default',
                  userSelect: 'none',
                }}
              >
                {c.label}{sortBy === c.key && (sortDir === 'asc' ? ' ↑' : ' ↓')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const name = `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim() || '(no name)';
            return (
              <tr
                key={r.id}
                onClick={() => onRowClick(r.id)}
                style={{ borderBottom: `1px solid ${C.border}`, cursor: 'pointer' }}
              >
                <td style={{ padding: '10px 12px' }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(r.id)}
                    onClick={e => e.stopPropagation()}
                    onChange={e => onToggleSelect(r.id, e.target.checked)}
                  />
                </td>
                <td style={{ padding: '10px 12px', color: C.text }}>{name}</td>
                <td style={{ padding: '10px 12px', color: C.muted }}>{r.phone}</td>
                <td style={{ padding: '10px 12px', color: C.text }}>{r.state ?? ''}</td>
                <td style={{ padding: '10px 12px', color: statusColor(r.placedStatus) }}>{r.placedStatus ?? '—'}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: C.text }}>
                  {r.monthlyPremium != null ? `$${Number(r.monthlyPremium).toFixed(2)}` : '—'}
                </td>
                <td style={{ padding: '10px 12px', color: C.muted }}>
                  {r.applicationDate ? new Date(r.applicationDate).toLocaleDateString() : '—'}
                </td>
                <td style={{ padding: '10px 12px', color: C.muted }}>{r.salesAgent ?? '—'}</td>
                <td style={{ padding: '10px 12px', color: C.muted }}>
                  {r.lastSeenAt ? new Date(r.lastSeenAt).toLocaleDateString() : '—'}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={cols.length + 1} style={{ padding: 32, textAlign: 'center', color: C.muted }}>
                No contacts match the current filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
