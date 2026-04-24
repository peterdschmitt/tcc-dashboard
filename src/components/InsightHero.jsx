'use client';
import { useState, useEffect, lazy, Suspense } from 'react';

const FullAnalysis = lazy(() => import('./FullAnalysis'));

const C = {
  bg: '#080b10', surface: '#0f1520', card: '#131b28', border: '#1a2538',
  text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff',
  green: '#4ade80', greenDim: '#0a2e1a',
  yellow: '#facc15', yellowDim: '#2e2a0a',
  red: '#f87171', redDim: '#2e0a0a',
  mono: "'SF Mono', 'Fira Code', monospace",
  sans: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
};

const SEVERITY_COLOR = {
  red: { bar: C.red, label: C.red, dim: C.redDim },
  yellow: { bar: C.yellow, label: C.yellow, dim: C.yellowDim },
  green: { bar: C.green, label: C.green, dim: C.greenDim },
  info: { bar: C.accent, label: C.accent, dim: C.accent + '22' },
};

// Typography tokens — distinguish section heading > item title > subpoint > evidence
const T = {
  sectionHeading: {
    fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2,
    color: C.accent, fontFamily: C.sans,
    borderBottom: `1px solid ${C.border}`, paddingBottom: 6,
    marginTop: 28, marginBottom: 12,
  },
  itemTitle: {
    fontSize: 13, fontWeight: 700, color: C.text, fontFamily: C.sans,
    lineHeight: 1.45, marginBottom: 4,
  },
  itemRank: {
    display: 'inline-block', fontSize: 12, fontWeight: 800,
    color: C.accent, fontFamily: C.mono, marginRight: 8,
  },
  itemSubpoint: {
    fontSize: 11, fontWeight: 600, color: C.muted,
    fontFamily: C.sans, marginBottom: 3,
  },
  itemEvidence: {
    fontSize: 12, fontWeight: 400, color: C.text,
    fontFamily: C.sans, lineHeight: 1.5,
    paddingLeft: 12, marginLeft: 4, marginTop: 4,
    borderLeft: `2px solid ${C.border}`,
    opacity: 0.88,
  },
  item: { marginBottom: 14 },
};

function Chip({ text, severity }) {
  const sev = SEVERITY_COLOR[severity] || SEVERITY_COLOR.info;
  return (
    <span style={{
      display: 'inline-block', padding: '1px 6px', borderRadius: 3,
      fontSize: 9, fontWeight: 600, fontFamily: C.mono,
      background: sev.dim, color: sev.label, marginLeft: 6, whiteSpace: 'nowrap',
    }}>{text}</span>
  );
}

function Skeleton() {
  return (
    <div style={{ background: C.card, borderLeft: `4px solid ${C.border}`, borderRadius: 6, padding: '14px 16px', marginBottom: 16 }}>
      <div style={{ height: 10, background: C.border, borderRadius: 3, width: 120, marginBottom: 8 }} />
      <div style={{ height: 18, background: C.border, borderRadius: 3, width: '85%', marginBottom: 6 }} />
      <div style={{ height: 18, background: C.border, borderRadius: 3, width: '60%' }} />
      <div style={{ marginTop: 14, color: C.muted, fontSize: 11, fontFamily: C.mono }}>
        Synthesizing insights from today's report…
      </div>
    </div>
  );
}

function Bucket({ title, items, render }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <div style={T.sectionHeading}>{title}</div>
      <div>
        {items.map((it, i) => <div key={i} style={T.item}>{render(it)}</div>)}
      </div>
    </div>
  );
}

export default function InsightHero({ category, date }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!category) return;
    setLoading(true);
    setError(null);
    setData(null);

    const url = `/api/ai-analyst/insights?category=${encodeURIComponent(category)}${date ? `&date=${encodeURIComponent(date)}` : ''}`;
    fetch(url)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); setData(null); }
        else setData(d);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [category, date]);

  if (loading) return <Skeleton />;
  if (error) {
    return (
      <div style={{ background: C.card, borderLeft: `4px solid ${C.muted}`, borderRadius: 6, padding: '12px 14px', marginBottom: 16, color: C.muted, fontSize: 11 }}>
        Insight synthesis unavailable: {error}
      </div>
    );
  }
  if (!data || !data.headline) return null;

  const sev = SEVERITY_COLOR[data.headline.severity] || SEVERITY_COLOR.info;
  const headlineLabel =
    data.headline.severity === 'red' ? 'HEADLINE — RED'
    : data.headline.severity === 'yellow' ? 'HEADLINE — YELLOW'
    : data.headline.severity === 'green' ? 'HEADLINE — GREEN'
    : 'HEADLINE';

  return (
    <div style={{
      background: C.card, borderLeft: `4px solid ${sev.bar}`,
      borderRadius: 6, padding: '18px 20px', marginBottom: 16,
      position: 'relative', fontFamily: C.sans,
    }}>
      <div style={{ position: 'absolute', top: 14, right: 16, display: 'flex', gap: 4, alignItems: 'center' }}>
        <button title="Helpful headline" style={voteBtnStyle}>Helpful</button>
        <button title="Not helpful" style={voteBtnStyle}>Not helpful</button>
        <span title={`Matched #${data.headline.priorityRank}: ${data.headline.priorityMatched || 'n/a'}${data.headline.wasOverride ? ' (severity override)' : ''}`}
              style={{ color: C.muted, fontSize: 12, cursor: 'help', padding: '0 4px' }}>info</span>
      </div>

      <div style={{
        fontSize: 11, fontWeight: 800, color: sev.label,
        textTransform: 'uppercase', letterSpacing: 1.4, marginBottom: 8,
      }}>
        {headlineLabel}
      </div>

      <div style={{ fontSize: 15, lineHeight: 1.55, color: C.text, fontWeight: 600, paddingRight: 160 }}>
        {data.headline.text}
      </div>

      {(data.kpis?.length > 0 || data.topAction) && (
        <div style={{
          display: 'flex', marginTop: 14, borderTop: `1px solid ${C.border}`,
          paddingTop: 12, alignItems: 'stretch', flexWrap: 'wrap', gap: 12,
        }}>
          {(data.kpis || []).map((kpi, i) => {
            const trendColor = kpi.trend === 'up' ? C.green : kpi.trend === 'down' ? C.red : C.text;
            const trendArrow = kpi.trend === 'up' ? ' ↑' : kpi.trend === 'down' ? ' ↓' : '';
            return (
              <div key={i} style={{ paddingRight: 20, marginRight: 8, borderRight: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700 }}>{kpi.label}</div>
                <div style={{ fontFamily: C.mono, fontSize: 17, fontWeight: 800, color: trendColor, marginTop: 2 }}>
                  {kpi.value}{trendArrow}
                </div>
              </div>
            );
          })}
          {data.topAction && (
            <div style={{ flex: 1, minWidth: 220, paddingLeft: 4, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div style={{ fontSize: 9, color: C.accent, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 800 }}>Top Action</div>
              <div style={{ fontSize: 13, color: C.text, marginTop: 3, lineHeight: 1.4, fontWeight: 600 }}>{data.topAction}</div>
            </div>
          )}
        </div>
      )}

      <div>
        <Bucket title="Anomalies" items={data.anomalies} render={(it) => (
          <>
            <div style={T.itemTitle}>
              {it.text}
              {it.severity && <Chip text={it.severity} severity={it.severity} />}
            </div>
            {it.evidence && <div style={T.itemEvidence}>{it.evidence}</div>}
          </>
        )} />

        <Bucket title="Threshold Breaches" items={data.breaches} render={(it) => (
          <>
            <div style={T.itemTitle}>
              {it.text}
              {it.severity && <Chip text={it.severity} severity={it.severity} />}
            </div>
            {it.evidence && <div style={T.itemEvidence}>{it.evidence}</div>}
          </>
        )} />

        <Bucket title="Top Problems" items={data.topProblems} render={(it) => (
          <>
            <div style={T.itemTitle}>
              {it.rank && <span style={T.itemRank}>{it.rank}.</span>}
              {it.title}
            </div>
            {it.scope && <div style={T.itemSubpoint}>Scope: {it.scope}</div>}
            {it.evidence && <div style={T.itemEvidence}>{it.evidence}</div>}
          </>
        )} />

        <Bucket title="Top Opportunities" items={data.topOpportunities} render={(it) => (
          <>
            <div style={T.itemTitle}>
              {it.rank && <span style={T.itemRank}>{it.rank}.</span>}
              {it.title}
            </div>
            {it.lift && <div style={{ ...T.itemSubpoint, color: C.green }}>Lift: {it.lift}</div>}
            {it.evidence && <div style={T.itemEvidence}>{it.evidence}</div>}
          </>
        )} />

        <Bucket title="Actions" items={data.actions} render={(it) => (
          <>
            <div style={T.itemTitle}>
              {it.rank && <span style={T.itemRank}>{it.rank}.</span>}
              {it.text}
            </div>
            {it.evidence && <div style={T.itemEvidence}>{it.evidence}</div>}
          </>
        )} />

        <Bucket title="Next Week Actions" items={data.nextWeekActions} render={(it) => (
          <>
            <div style={T.itemTitle}>
              {it.rank && <span style={T.itemRank}>{it.rank}.</span>}
              {it.action}
            </div>
            {it.evidence && <div style={T.itemEvidence}>{it.evidence}</div>}
          </>
        )} />

        <Bucket title="Follow-Up Data Needed" items={data.followUpDataNeeded} render={(it) => (
          <>
            <div style={T.itemTitle}>{it.dataNeeded}</div>
            {it.why && <div style={T.itemSubpoint}>Why: {it.why}</div>}
            {it.currentEvidence && <div style={T.itemEvidence}>{it.currentEvidence}</div>}
          </>
        )} />

        <Bucket title="Sustained Themes" items={data.themes} render={(it) => (
          <>
            <div style={T.itemTitle}>
              {it.text}
              {it.daysObserved && <Chip text={`${it.daysObserved} days`} severity="yellow" />}
            </div>
            {it.evidence && <div style={T.itemEvidence}>{it.evidence}</div>}
          </>
        )} />

        <Bucket title="Wins" items={data.wins} render={(it) => (
          <>
            <div style={{ ...T.itemTitle, color: C.green }}>{it.text}</div>
            {it.evidence && <div style={T.itemEvidence}>{it.evidence}</div>}
          </>
        )} />

        <Bucket title="Examples & Quotes" items={data.examples} render={(it) => (
          <div style={{ borderLeft: `2px solid ${C.accent}44`, paddingLeft: 10 }}>
            <div style={{ fontSize: 9, color: C.accent, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 800 }}>{it.type || 'note'}</div>
            <div style={{ ...T.itemTitle, marginTop: 3 }}>{it.text}</div>
            {it.context && <div style={T.itemSubpoint}>{it.context}</div>}
          </div>
        )} />

        {(data.rawMarkdown || (data.evidenceTables && data.evidenceTables.length > 0)) && (
          <Suspense fallback={<div style={{ ...T.itemSubpoint, marginTop: 20 }}>Loading full analysis…</div>}>
            <FullAnalysis
              rawMarkdown={data.rawMarkdown}
              evidenceTables={data.evidenceTables}
              meta={data.meta}
            />
          </Suspense>
        )}

        {data.meta?.synthesisMs && (
          <div style={{
            marginTop: 20, paddingTop: 10, borderTop: `1px solid ${C.border}`,
            color: C.muted, fontSize: 10, fontFamily: C.mono, textAlign: 'right',
          }}>
            synthesized in {(data.meta.synthesisMs / 1000).toFixed(1)}s
            {' · '}{data.cached ? 'cached' : 'fresh'}
            {data.meta.evidenceTableCount != null && ` · ${data.meta.evidenceTableCount} tables extracted`}
          </div>
        )}
      </div>
    </div>
  );
}

const voteBtnStyle = {
  background: 'transparent', border: `1px solid ${C.border}`,
  color: C.muted, borderRadius: 4, padding: '3px 8px', fontSize: 10,
  cursor: 'pointer', fontFamily: C.sans,
};
