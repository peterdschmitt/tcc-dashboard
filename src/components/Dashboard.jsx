'use client';
import { useState, useMemo } from 'react';

const C = {
  bg: '#080b10', surface: '#0f1520', card: '#131b28', border: '#1a2538',
  text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff', accentDim: '#1e3a5f',
  green: '#22c55e', greenDim: '#0a2e1a', yellow: '#eab308', yellowDim: '#2e2a0a',
  red: '#ef4444', redDim: '#2e0a0a', purple: '#a855f7',
  mono: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
  sans: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
};

const TABS = [
  { id: 'daily', label: 'Daily Activity' },
  { id: 'publishers', label: 'Publishers' },
  { id: 'agents', label: 'Agents' },
  { id: 'carriers', label: 'Carriers' },
  { id: 'pnl', label: 'P&L Report' },
];

function fmt(n, d = 0) { if (n == null || isNaN(n)) return '—'; return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }
function fmtDollar(n, d = 0) { if (n == null || isNaN(n)) return '—'; return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }
function fmtPct(n) { if (n == null || isNaN(n)) return '—'; return n.toFixed(1) + '%'; }

function goalColor(actual, goal, lower = false) {
  if (!goal || !actual) return C.muted;
  const r = lower ? goal / actual : actual / goal;
  return r >= 1 ? C.green : r >= 0.8 ? C.yellow : C.red;
}
function goalBg(actual, goal, lower = false) {
  if (!goal || !actual) return 'transparent';
  const r = lower ? goal / actual : actual / goal;
  return r >= 1 ? C.greenDim : r >= 0.8 ? C.yellowDim : C.redDim;
}
function calcDays(s, e) { if (!s || !e) return 1; return Math.max(Math.ceil((new Date(e) - new Date(s)) / 864e5) + 1, 1); }
const isPlaced = p => ['Advance Released', 'Active - In Force', 'Submitted - Pending'].includes(p.placed);

function KPICard({ label, value, goal, lowerIsBetter, subtitle }) {
  const color = goal ? goalColor(typeof value === 'string' ? parseFloat(value) : value, goal, lowerIsBetter) : C.accent;
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '16px 20px', flex: '1 1 0', minWidth: 140, borderTop: `3px solid ${color}` }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color, fontFamily: C.mono, lineHeight: 1 }}>{value}</div>
      {goal && <div style={{ fontSize: 10, color: C.muted, marginTop: 6, fontFamily: C.mono }}>Goal: {typeof goal === 'number' && goal > 1 ? fmtDollar(goal) : goal}</div>}
      {subtitle && <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>{subtitle}</div>}
    </div>
  );
}

function ProgressBar({ value, goal, lowerIsBetter = false, width = 100 }) {
  if (!goal || !value) return <span style={{ color: C.muted, fontSize: 11, fontFamily: C.mono }}>—</span>;
  const pct = lowerIsBetter ? (goal / value) * 100 : (value / goal) * 100;
  const clamped = Math.min(pct, 100);
  const color = pct >= 100 ? C.green : pct >= 80 ? C.yellow : C.red;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width, height: 6, background: C.border, borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${clamped}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.5s ease' }} />
      </div>
      <span style={{ fontSize: 10, fontFamily: C.mono, color, minWidth: 36 }}>{pct.toFixed(0)}%</span>
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
            <tr key={i} onClick={() => onRowClick && onRowClick(row)}
              onMouseEnter={e => e.currentTarget.style.background = '#151f30'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              style={{ cursor: onRowClick ? 'pointer' : 'default' }}>
              {columns.map(col => (
                <td key={col.key} style={{
                  padding: '10px 12px', textAlign: col.align || 'right', fontSize: 12,
                  fontFamily: col.mono !== false ? C.mono : C.sans, borderBottom: `1px solid ${C.border}`,
                  whiteSpace: 'nowrap', color: col.color ? col.color(row) : C.text, fontWeight: col.bold ? 600 : 400,
                }}>{col.render ? col.render(row) : row[col.key]}</td>
              ))}
            </tr>
          ))}
          {sorted.length === 0 && <tr><td colSpan={columns.length} style={{ padding: 24, textAlign: 'center', color: C.muted, fontSize: 13 }}>No data for this date range</td></tr>}
          {totalsRow && sorted.length > 0 && (
            <tr style={{ background: C.surface, borderTop: `2px solid ${C.accent}` }}>
              {columns.map(col => (
                <td key={col.key} style={{
                  padding: '10px 12px', textAlign: col.align || 'right', fontSize: 12,
                  fontFamily: col.mono !== false ? C.mono : C.sans, borderBottom: `1px solid ${C.border}`,
                  whiteSpace: 'nowrap', color: C.accent, fontWeight: 700,
                }}>{col.render ? col.render(totalsRow) : totalsRow[col.key]}</td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Section({ title, rightContent, children }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
      <div style={{ padding: '12px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: 10, fontWeight: 700, color: C.muted, margin: 0, textTransform: 'uppercase', letterSpacing: 1.2 }}>{title}</h3>
        {rightContent}
      </div>
      {children}
    </div>
  );
}

function Breadcrumb({ items }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
      {items.map((item, i) => (
        <span key={i}>
          {i > 0 && <span style={{ color: C.muted, margin: '0 4px' }}>›</span>}
          <span onClick={() => item.onClick && item.onClick()} style={{
            fontSize: 12, fontWeight: i === items.length - 1 ? 700 : 400,
            color: i === items.length - 1 ? C.text : C.accent, cursor: item.onClick ? 'pointer' : 'default',
          }}>{item.label}</span>
        </span>
      ))}
    </div>
  );
}

function GoalComparison({ policies, calls, pnl, goals }) {
  const companyGoals = goals?.company || {};
  if (!companyGoals.cpa) return null;
  const placed = policies.filter(isPlaced);
  const totalPremium = placed.reduce((s, p) => s + p.premium, 0);
  const totalLeadSpend = pnl.reduce((s, p) => s + p.leadSpend, 0);
  const billable = calls.filter(c => c.isBillable).length;
  const cpa = placed.length > 0 ? totalLeadSpend / placed.length : 0;
  const closeRate = billable > 0 ? placed.length / billable * 100 : 0;
  const placementRate = policies.length > 0 ? placed.length / policies.length * 100 : 0;
  const avgPremium = placed.length > 0 ? totalPremium / placed.length : 0;
  const billableRate = calls.length > 0 ? billable / calls.length * 100 : 0;
  const rpc = calls.length > 0 ? totalLeadSpend / calls.length : 0;

  const items = [
    { label: 'CPA', actual: cpa, goal: companyGoals.cpa, lower: true, format: v => fmtDollar(v) },
    { label: 'Close Rate', actual: closeRate, goal: companyGoals.conversionRate, format: fmtPct },
    { label: 'Placement Rate', actual: placementRate, goal: companyGoals.placementRate, format: fmtPct },
    { label: 'Avg Premium', actual: avgPremium, goal: 70, format: v => fmtDollar(v, 2) },
    { label: 'Billable Rate', actual: billableRate, goal: 65, format: fmtPct },
    { label: 'RPC', actual: rpc, goal: 35, lower: true, format: v => fmtDollar(v, 2) },
  ];

  return (
    <Section title="Goal Comparison">
      <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        {items.map(g => (
          <div key={g.label} style={{ background: goalBg(g.actual, g.goal, g.lower), borderRadius: 6, padding: '12px 16px', border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{g.label}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 20, fontWeight: 700, fontFamily: C.mono, color: goalColor(g.actual, g.goal, g.lower) }}>{g.format(g.actual)}</span>
              <span style={{ fontSize: 11, color: C.muted, fontFamily: C.mono }}>Goal: {g.format(g.goal)}</span>
            </div>
            <div style={{ marginTop: 8 }}><ProgressBar value={g.actual} goal={g.goal} lowerIsBetter={g.lower} width={140} /></div>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ─── DAILY ACTIVITY TAB ────────────────────────────
function DailyActivityTab({ policies, calls, pnl, goals, dateRange }) {
  const days = calcDays(dateRange.start, dateRange.end);
  const cg = goals?.company || {};
  const placed = policies.filter(isPlaced);
  const totalPremium = placed.reduce((s, p) => s + p.premium, 0);
  const totalGAR = placed.reduce((s, p) => s + p.grossAdvancedRevenue, 0);
  const totalComm = placed.reduce((s, p) => s + p.commission, 0);
  const totalCalls = calls.length;
  const billable = calls.filter(c => c.isBillable).length;
  const leadSpend = calls.reduce((s, c) => s + c.cost, 0);
  const cpa = placed.length > 0 ? leadSpend / placed.length : 0;
  const rpc = totalCalls > 0 ? leadSpend / totalCalls : 0;
  const billableRate = totalCalls > 0 ? billable / totalCalls * 100 : 0;
  const avgPrem = placed.length > 0 ? totalPremium / placed.length : 0;

  const byDay = {};
  policies.forEach(p => {
    if (!byDay[p.submitDate]) byDay[p.submitDate] = { date: p.submitDate, apps: 0, placed: 0, premium: 0, commission: 0, gar: 0, totalCalls: 0, billableCalls: 0, leadSpend: 0 };
    byDay[p.submitDate].apps++;
    if (isPlaced(p)) { byDay[p.submitDate].placed++; byDay[p.submitDate].premium += p.premium; byDay[p.submitDate].commission += p.commission; byDay[p.submitDate].gar += p.grossAdvancedRevenue; }
  });
  calls.forEach(c => {
    if (!byDay[c.date]) byDay[c.date] = { date: c.date, apps: 0, placed: 0, premium: 0, commission: 0, gar: 0, totalCalls: 0, billableCalls: 0, leadSpend: 0 };
    byDay[c.date].totalCalls++; if (c.isBillable) { byDay[c.date].billableCalls++; byDay[c.date].leadSpend += c.cost; }
  });
  const dailyRows = Object.values(byDay).sort((a, b) => b.date.localeCompare(a.date));

  return (
    <>
      <GoalComparison policies={policies} calls={calls} pnl={pnl} goals={goals} />
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <KPICard label="Apps Submitted" value={policies.length} goal={cg.appsSubmitted ? cg.appsSubmitted * days : null} subtitle={`${(policies.length / days).toFixed(1)}/day`} />
        <KPICard label="Policies Placed" value={placed.length} goal={cg.policiesPlaced ? cg.policiesPlaced * days : null} subtitle={`${(placed.length / days).toFixed(1)}/day`} />
        <KPICard label="Mo. Premium" value={fmtDollar(totalPremium, 2)} goal={cg.premiumTarget ? cg.premiumTarget * days : null} subtitle={`Avg: ${fmtDollar(avgPrem, 2)}`} />
        <KPICard label="Gross Adv. Revenue" value={fmtDollar(totalGAR)} subtitle="9mo (6mo CICA)" />
        <KPICard label="Lead Spend" value={fmtDollar(leadSpend)} subtitle={`RPC: ${fmtDollar(rpc, 2)} · Bill: ${fmtPct(billableRate)}`} />
        <KPICard label="CPA" value={fmtDollar(cpa)} goal={cg.cpa} lowerIsBetter />
        <KPICard label="Net Revenue" value={fmtDollar(totalGAR - leadSpend - totalComm)} subtitle={`Comm: ${fmtDollar(totalComm)}`} />
      </div>
      <Section title="Daily Breakdown">
        <SortableTable defaultSort="date" columns={[
          { key: 'date', label: 'Date', align: 'left', bold: true },
          { key: 'apps', label: 'Apps' },
          { key: 'placed', label: 'Placed', color: r => r.placed > 0 ? C.green : C.muted },
          { key: 'premium', label: 'Premium', render: r => fmtDollar(r.premium, 2), color: r => r.premium > 0 ? C.green : C.muted },
          { key: 'avgPrem', label: 'Avg Prem', render: r => r.placed > 0 ? fmtDollar(r.premium / r.placed, 2) : '—' },
          { key: 'gar', label: 'Gross Adv Rev', render: r => fmtDollar(r.gar), color: r => r.gar > 0 ? C.green : C.muted },
          { key: 'totalCalls', label: 'Calls', render: r => fmt(r.totalCalls || 0) },
          { key: 'billableCalls', label: 'Billable', render: r => fmt(r.billableCalls || 0) },
          { key: 'billableRate', label: 'Bill %', render: r => r.totalCalls > 0 ? fmtPct(r.billableCalls / r.totalCalls * 100) : '—' },
          { key: 'leadSpend', label: 'Spend', render: r => fmtDollar(r.leadSpend || 0), color: r => (r.leadSpend || 0) > 0 ? C.yellow : C.muted },
          { key: 'rpc', label: 'RPC', render: r => r.totalCalls > 0 ? fmtDollar(r.leadSpend / r.totalCalls, 2) : '—' },
          { key: 'cpa', label: 'CPA', render: r => r.placed > 0 && r.leadSpend ? fmtDollar(r.leadSpend / r.placed) : '—' },
          { key: 'net', label: 'Net Rev', render: r => fmtDollar(r.gar - (r.leadSpend || 0) - r.commission), color: r => (r.gar - (r.leadSpend || 0) - r.commission) > 0 ? C.green : C.red },
        ]} rows={dailyRows} />
      </Section>
    </>
  );
}

// ─── PUBLISHERS TAB ─────────────────────────────────
function PublishersTab({ pnl, policies, goals, calls }) {
  const [drill, setDrill] = useState(null);
  const cg = goals?.company || {};

  const pubTotals = useMemo(() => {
    const t = { campaign: 'TOTAL', vendor: '', totalCalls: 0, billableCalls: 0, leadSpend: 0, placedCount: 0, totalPremium: 0, grossAdvancedRevenue: 0, totalCommission: 0, pricePerCall: 0 };
    pnl.forEach(p => { t.totalCalls += p.totalCalls; t.billableCalls += p.billableCalls; t.leadSpend += p.leadSpend; t.placedCount += p.placedCount; t.totalPremium += p.totalPremium; t.grossAdvancedRevenue += p.grossAdvancedRevenue; t.totalCommission += p.totalCommission; });
    t.billableRate = t.totalCalls > 0 ? t.billableCalls / t.totalCalls * 100 : 0;
    t.rpc = t.totalCalls > 0 ? t.leadSpend / t.totalCalls : 0;
    t.closeRate = t.billableCalls > 0 ? t.placedCount / t.billableCalls * 100 : 0;
    t.cpa = t.placedCount > 0 ? t.leadSpend / t.placedCount : 0;
    t.avgPremium = t.placedCount > 0 ? t.totalPremium / t.placedCount : 0;
    t.netRevenue = t.grossAdvancedRevenue - t.leadSpend - t.totalCommission;
    return t;
  }, [pnl]);

  if (drill) {
    const pub = pnl.find(p => p.campaign === drill);
    if (!pub) { setDrill(null); return null; }
    const pp = policies.filter(p => p.leadSource === drill);
    const agentMap = {};
    pp.forEach(p => {
      if (!agentMap[p.agent]) agentMap[p.agent] = { agent: p.agent, apps: 0, placed: 0, premium: 0, commission: 0, gar: 0 };
      agentMap[p.agent].apps++;
      if (isPlaced(p)) { agentMap[p.agent].placed++; agentMap[p.agent].premium += p.premium; agentMap[p.agent].commission += p.commission; agentMap[p.agent].gar += p.grossAdvancedRevenue; }
    });
    (pub.agentBreakdown || []).forEach(a => {
      if (!agentMap[a.agent]) agentMap[a.agent] = { agent: a.agent, apps: 0, placed: 0, premium: 0, commission: 0, gar: 0 };
      agentMap[a.agent].totalCalls = a.totalCalls; agentMap[a.agent].billableCalls = a.billableCalls; agentMap[a.agent].leadSpend = a.leadSpend;
    });
    const carrierMap = {};
    pp.forEach(p => {
      if (!carrierMap[p.carrier]) carrierMap[p.carrier] = { carrier: p.carrier, apps: 0, placed: 0, premium: 0, commission: 0, gar: 0 };
      carrierMap[p.carrier].apps++;
      if (isPlaced(p)) { carrierMap[p.carrier].placed++; carrierMap[p.carrier].premium += p.premium; carrierMap[p.carrier].commission += p.commission; carrierMap[p.carrier].gar += p.grossAdvancedRevenue; }
    });
    return (
      <>
        <Breadcrumb items={[{ label: 'All Publishers', onClick: () => setDrill(null) }, { label: drill }]} />
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <KPICard label="Lead Spend" value={fmtDollar(pub.leadSpend)} subtitle={`${fmt(pub.billableCalls)} billable × ${fmtDollar(pub.pricePerCall)}`} />
          <KPICard label="Placed" value={pub.placedCount || 0} subtitle={`of ${pub.appCount || 0} apps`} />
          <KPICard label="CPA" value={fmtDollar(pub.cpa)} goal={cg.cpa} lowerIsBetter />
          <KPICard label="Mo. Premium" value={fmtDollar(pub.totalPremium, 2)} subtitle={`Avg: ${fmtDollar(pub.avgPremium, 2)}`} />
          <KPICard label="Bill %" value={fmtPct(pub.billableRate)} />
          <KPICard label="RPC" value={fmtDollar(pub.rpc, 2)} />
          <KPICard label="Gross Adv Rev" value={fmtDollar(pub.grossAdvancedRevenue)} />
          <KPICard label="Net Revenue" value={fmtDollar(pub.netRevenue)} />
        </div>
        <Section title="Agent Breakdown">
          <SortableTable defaultSort="premium" columns={[
            { key: 'agent', label: 'Agent', align: 'left', bold: true, mono: false },
            { key: 'apps', label: 'Apps' }, { key: 'placed', label: 'Placed', color: r => r.placed > 0 ? C.green : C.muted },
            { key: 'premium', label: 'Premium', render: r => fmtDollar(r.premium, 2), color: () => C.green },
            { key: 'avgPrem', label: 'Avg Prem', render: r => r.placed > 0 ? fmtDollar(r.premium / r.placed, 2) : '—' },
            { key: 'totalCalls', label: 'Calls', render: r => fmt(r.totalCalls || 0) },
            { key: 'billableCalls', label: 'Billable', render: r => fmt(r.billableCalls || 0) },
            { key: 'billRate', label: 'Bill %', render: r => (r.totalCalls || 0) > 0 ? fmtPct(r.billableCalls / r.totalCalls * 100) : '—' },
            { key: 'leadSpend', label: 'Spend', render: r => fmtDollar(r.leadSpend || 0), color: () => C.yellow },
            { key: 'rpc', label: 'RPC', render: r => (r.totalCalls || 0) > 0 ? fmtDollar(r.leadSpend / r.totalCalls, 2) : '—' },
            { key: 'cpa', label: 'CPA', render: r => r.placed > 0 && r.leadSpend ? fmtDollar(r.leadSpend / r.placed) : '—' },
          ]} rows={Object.values(agentMap)} />
        </Section>
        <Section title="Carrier Breakdown">
          <SortableTable defaultSort="premium" columns={[
            { key: 'carrier', label: 'Carrier', align: 'left', bold: true, mono: false },
            { key: 'apps', label: 'Apps' }, { key: 'placed', label: 'Placed', color: r => r.placed > 0 ? C.green : C.muted },
            { key: 'premium', label: 'Premium', render: r => fmtDollar(r.premium, 2), color: () => C.green },
            { key: 'avgPrem', label: 'Avg Prem', render: r => r.placed > 0 ? fmtDollar(r.premium / r.placed, 2) : '—' },
            { key: 'commission', label: 'Commission', render: r => fmtDollar(r.commission), color: () => C.accent },
            { key: 'gar', label: 'Gross Adv Rev', render: r => fmtDollar(r.gar), color: () => C.green },
          ]} rows={Object.values(carrierMap)} />
        </Section>
      </>
    );
  }
  return (
    <Section title="Publisher Performance" rightContent={<span style={{ fontSize: 10, color: C.muted }}>Click a row to drill down</span>}>
      <SortableTable defaultSort="totalPremium" onRowClick={r => r.campaign !== 'TOTAL' && setDrill(r.campaign)} totalsRow={pubTotals} columns={[
        { key: 'campaign', label: 'Publisher', align: 'left', bold: true, mono: false },
        { key: 'vendor', label: 'Vendor', align: 'left', mono: false, color: () => C.muted },
        { key: 'totalCalls', label: 'Calls' }, { key: 'billableCalls', label: 'Billable' },
        { key: 'billableRate', label: 'Bill %', render: r => fmtPct(r.billableRate) },
        { key: 'pricePerCall', label: '$/Call', render: r => r.pricePerCall > 0 ? fmtDollar(r.pricePerCall) : '—' },
        { key: 'leadSpend', label: 'Spend', render: r => fmtDollar(r.leadSpend), color: r => r.leadSpend > 0 ? C.yellow : C.muted },
        { key: 'rpc', label: 'RPC', render: r => r.totalCalls > 0 ? fmtDollar(r.rpc, 2) : '—' },
        { key: 'placedCount', label: 'Sales', color: r => r.placedCount > 0 ? C.green : C.muted },
        { key: 'closeRate', label: 'Close %', render: r => fmtPct(r.closeRate) },
        { key: 'cpa', label: 'CPA', render: r => r.cpa > 0 ? fmtDollar(r.cpa) : '—', color: r => goalColor(r.cpa, cg.cpa, true) },
        { key: 'totalPremium', label: 'Mo. Prem', render: r => fmtDollar(r.totalPremium, 2), color: r => r.totalPremium > 0 ? C.green : C.muted },
        { key: 'avgPremium', label: 'Avg Prem', render: r => fmtDollar(r.avgPremium, 2) },
        { key: 'grossAdvancedRevenue', label: 'Gross Adv', render: r => fmtDollar(r.grossAdvancedRevenue), color: r => r.grossAdvancedRevenue > 0 ? C.green : C.muted },
        { key: 'totalCommission', label: 'Comm', render: r => fmtDollar(r.totalCommission), color: () => C.accent },
        { key: 'netRevenue', label: 'Net Rev', render: r => fmtDollar(r.netRevenue), color: r => r.netRevenue > 0 ? C.green : C.red, bold: true },
      ]} rows={pnl} />
    </Section>
  );
}

// ─── AGENTS TAB ──────────────────────────────────────
function AgentsTab({ policies, calls, goals, dateRange }) {
  const [drill, setDrill] = useState(null);
  const days = calcDays(dateRange.start, dateRange.end);
  const ag = goals?.agent || {};
  const agentMap = {};
  policies.forEach(p => {
    if (!agentMap[p.agent]) agentMap[p.agent] = { agent: p.agent, apps: 0, placed: 0, premium: 0, commission: 0, faceAmount: 0, gar: 0 };
    agentMap[p.agent].apps++;
    if (isPlaced(p)) { agentMap[p.agent].placed++; agentMap[p.agent].premium += p.premium; agentMap[p.agent].commission += p.commission; agentMap[p.agent].faceAmount += p.faceAmount; agentMap[p.agent].gar += p.grossAdvancedRevenue; }
  });
  calls.forEach(c => {
    if (!c.rep) return;
    if (!agentMap[c.rep]) agentMap[c.rep] = { agent: c.rep, apps: 0, placed: 0, premium: 0, commission: 0, faceAmount: 0, gar: 0 };
    agentMap[c.rep].totalCalls = (agentMap[c.rep].totalCalls || 0) + 1;
    if (c.isBillable) { agentMap[c.rep].billableCalls = (agentMap[c.rep].billableCalls || 0) + 1; agentMap[c.rep].leadSpend = (agentMap[c.rep].leadSpend || 0) + c.cost; }
  });
  const agentRows = Object.values(agentMap).sort((a, b) => b.premium - a.premium);
  function getGoal(name, m) {
    const o = ag.overrides?.[name]; if (o && o[m] != null) return o[m] * days;
    if (ag.defaults?.[m] != null) return ag.defaults[m] * days; return null;
  }

  const agentTotals = useMemo(() => {
    const t = { agent: 'TOTAL', apps: 0, placed: 0, premium: 0, commission: 0, gar: 0, totalCalls: 0, billableCalls: 0, leadSpend: 0 };
    agentRows.forEach(a => { t.apps += a.apps; t.placed += a.placed; t.premium += a.premium; t.commission += a.commission; t.gar += a.gar; t.totalCalls += (a.totalCalls || 0); t.billableCalls += (a.billableCalls || 0); t.leadSpend += (a.leadSpend || 0); });
    return t;
  }, [agentRows]);

  if (drill) {
    const a = agentMap[drill]; if (!a) { setDrill(null); return null; }
    const ap = policies.filter(p => p.agent === drill);
    const carrierMap = {}, sourceMap = {};
    ap.forEach(p => {
      if (!carrierMap[p.carrier]) carrierMap[p.carrier] = { carrier: p.carrier, apps: 0, placed: 0, premium: 0, commission: 0, gar: 0 };
      carrierMap[p.carrier].apps++; if (isPlaced(p)) { carrierMap[p.carrier].placed++; carrierMap[p.carrier].premium += p.premium; carrierMap[p.carrier].commission += p.commission; carrierMap[p.carrier].gar += p.grossAdvancedRevenue; }
      if (!sourceMap[p.leadSource]) sourceMap[p.leadSource] = { leadSource: p.leadSource, apps: 0, placed: 0, premium: 0 };
      sourceMap[p.leadSource].apps++; if (isPlaced(p)) { sourceMap[p.leadSource].placed++; sourceMap[p.leadSource].premium += p.premium; }
    });
    const billRate = (a.totalCalls || 0) > 0 ? (a.billableCalls || 0) / a.totalCalls * 100 : 0;
    const rpc = (a.totalCalls || 0) > 0 ? (a.leadSpend || 0) / a.totalCalls : 0;
    return (
      <>
        <Breadcrumb items={[{ label: 'All Agents', onClick: () => setDrill(null) }, { label: drill }]} />
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <KPICard label="Apps" value={a.apps} />
          <KPICard label="Placed" value={a.placed} goal={getGoal(drill, 'policiesPlaced')} />
          <KPICard label="Premium" value={fmtDollar(a.premium, 2)} goal={getGoal(drill, 'premiumTarget')} subtitle={`Avg: ${fmtDollar(a.placed > 0 ? a.premium / a.placed : 0, 2)}`} />
          <KPICard label="Gross Adv Rev" value={fmtDollar(a.gar)} />
          <KPICard label="Commission" value={fmtDollar(a.commission)} />
          <KPICard label="Bill %" value={fmtPct(billRate)} />
          <KPICard label="RPC" value={fmtDollar(rpc, 2)} />
        </div>
        <Section title="By Carrier">
          <SortableTable defaultSort="premium" columns={[
            { key: 'carrier', label: 'Carrier', align: 'left', bold: true, mono: false },
            { key: 'apps', label: 'Apps' }, { key: 'placed', label: 'Placed', color: r => r.placed > 0 ? C.green : C.muted },
            { key: 'premium', label: 'Premium', render: r => fmtDollar(r.premium, 2), color: () => C.green },
            { key: 'avgPrem', label: 'Avg Prem', render: r => r.placed > 0 ? fmtDollar(r.premium / r.placed, 2) : '—' },
            { key: 'commission', label: 'Commission', render: r => fmtDollar(r.commission), color: () => C.accent },
            { key: 'gar', label: 'Gross Adv Rev', render: r => fmtDollar(r.gar), color: () => C.green },
          ]} rows={Object.values(carrierMap)} />
        </Section>
        <Section title="By Lead Source">
          <SortableTable defaultSort="premium" columns={[
            { key: 'leadSource', label: 'Source', align: 'left', bold: true, mono: false },
            { key: 'apps', label: 'Apps' }, { key: 'placed', label: 'Placed', color: r => r.placed > 0 ? C.green : C.muted },
            { key: 'premium', label: 'Premium', render: r => fmtDollar(r.premium, 2), color: () => C.green },
            { key: 'avgPrem', label: 'Avg Prem', render: r => r.placed > 0 ? fmtDollar(r.premium / r.placed, 2) : '—' },
          ]} rows={Object.values(sourceMap)} />
        </Section>
        <Section title="Recent Policies">
          <SortableTable defaultSort="submitDate" columns={[
            { key: 'submitDate', label: 'Date', align: 'left', bold: true },
            { key: 'carrier', label: 'Carrier', align: 'left', mono: false },
            { key: 'product', label: 'Product', align: 'left', mono: false, color: () => C.muted },
            { key: 'faceAmount', label: 'Face', render: r => fmtDollar(r.faceAmount) },
            { key: 'premium', label: 'Premium', render: r => fmtDollar(r.premium, 2), color: () => C.green },
            { key: 'outcome', label: 'Outcome', align: 'left', mono: false },
            { key: 'placed', label: 'Status', align: 'left', mono: false, color: r => r.placed === 'Declined' ? C.red : r.placed.includes('Active') || r.placed.includes('Advance') ? C.green : C.yellow },
            { key: 'state', label: 'State' },
          ]} rows={ap} />
        </Section>
      </>
    );
  }
  return (
    <Section title="Agent Rankings" rightContent={<span style={{ fontSize: 10, color: C.muted }}>Click a row to drill down</span>}>
      <SortableTable defaultSort="premium" onRowClick={r => r.agent !== 'TOTAL' && setDrill(r.agent)} totalsRow={agentTotals} columns={[
        { key: 'agent', label: 'Agent', align: 'left', bold: true, mono: false },
        { key: 'apps', label: 'Apps' }, { key: 'placed', label: 'Placed', color: r => r.placed > 0 ? C.green : C.muted },
        { key: 'premium', label: 'Mo. Prem', render: r => fmtDollar(r.premium, 2), color: () => C.green, bold: true },
        { key: 'avgPrem', label: 'Avg Prem', render: r => r.placed > 0 ? fmtDollar(r.premium / r.placed, 2) : '—' },
        { key: 'premGoal', label: 'Prem Goal', render: r => r.agent === 'TOTAL' ? '' : <ProgressBar value={r.premium} goal={getGoal(r.agent, 'premiumTarget')} />, sortable: false },
        { key: 'commission', label: 'Commission', render: r => fmtDollar(r.commission), color: () => C.accent },
        { key: 'gar', label: 'Gross Adv', render: r => fmtDollar(r.gar), color: () => C.green },
        { key: 'totalCalls', label: 'Calls', render: r => fmt(r.totalCalls || 0) },
        { key: 'billRate', label: 'Bill %', render: r => (r.totalCalls || 0) > 0 ? fmtPct((r.billableCalls || 0) / r.totalCalls * 100) : '—' },
        { key: 'rpc', label: 'RPC', render: r => (r.totalCalls || 0) > 0 ? fmtDollar((r.leadSpend || 0) / r.totalCalls, 2) : '—' },
        { key: 'placementRate', label: 'Place %', render: r => r.apps > 0 ? fmtPct(r.placed / r.apps * 100) : '—' },
      ]} rows={agentRows} />
    </Section>
  );
}

// ─── CARRIERS TAB ────────────────────────────────────
function CarriersTab({ policies, goals, calls, dateRange }) {
  const [drill, setDrill] = useState(null);

  // Group by Carrier + Product + Payout
  const carrierMap = {};
  policies.forEach(p => {
    const key = [p.carrier, p.product].join('|||');
    if (!carrierMap[key]) carrierMap[key] = { key, carrier: p.carrier || '—', product: p.product || '—', apps: 0, placed: 0, premium: 0, commission: 0, faceAmount: 0, gar: 0, agents: new Set(), states: new Set() };
    carrierMap[key].apps++; carrierMap[key].agents.add(p.agent); carrierMap[key].states.add(p.state);
    if (isPlaced(p)) { carrierMap[key].placed++; carrierMap[key].premium += p.premium; carrierMap[key].commission += p.commission; carrierMap[key].faceAmount += p.faceAmount; carrierMap[key].gar += p.grossAdvancedRevenue; }
  });
  const carrierRows = Object.values(carrierMap).map(c => ({ ...c, agentCount: c.agents.size, stateCount: c.states.size })).sort((a, b) => b.premium - a.premium);

  const carrierTotals = useMemo(() => {
    const t = { key: 'TOTAL', carrier: 'TOTAL', product: '', apps: 0, placed: 0, premium: 0, commission: 0, faceAmount: 0, gar: 0, agentCount: 0, stateCount: 0 };
    carrierRows.forEach(c => { t.apps += c.apps; t.placed += c.placed; t.premium += c.premium; t.commission += c.commission; t.faceAmount += c.faceAmount; t.gar += c.gar; });
    return t;
  }, [carrierRows]);

  if (drill) {
    const carrier = carrierMap[drill]; if (!carrier) { setDrill(null); return null; }
    const cp = policies.filter(p => [p.carrier, p.product].join('|||') === drill);
    const agentMap = {};
    cp.forEach(p => {
      if (!agentMap[p.agent]) agentMap[p.agent] = { agent: p.agent, apps: 0, placed: 0, premium: 0, commission: 0, gar: 0 };
      agentMap[p.agent].apps++; if (isPlaced(p)) { agentMap[p.agent].placed++; agentMap[p.agent].premium += p.premium; agentMap[p.agent].commission += p.commission; agentMap[p.agent].gar += p.grossAdvancedRevenue; }
    });
    return (
      <>
        <Breadcrumb items={[{ label: 'All Carriers', onClick: () => setDrill(null) }, { label: `${carrier.carrier} · ${carrier.product}` }]} />
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <KPICard label="Apps" value={carrier.apps} />
          <KPICard label="Placed" value={carrier.placed} />
          <KPICard label="Premium" value={fmtDollar(carrier.premium, 2)} subtitle={`Avg: ${fmtDollar(carrier.placed > 0 ? carrier.premium / carrier.placed : 0, 2)}`} />
          <KPICard label="Gross Adv Rev" value={fmtDollar(carrier.gar)} />
          <KPICard label="Commission" value={fmtDollar(carrier.commission)} />
          <KPICard label="Place %" value={fmtPct(carrier.apps > 0 ? carrier.placed / carrier.apps * 100 : 0)} />
        </div>
        <Section title="By Agent">
          <SortableTable defaultSort="premium" columns={[
            { key: 'agent', label: 'Agent', align: 'left', bold: true, mono: false },
            { key: 'apps', label: 'Apps' }, { key: 'placed', label: 'Placed', color: r => r.placed > 0 ? C.green : C.muted },
            { key: 'premium', label: 'Premium', render: r => fmtDollar(r.premium, 2), color: () => C.green },
            { key: 'avgPrem', label: 'Avg Prem', render: r => r.placed > 0 ? fmtDollar(r.premium / r.placed, 2) : '—' },
            { key: 'commission', label: 'Commission', render: r => fmtDollar(r.commission), color: () => C.accent },
          ]} rows={Object.values(agentMap)} />
        </Section>
        <Section title="Policies">
          <SortableTable defaultSort="submitDate" columns={[
            { key: 'submitDate', label: 'Date', align: 'left', bold: true },
            { key: 'agent', label: 'Agent', align: 'left', mono: false },
            { key: 'faceAmount', label: 'Face', render: r => fmtDollar(r.faceAmount) },
            { key: 'premium', label: 'Premium', render: r => fmtDollar(r.premium, 2), color: () => C.green },
            { key: 'placed', label: 'Status', align: 'left', mono: false, color: r => r.placed === 'Declined' ? C.red : isPlaced(r) ? C.green : C.yellow },
            { key: 'state', label: 'State' },
          ]} rows={cp} />
        </Section>
      </>
    );
  }
  return (
    <Section title="Carrier / Product Overview" rightContent={<span style={{ fontSize: 10, color: C.muted }}>Click a row to drill down</span>}>
      <SortableTable defaultSort="premium" onRowClick={r => r.key !== 'TOTAL' && setDrill(r.key)} totalsRow={carrierTotals} columns={[
        { key: 'carrier', label: 'Carrier', align: 'left', bold: true, mono: false },
        { key: 'product', label: 'Product', align: 'left', mono: false },
        { key: 'apps', label: 'Apps' }, { key: 'placed', label: 'Placed', color: r => r.placed > 0 ? C.green : C.muted },
        { key: 'premium', label: 'Mo. Prem', render: r => fmtDollar(r.premium, 2), color: () => C.green, bold: true },
        { key: 'avgPrem', label: 'Avg Prem', render: r => r.placed > 0 ? fmtDollar(r.premium / r.placed, 2) : '—' },
        { key: 'commission', label: 'Commission', render: r => fmtDollar(r.commission), color: () => C.accent },
        { key: 'gar', label: 'Gross Adv', render: r => fmtDollar(r.gar), color: () => C.green },
        { key: 'netRev', label: 'Net Rev', render: r => { const n = r.gar - r.commission; return fmtDollar(n); }, color: r => (r.gar - r.commission) > 0 ? C.green : C.red },
        { key: 'placementRate', label: 'Place %', render: r => r.apps > 0 ? fmtPct(r.placed / r.apps * 100) : '—' },
        { key: 'avgFace', label: 'Avg Face', render: r => r.placed > 0 ? fmtDollar(r.faceAmount / r.placed) : '—' },
        { key: 'agentCount', label: 'Agents' }, { key: 'stateCount', label: 'States' },
      ]} rows={carrierRows} />
    </Section>
  );
}

// ─── P&L TAB ─────────────────────────────────────────
function PnlTab({ pnl, policies, calls, goals }) {
  const placed = policies.filter(isPlaced);
  const totalPremium = placed.reduce((s, p) => s + p.premium, 0);
  const totalComm = placed.reduce((s, p) => s + p.commission, 0);
  const totalGAR = placed.reduce((s, p) => s + p.grossAdvancedRevenue, 0);
  const totalSpend = pnl.reduce((s, p) => s + p.leadSpend, 0);
  const totalCalls = calls.length;
  const billable = calls.filter(c => c.isBillable).length;
  const cg = goals?.company || {};
  const cpa = placed.length > 0 ? totalSpend / placed.length : 0;
  const rpc = totalCalls > 0 ? totalSpend / totalCalls : 0;
  const billableRate = totalCalls > 0 ? billable / totalCalls * 100 : 0;
  const netRev = totalGAR - totalSpend - totalComm;

  return (
    <>
      <GoalComparison policies={policies} calls={calls} pnl={pnl} goals={goals} />
      <Section title="P&L Summary">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 1, padding: 1, background: C.border }}>
          {[
            { label: 'Total Calls', value: fmt(totalCalls) },
            { label: 'Billable Calls', value: fmt(billable) },
            { label: 'Billable Rate', value: fmtPct(billableRate) },
            { label: 'Lead Spend', value: fmtDollar(totalSpend), color: C.yellow },
            { label: 'RPC', value: fmtDollar(rpc, 2) },
            { label: 'Applications', value: fmt(policies.length) },
            { label: 'Policies Placed', value: fmt(placed.length), color: C.green },
            { label: 'Close Rate', value: fmtPct(billable > 0 ? placed.length / billable * 100 : 0) },
            { label: 'CPA', value: fmtDollar(cpa), color: goalColor(cpa, cg.cpa, true) },
            { label: 'Monthly Premium', value: fmtDollar(totalPremium, 2), color: C.green },
            { label: 'Avg Premium', value: fmtDollar(placed.length > 0 ? totalPremium / placed.length : 0, 2) },
            { label: 'Premium:Cost', value: totalSpend > 0 ? (totalPremium / totalSpend).toFixed(2) + 'x' : '—' },
            { label: 'Gross Adv Revenue', value: fmtDollar(totalGAR), color: C.green },
            { label: 'Agent Commission', value: fmtDollar(totalComm), color: C.accent },
            { label: 'Net Revenue', value: fmtDollar(netRev), color: netRev > 0 ? C.green : C.red },
          ].map(item => (
            <div key={item.label} style={{ background: C.card, padding: '14px 18px' }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 6 }}>{item.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: item.color || C.text, fontFamily: C.mono }}>{item.value}</div>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Publisher P&L Detail">
        <SortableTable defaultSort="netRevenue" columns={[
          { key: 'campaign', label: 'Publisher', align: 'left', bold: true, mono: false },
          { key: 'vendor', label: 'Vendor', align: 'left', mono: false, color: () => C.muted },
          { key: 'totalCalls', label: 'Calls' }, { key: 'billableCalls', label: 'Billable' },
          { key: 'billableRate', label: 'Bill %', render: r => fmtPct(r.billableRate) },
          { key: 'pricePerCall', label: '$/Call', render: r => r.pricePerCall > 0 ? fmtDollar(r.pricePerCall) : '—' },
          { key: 'leadSpend', label: 'Spend', render: r => fmtDollar(r.leadSpend), color: r => r.leadSpend > 0 ? C.yellow : C.muted },
          { key: 'rpc', label: 'RPC', render: r => r.totalCalls > 0 ? fmtDollar(r.rpc, 2) : '—' },
          { key: 'placedCount', label: 'Sales', color: r => (r.placedCount || 0) > 0 ? C.green : C.muted },
          { key: 'closeRate', label: 'Close %', render: r => fmtPct(r.closeRate) },
          { key: 'cpa', label: 'CPA', render: r => r.cpa > 0 ? fmtDollar(r.cpa) : '—', color: r => goalColor(r.cpa, cg.cpa, true) },
          { key: 'totalPremium', label: 'Mo. Prem', render: r => fmtDollar(r.totalPremium, 2), color: r => r.totalPremium > 0 ? C.green : C.muted },
          { key: 'avgPremium', label: 'Avg Prem', render: r => fmtDollar(r.avgPremium, 2) },
          { key: 'grossAdvancedRevenue', label: 'Gross Adv', render: r => fmtDollar(r.grossAdvancedRevenue) },
          { key: 'totalCommission', label: 'Comm', render: r => fmtDollar(r.totalCommission), color: () => C.accent },
          { key: 'netRevenue', label: 'Net Rev', render: r => fmtDollar(r.netRevenue), color: r => r.netRevenue > 0 ? C.green : C.red, bold: true },
        ]} rows={pnl} />
      </Section>
    </>
  );
}

// ─── MAIN DASHBOARD ──────────────────────────────────
export default function Dashboard({ data, goals, loading, dateRange, applyPreset, setCustomRange }) {
  const [activeTab, setActiveTab] = useState('daily');
  if (loading || !data) {
    return (
      <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.text, fontFamily: C.sans }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 40, height: 40, border: `3px solid ${C.border}`, borderTopColor: C.accent, borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
          <p style={{ color: C.muted, fontSize: 14 }}>Loading dashboard data...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }
  const { policies, calls, pnl } = data;
  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text, fontFamily: C.sans }}>
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: '12px 24px', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div>
              <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0, letterSpacing: -0.3 }}>True Choice Coverage</h1>
              <p style={{ fontSize: 10, color: C.muted, margin: '2px 0 0' }}>{policies.length} policies · {calls.length} calls · {pnl.length} publishers</p>
            </div>
            <a href="/trends" style={{ padding: '6px 14px', borderRadius: 5, fontSize: 11, fontWeight: 600, background: C.accentDim, color: C.accent, textDecoration: 'none', border: `1px solid ${C.accent}33` }}>📈 Trends</a>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', gap: 1, background: C.card, borderRadius: 6, padding: 2, border: `1px solid ${C.border}` }}>
              {[{ id: 'yesterday', label: 'Yest' }, { id: 'today', label: 'Today' }, { id: 'last7', label: '7D' }, { id: 'last30', label: '30D' }, { id: 'mtd', label: 'MTD' }, { id: 'all', label: 'All' }].map(p => (
                <button key={p.id} onClick={() => applyPreset(p.id)} style={{
                  padding: '5px 10px', borderRadius: 4, border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  background: dateRange.preset === p.id ? C.accent : 'transparent', color: dateRange.preset === p.id ? '#fff' : C.muted,
                }}>{p.label}</button>
              ))}
            </div>
            <input type="date" value={dateRange.start} onChange={e => setCustomRange('start', e.target.value)} style={{ background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: '4px 6px', fontSize: 10, outline: 'none', width: 110 }} />
            <span style={{ color: C.muted, fontSize: 10 }}>–</span>
            <input type="date" value={dateRange.end} onChange={e => setCustomRange('end', e.target.value)} style={{ background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: '4px 6px', fontSize: 10, outline: 'none', width: 110 }} />
          </div>
        </div>
      </div>
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', gap: 0, padding: '0 24px' }}>
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              padding: '10px 20px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', background: 'transparent',
              borderBottom: `2px solid ${activeTab === tab.id ? C.accent : 'transparent'}`, color: activeTab === tab.id ? C.text : C.muted, transition: 'all 0.15s ease',
            }}>{tab.label}</button>
          ))}
        </div>
      </div>
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '20px 24px' }}>
        {activeTab === 'daily' && <DailyActivityTab policies={policies} calls={calls} pnl={pnl} goals={goals} dateRange={dateRange} />}
        {activeTab === 'publishers' && <PublishersTab pnl={pnl} policies={policies} goals={goals} calls={calls} />}
        {activeTab === 'agents' && <AgentsTab policies={policies} calls={calls} goals={goals} dateRange={dateRange} />}
        {activeTab === 'carriers' && <CarriersTab policies={policies} goals={goals} calls={calls} dateRange={dateRange} />}
        {activeTab === 'pnl' && <PnlTab pnl={pnl} policies={policies} calls={calls} goals={goals} />}
      </div>
    </div>
  );
}
