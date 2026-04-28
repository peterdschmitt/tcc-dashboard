// src/components/portfolio/PortfolioFilterSidebar.jsx
'use client';
import { useEffect, useMemo, useState } from 'react';

const C = { bg: '#080b10', surface: '#0f1520', card: '#131b28', border: '#1a2538', text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff', red: '#f87171', green: '#4ade80', yellow: '#facc15', orange: '#fb923c' };

// Parent bucket order + accent colors (match Commission Tracker)
const BUCKET_ORDER = ['Performing', 'Unknown', 'Canceled', 'Declined'];
const BUCKET_COLOR = {
  Performing: C.green,
  Unknown: C.yellow,
  Canceled: C.red,
  Declined: C.orange,
};

function splitName(name) {
  const idx = name.indexOf(' — ');
  if (idx === -1) return { parent: null, child: name };
  return { parent: name.slice(0, idx), child: name.slice(idx + 3) };
}

export default function PortfolioFilterSidebar({ activeViewId, onSelect, onEdit, onDuplicate, totalCount, refreshKey }) {
  const [views, setViews] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [collapsedBuckets, setCollapsedBuckets] = useState(new Set());

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch('/api/portfolio/views').then(r => r.json()),
      fetch('/api/portfolio/views/counts').then(r => r.json()).catch(() => ({ counts: {} })),
    ]).then(([list, counts]) => {
      setViews(list.views ?? []);
      setCounts(counts.counts ?? {});
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [refreshKey]);

  const refreshList = () => {
    Promise.all([
      fetch('/api/portfolio/views').then(r => r.json()),
      fetch('/api/portfolio/views/counts').then(r => r.json()).catch(() => ({ counts: {} })),
    ]).then(([list, counts]) => {
      setViews(list.views ?? []);
      setCounts(counts.counts ?? {});
    });
  };

  // Close action menu on outside click / Escape
  useEffect(() => {
    if (openMenuId == null) return;
    const onDocClick = (e) => { if (!e.target.closest('[data-view-menu]')) setOpenMenuId(null); };
    const onKey = (e) => { if (e.key === 'Escape') setOpenMenuId(null); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMenuId]);

  // Group: { headlines: [view], buckets: { Performing: [view], ... }, userViews: [view] }
  const grouped = useMemo(() => {
    const headlines = [];
    const buckets = {};
    const userViews = [];
    for (const v of views) {
      const { parent } = splitName(v.name);
      if (parent && BUCKET_ORDER.includes(parent)) {
        if (!buckets[parent]) buckets[parent] = [];
        buckets[parent].push(v);
      } else if (v.isSystem) {
        headlines.push(v);
      } else {
        userViews.push(v);
      }
    }
    return { headlines, buckets, userViews };
  }, [views]);

  const togglePin = async (v) => {
    const full = await loadAndPatch(v.id, { pinned: !v.pinned });
    await fetch(`/api/portfolio/views/${v.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(full),
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

  const toggleBucket = (bucketName) => {
    setCollapsedBuckets(prev => {
      const next = new Set(prev);
      if (next.has(bucketName)) next.delete(bucketName); else next.add(bucketName);
      return next;
    });
  };

  return (
    <div style={{ width: 260, background: C.surface, borderRight: `1px solid ${C.border}`, padding: 16, height: '100%', overflowY: 'auto' }}>
      <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', marginBottom: 8, letterSpacing: 0.5 }}>Smart Views</div>
      {loading && <div style={{ color: C.muted, fontSize: 12 }}>Loading...</div>}

      {/* Top: headline views (the 6 originals — no prefix) */}
      {grouped.headlines.map(v => renderViewRow(v, { activeViewId, onSelect, onEdit, onDuplicate, openMenuId, setOpenMenuId, togglePin, remove, reset, count: counts[v.id], indent: 0 }))}

      {/* Bucket groups */}
      {BUCKET_ORDER.map(bucketName => {
        const children = grouped.buckets[bucketName] ?? [];
        if (children.length === 0) return null;
        const collapsed = collapsedBuckets.has(bucketName);
        // Parent count = sum of child counts (skip nulls)
        const parentCount = children.reduce((s, v) => s + (counts[v.id] ?? 0), 0);
        const color = BUCKET_COLOR[bucketName] ?? C.muted;
        return (
          <div key={bucketName} style={{ marginTop: 12 }}>
            <div
              onClick={() => toggleBucket(bucketName)}
              style={{
                cursor: 'pointer', padding: '6px 8px',
                display: 'flex', alignItems: 'center', gap: 6,
                color, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
                borderBottom: `1px solid ${C.border}`,
              }}
            >
              <span style={{ width: 10, color: C.muted }}>{collapsed ? '▸' : '▾'}</span>
              <span style={{ flex: 1 }}>{bucketName}</span>
              <span style={{ color: C.muted, fontWeight: 500 }}>{parentCount.toLocaleString()}</span>
            </div>
            {!collapsed && children
              .slice()
              .sort((a, b) => splitName(a.name).child.localeCompare(splitName(b.name).child))
              .map(v => renderViewRow(v, { activeViewId, onSelect, onEdit, onDuplicate, openMenuId, setOpenMenuId, togglePin, remove, reset, count: counts[v.id], indent: 16, displayName: splitName(v.name).child }))}
          </div>
        );
      })}

      {/* User-created views */}
      {grouped.userViews.length > 0 && (
        <>
          <div style={{ marginTop: 16, color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, padding: '4px 8px', borderBottom: `1px solid ${C.border}` }}>My Views</div>
          {grouped.userViews.map(v => renderViewRow(v, { activeViewId, onSelect, onEdit, onDuplicate, openMenuId, setOpenMenuId, togglePin, remove, reset, count: counts[v.id], indent: 0 }))}
        </>
      )}

      <div style={{ marginTop: 24, color: C.muted, fontSize: 11 }}>
        {totalCount != null && `${totalCount.toLocaleString()} matching`}
      </div>
    </div>
  );
}

function renderViewRow(v, { activeViewId, onSelect, onEdit, onDuplicate, openMenuId, setOpenMenuId, togglePin, remove, reset, count, indent = 0, displayName }) {
  const active = activeViewId === v.id;
  const label = displayName ?? v.name;
  return (
    <div
      key={v.id}
      style={{
        padding: `6px ${8}px 6px ${8 + indent}px`,
        borderRadius: 4,
        color: active ? C.text : C.muted,
        background: active ? C.card : 'transparent',
        borderLeft: active ? `3px solid ${C.accent}` : '3px solid transparent',
        marginBottom: 1,
        fontSize: 12,
        display: 'flex', alignItems: 'center', gap: 6,
        position: 'relative',
      }}
    >
      <span onClick={() => onSelect(v.id)} style={{ flex: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden' }}>
        {v.pinned && <span style={{ flexShrink: 0 }}>📌</span>}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        {v.isSystem && <span style={{ color: C.accent, fontSize: 9, flexShrink: 0 }}>★</span>}
      </span>
      {count != null && (
        <span style={{ color: C.muted, fontSize: 11, fontFamily: 'monospace', flexShrink: 0 }}>{count.toLocaleString()}</span>
      )}
      <button
        data-view-menu
        onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === v.id ? null : v.id); }}
        style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', padding: '0 4px', flexShrink: 0 }}
        title="View actions"
      >⋮</button>
      {openMenuId === v.id && (
        <div data-view-menu style={{ position: 'absolute', right: 0, top: 24, background: C.card, border: `1px solid ${C.border}`, borderRadius: 4, zIndex: 30, minWidth: 140 }}>
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
