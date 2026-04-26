// src/components/portfolio/PortfolioGroupBySelector.jsx
'use client';

const C = { surface: '#0f1520', card: '#131b28', border: '#1a2538', text: '#f0f3f9', muted: '#8fa3be' };

const OPTIONS = [
  { value: 'none', label: 'No Grouping' },
  { value: 'placed_status', label: 'By Status' },
  { value: 'carrier', label: 'By Carrier' },
  { value: 'agent', label: 'By Agent' },
  { value: 'campaign', label: 'By Lead Source' },
  { value: 'state', label: 'By State' },
  { value: 'month', label: 'By Submission Month' },
];

export default function PortfolioGroupBySelector({ value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <label style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase' }}>Group by:</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          background: C.card, color: C.text, border: `1px solid ${C.border}`,
          borderRadius: 4, padding: '4px 8px', fontSize: 13,
        }}
      >
        {OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
