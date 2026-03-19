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
function Tip({ text, children }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  if (!text) return children;
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
      onMouseEnter={e => { const r = e.currentTarget.getBoundingClientRect(); setPos({ x: r.left + r.width / 2, y: r.top }); setShow(true); }}
      onMouseLeave={() => setShow(false)}>
      {children}
      {show && <span style={{ position: 'fixed', left: pos.x, top: pos.y - 6, transform: 'translate(-50%, -100%)', background: '#1a2538', color: '#e2e8f0', fontSize: 10, padding: '6px 10px', borderRadius: 6, border: `1px solid ${C.border}`, maxWidth: 260, lineHeight: 1.4, zIndex: 9999, pointerEvents: 'none', whiteSpace: 'normal', boxShadow: '0 4px 12px rgba(0,0,0,0.4)' }}>{text}</span>}
    </span>
  );
}
function KPICard({ label, value, color, subtitle, tooltip }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 16px', minWidth: 120, borderTop: `3px solid ${color || C.accent}` }}>
      <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8 }}>
        {label}{tooltip && <Tip text={tooltip}><span style={{ marginLeft: 4, fontSize: 8, opacity: 0.6, cursor: 'help' }}>ⓘ</span></Tip>}
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
  pending: { bg: '#2e2a0a', text: '#facc15', label: 'No Commission', tooltip: 'This policy has not appeared in any carrier commission statement yet' },
  carrierInferred: { bg: '#1a1a2e', text: '#a78bfa', label: 'Carrier Inferred', tooltip: 'Status inferred from sales tracker (Hold, Declined, Canceled, Lapsed, NeedReqmnt, Initial Not Paid)' },
  clawback: { bg: C.redDim, text: C.red, label: 'Clawback', tooltip: 'Carrier has charged back (recovered) commission on this policy' },
};

// ─── PolicyCRMDetail — Sale vs Carrier comparison + transaction history ───
function PolicyCRMDetail({ policy, cashFlow, loading, thStyle, tdStyle }) {
  if (loading) return <div style={{ color: C.muted, fontSize: 12 }}>Loading policy detail...</div>;

  const noActivity = !policy || policy.entries === 0;
  const cf = cashFlow || {};
  const cd = cf.carrierData || {};
  const mismatches = cf.mismatches || [];
  const hasMismatch = (field) => mismatches.find(m => m.field === field);

  // KPI Cards
  const kpis = (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
      <KPICard label="Sale Premium" value={fmtDollar(policy.premium)} color={C.accent} tooltip="Monthly premium from sales tracker" />
      <KPICard label="Carrier Premium" value={cd.carrierPremium != null ? fmtDollar(cd.carrierPremium) : 'N/A'}
        color={hasMismatch('premium') ? C.red : cd.carrierPremium != null ? C.accent : C.muted}
        tooltip={hasMismatch('premium') ? hasMismatch('premium').note : 'Annualized premium from carrier commission statement'} />
      {hasMismatch('premium') && (
        <KPICard label="Δ Premium" value={fmtDollar(Math.abs(policy.premium - (cd.carrierPremium || 0)))} color={C.red} tooltip="Difference between sale and carrier premium" />
      )}
      <KPICard label="Expected Comm" value={fmtDollar(policy.expectedCommission)} color={C.muted} tooltip="Premium × rate × 9 months" />
      <KPICard label="Total Paid" value={fmtDollar(cf.totalPaid || 0)} color={C.green} tooltip="Total advances from carrier" />
      <KPICard label="Total Clawback" value={fmtDollar(cf.totalClawback || 0)} color={(cf.totalClawback || 0) > 0 ? C.red : C.muted} tooltip="Total chargebacks + recovery clawbacks" />
      <KPICard label="Net Received" value={fmtDollar(cf.netCommission || 0)} color={(cf.netCommission || 0) >= 0 ? C.green : C.red} tooltip="Total Paid - Total Clawback" />
      <KPICard label="Balance" value={fmtDollar(policy.balance || 0)} color={Math.abs(policy.balance || 0) < 1 ? C.green : '#facc15'} tooltip="Expected - Paid + Clawback" />
    </div>
  );

  // Side-by-side comparison
  const compRowStyle = (mismatch) => ({
    display: 'grid', gridTemplateColumns: '140px 1fr 1fr', gap: 1, padding: '4px 0',
    borderBottom: `1px solid ${C.border}`,
    background: mismatch ? 'rgba(248,113,113,0.06)' : 'transparent',
  });
  const compLabel = { fontSize: 9, color: C.muted, textTransform: 'uppercase', fontWeight: 700, padding: '4px 8px', letterSpacing: 0.5 };
  const compVal = (mismatch) => ({ fontSize: 11, color: mismatch ? C.red : C.text, fontFamily: C.mono, padding: '4px 8px', fontWeight: mismatch ? 700 : 400 });

  const pi = cf.policyInfo || {};
  const comparison = (
    <div style={{ marginBottom: 16, border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 1fr', background: C.surface, padding: '6px 0' }}>
        <div style={{ ...compLabel, color: C.muted }}>Field</div>
        <div style={{ ...compLabel, color: C.accent }}>Sale Data</div>
        <div style={{ ...compLabel, color: C.accent }}>Carrier Data</div>
      </div>
      <div style={compRowStyle(hasMismatch('premium'))}>
        <div style={compLabel}>Premium</div>
        <div style={compVal(false)}>{fmtDollar(policy.premium)}/mo</div>
        <div style={compVal(hasMismatch('premium'))}>{cd.carrierPremium != null ? `${fmtDollar(cd.carrierPremium)} (ann)` : '—'}</div>
      </div>
      <div style={compRowStyle(false)}>
        <div style={compLabel}>Status</div>
        <div style={compVal(false)}>{policy.status || '—'}</div>
        <div style={compVal(false)}>{cd.entryCount > 0 ? (cf.totalClawback > 0 ? 'Clawback' : 'Active') : '—'}</div>
      </div>
      <div style={compRowStyle(false)}>
        <div style={compLabel}>Date</div>
        <div style={compVal(false)}>{policy.effectiveDate || policy.submitDate || '—'}</div>
        <div style={compVal(false)}>{cd.issueDate || '—'}</div>
      </div>
      <div style={compRowStyle(hasMismatch('agent'))}>
        <div style={compLabel}>Agent</div>
        <div style={compVal(false)}>{policy.agent || '—'}</div>
        <div style={compVal(hasMismatch('agent'))}>{cd.carrierAgent || '—'}{cd.carrierAgentId ? ` (${cd.carrierAgentId})` : ''}</div>
      </div>
      <div style={compRowStyle(false)}>
        <div style={compLabel}>Product</div>
        <div style={compVal(false)}>{policy.product || '—'}</div>
        <div style={compVal(false)}>{cd.carrierProduct || '—'}</div>
      </div>
      <div style={compRowStyle(false)}>
        <div style={compLabel}>Face Amount</div>
        <div style={compVal(false)}>{policy.faceAmount || '—'}</div>
        <div style={compVal(false)}>—</div>
      </div>
      <div style={compRowStyle(false)}>
        <div style={compLabel}>Lead Source</div>
        <div style={compVal(false)}>{policy.leadSource || '—'}</div>
        <div style={compVal(false)}>—</div>
      </div>
    </div>
  );

  // No activity message
  if (noActivity) {
    return (
      <div>
        {kpis}
        {comparison}
        <div style={{ padding: 20, textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: '#facc15', fontWeight: 700, marginBottom: 6 }}>No Commission Activity</div>
          <div style={{ fontSize: 11, color: C.muted }}>
            This policy ({policy.policyNumber}) was submitted on {policy.submitDate || '—'} but has not appeared in any carrier commission statement yet.
          </div>
        </div>
      </div>
    );
  }

  if (!cashFlow) return <div style={{ color: C.red, fontSize: 12 }}>Failed to load policy data.</div>;

  // Transaction history table
  const entries = (cf.entries || []).slice().sort((a, b) => (a.statementDate || '').localeCompare(b.statementDate || ''));
  let running = 0;
  const withRunning = entries.map(e => { running += e.commissionAmount || 0; return { ...e, runningBalance: running }; });

  const typeBadge = (type) => {
    const isPositive = type === 'advance' || type === 'as_earned';
    const isOverride = type?.includes('override');
    const bg = isPositive ? C.greenDim : isOverride ? '#1a2538' : C.redDim;
    const color = isPositive ? C.green : isOverride ? C.accent : C.red;
    return <span style={{ fontSize: 8, padding: '2px 6px', borderRadius: 4, fontWeight: 700, background: bg, color, whiteSpace: 'nowrap' }}>{type}</span>;
  };

  // Totals
  const totAdv = entries.reduce((s, e) => s + (e.advanceAmount || 0), 0);
  const totComm = entries.reduce((s, e) => s + (e.commissionAmount || 0), 0);
  const totCB = entries.reduce((s, e) => s + (e.chargebackAmount || 0), 0);
  const totRec = entries.reduce((s, e) => s + (e.recoveryAmount || 0), 0);
  const totNI = entries.reduce((s, e) => s + (e.netImpact || 0), 0);

  const txnTable = (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={thStyle}>Date</th>
            <th style={thStyle}>Statement</th>
            <th style={thStyle}>Type</th>
            <th style={thStyle}>Description</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Premium</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Advance</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Commission</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Chargeback</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Recovery</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Net Impact</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Balance</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Running</th>
          </tr>
        </thead>
        <tbody>
          {withRunning.map((e, i) => (
            <tr key={i}>
              <td style={tdStyle}>{e.statementDate || '—'}</td>
              <td style={{ ...tdStyle, fontSize: 9, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.statementFile || '—'}</td>
              <td style={tdStyle}>{typeBadge(e.transactionType)}</td>
              <td style={{ ...tdStyle, fontSize: 9, color: C.muted, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.description || '—'}</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{e.premium ? fmtDollar(e.premium) : '—'}</td>
              <td style={{ ...tdStyle, textAlign: 'right', color: e.advanceAmount > 0 ? C.green : C.muted }}>{e.advanceAmount ? fmtDollar(e.advanceAmount) : '—'}</td>
              <td style={{ ...tdStyle, textAlign: 'right', color: e.commissionAmount >= 0 ? C.green : C.red, fontWeight: 700 }}>{fmtDollar(e.commissionAmount)}</td>
              <td style={{ ...tdStyle, textAlign: 'right', color: e.chargebackAmount > 0 ? C.red : C.muted }}>{e.chargebackAmount ? fmtDollar(e.chargebackAmount) : '—'}</td>
              <td style={{ ...tdStyle, textAlign: 'right', color: e.recoveryAmount > 0 ? '#facc15' : C.muted }}>{e.recoveryAmount ? fmtDollar(e.recoveryAmount) : '—'}</td>
              <td style={{ ...tdStyle, textAlign: 'right', color: e.netImpact >= 0 ? C.green : C.red, fontWeight: 700 }}>{fmtDollar(e.netImpact)}</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtDollar(e.outstandingBalance)}</td>
              <td style={{ ...tdStyle, textAlign: 'right', color: e.runningBalance >= 0 ? C.green : C.red, fontWeight: 700 }}>{fmtDollar(e.runningBalance)}</td>
            </tr>
          ))}
          {/* Totals row */}
          <tr style={{ borderTop: `2px solid ${C.accent}`, background: 'rgba(91,159,255,0.04)' }}>
            <td style={{ ...tdStyle, fontWeight: 700 }} colSpan={5}>TOTALS</td>
            <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: C.green }}>{fmtDollar(totAdv)}</td>
            <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: totComm >= 0 ? C.green : C.red }}>{fmtDollar(totComm)}</td>
            <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: totCB > 0 ? C.red : C.muted }}>{totCB > 0 ? fmtDollar(totCB) : '—'}</td>
            <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: totRec > 0 ? '#facc15' : C.muted }}>{totRec > 0 ? fmtDollar(totRec) : '—'}</td>
            <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: totNI >= 0 ? C.green : C.red }}>{fmtDollar(totNI)}</td>
            <td style={tdStyle}></td>
            <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: running >= 0 ? C.green : C.red }}>{fmtDollar(running)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );

  return (
    <div>
      {kpis}
      {comparison}
      <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8 }}>Transaction History</div>
      {txnTable}
    </div>
  );
}

// ─── Policy Status View — Waterfall, Aging, Period ───
const AGE_BUCKETS = [
  { label: '0–7d', min: 0, max: 7 }, { label: '8–14d', min: 8, max: 14 },
  { label: '15–30d', min: 15, max: 30 }, { label: '31–60d', min: 31, max: 60 },
  { label: '61–90d', min: 61, max: 90 }, { label: '90d+', min: 91, max: 99999 },
];
function getAgeBucketLabel(days) { if (days == null) return null; const b = AGE_BUCKETS.find(b => days >= b.min && days <= b.max); return b ? b.label : null; }

function PolicyStatusView({ policies, loading, error }) {
  const [psSubTab, setPsSubTab] = useState('waterfall');
  const [period, setPeriod] = useState('weekly');

  if (error) return <div style={{ color: C.red, padding: 40, textAlign: 'center' }}>Error: {error}</div>;
  if (loading || !policies) return <div style={{ color: C.muted, padding: 40, textAlign: 'center' }}>Loading...</div>;

  const pillStyle = (active) => ({
    background: active ? C.accent : 'transparent', border: `1px solid ${active ? C.accent : C.border}`,
    borderRadius: 6, padding: '5px 14px', fontSize: 11, fontWeight: 600, color: active ? '#fff' : C.muted, cursor: 'pointer',
  });

  // Classify policies
  const classify = (p) => {
    const s = (p.status || '').toLowerCase();
    if (s.includes('active') || s.includes('in force') || s.includes('advance released')) return 'active';
    if (s.includes('pending') || s.includes('submitted') || s.includes('hold') || s.includes('need') || s.includes('not paid') || s.includes('initial premium')) return 'pending';
    return 'left'; // canceled, declined, lapsed, unknown
  };
  const statusColor = (p) => { const c = classify(p); return c === 'active' ? C.green : c === 'pending' ? '#facc15' : C.red; };

  // Summary totals
  const active = policies.filter(p => classify(p) === 'active');
  const pending = policies.filter(p => classify(p) === 'pending');
  const left = policies.filter(p => classify(p) === 'left');
  const activePrem = active.reduce((s, p) => s + (p.premium || 0), 0);
  const totalPrem = policies.reduce((s, p) => s + (p.premium || 0), 0);
  const retention = (active.length + left.length) > 0 ? active.length / (active.length + left.length) * 100 : 0;

  // KPI row
  const kpis = (
    <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
      <KPICard label="Total Policies" value={fmt(policies.length)} />
      <KPICard label="Active / Placed" value={fmt(active.length)} subtitle="In Force + Advance Released" />
      <KPICard label="Pending" value={fmt(pending.length)} subtitle="Submitted, Hold, Not Paid" />
      <KPICard label="Left" value={fmt(left.length)} subtitle="Canceled, Declined, Lapsed" />
      <KPICard label="Active Premium" value={fmtDollar(activePrem, 2)} />
      <KPICard label="Total Premium" value={fmtDollar(totalPrem, 2)} />
      <KPICard label="Retention Rate" value={fmtPct(retention)} subtitle="Active ÷ (Active + Left)" />
    </div>
  );

  // ─── Waterfall ───
  const renderWaterfall = () => {
    const weekMap = {};
    policies.forEach(p => {
      const ds = p.submitDate || p.effectiveDate;
      if (!ds) return;
      const d = parseDate(ds);
      if (!d) return;
      const day = d.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      d.setDate(d.getDate() + diff);
      const wk = d.toISOString().slice(0, 10);
      if (!weekMap[wk]) weekMap[wk] = [];
      weekMap[wk].push(p);
    });
    const weekKeys = Object.keys(weekMap).sort();
    const weekLabels = weekKeys.map(wk => {
      const start = new Date(wk + 'T00:00:00');
      const end = new Date(start); end.setDate(end.getDate() + 6);
      const f = d => d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
      return f(start) + ' –\n' + f(end);
    });

    const isActive = p => classify(p) === 'active';
    const isDeclined = p => (p.status || '').toLowerCase().includes('declined');
    const isPending = p => classify(p) === 'pending';
    const isCanceled = p => /cancell?ed/i.test(p.status || '');
    const isLapsed = p => (p.status || '').toLowerCase().includes('lapsed');

    const wkData = {};
    weekKeys.forEach(wk => {
      const ps = weekMap[wk];
      const submitted = ps.length;
      const declined = ps.filter(isDeclined).length;
      const pendingCt = ps.filter(isPending).length;
      const initialIF = submitted - declined - pendingCt;
      const activeCt = ps.filter(isActive).length;
      const canceled = ps.filter(isCanceled).length;
      const lapsed = ps.filter(isLapsed).length;
      const activePrem = ps.filter(isActive).reduce((s, p) => s + (p.premium || 0), 0);
      // Revenue metrics per week
      const expectedRev = ps.reduce((s, p) => s + (p.expectedCommission || p.premium * 12 || 0), 0);
      const activeRev = ps.filter(isActive).reduce((s, p) => s + (p.expectedCommission || p.premium * 12 || 0), 0);
      const lostRev = ps.filter(p => classify(p) === 'left').reduce((s, p) => s + (p.expectedCommission || p.premium * 12 || 0), 0);
      const pendingRev = ps.filter(isPending).reduce((s, p) => s + (p.expectedCommission || p.premium * 12 || 0), 0);
      const commPaid = ps.reduce((s, p) => s + (p.totalPaid || 0), 0);
      const clawback = ps.reduce((s, p) => s + (p.totalClawback || 0), 0);
      const netRcvd = ps.reduce((s, p) => s + (p.netReceived || 0), 0);
      wkData[wk] = { submitted, declined, pending: pendingCt, initialIF, active: activeCt, canceled, lapsed, activePrem, expectedRev, activeRev, lostRev, pendingRev, commPaid, clawback, netRcvd };
    });

    const allP = policies.filter(p => p.submitDate || p.effectiveDate);
    const gt = {
      submitted: allP.length, declined: allP.filter(isDeclined).length, pending: allP.filter(isPending).length,
      active: allP.filter(isActive).length, canceled: allP.filter(isCanceled).length, lapsed: allP.filter(isLapsed).length,
      activePrem: allP.filter(isActive).reduce((s, p) => s + (p.premium || 0), 0),
      expectedRev: allP.reduce((s, p) => s + (p.expectedCommission || p.premium * 12 || 0), 0),
      activeRev: allP.filter(isActive).reduce((s, p) => s + (p.expectedCommission || p.premium * 12 || 0), 0),
      lostRev: allP.filter(p => classify(p) === 'left').reduce((s, p) => s + (p.expectedCommission || p.premium * 12 || 0), 0),
      pendingRev: allP.filter(isPending).reduce((s, p) => s + (p.expectedCommission || p.premium * 12 || 0), 0),
      commPaid: allP.reduce((s, p) => s + (p.totalPaid || 0), 0),
      clawback: allP.reduce((s, p) => s + (p.totalClawback || 0), 0),
      netRcvd: allP.reduce((s, p) => s + (p.netReceived || 0), 0),
    };
    gt.initialIF = gt.submitted - gt.declined - gt.pending;

    const HEADER_ROWS = [
      { key: 'submitted', label: 'Total Submitted', color: C.accent, val: w => w.submitted, gtVal: gt.submitted },
      { key: 'declined', label: 'Declined / Denied', color: '#f87171', val: w => w.declined, gtVal: gt.declined },
      { key: 'pending', label: 'Pending', color: '#facc15', val: w => w.pending, gtVal: gt.pending },
    ];
    const IIF_ROW = { key: 'initialIF', label: 'Initial In Force', color: '#38bdf8' };
    const STATUS_ROWS_DETAIL = [
      { key: 'active', label: 'Active - In Force', color: C.green, val: w => w.active, gtVal: gt.active },
      { key: 'canceled', label: 'Canceled', color: '#fb923c', val: w => w.canceled, gtVal: gt.canceled },
      { key: 'lapsed', label: 'Lapsed', color: '#c084fc', val: w => w.lapsed, gtVal: gt.lapsed },
    ];

    const thS = { padding: '8px 12px', textAlign: 'center', fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: `2px solid ${C.border}`, background: C.surface, whiteSpace: 'pre-line', minWidth: 72 };
    const tdS = { padding: '6px 12px', textAlign: 'center', fontSize: 13, fontFamily: 'monospace', borderBottom: `1px solid ${C.border}` };
    const stickyLabel = (color, bold) => ({ ...tdS, textAlign: 'left', fontFamily: 'inherit', fontWeight: bold ? 700 : 600, fontSize: 11, color, position: 'sticky', left: 0, background: C.card, zIndex: 1 });
    const totalColBorder = `2px solid ${C.accent}`;
    const dividerRow = (k) => <tr key={`div-${k}`}><td colSpan={weekKeys.length + 2} style={{ height: 2, background: C.border, padding: 0 }} /></tr>;

    return (<>
      <Section title="Sales Cohort Waterfall" rightContent={<span style={{ fontSize: 10, color: C.muted }}>Policies grouped by week sold</span>}>
        <div style={{ overflowX: 'auto', padding: 16 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: weekKeys.length * 80 + 200 }}>
            <thead><tr>
              <th style={{ ...thS, textAlign: 'left', width: 160, position: 'sticky', left: 0, zIndex: 2, background: C.surface }}>Status</th>
              {weekLabels.map((lbl, i) => <th key={weekKeys[i]} style={thS}>{lbl}</th>)}
              <th style={{ ...thS, color: C.accent, borderLeft: totalColBorder }}>Total</th>
            </tr></thead>
            <tbody>
              {HEADER_ROWS.map(r => (
                <tr key={r.key}>
                  <td style={stickyLabel(r.color, false)}>{r.label}</td>
                  {weekKeys.map(wk => { const v = r.val(wkData[wk]); return <td key={wk} style={{ ...tdS, color: v > 0 ? r.color : C.muted + '60', fontWeight: v > 0 ? 600 : 400 }}>{v}</td>; })}
                  <td style={{ ...tdS, borderLeft: totalColBorder, color: r.gtVal > 0 ? r.color : C.muted, fontWeight: 700 }}>{r.gtVal}</td>
                </tr>
              ))}
              <tr style={{ background: '#0c1a2e' }}>
                <td style={{ ...stickyLabel(IIF_ROW.color, true), background: '#0c1a2e' }}>{IIF_ROW.label}</td>
                {weekKeys.map(wk => {
                  const w = wkData[wk]; const pct = w.submitted > 0 ? (w.initialIF / w.submitted * 100).toFixed(0) + '%' : '—';
                  return <td key={wk} style={{ ...tdS, fontWeight: 700, color: IIF_ROW.color }}>{w.initialIF}<span style={{ fontSize: 9, color: C.muted, marginLeft: 4 }}>{pct}</span></td>;
                })}
                <td style={{ ...tdS, borderLeft: totalColBorder, fontWeight: 800, color: IIF_ROW.color }}>
                  {gt.initialIF}<span style={{ fontSize: 9, color: C.muted, marginLeft: 4 }}>{gt.submitted > 0 ? (gt.initialIF / gt.submitted * 100).toFixed(0) + '%' : '—'}</span>
                </td>
              </tr>
              {dividerRow(1)}
              {STATUS_ROWS_DETAIL.map(r => (
                <tr key={r.key}>
                  <td style={stickyLabel(r.color, false)}>{r.label}</td>
                  {weekKeys.map(wk => {
                    const v = r.val(wkData[wk]); const base = wkData[wk].initialIF;
                    const pct = base > 0 ? (v / base * 100).toFixed(0) + '%' : '';
                    return <td key={wk} style={{ ...tdS, color: v > 0 ? r.color : C.muted + '60', fontWeight: v > 0 ? 600 : 400 }}>
                      {v > 0 ? <>{v}<span style={{ fontSize: 9, color: C.muted, marginLeft: 3 }}>{pct}</span></> : v}
                    </td>;
                  })}
                  <td style={{ ...tdS, borderLeft: totalColBorder, color: r.gtVal > 0 ? r.color : C.muted, fontWeight: 700 }}>
                    {r.gtVal > 0 ? <>{r.gtVal}<span style={{ fontSize: 9, color: C.muted, marginLeft: 3 }}>{gt.initialIF > 0 ? (r.gtVal / gt.initialIF * 100).toFixed(0) + '%' : ''}</span></> : r.gtVal}
                  </td>
                </tr>
              ))}
              {dividerRow(2)}
              <tr>
                <td style={stickyLabel(C.green, true)}>In Force Rate</td>
                {weekKeys.map(wk => {
                  const w = wkData[wk]; const rate = w.initialIF > 0 ? (w.active / w.initialIF * 100) : null;
                  const rColor = rate === null ? C.muted : rate >= 80 ? C.green : rate >= 60 ? '#facc15' : C.red;
                  return <td key={wk} style={{ ...tdS, color: rColor, fontWeight: 700, fontSize: 14 }}>{rate !== null ? rate.toFixed(0) + '%' : '—'}</td>;
                })}
                <td style={{ ...tdS, borderLeft: totalColBorder, fontWeight: 800, fontSize: 14, color: gt.initialIF > 0 ? (gt.active / gt.initialIF * 100 >= 80 ? C.green : gt.active / gt.initialIF * 100 >= 60 ? '#facc15' : C.red) : C.muted }}>
                  {gt.initialIF > 0 ? (gt.active / gt.initialIF * 100).toFixed(1) + '%' : '—'}
                </td>
              </tr>
              <tr>
                <td style={stickyLabel(C.muted, false)}>Active Premium</td>
                {weekKeys.map(wk => {
                  const prem = wkData[wk].activePrem;
                  return <td key={wk} style={{ ...tdS, color: prem > 0 ? C.green : C.muted + '60', fontWeight: prem > 0 ? 600 : 400 }}>{prem > 0 ? fmtDollar(prem) : '—'}</td>;
                })}
                <td style={{ ...tdS, borderLeft: totalColBorder, color: C.green, fontWeight: 700 }}>{fmtDollar(gt.activePrem)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      {/* Revenue Cohort Waterfall */}
      {(() => {
        const REV_ROWS = [
          { key: 'expectedRev', label: 'Expected Revenue', color: C.accent, val: w => w.expectedRev, gtVal: gt.expectedRev },
          { key: 'activeRev', label: 'Active Revenue', color: C.green, val: w => w.activeRev, gtVal: gt.activeRev },
          { key: 'pendingRev', label: 'Pending Revenue', color: '#facc15', val: w => w.pendingRev, gtVal: gt.pendingRev },
          { key: 'lostRev', label: 'Lost Revenue', color: C.red, val: w => w.lostRev, gtVal: gt.lostRev },
        ];
        const COMM_ROWS = [
          { key: 'commPaid', label: 'Commission Paid', color: C.green, val: w => w.commPaid, gtVal: gt.commPaid },
          { key: 'clawback', label: 'Chargebacks', color: C.red, val: w => w.clawback, gtVal: gt.clawback },
          { key: 'netRcvd', label: 'Net Received', color: '#38bdf8', val: w => w.netRcvd, gtVal: gt.netRcvd },
        ];

        return (
          <Section title="Revenue Cohort Waterfall" rightContent={<span style={{ fontSize: 10, color: C.muted }}>Financial impact grouped by week sold</span>}>
            <div style={{ overflowX: 'auto', padding: 16 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: weekKeys.length * 80 + 200 }}>
                <thead><tr>
                  <th style={{ ...thS, textAlign: 'left', width: 160, position: 'sticky', left: 0, zIndex: 2, background: C.surface }}>Metric</th>
                  {weekLabels.map((lbl, i) => <th key={weekKeys[i]} style={thS}>{lbl}</th>)}
                  <th style={{ ...thS, color: C.accent, borderLeft: totalColBorder }}>Total</th>
                </tr></thead>
                <tbody>
                  {/* Revenue breakdown */}
                  {REV_ROWS.map(r => (
                    <tr key={r.key}>
                      <td style={stickyLabel(r.color, false)}>{r.label}</td>
                      {weekKeys.map(wk => {
                        const v = r.val(wkData[wk]);
                        return <td key={wk} style={{ ...tdS, color: v > 0 ? r.color : C.muted + '60', fontWeight: v > 0 ? 600 : 400, fontSize: 11 }}>{v > 0 ? fmtDollar(v) : '—'}</td>;
                      })}
                      <td style={{ ...tdS, borderLeft: totalColBorder, color: r.gtVal > 0 ? r.color : C.muted, fontWeight: 700, fontSize: 11 }}>{r.gtVal > 0 ? fmtDollar(r.gtVal) : '—'}</td>
                    </tr>
                  ))}

                  {/* Revenue Retention % row */}
                  <tr style={{ background: '#0c1a2e' }}>
                    <td style={{ ...stickyLabel(C.green, true), background: '#0c1a2e' }}>Revenue Retention %</td>
                    {weekKeys.map(wk => {
                      const w = wkData[wk];
                      const rate = w.expectedRev > 0 ? (w.activeRev / w.expectedRev * 100) : null;
                      const rColor = rate === null ? C.muted : rate >= 80 ? C.green : rate >= 60 ? '#facc15' : C.red;
                      return <td key={wk} style={{ ...tdS, color: rColor, fontWeight: 700, fontSize: 14 }}>{rate !== null ? rate.toFixed(0) + '%' : '—'}</td>;
                    })}
                    <td style={{ ...tdS, borderLeft: totalColBorder, fontWeight: 800, fontSize: 14, color: gt.expectedRev > 0 ? (gt.activeRev / gt.expectedRev * 100 >= 80 ? C.green : gt.activeRev / gt.expectedRev * 100 >= 60 ? '#facc15' : C.red) : C.muted }}>
                      {gt.expectedRev > 0 ? (gt.activeRev / gt.expectedRev * 100).toFixed(1) + '%' : '—'}
                    </td>
                  </tr>

                  {/* Divider */}
                  <tr><td colSpan={weekKeys.length + 2} style={{ height: 2, background: C.border, padding: 0 }} /></tr>

                  {/* Commission breakdown */}
                  {COMM_ROWS.map(r => (
                    <tr key={r.key}>
                      <td style={stickyLabel(r.color, r.key === 'netRcvd')}>{r.label}</td>
                      {weekKeys.map(wk => {
                        const v = r.val(wkData[wk]);
                        const show = Math.abs(v) > 0;
                        return <td key={wk} style={{ ...tdS, color: show ? (v >= 0 ? r.color : C.red) : C.muted + '60', fontWeight: show ? 600 : 400, fontSize: 11 }}>{show ? fmtDollar(v) : '—'}</td>;
                      })}
                      <td style={{ ...tdS, borderLeft: totalColBorder, color: Math.abs(r.gtVal) > 0 ? (r.gtVal >= 0 ? r.color : C.red) : C.muted, fontWeight: 700, fontSize: 11 }}>{Math.abs(r.gtVal) > 0 ? fmtDollar(r.gtVal) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        );
      })()}
    </>);
  };

  // ─── Aging Matrix ───
  const renderAging = () => {
    const STATUS_ROWS = [
      { key: 'active', label: 'Active / Placed', color: C.green },
      { key: 'pending', label: 'Pending', color: '#facc15' },
      { key: 'left', label: 'Left', color: C.red },
      { key: 'Total', label: 'Total', color: C.accent },
    ];
    const BUCKET_COLS = [...AGE_BUCKETS.map(b => b.label), 'Total'];

    const agingMatrix = {};
    ['active', 'pending', 'left', 'Total'].forEach(k => { agingMatrix[k] = {}; BUCKET_COLS.forEach(c => { agingMatrix[k][c] = { count: 0, premium: 0 }; }); });

    policies.forEach(p => {
      const cat = classify(p);
      const days = p._daysActive;
      const bucket = getAgeBucketLabel(days) || null;
      if (!bucket) return;
      agingMatrix[cat][bucket].count++;
      agingMatrix[cat][bucket].premium += p.premium || 0;
      agingMatrix[cat]['Total'].count++;
      agingMatrix[cat]['Total'].premium += p.premium || 0;
      agingMatrix['Total'][bucket].count++;
      agingMatrix['Total'][bucket].premium += p.premium || 0;
      agingMatrix['Total']['Total'].count++;
      agingMatrix['Total']['Total'].premium += p.premium || 0;
    });

    return (
      <Section title="Policy Aging Matrix" rightContent={<span style={{ fontSize: 10, color: C.muted }}>Age = days since application submitted</span>}>
        <div style={{ overflowX: 'auto', padding: 16 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 700 }}>
            <thead><tr>
              <th style={{ padding: '8px 16px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, borderBottom: `2px solid ${C.border}`, background: C.surface, width: 130 }}>Status</th>
              {BUCKET_COLS.map(col => (
                <th key={col} style={{ padding: '8px 16px', textAlign: 'center', fontSize: 9, fontWeight: 700, color: col === 'Total' ? C.accent : C.muted, textTransform: 'uppercase', letterSpacing: 1, borderBottom: `2px solid ${C.border}`, background: C.surface, borderLeft: col === 'Total' ? `2px solid ${C.accent}` : `1px solid ${C.border}` }}>{col}</th>
              ))}
            </tr></thead>
            <tbody>
              {STATUS_ROWS.map(row => {
                const rowData = agingMatrix[row.key] || {};
                const isTotal = row.key === 'Total';
                return (
                  <tr key={row.key} style={{ borderTop: isTotal ? `2px solid ${C.accent}` : undefined, background: isTotal ? C.surface : 'transparent' }}>
                    <td style={{ padding: '10px 16px', fontSize: 11, fontWeight: 700, color: row.color, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>{row.label}</td>
                    {BUCKET_COLS.map(col => {
                      const cell = rowData[col] || { count: 0, premium: 0 };
                      const isLast = col === 'Total';
                      return (
                        <td key={col} style={{ padding: '10px 16px', textAlign: 'center', borderBottom: `1px solid ${C.border}`, borderLeft: isLast ? `2px solid ${C.accent}` : `1px solid ${C.border}`, background: cell.count > 0 ? (isTotal ? C.surface : `${row.color}10`) : 'transparent', verticalAlign: 'top' }}>
                          {cell.count === 0 ? <span style={{ color: C.border, fontSize: 13 }}>—</span> : <>
                            <div style={{ fontSize: 20, fontWeight: 800, color: row.color, fontFamily: C.mono, lineHeight: 1.1 }}>{cell.count}</div>
                            {cell.premium > 0 && <div style={{ fontSize: 10, color: C.green, fontFamily: C.mono, marginTop: 3 }}>{fmtDollar(cell.premium)}/mo</div>}
                          </>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
    );
  };

  return (
    <div>
      {kpis}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[['waterfall', 'Waterfall'], ['aging', 'Aging Report']].map(([val, lbl]) => (
          <button key={val} style={pillStyle(psSubTab === val)} onClick={() => setPsSubTab(val)}>{lbl}</button>
        ))}
      </div>
      {psSubTab === 'waterfall' && renderWaterfall()}
      {psSubTab === 'aging' && renderAging()}
    </div>
  );
}

export default function CombinedPoliciesTab() {
  const [subTab, setSubTab] = useState('combined');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [groupBy, setGroupBy] = useState('none');
  const [statusFilter, setStatusFilter] = useState(null);
  const [commFilter, setCommFilter] = useState(null);
  const [impactView, setImpactView] = useState('carrier');
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

  const normStatus = (s) => /cancell?ed/i.test(s) ? 'Canceled' : (s || 'Unknown');
  const filtered = enriched.filter(p => {
    if (statusFilter && normStatus(p.status) !== statusFilter) return false;
    if (commFilter && p.commissionStatus !== commFilter) return false;
    return true;
  });
  const sorted = sortData(filtered, mainSort.sortKey, mainSort.sortDir);

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
    const order = ['active', 'pending', 'carrierInferred', 'clawback'];
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
    const normS = (s) => /cancell?ed/i.test(s) ? 'Canceled' : s;
    sorted.forEach(p => { const k = normS(p.status || 'Unknown'); if (!map[k]) map[k] = []; map[k].push(p); });
    groups = Object.entries(map).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => ({ label: k, color: statusColor(k), policies: v }));
  } else {
    groups = [{ label: 'All Policies', color: C.accent, policies: sorted }];
  }

  const renderRow = (p, i) => {
    const isSelP = selectedPolicy?.policyNumber === p.policyNumber;
    const cs = STATUS_COLORS[p.commissionStatus] || STATUS_COLORS.pending;
    const days = p._daysActive;
    const daysColor = days === null ? C.muted : days > 180 ? C.green : days > 90 ? C.accent : days > 30 ? '#facc15' : C.muted;
    const subBg = 'rgba(91,159,255,0.03)';
    const subTd = { ...tdStyle, fontSize: 10, borderBottom: `1px solid rgba(26,37,56,0.5)`, background: subBg };

    const mainRow = (
      <tr key={`main-${i}`}
        style={{ cursor: 'pointer', background: isSelP ? 'rgba(91,159,255,0.08)' : 'transparent', borderLeft: isSelP ? `3px solid ${C.accent}` : '3px solid transparent', transition: 'background 0.15s ease' }}
        onClick={() => setSelectedPolicy(isSelP ? null : p)}
        onMouseOver={e => { if (!isSelP) e.currentTarget.style.background = 'rgba(91,159,255,0.05)'; }}
        onMouseOut={e => { if (!isSelP) e.currentTarget.style.background = 'transparent'; }}
      >
        <td style={{ ...tdStyle, width: 28, padding: '6px 4px', textAlign: 'center', fontSize: 12, color: isSelP ? C.accent : C.muted }}>{isSelP ? '▾' : '▸'}</td>
        <td style={tdStyle}>{p.policyNumber}</td>
        <td style={tdStyle}>{p.insuredName}</td>
        <td style={{ ...tdStyle, fontSize: 10 }}>{p.carrier}{p.product ? ` - ${p.product}` : ''}</td>
        <td style={{ ...tdStyle, fontSize: 10 }}>{p._effDateParsed ? p._effDateParsed.toLocaleDateString() : '—'}</td>
        <td style={tdStyle}>
          <Tip text={cs.tooltip}><span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, fontWeight: 700, background: cs.bg, color: cs.text, cursor: 'help' }}>{cs.label}</span></Tip>
        </td>
        <td style={tdStyle}>{fmtDollar(p.premium)}</td>
        <td style={tdStyle}>{fmtDollar(p.premium * 12)}</td>
        <td style={{ ...tdStyle, color: p.totalPaid > 0 ? C.green : C.muted }}>{fmtDollar(p.totalPaid)}</td>
        <td style={{ ...tdStyle, color: p.totalClawback > 0 ? C.red : C.muted }}>{p.totalClawback > 0 ? fmtDollar(p.totalClawback) : '—'}</td>
        <td style={{ ...tdStyle, color: p.netReceived >= 0 ? C.green : C.red, fontWeight: 700 }}>{p.entries > 0 ? fmtDollar(p.netReceived) : '—'}</td>
        <td style={{ ...tdStyle, color: p.balance > 0 ? C.green : p.balance < 0 ? C.red : C.muted, fontWeight: p.balance !== 0 ? 600 : 400 }}>{fmtDollar(p.balance)}</td>
        <td style={{ ...tdStyle, color: p.liability != null && p.liability < 0 ? C.red : C.muted, fontWeight: p.liability != null && p.liability < 0 ? 700 : 400 }}>{p.liability != null && p.liability < 0 ? fmtDollar(p.liability) : '—'}</td>
        <td style={{ ...tdStyle, textAlign: 'center', color: daysColor, fontWeight: 600 }}>{days !== null ? days : '—'}</td>
        <td style={tdStyle}>
          <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, fontWeight: 700, background: cs.bg, color: cs.text }}>{cs.label}</span>
        </td>
        <td style={tdStyle}>
          <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, fontWeight: 700, background: statusBg(p.status), color: statusColor(p.status) }}>{p.status || '—'}</span>
        </td>
      </tr>
    );

    if (!isSelP) return mainRow;

    // Build inline sub-rows: SALE row + carrier entries + TOTAL row
    const cf = cashFlow || {};
    const entries = (cf.entries || []).slice().sort((a, b) => (a.statementDate || '').localeCompare(b.statementDate || ''));
    let ourRunning = 0;

    // Sale row
    const saleRow = (
      <tr key={`sale-${i}`} style={{ background: subBg }}>
        <td style={{ ...subTd, paddingLeft: 20, color: C.muted }}>└</td>
        <td style={subTd}>{p.policyNumber}</td>
        <td style={subTd}>{p.insuredName}</td>
        <td style={{ ...subTd, fontSize: 9 }}>{p.carrier}{p.product ? ` - ${p.product}` : ''}</td>
        <td style={subTd}>{p.effectiveDate || p.submitDate || '—'}</td>
        <td style={subTd}><span style={{ fontSize: 8, padding: '2px 6px', borderRadius: 4, fontWeight: 700, background: '#1a2538', color: C.accent }}>SALE</span></td>
        <td style={subTd}>{fmtDollar(p.premium)}</td>
        <td style={subTd}>{fmtDollar(p.premium * 12)}</td>
        <td style={subTd}></td>
        <td style={subTd}></td>
        <td style={subTd}></td>
        <td style={subTd}></td>
        <td style={subTd}></td>
        <td style={subTd}></td>
        <td style={subTd}>{p.agent || '—'}</td>
        <td style={{ ...subTd }}>
          <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, fontWeight: 700, background: statusBg(p.status), color: statusColor(p.status) }}>{p.status || '—'}</span>
        </td>
      </tr>
    );

    // Carrier entry rows
    const entryRows = entries.map((e, ei) => {
      ourRunning += e.commissionAmount || 0;
      const carrierBal = e.outstandingBalance || 0;
      const delta = Math.round((ourRunning - carrierBal) * 100) / 100;
      const typeBg = (e.transactionType === 'advance' || e.transactionType === 'as_earned') ? C.greenDim : e.transactionType?.includes('override') ? '#1a2538' : C.redDim;
      const typeColor = (e.transactionType === 'advance' || e.transactionType === 'as_earned') ? C.green : e.transactionType?.includes('override') ? C.accent : C.red;

      return (
        <tr key={`entry-${i}-${ei}`} style={{ background: subBg }}>
          <td style={{ ...subTd, paddingLeft: 20, color: C.muted }}>{ei === entries.length - 1 ? '└' : '├'}</td>
          <td style={{ ...subTd, fontSize: 9, color: C.muted }}>{e.policyNumber}</td>
          <td style={{ ...subTd, fontSize: 9, color: C.muted }}>{e.insuredName}</td>
          <td style={{ ...subTd, fontSize: 9, color: C.muted }}>{e.carrier}</td>
          <td style={subTd}>{e.statementDate || '—'}</td>
          <td style={subTd}><span style={{ fontSize: 8, padding: '2px 6px', borderRadius: 4, fontWeight: 700, background: typeBg, color: typeColor, whiteSpace: 'nowrap' }}>{e.transactionType}</span></td>
          <td style={subTd}>{e.premium ? fmtDollar(e.premium / 12) : ''}</td>
          <td style={subTd}>{e.premium ? fmtDollar(e.premium) : ''}</td>
          <td style={{ ...subTd, color: e.commissionAmount >= 0 ? C.green : C.red, fontWeight: 700 }}>{fmtDollar(e.commissionAmount)}</td>
          <td style={{ ...subTd, color: e.chargebackAmount > 0 ? C.red : C.muted }}>{e.chargebackAmount ? fmtDollar(e.chargebackAmount) : ''}</td>
          <td style={{ ...subTd, color: e.netImpact >= 0 ? C.green : C.red, fontWeight: 600 }}>{fmtDollar(e.netImpact)}</td>
          <td style={subTd}>{carrierBal ? fmtDollar(carrierBal) : '$0'}</td>
          <td style={subTd}></td>
          <td style={{ ...subTd, fontSize: 8, color: C.muted, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.statementFile || ''}</td>
          <td style={subTd}></td>
        </tr>
      );
    });

    // Total row
    const totComm = entries.reduce((s, e) => s + (e.commissionAmount || 0), 0);
    const totCB = entries.reduce((s, e) => s + (e.chargebackAmount || 0), 0);
    const totNI = entries.reduce((s, e) => s + (e.netImpact || 0), 0);
    const lastCarrierBal = entries.length > 0 ? (entries[entries.length - 1].outstandingBalance || 0) : 0;
    const finalDelta = Math.round((ourRunning - lastCarrierBal) * 100) / 100;

    const totalRow = entries.length > 0 ? (
      <tr key={`total-${i}`} style={{ background: 'rgba(91,159,255,0.06)', borderTop: `1px solid ${C.accent}` }}>
        <td style={subTd}></td>
        <td style={subTd} colSpan={4}></td>
        <td style={{ ...subTd, fontWeight: 700, color: C.accent, fontSize: 9 }}>TOTAL</td>
        <td style={subTd}></td>
        <td style={subTd}></td>
        <td style={{ ...subTd, fontWeight: 700, color: totComm >= 0 ? C.green : C.red }}>{fmtDollar(totComm)}</td>
        <td style={{ ...subTd, fontWeight: 700, color: totCB > 0 ? C.red : C.muted }}>{totCB > 0 ? fmtDollar(totCB) : ''}</td>
        <td style={{ ...subTd, fontWeight: 700, color: totNI >= 0 ? C.green : C.red }}>{fmtDollar(totNI)}</td>
        <td style={{ ...subTd, fontWeight: 700 }}>{fmtDollar(lastCarrierBal)}</td>
        <td style={subTd}></td>
        <td style={subTd} colSpan={3}></td>
      </tr>
    ) : (
      <tr key={`nodata-${i}`} style={{ background: subBg }}>
        <td style={subTd}></td>
        <td colSpan={17} style={{ ...subTd, color: '#facc15', fontStyle: 'italic', textAlign: 'center', padding: '10px' }}>No carrier commission activity yet</td>
      </tr>
    );

    return <>{mainRow}{cashFlowLoading ? (
      <tr key={`loading-${i}`} style={{ background: subBg }}><td colSpan={18} style={{ ...subTd, color: C.muted, textAlign: 'center', padding: 10 }}>Loading carrier data...</td></tr>
    ) : <>{saleRow}{entryRows}{totalRow}</>}</>;
  };

  const tableHeader = (
    <thead>
      <tr>
        <th style={{ ...thStyle, width: 28, padding: '6px 4px' }}></th>
        <SortTh label="Policy #" field="policyNumber" {...mainSort} onSort={mainSort.toggle} style={thStyle} />
        <SortTh label="Insured" field="insuredName" {...mainSort} onSort={mainSort.toggle} style={thStyle} />
        <SortTh label="Carrier" field="carrier" {...mainSort} onSort={mainSort.toggle} style={thStyle} />
        <SortTh label="Date" field="effectiveDate" {...mainSort} onSort={mainSort.toggle} style={thStyle} />
        <SortTh label="Type" field="commissionStatus" {...mainSort} onSort={mainSort.toggle} style={thStyle} />
        <SortTh label="Mo Prem" field="premium" {...mainSort} onSort={mainSort.toggle} style={thStyle} />
        <SortTh label="Anl Prem" field="expectedCommission" {...mainSort} onSort={mainSort.toggle} style={thStyle} />
        <SortTh label="Commission" field="totalPaid" {...mainSort} onSort={mainSort.toggle} style={thStyle} />
        <SortTh label="Chargeback" field="totalClawback" {...mainSort} onSort={mainSort.toggle} style={thStyle} />
        <SortTh label="Net Impact" field="netReceived" {...mainSort} onSort={mainSort.toggle} style={thStyle} />
        <SortTh label="Balance" field="balance" {...mainSort} onSort={mainSort.toggle} style={thStyle} />
        <SortTh label="Liability" field="liability" {...mainSort} onSort={mainSort.toggle} style={thStyle} />
        <SortTh label="Days" field="_daysActive" {...mainSort} onSort={mainSort.toggle} style={thStyle} />
        <th style={thStyle}>Source</th>
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
          {[['combined', 'Combined Policies'], ['policyStatus', 'Policy Status'], ['commissions', 'Agent Commissions'], ['statements', 'Commission Statements']].map(([val, lbl]) => (
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

      {subTab === 'policyStatus' && <PolicyStatusView policies={enriched} loading={!data} error={error} />}

      {subTab === 'combined' && <>
      {error ? <div style={{ color: C.red, padding: 40, textAlign: 'center' }}>Error: {error}</div>
       : !data ? <div style={{ color: C.muted, padding: 40, textAlign: 'center' }}>Loading combined policy data...</div>
       : <>
      <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 4 }}>Combined Policy Information</div>
          <div style={{ fontSize: 12, color: C.muted }}>
            All policies from the sales tracker cross-referenced with carrier commission statements. Identifies policies without commission activity.
          </div>
        </div>
        <button
          onClick={() => { window.open('/api/combined-policies/export', '_blank'); }}
          style={{ background: C.accent, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
        >Export Excel</button>
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

      {/* Status Financial Impact table — two-level grouping with toggle */}
      <Section title="Financial Impact by Policy Status" rightContent={
        <div style={{ display: 'flex', gap: 6 }}>
          {[['carrier', 'Carrier First'], ['sales', 'Sales First']].map(([val, lbl]) => (
            <button key={val} style={pillStyle(impactView === val)} onClick={() => setImpactView(val)}>{lbl}</button>
          ))}
        </div>
      }>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}><Tip text={impactView === 'carrier' ? 'Status based on carrier commission activity: Comm Active, No Commission, Carrier Inferred, or Clawback' : 'Policy status from the sales tracker (e.g., Active - In Force, Pending, Canceled)'}>{impactView === 'carrier' ? 'Commission Status' : 'Sales Status'}</Tip></th>
                <th style={thStyle}><Tip text={impactView === 'carrier' ? 'Policy status from the sales tracker' : 'Status based on carrier commission activity'}>{impactView === 'carrier' ? 'Sales Status' : 'Commission Status'}</Tip></th>
                <th style={{ ...thStyle, textAlign: 'center' }}><Tip text="Number of policies in this group">Count</Tip></th>
                <th style={thStyle}><Tip text="Total monthly premium from the sales tracker">Premium</Tip></th>
                <th style={thStyle}><Tip text="Expected total commission: Premium × commission rate × 9 advance months (6 for CICA)">Expected</Tip></th>
                <th style={thStyle}><Tip text="Total commission advances actually paid by the carrier (from commission statements)">Paid</Tip></th>
                <th style={thStyle}><Tip text="Total chargebacks — commission clawed back by the carrier due to policy cancellations">Clawback</Tip></th>
                <th style={thStyle}><Tip text="Net received: Paid minus Clawback — what you actually kept">Net</Tip></th>
                <th style={thStyle}><Tip text="Outstanding advance balance from carrier statements. This is what you owe back if the policy cancels. If no carrier data, uses Expected minus Paid.">Balance</Tip></th>
                <th style={thStyle}><Tip text="Net loss on terminated/clawback policies — unrecovered chargebacks that reduce future advances">Liability</Tip></th>
                <th style={{ ...thStyle, textAlign: 'center' }}><Tip text="Average days since policy effective date">Avg Days</Tip></th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const normS = (s) => /cancell?ed/i.test(s) ? 'Canceled' : (s || 'Unknown');
                const commLabel = (cs) => cs === 'active' ? 'Comm Active' : cs === 'clawback' ? 'Clawback' : cs === 'carrierInferred' ? 'Carrier Inferred' : 'No Commission';
                const commColor = (cs) => cs === 'active' ? C.green : cs === 'clawback' ? C.red : cs === 'carrierInferred' ? '#a78bfa' : '#facc15';
                const commBg = (cs) => cs === 'active' ? C.greenDim : cs === 'clawback' ? C.redDim : cs === 'carrierInferred' ? '#1a1a2e' : '#2e2a0a';

                // Build two-level groups
                const groupMap = {};
                enriched.forEach(p => {
                  const sales = normS(p.status);
                  const comm = p.commissionStatus || 'pending';
                  const primary = impactView === 'carrier' ? comm : sales;
                  const secondary = impactView === 'carrier' ? sales : comm;
                  const key = `${primary}|||${secondary}`;
                  if (!groupMap[key]) groupMap[key] = { primary, secondary, count: 0, premium: 0, expected: 0, paid: 0, clawback: 0, net: 0, balance: 0, liability: 0, daysSum: 0, daysCount: 0 };
                  const row = groupMap[key];
                  row.count++;
                  row.premium += p.premium;
                  row.expected += p.expectedCommission;
                  row.paid += p.totalPaid;
                  row.clawback += p.totalClawback;
                  row.net += p.netReceived;
                  row.balance += p.balance || 0;
                  row.liability += (p.liability != null && p.liability < 0) ? p.liability : 0;
                  if (p._daysActive != null) { row.daysSum += p._daysActive; row.daysCount++; }
                });

                // Group by primary, then sort
                const primaryMap = {};
                Object.values(groupMap).forEach(r => {
                  if (!primaryMap[r.primary]) primaryMap[r.primary] = { rows: [], totals: { count: 0, premium: 0, expected: 0, paid: 0, clawback: 0, net: 0, balance: 0, liability: 0, daysSum: 0, daysCount: 0 } };
                  primaryMap[r.primary].rows.push(r);
                  const t = primaryMap[r.primary].totals;
                  t.count += r.count; t.premium += r.premium; t.expected += r.expected;
                  t.paid += r.paid; t.clawback += r.clawback; t.net += r.net;
                  t.balance += r.balance; t.liability += r.liability;
                  t.daysSum += r.daysSum; t.daysCount += r.daysCount;
                });

                // Sort primary groups: carrier view uses fixed order, sales view by count
                const CARRIER_ORDER = { active: 0, pending: 1, carrierInferred: 2, clawback: 3 };
                const primaryKeys = Object.keys(primaryMap).sort((a, b) => {
                  if (impactView === 'carrier') return (CARRIER_ORDER[a] ?? 99) - (CARRIER_ORDER[b] ?? 99);
                  return primaryMap[b].totals.count - primaryMap[a].totals.count;
                });

                const grandTotals = primaryKeys.reduce((t, k) => {
                  const g = primaryMap[k].totals;
                  return { count: t.count + g.count, premium: t.premium + g.premium, expected: t.expected + g.expected, paid: t.paid + g.paid, clawback: t.clawback + g.clawback, net: t.net + g.net, balance: t.balance + g.balance, liability: t.liability + g.liability, daysSum: t.daysSum + g.daysSum, daysCount: t.daysCount + g.daysCount };
                }, { count: 0, premium: 0, expected: 0, paid: 0, clawback: 0, net: 0, balance: 0, liability: 0, daysSum: 0, daysCount: 0 });

                const renderFinRow = (r, isPrimary, isSubRow, idx) => {
                  const label = isPrimary ? r.primary || r.status : r.secondary;
                  const isCarrierLabel = impactView === 'carrier' ? isPrimary : !isPrimary;
                  const labelColor = isCarrierLabel ? commColor(label) : statusColor(label);
                  const labelBg = isCarrierLabel ? commBg(label) : statusBg(label);
                  const displayLabel = isCarrierLabel ? commLabel(label) : label;
                  const d = isPrimary ? r : r;

                  const handleRowClick = () => {
                    if (isSubRow) {
                      // Sub-row: filter by both primary and secondary
                      const salesVal = impactView === 'carrier' ? r.secondary : r.primary;
                      const commVal = impactView === 'carrier' ? r.primary : r.secondary;
                      const newSales = statusFilter === salesVal && commFilter === commVal ? null : salesVal;
                      const newComm = statusFilter === salesVal && commFilter === commVal ? null : commVal;
                      setStatusFilter(newSales);
                      setCommFilter(newComm);
                    }
                  };

                  return (
                    <tr key={`${isPrimary ? 'p' : 's'}-${idx}-${label}`}
                      style={{ background: isSubRow ? `${C.surface}44` : 'transparent', cursor: isSubRow ? 'pointer' : 'default', transition: 'background 0.15s' }}
                      onClick={handleRowClick}
                      onMouseOver={e => { if (isSubRow) e.currentTarget.style.background = 'rgba(91,159,255,0.08)'; }}
                      onMouseOut={e => { if (isSubRow) e.currentTarget.style.background = `${C.surface}44`; }}
                    >
                      <td style={{ ...tdStyle, paddingLeft: isSubRow ? 28 : 10 }}>
                        {!isSubRow && <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, fontWeight: 700, background: impactView === 'carrier' ? labelBg : 'transparent', color: impactView === 'carrier' ? labelColor : C.text }}>
                          {impactView === 'carrier' ? displayLabel : ''}
                        </span>}
                        {isSubRow && impactView === 'carrier' && ''}
                        {!isSubRow && impactView === 'sales' && <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, fontWeight: 700, background: labelBg, color: labelColor }}>{displayLabel}</span>}
                      </td>
                      <td style={tdStyle}>
                        {isSubRow && impactView === 'carrier' && <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, fontWeight: 600, background: statusBg(label), color: statusColor(label) }}>{label}</span>}
                        {!isSubRow && impactView === 'carrier' && ''}
                        {isSubRow && impactView === 'sales' && <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, fontWeight: 600, background: commBg(label), color: commColor(label) }}>{commLabel(label)}</span>}
                        {!isSubRow && impactView === 'sales' && ''}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center', fontWeight: isPrimary ? 700 : 400 }}>{d.count}</td>
                      <td style={tdStyle}>{fmtDollar(d.premium)}</td>
                      <td style={tdStyle}>{fmtDollar(d.expected)}</td>
                      <td style={{ ...tdStyle, color: d.paid > 0 ? C.green : C.muted }}>{fmtDollar(d.paid)}</td>
                      <td style={{ ...tdStyle, color: d.clawback > 0 ? C.red : C.muted }}>{fmtDollar(d.clawback)}</td>
                      <td style={{ ...tdStyle, color: d.net >= 0 ? C.green : C.red, fontWeight: isPrimary ? 700 : 400 }}>{fmtDollar(d.net)}</td>
                      <td style={{ ...tdStyle, color: d.balance > 0 ? '#facc15' : d.balance < 0 ? C.red : C.muted, fontWeight: d.balance !== 0 ? 600 : 400 }}>{fmtDollar(d.balance)}</td>
                      <td style={{ ...tdStyle, color: d.liability < 0 ? C.red : C.muted, fontWeight: d.liability < 0 ? 700 : 400 }}>{d.liability < 0 ? fmtDollar(d.liability) : '—'}</td>
                      <td style={{ ...tdStyle, textAlign: 'center', color: C.muted }}>{d.daysCount > 0 ? Math.round(d.daysSum / d.daysCount) + 'd' : '—'}</td>
                    </tr>
                  );
                };

                const tableRows = [];
                primaryKeys.forEach((pk, pi) => {
                  const group = primaryMap[pk];
                  const t = group.totals;
                  const isCarrier = impactView === 'carrier';
                  const lbl = isCarrier ? commLabel(pk) : pk;
                  const lc = isCarrier ? commColor(pk) : statusColor(pk);
                  const lb = isCarrier ? commBg(pk) : statusBg(pk);

                  // Group header row — clickable to filter by primary group
                  const handleHeaderClick = () => {
                    if (isCarrier) {
                      setCommFilter(commFilter === pk ? null : pk);
                      setStatusFilter(null);
                    } else {
                      setStatusFilter(statusFilter === pk ? null : pk);
                      setCommFilter(null);
                    }
                  };
                  tableRows.push(
                    <tr key={`hdr-${pi}`} style={{ background: `${C.surface}66`, borderTop: pi > 0 ? `2px solid ${C.border}` : 'none', cursor: 'pointer' }}
                      onClick={handleHeaderClick}
                      onMouseOver={e => e.currentTarget.style.background = 'rgba(91,159,255,0.08)'}
                      onMouseOut={e => e.currentTarget.style.background = `${C.surface}66`}
                    >
                      <td colSpan={2} style={{ ...tdStyle, fontWeight: 700, paddingTop: 10, paddingBottom: 6 }}>
                        <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, fontWeight: 700, background: lb, color: lc }}>{lbl}</span>
                        <span style={{ marginLeft: 8, fontSize: 10, color: C.muted }}>({t.count} policies)</span>
                      </td>
                      <td colSpan={9} style={tdStyle}></td>
                    </tr>
                  );
                  // Sub-rows sorted by count
                  const subRows = group.rows.sort((a, b) => b.count - a.count);
                  subRows.forEach((sr, si) => {
                    tableRows.push(renderFinRow(sr, false, true, `${pi}-${si}`));
                  });
                  // Subtotal row
                  tableRows.push(
                    <tr key={`sub-${pi}`} style={{ background: `${C.surface}88`, fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ ...tdStyle, paddingLeft: 28, fontSize: 9, color: lc }}>Subtotal</td>
                      <td style={tdStyle}></td>
                      <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 700, color: lc }}>{t.count}</td>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{fmtDollar(t.premium)}</td>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{fmtDollar(t.expected)}</td>
                      <td style={{ ...tdStyle, color: t.paid > 0 ? C.green : C.muted, fontWeight: 600 }}>{fmtDollar(t.paid)}</td>
                      <td style={{ ...tdStyle, color: t.clawback > 0 ? C.red : C.muted, fontWeight: 600 }}>{fmtDollar(t.clawback)}</td>
                      <td style={{ ...tdStyle, color: t.net >= 0 ? C.green : C.red, fontWeight: 700 }}>{fmtDollar(t.net)}</td>
                      <td style={{ ...tdStyle, color: t.balance > 0 ? '#facc15' : t.balance < 0 ? C.red : C.muted, fontWeight: 600 }}>{fmtDollar(t.balance)}</td>
                      <td style={{ ...tdStyle, color: t.liability < 0 ? C.red : C.muted, fontWeight: 600 }}>{t.liability < 0 ? fmtDollar(t.liability) : '—'}</td>
                      <td style={{ ...tdStyle, textAlign: 'center', color: C.muted }}>{t.daysCount > 0 ? Math.round(t.daysSum / t.daysCount) + 'd' : '—'}</td>
                    </tr>
                  );
                });

                return (
                  <>
                    {tableRows}
                    <tr style={{ background: C.surface, fontWeight: 700, borderTop: `2px solid ${C.accent}` }}>
                      <td style={{ ...tdStyle, color: C.accent }}>TOTAL</td>
                      <td style={tdStyle}></td>
                      <td style={{ ...tdStyle, textAlign: 'center', color: C.accent }}>{grandTotals.count}</td>
                      <td style={tdStyle}>{fmtDollar(grandTotals.premium)}</td>
                      <td style={tdStyle}>{fmtDollar(grandTotals.expected)}</td>
                      <td style={{ ...tdStyle, color: C.green }}>{fmtDollar(grandTotals.paid)}</td>
                      <td style={{ ...tdStyle, color: C.red }}>{fmtDollar(grandTotals.clawback)}</td>
                      <td style={{ ...tdStyle, color: grandTotals.net >= 0 ? C.green : C.red }}>{fmtDollar(grandTotals.net)}</td>
                      <td style={{ ...tdStyle, color: grandTotals.balance > 0 ? '#facc15' : grandTotals.balance < 0 ? C.red : C.muted, fontWeight: 700 }}>{fmtDollar(grandTotals.balance)}</td>
                      <td style={{ ...tdStyle, color: grandTotals.liability < 0 ? C.red : C.muted, fontWeight: 700 }}>{grandTotals.liability < 0 ? fmtDollar(grandTotals.liability) : '—'}</td>
                      <td style={{ ...tdStyle, textAlign: 'center', color: C.muted }}>{grandTotals.daysCount > 0 ? Math.round(grandTotals.daysSum / grandTotals.daysCount) + 'd' : '—'}</td>
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
        const hasFilter = statusFilter || commFilter;
        const filterLabel = [statusFilter, commFilter && (commFilter === 'active' ? 'Comm Active' : commFilter === 'clawback' ? 'Clawback' : 'No Commission')].filter(Boolean).join(' + ');
        const sectionTitle = groupBy === 'none'
          ? (hasFilter ? `${filterLabel} — ${g.policies.length} policies` : `All Policies (${g.policies.length})`)
          : `${g.label} — ${g.policies.length} ${g.policies.length === 1 ? 'policy' : 'policies'} · Premium ${fmtDollar(grpPremium)} · Net ${fmtDollar(grpNet)}`;
        return (
          <Section key={gi} title={sectionTitle} rightContent={hasFilter ? (
            <button onClick={() => { setStatusFilter(null); setCommFilter(null); }} style={{ background: C.red, color: '#fff', border: 'none', borderRadius: 4, padding: '4px 10px', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>Clear Filter</button>
          ) : null}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                {tableHeader}
                <tbody>
                  {g.policies.map(renderRow)}
                  {groupBy !== 'none' && g.policies.length > 1 && (
                    <tr style={{ background: C.surface, fontWeight: 700 }}>
                      <td style={tdStyle}></td>
                      <td colSpan={5} style={{ ...tdStyle, fontSize: 10, color: C.muted }}>SUBTOTAL ({g.policies.length})</td>
                      <td style={tdStyle}>{fmtDollar(grpPremium)}</td>
                      <td style={{ ...tdStyle, color: C.green }}>{fmtDollar(grpPaid)}</td>
                      <td style={{ ...tdStyle, color: C.red }}>{fmtDollar(g.policies.reduce((s, p) => s + p.totalClawback, 0))}</td>
                      <td style={{ ...tdStyle, color: grpNet >= 0 ? C.green : C.red }}>{fmtDollar(grpNet)}</td>
                      <td style={tdStyle} colSpan={3}></td>
                      <td style={{ ...tdStyle, textAlign: 'center', color: C.muted, fontSize: 10 }}>
                        {Math.round(g.policies.filter(p => p._daysActive != null).reduce((s, p) => s + (p._daysActive || 0), 0) / Math.max(1, g.policies.filter(p => p._daysActive != null).length))}d avg
                      </td>
                      <td style={tdStyle} colSpan={2}></td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Section>
        );
      })}

      {/* Detail is now inline sub-rows in the table above */}

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

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: 40, overflowY: 'auto' }}
      onClick={onClose}
    >
      <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, width: '90%', maxWidth: 1200, maxHeight: 'calc(100vh - 80px)', overflowY: 'auto', padding: 24 }}
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

        <PolicyCRMDetail policy={policy} cashFlow={cashData} loading={loading} thStyle={thStyle} tdStyle={tdStyle} />
      </div>
    </div>
  );
}
