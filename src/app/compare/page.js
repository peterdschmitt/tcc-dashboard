'use client';
import { useEffect, useState, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';

const C = {
  bg: '#080b10', surface: '#0f1520', card: '#131b28', border: '#1a2538',
  text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff',
  green: '#4ade80', yellow: '#facc15', red: '#f87171',
  mono: "'JetBrains Mono','SF Mono','Fira Code',monospace",
};

function fmtDollar(n, d = 2) {
  if (n == null || isNaN(n) || n === '') return '—';
  const v = typeof n === 'number' ? n : parseFloat(n);
  if (isNaN(v)) return '—';
  return `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}
function fmtDate(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    if (isNaN(d)) return '';
    return `${d.getUTCMonth()+1}/${d.getUTCDate()}/${String(d.getUTCFullYear()).slice(2)}`;
  }
  const s = String(v);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${parseInt(iso[2])}/${parseInt(iso[3])}/${iso[1].slice(2)}`;
  const mdy = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (mdy) return `${parseInt(mdy[1])}/${parseInt(mdy[2])}/${mdy[3].slice(2)}`;
  return s;
}
const num = v => { const n = typeof v === 'number' ? v : parseFloat(String(v || '').replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; };
const normName = s => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// Days between two ISO dates (null if either missing)
function daysBetween(fromISO, toISO) {
  if (!fromISO || !toISO) return null;
  const f = new Date(fromISO + 'T00:00:00Z'), t = new Date(toISO + 'T00:00:00Z');
  if (isNaN(f) || isNaN(t)) return null;
  return Math.round((t - f) / 86400000);
}

// Excel date serial → YYYY-MM-DD
function excelToISO(v) {
  if (typeof v !== 'number') {
    const s = String(v || '');
    const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return `${iso[1]}-${iso[2].padStart(2,'0')}-${iso[3].padStart(2,'0')}`;
    return s;
  }
  const d = new Date(Math.round((v - 25569) * 86400 * 1000));
  if (isNaN(d)) return '';
  return d.toISOString().slice(0, 10);
}

// Compare two dollar amounts; return 'equal' if within $1
function diffClass(a, b) {
  const na = num(a), nb = num(b);
  if (na === 0 && nb === 0) return 'equal';
  if (Math.abs(na - nb) <= 1) return 'equal';
  return na > nb ? 'higher' : 'lower';
}

export default function ComparePage() {
  const fileRef = useRef(null);
  const [excelRows, setExcelRows] = useState(null);
  const [excelFile, setExcelFile] = useState('');
  const [system, setSystem] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');
  const [viewMode, setViewMode] = useState('diffs'); // diffs | equal | onlyExcel | onlySystem

  // Fetch system data on load
  useEffect(() => {
    setLoading(true);
    fetch('/api/commission-reconciliation?start=2020-01-01&end=2030-12-31')
      .then(r => r.ok ? r.json() : r.json().then(e => { throw new Error(e.error || 'API error'); }))
      .then(setSystem)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Parse uploaded Excel
  const handleFile = async (file) => {
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      // First row is a summary; real header is on row 1 (range: 1)
      const rows = XLSX.utils.sheet_to_json(sheet, { range: 1, defval: '', raw: true })
        .filter(r => r.Date && r.Date !== 'TOTAL');
      // Normalize column names (remove \r\n in keys)
      const normalized = rows.map(r => {
        const o = {};
        for (const [k, v] of Object.entries(r)) o[k.replace(/\s+/g, ' ').trim()] = v;
        return o;
      });
      setExcelRows(normalized);
      setExcelFile(file.name);
    } catch (err) {
      setError('Failed to parse Excel file: ' + err.message);
    }
  };

  const compared = useMemo(() => {
    if (!excelRows || !system?.rows) return null;

    const sysIndex = {};
    system.rows.forEach(r => {
      const k = normName(r.client) + '|' + normName(r.agent);
      (sysIndex[k] = sysIndex[k] || []).push(r);
    });
    const usedSys = new Set();
    const matched = [];
    const onlyExcel = [];
    for (const x of excelRows) {
      const k = normName(x.Client) + '|' + normName(x.Agent);
      const cands = (sysIndex[k] || []).filter(r => !usedSys.has(r.policyNumber));
      const m = cands[0];
      if (m) {
        usedSys.add(m.policyNumber);
        // Excel stores chargebacks as negative ($-1,806); system as positive magnitude.
        // Normalize both to positive magnitude for apples-to-apples comparison.
        const xl = {
          date: excelToISO(x.Date),
          agent: x.Agent, client: x.Client, leadSource: x['Lead Source'],
          carrier: x.Carrier, product: x.Product,
          premium: num(x.Premium), commission: num(x.Commission), gar: num(x['Gross Adv Rev']),
          carrierAdvance: num(x['Carrier Advance']),
          advanceDate: excelToISO(x['Advance Date']),
          chargeBack: Math.abs(num(x['Charge Back'])),
          chargeBackDate: excelToISO(x['Charge Back Date']),
          netRevenue: num(x['Net Revenue']),
          status: x.Status, aging: x.Aging,
        };
        const fields = ['premium', 'commission', 'gar', 'carrierAdvance', 'chargeBack'];
        // System side maps: carrierAdvance stays; chargeBack stays. GAR uses gar. netRevenue = carrierAdvance - chargeBack
        const sys = {
          submissionDate: m.submissionDate, effectiveDate: m.effectiveDate,
          premium: m.premium, commission: m.commission, gar: m.gar,
          carrierAdvance: m.carrierAdvance, chargeBack: m.chargeBack,
          advanceDate: m.advanceDate, chargeBackDate: m.chargeBackDate,
          netRevenue: m.netReceived,
        };
        const diffs = {};
        let diffCount = 0;
        fields.forEach(f => {
          const d = diffClass(xl[f], sys[f]);
          diffs[f] = d;
          if (d !== 'equal') diffCount++;
        });
        matched.push({ xl, sys, sysPolicyNumber: m.policyNumber, diffs, diffCount });
      } else {
        onlyExcel.push(x);
      }
    }
    const onlySystem = system.rows.filter(r => !usedSys.has(r.policyNumber));
    return {
      matched, onlyExcel, onlySystem,
      equal: matched.filter(m => m.diffCount === 0),
      different: matched.filter(m => m.diffCount > 0),
    };
  }, [excelRows, system]);

  const rowsToShow = useMemo(() => {
    if (!compared) return [];
    let rows;
    if (viewMode === 'diffs')      rows = compared.different;
    else if (viewMode === 'equal') rows = compared.equal;
    else if (viewMode === 'onlyExcel')  rows = compared.onlyExcel;
    else if (viewMode === 'onlySystem') rows = compared.onlySystem;
    else rows = compared.matched;
    const f = filter.trim().toLowerCase();
    if (!f) return rows;
    return rows.filter(r => {
      const src = r.xl || r || {};
      return [src.agent, src.client, src.carrier, src.product, src.Agent, src.Client, src.Carrier, src.Product]
        .some(v => (v || '').toLowerCase().includes(f));
    });
  }, [compared, viewMode, filter]);

  const diffCellStyle = (d) => ({
    padding: '6px 10px', textAlign: 'right', fontFamily: C.mono, fontSize: 11, whiteSpace: 'nowrap',
    color: d === 'higher' ? C.green : d === 'lower' ? C.red : C.text,
    background: d === 'higher' ? 'rgba(74,222,128,0.08)' : d === 'lower' ? 'rgba(248,113,113,0.08)' : 'transparent',
    fontWeight: d !== 'equal' ? 700 : 400,
  });

  const filterBtn = (mode, label, count, color) => (
    <button
      onClick={() => setViewMode(mode)}
      style={{
        background: viewMode === mode ? (color || C.accent) : 'transparent',
        color: viewMode === mode ? '#000' : C.muted,
        border: `1px solid ${viewMode === mode ? (color || C.accent) : C.border}`,
        padding: '6px 14px', borderRadius: 4, fontSize: 11, cursor: 'pointer', fontWeight: 700,
      }}
    >{label}{count != null && <span style={{ marginLeft: 6, opacity: 0.7 }}>({count})</span>}</button>
  );

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: C.mono, padding: 24 }}>
      <div style={{ maxWidth: 1800, margin: '0 auto' }}>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>
          <a href="/reconciliation" style={{ color: C.accent, textDecoration: 'none' }}>← Commission Reconciliation</a>
          <span style={{ margin: '0 8px', color: C.border }}>|</span>
          <a href="/" style={{ color: C.accent, textDecoration: 'none' }}>Dashboard</a>
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 4px 0' }}>Excel Compare</h1>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>
          Upload an external tracker (.xlsx) — each row is matched to a policy in our system by Client + Agent, and every dollar field is diffed.
        </div>

        {/* File upload */}
        <div style={{ background: C.card, border: `1px dashed ${C.border}`, borderRadius: 8, padding: 16, marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            ref={fileRef} type="file" accept=".xlsx,.xls,.csv"
            onChange={e => handleFile(e.target.files?.[0])}
            style={{ display: 'none' }}
          />
          <button onClick={() => fileRef.current?.click()}
            style={{ background: C.accent, color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            {excelRows ? 'Choose Different File' : '⇡ Upload Excel File'}
          </button>
          <div style={{ fontSize: 11, color: C.muted }}>
            {excelFile ? (<><span style={{ color: C.green, marginRight: 6 }}>✓</span> <span style={{ color: C.text }}>{excelFile}</span> · {excelRows?.length || 0} rows loaded</>)
                       : <>Expected columns: Date · Agent · Client · Carrier · Product · Premium · Commission · Gross Adv Rev · Carrier Advance · Advance Date · Charge Back · Charge Back Date · Net Revenue · Status</>}
          </div>
        </div>

        {loading && <div style={{ padding: 40, textAlign: 'center', color: C.muted }}>Loading system data…</div>}
        {error && <div style={{ padding: 20, background: 'rgba(248,113,113,0.1)', border: `1px solid ${C.red}`, borderRadius: 6, color: C.red, fontSize: 12 }}>Error: {error}</div>}

        {compared && (
          <>
            {/* KPIs */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
              {[
                { label: 'Excel Rows',     value: excelRows.length,                color: C.accent },
                { label: 'System Rows',    value: system.rows.length,              color: C.accent },
                { label: 'Matched',        value: compared.matched.length,         color: C.green },
                { label: 'Equal',          value: compared.equal.length,           color: C.green },
                { label: 'Differences',    value: compared.different.length,       color: C.yellow },
                { label: 'Only in Excel',  value: compared.onlyExcel.length,       color: compared.onlyExcel.length > 0 ? C.red : C.muted },
                { label: 'Only in System', value: compared.onlySystem.length,      color: compared.onlySystem.length > 0 ? C.yellow : C.muted },
              ].map(k => (
                <div key={k.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 16px', minWidth: 110, borderTop: `3px solid ${k.color}` }}>
                  <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8 }}>{k.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: k.color, marginTop: 4 }}>{k.value.toLocaleString()}</div>
                </div>
              ))}
            </div>

            {/* View filters */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              {filterBtn('diffs',      `Differences`,     compared.different.length,   C.yellow)}
              {filterBtn('equal',      `Matched & Equal`, compared.equal.length,       C.green)}
              {filterBtn('onlyExcel',  `Only in Excel`,   compared.onlyExcel.length,   C.red)}
              {filterBtn('onlySystem', `Only in System`,  compared.onlySystem.length,  C.accent)}
              <input type="text" placeholder="Filter by client, agent, carrier…" value={filter} onChange={e => setFilter(e.target.value)}
                style={{ flex: 1, minWidth: 220, padding: '6px 10px', background: C.card, border: `1px solid ${C.border}`, color: C.text, borderRadius: 4, fontSize: 11 }} />
            </div>

            {/* Tables per view */}
            {(viewMode === 'diffs' || viewMode === 'equal') && rowsToShow.length > 0 && (
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ background: C.surface }}>
                        <th rowSpan={2} style={{ ...thBase, textAlign: 'left' }}>Agent</th>
                        <th rowSpan={2} style={{ ...thBase, textAlign: 'left' }}>Client</th>
                        <th rowSpan={2} style={{ ...thBase, textAlign: 'left' }}>Carrier</th>
                        <th rowSpan={2} style={{ ...thBase, textAlign: 'left' }}>Product</th>
                        <th rowSpan={2} style={{ ...thBase, textAlign: 'left' }}>Submit</th>
                        <th rowSpan={2} style={{ ...thBase, textAlign: 'left' }}>Effective</th>
                        <th colSpan={2} style={{ ...thBase, textAlign: 'center', borderLeft: `2px solid ${C.border}`, color: C.accent }}>PREMIUM</th>
                        <th colSpan={2} style={{ ...thBase, textAlign: 'center', borderLeft: `2px solid ${C.border}`, color: C.accent }}>COMMISSION</th>
                        <th colSpan={2} style={{ ...thBase, textAlign: 'center', borderLeft: `2px solid ${C.border}`, color: C.accent }}>GAR</th>
                        <th colSpan={2} style={{ ...thBase, textAlign: 'center', borderLeft: `2px solid ${C.border}`, color: C.green }}>CARRIER ADVANCE</th>
                        <th colSpan={2} style={{ ...thBase, textAlign: 'center', borderLeft: `1px solid ${C.border}`, color: C.green }}>PAID DATE</th>
                        <th rowSpan={2} style={{ ...thBase, textAlign: 'right', borderLeft: `1px solid ${C.border}`, color: C.accent, fontSize: 9 }} title="Days from submission date to system paid date">DAYS<br/>Submit→Paid</th>
                        <th rowSpan={2} style={{ ...thBase, textAlign: 'right', borderLeft: `1px solid ${C.border}`, color: C.accent, fontSize: 9 }} title="Days from effective date to system paid date">DAYS<br/>Eff→Paid</th>
                        <th colSpan={2} style={{ ...thBase, textAlign: 'center', borderLeft: `2px solid ${C.border}`, color: C.red }}>CHARGE BACK</th>
                        <th colSpan={2} style={{ ...thBase, textAlign: 'center', borderLeft: `1px solid ${C.border}`, color: C.red }}>CB DATE</th>
                      </tr>
                      <tr style={{ background: C.surface }}>
                        {['Excel','System','Excel','System','Excel','System','Excel','System','Excel','System','Excel','System','Excel','System'].map((lbl, i) => (
                          <th key={i} style={{ ...thSub, borderLeft: (i % 2 === 0) ? `2px solid ${C.border}` : `1px solid ${C.border}` }}>{lbl}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rowsToShow.map((m, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                          <td style={tdBase}>{m.xl.agent}</td>
                          <td style={{ ...tdBase, color: C.accent, fontWeight: 600 }}>{m.xl.client}</td>
                          <td style={tdBase}>{m.xl.carrier}</td>
                          <td style={{ ...tdBase, color: C.muted, fontSize: 10, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.xl.product}>{m.xl.product}</td>
                          <td style={tdBase}>{fmtDate(m.xl.date)}</td>
                          <td style={{ ...tdBase, color: C.muted }}>{fmtDate(m.sys.effectiveDate)}</td>
                          <td style={{ ...diffCellStyle(m.diffs.premium), borderLeft: `2px solid ${C.border}` }}>{fmtDollar(m.xl.premium)}</td>
                          <td style={{ ...diffCellStyle(m.diffs.premium), color: C.text }}>{fmtDollar(m.sys.premium)}</td>
                          <td style={{ ...diffCellStyle(m.diffs.commission), borderLeft: `2px solid ${C.border}` }}>{fmtDollar(m.xl.commission)}</td>
                          <td style={{ ...diffCellStyle(m.diffs.commission), color: C.text }}>{fmtDollar(m.sys.commission)}</td>
                          <td style={{ ...diffCellStyle(m.diffs.gar), borderLeft: `2px solid ${C.border}` }}>{fmtDollar(m.xl.gar, 0)}</td>
                          <td style={{ ...diffCellStyle(m.diffs.gar), color: C.text }}>{fmtDollar(m.sys.gar, 0)}</td>
                          <td style={{ ...diffCellStyle(m.diffs.carrierAdvance), borderLeft: `2px solid ${C.border}` }}>{m.xl.carrierAdvance > 0 ? fmtDollar(m.xl.carrierAdvance) : '—'}</td>
                          <td style={{ ...diffCellStyle(m.diffs.carrierAdvance), color: C.text }}>{m.sys.carrierAdvance > 0 ? fmtDollar(m.sys.carrierAdvance) : '—'}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', color: C.muted, fontSize: 10, borderLeft: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>{fmtDate(m.xl.advanceDate)}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', color: C.muted, fontSize: 10, whiteSpace: 'nowrap' }}>{fmtDate(m.sys.advanceDate)}</td>
                          {(() => {
                            const dSubmit = daysBetween(m.sys.submissionDate, m.sys.advanceDate);
                            const dEff = daysBetween(m.sys.effectiveDate, m.sys.advanceDate);
                            const dColor = d => d == null ? C.muted : d <= 14 ? C.green : d <= 30 ? C.yellow : C.red;
                            return (
                              <>
                                <td style={{ padding: '6px 10px', textAlign: 'right', borderLeft: `1px solid ${C.border}`, color: dColor(dSubmit), fontFamily: C.mono, fontWeight: 600, fontSize: 11 }}>{dSubmit == null ? '—' : `${dSubmit}d`}</td>
                                <td style={{ padding: '6px 10px', textAlign: 'right', borderLeft: `1px solid ${C.border}`, color: dColor(dEff),    fontFamily: C.mono, fontWeight: 600, fontSize: 11 }}>{dEff == null ? '—' : `${dEff}d`}</td>
                              </>
                            );
                          })()}
                          <td style={{ ...diffCellStyle(m.diffs.chargeBack), borderLeft: `2px solid ${C.border}` }}>{m.xl.chargeBack !== 0 ? fmtDollar(m.xl.chargeBack) : '—'}</td>
                          <td style={{ ...diffCellStyle(m.diffs.chargeBack), color: C.text }}>{m.sys.chargeBack !== 0 ? fmtDollar(m.sys.chargeBack) : '—'}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', color: C.muted, fontSize: 10, borderLeft: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>{fmtDate(m.xl.chargeBackDate)}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', color: C.muted, fontSize: 10, whiteSpace: 'nowrap' }}>{fmtDate(m.sys.chargeBackDate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {viewMode === 'onlyExcel' && (
              <SimpleTable title="Policies in Excel but not in System" rows={rowsToShow} columns={[
                { k: 'Date', label: 'Date', fmt: fmtDate },
                { k: 'Agent', label: 'Agent' }, { k: 'Client', label: 'Client', highlight: true },
                { k: 'Carrier', label: 'Carrier' }, { k: 'Product', label: 'Product' },
                { k: 'Premium', label: 'Premium', fmt: v => fmtDollar(v) },
                { k: 'Carrier Advance', label: 'Carrier Adv', fmt: v => fmtDollar(v) },
                { k: 'Status', label: 'Status' },
              ]} />
            )}

            {viewMode === 'onlySystem' && (
              <SimpleTable title="Policies in System but not in Excel" rows={rowsToShow} columns={[
                { k: 'submissionDate', label: 'Submit', fmt: fmtDate },
                { k: 'agent', label: 'Agent' }, { k: 'client', label: 'Client', highlight: true },
                { k: 'carrier', label: 'Carrier' }, { k: 'product', label: 'Product' },
                { k: 'policyNumber', label: 'Policy #' },
                { k: 'premium', label: 'Premium', fmt: v => fmtDollar(v) },
                { k: 'carrierAdvance', label: 'Carrier Adv', fmt: v => v > 0 ? fmtDollar(v) : '—' },
                { k: 'ledgerEntries', label: 'Entries' },
              ]} />
            )}

            {rowsToShow.length === 0 && (
              <div style={{ padding: 40, textAlign: 'center', color: C.muted, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8 }}>
                No rows in this view{filter ? ` matching "${filter}"` : ''}.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const thBase = { padding: '10px 10px', fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap', background: C.surface };
const thSub = { ...thBase, fontSize: 9, color: C.muted, textTransform: 'none', letterSpacing: 0.5, padding: '6px 10px', textAlign: 'right' };
const tdBase = { padding: '7px 10px', color: '#f0f3f9', whiteSpace: 'nowrap' };

function SimpleTable({ title, rows, columns }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}`, fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1.2 }}>
        {title} — {rows.length}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr>{columns.map(c => <th key={c.k} style={{ ...thBase, textAlign: 'left' }}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                {columns.map(c => {
                  const raw = r[c.k];
                  const val = c.fmt ? c.fmt(raw) : (raw == null || raw === '' ? '—' : raw);
                  return <td key={c.k} style={{ ...tdBase, color: c.highlight ? C.accent : C.text, fontWeight: c.highlight ? 600 : 400 }}>{val}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
