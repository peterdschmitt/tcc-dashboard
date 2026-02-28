'use client';
import { useState, useEffect, useMemo } from 'react';
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

const C = {
  bg: '#080b10', surface: '#0f1520', card: '#131b28', border: '#1a2538',
  text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff', accentDim: '#1e3a5f',
  green: '#22c55e', yellow: '#eab308', red: '#ef4444', purple: '#a855f7',
  cyan: '#06b6d4', orange: '#f97316', pink: '#ec4899',
  mono: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
  sans: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
};

const COLORS = [C.accent, C.green, C.yellow, C.red, C.purple, C.cyan, C.orange, C.pink, '#818cf8', '#fb923c'];

function fmtD(n, d=0) { if (n==null||isNaN(n)) return '—'; return (n<0?'-$':'$')+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}); }
function fmtP(n) { if (n==null||isNaN(n)) return '—'; return n.toFixed(1)+'%'; }
function fmt(n) { if (n==null||isNaN(n)) return '—'; return n.toLocaleString('en-US'); }

const isPlaced = p => ['Advance Released','Active - In Force','Submitted - Pending'].includes(p.placed);

const CustomTooltip = ({ active, payload, label, formatter }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: '10px 14px', boxShadow: '0 8px 24px rgba(0,0,0,0.4)', maxWidth: 300 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.text, marginBottom: 6, fontFamily: C.mono }}>{label}</div>
      {payload.filter(p => p.value != null).map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: C.muted }}>{p.name}:</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: p.color, fontFamily: C.mono }}>{formatter ? formatter(p.value, p.name) : p.value}</span>
        </div>
      ))}
    </div>
  );
};

function ChartCard({ title, subtitle, children, height = 300 }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.border}` }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: C.text, margin: 0 }}>{title}</h3>
        {subtitle && <p style={{ fontSize: 10, color: C.muted, margin: '2px 0 0' }}>{subtitle}</p>}
      </div>
      <div style={{ padding: '12px 8px 8px', height }}>{children}</div>
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 18px', flex: '1 1 0', minWidth: 130 }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || C.text, fontFamily: C.mono, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function MultiSelect({ options, selected, onChange, label }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
      <span style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginRight: 4 }}>{label}:</span>
      {options.map((opt, i) => {
        const active = selected.includes(opt);
        const color = active ? COLORS[selected.indexOf(opt) % COLORS.length] : C.muted;
        return (
          <button key={opt} onClick={() => {
            if (active) onChange(selected.filter(s => s !== opt));
            else if (selected.length < 5) onChange([...selected, opt]);
          }} style={{
            padding: '3px 10px', borderRadius: 12, border: `1px solid ${active ? color : C.border}`,
            background: active ? color + '22' : 'transparent', color: active ? color : C.muted,
            fontSize: 11, fontWeight: 600, cursor: 'pointer',
          }}>{opt}</button>
        );
      })}
    </div>
  );
}

function getPresetRange(id) {
  const today = new Date(); const yyyy = d => d.toISOString().slice(0, 10);
  const d = new Date(today);
  switch (id) {
    case 'last7': d.setDate(d.getDate() - 6); return { start: yyyy(d), end: yyyy(today), preset: id };
    case 'last30': d.setDate(d.getDate() - 29); return { start: yyyy(d), end: yyyy(today), preset: id };
    case 'mtd': return { start: yyyy(new Date(today.getFullYear(), today.getMonth(), 1)), end: yyyy(today), preset: id };
    case 'all': default: return { start: '2020-01-01', end: '2030-12-31', preset: 'all' };
  }
}

export default function TrendsPage() {
  const [data, setData] = useState(null);
  const [goals, setGoals] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('daily');
  const [compareMode, setCompareMode] = useState('campaign');
  const [selectedItems, setSelectedItems] = useState([]);
  const [dateRange, setDateRange] = useState(getPresetRange('all'));

  const applyPreset = id => setDateRange(getPresetRange(id));
  const setCustomRange = (field, val) => setDateRange(prev => ({ ...prev, [field]: val, preset: null }));

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [d, g] = await Promise.all([
        fetch(`/api/dashboard?start=${dateRange.start}&end=${dateRange.end}`).then(r => r.json()),
        fetch('/api/goals').then(r => r.json()),
      ]);
      setData(d); setGoals(g); setLoading(false);
    }
    load();
  }, [dateRange.start, dateRange.end]);

  // Reset selections when switching compare mode
  useEffect(() => { setSelectedItems([]); }, [compareMode]);

  // ─── Available items for comparison ─────────────
  const campaignOptions = useMemo(() => {
    if (!data) return [];
    return [...new Set([...data.pnl.filter(p => p.totalCalls > 0 || p.placedCount > 0).map(p => p.campaign), ...data.policies.map(p => p.leadSource)])].filter(Boolean).sort();
  }, [data]);

  const agentOptions = useMemo(() => {
    if (!data) return [];
    return [...new Set([...data.policies.map(p => p.agent), ...data.calls.map(c => c.rep).filter(Boolean)])].sort();
  }, [data]);

  // ─── Daily trend data (overall) ─────────────────
  const dailyData = useMemo(() => {
    if (!data) return [];
    const byDay = {};
    data.policies.forEach(p => {
      if (!byDay[p.submitDate]) byDay[p.submitDate] = { date: p.submitDate, apps: 0, placed: 0, premium: 0, commission: 0, gar: 0, totalCalls: 0, billableCalls: 0, leadSpend: 0 };
      byDay[p.submitDate].apps++;
      if (isPlaced(p)) { byDay[p.submitDate].placed++; byDay[p.submitDate].premium += p.premium; byDay[p.submitDate].commission += p.commission; byDay[p.submitDate].gar += p.grossAdvancedRevenue; }
    });
    data.calls.forEach(c => {
      if (!byDay[c.date]) byDay[c.date] = { date: c.date, apps: 0, placed: 0, premium: 0, commission: 0, gar: 0, totalCalls: 0, billableCalls: 0, leadSpend: 0 };
      byDay[c.date].totalCalls++; if (c.isBillable) { byDay[c.date].billableCalls++; byDay[c.date].leadSpend += c.cost; }
    });
    return Object.values(byDay).map(d => ({
      ...d, label: d.date.slice(5),
      cpa: d.placed > 0 ? d.leadSpend / d.placed : null,
      rpc: d.totalCalls > 0 ? d.leadSpend / d.totalCalls : null,
      billableRate: d.totalCalls > 0 ? d.billableCalls / d.totalCalls * 100 : null,
      closeRate: d.billableCalls > 0 ? d.placed / d.billableCalls * 100 : null,
      placementRate: d.apps > 0 ? d.placed / d.apps * 100 : null,
      avgPremium: d.placed > 0 ? d.premium / d.placed : null,
      netRevenue: d.gar - d.leadSpend - d.commission,
    })).sort((a, b) => a.date.localeCompare(b.date));
  }, [data]);

  // ─── Comparison data by day ─────────────────────
  const comparisonData = useMemo(() => {
    if (!data || selectedItems.length === 0) return [];
    const byDay = {};

    if (compareMode === 'campaign') {
      data.policies.forEach(p => {
        if (!selectedItems.includes(p.leadSource)) return;
        if (!byDay[p.submitDate]) byDay[p.submitDate] = { date: p.submitDate, label: p.submitDate.slice(5) };
        const key = p.leadSource;
        if (!byDay[p.submitDate][key + '_apps']) { byDay[p.submitDate][key + '_apps'] = 0; byDay[p.submitDate][key + '_placed'] = 0; byDay[p.submitDate][key + '_premium'] = 0; byDay[p.submitDate][key + '_commission'] = 0; byDay[p.submitDate][key + '_gar'] = 0; }
        byDay[p.submitDate][key + '_apps']++;
        if (isPlaced(p)) { byDay[p.submitDate][key + '_placed']++; byDay[p.submitDate][key + '_premium'] += p.premium; byDay[p.submitDate][key + '_commission'] += p.commission; byDay[p.submitDate][key + '_gar'] += p.grossAdvancedRevenue; }
      });
      data.calls.forEach(c => {
        if (!selectedItems.includes(c.campaignCode)) return;
        if (!byDay[c.date]) byDay[c.date] = { date: c.date, label: c.date.slice(5) };
        const key = c.campaignCode;
        if (!byDay[c.date][key + '_totalCalls']) { byDay[c.date][key + '_totalCalls'] = 0; byDay[c.date][key + '_billableCalls'] = 0; byDay[c.date][key + '_leadSpend'] = 0; }
        byDay[c.date][key + '_totalCalls']++;
        if (c.isBillable) { byDay[c.date][key + '_billableCalls']++; byDay[c.date][key + '_leadSpend'] += c.cost; }
      });
    } else {
      data.policies.forEach(p => {
        if (!selectedItems.includes(p.agent)) return;
        if (!byDay[p.submitDate]) byDay[p.submitDate] = { date: p.submitDate, label: p.submitDate.slice(5) };
        const key = p.agent;
        if (!byDay[p.submitDate][key + '_apps']) { byDay[p.submitDate][key + '_apps'] = 0; byDay[p.submitDate][key + '_placed'] = 0; byDay[p.submitDate][key + '_premium'] = 0; byDay[p.submitDate][key + '_commission'] = 0; byDay[p.submitDate][key + '_gar'] = 0; }
        byDay[p.submitDate][key + '_apps']++;
        if (isPlaced(p)) { byDay[p.submitDate][key + '_placed']++; byDay[p.submitDate][key + '_premium'] += p.premium; byDay[p.submitDate][key + '_commission'] += p.commission; byDay[p.submitDate][key + '_gar'] += p.grossAdvancedRevenue; }
      });
      data.calls.forEach(c => {
        if (!c.rep || !selectedItems.includes(c.rep)) return;
        if (!byDay[c.date]) byDay[c.date] = { date: c.date, label: c.date.slice(5) };
        const key = c.rep;
        if (!byDay[c.date][key + '_totalCalls']) { byDay[c.date][key + '_totalCalls'] = 0; byDay[c.date][key + '_billableCalls'] = 0; byDay[c.date][key + '_leadSpend'] = 0; }
        byDay[c.date][key + '_totalCalls']++;
        if (c.isBillable) { byDay[c.date][key + '_billableCalls']++; byDay[c.date][key + '_leadSpend'] += c.cost; }
      });
    }

    // Compute derived metrics
    return Object.values(byDay).map(day => {
      selectedItems.forEach(item => {
        const tc = day[item + '_totalCalls'] || 0;
        const bc = day[item + '_billableCalls'] || 0;
        const ls = day[item + '_leadSpend'] || 0;
        const pl = day[item + '_placed'] || 0;
        const pr = day[item + '_premium'] || 0;
        const gar = day[item + '_gar'] || 0;
        const comm = day[item + '_commission'] || 0;
        day[item + '_cpa'] = pl > 0 ? ls / pl : null;
        day[item + '_rpc'] = tc > 0 ? ls / tc : null;
        day[item + '_billableRate'] = tc > 0 ? bc / tc * 100 : null;
        day[item + '_closeRate'] = bc > 0 ? pl / bc * 100 : null;
        day[item + '_avgPremium'] = pl > 0 ? pr / pl : null;
        day[item + '_netRevenue'] = gar - ls - comm;
      });
      return day;
    }).sort((a, b) => a.date.localeCompare(b.date));
  }, [data, selectedItems, compareMode]);

  // ─── Summary stats ──────────────────────────────
  const summary = useMemo(() => {
    if (!data) return {};
    const placed = data.policies.filter(isPlaced);
    const prem = placed.reduce((s, p) => s + p.premium, 0);
    const comm = placed.reduce((s, p) => s + p.commission, 0);
    const gar = placed.reduce((s, p) => s + p.grossAdvancedRevenue, 0);
    const spend = data.calls.reduce((s, c) => s + c.cost, 0);
    const bill = data.calls.filter(c => c.isBillable).length;
    return {
      policies: data.policies.length, placed: placed.length, premium: prem, commission: comm,
      gar, leadSpend: spend, calls: data.calls.length, billable: bill,
      cpa: placed.length > 0 ? spend / placed.length : 0,
      rpc: data.calls.length > 0 ? spend / data.calls.length : 0,
      billableRate: data.calls.length > 0 ? bill / data.calls.length * 100 : 0,
      avgPremium: placed.length > 0 ? prem / placed.length : 0,
      netRevenue: gar - spend - comm,
    };
  }, [data]);

  const cg = goals?.company || {};
  const axisStyle = { fontSize: 10, fontFamily: C.mono, fill: C.muted };
  const gridStyle = { stroke: C.border, strokeDasharray: '3 3' };

  if (loading) {
    return (
      <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: C.sans }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 40, height: 40, border: `3px solid ${C.border}`, borderTopColor: C.accent, borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
          <p style={{ color: C.muted, fontSize: 14 }}>Loading trends data...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  const isCompare = view === 'compare';
  const chartSrc = isCompare ? comparisonData : dailyData;

  // Helper to render comparison lines
  function compLines(metric, strokeWidth = 2) {
    return selectedItems.map((item, i) => (
      <Line key={item} dataKey={item + '_' + metric} name={item} stroke={COLORS[i % COLORS.length]}
        strokeWidth={strokeWidth} dot={{ r: 2, fill: COLORS[i % COLORS.length] }} connectNulls />
    ));
  }

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text, fontFamily: C.sans }}>
      {/* Header */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: '12px 24px', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <a href="/" style={{ color: C.accent, fontSize: 12, textDecoration: 'none', fontWeight: 600 }}>← Dashboard</a>
            <div>
              <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0, letterSpacing: -0.3 }}>Performance Trends</h1>
              <p style={{ fontSize: 10, color: C.muted, margin: '2px 0 0' }}>{summary.policies} policies · {summary.calls} calls · {dateRange.preset === 'all' ? 'All time' : `${dateRange.start} to ${dateRange.end}`}</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 1, background: C.card, borderRadius: 6, padding: 2, border: `1px solid ${C.border}` }}>
            {[{ id: 'daily', label: 'Daily Trends' }, { id: 'compare', label: 'Compare' }].map(v => (
              <button key={v.id} onClick={() => setView(v.id)} style={{
                padding: '5px 14px', borderRadius: 4, border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                background: view === v.id ? C.accent : 'transparent', color: view === v.id ? '#fff' : C.muted,
              }}>{v.label}</button>
            ))}
          </div>
        </div>
      </div>
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: '8px 24px' }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
          <div style={{ display: 'flex', gap: 1, background: C.card, borderRadius: 6, padding: 2, border: `1px solid ${C.border}` }}>
            {[{ id: 'last7', label: '7D' }, { id: 'last30', label: '30D' }, { id: 'mtd', label: 'MTD' }, { id: 'all', label: 'All' }].map(p => (
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

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '20px 24px' }}>

        {/* Summary strip */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <StatCard label="Gross Adv Revenue" value={fmtD(summary.gar)} color={C.green} />
          <StatCard label="Net Revenue" value={fmtD(summary.netRevenue)} color={summary.netRevenue > 0 ? C.green : C.red} />
          <StatCard label="Lead Spend" value={fmtD(summary.leadSpend)} color={C.yellow} />
          <StatCard label="CPA" value={fmtD(summary.cpa)} color={summary.cpa <= (cg.cpa || 999) ? C.green : C.red} />
          <StatCard label="RPC" value={fmtD(summary.rpc, 2)} color={C.cyan} />
          <StatCard label="Avg Premium" value={fmtD(summary.avgPremium, 2)} color={C.accent} />
          <StatCard label="Bill %" value={fmtP(summary.billableRate)} color={C.purple} />
        </div>

        {/* Comparison Controls */}
        {isCompare && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
              <span style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>Compare by:</span>
              {['campaign', 'agent'].map(m => (
                <button key={m} onClick={() => setCompareMode(m)} style={{
                  padding: '3px 12px', borderRadius: 4, border: `1px solid ${compareMode === m ? C.accent : C.border}`,
                  background: compareMode === m ? C.accentDim : 'transparent', color: compareMode === m ? C.accent : C.muted,
                  fontSize: 11, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize',
                }}>{m === 'campaign' ? 'Campaign' : 'Agent'}</button>
              ))}
            </div>
            <MultiSelect
              options={compareMode === 'campaign' ? campaignOptions : agentOptions}
              selected={selectedItems}
              onChange={setSelectedItems}
              label={compareMode === 'campaign' ? 'Select Campaigns (max 5)' : 'Select Agents (max 5)'}
            />
            {selectedItems.length === 0 && <p style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>Select 2–5 items above to compare them side-by-side</p>}
          </div>
        )}

        {/* Charts */}
        {(view === 'daily' || (isCompare && selectedItems.length > 0)) && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

            {/* 1. Gross & Net Revenue */}
            <ChartCard title="Gross Advanced Revenue & Net Revenue" subtitle={isCompare ? 'Net revenue by selection' : '9-month advance (6mo CICA) minus costs'}>
              <ResponsiveContainer width="100%" height="100%">
                {isCompare ? (
                  <LineChart data={chartSrc}>
                    <CartesianGrid {...gridStyle} /><XAxis dataKey="label" tick={axisStyle} /><YAxis tick={axisStyle} tickFormatter={v => '$' + v} />
                    <Tooltip content={<CustomTooltip formatter={v => fmtD(v)} />} /><Legend wrapperStyle={{ fontSize: 10 }} />
                    {compLines('netRevenue')}
                  </LineChart>
                ) : (
                  <ComposedChart data={chartSrc}>
                    <CartesianGrid {...gridStyle} /><XAxis dataKey="label" tick={axisStyle} /><YAxis tick={axisStyle} tickFormatter={v => '$' + v} />
                    <Tooltip content={<CustomTooltip formatter={v => fmtD(v)} />} /><Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="gar" name="Gross Adv Rev" fill={C.green} opacity={0.5} radius={[2,2,0,0]} />
                    <Line dataKey="netRevenue" name="Net Revenue" stroke={C.accent} strokeWidth={2.5} dot={{ r: 3, fill: C.accent }} />
                    <ReferenceLine y={0} stroke={C.muted} strokeDasharray="4 4" />
                  </ComposedChart>
                )}
              </ResponsiveContainer>
            </ChartCard>

            {/* 2. CPA */}
            <ChartCard title="CPA Trend" subtitle={isCompare ? 'Cost per acquisition by selection' : 'Lower is better'}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartSrc}>
                  <CartesianGrid {...gridStyle} /><XAxis dataKey="label" tick={axisStyle} /><YAxis tick={axisStyle} tickFormatter={v => '$' + v} />
                  <Tooltip content={<CustomTooltip formatter={v => fmtD(v)} />} /><Legend wrapperStyle={{ fontSize: 10 }} />
                  {isCompare ? compLines('cpa') : <Line dataKey="cpa" name="CPA" stroke={C.red} strokeWidth={2.5} dot={{ r: 3, fill: C.red }} connectNulls />}
                  {cg.cpa && <ReferenceLine y={cg.cpa} stroke={C.green} strokeDasharray="6 4" strokeOpacity={0.5} label={{ value: 'Goal', fill: C.muted, fontSize: 9, position: 'right' }} />}
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* 3. Lead Spend */}
            <ChartCard title="Lead Spend" subtitle={isCompare ? 'Daily spend by selection' : 'Total billable call cost per day'}>
              <ResponsiveContainer width="100%" height="100%">
                {isCompare ? (
                  <LineChart data={chartSrc}>
                    <CartesianGrid {...gridStyle} /><XAxis dataKey="label" tick={axisStyle} /><YAxis tick={axisStyle} tickFormatter={v => '$' + v} />
                    <Tooltip content={<CustomTooltip formatter={v => fmtD(v)} />} /><Legend wrapperStyle={{ fontSize: 10 }} />
                    {compLines('leadSpend')}
                  </LineChart>
                ) : (
                  <BarChart data={chartSrc}>
                    <CartesianGrid {...gridStyle} /><XAxis dataKey="label" tick={axisStyle} /><YAxis tick={axisStyle} tickFormatter={v => '$' + v} />
                    <Tooltip content={<CustomTooltip formatter={v => fmtD(v)} />} />
                    <Bar dataKey="leadSpend" name="Lead Spend" fill={C.yellow} opacity={0.8} radius={[2,2,0,0]} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </ChartCard>

            {/* 4. RPC */}
            <ChartCard title="RPC (Revenue Per Call)" subtitle={isCompare ? 'RPC by selection' : 'Lead spend ÷ total calls'}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartSrc}>
                  <CartesianGrid {...gridStyle} /><XAxis dataKey="label" tick={axisStyle} /><YAxis tick={axisStyle} tickFormatter={v => '$' + v} />
                  <Tooltip content={<CustomTooltip formatter={v => fmtD(v, 2)} />} /><Legend wrapperStyle={{ fontSize: 10 }} />
                  {isCompare ? compLines('rpc') : <Line dataKey="rpc" name="RPC" stroke={C.cyan} strokeWidth={2.5} dot={{ r: 3, fill: C.cyan }} connectNulls />}
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* 5. Billable Rate */}
            <ChartCard title="Billable Rate" subtitle={isCompare ? 'Billable % by selection' : 'Percentage of calls that are billable'}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartSrc}>
                  <CartesianGrid {...gridStyle} /><XAxis dataKey="label" tick={axisStyle} /><YAxis tick={axisStyle} tickFormatter={v => v + '%'} domain={[0, 100]} />
                  <Tooltip content={<CustomTooltip formatter={v => fmtP(v)} />} /><Legend wrapperStyle={{ fontSize: 10 }} />
                  {isCompare ? compLines('billableRate') : <Line dataKey="billableRate" name="Billable %" stroke={C.purple} strokeWidth={2.5} dot={{ r: 3, fill: C.purple }} connectNulls />}
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* 6. Call Volume */}
            <ChartCard title="Call Volume" subtitle={isCompare ? 'Total calls by selection' : 'Total vs billable calls per day'}>
              <ResponsiveContainer width="100%" height="100%">
                {isCompare ? (
                  <LineChart data={chartSrc}>
                    <CartesianGrid {...gridStyle} /><XAxis dataKey="label" tick={axisStyle} /><YAxis tick={axisStyle} />
                    <Tooltip content={<CustomTooltip />} /><Legend wrapperStyle={{ fontSize: 10 }} />
                    {compLines('totalCalls')}
                  </LineChart>
                ) : (
                  <BarChart data={chartSrc}>
                    <CartesianGrid {...gridStyle} /><XAxis dataKey="label" tick={axisStyle} /><YAxis tick={axisStyle} />
                    <Tooltip content={<CustomTooltip />} /><Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="totalCalls" name="Total Calls" fill={C.accent} opacity={0.4} radius={[2,2,0,0]} />
                    <Bar dataKey="billableCalls" name="Billable" fill={C.accent} radius={[2,2,0,0]} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </ChartCard>

            {/* 7. Avg Premium */}
            <ChartCard title="Average Premium" subtitle={isCompare ? 'Avg premium per placed policy by selection' : 'Average monthly premium per placed policy'}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartSrc}>
                  <CartesianGrid {...gridStyle} /><XAxis dataKey="label" tick={axisStyle} /><YAxis tick={axisStyle} tickFormatter={v => '$' + v} />
                  <Tooltip content={<CustomTooltip formatter={v => fmtD(v, 2)} />} /><Legend wrapperStyle={{ fontSize: 10 }} />
                  {isCompare ? compLines('avgPremium') : <Line dataKey="avgPremium" name="Avg Premium" stroke={C.orange} strokeWidth={2.5} dot={{ r: 3, fill: C.orange }} connectNulls />}
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* 8. Commission */}
            <ChartCard title="Commission" subtitle={isCompare ? 'Agent commission by selection' : 'Agent commission per day'}>
              <ResponsiveContainer width="100%" height="100%">
                {isCompare ? (
                  <LineChart data={chartSrc}>
                    <CartesianGrid {...gridStyle} /><XAxis dataKey="label" tick={axisStyle} /><YAxis tick={axisStyle} tickFormatter={v => '$' + v} />
                    <Tooltip content={<CustomTooltip formatter={v => fmtD(v)} />} /><Legend wrapperStyle={{ fontSize: 10 }} />
                    {compLines('commission')}
                  </LineChart>
                ) : (
                  <BarChart data={chartSrc}>
                    <CartesianGrid {...gridStyle} /><XAxis dataKey="label" tick={axisStyle} /><YAxis tick={axisStyle} tickFormatter={v => '$' + v} />
                    <Tooltip content={<CustomTooltip formatter={v => fmtD(v)} />} />
                    <Bar dataKey="commission" name="Commission" fill={C.accent} opacity={0.8} radius={[2,2,0,0]} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </ChartCard>

            {/* 9. Conversion Rates */}
            <ChartCard title="Conversion Rates" subtitle={isCompare ? 'Close rate by selection' : 'Close rate & placement rate'} height={320}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartSrc}>
                  <CartesianGrid {...gridStyle} /><XAxis dataKey="label" tick={axisStyle} /><YAxis tick={axisStyle} tickFormatter={v => v + '%'} domain={[0, 100]} />
                  <Tooltip content={<CustomTooltip formatter={v => fmtP(v)} />} /><Legend wrapperStyle={{ fontSize: 10 }} />
                  {isCompare ? compLines('closeRate') : (
                    <>
                      <Line dataKey="closeRate" name="Close Rate" stroke={C.green} strokeWidth={2.5} dot={{ r: 3, fill: C.green }} connectNulls />
                      <Line dataKey="placementRate" name="Placement Rate" stroke={C.purple} strokeWidth={2} dot={{ r: 3, fill: C.purple }} connectNulls strokeDasharray="5 3" />
                    </>
                  )}
                  {cg.conversionRate && <ReferenceLine y={cg.conversionRate} stroke={C.green} strokeDasharray="6 4" strokeOpacity={0.4} />}
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

          </div>
        )}

        {isCompare && selectedItems.length === 0 && (
          <div style={{ textAlign: 'center', padding: 60, color: C.muted }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
            <p style={{ fontSize: 14 }}>Select campaigns or agents above to compare their performance side-by-side</p>
          </div>
        )}

      </div>
    </div>
  );
}
