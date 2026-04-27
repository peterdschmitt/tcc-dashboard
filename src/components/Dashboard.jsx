'use client';
import { useState, useMemo, useEffect } from 'react';
import PortfolioTab from './portfolio/PortfolioTab';
import CarrierSyncTab from './tabs/CarrierSyncTab';
import DataDiffTab from './tabs/DataDiffTab';
import CommissionStatementsTab from './tabs/CommissionStatementsTab';
import StatementRecordDrawer from './StatementRecordDrawer';
import { StatementRecordDrawerProvider, useStatementRecordDrawer } from '@/contexts/StatementRecordDrawerContext';
import CombinedPoliciesTab from './tabs/CombinedPoliciesTab';
import CommissionReconciliationTab from './tabs/CommissionReconciliationTab';
import AiAnalystPane from './AiAnalystPane';
import DailySummaryPage from './DailySummaryPage';
import CommissionSidebar from './CommissionSidebar';
import CommissionStatusTable from './CommissionStatusTable';
import PeriodRevenueTable from './PeriodRevenueTable';
import CarrierBalancesTable from './CarrierBalancesTable';
// VoiceAgent moved to page.js to persist across loading states
import DatePicker from './shared/DatePicker';
import DeepDiveCard from './shared/DeepDiveCard';

const C = {
  bg: '#080b10', surface: '#0f1520', card: '#131b28', border: '#1a2538',
  text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff', accentDim: '#1e3a5f',
  green: '#4ade80', greenDim: '#0a2e1a', yellow: '#facc15', yellowDim: '#2e2a0a',
  red: '#f87171', redDim: '#2e0a0a', purple: '#a855f7',
  mono: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
  sans: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
};

// Top-level navigation: one standalone "Daily Brief" pill + 5 grouped dropdowns.
// Commission Status, Period Revenue, Carrier Balances, and Commission Recon
// were absorbed as sub-tabs of Commission Statements (Stage A consolidation).
const TAB_GROUPS = [
  { id: 'daily-brief', kind: 'standalone', label: 'Daily Brief' },
  {
    id: 'operations', kind: 'group', label: 'Operations',
    items: [
      { id: 'daily', label: 'Daily Activity' },
      { id: 'publishers', label: 'Publishers' },
      { id: 'agents', label: 'Agents' },
      { id: 'carriers', label: 'Carriers' },
    ],
  },
  {
    id: 'sales', kind: 'group', label: 'Sales',
    items: [
      { id: 'combined-policies', label: 'Combined Policies' },
      { id: 'policies-detail', label: 'Policies' },
      { id: 'policy-status', label: 'Policy Status' },
      { id: 'agent-perf', label: 'Agent Performance' },
      { id: 'pnl', label: 'P&L Report' },
      { id: 'portfolio', label: 'Portfolio' },
    ],
  },
  { id: 'commission-statements', kind: 'standalone', label: 'Commission' },
  {
    id: 'admin', kind: 'group', label: 'Admin',
    items: [
      { id: 'data-diff', label: 'Data Diff' },
      { id: 'carrier-sync', label: 'Carrier Sync' },
    ],
  },
];

// Flat list (still used by code that needs to iterate every tab — voice
// targets, deep-link handling, etc.).
const TABS = TAB_GROUPS.flatMap(g => g.kind === 'standalone'
  ? [{ id: g.id, label: g.label }]
  : g.items
);

function fmt(n, d = 0) { if (n == null || isNaN(n)) return '—'; return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }
function fmtDollar(n, d = 0) { if (n == null || isNaN(n)) return '—'; return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }
function fmtPct(n) { if (n == null || isNaN(n)) return '—'; return n.toFixed(1) + '%'; }

function goalColor(actual, goal, lower = false, yellowPct = 80) {
  if (!goal || !actual) return C.muted;
  const r = lower ? goal / actual : actual / goal;
  return r >= 1 ? C.green : r >= (yellowPct / 100) ? C.yellow : C.red;
}function goalBg(actual, goal, lower = false) {
  if (!goal || !actual) return 'transparent';
  const r = lower ? goal / actual : actual / goal;
  return r >= 1 ? C.greenDim : r >= 0.8 ? C.yellowDim : C.redDim;
}
function calcDays(s, e) { if (!s || !e) return 1; return Math.max(Math.ceil((new Date(e) - new Date(s)) / 864e5) + 1, 1); }
const isPlaced = p => ['Advance Released', 'Active - In Force', 'Submitted - Pending'].includes(p.placed);

function KPICard({ label, value, goal, lowerIsBetter, subtitle }) {
  const color = goal ? goalColor(typeof value === 'string' ? parseFloat(value) : value, goal, lowerIsBetter) : C.accent;
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '16px 20px', flex: '1 1 0', minWidth: 140, borderTop: `3px solid ${color}` }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color, fontFamily: C.mono, lineHeight: 1 }}>{value}</div>
      {goal && <div style={{ fontSize: 10, color: C.muted, marginTop: 6, fontFamily: C.mono }}>Goal: {typeof goal === 'number' && goal > 1 ? fmtDollar(goal) : goal}</div>}
      {subtitle && <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>{subtitle}</div>}
    </div>
  );
}

function ProgressBar({ value, goal, lowerIsBetter = false, yellowPct = 80, width = 100 }) {
  if (!goal || !value) return <span style={{ color: C.muted, fontSize: 11, fontFamily: C.mono }}>—</span>;
  const pct = lowerIsBetter ? (goal / value) * 100 : (value / goal) * 100;
  const clamped = Math.min(pct, 100);
  const color = pct >= 100 ? C.green : pct >= yellowPct ? C.yellow : C.red;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width, height: 4, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${clamped}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.5s ease' }} />
      </div>
      <span style={{ fontSize: 10, fontFamily: C.mono, color, minWidth: 36 }}>{pct.toFixed(0)}%</span>
    </div>
  );
}

function SortableTable({ columns, rows, defaultSort, onRowClick, totalsRow }) {
  const [sortCol, setSortCol] = useState(defaultSort || null);
  const [sortDir, setSortDir] = useState('desc');
  const sorted = useMemo(() => {
    if (!sortCol) return rows;
    return [...rows].sort((a, b) => {
      let av = a[sortCol], bv = b[sortCol];
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [rows, sortCol, sortDir]);
  const toggleSort = col => { if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortCol(col); setSortDir('desc'); } };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          {columns.map(col => (
            <th key={col.key} onClick={() => col.sortable !== false && toggleSort(col.key)} style={{
              padding: '10px 12px', textAlign: col.align || 'right', fontSize: 9, fontWeight: 700, color: C.muted,
              textTransform: 'uppercase', letterSpacing: 1, borderBottom: `2px solid ${C.border}`, background: C.surface,
              whiteSpace: 'nowrap', cursor: col.sortable !== false ? 'pointer' : 'default',
              ...(col.key === sortCol ? { color: C.accent } : {}),
            }}>{col.label} {col.key === sortCol ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
          ))}
        </tr></thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={i} onClick={() => onRowClick && onRowClick(row)}
              onMouseEnter={e => e.currentTarget.style.background = '#151f30'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              style={{ cursor: onRowClick ? 'pointer' : 'default' }}>
              {columns.map(col => (
                <td key={col.key} style={{
                  padding: '10px 12px', textAlign: col.align || 'right', fontSize: 12,
                  fontFamily: col.mono !== false ? C.mono : C.sans, borderBottom: `1px solid ${C.border}`,
                  whiteSpace: 'nowrap', color: col.color ? col.color(row) : C.text, fontWeight: col.bold ? 600 : 400,
                }}>{col.render ? col.render(row) : row[col.key]}</td>
              ))}
            </tr>
          ))}
          {sorted.length === 0 && <tr><td colSpan={columns.length} style={{ padding: 24, textAlign: 'center', color: C.muted, fontSize: 13 }}>No data for this date range</td></tr>}
          {totalsRow && sorted.length > 0 && (
            <tr style={{ background: C.surface, borderTop: `2px solid ${C.accent}` }}>
              {columns.map(col => (
                <td key={col.key} style={{
                  padding: '10px 12px', textAlign: col.align || 'right', fontSize: 12,
                  fontFamily: col.mono !== false ? C.mono : C.sans, borderBottom: `1px solid ${C.border}`,
                  whiteSpace: 'nowrap', color: C.accent, fontWeight: 700,
                }}>{col.render ? col.render(totalsRow) : totalsRow[col.key]}</td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Section({ title, rightContent, children }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
      <div style={{ padding: '12px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: 10, fontWeight: 700, color: C.muted, margin: 0, textTransform: 'uppercase', letterSpacing: 1.2 }}>{title}</h3>
        {rightContent}
      </div>
      {children}
    </div>
  );
}

function Breadcrumb({ items }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
      {items.map((item, i) => (
        <span key={i}>
          {i > 0 && <span style={{ color: C.muted, margin: '0 4px' }}>›</span>}
          <span onClick={() => item.onClick && item.onClick()} style={{
            fontSize: 12, fontWeight: i === items.length - 1 ? 700 : 400,
            color: i === items.length - 1 ? C.text : C.accent, cursor: item.onClick ? 'pointer' : 'default',
          }}>{item.label}</span>
        </span>
      ))}
    </div>
  );
}

const MODAL_CONFIGS_KEYS = ['apps_submitted', 'gross_adv_revenue', 'eff_revenue', 'total_calls', 'billable_calls', 'billable_rate', 'monthly_premium', 'lead_spend', 'agent_commission', 'net_revenue', 'cpa', 'rpc', 'close_rate', 'placement_rate', 'premium_cost_ratio', 'avg_premium'];

// ─── TILE DETAIL MODAL ─────────────────────────────
function SortableModalTable({ columns, rows, totals, thStyle, tdStyle, onRowClick, sortable = false }) {
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('desc');
  const sorted = useMemo(() => {
    if (!sortable || sortCol == null) return rows;
    return [...rows].sort((a, b) => {
      const col = columns[sortCol];
      if (!col) return 0;
      let av = col.sortValue ? col.sortValue(a) : col.render(a);
      let bv = col.sortValue ? col.sortValue(b) : col.render(b);
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [rows, columns, sortCol, sortDir, sortable]);
  const toggleSort = idx => { if (sortCol === idx) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortCol(idx); setSortDir('desc'); } };
  return (
    <div style={{ overflowX: 'auto', maxHeight: '60vh', overflowY: 'auto' }}>
      <table style={{ width: 'max-content', minWidth: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead style={{ position: 'sticky', top: 0, background: C.card }}>
          <tr>{columns.map((c, i) => (
            <th key={c.label} onClick={() => sortable && toggleSort(i)} style={{
              ...thStyle,
              cursor: sortable ? 'pointer' : 'default',
              color: sortCol === i ? C.accent : thStyle.color,
            }}>{c.label} {sortCol === i ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
          ))}</tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={i} onClick={() => onRowClick && onRowClick(row)} style={{ background: i % 2 === 0 ? 'transparent' : `${C.surface}88`, cursor: onRowClick ? 'pointer' : 'default' }}
              onMouseEnter={e => { if (onRowClick) e.currentTarget.style.background = `${C.accent}15`; }}
              onMouseLeave={e => { e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : `${C.surface}88`; }}>
              {columns.map(c => {
                const color = typeof c.color === 'function' ? c.color(row) : c.color;
                return <td key={c.label} style={tdStyle(color)}>{c.render(row)}</td>;
              })}
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot>
            <tr style={{ background: C.surface, borderTop: `2px solid ${C.border}` }}>
              {totals.map((val, i) => (
                <td key={i} style={{ padding: '8px 10px', fontSize: 11, fontFamily: C.mono, fontWeight: 700, color: i === 0 ? C.muted : C.text, whiteSpace: 'nowrap' }}>{val}</td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function TileModal({ tileKey, policies, calls, pnl, goals, onClose }) {
  const [modalTab, setModalTab] = useState('campaign');
  const [drillTarget, setDrillTarget] = useState(null);
  if (!tileKey) return null;

  const placed = policies.filter(isPlaced);

  const vpw = typeof document !== 'undefined' ? parseInt(getComputedStyle(document.documentElement).getPropertyValue('--voice-panel-width') || '0') : 0;
  const overlayStyle = { position: 'fixed', top: 0, left: 0, bottom: 0, right: vpw, background: 'rgba(0,0,0,0.75)', zIndex: 2000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' };
  const modalStyle = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, minWidth: 900, maxWidth: 1400, width: '100%', position: 'relative' };
  const thStyle = { textAlign: 'left', padding: '5px 8px', color: C.muted, fontWeight: 600, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.8, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' };
  const tdStyle = (color) => ({ padding: '4px 8px', color: color || C.text, fontSize: 10, fontFamily: C.mono, borderBottom: `1px solid ${C.border}22`, whiteSpace: 'nowrap' });

  const appsRows = [...policies].sort((a, b) => b.submitDate.localeCompare(a.submitDate));

  // Match each policy to its specific call by phone number (prefer billable calls)
  const phoneCallMap = {};
  calls.forEach(c => {
    if (!c.phone) return;
    const existing = phoneCallMap[c.phone];
    if (!existing || (c.isBillable && !existing.isBillable)) phoneCallMap[c.phone] = c;
  });
  const getCallCost = r => phoneCallMap[r.phone]?.cost || 0;

  const totalPrem      = appsRows.reduce((s, r) => s + (r.premium || 0), 0);
  const totalComm      = appsRows.reduce((s, r) => s + (r.commission || 0), 0);
  const totalGAR       = appsRows.reduce((s, r) => s + (r.grossAdvancedRevenue || 0), 0);
  const totalLeadSpend = appsRows.reduce((s, r) => s + getCallCost(r), 0);
  const netRevenue     = totalGAR - totalLeadSpend - totalComm;
  const count = appsRows.length;

  const MODAL_CONFIGS = {
    apps_submitted: {
      title: 'Apps Submitted — All Applications',
      summary: `${count} applications in date range`,
      financials: [
        { label: 'Gross Adv Revenue', value: fmtDollar(totalGAR),       color: C.green },
        { label: 'Lead Cost',         value: fmtDollar(totalLeadSpend), color: C.yellow },
        { label: 'Net Revenue',       value: fmtDollar(netRevenue),     color: netRevenue >= 0 ? C.green : C.red },
      ],
      rows: appsRows,
      columns: [
        { label: 'Date',          render: r => r.submitDate,                                                                      color: C.muted },
        { label: 'Agent',         render: r => r.agent,                                                                           color: C.text },
        { label: 'Client',        render: r => `${r.firstName} ${r.lastName}`.trim(),                                             color: C.text },
        { label: 'Lead Source',   render: r => r.leadSource || '—',                                                               color: C.muted },
        { label: 'Carrier',       render: r => r.carrier,                                                                         color: C.text },
        { label: 'Product',       render: r => r.product || '—',                                                                  color: C.muted },
        { label: 'Premium',       render: r => fmtDollar(r.premium, 2),                                                           color: C.green },
        { label: 'Commission',    render: r => fmtDollar(r.commission, 2),                                                        color: C.accent },
        { label: 'Gross Adv Rev', render: r => fmtDollar(r.grossAdvancedRevenue, 0),                                             color: C.green },
        { label: 'Lead Cost',     render: r => getCallCost(r) > 0 ? fmtDollar(getCallCost(r), 2) : '—',                         color: C.yellow },
        { label: 'Net Revenue',   render: r => { const n = (r.grossAdvancedRevenue||0) - getCallCost(r) - (r.commission||0); return fmtDollar(n, 2); }, color: r => ((r.grossAdvancedRevenue||0) - getCallCost(r) - (r.commission||0)) >= 0 ? C.green : C.red },
        { label: 'Status',        render: r => r.placed,                                                                          color: r => isPlaced(r) ? C.green : C.muted },
      ],
      totals: [
        'TOTAL', `${count} apps`, '', '', '', '',
        fmtDollar(totalPrem, 2) + ` (avg ${fmtDollar(count > 0 ? totalPrem / count : 0, 2)})`,
        fmtDollar(totalComm, 2) + ` (avg ${fmtDollar(count > 0 ? totalComm / count : 0, 2)})`,
        fmtDollar(totalGAR, 0)  + ` (avg ${fmtDollar(count > 0 ? totalGAR  / count : 0, 0)})`,
        fmtDollar(totalLeadSpend, 2),
        fmtDollar(netRevenue, 2),
        `${policies.filter(isPlaced).length} placed`,
      ],
    },
    gross_adv_revenue: (() => {
      const garRows = [...policies].sort((a, b) => b.submitDate.localeCompare(a.submitDate));
      const garTotalGAR  = garRows.reduce((s, r) => s + (r.grossAdvancedRevenue || 0), 0);
      const garTotalComm = garRows.reduce((s, r) => s + (r.commission || 0), 0);
      const garTotalSpend = garRows.reduce((s, r) => s + getCallCost(r), 0);
      const garNet = garTotalGAR - garTotalSpend - garTotalComm;
      const garCount = garRows.length;
      return {
        title: 'Gross Advanced Revenue — Placed Policies',
        summary: `${garCount} placed policies in date range`,
        financials: [
          { label: 'Gross Adv Revenue', value: fmtDollar(garTotalGAR),   color: C.green },
          { label: 'Lead Cost',         value: fmtDollar(garTotalSpend), color: C.yellow },
          { label: 'Net Revenue',       value: fmtDollar(garNet),        color: garNet >= 0 ? C.green : C.red },
        ],
        rows: garRows,
        columns: [
          { label: 'Date',          render: r => r.submitDate,                                                                      color: C.muted },
          { label: 'Agent',         render: r => r.agent,                                                                           color: C.text },
          { label: 'Client',        render: r => `${r.firstName} ${r.lastName}`.trim(),                                             color: C.text },
          { label: 'Carrier',       render: r => r.carrier,                                                                         color: C.text },
          { label: 'Product',       render: r => r.product || '—',                                                                  color: C.muted },
          { label: 'Premium',       render: r => fmtDollar(r.premium, 2),                                                           color: C.green },
          { label: 'Rate',          render: r => r.commissionRate ? (r.commissionRate * 100).toFixed(0) + '%' : '—',               color: C.accent },
          { label: 'Adv Months',    render: r => r.advanceMonths ? r.advanceMonths + 'mo' : '—',                                    color: C.muted },
          { label: 'Gross Adv Rev', render: r => fmtDollar(r.grossAdvancedRevenue, 0),                                             color: C.green },
          { label: 'Commission',    render: r => fmtDollar(r.commission, 2),                                                        color: C.accent },
          { label: 'Lead Cost',     render: r => getCallCost(r) > 0 ? fmtDollar(getCallCost(r), 2) : '—',                         color: C.yellow },
          { label: 'Net Revenue',   render: r => { const n = (r.grossAdvancedRevenue||0) - getCallCost(r) - (r.commission||0); return fmtDollar(n, 2); }, color: r => ((r.grossAdvancedRevenue||0) - getCallCost(r) - (r.commission||0)) >= 0 ? C.green : C.red },
          { label: 'Status',        render: r => r.placed,                                                                          color: () => C.green },
        ],
        totals: [
          'TOTAL', `${garCount} placed`, '', '', '',
          fmtDollar(garRows.reduce((s,r) => s+(r.premium||0),0), 2) + ` (avg ${fmtDollar(garCount > 0 ? garRows.reduce((s,r)=>s+(r.premium||0),0)/garCount : 0, 2)})`,
          '', '',
          fmtDollar(garTotalGAR, 0) + ` (avg ${fmtDollar(garCount > 0 ? garTotalGAR / garCount : 0, 0)})`,
          fmtDollar(garTotalComm, 2),
          fmtDollar(garTotalSpend, 2),
          fmtDollar(garNet, 2),
          '',
        ],
      };
    })(),
    eff_revenue: (() => {
      const garRows = [...policies].sort((a, b) => b.submitDate.localeCompare(a.submitDate));
      const garTotalGAR  = garRows.reduce((s, r) => s + (r.grossAdvancedRevenue || 0), 0);
      const garTotalComm = garRows.reduce((s, r) => s + (r.commission || 0), 0);
      const garTotalSpend = garRows.reduce((s, r) => s + getCallCost(r), 0);
      const garCount = garRows.length;
      return {
        title: 'Effectuated Revenue — All Submitted',
        summary: `${garCount} applications · GAR adjusted by effectuation rate`,
        financials: [
          { label: 'Gross Adv Revenue', value: fmtDollar(garTotalGAR),   color: C.green },
          { label: 'Eff. Revenue',      value: fmtDollar(garTotalGAR * 0.70), color: C.accent },
          { label: 'Lead Cost',         value: fmtDollar(garTotalSpend), color: C.yellow },
        ],
        rows: garRows,
        columns: [
          { label: 'Date',          render: r => r.submitDate,                                                                      color: C.muted },
          { label: 'Agent',         render: r => r.agent,                                                                           color: C.text },
          { label: 'Client',        render: r => `${r.firstName} ${r.lastName}`.trim(),                                             color: C.text },
          { label: 'Carrier',       render: r => r.carrier,                                                                         color: C.text },
          { label: 'Product',       render: r => r.product || '—',                                                                  color: C.muted },
          { label: 'Premium',       render: r => fmtDollar(r.premium, 2),                                                           color: C.green },
          { label: 'Gross Adv Rev', render: r => fmtDollar(r.grossAdvancedRevenue, 0),                                             color: C.green },
          { label: 'Eff. Revenue',  render: r => fmtDollar((r.grossAdvancedRevenue||0) * 0.70, 0),                                 color: C.accent },
          { label: 'Status',        render: r => r.placed,                                                                          color: () => C.green },
        ],
        totals: [
          'TOTAL', `${garCount} placed`, '', '', '',
          fmtDollar(garRows.reduce((s,r) => s+(r.premium||0),0), 2),
          fmtDollar(garTotalGAR, 0),
          fmtDollar(garTotalGAR * 0.70, 0),
          '',
        ],
      };
    })(),
    total_calls: (() => {
      const callRows = [...calls].sort((a, b) => (b.date||'').localeCompare(a.date||'') || (b.duration||0) - (a.duration||0));
      const billable = callRows.filter(c => c.isBillable);
      const totalSpend = callRows.reduce((s, c) => s + (c.cost || 0), 0);
      const totalDur = callRows.reduce((s, c) => s + (c.duration || 0), 0);
      const fmtDur = s => { if (!s) return '0s'; const m = Math.floor(s/60); const sec = s%60; return m > 0 ? `${m}m ${sec}s` : `${sec}s`; };
      const callCount = callRows.length;
      return {
        title: 'Total Calls — All Calls',
        summary: `${callCount} calls · ${billable.length} billable · ${fmtDollar(totalSpend)} spend`,
        financials: [
          { label: 'Total Calls',    value: fmt(callCount),           color: C.text },
          { label: 'Billable Calls', value: fmt(billable.length),     color: C.green },
          { label: 'Total Spend',    value: fmtDollar(totalSpend),   color: C.yellow },
        ],
        rows: callRows,
        columns: [
          { label: 'Date',      render: r => r.date,                                                      color: C.muted },
          { label: 'Time',      render: r => r.callTime || '—',                                           color: C.muted },
          { label: 'Agent',     render: r => r.rep || '—',                                                color: C.text },
          { label: 'Campaign',  render: r => r.campaign || '—',                                           color: C.text },
          { label: 'Status',    render: r => r.callStatus || '—',                                         color: C.muted },
          { label: 'Type',      render: r => r.callType || '—',                                           color: C.muted },
          { label: 'Duration',  render: r => fmtDur(r.duration),                                          color: r => r.isBillable ? C.green : C.muted },
          { label: 'Buffer',    render: r => fmtDur(r.buffer),                                            color: () => C.muted },
          { label: 'Billable?', render: r => r.isBillable ? '✓ YES' : '✗ NO',                            color: r => r.isBillable ? C.green : C.red },
          { label: 'Cost',      render: r => r.cost > 0 ? fmtDollar(r.cost, 2) : '—',                   color: r => r.cost > 0 ? C.yellow : C.muted },
          { label: 'State',     render: r => r.state || '—',                                              color: C.muted },
          { label: 'Phone',     render: r => r.phone || '—',                                              color: C.muted },
          { label: 'Lead ID',   render: r => r.leadId || '—',                                             color: C.muted },
        ],
        totals: [
          'TOTAL', '', '', '', '', '',
          fmtDur(totalDur) + ` (avg ${fmtDur(callCount > 0 ? Math.round(totalDur/callCount) : 0)})`,
          '', `${billable.length} billable`,
          fmtDollar(totalSpend, 2),
          '', '', '',
        ],
      };
    })(),
    billable_calls: (() => {
      const billableRows = [...calls].filter(c => c.isBillable).sort((a, b) => (b.date||'').localeCompare(a.date||'') || (b.duration||0) - (a.duration||0));
      const totalSpend = billableRows.reduce((s, c) => s + (c.cost || 0), 0);
      const totalDur = billableRows.reduce((s, c) => s + (c.duration || 0), 0);
      const fmtDur = s => { if (!s) return '0s'; const m = Math.floor(s/60); const sec = s%60; return m > 0 ? `${m}m ${sec}s` : `${sec}s`; };
      const bCount = billableRows.length;
      // Build total calls per campaign (for RPC)
      const totalCallsByCamp = {};
      calls.forEach(c => {
        const key = c.campaignCode || c.campaign || 'Unknown';
        totalCallsByCamp[key] = (totalCallsByCamp[key] || 0) + 1;
      });
      // Build campaign summary
      const bycamp = {};
      billableRows.forEach(c => {
        const key = c.campaignCode || c.campaign || 'Unknown';
        if (!bycamp[key]) bycamp[key] = { campaign: key, vendor: c.vendor || '', calls: 0, spend: 0, totalDur: 0, buffer: c.buffer || 0, pricePerCall: c.pricePerCall || 0, agents: new Set(), totalCalls: totalCallsByCamp[key] || 0 };
        bycamp[key].calls++;
        bycamp[key].spend += c.cost || 0;
        bycamp[key].totalDur += c.duration || 0;
        if (c.rep) bycamp[key].agents.add(c.rep);
      });
      const campRows = Object.values(bycamp).map(r => ({ ...r, agentCount: r.agents.size })).sort((a, b) => b.spend - a.spend);
      const allCallsTotal = calls.length;
      return {
        title: 'Billable Calls — Detail',
        summary: `${bCount} billable calls · ${fmtDollar(totalSpend)} total spend`,
        tabbed: true,
        financials: [
          { label: 'Billable Calls', value: fmt(bCount),                                                       color: C.green },
          { label: 'Total Spend',    value: fmtDollar(totalSpend),                                            color: C.yellow },
          { label: 'Avg Cost/Call',  value: fmtDollar(bCount > 0 ? totalSpend / bCount : 0, 2),              color: C.text },
        ],
        campaignRows: campRows,
        campaignColumns: [
          { label: 'Campaign',    render: r => r.campaign,                                                   color: C.accent, sortValue: r => r.campaign },
          { label: 'Vendor',      render: r => r.vendor || '—',                                              color: C.muted, sortValue: r => r.vendor || '' },
          { label: 'Calls',       render: r => fmt(r.calls),                                                  color: C.green, sortValue: r => r.calls },
          { label: 'Spend',       render: r => fmtDollar(r.spend, 2),                                       color: C.yellow, sortValue: r => r.spend },
          { label: 'Avg Cost',    render: r => fmtDollar(r.calls > 0 ? r.spend / r.calls : 0, 2),           color: C.text, sortValue: r => r.calls > 0 ? r.spend / r.calls : 0 },
          { label: '$/Call',      render: r => r.pricePerCall > 0 ? fmtDollar(r.pricePerCall, 2) : '—',     color: C.muted, sortValue: r => r.pricePerCall },
          { label: 'Buffer',      render: r => r.buffer ? r.buffer + 's' : '—',                              color: C.muted, sortValue: r => r.buffer },
          { label: 'Avg Duration', render: r => fmtDur(r.calls > 0 ? Math.round(r.totalDur / r.calls) : 0), color: C.green, sortValue: r => r.calls > 0 ? r.totalDur / r.calls : 0 },
          { label: 'RPC',         render: r => r.totalCalls > 0 ? fmtDollar(r.spend / r.totalCalls, 2) : '—', color: r => { const v = r.totalCalls > 0 ? r.spend / r.totalCalls : null; return !v ? C.muted : v <= 35 ? C.green : v <= 43 ? C.yellow : C.red; }, sortValue: r => r.totalCalls > 0 ? r.spend / r.totalCalls : 0 },
          { label: 'Agents',      render: r => fmt(r.agentCount),                                            color: C.muted, sortValue: r => r.agentCount },
        ],
        campaignTotals: [
          'TOTAL', '',
          fmt(bCount),
          fmtDollar(totalSpend, 2),
          fmtDollar(bCount > 0 ? totalSpend / bCount : 0, 2),
          '', '',
          fmtDur(bCount > 0 ? Math.round(totalDur / bCount) : 0),
          allCallsTotal > 0 ? fmtDollar(totalSpend / allCallsTotal, 2) : '—',
          '',
        ],
        allRows: billableRows,
        rows: billableRows,
        columns: [
          { label: 'Date',      render: r => r.date,                                    color: C.muted, sortValue: r => r.date || '' },
          { label: 'Time',      render: r => r.callTime || '—',                         color: C.muted, sortValue: r => r.callTime || '' },
          { label: 'Agent',     render: r => r.rep || '—',                              color: C.text, sortValue: r => r.rep || '' },
          { label: 'Campaign',  render: r => r.campaign || '—',                         color: C.text, sortValue: r => r.campaign || '' },
          { label: 'Status',    render: r => r.callStatus || '—',                       color: C.muted, sortValue: r => r.callStatus || '' },
          { label: 'Type',      render: r => r.callType || '—',                         color: C.muted, sortValue: r => r.callType || '' },
          { label: 'Duration',  render: r => fmtDur(r.duration),                        color: () => C.green, sortValue: r => r.duration || 0 },
          { label: 'Buffer',    render: r => fmtDur(r.buffer),                          color: () => C.muted, sortValue: r => r.buffer || 0 },
          { label: 'Cost',      render: r => fmtDollar(r.cost, 2),                      color: () => C.yellow, sortValue: r => r.cost || 0 },
          { label: 'State',     render: r => r.state || '—',                            color: C.muted, sortValue: r => r.state || '' },
          { label: 'Phone',     render: r => r.phone || '—',                            color: C.muted, sortValue: r => r.phone || '' },
          { label: 'Lead ID',   render: r => r.leadId || '—',                           color: C.muted, sortValue: r => r.leadId || '' },
        ],
        totals: [
          'TOTAL', '', '', '', '', '',
          fmtDur(totalDur) + ` (avg ${fmtDur(bCount > 0 ? Math.round(totalDur/bCount) : 0)})`,
          '',
          fmtDollar(totalSpend, 2) + ` (avg ${fmtDollar(bCount > 0 ? totalSpend/bCount : 0, 2)})`,
          '', '', '',
        ],
      };
    })(),
    billable_rate: (() => {
      // Break down by campaign
      const bycamp = {};
      calls.forEach(c => {
        const key = c.campaignCode || c.campaign || 'Unknown';
        if (!bycamp[key]) bycamp[key] = { campaign: key, vendor: c.vendor || '', total: 0, billable: 0, spend: 0, buffer: c.buffer || 0, pricePerCall: c.pricePerCall || 0 };
        bycamp[key].total++;
        if (c.isBillable) { bycamp[key].billable++; bycamp[key].spend += c.cost || 0; }
      });
      const campRows = Object.values(bycamp).sort((a, b) => {
        const rA = a.total > 0 ? a.billable / a.total : 0;
        const rB = b.total > 0 ? b.billable / b.total : 0;
        return rA - rB; // worst rate first
      });
      const totalCalls = calls.length;
      const totalBillable = calls.filter(c => c.isBillable).length;
      const overallRate = totalCalls > 0 ? totalBillable / totalCalls * 100 : 0;
      return {
        title: 'Billable Rate — By Campaign',
        summary: `${totalBillable} billable of ${totalCalls} total calls · ${fmtPct(overallRate)} overall`,
        financials: [
          { label: 'Total Calls',    value: fmt(totalCalls),           color: C.text },
          { label: 'Billable Calls', value: fmt(totalBillable),        color: C.green },
          { label: 'Billable Rate',  value: fmtPct(overallRate),       color: overallRate >= 65 ? C.green : overallRate >= 52 ? C.yellow : C.red },
        ],
        rows: campRows,
        columns: [
          { label: 'Campaign',      render: r => r.campaign,                                                            color: C.text },
          { label: 'Vendor',        render: r => r.vendor || '—',                                                       color: C.muted },
          { label: 'Buffer',        render: r => r.buffer ? r.buffer + 's' : '—',                                       color: C.muted },
          { label: '$/Call',        render: r => r.pricePerCall > 0 ? fmtDollar(r.pricePerCall, 2) : '—',              color: C.muted },
          { label: 'Total Calls',   render: r => fmt(r.total),                                                          color: C.text },
          { label: 'Billable',      render: r => fmt(r.billable),                                                       color: C.green },
          { label: 'Non-Billable',  render: r => fmt(r.total - r.billable),                                             color: C.red },
          { label: 'Bill Rate',     render: r => r.total > 0 ? fmtPct(r.billable / r.total * 100) : '—',               color: r => { const rt = r.total > 0 ? r.billable/r.total*100 : 0; return rt >= 65 ? C.green : rt >= 52 ? C.yellow : C.red; } },
          { label: 'Spend',         render: r => r.spend > 0 ? fmtDollar(r.spend, 2) : '—',                            color: r => r.spend > 0 ? C.yellow : C.muted },
        ],
        totals: [
          'TOTAL', '', '', '',
          fmt(totalCalls),
          fmt(totalBillable),
          fmt(totalCalls - totalBillable),
          fmtPct(overallRate),
          fmtDollar(calls.reduce((s,c) => s+(c.cost||0), 0), 2),
        ],
      };
    })(),
    monthly_premium: (() => {
      const premRows = [...policies].sort((a, b) => (b.premium||0) - (a.premium||0));
      const totalPrem = premRows.reduce((s, r) => s + (r.premium||0), 0);
      const avgPrem = premRows.length > 0 ? totalPrem / premRows.length : 0;
      const byAgent = {};
      premRows.forEach(r => { byAgent[r.agent] = (byAgent[r.agent]||0) + r.premium; });
      const topAgent = Object.entries(byAgent).sort((a,b) => b[1]-a[1])[0];
      return {
        title: 'Monthly Premium — All Submitted',
        summary: `${premRows.length} applications · avg ${fmtDollar(avgPrem, 2)}/policy`,
        financials: [
          { label: 'Total Premium', value: fmtDollar(totalPrem, 2),                                        color: C.green },
          { label: 'Avg Premium',   value: fmtDollar(avgPrem, 2),                                          color: C.text },
          { label: 'Top Agent',     value: topAgent ? `${topAgent[0]} (${fmtDollar(topAgent[1], 2)})` : '—', color: C.accent },
        ],
        rows: premRows,
        columns: [
          { label: 'Date',        render: r => r.submitDate,                                                color: C.muted },
          { label: 'Agent',       render: r => r.agent,                                                     color: C.text },
          { label: 'Client',      render: r => `${r.firstName} ${r.lastName}`.trim(),                       color: C.text },
          { label: 'Lead Source', render: r => r.leadSource || '—',                                         color: C.muted },
          { label: 'Carrier',     render: r => r.carrier,                                                   color: C.text },
          { label: 'Product',     render: r => r.product || '—',                                            color: C.muted },
          { label: 'Face Amount', render: r => fmtDollar(r.faceAmount||0),                                  color: C.muted },
          { label: 'Premium',     render: r => fmtDollar(r.premium, 2),                                     color: C.green },
          { label: 'Status',      render: r => r.placed,                                                    color: () => C.green },
        ],
        totals: [
          'TOTAL', '', '', '', '', '', '',
          fmtDollar(totalPrem, 2) + ` (avg ${fmtDollar(avgPrem, 2)})`,
          `${premRows.length} placed`,
        ],
      };
    })(),
    lead_spend: (() => {
      const bycamp = {};
      calls.forEach(c => {
        const key = c.campaignCode || c.campaign || 'Unknown';
        if (!bycamp[key]) bycamp[key] = { campaign: key, vendor: c.vendor || '', total: 0, billable: 0, spend: 0, pricePerCall: c.pricePerCall || 0, buffer: c.buffer || 0 };
        bycamp[key].total++;
        if (c.isBillable) { bycamp[key].billable++; bycamp[key].spend += c.cost || 0; }
      });
      const spendRows = Object.values(bycamp).filter(r => r.spend > 0).sort((a, b) => b.spend - a.spend);
      const totalSpend = spendRows.reduce((s, r) => s + r.spend, 0);
      const totalBillable = spendRows.reduce((s, r) => s + r.billable, 0);
      const totalCalls = spendRows.reduce((s, r) => s + r.total, 0);
      const overallRpc = totalCalls > 0 ? totalSpend / totalCalls : 0;
      return {
        title: 'Lead Spend — By Publisher',
        summary: `${spendRows.length} publishers · ${fmt(totalBillable)} billable calls · ${fmtDollar(totalSpend)} total spend`,
        financials: [
          { label: 'Total Spend',      value: fmtDollar(totalSpend),                                                            color: C.yellow },
          { label: 'Billable Calls',   value: fmt(totalBillable),                                                               color: C.green },
          { label: 'Avg Cost/Call',    value: fmtDollar(totalBillable > 0 ? totalSpend / totalBillable : 0, 2),                color: C.text },
          { label: 'RPC',             value: fmtDollar(overallRpc, 2),                                                          color: overallRpc <= 35 ? C.green : overallRpc <= 43 ? C.yellow : C.red },
        ],
        rows: spendRows,
        columns: [
          { label: 'Campaign',      render: r => r.campaign,                                                                    color: C.text },
          { label: 'Vendor',        render: r => r.vendor || '—',                                                               color: C.muted },
          { label: 'Buffer',        render: r => r.buffer ? r.buffer + 's' : '—',                                               color: C.muted },
          { label: '$/Call',        render: r => fmtDollar(r.pricePerCall, 2),                                                  color: C.muted },
          { label: 'Total Calls',   render: r => fmt(r.total),                                                                  color: C.text },
          { label: 'Billable',      render: r => fmt(r.billable),                                                               color: C.green },
          { label: 'Bill Rate',     render: r => r.total > 0 ? fmtPct(r.billable / r.total * 100) : '—',                       color: C.muted },
          { label: 'Spend',         render: r => fmtDollar(r.spend, 2),                                                         color: () => C.yellow },
          { label: 'RPC',           render: r => r.total > 0 ? fmtDollar(r.spend / r.total, 2) : '—',                          color: r => { const v = r.total > 0 ? r.spend / r.total : null; return !v ? C.muted : v <= 35 ? C.green : v <= 43 ? C.yellow : C.red; } },
          { label: 'Avg Cost/Call', render: r => r.billable > 0 ? fmtDollar(r.spend / r.billable, 2) : '—',                   color: C.muted },
        ],
        totals: [
          'TOTAL', '', '', '',
          fmt(totalCalls),
          fmt(totalBillable),
          fmtPct(totalCalls > 0 ? totalBillable / totalCalls * 100 : 0),
          fmtDollar(totalSpend, 2),
          fmtDollar(overallRpc, 2),
          fmtDollar(totalBillable > 0 ? totalSpend / totalBillable : 0, 2),
        ],
      };
    })(),
    agent_commission: (() => {
      const commRows = [...policies].sort((a, b) => (b.commission||0) - (a.commission||0));
      const totalComm = commRows.reduce((s, r) => s + (r.commission||0), 0);
      const totalPrem = commRows.reduce((s, r) => s + (r.premium||0), 0);
      // Summarize by agent
      const byAgent = {};
      commRows.forEach(r => {
        if (!byAgent[r.agent]) byAgent[r.agent] = { agent: r.agent, policies: 0, premium: 0, commission: 0, isSalaried: r.isSalaried };
        byAgent[r.agent].policies++;
        byAgent[r.agent].premium += r.premium||0;
        byAgent[r.agent].commission += r.commission||0;
      });
      const agentSummary = Object.values(byAgent).sort((a,b) => b.commission - a.commission);
      const topAgent = agentSummary[0];
      return {
        title: 'Agent Commission — Placed Policies',
        summary: `${commRows.length} placed policies · ${agentSummary.length} agents`,
        financials: [
          { label: 'Total Commission', value: fmtDollar(totalComm, 2),                                                          color: C.accent },
          { label: 'Avg Commission',   value: fmtDollar(commRows.length > 0 ? totalComm / commRows.length : 0, 2),             color: C.text },
          { label: 'Top Agent',        value: topAgent ? `${topAgent.agent} (${fmtDollar(topAgent.commission, 2)})` : '—',     color: C.accent },
        ],
        rows: commRows,
        columns: [
          { label: 'Date',        render: r => r.submitDate,                                                    color: C.muted },
          { label: 'Agent',       render: r => r.agent,                                                         color: C.text },
          { label: 'Client',      render: r => `${r.firstName} ${r.lastName}`.trim(),                           color: C.text },
          { label: 'Carrier',     render: r => r.carrier,                                                       color: C.muted },
          { label: 'Product',     render: r => r.product || '—',                                                color: C.muted },
          { label: 'Premium',     render: r => fmtDollar(r.premium, 2),                                         color: C.green },
          { label: 'Comm Rate',   render: r => r.premium > 0 ? fmtPct(r.commission / r.premium * 100) : '—',   color: C.muted },
          { label: 'Commission',  render: r => r.isSalaried ? 'Salary' : fmtDollar(r.commission, 2),           color: r => r.isSalaried ? C.muted : C.accent },
          { label: 'Status',      render: r => r.placed,                                                        color: () => C.green },
        ],
        totals: [
          'TOTAL', '', '', '', '',
          fmtDollar(totalPrem, 2),
          totalPrem > 0 ? fmtPct(totalComm / totalPrem * 100) : '—',
          fmtDollar(totalComm, 2) + ` (avg ${fmtDollar(commRows.length > 0 ? totalComm/commRows.length : 0, 2)})`,
          '',
        ],
      };
    })(),
    net_revenue: (() => {
      const netRows = [...pnl].sort((a, b) => b.netRevenue - a.netRevenue);
      const totalGAR     = netRows.reduce((s, r) => s + (r.grossAdvancedRevenue||0), 0);
      const totalSpend   = netRows.reduce((s, r) => s + (r.leadSpend||0), 0);
      const totalComm    = netRows.reduce((s, r) => s + (r.totalCommission||0), 0);
      const totalNet     = totalGAR - totalSpend - totalComm;
      return {
        title: 'Net Revenue — By Publisher',
        summary: `${netRows.length} publishers · GAR ${fmtDollar(totalGAR)} − Spend ${fmtDollar(totalSpend)} − Comm ${fmtDollar(totalComm)}`,
        financials: [
          { label: 'Gross Adv Revenue', value: fmtDollar(totalGAR),   color: C.green },
          { label: 'Lead Spend + Comm', value: fmtDollar(totalSpend + totalComm), color: C.yellow },
          { label: 'Net Revenue',        value: fmtDollar(totalNet),   color: totalNet >= 0 ? C.green : C.red },
        ],
        rows: netRows,
        columns: [
          { label: 'Publisher',    render: r => r.campaign,                                                                        color: C.text },
          { label: 'Vendor',       render: r => r.vendor || '—',                                                                   color: C.muted },
          { label: 'Placed',       render: r => fmt(r.placedCount||0),                                                             color: C.green },
          { label: 'Premium',      render: r => fmtDollar(r.totalPremium||0, 2),                                                   color: C.green },
          { label: 'Gross Adv Rev',render: r => fmtDollar(r.grossAdvancedRevenue||0),                                             color: C.green },
          { label: 'Lead Spend',   render: r => fmtDollar(r.leadSpend||0, 2),                                                      color: C.yellow },
          { label: 'Commission',   render: r => fmtDollar(r.totalCommission||0, 2),                                                color: C.accent },
          { label: 'Net Revenue',  render: r => fmtDollar(r.netRevenue||0, 2),                                                     color: r => (r.netRevenue||0) >= 0 ? C.green : C.red },
        ],
        totals: [
          'TOTAL', '',
          fmt(netRows.reduce((s,r)=>s+(r.placedCount||0),0)),
          fmtDollar(netRows.reduce((s,r)=>s+(r.totalPremium||0),0), 2),
          fmtDollar(totalGAR),
          fmtDollar(totalSpend, 2),
          fmtDollar(totalComm, 2),
          fmtDollar(totalNet, 2),
        ],
      };
    })(),
    cpa: (() => {
      const cpaRows = [...pnl].filter(r => r.leadSpend > 0).sort((a, b) => {
        const cpaA = a.appCount > 0 ? a.leadSpend / a.appCount : Infinity;
        const cpaB = b.appCount > 0 ? b.leadSpend / b.appCount : Infinity;
        return cpaA - cpaB; // best CPA first
      });
      const totalSpend  = cpaRows.reduce((s, r) => s + r.leadSpend, 0);
      const totalApps   = policies.length; // all apps submitted
      const overallCpa  = totalApps > 0 ? totalSpend / totalApps : 0;
      return {
        title: 'CPA — Cost Per App Submitted by Publisher',
        summary: `${totalApps} apps · ${fmtDollar(totalSpend)} spend · overall CPA ${fmtDollar(overallCpa)}`,
        financials: [
          { label: 'Overall CPA',   value: fmtDollar(overallCpa),   color: overallCpa <= 250 ? C.green : overallCpa <= 312 ? C.yellow : C.red },
          { label: 'Total Spend',   value: fmtDollar(totalSpend),   color: C.yellow },
          { label: 'Apps',          value: fmt(totalApps),           color: C.green },
        ],
        rows: cpaRows,
        columns: [
          { label: 'Publisher',     render: r => r.campaign,                                                                                        color: C.text },
          { label: 'Vendor',        render: r => r.vendor || '—',                                                                                   color: C.muted },
          { label: 'Total Calls',   render: r => fmt(r.totalCalls||0),                                                                              color: C.muted },
          { label: 'Billable',      render: r => fmt(r.billableCalls||0),                                                                           color: C.muted },
          { label: 'Apps',          render: r => fmt(r.appCount||0),                                                                                color: C.green },
          { label: 'Lead Spend',    render: r => fmtDollar(r.leadSpend, 2),                                                                         color: C.yellow },
          { label: 'CPA',           render: r => r.appCount > 0 ? fmtDollar(r.leadSpend / r.appCount) : '—',                                       color: r => { const c = r.appCount > 0 ? r.leadSpend/r.appCount : null; return !c ? C.muted : c <= 250 ? C.green : c <= 312 ? C.yellow : C.red; } },
          { label: 'Close Rate',    render: r => r.billableCalls > 0 ? fmtPct(r.placedCount / r.billableCalls * 100) : '—',                        color: C.muted },
        ],
        totals: [
          'TOTAL', '',
          fmt(cpaRows.reduce((s,r)=>s+(r.totalCalls||0),0)),
          fmt(cpaRows.reduce((s,r)=>s+(r.billableCalls||0),0)),
          fmt(totalApps),
          fmtDollar(totalSpend, 2),
          fmtDollar(overallCpa),
          '',
        ],
      };
    })(),
    rpc: (() => {
      const rpcRows = [...pnl].filter(r => r.totalCalls > 0).sort((a, b) => {
        const rpcA = a.totalCalls > 0 ? a.leadSpend / a.totalCalls : Infinity;
        const rpcB = b.totalCalls > 0 ? b.leadSpend / b.totalCalls : Infinity;
        return rpcA - rpcB; // best (lowest) RPC first
      });
      const totalSpend  = rpcRows.reduce((s, r) => s + (r.leadSpend||0), 0);
      const totalCalls  = rpcRows.reduce((s, r) => s + (r.totalCalls||0), 0);
      const overallRpc  = totalCalls > 0 ? totalSpend / totalCalls : 0;
      return {
        title: 'RPC — Revenue Per Call by Publisher',
        summary: `${fmt(totalCalls)} total calls · ${fmtDollar(totalSpend)} spend · overall RPC ${fmtDollar(overallRpc, 2)}`,
        financials: [
          { label: 'Overall RPC',   value: fmtDollar(overallRpc, 2),  color: overallRpc <= 35 ? C.green : overallRpc <= 43 ? C.yellow : C.red },
          { label: 'Total Calls',   value: fmt(totalCalls),            color: C.text },
          { label: 'Total Spend',   value: fmtDollar(totalSpend),     color: C.yellow },
        ],
        rows: rpcRows,
        columns: [
          { label: 'Publisher',    render: r => r.campaign,                                                                                         color: C.text },
          { label: 'Vendor',       render: r => r.vendor || '—',                                                                                    color: C.muted },
          { label: 'Total Calls',  render: r => fmt(r.totalCalls||0),                                                                               color: C.text },
          { label: 'Billable',     render: r => fmt(r.billableCalls||0),                                                                            color: C.muted },
          { label: 'Bill Rate',    render: r => r.totalCalls > 0 ? fmtPct(r.billableCalls/r.totalCalls*100) : '—',                                 color: C.muted },
          { label: 'Lead Spend',   render: r => fmtDollar(r.leadSpend||0, 2),                                                                       color: C.yellow },
          { label: 'RPC',          render: r => r.totalCalls > 0 ? fmtDollar(r.leadSpend/r.totalCalls, 2) : '—',                                   color: r => { const v = r.totalCalls > 0 ? r.leadSpend/r.totalCalls : null; return !v ? C.muted : v <= 35 ? C.green : v <= 43 ? C.yellow : C.red; } },
          { label: 'Placed',       render: r => fmt(r.placedCount||0),                                                                              color: C.green },
          { label: 'CPA',          render: r => r.placedCount > 0 ? fmtDollar(r.leadSpend/r.placedCount) : '—',                                    color: C.muted },
        ],
        totals: [
          'TOTAL', '',
          fmt(totalCalls),
          fmt(rpcRows.reduce((s,r)=>s+(r.billableCalls||0),0)),
          '',
          fmtDollar(totalSpend, 2),
          fmtDollar(overallRpc, 2),
          fmt(rpcRows.reduce((s,r)=>s+(r.placedCount||0),0)),
          '',
        ],
      };
    })(),
    close_rate: (() => {
      const crRows = [...pnl].filter(r => r.billableCalls > 0).sort((a, b) => {
        const crA = a.billableCalls > 0 ? a.placedCount / a.billableCalls : 0;
        const crB = b.billableCalls > 0 ? b.placedCount / b.billableCalls : 0;
        return crB - crA; // best close rate first
      });
      const totalBillable = crRows.reduce((s, r) => s + (r.billableCalls||0), 0);
      const totalPlaced   = crRows.reduce((s, r) => s + (r.placedCount||0), 0);
      const overallCR     = totalBillable > 0 ? totalPlaced / totalBillable * 100 : 0;
      return {
        title: 'Close Rate — By Publisher',
        summary: `${fmt(totalPlaced)} placed of ${fmt(totalBillable)} billable calls · overall ${fmtPct(overallCR)}`,
        financials: [
          { label: 'Overall Close Rate', value: fmtPct(overallCR),     color: overallCR >= 5 ? C.green : overallCR >= 4 ? C.yellow : C.red },
          { label: 'Placed',             value: fmt(totalPlaced),       color: C.green },
          { label: 'Billable Calls',     value: fmt(totalBillable),     color: C.text },
        ],
        rows: crRows,
        columns: [
          { label: 'Publisher',    render: r => r.campaign,                                                                                              color: C.text },
          { label: 'Vendor',       render: r => r.vendor || '—',                                                                                         color: C.muted },
          { label: 'Billable',     render: r => fmt(r.billableCalls||0),                                                                                 color: C.text },
          { label: 'Placed',       render: r => fmt(r.placedCount||0),                                                                                   color: C.green },
          { label: 'Close Rate',   render: r => r.billableCalls > 0 ? fmtPct(r.placedCount/r.billableCalls*100) : '—',                                  color: r => { const v = r.billableCalls > 0 ? r.placedCount/r.billableCalls*100 : 0; return v >= 5 ? C.green : v >= 4 ? C.yellow : C.red; } },
          { label: 'Total Calls',  render: r => fmt(r.totalCalls||0),                                                                                    color: C.muted },
          { label: 'Bill Rate',    render: r => r.totalCalls > 0 ? fmtPct(r.billableCalls/r.totalCalls*100) : '—',                                      color: C.muted },
          { label: 'Lead Spend',   render: r => fmtDollar(r.leadSpend||0, 2),                                                                            color: C.yellow },
          { label: 'CPA',          render: r => r.placedCount > 0 ? fmtDollar(r.leadSpend/r.placedCount) : '—',                                         color: C.muted },
        ],
        totals: [
          'TOTAL', '',
          fmt(totalBillable),
          fmt(totalPlaced),
          fmtPct(overallCR),
          fmt(crRows.reduce((s,r)=>s+(r.totalCalls||0),0)),
          '',
          fmtDollar(crRows.reduce((s,r)=>s+(r.leadSpend||0),0), 2),
          '',
        ],
      };
    })(),
    placement_rate: (() => {
      const byAgent = {};
      policies.forEach(r => {
        if (!byAgent[r.agent]) byAgent[r.agent] = { agent: r.agent, apps: 0, placed: 0, premium: 0 };
        byAgent[r.agent].apps++;
        byAgent[r.agent].premium += r.premium||0;
        if (isPlaced(r)) { byAgent[r.agent].placed++; }
      });
      const prRows = Object.values(byAgent).filter(r => r.apps > 0).sort((a, b) => {
        const prA = a.apps > 0 ? a.placed / a.apps : 0;
        const prB = b.apps > 0 ? b.placed / b.apps : 0;
        return prB - prA; // best placement rate first
      });
      const totalApps   = prRows.reduce((s, r) => s + r.apps, 0);
      const totalPlaced = prRows.reduce((s, r) => s + r.placed, 0);
      const overallPR   = totalApps > 0 ? totalPlaced / totalApps * 100 : 0;
      return {
        title: 'Placement Rate — By Agent',
        summary: `${fmt(totalPlaced)} placed of ${fmt(totalApps)} apps submitted · overall ${fmtPct(overallPR)}`,
        financials: [
          { label: 'Placement Rate', value: fmtPct(overallPR),    color: overallPR >= 80 ? C.green : overallPR >= 64 ? C.yellow : C.red },
          { label: 'Apps Submitted', value: fmt(totalApps),        color: C.text },
          { label: 'Placed',         value: fmt(totalPlaced),      color: C.green },
        ],
        rows: prRows,
        columns: [
          { label: 'Agent',           render: r => r.agent,                                                                                              color: C.text },
          { label: 'Apps Submitted',  render: r => fmt(r.apps),                                                                                          color: C.text },
          { label: 'Placed',          render: r => fmt(r.placed),                                                                                        color: C.green },
          { label: 'Not Placed',      render: r => fmt(r.apps - r.placed),                                                                               color: C.red },
          { label: 'Placement Rate',  render: r => r.apps > 0 ? fmtPct(r.placed/r.apps*100) : '—',                                                      color: r => { const v = r.apps > 0 ? r.placed/r.apps*100 : 0; return v >= 80 ? C.green : v >= 64 ? C.yellow : C.red; } },
          { label: 'Total Premium',   render: r => fmtDollar(r.premium, 2),                                                                              color: C.green },
          { label: 'Avg Premium',     render: r => r.apps > 0 ? fmtDollar(r.premium/r.apps, 2) : '—',                                                   color: C.muted },
        ],
        totals: [
          'TOTAL',
          fmt(totalApps),
          fmt(totalPlaced),
          fmt(totalApps - totalPlaced),
          fmtPct(overallPR),
          fmtDollar(prRows.reduce((s,r)=>s+r.premium,0), 2),
          '',
        ],
      };
    })(),
    premium_cost_ratio: (() => {
      const _cg = goals?.company || {};
      const _effEnabled = (_cg.effectuation_enabled ?? 1) >= 1;
      const _effRate = _effEnabled ? (_cg.effectuation_rate ?? 70) / 100 : 1;
      const rowEffRev = r => (r.grossAdvancedRevenue || 0) * _effRate;
      const rowEffComm = r => (r.totalCommission || 0) * _effRate;
      const rowVarCost = r => (r.leadSpend || 0) + rowEffComm(r);
      const pcrRows = [...pnl].filter(r => rowVarCost(r) > 0).sort((a, b) => {
        const rA = rowVarCost(a) > 0 ? rowEffRev(a) / rowVarCost(a) : 0;
        const rB = rowVarCost(b) > 0 ? rowEffRev(b) / rowVarCost(b) : 0;
        return rB - rA; // best ratio first
      });
      const totalPrem    = pcrRows.reduce((s, r) => s + (r.totalPremium||0), 0);
      const totalSpend   = pcrRows.reduce((s, r) => s + (r.leadSpend||0), 0);
      const totalComm    = pcrRows.reduce((s, r) => s + (r.totalCommission||0), 0);
      const totalEffComm = totalComm * _effRate;
      const totalVarCost = totalSpend + totalEffComm;
      const totalEffRev  = pcrRows.reduce((s, r) => s + rowEffRev(r), 0);
      const overallRatio = totalVarCost > 0 ? (totalEffRev / totalVarCost) * 100 : 0;
      return {
        title: 'Rev:Cost Ratio — By Publisher',
        summary: `${fmtDollar(totalEffRev, 2)} eff. rev · ${fmtDollar(totalVarCost)} variable cost · overall ${fmtPct(overallRatio)}`,
        financials: [
          { label: 'Rev:Cost',       value: fmtPct(overallRatio),             color: overallRatio >= 45 ? C.green : overallRatio >= 35 ? C.yellow : C.red },
          { label: 'Eff. Revenue',   value: fmtDollar(totalEffRev, 2),       color: C.green },
          { label: 'Lead Spend',     value: fmtDollar(totalSpend),           color: C.yellow },
          { label: 'Eff. Commission', value: fmtDollar(totalEffComm),        color: C.yellow },
        ],
        rows: pcrRows,
        columns: [
          { label: 'Publisher',      render: r => r.campaign,                                                                                                          color: C.text },
          { label: 'Vendor',         render: r => r.vendor || '—',                                                                                                     color: C.muted },
          { label: 'Placed',         render: r => fmt(r.placedCount||0),                                                                                               color: C.green },
          { label: 'Premium',        render: r => fmtDollar(r.totalPremium||0, 2),                                                                                     color: C.green },
          { label: 'Lead Spend',     render: r => fmtDollar(r.leadSpend||0, 2),                                                                                        color: C.yellow },
          { label: 'Eff. Comm',      render: r => fmtDollar(rowEffComm(r), 2),                                                                                          color: C.yellow },
          { label: 'Eff. Rev',       render: r => fmtDollar(rowEffRev(r), 2),                                                                                          color: C.green },
          { label: 'Rev:Cost',       render: r => rowVarCost(r) > 0 ? fmtPct((rowEffRev(r)/rowVarCost(r)) * 100) : '—',                                                color: r => { const v = rowVarCost(r) > 0 ? (rowEffRev(r)/rowVarCost(r)) * 100 : 0; return v >= 45 ? C.green : v >= 35 ? C.yellow : C.red; } },
          { label: 'CPA',            render: r => r.placedCount > 0 ? fmtDollar(r.leadSpend/r.placedCount) : '—',                                                     color: C.muted },
        ],
        totals: [
          'TOTAL', '',
          fmt(pcrRows.reduce((s,r)=>s+(r.placedCount||0),0)),
          fmtDollar(totalPrem, 2),
          fmtDollar(totalSpend, 2),
          fmtDollar(totalEffComm, 2),
          fmtDollar(totalEffRev, 2),
          fmtPct(overallRatio),
          '',
        ],
      };
    })(),
    avg_premium: (() => {
      const avgRows = [...policies].sort((a, b) => (b.premium||0) - (a.premium||0));
      const totalPrem = avgRows.reduce((s, r) => s + (r.premium||0), 0);
      const avgPrem   = avgRows.length > 0 ? totalPrem / avgRows.length : 0;
      // By agent summary
      const byAgent = {};
      avgRows.forEach(r => {
        if (!byAgent[r.agent]) byAgent[r.agent] = { agent: r.agent, count: 0, premium: 0 };
        byAgent[r.agent].count++;
        byAgent[r.agent].premium += r.premium||0;
      });
      const topAgent = Object.values(byAgent).sort((a,b) => (b.premium/b.count) - (a.premium/a.count))[0];
      return {
        title: 'Avg Premium — Placed Policies',
        summary: `${avgRows.length} placed policies · total ${fmtDollar(totalPrem, 2)}`,
        financials: [
          { label: 'Avg Premium',   value: fmtDollar(avgPrem, 2),                                                                                  color: avgPrem >= 70 ? C.green : avgPrem >= 56 ? C.yellow : C.red },
          { label: 'Total Premium', value: fmtDollar(totalPrem, 2),                                                                                 color: C.green },
          { label: 'Top Avg Agent', value: topAgent ? `${topAgent.agent} (${fmtDollar(topAgent.premium/topAgent.count, 2)})` : '—',                color: C.accent },
        ],
        rows: avgRows,
        columns: [
          { label: 'Date',        render: r => r.submitDate,                                                                                         color: C.muted },
          { label: 'Agent',       render: r => r.agent,                                                                                              color: C.text },
          { label: 'Client',      render: r => `${r.firstName} ${r.lastName}`.trim(),                                                                color: C.text },
          { label: 'Carrier',     render: r => r.carrier,                                                                                            color: C.muted },
          { label: 'Product',     render: r => r.product || '—',                                                                                     color: C.muted },
          { label: 'Face Amount', render: r => fmtDollar(r.faceAmount||0),                                                                           color: C.muted },
          { label: 'Premium',     render: r => fmtDollar(r.premium, 2),                                                                              color: r => (r.premium||0) >= 70 ? C.green : (r.premium||0) >= 56 ? C.yellow : C.red },
          { label: 'Lead Source', render: r => r.leadSource || '—',                                                                                  color: C.muted },
          { label: 'Status',      render: r => r.placed,                                                                                             color: () => C.green },
        ],
        totals: [
          'TOTAL', '', '', '', '', '',
          fmtDollar(totalPrem, 2) + ` (avg ${fmtDollar(avgPrem, 2)})`,
          '', '',
        ],
      };
    })(),
  };

  const cfg = MODAL_CONFIGS[tileKey];
  if (!cfg) return null;

  const tabBtnStyle = (active) => ({
    padding: '6px 16px', fontSize: 10, fontWeight: 700, color: active ? C.text : C.muted,
    background: active ? C.surface : 'transparent', border: `1px solid ${active ? C.border : 'transparent'}`,
    borderBottom: active ? 'none' : `1px solid ${C.border}`, borderRadius: '6px 6px 0 0',
    cursor: 'pointer', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: -1,
  });

  // === Build Campaign / Agent / All views for all tiles ===
  const fmtDurV = s => { if (!s) return '0s'; const m = Math.floor(s/60); const sec = s%60; return m > 0 ? `${m}m ${sec}s` : `${sec}s`; };

  const buildPolGroupRows = (pols, keyFn) => {
    const map = {};
    pols.forEach(p => {
      const key = keyFn(p) || 'Unknown';
      if (!map[key]) map[key] = { campaign: key, agent: key, apps: 0, placed: 0, premium: 0, commission: 0, gar: 0, leadSpend: 0, isSalaried: p.isSalaried };
      map[key].apps++;
      map[key].premium += p.premium||0;
      map[key].commission += p.commission||0;
      map[key].gar += p.grossAdvancedRevenue||0;
      if (isPlaced(p)) { map[key].placed++; }
      map[key].leadSpend += getCallCost(p);
    });
    return Object.values(map).sort((a,b) => b.premium - a.premium);
  };

  const buildCallGroupRows = (cls, keyFn) => {
    const map = {};
    cls.forEach(c => {
      const key = keyFn(c) || 'Unknown';
      if (!map[key]) map[key] = { campaign: key, agent: key, vendor: c.vendor||'', total: 0, billable: 0, spend: 0, totalDur: 0, buffer: c.buffer||0, pricePerCall: c.pricePerCall||0 };
      map[key].total++;
      if (c.isBillable) { map[key].billable++; map[key].spend += c.cost||0; }
      map[key].totalDur += c.duration||0;
    });
    return Object.values(map).sort((a,b) => b.total - a.total);
  };

  const buildCarrierGroupRows = (pols) => {
    const map = {};
    pols.forEach(p => {
      const key = p.carrier || 'Unknown';
      if (!map[key]) map[key] = { carrier: key, apps: 0, placed: 0, premium: 0, commission: 0, gar: 0, leadSpend: 0 };
      map[key].apps++;
      map[key].premium += p.premium||0;
      map[key].commission += p.commission||0;
      map[key].gar += p.grossAdvancedRevenue||0;
      if (isPlaced(p)) { map[key].placed++; }
      map[key].leadSpend += getCallCost(p);
    });
    return Object.values(map).sort((a,b) => b.premium - a.premium);
  };

  const buildMergedAgentRows = () => {
    const map = {};
    calls.forEach(c => {
      const key = c.rep || 'Unknown';
      if (!map[key]) map[key] = { agent: key, calls: 0, billable: 0, spend: 0, apps: 0, placed: 0, premium: 0, commission: 0, gar: 0 };
      map[key].calls++;
      if (c.isBillable) { map[key].billable++; map[key].spend += c.cost||0; }
    });
    policies.forEach(p => {
      const key = p.agent || 'Unknown';
      if (!map[key]) map[key] = { agent: key, calls: 0, billable: 0, spend: 0, apps: 0, placed: 0, premium: 0, commission: 0, gar: 0 };
      map[key].apps++;
      map[key].premium += p.premium||0;
      map[key].commission += p.commission||0;
      map[key].gar += p.grossAdvancedRevenue||0;
      if (isPlaced(p)) { map[key].placed++; }
    });
    return Object.values(map).sort((a,b) => b.premium - a.premium);
  };

  // Column templates for grouped views
  const polGroupCols = (isAgent) => [
    isAgent
      ? { label: 'Agent', render: r => r.agent, color: C.accent, sortValue: r => r.agent }
      : { label: 'Campaign', render: r => r.campaign, color: C.accent, sortValue: r => r.campaign },
    { label: 'Apps', render: r => fmt(r.apps), color: C.text, sortValue: r => r.apps },
    { label: 'Placed', render: r => fmt(r.placed), color: C.green, sortValue: r => r.placed },
    { label: 'Place Rate', render: r => r.apps > 0 ? fmtPct(r.placed/r.apps*100) : '—', color: r => { const v = r.apps>0?r.placed/r.apps*100:0; return v>=80?C.green:v>=64?C.yellow:C.red; }, sortValue: r => r.apps>0?r.placed/r.apps:0 },
    { label: 'Premium', render: r => fmtDollar(r.premium, 2), color: C.green, sortValue: r => r.premium },
    { label: 'Avg Prem', render: r => r.apps > 0 ? fmtDollar(r.premium/r.apps, 2) : '—', color: C.muted, sortValue: r => r.apps>0?r.premium/r.apps:0 },
    { label: 'Commission', render: r => fmtDollar(r.commission, 2), color: C.accent, sortValue: r => r.commission },
    { label: 'GAR', render: r => fmtDollar(r.gar, 0), color: C.green, sortValue: r => r.gar },
  ];

  const carrierGroupCols = [
    { label: 'Carrier', render: r => r.carrier, color: C.accent, sortValue: r => r.carrier },
    { label: 'Apps', render: r => fmt(r.apps), color: C.text, sortValue: r => r.apps },
    { label: 'Placed', render: r => fmt(r.placed), color: C.green, sortValue: r => r.placed },
    { label: 'Place Rate', render: r => r.apps > 0 ? fmtPct(r.placed/r.apps*100) : '—', color: r => { const v = r.apps>0?r.placed/r.apps*100:0; return v>=80?C.green:v>=64?C.yellow:C.red; }, sortValue: r => r.apps>0?r.placed/r.apps:0 },
    { label: 'Premium', render: r => fmtDollar(r.premium, 2), color: C.green, sortValue: r => r.premium },
    { label: 'Avg Prem', render: r => r.apps > 0 ? fmtDollar(r.premium/r.apps, 2) : '—', color: C.muted, sortValue: r => r.apps>0?r.premium/r.apps:0 },
    { label: 'Commission', render: r => fmtDollar(r.commission, 2), color: C.accent, sortValue: r => r.commission },
    { label: 'GAR', render: r => fmtDollar(r.gar, 0), color: C.green, sortValue: r => r.gar },
  ];

  const callGroupCols = (isAgent) => {
    const base = [
      isAgent
        ? { label: 'Agent', render: r => r.agent, color: C.accent, sortValue: r => r.agent }
        : { label: 'Campaign', render: r => r.campaign, color: C.accent, sortValue: r => r.campaign },
    ];
    if (!isAgent) base.push({ label: 'Vendor', render: r => r.vendor || '—', color: C.muted, sortValue: r => r.vendor||'' });
    return [...base,
      { label: 'Total', render: r => fmt(r.total), color: C.text, sortValue: r => r.total },
      { label: 'Billable', render: r => fmt(r.billable), color: C.green, sortValue: r => r.billable },
      { label: 'Bill Rate', render: r => r.total>0 ? fmtPct(r.billable/r.total*100) : '—', color: r => { const v = r.total>0?r.billable/r.total*100:0; return v>=65?C.green:v>=52?C.yellow:C.red; }, sortValue: r => r.total>0?r.billable/r.total:0 },
      { label: 'Spend', render: r => fmtDollar(r.spend, 2), color: C.yellow, sortValue: r => r.spend },
      { label: 'Avg Dur', render: r => fmtDurV(r.total > 0 ? Math.round(r.totalDur/r.total) : 0), color: C.green, sortValue: r => r.total>0?r.totalDur/r.total:0 },
      { label: 'RPC', render: r => r.total>0 ? fmtDollar(r.spend/r.total, 2) : '—', color: r => { const v = r.total>0?r.spend/r.total:null; return !v?C.muted:v<=35?C.green:v<=43?C.yellow:C.red; }, sortValue: r => r.total>0?r.spend/r.total:0 },
    ];
  };

  const mergedAgentCols = [
    { label: 'Agent', render: r => r.agent, color: C.accent, sortValue: r => r.agent },
    { label: 'Calls', render: r => fmt(r.calls), color: C.text, sortValue: r => r.calls },
    { label: 'Billable', render: r => fmt(r.billable), color: C.green, sortValue: r => r.billable },
    { label: 'Apps', render: r => fmt(r.apps), color: C.text, sortValue: r => r.apps },
    { label: 'Placed', render: r => fmt(r.placed), color: C.green, sortValue: r => r.placed },
    { label: 'Premium', render: r => fmtDollar(r.premium, 2), color: C.green, sortValue: r => r.premium },
    { label: 'Spend', render: r => fmtDollar(r.spend, 2), color: C.yellow, sortValue: r => r.spend },
    { label: 'Commission', render: r => fmtDollar(r.commission, 2), color: C.accent, sortValue: r => r.commission },
    { label: 'GAR', render: r => fmtDollar(r.gar, 0), color: C.green, sortValue: r => r.gar },
    { label: 'Net Rev', render: r => { const n = (r.gar||0)-(r.spend||0)-(r.commission||0); return fmtDollar(n, 0); }, color: r => ((r.gar||0)-(r.spend||0)-(r.commission||0))>=0?C.green:C.red, sortValue: r => (r.gar||0)-(r.spend||0)-(r.commission||0) },
    { label: 'CPA', render: r => r.placed>0 ? fmtDollar(r.spend/r.placed, 0) : '—', color: r => { const v = r.placed>0?r.spend/r.placed:null; return !v?C.muted:v<=250?C.green:v<=312?C.yellow:C.red; }, sortValue: r => r.placed>0?r.spend/r.placed:Infinity },
    { label: 'Close Rate', render: r => r.billable>0 ? fmtPct(r.placed/r.billable*100) : '—', color: r => { const v = r.billable>0?r.placed/r.billable*100:0; return v>=5?C.green:v>=4?C.yellow:C.red; }, sortValue: r => r.billable>0?r.placed/r.billable:0 },
  ];

  // Generic "all individual records" columns
  const allPolicyCols = [
    { label: 'Date', render: r => r.submitDate, color: C.muted, sortValue: r => r.submitDate||'' },
    { label: 'Agent', render: r => r.agent, color: C.text, sortValue: r => r.agent||'' },
    { label: 'Client', render: r => `${r.firstName} ${r.lastName}`.trim(), color: C.text, sortValue: r => r.lastName||'' },
    { label: 'Lead Source', render: r => r.leadSource || '—', color: C.muted, sortValue: r => r.leadSource||'' },
    { label: 'Carrier', render: r => r.carrier, color: C.text, sortValue: r => r.carrier||'' },
    { label: 'Premium', render: r => fmtDollar(r.premium, 2), color: C.green, sortValue: r => r.premium||0 },
    { label: 'Commission', render: r => fmtDollar(r.commission, 2), color: C.accent, sortValue: r => r.commission||0 },
    { label: 'GAR', render: r => fmtDollar(r.grossAdvancedRevenue, 0), color: C.green, sortValue: r => r.grossAdvancedRevenue||0 },
    { label: 'Status', render: r => r.placed, color: r => isPlaced(r)?C.green:C.muted, sortValue: r => r.placed||'' },
  ];

  const allCallCols = [
    { label: 'Date', render: r => r.date, color: C.muted, sortValue: r => r.date||'' },
    { label: 'Agent', render: r => r.rep || '—', color: C.text, sortValue: r => r.rep||'' },
    { label: 'Campaign', render: r => r.campaign || '—', color: C.text, sortValue: r => r.campaign||'' },
    { label: 'Status', render: r => r.callStatus || '—', color: C.muted, sortValue: r => r.callStatus||'' },
    { label: 'Duration', render: r => fmtDurV(r.duration), color: r => r.isBillable?C.green:C.muted, sortValue: r => r.duration||0 },
    { label: 'Billable?', render: r => r.isBillable ? '✓ YES' : '✗ NO', color: r => r.isBillable?C.green:C.red, sortValue: r => r.isBillable?1:0 },
    { label: 'Cost', render: r => r.cost>0 ? fmtDollar(r.cost, 2) : '—', color: r => r.cost>0?C.yellow:C.muted, sortValue: r => r.cost||0 },
    { label: 'State', render: r => r.state || '—', color: C.muted, sortValue: r => r.state||'' },
    { label: 'Phone', render: r => r.phone || '—', color: C.muted, sortValue: r => r.phone||'' },
  ];

  // Determine tile category and build views
  const POLICY_TILE_KEYS = new Set(['apps_submitted', 'gross_adv_revenue', 'eff_revenue', 'monthly_premium', 'agent_commission', 'avg_premium']);
  const CALL_TILE_KEYS = new Set(['total_calls', 'billable_calls']);

  let views;
  if (POLICY_TILE_KEYS.has(tileKey)) {
    const src = cfg.rows;
    views = {
      campaign: { columns: polGroupCols(false), rows: buildPolGroupRows(src, p => p.leadSource) },
      agent: { columns: polGroupCols(true), rows: buildPolGroupRows(src, p => p.agent) },
      carrier: { columns: carrierGroupCols, rows: buildCarrierGroupRows(src) },
      all: { columns: cfg.columns, rows: cfg.rows, totals: cfg.totals },
    };
  } else if (CALL_TILE_KEYS.has(tileKey)) {
    const src = tileKey === 'billable_calls' ? calls.filter(c => c.isBillable) : [...calls];
    views = {
      campaign: { columns: callGroupCols(false), rows: buildCallGroupRows(src, c => c.campaignCode || c.campaign) },
      agent: { columns: callGroupCols(true), rows: buildCallGroupRows(src, c => c.rep) },
      carrier: { columns: carrierGroupCols, rows: buildCarrierGroupRows(policies) },
      all: { columns: cfg.columns, rows: cfg.allRows || cfg.rows, totals: cfg.totals },
    };
  } else if (tileKey === 'billable_rate') {
    views = {
      campaign: { columns: cfg.columns, rows: cfg.rows, totals: cfg.totals },
      agent: { columns: callGroupCols(true), rows: buildCallGroupRows(calls, c => c.rep) },
      carrier: { columns: carrierGroupCols, rows: buildCarrierGroupRows(policies) },
      all: { columns: allCallCols, rows: [...calls].sort((a,b) => (b.date||'').localeCompare(a.date||'')) },
    };
  } else if (tileKey === 'placement_rate') {
    views = {
      campaign: { columns: polGroupCols(false), rows: buildPolGroupRows(policies, p => p.leadSource) },
      agent: { columns: cfg.columns, rows: cfg.rows, totals: cfg.totals },
      carrier: { columns: carrierGroupCols, rows: buildCarrierGroupRows(policies) },
      all: { columns: allPolicyCols, rows: [...policies].sort((a,b) => (b.submitDate||'').localeCompare(a.submitDate||'')) },
    };
  } else {
    // PnL tiles: lead_spend, net_revenue, cpa, rpc, close_rate, premium_cost_ratio
    const isCallCentric = tileKey === 'lead_spend' || tileKey === 'rpc';
    views = {
      campaign: { columns: cfg.columns, rows: cfg.rows, totals: cfg.totals },
      agent: { columns: mergedAgentCols, rows: buildMergedAgentRows() },
      carrier: { columns: carrierGroupCols, rows: buildCarrierGroupRows(policies) },
      all: isCallCentric
        ? { columns: allCallCols, rows: [...calls].filter(c => c.isBillable).sort((a,b) => (b.date||'').localeCompare(a.date||'')) }
        : { columns: allPolicyCols, rows: [...policies].sort((a,b) => (b.submitDate||'').localeCompare(a.submitDate||'')) },
    };
  }

  // Export current view to Excel
  const exportToExcel = (columns, rows, totalsArr, label) => {
    import('xlsx').then(({ utils, writeFile }) => {
      const headers = columns.map(c => c.label);
      const dataRows = rows.map(row => columns.map(c => {
        // Extract plain text from render function
        const val = c.render(row);
        if (val == null) return '';
        // If it's a React element, try to get text content
        if (typeof val === 'object' && val.props) return val.props.children || '';
        return String(val).replace(/[$,%]/g, m => m); // keep formatting
      }));
      // Parse numeric-looking values back to numbers for Excel
      const parsed = dataRows.map(row => row.map(v => {
        const stripped = String(v).replace(/[$,%x]/g, '').replace(/,/g, '').trim();
        if (stripped === '' || stripped === '—' || stripped === 'N/A') return v;
        const num = Number(stripped);
        return !isNaN(num) && stripped !== '' ? num : v;
      }));
      const aoa = [headers, ...parsed];
      if (totalsArr && totalsArr.length > 0) aoa.push(totalsArr);
      const ws = utils.aoa_to_sheet(aoa);
      ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length + 4, 12) }));
      const wb = utils.book_new();
      utils.book_append_sheet(wb, ws, 'Export');
      const date = new Date().toISOString().slice(0, 10);
      writeFile(wb, `TCC_${label}_${date}.xlsx`);
    });
  };

  const exportBtnStyle = {
    background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 4,
    color: C.accent, fontSize: 10, fontWeight: 600, cursor: 'pointer', padding: '4px 10px',
    fontFamily: C.sans, whiteSpace: 'nowrap',
  };

  // Drill-down handling
  if (drillTarget) {
    const dt = drillTarget;
    let drillRows, drillCols;
    const isCallSource = CALL_TILE_KEYS.has(tileKey) || tileKey === 'billable_rate' || tileKey === 'lead_spend' || tileKey === 'rpc';
    if (dt.type === 'carrier') {
      // Carrier drill-down always shows policies
      const src = POLICY_TILE_KEYS.has(tileKey) ? cfg.rows : policies;
      drillRows = src.filter(p => (p.carrier || 'Unknown') === dt.value).sort((a,b) => (b.submitDate||'').localeCompare(a.submitDate||''));
      drillCols = allPolicyCols;
    } else if (isCallSource) {
      const src = tileKey === 'billable_calls' ? calls.filter(c => c.isBillable) : calls;
      drillRows = src.filter(c => {
        if (dt.type === 'campaign') return (c.campaignCode || c.campaign || 'Unknown') === dt.value;
        return (c.rep || 'Unknown') === dt.value;
      }).sort((a,b) => (b.date||'').localeCompare(a.date||''));
      drillCols = allCallCols;
    } else {
      const src = POLICY_TILE_KEYS.has(tileKey) ? cfg.rows : policies;
      drillRows = src.filter(p => {
        if (dt.type === 'campaign') return (p.leadSource || 'Unknown') === dt.value;
        return (p.agent || 'Unknown') === dt.value;
      }).sort((a,b) => (b.submitDate||'').localeCompare(a.submitDate||''));
      drillCols = allPolicyCols;
    }
    const drillKpis = dt.type === 'carrier' ? [
      { label: 'Policies', value: fmt(drillRows.length), color: C.text },
      { label: 'Placed', value: fmt(drillRows.filter(isPlaced).length), color: C.green },
      { label: 'Premium', value: fmtDollar(drillRows.reduce((s,p) => s+(p.premium||0), 0), 2), color: C.green },
      { label: 'GAR', value: fmtDollar(drillRows.reduce((s,p) => s+(p.grossAdvancedRevenue||0), 0), 0), color: C.green },
    ] : isCallSource ? [
      { label: 'Calls', value: fmt(drillRows.length), color: C.text },
      { label: 'Billable', value: fmt(drillRows.filter(c => c.isBillable).length), color: C.green },
      { label: 'Spend', value: fmtDollar(drillRows.reduce((s,c) => s+(c.cost||0), 0), 2), color: C.yellow },
    ] : [
      { label: 'Policies', value: fmt(drillRows.length), color: C.text },
      { label: 'Placed', value: fmt(drillRows.filter(isPlaced).length), color: C.green },
      { label: 'Premium', value: fmtDollar(drillRows.reduce((s,p) => s+(p.premium||0), 0), 2), color: C.green },
    ];

    return (
      <div style={overlayStyle} onClick={onClose}>
        <div style={modalStyle} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={() => setDrillTarget(null)} style={{ background: 'transparent', border: 'none', color: C.accent, fontSize: 12, cursor: 'pointer', padding: 0 }}>← Back</button>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text }}>{dt.value}</h2>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={() => exportToExcel(drillCols, drillRows, null, `${tileKey}_${dt.value}`)} style={exportBtnStyle}>Export</button>
              <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: C.muted, fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>✕</button>
            </div>
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>{drillRows.length} records</div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            {drillKpis.map(f => (
              <div key={f.label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 14px', flex: 1 }}>
                <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>{f.label}</div>
                <div style={{ fontSize: 16, fontWeight: 800, fontFamily: C.mono, color: f.color }}>{f.value}</div>
              </div>
            ))}
          </div>
          <SortableModalTable columns={drillCols} rows={drillRows} thStyle={thStyle} tdStyle={tdStyle} sortable />
        </div>
      </div>
    );
  }

  // Normal tabbed view
  const activeView = views[modalTab];

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text }}>{cfg.title}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => exportToExcel(activeView.columns, activeView.rows, activeView.totals, `${tileKey}_${modalTab}`)} style={exportBtnStyle}>Export</button>
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: C.muted, fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>✕</button>
          </div>
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>{cfg.summary}</div>
        {cfg.financials && (
          <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            {cfg.financials.map(f => (
              <div key={f.label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 14px', flex: 1 }}>
                <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>{f.label}</div>
                <div style={{ fontSize: 16, fontWeight: 800, fontFamily: C.mono, color: f.color }}>{f.value}</div>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 0, marginBottom: 0, borderBottom: `1px solid ${C.border}` }}>
          <button style={tabBtnStyle(modalTab === 'campaign')} onClick={() => { setModalTab('campaign'); setDrillTarget(null); }}>By Campaign</button>
          <button style={tabBtnStyle(modalTab === 'agent')} onClick={() => { setModalTab('agent'); setDrillTarget(null); }}>By Agent</button>
          <button style={tabBtnStyle(modalTab === 'carrier')} onClick={() => { setModalTab('carrier'); setDrillTarget(null); }}>By Carrier</button>
          <button style={tabBtnStyle(modalTab === 'all')} onClick={() => { setModalTab('all'); setDrillTarget(null); }}>All</button>
        </div>
        <div style={{ paddingTop: 12 }}>
          <SortableModalTable
            columns={activeView.columns}
            rows={activeView.rows}
            totals={activeView.totals}
            thStyle={thStyle}
            tdStyle={tdStyle}
            onRowClick={modalTab !== 'all' ? row => setDrillTarget({ type: modalTab, value: row.campaign || row.agent || row.carrier }) : undefined}
            sortable
          />
        </div>
      </div>
    </div>
  );
}

function PolicyStatusMini({ allTimePolicies, rangePolicies }) {
  const clf = p => {
    const s = (p.placed || '').toLowerCase();
    if (s === 'advance released' || s === 'active - in force') return 'active';
    if (s === 'cancelled' || s === 'canceled' || s === 'declined' || s === 'lapsed') return 'left';
    return 'pending';
  };
  const breakdown = ps => {
    if (!ps) return { total: 0, active: 0, pending: 0, left: 0 };
    const total = ps.length;
    const active = ps.filter(p => clf(p) === 'active').length;
    const pending = ps.filter(p => clf(p) === 'pending').length;
    const left = ps.filter(p => clf(p) === 'left').length;
    return { total, active, pending, left };
  };
  const all = breakdown(allTimePolicies);
  const range = breakdown(rangePolicies);
  const pct = (n, t) => t > 0 ? (n / t * 100).toFixed(0) + '%' : '—';

  const Panel = ({ label, d }) => {
    const aPct = d.total > 0 ? d.active / d.total * 100 : 0;
    const pPct = d.total > 0 ? d.pending / d.total * 100 : 0;
    const lPct = d.total > 0 ? d.left / d.total * 100 : 0;
    return (
      <div style={{ flex: 1, minWidth: 160 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
          {label} <span style={{ color: C.accent, fontFamily: C.mono }}>{d.total}</span> submitted
        </div>
        {/* Stacked bar */}
        <div style={{ height: 6, borderRadius: 3, overflow: 'hidden', display: 'flex', marginBottom: 8, background: C.border }}>
          <div style={{ width: `${aPct}%`, background: C.green }} />
          <div style={{ width: `${pPct}%`, background: C.yellow }} />
          <div style={{ width: `${lPct}%`, background: C.red }} />
        </div>
        {/* Rows */}
        {[['Active', d.active, C.green], ['Pending', d.pending, C.yellow], ['Left', d.left, C.red]].map(([lbl, count, color]) => (
          <div key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: C.muted, flex: 1 }}>{lbl}</span>
            <span style={{ fontSize: 11, fontWeight: 700, fontFamily: C.mono, color }}>{count}</span>
            <span style={{ fontSize: 10, fontFamily: C.mono, color: C.muted, minWidth: 34, textAlign: 'right' }}>{pct(count, d.total)}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', gap: 24, padding: '12px 16px', borderTop: `1px solid ${C.border}`, background: C.surface }}>
      <Panel label="All Time —" d={all} />
      <div style={{ width: 1, background: C.border }} />
      <Panel label="Selected Range —" d={range} />
    </div>
  );
}

function GoalComparison({ policies: _policies, calls: _calls, pnl: _pnl, goals, dateRange, allTimePolicies }) {
  const policies = _policies || [];
  const calls = _calls || [];
  const pnl = _pnl || [];
  const [activeTile, setActiveTile] = useState(null);
  const cg = goals?.company || {};
  const meta = goals?.companyMeta || {};

  // Count only days with actual activity (calls or policies)
  const activeDays = new Set();
  policies.forEach(p => { if (p.submitDate) activeDays.add(p.submitDate); });
  calls.forEach(c => { if (c.date) activeDays.add(c.date); });
  const days = Math.max(activeDays.size, 1);

  const placed = policies.filter(isPlaced);
  const totalPremium = policies.reduce((s, p) => s + p.premium, 0);
  const totalLeadSpend = pnl.reduce((s, p) => s + p.leadSpend, 0);
  const totalGAR = policies.reduce((s, p) => s + p.grossAdvancedRevenue, 0);
  const totalComm = policies.reduce((s, p) => s + p.commission, 0);
  const billable = calls.filter(c => c.isBillable).length;
  const totalCalls = calls.length;
  const cpa = policies.length > 0 ? totalLeadSpend / policies.length : 0;
  const closeRate = billable > 0 ? policies.length / billable * 100 : 0;
  const placementRate = policies.length > 0 ? placed.length / policies.length * 100 : 0;
  const avgPremium = policies.length > 0 ? totalPremium / policies.length : 0;
  const billableRate = totalCalls > 0 ? billable / totalCalls * 100 : 0;
  const rpc = totalCalls > 0 ? totalLeadSpend / totalCalls : 0;
  // Effectuation: apply rate to GAR if enabled in settings
  const effEnabled = (cg.effectuation_enabled ?? 1) >= 1;
  const effRate = effEnabled ? (cg.effectuation_rate ?? 70) / 100 : 1;
  const effRevenue = totalGAR * effRate;
  const effComm = totalComm * effRate;
  const netRevenue = effRevenue - totalLeadSpend - effComm;
  const varCost = totalLeadSpend + effComm;
  const premCostRatio = varCost > 0 ? (effRevenue / varCost) * 100 : 0;

  const m = key => meta[key] || { lower: false, yellow: 80 };

  const rows = [
    [
      { label: 'Apps Submitted', actual: policies.length, dailyGoal: cg.apps_submitted, key: 'apps_submitted', format: v => fmt(v) },
      { label: 'Policies Placed', actual: placed.length, dailyGoal: cg.policies_placed, key: 'policies_placed', format: v => fmt(v) },
      { label: 'Total Calls', actual: totalCalls, dailyGoal: cg.total_calls, key: 'total_calls', format: v => fmt(v) },
      { label: 'Billable Calls', actual: billable, dailyGoal: cg.billable_calls, key: 'billable_calls', format: v => fmt(v) },
      { label: 'Billable Rate', actual: billableRate, dailyGoal: cg.billable_rate, key: 'billable_rate', format: fmtPct, isRate: true },
    ],
    [
      { label: 'Monthly Premium', actual: totalPremium, dailyGoal: cg.monthly_premium, key: 'monthly_premium', format: v => fmtDollar(v, 2) },
      { label: 'Gross Adv Revenue', actual: totalGAR, dailyGoal: cg.gross_adv_revenue, key: 'gross_adv_revenue', format: v => fmtDollar(v) },
      { label: `Eff. Revenue${effEnabled ? ' (' + (effRate * 100).toFixed(0) + '%)' : ''}`, actual: effRevenue, dailyGoal: cg.eff_revenue, key: 'eff_revenue', format: v => fmtDollar(v) },
      { label: 'Lead Spend', actual: totalLeadSpend, dailyGoal: cg.lead_spend, key: 'lead_spend', format: v => fmtDollar(v) },
      { label: 'Agent Commission', actual: effComm, dailyGoal: cg.agent_commission, key: 'agent_commission', format: v => fmtDollar(v), subtext: effEnabled ? `Raw: ${fmtDollar(totalComm)}` : null },
      { label: 'Net Revenue', actual: netRevenue, dailyGoal: cg.net_revenue, key: 'net_revenue', format: v => fmtDollar(v) },
    ],
    [
      { label: 'CPA', actual: cpa, dailyGoal: cg.cpa, key: 'cpa', format: v => fmtDollar(v), isRate: true },
      { label: 'RPC', actual: rpc, dailyGoal: cg.rpc, key: 'rpc', format: v => fmtDollar(v, 2), isRate: true },
      { label: 'Close Rate', actual: closeRate, dailyGoal: cg.close_rate, key: 'close_rate', format: fmtPct, isRate: true },
      { label: 'Placement Rate', actual: placementRate, dailyGoal: cg.placement_rate, key: 'placement_rate', format: fmtPct, isRate: true },
      { label: 'Rev:Cost', actual: premCostRatio, dailyGoal: cg.premium_cost_ratio, key: 'premium_cost_ratio', format: fmtPct, isRate: true },
      { label: 'Avg Premium', actual: avgPremium, dailyGoal: cg.avg_premium, key: 'avg_premium', format: v => fmtDollar(v, 2), isRate: true },
    ],
  ];

  if (!cg || Object.keys(cg).length === 0) return null;

  return (
    <>
    {activeTile && <TileModal key={activeTile} tileKey={activeTile} policies={policies} calls={calls} pnl={pnl} goals={goals} onClose={() => setActiveTile(null)} />}
    <Section title={`Goal Comparison — ${days} active day${days !== 1 ? 's' : ''}`}>
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((row, ri) => (
          <div key={ri} style={{ display: 'grid', gridTemplateColumns: `repeat(${row.length}, 1fr)`, gap: 8 }}>
            {row.map(g => {
              const gm = m(g.key);
              const periodGoal = g.dailyGoal ? (g.isRate ? g.dailyGoal : g.dailyGoal * days) : null;
              const ratio = periodGoal ? (gm.lower ? periodGoal / g.actual : g.actual / periodGoal) : null;
              const pctOff = periodGoal ? (gm.lower ? ((periodGoal - g.actual) / periodGoal * 100) : ((g.actual - periodGoal) / periodGoal * 100)) : null;
              const pctLabel = pctOff !== null ? (pctOff >= 0 ? '+' + pctOff.toFixed(1) + '%' : pctOff.toFixed(1) + '%') : null;
              const tileColor = !periodGoal ? '#ffffff' : ratio >= 1 ? C.green : ratio >= (gm.yellow / 100) ? C.yellow : C.red;
              const tileBg = !periodGoal ? C.surface : ratio >= 1 ? C.greenDim : ratio >= (gm.yellow / 100) ? C.yellowDim : C.redDim;
              const isClickable = !!MODAL_CONFIGS_KEYS.includes(g.key);
              return (
                <div key={g.label} onClick={isClickable ? () => setActiveTile(g.key) : undefined} style={{ background: tileBg, borderRadius: 6, padding: '10px 14px', border: `1px solid ${C.border}`, cursor: isClickable ? 'pointer' : 'default', position: 'relative' }}>
                  <div style={{ fontSize: 9, color: '#c4d5e8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{g.label}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: g.subtext ? 2 : 8 }}>
                    <span style={{ fontSize: 20, fontWeight: 800, fontFamily: C.mono, color: tileColor, lineHeight: 1 }}>{g.format(g.actual)}</span>
                    {pctLabel && (
                      <span style={{
                        fontSize: 11, fontWeight: 700, fontFamily: C.mono, color: tileColor,
                        background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: 4, lineHeight: 1.2,
                      }}>{pctLabel}</span>
                    )}
                  </div>
                  {g.subtext && (
                    <div style={{ fontSize: 10, color: C.muted, fontFamily: C.mono, marginBottom: 6 }}>{g.subtext}</div>
                  )}
                  {periodGoal && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 6 }}>
                      {!g.isRate && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 13, color: '#b0c4de', fontFamily: C.mono, fontWeight: 600 }}>Period Goal</span>
                          <span style={{ fontSize: 13, color: '#e0e8f0', fontFamily: C.mono, fontWeight: 700 }}>{g.format(periodGoal)}</span>
                        </div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 11, color: '#8fa3be', fontFamily: C.mono }}>Daily Goal</span>
                        <span style={{ fontSize: 11, color: '#b0c4de', fontFamily: C.mono }}>{g.format(g.dailyGoal)}</span>
                      </div>
                    </div>
                  )}
                  {periodGoal && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ flex: 1, height: 4, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ width: `${Math.min((ratio || 0) * 100, 100)}%`, height: '100%', background: tileColor, borderRadius: 2, transition: 'width 0.5s ease' }} />
                      </div>
                      <span style={{ fontSize: 10, fontFamily: C.mono, color: tileColor, minWidth: 36 }}>{ratio ? (ratio * 100).toFixed(0) + '%' : '—'}</span>
                    </div>
                  )}
                  {isClickable && <div style={{ position: 'absolute', bottom: 6, right: 8, fontSize: 9, color: C.muted, opacity: 0.6 }}>↗ detail</div>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <PolicyStatusMini allTimePolicies={allTimePolicies} rangePolicies={policies} />
    </Section>
    </>
  );
}
// ─── VIRTUAL AGENT TILES ─────────────────────────────
function normalizePhone(raw) {
  if (!raw) return '';
  return raw.replace(/\D/g, '').slice(-10);
}

function VirtualAgentTiles({ vaData, policies, goals, dateRange }) {
  const [drillKey, setDrillKey] = useState(null);
  const vaCalls = vaData?.calls || [];
  const cg = goals?.company || {};
  const meta = goals?.companyMeta || {};

  if (!vaCalls.length && !cg.va_calls) return null;

  // Count active days for period goal scaling
  const activeDays = new Set();
  vaCalls.forEach(c => { if (c.date) activeDays.add(c.date); });
  const days = Math.max(activeDays.size, 1);

  const totalVACalls = vaCalls.length;
  const transfers = vaCalls.filter(c => c.transferConfirmation).length;
  const transferRate = totalVACalls > 0 ? (transfers / totalVACalls) * 100 : 0;

  // Match VA caller IDs to policy phone numbers for sales attribution
  const policyPhones = new Set();
  (policies || []).forEach(p => {
    const ph = normalizePhone(p.phone || p.phoneNumber || p['Phone Number']);
    if (ph) policyPhones.add(ph);
  });
  const vaSales = vaCalls.filter(c => c.transferConfirmation && c.callerId && policyPhones.has(c.callerId)).length;
  const vaConvRate = transfers > 0 ? (vaSales / transfers) * 100 : 0;

  const m = key => meta[key] || { lower: false, yellow: 80 };

  const tiles = [
    { label: 'VA Calls', actual: totalVACalls, dailyGoal: cg.va_calls, key: 'va_calls', format: v => fmt(v) },
    { label: 'VA Transfers', actual: transfers, dailyGoal: cg.va_transfers, key: 'va_transfers', format: v => fmt(v) },
    { label: 'Transfer Rate', actual: transferRate, dailyGoal: cg.va_transfer_rate, key: 'va_transfer_rate', format: fmtPct, isRate: true },
    { label: 'VA Sales', actual: vaSales, dailyGoal: cg.va_sales, key: 'va_sales', format: v => fmt(v) },
    { label: 'VA Conversion', actual: vaConvRate, dailyGoal: cg.va_conversion_rate, key: 'va_conversion_rate', format: fmtPct, isRate: true },
  ];

  const filterForKey = (key) => {
    switch (key) {
      case 'va_transfers': return vaCalls.filter(c => c.transferConfirmation);
      case 'va_sales':
      case 'va_conversion_rate':
        return vaCalls.filter(c => c.transferConfirmation && c.callerId && policyPhones.has(c.callerId));
      case 'va_calls':
      case 'va_transfer_rate':
      default:
        return vaCalls;
    }
  };
  const drillTile = tiles.find(t => t.key === drillKey);
  const drillCalls = drillKey ? filterForKey(drillKey) : [];

  return (
    <>
    <Section title={`Virtual Agent Screener — ${days} active day${days !== 1 ? 's' : ''}`}>
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${tiles.length}, 1fr)`, gap: 8 }}>
          {tiles.map(g => {
            const gm = m(g.key);
            const periodGoal = g.dailyGoal ? (g.isRate ? g.dailyGoal : g.dailyGoal * days) : null;
            const ratio = periodGoal ? (gm.lower ? periodGoal / g.actual : g.actual / periodGoal) : null;
            const pctOff = periodGoal ? (gm.lower ? ((periodGoal - g.actual) / periodGoal * 100) : ((g.actual - periodGoal) / periodGoal * 100)) : null;
            const pctLabel = pctOff !== null ? (pctOff >= 0 ? '+' + pctOff.toFixed(1) + '%' : pctOff.toFixed(1) + '%') : null;
            const tileColor = !periodGoal ? '#ffffff' : ratio >= 1 ? C.green : ratio >= (gm.yellow / 100) ? C.yellow : C.red;
            const tileBg = !periodGoal ? C.surface : ratio >= 1 ? C.greenDim : ratio >= (gm.yellow / 100) ? C.yellowDim : C.redDim;
            const isActive = drillKey === g.key;
            return (
              <div
                key={g.label}
                onClick={() => setDrillKey(isActive ? null : g.key)}
                style={{
                  background: tileBg, borderRadius: 6, padding: '10px 14px',
                  border: `1px solid ${isActive ? tileColor : C.border}`,
                  cursor: 'pointer', transition: 'border-color 0.15s',
                  boxShadow: isActive ? `0 0 0 1px ${tileColor}` : 'none',
                }}>
                <div style={{ fontSize: 9, color: '#c4d5e8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{g.label}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 20, fontWeight: 800, fontFamily: C.mono, color: tileColor, lineHeight: 1 }}>{g.format(g.actual)}</span>
                  {pctLabel && (
                    <span style={{
                      fontSize: 11, fontWeight: 700, fontFamily: C.mono, color: tileColor,
                      background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: 4, lineHeight: 1.2,
                    }}>{pctLabel}</span>
                  )}
                </div>
                {periodGoal && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 6 }}>
                    {!g.isRate && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 13, color: '#b0c4de', fontFamily: C.mono, fontWeight: 600 }}>Period Goal</span>
                        <span style={{ fontSize: 13, color: '#e0e8f0', fontFamily: C.mono, fontWeight: 700 }}>{g.format(periodGoal)}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 11, color: '#8fa3be', fontFamily: C.mono }}>Daily Goal</span>
                      <span style={{ fontSize: 11, color: '#b0c4de', fontFamily: C.mono }}>{g.format(g.dailyGoal)}</span>
                    </div>
                  </div>
                )}
                {periodGoal && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ flex: 1, height: 4, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min((ratio || 0) * 100, 100)}%`, height: '100%', background: tileColor, borderRadius: 2, transition: 'width 0.5s ease' }} />
                    </div>
                    <span style={{ fontSize: 10, fontFamily: C.mono, color: tileColor, minWidth: 36 }}>{ratio ? (ratio * 100).toFixed(0) + '%' : '—'}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Section>
    {drillKey && (
      <div
        onClick={() => setDrillKey(null)}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
          zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
          padding: '40px 24px', overflowY: 'auto',
        }}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{ width: '100%', maxWidth: 1400 }}
        >
          <VirtualAgentDrilldown
            calls={drillCalls}
            label={drillTile?.label || ''}
            onClose={() => setDrillKey(null)}
          />
        </div>
      </div>
    )}
    </>
  );
}

// ─── VIRTUAL AGENT DRILL-DOWN ─────────────────────
function VirtualAgentDrilldown({ calls, label, onClose }) {
  const fmtDur = s => {
    if (!s) return '0:00';
    const m = Math.floor(s / 60), sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  };
  const fmtPhone = p => {
    if (!p || p.length !== 10) return p || '—';
    return `(${p.slice(0,3)}) ${p.slice(3,6)}-${p.slice(6)}`;
  };
  const fmtDate = d => {
    if (!d) return '';
    const [y, m, day] = d.split('-');
    return `${parseInt(m)}/${parseInt(day)}/${y}`;
  };
  const bool = v => v
    ? <span style={{ color: C.green, fontWeight: 700 }}>✓</span>
    : <span style={{ color: C.red, fontWeight: 700 }}>✗</span>;

  const [selectedDay, setSelectedDay] = useState(null);

  // Group by date → campaign
  const byDate = {};
  calls.forEach(c => {
    const d = c.date || '(no date)';
    const camp = c.campaign || '(no campaign)';
    if (!byDate[d]) byDate[d] = {};
    if (!byDate[d][camp]) byDate[d][camp] = [];
    byDate[d][camp].push(c);
  });
  const allDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));

  // Day-level summary stats
  const dayStats = allDates.map(d => {
    const rows = Object.values(byDate[d]).flat();
    const uniq = new Set(rows.map(r => r.callerId).filter(Boolean)).size;
    const endXfer = rows.filter(r => r.endCallSource === 'transfer').length;
    const colXfer = rows.filter(r => r.transferConfirmation).length;
    const billable = rows.filter(r => r.billable).length;
    const avgDur = rows.length ? Math.round(rows.reduce((s, r) => s + (r.duration || 0), 0) / rows.length) : 0;
    return {
      date: d, rows: rows.length, uniq, endXfer, colXfer, billable, avgDur,
      xferRate: rows.length ? (endXfer / rows.length * 100) : 0,
      campaigns: Object.keys(byDate[d]).length,
    };
  });

  const dates = selectedDay ? [selectedDay] : [];
  const detailCols = ['Agent', 'Caller ID', 'Billable', 'Duration', 'Disposition'];
  const statusCols = ['End Call Src', 'Lead Review', 'Intent', 'DOB', 'Existing Cov', 'Budget', 'State', 'Xfer Conf'];

  return (
    <Section
      title={selectedDay
        ? `${label} — ${fmtDate(selectedDay)} Detail`
        : `${label} — Day Summary (${calls.length} row${calls.length !== 1 ? 's' : ''} across ${allDates.length} day${allDates.length !== 1 ? 's' : ''})`}
      rightContent={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {selectedDay && (
            <span
              onClick={() => setSelectedDay(null)}
              style={{ cursor: 'pointer', fontSize: 11, color: C.accent, padding: '4px 10px', border: `1px solid ${C.accent}`, borderRadius: 4 }}
            >‹ Back to Summary</span>
          )}
          <span
            onClick={onClose}
            style={{ cursor: 'pointer', fontSize: 11, color: C.muted, padding: '4px 10px', border: `1px solid ${C.border}`, borderRadius: 4 }}
          >✕ Close</span>
        </div>
      }
    >
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {allDates.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: C.muted, fontSize: 12 }}>No rows match.</div>
        )}
        {!selectedDay && allDates.length > 0 && (
          <div style={{ overflowX: 'auto', border: `1px solid ${C.border}`, borderRadius: 6 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: C.mono }}>
              <thead>
                <tr style={{ background: C.surface }}>
                  {['Date', 'Calls', 'Unique Callers', 'Campaigns', 'Transfers (end=xfer)', 'Xfer Conf Col', 'Xfer Rate', 'Billable', 'Avg Duration', ''].map(h => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: h==='Date' ? 'left' : 'right', color: C.muted, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dayStats.map(s => (
                  <tr key={s.date}
                      onClick={() => setSelectedDay(s.date)}
                      style={{ borderBottom: `1px solid ${C.border}`, cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.background = C.surface}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ padding: '8px 10px', color: C.accent, fontWeight: 700 }}>{fmtDate(s.date)}</td>
                    <td style={{ padding: '8px 10px', color: C.text, textAlign: 'right' }}>{s.rows}</td>
                    <td style={{ padding: '8px 10px', color: C.text, textAlign: 'right' }}>{s.uniq}</td>
                    <td style={{ padding: '8px 10px', color: C.muted, textAlign: 'right' }}>{s.campaigns}</td>
                    <td style={{ padding: '8px 10px', color: C.green, textAlign: 'right' }}>{s.endXfer}</td>
                    <td style={{ padding: '8px 10px', color: C.muted, textAlign: 'right' }}>{s.colXfer}</td>
                    <td style={{ padding: '8px 10px', color: s.xferRate >= 20 ? C.green : s.xferRate >= 10 ? C.yellow : C.red, textAlign: 'right', fontWeight: 700 }}>{s.xferRate.toFixed(1)}%</td>
                    <td style={{ padding: '8px 10px', color: C.text, textAlign: 'right' }}>{s.billable}</td>
                    <td style={{ padding: '8px 10px', color: C.muted, textAlign: 'right' }}>{fmtDur(s.avgDur)}</td>
                    <td style={{ padding: '8px 10px', color: C.accent, textAlign: 'right', fontSize: 10 }}>›</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: C.bg, borderTop: `2px solid ${C.border}` }}>
                  <td style={{ padding: '8px 10px', color: C.accent, fontWeight: 800 }}>TOTAL</td>
                  <td style={{ padding: '8px 10px', color: C.text, fontWeight: 800, textAlign: 'right' }}>{dayStats.reduce((s,x)=>s+x.rows,0)}</td>
                  <td style={{ padding: '8px 10px', color: C.text, fontWeight: 800, textAlign: 'right' }}>{new Set(calls.map(c=>c.callerId).filter(Boolean)).size}</td>
                  <td style={{ padding: '8px 10px', color: C.muted, textAlign: 'right' }}>—</td>
                  <td style={{ padding: '8px 10px', color: C.green, fontWeight: 800, textAlign: 'right' }}>{dayStats.reduce((s,x)=>s+x.endXfer,0)}</td>
                  <td style={{ padding: '8px 10px', color: C.muted, textAlign: 'right' }}>{dayStats.reduce((s,x)=>s+x.colXfer,0)}</td>
                  <td style={{ padding: '8px 10px', color: C.accent, fontWeight: 800, textAlign: 'right' }}>{(() => { const t=dayStats.reduce((s,x)=>s+x.rows,0); const x=dayStats.reduce((s,x)=>s+x.endXfer,0); return t ? (x/t*100).toFixed(1)+'%' : '—'; })()}</td>
                  <td style={{ padding: '8px 10px', color: C.text, fontWeight: 800, textAlign: 'right' }}>{dayStats.reduce((s,x)=>s+x.billable,0)}</td>
                  <td style={{ padding: '8px 10px' }}></td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {dates.map(d => {
          const campaigns = Object.keys(byDate[d]).sort();
          const dayTotal = campaigns.reduce((s, c) => s + byDate[d][c].length, 0);
          return (
            <div key={d} style={{ border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ background: C.surface, padding: '8px 12px', borderBottom: `1px solid ${C.border}`, fontSize: 12, fontWeight: 700, color: C.accent }}>
                {fmtDate(d)} <span style={{ color: C.muted, fontWeight: 400, marginLeft: 8 }}>({dayTotal} call{dayTotal !== 1 ? 's' : ''})</span>
              </div>
              {campaigns.map(camp => {
                const rows = byDate[d][camp];
                return (
                  <div key={camp}>
                    <div style={{ background: C.card, padding: '6px 12px', borderBottom: `1px solid ${C.border}`, fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1 }}>
                      {camp} <span style={{ fontWeight: 400, marginLeft: 6 }}>· {rows.length}</span>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: C.mono }}>
                        <thead>
                          <tr style={{ background: C.bg }}>
                            {detailCols.map(h => (
                              <th key={h} style={{ padding: '6px 8px', textAlign: 'left', color: C.muted, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                            ))}
                            <th style={{ padding: '6px 8px', borderLeft: `2px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}></th>
                            {statusCols.map(h => (
                              <th key={h} style={{ padding: '6px 8px', textAlign: 'center', color: C.muted, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r, i) => (
                            <tr key={r.recordingId || i} style={{ borderBottom: `1px solid ${C.border}` }}>
                              <td style={{ padding: '6px 8px', color: C.text }}>{r.agentName || '—'}</td>
                              <td style={{ padding: '6px 8px', color: C.text }}>{fmtPhone(r.callerId)}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'center' }}>{bool(r.billable)}</td>
                              <td style={{ padding: '6px 8px', color: C.text }}>{fmtDur(r.duration)}</td>
                              <td style={{ padding: '6px 8px', color: C.muted, maxWidth: 360, fontSize: 10 }} title={r.disposition}>{r.disposition || '—'}</td>
                              <td style={{ borderLeft: `2px solid ${C.border}` }}></td>
                              <td style={{ padding: '6px 8px', color: r.endCallSource === 'transfer' ? C.green : C.text, fontSize: 10, textAlign: 'center' }}>{r.endCallSource || '—'}</td>
                              <td style={{ padding: '6px 8px', color: C.muted, fontSize: 10, textAlign: 'center' }}>{r.leadReview || '—'}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'center' }}>{bool(r.intentConfirmation)}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'center' }}>{bool(r.collectDob)}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'center' }}>{bool(r.existingCoverage)}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'center' }}>{bool(r.budgetQualification)}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'center' }}>{bool(r.collectState)}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'center' }}>{bool(r.transferConfirmation)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ─── DAILY ACTIVITY TAB ────────────────────────────
function DailyActivityTab({ policies, calls, pnl, goals, dateRange, allTimePolicies, vaData }) {
  const { openDrawer } = useStatementRecordDrawer();
  const [drillDay, setDrillDay] = useState(null);
  const [overrides, setOverrides] = useState({}); // rowIndex → 'N' | 'Y' | ''
  const [flagging, setFlagging] = useState(null); // rowIndex currently being saved

  const flagCall = async (rowIndex, value) => {
    setFlagging(rowIndex);
    setOverrides(prev => ({ ...prev, [rowIndex]: value }));
    try {
      const res = await fetch('/api/flag-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowIndex, value }),
      });
      if (!res.ok) throw new Error('API error');
    } catch {
      setOverrides(prev => { const n = { ...prev }; delete n[rowIndex]; return n; });
    }
    setFlagging(null);
  };

  const days = calcDays(dateRange.start, dateRange.end);
  const cg = goals?.company || {};
  const placed = policies.filter(isPlaced);
  const totalPremium = policies.reduce((s, p) => s + p.premium, 0);
  const totalGAR = policies.reduce((s, p) => s + p.grossAdvancedRevenue, 0);
  const totalComm = policies.reduce((s, p) => s + p.commission, 0);
  const totalCalls = calls.length;
  const billable = calls.filter(c => c.isBillable).length;
  const leadSpend = calls.reduce((s, c) => s + c.cost, 0);
  const cpa = policies.length > 0 ? leadSpend / policies.length : 0;
  const rpc = totalCalls > 0 ? leadSpend / totalCalls : 0;
  const billableRate = totalCalls > 0 ? billable / totalCalls * 100 : 0;
  const avgPrem = policies.length > 0 ? totalPremium / policies.length : 0;

  const byDay = {};
  policies.forEach(p => {
    if (!byDay[p.submitDate]) byDay[p.submitDate] = { date: p.submitDate, apps: 0, placed: 0, premium: 0, commission: 0, gar: 0, totalCalls: 0, billableCalls: 0, leadSpend: 0 };
    byDay[p.submitDate].apps++;
    byDay[p.submitDate].premium += p.premium;
    byDay[p.submitDate].commission += p.commission;
    byDay[p.submitDate].gar += p.grossAdvancedRevenue;
    if (isPlaced(p)) { byDay[p.submitDate].placed++; }
  });
  calls.forEach(c => {
    if (!byDay[c.date]) byDay[c.date] = { date: c.date, apps: 0, placed: 0, premium: 0, commission: 0, gar: 0, totalCalls: 0, billableCalls: 0, leadSpend: 0 };
    byDay[c.date].totalCalls++; if (c.isBillable) { byDay[c.date].billableCalls++; byDay[c.date].leadSpend += c.cost; }
  });
  const dailyRows = Object.values(byDay).sort((a, b) => b.date.localeCompare(a.date));

  return (
    <>
      <GoalComparison policies={policies} calls={calls} pnl={pnl} goals={goals} dateRange={dateRange} allTimePolicies={allTimePolicies || []} />
      <VirtualAgentTiles vaData={vaData} policies={policies} goals={goals} dateRange={dateRange} />
      {drillDay ? (() => {
        const rawDayCalls = calls.filter(c => c.date === drillDay).sort((a, b) => b.duration - a.duration);
        // Apply local overrides on top of server-side data
        const dayCalls = rawDayCalls.map(c => {
          const ov = overrides[c._rowIndex];
          if (ov === undefined) return c;
          const effBillable = ov === 'N' ? false : ov === 'Y' ? true : c.isBillable;
          return { ...c, isBillable: effBillable, billableOverride: ov, cost: effBillable ? c.pricePerCall : 0 };
        });
        const dayPolicies = policies.filter(p => p.submitDate === drillDay);
        const dayBillable = dayCalls.filter(c => c.isBillable);
        const daySpend = dayCalls.reduce((s, c) => s + c.cost, 0);
        const dayFlagged = dayCalls.filter(c => (overrides[c._rowIndex] ?? c.billableOverride) === 'N').length;
        function fmtDur(s) { if (!s) return '0s'; const m = Math.floor(s / 60); const sec = s % 60; return m > 0 ? `${m}m ${sec}s` : `${sec}s`; }
        return (
          <>
            <Breadcrumb items={[{ label: 'Daily Breakdown', onClick: () => setDrillDay(null) }, { label: drillDay }]} />
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
              <KPICard label="Total Calls" value={dayCalls.length} />
              <KPICard label="Billable" value={dayBillable.length} subtitle={`${dayCalls.length > 0 ? (dayBillable.length / dayCalls.length * 100).toFixed(1) : 0}%`} />
              <KPICard label="Lead Spend" value={fmtDollar(daySpend)} />
              <KPICard label="Apps" value={dayPolicies.length} subtitle={`${dayPolicies.filter(isPlaced).length} placed`} />
              <KPICard label="Flagged Non-Bill" value={dayFlagged} subtitle="Manual overrides" />
            </div>
            <Section title={`All Calls — ${drillDay}`} rightContent={<span style={{ fontSize: 10, color: C.muted }}>{dayCalls.length} calls · {dayBillable.length} billable · {fmtDollar(daySpend)} spend{dayFlagged > 0 ? ` · ${dayFlagged} flagged` : ''}</span>}>
              <SortableTable defaultSort="duration" columns={[
                { key: 'campaign', label: 'Campaign', align: 'left', bold: true, mono: false },
                { key: 'rep', label: 'Agent', align: 'left', mono: false },
                { key: 'callStatus', label: 'Status', align: 'left', mono: false, color: r => r.callStatus?.toLowerCase() === 'sale' ? C.green : r.isBillable ? C.text : C.muted },
                { key: 'callType', label: 'Call Type', align: 'left', mono: false, color: r => r.callType === 'Inbound' ? C.green : C.muted },
                { key: 'duration', label: 'Duration', render: r => fmtDur(r.duration), color: r => r.isBillable ? C.green : C.red },
                { key: 'buffer', label: 'Buffer', render: r => fmtDur(r.buffer), color: () => C.muted },
                { key: 'isBillable', label: 'Billable?', render: r => r.isBillable ? '✓ YES' : '✗ NO', color: r => r.isBillable ? C.green : C.red },
                { key: 'cost', label: 'Cost', render: r => r.cost > 0 ? fmtDollar(r.cost) : '—', color: r => r.cost > 0 ? C.yellow : C.muted },
                { key: 'pricePerCall', label: '$/Call', render: r => r.pricePerCall > 0 ? fmtDollar(r.pricePerCall) : '—' },
                { key: 'state', label: 'State' },
                { key: 'phone', label: 'Phone', align: 'left' },
                { key: 'leadId', label: 'Lead ID', align: 'left', color: () => C.muted },
                { key: '_flag', label: 'Override', sortable: false, align: 'center', render: r => {
                  const ov = overrides[r._rowIndex] !== undefined ? overrides[r._rowIndex] : (r.billableOverride || '');
                  const pending = flagging === r._rowIndex;
                  if (ov === 'N') return (
                    <button disabled={pending} onClick={e => { e.stopPropagation(); flagCall(r._rowIndex, ''); }} style={{ fontSize: 10, padding: '3px 8px', background: C.redDim, color: C.red, border: `1px solid ${C.red}`, borderRadius: 4, cursor: 'pointer', opacity: pending ? 0.5 : 1 }}>
                      {pending ? '...' : '↩ Remove Flag'}
                    </button>
                  );
                  if (r.isBillable) return (
                    <button disabled={pending} onClick={e => { e.stopPropagation(); flagCall(r._rowIndex, 'N'); }} style={{ fontSize: 10, padding: '3px 8px', background: 'transparent', color: C.muted, border: `1px solid ${C.border}`, borderRadius: 4, cursor: 'pointer', opacity: pending ? 0.5 : 1 }}>
                      {pending ? '...' : '🚩 Flag'}
                    </button>
                  );
                  return <span style={{ color: C.border, fontSize: 10 }}>—</span>;
                }},
              ]} rows={dayCalls} />
            </Section>
            {dayPolicies.length > 0 && (
              <Section title={`Policies Submitted — ${drillDay}`}>
                <SortableTable defaultSort="premium" columns={[
                  { key: 'agent', label: 'Agent', align: 'left', bold: true, mono: false },
                  { key: 'carrier', label: 'Carrier', align: 'left', mono: false },
                  { key: 'product', label: 'Product', align: 'left', mono: false, color: () => C.muted },
                  { key: 'faceAmount', label: 'Face', render: r => fmtDollar(r.faceAmount) },
                  { key: 'premium', label: 'Premium', render: r => fmtDollar(r.premium, 2), color: () => C.green },
                  { key: 'commission', label: 'Agent Comm', render: r => fmtDollar(r.commission), color: () => C.accent },
                  { key: 'placed', label: 'Status', align: 'left', mono: false, color: r => isPlaced(r) ? C.green : r.placed === 'Declined' ? C.red : C.yellow },
                  { key: 'state', label: 'State' },
                  { key: '_stmtBtn', label: '📄', sortable: false, align: 'center', mono: false, render: r => (
                    <button onClick={(e) => { e.stopPropagation(); openDrawer({ holderName: `${r.firstName} ${r.lastName}`.trim(), policyNumber: r.policyNumber }); }} title="View carrier statements" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 14 }}>📄</button>
                  )},
                ]} rows={dayPolicies} />
              </Section>
            )}
          </>
        );
      })() : (
      <Section title="Daily Breakdown" rightContent={<span style={{ fontSize: 10, color: C.muted }}>Click a day to see call details</span>}>
        <SortableTable defaultSort="date" onRowClick={r => setDrillDay(r.date)} columns={[
          { key: 'date', label: 'Date', align: 'left', bold: true },
          { key: 'apps', label: 'Apps' },
          { key: 'placed', label: 'Placed', color: r => r.placed > 0 ? C.green : C.muted },
          { key: 'premium', label: 'Premium', render: r => fmtDollar(r.premium, 2), color: r => r.premium > 0 ? C.green : C.muted },
          { key: 'avgPrem', label: 'Avg Prem', render: r => r.apps > 0 ? fmtDollar(r.premium / r.apps, 2) : '—' },
          { key: 'gar', label: 'Gross Adv Rev', render: r => fmtDollar(r.gar), color: r => r.gar > 0 ? C.green : C.muted },
          { key: 'totalCalls', label: 'Calls', render: r => fmt(r.totalCalls || 0) },
          { key: 'billableCalls', label: 'Billable', render: r => fmt(r.billableCalls || 0) },
          { key: 'billableRate', label: 'Bill %', render: r => r.totalCalls > 0 ? fmtPct(r.billableCalls / r.totalCalls * 100) : '—' },
          { key: 'leadSpend', label: 'Spend', render: r => fmtDollar(r.leadSpend || 0), color: r => (r.leadSpend || 0) > 0 ? C.yellow : C.muted },
          { key: 'rpc', label: 'RPC', render: r => r.totalCalls > 0 ? fmtDollar(r.leadSpend / r.totalCalls, 2) : '—' },
          { key: 'cpa', label: 'CPA', render: r => r.apps > 0 && r.leadSpend ? fmtDollar(r.leadSpend / r.apps) : '—' },
          { key: 'commission', label: 'Comm', render: r => fmtDollar(r.commission), color: () => C.accent },
          { key: 'net', label: 'Net Rev', render: r => fmtDollar(r.gar - (r.leadSpend || 0) - r.commission), color: r => (r.gar - (r.leadSpend || 0) - r.commission) > 0 ? C.green : C.red },
        ]} rows={dailyRows} />
      </Section>
      )}
    </>
  );
}

// ─── PUBLISHERS TAB ─────────────────────────────────
function PublishersTab({ pnl, policies, goals, calls, dateRange, allTimePolicies, vaData, voiceDrillTarget, clearVoiceDrill }) {
  const [drill, setDrill] = useState(null);
  useEffect(() => {
    if (voiceDrillTarget?.type === 'publisher' && voiceDrillTarget?.name) {
      setDrill(voiceDrillTarget.name);
      if (clearVoiceDrill) clearVoiceDrill();
    }
  }, [voiceDrillTarget, clearVoiceDrill]);
  const cg = goals?.company || {};

  const pubTotals = useMemo(() => {
    const t = { campaign: 'TOTAL', vendor: '', totalCalls: 0, billableCalls: 0, leadSpend: 0, placedCount: 0, totalPremium: 0, grossAdvancedRevenue: 0, totalCommission: 0, pricePerCall: 0 };
    pnl.forEach(p => { t.totalCalls += p.totalCalls; t.billableCalls += p.billableCalls; t.leadSpend += p.leadSpend; t.placedCount += p.placedCount; t.totalPremium += p.totalPremium; t.grossAdvancedRevenue += p.grossAdvancedRevenue; t.totalCommission += p.totalCommission; });
    t.billableRate = t.totalCalls > 0 ? t.billableCalls / t.totalCalls * 100 : 0;
    t.rpc = t.totalCalls > 0 ? t.leadSpend / t.totalCalls : 0;
    t.closeRate = t.billableCalls > 0 ? t.placedCount / t.billableCalls * 100 : 0;
    t.appCount = pnl.reduce((s, p) => s + (p.appCount||0), 0);
    t.cpa = t.appCount > 0 ? t.leadSpend / t.appCount : 0;
    t.avgPremium = t.appCount > 0 ? t.totalPremium / t.appCount : 0;
    t.netRevenue = t.grossAdvancedRevenue - t.leadSpend - t.totalCommission;
    return t;
  }, [pnl]);

  if (drill) {
    const pub = pnl.find(p => p.campaign === drill);
    if (!pub) { setDrill(null); return null; }
    const pp = policies.filter(p => p.leadSource === drill);
    const agentMap = {};
    pp.forEach(p => {
      if (!agentMap[p.agent]) agentMap[p.agent] = { agent: p.agent, apps: 0, placed: 0, premium: 0, commission: 0, gar: 0 };
      agentMap[p.agent].apps++;
      agentMap[p.agent].premium += p.premium;
      agentMap[p.agent].commission += p.commission;
      agentMap[p.agent].gar += p.grossAdvancedRevenue;
      if (isPlaced(p)) { agentMap[p.agent].placed++; }
    });
    (pub.agentBreakdown || []).forEach(a => {
      if (!agentMap[a.agent]) agentMap[a.agent] = { agent: a.agent, apps: 0, placed: 0, premium: 0, commission: 0, gar: 0 };
      agentMap[a.agent].totalCalls = a.totalCalls; agentMap[a.agent].billableCalls = a.billableCalls; agentMap[a.agent].leadSpend = a.leadSpend;
    });
    const carrierMap = {};
    pp.forEach(p => {
      if (!carrierMap[p.carrier]) carrierMap[p.carrier] = { carrier: p.carrier, apps: 0, placed: 0, premium: 0, commission: 0, gar: 0 };
      carrierMap[p.carrier].apps++;
      carrierMap[p.carrier].gar += p.grossAdvancedRevenue;
      if (isPlaced(p)) { carrierMap[p.carrier].placed++; carrierMap[p.carrier].premium += p.premium; carrierMap[p.carrier].commission += p.commission; }
    });
    return (
      <>
        <Breadcrumb items={[{ label: 'All Publishers', onClick: () => setDrill(null) }, { label: drill }]} />
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <KPICard label="Lead Spend" value={fmtDollar(pub.leadSpend)} subtitle={`${fmt(pub.billableCalls)} billable × ${fmtDollar(pub.pricePerCall)}`} />
          <KPICard label="Placed" value={pub.placedCount || 0} subtitle={`of ${pub.appCount || 0} apps`} />
          <KPICard label="CPA" value={fmtDollar(pub.cpa)} goal={cg.cpa} lowerIsBetter />
          <KPICard label="Mo. Premium" value={fmtDollar(pub.totalPremium, 2)} subtitle={`Avg: ${fmtDollar(pub.avgPremium, 2)}`} />
          <KPICard label="Bill %" value={fmtPct(pub.billableRate)} />
          <KPICard label="RPC" value={fmtDollar(pub.rpc, 2)} />
          <KPICard label="Gross Adv Rev" value={fmtDollar(pub.grossAdvancedRevenue)} />
          <KPICard label="Net Revenue" value={fmtDollar(pub.netRevenue)} />
        </div>
        <Section title="Agent Breakdown">
          <SortableTable defaultSort="premium" columns={[
            { key: 'agent', label: 'Agent', align: 'left', bold: true, mono: false },
            { key: 'apps', label: 'Apps' }, { key: 'placed', label: 'Placed', color: r => r.placed > 0 ? C.green : C.muted },
            { key: 'premium', label: 'Premium', render: r => fmtDollar(r.premium, 2), color: () => C.green },
            { key: 'avgPrem', label: 'Avg Prem', render: r => r.apps > 0 ? fmtDollar(r.premium / r.apps, 2) : '—' },
            { key: 'totalCalls', label: 'Calls', render: r => fmt(r.totalCalls || 0) },
            { key: 'billableCalls', label: 'Billable', render: r => fmt(r.billableCalls || 0) },
            { key: 'billRate', label: 'Bill %', render: r => (r.totalCalls || 0) > 0 ? fmtPct(r.billableCalls / r.totalCalls * 100) : '—' },
            { key: 'leadSpend', label: 'Spend', render: r => fmtDollar(r.leadSpend || 0), color: () => C.yellow },
            { key: 'rpc', label: 'RPC', render: r => (r.totalCalls || 0) > 0 ? fmtDollar(r.leadSpend / r.totalCalls, 2) : '—' },
            { key: 'cpa', label: 'CPA', render: r => r.apps > 0 && r.leadSpend ? fmtDollar(r.leadSpend / r.apps) : '—' },
          ]} rows={Object.values(agentMap)} />
        </Section>
        <Section title="Carrier Breakdown">
          <SortableTable defaultSort="premium" columns={[
            { key: 'carrier', label: 'Carrier', align: 'left', bold: true, mono: false },
            { key: 'apps', label: 'Apps' }, { key: 'placed', label: 'Placed', color: r => r.placed > 0 ? C.green : C.muted },
            { key: 'premium', label: 'Premium', render: r => fmtDollar(r.premium, 2), color: () => C.green },
            { key: 'avgPrem', label: 'Avg Prem', render: r => r.apps > 0 ? fmtDollar(r.premium / r.apps, 2) : '—' },
            { key: 'commission', label: 'Commission', render: r => fmtDollar(r.commission), color: () => C.accent },
            { key: 'gar', label: 'Gross Adv Rev', render: r => fmtDollar(r.gar), color: () => C.green },
          ]} rows={Object.values(carrierMap)} />
        </Section>
      </>
    );
  }
  return (
    <>
    <GoalComparison policies={policies} calls={calls} pnl={pnl} goals={goals} dateRange={dateRange} />
    <VirtualAgentTiles vaData={vaData} policies={policies} goals={goals} dateRange={dateRange} />
    <Section title="Publisher Performance" rightContent={<span style={{ fontSize: 10, color: C.muted }}>Click a row to drill down</span>}>
      <SortableTable defaultSort="totalPremium" onRowClick={r => r.campaign !== 'TOTAL' && setDrill(r.campaign)} totalsRow={pubTotals} columns={[
        { key: 'campaign', label: 'Publisher', align: 'left', bold: true, mono: false },
        { key: 'vendor', label: 'Vendor', align: 'left', mono: false, color: () => C.muted },
        { key: 'totalCalls', label: 'Calls' }, { key: 'billableCalls', label: 'Billable' },
        { key: 'billableRate', label: 'Bill %', render: r => fmtPct(r.billableRate) },
        { key: 'pricePerCall', label: '$/Call', render: r => r.pricePerCall > 0 ? fmtDollar(r.pricePerCall) : '—' },
        { key: 'leadSpend', label: 'Spend', render: r => fmtDollar(r.leadSpend), color: r => r.leadSpend > 0 ? C.yellow : C.muted },
        { key: 'rpc', label: 'RPC', render: r => r.totalCalls > 0 ? fmtDollar(r.rpc, 2) : '—' },
        { key: 'placedCount', label: 'Sales', color: r => r.placedCount > 0 ? C.green : C.muted },
        { key: 'closeRate', label: 'Close %', render: r => fmtPct(r.closeRate) },
        { key: 'cpa', label: 'CPA', render: r => r.cpa > 0 ? fmtDollar(r.cpa) : '—', color: r => goalColor(r.cpa, cg.cpa, true) },
        { key: 'totalPremium', label: 'Mo. Prem', render: r => fmtDollar(r.totalPremium, 2), color: r => r.totalPremium > 0 ? C.green : C.muted },
        { key: 'avgPremium', label: 'Avg Prem', render: r => fmtDollar(r.avgPremium, 2) },
        { key: 'grossAdvancedRevenue', label: 'Gross Adv', render: r => fmtDollar(r.grossAdvancedRevenue), color: r => r.grossAdvancedRevenue > 0 ? C.green : C.muted },
        { key: 'totalCommission', label: 'Comm', render: r => fmtDollar(r.totalCommission), color: () => C.accent },
        { key: 'netRevenue', label: 'Net Rev', render: r => fmtDollar(r.netRevenue), color: r => r.netRevenue > 0 ? C.green : C.red, bold: true },
      ]} rows={pnl} />
    </Section>
    </>
  );
}

// ─── AGENTS TAB ──────────────────────────────────────
function AgentsTab({ policies, calls, goals, dateRange, pnl, allTimePolicies, vaData, voiceDrillTarget, clearVoiceDrill }) {
  const [drill, setDrill] = useState(null);
  useEffect(() => {
    if (voiceDrillTarget?.type === 'agent' && voiceDrillTarget?.name) {
      setDrill(voiceDrillTarget.name);
      if (clearVoiceDrill) clearVoiceDrill();
    }
  }, [voiceDrillTarget, clearVoiceDrill]);
  const days = calcDays(dateRange.start, dateRange.end);
  const ag = goals?.agent || {};
  const isSalaried = name => (goals?.agents?.[name]?.commissionType || '').toLowerCase() === 'salary';
  const SalaryBadge = () => <span style={{ fontSize: 9, marginLeft: 6, padding: '1px 5px', background: C.accentDim, color: C.accent, borderRadius: 3, fontWeight: 700, verticalAlign: 'middle' }}>SALARY</span>;
  const agentMap = {};
  policies.forEach(p => {
    if (!agentMap[p.agent]) agentMap[p.agent] = { agent: p.agent, apps: 0, placed: 0, premium: 0, commission: 0, faceAmount: 0, gar: 0 };
    agentMap[p.agent].apps++;
    agentMap[p.agent].gar += p.grossAdvancedRevenue;
    if (isPlaced(p)) { agentMap[p.agent].placed++; agentMap[p.agent].premium += p.premium; agentMap[p.agent].commission += p.commission; agentMap[p.agent].faceAmount += p.faceAmount; }
  });
  calls.forEach(c => {
    if (!c.rep) return;
    if (!agentMap[c.rep]) agentMap[c.rep] = { agent: c.rep, apps: 0, placed: 0, premium: 0, commission: 0, faceAmount: 0, gar: 0 };
    agentMap[c.rep].totalCalls = (agentMap[c.rep].totalCalls || 0) + 1;
    if (c.isBillable) { agentMap[c.rep].billableCalls = (agentMap[c.rep].billableCalls || 0) + 1; agentMap[c.rep].leadSpend = (agentMap[c.rep].leadSpend || 0) + c.cost; }
  });
  const agentRows = Object.values(agentMap).sort((a, b) => b.premium - a.premium);
  function getGoal(name, m) {
    const o = ag.overrides?.[name]; if (o && o[m] != null) return o[m] * days;
    if (ag.defaults?.[m] != null) return ag.defaults[m] * days; return null;
  }

  const agentTotals = useMemo(() => {
    const t = { agent: 'TOTAL', apps: 0, placed: 0, premium: 0, commission: 0, gar: 0, totalCalls: 0, billableCalls: 0, leadSpend: 0 };
    agentRows.forEach(a => { t.apps += a.apps; t.placed += a.placed; t.premium += a.premium; t.commission += a.commission; t.gar += a.gar; t.totalCalls += (a.totalCalls || 0); t.billableCalls += (a.billableCalls || 0); t.leadSpend += (a.leadSpend || 0); });
    return t;
  }, [agentRows]);

  if (drill) {
    const a = agentMap[drill]; if (!a) { setDrill(null); return null; }
    const ap = policies.filter(p => p.agent === drill);
    const carrierMap = {}, sourceMap = {};
    ap.forEach(p => {
      if (!carrierMap[p.carrier]) carrierMap[p.carrier] = { carrier: p.carrier, apps: 0, placed: 0, premium: 0, commission: 0, gar: 0 };
      carrierMap[p.carrier].apps++; carrierMap[p.carrier].gar += p.grossAdvancedRevenue; if (isPlaced(p)) { carrierMap[p.carrier].placed++; carrierMap[p.carrier].premium += p.premium; carrierMap[p.carrier].commission += p.commission; }
      if (!sourceMap[p.leadSource]) sourceMap[p.leadSource] = { leadSource: p.leadSource, apps: 0, placed: 0, premium: 0 };
      sourceMap[p.leadSource].apps++; if (isPlaced(p)) { sourceMap[p.leadSource].placed++; sourceMap[p.leadSource].premium += p.premium; }
    });
    const billRate = (a.totalCalls || 0) > 0 ? (a.billableCalls || 0) / a.totalCalls * 100 : 0;
    const rpc = (a.totalCalls || 0) > 0 ? (a.leadSpend || 0) / a.totalCalls : 0;
    return (
      <>
        <Breadcrumb items={[{ label: 'All Agents', onClick: () => setDrill(null) }, { label: drill }, ...(isSalaried(drill) ? [{ label: 'SALARY' }] : [])]} />
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <KPICard label="Apps" value={a.apps} />
          <KPICard label="Placed" value={a.placed} goal={getGoal(drill, 'policiesPlaced')} />
          <KPICard label="Premium" value={fmtDollar(a.premium, 2)} goal={getGoal(drill, 'premiumTarget')} subtitle={`Avg: ${fmtDollar(a.placed > 0 ? a.premium / a.placed : 0, 2)}`} />
          <KPICard label="Gross Adv Rev" value={fmtDollar(a.gar)} />
          {isSalaried(drill)
            ? <KPICard label="Commission" value="Salary" subtitle="No commission owed" />
            : <KPICard label="Commission" value={fmtDollar(a.commission)} />}
          <KPICard label="Bill %" value={fmtPct(billRate)} />
          <KPICard label="RPC" value={fmtDollar(rpc, 2)} />
        </div>
        <Section title="By Carrier">
          <SortableTable defaultSort="premium" columns={[
            { key: 'carrier', label: 'Carrier', align: 'left', bold: true, mono: false },
            { key: 'apps', label: 'Apps' }, { key: 'placed', label: 'Placed', color: r => r.placed > 0 ? C.green : C.muted },
            { key: 'premium', label: 'Premium', render: r => fmtDollar(r.premium, 2), color: () => C.green },
            { key: 'avgPrem', label: 'Avg Prem', render: r => r.apps > 0 ? fmtDollar(r.premium / r.apps, 2) : '—' },
            { key: 'commission', label: 'Commission', render: r => fmtDollar(r.commission), color: () => C.accent },
            { key: 'gar', label: 'Gross Adv Rev', render: r => fmtDollar(r.gar), color: () => C.green },
          ]} rows={Object.values(carrierMap)} />
        </Section>
        <Section title="By Lead Source">
          <SortableTable defaultSort="premium" columns={[
            { key: 'leadSource', label: 'Source', align: 'left', bold: true, mono: false },
            { key: 'apps', label: 'Apps' }, { key: 'placed', label: 'Placed', color: r => r.placed > 0 ? C.green : C.muted },
            { key: 'premium', label: 'Premium', render: r => fmtDollar(r.premium, 2), color: () => C.green },
            { key: 'avgPrem', label: 'Avg Prem', render: r => r.apps > 0 ? fmtDollar(r.premium / r.apps, 2) : '—' },
          ]} rows={Object.values(sourceMap)} />
        </Section>
        <Section title="Recent Policies — Commission Verification">
          <SortableTable defaultSort="submitDate" columns={[
            { key: 'submitDate', label: 'Date', align: 'left', bold: true },
            { key: 'carrier', label: 'Carrier', align: 'left', mono: false },
            { key: 'product', label: 'Product', align: 'left', mono: false, color: () => C.muted },
            { key: 'age', label: 'Age' },
            { key: 'premium', label: 'Premium', render: r => fmtDollar(r.premium, 2), color: () => C.green },
            { key: 'commissionRate', label: 'Rate', render: r => r.isSalaried ? 'Salary' : r.commissionRate > 0 ? (r.commissionRate * 100).toFixed(0) + '%' : '—', color: r => r.isSalaried ? C.muted : C.accent },
            { key: 'commission', label: 'Commission $', render: r => r.isSalaried ? '$0' : fmtDollar(r.commission, 2), color: r => r.isSalaried ? C.muted : C.yellow },
            { key: 'placed', label: 'Status', align: 'left', mono: false, color: r => r.placed === 'Declined' ? C.red : r.placed.includes('Active') || r.placed.includes('Advance') ? C.green : C.yellow },
          ]} rows={ap} />
        </Section>
      </>
    );
  }
  return (
    <>
    <GoalComparison policies={policies} calls={calls} pnl={pnl} goals={goals} dateRange={dateRange} />
    <VirtualAgentTiles vaData={vaData} policies={policies} goals={goals} dateRange={dateRange} />
    <Section title="Agent Rankings" rightContent={<span style={{ fontSize: 10, color: C.muted }}>Click a row to drill down</span>}>
      <SortableTable defaultSort="premium" onRowClick={r => r.agent !== 'TOTAL' && setDrill(r.agent)} totalsRow={agentTotals} columns={[
        { key: 'agent', label: 'Agent', align: 'left', bold: true, mono: false, render: r => <span>{r.agent}{isSalaried(r.agent) && <SalaryBadge />}</span> },
        { key: 'apps', label: 'Apps' }, { key: 'placed', label: 'Placed', color: r => r.placed > 0 ? C.green : C.muted },
        { key: 'premium', label: 'Mo. Prem', render: r => fmtDollar(r.premium, 2), color: () => C.green, bold: true },
        { key: 'avgPrem', label: 'Avg Prem', render: r => r.apps > 0 ? fmtDollar(r.premium / r.apps, 2) : '—' },
        { key: 'premGoal', label: 'Prem Goal', render: r => r.agent === 'TOTAL' ? '' : <ProgressBar value={r.premium} goal={getGoal(r.agent, 'premiumTarget')} />, sortable: false },
        { key: 'commission', label: 'Commission', render: r => isSalaried(r.agent) ? <span style={{ color: C.muted }}>Salary</span> : fmtDollar(r.commission), color: r => isSalaried(r.agent) ? C.muted : C.accent },
        { key: 'gar', label: 'Gross Adv', render: r => fmtDollar(r.gar), color: () => C.green },
        { key: 'totalCalls', label: 'Calls', render: r => fmt(r.totalCalls || 0) },
        { key: 'billRate', label: 'Bill %', render: r => (r.totalCalls || 0) > 0 ? fmtPct((r.billableCalls || 0) / r.totalCalls * 100) : '—' },
        { key: 'rpc', label: 'RPC', render: r => (r.totalCalls || 0) > 0 ? fmtDollar((r.leadSpend || 0) / r.totalCalls, 2) : '—' },
        { key: 'placementRate', label: 'Place %', render: r => r.apps > 0 ? fmtPct(r.placed / r.apps * 100) : '—' },
      ]} rows={agentRows} />
    </Section>
    </>
  );
}

// ─── CARRIERS TAB ────────────────────────────────────
function CarriersTab({ policies, goals, calls, dateRange, pnl, allTimePolicies, vaData, voiceDrillTarget, clearVoiceDrill }) {
  const [drill, setDrill] = useState(null);
  useEffect(() => {
    if (voiceDrillTarget?.type === 'carrier' && voiceDrillTarget?.name) {
      setDrill(voiceDrillTarget.name);
      if (clearVoiceDrill) clearVoiceDrill();
    }
  }, [voiceDrillTarget, clearVoiceDrill]);

  // Group by Carrier + Product + Payout
  const carrierMap = {};
  policies.forEach(p => {
    const key = [p.carrier, p.product].join('|||');
    if (!carrierMap[key]) carrierMap[key] = { key, carrier: p.carrier || '—', product: p.product || '—', apps: 0, placed: 0, premium: 0, commission: 0, faceAmount: 0, gar: 0, agents: new Set(), states: new Set() };
    carrierMap[key].apps++; carrierMap[key].agents.add(p.agent); carrierMap[key].states.add(p.state); carrierMap[key].gar += p.grossAdvancedRevenue;
    if (isPlaced(p)) { carrierMap[key].placed++; carrierMap[key].premium += p.premium; carrierMap[key].commission += p.commission; carrierMap[key].faceAmount += p.faceAmount; }
  });
  const carrierRows = Object.values(carrierMap).map(c => ({ ...c, agentCount: c.agents.size, stateCount: c.states.size })).sort((a, b) => b.premium - a.premium);

  const carrierTotals = useMemo(() => {
    const t = { key: 'TOTAL', carrier: 'TOTAL', product: '', apps: 0, placed: 0, premium: 0, commission: 0, faceAmount: 0, gar: 0, agentCount: 0, stateCount: 0 };
    carrierRows.forEach(c => { t.apps += c.apps; t.placed += c.placed; t.premium += c.premium; t.commission += c.commission; t.faceAmount += c.faceAmount; t.gar += c.gar; });
    return t;
  }, [carrierRows]);

  if (drill) {
    const carrier = carrierMap[drill]; if (!carrier) { setDrill(null); return null; }
    const cp = policies.filter(p => [p.carrier, p.product].join('|||') === drill);
    const agentMap = {};
    cp.forEach(p => {
      if (!agentMap[p.agent]) agentMap[p.agent] = { agent: p.agent, apps: 0, placed: 0, premium: 0, commission: 0, gar: 0 };
      agentMap[p.agent].apps++; agentMap[p.agent].gar += p.grossAdvancedRevenue; if (isPlaced(p)) { agentMap[p.agent].placed++; agentMap[p.agent].premium += p.premium; agentMap[p.agent].commission += p.commission; }
    });
    return (
      <>
        <Breadcrumb items={[{ label: 'All Carriers', onClick: () => setDrill(null) }, { label: `${carrier.carrier} · ${carrier.product}` }]} />
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <KPICard label="Apps" value={carrier.apps} />
          <KPICard label="Placed" value={carrier.placed} />
          <KPICard label="Premium" value={fmtDollar(carrier.premium, 2)} subtitle={`Avg: ${fmtDollar(carrier.placed > 0 ? carrier.premium / carrier.placed : 0, 2)}`} />
          <KPICard label="Gross Adv Rev" value={fmtDollar(carrier.gar)} />
          <KPICard label="Commission" value={fmtDollar(carrier.commission)} />
          <KPICard label="Place %" value={fmtPct(carrier.apps > 0 ? carrier.placed / carrier.apps * 100 : 0)} />
        </div>
        <Section title="By Agent">
          <SortableTable defaultSort="premium" columns={[
            { key: 'agent', label: 'Agent', align: 'left', bold: true, mono: false },
            { key: 'apps', label: 'Apps' }, { key: 'placed', label: 'Placed', color: r => r.placed > 0 ? C.green : C.muted },
            { key: 'premium', label: 'Premium', render: r => fmtDollar(r.premium, 2), color: () => C.green },
            { key: 'avgPrem', label: 'Avg Prem', render: r => r.apps > 0 ? fmtDollar(r.premium / r.apps, 2) : '—' },
            { key: 'commission', label: 'Commission', render: r => fmtDollar(r.commission), color: () => C.accent },
          ]} rows={Object.values(agentMap)} />
        </Section>
        <Section title="Policies">
          <SortableTable defaultSort="submitDate" columns={[
            { key: 'submitDate', label: 'Date', align: 'left', bold: true },
            { key: 'agent', label: 'Agent', align: 'left', mono: false },
            { key: 'faceAmount', label: 'Face', render: r => fmtDollar(r.faceAmount) },
            { key: 'premium', label: 'Premium', render: r => fmtDollar(r.premium, 2), color: () => C.green },
            { key: 'placed', label: 'Status', align: 'left', mono: false, color: r => r.placed === 'Declined' ? C.red : isPlaced(r) ? C.green : C.yellow },
            { key: 'state', label: 'State' },
          ]} rows={cp} />
        </Section>
      </>
    );
  }
  return (
    <>
    <GoalComparison policies={policies} calls={calls} pnl={pnl} goals={goals} dateRange={dateRange} />
    <VirtualAgentTiles vaData={vaData} policies={policies} goals={goals} dateRange={dateRange} />
    <Section title="Carrier / Product Overview" rightContent={<span style={{ fontSize: 10, color: C.muted }}>Click a row to drill down</span>}>
      <SortableTable defaultSort="premium" onRowClick={r => r.key !== 'TOTAL' && setDrill(r.key)} totalsRow={carrierTotals} columns={[
        { key: 'carrier', label: 'Carrier', align: 'left', bold: true, mono: false },
        { key: 'product', label: 'Product', align: 'left', mono: false },
        { key: 'apps', label: 'Apps' }, { key: 'placed', label: 'Placed', color: r => r.placed > 0 ? C.green : C.muted },
        { key: 'premium', label: 'Mo. Prem', render: r => fmtDollar(r.premium, 2), color: () => C.green, bold: true },
        { key: 'avgPrem', label: 'Avg Prem', render: r => r.apps > 0 ? fmtDollar(r.premium / r.apps, 2) : '—' },
        { key: 'commission', label: 'Commission', render: r => fmtDollar(r.commission), color: () => C.accent },
        { key: 'gar', label: 'Gross Adv', render: r => fmtDollar(r.gar), color: () => C.green },
        { key: 'netRev', label: 'Net Rev', render: r => { const n = r.gar - r.commission; return fmtDollar(n); }, color: r => (r.gar - r.commission) > 0 ? C.green : C.red },
        { key: 'placementRate', label: 'Place %', render: r => r.apps > 0 ? fmtPct(r.placed / r.apps * 100) : '—' },
        { key: 'avgFace', label: 'Avg Face', render: r => r.placed > 0 ? fmtDollar(r.faceAmount / r.placed) : '—' },
        { key: 'agentCount', label: 'Agents' }, { key: 'stateCount', label: 'States' },
      ]} rows={carrierRows} />
    </Section>
    </>
  );
}

// ─── P&L TAB ─────────────────────────────────────────
function PnlTab({ pnl, policies, calls, goals, allTimePolicies, dateRange, vaData }) {
  const placed = policies.filter(isPlaced);
  const totalPremium = policies.reduce((s, p) => s + p.premium, 0);
  const totalComm = policies.reduce((s, p) => s + p.commission, 0);
  const totalGAR = policies.reduce((s, p) => s + p.grossAdvancedRevenue, 0);
  const totalSpend = pnl.reduce((s, p) => s + p.leadSpend, 0);
  const totalCalls = calls.length;
  const billable = calls.filter(c => c.isBillable).length;
  const cg = goals?.company || {};
  const cpa = policies.length > 0 ? totalSpend / policies.length : 0;
  const rpc = totalCalls > 0 ? totalSpend / totalCalls : 0;
  const billableRate = totalCalls > 0 ? billable / totalCalls * 100 : 0;
  const netRev = totalGAR - totalSpend - totalComm;

  return (
    <>
      <GoalComparison policies={policies} calls={calls} pnl={pnl} goals={goals} dateRange={dateRange} allTimePolicies={allTimePolicies || []} />
      <VirtualAgentTiles vaData={vaData} policies={policies} goals={goals} dateRange={dateRange} />
      <Section title="Publisher P&L Detail">
        <SortableTable defaultSort="netRevenue" columns={[
          { key: 'campaign', label: 'Publisher', align: 'left', bold: true, mono: false },
          { key: 'vendor', label: 'Vendor', align: 'left', mono: false, color: () => C.muted },
          { key: 'totalCalls', label: 'Calls' }, { key: 'billableCalls', label: 'Billable' },
          { key: 'billableRate', label: 'Bill %', render: r => fmtPct(r.billableRate) },
          { key: 'pricePerCall', label: '$/Call', render: r => r.pricePerCall > 0 ? fmtDollar(r.pricePerCall) : '—' },
          { key: 'leadSpend', label: 'Spend', render: r => fmtDollar(r.leadSpend), color: r => r.leadSpend > 0 ? C.yellow : C.muted },
          { key: 'rpc', label: 'RPC', render: r => r.totalCalls > 0 ? fmtDollar(r.rpc, 2) : '—' },
          { key: 'placedCount', label: 'Sales', color: r => (r.placedCount || 0) > 0 ? C.green : C.muted },
          { key: 'closeRate', label: 'Close %', render: r => fmtPct(r.closeRate) },
          { key: 'cpa', label: 'CPA', render: r => r.cpa > 0 ? fmtDollar(r.cpa) : '—', color: r => goalColor(r.cpa, cg.cpa, true) },
          { key: 'totalPremium', label: 'Mo. Prem', render: r => fmtDollar(r.totalPremium, 2), color: r => r.totalPremium > 0 ? C.green : C.muted },
          { key: 'avgPremium', label: 'Avg Prem', render: r => fmtDollar(r.avgPremium, 2) },
          { key: 'grossAdvancedRevenue', label: 'Gross Adv', render: r => fmtDollar(r.grossAdvancedRevenue) },
          { key: 'totalCommission', label: 'Comm', render: r => fmtDollar(r.totalCommission), color: () => C.accent },
          { key: 'netRevenue', label: 'Net Rev', render: r => fmtDollar(r.netRevenue), color: r => r.netRevenue > 0 ? C.green : C.red, bold: true },
        ]} rows={pnl} />
      </Section>
    </>
  );
}




// ─── COMMISSIONS TAB ────────────────────────────────
function CommissionsTab({ policies }) {
  const [drill, setDrill] = useState(null);

  // Aggregate all submitted policies by submit date
  const byDay = {};
  policies.forEach(p => {
    if (!byDay[p.submitDate]) byDay[p.submitDate] = { date: p.submitDate, policies: [], totalPremium: 0, totalCommission: 0, agentSet: new Set() };
    byDay[p.submitDate].policies.push(p);
    byDay[p.submitDate].totalPremium += p.premium;
    byDay[p.submitDate].totalCommission += p.commission;
    byDay[p.submitDate].agentSet.add(p.agent);
  });

  const days = Object.values(byDay)
    .map(d => ({
      date: d.date, policies: d.policies, count: d.policies.length,
      totalPremium: d.totalPremium, totalCommission: d.totalCommission,
      avgRate: d.totalPremium > 0 ? d.totalCommission / d.totalPremium * 100 : 0,
      agents: [...d.agentSet].join(', '),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const totalPolicies = policies.length;
  const totalPremium = policies.reduce((s, p) => s + p.premium, 0);
  const totalCommission = policies.reduce((s, p) => s + p.commission, 0);
  const overallAvgRate = totalPremium > 0 ? totalCommission / totalPremium * 100 : 0;
  const commAgentCount = new Set(policies.filter(p => !p.isSalaried && p.commission > 0).map(p => p.agent)).size;
  const salaryAgentCount = new Set(policies.filter(p => p.isSalaried).map(p => p.agent)).size;

  // ── Drill-down: single day ────────────────────────
  if (drill) {
    const dp = drill.policies;
    const dayPrem = dp.reduce((s, p) => s + p.premium, 0);
    const dayComm = dp.reduce((s, p) => s + p.commission, 0);
    const totalsRow = {
      agent: 'TOTAL', firstName: '', lastName: '', carrier: '', product: '', age: '',
      premium: dayPrem,
      commissionRate: dayPrem > 0 ? dayComm / dayPrem : 0,
      commission: dayComm,
      placed: '', isSalaried: false,
    };
    return (
      <>
        <Breadcrumb items={[{ label: 'All Days', onClick: () => setDrill(null) }, { label: drill.date }]} />
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <KPICard label="Policies" value={dp.length} />
          <KPICard label="Total Premium" value={fmtDollar(dayPrem, 2)} />
          <KPICard label="Commission Owed" value={fmtDollar(dayComm, 2)} />
          <KPICard label="Avg Rate" value={dayPrem > 0 ? (dayComm / dayPrem * 100).toFixed(0) + '%' : '—'} />
        </div>
        <Section title={`Commission Detail — ${drill.date}`}>
          <SortableTable defaultSort="agent" columns={[
            { key: 'agent', label: 'Agent', align: 'left', mono: false },
            { key: 'firstName', label: 'First', align: 'left', mono: false },
            { key: 'lastName', label: 'Last', align: 'left', mono: false },
            { key: 'carrier', label: 'Carrier', align: 'left', mono: false, color: () => C.muted },
            { key: 'product', label: 'Product', align: 'left', mono: false, color: () => C.muted },
            { key: 'age', label: 'Age' },
            { key: 'premium', label: 'Premium', render: r => fmtDollar(r.premium, 2), color: () => C.green },
            { key: 'commissionRate', label: 'Rate', render: r => r.isSalaried ? 'Salary' : r.commissionRate > 0 ? (r.commissionRate * 100).toFixed(0) + '%' : '—', color: r => r.isSalaried ? C.muted : C.accent },
            { key: 'commission', label: 'Commission $', render: r => r.isSalaried ? '$0' : fmtDollar(r.commission, 2), color: r => r.isSalaried ? C.muted : C.yellow },
            { key: 'placed', label: 'Status', align: 'left', mono: false, color: r => !r.placed ? C.muted : r.placed === 'Declined' ? C.red : r.placed.includes('Active') || r.placed.includes('Advance') ? C.green : C.yellow },
          ]} rows={dp} totalsRow={totalsRow} />
        </Section>
      </>
    );
  }

  // ── Summary totals row ────────────────────────────
  const summaryTotalsRow = {
    date: 'TOTAL', count: totalPolicies, totalPremium,
    avgRate: overallAvgRate, totalCommission,
    agents: commAgentCount + ' agent' + (commAgentCount !== 1 ? 's' : ''),
  };

  return (
    <>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <KPICard label="Total Commission" value={fmtDollar(totalCommission, 2)} />
        <KPICard label="Total Premium" value={fmtDollar(totalPremium, 2)} />
        <KPICard label="Avg Rate" value={overallAvgRate.toFixed(0) + '%'} />
        <KPICard label="Commission Agents" value={commAgentCount} />
        {salaryAgentCount > 0 && <KPICard label="Salary Agents" value={salaryAgentCount} subtitle="$0 commission" />}
      </div>
      <Section title="Daily Commission Summary" rightContent={<span style={{ fontSize: 10, color: C.muted }}>Click a row for policy detail</span>}>
        <SortableTable defaultSort="date" onRowClick={r => r.date !== 'TOTAL' && setDrill(r)} columns={[
          { key: 'date', label: 'Date', align: 'left', bold: true },
          { key: 'count', label: 'Policies' },
          { key: 'totalPremium', label: 'Total Premium', render: r => fmtDollar(r.totalPremium, 2), color: () => C.green },
          { key: 'avgRate', label: 'Avg Rate', render: r => r.avgRate > 0 ? r.avgRate.toFixed(0) + '%' : '—', color: () => C.accent },
          { key: 'totalCommission', label: 'Commission $', render: r => fmtDollar(r.totalCommission, 2), color: () => C.yellow },
          { key: 'agents', label: 'Agents', align: 'left', mono: false, color: () => C.muted },
        ]} rows={days} totalsRow={summaryTotalsRow} />
      </Section>
    </>
  );
}

// ─── POLICIES TAB ───────────────────────────────────
function PoliciesTab({ policies }) {
  const [drill, setDrill] = useState(null);
  const sorted = [...policies].sort((a, b) => (b.submitDate || '').localeCompare(a.submitDate || ''));

  if (drill) {
    const p = drill;
    const fields = [
      ['Agent', p.agent], ['Lead Source', p.leadSource],
      ['Submit Date', p.submitDate], ['Effective Date', p.effectiveDate],
      ['Carrier', p.carrier], ['Product', p.product],
      ['Face Amount', fmtDollar(p.faceAmount)], ['Monthly Premium', fmtDollar(p.premium, 2)],
      ['Commission', fmtDollar(p.commission)], ['Gross Adv Revenue', fmtDollar(p.grossAdvancedRevenue)],
      ['Outcome', p.outcome], ['Status', p.placed],
      ['Payment Type', p.paymentType], ['Payment Frequency', p.paymentFrequency],
      ['SSN Billing Match', p.ssnMatch],
      ['First Name', p.firstName], ['Last Name', p.lastName],
      ['Gender', p.gender], ['Date of Birth', p.dob],
      ['Phone', p.phone], ['Email', p.email],
      ['Address', [p.address, p.city, p.state, p.zip].filter(Boolean).join(', ')],
      ['Text Friendly', p.textFriendly],
      ['Policy #', p.policyNumber],
    ];
    return (
      <>
        <Breadcrumb items={[{ label: 'All Policies', onClick: () => setDrill(null) }, { label: `${p.firstName || ''} ${p.lastName || ''} — ${p.carrier}` }]} />
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <KPICard label="Monthly Premium" value={fmtDollar(p.premium, 2)} />
          <KPICard label="Face Amount" value={fmtDollar(p.faceAmount)} />
          <KPICard label="Commission" value={fmtDollar(p.commission)} />
          <KPICard label="Gross Adv Revenue" value={fmtDollar(p.grossAdvancedRevenue)} />
        </div>
        <Section title="Policy Details">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 1, padding: 1, background: C.border }}>
            {fields.map(([label, val]) => (
              <div key={label} style={{ background: C.card, padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>{label}</span>
                <span style={{ fontSize: 13, color: C.text, fontFamily: C.mono, fontWeight: 500 }}>{val || '—'}</span>
              </div>
            ))}
          </div>
        </Section>
      </>
    );
  }

  const placed = sorted.filter(isPlaced);
  const totalPrem = placed.reduce((s, p) => s + p.premium, 0);
  const totalFace = placed.reduce((s, p) => s + p.faceAmount, 0);
  const totalGAR = policies.reduce((s, p) => s + p.grossAdvancedRevenue, 0);
  const totalComm = placed.reduce((s, p) => s + p.commission, 0);

  return (
    <>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <KPICard label="Total Policies" value={sorted.length} subtitle={`${placed.length} placed`} />
        <KPICard label="Total Premium" value={fmtDollar(totalPrem, 2)} subtitle={`Avg: ${fmtDollar(placed.length > 0 ? totalPrem / placed.length : 0, 2)}`} />
        <KPICard label="Total Face" value={fmtDollar(totalFace)} />
        <KPICard label="Gross Adv Revenue" value={fmtDollar(totalGAR)} />
        <KPICard label="Total Commission" value={fmtDollar(totalComm)} />
      </div>
      <Section title="All Policies" rightContent={<span style={{ fontSize: 10, color: C.muted }}>Click a row for full details</span>}>
        <SortableTable defaultSort="submitDate" onRowClick={r => setDrill(r)} columns={[
          { key: 'submitDate', label: 'Submit Date', align: 'left', bold: true },
          { key: 'firstName', label: 'First', align: 'left', mono: false },
          { key: 'lastName', label: 'Last', align: 'left', mono: false },
          { key: 'gender', label: 'Gender', align: 'left', mono: false, color: () => C.muted },
          { key: 'dob', label: 'DOB', align: 'left', mono: false, color: () => C.muted },
          { key: 'phone', label: 'Phone', align: 'left' },
          { key: 'email', label: 'Email', align: 'left', mono: false, color: () => C.muted },
          { key: 'city', label: 'City', align: 'left', mono: false, color: () => C.muted },
          { key: 'state', label: 'State' },
          { key: 'zip', label: 'Zip', align: 'left', mono: false, color: () => C.muted },
          { key: 'textFriendly', label: 'Text OK', align: 'left', mono: false, color: r => (r.textFriendly || '').toLowerCase() === 'yes' ? C.green : C.muted },
          { key: 'agent', label: 'Agent', align: 'left', mono: false },
          { key: 'carrier', label: 'Carrier', align: 'left', mono: false },
          { key: 'product', label: 'Product', align: 'left', mono: false, color: () => C.muted },
          { key: 'termLength', label: 'Term', align: 'left', mono: false, color: () => C.muted },
          { key: 'faceAmount', label: 'Face', render: r => fmtDollar(r.faceAmount) },
          { key: 'premium', label: 'Premium', render: r => fmtDollar(r.premium, 2), color: () => C.green },
          { key: 'paymentType', label: 'Pay Type', align: 'left', mono: false, color: () => C.muted },
          { key: 'policyNumber', label: 'Policy #', align: 'left' },
          { key: 'effectiveDate', label: 'Eff Date', align: 'left' },
          { key: 'placed', label: 'Status', align: 'left', mono: false, color: r => isPlaced(r) ? C.green : r.placed === 'Declined' ? C.red : C.yellow },
          { key: 'leadSource', label: 'Source', align: 'left', mono: false, color: () => C.muted },
        ]} rows={sorted} />
      </Section>
    </>
  );
}
// ─── POLICY STATUS TAB ──────────────────────────────
function PolicyStatusTab({ policies, calls }) {
  const [period, setPeriod] = useState('weekly');
  const [subTab, setSubTab] = useState('period'); // 'period' | 'aging'
  const [drillPeriod, setDrillPeriod] = useState(null);
  const [drillPolicy, setDrillPolicy] = useState(null);

  const classify = p => {
    const s = p.placed;
    if (s === 'Advance Released' || s === 'Active - In Force') return 'active';
    if (s === 'Submitted - Pending') return 'pending';
    return 'left';
  };

  // Phone → best call map for per-policy lead cost lookup
  const phoneCallMap = useMemo(() => {
    const map = {};
    (calls || []).forEach(c => {
      if (!c.phone) return;
      const ex = map[c.phone];
      if (!ex || (c.isBillable && !ex.isBillable)) map[c.phone] = c;
    });
    return map;
  }, [calls]);

  const getLeadCost = p => phoneCallMap[p.phone]?.cost || 0;

  const AGE_BUCKETS = [
    { label: '0–7d',   min: 0,  max: 7 },
    { label: '8–30d',  min: 8,  max: 30 },
    { label: '31–60d', min: 31, max: 60 },
    { label: '61–90d', min: 61, max: 90 },
    { label: '90+d',   min: 91, max: Infinity },
  ];
  const policyAge = dateStr => {
    if (!dateStr) return null;
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return null;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  };
  const getAgeBucketLabel = days => {
    if (days === null) return null;
    return AGE_BUCKETS.find(b => days >= b.min && days <= b.max)?.label || null;
  };

  const getPeriodKey = (dateStr) => {
    if (!dateStr) return 'Unknown';
    if (period === 'daily') return dateStr;
    if (period === 'monthly') return dateStr.slice(0, 7);
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return 'Unknown';
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
  };

  const formatPeriodLabel = (key) => {
    if (key === 'Unknown') return 'Unknown';
    if (period === 'monthly') {
      const [y, m] = key.split('-');
      return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
    }
    if (period === 'weekly') {
      const start = new Date(key + 'T00:00:00');
      if (isNaN(start.getTime())) return key;
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      const f = d => d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
      return `${f(start)} – ${f(end)}, ${start.getFullYear()}`;
    }
    return key;
  };

  const grouped = useMemo(() => {
    const map = {};
    policies.forEach(p => {
      const key = getPeriodKey(p.submitDate);
      if (!map[key]) map[key] = { key, items: [] };
      map[key].items.push(p);
    });
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policies, period]);

  const periodRows = useMemo(() => {
    return Object.values(grouped).map(({ key, items }) => {
      const active = items.filter(p => classify(p) === 'active');
      const pending = items.filter(p => classify(p) === 'pending');
      const left = items.filter(p => classify(p) === 'left');
      const premium = active.reduce((s, p) => s + p.premium, 0);
      const billed = items.filter(p => classify(p) !== 'left');
      const grossRevenue = billed.reduce((s, p) => s + p.grossAdvancedRevenue, 0);
      const commission = billed.reduce((s, p) => s + p.commission, 0);
      const leadCost = items.reduce((s, p) => s + getLeadCost(p), 0);
      const netRevenue = grossRevenue - commission - leadCost;
      const retention = (active.length + left.length) > 0 ? active.length / (active.length + left.length) * 100 : 0;
      return { key, label: formatPeriodLabel(key), total: items.length, active: active.length, pending: pending.length, left: left.length, premium, grossRevenue, commission, leadCost, netRevenue, retention, _sortKey: key };
    }).sort((a, b) => b._sortKey.localeCompare(a._sortKey));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grouped, phoneCallMap]);

  const totals = useMemo(() => {
    const active = policies.filter(p => classify(p) === 'active');
    const pending = policies.filter(p => classify(p) === 'pending');
    const left = policies.filter(p => classify(p) === 'left');
    const billed = policies.filter(p => classify(p) !== 'left');
    const grossRevenue = billed.reduce((s, p) => s + p.grossAdvancedRevenue, 0);
    const commission = billed.reduce((s, p) => s + p.commission, 0);
    const leadCost = policies.reduce((s, p) => s + getLeadCost(p), 0);
    return {
      total: policies.length,
      active: active.length,
      pending: pending.length,
      left: left.length,
      premium: active.reduce((s, p) => s + p.premium, 0),
      grossRevenue,
      commission,
      leadCost,
      netRevenue: grossRevenue - commission - leadCost,
      retention: (active.length + left.length) > 0 ? active.length / (active.length + left.length) * 100 : 0,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policies, phoneCallMap]);

  // Non-active policies (pending + left) enriched with age in days
  const nonActivePolicies = useMemo(() => {
    return policies
      .filter(p => classify(p) !== 'active')
      .map(p => ({ ...p, ageDays: policyAge(p.submitDate) }))
      .sort((a, b) => (b.ageDays || 0) - (a.ageDays || 0));
  }, [policies]); // eslint-disable-line react-hooks/exhaustive-deps

  // Aging matrix: status × age-bucket → { count, grossRevenue, commission, leadCost }
  const agingMatrix = useMemo(() => {
    const statuses = ['active', 'pending', 'left'];
    const empty = () => ({ count: 0, grossRevenue: 0, commission: 0, leadCost: 0 });
    const matrix = {};
    statuses.forEach(s => {
      matrix[s] = {};
      AGE_BUCKETS.forEach(b => { matrix[s][b.label] = empty(); });
      matrix[s]['Total'] = empty();
    });
    matrix['Total'] = {};
    AGE_BUCKETS.forEach(b => { matrix['Total'][b.label] = empty(); });
    matrix['Total']['Total'] = empty();

    policies.forEach(p => {
      const s = classify(p);
      const days = policyAge(p.submitDate);
      const bucket = getAgeBucketLabel(days);
      if (!bucket) return;
      const gr = s !== 'left' ? p.grossAdvancedRevenue : 0;
      const cm = s !== 'left' ? p.commission : 0;
      const lc = getLeadCost(p);
      for (const key of [bucket, 'Total']) {
        matrix[s][key].count++;
        matrix[s][key].grossRevenue += gr;
        matrix[s][key].commission += cm;
        matrix[s][key].leadCost += lc;
        matrix['Total'][key].count++;
        matrix['Total'][key].grossRevenue += gr;
        matrix['Total'][key].commission += cm;
        matrix['Total'][key].leadCost += lc;
      }
    });
    return matrix;
  }, [policies, phoneCallMap]); // eslint-disable-line react-hooks/exhaustive-deps

  const statusColor = p => {
    const c = classify(p);
    return c === 'active' ? C.green : c === 'pending' ? C.yellow : C.red;
  };

  const pillStyle = (active) => ({
    padding: '5px 14px', borderRadius: 20, fontSize: 11, fontWeight: 600,
    cursor: 'pointer', border: 'none',
    background: active ? C.accent : C.border, color: active ? '#fff' : C.muted,
  });

  const policyColumns = [
    { key: 'placed', label: 'Status', align: 'left', mono: false, color: r => statusColor(r), bold: true },
    { key: 'submitDate', label: 'Submit Date', align: 'left' },
    { key: 'agent', label: 'Agent', align: 'left', mono: false },
    { key: 'firstName', label: 'First', align: 'left', mono: false },
    { key: 'lastName', label: 'Last', align: 'left', mono: false },
    { key: 'carrier', label: 'Carrier', align: 'left', mono: false },
    { key: 'product', label: 'Product', align: 'left', mono: false, color: () => C.muted },
    { key: 'premium', label: 'Premium', render: r => fmtDollar(r.premium, 2), color: r => classify(r) === 'active' ? C.green : C.muted },
    { key: 'grossAdvancedRevenue', label: 'Gross Rev', render: r => fmtDollar(r.grossAdvancedRevenue), color: r => classify(r) === 'active' ? C.green : C.muted },
    { key: 'commission', label: 'Commission', render: r => fmtDollar(r.commission), color: () => C.yellow },
    { key: '_leadCost', label: 'Lead Cost', render: r => fmtDollar(getLeadCost(r)), color: () => C.muted },
    { key: '_netRevenue', label: 'Net Revenue', render: r => { const n = r.grossAdvancedRevenue - r.commission - getLeadCost(r); return fmtDollar(n); }, color: r => { const n = r.grossAdvancedRevenue - r.commission - getLeadCost(r); return n >= 0 ? C.green : C.red; } },
    { key: 'faceAmount', label: 'Face', render: r => fmtDollar(r.faceAmount) },
    { key: 'leadSource', label: 'Source', align: 'left', mono: false, color: () => C.muted },
    { key: 'effectiveDate', label: 'Eff Date', align: 'left' },
    { key: 'policyNumber', label: 'Policy #', align: 'left' },
    { key: 'phone', label: 'Phone', align: 'left' },
    { key: 'state', label: 'State' },
  ];

  // Policy detail view
  if (drillPolicy) {
    const p = drillPolicy;
    const periodLabel = drillPeriod ? formatPeriodLabel(drillPeriod) : null;
    const leadCost = getLeadCost(p);
    const netRevenue = p.grossAdvancedRevenue - p.commission - leadCost;
    const fields = [
      ['Agent', p.agent], ['Lead Source', p.leadSource],
      ['Submit Date', p.submitDate], ['Effective Date', p.effectiveDate],
      ['Carrier', p.carrier], ['Product', p.product],
      ['Face Amount', fmtDollar(p.faceAmount)], ['Monthly Premium', fmtDollar(p.premium, 2)],
      ['Gross Adv Revenue', fmtDollar(p.grossAdvancedRevenue)], ['Commission', fmtDollar(p.commission)],
      ['Lead Cost', fmtDollar(leadCost)], ['Net Revenue', fmtDollar(netRevenue)],
      ['Outcome', p.outcome], ['Status', p.placed],
      ['Payment Type', p.paymentType], ['Payment Frequency', p.paymentFrequency],
      ['SSN Billing Match', p.ssnMatch],
      ['First Name', p.firstName], ['Last Name', p.lastName],
      ['Gender', p.gender], ['Date of Birth', p.dob],
      ['Phone', p.phone], ['Email', p.email],
      ['Address', [p.address, p.city, p.state, p.zip].filter(Boolean).join(', ')],
      ['Text Friendly', p.textFriendly], ['Policy #', p.policyNumber],
    ];
    return (
      <>
        <Breadcrumb items={[
          { label: 'Policy Status', onClick: () => { setDrillPeriod(null); setDrillPolicy(null); } },
          ...(periodLabel ? [{ label: periodLabel, onClick: () => setDrillPolicy(null) }] : []),
          { label: `${p.firstName || ''} ${p.lastName || ''} — ${p.carrier}`.trim() },
        ]} />
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <KPICard label="Monthly Premium" value={fmtDollar(p.premium, 2)} />
          <KPICard label="Gross Adv Revenue" value={fmtDollar(p.grossAdvancedRevenue)} />
          <KPICard label="Commission" value={fmtDollar(p.commission)} />
          <KPICard label="Lead Cost" value={fmtDollar(leadCost)} />
          <KPICard label="Net Revenue" value={fmtDollar(netRevenue)} />
          <KPICard label="Face Amount" value={fmtDollar(p.faceAmount)} />
        </div>
        <Section title="Policy Details">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 1, padding: 1, background: C.border }}>
            {fields.map(([label, val]) => (
              <div key={label} style={{ background: C.card, padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>{label}</span>
                <span style={{ fontSize: 13, color: C.text, fontFamily: C.mono, fontWeight: 500 }}>{val || '—'}</span>
              </div>
            ))}
          </div>
        </Section>
      </>
    );
  }

  // Period drill-down view
  if (drillPeriod) {
    const group = grouped[drillPeriod];
    const ps = group?.items || [];
    const periodLabel = formatPeriodLabel(drillPeriod);
    const active = ps.filter(p => classify(p) === 'active');
    const pending = ps.filter(p => classify(p) === 'pending');
    const left = ps.filter(p => classify(p) === 'left');
    const prem = active.reduce((s, p) => s + p.premium, 0);
    const billed = ps.filter(p => classify(p) !== 'left');
    const grossRev = billed.reduce((s, p) => s + p.grossAdvancedRevenue, 0);
    const comm = billed.reduce((s, p) => s + p.commission, 0);
    const lCost = ps.reduce((s, p) => s + getLeadCost(p), 0);
    const netRev = grossRev - comm - lCost;
    const ret = (active.length + left.length) > 0 ? active.length / (active.length + left.length) * 100 : 0;
    return (
      <>
        <Breadcrumb items={[
          { label: 'Policy Status', onClick: () => setDrillPeriod(null) },
          { label: periodLabel },
        ]} />
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <KPICard label="Total Policies" value={fmt(ps.length)} />
          <KPICard label="Active / Placed" value={fmt(active.length)} />
          <KPICard label="Pending" value={fmt(pending.length)} />
          <KPICard label="Left" value={fmt(left.length)} />
          <KPICard label="Active Premium" value={fmtDollar(prem, 2)} />
          <KPICard label="Gross Revenue" value={fmtDollar(grossRev)} />
          <KPICard label="Commission" value={fmtDollar(comm)} />
          <KPICard label="Lead Cost" value={fmtDollar(lCost)} />
          <KPICard label="Net Revenue" value={fmtDollar(netRev)} />
          <KPICard label="Retention Rate" value={fmtPct(ret)} />
        </div>
        <Section title={`Policies — ${periodLabel}`} rightContent={<span style={{ fontSize: 10, color: C.muted }}>Click a row for full details</span>}>
          <SortableTable defaultSort="submitDate" onRowClick={r => setDrillPolicy(r)} columns={policyColumns} rows={ps} />
        </Section>
      </>
    );
  }

  // Columns for the non-active and period drill-down policy list (includes age)
  const nonActiveColumns = [
    { key: 'placed', label: 'Status', align: 'left', mono: false, color: r => statusColor(r), bold: true },
    { key: 'ageDays', label: 'Age (days)', render: r => r.ageDays != null ? fmt(r.ageDays) : '—', color: r => r.ageDays > 90 ? C.red : r.ageDays > 30 ? C.yellow : C.muted },
    { key: 'submitDate', label: 'Submit Date', align: 'left' },
    { key: 'agent', label: 'Agent', align: 'left', mono: false },
    { key: 'firstName', label: 'First', align: 'left', mono: false },
    { key: 'lastName', label: 'Last', align: 'left', mono: false },
    { key: 'carrier', label: 'Carrier', align: 'left', mono: false },
    { key: 'product', label: 'Product', align: 'left', mono: false, color: () => C.muted },
    { key: 'premium', label: 'Premium', render: r => fmtDollar(r.premium, 2), color: () => C.muted },
    { key: 'grossAdvancedRevenue', label: 'Gross Rev', render: r => fmtDollar(r.grossAdvancedRevenue), color: () => C.muted },
    { key: 'commission', label: 'Commission', render: r => fmtDollar(r.commission), color: () => C.yellow },
    { key: '_leadCost', label: 'Lead Cost', render: r => fmtDollar(getLeadCost(r)), color: () => C.muted },
    { key: '_netRevenue', label: 'Net Revenue', render: r => { const n = r.grossAdvancedRevenue - r.commission - getLeadCost(r); return fmtDollar(n); }, color: r => { const n = r.grossAdvancedRevenue - r.commission - getLeadCost(r); return n >= 0 ? C.green : C.red; } },
    { key: 'policyNumber', label: 'Policy #', align: 'left' },
  ];

  // Main view
  const STATUS_ROWS = [
    { key: 'active',  label: 'Active / Placed', color: C.green },
    { key: 'pending', label: 'Pending',          color: C.yellow },
    { key: 'left',    label: 'Left',             color: C.red },
    { key: 'Total',   label: 'Total',            color: C.accent },
  ];
  const BUCKET_COLS = [...AGE_BUCKETS.map(b => b.label), 'Total'];

  return (
    <>
      {/* Summary KPIs */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <KPICard label="Total Policies" value={fmt(totals.total)} />
        <KPICard label="Active / Placed" value={fmt(totals.active)} subtitle="Advance Released + In Force" />
        <KPICard label="Pending" value={fmt(totals.pending)} subtitle="Submitted - Pending" />
        <KPICard label="Left" value={fmt(totals.left)} subtitle="Lapsed, Cancelled, Declined" />
        <KPICard label="Active Premium" value={fmtDollar(totals.premium, 2)} />
        <KPICard label="Gross Revenue" value={fmtDollar(totals.grossRevenue)} />
        <KPICard label="Commission" value={fmtDollar(totals.commission)} />
        <KPICard label="Lead Cost" value={fmtDollar(totals.leadCost)} />
        <KPICard label="Net Revenue" value={fmtDollar(totals.netRevenue)} />
        <KPICard label="Retention Rate" value={fmtPct(totals.retention)} subtitle="Active ÷ (Active + Left)" />
      </div>

      {/* Sub-tab toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[['period', 'By Period'], ['waterfall', 'Waterfall'], ['aging', 'Aging Report']].map(([val, lbl]) => (
          <button key={val} style={pillStyle(subTab === val)} onClick={() => setSubTab(val)}>{lbl}</button>
        ))}
      </div>

      {subTab === 'period' && <>
        <Section title="Policy Status by Period" rightContent={
          <div style={{ display: 'flex', gap: 6 }}>
            {[['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']].map(([val, lbl]) => (
              <button key={val} style={pillStyle(period === val)} onClick={() => setPeriod(val)}>{lbl}</button>
            ))}
          </div>
        }>
          <SortableTable defaultSort="_sortKey" onRowClick={r => setDrillPeriod(r.key)} columns={[
            { key: 'label', label: 'Period', align: 'left', mono: false, sortable: false },
            { key: 'total', label: 'Total', render: r => fmt(r.total) },
            { key: 'active', label: 'Active', render: r => fmt(r.active), color: r => r.active > 0 ? C.green : C.muted },
            { key: 'pending', label: 'Pending', render: r => fmt(r.pending), color: r => r.pending > 0 ? C.yellow : C.muted },
            { key: 'left', label: 'Left', render: r => fmt(r.left), color: r => r.left > 0 ? C.red : C.muted },
            { key: 'premium', label: 'Premium', render: r => fmtDollar(r.premium, 2), color: r => r.premium > 0 ? C.green : C.muted },
            { key: 'grossRevenue', label: 'Gross Rev', render: r => fmtDollar(r.grossRevenue), color: r => r.grossRevenue > 0 ? C.green : C.muted },
            { key: 'commission', label: 'Commission', render: r => fmtDollar(r.commission), color: () => C.yellow },
            { key: 'leadCost', label: 'Lead Cost', render: r => fmtDollar(r.leadCost), color: () => C.muted },
            { key: 'netRevenue', label: 'Net Revenue', render: r => fmtDollar(r.netRevenue), color: r => r.netRevenue >= 0 ? C.green : C.red },
            { key: 'retention', label: 'Retention %', render: r => (r.active + r.left) > 0 ? fmtPct(r.retention) : '—', color: r => (r.active + r.left) > 0 ? (r.retention >= 80 ? C.green : r.retention >= 60 ? C.yellow : C.red) : C.muted },
          ]} rows={periodRows} />
        </Section>

        <Section title={`Non-Active Policies (${nonActivePolicies.length})`} rightContent={<span style={{ fontSize: 10, color: C.muted }}>Pending + Left · sorted by age · click for details</span>}>
          <SortableTable defaultSort="ageDays" onRowClick={r => setDrillPolicy(r)} columns={nonActiveColumns} rows={nonActivePolicies} />
        </Section>
      </>}

      {subTab === 'waterfall' && (() => {
        // Build weekly cohorts: columns = weeks (Mon–Sun), rows = status categories
        const weekMap = {};
        policies.forEach(p => {
          if (!p.submitDate) return;
          const d = new Date(p.submitDate + 'T00:00:00');
          if (isNaN(d.getTime())) return;
          const day = d.getDay();
          const diff = day === 0 ? -6 : 1 - day;
          d.setDate(d.getDate() + diff);
          const wk = d.toISOString().slice(0, 10);
          if (!weekMap[wk]) weekMap[wk] = [];
          weekMap[wk].push(p);
        });
        const weekKeys = Object.keys(weekMap).sort();
        const weekLabels = weekKeys.map(wk => {
          const start = new Date(wk + 'T00:00:00');
          const end = new Date(start); end.setDate(end.getDate() + 6);
          const f = d => d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
          return f(start) + ' –\n' + f(end);
        });

        // Count helpers per week
        const isActive = p => p.placed === 'Active - In Force' || p.placed === 'Advance Released';
        const isDeclined = p => p.placed === 'Declined';
        const isPending = p => p.placed === 'Submitted - Pending' || p.placed === 'Pending';
        const isCanceled = p => /cancell?ed/i.test(p.placed || '');
        const isLapsed = p => p.placed === 'Lapsed';
        const isNotPaid = p => p.placed === 'Not Yet Paid';

        // Per-week counts
        const wkData = {};
        weekKeys.forEach(wk => {
          const ps = weekMap[wk];
          const submitted = ps.length;
          const declined = ps.filter(isDeclined).length;
          const pending = ps.filter(isPending).length;
          const initialIF = submitted - declined - pending; // Only policies that got placed
          const active = ps.filter(isActive).length;
          const canceled = ps.filter(isCanceled).length;
          const lapsed = ps.filter(isLapsed).length;
          const notpaid = ps.filter(isNotPaid).length;
          const activePrem = ps.filter(isActive).reduce((s, p) => s + p.premium, 0);
          wkData[wk] = { submitted, declined, pending, initialIF, active, canceled, lapsed, notpaid, activePrem };
        });

        // Grand totals
        const allPolicies = policies.filter(p => p.submitDate);
        const gt = {
          submitted: allPolicies.length,
          declined: allPolicies.filter(isDeclined).length,
          pending: allPolicies.filter(isPending).length,
          active: allPolicies.filter(isActive).length,
          canceled: allPolicies.filter(isCanceled).length,
          lapsed: allPolicies.filter(isLapsed).length,
          notpaid: allPolicies.filter(isNotPaid).length,
          activePrem: allPolicies.filter(isActive).reduce((s, p) => s + p.premium, 0),
        };
        gt.initialIF = gt.submitted - gt.declined - gt.pending;

        // Helper: format percentage of Initial In Force base, or '—' if base is 0
        const pctOfBase = (val, base) => base > 0 ? (val / base * 100).toFixed(0) + '%' : '—';
        const pctColor = (val, base) => {
          if (base <= 0) return C.muted;
          const pct = val / base * 100;
          return pct >= 80 ? C.green : pct >= 60 ? C.yellow : C.red;
        };

        // Row definitions for the matrix
        // Section 1: Submitted → Declined → Pending → Initial In Force
        // Section 2: Placed status breakdown (% of Initial In Force)
        // Section 3: In Force Rate + Premium
        const HEADER_ROWS = [
          { key: 'submitted', label: 'Total Submitted', color: C.accent, val: w => w.submitted, gtVal: gt.submitted },
          { key: 'declined', label: 'Declined / Denied', color: '#f87171', val: w => w.declined, gtVal: gt.declined },
          { key: 'pending', label: 'Pending', color: C.yellow, val: w => w.pending, gtVal: gt.pending },
        ];
        const IIF_ROW = { key: 'initialIF', label: 'Initial In Force', color: '#38bdf8' };
        const STATUS_ROWS_DETAIL = [
          { key: 'active', label: 'Active - In Force', color: C.green, val: w => w.active, gtVal: gt.active },
          { key: 'canceled', label: 'Canceled', color: '#fb923c', val: w => w.canceled, gtVal: gt.canceled },
          { key: 'lapsed', label: 'Lapsed', color: '#c084fc', val: w => w.lapsed, gtVal: gt.lapsed },
          { key: 'notpaid', label: 'Not Yet Paid', color: '#94a3b8', val: w => w.notpaid, gtVal: gt.notpaid },
        ];

        const thStyle = { padding: '8px 12px', textAlign: 'center', fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: `2px solid ${C.border}`, background: C.surface, whiteSpace: 'pre-line', minWidth: 72 };
        const tdStyle = { padding: '6px 12px', textAlign: 'center', fontSize: 13, fontFamily: 'monospace', borderBottom: `1px solid ${C.border}` };
        const stickyLabel = (color, bold) => ({ ...tdStyle, textAlign: 'left', fontFamily: 'inherit', fontWeight: bold ? 700 : 600, fontSize: 11, color, position: 'sticky', left: 0, background: C.card, zIndex: 1 });
        const totalColBorder = `2px solid ${C.accent}`;
        const dividerRow = (k) => <tr key={`div-${k}`}><td colSpan={weekKeys.length + 2} style={{ height: 2, background: C.border, padding: 0 }} /></tr>;

        return <Section title="Sales Cohort Waterfall" rightContent={<span style={{ fontSize: 10, color: C.muted }}>Policies grouped by week sold · downstream %'s based on Initial In Force</span>}>
          <div style={{ overflowX: 'auto', padding: 16 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: weekKeys.length * 80 + 200 }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, textAlign: 'left', width: 160, position: 'sticky', left: 0, zIndex: 2, background: C.surface }}>Status</th>
                  {weekLabels.map((lbl, i) => <th key={weekKeys[i]} style={thStyle}>{lbl}</th>)}
                  <th style={{ ...thStyle, color: C.accent, borderLeft: totalColBorder }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {/* Section 1: Total Submitted, Declined */}
                {HEADER_ROWS.map(r => (
                  <tr key={r.key}>
                    <td style={stickyLabel(r.color, false)}>{r.label}</td>
                    {weekKeys.map(wk => {
                      const val = r.val(wkData[wk]);
                      return <td key={wk} style={{ ...tdStyle, color: val > 0 ? r.color : C.muted + '60', fontWeight: val > 0 ? 600 : 400 }}>{val}</td>;
                    })}
                    <td style={{ ...tdStyle, borderLeft: totalColBorder, color: r.gtVal > 0 ? r.color : C.muted, fontWeight: 700 }}>{r.gtVal}</td>
                  </tr>
                ))}

                {/* Initial In Force row (highlighted) */}
                <tr style={{ background: '#0c1a2e' }}>
                  <td style={{ ...stickyLabel(IIF_ROW.color, true), background: '#0c1a2e' }}>
                    {IIF_ROW.label}
                  </td>
                  {weekKeys.map(wk => {
                    const w = wkData[wk];
                    const pct = w.submitted > 0 ? (w.initialIF / w.submitted * 100).toFixed(0) + '%' : '—';
                    return <td key={wk} style={{ ...tdStyle, fontWeight: 700, color: IIF_ROW.color }}>
                      {w.initialIF}<span style={{ fontSize: 9, color: C.muted, marginLeft: 4 }}>{pct}</span>
                    </td>;
                  })}
                  <td style={{ ...tdStyle, borderLeft: totalColBorder, fontWeight: 800, color: IIF_ROW.color }}>
                    {gt.initialIF}<span style={{ fontSize: 9, color: C.muted, marginLeft: 4 }}>{gt.submitted > 0 ? (gt.initialIF / gt.submitted * 100).toFixed(0) + '%' : '—'}</span>
                  </td>
                </tr>

                {dividerRow(1)}

                {/* Section 2: Status breakdown — counts + % of Initial In Force */}
                {STATUS_ROWS_DETAIL.map(r => (
                  <tr key={r.key}>
                    <td style={stickyLabel(r.color, false)}>{r.label}</td>
                    {weekKeys.map(wk => {
                      const val = r.val(wkData[wk]);
                      const base = wkData[wk].initialIF;
                      const pct = base > 0 ? (val / base * 100).toFixed(0) + '%' : '';
                      return <td key={wk} style={{ ...tdStyle, color: val > 0 ? r.color : C.muted + '60', fontWeight: val > 0 ? 600 : 400 }}>
                        {val > 0 ? <>{val}<span style={{ fontSize: 9, color: C.muted, marginLeft: 3 }}>{pct}</span></> : val}
                      </td>;
                    })}
                    <td style={{ ...tdStyle, borderLeft: totalColBorder, color: r.gtVal > 0 ? r.color : C.muted, fontWeight: 700 }}>
                      {r.gtVal > 0 ? <>{r.gtVal}<span style={{ fontSize: 9, color: C.muted, marginLeft: 3 }}>{gt.initialIF > 0 ? (r.gtVal / gt.initialIF * 100).toFixed(0) + '%' : ''}</span></> : r.gtVal}
                    </td>
                  </tr>
                ))}

                {dividerRow(2)}

                {/* In Force Rate — Active / Initial In Force */}
                <tr>
                  <td style={stickyLabel(C.green, true)}>In Force Rate</td>
                  {weekKeys.map(wk => {
                    const w = wkData[wk];
                    const rate = w.initialIF > 0 ? (w.active / w.initialIF * 100) : null;
                    const rColor = rate === null ? C.muted : rate >= 80 ? C.green : rate >= 60 ? C.yellow : C.red;
                    return <td key={wk} style={{ ...tdStyle, color: rColor, fontWeight: 700, fontSize: 14 }}>
                      {rate !== null ? rate.toFixed(0) + '%' : '—'}
                    </td>;
                  })}
                  <td style={{ ...tdStyle, borderLeft: totalColBorder, fontWeight: 800, fontSize: 14, color: gt.initialIF > 0 ? (gt.active / gt.initialIF * 100 >= 80 ? C.green : gt.active / gt.initialIF * 100 >= 60 ? C.yellow : C.red) : C.muted }}>
                    {gt.initialIF > 0 ? (gt.active / gt.initialIF * 100).toFixed(1) + '%' : '—'}
                  </td>
                </tr>

                {/* Active Premium */}
                <tr>
                  <td style={stickyLabel(C.muted, false)}>Active Premium</td>
                  {weekKeys.map(wk => {
                    const prem = wkData[wk].activePrem;
                    return <td key={wk} style={{ ...tdStyle, color: prem > 0 ? C.green : C.muted + '60', fontWeight: prem > 0 ? 600 : 400 }}>{prem > 0 ? fmtDollar(prem) : '—'}</td>;
                  })}
                  <td style={{ ...tdStyle, borderLeft: totalColBorder, color: C.green, fontWeight: 700 }}>{fmtDollar(gt.activePrem)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Section>;
      })()}

      {subTab === 'aging' && <>
        <Section title="Policy Aging Matrix" rightContent={<span style={{ fontSize: 10, color: C.muted }}>Age = days since application submitted · click cell area to explore</span>}>
          <div style={{ overflowX: 'auto', padding: 16 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 700 }}>
              <thead>
                <tr>
                  <th style={{ padding: '8px 16px', textAlign: 'left', fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, borderBottom: `2px solid ${C.border}`, background: C.surface, width: 130 }}>Status</th>
                  {BUCKET_COLS.map(col => (
                    <th key={col} style={{ padding: '8px 16px', textAlign: 'center', fontSize: 9, fontWeight: 700, color: col === 'Total' ? C.accent : C.muted, textTransform: 'uppercase', letterSpacing: 1, borderBottom: `2px solid ${C.border}`, background: C.surface, borderLeft: col === 'Total' ? `2px solid ${C.accent}` : `1px solid ${C.border}` }}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {STATUS_ROWS.map((row, ri) => {
                  const rowData = agingMatrix[row.key] || {};
                  const isTotal = row.key === 'Total';
                  return (
                    <tr key={row.key} style={{ borderTop: isTotal ? `2px solid ${C.accent}` : undefined, background: isTotal ? C.surface : 'transparent' }}>
                      <td style={{ padding: '10px 16px', fontSize: 11, fontWeight: 700, color: row.color, fontFamily: C.sans, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>{row.label}</td>
                      {BUCKET_COLS.map(col => {
                        const cell = rowData[col] || { count: 0, grossRevenue: 0, commission: 0, leadCost: 0 };
                        const netRev = cell.grossRevenue - cell.commission - cell.leadCost;
                        const isLastCol = col === 'Total';
                        return (
                          <td key={col} style={{ padding: '10px 16px', textAlign: 'center', borderBottom: `1px solid ${C.border}`, borderLeft: isLastCol ? `2px solid ${C.accent}` : `1px solid ${C.border}`, background: cell.count > 0 ? (isTotal ? C.surface : `${row.color}10`) : 'transparent', verticalAlign: 'top' }}>
                            {cell.count === 0 ? (
                              <span style={{ color: C.border, fontSize: 13 }}>—</span>
                            ) : (
                              <>
                                <div style={{ fontSize: 20, fontWeight: 800, color: row.color, fontFamily: C.mono, lineHeight: 1.1 }}>{cell.count}</div>
                                {cell.grossRevenue > 0 && <div style={{ fontSize: 10, color: C.green, fontFamily: C.mono, marginTop: 3 }}>{fmtDollar(cell.grossRevenue)}</div>}
                                {cell.commission > 0 && <div style={{ fontSize: 9, color: C.yellow, fontFamily: C.mono }}>{fmtDollar(cell.commission)} comm</div>}
                                {cell.leadCost > 0 && <div style={{ fontSize: 9, color: C.muted, fontFamily: C.mono }}>{fmtDollar(cell.leadCost)} spend</div>}
                                {(cell.grossRevenue > 0 || cell.leadCost > 0) && <div style={{ fontSize: 10, fontWeight: 700, color: netRev >= 0 ? C.green : C.red, fontFamily: C.mono, marginTop: 2, borderTop: `1px solid ${C.border}`, paddingTop: 2 }}>{fmtDollar(netRev)} net</div>}
                              </>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>

        {/* Full policy list enriched with age, sortable */}
        <Section title="All Policies — By Age" rightContent={<span style={{ fontSize: 10, color: C.muted }}>Click a row for full details</span>}>
          <SortableTable
            defaultSort="ageDays"
            onRowClick={r => setDrillPolicy(r)}
            columns={[
              { key: 'placed', label: 'Status', align: 'left', mono: false, color: r => statusColor(r), bold: true },
              { key: 'ageDays', label: 'Age (days)', render: r => r.ageDays != null ? fmt(r.ageDays) : '—', color: r => r.ageDays > 90 ? C.red : r.ageDays > 30 ? C.yellow : C.text },
              { key: '_ageBucket', label: 'Bucket', render: r => getAgeBucketLabel(r.ageDays) || '—', align: 'left', mono: false, color: () => C.muted },
              { key: 'submitDate', label: 'Submit Date', align: 'left' },
              { key: 'agent', label: 'Agent', align: 'left', mono: false },
              { key: 'firstName', label: 'First', align: 'left', mono: false },
              { key: 'lastName', label: 'Last', align: 'left', mono: false },
              { key: 'carrier', label: 'Carrier', align: 'left', mono: false },
              { key: 'product', label: 'Product', align: 'left', mono: false, color: () => C.muted },
              { key: 'premium', label: 'Premium', render: r => fmtDollar(r.premium, 2), color: r => classify(r) === 'active' ? C.green : C.muted },
              { key: 'grossAdvancedRevenue', label: 'Gross Rev', render: r => fmtDollar(r.grossAdvancedRevenue), color: r => classify(r) !== 'left' ? C.green : C.muted },
              { key: 'commission', label: 'Commission', render: r => fmtDollar(r.commission), color: () => C.yellow },
              { key: '_leadCost2', label: 'Lead Cost', render: r => fmtDollar(getLeadCost(r)), color: () => C.muted },
              { key: '_netRevenue2', label: 'Net Revenue', render: r => { const n = r.grossAdvancedRevenue - r.commission - getLeadCost(r); return fmtDollar(n); }, color: r => { const n = r.grossAdvancedRevenue - r.commission - getLeadCost(r); return n >= 0 ? C.green : C.red; } },
            ]}
            rows={policies.map(p => ({ ...p, ageDays: policyAge(p.submitDate) }))}
          />
        </Section>
      </>}
    </>
  );
}

// ─── AGENT PERFORMANCE TAB ──────────────────────────
function AgentPerformanceTab({ dateRange, calls, policies }) {
  const [perfData, setPerfData] = useState(null);
  const [perfLoading, setPerfLoading] = useState(true);
  const [perfError, setPerfError] = useState(null);
  const [view, setView] = useState('agents');
  const [drillAgent, setDrillAgent] = useState(null);
  const [drillDay, setDrillDay] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setPerfLoading(true);
      setPerfError(null);
      try {
        const res = await fetch('/api/agent-performance?start=' + dateRange.start + '&end=' + dateRange.end);
        if (!res.ok) throw new Error('API returned ' + res.status);
        const data = await res.json();
        if (data.meta?.error) throw new Error(data.meta.error);
        if (!cancelled) setPerfData(data);
      } catch (e) {
        console.error('[agent-perf] load error:', e);
        if (!cancelled) setPerfError(e.message);
      }
      if (!cancelled) setPerfLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [dateRange]);

  if (perfLoading) {
    return <div style={{ padding: 40, textAlign: 'center', color: C.muted }}>Loading agent performance data...</div>;
  }

  if (perfError) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.red, marginBottom: 8 }}>Agent Performance Error</div>
        <div style={{ fontSize: 12, color: C.muted, maxWidth: 500, margin: '0 auto' }}>{perfError}</div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 12 }}>Make sure <code style={{ background: C.card, padding: '2px 6px', borderRadius: 3 }}>AGENT_PERF_SHEET_ID</code> is set in your environment variables.</div>
      </div>
    );
  }

  if (!perfData) return null;

  const { daily, agents } = perfData;

  // Billable calls and placed policies from dashboard data, keyed by agent and date
  const billableByAgent = {};
  const billableByDate = {};
  const billableByAgentDate = {};
  const placedByAgent = {};
  (calls || []).forEach(c => {
    if (c.isBillable) {
      billableByAgent[c.rep] = (billableByAgent[c.rep] || 0) + 1;
      billableByDate[c.date] = (billableByDate[c.date] || 0) + 1;
      const k = c.rep + '|' + c.date;
      billableByAgentDate[k] = (billableByAgentDate[k] || 0) + 1;
    }
  });
  (policies || []).filter(isPlaced).forEach(p => {
    placedByAgent[p.agent] = (placedByAgent[p.agent] || 0) + 1;
  });

  function fmtTime(s) {
    if (!s) return '0:00:00';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
  }

  const availColor = pct => pct >= 85 ? C.green : pct >= 70 ? C.yellow : C.red;
  const pauseColor = pct => pct <= 15 ? C.green : pct <= 30 ? C.yellow : C.red;

  // Summary KPIs
  const totalLoggedIn = agents.reduce((s, a) => s + a.loggedIn, 0);
  const totalPaused = agents.reduce((s, a) => s + a.paused, 0);
  const totalTalk = agents.reduce((s, a) => s + a.talkTime, 0);
  const totalAvailable = totalLoggedIn - totalPaused;
  const overallAvailPct = totalLoggedIn > 0 ? (totalAvailable / totalLoggedIn) * 100 : 0;
  const overallPausePct = totalLoggedIn > 0 ? (totalPaused / totalLoggedIn) * 100 : 0;
  const overallTalkPct = totalAvailable > 0 ? (totalTalk / totalAvailable) * 100 : 0;
  const totalDialed = agents.reduce((s, a) => s + a.dialed, 0);
  const totalConnects = agents.reduce((s, a) => s + a.connects, 0);
  const totalSales = agents.reduce((s, a) => s + a.sales, 0);
  const totalHours = agents.reduce((s, a) => s + a.hoursWorked, 0);

  // Flagged agents (availability < 70%)
  const flagged = agents.filter(a => a.availPct < 70 && a.loggedIn > 0).sort((a, b) => a.availPct - b.availPct);

  // Aggregate by day
  const byDay = {};
  daily.forEach(r => {
    if (!byDay[r.date]) {
      byDay[r.date] = { date: r.date, agentCount: 0, dialed: 0, connects: 0, contacts: 0, sales: 0, talkTime: 0, paused: 0, waitTime: 0, wrapUp: 0, loggedIn: 0, hoursWorked: 0 };
    }
    const d = byDay[r.date];
    d.agentCount++;
    d.dialed += r.dialed;
    d.connects += r.connects;
    d.contacts += r.contacts;
    d.sales += r.sales;
    d.talkTime += r.talkTime;
    d.paused += r.paused;
    d.waitTime += r.waitTime;
    d.wrapUp += r.wrapUp;
    d.loggedIn += r.loggedIn;
    d.hoursWorked += r.hoursWorked;
  });
  const dayRows = Object.values(byDay).map(d => {
    const available = d.loggedIn - d.paused;
    const dayBillable = billableByDate[d.date] || 0;
    return {
      ...d,
      available,
      availPct: d.loggedIn > 0 ? (available / d.loggedIn) * 100 : 0,
      pausePct: d.loggedIn > 0 ? (d.paused / d.loggedIn) * 100 : 0,
      talkPct: available > 0 ? (d.talkTime / available) * 100 : 0,
      connectsPerHour: d.hoursWorked > 0 ? d.connects / d.hoursWorked : 0,
      billable: dayBillable,
      billConvRate: dayBillable > 0 ? (d.sales / dayBillable) * 100 : 0,
      loggedInStr: fmtTime(d.loggedIn),
      pausedStr: fmtTime(d.paused),
      talkTimeStr: fmtTime(d.talkTime),
      avgTalkTimeStr: fmtTime(d.connects > 0 ? Math.round(d.talkTime / d.connects) : 0),
      waitTimeStr: fmtTime(d.waitTime),
      avgWaitTimeStr: fmtTime(d.connects > 0 ? Math.round(d.waitTime / d.connects) : 0),
      wrapUpStr: fmtTime(d.wrapUp),
      avgWrapUpStr: fmtTime(d.connects > 0 ? Math.round(d.wrapUp / d.connects) : 0),
      availableStr: fmtTime(available),
    };
  }).sort((a, b) => b.date.localeCompare(a.date));

  // View toggle button style
  const togStyle = (active) => ({
    padding: '6px 14px', borderRadius: 4, border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer',
    background: active ? C.accent : 'transparent', color: active ? '#fff' : C.muted,
  });

  // ── Agent Drill-Down ──
  if (drillAgent) {
    const agentDays = daily.filter(d => d.rep === drillAgent).sort((a, b) => b.date.localeCompare(a.date));
    const agg = agents.find(a => a.rep === drillAgent);
    if (!agg) { setDrillAgent(null); return null; }
    return (
      <>
        <Breadcrumb items={[{ label: 'All Agents', onClick: () => setDrillAgent(null) }, { label: drillAgent }]} />
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <KPICard label="Days Active" value={agg.days} />
          <KPICard label="Availability" value={fmtPct(agg.availPct)} subtitle={`${fmtTime(agg.available)} of ${fmtTime(agg.loggedIn)}`} />
          <KPICard label="Pause %" value={fmtPct(agg.pausePct)} subtitle={fmtTime(agg.paused)} />
          <KPICard label="Talk Time" value={fmtTime(agg.talkTime)} subtitle={`${fmtPct(agg.talkPct)} utilization`} />
          <KPICard label="Connects" value={fmt(agg.connects)} subtitle={`${agg.connectsPerHour.toFixed(1)}/hr`} />
          <KPICard label="Sales" value={fmt(agg.sales)} subtitle={`${(billableByAgent[drillAgent]||0) > 0 ? fmtPct(agg.sales/(billableByAgent[drillAgent]||1)*100) : '—'} bill conv`} />
        </div>
        {agg.pausePct > 30 && (
          <div style={{ background: C.redDim, border: `1px solid ${C.red}44`, borderRadius: 8, padding: '12px 20px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>⚠️</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.red }}>High Pause Time Alert</div>
              <div style={{ fontSize: 11, color: C.muted }}>{drillAgent} has been paused {fmtPct(agg.pausePct)} of logged-in time ({fmtTime(agg.paused)} total). Target is under 15%.</div>
            </div>
          </div>
        )}
        <Section title="Daily Breakdown">
          <SortableTable defaultSort="date" columns={[
            { key: 'date', label: 'Date', align: 'left', bold: true },
            { key: 'dialed', label: 'Dialed' },
            { key: 'connects', label: 'Connects' },
            { key: 'billable', label: 'Billable', render: r => fmt(billableByAgentDate[r.rep + '|' + r.date] || 0), color: r => (billableByAgentDate[r.rep + '|' + r.date] || 0) > 0 ? C.accent : C.muted },
            { key: 'sales', label: 'Sales', color: r => r.sales > 0 ? C.green : C.muted },
            { key: 'billConv', label: 'Bill Conv%', render: r => { const b = billableByAgentDate[r.rep + '|' + r.date] || 0; return b > 0 ? fmtPct(r.sales / b * 100) : '—'; }, color: r => r.sales > 0 ? C.green : C.muted },
            { key: 'connectsPerHour', label: 'Conn/Hr', render: r => r.connectsPerHour.toFixed(1) },
            { key: 'talkTimeStr', label: 'Talk Time' },
            { key: 'avgTalkTimeStr', label: 'Avg Talk' },
            { key: 'pausedStr', label: 'Paused', color: r => pauseColor(r.pausePct) },
            { key: 'pausePct', label: 'Pause %', render: r => fmtPct(r.pausePct), color: r => pauseColor(r.pausePct) },
            { key: 'waitTimeStr', label: 'Wait Time' },
            { key: 'avgWaitTimeStr', label: 'Avg Wait' },
            { key: 'wrapUpStr', label: 'Wrap Up' },
            { key: 'avgWrapUpStr', label: 'Avg Wrap' },
            { key: 'loggedInStr', label: 'Logged In' },
            { key: 'availPct', label: 'Avail %', render: r => fmtPct(r.availPct), color: r => availColor(r.availPct) },
          ]} rows={agentDays} />
        </Section>
      </>
    );
  }

  // ── Day Drill-Down ──
  if (drillDay) {
    const dayAgents = daily.filter(d => d.date === drillDay).sort((a, b) => a.availPct - b.availPct);
    const daySummary = byDay[drillDay];
    if (!daySummary) { setDrillDay(null); return null; }
    const dayAvail = daySummary.loggedIn > 0 ? ((daySummary.loggedIn - daySummary.paused) / daySummary.loggedIn) * 100 : 0;
    const dayFlagged = dayAgents.filter(a => a.availPct < 70 && a.loggedIn > 0);
    return (
      <>
        <Breadcrumb items={[{ label: 'Daily View', onClick: () => setDrillDay(null) }, { label: drillDay }]} />
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <KPICard label="Agents Active" value={daySummary.agentCount} subtitle={`${dayFlagged.length} flagged`} />
          <KPICard label="Availability" value={fmtPct(dayAvail)} subtitle={`${fmtTime(daySummary.loggedIn - daySummary.paused)} of ${fmtTime(daySummary.loggedIn)}`} />
          <KPICard label="Total Paused" value={fmtTime(daySummary.paused)} subtitle={fmtPct(daySummary.loggedIn > 0 ? (daySummary.paused / daySummary.loggedIn) * 100 : 0)} />
          <KPICard label="Talk Time" value={fmtTime(daySummary.talkTime)} />
          <KPICard label="Connects" value={fmt(daySummary.connects)} subtitle={`${daySummary.hoursWorked > 0 ? (daySummary.connects / daySummary.hoursWorked).toFixed(1) : 0}/hr`} />
          <KPICard label="Sales" value={fmt(daySummary.sales)} subtitle={`${daySummary.connects > 0 ? ((daySummary.sales / daySummary.connects) * 100).toFixed(1) : 0}% conv`} />
          <KPICard label="Dialed" value={fmt(daySummary.dialed)} />
        </div>
        {dayFlagged.length > 0 && (
          <Section title={`⚠️ Availability Alerts — ${drillDay}`}>
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {dayFlagged.map(a => (
                <div key={a.rep} onClick={() => { setDrillDay(null); setDrillAgent(a.rep); }} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px',
                  background: a.availPct < 30 ? C.redDim : C.yellowDim, borderRadius: 6, cursor: 'pointer',
                  border: `1px solid ${a.availPct < 30 ? C.red : C.yellow}33`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 16 }}>{a.availPct < 30 ? '🔴' : '🟡'}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{a.rep}</div>
                      <div style={{ fontSize: 10, color: C.muted }}>Logged in: {fmtTime(a.loggedIn)} · Paused: {fmtTime(a.paused)}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 18, fontWeight: 800, fontFamily: C.mono, color: a.availPct < 30 ? C.red : C.yellow }}>{fmtPct(a.availPct)}</div>
                    <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase' }}>Available</div>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}
        <Section title={`All Agents — ${drillDay}`} rightContent={<span style={{ fontSize: 10, color: C.muted }}>Click agent to see full history</span>}>
          <SortableTable defaultSort="availPct" onRowClick={r => { setDrillDay(null); setDrillAgent(r.rep); }} columns={[
            { key: 'rep', label: 'Agent', align: 'left', bold: true, mono: false },
            { key: 'dialed', label: 'Dialed' },
            { key: 'connects', label: 'Connects' },
            { key: 'billable', label: 'Billable', render: r => fmt(billableByAgentDate[r.rep + '|' + r.date] || 0), color: r => (billableByAgentDate[r.rep + '|' + r.date] || 0) > 0 ? C.accent : C.muted },
            { key: 'sales', label: 'Sales', color: r => r.sales > 0 ? C.green : C.muted },
            { key: 'billConv', label: 'Bill Conv%', render: r => { const b = billableByAgentDate[r.rep + '|' + r.date] || 0; return b > 0 ? fmtPct(r.sales / b * 100) : '—'; }, color: r => r.sales > 0 ? C.green : C.muted },
            { key: 'connectsPerHour', label: 'Conn/Hr', render: r => r.connectsPerHour.toFixed(1) },
            { key: 'talkTimeStr', label: 'Talk Time' },
            { key: 'avgTalkTimeStr', label: 'Avg Talk' },
            { key: 'pausedStr', label: 'Paused', color: r => pauseColor(r.pausePct) },
            { key: 'pausePct', label: 'Pause %', render: r => fmtPct(r.pausePct), color: r => pauseColor(r.pausePct) },
            { key: 'waitTimeStr', label: 'Wait Time' },
            { key: 'avgWaitTimeStr', label: 'Avg Wait' },
            { key: 'wrapUpStr', label: 'Wrap Up' },
            { key: 'avgWrapUpStr', label: 'Avg Wrap' },
            { key: 'loggedInStr', label: 'Logged In' },
            { key: 'availPct', label: 'Avail %', render: r => fmtPct(r.availPct), color: r => availColor(r.availPct) },
          ]} rows={dayAgents} />
        </Section>
      </>
    );
  }

  // ── Main View ──
  return (
    <>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <KPICard label="Agents" value={agents.length} subtitle={`${flagged.length} flagged`} />
        <KPICard label="Overall Availability" value={fmtPct(overallAvailPct)} subtitle={`${fmtTime(totalAvailable)} avail of ${fmtTime(totalLoggedIn)}`} />
        <KPICard label="Overall Pause %" value={fmtPct(overallPausePct)} subtitle={fmtTime(totalPaused)} />
        <KPICard label="Talk Utilization" value={fmtPct(overallTalkPct)} subtitle={fmtTime(totalTalk)} />
        <KPICard label="Total Connects" value={fmt(totalConnects)} subtitle={`${totalHours > 0 ? (totalConnects / totalHours).toFixed(1) : 0}/hr`} />
        <KPICard label="Total Sales" value={fmt(totalSales)} subtitle={`${Object.values(billableByAgent).reduce((s,v)=>s+v,0) > 0 ? ((totalSales / Object.values(billableByAgent).reduce((s,v)=>s+v,0)) * 100).toFixed(1) : 0}% bill conv`} />
        <KPICard label="Total Dialed" value={fmt(totalDialed)} />
      </div>

      {flagged.length > 0 && (
        <Section title={`⚠️ Availability Alerts — ${flagged.length} agent${flagged.length > 1 ? 's' : ''} below 70%`}>
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {flagged.map(a => (
              <div key={a.rep} onClick={() => setDrillAgent(a.rep)} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px',
                background: a.availPct < 30 ? C.redDim : C.yellowDim, borderRadius: 6, cursor: 'pointer',
                border: `1px solid ${a.availPct < 30 ? C.red : C.yellow}33`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 16 }}>{a.availPct < 30 ? '🔴' : '🟡'}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{a.rep}</div>
                    <div style={{ fontSize: 10, color: C.muted }}>{a.days} day{a.days > 1 ? 's' : ''} · Logged in: {fmtTime(a.loggedIn)} · Paused: {fmtTime(a.paused)}</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, fontFamily: C.mono, color: a.availPct < 30 ? C.red : C.yellow }}>{fmtPct(a.availPct)}</div>
                  <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase' }}>Available</div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      <div style={{ display: 'flex', gap: 1, background: C.card, borderRadius: 6, padding: 2, border: `1px solid ${C.border}`, marginBottom: 16, width: 'fit-content' }}>
        <button onClick={() => setView('agents')} style={togStyle(view === 'agents')}>By Agent</button>
        <button onClick={() => setView('daily')} style={togStyle(view === 'daily')}>By Day</button>
      </div>

      {view === 'agents' && (
        <Section title="Agent Performance" rightContent={<span style={{ fontSize: 10, color: C.muted }}>Click a row to drill down</span>}>
          <SortableTable defaultSort="availPct" onRowClick={r => setDrillAgent(r.rep)} columns={[
            { key: 'rep', label: 'Agent', align: 'left', bold: true, mono: false },
            { key: 'days', label: 'Days' },
            { key: 'dialed', label: 'Dialed' },
            { key: 'connects', label: 'Connects' },
            { key: 'billable', label: 'Billable', render: r => fmt(billableByAgent[r.rep] || 0), color: r => (billableByAgent[r.rep] || 0) > 0 ? C.accent : C.muted },
            { key: 'sales', label: 'Sales', color: r => r.sales > 0 ? C.green : C.muted },
            { key: 'placed', label: 'Placed', render: r => fmt(placedByAgent[r.rep] || 0), color: r => (placedByAgent[r.rep] || 0) > 0 ? C.green : C.muted },
            { key: 'billConv', label: 'Bill Conv%', render: r => { const b = billableByAgent[r.rep] || 0; return b > 0 ? fmtPct(r.sales / b * 100) : '—'; }, color: r => (billableByAgent[r.rep] || 0) > 0 ? C.green : C.muted },
            { key: 'connHr', label: 'Conn/Hr', render: r => r.connectsPerHour.toFixed(1) },
            { key: 'talkTimeStr', label: 'Talk Time' },
            { key: 'avgTalkTimeStr', label: 'Avg Talk' },
            { key: 'pausedStr', label: 'Paused', color: r => pauseColor(r.pausePct) },
            { key: 'pausePct', label: 'Pause %', render: r => fmtPct(r.pausePct), color: r => pauseColor(r.pausePct) },
            { key: 'waitTimeStr', label: 'Wait Time' },
            { key: 'avgWaitTimeStr', label: 'Avg Wait' },
            { key: 'wrapUpStr', label: 'Wrap Up' },
            { key: 'avgWrapUpStr', label: 'Avg Wrap' },
            { key: 'loggedInStr', label: 'Logged In' },
            { key: 'availPct', label: 'Avail %', render: r => fmtPct(r.availPct), color: r => availColor(r.availPct) },
          ]} rows={agents} />
        </Section>
      )}

      {view === 'daily' && (
        <Section title="Daily Agent Performance" rightContent={<span style={{ fontSize: 10, color: C.muted }}>Click a row to see agent history</span>}>
          <SortableTable defaultSort="date" onRowClick={r => setDrillAgent(r.rep)} columns={[
            { key: 'date', label: 'Date', align: 'left', bold: true },
            { key: 'rep', label: 'Agent', align: 'left', bold: true, mono: false },
            { key: 'dialed', label: 'Dialed' },
            { key: 'connects', label: 'Connects' },
            { key: 'billable', label: 'Billable', render: r => fmt(billableByAgentDate[r.rep + '|' + r.date] || 0), color: r => (billableByAgentDate[r.rep + '|' + r.date] || 0) > 0 ? C.accent : C.muted },
            { key: 'sales', label: 'Sales', color: r => r.sales > 0 ? C.green : C.muted },
            { key: 'billConv', label: 'Bill Conv%', render: r => { const b = billableByAgentDate[r.rep + '|' + r.date] || 0; return b > 0 ? fmtPct(r.sales / b * 100) : '—'; }, color: r => r.sales > 0 ? C.green : C.muted },
            { key: 'connectsPerHour', label: 'Conn/Hr', render: r => r.connectsPerHour.toFixed(1) },
            { key: 'talkTimeStr', label: 'Talk Time' },
            { key: 'avgTalkTimeStr', label: 'Avg Talk' },
            { key: 'pausedStr', label: 'Paused', color: r => pauseColor(r.pausePct) },
            { key: 'pausePct', label: 'Pause %', render: r => fmtPct(r.pausePct), color: r => pauseColor(r.pausePct) },
            { key: 'waitTimeStr', label: 'Wait Time' },
            { key: 'avgWaitTimeStr', label: 'Avg Wait' },
            { key: 'wrapUpStr', label: 'Wrap Up' },
            { key: 'avgWrapUpStr', label: 'Avg Wrap' },
            { key: 'loggedInStr', label: 'Logged In' },
            { key: 'availPct', label: 'Avail %', render: r => fmtPct(r.availPct), color: r => availColor(r.availPct) },
          ]} rows={daily.sort((a, b) => b.date.localeCompare(a.date) || a.rep.localeCompare(b.rep))} />
        </Section>
      )}

      <AgentDeepDivePanel agents={agents} />
    </>
  );
}

function AgentDeepDivePanel({ agents }) {
  const [bundle, setBundle] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/agent-deep-dive')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d) setBundle(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const entities = bundle?.entities || [];
  const pending = bundle?.pending || [];
  if (!entities.length && !pending.length) return null;

  // Sort by whether the entity appears in today's agent list first
  const activeAgentNames = new Set((agents || []).map(a => a.rep));
  const ordered = [...entities].sort((a, b) => {
    const aIn = activeAgentNames.has(a.name) ? 0 : 1;
    const bIn = activeAgentNames.has(b.name) ? 0 : 1;
    if (aIn !== bIn) return aIn - bIn;
    return (a.name || '').localeCompare(b.name || '');
  });
  const orderedPending = [...pending].sort((a, b) => (a || '').localeCompare(b || ''));

  return (
    <Section title="Agent Deep Dive" rightContent={<span style={{ fontSize: 10, color: C.muted }}>{entities.length} of {entities.length + pending.length} agents analyzed (run {bundle?.runDate || '—'})</span>}>
      <p style={{ margin: '0 0 12px', fontSize: 11, color: C.muted, fontStyle: 'italic' }}>
        Per-agent qualitative coaching analysis from Conversely. Click to expand.
      </p>
      {ordered.map((e, i) => (
        <DeepDiveCard key={e.name || `a-${i}`} entity={e} defaultOpen={false} />
      ))}
      {orderedPending.map((name, i) => (
        <div key={`p-${name || i}`} style={{ background: C.bg, border: `1px dashed ${C.border}`, borderRadius: 6, marginBottom: 8, padding: '10px 14px', opacity: 0.6 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.muted }}>{name}</div>
          <div style={{ fontSize: 11, color: C.muted, fontStyle: 'italic', marginTop: 2 }}>
            No analysis run yet for this agent.
          </div>
        </div>
      ))}
    </Section>
  );
}

// ─── MAIN DASHBOARD ──────────────────────────────────
export default function Dashboard({ data, allTimePolicies, goals, vaData, loading, dateRange, applyPreset, setCustomRange, dataSource, setDataSource, activeTab, setActiveTab, voiceDrillTarget, setVoiceDrillTarget, aiPaneOpen, setAiPaneOpen, voiceTileTarget, setVoiceTileTarget, voicePanelOpen }) {
  // ALL HOOKS MUST GO BEFORE the early-return below — React rules of hooks
  // require the same hooks to be called in the same order on every render.
  // Originally `commSidebarOpen` lived after the early return; that was a
  // latent bug that became visible once more hooks (openNavDropdown +
  // useEffect) were added in the same spot.
  const voicePanelWidth = voicePanelOpen ? 380 : 0;
  const [commSidebarOpen, setCommSidebarOpen] = useState(true);
  // Which top-nav dropdown is currently open (null = none).
  const [openNavDropdown, setOpenNavDropdown] = useState(null);
  // Close dropdown when user clicks outside the nav region or presses Escape.
  useEffect(() => {
    if (!openNavDropdown) return;
    const onClick = (e) => { if (!e.target.closest('[data-nav-dropdown]')) setOpenNavDropdown(null); };
    const onKey = (e) => { if (e.key === 'Escape') setOpenNavDropdown(null); };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey); };
  }, [openNavDropdown]);
  // Set CSS custom property so TileModal can read it (also moved above the
  // early return — same hooks-order rule).
  useEffect(() => {
    document.documentElement.style.setProperty('--voice-panel-width', `${voicePanelWidth}px`);
  }, [voicePanelWidth]);

  if (loading || !data) {
    return (
      <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.text, fontFamily: C.sans }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 40, height: 40, border: `3px solid ${C.border}`, borderTopColor: C.accent, borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
          <p style={{ color: C.muted, fontSize: 14 }}>Loading dashboard data...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }
  const { policies = [], calls = [], pnl = [] } = data || {};

  return (
    <StatementRecordDrawerProvider>
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text, fontFamily: C.sans, marginRight: voicePanelWidth + (commSidebarOpen ? 520 : 0), transition: 'margin-right 0.2s ease' }}>
      {/* Voice-triggered tile modal */}
      {voiceTileTarget && MODAL_CONFIGS_KEYS.includes(voiceTileTarget) && (
        <TileModal tileKey={voiceTileTarget} policies={policies} calls={calls} pnl={pnl} goals={goals} onClose={() => setVoiceTileTarget(null)} />
      )}
      {/* White calendar date pickers rendered below */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: '12px 24px', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div>
              <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0, letterSpacing: -0.3 }}>True Choice Coverage</h1>
              <p style={{ fontSize: 10, color: C.muted, margin: '2px 0 0' }}>{policies.length} policies · {calls.length} calls · {pnl.length} publishers</p>
            </div>
            <a href="/trends" style={{ padding: '6px 14px', borderRadius: 5, fontSize: 11, fontWeight: 600, background: C.accentDim, color: C.accent, textDecoration: 'none', border: `1px solid ${C.accent}33` }}>📈 Trends</a>
            <a href="/reconciliation" style={{ padding: '6px 14px', borderRadius: 5, fontSize: 11, fontWeight: 600, background: C.accentDim, color: C.accent, textDecoration: 'none', border: `1px solid ${C.accent}33` }}>📋 Reconciliation</a>
            <a href="/compare" style={{ padding: '6px 14px', borderRadius: 5, fontSize: 11, fontWeight: 600, background: C.accentDim, color: C.accent, textDecoration: 'none', border: `1px solid ${C.accent}33` }}>🔎 Tracker Compare</a>
            <a href="/orphans" style={{ padding: '6px 14px', borderRadius: 5, fontSize: 11, fontWeight: 600, background: C.accentDim, color: C.accent, textDecoration: 'none', border: `1px solid ${C.accent}33` }}>⚠ Orphans</a>
            <a href="/settings" style={{ padding: '6px 14px', borderRadius: 5, fontSize: 11, fontWeight: 600, background: C.accentDim, color: C.accent, textDecoration: 'none', border: `1px solid ${C.accent}33` }}>⚙ Settings</a>
            <button onClick={async () => { await fetch("/api/clear-cache", { method: "POST" }); window.location.reload(); }} style={{ padding: "6px 14px", borderRadius: 5, fontSize: 11, fontWeight: 600, background: "#2e0a0a", color: "#f87171", border: "1px solid #f8717133", cursor: "pointer" }}>🗑 Clear Cache</button>
            <button onClick={() => setCommSidebarOpen(o => !o)} style={{ padding: '6px 14px', borderRadius: 5, fontSize: 11, fontWeight: 600, background: commSidebarOpen ? C.green : C.accentDim, color: commSidebarOpen ? '#000' : C.accent, border: `1px solid ${commSidebarOpen ? C.green : C.accent}33`, cursor: 'pointer' }}>💰 Commissions</button>
            {dataSource && setDataSource && (
              <div style={{ display: 'flex', gap: 1, background: C.card, borderRadius: 6, padding: 2, border: `1px solid ${C.border}` }}>
                <button onClick={() => setDataSource('Sheet1')} style={{ padding: '5px 10px', borderRadius: 4, border: 'none', fontSize: 10, fontWeight: 600, cursor: 'pointer', background: dataSource === 'Sheet1' ? C.yellow : 'transparent', color: dataSource === 'Sheet1' ? '#000' : C.muted }}>App Data</button>
                <button onClick={() => setDataSource('Merged')} style={{ padding: '5px 10px', borderRadius: 4, border: 'none', fontSize: 10, fontWeight: 600, cursor: 'pointer', background: dataSource === 'Merged' ? C.green : 'transparent', color: dataSource === 'Merged' ? '#000' : C.muted }}>Carrier Data</button>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 1, background: C.card, borderRadius: 6, padding: 2, border: `1px solid ${C.border}` }}>
              {[{ id: 'yesterday', label: 'Yest' }, { id: 'today', label: 'Today' }, { id: 'last7', label: '7D' }, { id: 'last30', label: '30D' }, { id: 'mtd', label: 'MTD' }, { id: 'wtd', label: 'WTD' }, { id: 'all', label: 'All' }].map(p => (
                <button key={p.id} onClick={() => applyPreset(p.id)} style={{
                  padding: '5px 10px', borderRadius: 4, border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  background: dateRange.preset === p.id ? C.accent : 'transparent', color: dateRange.preset === p.id ? '#fff' : C.muted,
                }}>{p.label}</button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <DatePicker value={dateRange.start} onChange={v => setCustomRange('start', v)} />
              <span style={{ color: C.muted, fontSize: 12, fontWeight: 600 }}>to</span>
              <DatePicker value={dateRange.end} onChange={v => setCustomRange('end', v)} />
            </div>
          </div>
        </div>
      </div>
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', gap: 0, padding: '0 24px' }}>
          {TAB_GROUPS.map(group => {
            if (group.kind === 'standalone') {
              const isActive = activeTab === group.id;
              return (
                <button key={group.id} onClick={() => setActiveTab(group.id)} style={{
                  padding: '10px 20px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', background: 'transparent',
                  borderBottom: `2px solid ${isActive ? C.accent : 'transparent'}`, color: isActive ? C.text : C.muted, transition: 'all 0.15s ease',
                }}>{group.label}</button>
              );
            }
            // group.kind === 'group' → dropdown
            const childIds = group.items.map(i => i.id);
            const groupActive = childIds.includes(activeTab);
            const isOpen = openNavDropdown === group.id;
            const activeChild = group.items.find(i => i.id === activeTab);
            return (
              <div key={group.id} data-nav-dropdown style={{ position: 'relative' }}>
                <button
                  onClick={(e) => { e.stopPropagation(); setOpenNavDropdown(isOpen ? null : group.id); }}
                  style={{
                    padding: '10px 20px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', background: 'transparent',
                    borderBottom: `2px solid ${groupActive ? C.accent : 'transparent'}`, color: groupActive ? C.text : C.muted, transition: 'all 0.15s ease',
                  }}>
                  {group.label}{activeChild ? ` · ${activeChild.label}` : ''} {isOpen ? '▴' : '▾'}
                </button>
                {isOpen && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, zIndex: 50, minWidth: 200,
                    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.4)', padding: '4px 0', marginTop: 2,
                  }}>
                    {group.items.map(item => {
                      const isItemActive = activeTab === item.id;
                      return (
                        <button key={item.id}
                          onClick={() => { setActiveTab(item.id); setOpenNavDropdown(null); }}
                          style={{
                            display: 'block', width: '100%', textAlign: 'left',
                            padding: '8px 16px', fontSize: 12, fontWeight: 500,
                            border: 'none', cursor: 'pointer',
                            background: isItemActive ? `${C.accent}22` : 'transparent',
                            color: isItemActive ? C.accent : C.text,
                          }}
                          onMouseEnter={(e) => { if (!isItemActive) e.currentTarget.style.background = `${C.border}88`; }}
                          onMouseLeave={(e) => { if (!isItemActive) e.currentTarget.style.background = 'transparent'; }}>
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '20px 24px' }}>
        {activeTab === 'daily-brief' && <DailySummaryPage dateRange={dateRange} />}
        {activeTab === 'daily' && <DailyActivityTab policies={policies} calls={calls} pnl={pnl} goals={goals} dateRange={dateRange} allTimePolicies={allTimePolicies || []} vaData={vaData} />}
        {activeTab === 'publishers' && <PublishersTab pnl={pnl} policies={policies} goals={goals} calls={calls} dateRange={dateRange} allTimePolicies={allTimePolicies || []} vaData={vaData} voiceDrillTarget={voiceDrillTarget} clearVoiceDrill={() => setVoiceDrillTarget(null)} />}
        {activeTab === 'agents' && <AgentsTab policies={policies} calls={calls} goals={goals} dateRange={dateRange} pnl={pnl} allTimePolicies={allTimePolicies || []} vaData={vaData} voiceDrillTarget={voiceDrillTarget} clearVoiceDrill={() => setVoiceDrillTarget(null)} />}
        {activeTab === 'carriers' && <CarriersTab policies={policies} goals={goals} calls={calls} dateRange={dateRange} pnl={pnl} allTimePolicies={allTimePolicies || []} vaData={vaData} voiceDrillTarget={voiceDrillTarget} clearVoiceDrill={() => setVoiceDrillTarget(null)} />}
        {activeTab === 'policies-detail' && <PoliciesTab policies={policies} />}        {activeTab === 'policy-status' && <PolicyStatusTab policies={policies} calls={calls} />}        {activeTab === 'agent-perf' && <AgentPerformanceTab dateRange={dateRange} calls={calls} policies={policies} />}        {activeTab === 'pnl' && <PnlTab pnl={pnl} policies={policies} calls={calls} goals={goals} dateRange={dateRange} allTimePolicies={allTimePolicies || []} vaData={vaData} />}        {activeTab === 'commissions' && <CommissionsTab policies={policies} />}
        {activeTab === 'portfolio' && <PortfolioTab />}
        {activeTab === 'data-diff' && <DataDiffTab />}
        {activeTab === 'carrier-sync' && <CarrierSyncTab />}
        {activeTab === 'commission-statements' && <CommissionStatementsTab dateRange={dateRange} />}
        {activeTab === 'combined-policies' && <CombinedPoliciesTab />}
      </div>
      <CommissionSidebar open={commSidebarOpen} onClose={() => setCommSidebarOpen(false)} onNavigateTab={setActiveTab} />
      <AiAnalystPane
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        applyPreset={applyPreset}
        setCustomRange={setCustomRange}
        dataSource={dataSource}
        setDataSource={setDataSource}
        dateRange={dateRange}
        setVoiceDrillTarget={setVoiceDrillTarget}
        policies={policies}
        calls={calls}
        pnl={pnl}
        goals={goals}
        onOpenChange={setAiPaneOpen}
        rightOffset={commSidebarOpen ? 536 : 0}
      />
    </div>
    <StatementRecordDrawer />
    </StatementRecordDrawerProvider>
  );
}
