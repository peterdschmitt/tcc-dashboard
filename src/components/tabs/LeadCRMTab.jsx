'use client';
import { useState, useEffect, useMemo } from 'react';
import { C, fmt, fmtPct, STATUS_COLORS, LEAD_STATUSES } from '../shared/theme';
import LeadDetailModal from '../crm/LeadDetailModal';

function KPICard({ label, value, goal }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '16px 20px', flex: '1 1 0', minWidth: 140, borderTop: `3px solid ${C.accent}` }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: C.accent, fontFamily: C.mono, lineHeight: 1 }}>{value}</div>
      {goal && <div style={{ fontSize: 10, color: C.muted, marginTop: 6, fontFamily: C.mono }}>Goal: {goal}</div>}
    </div>
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
    <div style={{ overflowX: 'auto', marginTop: 16 }}>
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
            <tr key={i} onClick={() => onRowClick && onRowClick(row)}
              onMouseEnter={e => e.currentTarget.style.background = '#151f30'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              style={{ cursor: onRowClick ? 'pointer' : 'default' }}>
              {columns.map(col => (
                <td key={col.key} style={{
                  padding: '10px 12px', textAlign: col.align || 'right', fontSize: 12,
                  color: col.color ? col.color(row[col.key], row) : C.text, fontFamily: col.mono ? C.mono : 'inherit',
                  borderBottom: `1px solid ${C.border}`,
                }}>
                  {col.render ? col.render(row[col.key], row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
          {totalsRow && (
            <tr style={{ background: C.surface, fontWeight: 700 }}>
              {columns.map(col => (
                <td key={col.key} style={{
                  padding: '10px 12px', textAlign: col.align || 'right', fontSize: 12,
                  color: C.text, fontFamily: col.mono ? C.mono : 'inherit',
                  borderBottom: `2px solid ${C.border}`, borderTop: `1px solid ${C.border}`,
                }}>
                  {totalsRow[col.key] || ''}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginTop: 20, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 16 }}>{title}</div>
      {children}
    </div>
  );
}

export default function LeadCRMTab({ dateRange }) {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [subtab, setSubtab] = useState('all');
  const [selectedLead, setSelectedLead] = useState(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/crm/leads?start=${dateRange.start}&end=${dateRange.end}&page=1&limit=500`)
      .then(r => r.json())
      .then(d => {
        setLeads(d.leads || []);
        setError(null);
      })
      .catch(err => {
        setError(err.message);
        setLeads([]);
      })
      .finally(() => setLoading(false));
  }, [dateRange, subtab]);

  // Filter leads by subtab
  const filtered = useMemo(() => {
    if (subtab === 'all') return leads;
    if (subtab === 'my-leads') return leads; // TODO: filter by current agent
    return leads.filter(l => l.status === subtab.charAt(0).toUpperCase() + subtab.slice(1).replace('-', ' '));
  }, [leads, subtab]);

  // Calculate metrics
  const metrics = useMemo(() => {
    const today = new Date();
    const followUpDue = filtered.filter(l => l.followUpDue && new Date(l.followUpDue) <= today).length;
    const newToday = filtered.filter(l => l.status === 'New' && l.createdAt && new Date(l.createdAt).toDateString() === today.toDateString()).length;
    const converted = filtered.filter(l => l.status === 'Converted').length;
    const convertRate = filtered.length > 0 ? ((converted / filtered.length) * 100).toFixed(1) : 0;
    const avgAttempts = filtered.length > 0 ? (filtered.reduce((sum, l) => sum + (l.attempts || 0), 0) / filtered.length).toFixed(1) : 0;

    return {
      totalLeads: fmt(filtered.length),
      newToday: fmt(newToday),
      followUpDue: fmt(followUpDue),
      convertRate: fmtPct(convertRate),
      avgAttempts: fmtPct(avgAttempts),
    };
  }, [filtered]);

  // Format date strings
  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  // Check if date is overdue
  const isOverdue = (dateStr) => {
    if (!dateStr) return false;
    return new Date(dateStr) < new Date();
  };

  const columns = [
    { key: 'name', label: 'Name', align: 'left' },
    { key: 'phone', label: 'Phone', align: 'left', mono: true },
    { key: 'source', label: 'Source', align: 'left', color: () => C.muted },
    { key: 'status', label: 'Status', align: 'left', render: (val) => (
      <span style={{
        display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
        background: (STATUS_COLORS[val] || C.muted) + '22', color: STATUS_COLORS[val] || C.muted,
      }}>{val || '—'}</span>
    )},
    { key: 'agent', label: 'Agent', align: 'left' },
    { key: 'lastContact', label: 'Last Contact', align: 'center', render: formatDate, mono: true },
    { key: 'followUpDue', label: 'Follow-Up Due', align: 'center', render: (val) => (
      <span style={{ color: isOverdue(val) ? C.red : (val ? C.green : C.muted), fontFamily: C.mono }}>
        {formatDate(val)}
      </span>
    )},
    { key: 'attempts', label: 'Attempts', align: 'right', mono: true },
  ];

  const tableRows = filtered.map(l => ({
    ...l,
    name: l.firstName && l.lastName ? `${l.firstName} ${l.lastName}` : l.firstName || '—',
  }));

  if (loading) return <div style={{ color: C.muted, textAlign: 'center', padding: 40 }}>Loading leads...</div>;
  if (error) return <div style={{ color: C.red, textAlign: 'center', padding: 40 }}>Error: {error}</div>;

  return (
    <div>
      {/* Subtab bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: `1px solid ${C.border}`, paddingBottom: 12 }}>
        {['all', 'my-leads', 'new', 'follow-up', 'converted', 'dead', 'pooled'].map(tab => (
          <button
            key={tab}
            onClick={() => setSubtab(tab)}
            style={{
              background: 'transparent', border: 'none', color: subtab === tab ? C.accent : C.muted,
              fontSize: 12, fontWeight: 600, cursor: 'pointer', paddingBottom: 8,
              borderBottom: subtab === tab ? `2px solid ${C.accent}` : 'none',
              fontFamily: C.sans, textTransform: 'capitalize',
            }}
          >
            {tab.replace('-', ' ')}
          </button>
        ))}
      </div>

      {/* Metrics */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <KPICard label="Total Leads" value={metrics.totalLeads} />
        <KPICard label="New Today" value={metrics.newToday} />
        <KPICard label="Follow-Up Due" value={metrics.followUpDue} />
        <KPICard label="Conversion Rate" value={metrics.convertRate} />
        <KPICard label="Avg Attempts" value={metrics.avgAttempts} />
      </div>

      {/* Table */}
      <Section title="Lead List">
        {tableRows.length === 0 ? (
          <div style={{ color: C.muted, padding: 20, textAlign: 'center' }}>No leads found</div>
        ) : (
          <SortableTable
            columns={columns}
            rows={tableRows}
            defaultSort="followUpDue"
            onRowClick={(row) => setSelectedLead(row.leadId)}
          />
        )}
      </Section>

      {/* Detail modal */}
      {selectedLead && <LeadDetailModal leadId={selectedLead} onClose={() => setSelectedLead(null)} />}
    </div>
  );
}
