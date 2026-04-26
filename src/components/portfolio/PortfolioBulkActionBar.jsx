// src/components/portfolio/PortfolioBulkActionBar.jsx
'use client';

const C = { bg: '#080b10', surface: '#0f1520', card: '#131b28', border: '#1a2538', text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff' };

export default function PortfolioBulkActionBar({ selectedCount, filters, onClearSelection }) {
  if (selectedCount === 0) return null;
  const filtersParam = encodeURIComponent(JSON.stringify(filters));
  const exportUrl = `/api/portfolio/export?filters=${filtersParam}`;
  const dialerUrl = `/api/portfolio/dialer-export?filters=${filtersParam}`;
  return (
    <div style={{
      background: C.accent, color: C.bg, padding: '10px 16px', borderRadius: 6,
      display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12, fontSize: 13,
    }}>
      <span style={{ fontWeight: 600 }}>{selectedCount} selected</span>
      <a href={exportUrl} download style={{ color: C.bg, textDecoration: 'underline', fontWeight: 500 }}>
        Export CSV
      </a>
      <a href={dialerUrl} download style={{ color: C.bg, textDecoration: 'underline', fontWeight: 500 }}>
        Push to Dialer (CSV)
      </a>
      <span style={{ color: C.bg, opacity: 0.5, fontSize: 11 }}>
        Trigger Workflow (V2)
      </span>
      <button
        onClick={onClearSelection}
        style={{
          marginLeft: 'auto', background: 'transparent', color: C.bg,
          border: `1px solid ${C.bg}`, padding: '4px 10px', borderRadius: 4,
          cursor: 'pointer', fontSize: 12,
        }}
      >
        Clear
      </button>
    </div>
  );
}
