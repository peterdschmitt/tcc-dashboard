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

// Build one row of the Excel export from a compared-records entry
function buildExportRow(m) {
  const round = n => Math.round((n || 0) * 100) / 100;
  const dSubmit = daysBetween(m.sys?.submissionDate, m.sys?.advanceDate);
  const dEff    = daysBetween(m.sys?.effectiveDate,  m.sys?.advanceDate);
  const sourceLabel = m.source === 'onlyExcel' ? 'Tracker only (not in TCC)'
                    : m.source === 'onlySystem' ? 'TCC only (not in Manual Tracker)'
                    : 'Both';
  return {
    'Source':           sourceLabel,
    'Agent':            m.xl?.agent || m.sys?.agent || '',
    'Client':           m.xl?.client || m.sys?.client || '',
    'Carrier':          m.xl?.carrier || m.sys?.carrier || '',
    'Product':          m.xl?.product || m.sys?.product || '',
    'Submit Date':      m.xl?.date || m.sys?.submissionDate || '',
    'Effective Date':   m.sys?.effectiveDate || '',
    'Policy #':         m.sysPolicyNumber || '',

    'Premium (Tracker)':          round(m.xl?.premium),
    'Premium (TCC Sales)':        round(m.sys?.premium),
    'Premium Δ':                  round((m.xl?.premium || 0) - (m.sys?.premium || 0)),

    'Commission (Tracker)':       round(m.xl?.commission),
    'Commission (TCC Sales)':     round(m.sys?.commission),
    'Commission Δ':               round((m.xl?.commission || 0) - (m.sys?.commission || 0)),

    'GAR (Tracker)':              round(m.xl?.gar),
    'GAR (TCC Sales)':            round(m.sys?.gar),
    'GAR Δ':                      round((m.xl?.gar || 0) - (m.sys?.gar || 0)),

    'Carrier Advance (Tracker)':       round(m.xl?.carrierAdvance),
    'Carrier Advance (Carrier Stmts)': round(m.sys?.carrierAdvance),
    'Advance Δ':                       round((m.xl?.carrierAdvance || 0) - (m.sys?.carrierAdvance || 0)),

    'AnnL Spread (Tracker)': round((m.xl?.gar  || 0) - (m.xl?.carrierAdvance  || 0)),
    'AnnL Spread (TCC)':     round((m.sys?.gar || 0) - (m.sys?.carrierAdvance || 0)),

    'Paid Date (Tracker)':        m.xl?.advanceDate || '',
    'Paid Date (Carrier Stmts)':  m.sys?.advanceDate || '',
    'Days Submit→Paid':           dSubmit == null ? '' : dSubmit,
    'Days Eff→Paid':              dEff    == null ? '' : dEff,

    'Charge Back (Tracker)':       round(m.xl?.chargeBack),
    'Charge Back (Carrier Stmts)': round(m.sys?.chargeBack),
    'Charge Back Δ':               round((m.xl?.chargeBack || 0) - (m.sys?.chargeBack || 0)),

    'CB Date (Tracker)':       m.xl?.chargeBackDate || '',
    'CB Date (Carrier Stmts)': m.sys?.chargeBackDate || '',
  };
}

function downloadXLSX(compared, excelFilename) {
  const allRows = compared.all.map(buildExportRow);

  const totals = compared.all.reduce((t, m) => {
    const add = (f, side) => t[f + (side || '')] += (m[side || 'xl']?.[f] || 0);
    return {
      xlPrem: t.xlPrem + (m.xl?.premium || 0),          sysPrem: t.sysPrem + (m.sys?.premium || 0),
      xlComm: t.xlComm + (m.xl?.commission || 0),       sysComm: t.sysComm + (m.sys?.commission || 0),
      xlGar:  t.xlGar  + (m.xl?.gar || 0),              sysGar:  t.sysGar  + (m.sys?.gar || 0),
      xlAdv:  t.xlAdv  + (m.xl?.carrierAdvance || 0),   sysAdv:  t.sysAdv  + (m.sys?.carrierAdvance || 0),
      xlCb:   t.xlCb   + (m.xl?.chargeBack || 0),       sysCb:   t.sysCb   + (m.sys?.chargeBack || 0),
    };
  }, { xlPrem:0, sysPrem:0, xlComm:0, sysComm:0, xlGar:0, sysGar:0, xlAdv:0, sysAdv:0, xlCb:0, sysCb:0 });

  const round = n => Math.round((n || 0) * 100) / 100;
  const summary = [
    { Metric: 'Total records',       Value: compared.all.length },
    { Metric: 'Matched (both)',      Value: compared.matched.length },
    { Metric: 'Matched & equal',     Value: compared.equal.length },
    { Metric: 'Matched with diffs',  Value: compared.different.length },
    { Metric: 'Excel only',          Value: compared.onlyExcel.length },
    { Metric: 'System only',         Value: compared.onlySystem.length },
    { Metric: '', Value: '' },
    { Metric: 'Total Premium (Excel)',          Value: round(totals.xlPrem) },
    { Metric: 'Total Premium (System)',         Value: round(totals.sysPrem) },
    { Metric: 'Premium Δ',                      Value: round(totals.xlPrem - totals.sysPrem) },
    { Metric: '', Value: '' },
    { Metric: 'Total Commission (Excel)',       Value: round(totals.xlComm) },
    { Metric: 'Total Commission (System)',      Value: round(totals.sysComm) },
    { Metric: 'Commission Δ',                   Value: round(totals.xlComm - totals.sysComm) },
    { Metric: '', Value: '' },
    { Metric: 'Total GAR (Excel)',              Value: round(totals.xlGar) },
    { Metric: 'Total GAR (System)',             Value: round(totals.sysGar) },
    { Metric: 'GAR Δ',                          Value: round(totals.xlGar - totals.sysGar) },
    { Metric: '', Value: '' },
    { Metric: 'Total Carrier Advance (Excel)',  Value: round(totals.xlAdv) },
    { Metric: 'Total Carrier Advance (System)', Value: round(totals.sysAdv) },
    { Metric: 'Carrier Advance Δ',              Value: round(totals.xlAdv - totals.sysAdv) },
    { Metric: '', Value: '' },
    { Metric: 'Total Charge Back (Excel)',      Value: round(totals.xlCb) },
    { Metric: 'Total Charge Back (System)',     Value: round(totals.sysCb) },
    { Metric: 'Charge Back Δ',                  Value: round(totals.xlCb - totals.sysCb) },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(allRows), 'All Records');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(compared.different.map(buildExportRow)), 'Differences');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(compared.equal.map(buildExportRow)),     'Matched Equal');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(compared.onlyExcel.map(x => ({
    Date: excelToISO(x.Date), Agent: x.Agent, Client: x.Client, Carrier: x.Carrier,
    Product: x.Product, Premium: num(x.Premium), Commission: num(x.Commission),
    'Gross Adv Rev': num(x['Gross Adv Rev']), 'Carrier Advance': num(x['Carrier Advance']),
    Status: x.Status,
  }))), 'Only in Excel');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(compared.onlySystem.map(r => ({
    'Policy #': r.policyNumber, 'Submit Date': r.submissionDate, 'Effective Date': r.effectiveDate,
    Agent: r.agent, Client: r.client, Carrier: r.carrier, Product: r.product,
    Premium: r.premium, Commission: r.commission, GAR: r.gar,
    'Carrier Advance': r.carrierAdvance, 'Paid Date': r.advanceDate,
    'Charge Back': r.chargeBack, 'CB Date': r.chargeBackDate,
    'Ledger Entries': r.ledgerEntries,
  }))), 'Only in System');

  const base = excelFilename.replace(/\.[^.]+$/, '') || 'comparison';
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${base}_reconciliation_${stamp}.xlsx`);
}

export default function ComparePage() {
  const fileRef = useRef(null);
  const [excelRows, setExcelRows] = useState(null);
  const [excelFile, setExcelFile] = useState('');
  const [system, setSystem] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');
  const [viewMode, setViewMode] = useState('all'); // all | diffs | equal | onlyExcel | onlySystem
  const [allSortKey, setAllSortKey] = useState('date');
  const [allSortDir, setAllSortDir] = useState('desc');

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
          agent: m.agent, client: m.client, carrier: m.carrier, product: m.product,
          status: m.status || '',
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

    // Build a unified "all records" list — matched pairs + Excel-only + System-only,
    // all in the same {xl, sys, diffs, source} shape so a single side-by-side table can render them.
    const empty = { agent:'', client:'', carrier:'', product:'', submissionDate:'', effectiveDate:'',
      premium:0, commission:0, gar:0, carrierAdvance:0, chargeBack:0, advanceDate:'', chargeBackDate:'', netRevenue:0 };
    const allRecords = [
      ...matched.map(m => ({ ...m, source: 'matched' })),
      ...onlyExcel.map(x => ({
        xl: {
          date: excelToISO(x.Date), agent: x.Agent, client: x.Client, leadSource: x['Lead Source'],
          carrier: x.Carrier, product: x.Product,
          premium: num(x.Premium), commission: num(x.Commission), gar: num(x['Gross Adv Rev']),
          carrierAdvance: num(x['Carrier Advance']), advanceDate: excelToISO(x['Advance Date']),
          chargeBack: Math.abs(num(x['Charge Back'])), chargeBackDate: excelToISO(x['Charge Back Date']),
          netRevenue: num(x['Net Revenue']), status: x.Status,
        },
        sys: { ...empty },
        sysPolicyNumber: '',
        diffs: {}, diffCount: 0, source: 'onlyExcel',
      })),
      ...onlySystem.map(r => ({
        xl: { ...empty, date: r.submissionDate },
        sys: {
          submissionDate: r.submissionDate, effectiveDate: r.effectiveDate,
          agent: r.agent, client: r.client, carrier: r.carrier, product: r.product,
          status: r.status || '',
          premium: r.premium, commission: r.commission, gar: r.gar,
          carrierAdvance: r.carrierAdvance, chargeBack: r.chargeBack,
          advanceDate: r.advanceDate, chargeBackDate: r.chargeBackDate, netRevenue: r.netReceived,
        },
        sysPolicyNumber: r.policyNumber,
        diffs: {}, diffCount: 0, source: 'onlySystem',
      })),
    ];

    return {
      matched, onlyExcel, onlySystem, all: allRecords,
      equal: matched.filter(m => m.diffCount === 0),
      different: matched.filter(m => m.diffCount > 0),
    };
  }, [excelRows, system]);

  const rowsToShow = useMemo(() => {
    if (!compared) return [];
    let rows;
    if (viewMode === 'all')             rows = compared.all;
    else if (viewMode === 'diffs')      rows = compared.different;
    else if (viewMode === 'equal')      rows = compared.equal;
    else if (viewMode === 'onlyExcel')  rows = compared.onlyExcel;
    else if (viewMode === 'onlySystem') rows = compared.onlySystem;
    else rows = compared.matched;
    const f = filter.trim().toLowerCase();
    if (f) {
      rows = rows.filter(r => {
        const src = r.xl || r || {};
        return [src.agent, src.client, src.carrier, src.product, src.Agent, src.Client, src.Carrier, src.Product]
          .some(v => (v || '').toLowerCase().includes(f));
      });
    }
    if (viewMode === 'all') {
      const getVal = (row, key) => {
        const p = v => v ?? '';
        switch (key) {
          case 'agent':          return p(row.xl?.agent || row.sys?.agent);
          case 'client':         return p(row.xl?.client || row.sys?.client);
          case 'status':         return p(row.sys?.status || row.xl?.status);
          case 'carrier':        return p(row.xl?.carrier || row.sys?.carrier);
          case 'product':        return p(row.xl?.product || row.sys?.product);
          case 'submit':         return p(row.xl?.date || row.sys?.submissionDate);
          case 'effective':      return p(row.sys?.effectiveDate);
          case 'premium':        return (row.xl?.premium || row.sys?.premium || 0);
          case 'commission':     return (row.xl?.commission || row.sys?.commission || 0);
          case 'gar':            return (row.xl?.gar || row.sys?.gar || 0);
          case 'carrierAdvance': return (row.xl?.carrierAdvance || row.sys?.carrierAdvance || 0);
          case 'annlSpread':     return ((row.sys?.gar || row.xl?.gar || 0) - (row.sys?.carrierAdvance || row.xl?.carrierAdvance || 0));
          case 'advanceDate':    return p(row.xl?.advanceDate || row.sys?.advanceDate);
          case 'chargeBack':     return (row.xl?.chargeBack || row.sys?.chargeBack || 0);
          case 'cbDate':         return p(row.xl?.chargeBackDate || row.sys?.chargeBackDate);
          case 'source':         return p(row.source);
          default: return '';
        }
      };
      rows = [...rows].sort((a, b) => {
        const va = getVal(a, allSortKey), vb = getVal(b, allSortKey);
        const cmp = (typeof va === 'number' && typeof vb === 'number')
          ? va - vb
          : String(va).localeCompare(String(vb));
        return allSortDir === 'asc' ? cmp : -cmp;
      });
    }
    return rows;
  }, [compared, viewMode, filter, allSortKey, allSortDir]);

  const toggleSort = (key) => {
    if (allSortKey === key) setAllSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setAllSortKey(key); setAllSortDir('asc'); }
  };
  const sortArrow = (key) => allSortKey === key ? (allSortDir === 'asc' ? ' ▲' : ' ▼') : ' ⇅';

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
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 4px 0' }}>Tracker Reconciliation</h1>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>
          Compare an external manual tracker (.xlsx) against our live data. Every row is matched by Client + Agent and every dollar field is diffed.
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 16, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: '10px 14px', lineHeight: 1.6 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Data sources</div>
          <div><span style={{ color: C.yellow, fontWeight: 700 }}>Manual Tracker</span> — the .xlsx file you upload (every column comes from this single spreadsheet)</div>
          <div><span style={{ color: C.accent, fontWeight: 700 }}>TCC</span> — our live Google Sheets data, which is the combination of:</div>
          <div style={{ paddingLeft: 16, color: C.muted }}>
            · <span style={{ color: C.text }}>Sales Tracker</span> (agent-entered apps) → Agent, Client, Carrier, Product, Submit Date, Effective Date, Premium, Commission, GAR<br/>
            · <span style={{ color: C.text }}>Commission Ledger</span> (parsed carrier statements) → Carrier Advance, Paid Date, Charge Back, CB Date
          </div>
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
                { label: 'Tracker Rows',    value: excelRows.length,                color: C.yellow },
                { label: 'TCC Rows',        value: system.rows.length,              color: C.accent },
                { label: 'Matched',         value: compared.matched.length,         color: C.green },
                { label: 'Equal',           value: compared.equal.length,           color: C.green },
                { label: 'Differences',     value: compared.different.length,       color: C.yellow },
                { label: 'Only in Tracker', value: compared.onlyExcel.length,       color: compared.onlyExcel.length > 0 ? C.red : C.muted },
                { label: 'Only in TCC',     value: compared.onlySystem.length,      color: compared.onlySystem.length > 0 ? C.yellow : C.muted },
              ].map(k => (
                <div key={k.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 16px', minWidth: 110, borderTop: `3px solid ${k.color}` }}>
                  <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8 }}>{k.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: k.color, marginTop: 4 }}>{k.value.toLocaleString()}</div>
                </div>
              ))}
            </div>

            {/* View filters */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              {filterBtn('all',        `All Records`,     compared.matched.length + compared.onlyExcel.length + compared.onlySystem.length, C.accent)}
              {filterBtn('diffs',      `Differences`,     compared.different.length,   C.yellow)}
              {filterBtn('equal',      `Matched & Equal`, compared.equal.length,       C.green)}
              {filterBtn('onlyExcel',  `Only in Tracker`, compared.onlyExcel.length,   C.red)}
              {filterBtn('onlySystem', `Only in TCC`,     compared.onlySystem.length,  C.accent)}
              <div style={{ flex: 1 }} />
              <button
                onClick={() => downloadXLSX(compared, excelFile)}
                style={{
                  background: C.green, color: '#000', border: 'none', padding: '8px 16px',
                  borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >⇣ Export to Excel</button>
              <input type="text" placeholder="Filter by client, agent, carrier…" value={filter} onChange={e => setFilter(e.target.value)}
                style={{ flex: 1, minWidth: 220, padding: '6px 10px', background: C.card, border: `1px solid ${C.border}`, color: C.text, borderRadius: 4, fontSize: 11 }} />
            </div>

            {/* Tables per view */}
            {(viewMode === 'all' || viewMode === 'diffs' || viewMode === 'equal') && rowsToShow.length > 0 && (
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      {(() => {
                        const sortable = viewMode === 'all';
                        const Sortable = ({ k, children, style }) => (
                          <th rowSpan={2} onClick={sortable ? () => toggleSort(k) : undefined}
                              style={{ ...thBase, textAlign: 'left', cursor: sortable ? 'pointer' : 'default', userSelect: 'none', ...style }}>
                            {children}{sortable ? sortArrow(k) : ''}
                          </th>
                        );
                        const SortableGroup = ({ k, colSpan, color, children, extraStyle }) => (
                          <th colSpan={colSpan} onClick={sortable ? () => toggleSort(k) : undefined}
                              style={{ ...thBase, textAlign: 'center', color, cursor: sortable ? 'pointer' : 'default', userSelect: 'none', ...extraStyle }}>
                            {children}{sortable ? sortArrow(k) : ''}
                          </th>
                        );
                        return (
                          <tr style={{ background: C.surface }}>
                            {sortable && <Sortable k="source" style={{ fontSize: 9 }}>SOURCE</Sortable>}
                            <Sortable k="agent">Agent</Sortable>
                            <Sortable k="client">Client</Sortable>
                            <Sortable k="status">Status</Sortable>
                            <Sortable k="carrier">Carrier</Sortable>
                            <Sortable k="product">Product</Sortable>
                            <Sortable k="submit">Submit</Sortable>
                            <Sortable k="effective">Effective</Sortable>
                            <SortableGroup k="premium"        colSpan={2} color={C.accent} extraStyle={{ borderLeft: `2px solid ${C.border}` }}>PREMIUM</SortableGroup>
                            <SortableGroup k="commission"     colSpan={2} color={C.accent} extraStyle={{ borderLeft: `2px solid ${C.border}` }}>COMMISSION</SortableGroup>
                            <SortableGroup k="gar"            colSpan={2} color={C.accent} extraStyle={{ borderLeft: `2px solid ${C.border}` }}>GAR</SortableGroup>
                            <SortableGroup k="carrierAdvance" colSpan={2} color={C.green}  extraStyle={{ borderLeft: `2px solid ${C.border}`, background: 'rgba(74,222,128,0.08)' }}>CARRIER ADVANCE</SortableGroup>
                            <SortableGroup k="annlSpread"     colSpan={2} color={C.accent} extraStyle={{ borderLeft: `2px solid ${C.border}` }}>ANNL SPREAD<br/><span style={{ fontSize: 8, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>GAR − Advance</span></SortableGroup>
                            <SortableGroup k="advanceDate"    colSpan={2} color={C.green}  extraStyle={{ borderLeft: `1px solid ${C.border}`, background: 'rgba(74,222,128,0.08)' }}>PAID DATE</SortableGroup>
                            <th rowSpan={2} style={{ ...thBase, textAlign: 'right', borderLeft: `1px solid ${C.border}`, color: C.accent, fontSize: 9 }} title="Days from submission date to system paid date">DAYS<br/>Submit→Paid</th>
                            <th rowSpan={2} style={{ ...thBase, textAlign: 'right', borderLeft: `1px solid ${C.border}`, color: C.accent, fontSize: 9 }} title="Days from effective date to system paid date">DAYS<br/>Eff→Paid</th>
                            <SortableGroup k="chargeBack"     colSpan={2} color={C.red}    extraStyle={{ borderLeft: `2px solid ${C.border}`, background: 'rgba(248,113,113,0.08)' }}>CHARGE BACK</SortableGroup>
                            <SortableGroup k="cbDate"         colSpan={2} color={C.red}    extraStyle={{ borderLeft: `1px solid ${C.border}`, background: 'rgba(248,113,113,0.08)' }}>CB DATE</SortableGroup>
                          </tr>
                        );
                      })()}
                      <tr style={{ background: C.surface }}>
                        {(() => {
                          const stmtShade = 'rgba(74,222,128,0.06)';   // green-tinted — Carrier Advance / Paid Date
                          const cbShade   = 'rgba(248,113,113,0.06)';  // red-tinted — Charge Back / CB Date
                          const subs = [
                            { lbl:'Tracker',       bg:null,       },   // Premium
                            { lbl:'TCC Sales',     bg:null,       },
                            { lbl:'Tracker',       bg:null,       },   // Commission
                            { lbl:'TCC Sales',     bg:null,       },
                            { lbl:'Tracker',       bg:null,       },   // GAR
                            { lbl:'TCC Sales',     bg:null,       },
                            { lbl:'Tracker',       bg:stmtShade,  },   // Carrier Advance
                            { lbl:'Carrier Stmts', bg:stmtShade,  },
                            { lbl:'Tracker',       bg:null,       },   // AnnL Spread
                            { lbl:'TCC',           bg:null,       },
                            { lbl:'Tracker',       bg:stmtShade,  },   // Paid Date
                            { lbl:'Carrier Stmts', bg:stmtShade,  },
                            { lbl:'Tracker',       bg:cbShade,    },   // Charge Back
                            { lbl:'Carrier Stmts', bg:cbShade,    },
                            { lbl:'Tracker',       bg:cbShade,    },   // CB Date
                            { lbl:'Carrier Stmts', bg:cbShade,    },
                          ];
                          return subs.map((s, i) => (
                            <th key={i} style={{ ...thSub, borderLeft: (i % 2 === 0) ? `2px solid ${C.border}` : `1px solid ${C.border}`, background: s.bg || C.surface }}>{s.lbl}</th>
                          ));
                        })()}
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const t = rowsToShow.reduce((a, m) => ({
                          xlPrem: a.xlPrem + (m.xl?.premium || 0),          sysPrem: a.sysPrem + (m.sys?.premium || 0),
                          xlComm: a.xlComm + (m.xl?.commission || 0),       sysComm: a.sysComm + (m.sys?.commission || 0),
                          xlGar:  a.xlGar  + (m.xl?.gar || 0),              sysGar:  a.sysGar  + (m.sys?.gar || 0),
                          xlAdv:  a.xlAdv  + (m.xl?.carrierAdvance || 0),   sysAdv:  a.sysAdv  + (m.sys?.carrierAdvance || 0),
                          xlCb:   a.xlCb   + (m.xl?.chargeBack || 0),       sysCb:   a.sysCb   + (m.sys?.chargeBack || 0),
                        }), { xlPrem:0, sysPrem:0, xlComm:0, sysComm:0, xlGar:0, sysGar:0, xlAdv:0, sysAdv:0, xlCb:0, sysCb:0 });
                        const tdTotal = { padding: '8px 10px', textAlign: 'right', fontFamily: C.mono, fontSize: 11, fontWeight: 800, color: C.accent, whiteSpace: 'nowrap', borderBottom: `2px solid ${C.accent}`, background: 'rgba(91,159,255,0.07)' };
                        const skipCols = viewMode === 'all' ? 8 : 7; // Source + Agent + Client + Status + Carrier + Product + Submit + Effective
                        return (
                          <tr>
                            <td colSpan={skipCols} style={{ padding: '8px 10px', fontSize: 10, fontWeight: 800, color: C.accent, textTransform: 'uppercase', letterSpacing: 1.2, borderBottom: `2px solid ${C.accent}`, background: 'rgba(91,159,255,0.07)' }}>
                              TOTALS ({rowsToShow.length} {rowsToShow.length === 1 ? 'row' : 'rows'})
                            </td>
                            <td style={{ ...tdTotal, borderLeft: `2px solid ${C.border}` }}>{fmtDollar(t.xlPrem)}</td>
                            <td style={tdTotal}>{fmtDollar(t.sysPrem)}</td>
                            <td style={{ ...tdTotal, borderLeft: `2px solid ${C.border}` }}>{fmtDollar(t.xlComm)}</td>
                            <td style={tdTotal}>{fmtDollar(t.sysComm)}</td>
                            <td style={{ ...tdTotal, borderLeft: `2px solid ${C.border}` }}>{fmtDollar(t.xlGar, 0)}</td>
                            <td style={tdTotal}>{fmtDollar(t.sysGar, 0)}</td>
                            <td style={{ ...tdTotal, borderLeft: `2px solid ${C.border}`, background: 'rgba(74,222,128,0.10)', color: C.green }}>{fmtDollar(t.xlAdv)}</td>
                            <td style={{ ...tdTotal, background: 'rgba(74,222,128,0.10)', color: C.green }}>{fmtDollar(t.sysAdv)}</td>
                            <td style={{ ...tdTotal, borderLeft: `2px solid ${C.border}` }}>{fmtDollar(t.xlGar - t.xlAdv, 0)}</td>
                            <td style={tdTotal}>{fmtDollar(t.sysGar - t.sysAdv, 0)}</td>
                            <td style={{ ...tdTotal, borderLeft: `1px solid ${C.border}`, background: 'rgba(74,222,128,0.10)' }}></td>
                            <td style={{ ...tdTotal, background: 'rgba(74,222,128,0.10)' }}></td>
                            <td style={{ ...tdTotal, borderLeft: `1px solid ${C.border}` }}></td>
                            <td style={tdTotal}></td>
                            <td style={{ ...tdTotal, borderLeft: `2px solid ${C.border}`, background: 'rgba(248,113,113,0.10)', color: C.red }}>{fmtDollar(t.xlCb)}</td>
                            <td style={{ ...tdTotal, background: 'rgba(248,113,113,0.10)', color: C.red }}>{fmtDollar(t.sysCb)}</td>
                            <td style={{ ...tdTotal, borderLeft: `1px solid ${C.border}`, background: 'rgba(248,113,113,0.10)' }}></td>
                            <td style={{ ...tdTotal, background: 'rgba(248,113,113,0.10)' }}></td>
                          </tr>
                        );
                      })()}
                      {rowsToShow.map((m, i) => {
                        const primary = m.xl.agent ? m.xl : m.sys; // fall back to sys for onlySystem rows
                        const showSource = viewMode === 'all';
                        const srcColor = m.source === 'onlyExcel' ? C.red : m.source === 'onlySystem' ? C.yellow : C.green;
                        const srcLabel = m.source === 'onlyExcel' ? 'Tracker only'
                                       : m.source === 'onlySystem' ? 'TCC only'
                                       : 'Both';
                        return (
                        <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                          {showSource && (
                            <td style={{ padding: '6px 8px', fontSize: 9, fontWeight: 700, color: srcColor, textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap' }}>{srcLabel}</td>
                          )}
                          <td style={tdBase}>{primary.agent || '—'}</td>
                          <td style={{ ...tdBase, color: C.accent, fontWeight: 600 }}>{primary.client || '—'}</td>
                          <td style={{ ...tdBase, color: C.muted, fontSize: 10 }} title={m.sys?.status || ''}>{(m.sys?.status || m.xl?.status || '') || '—'}</td>
                          <td style={tdBase}>{primary.carrier || '—'}</td>
                          <td style={{ ...tdBase, color: C.muted, fontSize: 10, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={primary.product}>{primary.product || '—'}</td>
                          <td style={tdBase}>{fmtDate(m.xl.date || m.sys.submissionDate)}</td>
                          <td style={{ ...tdBase, color: C.muted }}>{fmtDate(m.sys.effectiveDate)}</td>
                          <td style={{ ...diffCellStyle(m.diffs.premium), borderLeft: `2px solid ${C.border}` }}>{fmtDollar(m.xl.premium)}</td>
                          <td style={{ ...diffCellStyle(m.diffs.premium), color: C.text }}>{fmtDollar(m.sys.premium)}</td>
                          <td style={{ ...diffCellStyle(m.diffs.commission), borderLeft: `2px solid ${C.border}` }}>{fmtDollar(m.xl.commission)}</td>
                          <td style={{ ...diffCellStyle(m.diffs.commission), color: C.text }}>{fmtDollar(m.sys.commission)}</td>
                          <td style={{ ...diffCellStyle(m.diffs.gar), borderLeft: `2px solid ${C.border}` }}>{fmtDollar(m.xl.gar, 0)}</td>
                          <td style={{ ...diffCellStyle(m.diffs.gar), color: C.text }}>{fmtDollar(m.sys.gar, 0)}</td>
                          <td style={{ ...diffCellStyle(m.diffs.carrierAdvance), borderLeft: `2px solid ${C.border}`, background: m.diffs.carrierAdvance && m.diffs.carrierAdvance !== 'equal' ? undefined : 'rgba(74,222,128,0.04)' }}>{m.xl.carrierAdvance > 0 ? fmtDollar(m.xl.carrierAdvance) : '—'}</td>
                          <td style={{ ...diffCellStyle(m.diffs.carrierAdvance), color: C.text, background: m.diffs.carrierAdvance && m.diffs.carrierAdvance !== 'equal' ? undefined : 'rgba(74,222,128,0.04)' }}>{m.sys.carrierAdvance > 0 ? fmtDollar(m.sys.carrierAdvance) : '—'}</td>
                          {(() => {
                            const xlSpread  = (m.xl.gar || 0)  - (m.xl.carrierAdvance  || 0);
                            const sysSpread = (m.sys.gar || 0) - (m.sys.carrierAdvance || 0);
                            const cellStyle = v => ({
                              padding: '6px 10px', textAlign: 'right', fontFamily: C.mono, fontSize: 11,
                              color: v > 0 ? C.accent : v < 0 ? C.red : C.muted, fontWeight: 600, whiteSpace: 'nowrap',
                            });
                            return (
                              <>
                                <td style={{ ...cellStyle(xlSpread),  borderLeft: `2px solid ${C.border}` }}>{(m.xl.gar  || m.xl.carrierAdvance)  ? fmtDollar(xlSpread, 0)  : '—'}</td>
                                <td style={{ ...cellStyle(sysSpread), borderLeft: `1px solid ${C.border}` }}>{(m.sys.gar || m.sys.carrierAdvance) ? fmtDollar(sysSpread, 0) : '—'}</td>
                              </>
                            );
                          })()}
                          <td style={{ padding: '6px 10px', textAlign: 'right', color: C.muted, fontSize: 10, borderLeft: `1px solid ${C.border}`, whiteSpace: 'nowrap', background: 'rgba(74,222,128,0.04)' }}>{fmtDate(m.xl.advanceDate)}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', color: C.muted, fontSize: 10, whiteSpace: 'nowrap', background: 'rgba(74,222,128,0.04)' }}>{fmtDate(m.sys.advanceDate)}</td>
                          {(() => {
                            const dSubmit = daysBetween(m.sys.submissionDate, m.sys.advanceDate);
                            const dEff = daysBetween(m.sys.effectiveDate, m.sys.advanceDate);
                            return (
                              <>
                                <td style={{ padding: '6px 10px', textAlign: 'right', borderLeft: `1px solid ${C.border}`, color: C.text, fontFamily: C.mono, fontSize: 11 }}>{dSubmit == null ? '—' : `${dSubmit}d`}</td>
                                <td style={{ padding: '6px 10px', textAlign: 'right', borderLeft: `1px solid ${C.border}`, color: C.text, fontFamily: C.mono, fontSize: 11 }}>{dEff == null ? '—' : `${dEff}d`}</td>
                              </>
                            );
                          })()}
                          <td style={{ ...diffCellStyle(m.diffs.chargeBack), borderLeft: `2px solid ${C.border}`, background: m.diffs.chargeBack && m.diffs.chargeBack !== 'equal' ? undefined : 'rgba(248,113,113,0.04)' }}>{m.xl.chargeBack !== 0 ? fmtDollar(m.xl.chargeBack) : '—'}</td>
                          <td style={{ ...diffCellStyle(m.diffs.chargeBack), color: C.text, background: m.diffs.chargeBack && m.diffs.chargeBack !== 'equal' ? undefined : 'rgba(248,113,113,0.04)' }}>{m.sys.chargeBack !== 0 ? fmtDollar(m.sys.chargeBack) : '—'}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', color: C.muted, fontSize: 10, borderLeft: `1px solid ${C.border}`, whiteSpace: 'nowrap', background: 'rgba(248,113,113,0.04)' }}>{fmtDate(m.xl.chargeBackDate)}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', color: C.muted, fontSize: 10, whiteSpace: 'nowrap', background: 'rgba(248,113,113,0.04)' }}>{fmtDate(m.sys.chargeBackDate)}</td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {viewMode === 'onlyExcel' && (
              <SimpleTable title="Policies in the Manual Tracker but not in TCC" rows={rowsToShow} columns={[
                { k: 'Date', label: 'Date', fmt: fmtDate },
                { k: 'Agent', label: 'Agent' }, { k: 'Client', label: 'Client', highlight: true },
                { k: 'Carrier', label: 'Carrier' }, { k: 'Product', label: 'Product' },
                { k: 'Premium', label: 'Premium', fmt: v => fmtDollar(v) },
                { k: 'Carrier Advance', label: 'Carrier Adv', fmt: v => fmtDollar(v) },
                { k: 'Status', label: 'Status' },
              ]} />
            )}

            {viewMode === 'onlySystem' && (
              <SimpleTable title="Policies in TCC Sales Tracker but not in the Manual Tracker" rows={rowsToShow} columns={[
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
