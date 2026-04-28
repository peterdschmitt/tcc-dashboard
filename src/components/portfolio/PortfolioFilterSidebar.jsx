// src/components/portfolio/PortfolioFilterSidebar.jsx
'use client';
import { useEffect, useState } from 'react';

const C = { bg: '#080b10', surface: '#0f1520', card: '#131b28', border: '#1a2538', text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff', red: '#f87171' };

export default function PortfolioFilterSidebar({ activeViewId, onSelect, onEdit, onDuplicate, totalCount, refreshKey }) {
  const [views, setViews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openMenuId, setOpenMenuId] = useState(null);

  useEffect(() => {
    setLoading(true);
    fetch('/api/portfolio/views')
      .then(r => r.json())
      .then(d => { setViews(d.views ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [refreshKey]);

  // Close the action menu on any outside click / Escape press
  useEffect(() => {
    if (openMenuId == null) return;
    const onDocClick = (e) => {
      if (!e.target.closest('[data-view-menu]')) setOpenMenuId(null);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpenMenuId(null); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMenuId]);

  const refreshList = () => {
    fetch('/api/portfolio/views').then(r => r.json()).then(d => setViews(d.views ?? []));
  };

  const togglePin = async (v) => {
    const full = await loadAndPatch(v.id, { pinned: !v.pinned });
    await fetch(`/api/portfolio/views/${v.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(full),
    });
    setOpenMenuId(null);
    refreshList();
  };
  const remove = async (v) => {
    if (!confirm(`Delete the view "${v.name}"?`)) return;
    const r = await fetch(`/api/portfolio/views/${v.id}`, { method: 'DELETE' });
    if (r.ok) refreshList();
    else { const j = await r.json(); alert(j.error); }
    setOpenMenuId(null);
  };
  const reset = async (v) => {
    if (!confirm(`Reset "${v.name}" to its default settings?`)) return;
    const r = await fetch(`/api/portfolio/views/${v.id}/reset`, { method: 'POST' });
    if (r.ok) refreshList();
    else { const j = await r.json(); alert(j.error); }
    setOpenMenuId(null);
  };

  return (
    <div style={{ width: 240, background: C.surface, borderRight: `1px solid ${C.border}`, padding: 16, height: '100%', overflowY: 'auto' }}>
      <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', marginBottom: 8 }}>Smart Views</div>
      {loading && <div style={{ color: C.muted, fontSize: 12 }}>Loading...</div>}
      {views.map(v => {
        const active = activeViewId === v.id;
        return (
          <div
            key={v.id}
            style={{
              padding: '8px 12px',
              borderRadius: 6,
              color: active ? C.text : C.muted,
              background: active ? C.card : 'transparent',
              borderLeft: active ? `3px solid ${C.accent}` : '3px solid transparent',
              marginBottom: 2,
              fontSize: 13,
              display: 'flex', alignItems: 'center', gap: 6,
              position: 'relative',
            }}
          >
            <span onClick={() => onSelect(v.id)} style={{ flex: 1, cursor: 'pointer' }}>
              {v.pinned && '📌 '}
              {v.name}
              {v.isSystem && <span style={{ color: C.accent, fontSize: 10, marginLeft: 4 }}>★</span>}
            </span>
            <button
              data-view-menu
              onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === v.id ? null : v.id); }}
              style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer' }}
              title="View actions"
            >⋮</button>
            {openMenuId === v.id && (
              <div data-view-menu style={{ position: 'absolute', right: 0, top: 30, background: C.card, border: `1px solid ${C.border}`, borderRadius: 4, zIndex: 30, minWidth: 140 }}>
                <MenuItem onClick={() => { onEdit(v.id); setOpenMenuId(null); }}>Edit</MenuItem>
                <MenuItem onClick={() => { onDuplicate(v.id); setOpenMenuId(null); }}>Duplicate</MenuItem>
                <MenuItem onClick={() => togglePin(v)}>{v.pinned ? 'Unpin' : 'Pin'}</MenuItem>
                {v.isSystem
                  ? <MenuItem onClick={() => reset(v)}>Reset to defaults</MenuItem>
                  : <MenuItem onClick={() => remove(v)} danger>Delete</MenuItem>}
              </div>
            )}
          </div>
        );
      })}
      <div style={{ marginTop: 24, color: C.muted, fontSize: 11 }}>
        {totalCount != null && `${totalCount.toLocaleString()} matching`}
      </div>
    </div>
  );
}

function MenuItem({ children, onClick, danger }) {
  return (
    <div onClick={onClick} style={{
      padding: '6px 10px', cursor: 'pointer', fontSize: 12,
      color: danger ? '#f87171' : '#f0f3f9',
      borderBottom: '1px solid #1a2538',
    }}>{children}</div>
  );
}

async function loadAndPatch(id, patch) {
  const r = await fetch(`/api/portfolio/views/${id}`);
  const { view } = await r.json();
  return {
    name: view.name, description: view.description,
    filters_json: view.filtersJson, raw_where: view.rawWhere,
    columns: view.columns, sort_by: view.sortBy, sort_dir: view.sortDir,
    group_by: view.groupBy, pinned: view.pinned,
    ...patch,
  };
}
