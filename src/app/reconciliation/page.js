'use client';
import { useEffect, useState, useMemo, Fragment } from 'react';

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
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${parseInt(m)}/${parseInt(d)}/${y.slice(2)}`;
}
function downloadCSV(filename, headers, rows) {
  const esc = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [headers.map(h => esc(h.label)).join(','),
               ...rows.map(r => headers.map(h => esc(r[h.key])).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function ReconciliationPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortKey, setSortKey] = useState('_dataFirst');
  const [sortDir, setSortDir] = useState('desc');
  const [filter, setFilter] = useState('');
  const [viewMode, setViewMode] = useState('all'); // all | advanced | chargeback | awaiting | variance
  const [start, setStart] = useState('2020-01-01');
  const [end,   setEnd]   = useState('2030-12-31');
  const [expanded, setExpanded] = useState(new Set());

  useEffect(() => {
    setLoading(true);
    fetch(`/api/commission-reconciliation?start=${start}&end=${end}`)
      .then(r => r.ok ? r.json() : r.json().then(e => { throw new Error(e.error || 'API error'); }))
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [start, end]);

  const toggle = k => { if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortKey(k); setSortDir('asc'); } };

  const filtered = useMemo(() => {
    if (!data?.rows) return [];
    let rows = data.rows;
    if (viewMode === 'advanced')   rows = rows.filter(r => r.carrierAdvance > 0);
    if (viewMode === 'chargeback') rows = rows.filter(r => r.chargeBack > 0);
    if (viewMode === 'awaiting')   rows = rows.filter(r => r.ledgerEntries === 0);
    if (viewMode === 'variance')   rows = rows.filter(r => Math.abs(r.variance) > 1 && r.ledgerEntries > 0);
    const f = filter.trim().toLowerCase();
    if (f) rows = rows.filter(r => [r.agent, r.client, r.policyNumber, r.carrier, r.product, r.leadSource]
      .some(v => (v || '').toLowerCase().includes(f)));
    return [...rows].sort((a, b) => {
      // _dataFirst: policies with ledger activity first, then by submission date desc
      if (sortKey === '_dataFirst') {
        const ea = a.ledgerEntries || 0, eb = b.ledgerEntries || 0;
        if (ea !== eb) return sortDir === 'asc' ? ea - eb : eb - ea;
        return (b.submissionDate || '').localeCompare(a.submissionDate || '');
      }
      let va = a[sortKey], vb = b[sortKey];
      if (va == null) return 1; if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return sortDir === 'asc' ? va - vb : vb - va;
      const cmp = String(va).localeCompare(String(vb));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir, filter, viewMode]);

  const tfoot = useMemo(() => filtered.reduce((t, r) => ({
    premium: t.premium + r.premium,
    commission: t.commission + r.commission,
    gar: t.gar + r.gar,
    advance: t.advance + r.carrierAdvance,
    chargeback: t.chargeback + r.chargeBack,
    net: t.net + r.netReceived,
    variance: t.variance + r.variance,
  }), { premium: 0, commission: 0, gar: 0, advance: 0, chargeback: 0, net: 0, variance: 0 }), [filtered]);

  const Th = ({ label, k, align = 'left', extra = {} }) => {
    const active = sortKey === k;
    return (
      <th onClick={() => toggle(k)} style={{
        padding: '10px 12px', textAlign: align, fontSize: 10, fontWeight: 700,
        color: active ? C.accent : C.muted, textTransform: 'uppercase', letterSpacing: 1,
        borderBottom: `1px solid ${C.border}`, cursor: 'pointer', userSelect: 'none',
        whiteSpace: 'nowrap', background: C.surface, ...extra,
      }}>
        {label} <span style={{ fontSize: 9, opacity: active ? 1 : 0.35 }}>{active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
      </th>
    );
  };

  const KPI = ({ label, value, color, sub }) => (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 16px', minWidth: 120, borderTop: `3px solid ${color || C.accent}` }}>
      <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || C.text, fontFamily: C.mono, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  );

  const filterBtn = (mode, label, count) => (
    <button onClick={() => setViewMode(mode)} style={{
      background: viewMode === mode ? C.accent : 'transparent',
      color: viewMode === mode ? '#fff' : C.muted,
      border: `1px solid ${viewMode === mode ? C.accent : C.border}`,
      padding: '6px 12px', borderRadius: 4, fontSize: 11, cursor: 'pointer', fontWeight: 600,
    }}>{label}{count != null && <span style={{ marginLeft: 6, opacity: 0.7 }}>({count})</span>}</button>
  );

  const exportCSV = () => {
    downloadCSV(
      `commission-reconciliation_${start}_${end}.csv`,
      [
        { label: 'Submission Date', key: 'submissionDate' }, { label: 'Effective Date',  key: 'effectiveDate' },
        { label: 'Agent',           key: 'agent' },          { label: 'Client',          key: 'client' },
        { label: 'Lead Source',     key: 'leadSource' },     { label: 'Carrier',         key: 'carrier' },
        { label: 'Product',         key: 'product' },        { label: 'Policy #',        key: 'policyNumber' },
        { label: 'Premium',         key: 'premium' },        { label: 'Commission',      key: 'commission' },
        { label: 'Gross Adv Rev',   key: 'gar' },            { label: 'Carrier Advance', key: 'carrierAdvance' },
        { label: 'Advance Date',    key: 'advanceDate' },    { label: 'Charge Back',     key: 'chargeBack' },
        { label: 'Charge Back Date',key: 'chargeBackDate' }, { label: 'Net Received',    key: 'netReceived' },
        { label: 'Variance',        key: 'variance' },
      ],
      filtered,
    );
  };

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: C.mono, padding: 24 }}>
      <div style={{ maxWidth: 1800, margin: '0 auto' }}>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>
          <a href="/" style={{ color: C.accent, textDecoration: 'none' }}>← Back to Dashboard</a>
          <span style={{ margin: '0 8px', color: C.border }}>|</span>
          <a href="/orphans" style={{ color: C.accent, textDecoration: 'none' }}>Orphan Entries →</a>
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: C.text, margin: '0 0 4px 0' }}>Commission Reconciliation</h1>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>
          Every policy with agent-submitted numbers next to carrier-paid numbers. Sortable, filterable, exportable.
        </div>

        {/* Date range */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 11, color: C.muted }}>From:</label>
          <input type="date" value={start} onChange={e => setStart(e.target.value)}
            style={{ padding: '6px 10px', background: C.card, border: `1px solid ${C.border}`, color: C.text, borderRadius: 4, fontSize: 11 }} />
          <label style={{ fontSize: 11, color: C.muted }}>To:</label>
          <input type="date" value={end} onChange={e => setEnd(e.target.value)}
            style={{ padding: '6px 10px', background: C.card, border: `1px solid ${C.border}`, color: C.text, borderRadius: 4, fontSize: 11 }} />
          <button onClick={() => { setStart('2020-01-01'); setEnd('2030-12-31'); }}
            style={{ padding: '6px 12px', background: 'transparent', color: C.muted, border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 11, cursor: 'pointer' }}>All Time</button>
        </div>

        {loading && <div style={{ padding: 40, textAlign: 'center', color: C.muted }}>Loading…</div>}
        {error && <div style={{ padding: 40, textAlign: 'center', color: C.red }}>Error: {error}</div>}

        {data && (
          <>
            {/* KPIs */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              <KPI label="Policies"            value={data.counts.total.toLocaleString()} color={C.accent} sub={`${data.counts.awaiting} awaiting`} />
              <KPI label="Premium"             value={fmtDollar(data.totals.premium)}     color={C.accent} />
              <KPI label="Expected Commission" value={fmtDollar(data.totals.commission)}  color={C.accent} />
              <KPI label="Gross Adv Rev"       value={fmtDollar(data.totals.gar, 0)}      color={C.accent} />
              <KPI label="Carrier Advance"     value={fmtDollar(data.totals.advance)}     color={C.green}  sub={`${data.counts.withAdvance} policies`} />
              <KPI label="Charge Back"         value={fmtDollar(data.totals.chargeback)}  color={C.red}    sub={`${data.counts.withChargeback} policies`} />
              <KPI label="Net Received"        value={fmtDollar(data.totals.net)}         color={data.totals.net >= 0 ? C.green : C.red} />
              <KPI label="Variance vs Expected" value={fmtDollar(data.totals.variance)}   color={data.totals.variance >= 0 ? C.green : C.red} sub="net - commission" />
              <KPI label="Orphans"             value={data.counts.orphans.toLocaleString()} color={data.counts.orphans > 0 ? C.yellow : C.muted} sub={<a href="/orphans" style={{ color: C.accent }}>investigate →</a>} />
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              {filterBtn('all', 'All', data.counts.total)}
              {filterBtn('advanced', 'Has Advance', data.counts.withAdvance)}
              {filterBtn('chargeback', 'Has Chargeback', data.counts.withChargeback)}
              {filterBtn('awaiting', 'Awaiting Statement', data.counts.awaiting)}
              {filterBtn('variance', 'Variance', null)}
              <input type="text" placeholder="Filter by agent, client, carrier, policy…" value={filter} onChange={e => setFilter(e.target.value)}
                style={{ flex: 1, minWidth: 220, padding: '6px 10px', background: C.card, border: `1px solid ${C.border}`, color: C.text, borderRadius: 4, fontSize: 11 }} />
              <button onClick={exportCSV} style={{ background: C.green, color: '#000', border: 'none', padding: '6px 14px', borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>⇣ Export CSV</button>
            </div>

            {/* Reconciliation table */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}`, fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1.2 }}>
                {filtered.length.toLocaleString()} {filtered.length === 1 ? 'policy' : 'policies'}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '10px 6px', width: 26, background: C.surface, borderBottom: `1px solid ${C.border}` }}></th>
                      <Th label="Submit"      k="submissionDate" />
                      <Th label="Effective"   k="effectiveDate" />
                      <Th label="Agent"       k="agent" />
                      <Th label="Client"      k="client" />
                      <Th label="Lead"        k="leadSource" />
                      <Th label="Carrier"     k="carrier" />
                      <Th label="Product"     k="product" />
                      <Th label="Policy #"    k="policyNumber" />
                      <Th label="Premium"     k="premium"        align="right" />
                      <Th label="Commission"  k="commission"     align="right" />
                      <Th label="GAR"         k="gar"            align="right" />
                      <Th label="#"           k="ledgerEntries"  align="right" extra={{ borderLeft: `2px solid ${C.border}` }} />
                      <Th label="Carrier Adv" k="carrierAdvance" align="right" />
                      <Th label="Adv Date"    k="advanceDate"    align="right" />
                      <Th label="Charge Back" k="chargeBack"     align="right" />
                      <Th label="CB Date"     k="chargeBackDate" align="right" />
                      <Th label="Net"         k="netReceived"    align="right" />
                      <Th label="Variance"    k="variance"       align="right" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r, i) => {
                      const isOpen = expanded.has(r.policyNumber);
                      const canExpand = (r.entries || []).length > 0;
                      return (
                      <Fragment key={r.policyNumber + '-group-' + i}>
                      <tr
                          onClick={() => {
                            if (!canExpand) return;
                            setExpanded(prev => { const n = new Set(prev); n.has(r.policyNumber) ? n.delete(r.policyNumber) : n.add(r.policyNumber); return n; });
                          }}
                          style={{ borderBottom: isOpen ? 'none' : `1px solid ${C.border}`, background: isOpen ? 'rgba(91,159,255,0.06)' : (i % 2 ? 'transparent' : 'rgba(255,255,255,0.015)'), cursor: canExpand ? 'pointer' : 'default' }}>
                        <td style={{ padding: '7px 6px', color: canExpand ? C.accent : C.border, textAlign: 'center', fontSize: 10 }}>{canExpand ? (isOpen ? '▾' : '▸') : ''}</td>
                        <td style={{ padding: '7px 12px', color: C.muted, whiteSpace: 'nowrap' }}>{fmtDate(r.submissionDate)}</td>
                        <td style={{ padding: '7px 12px', color: C.muted, whiteSpace: 'nowrap' }}>{fmtDate(r.effectiveDate)}</td>
                        <td style={{ padding: '7px 12px', color: C.text }}>{r.agent || '—'}</td>
                        <td style={{ padding: '7px 12px', color: C.text }}>{r.client || '—'}</td>
                        <td style={{ padding: '7px 12px', color: C.muted }}>{r.leadSource || '—'}</td>
                        <td style={{ padding: '7px 12px', color: C.text, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.carrier}>{r.carrier || '—'}</td>
                        <td style={{ padding: '7px 12px', color: C.muted, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.product}>{r.product || '—'}</td>
                        <td style={{ padding: '7px 12px', color: C.accent, fontWeight: 600, whiteSpace: 'nowrap' }}>{r.policyNumber}</td>
                        <td style={{ padding: '7px 12px', color: C.text, textAlign: 'right' }}>{fmtDollar(r.premium)}</td>
                        <td style={{ padding: '7px 12px', color: C.text, textAlign: 'right' }}>{fmtDollar(r.commission)}</td>
                        <td style={{ padding: '7px 12px', color: C.muted, textAlign: 'right' }}>{fmtDollar(r.gar, 0)}</td>
                        <td style={{ padding: '7px 12px', color: r.ledgerEntries > 0 ? C.accent : C.border, textAlign: 'right', fontWeight: 700, borderLeft: `2px solid ${C.border}` }}>
                          {r.ledgerEntries || '—'}
                        </td>
                        <td style={{ padding: '7px 12px', color: r.carrierAdvance > 0 ? C.green : (r.ledgerEntries === 0 ? C.muted : C.border), textAlign: 'right', fontWeight: r.carrierAdvance > 0 ? 700 : 400, fontStyle: r.ledgerEntries === 0 ? 'italic' : 'normal', fontSize: r.ledgerEntries === 0 ? 10 : 11 }}>
                          {r.carrierAdvance > 0 ? fmtDollar(r.carrierAdvance) : (r.ledgerEntries === 0 ? 'awaiting' : '—')}
                        </td>
                        <td style={{ padding: '7px 12px', color: C.muted, textAlign: 'right', fontSize: 10 }}>{fmtDate(r.advanceDate) || ''}</td>
                        <td style={{ padding: '7px 12px', color: r.chargeBack > 0 ? C.red : C.border, textAlign: 'right', fontWeight: r.chargeBack > 0 ? 700 : 400 }}>
                          {r.chargeBack > 0 ? fmtDollar(r.chargeBack) : ''}
                        </td>
                        <td style={{ padding: '7px 12px', color: C.muted, textAlign: 'right', fontSize: 10 }}>{fmtDate(r.chargeBackDate) || ''}</td>
                        <td style={{ padding: '7px 12px', color: r.ledgerEntries === 0 ? C.border : (r.netReceived >= 0 ? C.text : C.red), textAlign: 'right', fontWeight: 700 }}>
                          {r.ledgerEntries > 0 ? fmtDollar(r.netReceived) : ''}
                        </td>
                        <td style={{ padding: '7px 12px', color: r.ledgerEntries === 0 ? C.border : (r.variance >= 0 ? C.green : C.red), textAlign: 'right', fontWeight: 700 }}>
                          {r.ledgerEntries > 0 ? fmtDollar(r.variance) : ''}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr key={r.policyNumber + '-detail-' + i} style={{ background: 'rgba(91,159,255,0.04)', borderBottom: `1px solid ${C.border}` }}>
                          <td></td>
                          <td colSpan={18} style={{ padding: '0 12px 12px 12px' }}>
                            <div style={{ padding: '10px 14px', background: C.surface, borderRadius: 6, border: `1px solid ${C.border}` }}>
                              <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                                Ledger entries ({(r.entries || []).length}) — every payment/chargeback touching this policy
                              </div>
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                                <thead>
                                  <tr>
                                    {['Paid Date', 'Stmt Date', 'Type', 'Transaction', 'Amount', 'Source File'].map(h => (
                                      <th key={h} style={{ padding: '6px 10px', textAlign: h === 'Amount' ? 'right' : 'left', fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>{h}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {(r.entries || [])
                                    .slice()
                                    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
                                    .map((e, ei) => (
                                    <tr key={ei} style={{ borderBottom: ei < r.entries.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                                      <td style={{ padding: '6px 10px', color: C.text, whiteSpace: 'nowrap' }}>{fmtDate(e.date) || '—'}</td>
                                      <td style={{ padding: '6px 10px', color: C.muted, whiteSpace: 'nowrap' }}>{fmtDate(e.statementDate) || '—'}</td>
                                      <td style={{ padding: '6px 10px' }}>
                                        <span style={{
                                          fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 3,
                                          background: e.type === 'advance' ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)',
                                          color: e.type === 'advance' ? C.green : C.red,
                                          textTransform: 'uppercase', letterSpacing: 0.8,
                                        }}>{e.type}</span>
                                      </td>
                                      <td style={{ padding: '6px 10px', color: C.muted }}>{e.transactionType || '—'}</td>
                                      <td style={{ padding: '6px 10px', color: e.amount >= 0 ? C.green : C.red, textAlign: 'right', fontWeight: 700 }}>{fmtDollar(e.amount)}</td>
                                      <td style={{ padding: '6px 10px', color: C.muted, fontSize: 10 }} title={e.statementFile}>{e.statementFile || '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                      );
                    })}
                    {filtered.length === 0 && (
                      <tr><td colSpan={19} style={{ padding: 24, textAlign: 'center', color: C.muted }}>No policies match.</td></tr>
                    )}
                  </tbody>
                  {filtered.length > 0 && (
                    <tfoot>
                      <tr style={{ background: C.surface, borderTop: `2px solid ${C.border}` }}>
                        <td colSpan={9} style={{ padding: '10px 12px', color: C.accent, fontWeight: 800 }}>TOTAL ({filtered.length})</td>
                        <td style={{ padding: '10px 12px', color: C.text, fontWeight: 800, textAlign: 'right' }}>{fmtDollar(tfoot.premium)}</td>
                        <td style={{ padding: '10px 12px', color: C.text, fontWeight: 800, textAlign: 'right' }}>{fmtDollar(tfoot.commission)}</td>
                        <td style={{ padding: '10px 12px', color: C.muted, fontWeight: 800, textAlign: 'right' }}>{fmtDollar(tfoot.gar, 0)}</td>
                        <td style={{ padding: '10px 12px', color: C.accent, fontWeight: 800, textAlign: 'right', borderLeft: `2px solid ${C.border}` }}>{filtered.reduce((s,r)=>s+(r.ledgerEntries||0),0)}</td>
                        <td style={{ padding: '10px 12px', color: C.green, fontWeight: 800, textAlign: 'right' }}>{fmtDollar(tfoot.advance)}</td>
                        <td></td>
                        <td style={{ padding: '10px 12px', color: C.red, fontWeight: 800, textAlign: 'right' }}>{fmtDollar(tfoot.chargeback)}</td>
                        <td></td>
                        <td style={{ padding: '10px 12px', color: tfoot.net >= 0 ? C.green : C.red, fontWeight: 800, textAlign: 'right' }}>{fmtDollar(tfoot.net)}</td>
                        <td style={{ padding: '10px 12px', color: tfoot.variance >= 0 ? C.green : C.red, fontWeight: 800, textAlign: 'right' }}>{fmtDollar(tfoot.variance)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
