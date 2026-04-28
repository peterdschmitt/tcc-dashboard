// src/components/portfolio/PortfolioTab.jsx
'use client';
import { useEffect, useState, useCallback } from 'react';
import PortfolioFilterSidebar from './PortfolioFilterSidebar';
import PortfolioGrid from './PortfolioGrid';
import PortfolioGroupBySelector from './PortfolioGroupBySelector';
import PortfolioGroupView from './PortfolioGroupView';
import PortfolioBulkActionBar from './PortfolioBulkActionBar';
import PortfolioDetailPanel from './PortfolioDetailPanel';
import PortfolioSaveViewPopover from './PortfolioSaveViewPopover';
import PortfolioViewEditor from './PortfolioViewEditor';

const C = { bg: '#080b10', text: '#f0f3f9', muted: '#8fa3be', card: '#131b28', border: '#1a2538', accent: '#5b9fff' };

export default function PortfolioTab() {
  const [activeViewId, setActiveViewId] = useState(null);
  const [search, setSearch] = useState('');
  const [groupBy, setGroupBy] = useState('none');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);

  const [data, setData] = useState({ rows: [], total: 0, columns: [], groups: null });
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [openContactId, setOpenContactId] = useState(null);
  const [showSavePopover, setShowSavePopover] = useState(false);
  const [editorViewId, setEditorViewId] = useState(null);
  const [sidebarRefresh, setSidebarRefresh] = useState(0);

  // On first load (or after a view delete leaves activeViewId stale), pick the first view in the sidebar list
  useEffect(() => {
    if (activeViewId) return;
    fetch('/api/portfolio/views').then(r => r.json()).then(d => {
      if (d.views?.length) setActiveViewId(d.views[0].id);
    });
  }, [activeViewId]);

  const reload = useCallback(async () => {
    if (!activeViewId) return;
    setLoading(true);
    const params = new URLSearchParams({
      viewId: String(activeViewId),
      page: String(page),
      pageSize: String(pageSize),
    });
    const res = await fetch(`/api/portfolio/contacts?${params}`);
    const json = await res.json();
    setData({
      rows: json.rows ?? [],
      total: json.total ?? 0,
      columns: json.columns ?? [],
      groups: null,
    });
    setLoading(false);
  }, [activeViewId, page, pageSize]);

  useEffect(() => { reload(); }, [reload]);

  const toggleSelect = (id, on) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  };

  const onViewSaved = (id) => {
    setEditorViewId(null);
    setShowSavePopover(false);
    setSidebarRefresh(x => x + 1);
    setActiveViewId(id);
  };

  const onDuplicate = async (id) => {
    const r = await fetch(`/api/portfolio/views/${id}`);
    const { view } = await r.json();
    const r2 = await fetch('/api/portfolio/views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${view.name} (copy)`,
        description: view.description,
        filters_json: view.filtersJson,
        raw_where: view.rawWhere,
        columns: view.columns,
        sort_by: view.sortBy,
        sort_dir: view.sortDir,
        group_by: view.groupBy,
        pinned: false,
      }),
    });
    const j = await r2.json();
    if (r2.ok) { setSidebarRefresh(x => x + 1); setEditorViewId(j.id); }
    else alert(j.error);
  };

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 64px)', background: C.bg, color: C.text }}>
      <PortfolioFilterSidebar
        activeViewId={activeViewId}
        onSelect={(id) => { setActiveViewId(id); setPage(1); setSelectedIds(new Set()); }}
        onEdit={(id) => setEditorViewId(id)}
        onDuplicate={onDuplicate}
        totalCount={data.total}
        refreshKey={sidebarRefresh}
      />

      <div style={{ flex: 1, padding: 16, overflow: 'auto', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, position: 'relative' }}>
          <input
            type="text"
            placeholder="Search by name or phone..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              background: C.card, color: C.text, border: `1px solid ${C.border}`,
              borderRadius: 4, padding: '6px 10px', fontSize: 13, flex: 1, maxWidth: 320,
            }}
          />
          <PortfolioGroupBySelector value={groupBy} onChange={(g) => { setGroupBy(g); setPage(1); }} />
          <button
            onClick={() => setShowSavePopover(true)}
            style={{ background: C.accent, color: C.bg, border: 'none', padding: '6px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
          >
            + Save view
          </button>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ color: C.muted, fontSize: 12 }}>{loading ? 'Loading...' : ''}</span>
            <ExportMenu activeViewId={activeViewId} />
          </div>
          {showSavePopover && (
            <PortfolioSaveViewPopover
              currentState={{
                filters_json: { op: 'AND', rules: [] },
                columns: data.columns,
                sort_by: null,
                sort_dir: 'desc',
                group_by: groupBy,
              }}
              onSaved={onViewSaved}
              onCancel={() => setShowSavePopover(false)}
            />
          )}
        </div>

        <PortfolioBulkActionBar
          selectedCount={selectedIds.size}
          filters={{}}
          onClearSelection={() => setSelectedIds(new Set())}
        />

        <PortfolioGrid
          rows={data.rows}
          columns={data.columns}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onRowClick={setOpenContactId}
        />

        {data.total > pageSize && (
          <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
            <button disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))} style={pagBtn(page === 1)}>← Prev</button>
            <span style={{ color: C.muted, fontSize: 13 }}>
              Page {page} of {Math.ceil(data.total / pageSize)} · {data.total} total
            </span>
            <button disabled={page * pageSize >= data.total} onClick={() => setPage(p => p + 1)} style={pagBtn(page * pageSize >= data.total)}>Next →</button>
          </div>
        )}
      </div>

      <PortfolioDetailPanel contactId={openContactId} onClose={() => setOpenContactId(null)} />
      <PortfolioViewEditor viewId={editorViewId} onClose={() => setEditorViewId(null)} onSaved={onViewSaved} />
    </div>
  );
}

const pagBtn = (disabled) => ({
  background: '#131b28', color: '#f0f3f9', border: '1px solid #1a2538',
  padding: '6px 12px', borderRadius: 4, cursor: disabled ? 'default' : 'pointer',
});

const FORMATS = [
  { id: 'csv',    label: 'CSV',                     ext: '.csv',   note: 'comma-separated, opens in Excel/Sheets' },
  { id: 'xlsx',   label: 'Excel (.xlsx)',           ext: '.xlsx',  note: 'native Excel workbook' },
  { id: 'json',   label: 'JSON',                    ext: '.json',  note: 'raw API rows + view metadata' },
  { id: 'dialer', label: 'Dialer CSV (ChaseData)',  ext: '.csv',   note: 'phone, first/last name, state' },
];

function ExportMenu({ activeViewId }) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(null);

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (!e.target.closest('[data-export-menu]')) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const doExport = async (format) => {
    if (!activeViewId) return;
    setExporting(format);
    try {
      const url = `/api/portfolio/export-view?viewId=${activeViewId}&format=${format}`;
      // Trigger browser download by temporarily creating an anchor
      const a = document.createElement('a');
      a.href = url;
      a.download = ''; // server's Content-Disposition supplies the filename
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      setTimeout(() => setExporting(null), 600);
      setOpen(false);
    }
  };

  const C = { card: '#131b28', surface: '#0f1520', border: '#1a2538', text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff' };

  return (
    <div data-export-menu style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        disabled={!activeViewId}
        style={{
          background: 'transparent', color: activeViewId ? C.text : C.muted,
          border: `1px solid ${C.border}`, padding: '6px 12px', borderRadius: 4,
          cursor: activeViewId ? 'pointer' : 'default', fontSize: 12, fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: 6,
        }}
      >
        ⬇ Export <span style={{ fontSize: 9, opacity: 0.6 }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 32, right: 0, zIndex: 50,
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6,
          minWidth: 260, boxShadow: '0 4px 12px rgba(0,0,0,0.5)', overflow: 'hidden',
        }}>
          <div style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, padding: '8px 12px 4px' }}>Export current view</div>
          {FORMATS.map(f => (
            <div
              key={f.id}
              onClick={() => doExport(f.id)}
              style={{
                padding: '8px 12px', cursor: 'pointer', fontSize: 12, color: C.text,
                borderTop: `1px solid ${C.border}`,
                opacity: exporting === f.id ? 0.5 : 1,
              }}
              onMouseEnter={e => e.currentTarget.style.background = C.card}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{ fontWeight: 600 }}>{f.label} {exporting === f.id ? '…' : ''}</div>
              <div style={{ color: C.muted, fontSize: 11, marginTop: 1 }}>{f.note}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
