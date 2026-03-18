'use client';
import { useState, useEffect } from 'react';
import { C, fmt, fmtDollar, fmtPct } from '../shared/theme';
import CommissionStatementsTab from './CommissionStatementsTab';

function compareValues(a, b, key) {
  let va = a?.[key], vb = b?.[key];
  if (va == null && vb == null) return 0;
  if (va == null) return 1;
  if (vb == null) return -1;
  const na = typeof va === 'number' ? va : parseFloat(va);
  const nb = typeof vb === 'number' ? vb : parseFloat(vb);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  return String(va).localeCompare(String(vb), undefined, { sensitivity: 'base' });
}
function sortData(data, sortKey, sortDir) {
  if (!sortKey || !data) return data;
  return [...data].sort((a, b) => { const cmp = compareValues(a, b, sortKey); return sortDir === 'desc' ? -cmp : cmp; });
}
function useSort(defaultKey = null, defaultDir = 'asc') {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState(defaultDir);
  const toggle = (key) => { if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortKey(key); setSortDir('asc'); } };
  return { sortKey, sortDir, toggle };
}
function SortTh({ label, field, sortKey, sortDir, onSort, style }) {
  const active = sortKey === field;
  return (
    <th onClick={() => onSort(field)} style={{ ...style, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', color: active ? C.accent : style?.color || C.muted }}>
      {label} <span style={{ fontSize: 8, opacity: active ? 1 : 0.3 }}>{active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
    </th>
  );
}
function Section({ title, children, rightContent }) {
  return (
    <div style={{ marginTop: 20, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1.2 }}>{title}</div>
        {rightContent}
      </div>
      {children}
    </div>
  );
}
function KPICard({ label, value, color, subtitle, tooltip }) {
  return (
    <div title={tooltip || ''} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 16px', minWidth: 120, borderTop: `3px solid ${color || C.accent}`, cursor: tooltip ? 'help' : 'default' }}>
      <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8 }}>
        {label}{tooltip && <span style={{ marginLeft: 4, fontSize: 8, opacity: 0.6 }}>ⓘ</span>}
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || C.text, fontFamily: C.mono, marginTop: 4 }}>{value}</div>
      {subtitle && <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{subtitle}</div>}
    </div>
  );
}

// Parse dates in MM-DD-YYYY or YYYY-MM-DD format
function parseDate(str) {
  if (!str) return null;
  const mdy = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (mdy) return new Date(parseInt(mdy[3]), parseInt(mdy[1]) - 1, parseInt(mdy[2]));
  const ymd = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (ymd) return new Date(parseInt(ymd[1]), parseInt(ymd[2]) - 1, parseInt(ymd[3]));
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

const STATUS_COLORS = {
  active: { bg: C.greenDim, text: C.green, label: 'Comm Active', tooltip: 'Carrier has paid commission advances on this policy' },
  clawback: { bg: C.redDim, text: C.red, label: 'Clawback', tooltip: 'Carrier has charged back (recovered) commission on this policy' },
  pending: { bg: '#2e2a0a', text: '#facc15', label: 'No Commission', tooltip: 'This policy has not appeared in any carrier commission statement yet' },
};

export default function CombinedPoliciesTab() {
  const [subTab, setSubTab] = useState('combined');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [groupBy, setGroupBy] = useState('none');
  const [selectedPolicy, setSelectedPolicy] = useState(null);
  const [cashFlow, setCashFlow] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState(null); // policy to show in modal
  const [cashFlowLoading, setCashFlowLoading] = useState(false);
  const mainSort = useSort('premium', 'desc');
  const unmatchedSort = useSort('commissionAmount', 'desc');

  useEffect(() => {
    fetch('/api/combined-policies')
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setData(d); })
      .catch(e => setError(e.message));
  }, []);

  // Load cash flow when a policy is selected
  useEffect(() => {
    if (!selectedPolicy) { setCashFlow(null); return; }
    if (selectedPolicy.entries === 0) { setCashFlow({ entries: [], totalPaid: 0, totalClawback: 0, netCommission: 0 }); return; }
    setCashFlowLoading(true);
    fetch(`/api/commission-statements/policy/${encodeURIComponent(selectedPolicy.policyNumber)}`)
      .then(r => r.json())
      .then(d => { setCashFlow(d.error ? null : d); setCashFlowLoading(false); })
      .catch(() => { setCashFlow(null); setCashFlowLoading(false); });
  }, [selectedPolicy]);

  const pillStyle = (active) => ({
    background: active ? C.accent : 'transparent',
    border: `1px solid ${active ? C.accent : C.border}`,
    borderRadius: 6, padding: '5px 14px', fontSize: 11, fontWeight: 600,
    color: active ? '#fff' : C.muted, cursor: 'pointer',
  });
  const thStyle = { textAlign: 'left', padding: '6px 10px', fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', borderBottom: `1px solid ${C.border}` };
  const tdStyle = { padding: '6px 10px', fontSize: 11, color: C.text, fontFamily: C.mono, borderBottom: `1px solid ${C.border}` };

  const { policies = [], unmatchedLedger = [], summary = {} } = data || {};

  // Pre-compute dates and days active
  const enriched = policies.map(p => {
    const d = parseDate(p.effectiveDate) || parseDate(p.submitDate);
    return { ...p, _effDateParsed: d, _daysActive: d ? Math.floor((Date.now() - d.getTime()) / 86400000) : null };
  });

  const sorted = sortData(enriched, mainSort.sortKey, mainSort.sortDir);

  // Build groups
  const statusColor = (s) => {
    const v = (s || '').toLowerCase();
    if (v.includes('active') || v.includes('in force')) return C.green;
    if (v.includes('pending') || v.includes('submitted')) return '#facc15';
    if (v.includes('cancel') || v.includes('declined') || v.includes('lapsed') || v.includes('rejected') || v.includes('terminated') || v.includes('not taken')) return C.red;
    if (v.includes('hold') || v.includes('need') || v.includes('not paid')) return '#fb923c'; // orange
    return C.muted;
  };
  const statusBg = (s) => {
    const v = (s || '').toLowerCase();
    if (v.includes('active') || v.includes('in force')) return C.greenDim;
    if (v.includes('pending') || v.includes('submitted')) return '#2e2a0a';
    if (v.includes('cancel') || v.includes('declined') || v.includes('lapsed') || v.includes('rejected') || v.includes('terminated') || v.includes('not taken')) return C.redDim;
    if (v.includes('hold') || v.includes('need') || v.includes('not paid')) return '#2e1a0a'; // dark orange
    return '#1a2538';
  };

  let groups;
  if (groupBy === 'commissionStatus') {
    const map = {};
    sorted.forEach(p => { const k = p.commissionStatus; if (!map[k]) map[k] = []; map[k].push(p); });
    const order = ['pending', 'clawback', 'active'];
    groups = order.filter(k => map[k]).map(k => ({ label: STATUS_COLORS[k]?.label || k, color: STATUS_COLORS[k]?.text || C.muted, policies: map[k] }));
  } else if (groupBy === 'carrier') {
    const map = {};
    sorted.forEach(p => { const k = p.carrier || 'Unknown'; if (!map[k]) map[k] = []; map[k].push(p); });
    groups = Object.entries(map).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => ({ label: k, color: C.accent, policies: v }));
  } else if (groupBy === 'month') {
    const map = {};
    sorted.forEach(p => {
      const d = parseDate(p.submitDate) || parseDate(p.effectiveDate);
      const m = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : 'Unknown';
      if (!map[m]) map[m] = [];
      map[m].push(p);
    });
    groups = Object.entries(map).sort((a, b) => b[0].localeCompare(a[0])).map(([k, v]) => {
      const lbl = k === 'Unknown' ? 'Unknown' : new Date(parseInt(k.split('-')[0]), parseInt(k.split('-')[1]) - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
      return { label: lbl, color: C.accent, policies: v };
    });
  } else if (groupBy === 'status') {
    const map = {};
    sorted.forEach(p => { const k = p.status || 'Unknown'; if (!map[k]) map[k] = []; map[k].push(p); });
    groups = Object.entries(map).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => ({ label: k, color: statusColor(k), policies: v }));
  } else {
    groups = [{ label: 'All Policies', color: C.accent, policies: sorted }];
  }

  const renderRow = (p, i) => {
    const isSelP = selectedPolicy?.policyNumber === p.policyNumber;
    const cs = STATUS_COLORS[p.commissionStatus] || STATUS_COLORS.pending;
    const days = p._daysActive;
    const daysColor = days === null ? C.muted : days > 180 ? C.green : days > 90 ? C.accent : days > 30 ? '#facc15' : C.muted;
    return (
      <tr key={i}
        style={{ cursor: 'pointer', background: isSelP ? 'rgba(91,159,255,0.08)' : 'transparent', borderLeft: isSelP ? `3px solid ${C.accent}` : '3px solid transparent', transition: 'background 0.15s ease' }}
        onClick={() => setSelectedPolicy(isSelP ? null : p)}
        onMouseOver={e => { if (!isSelP) e.currentTarget.style.background = 'rgba(91,159,255,0.05)'; }}
        onMouseOut={e => { if (!isSelP) e.currentTarget.style.background = 'transparent'; }}
      >
        <td style={{ ...tdStyle, width: 28, padding: '6px 4px', textAlign: 'center', fontSize: 12, color: isSelP ? C.accent : C.muted }}>{isSelP ? '▾' : '▸'}</td>
        <td style={tdStyle}>{p.policyNumber}</td>
        <td style={tdStyle}>{p.insuredName}</td>
        <td style={{ ...tdStyle, fontSize: 10 }}>{p.carrier}</td>
        <td style={tdStyle}>{fmtDollar(p.premium)}</td>
        <td style={tdStyle}>{fmtDollar(p.expectedCommission)}</td>
        <td style={{ ...tdStyle, color: p.totalPaid > 0 ? C.green : C.muted }}>{fmtDollar(p.totalPaid)}</td>
        <td style={{ ...tdStyle, color: p.totalClawback > 0 ? C.red : C.muted }}>{fmtDollar(p.totalClawback)}</td>
        <td style={{ ...tdStyle, color: p.netReceived >= 0 ? C.green : C.red, fontWeight: 700 }}>{p.entries > 0 ? fmtDollar(p.netReceived) : '—'}</td>
        <td style={{ ...tdStyle, color: Math.abs(p.balance) < 1 ? C.green : '#facc15' }}>{fmtDollar(p.balance)}</td>
        <td style={{ ...tdStyle, fontSize: 10 }}>{p._effDateParsed ? p._effDateParsed.toLocaleDateString() : '—'}</td>
        <td style={{ ...tdStyle, textAlign: 'center', color: daysColor, fontWeight: 600 }}>{days !== null ? days : '—'}</td>
        <td style={tdStyle}>
          <span title={cs.tooltip || ''} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, fontWeight: 700, background: cs.bg, color: cs.text, cursor: 'help' }}>{cs.label}</span>
        </td>
        <td style={tdStyle}>
          <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, fontWeight: 700, background: statusBg(p.status), color: statusColor(p.status) }}>{p.status || '—'}</span>
        </td>
      </tr>
    );
  };

  const tableHeader = (
    <thead>
      <tr>
        <th style={{ ...thStyle, width: 28, padding: '6px 4px' }}></th>
        <SortTh label="Policy #" field="policyNumber" {...mainSort} onSort={mainSort.toggle} style={thStyle} />
        <SortTh label="Insured" field="insuredName" {...mainSort} onSort={mainSort.toggle} style={thStyle} />
        <SortTh label="Carrier" field="carrier" {...mainSort} onSort={mainSort.toggle} style={thStyle} />
        <SortTh label="Premium" field="premium" {...mainSort} onSort={mainSort.toggle} style={thStyle} />
        <SortTh label="Expected" field="expectedCommission" {...mainSort} onSort={mainSort.toggle} style={thStyle} />
        <SortTh label="Paid" field="totalPaid" {...mainSort} onSort={mainSort.toggle} style={thStyle} />
        <SortTh label="Clawback" field="totalClawback" {...mainSort} onSort={mainSort.toggle} style={thStyle} />
        <SortTh label="Net" field="netReceived" {...mainSort} onSort={mainSort.toggle} style={thStyle} />
        <SortTh label="Balance" field="balance" {...mainSort} onSort={mainSort.toggle} style={thStyle} />
        <SortTh label="Effective" field="effectiveDate" {...mainSort} onSort={mainSort.toggle} style={thStyle} />
        <SortTh label="Days" field="_daysActive" {...mainSort} onSort={mainSort.toggle} style={thStyle} />
        <SortTh label="Comm Status" field="commissionStatus" {...mainSort} onSort={mainSort.toggle} style={thStyle} />
        <SortTh label="Status" field="status" {...mainSort} onSort={mainSort.toggle} style={thStyle} />
      </tr>
    </thead>
  );

  // Search logic
  const searchResults = searchQuery.length >= 2 ? enriched.filter(p => {
    const q = searchQuery.toLowerCase();
    return (p.policyNumber || '').toLowerCase().includes(q) || (p.insuredName || '').toLowerCase().includes(q);
  }).slice(0, 10) : [];

  return (
    <div>
      {/* Search bar + Sub-tab toggle row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {[['combined', 'Combined Policies'], ['commissions', 'Agent Commissions'], ['statements', 'Commission Statements']].map(([val, lbl]) => (
            <button key={val} style={pillStyle(subTab === val)} onClick={() => setSubTab(val)}>{lbl}</button>
          ))}
        </div>
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            placeholder="Search policy # or name..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontSize: 12, padding: '6px 12px', fontFamily: C.mono, width: 240, outline: 'none' }}
          />
          {searchQuery && <span onClick={() => setSearchQuery('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: C.muted, cursor: 'pointer', fontSize: 14 }}>×</span>}
          {/* Search dropdown */}
          {searchResults.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, width: 420, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, zIndex: 100, maxHeight: 360, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
              {searchResults.map((p, i) => {
                const cs = STATUS_COLORS[p.commissionStatus] || STATUS_COLORS.pending;
                return (
                  <div key={i}
                    onClick={() => { setSearchResult(p); setSearchQuery(''); }}
                    style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: i < searchResults.length - 1 ? `1px solid ${C.border}` : 'none', transition: 'background 0.1s' }}
                    onMouseOver={e => e.currentTarget.style.background = 'rgba(91,159,255,0.08)'}
                    onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{p.insuredName}</span>
                        <span style={{ fontSize: 11, color: C.muted, marginLeft: 8, fontFamily: C.mono }}>{p.policyNumber}</span>
                      </div>
                      <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, fontWeight: 700, background: cs.bg, color: cs.text }}>{cs.label}</span>
                    </div>
                    <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>
                      {p.carrier} · {fmtDollar(p.premium)}/mo · {p.agent}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Search Result Modal */}
      {searchResult && <PolicyDetailModal policy={searchResult} onClose={() => setSearchResult(null)} />}

      {subTab === 'statements' && <CommissionStatementsTab />}

      {subTab === 'commissions' && <>
        {error ? <div style={{ color: C.red, padding: 40, textAlign: 'center' }}>Error: {error}</div>
         : !data ? <div style={{ color: C.muted, padding: 40, textAlign: 'center' }}>Loading commission data...</div>
         : <AgentCommissionsView policies={enriched} thStyle={thStyle} tdStyle={tdStyle} />}
      </>}

      {subTab === 'combined' && <>
      {error ? <div style={{ color: C.red, padding: 40, textAlign: 'center' }}>Error: {error}</div>
       : !data ? <div style={{ color: C.muted, padding: 40, textAlign: 'center' }}>Loading combined policy data...</div>
       : <>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 4 }}>Combined Policy Information</div>
        <div style={{ fontSize: 12, color: C.muted }}>
          All policies from the sales tracker cross-referenced with carrier commission statements. Identifies policies without commission activity.
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <KPICard label="Total Policies" value={summary.totalPolicies} color={C.accent} tooltip="All policies from the sales/application tracker" />
        <KPICard label="With Commission" value={summary.withCommission} color={C.green} tooltip="Policies that have at least one carrier commission entry (advance, override, or clawback)" />
        <KPICard label="No Commission Yet" value={summary.pending} color="#facc15" subtitle={fmtDollar(summary.pendingPremium) + ' premium'} tooltip="Policies submitted by agents but not yet appearing in any carrier commission statement. These may need follow-up with the carrier." />
        <KPICard label="Clawbacks" value={summary.clawbacks} color={C.red} tooltip="Policies where the carrier has charged back (recovered) previously paid commission, typically due to cancellation or lapse" />
        <KPICard label="Orphaned Carrier" value={summary.orphaned} color={C.muted} tooltip="Commission entries from carrier statements that could not be matched to any policy in the sales tracker. May indicate missing tracker entries or policy number mismatches." />
        <KPICard label="Total Premium" value={fmtDollar(summary.totalPremium)} color={C.accent} tooltip="Sum of monthly premiums across all policies in the tracker" />
        <KPICard label="Total Received" value={fmtDollar(summary.totalReceived)} color={C.green} tooltip="Net commission received from carriers (advances minus clawbacks) for policies with commission activity" />
      </div>

      {/* Status Financial Impact table */}
      <Section title="Financial Impact by Policy Status">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Status</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Count</th>
                <th style={thStyle}>Premium</th>
                <th style={thStyle}>Expected</th>
                <th style={thStyle}>Paid</th>
                <th style={thStyle}>Clawback</th>
                <th style={thStyle}>Net</th>
                <th style={thStyle}>Balance</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Avg Days</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const statusMap = {};
                enriched.forEach(p => {
                  const s = p.status || 'Unknown';
                  if (!statusMap[s]) statusMap[s] = { status: s, count: 0, premium: 0, expected: 0, paid: 0, clawback: 0, net: 0, balance: 0, daysSum: 0, daysCount: 0 };
                  const row = statusMap[s];
                  row.count++;
                  row.premium += p.premium;
                  row.expected += p.expectedCommission;
                  row.paid += p.totalPaid;
                  row.clawback += p.totalClawback;
                  row.net += p.netReceived;
                  row.balance += p.balance;
                  if (p._daysActive != null) { row.daysSum += p._daysActive; row.daysCount++; }
                });
                const rows = Object.values(statusMap).sort((a, b) => b.count - a.count);
                const totals = rows.reduce((t, r) => ({ count: t.count + r.count, premium: t.premium + r.premium, expected: t.expected + r.expected, paid: t.paid + r.paid, clawback: t.clawback + r.clawback, net: t.net + r.net, balance: t.balance + r.balance, daysSum: t.daysSum + r.daysSum, daysCount: t.daysCount + r.daysCount }), { count: 0, premium: 0, expected: 0, paid: 0, clawback: 0, net: 0, balance: 0, daysSum: 0, daysCount: 0 });
                return (
                  <>
                    {rows.map((r, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : `${C.surface}88` }}>
                        <td style={tdStyle}>
                          <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, fontWeight: 700, background: statusBg(r.status), color: statusColor(r.status) }}>{r.status}</span>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 700 }}>{r.count}</td>
                        <td style={tdStyle}>{fmtDollar(r.premium)}</td>
                        <td style={tdStyle}>{fmtDollar(r.expected)}</td>
                        <td style={{ ...tdStyle, color: r.paid > 0 ? C.green : C.muted }}>{fmtDollar(r.paid)}</td>
                        <td style={{ ...tdStyle, color: r.clawback > 0 ? C.red : C.muted }}>{fmtDollar(r.clawback)}</td>
                        <td style={{ ...tdStyle, color: r.net >= 0 ? C.green : C.red, fontWeight: 700 }}>{fmtDollar(r.net)}</td>
                        <td style={{ ...tdStyle, color: Math.abs(r.balance) < 1 ? C.green : '#facc15' }}>{fmtDollar(r.balance)}</td>
                        <td style={{ ...tdStyle, textAlign: 'center', color: C.muted }}>{r.daysCount > 0 ? Math.round(r.daysSum / r.daysCount) + 'd' : '—'}</td>
                      </tr>
                    ))}
                    <tr style={{ background: C.surface, fontWeight: 700, borderTop: `2px solid ${C.accent}` }}>
                      <td style={{ ...tdStyle, color: C.accent }}>TOTAL</td>
                      <td style={{ ...tdStyle, textAlign: 'center', color: C.accent }}>{totals.count}</td>
                      <td style={tdStyle}>{fmtDollar(totals.premium)}</td>
                      <td style={tdStyle}>{fmtDollar(totals.expected)}</td>
                      <td style={{ ...tdStyle, color: C.green }}>{fmtDollar(totals.paid)}</td>
                      <td style={{ ...tdStyle, color: C.red }}>{fmtDollar(totals.clawback)}</td>
                      <td style={{ ...tdStyle, color: totals.net >= 0 ? C.green : C.red }}>{fmtDollar(totals.net)}</td>
                      <td style={{ ...tdStyle, color: '#facc15' }}>{fmtDollar(totals.balance)}</td>
                      <td style={{ ...tdStyle, textAlign: 'center', color: C.muted }}>{totals.daysCount > 0 ? Math.round(totals.daysSum / totals.daysCount) + 'd' : '—'}</td>
                    </tr>
                  </>
                );
              })()}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Group by toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 10, color: C.muted, fontWeight: 600, textTransform: 'uppercase' }}>Group by:</span>
        {[['none', 'None'], ['commissionStatus', 'Comm Status'], ['status', 'Policy Status'], ['carrier', 'Carrier'], ['month', 'Month']].map(([val, lbl]) => (
          <button key={val} style={pillStyle(groupBy === val)} onClick={() => setGroupBy(val)}>{lbl}</button>
        ))}
      </div>

      {/* Grouped tables */}
      {groups.map((g, gi) => {
        const grpPremium = g.policies.reduce((s, p) => s + p.premium, 0);
        const grpPaid = g.policies.reduce((s, p) => s + p.totalPaid, 0);
        const grpNet = g.policies.reduce((s, p) => s + p.netReceived, 0);
        return (
          <Section key={gi} title={
            groupBy === 'none' ? `All Policies (${g.policies.length})` :
            `${g.label} — ${g.policies.length} ${g.policies.length === 1 ? 'policy' : 'policies'} · Premium ${fmtDollar(grpPremium)} · Net ${fmtDollar(grpNet)}`
          }>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                {tableHeader}
                <tbody>
                  {g.policies.map(renderRow)}
                  {groupBy !== 'none' && g.policies.length > 1 && (
                    <tr style={{ background: C.surface, fontWeight: 700 }}>
                      <td style={tdStyle}></td>
                      <td colSpan={2} style={{ ...tdStyle, fontSize: 10, color: C.muted }}>SUBTOTAL ({g.policies.length})</td>
                      <td style={tdStyle}></td>
                      <td style={tdStyle}>{fmtDollar(grpPremium)}</td>
                      <td style={tdStyle}>{fmtDollar(g.policies.reduce((s, p) => s + p.expectedCommission, 0))}</td>
                      <td style={{ ...tdStyle, color: C.green }}>{fmtDollar(grpPaid)}</td>
                      <td style={{ ...tdStyle, color: C.red }}>{fmtDollar(g.policies.reduce((s, p) => s + p.totalClawback, 0))}</td>
                      <td style={{ ...tdStyle, color: grpNet >= 0 ? C.green : C.red }}>{fmtDollar(grpNet)}</td>
                      <td style={{ ...tdStyle, color: '#facc15' }}>{fmtDollar(g.policies.reduce((s, p) => s + p.balance, 0))}</td>
                      <td style={tdStyle}></td>
                      <td style={{ ...tdStyle, textAlign: 'center', color: C.muted, fontSize: 10 }}>
                        {Math.round(g.policies.filter(p => p._daysActive != null).reduce((s, p) => s + (p._daysActive || 0), 0) / Math.max(1, g.policies.filter(p => p._daysActive != null).length))}d avg
                      </td>
                      <td style={tdStyle}></td>
                      <td style={tdStyle}></td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Section>
        );
      })}

      {/* Cash Flow drill-down for selected policy */}
      {selectedPolicy && (
        <Section title={`Cash Flow — ${selectedPolicy.insuredName} (${selectedPolicy.policyNumber})`}>
          {cashFlowLoading ? (
            <div style={{ color: C.muted, fontSize: 12 }}>Loading cash flow...</div>
          ) : selectedPolicy.entries === 0 ? (
            <div style={{ padding: 20, textAlign: 'center' }}>
              <div style={{ fontSize: 13, color: '#facc15', fontWeight: 700, marginBottom: 6 }}>No Commission Activity</div>
              <div style={{ fontSize: 11, color: C.muted }}>
                This policy ({selectedPolicy.policyNumber}) was submitted on {selectedPolicy.submitDate || '—'} but has not appeared in any carrier commission statement yet.
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
                Premium: {fmtDollar(selectedPolicy.premium)} · Expected Commission: {fmtDollar(selectedPolicy.expectedCommission)} · Status: {selectedPolicy.status}
              </div>
            </div>
          ) : cashFlow ? (() => {
            const entries = (cashFlow.entries || []).slice().sort((a, b) => (a.statementDate || '').localeCompare(b.statementDate || ''));
            let running = 0;
            const withRunning = entries.map(e => { running += e.commissionAmount || 0; return { ...e, runningBalance: running }; });
            return (
              <div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
                  <KPICard label="Premium" value={fmtDollar(selectedPolicy.premium)} color={C.accent} />
                  <KPICard label="Total Paid" value={fmtDollar(cashFlow.totalPaid || 0)} color={C.green} />
                  <KPICard label="Clawbacks" value={fmtDollar(cashFlow.totalClawback || 0)} color={(cashFlow.totalClawback || 0) > 0 ? C.red : C.muted} />
                  <KPICard label="Net Commission" value={fmtDollar(cashFlow.netCommission || 0)} color={(cashFlow.netCommission || 0) >= 0 ? C.green : C.red} />
                </div>
                {withRunning.length > 0 && (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Date</th>
                          <th style={thStyle}>Type</th>
                          <th style={thStyle}>Amount</th>
                          <th style={thStyle}>Running Balance</th>
                          <th style={thStyle}>Statement File</th>
                          <th style={thStyle}>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {withRunning.map((e, i) => (
                          <tr key={i}>
                            <td style={tdStyle}>{e.statementDate ? new Date(e.statementDate).toLocaleDateString() : '—'}</td>
                            <td style={tdStyle}>
                              <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, fontWeight: 700, background: e.transactionType === 'advance' ? C.greenDim : e.transactionType === 'override' ? '#1a2538' : C.redDim, color: e.transactionType === 'advance' ? C.green : e.transactionType === 'override' ? C.accent : C.red }}>{e.transactionType}</span>
                            </td>
                            <td style={{ ...tdStyle, color: e.commissionAmount >= 0 ? C.green : C.red, fontWeight: 700 }}>{fmtDollar(e.commissionAmount)}</td>
                            <td style={{ ...tdStyle, color: e.runningBalance >= 0 ? C.green : C.red, fontWeight: 700 }}>{fmtDollar(e.runningBalance)}</td>
                            <td style={{ ...tdStyle, fontSize: 10, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.statementFile || '—'}</td>
                            <td style={{ ...tdStyle, fontSize: 10, color: C.muted }}>{e.notes || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })() : (
            <div style={{ color: C.red, fontSize: 12 }}>Failed to load cash flow data.</div>
          )}
        </Section>
      )}

      {/* Unmatched carrier records */}
      {unmatchedLedger.length > 0 && (
        <Section title={`Orphaned Carrier Records (${unmatchedLedger.length})`} rightContent={<span style={{ fontSize: 10, color: C.muted }}>Ledger entries with no matching sales tracker policy</span>}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <SortTh label="Policy #" field="policyNumber" {...unmatchedSort} onSort={unmatchedSort.toggle} style={thStyle} />
                  <SortTh label="Insured" field="insuredName" {...unmatchedSort} onSort={unmatchedSort.toggle} style={thStyle} />
                  <SortTh label="Agent" field="agent" {...unmatchedSort} onSort={unmatchedSort.toggle} style={thStyle} />
                  <SortTh label="Carrier" field="carrier" {...unmatchedSort} onSort={unmatchedSort.toggle} style={thStyle} />
                  <SortTh label="Type" field="transactionType" {...unmatchedSort} onSort={unmatchedSort.toggle} style={thStyle} />
                  <SortTh label="Amount" field="commissionAmount" {...unmatchedSort} onSort={unmatchedSort.toggle} style={thStyle} />
                  <SortTh label="Date" field="statementDate" {...unmatchedSort} onSort={unmatchedSort.toggle} style={thStyle} />
                  <SortTh label="File" field="statementFile" {...unmatchedSort} onSort={unmatchedSort.toggle} style={thStyle} />
                </tr>
              </thead>
              <tbody>
                {sortData(unmatchedLedger, unmatchedSort.sortKey, unmatchedSort.sortDir).map((r, i) => (
                  <tr key={i} style={{ background: C.redDim }}>
                    <td style={tdStyle}>{r.policyNumber}</td>
                    <td style={tdStyle}>{r.insuredName}</td>
                    <td style={tdStyle}>{r.agent}</td>
                    <td style={{ ...tdStyle, fontSize: 10 }}>{r.carrier}</td>
                    <td style={tdStyle}>{r.transactionType}</td>
                    <td style={{ ...tdStyle, color: r.commissionAmount >= 0 ? C.green : C.red, fontWeight: 700 }}>{fmtDollar(r.commissionAmount)}</td>
                    <td style={{ ...tdStyle, fontSize: 10 }}>{r.statementDate || '—'}</td>
                    <td style={{ ...tdStyle, fontSize: 10, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.statementFile || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
      </>}
      </>}
    </div>
  );
}

// Agent Commissions sub-view: grouped by agent → month
function AgentCommissionsView({ policies, thStyle, tdStyle }) {
  const [expandedAgent, setExpandedAgent] = useState(null);

  // Build agent → month structure
  const agentMap = {};
  policies.forEach(p => {
    const agent = p.agent || 'Unknown';
    if (!agentMap[agent]) agentMap[agent] = { agent, policies: [], totalPremium: 0, totalPaid: 0, totalClawback: 0, net: 0, policyCount: 0, months: {} };
    const a = agentMap[agent];
    a.policies.push(p);
    a.policyCount++;
    a.totalPremium += p.premium;
    a.totalPaid += p.totalPaid;
    a.totalClawback += p.totalClawback;
    a.net += p.netReceived;

    // Group by month (from effective date)
    const d = p._effDateParsed;
    const mk = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : 'Unknown';
    if (!a.months[mk]) a.months[mk] = { key: mk, policies: [], premium: 0, paid: 0, clawback: 0, net: 0 };
    a.months[mk].policies.push(p);
    a.months[mk].premium += p.premium;
    a.months[mk].paid += p.totalPaid;
    a.months[mk].clawback += p.totalClawback;
    a.months[mk].net += p.netReceived;
  });

  const agents = Object.values(agentMap).sort((a, b) => b.net - a.net);

  const fmtMonth = (k) => {
    if (k === 'Unknown') return 'Unknown';
    const [y, m] = k.split('-');
    return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  };

  // Totals
  const grandPremium = agents.reduce((s, a) => s + a.totalPremium, 0);
  const grandPaid = agents.reduce((s, a) => s + a.totalPaid, 0);
  const grandClawback = agents.reduce((s, a) => s + a.totalClawback, 0);
  const grandNet = agents.reduce((s, a) => s + a.net, 0);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 4 }}>Agent Commissions Received</div>
        <div style={{ fontSize: 12, color: C.muted }}>
          Carrier commission payments grouped by agent, then by month. Click an agent to see monthly breakdown and policy detail.
        </div>
      </div>

      {/* Summary KPIs */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <KPICard label="Agents" value={agents.length} color={C.accent} />
        <KPICard label="Total Premium" value={fmtDollar(grandPremium)} color={C.accent} />
        <KPICard label="Total Paid" value={fmtDollar(grandPaid)} color={C.green} />
        <KPICard label="Total Clawback" value={fmtDollar(grandClawback)} color={grandClawback > 0 ? C.red : C.muted} />
        <KPICard label="Net Received" value={fmtDollar(grandNet)} color={grandNet >= 0 ? C.green : C.red} />
      </div>

      {/* Agent summary table */}
      <Section title="By Agent">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: 28, padding: '6px 4px' }}></th>
                <th style={thStyle}>Agent</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Policies</th>
                <th style={thStyle}>Premium</th>
                <th style={thStyle}>Paid</th>
                <th style={thStyle}>Clawback</th>
                <th style={thStyle}>Net</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a, i) => {
                const isExp = expandedAgent === a.agent;
                return (
                  <tr key={i}
                    style={{ cursor: 'pointer', background: isExp ? 'rgba(91,159,255,0.08)' : 'transparent', borderLeft: isExp ? `3px solid ${C.accent}` : '3px solid transparent' }}
                    onClick={() => setExpandedAgent(isExp ? null : a.agent)}
                    onMouseOver={e => { if (!isExp) e.currentTarget.style.background = 'rgba(91,159,255,0.05)'; }}
                    onMouseOut={e => { if (!isExp) e.currentTarget.style.background = isExp ? 'rgba(91,159,255,0.08)' : 'transparent'; }}
                  >
                    <td style={{ ...tdStyle, width: 28, padding: '6px 4px', textAlign: 'center', fontSize: 12, color: isExp ? C.accent : C.muted }}>{isExp ? '▾' : '▸'}</td>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>{a.agent}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{a.policyCount}</td>
                    <td style={tdStyle}>{fmtDollar(a.totalPremium)}</td>
                    <td style={{ ...tdStyle, color: a.totalPaid > 0 ? C.green : C.muted }}>{fmtDollar(a.totalPaid)}</td>
                    <td style={{ ...tdStyle, color: a.totalClawback > 0 ? C.red : C.muted }}>{fmtDollar(a.totalClawback)}</td>
                    <td style={{ ...tdStyle, color: a.net >= 0 ? C.green : C.red, fontWeight: 700 }}>{fmtDollar(a.net)}</td>
                  </tr>
                );
              })}
              <tr style={{ background: C.surface, fontWeight: 700, borderTop: `2px solid ${C.accent}` }}>
                <td style={tdStyle}></td>
                <td style={{ ...tdStyle, color: C.accent }}>TOTAL</td>
                <td style={{ ...tdStyle, textAlign: 'center', color: C.accent }}>{policies.length}</td>
                <td style={tdStyle}>{fmtDollar(grandPremium)}</td>
                <td style={{ ...tdStyle, color: C.green }}>{fmtDollar(grandPaid)}</td>
                <td style={{ ...tdStyle, color: C.red }}>{fmtDollar(grandClawback)}</td>
                <td style={{ ...tdStyle, color: grandNet >= 0 ? C.green : C.red }}>{fmtDollar(grandNet)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      {/* Expanded agent detail: by month → policies */}
      {expandedAgent && agentMap[expandedAgent] && (() => {
        const a = agentMap[expandedAgent];
        const months = Object.values(a.months).sort((x, y) => y.key.localeCompare(x.key));
        return (
          <>
            {/* Agent KPIs */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16, marginBottom: 8 }}>
              <KPICard label="Agent" value={a.agent} color={C.text} />
              <KPICard label="Policies" value={a.policyCount} color={C.accent} />
              <KPICard label="Premium" value={fmtDollar(a.totalPremium)} color={C.accent} />
              <KPICard label="Paid" value={fmtDollar(a.totalPaid)} color={C.green} />
              <KPICard label="Clawback" value={fmtDollar(a.totalClawback)} color={a.totalClawback > 0 ? C.red : C.muted} />
              <KPICard label="Net" value={fmtDollar(a.net)} color={a.net >= 0 ? C.green : C.red} />
            </div>

            {/* Monthly sections */}
            {months.map((m, mi) => (
              <Section key={mi} title={`${fmtMonth(m.key)} — ${m.policies.length} ${m.policies.length === 1 ? 'policy' : 'policies'} · Premium ${fmtDollar(m.premium)} · Net ${fmtDollar(m.net)}`}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Policy #</th>
                        <th style={thStyle}>Insured</th>
                        <th style={thStyle}>Carrier</th>
                        <th style={thStyle}>Premium</th>
                        <th style={thStyle}>Expected</th>
                        <th style={thStyle}>Paid</th>
                        <th style={thStyle}>Clawback</th>
                        <th style={thStyle}>Net</th>
                        <th style={thStyle}>Effective</th>
                        <th style={thStyle}>Days</th>
                        <th style={thStyle}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.policies.map((p, pi) => {
                        const days = p._daysActive;
                        const daysColor = days === null ? C.muted : days > 180 ? C.green : days > 90 ? C.accent : days > 30 ? '#facc15' : C.muted;
                        const sc = (s) => { const v = (s||'').toLowerCase(); if (v.includes('active') || v.includes('in force')) return C.green; if (v.includes('pending') || v.includes('submitted')) return '#facc15'; if (v.includes('cancel') || v.includes('declined') || v.includes('lapsed')) return C.red; if (v.includes('hold') || v.includes('need')) return '#fb923c'; return C.muted; };
                        const sb = (s) => { const v = (s||'').toLowerCase(); if (v.includes('active') || v.includes('in force')) return C.greenDim; if (v.includes('pending') || v.includes('submitted')) return '#2e2a0a'; if (v.includes('cancel') || v.includes('declined') || v.includes('lapsed')) return C.redDim; if (v.includes('hold') || v.includes('need')) return '#2e1a0a'; return '#1a2538'; };
                        return (
                          <tr key={pi}>
                            <td style={tdStyle}>{p.policyNumber}</td>
                            <td style={tdStyle}>{p.insuredName}</td>
                            <td style={{ ...tdStyle, fontSize: 10 }}>{p.carrier}</td>
                            <td style={tdStyle}>{fmtDollar(p.premium)}</td>
                            <td style={tdStyle}>{fmtDollar(p.expectedCommission)}</td>
                            <td style={{ ...tdStyle, color: p.totalPaid > 0 ? C.green : C.muted }}>{fmtDollar(p.totalPaid)}</td>
                            <td style={{ ...tdStyle, color: p.totalClawback > 0 ? C.red : C.muted }}>{fmtDollar(p.totalClawback)}</td>
                            <td style={{ ...tdStyle, color: p.netReceived >= 0 ? C.green : C.red, fontWeight: 700 }}>{p.entries > 0 ? fmtDollar(p.netReceived) : '—'}</td>
                            <td style={{ ...tdStyle, fontSize: 10 }}>{p._effDateParsed ? p._effDateParsed.toLocaleDateString() : '—'}</td>
                            <td style={{ ...tdStyle, textAlign: 'center', color: daysColor, fontWeight: 600 }}>{days !== null ? days : '—'}</td>
                            <td style={tdStyle}>
                              <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, fontWeight: 700, background: sb(p.status), color: sc(p.status) }}>{p.status || '—'}</span>
                            </td>
                          </tr>
                        );
                      })}
                      {m.policies.length > 1 && (
                        <tr style={{ background: C.surface, fontWeight: 700 }}>
                          <td colSpan={3} style={{ ...tdStyle, fontSize: 10, color: C.muted }}>SUBTOTAL ({m.policies.length})</td>
                          <td style={tdStyle}>{fmtDollar(m.premium)}</td>
                          <td style={tdStyle}>{fmtDollar(m.policies.reduce((s, p) => s + p.expectedCommission, 0))}</td>
                          <td style={{ ...tdStyle, color: C.green }}>{fmtDollar(m.paid)}</td>
                          <td style={{ ...tdStyle, color: C.red }}>{fmtDollar(m.clawback)}</td>
                          <td style={{ ...tdStyle, color: m.net >= 0 ? C.green : C.red }}>{fmtDollar(m.net)}</td>
                          <td colSpan={3} style={tdStyle}></td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Section>
            ))}
          </>
        );
      })()}
    </div>
  );
}

// Modal overlay showing full policy detail + cash flow
function PolicyDetailModal({ policy, onClose }) {
  const [cashData, setCashData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (policy.entries > 0) {
      fetch(`/api/commission-statements/policy/${encodeURIComponent(policy.policyNumber)}`)
        .then(r => r.json())
        .then(d => { setCashData(d.error ? null : d); setLoading(false); })
        .catch(() => { setCashData(null); setLoading(false); });
    } else {
      setLoading(false);
    }
  }, [policy]);

  const thStyle = { textAlign: 'left', padding: '6px 10px', fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', borderBottom: `1px solid ${C.border}` };
  const tdStyle = { padding: '6px 10px', fontSize: 11, color: C.text, fontFamily: C.mono, borderBottom: `1px solid ${C.border}` };
  const cs = STATUS_COLORS[policy.commissionStatus] || STATUS_COLORS.pending;
  const d = parseDate(policy.effectiveDate) || parseDate(policy.submitDate);
  const days = d ? Math.floor((Date.now() - d.getTime()) / 86400000) : null;

  const sc = (s) => { const v = (s||'').toLowerCase(); if (v.includes('active') || v.includes('in force')) return C.green; if (v.includes('pending') || v.includes('submitted')) return '#facc15'; if (v.includes('cancel') || v.includes('declined') || v.includes('lapsed')) return C.red; if (v.includes('hold') || v.includes('need')) return '#fb923c'; return C.muted; };
  const sb = (s) => { const v = (s||'').toLowerCase(); if (v.includes('active') || v.includes('in force')) return C.greenDim; if (v.includes('pending') || v.includes('submitted')) return '#2e2a0a'; if (v.includes('cancel') || v.includes('declined') || v.includes('lapsed')) return C.redDim; if (v.includes('hold') || v.includes('need')) return '#2e1a0a'; return '#1a2538'; };

  // Cash flow running balance
  const entries = cashData ? (cashData.entries || []).slice().sort((a, b) => (a.statementDate || '').localeCompare(b.statementDate || '')) : [];
  let running = 0;
  const withRunning = entries.map(e => { running += e.commissionAmount || 0; return { ...e, runningBalance: running }; });

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: 40, overflowY: 'auto' }}
      onClick={onClose}
    >
      <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, width: '90%', maxWidth: 1100, maxHeight: 'calc(100vh - 80px)', overflowY: 'auto', padding: 24 }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{policy.insuredName}</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
              Policy {policy.policyNumber} · {policy.carrier} · {policy.agent}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, color: C.muted, fontSize: 14, padding: '4px 12px', cursor: 'pointer' }}>✕ Close</button>
        </div>

        {/* KPI cards */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
          <KPICard label="Premium" value={fmtDollar(policy.premium)} color={C.accent} />
          <KPICard label="Expected" value={fmtDollar(policy.expectedCommission)} color={C.muted} />
          <KPICard label="Paid" value={fmtDollar(policy.totalPaid)} color={policy.totalPaid > 0 ? C.green : C.muted} />
          <KPICard label="Clawback" value={fmtDollar(policy.totalClawback)} color={policy.totalClawback > 0 ? C.red : C.muted} />
          <KPICard label="Net" value={fmtDollar(policy.netReceived)} color={policy.netReceived >= 0 ? C.green : C.red} />
          <KPICard label="Balance" value={fmtDollar(policy.balance)} color={Math.abs(policy.balance) < 1 ? C.green : '#facc15'} />
          <KPICard label="Days Active" value={days !== null ? days : '—'} color={C.accent} />
        </div>

        {/* Policy details grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 1, padding: 1, background: C.border, borderRadius: 8, overflow: 'hidden', marginBottom: 20 }}>
          {[
            ['Policy #', policy.policyNumber],
            ['Insured', policy.insuredName],
            ['Agent', policy.agent],
            ['Carrier', policy.carrier],
            ['Product', policy.product || '—'],
            ['Monthly Premium', fmtDollar(policy.premium)],
            ['Effective Date', d ? d.toLocaleDateString() : '—'],
            ['Submit Date', policy.submitDate || '—'],
            ['Policy Status', policy.status || '—'],
            ['Comm Status', cs.label],
            ['Expected Commission', fmtDollar(policy.expectedCommission)],
            ['Ledger Entries', policy.entries],
          ].map(([label, val], i) => (
            <div key={i} style={{ background: C.card, padding: '8px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: C.muted, fontWeight: 600 }}>{label}</span>
              <span style={{ fontSize: 12, color: label === 'Policy Status' ? sc(String(val)) : label === 'Comm Status' ? cs.text : C.text, fontFamily: C.mono, fontWeight: 600 }}>{val}</span>
            </div>
          ))}
        </div>

        {/* Commission Cash Flow */}
        <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Commission Cash Flow</div>
        {loading ? (
          <div style={{ color: C.muted, fontSize: 12 }}>Loading...</div>
        ) : policy.entries === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', background: C.card, borderRadius: 8, border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 13, color: '#facc15', fontWeight: 700, marginBottom: 4 }}>No Commission Activity</div>
            <div style={{ fontSize: 11, color: C.muted }}>This policy has not appeared in any carrier commission statement yet.</div>
          </div>
        ) : withRunning.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Amount</th>
                  <th style={thStyle}>Running Balance</th>
                  <th style={thStyle}>Statement File</th>
                  <th style={thStyle}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {withRunning.map((e, i) => (
                  <tr key={i}>
                    <td style={tdStyle}>{e.statementDate ? new Date(e.statementDate).toLocaleDateString() : '—'}</td>
                    <td style={tdStyle}>
                      <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, fontWeight: 700, background: e.transactionType === 'advance' ? C.greenDim : e.transactionType === 'override' ? '#1a2538' : C.redDim, color: e.transactionType === 'advance' ? C.green : e.transactionType === 'override' ? C.accent : C.red }}>{e.transactionType}</span>
                    </td>
                    <td style={{ ...tdStyle, color: e.commissionAmount >= 0 ? C.green : C.red, fontWeight: 700 }}>{fmtDollar(e.commissionAmount)}</td>
                    <td style={{ ...tdStyle, color: e.runningBalance >= 0 ? C.green : C.red, fontWeight: 700 }}>{fmtDollar(e.runningBalance)}</td>
                    <td style={{ ...tdStyle, fontSize: 10 }}>{e.statementFile || '—'}</td>
                    <td style={{ ...tdStyle, fontSize: 10, color: C.muted }}>{e.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ color: C.muted, fontSize: 12 }}>No ledger entries found.</div>
        )}
      </div>
    </div>
  );
}
