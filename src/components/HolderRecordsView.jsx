'use client';
import { useEffect, useMemo, useState } from 'react';
import { useStatementRecordDrawer } from '@/contexts/StatementRecordDrawerContext';

const C = {
  bg: '#080b10', card: '#131b28', border: '#1a2538',
  text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff',
  green: '#4ade80', yellow: '#facc15', red: '#f87171',
};

const fmt$ = (n) => (n === null || n === undefined || n === '') ? '—' :
  `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function varianceColor(v) {
  if (v === null || v === undefined || v === '') return C.muted;
  const a = Math.abs(Number(v));
  if (a <= 10) return C.green;
  if (a <= 50) return C.yellow;
  return C.red;
}

const STATUS_OPTIONS = [
  ['all', 'All'], ['variance', 'Variance ≠ 0'], ['chargebacks', 'Chargebacks'],
  ['outstanding', 'Outstanding'], ['healthy', 'Healthy'], ['unmatched', 'Unmatched'],
];

const COLUMNS = [
  { key: 'Insured Name', label: 'Holder' },
  { key: 'Policies', label: 'Policies' },
  { key: 'Carriers', label: 'Carriers' },
  { key: 'Statement Count', label: '# Stmts', align: 'right' },
  { key: 'Last Period', label: 'Last' },
  { key: 'Total Advances', label: 'Advances', align: 'right', fmt: fmt$ },
  { key: 'Total Chargebacks', label: 'Chgbks', align: 'right', fmt: fmt$ },
  { key: 'Outstanding Balance', label: 'Outstanding', align: 'right', fmt: fmt$ },
  { key: 'Net Total', label: 'Net', align: 'right', fmt: fmt$ },
  { key: 'Expected Net', label: 'Expected', align: 'right', fmt: fmt$ },
  { key: 'Variance', label: 'Variance', align: 'right', fmt: fmt$ },
  { key: 'Status', label: 'Status' },
];

export default function HolderRecordsView() {
  const { openDrawer } = useStatementRecordDrawer();
  const [holders, setHolders] = useState([]);
  const [lastRebuilt, setLastRebuilt] = useState(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [sortKey, setSortKey] = useState('Net Total');
  const [sortDir, setSortDir] = useState('desc');
  const [loading, setLoading] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  const load = async () => {
    setLoading(true);
    const params = new URLSearchParams({ search, status });
    const res = await fetch(`/api/statement-records?${params}`);
    const json = await res.json();
    setHolders(json.holders || []);
    setLastRebuilt(json.lastRebuilt);
    setLoading(false);
  };

  useEffect(() => { load(); }, [search, status]);

  const sorted = useMemo(() => {
    const arr = [...holders];
    arr.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av;
      return sortDir === 'asc'
        ? String(av || '').localeCompare(String(bv || ''))
        : String(bv || '').localeCompare(String(av || ''));
    });
    return arr;
  }, [holders, sortKey, sortDir]);

  const totals = useMemo(() => {
    return holders.reduce((acc, h) => ({
      advances: acc.advances + h['Total Advances'],
      chargebacks: acc.chargebacks + h['Total Chargebacks'],
      outstanding: acc.outstanding + h['Outstanding Balance'],
      variance: acc.variance + (h.Variance || 0),
    }), { advances: 0, chargebacks: 0, outstanding: 0, variance: 0 });
  }, [holders]);

  const rebuild = async () => {
    setRebuilding(true);
    await fetch('/api/statement-records/rebuild', { method: 'POST' });
    await load();
    setRebuilding(false);
  };

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  return (
    <div style={{ color: C.text }}>
      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 16 }}>
        {[
          ['Total Holders', String(holders.length), C.text],
          ['Total Advances', fmt$(totals.advances), C.green],
          ['Total Chargebacks', fmt$(totals.chargebacks), totals.chargebacks > 0 ? C.red : C.muted],
          ['Outstanding', fmt$(totals.outstanding), totals.outstanding > 0 ? C.yellow : C.muted],
          ['Total Variance', fmt$(totals.variance), varianceColor(totals.variance)],
        ].map(([label, val, color]) => (
          <div key={label} style={{ background: C.card, padding: 12, borderRadius: 4, borderTop: `2px solid ${color}` }}>
            <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase' }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          type="text" placeholder="Search by holder name or policy #" value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text, padding: '6px 10px', borderRadius: 4, minWidth: 280 }}
        />
        {STATUS_OPTIONS.map(([val, label]) => (
          <button key={val} onClick={() => setStatus(val)} style={{
            background: status === val ? C.accent : 'transparent',
            color: status === val ? '#fff' : C.muted,
            border: `1px solid ${status === val ? C.accent : C.border}`,
            padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12,
          }}>{label}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={rebuild} disabled={rebuilding} style={{
          background: C.card, color: C.text, border: `1px solid ${C.border}`,
          padding: '6px 12px', borderRadius: 4, cursor: rebuilding ? 'wait' : 'pointer',
        }}>{rebuilding ? 'Rebuilding…' : 'Rebuild rollups'}</button>
        {lastRebuilt && <span style={{ color: C.muted, fontSize: 11 }}>Last: {lastRebuilt}</span>}
      </div>

      {/* Table */}
      <div style={{ background: C.card, borderRadius: 4, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: C.muted, textAlign: 'left', borderBottom: `1px solid ${C.border}` }}>
              {COLUMNS.map(col => (
                <th key={col.key} onClick={() => toggleSort(col.key)} style={{
                  padding: 8, cursor: 'pointer', textAlign: col.align || 'left',
                }}>
                  {col.label}{sortKey === col.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={COLUMNS.length} style={{ padding: 16, color: C.muted, textAlign: 'center' }}>Loading…</td></tr>}
            {!loading && sorted.map(h => (
              <tr key={h['Holder Key']}
                onClick={() => openDrawer({ holderName: h['Insured Name'], policyNumber: (h.Policies || '').split(',')[0]?.trim() })}
                style={{ borderBottom: `1px solid ${C.border}`, cursor: 'pointer' }}>
                {COLUMNS.map(col => {
                  const v = h[col.key];
                  const display = col.fmt ? col.fmt(v) : (v === null || v === undefined ? '—' : String(v));
                  const color = col.key === 'Variance' ? varianceColor(v) : undefined;
                  return <td key={col.key} style={{ padding: 8, textAlign: col.align || 'left', color }}>{display}</td>;
                })}
              </tr>
            ))}
            {!loading && sorted.length === 0 && (
              <tr><td colSpan={COLUMNS.length} style={{ padding: 16, color: C.muted, textAlign: 'center' }}>No holders match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
