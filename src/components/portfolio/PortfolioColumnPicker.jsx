// src/components/portfolio/PortfolioColumnPicker.jsx
'use client';
import { useState } from 'react';
import { COLUMN_REGISTRY, columnsByCategory } from '@/lib/portfolio/column-registry';

const C = { card: '#131b28', border: '#1a2538', text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff', red: '#f87171' };

export default function PortfolioColumnPicker({ selected, onChange }) {
  const [search, setSearch] = useState('');
  const [openCats, setOpenCats] = useState(() => new Set(['Contact', 'Latest Policy', 'Commission', 'Activity']));

  const selectedSet = new Set(selected);
  const groups = columnsByCategory();
  const q = search.toLowerCase().trim();

  const toggleSelect = (key) => {
    if (selectedSet.has(key)) onChange(selected.filter(k => k !== key));
    else onChange([...selected, key]);
  };
  const removeSelected = (key) => onChange(selected.filter(k => k !== key));
  const moveUp = (i) => {
    if (i === 0) return;
    const next = [...selected];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    onChange(next);
  };
  const moveDown = (i) => {
    if (i === selected.length - 1) return;
    const next = [...selected];
    [next[i + 1], next[i]] = [next[i], next[i + 1]];
    onChange(next);
  };
  const onDragStart = (e, idx) => { e.dataTransfer.setData('idx', String(idx)); };
  const onDrop = (e, idx) => {
    e.preventDefault();
    const from = parseInt(e.dataTransfer.getData('idx'), 10);
    if (isNaN(from) || from === idx) return;
    const next = [...selected];
    const [moved] = next.splice(from, 1);
    next.splice(idx, 0, moved);
    onChange(next);
  };

  const toggleCat = (cat) => {
    setOpenCats(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {/* Available */}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, padding: 8, maxHeight: 340, overflowY: 'auto' }}>
        <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', marginBottom: 6 }}>Available</div>
        <input
          type="text"
          placeholder="Search columns..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: '4px 8px', fontSize: 12, width: '100%', marginBottom: 6 }}
        />
        {groups.map(g => {
          const visible = g.columns.filter(c => !q || c.label.toLowerCase().includes(q));
          if (visible.length === 0) return null;
          const open = openCats.has(g.category) || !!q;
          return (
            <div key={g.category} style={{ marginBottom: 4 }}>
              <div onClick={() => toggleCat(g.category)} style={{ cursor: 'pointer', color: C.accent, fontSize: 11, textTransform: 'uppercase', padding: '4px 0' }}>
                {open ? '▾' : '▸'} {g.category} ({visible.length})
              </div>
              {open && visible.map(c => (
                <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0 2px 16px', cursor: 'pointer', fontSize: 12, color: selectedSet.has(c.key) ? C.muted : C.text }}>
                  <input
                    type="checkbox"
                    checked={selectedSet.has(c.key)}
                    onChange={() => toggleSelect(c.key)}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          );
        })}
      </div>
      {/* Selected */}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, padding: 8, maxHeight: 340, overflowY: 'auto' }}>
        <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', marginBottom: 6 }}>Selected ({selected.length})</div>
        {selected.length === 0 && (
          <div style={{ color: C.muted, fontSize: 12, padding: 8 }}>Pick at least one column from the left.</div>
        )}
        {selected.map((key, i) => {
          const col = COLUMN_REGISTRY[key];
          return (
            <div
              key={key}
              draggable
              onDragStart={e => onDragStart(e, i)}
              onDragOver={e => e.preventDefault()}
              onDrop={e => onDrop(e, i)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderBottom: `1px solid ${C.border}`, fontSize: 12, color: C.text }}
            >
              <span style={{ cursor: 'grab', color: C.muted }}>☰</span>
              <span style={{ flex: 1 }}>{col?.label ?? key}</span>
              <button onClick={() => moveUp(i)} disabled={i === 0} style={arrowBtnStyle}>↑</button>
              <button onClick={() => moveDown(i)} disabled={i === selected.length - 1} style={arrowBtnStyle}>↓</button>
              <button onClick={() => removeSelected(key)} style={{ ...arrowBtnStyle, color: C.red }}>×</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const arrowBtnStyle = {
  background: 'transparent', color: '#5b9fff', border: 'none', cursor: 'pointer',
  fontSize: 13, padding: '0 4px',
};
