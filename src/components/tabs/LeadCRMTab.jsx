'use client';
import { useState, useEffect, useMemo } from 'react';
import { C, fmt, fmtPct, fmtDollar, STATUS_COLORS } from '../shared/theme';
import LeadDetailModal from '../crm/LeadDetailModal';

// ─── Status color mapping for Call Status values ─────────
const STATUS_CLR = {
  CONVERTED: C.green,
  SALE: C.green,
  CALLBACK: C.yellow,
  DNC: C.red,
  DEAD: '#666',
  DROP: '#666',
  'NO ANSWER': C.muted,
  VOICEMAIL: C.muted,
  BUSY: C.muted,
  HANGUP: C.red,
  UNKNOWN: '#555',
};
function statusColor(s) { return STATUS_CLR[s?.toUpperCase()] || C.accent; }

// ─── Shared Components ─────────────────────────────────

function KPICard({ label, value, color }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '16px 20px', flex: '1 1 0', minWidth: 130, borderTop: `3px solid ${color || C.accent}` }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: color || C.accent, fontFamily: C.mono, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }) {
  const clr = statusColor(status);
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
      background: clr + '22', color: clr,
    }}>{status || '—'}</span>
  );
}

function SortableTable({ columns, rows, defaultSort, onRowClick, totalsRow }) {
  const [sortCol, setSortCol] = useState(defaultSort || null);
  const [sortDir, setSortDir] = useState('desc');
  const sorted = useMemo(() => {
    if (!sortCol) return rows;
    return [...rows].sort((a, b) => {
      let av = a[sortCol], bv = b[sortCol];
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [rows, sortCol, sortDir]);
  const toggleSort = col => { if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortCol(col); setSortDir('desc'); } };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          {columns.map(col => (
            <th key={col.key} onClick={() => col.sortable !== false && toggleSort(col.key)} style={{
              padding: '10px 12px', textAlign: col.align || 'right', fontSize: 9, fontWeight: 700, color: C.muted,
              textTransform: 'uppercase', letterSpacing: 1, borderBottom: `2px solid ${C.border}`, background: C.surface,
              whiteSpace: 'nowrap', cursor: col.sortable !== false ? 'pointer' : 'default',
              ...(col.key === sortCol ? { color: C.accent } : {}),
            }}>{col.label} {col.key === sortCol ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
          ))}
        </tr></thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={row._key || i} onClick={() => onRowClick && onRowClick(row)}
              onMouseEnter={e => e.currentTarget.style.background = '#151f30'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              style={{ cursor: onRowClick ? 'pointer' : 'default' }}>
              {columns.map(col => (
                <td key={col.key} style={{
                  padding: '10px 12px', textAlign: col.align || 'right', fontSize: 12,
                  color: col.color ? col.color(row[col.key], row) : C.text, fontFamily: col.mono ? C.mono : 'inherit',
                  borderBottom: `1px solid ${C.border}`,
                }}>{col.render ? col.render(row[col.key], row) : (row[col.key] ?? '—')}</td>
              ))}
            </tr>
          ))}
          {totalsRow && (
            <tr style={{ background: C.surface, fontWeight: 700 }}>
              {columns.map(col => (
                <td key={col.key} style={{
                  padding: '10px 12px', textAlign: col.align || 'right', fontSize: 12,
                  color: C.accent, fontFamily: col.mono ? C.mono : 'inherit',
                  borderBottom: `2px solid ${C.border}`, borderTop: `1px solid ${C.border}`,
                }}>{totalsRow[col.key] ?? ''}</td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Section({ title, children, subtitle }) {
  return (
    <div style={{ marginTop: 20, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1.2 }}>{title}</div>
        {subtitle && <span style={{ fontSize: 10, color: C.muted }}>{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

// ─── Pipeline Summary Table (transposed: dispositions as rows, agents/campaigns as columns) ─────

function PipelineTable({ data, statuses, groupLabel }) {
  // data = { groupName: { _total: { status: count }, _leads: N, _premium: N, _cost: N, ... }, ... }
  if (!data || Object.keys(data).length === 0) return <div style={{ color: C.muted, padding: 20, textAlign: 'center', fontSize: 11 }}>No data</div>;

  // Get group names sorted by total leads desc
  const groups = Object.entries(data).sort((a, b) => b[1]._leads - a[1]._leads).map(([name]) => name);

  // Build table: rows = dispositions, columns = agents/campaigns
  const thStyle = (highlight) => ({
    padding: '8px 10px', textAlign: 'right', fontSize: 9, fontWeight: 700, color: highlight ? C.accent : C.muted,
    textTransform: 'uppercase', letterSpacing: 0.8, borderBottom: `2px solid ${C.border}`, background: C.surface,
    whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 1,
  });
  const tdStyle = { padding: '8px 10px', textAlign: 'right', fontSize: 12, fontFamily: C.mono, borderBottom: `1px solid ${C.border}` };

  // Compute column totals
  const colTotals = {};
  groups.forEach(g => { colTotals[g] = data[g]._leads; });

  // Compute row totals per status
  const rowTotals = {};
  statuses.forEach(s => {
    rowTotals[s] = groups.reduce((sum, g) => sum + (data[g]._total?.[s] || 0), 0);
  });
  const grandTotal = groups.reduce((sum, g) => sum + (data[g]._leads || 0), 0);

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...thStyle(), textAlign: 'left', minWidth: 120 }}>Disposition</th>
            {groups.map(g => (
              <th key={g} style={thStyle()}>{g}</th>
            ))}
            <th style={thStyle(true)}>Total</th>
          </tr>
        </thead>
        <tbody>
          {statuses.map(s => {
            const total = rowTotals[s] || 0;
            if (total === 0) return null; // skip empty dispositions
            const clr = statusColor(s);
            return (
              <tr key={s}
                onMouseEnter={e => e.currentTarget.style.background = '#151f30'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <td style={{ ...tdStyle, textAlign: 'left', fontFamily: C.sans, fontWeight: 600 }}>
                  <span style={{ color: clr }}>{s}</span>
                </td>
                {groups.map(g => {
                  const val = data[g]._total?.[s] || 0;
                  return (
                    <td key={g} style={{ ...tdStyle, color: val > 0 ? clr : '#282828' }}>
                      {val > 0 ? val : '—'}
                    </td>
                  );
                })}
                <td style={{ ...tdStyle, fontWeight: 700, color: clr }}>{total}</td>
              </tr>
            );
          })}
          {/* Totals row */}
          <tr style={{ background: C.surface }}>
            <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 700, color: C.accent, fontFamily: C.sans, borderTop: `1px solid ${C.border}` }}>TOTAL</td>
            {groups.map(g => (
              <td key={g} style={{ ...tdStyle, fontWeight: 700, color: C.accent, borderTop: `1px solid ${C.border}` }}>{colTotals[g]}</td>
            ))}
            <td style={{ ...tdStyle, fontWeight: 700, color: C.accent, borderTop: `1px solid ${C.border}` }}>{grandTotal}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────

export default function LeadCRMTab({ dateRange }) {
  const [leads, setLeads] = useState([]);
  const [pipeline, setPipeline] = useState({ byAgent: {}, byCampaign: {} });
  const [statuses, setStatuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [view, setView] = useState('pipeline'); // 'pipeline' or 'detail'
  const [pipelineMode, setPipelineMode] = useState('agent'); // 'agent' or 'campaign'
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedLead, setSelectedLead] = useState(null);
  const [billableOnly, setBillableOnly] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/crm/leads?start=${dateRange.start}&end=${dateRange.end}&limit=1000&billable=${billableOnly}`)
      .then(r => r.json())
      .then(d => {
        setLeads(d.leads || []);
        setPipeline(d.pipeline || { byAgent: {}, byCampaign: {} });
        setStatuses(d.statuses || []);
        setError(null);
      })
      .catch(err => { setError(err.message); setLeads([]); })
      .finally(() => setLoading(false));
  }, [dateRange, billableOnly]);

  // Filtered leads for detail view
  const filtered = useMemo(() => {
    if (statusFilter === 'all') return leads;
    return leads.filter(l => l.status === statusFilter);
  }, [leads, statusFilter]);

  // Metrics
  const metrics = useMemo(() => {
    const converted = leads.filter(l => l.status === 'CONVERTED').length;
    const convertRate = leads.length > 0 ? ((converted / leads.length) * 100).toFixed(1) : 0;
    const totalPremium = leads.reduce((s, l) => s + (l.premium || 0), 0);
    const totalCost = leads.reduce((s, l) => s + (l.totalCost || 0), 0);
    return {
      totalLeads: fmt(leads.length),
      converted: fmt(converted),
      convertRate: fmtPct(convertRate),
      totalPremium: fmtDollar(totalPremium),
      totalCost: fmtDollar(totalCost),
    };
  }, [leads]);

  // Status counts for filter tabs
  const statusCounts = useMemo(() => {
    const counts = { all: leads.length };
    statuses.forEach(s => { counts[s] = leads.filter(l => l.status === s).length; });
    return counts;
  }, [leads, statuses]);

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  // Detail table columns
  const detailColumns = [
    { key: 'name', label: 'Name', align: 'left' },
    { key: 'phone', label: 'Phone', align: 'left', mono: true },
    { key: 'leadSource', label: 'Source', align: 'left', color: () => C.muted },
    { key: 'status', label: 'Status', align: 'left', render: (val) => <StatusBadge status={val} /> },
    { key: 'primaryAgent', label: 'Agent', align: 'left' },
    { key: 'state', label: 'State', align: 'center' },
    { key: 'lastContact', label: 'Last Contact', align: 'center', render: formatDate, mono: true },
    { key: 'attempts', label: 'Calls', align: 'right', mono: true },
    { key: 'billableCalls', label: 'Billable', align: 'right', mono: true },
    { key: 'totalCost', label: 'Cost', align: 'right', mono: true, render: (val) => val > 0 ? fmtDollar(val) : '—', color: (val) => val > 0 ? C.red : C.muted },
    { key: 'premium', label: 'Premium', align: 'right', mono: true, render: (val) => val > 0 ? fmtDollar(val) : '—', color: (val) => val > 0 ? C.green : C.muted },
  ];

  if (loading) return <div style={{ color: C.muted, textAlign: 'center', padding: 40 }}>Loading leads...</div>;
  if (error) return <div style={{ color: C.red, textAlign: 'center', padding: 40 }}>Error: {error}</div>;

  return (
    <div>
      {/* View toggle: Pipeline vs Detail */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 2, background: C.card, borderRadius: 6, padding: 2, border: `1px solid ${C.border}` }}>
          <button onClick={() => setView('pipeline')} style={{
            padding: '7px 16px', borderRadius: 4, border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer',
            background: view === 'pipeline' ? C.accent : 'transparent', color: view === 'pipeline' ? '#fff' : C.muted,
          }}>Pipeline</button>
          <button onClick={() => setView('detail')} style={{
            padding: '7px 16px', borderRadius: 4, border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer',
            background: view === 'detail' ? C.accent : 'transparent', color: view === 'detail' ? '#fff' : C.muted,
          }}>Detail</button>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Billable toggle */}
          <div style={{ display: 'flex', gap: 2, background: C.card, borderRadius: 6, padding: 2, border: `1px solid ${C.border}` }}>
            <button onClick={() => setBillableOnly(true)} style={{
              padding: '7px 14px', borderRadius: 4, border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer',
              background: billableOnly ? C.accent : 'transparent', color: billableOnly ? '#fff' : C.muted,
            }}>Billable</button>
            <button onClick={() => setBillableOnly(false)} style={{
              padding: '7px 14px', borderRadius: 4, border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer',
              background: !billableOnly ? C.accent : 'transparent', color: !billableOnly ? '#fff' : C.muted,
            }}>All Calls</button>
          </div>

          {/* Pipeline mode toggle (only in pipeline view) */}
          {view === 'pipeline' && (
            <div style={{ display: 'flex', gap: 2, background: C.card, borderRadius: 6, padding: 2, border: `1px solid ${C.border}` }}>
              <button onClick={() => setPipelineMode('agent')} style={{
                padding: '7px 14px', borderRadius: 4, border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                background: pipelineMode === 'agent' ? C.accent : 'transparent', color: pipelineMode === 'agent' ? '#fff' : C.muted,
              }}>By Agent</button>
              <button onClick={() => setPipelineMode('campaign')} style={{
                padding: '7px 14px', borderRadius: 4, border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                background: pipelineMode === 'campaign' ? C.accent : 'transparent', color: pipelineMode === 'campaign' ? '#fff' : C.muted,
              }}>By Campaign</button>
            </div>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <KPICard label="Total Leads" value={metrics.totalLeads} />
        <KPICard label="Converted" value={metrics.converted} color={C.green} />
        <KPICard label="Conversion Rate" value={metrics.convertRate} color={C.green} />
        <KPICard label="Total Premium" value={metrics.totalPremium} color={C.green} />
        <KPICard label="Lead Cost" value={metrics.totalCost} color={C.red} />
      </div>

      {/* Pipeline View */}
      {view === 'pipeline' && (
        <Section
          title={pipelineMode === 'agent' ? 'Pipeline by Agent' : 'Pipeline by Campaign'}
        >
          {pipelineMode === 'agent' ? (
            <PipelineTable
              data={pipeline.byAgent}
              statuses={statuses}
              groupLabel="Agent"
            />
          ) : (
            <PipelineTable
              data={pipeline.byCampaign}
              statuses={statuses}
              groupLabel="Campaign"
            />
          )}
        </Section>
      )}

      {/* Detail View */}
      {view === 'detail' && (
        <>
          {/* Status filter tabs */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap', borderBottom: `1px solid ${C.border}`, paddingBottom: 12 }}>
            <button onClick={() => setStatusFilter('all')} style={{
              background: 'transparent', border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer', paddingBottom: 6,
              color: statusFilter === 'all' ? C.accent : C.muted,
              borderBottom: statusFilter === 'all' ? `2px solid ${C.accent}` : 'none',
            }}>All ({statusCounts.all})</button>
            {statuses.map(s => (
              <button key={s} onClick={() => setStatusFilter(s)} style={{
                background: 'transparent', border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer', paddingBottom: 6,
                color: statusFilter === s ? statusColor(s) : C.muted,
                borderBottom: statusFilter === s ? `2px solid ${statusColor(s)}` : 'none',
              }}>{s} ({statusCounts[s] || 0})</button>
            ))}
          </div>

          <Section title={`Leads (${filtered.length})`} subtitle="Click any row for details">
            {filtered.length === 0 ? (
              <div style={{ color: C.muted, padding: 30, textAlign: 'center', fontSize: 12 }}>No leads found for this date range</div>
            ) : (
              <SortableTable
                columns={detailColumns}
                rows={filtered}
                defaultSort="lastContact"
                onRowClick={(row) => setSelectedLead(row.leadId)}
              />
            )}
          </Section>
        </>
      )}

      {/* Detail modal */}
      {selectedLead && <LeadDetailModal leadId={selectedLead} onClose={() => setSelectedLead(null)} />}
    </div>
  );
}
