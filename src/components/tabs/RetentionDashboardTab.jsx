'use client';
import { useState, useEffect, useMemo } from 'react';
import { C, fmt, fmtDollar, fmtPct, STATUS_COLORS, POLICYHOLDER_STATUSES, OUTREACH_METHODS, OUTREACH_OUTCOMES, LAPSE_REASONS } from '../shared/theme';
import PolicyholderDetailModal from '../crm/PolicyholderDetailModal';

function KPICard({ label, value, goal }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '16px 20px', flex: '1 1 0', minWidth: 140, borderTop: `3px solid ${C.accent}` }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: C.accent, fontFamily: C.mono, lineHeight: 1 }}>{value}</div>
      {goal && <div style={{ fontSize: 10, color: C.muted, marginTop: 6, fontFamily: C.mono }}>Goal: {goal}</div>}
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
    <div style={{ overflowX: 'auto', marginTop: 16 }}>
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
          {rows.map((row, i) => (
            <tr key={i} onClick={() => onRowClick && onRowClick(row)}
              onMouseEnter={e => e.currentTarget.style.background = '#151f30'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              style={{ cursor: onRowClick ? 'pointer' : 'default' }}>
              {columns.map(col => (
                <td key={col.key} style={{
                  padding: '10px 12px', textAlign: col.align || 'right', fontSize: 12,
                  color: col.color ? col.color(row[col.key], row) : C.text, fontFamily: col.mono ? C.mono : 'inherit',
                  borderBottom: `1px solid ${C.border}`,
                }}>
                  {col.render ? col.render(row[col.key], row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
          {totalsRow && (
            <tr style={{ background: C.surface, fontWeight: 700 }}>
              {columns.map(col => (
                <td key={col.key} style={{
                  padding: '10px 12px', textAlign: col.align || 'right', fontSize: 12,
                  color: C.text, fontFamily: col.mono ? C.mono : 'inherit',
                  borderBottom: `2px solid ${C.border}`, borderTop: `1px solid ${C.border}`,
                }}>
                  {totalsRow[col.key] || ''}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginTop: 20, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 16 }}>{title}</div>
      {children}
    </div>
  );
}

export default function RetentionDashboardTab({ dateRange }) {
  const [policyholders, setPolicyholders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [subtab, setSubtab] = useState('all');
  const [selectedPolicyholder, setSelectedPolicyholder] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [lastSync, setLastSync] = useState(null);

  // Fetch sync status on mount
  useEffect(() => {
    fetch('/api/crm/carrier-sync')
      .then(r => r.json())
      .then(d => { if (d.lastSync) setLastSync(d.lastSync); })
      .catch(() => {});
  }, []);

  const loadPolicyholders = () => {
    setLoading(true);
    fetch(`/api/crm/policyholders?start=${dateRange.start}&end=${dateRange.end}&page=1&limit=500`)
      .then(r => r.json())
      .then(d => {
        setPolicyholders(d.policyholders || []);
        setError(null);
      })
      .catch(err => {
        setError(err.message);
        setPolicyholders([]);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadPolicyholders(); }, [dateRange, subtab]);

  const runCarrierSync = async (dryRun = false) => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/crm/carrier-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSyncResult(data);
      if (!dryRun) {
        setLastSync({
          date: new Date().toISOString(),
          policiesProcessed: data.summary.processed,
          newPolicies: data.summary.newPolicies,
          statusChanges: data.summary.statusChanges,
          lapseEvents: data.summary.lapseEvents,
        });
        // Reload policyholders after sync
        setTimeout(loadPolicyholders, 1000);
      }
    } catch (err) {
      setSyncResult({ error: err.message });
    } finally {
      setSyncing(false);
    }
  };

  // Filter by subtab
  const filtered = useMemo(() => {
    if (subtab === 'all') return policyholders;
    if (subtab === 'active') return policyholders.filter(p => p.status === 'Active');
    if (subtab === 'at-risk') return policyholders.filter(p => p.status === 'At-Risk');
    if (subtab === 'lapsed') return policyholders.filter(p => p.status === 'Lapsed');
    if (subtab === 'win-back') return policyholders.filter(p => p.status === 'Win-Back');
    if (subtab === 'reinstated') return policyholders.filter(p => p.status === 'Reinstated');
    return policyholders;
  }, [policyholders, subtab]);

  // Calculate metrics
  const metrics = useMemo(() => {
    const active = filtered.filter(p => p.status === 'Active').length;
    const totalPremium = filtered.filter(p => p.status === 'Active').reduce((sum, p) => sum + (parseFloat(p.premium) || 0), 0);
    const atRisk = filtered.filter(p => p.status === 'At-Risk').length;
    const lapsed = filtered.filter(p => p.status === 'Lapsed').length;
    const lapseRate = filtered.length > 0 ? ((lapsed / (active + lapsed)) * 100).toFixed(1) : 0;
    const winBack = filtered.filter(p => p.status === 'Reinstated').length;
    const winBackSuccess = (active + lapsed) > 0 ? ((winBack / (active + lapsed)) * 100).toFixed(1) : 0;

    return {
      totalMembers: fmt(filtered.length),
      premiumInForce: fmtDollar(totalPremium),
      atRiskCount: fmt(atRisk),
      lapseRate: fmtPct(lapseRate),
      winBackSuccess: fmtPct(winBackSuccess),
    };
  }, [filtered]);

  // Format date
  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  // Days since last payment
  const daysSincePayment = (dateStr) => {
    if (!dateStr) return null;
    const days = Math.floor((new Date() - new Date(dateStr)) / (1000 * 60 * 60 * 24));
    return days;
  };

  const columns = [
    { key: 'name', label: 'Name', align: 'left' },
    { key: 'policyNumber', label: 'Policy #', align: 'left', mono: true },
    { key: 'carrier', label: 'Carrier', align: 'left' },
    { key: 'product', label: 'Product', align: 'left' },
    { key: 'premium', label: 'Premium', align: 'right', render: (val) => fmtDollar(parseFloat(val) || 0), mono: true },
    { key: 'status', label: 'Status', align: 'left', render: (val) => (
      <span style={{
        display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
        background: (STATUS_COLORS[val] || C.muted) + '22', color: STATUS_COLORS[val] || C.muted,
      }}>{val || '—'}</span>
    )},
    { key: 'lastPaymentDate', label: 'Days Since Payment', align: 'right', render: (val) => {
      const days = daysSincePayment(val);
      return <span style={{ color: days && days > 30 ? C.red : C.text, fontFamily: C.mono }}>{days ? days + 'd' : '—'}</span>;
    }, mono: true },
    { key: 'lastOutreach', label: 'Last Outreach', align: 'center', render: formatDate, mono: true },
    { key: 'outreachAttempts', label: 'Attempts', align: 'right', mono: true },
  ];

  const tableRows = filtered.map(p => ({
    ...p,
    name: p.firstName && p.lastName ? `${p.firstName} ${p.lastName}` : p.firstName || '—',
  }));

  if (loading) return <div style={{ color: C.muted, textAlign: 'center', padding: 40 }}>Loading policyholders...</div>;
  if (error) return <div style={{ color: C.red, textAlign: 'center', padding: 40 }}>Error: {error}</div>;

  return (
    <div>
      {/* Subtab bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: `1px solid ${C.border}`, paddingBottom: 12 }}>
        {['all', 'active', 'at-risk', 'lapsed', 'win-back', 'reinstated'].map(tab => (
          <button
            key={tab}
            onClick={() => setSubtab(tab)}
            style={{
              background: 'transparent', border: 'none', color: subtab === tab ? C.accent : C.muted,
              fontSize: 12, fontWeight: 600, cursor: 'pointer', paddingBottom: 8,
              borderBottom: subtab === tab ? `2px solid ${C.accent}` : 'none',
              fontFamily: C.sans, textTransform: 'capitalize',
            }}
          >
            {tab.replace('-', ' ')}
          </button>
        ))}
      </div>

      {/* Carrier Sync Bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
        padding: '10px 16px', marginBottom: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1 }}>
            Carrier Sync
          </div>
          {lastSync && (
            <div style={{ fontSize: 11, color: C.muted, fontFamily: 'monospace' }}>
              Last: {new Date(lastSync.date).toLocaleString()} — {lastSync.policiesProcessed} policies, {lastSync.newPolicies} new, {lastSync.statusChanges} changes
              {lastSync.lapseEvents > 0 && <span style={{ color: C.red, fontWeight: 700 }}> — {lastSync.lapseEvents} lapse events</span>}
            </div>
          )}
          {!lastSync && <div style={{ fontSize: 11, color: C.muted }}>No sync history</div>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => runCarrierSync(true)}
            disabled={syncing}
            style={{
              background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6,
              color: C.muted, fontSize: 11, fontWeight: 600, padding: '6px 14px',
              cursor: syncing ? 'not-allowed' : 'pointer', opacity: syncing ? 0.5 : 1,
            }}
          >
            Preview
          </button>
          <button
            onClick={() => runCarrierSync(false)}
            disabled={syncing}
            style={{
              background: C.accent, border: 'none', borderRadius: 6,
              color: '#fff', fontSize: 11, fontWeight: 700, padding: '6px 14px',
              cursor: syncing ? 'not-allowed' : 'pointer', opacity: syncing ? 0.5 : 1,
            }}
          >
            {syncing ? 'Syncing...' : 'Sync Now'}
          </button>
        </div>
      </div>

      {/* Sync Result Banner */}
      {syncResult && (
        <div style={{
          background: syncResult.error ? C.redDim : (syncResult.dryRun ? '#1a2538' : C.greenDim),
          border: `1px solid ${syncResult.error ? C.red : (syncResult.dryRun ? C.accent : C.green)}`,
          borderRadius: 8, padding: '12px 16px', marginBottom: 16,
        }}>
          {syncResult.error ? (
            <div style={{ color: C.red, fontSize: 12, fontWeight: 600 }}>Sync Error: {syncResult.error}</div>
          ) : (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: syncResult.dryRun ? C.accent : C.green, textTransform: 'uppercase' }}>
                  {syncResult.dryRun ? 'Preview Results (no changes made)' : 'Sync Complete'}
                </div>
                <button onClick={() => setSyncResult(null)} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 14 }}>x</button>
              </div>
              <div style={{ display: 'flex', gap: 20, fontSize: 12, color: C.text, fontFamily: 'monospace' }}>
                <span>{syncResult.summary.processed} processed</span>
                <span style={{ color: C.green }}>{syncResult.summary.newPolicies} new</span>
                <span style={{ color: C.accent }}>{syncResult.summary.updated} updated</span>
                <span style={{ color: C.yellow }}>{syncResult.summary.statusChanges} status changes</span>
                {syncResult.summary.lapseEvents > 0 && <span style={{ color: C.red, fontWeight: 700 }}>{syncResult.summary.lapseEvents} lapse events</span>}
                {syncResult.summary.reinstatements > 0 && <span style={{ color: C.green, fontWeight: 700 }}>{syncResult.summary.reinstatements} reinstatements</span>}
                {syncResult.summary.errors > 0 && <span style={{ color: C.red }}>{syncResult.summary.errors} errors</span>}
              </div>
              {syncResult.details?.statusChanges?.length > 0 && (
                <div style={{ marginTop: 10, fontSize: 11, color: C.muted }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>Status Changes:</div>
                  {syncResult.details.statusChanges.map((sc, i) => (
                    <div key={i} style={{ padding: '2px 0' }}>
                      <span style={{ color: C.text }}>{sc.name}</span>
                      <span style={{ color: C.muted }}> ({sc.policyNumber}) </span>
                      <span style={{ color: C.red }}>{sc.previousStatus}</span>
                      <span style={{ color: C.muted }}> → </span>
                      <span style={{ color: sc.newStatus === 'Lapsed' ? C.red : sc.newStatus === 'Reinstated' ? C.green : C.yellow }}>{sc.newStatus}</span>
                      <span style={{ color: C.muted }}> — {fmtDollar(sc.premium)}/mo</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Metrics */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <KPICard label="Total Members" value={metrics.totalMembers} />
        <KPICard label="Premium in Force" value={metrics.premiumInForce} />
        <KPICard label="At-Risk Members" value={metrics.atRiskCount} />
        <KPICard label="Lapse Rate %" value={metrics.lapseRate} />
        <KPICard label="Win-Back Success %" value={metrics.winBackSuccess} />
      </div>

      {/* Table */}
      <Section title="Policyholder List">
        {tableRows.length === 0 ? (
          <div style={{ color: C.muted, padding: 20, textAlign: 'center' }}>No policyholders found</div>
        ) : (
          <SortableTable
            columns={columns}
            rows={tableRows}
            defaultSort="lastPaymentDate"
            onRowClick={(row) => setSelectedPolicyholder(row.policyNumber)}
          />
        )}
      </Section>

      {/* Detail modal */}
      {selectedPolicyholder && <PolicyholderDetailModal policyNumber={selectedPolicyholder} onClose={() => setSelectedPolicyholder(null)} />}
    </div>
  );
}
