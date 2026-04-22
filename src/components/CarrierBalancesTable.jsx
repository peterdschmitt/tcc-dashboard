'use client';
import { useState, useEffect, useMemo } from 'react';

const C = {
  bg: '#080b10', surface: '#0f1520', card: '#131b28', border: '#1a2538',
  text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff', accentDim: '#1e3a5f',
  green: '#4ade80', greenDim: '#0a2e1a', yellow: '#facc15',
  red: '#f87171', redDim: '#2e0a0a', orange: '#fb923c', gray: '#64748b',
  mono: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
};

function fmtDollar(n) {
  if (n == null || isNaN(n)) return '—';
  return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDollarRound(n) {
  if (n == null || isNaN(n)) return '—';
  return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function Section({ title, children, rightContent }) {
  return (
    <div style={{ marginTop: 20, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1.2 }}>{title}</div>
        {rightContent}
      </div>
      {children}
    </div>
  );
}

function KPICard({ label, value, color, subtitle }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
      padding: '12px 16px', minWidth: 130, borderTop: `3px solid ${color || C.accent}`,
    }}>
      <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || C.text, fontFamily: C.mono, marginTop: 4 }}>{value}</div>
      {subtitle && <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{subtitle}</div>}
    </div>
  );
}

export default function CarrierBalancesTable() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedCarrier, setExpandedCarrier] = useState(null);
  const [sortKey, setSortKey] = useState('outstandingBalance');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    fetch('/api/commission-statements?view=ledger')
      .then(r => r.ok ? r.json() : null)
      .then(d => { setEntries(d?.entries || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // Build per-carrier, per-policy view.
  // Carriers like American Amicable send a NEW advance each statement rather than
  // a cumulative running total — so Received and Chargebacks must be SUMMED across
  // every entry. Outstanding Balance is the CURRENT position, so we take the
  // latest statement's reported balance per policy.
  const carrierData = useMemo(() => {
    const byCarrier = {};
    for (const e of entries) {
      const carrier = e.carrier || 'Unknown';
      if (!byCarrier[carrier]) byCarrier[carrier] = {};
      const pn = e.policyNumber || '(no policy #)';
      if (!byCarrier[carrier][pn]) {
        byCarrier[carrier][pn] = {
          policyNumber: pn, carrier,
          insuredName: e.insuredName, agent: e.agent, matchedPolicy: e.matchedPolicy,
          totalComm: 0, totalChargeback: 0, totalRecovery: 0,
          premium: e.premium || 0,
          outstandingBalance: e.outstandingBalance || 0,
          latestStatementDate: e.statementDate || '',
          latestStatementFile: e.statementFile || '',
          entryCount: 0,
        };
      }
      const agg = byCarrier[carrier][pn];
      const amt = e.commissionAmount || 0;
      // Sum commissionAmount across every entry (positive = advance, negative = chargeback adjustment)
      if (amt > 0) agg.totalComm += amt;
      else if (amt < 0) agg.totalChargeback += Math.abs(amt);
      agg.totalChargeback += (e.chargebackAmount || 0);   // explicit chargeback column
      agg.totalRecovery  += (e.recoveryAmount  || 0);
      agg.entryCount++;
      // Overwrite outstandingBalance + latest metadata with the newest statement
      if ((e.statementDate || '') >= agg.latestStatementDate) {
        agg.outstandingBalance   = e.outstandingBalance || 0;
        agg.latestStatementDate  = e.statementDate || '';
        agg.latestStatementFile  = e.statementFile || '';
        agg.premium              = e.premium || agg.premium;
      }
    }

    // Build carrier summaries
    const carriers = Object.entries(byCarrier).map(([carrier, policyMap]) => {
      const policies = Object.values(policyMap);
      const totalOutstanding = policies.reduce((s, p) => s + (p.outstandingBalance || 0), 0);
      const totalComm = policies.reduce((s, p) => s + (p.totalComm || 0), 0);
      const totalChargeback = policies.reduce((s, p) => s + (p.totalChargeback || 0), 0);
      const totalRecovery = policies.reduce((s, p) => s + (p.totalRecovery || 0), 0);
      const totalPremium = policies.reduce((s, p) => s + (p.premium || 0), 0);

      // Latest statement info
      let latestDate = '', latestFile = '';
      for (const p of policies) {
        if ((p.statementDate || '') > latestDate) {
          latestDate = p.statementDate || '';
          latestFile = p.statementFile || '';
        }
      }

      // Compute position narrative
      const advanceCount = policies.filter(p => (p.commissionAmount || 0) > 0).length;
      const cbCount = policies.filter(p => (p.commissionAmount || 0) < 0).length;
      const netEarned = totalComm - totalOutstanding;

      let position, positionColor, positionIcon;
      if (totalOutstanding > 0 && totalComm > 0) {
        position = `Advanced $${Math.abs(totalComm).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}. Outstanding balance of $${totalOutstanding.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} is unearned — at risk if policies cancel.`;
        positionColor = totalOutstanding > totalComm ? '#f87171' : '#facc15';
        positionIcon = totalOutstanding > totalComm ? '⚠' : '◐';
      } else if (totalOutstanding === 0 && totalComm > 0) {
        position = `Paid $${totalComm.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} with no outstanding balance. Fully earned or carrier does not track advance balance.`;
        positionColor = '#4ade80';
        positionIcon = '✓';
      } else if (totalComm < 0) {
        position = `Net negative — chargebacks exceed advances. We owe carrier $${Math.abs(totalComm).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}.`;
        positionColor = '#f87171';
        positionIcon = '‼';
      } else {
        position = `$${totalComm.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} net commission.`;
        positionColor = '#8fa3be';
        positionIcon = '—';
      }

      return {
        carrier,
        policyCount: policies.length,
        advanceCount,
        cbCount,
        totalOutstanding,
        totalComm,
        totalChargeback,
        totalRecovery,
        totalPremium,
        netEarned,
        latestDate,
        latestFile,
        policies,
        position,
        positionColor,
        positionIcon,
      };
    }).sort((a, b) => b.totalOutstanding - a.totalOutstanding);

    return carriers;
  }, [entries]);

  const grandTotals = useMemo(() => {
    const t = carrierData.reduce((t, c) => ({
      policies: t.policies + c.policyCount,
      outstanding: t.outstanding + c.totalOutstanding,
      comm: t.comm + c.totalComm,
      chargeback: t.chargeback + c.totalChargeback,
      recovery: t.recovery + c.totalRecovery,
      premium: t.premium + c.totalPremium,
      netEarned: t.netEarned + c.netEarned,
    }), { policies: 0, outstanding: 0, comm: 0, chargeback: 0, recovery: 0, premium: 0, netEarned: 0 });
    return t;
  }, [carrierData]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  if (loading) return (
    <div style={{ textAlign: 'center', padding: 40, color: C.muted }}>
      <div style={{ width: 30, height: 30, border: `2px solid ${C.border}`, borderTopColor: C.accent, borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
      Loading carrier balance data...
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  const thStyle = { padding: '6px 8px', fontSize: 9, color: C.muted, fontWeight: 600, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', textAlign: 'left' };
  const thRight = { ...thStyle, textAlign: 'right' };
  const tdStyle = { padding: '6px 8px', fontSize: 10, borderBottom: `1px solid ${C.border}33` };
  const tdRight = { ...tdStyle, textAlign: 'right', fontFamily: C.mono };

  const SortTh = ({ label, field, align = 'left' }) => (
    <th style={align === 'right' ? thRight : thStyle} onClick={() => toggleSort(field)}>
      {label} <span style={{ fontSize: 7, opacity: sortKey === field ? 1 : 0.3 }}>
        {sortKey === field ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
      </span>
    </th>
  );

  // Expanded carrier detail view
  const expandedData = expandedCarrier ? carrierData.find(c => c.carrier === expandedCarrier) : null;
  const sortedPolicies = expandedData ? [...expandedData.policies].sort((a, b) => {
    const va = a[sortKey], vb = b[sortKey];
    if (typeof va === 'string') return sortDir === 'asc' ? (va || '').localeCompare(vb || '') : (vb || '').localeCompare(va || '');
    return sortDir === 'asc' ? (va || 0) - (vb || 0) : (vb || 0) - (va || 0);
  }) : [];

  return (
    <>
      {/* KPI Cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <KPICard label="Carriers" value={carrierData.length} color={C.accent} subtitle={`${grandTotals.policies} policies with statements`} />
        <KPICard label="Commission Received" value={fmtDollarRound(grandTotals.comm)} color={C.green}
          subtitle="Total advanced by carriers" />
        <KPICard label="Outstanding Balance" value={fmtDollarRound(grandTotals.outstanding)} color={grandTotals.outstanding > 0 ? C.yellow : C.green}
          subtitle="Unearned — at risk if policies cancel" />
        <KPICard label="Net Earned" value={fmtDollarRound(grandTotals.netEarned)} color={grandTotals.netEarned > 0 ? C.green : C.red}
          subtitle="Commission - Outstanding = kept" />
        <KPICard label="Chargebacks" value={fmtDollarRound(grandTotals.chargeback)} color={grandTotals.chargeback > 0 ? C.red : C.muted}
          subtitle="Clawed back by carriers" />
      </div>

      {/* Field Definitions */}
      <Section title="How to Read This Report">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px', fontSize: 10, color: C.muted }}>
          <div><span style={{ color: C.green, fontWeight: 700 }}>Commission Received</span> — Total dollars carriers have advanced to us on new policies. This is upfront money based on anticipated premium collection.</div>
          <div><span style={{ color: C.yellow, fontWeight: 700 }}>Outstanding Balance</span> — Unearned portion of the advance. The carrier advanced us money we haven't earned yet. If all policies stay active, this earns down to $0 over time. If policies cancel, the carrier claws it back.</div>
          <div><span style={{ color: C.green, fontWeight: 700 }}>Net Earned</span> — Commission Received minus Outstanding Balance. This is the money we've actually earned and can keep regardless of cancellations.</div>
          <div><span style={{ color: C.red, fontWeight: 700 }}>Chargebacks</span> — Money the carrier has taken back because a policy was canceled. Reduces our commission received.</div>
          <div><span style={{ color: C.orange, fontWeight: 700 }}>Recoveries</span> — Earned commission clawed back separately from the advance (e.g., post-advance-period clawbacks).</div>
          <div><span style={{ color: C.text, fontWeight: 700 }}>Premium</span> — Monthly premium on policies in the latest carrier statement. This drives the commission calculation.</div>
        </div>
      </Section>

      {/* Carrier Position Narratives */}
      <Section title="Current Position by Carrier">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {carrierData.map(c => (
            <div key={c.carrier} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '10px 14px', borderLeft: `3px solid ${c.positionColor}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: C.text }}>{c.positionIcon} {c.carrier}</span>
                <span style={{ fontSize: 10, fontFamily: C.mono, color: C.muted }}>
                  {c.policyCount} policies ({c.advanceCount} advances, {c.cbCount} chargebacks)
                </span>
              </div>
              <div style={{ display: 'flex', gap: 16, marginBottom: 6, fontSize: 10, fontFamily: C.mono }}>
                <span>Received: <span style={{ color: C.green, fontWeight: 600 }}>{fmtDollar(c.totalComm)}</span></span>
                <span>Outstanding: <span style={{ color: C.yellow, fontWeight: 600 }}>{fmtDollar(c.totalOutstanding)}</span></span>
                <span>Net Earned: <span style={{ color: c.netEarned >= 0 ? C.green : C.red, fontWeight: 600 }}>{fmtDollar(c.netEarned)}</span></span>
                {c.totalChargeback > 0 && <span>Chargebacks: <span style={{ color: C.red, fontWeight: 600 }}>{fmtDollar(c.totalChargeback)}</span></span>}
              </div>
              <div style={{ fontSize: 10, color: c.positionColor, lineHeight: 1.4 }}>{c.position}</div>
              <div style={{ fontSize: 9, color: C.muted, marginTop: 4 }}>Latest statement: {c.latestFile || '—'} ({c.latestDate || '—'})</div>
            </div>
          ))}

          {/* Grand total narrative */}
          <div style={{ background: C.bg, border: `1px solid ${C.accent}`, borderRadius: 6, padding: '10px 14px', borderLeft: `3px solid ${C.accent}` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.text, marginBottom: 6 }}>Overall Position</div>
            <div style={{ display: 'flex', gap: 16, marginBottom: 6, fontSize: 10, fontFamily: C.mono }}>
              <span>Received: <span style={{ color: C.green, fontWeight: 600 }}>{fmtDollar(grandTotals.comm)}</span></span>
              <span>Outstanding: <span style={{ color: C.yellow, fontWeight: 600 }}>{fmtDollar(grandTotals.outstanding)}</span></span>
              <span>Net Earned: <span style={{ color: grandTotals.netEarned >= 0 ? C.green : C.red, fontWeight: 700 }}>{fmtDollar(grandTotals.netEarned)}</span></span>
            </div>
            <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.5 }}>
              Carriers have advanced a total of {fmtDollarRound(grandTotals.comm)} across {grandTotals.policies} policies.
              Of that, {fmtDollarRound(grandTotals.outstanding)} is still unearned and at risk if policies cancel.
              {grandTotals.netEarned > 0
                ? ` Net earned position is ${fmtDollarRound(grandTotals.netEarned)} — this is money earned and kept.`
                : ` Net position is ${fmtDollarRound(grandTotals.netEarned)} — chargebacks and unearned advances exceed earned commission.`}
              {grandTotals.chargeback > 0 && ` ${fmtDollarRound(grandTotals.chargeback)} has already been clawed back through chargebacks.`}
            </div>
          </div>
        </div>
      </Section>

      {/* Carrier Summary Table */}
      <Section title="Carrier-Reported Balances (Latest Statement)">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                <th style={thStyle}>Carrier</th>
                <th style={thRight}># Policies</th>
                <th style={thRight}>Commission Received</th>
                <th style={thRight}>Outstanding Balance</th>
                <th style={thRight}>Net Earned</th>
                <th style={thRight}>Chargebacks</th>
                <th style={thRight}>Premium</th>
                <th style={thStyle}>Latest Statement</th>
                <th style={thStyle}>Statement Date</th>
                <th style={thStyle}>Position</th>
              </tr>
            </thead>
            <tbody>
              {carrierData.map(c => (
                <tr key={c.carrier}
                  onClick={() => { setExpandedCarrier(expandedCarrier === c.carrier ? null : c.carrier); setSortKey('outstandingBalance'); setSortDir('desc'); }}
                  style={{ cursor: 'pointer', borderBottom: `1px solid ${C.border}33`, background: expandedCarrier === c.carrier ? 'rgba(91,159,255,0.06)' : 'transparent' }}
                  onMouseOver={e => { if (expandedCarrier !== c.carrier) e.currentTarget.style.background = 'rgba(91,159,255,0.04)'; }}
                  onMouseOut={e => { if (expandedCarrier !== c.carrier) e.currentTarget.style.background = 'transparent'; }}>
                  <td style={{ ...tdStyle, color: C.text, fontWeight: 600 }}>
                    <span style={{ marginRight: 6, fontSize: 8, color: C.muted }}>{expandedCarrier === c.carrier ? '▾' : '▸'}</span>
                    {c.carrier}
                  </td>
                  <td style={{ ...tdRight, color: C.text, fontWeight: 600 }}>{c.policyCount}</td>
                  <td style={{ ...tdRight, color: c.totalComm > 0 ? C.green : c.totalComm < 0 ? C.red : C.muted }}>{fmtDollar(c.totalComm)}</td>
                  <td style={{ ...tdRight, color: c.totalOutstanding > 0 ? C.yellow : C.green, fontWeight: 700 }}>{fmtDollar(c.totalOutstanding)}</td>
                  <td style={{ ...tdRight, color: c.netEarned >= 0 ? C.green : C.red, fontWeight: 700 }}>{fmtDollar(c.netEarned)}</td>
                  <td style={{ ...tdRight, color: c.totalChargeback > 0 ? C.red : C.muted }}>{c.totalChargeback > 0 ? fmtDollar(c.totalChargeback) : '—'}</td>
                  <td style={tdRight}>{fmtDollar(c.totalPremium)}</td>
                  <td style={{ ...tdStyle, color: C.muted, fontSize: 9, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.latestFile || '—'}</td>
                  <td style={{ ...tdStyle, fontFamily: C.mono, fontSize: 9 }}>{c.latestDate || '—'}</td>
                  <td style={{ ...tdStyle, color: c.positionColor, fontSize: 9 }}>{c.positionIcon}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: `2px solid ${C.accent}` }}>
                <td style={{ ...tdStyle, fontWeight: 700, color: C.text }}>TOTAL</td>
                <td style={{ ...tdRight, fontWeight: 700, color: C.text }}>{grandTotals.policies}</td>
                <td style={{ ...tdRight, fontWeight: 700, color: C.green }}>{fmtDollar(grandTotals.comm)}</td>
                <td style={{ ...tdRight, fontWeight: 700, color: C.yellow }}>{fmtDollar(grandTotals.outstanding)}</td>
                <td style={{ ...tdRight, fontWeight: 700, color: grandTotals.netEarned >= 0 ? C.green : C.red }}>{fmtDollar(grandTotals.netEarned)}</td>
                <td style={{ ...tdRight, fontWeight: 700, color: grandTotals.chargeback > 0 ? C.red : C.muted }}>{grandTotals.chargeback > 0 ? fmtDollar(grandTotals.chargeback) : '—'}</td>
                <td style={{ ...tdRight, fontWeight: 700 }}>{fmtDollar(grandTotals.premium)}</td>
                <td colSpan="3"></td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Expanded policy detail */}
        {expandedData && (
          <div style={{ marginTop: 16, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
              {expandedData.carrier} — {expandedData.policyCount} Policies
              <span style={{ color: C.muted, fontWeight: 400, marginLeft: 8, fontSize: 9 }}>
                Statement: {expandedData.latestFile} ({expandedData.latestDate})
              </span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    <SortTh label="Policy #" field="policyNumber" />
                    <SortTh label="Insured" field="insuredName" />
                    <SortTh label="Agent" field="agent" />
                    <SortTh label="Product" field="product" />
                    <SortTh label="Type" field="transactionType" />
                    <SortTh label="Premium" field="premium" align="right" />
                    <SortTh label="Comm %" field="commissionPct" align="right" />
                    <SortTh label="Advance %" field="advancePct" align="right" />
                    <SortTh label="Commission" field="commissionAmount" align="right" />
                    <SortTh label="Outstanding" field="outstandingBalance" align="right" />
                    <SortTh label="Chargeback" field="chargebackAmount" align="right" />
                    <SortTh label="Recovery" field="recoveryAmount" align="right" />
                    <SortTh label="Issue Date" field="issueDate" />
                    <SortTh label="Stmt Date" field="statementDate" />
                  </tr>
                </thead>
                <tbody>
                  {sortedPolicies.map((p, i) => {
                    const isNeg = (p.commissionAmount || 0) < 0;
                    return (
                      <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(91,159,255,0.02)', borderBottom: `1px solid ${C.border}22` }}>
                        <td style={{ ...tdStyle, color: C.text, fontFamily: C.mono, fontSize: 9 }}>{p.policyNumber || '—'}</td>
                        <td style={{ ...tdStyle, color: C.text }}>{p.insuredName || '—'}</td>
                        <td style={{ ...tdStyle, color: C.muted, fontSize: 9 }}>{p.agent || p.agentId || '—'}</td>
                        <td style={{ ...tdStyle, color: C.muted, fontSize: 9 }}>{p.product || '—'}</td>
                        <td style={{ ...tdStyle, fontSize: 9 }}>
                          <span style={{
                            padding: '1px 5px', borderRadius: 3, fontSize: 8, fontWeight: 600,
                            background: p.transactionType === 'advance' ? C.greenDim : p.transactionType === 'chargeback' ? C.redDim : C.accentDim,
                            color: p.transactionType === 'advance' ? C.green : p.transactionType === 'chargeback' ? C.red : C.accent,
                          }}>{p.transactionType}</span>
                        </td>
                        <td style={tdRight}>{fmtDollar(p.premium)}</td>
                        <td style={{ ...tdRight, color: C.muted }}>{p.commissionPct ? `${(p.commissionPct * 100).toFixed(0)}%` : '—'}</td>
                        <td style={{ ...tdRight, color: C.muted }}>{p.advancePct ? `${(p.advancePct * 100).toFixed(0)}%` : '—'}</td>
                        <td style={{ ...tdRight, color: isNeg ? C.red : C.green, fontWeight: 600 }}>{fmtDollar(p.commissionAmount)}</td>
                        <td style={{ ...tdRight, color: (p.outstandingBalance || 0) > 0 ? C.yellow : C.muted, fontWeight: 600 }}>{fmtDollar(p.outstandingBalance)}</td>
                        <td style={{ ...tdRight, color: (p.chargebackAmount || 0) > 0 ? C.red : C.muted }}>{(p.chargebackAmount || 0) > 0 ? fmtDollar(p.chargebackAmount) : '—'}</td>
                        <td style={{ ...tdRight, color: (p.recoveryAmount || 0) > 0 ? C.orange : C.muted }}>{(p.recoveryAmount || 0) > 0 ? fmtDollar(p.recoveryAmount) : '—'}</td>
                        <td style={{ ...tdStyle, fontFamily: C.mono, fontSize: 9 }}>{p.issueDate || '—'}</td>
                        <td style={{ ...tdStyle, fontFamily: C.mono, fontSize: 9 }}>{p.statementDate || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div style={{ fontSize: 9, color: C.muted, marginTop: 8 }}>
          Balances reported directly by carriers on their commission statements. Click a carrier to see policy detail.
        </div>
      </Section>
    </>
  );
}
