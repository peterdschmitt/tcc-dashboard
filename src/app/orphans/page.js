'use client';
import { useEffect, useState, useMemo } from 'react';

const C = {
  bg: '#080b10', surface: '#0f1520', card: '#131b28', border: '#1a2538',
  text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff',
  green: '#4ade80', yellow: '#facc15', red: '#f87171',
  mono: "'JetBrains Mono','SF Mono','Fira Code',monospace",
};

function fmtDollar(n, d = 2) {
  if (n == null || isNaN(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}
function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${parseInt(m)}/${parseInt(d)}/${y.slice(2)}`;
}

export default function OrphansPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortKey, setSortKey] = useState('statementDate');
  const [sortDir, setSortDir] = useState('desc');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    fetch('/api/commission-reconciliation?start=2020-01-01&end=2030-12-31')
      .then(r => r.ok ? r.json() : r.json().then(e => { throw new Error(e.error || 'API error'); }))
      .then(d => setData(d))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const filtered = useMemo(() => {
    if (!data?.orphans) return [];
    const f = filter.trim().toLowerCase();
    let rows = f
      ? data.orphans.filter(o =>
          [o.carrier, o.agent, o.insuredName, o.policyNumber, o.transactionType, o.statementFile]
            .some(v => (v || '').toLowerCase().includes(f)))
      : data.orphans;
    return [...rows].sort((a, b) => {
      let va = a[sortKey] ?? '', vb = b[sortKey] ?? '';
      if (typeof va === 'number' && typeof vb === 'number') return sortDir === 'asc' ? va - vb : vb - va;
      const cmp = String(va).localeCompare(String(vb));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, filter, sortKey, sortDir]);

  // Group by policy # to surface duplicates
  const byPolicy = useMemo(() => {
    if (!data?.orphans) return {};
    const g = {};
    data.orphans.forEach(o => {
      const k = o.policyNumber || '(blank policy #)';
      (g[k] = g[k] || []).push(o);
    });
    return g;
  }, [data]);

  const totals = useMemo(() => {
    if (!data?.orphans) return { advances: 0, chargebacks: 0, net: 0 };
    return data.orphans.reduce((t, o) => ({
      advances: t.advances + (o.commissionAmount > 0 ? o.commissionAmount : 0),
      chargebacks: t.chargebacks + (o.commissionAmount < 0 ? Math.abs(o.commissionAmount) : 0),
      net: t.net + o.commissionAmount,
    }), { advances: 0, chargebacks: 0, net: 0 });
  }, [data]);

  const Th = ({ label, k, align = 'left' }) => {
    const active = sortKey === k;
    return (
      <th
        onClick={() => toggleSort(k)}
        style={{
          padding: '10px 12px', textAlign: align, fontSize: 10, fontWeight: 700,
          color: active ? C.accent : C.muted, textTransform: 'uppercase', letterSpacing: 1,
          borderBottom: `1px solid ${C.border}`, cursor: 'pointer', userSelect: 'none',
          whiteSpace: 'nowrap', background: C.surface,
        }}
      >
        {label} <span style={{ fontSize: 9, opacity: active ? 1 : 0.35 }}>{active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
      </th>
    );
  };

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: C.mono, padding: 24 }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>
              <a href="/" style={{ color: C.accent, textDecoration: 'none' }}>← Back to Dashboard</a>
            </div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: C.text, margin: 0, fontFamily: C.mono }}>
              Orphan Commission Entries
            </h1>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
              Carrier commission-statement rows that could not be matched to a policy in the sales tracker.
            </div>
          </div>
        </div>

        {loading && <div style={{ padding: 40, textAlign: 'center', color: C.muted }}>Loading…</div>}
        {error && <div style={{ padding: 40, textAlign: 'center', color: C.red }}>Error: {error}</div>}

        {data && (
          <>
            {/* KPIs */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
              {[
                { label: 'Orphan Entries',  value: data.counts.orphans.toLocaleString(), color: C.yellow },
                { label: 'Unique Policies', value: Object.keys(byPolicy).length,          color: C.accent },
                { label: 'Advances',        value: fmtDollar(totals.advances),            color: C.green },
                { label: 'Chargebacks',     value: `−${fmtDollar(totals.chargebacks)}`,   color: C.red },
                { label: 'Net',             value: fmtDollar(totals.net),                 color: totals.net >= 0 ? C.green : C.red },
              ].map(k => (
                <div key={k.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 18px', minWidth: 130, borderTop: `3px solid ${k.color}` }}>
                  <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 1 }}>{k.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: k.color, marginTop: 4, fontFamily: C.mono }}>{k.value}</div>
                </div>
              ))}
            </div>

            {/* Filter */}
            <input
              type="text"
              placeholder="Filter by carrier, agent, insured, policy #, file…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              style={{
                width: '100%', padding: '10px 14px', marginBottom: 16,
                background: C.card, border: `1px solid ${C.border}`, color: C.text,
                borderRadius: 6, fontSize: 12, fontFamily: C.mono,
              }}
            />

            {/* Main orphans table */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', marginBottom: 24 }}>
              <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}`, fontSize: 10, fontWeight: 700, color: C.yellow, textTransform: 'uppercase', letterSpacing: 1.2 }}>
                ⚠ {filtered.length} Orphan {filtered.length === 1 ? 'Entry' : 'Entries'}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr>
                      <Th label="Stmt Date"    k="statementDate" />
                      <Th label="Carrier"      k="carrier" />
                      <Th label="Agent"        k="agent" />
                      <Th label="Insured"      k="insuredName" />
                      <Th label="Policy #"     k="policyNumber" />
                      <Th label="Transaction"  k="transactionType" />
                      <Th label="Advance"      k="advanceAmount"   align="right" />
                      <Th label="Chargeback"   k="chargebackAmount" align="right" />
                      <Th label="Net"          k="commissionAmount" align="right" />
                      <Th label="Source File"  k="statementFile" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((o, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                        <td style={{ padding: '8px 12px', color: C.muted, whiteSpace: 'nowrap' }}>{fmtDate(o.statementDate)}</td>
                        <td style={{ padding: '8px 12px', color: C.text, whiteSpace: 'nowrap' }}>{o.carrier || '—'}</td>
                        <td style={{ padding: '8px 12px', color: C.text }}>{o.agent || '—'}</td>
                        <td style={{ padding: '8px 12px', color: C.text }}>{o.insuredName || '—'}</td>
                        <td style={{ padding: '8px 12px', color: C.accent, fontWeight: 700 }}>{o.policyNumber || '—'}</td>
                        <td style={{ padding: '8px 12px', color: C.muted }}>{o.transactionType || '—'}</td>
                        <td style={{ padding: '8px 12px', color: o.advanceAmount > 0 ? C.green : C.muted, textAlign: 'right', fontWeight: o.advanceAmount > 0 ? 700 : 400 }}>
                          {o.advanceAmount > 0 ? fmtDollar(o.advanceAmount) : '—'}
                        </td>
                        <td style={{ padding: '8px 12px', color: o.chargebackAmount > 0 ? C.red : C.muted, textAlign: 'right', fontWeight: o.chargebackAmount > 0 ? 700 : 400 }}>
                          {o.chargebackAmount > 0 ? fmtDollar(o.chargebackAmount) : '—'}
                        </td>
                        <td style={{ padding: '8px 12px', color: o.commissionAmount >= 0 ? C.green : C.red, textAlign: 'right', fontWeight: 700 }}>
                          {fmtDollar(o.commissionAmount)}
                        </td>
                        <td style={{ padding: '8px 12px', color: C.muted, fontSize: 10, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o.statementFile}>
                          {o.statementFile}
                        </td>
                      </tr>
                    ))}
                    {filtered.length === 0 && (
                      <tr><td colSpan={10} style={{ padding: 24, textAlign: 'center', color: C.muted }}>No orphans match the filter.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Grouped by policy — surfaces duplicates */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}`, fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1.2 }}>
                Grouped by Policy # — duplicates reveal double-imports
              </div>
              <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {Object.entries(byPolicy)
                  .sort((a, b) => b[1].length - a[1].length)
                  .map(([pn, entries]) => {
                    const net = entries.reduce((s, e) => s + e.commissionAmount, 0);
                    const isDup = entries.length > 1;
                    return (
                      <div key={pn} style={{ border: `1px solid ${isDup ? C.yellow : C.border}`, borderRadius: 6, overflow: 'hidden' }}>
                        <div style={{ background: C.surface, padding: '8px 12px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between' }}>
                          <div>
                            <span style={{ fontSize: 13, fontWeight: 800, color: isDup ? C.yellow : C.accent }}>{pn}</span>
                            <span style={{ fontSize: 11, color: C.muted, marginLeft: 10 }}>{entries.length} {entries.length === 1 ? 'entry' : 'entries'}</span>
                            {isDup && <span style={{ fontSize: 10, color: C.yellow, marginLeft: 8, textTransform: 'uppercase', letterSpacing: 1 }}>⚠ possible duplicate</span>}
                          </div>
                          <span style={{ fontSize: 12, color: net >= 0 ? C.green : C.red, fontWeight: 800 }}>net {fmtDollar(net)}</span>
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                          <tbody>
                            {entries.map((e, i) => (
                              <tr key={i} style={{ borderBottom: i < entries.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                                <td style={{ padding: '6px 12px', color: C.muted, width: 80 }}>{fmtDate(e.statementDate)}</td>
                                <td style={{ padding: '6px 12px', color: C.text, width: 150 }}>{e.carrier}</td>
                                <td style={{ padding: '6px 12px', color: C.text }}>{e.insuredName || '—'}</td>
                                <td style={{ padding: '6px 12px', color: C.muted }}>{e.transactionType}</td>
                                <td style={{ padding: '6px 12px', color: e.commissionAmount >= 0 ? C.green : C.red, textAlign: 'right', fontWeight: 700, width: 100 }}>
                                  {fmtDollar(e.commissionAmount)}
                                </td>
                                <td style={{ padding: '6px 12px', color: C.muted, fontSize: 10, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.statementFile}>
                                  {e.statementFile}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
