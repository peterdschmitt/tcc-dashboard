'use client';
import { useState, useEffect, useMemo } from 'react';

const C = {
  bg: '#080b10', surface: '#0f1520', card: '#131b28', border: '#1a2538',
  text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff', accentDim: '#1e3a5f',
  green: '#4ade80', greenDim: '#0a2e1a', yellow: '#facc15', yellowDim: '#2e2a0a',
  red: '#f87171', redDim: '#2e0a0a', purple: '#a78bfa', cyan: '#22d3ee',
  orange: '#fb923c', gray: '#64748b',
  mono: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
  sans: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
};

const STATUS_COLORS = {
  'Active - In Force': C.green,
  'Active - No commission paid yet': C.cyan,
  'Active - Past Due': C.green,
  'Issued, Not yet Active': C.purple,
  'Pending - Requirements Missing': C.yellow,
  'Pending - Requirements MIssing': C.yellow,
  'Pending - Agent State Appt': C.yellow,
  'Canceled': C.red, 'Cancelled': C.red,
  'Declined': C.orange,
  'Initial Pay Failure': C.gray,
  'Unknown': C.gray,
  'not in system yet': C.gray,
  '(No Status)': C.gray,
};

const STATUS_ICONS = {
  'Active - In Force': '●', 'Active - No commission paid yet': '●', 'Active - Past Due': '●',
  'Issued, Not yet Active': '●',
  'Pending - Requirements Missing': '◐', 'Pending - Requirements MIssing': '◐', 'Pending - Agent State Appt': '◐',
  'Canceled': '✗', 'Cancelled': '✗', 'Declined': '✗',
  'Initial Pay Failure': '◯', 'Unknown': '◯', 'not in system yet': '◯', '(No Status)': '◯',
};

const STATUS_ORDER = [
  'Active - In Force', 'Active - No commission paid yet', 'Active - Past Due',
  'Issued, Not yet Active', 'Pending - Requirements Missing', 'Pending - Agent State Appt', 'Initial Pay Failure',
  'Canceled', 'Declined',
  'Unknown', 'not in system yet', '(No Status)',
];

function statusSortIndex(s) {
  const idx = STATUS_ORDER.indexOf(s);
  return idx >= 0 ? idx : STATUS_ORDER.length;
}

function normalizeStatusKey(s) {
  if (s === 'Pending - Requirements MIssing') return 'Pending - Requirements Missing';
  if (s === 'Cancelled') return 'Canceled';
  return s;
}

function fmtDollar(n) {
  if (n == null || isNaN(n)) return '—';
  return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function getCarrierGroup(carrier) {
  const c = (carrier || '').toLowerCase();
  if (c.includes('cica') && c.includes('giwl')) return 'CICA (Credit/Debit)';
  if (c.includes('cica')) return 'CICA (Checking)';
  if (c.includes('aig') || c.includes('corebridge')) return 'AIG Corebridge';
  if (c.includes('amicable') || c.includes('occidental')) return 'American Amicable';
  if (c.includes('transamerica')) return 'TransAmerica';
  if (c.includes('baltimore')) return 'Baltimore Life';
  return carrier || 'Unknown';
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

function KPICard({ label, value, color, subtitle }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
      padding: '12px 16px', minWidth: 120, borderTop: `3px solid ${color || C.accent}`,
    }}>
      <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || C.text, fontFamily: C.mono, marginTop: 4 }}>{value}</div>
      {subtitle && <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{subtitle}</div>}
    </div>
  );
}

export default function CommissionStatusTable() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [drillStatus, setDrillStatus] = useState(null);
  const [sortKey, setSortKey] = useState('_order');
  const [sortDir, setSortDir] = useState('asc');
  const [detailSortKey, setDetailSortKey] = useState('premium');
  const [detailSortDir, setDetailSortDir] = useState('desc');

  useEffect(() => {
    fetch('/api/commission-statements?view=waterfall')
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const policies = data?.policies || [];

  const statusRows = useMemo(() => {
    const map = {};
    for (const p of policies) {
      const status = normalizeStatusKey(p.status || '(No Status)');
      if (!map[status]) map[status] = { status, count: 0, paid: 0, unpaid: 0, premium: 0, expected: 0, received: 0, clawback: 0, netReceived: 0, balance: 0, policies: [] };
      const r = map[status];
      r.count++;
      if (p.carrierPaid) r.paid++; else r.unpaid++;
      r.premium += p.premium || 0;
      r.expected += p.expectedCommission || 0;
      r.received += p.totalPaid || 0;
      r.clawback += p.totalClawback || 0;
      r.netReceived += p.netReceived || 0;
      r.balance += p.balance || 0;
      r.policies.push(p);
    }
    return Object.values(map);
  }, [policies]);

  const totals = useMemo(() => {
    return statusRows.reduce((t, r) => ({
      count: t.count + r.count, paid: t.paid + r.paid, unpaid: t.unpaid + r.unpaid,
      premium: t.premium + r.premium, expected: t.expected + r.expected,
      received: t.received + r.received, clawback: t.clawback + r.clawback,
      netReceived: t.netReceived + r.netReceived, balance: t.balance + r.balance,
    }), { count: 0, paid: 0, unpaid: 0, premium: 0, expected: 0, received: 0, clawback: 0, netReceived: 0, balance: 0 });
  }, [statusRows]);

  const sorted = useMemo(() => {
    return [...statusRows].sort((a, b) => {
      if (sortKey === '_order') {
        const diff = statusSortIndex(a.status) - statusSortIndex(b.status);
        return sortDir === 'asc' ? diff : -diff;
      }
      const va = a[sortKey], vb = b[sortKey];
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortDir === 'asc' ? (va || 0) - (vb || 0) : (vb || 0) - (va || 0);
    });
  }, [statusRows, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const toggleDetailSort = (key) => {
    if (detailSortKey === key) setDetailSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setDetailSortKey(key); setDetailSortDir('desc'); }
  };

  if (loading) return (
    <div style={{ textAlign: 'center', padding: 40, color: C.muted }}>
      <div style={{ width: 30, height: 30, border: `2px solid ${C.border}`, borderTopColor: C.accent, borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
      Loading commission data...
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  const thStyle = { padding: '6px 8px', fontSize: 9, color: C.muted, fontWeight: 600, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', textAlign: 'left' };
  const thRight = { ...thStyle, textAlign: 'right' };
  const tdStyle = { padding: '5px 8px', fontSize: 10, borderBottom: `1px solid ${C.border}33` };
  const tdRight = { ...tdStyle, textAlign: 'right', fontFamily: C.mono };

  const SortTh = ({ label, field, align = 'left' }) => (
    <th style={align === 'right' ? thRight : thStyle} onClick={() => drillStatus ? toggleDetailSort(field) : toggleSort(field)}>
      {label} <span style={{ fontSize: 7, opacity: (drillStatus ? detailSortKey : sortKey) === field ? 1 : 0.3 }}>
        {(drillStatus ? detailSortKey : sortKey) === field ? ((drillStatus ? detailSortDir : sortDir) === 'asc' ? '▲' : '▼') : '⇅'}
      </span>
    </th>
  );

  // Drill-down view
  if (drillStatus) {
    const row = statusRows.find(r => r.status === drillStatus);
    if (!row) { setDrillStatus(null); return null; }

    const detailPolicies = [...row.policies].sort((a, b) => {
      const va = a[detailSortKey], vb = b[detailSortKey];
      if (typeof va === 'string') return detailSortDir === 'asc' ? (va || '').localeCompare(vb || '') : (vb || '').localeCompare(va || '');
      return detailSortDir === 'asc' ? (va || 0) - (vb || 0) : (vb || 0) - (va || 0);
    });

    const sc = STATUS_COLORS[drillStatus] || C.gray;

    return (
      <>
        {/* KPI cards */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <KPICard label="Policies" value={row.count} color={sc} subtitle={`${row.paid} paid / ${row.unpaid} unpaid`} />
          <KPICard label="Mo Premium" value={fmtDollar(Math.round(row.premium))} color={C.text} />
          <KPICard label="Expected" value={fmtDollar(Math.round(row.expected))} color={C.accent} />
          <KPICard label="Received" value={fmtDollar(Math.round(row.received))} color={row.received > 0 ? C.green : C.muted} />
          <KPICard label="Clawback" value={fmtDollar(Math.round(row.clawback))} color={row.clawback > 0 ? C.red : C.muted} />
          <KPICard label="Balance" value={fmtDollar(Math.round(row.balance))} color={row.balance > 0 ? C.yellow : C.green} />
        </div>

        <Section title={`${drillStatus} — ${row.count} Policies`} rightContent={
          <button onClick={() => setDrillStatus(null)} style={{
            padding: '4px 12px', borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: 'pointer',
            background: C.accentDim, color: C.accent, border: `1px solid ${C.accent}33`,
          }}>← Back to Summary</button>
        }>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  <SortTh label="Policy #" field="policyNumber" />
                  <SortTh label="Insured" field="insuredName" />
                  <SortTh label="Carrier" field="carrier" />
                  <SortTh label="Agent" field="agent" />
                  <SortTh label="Mo Premium" field="premium" align="right" />
                  <SortTh label="Expected" field="expectedCommission" align="right" />
                  <SortTh label="Received" field="totalPaid" align="right" />
                  <SortTh label="Clawback" field="totalClawback" align="right" />
                  <SortTh label="Net Recv" field="netReceived" align="right" />
                  <SortTh label="Balance" field="balance" align="right" />
                  <SortTh label="Eff Date" field="effectiveDate" />
                  <th style={{ ...thStyle, textAlign: 'center' }}>Paid?</th>
                </tr>
              </thead>
              <tbody>
                {detailPolicies.map((p, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(91,159,255,0.02)' }}>
                    <td style={{ ...tdStyle, color: C.text, fontFamily: C.mono, fontSize: 9 }}>{p.policyNumber || '—'}</td>
                    <td style={{ ...tdStyle, color: C.text }}>{p.insuredName || '—'}</td>
                    <td style={{ ...tdStyle, color: C.muted, fontSize: 9 }}>{getCarrierGroup(p.carrier)}</td>
                    <td style={{ ...tdStyle, color: C.muted }}>{p.agent || '—'}</td>
                    <td style={tdRight}>{fmtDollar(p.premium)}</td>
                    <td style={tdRight}>{fmtDollar(Math.round(p.expectedCommission))}</td>
                    <td style={{ ...tdRight, color: p.totalPaid > 0 ? C.green : C.muted }}>{p.totalPaid > 0 ? fmtDollar(Math.round(p.totalPaid)) : '—'}</td>
                    <td style={{ ...tdRight, color: p.totalClawback > 0 ? C.red : C.muted }}>{p.totalClawback > 0 ? fmtDollar(Math.round(p.totalClawback)) : '—'}</td>
                    <td style={{ ...tdRight, color: p.netReceived > 0 ? C.green : p.netReceived < 0 ? C.red : C.muted }}>
                      {p.entries > 0 ? fmtDollar(Math.round(p.netReceived)) : '—'}
                    </td>
                    <td style={{ ...tdRight, color: p.balance > 0 ? C.yellow : p.balance < 0 ? C.green : C.muted, fontWeight: 600 }}>
                      {fmtDollar(Math.round(p.balance))}
                    </td>
                    <td style={{ ...tdStyle, fontFamily: C.mono, fontSize: 9 }}>{p.effectiveDate || '—'}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <span style={{ color: p.carrierPaid ? C.green : C.red, fontWeight: 700, fontSize: 11 }}>{p.carrierPaid ? '✓' : '✗'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </>
    );
  }

  // Summary view
  return (
    <>
      {/* KPI cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <KPICard label="Total Policies" value={totals.count} color={C.accent} subtitle={`${totals.paid} paid / ${totals.unpaid} unpaid`} />
        <KPICard label="Mo Premium" value={fmtDollar(Math.round(totals.premium))} color={C.text} />
        <KPICard label="Expected" value={fmtDollar(Math.round(totals.expected))} color={C.accent} />
        <KPICard label="Received" value={fmtDollar(Math.round(totals.received))} color={totals.received > 0 ? C.green : C.muted} />
        <KPICard label="Clawback" value={fmtDollar(Math.round(totals.clawback))} color={totals.clawback > 0 ? C.red : C.muted} />
        <KPICard label="Outstanding" value={fmtDollar(Math.round(totals.balance))} color={totals.balance > 0 ? C.yellow : C.green} />
      </div>

      <Section title="Commission Status Summary">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                <SortTh label="Status" field="status" />
                <SortTh label="# Policies" field="count" align="right" />
                <SortTh label="# Paid" field="paid" align="right" />
                <SortTh label="# Unpaid" field="unpaid" align="right" />
                <SortTh label="Mo Premium" field="premium" align="right" />
                <SortTh label="Expected" field="expected" align="right" />
                <SortTh label="Received" field="received" align="right" />
                <SortTh label="Clawback" field="clawback" align="right" />
                <SortTh label="Net Recv" field="netReceived" align="right" />
                <SortTh label="Balance" field="balance" align="right" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const sc = STATUS_COLORS[r.status] || C.gray;
                const icon = STATUS_ICONS[r.status] || '◯';
                return (
                  <tr key={r.status}
                    onClick={() => setDrillStatus(r.status)}
                    style={{ cursor: 'pointer', borderBottom: `1px solid ${C.border}33` }}
                    onMouseOver={e => e.currentTarget.style.background = 'rgba(91,159,255,0.05)'}
                    onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ ...tdStyle, color: sc, fontWeight: 600 }}>
                      <span style={{ marginRight: 4 }}>{icon}</span>{r.status}
                    </td>
                    <td style={{ ...tdRight, color: C.text, fontWeight: 600 }}>{r.count}</td>
                    <td style={{ ...tdRight, color: r.paid > 0 ? C.green : C.muted, fontWeight: 600 }}>{r.paid}</td>
                    <td style={{ ...tdRight, color: r.unpaid > 0 ? C.red : C.muted }}>{r.unpaid}</td>
                    <td style={tdRight}>{fmtDollar(Math.round(r.premium))}</td>
                    <td style={tdRight}>{fmtDollar(Math.round(r.expected))}</td>
                    <td style={{ ...tdRight, color: r.received > 0 ? C.green : C.muted }}>{fmtDollar(Math.round(r.received))}</td>
                    <td style={{ ...tdRight, color: r.clawback > 0 ? C.red : C.muted }}>{r.clawback > 0 ? fmtDollar(Math.round(r.clawback)) : '—'}</td>
                    <td style={{ ...tdRight, color: r.netReceived > 0 ? C.green : r.netReceived < 0 ? C.red : C.muted }}>
                      {fmtDollar(Math.round(r.netReceived))}
                    </td>
                    <td style={{ ...tdRight, color: r.balance > 0 ? C.yellow : r.balance < 0 ? C.green : C.muted, fontWeight: 600 }}>
                      {fmtDollar(Math.round(r.balance))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: `2px solid ${C.accent}` }}>
                <td style={{ ...tdStyle, fontWeight: 700, color: C.text }}>TOTAL</td>
                <td style={{ ...tdRight, fontWeight: 700, color: C.text }}>{totals.count}</td>
                <td style={{ ...tdRight, fontWeight: 700, color: C.green }}>{totals.paid}</td>
                <td style={{ ...tdRight, fontWeight: 700, color: C.red }}>{totals.unpaid}</td>
                <td style={{ ...tdRight, fontWeight: 700 }}>{fmtDollar(Math.round(totals.premium))}</td>
                <td style={{ ...tdRight, fontWeight: 700, color: C.accent }}>{fmtDollar(Math.round(totals.expected))}</td>
                <td style={{ ...tdRight, fontWeight: 700, color: C.green }}>{fmtDollar(Math.round(totals.received))}</td>
                <td style={{ ...tdRight, fontWeight: 700, color: totals.clawback > 0 ? C.red : C.muted }}>{fmtDollar(Math.round(totals.clawback))}</td>
                <td style={{ ...tdRight, fontWeight: 700, color: C.green }}>{fmtDollar(Math.round(totals.netReceived))}</td>
                <td style={{ ...tdRight, fontWeight: 700, color: C.yellow }}>{fmtDollar(Math.round(totals.balance))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div style={{ fontSize: 9, color: C.muted, marginTop: 8 }}>Click any row to see individual policies</div>
      </Section>
    </>
  );
}
