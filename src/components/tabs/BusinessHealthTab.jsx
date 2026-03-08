'use client';
import { useState, useEffect, useMemo } from 'react';
import { C, fmt, fmtDollar, fmtPct, goalColor, goalBg } from '../shared/theme';

function GoalTile({ label, value, goal, lowerIsBetter, progressBar }) {
  const color = goal ? goalColor(parseFloat(value) || 0, goal, lowerIsBetter) : C.accent;
  const bg = goal ? goalBg(parseFloat(value) || 0, goal, lowerIsBetter) : 'transparent';
  const pct = goal ? (lowerIsBetter ? (goal / (parseFloat(value) || 1)) : (parseFloat(value) || 0) / goal) * 100 : 0;

  return (
    <div style={{
      background: bg || C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px',
      minWidth: 100, flex: '0 1 auto',
    }}>
      <div style={{ fontSize: 8, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4, lineHeight: 1.2 }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 800, color, fontFamily: C.mono, lineHeight: 1, textShadow: `0 0 10px ${color}40`, marginBottom: 4 }}>
        {value}
      </div>
      {goal && (
        <div style={{ fontSize: 9, color: '#b0c4de', fontFamily: C.mono, lineHeight: 1 }}>
          Goal: {goal}
        </div>
      )}
      {progressBar && (
        <div style={{ marginTop: 6, height: 4, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: color, borderRadius: 2 }} />
        </div>
      )}
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
  const toggleSort = col => { if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortCol(col); setSortDir('desc'); } };
  return (
    <div style={{ overflowX: 'auto', marginTop: 12 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          {columns.map(col => (
            <th key={col.key} onClick={() => col.sortable !== false && toggleSort(col.key)} style={{
              padding: '8px 10px', textAlign: col.align || 'right', fontSize: 9, fontWeight: 700, color: C.muted,
              textTransform: 'uppercase', letterSpacing: 0.8, borderBottom: `1px solid ${C.border}`, background: C.surface,
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
                  padding: '8px 10px', textAlign: col.align || 'right', fontSize: 11,
                  color: col.color ? col.color(row[col.key], row) : C.text, fontFamily: col.mono ? C.mono : 'inherit',
                  borderBottom: `1px solid ${C.border}`,
                }}>
                  {col.render ? col.render(row[col.key], row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginTop: 20, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );
}

export default function BusinessHealthTab({ dateRange }) {
  const [healthData, setHealthData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [drillCarrier, setDrillCarrier] = useState(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/crm/metrics/business-health?start=${dateRange.start}&end=${dateRange.end}`)
      .then(r => r.json())
      .then(d => {
        setHealthData(d);
        setError(null);
      })
      .catch(err => {
        setError(err.message);
        setHealthData(null);
      })
      .finally(() => setLoading(false));
  }, [dateRange]);

  if (loading) return <div style={{ color: C.muted, textAlign: 'center', padding: 40 }}>Loading health metrics...</div>;
  if (error) return <div style={{ color: C.red, textAlign: 'center', padding: 40 }}>Error: {error}</div>;
  if (!healthData) return <div style={{ color: C.muted, textAlign: 'center', padding: 40 }}>No data available</div>;

  // Map API response to UI fields
  const c = healthData.current || {};
  const byCarrier = healthData.byCarrier || [];
  const byAgent = healthData.byAgent || [];
  const lapseReasonBreakdown = healthData.lapseReasons || [];
  const timeSeries = healthData.timeSeries || [];

  const totalActiveMembers = c.activeMembers || 0;
  const totalPremiumInForce = c.totalActivePremium || 0;
  const atRiskMembers = c.atRiskMembers || 0;
  const lapsedThisMonth = c.lapsedThisPeriod || 0;
  const winBackSuccesses = c.winBackSuccesses || 0;
  const winBackAttempts = c.winBackAttempts || 0;
  const monthlyLapseRate = c.lapseRate || 0;
  const winBackRate = winBackAttempts > 0 ? (winBackSuccesses / winBackAttempts * 100) : 0;
  const persistencyRate = 0; // Requires persistency data
  const avgPolicyLifespan = 0; // Requires time series data
  const revenueAtRisk = c.revenueAtRisk || 0;
  const outreachDueToday = 0; // TODO: compute from tasks

  // Derived highlights
  const topDefectingCarrier = byCarrier.length > 0
    ? byCarrier.reduce((a, b) => (b.lapsed > a.lapsed ? b : a), byCarrier[0]).carrier
    : '—';
  const topLapseReason = lapseReasonBreakdown.length > 0
    ? lapseReasonBreakdown.reduce((a, b) => (b.count > a.count ? b : a), lapseReasonBreakdown[0]).reason
    : '—';
  const agentsWithLapses = byAgent.filter(a => (a.active + a.lapsed) > 0);
  const highestLapseAgent = agentsWithLapses.length > 0
    ? agentsWithLapses.reduce((a, b) => {
        const aRate = a.lapsed / (a.active + a.lapsed);
        const bRate = b.lapsed / (b.active + b.lapsed);
        return bRate > aRate ? b : a;
      }, agentsWithLapses[0])
    : null;
  const bestRetentionAgent = agentsWithLapses.length > 0
    ? agentsWithLapses.reduce((a, b) => {
        const aRate = a.active / (a.active + a.lapsed);
        const bRate = b.active / (b.active + b.lapsed);
        return bRate > aRate ? b : a;
      }, agentsWithLapses[0])
    : null;
  const highestLapseAgentName = highestLapseAgent ? highestLapseAgent.agent : '—';
  const highestLapseRate = highestLapseAgent ? (highestLapseAgent.lapsed / (highestLapseAgent.active + highestLapseAgent.lapsed) * 100) : 0;
  const bestRetentionAgentName = bestRetentionAgent ? bestRetentionAgent.agent : '—';
  const bestRetentionRate = bestRetentionAgent ? (bestRetentionAgent.active / (bestRetentionAgent.active + bestRetentionAgent.lapsed) * 100) : 0;
  const carriers = byCarrier.map(c => {
    const total = c.active + c.lapsed + c.atRisk;
    return {
      carrier: c.carrier,
      activeMembers: c.active,
      lapsedMembers: c.lapsed,
      lapseRate: total > 0 ? (c.lapsed / total * 100) : 0,
      premiumInForce: c.premium,
      revenueAtRisk: c.atRisk * (c.premium / (c.active || 1)),
      persistencyRate: total > 0 ? (c.active / total * 100) : 0,
    };
  });

  return (
    <div>
      {/* Section 1: KPI Tiles */}
      <Section title="Member Base & Premium">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <GoalTile label="Total Active Members" value={fmt(totalActiveMembers)} goal="" />
          <GoalTile label="Premium in Force ($)" value={fmtDollar(totalPremiumInForce)} goal="" />
          <GoalTile label="At-Risk Members" value={fmt(atRiskMembers)} goal="" />
          <GoalTile label="Lapsed This Month" value={fmt(lapsedThisMonth)} goal="" />
          <GoalTile label="Win-Back Successes" value={fmt(winBackSuccesses)} goal="" />
        </div>
      </Section>

      <Section title="Retention Rates & Metrics">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <GoalTile label="Monthly Lapse Rate %" value={fmtPct(monthlyLapseRate)} lowerIsBetter goal="2%" progressBar />
          <GoalTile label="Win-Back Rate %" value={fmtPct(winBackRate)} goal="25%" progressBar />
          <GoalTile label="13-Month Persistency %" value={fmtPct(persistencyRate)} goal="85%" progressBar />
          <GoalTile label="Avg Policy Lifespan (mo)" value={fmt(avgPolicyLifespan)} goal="36" />
          <GoalTile label="Revenue at Risk ($)" value={fmtDollar(revenueAtRisk)} goal="" />
        </div>
      </Section>

      <Section title="Performance Highlights">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <GoalTile label="Top Defecting Carrier" value={topDefectingCarrier} goal="" />
          <GoalTile label="Top Lapse Reason" value={topLapseReason} goal="" />
          <GoalTile label="Highest Lapse Agent" value={`${highestLapseAgentName} (${fmtPct(highestLapseRate)})`} goal="" />
          <GoalTile label="Best Retention Agent" value={`${bestRetentionAgentName} (${fmtPct(bestRetentionRate)})`} goal="" />
          <GoalTile label="Outreach Due Today" value={fmt(outreachDueToday)} goal="" />
        </div>
      </Section>

      {/* Section 2: Lapse Reason Breakdown */}
      <Section title="Lapse Reason Breakdown">
        {lapseReasonBreakdown && lapseReasonBreakdown.length > 0 ? (
          <div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {lapseReasonBreakdown.map((reason, i) => {
                const total = lapseReasonBreakdown.reduce((sum, r) => sum + (r.count || 0), 0);
                const pct = total > 0 ? ((reason.count || 0) / total) * 100 : 0;
                const reasonColors = {
                  'Non-Payment': C.red, 'Customer Cancelled': C.yellow, 'NSF': '#fb923c',
                  'Not-Taken': C.muted, 'Replaced': C.purple, 'Deceased': C.muted,
                  'Moved': C.accent, 'Other': C.muted,
                };
                const color = reasonColors[reason.reason] || C.accent;

                return (
                  <div key={i} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: C.text, fontWeight: 500 }}>{reason.reason}</span>
                      <span style={{ fontSize: 10, color: C.muted, fontFamily: C.mono }}>
                        {fmt(reason.count)} ({fmtPct(pct)})
                      </span>
                    </div>
                    <div style={{ height: 8, background: C.border, borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div style={{ color: C.muted, padding: 12, textAlign: 'center' }}>No lapse reason data</div>
        )}
      </Section>

      {/* Section 3: Trend Indicators */}
      <Section title="Month-over-Month Trends">
        {timeSeries && timeSeries.length >= 2 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { label: 'Active Members', key: 'activeMembers', format: fmt, icon: 'M' },
              { label: 'Lapse Rate', key: 'lapseRate', format: fmtPct, icon: '%', lowerIsBetter: true },
              { label: 'Revenue at Risk', key: 'revenueAtRisk', format: fmtDollar, icon: '$' },
              { label: 'Win-Back Rate', key: 'winBackRate', format: fmtPct, icon: '%' },
            ].map(metric => {
              const prev = timeSeries[timeSeries.length - 2]?.[metric.key] || 0;
              const curr = timeSeries[timeSeries.length - 1]?.[metric.key] || 0;
              const change = curr - prev;
              const changePct = prev !== 0 ? ((change / prev) * 100).toFixed(1) : 0;
              const isPositive = metric.lowerIsBetter ? change < 0 : change >= 0;
              const arrow = isPositive ? '↓' : '↑';
              const arrowColor = isPositive ? C.green : C.red;

              return (
                <div key={metric.key} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: 8, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4,
                }}>
                  <span style={{ fontSize: 11, color: C.text, fontWeight: 500 }}>{metric.label}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 12, fontFamily: C.mono, color: C.text, fontWeight: 600 }}>
                      {metric.format(prev)} → {metric.format(curr)}
                    </span>
                    <span style={{ fontSize: 11, fontFamily: C.mono, color: arrowColor, fontWeight: 700 }}>
                      {arrow} {Math.abs(changePct)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ color: C.muted, padding: 12, textAlign: 'center' }}>Insufficient data for trend analysis</div>
        )}
      </Section>

      {/* Section 4: By Carrier Comparison */}
      <Section title="Carrier Performance Comparison">
        {carriers && carriers.length > 0 ? (
          <SortableTable
            columns={[
              { key: 'carrier', label: 'Carrier', align: 'left', sortable: true },
              { key: 'activeMembers', label: 'Active Members', align: 'right', render: fmt, mono: true },
              { key: 'lapsedMembers', label: 'Lapsed', align: 'right', render: fmt, mono: true, color: (val) => val > 10 ? C.red : C.text },
              { key: 'lapseRate', label: 'Lapse Rate %', align: 'right', render: fmtPct, mono: true, color: (val) => {
                if (val < 2) return C.green;
                if (val < 5) return C.yellow;
                return C.red;
              }},
              { key: 'premiumInForce', label: 'Premium in Force', align: 'right', render: fmtDollar, mono: true },
              { key: 'revenueAtRisk', label: 'Revenue at Risk', align: 'right', render: fmtDollar, mono: true },
              { key: 'persistencyRate', label: 'Persistency %', align: 'right', render: fmtPct, mono: true, color: (val) => {
                if (val >= 80) return C.green;
                if (val >= 60) return C.yellow;
                return C.red;
              }},
            ]}
            rows={carriers}
            defaultSort="revenueAtRisk"
            onRowClick={(row) => setDrillCarrier(row.carrier)}
          />
        ) : (
          <div style={{ color: C.muted, padding: 12, textAlign: 'center' }}>No carrier data available</div>
        )}
      </Section>

      {drillCarrier && (
        <div style={{ marginTop: 20, padding: 16, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.accent }}>
              Drill-down: {drillCarrier}
            </div>
            <button
              onClick={() => setDrillCarrier(null)}
              style={{
                background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer',
                fontSize: 18, padding: 4, lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
          <div style={{ color: C.muted, fontSize: 11, padding: 12, textAlign: 'center' }}>
            Detailed carrier view coming soon (products, agents, trends)
          </div>
        </div>
      )}
    </div>
  );
}
