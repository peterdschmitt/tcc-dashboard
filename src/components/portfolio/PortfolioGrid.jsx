// src/components/portfolio/PortfolioGrid.jsx
'use client';
import { COLUMN_REGISTRY } from '@/lib/portfolio/column-registry';

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

function fmtValue(v, formatter) {
  if (v == null || v === '') return '—';
  switch (formatter) {
    case 'date':
      return new Date(v).toLocaleDateString();
    case 'datetime':
      return new Date(v).toLocaleString();
    case 'currency':
      return `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case 'integer':
      return Number(v).toLocaleString();
    case 'tags':
      if (!Array.isArray(v) || v.length === 0) return '—';
      return v.map((t, i) => (
        <span key={i} style={{ background: C.surface, color: C.muted, padding: '1px 6px', borderRadius: 8, fontSize: 10, marginRight: 4 }}>{t}</span>
      ));
    default:
      return String(v);
  }
}

export default function PortfolioGrid({ rows, columns, selectedIds, onToggleSelect, onRowClick, sortBy, sortDir, onSort }) {
  const cols = (columns ?? []).map(key => ({ key, ...COLUMN_REGISTRY[key] })).filter(c => c.label);
  const allSelected = rows.length > 0 && rows.every(r => selectedIds.has(r.id));

  return (
    <div style={{ background: C.card, borderRadius: 8, overflow: 'auto', maxWidth: '100%' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'monospace', fontSize: 13 }}>
        <thead>
          <tr style={{ background: C.surface, borderBottom: `1px solid ${C.border}` }}>
            <th style={{ padding: '10px 12px', textAlign: 'left', width: 36, position: 'sticky', left: 0, background: C.surface }}>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={e => rows.forEach(r => onToggleSelect(r.id, e.target.checked))}
              />
            </th>
            {cols.map(c => (
              <th
                key={c.key}
                onClick={() => onSort && onSort(c.key)}
                style={{
                  padding: '10px 12px',
                  textAlign: c.alignment ?? 'left',
                  color: C.muted,
                  textTransform: 'uppercase',
                  fontSize: 11,
                  cursor: onSort ? 'pointer' : 'default',
                  userSelect: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                {c.label}{sortBy === c.key && (sortDir === 'asc' ? ' ↑' : ' ↓')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr
              key={r.id}
              onClick={() => onRowClick(r.id)}
              style={{ borderBottom: `1px solid ${C.border}`, cursor: 'pointer' }}
            >
              <td style={{ padding: '10px 12px', position: 'sticky', left: 0, background: C.card }}>
                <input
                  type="checkbox"
                  checked={selectedIds.has(r.id)}
                  onClick={e => e.stopPropagation()}
                  onChange={e => onToggleSelect(r.id, e.target.checked)}
                />
              </td>
              {cols.map(c => {
                const v = r[c.key];
                const color = c.formatter === 'status_color' ? statusColor(v) : C.text;
                return (
                  <td key={c.key} style={{ padding: '10px 12px', textAlign: c.alignment ?? 'left', color, whiteSpace: 'nowrap' }}>
                    {c.formatter === 'status_color' ? (v ?? '—') : fmtValue(v, c.formatter)}
                  </td>
                );
              })}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={cols.length + 1} style={{ padding: 32, textAlign: 'center', color: C.muted }}>
                No contacts match the current view.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
