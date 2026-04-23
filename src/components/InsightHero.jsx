'use client';
import { useState, useEffect } from 'react';

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

export default function InsightHero({ category, date }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [allOpen, setAllOpen] = useState(false);

  useEffect(() => {
    if (!category) return;
    setLoading(true);
    setError(null);
    setData(null);
    setAllOpen(false);

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

  return (
    <div style={{
      background: C.card, borderLeft: `4px solid ${sev.bar}`,
      borderRadius: 6, padding: '14px 16px', marginBottom: 16,
      position: 'relative', fontFamily: C.sans,
    }}>
      <div style={{ position: 'absolute', top: 12, right: 14, display: 'flex', gap: 4, alignItems: 'center' }}>
        <button title="Helpful headline" style={voteBtnStyle}>👍</button>
        <button title="Not helpful" style={voteBtnStyle}>👎</button>
        <span title={`Matched #${data.headline.priorityRank}: ${data.headline.priorityMatched || 'n/a'}${data.headline.wasOverride ? ' (severity override)' : ''}`}
              style={{ color: C.muted, fontSize: 12, cursor: 'help', padding: '0 4px' }}>ⓘ</span>
      </div>

      <div style={{
        fontSize: 10, fontWeight: 700, color: sev.label,
        textTransform: 'uppercase', letterSpacing: 1.4, marginBottom: 6,
      }}>
        {data.headline.severity === 'red' ? '⚠' : data.headline.severity === 'yellow' ? '◐' : '✓'} Today's Headline
      </div>

      <div style={{ fontSize: 14, lineHeight: 1.55, color: C.text, fontWeight: 500, paddingRight: 80 }}>
        {data.headline.text}
      </div>

      {(data.kpis?.length > 0 || data.topAction) && (
        <div style={{
          display: 'flex', marginTop: 12, borderTop: `1px solid ${C.border}`,
          paddingTop: 12, alignItems: 'stretch',
        }}>
          {(data.kpis || []).map((kpi, i) => {
            const trendColor = kpi.trend === 'up' ? C.green : kpi.trend === 'down' ? C.red : C.text;
            const trendArrow = kpi.trend === 'up' ? ' ↑' : kpi.trend === 'down' ? ' ↓' : '';
            return (
              <div key={i} style={{ paddingRight: 20, marginRight: 20, borderRight: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8 }}>{kpi.label}</div>
                <div style={{ fontFamily: C.mono, fontSize: 17, fontWeight: 800, color: trendColor, marginTop: 2 }}>
                  {kpi.value}{trendArrow}
                </div>
              </div>
            );
          })}
          {data.topAction && (
            <div style={{ flex: 1, paddingLeft: 16, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div style={{ fontSize: 9, color: C.accent, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700 }}>Top Action</div>
              <div style={{ fontSize: 12, color: C.text, marginTop: 3, lineHeight: 1.4 }}>{data.topAction}</div>
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
        <div
          onClick={() => setAllOpen(o => !o)}
          style={{
            color: C.muted, fontSize: 11, cursor: 'pointer', padding: '6px 0',
            userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
          }}
          onMouseEnter={e => e.currentTarget.style.color = C.text}
          onMouseLeave={e => e.currentTarget.style.color = C.muted}
        >
          <span style={{ width: 12, color: C.accent }}>{allOpen ? '▼' : '▶'}</span>
          <span>All insights</span>
          <span style={{ color: C.muted }}>
            · {data.anomalies?.length || 0} anomalies · {data.breaches?.length || 0} breach{(data.breaches?.length || 0) === 1 ? '' : 'es'} · {data.actions?.length || 0} actions · {data.themes?.length || 0} theme{(data.themes?.length || 0) === 1 ? '' : 's'} · {data.wins?.length || 0} win{(data.wins?.length || 0) === 1 ? '' : 's'} · {data.examples?.length || 0} example{(data.examples?.length || 0) === 1 ? '' : 's'}
          </span>
          {data.meta?.synthesisMs && (
            <span style={{ color: C.muted, fontSize: 9, marginLeft: 'auto', fontFamily: C.mono }}>
              {(data.meta.synthesisMs / 1000).toFixed(1)}s {data.cached ? '(cached)' : '(fresh)'}
            </span>
          )}
        </div>

        {allOpen && (
          <div style={{ marginTop: 10, padding: 14, background: C.bg, borderRadius: 4, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Bucket title="⚠ Anomalies" items={data.anomalies} render={(it) => (
              <>
                <div style={{ fontSize: 11, color: C.text, fontWeight: 600 }}>
                  {it.text}
                  {it.severity && <Chip text={it.severity} severity={it.severity} />}
                </div>
                {it.evidence && <div style={{ fontSize: 11, color: C.text, marginTop: 3, lineHeight: 1.5, fontStyle: 'italic', opacity: 0.95 }}>↳ {it.evidence}</div>}
              </>
            )} />
            <Bucket title="🚨 Threshold Breaches" items={data.breaches} render={(it) => (
              <>
                <div style={{ fontSize: 11, color: C.text, fontWeight: 600 }}>
                  {it.text}
                  {it.severity && <Chip text={it.severity} severity={it.severity} />}
                </div>
                {it.evidence && <div style={{ fontSize: 11, color: C.text, marginTop: 3, lineHeight: 1.5, fontStyle: 'italic', opacity: 0.95 }}>↳ {it.evidence}</div>}
              </>
            )} />
            <Bucket title="🎯 Actions" items={data.actions} render={(it) => (
              <>
                <div style={{ fontSize: 11, color: C.text, fontWeight: 600 }}>
                  <span style={{ color: C.accent, fontFamily: C.mono, marginRight: 6 }}>{it.rank ? `${it.rank}.` : '•'}</span>
                  {it.text}
                </div>
                {it.evidence && <div style={{ fontSize: 11, color: C.text, marginTop: 3, lineHeight: 1.5, fontStyle: 'italic', opacity: 0.95 }}>↳ {it.evidence}</div>}
              </>
            )} />
            <Bucket title="🔁 Sustained Themes" items={data.themes} render={(it) => (
              <>
                <div style={{ fontSize: 11, color: C.text, fontWeight: 600 }}>
                  {it.text}
                  {it.daysObserved && <Chip text={`${it.daysObserved} days`} severity="yellow" />}
                </div>
                {it.evidence && <div style={{ fontSize: 11, color: C.text, marginTop: 3, lineHeight: 1.5, fontStyle: 'italic', opacity: 0.95 }}>↳ {it.evidence}</div>}
              </>
            )} />
            <Bucket title="✓ Wins" items={data.wins} render={(it) => (
              <>
                <div style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>{it.text}</div>
                {it.evidence && <div style={{ fontSize: 11, color: C.text, marginTop: 3, lineHeight: 1.5, fontStyle: 'italic', opacity: 0.95 }}>↳ {it.evidence}</div>}
              </>
            )} />
            <Bucket title="💬 Examples & Quotes" items={data.examples} render={(it) => (
              <div style={{ borderLeft: `2px solid ${C.accent}44`, paddingLeft: 10 }}>
                <div style={{ fontSize: 9, color: C.accent, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>{it.type || 'note'}</div>
                <div style={{ fontSize: 11, color: C.text, marginTop: 3, lineHeight: 1.5 }}>{it.text}</div>
                {it.context && <div style={{ fontSize: 10.5, color: C.text, marginTop: 3, fontStyle: 'italic', opacity: 0.85 }}>{it.context}</div>}
              </div>
            )} />
          </div>
        )}
      </div>
    </div>
  );
}

function Bucket({ title, items, render }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <div style={{ fontSize: 9, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((it, i) => <div key={i}>{render(it)}</div>)}
      </div>
    </div>
  );
}

const voteBtnStyle = {
  background: 'transparent', border: `1px solid ${C.border}`,
  color: C.muted, borderRadius: 4, padding: '3px 8px', fontSize: 11,
  cursor: 'pointer',
};
