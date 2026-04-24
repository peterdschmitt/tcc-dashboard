'use client';

import React, { useState, useEffect } from 'react';
import DeepDiveCard from './shared/DeepDiveCard';

const C = {
  bg: '#080b10', surface: '#0f1520', card: '#131b28', border: '#1a2538',
  text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff', green: '#4ade80',
  greenDim: '#0a2e1a', yellow: '#facc15', yellowDim: '#2e2a0a', red: '#f87171',
  redDim: '#2e0a0a', mono: "'SF Mono', 'Fira Code', monospace",
  sans: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
};

const fmt = (n, d = 0) => n != null && !isNaN(n) ? n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
const fmtD = (n, d = 0) => n != null && !isNaN(n) ? (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
const fmtP = n => n != null && !isNaN(n) ? n.toFixed(1) + '%' : '—';
const fmtTime = sec => {
  if (!sec) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

function DeltaChip({ baseline, lower = false }) {
  if (!baseline || baseline.deltaPct == null) return null;
  const pct = baseline.deltaPct * 100;
  const isGood = lower ? pct <= 0 : pct >= 0;
  const color = Math.abs(pct) < 5 ? C.muted : (isGood ? C.green : C.red);
  const arrow = pct >= 0 ? '↑' : '↓';
  return (
    <span style={{ color, fontSize: 10, marginLeft: 6, fontFamily: C.sans, fontWeight: 500 }}>
      {arrow}{Math.abs(pct).toFixed(0)}% vs 30d
    </span>
  );
}

function PendingDeepDiveCard({ name }) {
  return (
    <div style={{ background: C.bg, border: `1px dashed ${C.border}`, borderRadius: 6, marginBottom: 8, padding: '10px 14px', opacity: 0.6 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.muted }}>{name}</div>
      <div style={{ fontSize: 11, color: C.muted, fontStyle: 'italic', marginTop: 2 }}>
        No analysis run yet for this agent.
      </div>
    </div>
  );
}

function KPI({ label, value, color, chip }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 16px', flex: '1 1 140px', minWidth: 140 }}>
      <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || C.text, marginTop: 4, fontFamily: C.mono }}>{value}{chip}</div>
    </div>
  );
}

function Section({ title, children, color }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 16, overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}`, background: C.surface }}>
        <h3 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: color || C.accent, textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</h3>
      </div>
      <div style={{ padding: 16 }}>{children}</div>
    </div>
  );
}

function Table({ headers, rows }) {
  const thStyle = { padding: '6px 10px', color: C.muted, fontWeight: 600, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.8, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' };
  const tdStyle = (color) => ({ padding: '5px 10px', color: color || C.text, fontSize: 11, fontFamily: C.mono, borderBottom: `1px solid ${C.border}22`, whiteSpace: 'nowrap' });

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>{headers.map((h, i) => <th key={i} style={{ ...thStyle, textAlign: h.align || 'left' }}>{h.label}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => <td key={j} style={tdStyle(cell.color)} align={headers[j]?.align}>{cell.value}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function getWeekRange() {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const fmt = d => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  // Find the most recent completed Mon-Fri work week
  // If today is Sat(6) or Sun(0), show this past Mon-Fri
  // If today is Mon-Fri, show last week's Mon-Fri
  const lastFri = new Date(et);
  if (day === 6) {
    lastFri.setDate(et.getDate() - 1); // yesterday = Friday
  } else if (day === 0) {
    lastFri.setDate(et.getDate() - 2); // 2 days ago = Friday
  } else {
    // Mon-Fri: go back to last Friday
    lastFri.setDate(et.getDate() - day - 2);
  }
  const lastMon = new Date(lastFri);
  lastMon.setDate(lastFri.getDate() - 4); // Monday = Friday - 4

  return { start: fmt(lastMon), end: fmt(lastFri) };
}

export default function DailySummaryPage({ dateRange }) {
  const [briefView, setBriefView] = useState('daily'); // 'daily' | 'weekly'
  const [data, setData] = useState(null);
  const [weekData, setWeekData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [weekLoading, setWeekLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const date = dateRange?.end || dateRange?.start;
        const url = date ? `/api/daily-summary?date=${date}` : '/api/daily-summary';
        const res = await fetch(url);
        if (!res.ok) throw new Error(`API returned ${res.status}`);
        setData(await res.json());
      } catch (e) {
        setError(e.message);
      }
      setLoading(false);
    }
    load();
  }, [dateRange]);

  // Fetch week in review
  useEffect(() => {
    async function loadWeek() {
      setWeekLoading(true);
      try {
        const wr = getWeekRange();
        const res = await fetch(`/api/daily-summary?start=${wr.start}&end=${wr.end}&mode=weekly`);
        if (res.ok) setWeekData(await res.json());
      } catch (e) {
        console.warn('Week summary failed:', e);
      }
      setWeekLoading(false);
    }
    loadWeek();
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60, color: C.muted }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 32, height: 32, border: `3px solid ${C.border}`, borderTopColor: C.accent, borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
          <p style={{ fontSize: 12 }}>Generating daily summary...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  if (error) {
    return <div style={{ padding: 40, textAlign: 'center', color: C.red, fontSize: 13 }}>Error: {error}</div>;
  }

  if (!data) return null;

  const { sales, financials, calls, agentPerf, alerts, narrative, tableSummaries: ts } = data;

  const toggleBtnStyle = (active) => ({
    padding: '7px 20px',
    fontSize: 12,
    fontWeight: 600,
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    background: active ? C.accent : C.surface,
    color: active ? '#fff' : C.muted,
    transition: 'all 0.2s',
  });

  const aiInsightStyle = { margin: '0 0 12px', padding: '10px 14px', background: `${C.accent}0a`, border: `1px solid ${C.accent}22`, borderRadius: 6, fontSize: 12, color: C.text, lineHeight: 1.6, fontStyle: 'italic' };

  // Pick which dataset to render based on toggle
  const isWeekly = briefView === 'weekly';
  const viewData = isWeekly ? weekData : data;
  const viewSales = isWeekly ? (weekData?.sales || {}) : sales;
  const viewFinancials = isWeekly ? (weekData?.financials || {}) : financials;
  const viewCalls = isWeekly ? (weekData?.calls || {}) : calls;
  const viewAlerts = isWeekly ? (weekData?.alerts || []) : (alerts || []);
  const viewPerf = isWeekly ? (weekData?.agentPerf || []) : (agentPerf || []);
  const viewNarrative = isWeekly ? weekData?.narrative : narrative;
  const viewTS = isWeekly ? (weekData?.tableSummaries || {}) : (ts || {});
  // Filter out "Policies Placed" alerts — placed is irrelevant for daily/weekly reviews
  const filteredAlerts = viewAlerts.filter(a => a.metric !== 'Policies Placed' && a.metric !== 'Placement Rate');

  return (
    <div style={{ fontFamily: C.sans }}>
      {/* Toggle + Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.text }}>
            {isWeekly ? `Week in Review — ${weekData?.startDate || ''} to ${weekData?.endDate || ''}` : `Daily Summary — ${data.date}`}
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 11, color: C.muted }}>
            {isWeekly
              ? weekData ? `${viewSales.total || 0} apps · ${fmt(viewCalls.total)} calls · ${fmtD(viewFinancials.leadSpend)} spend` : 'Loading...'
              : `${sales.total} apps · ${fmt(calls.total)} calls · ${fmtD(financials.leadSpend)} spend · Generated ${new Date(data.generatedAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York' })}`
            }
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 4 }}>
          <button style={toggleBtnStyle(briefView === 'daily')} onClick={() => setBriefView('daily')}>Daily</button>
          <button style={toggleBtnStyle(briefView === 'weekly')} onClick={() => setBriefView('weekly')}>Week in Review</button>
        </div>
      </div>

      {/* Weekly loading state */}
      {isWeekly && weekLoading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60, color: C.muted }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 32, height: 32, border: `3px solid ${C.border}`, borderTopColor: C.accent, borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
            <p style={{ fontSize: 12 }}>Loading weekly summary...</p>
          </div>
        </div>
      )}

      {isWeekly && !weekLoading && !weekData && (
        <div style={{ padding: 40, textAlign: 'center', color: C.muted, fontSize: 13 }}>No weekly data available.</div>
      )}

      {/* ─── SHARED CONTENT (renders for both views) ─── */}
      {(!isWeekly || (isWeekly && weekData && !weekLoading)) && (
      <>
      {/* AI Executive Summary */}
      {viewNarrative && (
        <Section title={isWeekly ? "Weekly Executive Summary" : "Executive Summary"}>
          <p style={{ margin: 0, fontSize: 13, color: C.text, lineHeight: 1.7 }}>{viewNarrative}</p>
        </Section>
      )}

      {/* KPI Row — NO "Placed" (irrelevant for daily/weekly performance reviews) */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <KPI label="Apps Submitted" value={fmt(viewSales.total)}
             chip={<DeltaChip baseline={data.baselines?.company?.apps} />} />
        <KPI label="Total Calls" value={fmt(viewCalls.total)}
             chip={<DeltaChip baseline={data.baselines?.company?.calls} />} />
        <KPI label="Billable Calls" value={fmt(viewCalls.billable)}
             chip={<DeltaChip baseline={data.baselines?.company?.billable} />} />
        <KPI label="Billable Rate" value={fmtP(viewFinancials.billableRate)}
             chip={<DeltaChip baseline={data.baselines?.company?.billableRate} />} />
        <KPI label="CPA" value={fmtD(viewFinancials.cpa)}
             chip={<DeltaChip baseline={data.baselines?.company?.cpa} lower />} />
        <KPI label="Gross Revenue" value={fmtD(viewFinancials.gar)} color={C.green}
             chip={<DeltaChip baseline={data.baselines?.company?.gar} />} />
        <KPI label="Net Revenue" value={fmtD(viewFinancials.netRevenue)} color={viewFinancials.netRevenue >= 0 ? C.green : C.red}
             chip={<DeltaChip baseline={data.baselines?.company?.netRevenue} />} />
        <KPI label="Lead Spend" value={fmtD(viewFinancials.leadSpend)} color={C.yellow}
             chip={<DeltaChip baseline={data.baselines?.company?.leadSpend} lower />} />
        <KPI label="Close Rate" value={fmtP(viewFinancials.closeRate)}
             chip={<DeltaChip baseline={data.baselines?.company?.closeRate} />} />
        <KPI label="Avg Premium" value={fmtD(viewFinancials.avgPremium)}
             chip={<DeltaChip baseline={data.baselines?.company?.avgPremium} />} />
        <KPI label="Prem:Cost" value={viewFinancials.premCost > 0 ? viewFinancials.premCost.toFixed(2) + 'x' : '—'}
             chip={<DeltaChip baseline={data.baselines?.company?.premCost} />} />
        <KPI label="RPC" value={fmtD(viewFinancials.rpc, 2)}
             chip={<DeltaChip baseline={data.baselines?.company?.rpc} lower />} />
      </div>

      {/* Per-Agent NAR + Activity (after KPI tiles, before Agent Availability) */}
      {(() => {
        const rows = (viewData?.agentNarBreakdown || data.agentNarBreakdown || []);
        if (!rows.length) return null;
        const fmtNarHr = v => v != null && !isNaN(v) ? (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : '—';
        return (
          <Section title={isWeekly ? "Weekly Per-Agent NAR + Activity" : "Per-Agent NAR + Activity"}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ padding: '6px 10px', color: C.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.8, textAlign: 'left', borderBottom: `1px solid ${C.border}` }}>Agent</th>
                  <th style={{ padding: '6px 10px', color: C.accent, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.8, textAlign: 'right', borderBottom: `1px solid ${C.border}`, fontWeight: 700 }}>NAR</th>
                  <th style={{ padding: '6px 10px', color: C.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.8, textAlign: 'right', borderBottom: `1px solid ${C.border}` }}>NAR / Talk Hr</th>
                  <th style={{ padding: '6px 10px', color: C.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.8, textAlign: 'right', borderBottom: `1px solid ${C.border}` }}>Apps</th>
                  <th style={{ padding: '6px 10px', color: C.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.8, textAlign: 'right', borderBottom: `1px solid ${C.border}` }}>Premium</th>
                  <th style={{ padding: '6px 10px', color: C.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.8, textAlign: 'right', borderBottom: `1px solid ${C.border}` }}>GAR</th>
                  <th style={{ padding: '6px 10px', color: C.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.8, textAlign: 'right', borderBottom: `1px solid ${C.border}` }}>Commission</th>
                  <th style={{ padding: '6px 10px', color: C.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.8, textAlign: 'right', borderBottom: `1px solid ${C.border}` }}>Lead Spend</th>
                  <th style={{ padding: '6px 10px', color: C.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.8, textAlign: 'right', borderBottom: `1px solid ${C.border}` }}>Talk Time</th>
                  <th style={{ padding: '6px 10px', color: C.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.8, textAlign: 'right', borderBottom: `1px solid ${C.border}` }}>Pause %</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const narColor = r.nar > 0 ? C.green : r.nar < 0 ? C.red : C.text;
                  const tdMono = (color = C.text, weight = 400) => ({ padding: '6px 10px', color, fontSize: 11, fontFamily: C.mono, textAlign: 'right', borderBottom: `1px solid ${C.border}22`, fontWeight: weight });
                  return (
                    <tr key={r.agent}>
                      <td style={{ padding: '6px 10px', color: C.text, fontSize: 11, fontWeight: 600, borderBottom: `1px solid ${C.border}22` }}>{r.agent}</td>
                      <td style={tdMono(narColor, 800)}>{fmtD(r.nar)}</td>
                      <td style={tdMono(C.text)}>{fmtNarHr(r.narPerTalkHour)}</td>
                      <td style={tdMono(C.text)}>{fmt(r.apps)}</td>
                      <td style={tdMono(C.text)}>{fmtD(r.premium)}</td>
                      <td style={tdMono(C.text)}>{fmtD(r.gar)}</td>
                      <td style={tdMono(C.text)}>{fmtD(r.commission)}</td>
                      <td style={tdMono(C.text)}>{fmtD(r.leadSpend)}</td>
                      <td style={tdMono(C.text)}>{fmtTime(r.talkTimeSec)}</td>
                      <td style={tdMono(r.pausePct > 50 ? C.red : r.pausePct > 30 ? C.yellow : C.text)}>{fmtP(r.pausePct)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Section>
        );
      })()}

      {/* ─── SIX STANDALONE SECTIONS (Availability, Sales, Calls, Revenue, Cost, VA) ─── */}
      {(viewData?.dailyOverview || data.dailyOverview) && Object.keys(viewData?.dailyOverview || data.dailyOverview || {}).length > 0 && (() => {
        const ov = viewData?.dailyOverview || data.dailyOverview;
        const dates = Object.keys(ov).sort();
        const numDays = dates.length || 1;
        const dayNames = dates.map(d => {
          const dt = new Date(d + 'T12:00:00');
          return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        });

        const thresholdColor = (val, goal, lower) => {
          if (!goal || val == null) return C.text;
          const ratio = lower ? (val === 0 ? 2 : goal / val) : val / goal;
          if (ratio >= 1) return C.green;
          if (ratio >= 0.8) return C.yellow;
          return C.red;
        };

        const metrics = [
          // ─ AGENT AVAILABILITY ─
          { key: 'agentCount', label: 'Agents Logged In', format: fmt, section: 'availability' },
          { key: 'availPct', label: 'Avg Availability', format: fmtP, goal: 70, isAvg: true, section: 'availability' },
          { key: 'talkTimeSec', label: 'Total Talk Time', format: fmtTime, section: 'availability' },
          { key: 'loggedInSec', label: 'Total Logged In', format: fmtTime, section: 'availability' },
          { key: 'pausedSec', label: 'Total Pause Time', format: fmtTime, section: 'availability' },
          { key: 'pausePct', label: 'Pause %', format: fmtP, goal: 30, lower: true, isAvg: true, section: 'availability' },
          // ─ SALES & CONVERSION ─
          { key: 'salesPerAgent', label: 'Sales per Agent', format: v => v != null ? v.toFixed(1) : '—', goal: 2.5, isAvg: true, section: 'sales' },
          { key: 'sales', label: 'Sales (Apps)', format: fmt, goal: 5, section: 'sales' },
          { key: 'appsPerTalkHour', label: 'Apps / Talk-Hr', format: v => v != null ? v.toFixed(2) : '—', goal: 1.0, isAvg: true, section: 'sales' },
          { key: 'billables', label: 'Billable Calls', format: fmt, goal: 35, section: 'sales' },
          { key: 'closeRate', label: 'Conversion Rate', format: fmtP, goal: 22.5, isAvg: true, section: 'sales' },
          // ─ CALLS ─
          { key: 'calls', label: 'Total Calls', format: fmt, goal: 50, section: 'calls' },
          { key: 'billableRate', label: 'Billable Rate', format: fmtP, goal: 65, isAvg: true, section: 'calls' },
          // ─ REVENUE ─
          { key: 'premium', label: 'Premium', format: v => fmtD(v), goal: 500, section: 'revenue' },
          { key: 'gar', label: 'Gross Adv Revenue', format: v => fmtD(v), goal: 4000, section: 'revenue' },
          { key: 'commission', label: 'Commission', format: v => fmtD(v), goal: 1200, section: 'revenue' },
          { key: 'nar', label: 'Net Revenue', format: v => fmtD(v), goal: 2000, section: 'revenue' },
          // ─ COST EFFICIENCY (lower is better) ─
          { key: 'spend', label: 'Lead Spend', format: v => fmtD(v), goal: 1500, lower: true, section: 'cost' },
          { key: 'cpa', label: 'CPA', format: v => fmtD(v), goal: 200, lower: true, isAvg: true, section: 'cost' },
          { key: 'rpc', label: 'RPC', format: v => fmtD(v, 2), goal: 35, lower: true, isAvg: true, section: 'cost' },
          { key: 'avgPremium', label: 'Avg Premium', format: v => fmtD(v), goal: 70, isAvg: true, section: 'cost' },
          // ─ VIRTUAL AGENT ─
          { key: 'vaCalls', label: 'VA Calls', format: fmt, goal: 100, section: 'va' },
          { key: 'vaTransfers', label: 'VA Transfers', format: fmt, section: 'va' },
          { key: 'vaTransferRate', label: 'VA Transfer Rate', format: fmtP, goal: 30, isAvg: true, section: 'va' },
        ];

        const sectionDefs = [
          { key: 'availability', title: isWeekly ? 'Weekly Agent Availability' : 'Agent Availability' },
          { key: 'sales',        title: isWeekly ? 'Weekly Sales & Conversion' : 'Sales & Conversion' },
          { key: 'calls',        title: isWeekly ? 'Weekly Call Volume' : 'Call Volume' },
          { key: 'revenue',      title: isWeekly ? 'Weekly Revenue' : 'Revenue' },
          { key: 'cost',         title: isWeekly ? 'Weekly Cost Efficiency' : 'Cost Efficiency' },
          { key: 'va',           title: isWeekly ? 'Weekly Virtual Agent' : 'Virtual Agent' },
        ];

        const dailyOverviewSummaries = viewTS?.dailyOverview;
        const legacyString = typeof dailyOverviewSummaries === 'string' ? dailyOverviewSummaries : null;

        const renderSectionTable = (sectionKey) => {
          const rows = metrics.filter(m => m.section === sectionKey);
          return (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ padding: '6px 10px', color: C.muted, fontSize: 9, textTransform: 'uppercase', textAlign: 'left', borderBottom: `1px solid ${C.border}` }}>Metric</th>
                    {dayNames.map((d, i) => (
                      <th key={i} style={{ padding: '6px 10px', color: C.accent, fontSize: 9, textTransform: 'uppercase', textAlign: 'center', borderBottom: `1px solid ${C.border}` }}>{d}</th>
                    ))}
                    <th style={{ padding: '6px 10px', color: C.text, fontSize: 9, textTransform: 'uppercase', textAlign: 'center', borderBottom: `1px solid ${C.border}`, fontWeight: 700 }}>{dates.length > 1 ? 'Total/Avg' : 'Total'}</th>
                    <th style={{ padding: '6px 10px', color: C.muted, fontSize: 9, textTransform: 'uppercase', textAlign: 'center', borderBottom: `1px solid ${C.border}` }}>Goal</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(m => {
                    const vals = dates.map(d => ov[d]?.[m.key] || 0);
                    const total = vals.reduce((s, v) => s + v, 0);
                    const summary = m.isAvg ? total / numDays : total;
                    const goalCompare = m.isAvg ? m.goal : (m.goal ? m.goal * numDays : null);

                    return (
                      <tr key={m.key}>
                        <td style={{ padding: '5px 10px', color: C.text, fontSize: 11, fontWeight: 600, borderBottom: `1px solid ${C.border}22` }}>
                          {m.label}
                          {m.lower && <span style={{ fontSize: 8, color: C.muted, marginLeft: 4 }}>↓</span>}
                        </td>
                        {vals.map((v, i) => (
                          <td key={i} style={{
                            padding: '5px 10px',
                            color: m.goal ? thresholdColor(v, m.goal, m.lower) : C.text,
                            fontSize: 11, fontFamily: C.mono, textAlign: 'center',
                            borderBottom: `1px solid ${C.border}22`,
                          }}>
                            {m.format(v)}
                          </td>
                        ))}
                        <td style={{
                          padding: '5px 10px',
                          color: goalCompare ? thresholdColor(summary, goalCompare, m.lower) : C.accent,
                          fontSize: 11, fontFamily: C.mono, textAlign: 'center', fontWeight: 700,
                          borderBottom: `1px solid ${C.border}22`,
                        }}>
                          {m.format(summary)}
                        </td>
                        <td style={{ padding: '5px 10px', color: C.muted, fontSize: 10, fontFamily: C.mono, textAlign: 'center', borderBottom: `1px solid ${C.border}22` }}>
                          {m.goal ? (m.key === 'closeRate' || m.key === 'billableRate' || m.key === 'vaTransferRate' ? m.goal + '%' : m.key === 'avgPremium' || m.key === 'cpa' || m.key === 'rpc' || m.key === 'spend' || m.key === 'premium' || m.key === 'gar' || m.key === 'commission' || m.key === 'nar' ? '$' + m.goal.toLocaleString() : m.goal) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        };

        return (
          <>
            {legacyString && (
              <Section title={isWeekly ? 'Weekly Daily Overview' : 'Daily Overview'}>
                <p style={aiInsightStyle}>{legacyString}</p>
              </Section>
            )}
            {sectionDefs.map(s => {
              const narrative = dailyOverviewSummaries && typeof dailyOverviewSummaries === 'object'
                ? dailyOverviewSummaries[s.key]
                : null;
              return (
                <Section key={s.key} title={s.title}>
                  {narrative && <p style={aiInsightStyle}>{narrative}</p>}
                  {renderSectionTable(s.key)}
                </Section>
              );
            })}
          </>
        );
      })()}

      {/* ─── TABLE 2: PUBLISHER PERFORMANCE ─── */}
      <Section title={isWeekly ? "Weekly Publisher Performance" : "Publisher Performance"}>
        {viewTS.publishers && <p style={aiInsightStyle}>{viewTS.publishers}</p>}
        <Table
          headers={[
            { label: 'Campaign' }, { label: 'Vendor' }, { label: 'Calls', align: 'center' },
            { label: 'Billable', align: 'center' }, { label: 'Bill %', align: 'center' },
            { label: 'Sales', align: 'center' }, { label: 'Close %', align: 'center' },
            { label: 'Spend', align: 'right' }, { label: 'CPA', align: 'right' },
            { label: 'RPC', align: 'right' }, { label: 'Premium', align: 'right' },
            { label: 'GAR', align: 'right' }, { label: 'Net Rev', align: 'right' },
          ]}
          rows={Object.entries(viewSales.byCampaign || {}).sort((a, b) => b[1].calls - a[1].calls).map(([name, c]) => [
            { value: name },
            { value: c.vendor || '—', color: C.muted },
            { value: fmt(c.calls) },
            { value: fmt(c.billable), color: c.billable > 0 ? C.green : C.muted },
            { value: fmtP(c.billableRate), color: c.billableRate > 15 ? C.green : C.red },
            { value: fmt(c.sales || 0) },
            { value: fmtP(c.closeRate || 0) },
            { value: fmtD(c.spend), color: C.yellow },
            { value: fmtD(c.cpa || 0) },
            { value: fmtD(c.rpc, 2) },
            { value: fmtD(c.premium || 0), color: C.green },
            { value: fmtD(c.gar || 0), color: C.accent },
            { value: fmtD(c.netRevenue || 0), color: (c.netRevenue || 0) >= 0 ? C.green : C.red },
          ])}
        />
      </Section>

      {/* ─── TABLE 3: CARRIER BREAKDOWN ─── */}
      {(viewData?.byCarrier || data.byCarrier) && (viewData?.byCarrier || data.byCarrier).length > 0 && (
        <Section title={isWeekly ? "Weekly Carrier Breakdown" : "Carrier Breakdown"}>
          {viewTS.carriers && <p style={aiInsightStyle}>{viewTS.carriers}</p>}
          <Table
            headers={[
              { label: 'Carrier' }, { label: 'Sales', align: 'center' },
              { label: 'Premium', align: 'right' }, { label: 'Commission', align: 'right' },
              { label: 'GAR', align: 'right' }, { label: 'CPA', align: 'right' },
              { label: 'RPC', align: 'right' }, { label: 'Conv %', align: 'center' },
              { label: 'Prem:Cost', align: 'center' },
            ]}
            rows={(viewData?.byCarrier || data.byCarrier).map(c => [
              { value: c.carrier },
              { value: fmt(c.sales) },
              { value: fmtD(c.premium), color: C.green },
              { value: fmtD(c.commission || 0) },
              { value: fmtD(c.gar), color: C.accent },
              { value: fmtD(c.cpa) },
              { value: fmtD(c.rpc, 2) },
              { value: fmtP(c.conversionRate) },
              { value: c.premCost > 0 ? c.premCost.toFixed(2) + 'x' : '—' },
            ])}
          />
        </Section>
      )}

      {/* ─── TABLE 4: AGENT ACTIVITY ─── */}
      {(() => {
        // Merge agent sales data with dialer data
        const agentActivity = Object.entries(viewSales.byAgent || {}).map(([name, a]) => {
          const dialer = viewPerf.find(d => d.rep === name || name.includes(d.rep?.split(' ')[0] || '___'));
          return {
            name, sales: a.apps,
            premium: a.premium || 0, gar: a.gar || 0, commission: a.commission || 0,
            calls: dialer?.dialed || 0, connects: dialer?.connects || 0,
            availPct: dialer?.availPct, loggedIn: dialer?.loggedInStr || '—',
            talkTime: dialer?.talkTimeStr || '—',
            pauseTime: dialer?.pausedStr || dialer?.pauseTimeStr || '—',
            pausePct: dialer?.pausePct,
          };
        });
        return agentActivity.length > 0 ? (
          <Section title={isWeekly ? "Weekly Agent Activity" : "Agent Activity"}>
            {viewTS.agents && <p style={aiInsightStyle}>{viewTS.agents}</p>}
            <Table
              headers={[
                { label: 'Agent' }, { label: 'Apps', align: 'center' },
                { label: 'Premium', align: 'right' }, { label: 'GAR', align: 'right' },
                { label: 'Dials', align: 'center' }, { label: 'Connects', align: 'center' },
                { label: 'Avail %', align: 'center' }, { label: 'Logged In', align: 'center' },
                { label: 'Talk Time', align: 'center' }, { label: 'Pause Time', align: 'center' },
                { label: 'Pause %', align: 'center' },
              ]}
              rows={agentActivity.map(a => [
                { value: a.name },
                { value: fmt(a.sales) },
                { value: fmtD(a.premium), color: C.green },
                { value: fmtD(a.gar), color: C.accent },
                { value: fmt(a.calls) },
                { value: fmt(a.connects) },
                { value: a.availPct != null ? fmtP(a.availPct) : '—', color: a.availPct != null ? ((a.availPct) >= 70 ? C.green : C.red) : C.muted },
                { value: a.loggedIn },
                { value: a.talkTime },
                { value: a.pauseTime },
                { value: a.pausePct != null ? fmtP(a.pausePct) : '—', color: a.pausePct != null ? ((a.pausePct) <= 30 ? C.green : C.red) : C.muted },
              ])}
            />
          </Section>
        ) : null;
      })()}

      {/* ─── AGENT DEEP DIVE (Conversely agent 41) ─── */}
      <AgentDeepDiveSection
        embedded={viewData?.agentDeepDive || data.agentDeepDive}
        todaysAgents={Object.keys(viewSales.byAgent || {})}
        isWeekly={isWeekly}
      />

      {/* ─── TABLE 5: POLICY STATUS PIPELINE ─── */}
      {(viewData?.statusPipeline || data.statusPipeline) && (viewData?.statusPipeline || data.statusPipeline).statuses?.length > 0 && (
        <Section title="Policy Status Pipeline">
          {viewTS.pipeline && <p style={aiInsightStyle}>{viewTS.pipeline}</p>}
          {(() => {
            const { byDate, statuses } = viewData?.statusPipeline || data.statusPipeline;
            const dates = Object.keys(byDate || {}).sort();
            return (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '6px 10px', color: C.muted, fontSize: 9, textTransform: 'uppercase', textAlign: 'left', borderBottom: `1px solid ${C.border}` }}>Date</th>
                      {statuses.map(s => (
                        <th key={s} colSpan={2} style={{ padding: '6px 8px', color: C.accent, fontSize: 8, textTransform: 'uppercase', textAlign: 'center', borderBottom: `1px solid ${C.border}`, borderLeft: `1px solid ${C.border}33` }}>
                          {s.length > 20 ? s.substring(0, 18) + '..' : s}
                        </th>
                      ))}
                    </tr>
                    <tr>
                      <th style={{ padding: '3px 10px', borderBottom: `1px solid ${C.border}` }}></th>
                      {statuses.map(s => (
                        <React.Fragment key={s + '-sub'}>
                          <th style={{ padding: '3px 6px', color: C.muted, fontSize: 8, textAlign: 'center', borderBottom: `1px solid ${C.border}`, borderLeft: `1px solid ${C.border}33` }}>Count</th>
                          <th style={{ padding: '3px 6px', color: C.muted, fontSize: 8, textAlign: 'center', borderBottom: `1px solid ${C.border}` }}>$</th>
                        </React.Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dates.map(d => {
                      const dayName = new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                      return (
                        <tr key={d}>
                          <td style={{ padding: '5px 10px', color: C.text, fontSize: 11, fontWeight: 600, borderBottom: `1px solid ${C.border}22` }}>{dayName}</td>
                          {statuses.map(s => {
                            const cell = byDate[d]?.[s] || { count: 0, amount: 0 };
                            return (
                              <React.Fragment key={s}>
                                <td style={{ padding: '5px 6px', color: cell.count > 0 ? C.text : C.muted, fontSize: 10, fontFamily: C.mono, textAlign: 'center', borderBottom: `1px solid ${C.border}22`, borderLeft: `1px solid ${C.border}33` }}>{cell.count || '—'}</td>
                                <td style={{ padding: '5px 6px', color: cell.amount > 0 ? C.green : C.muted, fontSize: 10, fontFamily: C.mono, textAlign: 'center', borderBottom: `1px solid ${C.border}22` }}>{cell.amount > 0 ? fmtD(cell.amount) : '—'}</td>
                              </React.Fragment>
                            );
                          })}
                        </tr>
                      );
                    })}
                    {/* Totals row */}
                    <tr>
                      <td style={{ padding: '5px 10px', color: C.accent, fontSize: 11, fontWeight: 700, borderTop: `1px solid ${C.border}` }}>TOTAL</td>
                      {statuses.map(s => {
                        const total = dates.reduce((acc, d) => {
                          const cell = byDate[d]?.[s] || { count: 0, amount: 0 };
                          return { count: acc.count + cell.count, amount: acc.amount + cell.amount };
                        }, { count: 0, amount: 0 });
                        return (
                          <React.Fragment key={s + '-total'}>
                            <td style={{ padding: '5px 6px', color: C.accent, fontSize: 10, fontFamily: C.mono, textAlign: 'center', fontWeight: 700, borderTop: `1px solid ${C.border}`, borderLeft: `1px solid ${C.border}33` }}>{total.count}</td>
                            <td style={{ padding: '5px 6px', color: C.green, fontSize: 10, fontFamily: C.mono, textAlign: 'center', fontWeight: 700, borderTop: `1px solid ${C.border}` }}>{total.amount > 0 ? fmtD(total.amount) : '—'}</td>
                          </React.Fragment>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            );
          })()}
        </Section>
      )}

      {/* ─── ALERTS (bottom) ─── */}
      {filteredAlerts.length > 0 && (
        <Section title={`${isWeekly ? 'Weekly ' : ''}Alerts (${filteredAlerts.length})`} color={C.red}>
          <Table
            headers={[
              { label: 'Status' }, { label: 'Metric' }, { label: 'Agent' },
              { label: 'Actual', align: 'center' }, { label: 'Goal', align: 'center' },
            ]}
            rows={filteredAlerts.map(a => [
              { value: a.status === 'red' ? '🔴 RED' : '🟡 YELLOW', color: a.status === 'red' ? C.red : C.yellow },
              { value: a.metric },
              { value: a.agent || '—', color: C.muted },
              { value: typeof a.actual === 'number' ? a.actual.toFixed(1) : a.actual, color: a.status === 'red' ? C.red : C.yellow },
              { value: a.goal, color: C.muted },
            ])}
          />
        </Section>
      )}

      </>
      )}
    </div>
  );
}

function AgentDeepDiveSection({ embedded, todaysAgents = [], isWeekly = false }) {
  const [bundle, setBundle] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/agent-deep-dive')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d) setBundle(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const entities = bundle?.entities?.length ? bundle.entities : (embedded?.entities || []);
  const universe = bundle?.universe || [];
  const pending = bundle?.pending || universe.filter(n => !entities.some(e => e.name === n));
  const runDate = bundle?.runDate || embedded?.runDate;

  if (!entities.length && !pending.length) return null;

  const todaysSet = new Set(todaysAgents);
  const orderedEntities = [...entities].sort((a, b) => {
    const aIn = todaysSet.has(a.name) ? 0 : 1;
    const bIn = todaysSet.has(b.name) ? 0 : 1;
    if (aIn !== bIn) return aIn - bIn;
    return (a.name || '').localeCompare(b.name || '');
  });
  const orderedPending = [...pending].sort((a, b) => (a || '').localeCompare(b || ''));

  return (
    <Section title={isWeekly ? 'Weekly Agent Deep Dive' : 'Agent Deep Dive'}>
      <p style={{ margin: '0 0 12px', fontSize: 11, color: C.muted, fontStyle: 'italic' }}>
        Per-agent qualitative analysis from Conversely (run {runDate || '—'}).
        {' '}
        {entities.length} of {entities.length + pending.length} agents analyzed. Click to expand.
      </p>
      {orderedEntities.map((e, i) => (
        <DeepDiveCard key={e.name || `a-${i}`} entity={e} defaultOpen={false} />
      ))}
      {orderedPending.map((name, i) => (
        <PendingDeepDiveCard key={`p-${name || i}`} name={name} />
      ))}
    </Section>
  );
}
