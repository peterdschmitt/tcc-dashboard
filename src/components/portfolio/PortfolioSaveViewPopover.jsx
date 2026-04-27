// src/components/portfolio/PortfolioSaveViewPopover.jsx
'use client';
import { useState } from 'react';

const C = { card: '#131b28', surface: '#0f1520', border: '#1a2538', text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff' };

export default function PortfolioSaveViewPopover({ currentState, onSaved, onCancel }) {
  const [name, setName] = useState('');
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    setSaving(true); setError(null);
    try {
      const r = await fetch('/api/portfolio/views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          ...currentState,
          pinned,
        }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? 'Save failed');
      onSaved(json.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'absolute', top: 36, right: 0, background: C.surface,
      border: `1px solid ${C.border}`, borderRadius: 6, padding: 12, zIndex: 50,
      width: 280, boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
    }}>
      <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', marginBottom: 6 }}>Save current view</div>
      <input
        type="text"
        placeholder="View name"
        value={name}
        onChange={e => setName(e.target.value)}
        autoFocus
        style={{ width: '100%', background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: '6px 10px', fontSize: 13 }}
      />
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12, color: C.text }}>
        <input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} />
        Pin to top of sidebar
      </label>
      {error && <div style={{ color: '#f87171', fontSize: 12, marginTop: 6 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 6, marginTop: 10, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={{ ...btnStyle, background: 'transparent', border: `1px solid ${C.border}`, color: C.text }}>Cancel</button>
        <button onClick={submit} disabled={saving || !name.trim()} style={{ ...btnStyle, background: C.accent, color: C.surface }}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}

const btnStyle = {
  padding: '6px 12px', borderRadius: 4, border: 'none', cursor: 'pointer',
  fontSize: 12, fontWeight: 600,
};
