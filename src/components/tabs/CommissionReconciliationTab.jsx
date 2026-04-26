'use client';
import { useState, useEffect, useMemo } from 'react';
import { C, fmtDollar } from '../shared/theme';
import { useStatementRecordDrawer } from '@/contexts/StatementRecordDrawerContext';

function compare(a, b, key) {
  const va = a?.[key], vb = b?.[key];
  if (va == null && vb == null) return 0;
  if (va == null) return 1;
  if (vb == null) return -1;
  const na = typeof va === 'number' ? va : parseFloat(va);
  const nb = typeof vb === 'number' ? vb : parseFloat(vb);
  if (!isNaN(na) && !isNaN(nb) && typeof va === 'number') return na - nb;
  return String(va).localeCompare(String(vb));
}
function SortTh({ label, field, sortKey, sortDir, onSort, align = 'left', style }) {
  const active = sortKey === field;
  return (
    <th
      onClick={() => onSort(field)}
      style={{
        padding: '8px 10px', textAlign: align, fontSize: 9, fontWeight: 700,
        color: active ? C.accent : C.muted, textTransform: 'uppercase', letterSpacing: 1,
        borderBottom: `1px solid ${C.border}`, cursor: 'pointer', userSelect: 'none',
        whiteSpace: 'nowrap', background: C.surface, ...style,
      }}
    >
      {label} <span style={{ fontSize: 8, opacity: active ? 1 : 0.3 }}>{active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
    </th>
  );
}

function fmtDateShort(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${parseInt(m)}/${parseInt(d)}/${y.slice(2)}`;
}
function downloadCSV(filename, headers, rows) {
  const esc = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [headers.map(h => esc(h.label)).join(','), ...rows.map(r => headers.map(h => esc(typeof h.get === 'function' ? h.get(r) : r[h.key])).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function CommissionReconciliationTab({ dateRange }) {
  const { openDrawer } = useStatementRecordDrawer();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortKey, setSortKey] = useState('submissionDate');
  const [sortDir, setSortDir] = useState('desc');
  const [filter, setFilter] = useState(''); // text filter
  const [viewMode, setViewMode] = useState('all'); // all | advanced | chargeback | awaiting | variance

  const start = dateRange?.start || '';
  const end = dateRange?.end || '';

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
    if (viewMode === 'advanced') rows = rows.filter(r => r.carrierAdvance > 0);
    if (viewMode === 'chargeback') rows = rows.filter(r => r.chargeBack > 0);
    if (viewMode === 'awaiting') rows = rows.filter(r => r.ledgerEntries === 0);
    if (viewMode === 'variance') rows = rows.filter(r => Math.abs(r.variance) > 1 && r.ledgerEntries > 0);
    if (filter.trim()) {
      const f = filter.toLowerCase();
      rows = rows.filter(r => [r.agent, r.client, r.policyNumber, r.carrier, r.product, r.leadSource]
        .some(v => (v || '').toLowerCase().includes(f)));
    }
    return [...rows].sort((a, b) => { const c = compare(a, b, sortKey); return sortDir === 'desc' ? -c : c; });
  }, [data, sortKey, sortDir, filter, viewMode]);

  const filteredTotals = useMemo(() => {
    return filtered.reduce((t, r) => ({
      premium: t.premium + r.premium,
      commission: t.commission + r.commission,
      gar: t.gar + r.gar,
      advance: t.advance + r.carrierAdvance,
      chargeback: t.chargeback + r.chargeBack,
      net: t.net + r.netReceived,
      variance: t.variance + r.variance,
    }), { premium: 0, commission: 0, gar: 0, advance: 0, chargeback: 0, net: 0, variance: 0 });
  }, [filtered]);

  const exportCSV = () => {
    downloadCSV(
      `commission-reconciliation_${start}_${end}.csv`,
      [
        { label: 'Submission Date',  key: 'submissionDate' },
        { label: 'Effective Date',   key: 'effectiveDate' },
        { label: 'Agent',            key: 'agent' },
        { label: 'Client',           key: 'client' },
        { label: 'Lead Source',      key: 'leadSource' },
        { label: 'Carrier',          key: 'carrier' },
        { label: 'Product',          key: 'product' },
        { label: 'Policy #',         key: 'policyNumber' },
        { label: 'Premium',          key: 'premium' },
        { label: 'Commission',       key: 'commission' },
        { label: 'Gross Adv Rev',    key: 'gar' },
        { label: 'Carrier Advance',  key: 'carrierAdvance' },
        { label: 'Advance Date',     key: 'advanceDate' },
        { label: 'Charge Back',      key: 'chargeBack' },
        { label: 'Charge Back Date', key: 'chargeBackDate' },
        { label: 'Net Received',     key: 'netReceived' },
        { label: 'Variance',         key: 'variance' },
      ],
      filtered,
    );
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: C.muted }}>Loading reconciliation data…</div>;
  if (error) return <div style={{ padding: 40, textAlign: 'center', color: C.red }}>Error: {error}</div>;
  if (!data) return null;

  const kpi = (label, value, color, sub) => (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px', minWidth: 110, borderTop: `3px solid ${color || C.accent}` }}>
      <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: color || C.text, fontFamily: C.mono, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  );

  const filterBtn = (mode, label, count) => (
    <button
      onClick={() => setViewMode(mode)}
      style={{
        background: viewMode === mode ? C.accent : 'transparent',
        color: viewMode === mode ? '#fff' : C.muted,
        border: `1px solid ${viewMode === mode ? C.accent : C.border}`,
        padding: '6px 12px', borderRadius: 4, fontSize: 11, cursor: 'pointer', fontWeight: 600,
      }}
    >{label}{count != null && <span style={{ marginLeft: 6, opacity: 0.7 }}>({count})</span>}</button>
  );

  return (
    <div>
      {/* Summary KPIs */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {kpi('Policies', data.counts.total.toLocaleString(), C.accent, `${data.counts.awaiting} awaiting`)}
        {kpi('Premium', fmtDollar(data.totals.premium), C.accent)}
        {kpi('Expected Commission', fmtDollar(data.totals.commission), C.accent)}
        {kpi('Gross Adv Rev', fmtDollar(data.totals.gar), C.accent)}
        {kpi('Carrier Advance', fmtDollar(data.totals.advance), C.green, `${data.counts.withAdvance} policies`)}
        {kpi('Charge Back', fmtDollar(data.totals.chargeback), C.red, `${data.counts.withChargeback} policies`)}
        {kpi('Net Received', fmtDollar(data.totals.net), data.totals.net >= 0 ? C.green : C.red)}
        {kpi('Variance vs Expected', fmtDollar(data.totals.variance), data.totals.variance >= 0 ? C.green : C.red, 'net - commission')}
        {kpi('Orphan Entries', data.counts.orphans.toLocaleString(), data.counts.orphans > 0 ? C.yellow : C.muted, 'ledger w/o policy')}
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {filterBtn('all', 'All', data.counts.total)}
        {filterBtn('advanced', 'Has Advance', data.counts.withAdvance)}
        {filterBtn('chargeback', 'Has Chargeback', data.counts.withChargeback)}
        {filterBtn('awaiting', 'Awaiting Statement', data.counts.awaiting)}
        {filterBtn('variance', 'Variance', null)}
        <input
          type="text" placeholder="Filter by agent, client, carrier, policy…" value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{ flex: 1, minWidth: 200, padding: '6px 10px', background: C.card, border: `1px solid ${C.border}`, color: C.text, borderRadius: 4, fontSize: 11 }}
        />
        <button
          onClick={exportCSV}
          style={{ background: C.green, color: '#000', border: 'none', padding: '6px 14px', borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
        >⇣ Export CSV</button>
      </div>

      {/* Main reconciliation table */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1.2 }}>
            Commission Reconciliation — {filtered.length.toLocaleString()} {filtered.length === 1 ? 'policy' : 'policies'}
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: C.mono }}>
            <thead>
              <tr>
                <SortTh label="Submit"      field="submissionDate" sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
                <SortTh label="Effective"   field="effectiveDate"  sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
                <SortTh label="Agent"       field="agent"          sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
                <SortTh label="Client"      field="client"         sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
                <SortTh label="Lead"        field="leadSource"     sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
                <SortTh label="Carrier"     field="carrier"        sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
                <SortTh label="Product"     field="product"        sortKey={sortKey} sortDir={sortDir} onSort={toggle} />
                <SortTh label="Premium"     field="premium"        sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right" />
                <SortTh label="Commission"  field="commission"     sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right" />
                <SortTh label="GAR"         field="gar"            sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right" />
                <SortTh label="Carrier Adv" field="carrierAdvance" sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right" style={{ borderLeft: `2px solid ${C.border}` }} />
                <SortTh label="Adv Date"    field="advanceDate"    sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right" />
                <SortTh label="Charge Back" field="chargeBack"     sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right" />
                <SortTh label="CB Date"     field="chargeBackDate" sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right" />
                <SortTh label="Net"         field="netReceived"    sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right" />
                <SortTh label="Variance"    field="variance"       sortKey={sortKey} sortDir={sortDir} onSort={toggle} align="right" />
                <th title="View carrier statement records for this customer" style={{ padding: 8, textAlign: 'center' }}>📄</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={r.policyNumber + '-' + i} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 ? 'transparent' : 'rgba(255,255,255,0.015)' }}>
                  <td style={{ padding: '6px 10px', color: C.muted }}>{fmtDateShort(r.submissionDate)}</td>
                  <td style={{ padding: '6px 10px', color: C.muted }}>{fmtDateShort(r.effectiveDate)}</td>
                  <td style={{ padding: '6px 10px', color: C.text }}>{r.agent || '—'}</td>
                  <td style={{ padding: '6px 10px', color: C.text }}>{r.client || '—'}</td>
                  <td style={{ padding: '6px 10px', color: C.muted }}>{r.leadSource || '—'}</td>
                  <td style={{ padding: '6px 10px', color: C.text, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.carrier}>{r.carrier || '—'}</td>
                  <td style={{ padding: '6px 10px', color: C.muted, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.product}>{r.product || '—'}</td>
                  <td style={{ padding: '6px 10px', color: C.text, textAlign: 'right' }}>{fmtDollar(r.premium, 2)}</td>
                  <td style={{ padding: '6px 10px', color: C.text, textAlign: 'right' }}>{fmtDollar(r.commission, 2)}</td>
                  <td style={{ padding: '6px 10px', color: C.muted, textAlign: 'right' }}>{fmtDollar(r.gar, 0)}</td>
                  <td style={{ padding: '6px 10px', color: r.carrierAdvance > 0 ? C.green : C.muted, textAlign: 'right', borderLeft: `2px solid ${C.border}`, fontWeight: r.carrierAdvance > 0 ? 700 : 400 }}>
                    {r.carrierAdvance > 0 ? fmtDollar(r.carrierAdvance, 2) : '—'}
                  </td>
                  <td style={{ padding: '6px 10px', color: C.muted, textAlign: 'right' }}>{fmtDateShort(r.advanceDate)}</td>
                  <td style={{ padding: '6px 10px', color: r.chargeBack > 0 ? C.red : C.muted, textAlign: 'right', fontWeight: r.chargeBack > 0 ? 700 : 400 }}>
                    {r.chargeBack > 0 ? fmtDollar(r.chargeBack, 2) : '—'}
                  </td>
                  <td style={{ padding: '6px 10px', color: C.muted, textAlign: 'right' }}>{fmtDateShort(r.chargeBackDate)}</td>
                  <td style={{ padding: '6px 10px', color: r.netReceived >= 0 ? C.text : C.red, textAlign: 'right', fontWeight: 700 }}>
                    {r.ledgerEntries > 0 ? fmtDollar(r.netReceived, 2) : '—'}
                  </td>
                  <td style={{ padding: '6px 10px', color: r.ledgerEntries === 0 ? C.muted : (r.variance >= 0 ? C.green : C.red), textAlign: 'right', fontWeight: 700 }}>
                    {r.ledgerEntries > 0 ? fmtDollar(r.variance, 2) : '—'}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button onClick={(e) => { e.stopPropagation(); openDrawer({ holderName: r.client, policyNumber: r.policyNumber }); }} title="View carrier statements" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 14 }}>📄</button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={16} style={{ padding: 24, textAlign: 'center', color: C.muted }}>No policies match the current filter.</td></tr>
              )}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr style={{ background: C.surface, borderTop: `2px solid ${C.border}` }}>
                  <td colSpan={7} style={{ padding: '8px 10px', color: C.accent, fontWeight: 800 }}>TOTAL ({filtered.length})</td>
                  <td style={{ padding: '8px 10px', color: C.text, fontWeight: 800, textAlign: 'right' }}>{fmtDollar(filteredTotals.premium, 2)}</td>
                  <td style={{ padding: '8px 10px', color: C.text, fontWeight: 800, textAlign: 'right' }}>{fmtDollar(filteredTotals.commission, 2)}</td>
                  <td style={{ padding: '8px 10px', color: C.muted, fontWeight: 800, textAlign: 'right' }}>{fmtDollar(filteredTotals.gar, 0)}</td>
                  <td style={{ padding: '8px 10px', color: C.green, fontWeight: 800, textAlign: 'right', borderLeft: `2px solid ${C.border}` }}>{fmtDollar(filteredTotals.advance, 2)}</td>
                  <td></td>
                  <td style={{ padding: '8px 10px', color: C.red, fontWeight: 800, textAlign: 'right' }}>{fmtDollar(filteredTotals.chargeback, 2)}</td>
                  <td></td>
                  <td style={{ padding: '8px 10px', color: filteredTotals.net >= 0 ? C.green : C.red, fontWeight: 800, textAlign: 'right' }}>{fmtDollar(filteredTotals.net, 2)}</td>
                  <td style={{ padding: '8px 10px', color: filteredTotals.variance >= 0 ? C.green : C.red, fontWeight: 800, textAlign: 'right' }}>{fmtDollar(filteredTotals.variance, 2)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Orphan ledger entries */}
      {data.orphans.length > 0 && (
        <div style={{ marginTop: 20, background: C.card, border: `1px solid ${C.yellow}`, borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}`, fontSize: 10, fontWeight: 700, color: C.yellow, textTransform: 'uppercase', letterSpacing: 1.2 }}>
            ⚠ Orphan Ledger Entries — {data.orphans.length} commission rows with no matching policy
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: C.mono }}>
              <thead>
                <tr style={{ background: C.surface }}>
                  {['Statement Date', 'Carrier', 'Agent', 'Insured', 'Policy #', 'Transaction', 'Advance', 'Chargeback', 'Commission Amt', 'Statement File'].map(h => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.orphans.map((o, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: '6px 10px', color: C.muted }}>{fmtDateShort(o.statementDate)}</td>
                    <td style={{ padding: '6px 10px', color: C.text }}>{o.carrier}</td>
                    <td style={{ padding: '6px 10px', color: C.text }}>{o.agent}</td>
                    <td style={{ padding: '6px 10px', color: C.text }}>{o.insuredName}</td>
                    <td style={{ padding: '6px 10px', color: C.text }}>{o.policyNumber || '—'}</td>
                    <td style={{ padding: '6px 10px', color: C.muted }}>{o.transactionType}</td>
                    <td style={{ padding: '6px 10px', color: o.advanceAmount > 0 ? C.green : C.muted, textAlign: 'right' }}>{o.advanceAmount > 0 ? fmtDollar(o.advanceAmount, 2) : '—'}</td>
                    <td style={{ padding: '6px 10px', color: o.chargebackAmount > 0 ? C.red : C.muted, textAlign: 'right' }}>{o.chargebackAmount > 0 ? fmtDollar(o.chargebackAmount, 2) : '—'}</td>
                    <td style={{ padding: '6px 10px', color: o.commissionAmount >= 0 ? C.green : C.red, textAlign: 'right' }}>{fmtDollar(o.commissionAmount, 2)}</td>
                    <td style={{ padding: '6px 10px', color: C.muted, fontSize: 10, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o.statementFile}>{o.statementFile}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
