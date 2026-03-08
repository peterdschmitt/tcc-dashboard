'use client';
import { useState, useEffect, useMemo } from 'react';
import { C, fmt, fmtDollar, fmtPct } from '../shared/theme';

// ─── Status colors for retention ─────────────────────
const RET_CLR = {
  Active: C.green,
  Pending: C.accent,
  'At-Risk': C.yellow,
  Declined: C.red,
  Lapsed: C.red,
  Reinstated: '#22d3ee',
  Review: C.purple,
  Unknown: C.muted,
};
function retColor(s) { return RET_CLR[s] || C.muted; }

// ─── Shared Components ──────────────────────────────

function KPICard({ label, value, color }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '16px 20px', flex: '1 1 0', minWidth: 130, borderTop: `3px solid ${color || C.accent}` }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: color || C.accent, fontFamily: C.mono, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }) {
  const clr = retColor(status);
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
      background: clr + '22', color: clr,
    }}>{status || '—'}</span>
  );
}

function ConcernBadge({ concerns }) {
  if (!concerns || concerns.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {concerns.map((c, i) => (
        <span key={i} style={{
          display: 'inline-block', padding: '1px 6px', borderRadius: 3, fontSize: 9, fontWeight: 600,
          background: C.redDim, color: C.red, whiteSpace: 'nowrap',
        }}>{c}</span>
      ))}
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

function SortableTable({ columns, rows, defaultSort, onRowClick }) {
  const [sortCol, setSortCol] = useState(defaultSort || null);
  const [sortDir, setSortDir] = useState('desc');
  const sorted = useMemo(() => {
    if (!sortCol) return rows;
    return [...rows].sort((a, b) => {
      let av = a[sortCol], bv = b[sortCol];
      if (typeof av === 'string') av = (av || '').toLowerCase();
      if (typeof bv === 'string') bv = (bv || '').toLowerCase();
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
            <tr key={row.policyNumber || i} onClick={() => onRowClick && onRowClick(row)}
              onMouseEnter={e => e.currentTarget.style.background = '#151f30'}
              onMouseLeave={e => e.currentTarget.style.background = row.hasConcerns ? C.redDim + '33' : 'transparent'}
              style={{ cursor: onRowClick ? 'pointer' : 'default', background: row.hasConcerns ? C.redDim + '33' : 'transparent' }}>
              {columns.map(col => (
                <td key={col.key} style={{
                  padding: '10px 12px', textAlign: col.align || 'right', fontSize: 12,
                  color: col.color ? col.color(row[col.key], row) : C.text, fontFamily: col.mono ? C.mono : 'inherit',
                  borderBottom: `1px solid ${C.border}`, verticalAlign: 'top',
                }}>{col.render ? col.render(row[col.key], row) : (row[col.key] ?? '—')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Breakdown Grid (transposed: statuses as rows, agents/carriers as columns) ────

function BreakdownGrid({ data, statuses, groupLabel }) {
  if (!data || Object.keys(data).length === 0) return <div style={{ color: C.muted, padding: 20, textAlign: 'center', fontSize: 11 }}>No data</div>;

  // Sort groups by count desc
  const groups = Object.entries(data).sort((a, b) => b[1]._count - a[1]._count).map(([name]) => name);

  const thStyle = (highlight) => ({
    padding: '8px 10px', textAlign: 'right', fontSize: 9, fontWeight: 700, color: highlight ? C.accent : C.muted,
    textTransform: 'uppercase', letterSpacing: 0.8, borderBottom: `2px solid ${C.border}`, background: C.surface,
    whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 1,
  });
  const tdStyle = { padding: '8px 10px', textAlign: 'right', fontSize: 12, fontFamily: C.mono, borderBottom: `1px solid ${C.border}` };

  // Row totals (per status across all groups)
  const rowTotals = {};
  statuses.forEach(s => {
    rowTotals[s] = groups.reduce((sum, g) => sum + (data[g]._total?.[s] || 0), 0);
  });
  const grandTotal = groups.reduce((sum, g) => sum + (data[g]._count || 0), 0);

  // Premium row
  const totalPremium = groups.reduce((sum, g) => sum + (data[g]._premium || 0), 0);

  // Concerns row
  const totalConcerns = groups.reduce((sum, g) => sum + (data[g]._concerns || 0), 0);

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...thStyle(), textAlign: 'left', minWidth: 120 }}>Status</th>
            {groups.map(g => (
              <th key={g} style={thStyle()}>{g}</th>
            ))}
            <th style={thStyle(true)}>Total</th>
          </tr>
        </thead>
        <tbody>
          {/* Status rows */}
          {statuses.map(s => {
            const total = rowTotals[s] || 0;
            if (total === 0) return null;
            const clr = retColor(s);
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
              <td key={g} style={{ ...tdStyle, fontWeight: 700, color: C.accent, borderTop: `1px solid ${C.border}` }}>{data[g]._count}</td>
            ))}
            <td style={{ ...tdStyle, fontWeight: 700, color: C.accent, borderTop: `1px solid ${C.border}` }}>{grandTotal}</td>
          </tr>

          {/* Premium row */}
          <tr>
            <td style={{ ...tdStyle, textAlign: 'left', fontFamily: C.sans, fontWeight: 600, color: C.green }}>PREMIUM</td>
            {groups.map(g => (
              <td key={g} style={{ ...tdStyle, color: data[g]._premium > 0 ? C.green : '#282828', fontSize: 11 }}>
                {data[g]._premium > 0 ? fmtDollar(data[g]._premium) : '—'}
              </td>
            ))}
            <td style={{ ...tdStyle, fontWeight: 700, color: C.green }}>{fmtDollar(totalPremium)}</td>
          </tr>

          {/* Concerns row */}
          {totalConcerns > 0 && (
            <tr>
              <td style={{ ...tdStyle, textAlign: 'left', fontFamily: C.sans, fontWeight: 600, color: C.red }}>CONCERNS</td>
              {groups.map(g => {
                const val = data[g]._concerns || 0;
                return (
                  <td key={g} style={{ ...tdStyle, color: val > 0 ? C.red : '#282828' }}>
                    {val > 0 ? val : '—'}
                  </td>
                );
              })}
              <td style={{ ...tdStyle, fontWeight: 700, color: C.red }}>{totalConcerns}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Detail Panel (inline) ──────────────────────────

function PolicyDetail({ policy, onClose }) {
  if (!policy) return null;
  const clr = retColor(policy.retentionStatus);
  return (
    <Section title="Policy Detail" subtitle={<span onClick={onClose} style={{ cursor: 'pointer', color: C.accent }}>&times; Close</span>}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ flex: '1 1 300px' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 4 }}>{policy.name}</div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>
            {policy.phone && <span style={{ marginRight: 16 }}>{policy.phone}</span>}
            {policy.email && <span style={{ marginRight: 16 }}>{policy.email}</span>}
            {policy.state && <span>{policy.state}</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 16px', fontSize: 12 }}>
            <span style={{ color: C.muted }}>Policy #</span><span style={{ fontFamily: C.mono }}>{policy.policyNumber}</span>
            {policy.carrierPolicyNumber && <><span style={{ color: C.muted }}>Carrier Policy #</span><span style={{ fontFamily: C.mono }}>{policy.carrierPolicyNumber}</span></>}
            <span style={{ color: C.muted }}>Carrier</span><span>{policy.carrier}</span>
            <span style={{ color: C.muted }}>Product</span><span>{policy.product}</span>
            <span style={{ color: C.muted }}>Agent</span><span>{policy.agent}</span>
            <span style={{ color: C.muted }}>Lead Source</span><span>{policy.leadSource}</span>
            <span style={{ color: C.muted }}>Premium</span><span style={{ fontFamily: C.mono, color: C.green }}>{fmtDollar(policy.premium)}/mo</span>
            {policy.faceAmount > 0 && <><span style={{ color: C.muted }}>Face Amount</span><span style={{ fontFamily: C.mono }}>{fmtDollar(policy.faceAmount)}</span></>}
            {policy.termLength && <><span style={{ color: C.muted }}>Term</span><span>{policy.termLength}</span></>}
            <span style={{ color: C.muted }}>Submit Date</span><span style={{ fontFamily: C.mono }}>{policy.submitDate || '—'}</span>
            <span style={{ color: C.muted }}>Effective Date</span><span style={{ fontFamily: C.mono }}>{policy.effectiveDate || '—'}</span>
            <span style={{ color: C.muted }}>Placed Status</span><span>{policy.placedStatus || '—'}</span>
            <span style={{ color: C.muted }}>Retention Status</span><StatusBadge status={policy.retentionStatus} />
            {policy.carrierStatus && <><span style={{ color: C.muted }}>Carrier Status</span><span style={{ color: clr }}>{policy.carrierStatus}</span></>}
            {policy.carrierStatusDate && <><span style={{ color: C.muted }}>Carrier Status Date</span><span style={{ fontFamily: C.mono }}>{policy.carrierStatusDate}</span></>}
            {policy.lastSyncDate && <><span style={{ color: C.muted }}>Last Carrier Sync</span><span style={{ fontFamily: C.mono }}>{policy.lastSyncDate}</span></>}
            {policy.ssnMatch && <><span style={{ color: C.muted }}>SSN Match</span><span>{policy.ssnMatch}</span></>}
          </div>
        </div>
        <div style={{ flex: '1 1 250px' }}>
          {policy.concerns && policy.concerns.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.red, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Concerns</div>
              {policy.concerns.map((c, i) => (
                <div key={i} style={{ padding: '6px 10px', background: C.redDim, borderRadius: 4, fontSize: 11, color: C.red, marginBottom: 4 }}>{c}</div>
              ))}
            </div>
          )}
          {policy.syncNotes && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Sync Notes</div>
              <div style={{ fontSize: 11, color: C.text, whiteSpace: 'pre-wrap', background: C.surface, padding: 8, borderRadius: 4 }}>{policy.syncNotes}</div>
            </div>
          )}
          {policy.salesNotes && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Sales Notes</div>
              <div style={{ fontSize: 11, color: C.text, whiteSpace: 'pre-wrap', background: C.surface, padding: 8, borderRadius: 4 }}>{policy.salesNotes}</div>
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

// ─── Main Component ──────────────────────────────────

const STATUS_TABS = [
  { id: 'all', label: 'All' },
  { id: 'concerns', label: 'Concerns' },
  { id: 'Active', label: 'Active' },
  { id: 'Pending', label: 'Pending' },
  { id: 'At-Risk', label: 'At-Risk' },
  { id: 'Declined', label: 'Declined' },
  { id: 'Lapsed', label: 'Lapsed' },
  { id: 'Reinstated', label: 'Reinstated' },
];

export default function RetentionDashboardTab({ dateRange, dataSource }) {
  const [policyholders, setPolicyholders] = useState([]);
  const [summary, setSummary] = useState({});
  const [breakdown, setBreakdown] = useState({ byAgent: {}, byCarrier: {}, statuses: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [view, setView] = useState('summary'); // 'summary' or 'detail'
  const [summaryMode, setSummaryMode] = useState('agent'); // 'agent' or 'carrier'
  const [subtab, setSubtab] = useState('all');
  const [selectedPolicy, setSelectedPolicy] = useState(null);

  useEffect(() => {
    setLoading(true);
    // Retention view loads ALL policies; use source toggle for carrier data
    const src = dataSource || 'Sheet1';
    fetch(`/api/crm/policyholders?limit=1000&source=${src}`)
      .then(r => r.json())
      .then(d => {
        setPolicyholders(d.policyholders || []);
        setSummary(d.summary || {});
        setBreakdown(d.breakdown || { byAgent: {}, byCarrier: {}, statuses: [] });
        setError(null);
      })
      .catch(err => { setError(err.message); setPolicyholders([]); })
      .finally(() => setLoading(false));
  }, [dataSource]);

  // Filter by subtab (for detail view)
  const filtered = useMemo(() => {
    if (subtab === 'all') return policyholders;
    if (subtab === 'concerns') return policyholders.filter(p => p.hasConcerns);
    return policyholders.filter(p => p.retentionStatus === subtab);
  }, [policyholders, subtab]);

  // Tab counts
  const tabCounts = useMemo(() => {
    const counts = { all: policyholders.length, concerns: 0 };
    STATUS_TABS.forEach(t => {
      if (t.id !== 'all' && t.id !== 'concerns') {
        counts[t.id] = policyholders.filter(p => p.retentionStatus === t.id).length;
      }
    });
    counts.concerns = policyholders.filter(p => p.hasConcerns).length;
    return counts;
  }, [policyholders]);

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  // Detail table columns
  const columns = [
    { key: 'name', label: 'Name', align: 'left' },
    { key: 'policyNumber', label: 'Policy #', align: 'left', mono: true },
    { key: 'carrier', label: 'Carrier', align: 'left' },
    { key: 'product', label: 'Product', align: 'left' },
    { key: 'agent', label: 'Agent', align: 'left' },
    { key: 'premium', label: 'Premium', align: 'right', mono: true, render: (val) => val > 0 ? fmtDollar(val) : '—', color: (val) => val > 0 ? C.green : C.muted },
    { key: 'retentionStatus', label: 'Status', align: 'left', render: (val) => <StatusBadge status={val} /> },
    { key: 'placedStatus', label: 'Placed', align: 'left', render: (val) => <span style={{ fontSize: 10, color: C.muted }}>{val || '—'}</span> },
    { key: 'carrierStatus', label: 'Carrier Status', align: 'left', render: (val) => val ? <span style={{ fontSize: 10, color: C.yellow }}>{val}</span> : <span style={{ color: '#333' }}>—</span> },
    { key: 'submitDate', label: 'Submitted', align: 'center', render: formatDate, mono: true },
    { key: 'daysSinceSubmit', label: 'Age', align: 'right', mono: true, render: (val) => val != null ? `${val}d` : '—', color: (val) => val && val > 30 ? C.yellow : C.muted },
    { key: 'concerns', label: 'Concerns', align: 'left', sortable: false, render: (val) => <ConcernBadge concerns={val} /> },
  ];

  if (loading) return <div style={{ color: C.muted, textAlign: 'center', padding: 40 }}>Loading retention data...</div>;
  if (error) return <div style={{ color: C.red, textAlign: 'center', padding: 40 }}>Error: {error}</div>;

  return (
    <div>
      {/* View toggle bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 2, background: C.card, borderRadius: 6, padding: 2, border: `1px solid ${C.border}` }}>
          <button onClick={() => setView('summary')} style={{
            padding: '7px 16px', borderRadius: 4, border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer',
            background: view === 'summary' ? C.accent : 'transparent', color: view === 'summary' ? '#fff' : C.muted,
          }}>Summary</button>
          <button onClick={() => setView('detail')} style={{
            padding: '7px 16px', borderRadius: 4, border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer',
            background: view === 'detail' ? C.accent : 'transparent', color: view === 'detail' ? '#fff' : C.muted,
          }}>Detail</button>
        </div>

        {/* Summary mode toggle (only in summary view) */}
        {view === 'summary' && (
          <div style={{ display: 'flex', gap: 2, background: C.card, borderRadius: 6, padding: 2, border: `1px solid ${C.border}` }}>
            <button onClick={() => setSummaryMode('agent')} style={{
              padding: '7px 14px', borderRadius: 4, border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer',
              background: summaryMode === 'agent' ? C.accent : 'transparent', color: summaryMode === 'agent' ? '#fff' : C.muted,
            }}>By Agent</button>
            <button onClick={() => setSummaryMode('carrier')} style={{
              padding: '7px 14px', borderRadius: 4, border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer',
              background: summaryMode === 'carrier' ? C.accent : 'transparent', color: summaryMode === 'carrier' ? '#fff' : C.muted,
            }}>By Carrier</button>
          </div>
        )}
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <KPICard label="Total Policies" value={fmt(summary.total || 0)} />
        <KPICard label="Active" value={fmt(summary.active || 0)} color={C.green} />
        <KPICard label="Premium in Force" value={fmtDollar(summary.totalPremium || 0)} color={C.green} />
        <KPICard label="At-Risk / Lapsed" value={fmt((summary.atRisk || 0) + (summary.lapsed || 0))} color={C.yellow} />
        <KPICard label="At-Risk Premium" value={fmtDollar(summary.atRiskPremium || 0)} color={C.red} />
        <KPICard label="Concerns" value={fmt(summary.withConcerns || 0)} color={summary.withConcerns > 0 ? C.red : C.muted} />
      </div>

      {/* ─── Summary View ─── */}
      {view === 'summary' && (
        <Section title={summaryMode === 'agent' ? 'Retention by Agent' : 'Retention by Carrier'}>
          <BreakdownGrid
            data={summaryMode === 'agent' ? breakdown.byAgent : breakdown.byCarrier}
            statuses={breakdown.statuses}
            groupLabel={summaryMode === 'agent' ? 'Agent' : 'Carrier'}
          />
        </Section>
      )}

      {/* ─── Detail View ─── */}
      {view === 'detail' && (
        <>
          {/* Status filter tabs */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap', borderBottom: `1px solid ${C.border}`, paddingBottom: 12 }}>
            {STATUS_TABS.map(tab => {
              const count = tabCounts[tab.id] || 0;
              const isActive = subtab === tab.id;
              const clr = tab.id === 'concerns' ? C.red : (isActive ? (RET_CLR[tab.id] || C.accent) : C.muted);
              return (
                <button key={tab.id} onClick={() => setSubtab(tab.id)} style={{
                  background: 'transparent', border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer', paddingBottom: 6,
                  color: isActive ? clr : C.muted,
                  borderBottom: isActive ? `2px solid ${clr}` : 'none',
                }}>{tab.label} ({count})</button>
              );
            })}
          </div>

          <Section title={`Policies (${filtered.length})`} subtitle="Click any row for details">
            {filtered.length === 0 ? (
              <div style={{ color: C.muted, padding: 30, textAlign: 'center', fontSize: 12 }}>No policies found for this filter</div>
            ) : (
              <SortableTable
                columns={columns}
                rows={filtered}
                defaultSort="submitDate"
                onRowClick={(row) => setSelectedPolicy(row)}
              />
            )}
          </Section>

          {/* Inline detail panel */}
          {selectedPolicy && (
            <PolicyDetail policy={selectedPolicy} onClose={() => setSelectedPolicy(null)} />
          )}
        </>
      )}
    </div>
  );
}
