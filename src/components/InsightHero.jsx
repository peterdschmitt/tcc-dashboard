'use client';
import { useState } from 'react';

const C = {
  bg: '#080b10', surface: '#0f1520', card: '#131b28', border: '#1a2538',
  text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff',
  green: '#4ade80', greenDim: '#0a2e1a',
  yellow: '#facc15', yellowDim: '#2e2a0a',
  red: '#f87171', redDim: '#2e0a0a',
  mono: "'SF Mono', 'Fira Code', monospace",
  sans: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
};

// Hardcoded sample data — one entry per category. Real version will fetch from
// /api/ai-analyst/insights once the synthesis backend lands.
const MOCK_INSIGHTS = {
  lead_quality: {
    severity: 'red',
    headline: 'Quote rate dropped 18% vs 30d baseline — biggest drop in 14 days, driven by TV FEX. Recommend pausing pending quality review.',
    priorityMatched: '#1: Dominant ad-confusion / expectation-mismatch theme',
    kpis: [
      { label: 'Quote', value: '53%', trend: 'down' },
      { label: 'CPA', value: '$252', trend: 'down' },
      { label: 'Calls', value: '30', trend: null },
    ],
    topAction: 'Pause TV FEX overnight pending quality review',
    anomalies: [
      { text: 'Quote rate -18% vs 30d', severity: 'red' },
      { text: 'CPA +24% on TV FEX', severity: 'yellow' },
    ],
    breaches: [{ text: 'CPA $252 vs goal $200 (26% over)', severity: 'red' }],
    actions: [
      'Pause TV FEX overnight pending quality review',
      'Re-train rep on Plan Details → Application transition',
    ],
    themes: [{ text: 'Plan-Details → Application leak', daysObserved: 4 }],
    wins: [{ text: 'HIW conversion +12% vs 30d baseline' }],
  },
  funnel_analyzer: {
    severity: 'yellow',
    headline: 'HIW × Michael underperforming HIW × Kari by 22pp on close rate — same campaign, different agent. Coaching opportunity isolated.',
    priorityMatched: '#1: Top isolated root cause from same-campaign-across-agents split',
    kpis: [
      { label: 'Close rate', value: '17%', trend: 'down' },
      { label: 'Quote rate', value: '53%', trend: 'down' },
      { label: 'Sample', value: 'n=30', trend: null },
    ],
    topAction: 'Pair Michael with Kari for 1 shadow shift on HIW this week',
    anomalies: [{ text: 'Same-campaign rep delta of 22pp on close rate', severity: 'yellow' }],
    breaches: [],
    actions: [
      'Pair Michael with Kari for 1 shadow shift on HIW',
      'Audit 5 random Michael HIW calls for Plan-Details framing',
    ],
    themes: [{ text: 'HIW close-rate gap between agents', daysObserved: 6 }],
    wins: [{ text: 'Kari\'s HIW sales-to-quote held at 39% (best in cohort)' }],
  },
  volume_capacity: {
    severity: 'yellow',
    headline: 'Reached-agent rate dropped to 64% (vs 78% 30d avg) — IVR loss spiked on TV TERM, suggests queue config or coverage gap.',
    priorityMatched: '#1: Reached-agent % below threshold + leak location',
    kpis: [
      { label: 'Reached', value: '64%', trend: 'down' },
      { label: 'IVR loss', value: '21%', trend: 'down' },
      { label: 'Talk hrs', value: '14.2', trend: null },
    ],
    topAction: 'Audit TV TERM IVR config — 2-3pm window where loss concentrates',
    anomalies: [
      { text: 'Reached-agent 64% vs 78% baseline', severity: 'yellow' },
      { text: 'TV TERM IVR loss +9pp', severity: 'red' },
    ],
    breaches: [],
    actions: [
      'Audit TV TERM IVR config in 2-3pm window',
      'Add 1 floater rep to overflow queue between 1pm-3pm',
    ],
    themes: [{ text: 'Mid-afternoon IVR loss', daysObserved: 5 }],
    wins: [{ text: 'BCL handle-time normalized — back to 4:12 avg' }],
  },
  sales_execution: {
    severity: 'red',
    headline: 'Spray-and-pray flagged on Bill: 71% quote rate but only 18% sales→quote — quoting too freely without qualifying.',
    priorityMatched: '#2: Spray-and-pray detection',
    kpis: [
      { label: 'Sales/billable', value: '0.34', trend: 'down' },
      { label: 'Quote rate', value: '52%', trend: 'up' },
      { label: 'S→Q', value: '28%', trend: 'down' },
    ],
    topAction: 'Coach Bill on budget-and-health gating before quoting',
    anomalies: [{ text: 'Bill quote rate 71% vs 52% company avg', severity: 'red' }],
    breaches: [{ text: 'Bill sales/billable 0.21 vs 0.34 company', severity: 'red' }],
    actions: [
      'Coach Bill on budget-and-health gating before quoting',
      'Review 3 Bill calls where quote was issued without qualification',
    ],
    themes: [{ text: 'Bill\'s quote-rate spread vs company widening', daysObserved: 7 }],
    wins: [{ text: 'Sarah\'s sales/billable up to 0.51 (best in week)' }],
  },
  profitability: {
    severity: 'red',
    headline: 'CPA spiked to $252 on TV FEX × Bill — 38% above campaign average. Volume meaningful (n=14), economic waste real.',
    priorityMatched: '#1: CPA spike alert on meaningful-volume cell',
    kpis: [
      { label: 'CPA', value: '$252', trend: 'down' },
      { label: 'CPQ', value: '$72', trend: 'down' },
      { label: 'Sales/bill', value: '0.34', trend: null },
    ],
    topAction: 'Reroute TV FEX volume away from Bill until coaching completes',
    anomalies: [{ text: 'TV FEX × Bill CPA $252 vs $182 campaign avg', severity: 'red' }],
    breaches: [{ text: 'Company CPA $213 vs $200 target', severity: 'yellow' }],
    actions: [
      'Reroute TV FEX volume away from Bill until coaching completes',
      'Decompose CPA driver: 70% execution shift, 30% mix shift',
    ],
    themes: [{ text: 'CPA mix-shift toward TV FEX (worst-economics campaign)', daysObserved: 8 }],
    wins: [{ text: 'BCL sales/billable held at 0.41 — best campaign economics' }],
  },
  funnel_health: {
    severity: 'yellow',
    headline: 'Plan Details → Application is the biggest leak — only 31% completion (vs 47% 30d avg). Coaching focus this week.',
    priorityMatched: '#1: Single biggest stage-to-stage drop',
    kpis: [
      { label: 'Plan→App', value: '31%', trend: 'down' },
      { label: 'Quote rate', value: '53%', trend: 'down' },
      { label: 'S→Q', value: '31%', trend: 'down' },
    ],
    topAction: 'Run team huddle on Plan Details → Application commit-step language',
    anomalies: [{ text: 'Plan→App completion 31% vs 47% baseline', severity: 'yellow' }],
    breaches: [],
    actions: [
      'Run team huddle on commit-step language',
      'Record 2 best-in-class Kari calls as reference for the team',
    ],
    themes: [{ text: 'Plan-Details → Application leak persistent', daysObserved: 9 }],
    wins: [{ text: 'Reached-Agent → Opening drop closed (now matches baseline)' }],
  },
  mix_product: {
    severity: 'red',
    headline: '70% of calls on HIW which has the worst CPA ($231) — concentration risk. Recommend opening BCL bid to redirect 20% of volume.',
    priorityMatched: '#1: Product-mix shift risk: volume in worst-economics campaign',
    kpis: [
      { label: 'HIW share', value: '70%', trend: 'down' },
      { label: 'HIW CPA', value: '$231', trend: 'down' },
      { label: 'BCL CPA', value: '$148', trend: 'up' },
    ],
    topAction: 'Open BCL bid to redirect 20% of HIW volume',
    anomalies: [{ text: 'HIW carries 70% of volume + worst CPA', severity: 'red' }],
    breaches: [],
    actions: [
      'Open BCL bid to redirect 20% of HIW volume',
      'Restrict INU to high-intent only (28% high/med intent)',
    ],
    themes: [{ text: 'HIW volume concentration', daysObserved: 12 }],
    wins: [{ text: 'BCL quote-to-sale stability ranked #1 across products' }],
  },
};

const SEVERITY_COLOR = {
  red: { bar: C.red, label: C.red, dim: C.redDim },
  yellow: { bar: C.yellow, label: C.yellow, dim: C.yellowDim },
  green: { bar: C.green, label: C.green, dim: C.greenDim },
  info: { bar: C.accent, label: C.accent, dim: C.accent + '22' },
};

function Chip({ text, severity }) {
  const sev = SEVERITY_COLOR[severity] || SEVERITY_COLOR.info;
  return (
    <span style={{
      display: 'inline-block', padding: '1px 6px', borderRadius: 3,
      fontSize: 9, fontWeight: 600, fontFamily: C.mono,
      background: sev.dim, color: sev.label, marginLeft: 6,
    }}>{text}</span>
  );
}

export default function InsightHero({ category, date }) {
  const [allOpen, setAllOpen] = useState(false);
  const data = MOCK_INSIGHTS[category];
  if (!data) return null;
  const sev = SEVERITY_COLOR[data.severity] || SEVERITY_COLOR.info;

  return (
    <div style={{
      background: C.card, borderLeft: `4px solid ${sev.bar}`,
      borderRadius: 6, padding: '14px 16px', marginBottom: 16,
      position: 'relative', fontFamily: C.sans,
    }}>
      {/* Top-right action buttons */}
      <div style={{ position: 'absolute', top: 12, right: 14, display: 'flex', gap: 4, alignItems: 'center' }}>
        <button title="Helpful headline" style={voteBtnStyle}>👍</button>
        <button title="Not helpful" style={voteBtnStyle}>👎</button>
        <span title={`Matched ${data.priorityMatched}`} style={{ color: C.muted, fontSize: 12, cursor: 'help', padding: '0 4px' }}>ⓘ</span>
      </div>

      {/* Headline label */}
      <div style={{
        fontSize: 10, fontWeight: 700, color: sev.label,
        textTransform: 'uppercase', letterSpacing: 1.4, marginBottom: 6,
      }}>
        {data.severity === 'red' ? '⚠' : data.severity === 'yellow' ? '◐' : '✓'} Today's Headline
      </div>

      {/* Headline text */}
      <div style={{ fontSize: 14, lineHeight: 1.55, color: C.text, fontWeight: 500, paddingRight: 80 }}>
        {data.headline}
      </div>

      {/* KPI strip + top action */}
      <div style={{
        display: 'flex', marginTop: 12, borderTop: `1px solid ${C.border}`,
        paddingTop: 12, alignItems: 'stretch',
      }}>
        {data.kpis.map((kpi, i) => {
          const trendColor = kpi.trend === 'up' ? C.green : kpi.trend === 'down' ? C.red : C.text;
          const trendArrow = kpi.trend === 'up' ? ' ↑' : kpi.trend === 'down' ? ' ↓' : '';
          return (
            <div key={i} style={{ paddingRight: 24, marginRight: 24, borderRight: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8 }}>{kpi.label}</div>
              <div style={{ fontFamily: C.mono, fontSize: 18, fontWeight: 800, color: trendColor, marginTop: 2 }}>
                {kpi.value}{trendArrow}
              </div>
            </div>
          );
        })}
        <div style={{ flex: 1, paddingLeft: 16, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: 9, color: C.accent, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700 }}>Top Action</div>
          <div style={{ fontSize: 12, color: C.text, marginTop: 3 }}>{data.topAction}</div>
        </div>
      </div>

      {/* Drawer toggle */}
      <div style={{ marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
        <div
          onClick={() => setAllOpen(o => !o)}
          style={{
            color: C.muted, fontSize: 11, cursor: 'pointer', padding: '6px 0',
            userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6,
          }}
          onMouseEnter={e => e.currentTarget.style.color = C.text}
          onMouseLeave={e => e.currentTarget.style.color = C.muted}
        >
          <span style={{ width: 12, color: C.accent }}>{allOpen ? '▼' : '▶'}</span>
          <span>All insights</span>
          <span style={{ color: C.muted }}>
            · {data.anomalies.length} anomalies · {data.breaches.length} breach{data.breaches.length === 1 ? '' : 'es'} · {data.actions.length} actions · {data.themes.length} theme{data.themes.length === 1 ? '' : 's'} · {data.wins.length} win{data.wins.length === 1 ? '' : 's'}
          </span>
        </div>

        {allOpen && (
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
            marginTop: 10, padding: 12, background: C.bg, borderRadius: 4,
          }}>
            <Bucket title="⚠ Anomalies" items={data.anomalies} />
            <Bucket title="🚨 Breaches" items={data.breaches} />
            <Bucket title="🎯 Actions" items={data.actions.map(a => ({ text: a }))} />
            <Bucket title="🔁 Themes" items={data.themes.map(t => ({ text: t.text, severity: 'yellow', chip: `${t.daysObserved} days` }))} />
            <Bucket title="✓ Wins" items={data.wins.map(w => ({ text: w.text, severity: 'green' }))} fullWidth />
          </div>
        )}
      </div>
    </div>
  );
}

function Bucket({ title, items, fullWidth }) {
  return (
    <div style={{ padding: '4px 0', gridColumn: fullWidth ? 'span 2' : undefined }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
        {title}
      </div>
      {items.length === 0 && <div style={{ fontSize: 11, color: C.muted, fontStyle: 'italic' }}>none</div>}
      {items.map((it, i) => (
        <div key={i} style={{ fontSize: 11, color: C.text, margin: '4px 0', lineHeight: 1.5 }}>
          {it.text}
          {it.chip && <Chip text={it.chip} severity={it.severity} />}
          {it.severity && !it.chip && it.severity !== 'info' && <Chip text={it.severity} severity={it.severity} />}
        </div>
      ))}
    </div>
  );
}

const voteBtnStyle = {
  background: 'transparent', border: `1px solid ${C.border}`,
  color: C.muted, borderRadius: 4, padding: '3px 8px', fontSize: 11,
  cursor: 'pointer',
};
