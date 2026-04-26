// src/components/portfolio/PortfolioGroupView.jsx
'use client';

const C = { card: '#131b28', border: '#1a2538', text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff' };

export default function PortfolioGroupView({ groups, onGroupClick }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
      {groups.map(g => (
        <div
          key={g.groupKey ?? '(blank)'}
          onClick={() => onGroupClick(g.groupKey)}
          style={{
            background: C.card, borderRadius: 6, padding: 16, cursor: 'pointer',
            border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.accent}`,
          }}
        >
          <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', marginBottom: 4 }}>
            {g.groupKey ?? '(no value)'}
          </div>
          <div style={{ color: C.text, fontSize: 24, fontWeight: 600 }}>{g.contactCount}</div>
          <div style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>
            contacts{g.totalPremium ? ` · $${Number(g.totalPremium).toFixed(2)}/mo total` : ''}
          </div>
        </div>
      ))}
      {groups.length === 0 && (
        <div style={{ color: C.muted, gridColumn: '1 / -1', textAlign: 'center', padding: 32 }}>
          No groups in current view.
        </div>
      )}
    </div>
  );
}
