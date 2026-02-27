'use client';
import { useState, useMemo } from 'react';

// ═══════════════════════════════════════════════════════════════
// True Choice Coverage — Full Dashboard Component
// ═══════════════════════════════════════════════════════════════

const C = {
  bg: '#080b10', surface: '#0f1520', card: '#131b28', border: '#1a2538',
  text: '#e2e8f4', muted: '#5a6a82', accent: '#3b82f6', accentDim: '#1e3a5f',
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

// ─── Utility Functions ──────────────────────────────────────

function fmt(n, decimals = 0) {
  if (n == null || isNaN(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtDollar(n, decimals = 0) {
  if (n == null || isNaN(n)) return '—';
  const prefix = n < 0 ? '-$' : '$';
  return prefix + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  return n.toFixed(1) + '%';
}

function goalColor(actual, goal, lowerIsBetter = false) {
  if (!goal || !actual) return C.muted;
  const ratio = lowerIsBetter ? goal / actual : actual / goal;
  if (ratio >= 1) return C.green;
  if (ratio >= 0.8) return C.yellow;
  return C.red;
}

function goalBg(actual, goal, lowerIsBetter = false) {
  if (!goal || !actual) return 'transparent';
  const ratio = lowerIsBetter ? goal / actual : actual / goal;
  if (ratio >= 1) return C.greenDim;
  if (ratio >= 0.8) return C.yellowDim;
  return C.redDim;
}

function calcDaysBetween(start, end) {
  if (!start || !end) return 1;
  const s = new Date(start);
  const e = new Date(end);
  const diff = Math.ceil((e - s) / (1000 * 60 * 60 * 24)) + 1;
  return Math.max(diff, 1);
}

// ─── Sub-Components ─────────────────────────────────────────

function KPICard({ label, value, goal, lowerIsBetter, subtitle }) {
  const color = goal ? goalColor(typeof value === 'string' ? parseFloat(value) : value, goal, lowerIsBetter) : C.accent;
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
      padding: '16px 20px', flex: '1 1 0', minWidth: 150,
      borderTop: `3px solid ${color}`,
    }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color, fontFamily: C.mono, lineHeight: 1 }}>{value}</div>
      {goal && (
        <div style={{ fontSize: 10, color: C.muted, marginTop: 6, fontFamily: C.mono }}>
          Goal: {typeof goal === 'number' && goal > 1 ? fmtDollar(goal) : goal} 
        </div>
      )}
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

function SortableTable({ columns, rows, defaultSort, onRowClick }) {
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

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {columns.map(col => (
              <th key={col.key} onClick={() => col.sortable !== false && toggleSort(col.key)} style={{
                padding: '10px 12px', textAlign: col.align || 'right', fontSize: 9,
                fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1,
                borderBottom: `2px solid ${C.border}`, background: C.surface, whiteSpace: 'nowrap',
                cursor: col.sortable !== false ? 'pointer' : 'default',
                ...(col.key === sortCol ? { color: C.accent } : {}),
              }}>
                {col.label} {col.key === sortCol ? (sortDir === 'asc' ? '↑' : '↓') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={i}
              onClick={() => onRowClick && onRowClick(row)}
              onMouseEnter={e => e.currentTarget.style.background = '#151f30'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              style={{ cursor: onRowClick ? 'pointer' : 'default' }}
            >
              {columns.map(col => (
                <td key={col.key} style={{
                  padding: '10px 12px', textAlign: col.align || 'right',
                  fontSize: 12, fontFamily: col.mono !== false ? C.mono : C.sans,
                  borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap',
                  color: col.color ? col.color(row) : C.text,
                  fontWeight: col.bold ? 600 : 400,
                }}>
                  {col.render ? col.render(row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr><td colSpan={columns.length} style={{ padding: 24, textAlign: 'center', color: C.muted, fontSize: 13 }}>No data for this date range</td></tr>
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

function Breadcrumb({ items, onNavigate }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
      {items.map((item, i) => (
        <span key={i}>
          {i > 0 && <span style={{ color: C.muted, margin: '0 4px' }}>›</span>}
          <span
            onClick={() => item.onClick && item.onClick()}
            style={{
              fontSize: 12, fontWeight: i === items.length - 1 ? 700 : 400,
              color: i === items.length - 1 ? C.text : C.accent,
              cursor: item.onClick ? 'pointer' : 'default',
            }}
          >{item.label}</span>
        </span>
      ))}
    </div>
  );
}

// ─── Tab Views ──────────────────────────────────────────────

function DailyActivityTab({ policies, calls, goals, dateRange }) {
  const days = calcDaysBetween(dateRange.start, dateRange.end);
  const companyGoals = goals?.company || {};

  const isPlaced = p => ['Advance Released', 'Active - In Force', 'Submitted - Pending'].includes(p.placed);
  const placed = policies.filter(isPlaced);
  const totalPremium = placed.reduce((s, p) => s + p.premium, 0);
  const totalCommission = placed.reduce((s, p) => s + p.commission, 0);
  const totalCalls = calls.length;
  const billableCalls = calls.filter(c => c.isBillable).length;
  const leadSpend = calls.reduce((s, c) => s + c.cost, 0);
  const cpa = placed.length > 0 ? leadSpend / placed.length : 0;
  const placementRate = policies.length > 0 ? (placed.length / policies.length) * 100 : 0;
  const conversionRate = billableCalls > 0 ? (placed.length / billableCalls) * 100 : 0;

  // Group by day
  const byDay = {};
  policies.forEach(p => {
    if (!byDay[p.submitDate]) byDay[p.submitDate] = { date: p.submitDate, apps: 0, placed: 0, premium: 0, commission: 0 };
    byDay[p.submitDate].apps++;
    if (isPlaced(p)) { byDay[p.submitDate].placed++; byDay[p.submitDate].premium += p.premium; byDay[p.submitDate].commission += p.commission; }
  });
  calls.forEach(c => {
    if (!byDay[c.date]) byDay[c.date] = { date: c.date, apps: 0, placed: 0, premium: 0, commission: 0 };
    if (!byDay[c.date].totalCalls) byDay[c.date].totalCalls = 0;
    if (!byDay[c.date].billableCalls) byDay[c.date].billableCalls = 0;
    if (!byDay[c.date].leadSpend) byDay[c.date].leadSpend = 0;
    byDay[c.date].totalCalls++;
    if (c.isBillable) { byDay[c.date].billableCalls++; byDay[c.date].leadSpend += c.cost; }
  });
  const dailyRows = Object.values(byDay).sort((a, b) => b.date.localeCompare(a.date));

  return (
    <>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <KPICard label="Apps Submitted" value={policies.length} goal={companyGoals.appsSubmitted ? companyGoals.appsSubmitted * days : null} subtitle={`${(policies.length / days).toFixed(1)}/day`} />
        <KPICard label="Policies Placed" value={placed.length} goal={companyGoals.policiesPlaced ? companyGoals.policiesPlaced * days : null} subtitle={`${(placed.length / days).toFixed(1)}/day`} />
        <KPICard label="Monthly Premium" value={fmtDollar(totalPremium, 2)} goal={companyGoals.premiumTarget ? companyGoals.premiumTarget * days : null} subtitle={`${fmtDollar(totalPremium / days, 2)}/day`} />
        <KPICard label="Placement Rate" value={fmtPct(placementRate)} goal={companyGoals.placementRate} />
        <KPICard label="CPA" value={fmtDollar(cpa)} goal={companyGoals.cpa} lowerIsBetter />
        <KPICard label="Lead Spend" value={fmtDollar(leadSpend)} subtitle={`${fmt(billableCalls)} billable of ${fmt(totalCalls)} calls`} />
      </div>

      <Section title="Daily Breakdown">
        <SortableTable
          defaultSort="date"
          columns={[
            { key: 'date', label: 'Date', align: 'left', bold: true },
            { key: 'apps', label: 'Apps' },
            { key: 'placed', label: 'Placed', color: r => r.placed > 0 ? C.green : C.muted },
            { key: 'premium', label: 'Premium', render: r => fmtDollar(r.premium, 2), color: r => r.premium > 0 ? C.green : C.muted },
            { key: 'placementRate', label: 'Place %', render: r => r.apps > 0 ? fmtPct(r.placed / r.apps * 100) : '—' },
            { key: 'totalCalls', label: 'Calls', render: r => fmt(r.totalCalls || 0) },
            { key: 'billableCalls', label: 'Billable', render: r => fmt(r.billableCalls || 0) },
            { key: 'leadSpend', label: 'Lead Spend', render: r => fmtDollar(r.leadSpend || 0), color: r => (r.leadSpend || 0) > 0 ? C.yellow : C.muted },
            { key: 'cpa', label: 'CPA', render: r => r.placed > 0 && r.leadSpend ? fmtDollar(r.leadSpend / r.placed) : '—' },
            { key: 'goalPremium', label: 'Premium vs Goal', render: r => <ProgressBar value={r.premium} goal={companyGoals.premiumTarget} /> },
          ]}
          rows={dailyRows}
        />
      </Section>
    </>
  );
}

function PublishersTab({ pnl, policies, goals, dateRange }) {
  const [drillPublisher, setDrillPublisher] = useState(null);
  const days = calcDaysBetween(dateRange.start, dateRange.end);
  const companyGoals = goals?.company || {};

  if (drillPublisher) {
    const pub = pnl.find(p => p.campaign === drillPublisher);
    if (!pub) { setDrillPublisher(null); return null; }
    const pubPolicies = policies.filter(p => p.leadSource === drillPublisher);
    const isPlaced = p => ['Advance Released', 'Active - In Force', 'Submitted - Pending'].includes(p.placed);

    // Agent breakdown
    const agentMap = {};
    pubPolicies.forEach(p => {
      if (!agentMap[p.agent]) agentMap[p.agent] = { agent: p.agent, apps: 0, placed: 0, premium: 0, commission: 0 };
      agentMap[p.agent].apps++;
      if (isPlaced(p)) { agentMap[p.agent].placed++; agentMap[p.agent].premium += p.premium; agentMap[p.agent].commission += p.commission; }
    });
    // Merge call data from agentBreakdown
    (pub.agentBreakdown || []).forEach(a => {
      if (!agentMap[a.agent]) agentMap[a.agent] = { agent: a.agent, apps: 0, placed: 0, premium: 0, commission: 0 };
      agentMap[a.agent].totalCalls = a.totalCalls;
      agentMap[a.agent].billableCalls = a.billableCalls;
      agentMap[a.agent].leadSpend = a.leadSpend;
    });
    const agentRows = Object.values(agentMap);

    // Carrier breakdown
    const carrierMap = {};
    pubPolicies.forEach(p => {
      if (!carrierMap[p.carrier]) carrierMap[p.carrier] = { carrier: p.carrier, apps: 0, placed: 0, premium: 0, commission: 0 };
      carrierMap[p.carrier].apps++;
      if (isPlaced(p)) { carrierMap[p.carrier].placed++; carrierMap[p.carrier].premium += p.premium; carrierMap[p.carrier].commission += p.commission; }
    });
    const carrierRows = Object.values(carrierMap);

    return (
      <>
        <Breadcrumb items={[
          { label: 'All Publishers', onClick: () => setDrillPublisher(null) },
          { label: drillPublisher },
        ]} />
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <KPICard label="Lead Spend" value={fmtDollar(pub.leadSpend)} subtitle={`${fmt(pub.billableCalls)} billable × ${fmtDollar(pub.pricePerCall)}`} />
          <KPICard label="Placed" value={pub.placedCount || 0} subtitle={`of ${pub.appCount || 0} apps`} />
          <KPICard label="CPA" value={fmtDollar(pub.cpa)} goal={companyGoals.cpa} lowerIsBetter />
          <KPICard label="Mo. Premium" value={fmtDollar(pub.totalPremium, 2)} />
          <KPICard label="Net Revenue" value={fmtDollar(pub.netRevenue)} />
        </div>

        <Section title="Agent Breakdown">
          <SortableTable defaultSort="premium" columns={[
            { key: 'agent', label: 'Agent', align: 'left', bold: true, mono: false },
            { key: 'apps', label: 'Apps' },
            { key: 'placed', label: 'Placed', color: r => r.placed > 0 ? C.green : C.muted },
            { key: 'premium', label: 'Premium', render: r => fmtDollar(r.premium, 2), color: () => C.green },
            { key: 'totalCalls', label: 'Calls', render: r => fmt(r.totalCalls || 0) },
            { key: 'billableCalls', label: 'Billable', render: r => fmt(r.billableCalls || 0) },
            { key: 'leadSpend', label: 'Spend', render: r => fmtDollar(r.leadSpend || 0), color: () => C.yellow },
            { key: 'cpa', label: 'CPA', render: r => r.placed > 0 && r.leadSpend ? fmtDollar(r.leadSpend / r.placed) : '—' },
          ]} rows={agentRows} />
        </Section>

        <Section title="Carrier Breakdown">
          <SortableTable defaultSort="premium" columns={[
            { key: 'carrier', label: 'Carrier', align: 'left', bold: true, mono: false },
            { key: 'apps', label: 'Apps' },
            { key: 'placed', label: 'Placed', color: r => r.placed > 0 ? C.green : C.muted },
            { key: 'premium', label: 'Premium', render: r => fmtDollar(r.premium, 2), color: () => C.green },
            { key: 'commission', label: 'Commission', render: r => fmtDollar(r.commission), color: () => C.accent },
            { key: 'placementRate', label: 'Place %', render: r => r.apps > 0 ? fmtPct(r.placed / r.apps * 100) : '—' },
          ]} rows={carrierRows} />
        </Section>
      </>
    );
  }

  return (
    <Section title="Publisher Performance" rightContent={<span style={{ fontSize: 10, color: C.muted }}>Click a row to drill down</span>}>
      <SortableTable
        defaultSort="totalPremium"
        onRowClick={r => setDrillPublisher(r.campaign)}
        columns={[
          { key: 'campaign', label: 'Publisher', align: 'left', bold: true, mono: false },
          { key: 'vendor', label: 'Vendor', align: 'left', mono: false, color: () => C.muted },
          { key: 'totalCalls', label: 'Calls' },
          { key: 'billableCalls', label: 'Billable' },
          { key: 'billableRate', label: 'Bill %', render: r => fmtPct(r.billableRate) },
          { key: 'pricePerCall', label: '$/Call', render: r => fmtDollar(r.pricePerCall) },
          { key: 'leadSpend', label: 'Lead Spend', render: r => fmtDollar(r.leadSpend), color: r => r.leadSpend > 0 ? C.yellow : C.muted },
          { key: 'placedCount', label: 'Sales', color: r => r.placedCount > 0 ? C.green : C.muted },
          { key: 'closeRate', label: 'Close %', render: r => fmtPct(r.closeRate) },
          { key: 'cpa', label: 'CPA', render: r => r.cpa > 0 ? fmtDollar(r.cpa) : '—', color: r => goalColor(r.cpa, companyGoals.cpa, true) },
          { key: 'totalPremium', label: 'Mo. Premium', render: r => fmtDollar(r.totalPremium, 2), color: r => r.totalPremium > 0 ? C.green : C.muted },
          { key: 'premiumToCost', label: 'Prem:Cost', render: r => r.premiumToCost > 0 ? r.premiumToCost.toFixed(2) + 'x' : '—' },
          { key: 'totalCommission', label: 'Commission', render: r => fmtDollar(r.totalCommission), color: () => C.accent },
          { key: 'netRevenue', label: 'Net Revenue', render: r => fmtDollar(r.netRevenue), color: r => r.netRevenue > 0 ? C.green : C.red, bold: true },
        ]}
        rows={pnl}
      />
    </Section>
  );
}

function AgentsTab({ policies, calls, goals, dateRange }) {
  const [drillAgent, setDrillAgent] = useState(null);
  const days = calcDaysBetween(dateRange.start, dateRange.end);
  const isPlaced = p => ['Advance Released', 'Active - In Force', 'Submitted - Pending'].includes(p.placed);
  const agentGoals = goals?.agent || {};

  // Build agent summary
  const agentMap = {};
  policies.forEach(p => {
    if (!agentMap[p.agent]) agentMap[p.agent] = { agent: p.agent, apps: 0, placed: 0, premium: 0, commission: 0, faceAmount: 0 };
    agentMap[p.agent].apps++;
    if (isPlaced(p)) { agentMap[p.agent].placed++; agentMap[p.agent].premium += p.premium; agentMap[p.agent].commission += p.commission; agentMap[p.agent].faceAmount += p.faceAmount; }
  });
  calls.forEach(c => {
    if (!c.rep) return;
    if (!agentMap[c.rep]) agentMap[c.rep] = { agent: c.rep, apps: 0, placed: 0, premium: 0, commission: 0, faceAmount: 0 };
    if (!agentMap[c.rep].totalCalls) agentMap[c.rep].totalCalls = 0;
    if (!agentMap[c.rep].billableCalls) agentMap[c.rep].billableCalls = 0;
    if (!agentMap[c.rep].leadSpend) agentMap[c.rep].leadSpend = 0;
    agentMap[c.rep].totalCalls++;
    if (c.isBillable) { agentMap[c.rep].billableCalls++; agentMap[c.rep].leadSpend += c.cost; }
  });
  const agentRows = Object.values(agentMap).sort((a, b) => b.premium - a.premium);

  function getAgentGoal(agentName, metric) {
    const override = agentGoals.overrides?.[agentName];
    if (override && override[metric] != null) return override[metric] * days;
    if (agentGoals.defaults?.[metric] != null) return agentGoals.defaults[metric] * days;
    return null;
  }

  if (drillAgent) {
    const agent = agentMap[drillAgent];
    if (!agent) { setDrillAgent(null); return null; }
    const agentPolicies = policies.filter(p => p.agent === drillAgent);

    // By carrier
    const carrierMap = {};
    agentPolicies.forEach(p => {
      if (!carrierMap[p.carrier]) carrierMap[p.carrier] = { carrier: p.carrier, apps: 0, placed: 0, premium: 0, commission: 0 };
      carrierMap[p.carrier].apps++;
      if (isPlaced(p)) { carrierMap[p.carrier].placed++; carrierMap[p.carrier].premium += p.premium; carrierMap[p.carrier].commission += p.commission; }
    });

    // By lead source
    const sourceMap = {};
    agentPolicies.forEach(p => {
      if (!sourceMap[p.leadSource]) sourceMap[p.leadSource] = { leadSource: p.leadSource, apps: 0, placed: 0, premium: 0 };
      sourceMap[p.leadSource].apps++;
      if (isPlaced(p)) { sourceMap[p.leadSource].placed++; sourceMap[p.leadSource].premium += p.premium; }
    });

    const premGoal = getAgentGoal(drillAgent, 'premiumTarget');
    const placedGoal = getAgentGoal(drillAgent, 'policiesPlaced');

    return (
      <>
        <Breadcrumb items={[
          { label: 'All Agents', onClick: () => setDrillAgent(null) },
          { label: drillAgent },
        ]} />
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <KPICard label="Apps" value={agent.apps} />
          <KPICard label="Placed" value={agent.placed} goal={placedGoal} subtitle={`${(agent.placed / days).toFixed(1)}/day`} />
          <KPICard label="Premium" value={fmtDollar(agent.premium, 2)} goal={premGoal} subtitle={`${fmtDollar(agent.premium / days, 2)}/day`} />
          <KPICard label="Commission" value={fmtDollar(agent.commission)} />
          <KPICard label="Placement %" value={fmtPct(agent.apps > 0 ? agent.placed / agent.apps * 100 : 0)} />
          <KPICard label="Avg Face" value={fmtDollar(agent.placed > 0 ? agent.faceAmount / agent.placed : 0)} />
        </div>

        <Section title="By Carrier">
          <SortableTable defaultSort="premium" columns={[
            { key: 'carrier', label: 'Carrier', align: 'left', bold: true, mono: false },
            { key: 'apps', label: 'Apps' },
            { key: 'placed', label: 'Placed', color: r => r.placed > 0 ? C.green : C.muted },
            { key: 'premium', label: 'Premium', render: r => fmtDollar(r.premium, 2), color: () => C.green },
            { key: 'commission', label: 'Commission', render: r => fmtDollar(r.commission), color: () => C.accent },
            { key: 'placementRate', label: 'Place %', render: r => r.apps > 0 ? fmtPct(r.placed / r.apps * 100) : '—' },
          ]} rows={Object.values(carrierMap)} />
        </Section>

        <Section title="By Lead Source">
          <SortableTable defaultSort="premium" columns={[
            { key: 'leadSource', label: 'Source', align: 'left', bold: true, mono: false },
            { key: 'apps', label: 'Apps' },
            { key: 'placed', label: 'Placed', color: r => r.placed > 0 ? C.green : C.muted },
            { key: 'premium', label: 'Premium', render: r => fmtDollar(r.premium, 2), color: () => C.green },
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
          ]} rows={agentPolicies} />
        </Section>
      </>
    );
  }

  return (
    <Section title="Agent Rankings" rightContent={<span style={{ fontSize: 10, color: C.muted }}>Click a row to drill down</span>}>
      <SortableTable
        defaultSort="premium"
        onRowClick={r => setDrillAgent(r.agent)}
        columns={[
          { key: 'rank', label: '#', render: (_, i) => { const idx = agentRows.indexOf(_); return idx + 1; }, sortable: false },
          { key: 'agent', label: 'Agent', align: 'left', bold: true, mono: false },
          { key: 'apps', label: 'Apps' },
          { key: 'placed', label: 'Placed', color: r => r.placed > 0 ? C.green : C.muted },
          { key: 'premium', label: 'Mo. Premium', render: r => fmtDollar(r.premium, 2), color: () => C.green, bold: true },
          { key: 'premiumGoal', label: 'Prem Goal', render: r => <ProgressBar value={r.premium} goal={getAgentGoal(r.agent, 'premiumTarget')} />, sortable: false },
          { key: 'commission', label: 'Commission', render: r => fmtDollar(r.commission), color: () => C.accent },
          { key: 'placementRate', label: 'Place %', render: r => r.apps > 0 ? fmtPct(r.placed / r.apps * 100) : '—' },
          { key: 'totalCalls', label: 'Calls', render: r => fmt(r.totalCalls || 0) },
          { key: 'avgPremium', label: 'Avg Prem', render: r => r.placed > 0 ? fmtDollar(r.premium / r.placed, 2) : '—' },
          { key: 'avgFace', label: 'Avg Face', render: r => r.placed > 0 ? fmtDollar(r.faceAmount / r.placed) : '—' },
        ]}
        rows={agentRows}
      />
    </Section>
  );
}

function CarriersTab({ policies, goals, dateRange }) {
  const [drillCarrier, setDrillCarrier] = useState(null);
  const days = calcDaysBetween(dateRange.start, dateRange.end);
  const isPlaced = p => ['Advance Released', 'Active - In Force', 'Submitted - Pending'].includes(p.placed);
  const carrierGoals = goals?.carrier || {};

  const carrierMap = {};
  policies.forEach(p => {
    if (!carrierMap[p.carrier]) carrierMap[p.carrier] = { carrier: p.carrier, apps: 0, placed: 0, premium: 0, commission: 0, faceAmount: 0, products: new Set(), states: new Set() };
    carrierMap[p.carrier].apps++;
    carrierMap[p.carrier].products.add(p.product);
    carrierMap[p.carrier].states.add(p.state);
    if (isPlaced(p)) { carrierMap[p.carrier].placed++; carrierMap[p.carrier].premium += p.premium; carrierMap[p.carrier].commission += p.commission; carrierMap[p.carrier].faceAmount += p.faceAmount; }
  });
  const carrierRows = Object.values(carrierMap).map(c => ({ ...c, productCount: c.products.size, stateCount: c.states.size })).sort((a, b) => b.premium - a.premium);

  function getCarrierGoal(name, metric) {
    const override = carrierGoals.overrides?.[name];
    if (override && override[metric] != null) return override[metric] * days;
    if (carrierGoals.defaults?.[metric] != null) return carrierGoals.defaults[metric] * days;
    return null;
  }

  if (drillCarrier) {
    const carrier = carrierMap[drillCarrier];
    if (!carrier) { setDrillCarrier(null); return null; }
    const carrierPolicies = policies.filter(p => p.carrier === drillCarrier);

    const agentMap = {};
    carrierPolicies.forEach(p => {
      if (!agentMap[p.agent]) agentMap[p.agent] = { agent: p.agent, apps: 0, placed: 0, premium: 0, commission: 0 };
      agentMap[p.agent].apps++;
      if (isPlaced(p)) { agentMap[p.agent].placed++; agentMap[p.agent].premium += p.premium; agentMap[p.agent].commission += p.commission; }
    });

    const productMap = {};
    carrierPolicies.forEach(p => {
      if (!productMap[p.product]) productMap[p.product] = { product: p.product, apps: 0, placed: 0, premium: 0 };
      productMap[p.product].apps++;
      if (isPlaced(p)) { productMap[p.product].placed++; productMap[p.product].premium += p.premium; }
    });

    return (
      <>
        <Breadcrumb items={[
          { label: 'All Carriers', onClick: () => setDrillCarrier(null) },
          { label: drillCarrier },
        ]} />
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <KPICard label="Apps" value={carrier.apps} />
          <KPICard label="Placed" value={carrier.placed} goal={getCarrierGoal(drillCarrier, 'policiesPlaced')} />
          <KPICard label="Premium" value={fmtDollar(carrier.premium, 2)} goal={getCarrierGoal(drillCarrier, 'premiumTarget')} />
          <KPICard label="Commission" value={fmtDollar(carrier.commission)} />
          <KPICard label="Place %" value={fmtPct(carrier.apps > 0 ? carrier.placed / carrier.apps * 100 : 0)} />
          <KPICard label="Avg Face" value={fmtDollar(carrier.placed > 0 ? carrier.faceAmount / carrier.placed : 0)} />
        </div>

        <Section title="By Agent">
          <SortableTable defaultSort="premium" columns={[
            { key: 'agent', label: 'Agent', align: 'left', bold: true, mono: false },
            { key: 'apps', label: 'Apps' },
            { key: 'placed', label: 'Placed', color: r => r.placed > 0 ? C.green : C.muted },
            { key: 'premium', label: 'Premium', render: r => fmtDollar(r.premium, 2), color: () => C.green },
            { key: 'commission', label: 'Commission', render: r => fmtDollar(r.commission), color: () => C.accent },
          ]} rows={Object.values(agentMap)} />
        </Section>

        <Section title="By Product">
          <SortableTable defaultSort="premium" columns={[
            { key: 'product', label: 'Product', align: 'left', bold: true, mono: false },
            { key: 'apps', label: 'Apps' },
            { key: 'placed', label: 'Placed', color: r => r.placed > 0 ? C.green : C.muted },
            { key: 'premium', label: 'Premium', render: r => fmtDollar(r.premium, 2), color: () => C.green },
          ]} rows={Object.values(productMap)} />
        </Section>
      </>
    );
  }

  return (
    <Section title="Carrier Overview" rightContent={<span style={{ fontSize: 10, color: C.muted }}>Click a row to drill down</span>}>
      <SortableTable
        defaultSort="premium"
        onRowClick={r => setDrillCarrier(r.carrier)}
        columns={[
          { key: 'carrier', label: 'Carrier', align: 'left', bold: true, mono: false },
          { key: 'apps', label: 'Apps' },
          { key: 'placed', label: 'Placed', color: r => r.placed > 0 ? C.green : C.muted },
          { key: 'premium', label: 'Mo. Premium', render: r => fmtDollar(r.premium, 2), color: () => C.green, bold: true },
          { key: 'premGoal', label: 'Prem Goal', render: r => <ProgressBar value={r.premium} goal={getCarrierGoal(r.carrier, 'premiumTarget')} />, sortable: false },
          { key: 'commission', label: 'Commission', render: r => fmtDollar(r.commission), color: () => C.accent },
          { key: 'placementRate', label: 'Place %', render: r => r.apps > 0 ? fmtPct(r.placed / r.apps * 100) : '—' },
          { key: 'avgPremium', label: 'Avg Premium', render: r => r.placed > 0 ? fmtDollar(r.premium / r.placed, 2) : '—' },
          { key: 'avgFace', label: 'Avg Face', render: r => r.placed > 0 ? fmtDollar(r.faceAmount / r.placed) : '—' },
          { key: 'productCount', label: 'Products' },
          { key: 'stateCount', label: 'States' },
        ]}
        rows={carrierRows}
      />
    </Section>
  );
}

function PnlTab({ pnl, policies, calls, goals, dateRange }) {
  const isPlaced = p => ['Advance Released', 'Active - In Force', 'Submitted - Pending'].includes(p.placed);
  const placed = policies.filter(isPlaced);
  const totalPremium = placed.reduce((s, p) => s + p.premium, 0);
  const totalCommission = placed.reduce((s, p) => s + p.commission, 0);
  const totalLeadSpend = pnl.reduce((s, p) => s + p.leadSpend, 0);
  const totalCalls = calls.length;
  const billableCalls = calls.filter(c => c.isBillable).length;
  const companyGoals = goals?.company || {};

  // Totals row
  const totals = {
    campaign: 'TOTAL', vendor: '', totalCalls, billableCalls,
    billableRate: totalCalls > 0 ? billableCalls / totalCalls * 100 : 0,
    pricePerCall: 0, leadSpend: totalLeadSpend,
    placedCount: placed.length, appCount: policies.length,
    closeRate: billableCalls > 0 ? placed.length / billableCalls * 100 : 0,
    cpa: placed.length > 0 ? totalLeadSpend / placed.length : 0,
    totalPremium, avgPremium: placed.length > 0 ? totalPremium / placed.length : 0,
    premiumToCost: totalLeadSpend > 0 ? totalPremium / totalLeadSpend : 0,
    totalCommission,
    grossRevenue: totalPremium * 12,
    netRevenue: (totalPremium * 12) - totalLeadSpend - totalCommission,
  };

  return (
    <>
      <Section title="P&L Summary">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 1, padding: 1, background: C.border }}>
          {[
            { label: 'Total Calls', value: fmt(totalCalls) },
            { label: 'Billable Calls', value: fmt(billableCalls) },
            { label: 'Lead Spend', value: fmtDollar(totalLeadSpend), color: C.yellow },
            { label: 'Applications', value: fmt(policies.length) },
            { label: 'Policies Placed', value: fmt(placed.length), color: C.green },
            { label: 'Close Rate', value: fmtPct(totals.closeRate) },
            { label: 'CPA', value: fmtDollar(totals.cpa), color: goalColor(totals.cpa, companyGoals.cpa, true) },
            { label: 'Monthly Premium', value: fmtDollar(totalPremium, 2), color: C.green },
            { label: 'Avg Premium', value: fmtDollar(totals.avgPremium, 2) },
            { label: 'Premium:Cost', value: totals.premiumToCost > 0 ? totals.premiumToCost.toFixed(2) + 'x' : '—' },
            { label: 'Gross Revenue (Annual)', value: fmtDollar(totals.grossRevenue) },
            { label: 'Agent Commission', value: fmtDollar(totalCommission), color: C.accent },
            { label: 'Net Revenue', value: fmtDollar(totals.netRevenue), color: totals.netRevenue > 0 ? C.green : C.red },
          ].map(item => (
            <div key={item.label} style={{ background: C.card, padding: '14px 18px' }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 6 }}>{item.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: item.color || C.text, fontFamily: C.mono }}>{item.value}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Publisher P&L Detail">
        <SortableTable
          defaultSort="netRevenue"
          columns={[
            { key: 'campaign', label: 'Publisher', align: 'left', bold: true, mono: false },
            { key: 'vendor', label: 'Vendor', align: 'left', mono: false, color: () => C.muted },
            { key: 'totalCalls', label: 'Calls' },
            { key: 'billableCalls', label: 'Billable' },
            { key: 'billableRate', label: 'Bill %', render: r => fmtPct(r.billableRate) },
            { key: 'pricePerCall', label: '$/Call', render: r => r.pricePerCall > 0 ? fmtDollar(r.pricePerCall) : '—' },
            { key: 'leadSpend', label: 'Spend', render: r => fmtDollar(r.leadSpend), color: r => r.leadSpend > 0 ? C.yellow : C.muted },
            { key: 'placedCount', label: 'Sales', color: r => (r.placedCount || 0) > 0 ? C.green : C.muted },
            { key: 'closeRate', label: 'Close %', render: r => fmtPct(r.closeRate) },
            { key: 'cpa', label: 'CPA', render: r => r.cpa > 0 ? fmtDollar(r.cpa) : '—', color: r => goalColor(r.cpa, companyGoals.cpa, true) },
            { key: 'totalPremium', label: 'Mo. Prem', render: r => fmtDollar(r.totalPremium, 2), color: r => (r.totalPremium || 0) > 0 ? C.green : C.muted },
            { key: 'premiumToCost', label: 'P:C', render: r => r.premiumToCost > 0 ? r.premiumToCost.toFixed(2) + 'x' : '—' },
            { key: 'totalCommission', label: 'Comm.', render: r => fmtDollar(r.totalCommission), color: () => C.accent },
            { key: 'netRevenue', label: 'Net Rev', render: r => fmtDollar(r.netRevenue), color: r => r.netRevenue > 0 ? C.green : C.red, bold: true },
          ]}
          rows={pnl}
        />
      </Section>

      {/* Goals comparison row */}
      {companyGoals.cpa && (
        <Section title="Goal Comparison">
          <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            {[
              { label: 'CPA', actual: totals.cpa, goal: companyGoals.cpa, lower: true, format: fmtDollar },
              { label: 'Close Rate', actual: totals.closeRate, goal: companyGoals.conversionRate, format: fmtPct },
              { label: 'Placement Rate', actual: policies.length > 0 ? placed.length / policies.length * 100 : 0, goal: companyGoals.placementRate, format: fmtPct },
              { label: 'Avg Premium', actual: totals.avgPremium, goal: 70, format: v => fmtDollar(v, 2) },
            ].map(g => (
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
      )}
    </>
  );
}

// ─── Main Dashboard ─────────────────────────────────────────

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
      {/* ─── Header ──────────────────────────────── */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: '12px 24px', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div>
              <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0, letterSpacing: -0.3 }}>True Choice Coverage</h1>
              <p style={{ fontSize: 10, color: C.muted, margin: '2px 0 0' }}>
                {policies.length} policies · {calls.length} calls · {pnl.length} publishers
              </p>
            </div>
          </div>

          {/* Date Range */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', gap: 1, background: C.card, borderRadius: 6, padding: 2, border: `1px solid ${C.border}` }}>
              {[
                { id: 'yesterday', label: 'Yest' },
                { id: 'today', label: 'Today' },
                { id: 'last7', label: '7D' },
                { id: 'last30', label: '30D' },
                { id: 'mtd', label: 'MTD' },
                { id: 'all', label: 'All' },
              ].map(p => (
                <button key={p.id} onClick={() => applyPreset(p.id)} style={{
                  padding: '5px 10px', borderRadius: 4, border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  background: dateRange.preset === p.id ? C.accent : 'transparent',
                  color: dateRange.preset === p.id ? '#fff' : C.muted,
                }}>{p.label}</button>
              ))}
            </div>
            <input type="date" value={dateRange.start} onChange={e => setCustomRange('start', e.target.value)}
              style={{ background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: '4px 6px', fontSize: 10, outline: 'none', width: 110 }} />
            <span style={{ color: C.muted, fontSize: 10 }}>–</span>
            <input type="date" value={dateRange.end} onChange={e => setCustomRange('end', e.target.value)}
              style={{ background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: '4px 6px', fontSize: 10, outline: 'none', width: 110 }} />
          </div>
        </div>
      </div>

      {/* ─── Tabs ────────────────────────────────── */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', gap: 0, padding: '0 24px' }}>
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              padding: '10px 20px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
              background: 'transparent', borderBottom: `2px solid ${activeTab === tab.id ? C.accent : 'transparent'}`,
              color: activeTab === tab.id ? C.text : C.muted,
              transition: 'all 0.15s ease',
            }}>{tab.label}</button>
          ))}
        </div>
      </div>

      {/* ─── Content ─────────────────────────────── */}
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '20px 24px' }}>
        {activeTab === 'daily' && <DailyActivityTab policies={policies} calls={calls} goals={goals} dateRange={dateRange} />}
        {activeTab === 'publishers' && <PublishersTab pnl={pnl} policies={policies} goals={goals} dateRange={dateRange} />}
        {activeTab === 'agents' && <AgentsTab policies={policies} calls={calls} goals={goals} dateRange={dateRange} />}
        {activeTab === 'carriers' && <CarriersTab policies={policies} goals={goals} dateRange={dateRange} />}
        {activeTab === 'pnl' && <PnlTab pnl={pnl} policies={policies} calls={calls} goals={goals} dateRange={dateRange} />}
      </div>
    </div>
  );
}
