// src/components/portfolio/PortfolioTab.jsx
'use client';
import { useEffect, useState, useCallback } from 'react';
import PortfolioFilterSidebar from './PortfolioFilterSidebar';
import PortfolioGrid from './PortfolioGrid';
import PortfolioGroupBySelector from './PortfolioGroupBySelector';
import PortfolioGroupView from './PortfolioGroupView';
import PortfolioBulkActionBar from './PortfolioBulkActionBar';
import PortfolioDetailPanel from './PortfolioDetailPanel';

const C = { bg: '#080b10', text: '#f0f3f9', muted: '#8fa3be', card: '#131b28', border: '#1a2538' };

export default function PortfolioTab() {
  const [smartList, setSmartList] = useState('all_submitted');
  const [search, setSearch] = useState('');
  const [groupBy, setGroupBy] = useState('none');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [sortBy, setSortBy] = useState('last_seen_at');
  const [sortDir, setSortDir] = useState('desc');

  const [data, setData] = useState({ rows: [], total: 0, groups: null });
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [openContactId, setOpenContactId] = useState(null);

  const filters = { smartList, search: search || undefined };

  const reload = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      filters: JSON.stringify(filters),
      page: String(page), pageSize: String(pageSize),
      sortBy, sortDir,
    });
    if (groupBy !== 'none') params.set('groupBy', groupBy);
    const res = await fetch(`/api/portfolio/contacts?${params}`);
    const json = await res.json();
    if (json.groups) setData({ groups: json.groups, rows: [], total: json.groups.length });
    else setData({ rows: json.rows ?? [], total: json.total ?? 0, groups: null });
    setLoading(false);
  }, [smartList, search, groupBy, page, pageSize, sortBy, sortDir]);

  useEffect(() => { reload(); }, [reload]);

  const toggleSelect = (id, on) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  };
  const toggleSort = (col) => {
    if (col === sortBy) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('desc'); }
  };

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 64px)', background: C.bg, color: C.text }}>
      <PortfolioFilterSidebar
        activeSmartList={smartList}
        onSmartListChange={(k) => { setSmartList(k); setPage(1); setSelectedIds(new Set()); }}
        totalCount={data.total}
      />

      <div style={{ flex: 1, padding: 16, overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
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
          <div style={{ marginLeft: 'auto', color: C.muted, fontSize: 12 }}>
            {loading ? 'Loading...' : ''}
          </div>
        </div>

        <PortfolioBulkActionBar
          selectedCount={selectedIds.size}
          filters={filters}
          onClearSelection={() => setSelectedIds(new Set())}
        />

        {data.groups ? (
          <PortfolioGroupView
            groups={data.groups}
            onGroupClick={(key) => {
              setGroupBy('none');
              setSearch(key ?? '');
              setPage(1);
            }}
          />
        ) : (
          <PortfolioGrid
            rows={data.rows}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onRowClick={setOpenContactId}
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={toggleSort}
          />
        )}

        {!data.groups && data.total > pageSize && (
          <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              disabled={page === 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              style={{ background: C.card, color: C.text, border: `1px solid ${C.border}`, padding: '6px 12px', borderRadius: 4, cursor: page === 1 ? 'default' : 'pointer' }}
            >
              ← Prev
            </button>
            <span style={{ color: C.muted, fontSize: 13 }}>
              Page {page} of {Math.ceil(data.total / pageSize)} · {data.total} total
            </span>
            <button
              disabled={page * pageSize >= data.total}
              onClick={() => setPage(p => p + 1)}
              style={{ background: C.card, color: C.text, border: `1px solid ${C.border}`, padding: '6px 12px', borderRadius: 4, cursor: page * pageSize >= data.total ? 'default' : 'pointer' }}
            >
              Next →
            </button>
          </div>
        )}
      </div>

      <PortfolioDetailPanel contactId={openContactId} onClose={() => setOpenContactId(null)} />
    </div>
  );
}
