// src/components/portfolio/PortfolioFilterSidebar.jsx
'use client';

const C = { bg: '#080b10', surface: '#0f1520', card: '#131b28', border: '#1a2538', text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff' };

const SMART_LISTS = [
  { key: null, label: 'All Contacts' },
  { key: 'all_submitted', label: 'All Submitted Apps' },
  { key: 'pending', label: 'Pending Applications' },
  { key: 'active_policies', label: 'Active Policies' },
  { key: 'recently_lapsed', label: 'Recently Lapsed' },
  { key: 'declined', label: 'Declined' },
  { key: 'high_value', label: 'High-Value Active' },
];

export default function PortfolioFilterSidebar({ activeSmartList, onSmartListChange, totalCount }) {
  return (
    <div style={{ width: 240, background: C.surface, borderRight: `1px solid ${C.border}`, padding: 16, height: '100%' }}>
      <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', marginBottom: 8 }}>Smart Lists</div>
      {SMART_LISTS.map(sl => {
        const active = activeSmartList === sl.key;
        return (
          <div
            key={sl.key ?? 'all'}
            onClick={() => onSmartListChange(sl.key)}
            style={{
              padding: '8px 12px',
              borderRadius: 6,
              cursor: 'pointer',
              color: active ? C.text : C.muted,
              background: active ? C.card : 'transparent',
              borderLeft: active ? `3px solid ${C.accent}` : '3px solid transparent',
              marginBottom: 2,
              fontSize: 13,
            }}
          >
            {sl.label}
          </div>
        );
      })}
      <div style={{ marginTop: 24, color: C.muted, fontSize: 11 }}>
        {totalCount != null && `${totalCount.toLocaleString()} matching`}
      </div>
    </div>
  );
}
