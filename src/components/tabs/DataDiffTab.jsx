'use client';
import { useState, useEffect, useMemo, Fragment } from 'react';

const C = {
  bg: '#080b10', surface: '#0f1520', card: '#131b28', border: '#1a2538',
  text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff',
  green: '#4ade80', greenDim: '#0a2e1a', yellow: '#facc15', yellowDim: '#2e2a0a',
  red: '#f87171', redDim: '#2e0a0a',
  mono: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
  sans: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
};

function fmt$(n) { return n == null || isNaN(n) ? '—' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function KPICard({ label, value, color, subtitle }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderTop: `3px solid ${color || C.accent}`, borderRadius: 8, padding: '14px 18px', minWidth: 140 }}>
      <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || C.text, fontFamily: C.mono }}>{value}</div>
      {subtitle && <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>{subtitle}</div>}
    </div>
  );
}

export default function DataDiffTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterField, setFilterField] = useState('all');
  const [filterAgent, setFilterAgent] = useState('all');
  const [expandedRow, setExpandedRow] = useState(null);
  const [sortCol, setSortCol] = useState('submitDate');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    setLoading(true);
    fetch('/api/crm/data-diff')
      .then(r => r.ok ? r.json() : r.json().then(e => { throw new Error(e.error || r.status); }))
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  const filtered = useMemo(() => {
    if (!data?.records) return [];
    let rows = data.records;
    if (filterField !== 'all') {
      rows = rows.filter(r => r.diffs.some(d => d.field === filterField));
    }
    if (filterAgent !== 'all') {
      rows = rows.filter(r => r.agent === filterAgent);
    }
    // Sort
    rows = [...rows].sort((a, b) => {
      let va, vb;
      if (sortCol === 'submitDate') { va = a.submitDate || ''; vb = b.submitDate || ''; }
      else if (sortCol === 'insured') { va = a.insured; vb = b.insured; }
      else if (sortCol === 'agent') { va = a.agent; vb = b.agent; }
      else if (sortCol === 'carrier') { va = a.carrier; vb = b.carrier; }
      else if (sortCol === 'premiumDiff') { va = a.mergedPremium - a.sheet1Premium; vb = b.mergedPremium - b.sheet1Premium; }
      else { va = a[sortCol]; vb = b[sortCol]; }
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortDir === 'asc' ? (va || 0) - (vb || 0) : (vb || 0) - (va || 0);
    });
    return rows;
  }, [data, filterField, filterAgent, sortCol, sortDir]);

  const agents = useMemo(() => {
    if (!data?.summary?.byAgent) return [];
    return Object.entries(data.summary.byAgent).sort((a, b) => b[1] - a[1]);
  }, [data]);

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: C.muted }}>Loading data comparison...</div>;
  if (error) return <div style={{ padding: 40, textAlign: 'center', color: C.red }}>Error: {error}</div>;
  if (!data) return null;

  const { summary } = data;

  const SortHeader = ({ col, children, style: s }) => (
    <th onClick={() => handleSort(col)} style={{ ...thStyle, cursor: 'pointer', ...s }}>
      {children} {sortCol === col ? (sortDir === 'asc' ? '↑' : '↓') : ''}
    </th>
  );

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1400, margin: '0 auto' }}>
      {/* KPI Cards */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <KPICard label="Total Matched" value={summary.totalMatched} color={C.accent} subtitle={`${summary.totalSheet1} Sheet1 · ${summary.totalMerged} Merged`} />
        <KPICard label="Records Changed" value={summary.totalDiffs} color={summary.totalDiffs > 0 ? C.yellow : C.green} subtitle={`${((summary.totalDiffs / summary.totalMatched) * 100).toFixed(1)}% of total`} />
        <KPICard label="Status Changes" value={summary.statusDiffCount} color={summary.statusDiffCount > 0 ? C.red : C.green} />
        <KPICard label="Premium Impact" value={fmt$(summary.premiumDiffTotal)} color={summary.premiumDiffTotal < 0 ? C.red : summary.premiumDiffTotal > 0 ? C.green : C.muted} subtitle="Merged − App Data" />
        <KPICard label="Sheet1 Only" value={summary.sheet1Only} color={summary.sheet1Only > 0 ? C.yellow : C.muted} subtitle="Not in Merged" />
        <KPICard label="Merged Only" value={summary.mergedOnly} color={summary.mergedOnly > 0 ? C.yellow : C.muted} subtitle="Not in Sheet1" />
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>FILTER:</span>
        <div style={{ display: 'flex', gap: 2, background: C.card, borderRadius: 6, padding: 2, border: `1px solid ${C.border}` }}>
          {[{ id: 'all', label: `All (${summary.totalDiffs})` },
            ...Object.entries(summary.byField || {}).map(([k, v]) => ({ id: k, label: `${k} (${v})` }))
          ].map(f => (
            <button key={f.id} onClick={() => setFilterField(f.id)} style={{
              padding: '5px 10px', borderRadius: 4, border: 'none', fontSize: 10, fontWeight: 600, cursor: 'pointer',
              background: filterField === f.id ? C.accent : 'transparent',
              color: filterField === f.id ? '#fff' : C.muted,
            }}>{f.label}</button>
          ))}
        </div>

        <select value={filterAgent} onChange={e => setFilterAgent(e.target.value)} style={{
          background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6,
          padding: '5px 10px', fontSize: 11, fontFamily: C.mono, cursor: 'pointer',
        }}>
          <option value="all">All Agents ({agents.reduce((s, a) => s + a[1], 0)})</option>
          {agents.map(([name, count]) => (
            <option key={name} value={name}>{name} ({count})</option>
          ))}
        </select>

        <span style={{ fontSize: 11, color: C.muted, marginLeft: 'auto' }}>
          Showing {filtered.length} of {summary.totalDiffs} changed records
        </span>
      </div>

      {/* Table */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: C.mono }}>
            <thead>
              <tr style={{ background: C.surface }}>
                <SortHeader col="submitDate">Date</SortHeader>
                <SortHeader col="insured">Insured</SortHeader>
                <SortHeader col="agent">Agent</SortHeader>
                <SortHeader col="carrier">Carrier</SortHeader>
                <th style={thStyle}>App Status</th>
                <th style={thStyle}>Carrier Status</th>
                <th style={thStyle}>App Premium</th>
                <th style={thStyle}>Carrier Premium</th>
                <SortHeader col="premiumDiff" style={{ textAlign: 'right' }}>Diff</SortHeader>
                <th style={thStyle}>Changes</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={10} style={{ ...tdStyle, textAlign: 'center', padding: 30, color: C.green }}>
                  No differences found — App Data and Carrier Data are in sync.
                </td></tr>
              )}
              {filtered.map((r, i) => {
                const premDiff = r.mergedPremium - r.sheet1Premium;
                const statusChanged = r.sheet1Status !== r.mergedStatus;
                const isExpanded = expandedRow === i;

                return (
                  <Fragment key={r.policyNumber || i}>
                    <tr
                      onClick={() => setExpandedRow(isExpanded ? null : i)}
                      style={{
                        cursor: 'pointer',
                        background: isExpanded ? C.surface : (i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)'),
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = 'rgba(91,159,255,0.05)'; }}
                      onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)'; }}
                    >
                      <td style={tdStyle}>{r.submitDate || '—'}</td>
                      <td style={{ ...tdStyle, fontFamily: C.sans, fontWeight: 500 }}>{r.insured}</td>
                      <td style={tdStyle}>{r.agent}</td>
                      <td style={{ ...tdStyle, fontSize: 10 }}>{r.carrier}</td>
                      <td style={{ ...tdStyle, color: statusChanged ? C.yellow : C.muted }}>{r.sheet1Status || '—'}</td>
                      <td style={{ ...tdStyle, color: statusChanged ? C.accent : C.muted, fontWeight: statusChanged ? 700 : 400 }}>{r.mergedStatus || '—'}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{fmt$(r.sheet1Premium)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: Math.abs(premDiff) > 0.01 ? 700 : 400 }}>{fmt$(r.mergedPremium)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', color: premDiff < -0.01 ? C.red : premDiff > 0.01 ? C.green : C.muted, fontWeight: 700 }}>
                        {Math.abs(premDiff) > 0.01 ? (premDiff > 0 ? '+' : '') + fmt$(premDiff) : '—'}
                      </td>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {r.diffs.map((d, j) => (
                            <span key={j} style={{
                              padding: '2px 6px', borderRadius: 3, fontSize: 9, fontWeight: 600, fontFamily: C.sans,
                              background: d.field === 'Placed Status' ? C.redDim : d.field === 'Monthly Premium' ? C.yellowDim : C.surface,
                              color: d.field === 'Placed Status' ? C.red : d.field === 'Monthly Premium' ? C.yellow : C.muted,
                              border: `1px solid ${d.field === 'Placed Status' ? C.red + '33' : d.field === 'Monthly Premium' ? C.yellow + '33' : C.border}`,
                            }}>{d.field}</span>
                          ))}
                        </div>
                      </td>
                    </tr>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={10} style={{ padding: 0, background: C.surface }}>
                          <div style={{ padding: '16px 24px', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                            {/* Diff details */}
                            <div style={{ flex: 1, minWidth: 300 }}>
                              <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', fontWeight: 700, marginBottom: 10, letterSpacing: 0.5 }}>Field Changes</div>
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                <thead>
                                  <tr>
                                    <th style={{ ...thStyle, fontSize: 10 }}>Field</th>
                                    <th style={{ ...thStyle, fontSize: 10 }}>App Data (Sheet1)</th>
                                    <th style={{ ...thStyle, fontSize: 10 }}>Carrier Data (Merged)</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {r.diffs.map((d, j) => (
                                    <tr key={j}>
                                      <td style={{ ...tdStyle, fontWeight: 600, fontFamily: C.sans }}>{d.field}</td>
                                      <td style={{ ...tdStyle, color: C.red }}>{d.format === 'currency' ? fmt$(d.sheet1) : d.sheet1}</td>
                                      <td style={{ ...tdStyle, color: C.green }}>{d.format === 'currency' ? fmt$(d.merged) : d.merged}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>

                            {/* Audit info */}
                            <div style={{ minWidth: 250 }}>
                              <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', fontWeight: 700, marginBottom: 10, letterSpacing: 0.5 }}>Audit Info</div>
                              <div style={{ display: 'grid', gap: 8, fontSize: 11 }}>
                                <div><span style={{ color: C.muted }}>Policy #: </span><span style={{ color: C.text }}>{r.policyNumber || '—'}</span></div>
                                <div><span style={{ color: C.muted }}>Carrier Policy #: </span><span style={{ color: C.text }}>{r.carrierPolicyNo || '—'}</span></div>
                                <div><span style={{ color: C.muted }}>Carrier Status: </span><span style={{ color: C.accent }}>{r.carrierStatus || '—'}</span></div>
                                {r.originalPremium != null && (
                                  <div><span style={{ color: C.muted }}>Original Premium: </span><span style={{ color: C.yellow }}>{fmt$(r.originalPremium)}</span></div>
                                )}
                                <div><span style={{ color: C.muted }}>Last Sync: </span><span style={{ color: C.text }}>{r.lastSyncDate || '—'}</span></div>
                                {r.syncNotes && (
                                  <div style={{ marginTop: 4 }}>
                                    <div style={{ color: C.muted, marginBottom: 4 }}>Sync Notes:</div>
                                    <div style={{ background: C.card, borderRadius: 4, padding: '8px 10px', fontSize: 10, color: C.text, lineHeight: 1.5, whiteSpace: 'pre-wrap', border: `1px solid ${C.border}` }}>
                                      {r.syncNotes}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const thStyle = {
  padding: '10px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#8fa3be',
  textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid #1a2538',
  whiteSpace: 'nowrap',
};
const tdStyle = {
  padding: '10px 12px', borderBottom: '1px solid #1a253822', whiteSpace: 'nowrap',
  color: '#f0f3f9',
};
