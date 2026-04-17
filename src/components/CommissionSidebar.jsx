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
  'Canceled': C.red,
  'Cancelled': C.red,
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
  // Active / Producing
  'Active - In Force',
  'Active - No commission paid yet',
  'Active - Past Due',
  // In Process
  'Issued, Not yet Active',
  'Pending - Requirements Missing',
  'Pending - Agent State Appt',
  'Initial Pay Failure',
  // Gone
  'Canceled',
  'Declined',
  // Unknown
  'Unknown',
  'not in system yet',
  '(No Status)',
];

function statusSortIndex(s) {
  const idx = STATUS_ORDER.indexOf(s);
  return idx >= 0 ? idx : STATUS_ORDER.length;
}

// Merge the typo variant
function normalizeStatusKey(s) {
  if (s === 'Pending - Requirements MIssing') return 'Pending - Requirements Missing';
  if (s === 'Cancelled') return 'Canceled';
  return s;
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

function fmtDollar(n) {
  if (n == null || isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1000) return (n < 0 ? '-$' : '$') + (abs / 1000).toFixed(abs >= 10000 ? 0 : 1) + 'K';
  return (n < 0 ? '-$' : '$') + abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtDollarFull(n) {
  if (n == null || isNaN(n)) return '—';
  return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtPct(n) {
  if (n == null || isNaN(n) || !isFinite(n)) return '';
  return (n > 0 ? '▲' : '▼') + ' ' + Math.abs(n).toFixed(0) + '%';
}

// Simple donut chart using SVG
function DonutChart({ slices, centerTop, centerBottom, size = 75 }) {
  const r = 40, circ = 2 * Math.PI * r;
  const total = slices.reduce((s, sl) => s + sl.value, 0);
  let offset = 0;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} style={{ display: 'block', margin: '0 auto' }}>
      {slices.map((sl, i) => {
        const pct = total > 0 ? sl.value / total : 0;
        const dash = pct * circ;
        const el = (
          <circle key={i} cx="50" cy="50" r={r} fill="none" stroke={sl.color} strokeWidth="14"
            strokeDasharray={`${dash} ${circ}`} strokeDashoffset={-offset} transform="rotate(-90 50 50)" />
        );
        offset += dash;
        return el;
      })}
      <text x="50" y={centerBottom ? 44 : 50} textAnchor="middle" fill={C.text} fontSize="12" fontWeight="800" fontFamily={C.mono}>{centerTop}</text>
      {centerBottom && <text x="50" y="56" textAnchor="middle" fill={C.muted} fontSize="7" fontFamily={C.mono}>{centerBottom}</text>}
    </svg>
  );
}

// Policy detail drill-down
function PolicyDrillDown({ policies, title, onBack }) {
  const [sortKey, setSortKey] = useState('premium');
  const [sortDir, setSortDir] = useState('desc');

  const toggle = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const sorted = [...policies].sort((a, b) => {
    let va = a[sortKey], vb = b[sortKey];
    if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    return sortDir === 'asc' ? (va || 0) - (vb || 0) : (vb || 0) - (va || 0);
  });

  const thStyle = { padding: '5px 4px', fontSize: 9, color: C.accent, fontWeight: 600, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' };
  const tdStyle = { padding: '4px', fontSize: 9, borderBottom: `1px solid ${C.border}33` };

  const SortTh = ({ label, field, align = 'left' }) => (
    <th style={{ ...thStyle, textAlign: align }} onClick={() => toggle(field)}>
      {label} <span style={{ fontSize: 7, opacity: sortKey === field ? 1 : 0.3 }}>{sortKey === field ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
    </th>
  );

  return (
    <div>
      <div onClick={onBack} style={{ cursor: 'pointer', fontSize: 9, color: C.accent, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
        <span>←</span> Back
      </div>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.text, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.8 }}>{title}</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 8 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              <SortTh label="Policy #" field="policyNumber" />
              <SortTh label="Insured" field="insuredName" />
              <SortTh label="Premium" field="premium" align="right" />
              <SortTh label="Received" field="netReceived" align="right" />
              <SortTh label="Balance" field="balance" align="right" />
              <th style={{ ...thStyle, textAlign: 'center' }}>Paid?</th>
              <SortTh label="Eff Date" field="effectiveDate" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((p, i) => (
              <tr key={i}>
                <td style={{ ...tdStyle, color: C.text, fontFamily: C.mono }}>{p.policyNumber || '—'}</td>
                <td style={{ ...tdStyle, color: C.text }}>{p.insuredName || '—'}</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontFamily: C.mono }}>{fmtDollarFull(p.premium)}</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontFamily: C.mono, color: p.netReceived > 0 ? C.green : p.netReceived < 0 ? C.red : C.muted }}>
                  {p.entries > 0 ? fmtDollarFull(p.netReceived) : '—'}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', fontFamily: C.mono, color: p.balance > 0 ? C.yellow : p.balance < 0 ? C.green : C.muted }}>
                  {fmtDollarFull(p.balance)}
                </td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>
                  <span style={{ color: p.carrierPaid ? C.green : C.red, fontWeight: 700, fontSize: 8 }}>{p.carrierPaid ? '✓' : '✗'}</span>
                </td>
                <td style={{ ...tdStyle, fontFamily: C.mono }}>{p.effectiveDate || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


export default function CommissionSidebar({ open, onClose, onNavigateTab }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [groupBy, setGroupBy] = useState('overview'); // 'overview' | 'carrier' | 'status'
  const [drillDown, setDrillDown] = useState(null); // { title, policies }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fetch('/api/commission-statements?view=waterfall')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!cancelled && d) setData(d);
        if (!cancelled) setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  const policies = data?.policies || [];

  // Build grouped data
  const grouped = useMemo(() => {
    if (!policies.length) return { byCarrier: {}, byStatus: {}, totals: {} };

    const byCarrier = {};
    const byStatus = {};
    const totals = { count: 0, paid: 0, unpaid: 0, received: 0, clawback: 0, balance: 0, expected: 0 };

    for (const p of policies) {
      const carrier = getCarrierGroup(p.carrier);
      const status = normalizeStatusKey(p.status || '(No Status)');
      const paid = p.carrierPaid;

      // By carrier → status
      if (!byCarrier[carrier]) byCarrier[carrier] = { _totals: { count: 0, paid: 0, unpaid: 0, received: 0, balance: 0 }, statuses: {} };
      if (!byCarrier[carrier].statuses[status]) byCarrier[carrier].statuses[status] = { count: 0, paid: 0, unpaid: 0, received: 0, balance: 0, policies: [] };
      const cs = byCarrier[carrier].statuses[status];
      cs.count++; cs.received += p.netReceived; cs.balance += p.balance; cs.policies.push(p);
      if (paid) cs.paid++; else cs.unpaid++;
      byCarrier[carrier]._totals.count++;
      byCarrier[carrier]._totals.received += p.netReceived;
      byCarrier[carrier]._totals.balance += p.balance;
      if (paid) byCarrier[carrier]._totals.paid++; else byCarrier[carrier]._totals.unpaid++;

      // By status → carrier
      if (!byStatus[status]) byStatus[status] = { _totals: { count: 0, paid: 0, unpaid: 0, received: 0, balance: 0 }, carriers: {} };
      if (!byStatus[status].carriers[carrier]) byStatus[status].carriers[carrier] = { count: 0, paid: 0, unpaid: 0, received: 0, balance: 0, policies: [] };
      const sc = byStatus[status].carriers[carrier];
      sc.count++; sc.received += p.netReceived; sc.balance += p.balance; sc.policies.push(p);
      if (paid) sc.paid++; else sc.unpaid++;
      byStatus[status]._totals.count++;
      byStatus[status]._totals.received += p.netReceived;
      byStatus[status]._totals.balance += p.balance;
      if (paid) byStatus[status]._totals.paid++; else byStatus[status]._totals.unpaid++;

      // Totals
      totals.count++; totals.received += p.netReceived; totals.balance += p.balance;
      totals.clawback += p.totalClawback; totals.expected += p.expectedCommission;
      if (paid) totals.paid++; else totals.unpaid++;
    }

    return { byCarrier, byStatus, totals };
  }, [policies]);

  // Pie chart data
  const statusPieCounts = useMemo(() => {
    const buckets = { 'Active': 0, 'No Comm': 0, 'Issued': 0, 'Pending': 0, 'Canceled': 0, 'Declined': 0, 'Other': 0 };
    for (const p of policies) {
      const s = normalizeStatusKey(p.status || '');
      if (s === 'Active - In Force' || s === 'Active - Past Due') buckets['Active']++;
      else if (s === 'Active - No commission paid yet') buckets['No Comm']++;
      else if (s === 'Issued, Not yet Active') buckets['Issued']++;
      else if (s.startsWith('Pending')) buckets['Pending']++;
      else if (s === 'Canceled') buckets['Canceled']++;
      else if (s === 'Declined') buckets['Declined']++;
      else buckets['Other']++;
    }
    return buckets;
  }, [policies]);

  // Parse MM-DD-YYYY or YYYY-MM-DD to Date object
  const parseDate = (raw) => {
    if (!raw) return null;
    // MM-DD-YYYY
    const mdy = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (mdy) return new Date(parseInt(mdy[3]), parseInt(mdy[1]) - 1, parseInt(mdy[2]));
    // YYYY-MM-DD
    const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (iso) return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]));
    // MM/DD/YYYY
    const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slash) return new Date(parseInt(slash[3]), parseInt(slash[1]) - 1, parseInt(slash[2]));
    return null;
  };

  // WoW calculations
  const wow = useMemo(() => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const thisMonday = new Date(now); thisMonday.setDate(now.getDate() + mondayOffset); thisMonday.setHours(0, 0, 0, 0);
    const lastMonday = new Date(thisMonday); lastMonday.setDate(thisMonday.getDate() - 7);
    const thisSunday = new Date(thisMonday); thisSunday.setDate(thisMonday.getDate() + 6); thisSunday.setHours(23, 59, 59, 999);
    const lastSunday = new Date(thisMonday); lastSunday.setDate(thisMonday.getDate() - 1); lastSunday.setHours(23, 59, 59, 999);

    let thisWeekRecv = 0, lastWeekRecv = 0, thisWeekApps = 0, lastWeekApps = 0;
    let thisWeekBal = 0, lastWeekBal = 0;

    for (const p of policies) {
      const sd = parseDate(p.submitDate);
      if (!sd) continue;
      if (sd >= thisMonday && sd <= thisSunday) {
        thisWeekApps++; thisWeekRecv += p.netReceived; thisWeekBal += p.balance;
      } else if (sd >= lastMonday && sd <= lastSunday) {
        lastWeekApps++; lastWeekRecv += p.netReceived; lastWeekBal += p.balance;
      }
    }

    const recvDelta = thisWeekRecv - lastWeekRecv;
    const recvPct = lastWeekRecv !== 0 ? ((thisWeekRecv - lastWeekRecv) / Math.abs(lastWeekRecv)) * 100 : 0;
    const appsDelta = thisWeekApps - lastWeekApps;
    const appsPct = lastWeekApps !== 0 ? ((thisWeekApps - lastWeekApps) / lastWeekApps) * 100 : 0;
    const balDelta = thisWeekBal - lastWeekBal;
    const balPct = lastWeekBal !== 0 ? ((thisWeekBal - lastWeekBal) / Math.abs(lastWeekBal)) * 100 : 0;

    return { recvDelta, recvPct, appsDelta, appsPct, balDelta, balPct };
  }, [policies]);

  if (!open) return null;

  const { byCarrier, byStatus, totals } = grouped;

  const thStyle = { padding: '5px 4px', fontSize: 9, color: C.accent, fontWeight: 600, whiteSpace: 'nowrap' };
  const tdStyle = { padding: '4px', fontSize: 9 };

  const PaidCell = ({ paid, unpaid }) => (
    <td style={{ ...tdStyle, textAlign: 'center' }}>
      <span style={{ color: C.green, fontWeight: 700 }}>{paid}</span>
      <span style={{ color: C.muted }}>/</span>
      <span style={{ color: C.red }}>{unpaid}</span>
    </td>
  );

  const renderCarrierView = () => {
    const carrierOrder = Object.entries(byCarrier).sort((a, b) => b[1]._totals.count - a[1]._totals.count);
    return carrierOrder.map(([carrier, data]) => {
      const t = data._totals;
      const statusOrder = Object.entries(data.statuses).sort((a, b) => statusSortIndex(a[0]) - statusSortIndex(b[0]));
      return (
        <tbody key={carrier}>
          <tr><td colSpan="5" style={{ padding: '7px 4px 3px', color: C.text, fontWeight: 700, fontSize: 10, borderTop: `2px solid ${C.border}` }}>
            {carrier} <span style={{ color: C.muted, fontWeight: 400, fontSize: 7 }}>— {t.count} pol · <span style={{ color: C.green }}>{t.paid} paid</span> / <span style={{ color: C.red }}>{t.unpaid} unpd</span></span>
          </td></tr>
          {statusOrder.map(([status, s]) => {
            const sc = STATUS_COLORS[status] || C.gray;
            const icon = STATUS_ICONS[status] || '◯';
            return (
              <tr key={status} onClick={() => setDrillDown({ title: `${carrier} → ${status}`, policies: s.policies })}
                style={{ cursor: 'pointer', borderBottom: `1px solid ${C.border}22` }}
                onMouseOver={e => e.currentTarget.style.background = 'rgba(91,159,255,0.06)'}
                onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                <td style={{ ...tdStyle }}><span style={{ color: sc }}>{icon}</span> {status}</td>
                <td style={{ ...tdStyle, textAlign: 'right', color: C.text }}>{s.count}</td>
                <PaidCell paid={s.paid} unpaid={s.unpaid} />
                <td style={{ ...tdStyle, textAlign: 'right', color: s.received > 0 ? C.green : s.received < 0 ? C.red : C.muted, fontFamily: C.mono }}>{fmtDollarFull(Math.round(s.received))}</td>
                <td style={{ ...tdStyle, textAlign: 'right', color: s.balance > 0 ? C.yellow : s.balance < 0 ? C.green : C.muted, fontFamily: C.mono }}>{fmtDollarFull(Math.round(s.balance))}</td>
              </tr>
            );
          })}
          {/* Carrier subtotal */}
          <tr style={{ borderTop: `1px solid ${C.border}`, background: 'rgba(91,159,255,0.03)' }}>
            <td style={{ ...tdStyle, fontWeight: 700, color: C.muted, fontSize: 8, padding: '3px' }}>Subtotal</td>
            <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: C.text }}>{t.count}</td>
            <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 700 }}>
              <span style={{ color: C.green }}>{t.paid}</span>/<span style={{ color: C.red }}>{t.unpaid}</span>
            </td>
            <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: t.received > 0 ? C.green : t.received < 0 ? C.red : C.muted, fontFamily: C.mono }}>{fmtDollarFull(Math.round(t.received))}</td>
            <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: t.balance > 0 ? C.yellow : t.balance < 0 ? C.green : C.muted, fontFamily: C.mono }}>{fmtDollarFull(Math.round(t.balance))}</td>
          </tr>
        </tbody>
      );
    });
  };

  const renderStatusView = () => {
    const statusOrder = Object.entries(byStatus).sort((a, b) => statusSortIndex(a[0]) - statusSortIndex(b[0]));
    return statusOrder.map(([status, data]) => {
      const t = data._totals;
      const sc = STATUS_COLORS[status] || C.gray;
      const icon = STATUS_ICONS[status] || '◯';
      const carrierOrder = Object.entries(data.carriers).sort((a, b) => b[1].count - a[1].count);
      return (
        <tbody key={status}>
          <tr><td colSpan="5" style={{ padding: '7px 4px 3px', fontWeight: 700, fontSize: 10, borderTop: `2px solid ${C.border}` }}>
            <span style={{ color: sc }}>{icon} {status}</span> <span style={{ color: C.muted, fontWeight: 400, fontSize: 7 }}>— {t.count} pol · <span style={{ color: C.green }}>{t.paid} paid</span> / <span style={{ color: C.red }}>{t.unpaid} unpd</span></span>
          </td></tr>
          {carrierOrder.map(([carrier, s]) => (
            <tr key={carrier} onClick={() => setDrillDown({ title: `${status} → ${carrier}`, policies: s.policies })}
              style={{ cursor: 'pointer', borderBottom: `1px solid ${C.border}22` }}
              onMouseOver={e => e.currentTarget.style.background = 'rgba(91,159,255,0.06)'}
              onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
              <td style={{ ...tdStyle, color: C.text }}>{carrier}</td>
              <td style={{ ...tdStyle, textAlign: 'right', color: C.text }}>{s.count}</td>
              <PaidCell paid={s.paid} unpaid={s.unpaid} />
              <td style={{ ...tdStyle, textAlign: 'right', color: s.received > 0 ? C.green : s.received < 0 ? C.red : C.muted, fontFamily: C.mono }}>{fmtDollarFull(Math.round(s.received))}</td>
              <td style={{ ...tdStyle, textAlign: 'right', color: s.balance > 0 ? C.yellow : s.balance < 0 ? C.green : C.muted, fontFamily: C.mono }}>{fmtDollarFull(Math.round(s.balance))}</td>
            </tr>
          ))}
          {/* Status subtotal */}
          <tr style={{ borderTop: `1px solid ${C.border}`, background: 'rgba(91,159,255,0.03)' }}>
            <td style={{ ...tdStyle, fontWeight: 700, color: C.muted, fontSize: 8, padding: '3px' }}>Subtotal</td>
            <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: C.text }}>{t.count}</td>
            <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 700 }}>
              <span style={{ color: C.green }}>{t.paid}</span>/<span style={{ color: C.red }}>{t.unpaid}</span>
            </td>
            <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: t.received > 0 ? C.green : t.received < 0 ? C.red : C.muted, fontFamily: C.mono }}>{fmtDollarFull(Math.round(t.received))}</td>
            <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: t.balance > 0 ? C.yellow : t.balance < 0 ? C.green : C.muted, fontFamily: C.mono }}>{fmtDollarFull(Math.round(t.balance))}</td>
          </tr>
        </tbody>
      );
    });
  };

  // Overview: each status as a row, split into Paid and Unpaid sub-rows
  const renderOverviewView = () => {
    const statusOrder = Object.entries(byStatus).sort((a, b) => statusSortIndex(a[0]) - statusSortIndex(b[0]));
    return statusOrder.map(([status, data]) => {
      const t = data._totals;
      const sc = STATUS_COLORS[status] || C.gray;
      const icon = STATUS_ICONS[status] || '◯';

      // Split policies into paid vs unpaid
      const allPols = Object.values(data.carriers).flatMap(c => c.policies);
      const paidPols = allPols.filter(p => p.carrierPaid);
      const unpaidPols = allPols.filter(p => !p.carrierPaid);
      const paidRecv = paidPols.reduce((s, p) => s + p.netReceived, 0);
      const paidBal = paidPols.reduce((s, p) => s + p.balance, 0);
      const unpaidRecv = unpaidPols.reduce((s, p) => s + p.netReceived, 0);
      const unpaidBal = unpaidPols.reduce((s, p) => s + p.balance, 0);

      return (
        <tbody key={status}>
          <tr><td colSpan="4" style={{ padding: '7px 4px 3px', fontWeight: 700, fontSize: 10, borderTop: `2px solid ${C.border}` }}>
            <span style={{ color: sc }}>{icon} {status}</span> <span style={{ color: C.muted, fontWeight: 400, fontSize: 8 }}>— {t.count} policies</span>
          </td></tr>
          {paidPols.length > 0 && (
            <tr onClick={() => setDrillDown({ title: `${status} → Paid`, policies: paidPols })}
              style={{ cursor: 'pointer', borderBottom: `1px solid ${C.border}22`, background: 'rgba(74,222,128,0.03)' }}
              onMouseOver={e => e.currentTarget.style.background = 'rgba(74,222,128,0.08)'}
              onMouseOut={e => e.currentTarget.style.background = 'rgba(74,222,128,0.03)'}>
              <td style={{ ...tdStyle, paddingLeft: 16, color: C.green }}>✓ Paid</td>
              <td style={{ ...tdStyle, textAlign: 'right', color: C.green, fontWeight: 700 }}>{paidPols.length}</td>
              <td style={{ ...tdStyle, textAlign: 'right', color: C.green, fontFamily: C.mono }}>{fmtDollarFull(Math.round(paidRecv))}</td>
              <td style={{ ...tdStyle, textAlign: 'right', color: paidBal > 0 ? C.yellow : paidBal < 0 ? C.red : C.muted, fontFamily: C.mono }}>{fmtDollarFull(Math.round(paidBal))}</td>
            </tr>
          )}
          {unpaidPols.length > 0 && (
            <tr onClick={() => setDrillDown({ title: `${status} → Unpaid`, policies: unpaidPols })}
              style={{ cursor: 'pointer', borderBottom: `1px solid ${C.border}22`, background: 'rgba(248,113,113,0.03)' }}
              onMouseOver={e => e.currentTarget.style.background = 'rgba(248,113,113,0.08)'}
              onMouseOut={e => e.currentTarget.style.background = 'rgba(248,113,113,0.03)'}>
              <td style={{ ...tdStyle, paddingLeft: 16, color: C.red }}>✗ Unpaid</td>
              <td style={{ ...tdStyle, textAlign: 'right', color: C.red, fontWeight: 700 }}>{unpaidPols.length}</td>
              <td style={{ ...tdStyle, textAlign: 'right', color: unpaidRecv > 0 ? C.green : C.muted, fontFamily: C.mono }}>{fmtDollarFull(Math.round(unpaidRecv))}</td>
              <td style={{ ...tdStyle, textAlign: 'right', color: unpaidBal > 0 ? C.yellow : unpaidBal < 0 ? C.red : C.muted, fontFamily: C.mono }}>{fmtDollarFull(Math.round(unpaidBal))}</td>
            </tr>
          )}
          {/* Status subtotal */}
          <tr style={{ borderTop: `1px solid ${C.border}`, background: 'rgba(91,159,255,0.03)' }}>
            <td style={{ ...tdStyle, fontWeight: 700, color: sc, fontSize: 9, padding: '3px 4px' }}>Subtotal</td>
            <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: C.text }}>{t.count}</td>
            <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: t.received > 0 ? C.green : t.received < 0 ? C.red : C.muted, fontFamily: C.mono }}>{fmtDollarFull(Math.round(t.received))}</td>
            <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: t.balance > 0 ? C.yellow : t.balance < 0 ? C.red : C.muted, fontFamily: C.mono }}>{fmtDollarFull(Math.round(t.balance))}</td>
          </tr>
        </tbody>
      );
    });
  };

  const pieCounts = statusPieCounts;
  const pieSlices = [
    { value: pieCounts['Active'], color: C.green },
    { value: pieCounts['No Comm'], color: C.cyan },
    { value: pieCounts['Issued'], color: C.purple },
    { value: pieCounts['Pending'], color: C.yellow },
    { value: pieCounts['Canceled'], color: C.red },
    { value: pieCounts['Declined'], color: C.orange },
    { value: pieCounts['Other'], color: C.gray },
  ].filter(s => s.value > 0);

  const dollarSlices = [
    { value: Math.max(totals.received - totals.clawback, 0), color: C.green },
    { value: totals.clawback, color: C.red },
    { value: Math.max(totals.balance, 0), color: C.yellow },
  ].filter(s => s.value > 0);

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, width: 520, height: '100vh', zIndex: 60,
      background: C.bg, borderLeft: `1px solid ${C.border}`, overflowY: 'auto',
      transition: 'transform 0.2s ease', transform: open ? 'translateX(0)' : 'translateX(100%)',
      fontFamily: C.mono, fontSize: 11, color: C.muted,
    }}>
      <div style={{ padding: 12 }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, color: C.accent, fontWeight: 700 }}>Commission Tracker</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', gap: 1, background: C.card, borderRadius: 4, padding: 1, border: `1px solid ${C.border}` }}>
              {['overview', 'status', 'carrier'].map(v => (
                <span key={v} onClick={() => { setGroupBy(v); setDrillDown(null); }}
                  style={{ padding: '4px 10px', borderRadius: 3, fontSize: 10, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize',
                    background: groupBy === v ? C.accent : 'transparent', color: groupBy === v ? '#fff' : C.muted }}>{v}</span>
              ))}
            </div>
            <span onClick={onClose} style={{ cursor: 'pointer', color: C.muted, fontSize: 16, lineHeight: 1 }}>✕</span>
          </div>
        </div>

        {/* Quick Links */}
        {!loading && policies.length > 0 && (
          <div style={{ display: 'flex', gap: 5, marginBottom: 10 }}>
            <button onClick={() => { if (onNavigateTab) onNavigateTab('period-revenue'); onClose(); }}
              style={{ flex: 1, padding: '5px 6px', borderRadius: 4, fontSize: 8.5, fontWeight: 600, cursor: 'pointer',
                background: C.card, color: C.accent, border: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>
              📅 Period Revenue
            </button>
            <button onClick={() => { if (onNavigateTab) onNavigateTab('commission-status'); onClose(); }}
              style={{ flex: 1, padding: '5px 6px', borderRadius: 4, fontSize: 8.5, fontWeight: 600, cursor: 'pointer',
                background: C.card, color: C.accent, border: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>
              📊 Comm Status
            </button>
            <button onClick={() => { if (onNavigateTab) onNavigateTab('carrier-balances'); onClose(); }}
              style={{ flex: 1, padding: '5px 6px', borderRadius: 4, fontSize: 8.5, fontWeight: 600, cursor: 'pointer',
                background: C.card, color: C.accent, border: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>
              🏦 Carrier Balances
            </button>
          </div>
        )}

        {loading && (
          <div style={{ textAlign: 'center', padding: 40, color: C.muted }}>
            <div style={{ width: 24, height: 24, border: `2px solid ${C.border}`, borderTopColor: C.accent, borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 8px' }} />
            Loading...
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {!loading && policies.length > 0 && !drillDown && (
          <>
            {/* Pie Charts */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4, color: C.accent }}>Policies by Status</div>
                <DonutChart slices={pieSlices} centerTop={String(totals.count)} centerBottom="POLICIES" />
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 4, marginTop: 3, fontSize: 8.5 }}>
                  {Object.entries(pieCounts).filter(([, v]) => v > 0).map(([label, count]) => {
                    const colors = { Active: C.green, 'No Comm': C.cyan, Issued: C.purple, Pending: C.yellow, Canceled: C.red, Declined: C.orange, Other: C.gray };
                    return <span key={label}><span style={{ color: colors[label] }}>●</span> {count} {label}</span>;
                  })}
                </div>
              </div>
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4, color: C.accent }}>Commission $</div>
                <DonutChart slices={dollarSlices} centerTop={fmtDollar(totals.expected)} centerBottom="EXPECTED" />
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 4, marginTop: 3, fontSize: 8.5 }}>
                  <span><span style={{ color: C.green }}>●</span> {fmtDollar(totals.received)} Recv</span>
                  <span><span style={{ color: C.red }}>●</span> {fmtDollar(totals.clawback)} Clawback</span>
                  <span><span style={{ color: C.yellow }}>●</span> {fmtDollar(totals.balance)} Owed</span>
                </div>
              </div>
            </div>

            {/* WoW */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
              {[
                { label: 'Received', val: fmtDollarFull(wow.recvDelta), pct: wow.recvPct, good: wow.recvDelta >= 0 },
                { label: 'New Apps', val: (wow.appsDelta >= 0 ? '+' : '') + wow.appsDelta, pct: wow.appsPct, good: wow.appsDelta >= 0 },
                { label: 'Balance Δ', val: fmtDollarFull(wow.balDelta), pct: wow.balPct, good: wow.balDelta <= 0 },
              ].map(w => (
                <div key={w.label} style={{ flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: 5, padding: '4px 5px', textAlign: 'center' }}>
                  <div style={{ fontSize: 8, textTransform: 'uppercase', marginBottom: 1 }}>{w.label}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: w.good ? C.green : C.red }}>{w.val}</div>
                  {w.pct !== 0 && <div style={{ fontSize: 9, color: w.good ? C.green : C.red }}>{fmtPct(w.good ? Math.abs(w.pct) : -Math.abs(w.pct))}</div>}
                </div>
              ))}
            </div>

            {/* Table */}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  <th style={{ ...thStyle, textAlign: 'left' }}>{groupBy === 'carrier' ? 'Status' : groupBy === 'status' ? 'Carrier' : 'Status / Paid'}</th>
                  <th style={{ ...thStyle, textAlign: 'right', width: 30 }} title="Number of policies">#</th>
                  {groupBy !== 'overview' && <th style={{ ...thStyle, textAlign: 'center', width: 50 }} title="Paid count / Unpaid count. Paid = carrier has sent at least one commission payment.">Paid</th>}
                  <th style={{ ...thStyle, textAlign: 'right', width: 80 }} title="Net commission received from carrier (advances minus chargebacks)">Received</th>
                  <th style={{ ...thStyle, textAlign: 'right', width: 80 }} title="Active/Pending: what carrier still owes us. Declined: $0. Canceled: what we owe back (negative).">Balance</th>
                </tr>
              </thead>
              {groupBy === 'carrier' ? renderCarrierView() : groupBy === 'status' ? renderStatusView() : renderOverviewView()}
              <tfoot>
                <tr style={{ borderTop: `2px solid ${C.accent}` }}>
                  <td style={{ ...tdStyle, fontWeight: 700, color: C.text, fontSize: 10, padding: '6px 4px' }}>TOTAL</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: C.text, padding: '5px 4px' }}>{totals.count}</td>
                  {groupBy !== 'overview' && (
                    <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 700, padding: '5px 4px' }}>
                      <span style={{ color: C.green }}>{totals.paid}</span>/<span style={{ color: C.red }}>{totals.unpaid}</span>
                    </td>
                  )}
                  <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: C.green, fontFamily: C.mono, padding: '5px 4px' }}>{fmtDollarFull(Math.round(totals.received))}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: totals.balance > 0 ? C.yellow : C.red, fontFamily: C.mono, padding: '5px 4px' }} title="Active/Pending: carrier owes us. Canceled: we owe carrier. Net of both.">{fmtDollarFull(Math.round(totals.balance))}</td>
                </tr>
              </tfoot>
            </table>

          </>
        )}


        {/* Drill-down */}
        {drillDown && (
          <PolicyDrillDown
            policies={drillDown.policies}
            title={drillDown.title}
            onBack={() => setDrillDown(null)}
          />
        )}
      </div>
    </div>
  );
}
