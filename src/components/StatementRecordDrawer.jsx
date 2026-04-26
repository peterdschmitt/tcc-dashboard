'use client';
import { Fragment, useEffect, useState } from 'react';
import { useStatementRecordDrawer } from '@/contexts/StatementRecordDrawerContext';

const C = {
  bg: '#0a0e16', surface: '#0f1520', card: '#131b28', border: '#1a2538',
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

function PeriodLines({ statementFile, insuredName }) {
  const [lines, setLines] = useState(null);
  const [fileId, setFileId] = useState('');
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/statement-records/lines?statementFile=${encodeURIComponent(statementFile)}&insuredName=${encodeURIComponent(insuredName)}`)
      .then(r => r.json())
      .then(j => { if (!cancelled) { setLines(j.lines || []); setFileId(j.statement?.fileId || ''); } });
    return () => { cancelled = true; };
  }, [statementFile, insuredName]);

  if (lines === null) return <div style={{ color: C.muted, padding: 12 }}>Loading line items…</div>;
  if (lines.length === 0) return <div style={{ color: C.muted, padding: 12 }}>No line items found.</div>;
  return (
    <div style={{ background: C.bg, padding: 12, borderTop: `1px solid ${C.border}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong style={{ color: C.text }}>Raw line items — {statementFile}</strong>
        {fileId && (
          <a href={`https://drive.google.com/file/d/${fileId}/view`} target="_blank" rel="noreferrer"
            style={{ color: C.accent, fontSize: 12 }}>View original PDF ↗</a>
        )}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ color: C.muted, textAlign: 'left' }}>
            <th>Type</th><th>Description</th><th>Policy #</th><th>Premium</th>
            <th>Adv %</th><th>Adv Amt</th><th>Comm Amt</th><th>Chgbk</th><th>Recov</th><th>Outstanding</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} style={{ borderTop: `1px solid ${C.border}`, color: C.text }}>
              <td>{l.transactionType}</td>
              <td>{l.description}</td>
              <td>{l.policyNumber}</td>
              <td>{fmt$(l.premium)}</td>
              <td>{l.advancePct === null ? '—' : `${l.advancePct}%`}</td>
              <td>{fmt$(l.advanceAmount)}</td>
              <td>{fmt$(l.commissionAmount)}</td>
              <td style={{ color: l.chargebackAmount > 0 ? C.red : C.text }}>{fmt$(l.chargebackAmount)}</td>
              <td>{fmt$(l.recoveryAmount)}</td>
              <td>{fmt$(l.outstandingBalance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function StatementRecordDrawer() {
  const { open, data, closeDrawer } = useStatementRecordDrawer();
  const [expanded, setExpanded] = useState(null); // Row Key
  useEffect(() => { if (!open) setExpanded(null); }, [open]);

  if (!open) return null;
  const { holder, periods, loading, error } = data;

  return (
    <>
      <div onClick={closeDrawer} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
      }} />
      <aside style={{
        position: 'fixed', top: 0, right: 0, height: '100vh', width: '65vw', minWidth: 720,
        background: C.surface, borderLeft: `1px solid ${C.border}`, color: C.text,
        zIndex: 1001, overflowY: 'auto',
      }}>
        <header style={{ padding: 16, borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{holder?.['Insured Name'] || (loading ? 'Loading…' : 'No record')}</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
              {holder ? `${holder.Policies} · ${holder.Carriers}` : ''}
            </div>
          </div>
          <button onClick={closeDrawer} style={{
            background: 'transparent', border: `1px solid ${C.border}`, color: C.text,
            padding: '4px 12px', cursor: 'pointer', borderRadius: 4,
          }}>Close ✕</button>
        </header>

        {loading && <div style={{ padding: 24, color: C.muted }}>Loading…</div>}
        {error && <div style={{ padding: 24, color: C.red }}>Error: {error}</div>}
        {!loading && !error && !holder && (
          <div style={{ padding: 24, color: C.muted }}>No carrier statements found for this customer yet.</div>
        )}

        {holder && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, padding: 16 }}>
              {[
                ['Net Total', fmt$(holder['Net Total']), C.text],
                ['Variance', fmt$(holder.Variance), varianceColor(holder.Variance)],
                ['Outstanding', fmt$(holder['Outstanding Balance']), holder['Outstanding Balance'] > 0 ? C.yellow : C.text],
                ['# Statements', String(holder['Statement Count']), C.text],
              ].map(([label, val, color]) => (
                <div key={label} style={{ background: C.card, padding: 12, borderRadius: 4, borderTop: `2px solid ${color}` }}>
                  <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase' }}>{label}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color }}>{val}</div>
                </div>
              ))}
            </div>

            <div style={{ padding: 16 }}>
              <h3 style={{ fontSize: 13, color: C.muted, textTransform: 'uppercase', margin: '0 0 8px 0' }}>
                Statement periods ({periods.length})
              </h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ color: C.muted, textAlign: 'left', borderBottom: `1px solid ${C.border}` }}>
                    <th style={{ padding: 8 }}>File</th><th>Carrier</th><th>Period</th><th>Policy #</th>
                    <th>Premium</th><th>Adv</th><th>Chgbk</th><th>Rec</th><th>Net</th><th>Lines</th>
                  </tr>
                </thead>
                <tbody>
                  {periods.map((p) => {
                    const isOpen = expanded === p['Row Key'];
                    return (
                      <Fragment key={p['Row Key']}>
                        <tr
                          onClick={() => setExpanded(isOpen ? null : p['Row Key'])}
                          style={{ borderBottom: `1px solid ${C.border}`, cursor: 'pointer',
                            background: isOpen ? 'rgba(91,159,255,0.08)' : 'transparent' }}>
                          <td style={{ padding: 8 }}>{p['Statement File']}</td>
                          <td>{p.Carrier}</td>
                          <td>{p['Statement Period']}</td>
                          <td>{p['Policy #']}</td>
                          <td>{fmt$(p.Premium)}</td>
                          <td>{fmt$(p['Advance Amount'])}</td>
                          <td style={{ color: p['Chargeback Amount'] > 0 ? C.red : C.text }}>{fmt$(p['Chargeback Amount'])}</td>
                          <td>{fmt$(p['Recovery Amount'])}</td>
                          <td style={{ color: p['Net Impact'] < 0 ? C.red : C.text }}>{fmt$(p['Net Impact'])}</td>
                          <td>{p['Line Item Count']} {isOpen ? '▼' : '▶'}</td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan={10} style={{ padding: 0 }}>
                              <PeriodLines statementFile={p['Statement File']} insuredName={p['Insured Name']} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
