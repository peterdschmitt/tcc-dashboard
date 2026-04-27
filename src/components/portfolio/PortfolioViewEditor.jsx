// src/components/portfolio/PortfolioViewEditor.jsx
'use client';
import { useEffect, useState } from 'react';
import PortfolioFilterBuilder from './PortfolioFilterBuilder';
import PortfolioColumnPicker from './PortfolioColumnPicker';
import { COLUMN_REGISTRY } from '@/lib/portfolio/column-registry';

const C = { surface: '#0f1520', card: '#131b28', border: '#1a2538', text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff', red: '#f87171' };

const GROUP_BYS = ['none', 'state', 'placed_status', 'agent', 'campaign', 'month', 'carrier'];

export default function PortfolioViewEditor({ viewId, onClose, onSaved }) {
  const [view, setView] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [filterMode, setFilterMode] = useState('visual');

  useEffect(() => {
    if (!viewId) return;
    setLoading(true);
    fetch(`/api/portfolio/views/${viewId}`)
      .then(r => r.json())
      .then(d => {
        setView(d.view);
        setFilterMode(d.view.rawWhere ? 'raw' : 'visual');
        setLoading(false);
      });
  }, [viewId]);

  if (!viewId) return null;

  const update = (patch) => setView(v => ({ ...v, ...patch }));
  const submit = async () => {
    setSaving(true); setError(null);
    try {
      const payload = {
        name: view.name,
        description: view.description,
        columns: view.columns,
        sort_by: view.sortBy,
        sort_dir: view.sortDir,
        group_by: view.groupBy,
        pinned: view.pinned,
        ...(filterMode === 'raw'
          ? { raw_where: view.rawWhere, filters_json: null }
          : { filters_json: view.filtersJson, raw_where: null }),
      };
      const r = await fetch(`/api/portfolio/views/${viewId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? 'Save failed');
      onSaved(viewId);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };
  const reset = async () => {
    if (!confirm('Reset this system view to its default settings? Your edits will be lost.')) return;
    const r = await fetch(`/api/portfolio/views/${viewId}/reset`, { method: 'POST' });
    if (r.ok) onSaved(viewId);
    else { const j = await r.json(); setError(j.error); }
  };

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, height: '100vh', width: 560, background: C.surface,
      borderLeft: `1px solid ${C.border}`, padding: 24, overflowY: 'auto', zIndex: 100, color: C.text,
      boxShadow: '-4px 0 24px rgba(0,0,0,0.5)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase' }}>
          Edit View {view?.isSystem ? '(system)' : ''}
        </div>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 18 }}>✕</button>
      </div>

      {loading && <div style={{ color: C.muted }}>Loading...</div>}
      {view && (
        <>
          <label style={fieldStyle}>
            <span style={labelStyle}>Name</span>
            <input value={view.name} onChange={e => update({ name: e.target.value })} style={inputStyle} />
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Description</span>
            <input value={view.description ?? ''} onChange={e => update({ description: e.target.value })} style={inputStyle} />
          </label>

          <div style={sectionStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <span style={{ ...labelStyle, marginBottom: 0 }}>Filters</span>
              <label style={{ fontSize: 12, color: C.text }}>
                <input type="radio" checked={filterMode === 'visual'} onChange={() => setFilterMode('visual')} /> Visual builder
              </label>
              <label style={{ fontSize: 12, color: C.text }}>
                <input type="radio" checked={filterMode === 'raw'} onChange={() => setFilterMode('raw')} /> Raw SQL
              </label>
            </div>
            {filterMode === 'visual' ? (
              <PortfolioFilterBuilder
                tree={view.filtersJson ?? { op: 'AND', rules: [] }}
                onChange={t => update({ filtersJson: t, rawWhere: null })}
              />
            ) : (
              <>
                <textarea
                  value={view.rawWhere ?? ''}
                  onChange={e => update({ rawWhere: e.target.value, filtersJson: null })}
                  rows={4}
                  placeholder="e.g. monthly_premium > 100 AND state IN ('CA', 'TX')"
                  style={{ ...inputStyle, fontFamily: 'monospace', minHeight: 80 }}
                />
                <div style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>
                  Rules: no semicolons, no comments, no DDL/DML keywords. Runs against a read-only DB role.
                </div>
              </>
            )}
          </div>

          <div style={sectionStyle}>
            <span style={labelStyle}>Columns</span>
            <PortfolioColumnPicker selected={view.columns ?? []} onChange={cols => update({ columns: cols })} />
          </div>

          <div style={sectionStyle}>
            <span style={labelStyle}>Default sort</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <select value={view.sortBy ?? ''} onChange={e => update({ sortBy: e.target.value || null })} style={inputStyle}>
                <option value="">(none)</option>
                {Object.entries(COLUMN_REGISTRY).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
              </select>
              <select value={view.sortDir} onChange={e => update({ sortDir: e.target.value })} style={inputStyle}>
                <option value="desc">Desc</option>
                <option value="asc">Asc</option>
              </select>
            </div>
          </div>

          <div style={sectionStyle}>
            <span style={labelStyle}>Default grouping</span>
            <select value={view.groupBy} onChange={e => update({ groupBy: e.target.value })} style={inputStyle}>
              {GROUP_BYS.map(g => <option key={g} value={g}>{g === 'none' ? 'No grouping' : `By ${g}`}</option>)}
            </select>
          </div>

          {error && <div style={{ color: C.red, fontSize: 12, marginTop: 8 }}>{error}</div>}

          <div style={{ display: 'flex', gap: 6, marginTop: 16, justifyContent: 'flex-end' }}>
            {view.isSystem && (
              <button onClick={reset} style={{ ...btnStyle, background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, marginRight: 'auto' }}>
                Reset to defaults
              </button>
            )}
            <button onClick={onClose} style={{ ...btnStyle, background: 'transparent', border: `1px solid ${C.border}`, color: C.text }}>Cancel</button>
            <button onClick={submit} disabled={saving} style={{ ...btnStyle, background: C.accent, color: C.surface }}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const fieldStyle = { display: 'block', marginBottom: 12 };
const labelStyle = { color: C.muted, fontSize: 11, textTransform: 'uppercase', marginBottom: 4, display: 'block', letterSpacing: 0.3 };
const sectionStyle = { marginBottom: 16, paddingTop: 12, borderTop: `1px solid ${C.border}` };
const inputStyle = { width: '100%', background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: '6px 10px', fontSize: 13, fontFamily: 'inherit' };
const btnStyle = { padding: '6px 14px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600 };
