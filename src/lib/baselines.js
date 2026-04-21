// src/lib/baselines.js
// Pure stats — no I/O. Inputs are arrays of { date, value } sorted ascending.

function mean(xs) {
  if (!xs.length) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function stdev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1);
  return Math.sqrt(v);
}

function trendSlope(xs) {
  // Simple linear regression slope over index. Returns per-step slope.
  const n = xs.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = mean(xs);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - mx) * (xs[i] - my);
    den += (i - mx) * (i - mx);
  }
  return den === 0 ? 0 : num / den;
}

/**
 * series: array of { date, value } sorted ascending by date. `today` is the
 * most recent date's value. Values for "missing" days should be omitted from
 * the series entirely (we do not impute zeros).
 *
 * Returns a baseline summary for a single metric:
 *   { today, prev, avg7, avg30, stdev30, z, trend7, bestInN, worstInN, deltaPct }
 */
export function computeBaseline(series, { bestWorstWindow = 14 } = {}) {
  if (!series || !series.length) {
    return { today: 0, prev: null, avg7: null, avg30: null, stdev30: null,
             z: null, trend7: null, bestInN: false, worstInN: false, deltaPct: null };
  }
  const asc = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const today = asc[asc.length - 1].value;
  const prev = asc.length >= 2 ? asc[asc.length - 2].value : null;

  const last7  = asc.slice(-8, -1).map(x => x.value);   // 7 days before today
  const last30 = asc.slice(-31, -1).map(x => x.value);  // 30 days before today
  const avg7   = last7.length  ? mean(last7)  : null;
  const avg30  = last30.length ? mean(last30) : null;
  const sd30   = last30.length ? stdev(last30) : null;
  const z = (sd30 != null && sd30 > 0) ? (today - avg30) / sd30 : null;

  const trend7 = last7.length >= 2 ? trendSlope(last7) : null;

  const window = asc.slice(-bestWorstWindow); // inclusive of today
  const values = window.map(x => x.value);
  const bestInN  = values.length > 1 && today >= Math.max(...values);
  const worstInN = values.length > 1 && today <= Math.min(...values);

  const deltaPct = (avg30 != null && avg30 !== 0) ? (today - avg30) / avg30 : null;

  return { today, prev, avg7, avg30, stdev30: sd30, z, trend7, bestInN, worstInN, deltaPct };
}

/**
 * Build a compact, GPT-friendly baseline block for the prompt.
 *   company: { [metric]: baselineObject }
 *   topAgents: [{ agent, baseline: { [metric]: baselineObject } }]  (<=5)
 *   topCampaigns: [{ campaign, baseline: { [metric]: baselineObject } }] (<=8)
 */
export function buildBaselineBlock({ company = {}, topAgents = [], topCampaigns = [] }) {
  const lines = [];

  const fmtB = (b) => {
    if (!b) return 'n/a';
    const parts = [];
    parts.push(`today=${round(b.today)}`);
    if (b.avg7  != null) parts.push(`avg7=${round(b.avg7)}`);
    if (b.avg30 != null) parts.push(`avg30=${round(b.avg30)}`);
    if (b.z     != null) parts.push(`z=${round(b.z, 2)}`);
    if (b.deltaPct != null) parts.push(`Δ30=${(b.deltaPct * 100).toFixed(0)}%`);
    if (b.bestInN)  parts.push('BEST_IN_14');
    if (b.worstInN) parts.push('WORST_IN_14');
    return parts.join(' ');
  };

  lines.push('COMPANY BASELINES:');
  for (const [metric, b] of Object.entries(company)) lines.push(`  ${metric}: ${fmtB(b)}`);

  if (topAgents.length) {
    lines.push('AGENT BASELINES (top by today premium):');
    for (const a of topAgents) {
      const parts = Object.entries(a.baseline).map(([m, b]) => `${m}=${fmtB(b)}`).join('; ');
      lines.push(`  ${a.agent}: ${parts}`);
    }
  }
  if (topCampaigns.length) {
    lines.push('CAMPAIGN BASELINES (top by today spend):');
    for (const c of topCampaigns) {
      const parts = Object.entries(c.baseline).map(([m, b]) => `${m}=${fmtB(b)}`).join('; ');
      lines.push(`  ${c.campaign}: ${parts}`);
    }
  }

  return lines.join('\n');
}

function round(n, d = 2) {
  if (n == null || !isFinite(n)) return 'n/a';
  const m = Math.pow(10, d);
  return Math.round(n * m) / m;
}
