'use client';

import React, { useState, useEffect } from 'react';

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

function KPI({ label, value, color }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 16px', flex: '1 1 140px', minWidth: 140 }}>
      <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || C.text, marginTop: 4, fontFamily: C.mono }}>{value}</div>
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

  const { sales, financials, calls, agentPerf, alerts, narrative } = data;

  return (
    <div style={{ fontFamily: C.sans }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.text }}>Daily Summary — {data.date}</h2>
        <p style={{ margin: '4px 0 0', fontSize: 11, color: C.muted }}>
          {sales.total} apps · {fmt(calls.total)} calls · {fmtD(financials.leadSpend)} spend · Generated {new Date(data.generatedAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York' })}
        </p>
      </div>

      {/* AI Narrative */}
      {narrative && (
        <Section title="Executive Summary">
          <p style={{ margin: 0, fontSize: 13, color: C.text, lineHeight: 1.7 }}>{narrative}</p>
        </Section>
      )}

      {/* KPI Row */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <KPI label="Apps" value={fmt(sales.total)} />
        <KPI label="Placed" value={fmt(sales.placed)} color={sales.placed > 0 ? C.green : C.red} />
        <KPI label="CPA" value={fmtD(financials.cpa)} />
        <KPI label="Gross Revenue" value={fmtD(financials.gar)} color={C.green} />
        <KPI label="Net Revenue" value={fmtD(financials.netRevenue)} color={financials.netRevenue >= 0 ? C.green : C.red} />
        <KPI label="Lead Spend" value={fmtD(financials.leadSpend)} color={C.yellow} />
        <KPI label="Close Rate" value={fmtP(financials.closeRate)} />
        <KPI label="Billable Rate" value={fmtP(financials.billableRate)} />
      </div>

      {/* Alerts */}
      {alerts && alerts.length > 0 && (
        <Section title={`Alerts (${alerts.length})`} color={C.red}>
          <Table
            headers={[
              { label: 'Status' }, { label: 'Metric' }, { label: 'Agent' },
              { label: 'Actual', align: 'center' }, { label: 'Goal', align: 'center' },
            ]}
            rows={alerts.map(a => [
              { value: a.status === 'red' ? '🔴 RED' : '🟡 YELLOW', color: a.status === 'red' ? C.red : C.yellow },
              { value: a.metric },
              { value: a.agent || '—', color: C.muted },
              { value: typeof a.actual === 'number' ? a.actual.toFixed(1) : a.actual, color: a.status === 'red' ? C.red : C.yellow },
              { value: a.goal, color: C.muted },
            ])}
          />
        </Section>
      )}

      {/* Sales by Agent */}
      <Section title="Sales by Agent">
        <Table
          headers={[
            { label: 'Agent' }, { label: 'Apps', align: 'center' }, { label: 'Placed', align: 'center' },
            { label: 'Premium', align: 'right' }, { label: 'GAR', align: 'right' },
          ]}
          rows={Object.entries(sales.byAgent || {}).map(([name, a]) => [
            { value: name },
            { value: fmt(a.apps) },
            { value: fmt(a.placed), color: a.placed > 0 ? C.green : C.muted },
            { value: fmtD(a.premium), color: C.green },
            { value: fmtD(a.gar), color: C.accent },
          ])}
        />
      </Section>

      {/* Calls by Campaign */}
      <Section title="Calls by Campaign">
        <Table
          headers={[
            { label: 'Campaign' }, { label: 'Vendor' }, { label: 'Calls', align: 'center' },
            { label: 'Billable', align: 'center' }, { label: 'Bill %', align: 'center' },
            { label: 'Spend', align: 'right' }, { label: 'RPC', align: 'right' },
          ]}
          rows={Object.entries(sales.byCampaign || {}).sort((a, b) => b[1].calls - a[1].calls).map(([name, c]) => [
            { value: name },
            { value: c.vendor || '—', color: C.muted },
            { value: fmt(c.calls) },
            { value: fmt(c.billable), color: c.billable > 0 ? C.green : C.muted },
            { value: fmtP(c.billableRate), color: c.billableRate > 15 ? C.green : C.red },
            { value: fmtD(c.spend), color: C.yellow },
            { value: fmtD(c.rpc, 2) },
          ])}
        />
      </Section>

      {/* Agent Dialer Performance */}
      {agentPerf && agentPerf.length > 0 && (
        <Section title="Agent Dialer Performance">
          <Table
            headers={[
              { label: 'Agent' }, { label: 'Avail %', align: 'center' }, { label: 'Pause %', align: 'center' },
              { label: 'Logged In', align: 'center' }, { label: 'Talk Time', align: 'center' },
              { label: 'Dials', align: 'center' }, { label: 'Connects', align: 'center' },
            ]}
            rows={agentPerf.map(a => [
              { value: a.rep },
              { value: fmtP(a.availPct), color: (a.availPct || 0) >= 70 ? C.green : C.red },
              { value: fmtP(a.pausePct), color: (a.pausePct || 0) <= 30 ? C.green : C.red },
              { value: a.loggedInStr || '—' },
              { value: a.talkTimeStr || '—' },
              { value: fmt(a.dialed) },
              { value: fmt(a.connects) },
            ])}
          />
        </Section>
      )}

      {/* ─── TABLE 1: DAILY OVERVIEW ─── */}
      {data.dailyOverview && Object.keys(data.dailyOverview).length > 0 && (
        <Section title="Daily Overview">
          {(() => {
            const dates = Object.keys(data.dailyOverview).sort();
            const dayNames = dates.map(d => {
              const dt = new Date(d + 'T12:00:00');
              return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            });
            const metrics = [
              { key: 'calls', label: 'Calls', format: fmt },
              { key: 'sales', label: 'Sales', format: fmt },
              { key: 'billables', label: 'Billables', format: fmt },
              { key: 'gar', label: 'GAR', format: v => fmtD(v) },
              { key: 'nar', label: 'NAR', format: v => fmtD(v), color: v => v >= 0 ? C.green : C.red },
              { key: 'cpa', label: 'CPA', format: v => fmtD(v) },
              { key: 'rpc', label: 'RPC', format: v => fmtD(v, 2) },
              { key: 'vaTransfers', label: 'VA Transfers', format: fmt },
              { key: 'vaSales', label: 'VA Sales', format: fmt },
            ];
            return (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '6px 10px', color: C.muted, fontSize: 9, textTransform: 'uppercase', textAlign: 'left', borderBottom: `1px solid ${C.border}` }}>Metric</th>
                      {dayNames.map((d, i) => (
                        <th key={i} style={{ padding: '6px 10px', color: C.accent, fontSize: 9, textTransform: 'uppercase', textAlign: 'center', borderBottom: `1px solid ${C.border}` }}>{d}</th>
                      ))}
                      <th style={{ padding: '6px 10px', color: C.text, fontSize: 9, textTransform: 'uppercase', textAlign: 'center', borderBottom: `1px solid ${C.border}`, fontWeight: 700 }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.map(m => {
                      const vals = dates.map(d => data.dailyOverview[d]?.[m.key] || 0);
                      const total = vals.reduce((s, v) => s + v, 0);
                      const avg = m.key === 'cpa' || m.key === 'rpc' ? total / (dates.length || 1) : total;
                      return (
                        <tr key={m.key}>
                          <td style={{ padding: '5px 10px', color: C.text, fontSize: 11, fontWeight: 600, borderBottom: `1px solid ${C.border}22` }}>{m.label}</td>
                          {vals.map((v, i) => (
                            <td key={i} style={{ padding: '5px 10px', color: m.color ? m.color(v) : C.text, fontSize: 11, fontFamily: C.mono, textAlign: 'center', borderBottom: `1px solid ${C.border}22` }}>
                              {m.format(v)}
                            </td>
                          ))}
                          <td style={{ padding: '5px 10px', color: C.accent, fontSize: 11, fontFamily: C.mono, textAlign: 'center', fontWeight: 700, borderBottom: `1px solid ${C.border}22` }}>
                            {m.key === 'cpa' || m.key === 'rpc' ? m.format(avg) : m.format(total)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </Section>
      )}

      {/* ─── TABLE 2: PUBLISHER PERFORMANCE (already exists as Calls by Campaign above) ─── */}

      {/* ─── TABLE 3: CARRIER BREAKDOWN ─── */}
      {data.byCarrier && data.byCarrier.length > 0 && (
        <Section title="Carrier Breakdown">
          <Table
            headers={[
              { label: 'Carrier' }, { label: 'Sales', align: 'center' },
              { label: 'CPA', align: 'right' }, { label: 'RPC', align: 'right' },
              { label: 'Conv %', align: 'center' }, { label: 'Prem:Cost', align: 'center' },
              { label: 'GAR', align: 'right' },
            ]}
            rows={data.byCarrier.map(c => [
              { value: c.carrier },
              { value: fmt(c.sales) },
              { value: fmtD(c.cpa) },
              { value: fmtD(c.rpc, 2) },
              { value: fmtP(c.conversionRate) },
              { value: c.premCost > 0 ? c.premCost.toFixed(2) + 'x' : '—' },
              { value: fmtD(c.gar), color: C.green },
            ])}
          />
        </Section>
      )}

      {/* ─── TABLE 4: AGENT ACTIVITY (enhanced version of existing dialer table) ─── */}
      {(() => {
        // Merge agent sales data with dialer data
        const agentActivity = Object.entries(sales.byAgent || {}).map(([name, a]) => {
          const dialer = (agentPerf || []).find(d => d.rep === name || name.includes(d.rep?.split(' ')[0] || '___'));
          return {
            name, sales: a.apps, placed: a.placed,
            calls: dialer?.dialed || 0,
            talkTime: dialer?.talkTimeStr || '—',
            pauseTime: dialer?.pausedStr || dialer?.pauseTimeStr || '—',
            pausePct: dialer?.pausePct,
          };
        });
        return agentActivity.length > 0 ? (
          <Section title="Agent Activity">
            <Table
              headers={[
                { label: 'Agent' }, { label: 'Sales', align: 'center' },
                { label: 'Calls', align: 'center' }, { label: 'Talk Time', align: 'center' },
                { label: 'Pause Time', align: 'center' }, { label: 'Pause %', align: 'center' },
              ]}
              rows={agentActivity.map(a => [
                { value: a.name },
                { value: fmt(a.sales) },
                { value: fmt(a.calls) },
                { value: a.talkTime },
                { value: a.pauseTime },
                { value: a.pausePct != null ? fmtP(a.pausePct) : '—', color: a.pausePct != null ? ((a.pausePct) <= 30 ? C.green : C.red) : C.muted },
              ])}
            />
          </Section>
        ) : null;
      })()}

      {/* ─── TABLE 5: POLICY STATUS PIPELINE ─── */}
      {data.statusPipeline && data.statusPipeline.statuses?.length > 0 && (
        <Section title="Policy Status Pipeline">
          {(() => {
            const { byDate, statuses } = data.statusPipeline;
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

      {/* ─── WEEK IN REVIEW ─── */}
      <div style={{ marginTop: 32, borderTop: `2px solid ${C.accent}`, paddingTop: 24 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700, color: C.accent }}>Week in Review</h2>
        {weekLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '20px 0', color: C.muted }}>
            <div style={{ width: 16, height: 16, border: `2px solid ${C.border}`, borderTopColor: C.accent, borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 12 }}>Loading weekly summary...</span>
          </div>
        )}
        {weekData && !weekLoading && (() => {
          const ws = weekData.sales || {};
          const wf = weekData.financials || {};
          const wc = weekData.calls || {};
          const wa = weekData.alerts || [];
          const wPerf = weekData.agentPerf || [];
          return (
            <>
              <p style={{ margin: '0 0 16px', fontSize: 11, color: C.muted }}>
                {weekData.startDate} to {weekData.endDate} &middot; {ws.total} apps &middot; {fmt(wc.total)} calls &middot; {fmtD(wf.leadSpend)} spend
              </p>

              {weekData.narrative && (
                <Section title="Weekly Executive Summary">
                  <p style={{ margin: 0, fontSize: 13, color: C.text, lineHeight: 1.7 }}>{weekData.narrative}</p>
                </Section>
              )}

              {/* Weekly KPIs */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                <KPI label="Apps" value={fmt(ws.total)} />
                <KPI label="Placed" value={fmt(ws.placed)} color={ws.placed > 0 ? C.green : C.red} />
                <KPI label="CPA" value={fmtD(wf.cpa)} />
                <KPI label="Gross Revenue" value={fmtD(wf.gar)} color={C.green} />
                <KPI label="Net Revenue" value={fmtD(wf.netRevenue)} color={wf.netRevenue >= 0 ? C.green : C.red} />
                <KPI label="Lead Spend" value={fmtD(wf.leadSpend)} color={C.yellow} />
                <KPI label="Close Rate" value={fmtP(wf.closeRate)} />
                <KPI label="Avg Premium" value={fmtD(wf.avgPremium)} />
              </div>

              {/* Weekly Alerts */}
              {wa.length > 0 && (
                <Section title={`Weekly Alerts (${wa.length})`} color={C.red}>
                  <Table
                    headers={[{ label: 'Status' }, { label: 'Metric' }, { label: 'Agent' }, { label: 'Actual', align: 'center' }, { label: 'Goal', align: 'center' }]}
                    rows={wa.map(a => [
                      { value: a.status === 'red' ? '🔴 RED' : '🟡 YELLOW', color: a.status === 'red' ? C.red : C.yellow },
                      { value: a.metric },
                      { value: a.agent || '—', color: C.muted },
                      { value: typeof a.actual === 'number' ? a.actual.toFixed(1) : a.actual, color: a.status === 'red' ? C.red : C.yellow },
                      { value: a.goal, color: C.muted },
                    ])}
                  />
                </Section>
              )}

              {/* Weekly Sales by Agent */}
              <Section title="Weekly Sales by Agent">
                <Table
                  headers={[{ label: 'Agent' }, { label: 'Apps', align: 'center' }, { label: 'Placed', align: 'center' }, { label: 'Premium', align: 'right' }, { label: 'GAR', align: 'right' }]}
                  rows={Object.entries(ws.byAgent || {}).map(([name, a]) => [
                    { value: name },
                    { value: fmt(a.apps) },
                    { value: fmt(a.placed), color: a.placed > 0 ? C.green : C.muted },
                    { value: fmtD(a.premium), color: C.green },
                    { value: fmtD(a.gar), color: C.accent },
                  ])}
                />
              </Section>

              {/* Weekly Calls by Campaign */}
              <Section title="Weekly Calls by Campaign">
                <Table
                  headers={[{ label: 'Campaign' }, { label: 'Vendor' }, { label: 'Calls', align: 'center' }, { label: 'Billable', align: 'center' }, { label: 'Bill %', align: 'center' }, { label: 'Spend', align: 'right' }, { label: 'RPC', align: 'right' }]}
                  rows={Object.entries(ws.byCampaign || {}).sort((a, b) => b[1].calls - a[1].calls).map(([name, c]) => [
                    { value: name },
                    { value: c.vendor || '—', color: C.muted },
                    { value: fmt(c.calls) },
                    { value: fmt(c.billable), color: c.billable > 0 ? C.green : C.muted },
                    { value: fmtP(c.billableRate), color: c.billableRate > 15 ? C.green : C.red },
                    { value: fmtD(c.spend), color: C.yellow },
                    { value: fmtD(c.rpc, 2) },
                  ])}
                />
              </Section>

              {/* Weekly Agent Dialer */}
              {wPerf.length > 0 && (
                <Section title="Weekly Agent Dialer">
                  <Table
                    headers={[{ label: 'Agent' }, { label: 'Avail %', align: 'center' }, { label: 'Pause %', align: 'center' }, { label: 'Logged In', align: 'center' }, { label: 'Dials', align: 'center' }, { label: 'Connects', align: 'center' }]}
                    rows={wPerf.map(a => [
                      { value: a.rep },
                      { value: fmtP(a.availPct), color: (a.availPct || 0) >= 70 ? C.green : C.red },
                      { value: fmtP(a.pausePct), color: (a.pausePct || 0) <= 30 ? C.green : C.red },
                      { value: a.loggedInStr || '—' },
                      { value: fmt(a.dialed) },
                      { value: fmt(a.connects) },
                    ])}
                  />
                </Section>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}
