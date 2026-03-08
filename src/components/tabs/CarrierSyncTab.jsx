'use client';
import { useState, useEffect } from 'react';
import { C, fmt, fmtDollar, fmtPct } from '../shared/theme';

function Section({ title, children }) {
  return (
    <div style={{ marginTop: 20, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 16 }}>{title}</div>
      {children}
    </div>
  );
}

export default function CarrierSyncTab() {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [updateMerged, setUpdateMerged] = useState(true);

  // Fetch sync status on mount
  useEffect(() => {
    fetch('/api/crm/carrier-sync')
      .then(r => r.json())
      .then(d => { if (d.lastSync) setLastSync(d.lastSync); })
      .catch(() => {});
  }, []);

  const runCarrierSync = async (dryRun = false) => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/crm/carrier-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun, updateMerged }),
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
      }
    } catch (err) {
      setSyncResult({ error: err.message });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 4 }}>Carrier Data Sync</div>
        <div style={{ fontSize: 12, color: C.muted }}>
          Sync carrier report data into the CRM policyholders table and optionally update the Merged economics tab with carrier-corrected premium and status values.
        </div>
      </div>

      {/* Sync Controls */}
      <Section title="Sync Controls">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {lastSync && (
              <div style={{ fontSize: 11, color: C.muted, fontFamily: 'monospace' }}>
                Last sync: {new Date(lastSync.date).toLocaleString()} — {lastSync.policiesProcessed} policies, {lastSync.newPolicies} new, {lastSync.statusChanges} changes
                {lastSync.lapseEvents > 0 && <span style={{ color: C.red, fontWeight: 700 }}> — {lastSync.lapseEvents} lapse events</span>}
              </div>
            )}
            {!lastSync && <div style={{ fontSize: 11, color: C.muted }}>No sync history</div>}
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: updateMerged ? C.green : C.muted, cursor: 'pointer' }}>
              <input type="checkbox" checked={updateMerged} onChange={e => setUpdateMerged(e.target.checked)}
                style={{ accentColor: C.green, width: 14, height: 14, cursor: 'pointer' }} />
              Update Merged Economics
            </label>
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
      </Section>

      {/* Sync Result */}
      {syncResult && (
        <div style={{
          marginTop: 16,
          background: syncResult.error ? C.redDim : (syncResult.dryRun ? '#1a2538' : C.greenDim),
          border: `1px solid ${syncResult.error ? C.red : (syncResult.dryRun ? C.accent : C.green)}`,
          borderRadius: 8, padding: '16px 20px',
        }}>
          {syncResult.error ? (
            <div style={{ color: C.red, fontSize: 12, fontWeight: 600 }}>Sync Error: {syncResult.error}</div>
          ) : (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: syncResult.dryRun ? C.accent : C.green, textTransform: 'uppercase' }}>
                  {syncResult.dryRun ? 'Preview Results (no changes made)' : 'Sync Complete'}
                </div>
                <button onClick={() => setSyncResult(null)} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 14 }}>×</button>
              </div>

              {/* CRM Policyholder Sync */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 6 }}>CRM Policyholder Sync</div>
                <div style={{ display: 'flex', gap: 20, fontSize: 12, color: C.text, fontFamily: 'monospace', flexWrap: 'wrap' }}>
                  <span>{syncResult.summary.processed} processed</span>
                  <span style={{ color: C.green }}>{syncResult.summary.newPolicies} new</span>
                  <span style={{ color: C.accent }}>{syncResult.summary.updated} updated</span>
                  <span style={{ color: C.yellow }}>{syncResult.summary.statusChanges} status changes</span>
                  {syncResult.summary.lapseEvents > 0 && <span style={{ color: C.red, fontWeight: 700 }}>{syncResult.summary.lapseEvents} lapse events</span>}
                  {syncResult.summary.reinstatements > 0 && <span style={{ color: C.green, fontWeight: 700 }}>{syncResult.summary.reinstatements} reinstatements</span>}
                  {syncResult.summary.errors > 0 && <span style={{ color: C.red }}>{syncResult.summary.errors} errors</span>}
                </div>
              </div>

              {/* Status Changes Detail */}
              {syncResult.details?.statusChanges?.length > 0 && (
                <div style={{ marginBottom: 12, fontSize: 11, color: C.muted }}>
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

              {/* Merged Economics Results */}
              {syncResult.merged && !syncResult.merged.error && (
                <div style={{ paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: C.accent, marginBottom: 6, textTransform: 'uppercase' }}>
                    Merged Economics {syncResult.merged.tabCreated && '(Tab Created)'}
                  </div>
                  <div style={{ display: 'flex', gap: 20, fontSize: 12, color: C.text, fontFamily: 'monospace', flexWrap: 'wrap' }}>
                    <span>{syncResult.merged.matched} matched</span>
                    <span style={{ color: C.yellow }}>{syncResult.merged.updated} updated</span>
                    <span>{syncResult.merged.unchanged} unchanged</span>
                    <span style={{ color: C.red }}>{syncResult.merged.unmatched} unmatched</span>
                  </div>
                  {(syncResult.merged.impact?.policiesAtRisk > 0 || syncResult.merged.impact?.premiumChange !== 0) && (
                    <div style={{ display: 'flex', gap: 20, fontSize: 12, color: C.text, fontFamily: 'monospace', marginTop: 6, flexWrap: 'wrap' }}>
                      {syncResult.merged.impact.policiesAtRisk > 0 && (
                        <span style={{ color: C.red, fontWeight: 700 }}>{syncResult.merged.impact.policiesAtRisk} phantom revenue ({fmtDollar(syncResult.merged.impact.phantomRevenue)}/mo)</span>
                      )}
                      {syncResult.merged.impact.premiumChange !== 0 && (
                        <span style={{ color: syncResult.merged.impact.premiumChange > 0 ? C.green : C.red }}>
                          Premium net: {syncResult.merged.impact.premiumChange > 0 ? '+' : ''}{fmtDollar(syncResult.merged.impact.premiumChange)}/mo
                        </span>
                      )}
                      {syncResult.merged.impact.statusChanges > 0 && (
                        <span style={{ color: C.yellow }}>{syncResult.merged.impact.statusChanges} status corrections</span>
                      )}
                    </div>
                  )}
                  {syncResult.merged.changes?.length > 0 && (
                    <div style={{ marginTop: 10, fontSize: 11, color: C.muted }}>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>Economics Corrections:</div>
                      {syncResult.merged.changes.slice(0, 20).map((ch, i) => (
                        <div key={i} style={{ padding: '2px 0' }}>
                          <span style={{ color: C.text }}>{ch.name}</span>
                          <span style={{ color: C.muted }}> ({ch.salesPolicyNo}) </span>
                          <span style={{ color: C.muted, fontSize: 10 }}>[{ch.matchType}, {(ch.confidence * 100).toFixed(0)}%] </span>
                          {ch.premiumChange && (
                            <span style={{ color: C.yellow }}>
                              {fmtDollar(ch.premiumChange.from)}→{fmtDollar(ch.premiumChange.to)}
                            </span>
                          )}
                          {ch.premiumChange && ch.statusChange && <span style={{ color: C.muted }}> | </span>}
                          {ch.statusChange && (
                            <span>
                              <span style={{ color: C.red }}>{ch.statusChange.from}</span>
                              <span style={{ color: C.muted }}>→</span>
                              <span style={{ color: ch.statusChange.to === 'Declined' ? C.red : C.green }}>{ch.statusChange.to}</span>
                            </span>
                          )}
                        </div>
                      ))}
                      {syncResult.merged.changes.length > 20 && (
                        <div style={{ color: C.muted, fontSize: 10, marginTop: 4 }}>...and {syncResult.merged.changes.length - 20} more</div>
                      )}
                    </div>
                  )}
                  {syncResult.merged.unmatchedRecords?.length > 0 && (
                    <div style={{ marginTop: 10, fontSize: 11, color: C.muted }}>
                      <div style={{ fontWeight: 700, marginBottom: 4, color: C.red }}>Unmatched Carrier Records:</div>
                      {syncResult.merged.unmatchedRecords.slice(0, 10).map((ur, i) => (
                        <div key={i} style={{ padding: '2px 0' }}>
                          <span style={{ color: C.text }}>{ur.name}</span>
                          <span style={{ color: C.muted }}> ({ur.carrierPolicyNo}) </span>
                          <span style={{ color: C.muted }}>{ur.carrier} — {ur.status} — {fmtDollar(ur.premium)}/mo</span>
                        </div>
                      ))}
                      {syncResult.merged.unmatchedRecords.length > 10 && (
                        <div style={{ color: C.muted, fontSize: 10, marginTop: 4 }}>...and {syncResult.merged.unmatchedRecords.length - 10} more</div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {syncResult.merged?.error && (
                <div style={{ marginTop: 10, fontSize: 11, color: C.red }}>Merged sync error: {syncResult.merged.error}</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* How It Works */}
      <Section title="How It Works">
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.8 }}>
          <div style={{ marginBottom: 8 }}>
            <span style={{ color: C.text, fontWeight: 600 }}>CRM Sync:</span> Reads the carrier report (DetailedProduction), matches records to the Policyholders tab by policy number, updates statuses, detects lapse events, and creates outreach tasks.
          </div>
          <div style={{ marginBottom: 8 }}>
            <span style={{ color: C.text, fontWeight: 600 }}>Merged Economics:</span> Creates a "Merged" tab that mirrors Sheet1 but with carrier-corrected premium and status values. The dashboard can read from this tab instead of Sheet1 for accurate economics.
          </div>
          <div style={{ marginBottom: 8 }}>
            <span style={{ color: C.text, fontWeight: 600 }}>Matching:</span> Uses policy number (exact match for AIG/Transamerica) and fuzzy name+agent matching (for American Amicable which uses different numbering).
          </div>
          <div>
            <span style={{ color: C.text, fontWeight: 600 }}>To activate Merged economics:</span> After the first sync creates the Merged tab, set <span style={{ fontFamily: 'monospace', color: C.accent }}>SALES_TAB_NAME=Merged</span> in .env.local and restart.
          </div>
        </div>
      </Section>
    </div>
  );
}
