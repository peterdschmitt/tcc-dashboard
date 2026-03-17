'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { C, fmt, fmtDollar, fmtPct } from '../shared/theme';

/** Generic sort comparator — handles strings, numbers, dates */
function compareValues(a, b, key) {
  let va = a?.[key], vb = b?.[key];
  if (va == null && vb == null) return 0;
  if (va == null) return 1;
  if (vb == null) return -1;
  // Try numeric
  const na = typeof va === 'number' ? va : parseFloat(va);
  const nb = typeof vb === 'number' ? vb : parseFloat(vb);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  // String compare
  return String(va).localeCompare(String(vb), undefined, { sensitivity: 'base' });
}

function sortData(data, sortKey, sortDir) {
  if (!sortKey || !data) return data;
  return [...data].sort((a, b) => {
    const cmp = compareValues(a, b, sortKey);
    return sortDir === 'desc' ? -cmp : cmp;
  });
}

function useSort(defaultKey = null, defaultDir = 'asc') {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState(defaultDir);
  const toggle = useCallback((key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }, [sortKey]);
  return { sortKey, sortDir, toggle };
}

/** Sortable table header cell */
function SortTh({ label, field, sortKey, sortDir, onSort, style }) {
  const active = sortKey === field;
  return (
    <th
      onClick={() => onSort(field)}
      style={{
        ...style, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
        color: active ? C.accent : style?.color || C.muted,
      }}
    >
      {label} <span style={{ fontSize: 8, opacity: active ? 1 : 0.3 }}>{active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
    </th>
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

function KPICard({ label, value, color, subtitle }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
      padding: '12px 16px', minWidth: 120, borderTop: `3px solid ${color || C.accent}`,
    }}>
      <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || C.text, fontFamily: C.mono, marginTop: 4 }}>{value}</div>
      {subtitle && <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{subtitle}</div>}
    </div>
  );
}

const SUB_TABS = [
  { id: 'upload', label: 'Upload' },
  { id: 'history', label: 'History' },
  { id: 'reconciliation', label: 'Reconciliation' },
];

export default function CommissionStatementsTab() {
  const [subTab, setSubTab] = useState('upload');
  const [file, setFile] = useState(null);
  const [carrier, setCarrier] = useState('auto');
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [statements, setStatements] = useState([]);
  const [selectedStatement, setSelectedStatement] = useState(null);
  const [reconciliation, setReconciliation] = useState(null);
  const [pendingReviews, setPendingReviews] = useState([]);
  const [approving, setApproving] = useState({});
  const [isDragging, setIsDragging] = useState(false);
  const [ledgerEntries, setLedgerEntries] = useState(null);
  const [selectedPolicy, setSelectedPolicy] = useState(null);

  // Drive sync state
  const [syncStatus, setSyncStatus] = useState(null); // null | 'checking' | 'preview' | 'syncing' | 'done' | 'error'
  const [syncPreview, setSyncPreview] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [syncError, setSyncError] = useState(null);

  // Sort state for each table
  const historySort = useSort('uploadDate', 'desc');
  const reconSort = useSort('balance', 'desc');
  const matchedSort = useSort(null);
  const unmatchedSort = useSort(null);

  // Load data on mount and tab change
  useEffect(() => {
    if (subTab === 'history') loadStatements();
    if (subTab === 'reconciliation') loadReconciliation();
  }, [subTab]);

  const loadStatements = async () => {
    try {
      const res = await fetch('/api/commission-statements?view=statements');
      const data = await res.json();
      setStatements((data.statements || []).map((s, i) => ({ ...s, _rowIdx: i })));
    } catch (e) { console.error('Failed to load statements:', e); }
  };

  const loadReconciliation = async () => {
    try {
      const res = await fetch('/api/commission-statements?view=reconciliation');
      const data = await res.json();
      setReconciliation(data);
    } catch (e) { console.error('Failed to load reconciliation:', e); }
  };

  const loadPending = async () => {
    try {
      const res = await fetch('/api/commission-statements?view=pending');
      const data = await res.json();
      setPendingReviews(data.pendingReviews || []);
    } catch (e) { console.error('Failed to load pending:', e); }
  };

  const handleUpload = async (dryRun = false) => {
    if (!file) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('carrier', carrier);
      formData.append('dryRun', dryRun.toString());

      const res = await fetch('/api/commission-statements/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setUploadResult(data);
    } catch (err) {
      setUploadResult({ error: err.message });
    } finally {
      setUploading(false);
    }
  };

  const handleApprove = async (transactionId, action) => {
    setApproving(prev => ({ ...prev, [transactionId]: true }));
    try {
      const res = await fetch('/api/commission-statements/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actions: [{ transactionId, action }] }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      // Update local state
      if (uploadResult) {
        setUploadResult(prev => ({
          ...prev,
          records: prev.records.map(r =>
            r.transactionId === transactionId ? { ...r, status: action.includes('approve') ? 'approved' : 'rejected' } : r
          ),
          cancellationAlerts: prev.cancellationAlerts.filter(a => a.transactionId !== transactionId),
        }));
      }
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setApproving(prev => ({ ...prev, [transactionId]: false }));
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer?.files?.[0];
    if (droppedFile) setFile(droppedFile);
  };

  const handleDriveCheck = async () => {
    setSyncStatus('checking');
    setSyncPreview(null);
    setSyncResult(null);
    setSyncError(null);
    try {
      const res = await fetch('/api/commission-statements/sync-drive');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSyncPreview(data);
      setSyncStatus('preview');
    } catch (err) {
      setSyncError(err.message);
      setSyncStatus('error');
    }
  };

  const handleDriveSync = async () => {
    setSyncStatus('syncing');
    setSyncError(null);
    try {
      const res = await fetch('/api/commission-statements/sync-drive', { method: 'POST' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSyncResult(data);
      setSyncStatus('done');
    } catch (err) {
      setSyncError(err.message);
      setSyncStatus('error');
    }
  };

  const pillStyle = (active) => ({
    background: active ? C.accent : 'transparent',
    border: `1px solid ${active ? C.accent : C.border}`,
    borderRadius: 6, padding: '5px 14px', fontSize: 11, fontWeight: 600,
    color: active ? '#fff' : C.muted, cursor: 'pointer',
  });

  const thStyle = { textAlign: 'left', padding: '8px 12px', fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.6, borderBottom: `1px solid ${C.border}` };
  const tdStyle = { padding: '8px 12px', fontSize: 12, color: C.text, fontFamily: C.mono, borderBottom: `1px solid ${C.border}` };

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 4 }}>Commission Statements</div>
        <div style={{ fontSize: 12, color: C.muted }}>
          Upload carrier commission statements (PDF/Excel), match to policies, track advances and clawbacks, detect cancellations.
        </div>
      </div>

      {/* Sub-tab toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {SUB_TABS.map(t => (
          <button key={t.id} style={pillStyle(subTab === t.id)} onClick={() => setSubTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ═══════════════ UPLOAD VIEW ═══════════════ */}
      {subTab === 'upload' && (
        <div>
          <Section title="Upload Statement">
            {/* File drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => document.getElementById('comm-file-input')?.click()}
              style={{
                border: `2px dashed ${isDragging ? C.accent : C.border}`,
                borderRadius: 8, padding: '24px 16px', textAlign: 'center',
                cursor: 'pointer', background: isDragging ? C.accentDim || '#1a2538' : 'transparent',
                transition: 'all 0.15s',
              }}
            >
              <input
                id="comm-file-input"
                type="file"
                accept=".pdf,.xlsx,.xls,.csv"
                style={{ display: 'none' }}
                onChange={e => setFile(e.target.files?.[0] || null)}
              />
              {file ? (
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{file.name}</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
                    {(file.size / 1024).toFixed(1)} KB — Click to change file
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 13, color: C.muted }}>Drop a commission statement here or click to browse</div>
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 6 }}>Supports PDF, XLSX, CSV</div>
                </div>
              )}
            </div>

            {/* Controls row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, flexWrap: 'wrap', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <label style={{ fontSize: 11, color: C.muted }}>Carrier:</label>
                <select
                  value={carrier}
                  onChange={e => setCarrier(e.target.value)}
                  style={{
                    background: C.card, border: `1px solid ${C.border}`, borderRadius: 6,
                    color: C.text, fontSize: 11, padding: '4px 8px', fontFamily: C.mono,
                  }}
                >
                  <option value="auto">Auto-detect</option>
                  <option value="aig">AIG Corebridge</option>
                  <option value="transamerica">TransAmerica</option>
                  <option value="american-amicable">American Amicable</option>
                  <option value="baltimore-life">Baltimore Life</option>
                  <option value="cica">CICA</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => handleUpload(true)}
                  disabled={!file || uploading}
                  style={{
                    background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6,
                    color: C.muted, fontSize: 11, fontWeight: 600, padding: '6px 14px',
                    cursor: !file || uploading ? 'not-allowed' : 'pointer', opacity: !file || uploading ? 0.5 : 1,
                  }}
                >
                  Preview
                </button>
                <button
                  onClick={() => handleUpload(false)}
                  disabled={!file || uploading}
                  style={{
                    background: C.accent, border: 'none', borderRadius: 6,
                    color: '#fff', fontSize: 11, fontWeight: 700, padding: '6px 14px',
                    cursor: !file || uploading ? 'not-allowed' : 'pointer', opacity: !file || uploading ? 0.5 : 1,
                  }}
                >
                  {uploading ? 'Processing...' : 'Process & Save'}
                </button>
              </div>
            </div>
          </Section>

          {/* ─── Drive Sync Section ─── */}
          <Section title="Sync from Google Drive">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ fontSize: 12, color: C.muted }}>
                Auto-detect and process new commission statements from the shared Google Drive folder.
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={handleDriveCheck}
                  disabled={syncStatus === 'checking' || syncStatus === 'syncing'}
                  style={{
                    background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6,
                    color: C.muted, fontSize: 11, fontWeight: 600, padding: '6px 14px',
                    cursor: syncStatus === 'checking' || syncStatus === 'syncing' ? 'not-allowed' : 'pointer',
                    opacity: syncStatus === 'checking' || syncStatus === 'syncing' ? 0.5 : 1,
                  }}
                >
                  {syncStatus === 'checking' ? 'Checking...' : 'Check for New Files'}
                </button>
                {syncPreview && syncPreview.newFilesCount > 0 && (
                  <button
                    onClick={handleDriveSync}
                    disabled={syncStatus === 'syncing'}
                    style={{
                      background: C.accent, border: 'none', borderRadius: 6,
                      color: '#fff', fontSize: 11, fontWeight: 700, padding: '6px 14px',
                      cursor: syncStatus === 'syncing' ? 'not-allowed' : 'pointer',
                      opacity: syncStatus === 'syncing' ? 0.5 : 1,
                    }}
                  >
                    {syncStatus === 'syncing' ? 'Processing...' : `Process ${syncPreview.newFilesCount} File${syncPreview.newFilesCount !== 1 ? 's' : ''}`}
                  </button>
                )}
              </div>
            </div>

            {/* Preview — list of new files found */}
            {syncStatus === 'preview' && syncPreview && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>
                  <span style={{ color: C.text, fontWeight: 700 }}>{syncPreview.totalInFolder}</span> files in folder &nbsp;·&nbsp;
                  <span style={{ color: C.text, fontWeight: 700 }}>{syncPreview.alreadyProcessed}</span> already processed &nbsp;·&nbsp;
                  <span style={{ color: syncPreview.newFilesCount > 0 ? C.green : C.muted, fontWeight: 700 }}>{syncPreview.newFilesCount}</span> new
                </div>
                {syncPreview.newFilesCount > 0 ? (
                  <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: 10 }}>
                    {syncPreview.newFiles.map((f, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: i < syncPreview.newFiles.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                        <span style={{ fontSize: 11, color: C.text, fontFamily: C.mono }}>{f.name}</span>
                        <span style={{ fontSize: 10, color: C.muted }}>{(parseInt(f.size) / 1024).toFixed(1)} KB</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: C.green, fontWeight: 600, marginTop: 4 }}>
                    ✓ All files already processed — nothing new to sync.
                  </div>
                )}
              </div>
            )}

            {/* Sync results */}
            {syncStatus === 'done' && syncResult && (
              <div style={{ marginTop: 12, background: C.greenDim, border: `1px solid ${C.green}`, borderRadius: 8, padding: '12px 16px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.green, textTransform: 'uppercase', marginBottom: 10 }}>
                  Drive Sync Complete
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                  <KPICard label="Files Processed" value={syncResult.processed} color={C.accent} />
                  <KPICard label="Total Records" value={syncResult.totalRecords} color={C.accent} />
                  <KPICard label="Advances" value={fmtDollar(syncResult.totalAdvances)} color={C.green} />
                  <KPICard label="Recoveries" value={fmtDollar(syncResult.totalRecoveries)} color={C.red} />
                  <KPICard label="Net" value={fmtDollar(syncResult.netAmount)} color={syncResult.netAmount >= 0 ? C.green : C.red} />
                  {syncResult.failed > 0 && <KPICard label="Failed" value={syncResult.failed} color={C.red} />}
                </div>
                {/* Per-file breakdown */}
                {syncResult.results?.length > 0 && (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={thStyle}>File</th>
                          <th style={thStyle}>Carrier</th>
                          <th style={thStyle}>Period</th>
                          <th style={thStyle}>Records</th>
                          <th style={thStyle}>Matched</th>
                          <th style={thStyle}>Unmatched</th>
                          <th style={thStyle}>Pending</th>
                          <th style={thStyle}>Advances</th>
                          <th style={thStyle}>Recoveries</th>
                        </tr>
                      </thead>
                      <tbody>
                        {syncResult.results.map((r, i) => (
                          <tr key={i}>
                            <td style={{ ...tdStyle, fontSize: 10, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.filename}</td>
                            <td style={tdStyle}>{r.carrier}</td>
                            <td style={tdStyle}>{r.payPeriod || '—'}</td>
                            <td style={{ ...tdStyle, textAlign: 'center' }}>{r.totalRecords}</td>
                            <td style={{ ...tdStyle, textAlign: 'center', color: C.green }}>{r.matched}</td>
                            <td style={{ ...tdStyle, textAlign: 'center', color: r.unmatched > 0 ? C.red : C.muted }}>{r.unmatched}</td>
                            <td style={{ ...tdStyle, textAlign: 'center', color: r.pendingReview > 0 ? C.yellow : C.muted }}>{r.pendingReview}</td>
                            <td style={{ ...tdStyle, color: C.green }}>{fmtDollar(r.totalAdvances)}</td>
                            <td style={{ ...tdStyle, color: r.totalRecoveries > 0 ? C.red : C.muted }}>{fmtDollar(r.totalRecoveries)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {/* Errors */}
                {syncResult.errors?.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: C.red, textTransform: 'uppercase', marginBottom: 4 }}>Errors</div>
                    {syncResult.errors.map((e, i) => (
                      <div key={i} style={{ fontSize: 11, color: C.red, fontFamily: C.mono }}>
                        {e.filename}: {e.error}
                      </div>
                    ))}
                  </div>
                )}
                <button
                  onClick={() => { setSyncStatus(null); setSyncPreview(null); setSyncResult(null); }}
                  style={{ marginTop: 10, background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, color: C.muted, fontSize: 10, padding: '4px 10px', cursor: 'pointer' }}
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* Error */}
            {syncStatus === 'error' && syncError && (
              <div style={{ marginTop: 12, background: C.redDim, border: `1px solid ${C.red}`, borderRadius: 8, padding: '12px 16px' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.red }}>Error: {syncError}</div>
                <button
                  onClick={() => { setSyncStatus(null); setSyncError(null); }}
                  style={{ marginTop: 8, background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, color: C.muted, fontSize: 10, padding: '4px 10px', cursor: 'pointer' }}
                >
                  Dismiss
                </button>
              </div>
            )}
          </Section>

          {/* Upload Results */}
          {uploadResult && (
            <div style={{
              marginTop: 16,
              background: uploadResult.error ? C.redDim : (uploadResult.dryRun ? '#1a2538' : C.greenDim),
              border: `1px solid ${uploadResult.error ? C.red : (uploadResult.dryRun ? C.accent : C.green)}`,
              borderRadius: 8, padding: '16px 20px',
            }}>
              {uploadResult.error ? (
                <div style={{ color: C.red, fontSize: 12, fontWeight: 600 }}>Error: {uploadResult.error}</div>
              ) : (
                <div>
                  {/* Result header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: uploadResult.dryRun ? C.accent : C.green, textTransform: 'uppercase' }}>
                        {uploadResult.dryRun ? 'Preview (no changes saved)' : 'Statement Processed'}
                      </span>
                      <span style={{ fontSize: 11, color: C.muted, marginLeft: 12 }}>
                        {uploadResult.carrier} — {uploadResult.payPeriod}
                      </span>
                    </div>
                    <button onClick={() => setUploadResult(null)} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 16 }}>×</button>
                  </div>

                  {/* KPI row */}
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
                    <KPICard label="Records" value={uploadResult.summary.totalRecords} color={C.accent} />
                    <KPICard label="Matched" value={uploadResult.summary.matched} color={C.green} />
                    <KPICard label="Unmatched" value={uploadResult.summary.unmatched} color={uploadResult.summary.unmatched > 0 ? C.red : C.muted} />
                    <KPICard label="Pending Review" value={uploadResult.summary.pendingReview} color={uploadResult.summary.pendingReview > 0 ? C.yellow : C.muted} />
                    <KPICard label="Advances" value={fmtDollar(uploadResult.summary.totalAdvances)} color={C.green} />
                    <KPICard label="Recoveries" value={fmtDollar(uploadResult.summary.totalRecoveries)} color={C.red} />
                    <KPICard label="Net" value={fmtDollar(uploadResult.summary.netAmount)} color={uploadResult.summary.netAmount >= 0 ? C.green : C.red} />
                    <KPICard label="Cancellations" value={uploadResult.summary.cancellationsDetected} color={uploadResult.summary.cancellationsDetected > 0 ? C.red : C.muted} />
                  </div>

                  {/* Agent Summary */}
                  {uploadResult.agentSummary?.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 6 }}>By Agent</div>
                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                        {uploadResult.agentSummary.map((a, i) => (
                          <div key={i} style={{ fontSize: 11, color: C.text, fontFamily: C.mono }}>
                            <span style={{ fontWeight: 700 }}>{a.agentName}</span>
                            <span style={{ color: C.muted }}> / {a.agentId}: </span>
                            <span style={{ color: a.netCommission >= 0 ? C.green : C.red }}>{fmtDollar(a.netCommission)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Cancellation Alerts */}
                  {uploadResult.cancellationAlerts?.length > 0 && (
                    <div style={{ marginBottom: 16, background: C.redDim, border: `1px solid ${C.red}`, borderRadius: 8, padding: 12 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: C.red, textTransform: 'uppercase', marginBottom: 8 }}>
                        Cancellation Alerts — Requires Approval
                      </div>
                      {uploadResult.cancellationAlerts.map((alert, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < uploadResult.cancellationAlerts.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                          <div>
                            <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{alert.insuredName}</span>
                            <span style={{ fontSize: 11, color: C.muted }}> — Policy {alert.policyNumber}</span>
                            <span style={{ fontSize: 11, color: C.red, fontFamily: C.mono }}> — Clawback: {fmtDollar(alert.recoveryAmount)}</span>
                            <span style={{ fontSize: 11, color: C.muted }}> — Balance: {fmtDollar(alert.outstandingBalance)}</span>
                            <span style={{ fontSize: 11, color: C.yellow }}> — Current: {alert.currentPolicyStatus}</span>
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              disabled={approving[alert.transactionId]}
                              onClick={() => handleApprove(alert.transactionId, 'approve_cancel')}
                              style={{
                                background: C.red, border: 'none', borderRadius: 4, color: '#fff',
                                fontSize: 10, fontWeight: 700, padding: '4px 10px', cursor: 'pointer',
                                opacity: approving[alert.transactionId] ? 0.5 : 1,
                              }}
                            >
                              {approving[alert.transactionId] ? '...' : 'Cancel Policy'}
                            </button>
                            <button
                              disabled={approving[alert.transactionId]}
                              onClick={() => handleApprove(alert.transactionId, 'reject_cancel')}
                              style={{
                                background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 4,
                                color: C.muted, fontSize: 10, padding: '4px 10px', cursor: 'pointer',
                              }}
                            >
                              Keep Active
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Matched Records Table */}
                  {uploadResult.records?.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 8 }}>Matched Records</div>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr>
                              <SortTh label="Policy #" field="policyNumber" {...matchedSort} onSort={matchedSort.toggle} style={thStyle} />
                              <SortTh label="Insured" field="insuredName" {...matchedSort} onSort={matchedSort.toggle} style={thStyle} />
                              <SortTh label="Agent" field="agent" {...matchedSort} onSort={matchedSort.toggle} style={thStyle} />
                              <SortTh label="Type" field="transactionType" {...matchedSort} onSort={matchedSort.toggle} style={thStyle} />
                              <SortTh label="Amount" field="commissionAmount" {...matchedSort} onSort={matchedSort.toggle} style={thStyle} />
                              <SortTh label="Balance" field="outstandingBalance" {...matchedSort} onSort={matchedSort.toggle} style={thStyle} />
                              <SortTh label="Match" field="matchConfidence" {...matchedSort} onSort={matchedSort.toggle} style={thStyle} />
                              <SortTh label="Status" field="status" {...matchedSort} onSort={matchedSort.toggle} style={thStyle} />
                            </tr>
                          </thead>
                          <tbody>
                            {sortData(uploadResult.records, matchedSort.sortKey, matchedSort.sortDir).map((r, i) => (
                              <tr key={i} style={{ background: r.cancellationIndicator ? C.redDim : 'transparent' }}>
                                <td style={tdStyle}>{r.policyNumber}</td>
                                <td style={tdStyle}>{r.insuredName}</td>
                                <td style={{ ...tdStyle, fontSize: 11 }}>{r.agent || r.agentId}</td>
                                <td style={tdStyle}>
                                  <span style={{
                                    fontSize: 9, padding: '2px 6px', borderRadius: 4, fontWeight: 700,
                                    background: r.transactionType === 'advance' ? C.greenDim : r.transactionType === 'override' ? '#1a2538' : C.redDim,
                                    color: r.transactionType === 'advance' ? C.green : r.transactionType === 'override' ? C.accent : C.red,
                                  }}>
                                    {r.transactionType}
                                  </span>
                                </td>
                                <td style={{ ...tdStyle, color: r.commissionAmount >= 0 ? C.green : C.red, fontWeight: 700 }}>
                                  {fmtDollar(r.commissionAmount)}
                                </td>
                                <td style={tdStyle}>{fmtDollar(r.outstandingBalance)}</td>
                                <td style={tdStyle}>
                                  <span style={{ fontSize: 10, color: r.matchConfidence >= 0.85 ? C.green : r.matchConfidence >= 0.55 ? C.yellow : C.red }}>
                                    {(r.matchConfidence * 100).toFixed(0)}%
                                  </span>
                                  <span style={{ fontSize: 9, color: C.muted, marginLeft: 4 }}>({r.matchType})</span>
                                </td>
                                <td style={tdStyle}>
                                  <span style={{
                                    fontSize: 9, padding: '2px 6px', borderRadius: 4, fontWeight: 700,
                                    background: r.status === 'auto_matched' ? C.greenDim : r.status === 'approved' ? C.greenDim : r.status === 'pending_review' ? C.yellowDim : C.redDim,
                                    color: r.status === 'auto_matched' ? C.green : r.status === 'approved' ? C.green : r.status === 'pending_review' ? C.yellow : C.red,
                                  }}>
                                    {r.status.replace('_', ' ')}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Unmatched Records */}
                  {uploadResult.unmatchedRecords?.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: C.red, textTransform: 'uppercase', marginBottom: 8 }}>Unmatched Records</div>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr>
                              <SortTh label="Policy #" field="policyNumber" {...unmatchedSort} onSort={unmatchedSort.toggle} style={thStyle} />
                              <SortTh label="Insured" field="insuredName" {...unmatchedSort} onSort={unmatchedSort.toggle} style={thStyle} />
                              <SortTh label="Agent" field="agent" {...unmatchedSort} onSort={unmatchedSort.toggle} style={thStyle} />
                              <SortTh label="Type" field="transactionType" {...unmatchedSort} onSort={unmatchedSort.toggle} style={thStyle} />
                              <SortTh label="Amount" field="commissionAmount" {...unmatchedSort} onSort={unmatchedSort.toggle} style={thStyle} />
                            </tr>
                          </thead>
                          <tbody>
                            {sortData(uploadResult.unmatchedRecords, unmatchedSort.sortKey, unmatchedSort.sortDir).map((r, i) => (
                              <tr key={i}>
                                <td style={tdStyle}>{r.policyNumber}</td>
                                <td style={tdStyle}>{r.insuredName}</td>
                                <td style={tdStyle}>{r.agent || r.agentId}</td>
                                <td style={tdStyle}>{r.transactionType}</td>
                                <td style={{ ...tdStyle, color: r.commissionAmount >= 0 ? C.green : C.red }}>{fmtDollar(r.commissionAmount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════ HISTORY VIEW ═══════════════ */}
      {subTab === 'history' && (
        <div>
          <Section title="Processed Statements">
            {statements.length === 0 ? (
              <div style={{ fontSize: 12, color: C.muted, textAlign: 'center', padding: 20 }}>
                No statements processed yet. Upload one in the Upload tab.
              </div>
            ) : (
              <>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 8, fontStyle: 'italic' }}>
                Click any row to view statement details and ledger entries
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ ...thStyle, width: 28, padding: '6px 4px' }}></th>
                      <SortTh label="Date" field="uploadDate" {...historySort} onSort={historySort.toggle} style={thStyle} />
                      <SortTh label="Carrier" field="carrier" {...historySort} onSort={historySort.toggle} style={thStyle} />
                      <SortTh label="Period" field="statementPeriod" {...historySort} onSort={historySort.toggle} style={thStyle} />
                      <SortTh label="File" field="fileName" {...historySort} onSort={historySort.toggle} style={thStyle} />
                      <SortTh label="Records" field="totalRecords" {...historySort} onSort={historySort.toggle} style={thStyle} />
                      <SortTh label="Matched" field="matched" {...historySort} onSort={historySort.toggle} style={thStyle} />
                      <SortTh label="Advances" field="totalAdvances" {...historySort} onSort={historySort.toggle} style={thStyle} />
                      <SortTh label="Recoveries" field="totalRecoveries" {...historySort} onSort={historySort.toggle} style={thStyle} />
                      <SortTh label="Net" field="netAmount" {...historySort} onSort={historySort.toggle} style={thStyle} />
                      <SortTh label="Cancellations" field="cancellationsDetected" {...historySort} onSort={historySort.toggle} style={thStyle} />
                    </tr>
                  </thead>
                  <tbody>
                    {sortData(statements, historySort.sortKey, historySort.sortDir).map((s, i) => {
                      const isSelected = selectedStatement != null && selectedStatement._rowIdx === s._rowIdx;
                      return (
                      <tr key={i} style={{
                        cursor: 'pointer',
                        background: isSelected ? 'rgba(91,159,255,0.08)' : 'transparent',
                        borderLeft: isSelected ? `3px solid ${C.accent}` : '3px solid transparent',
                        transition: 'background 0.15s ease',
                      }}
                        onClick={() => setSelectedStatement(isSelected ? null : s)}
                        onMouseOver={e => { if (!isSelected) e.currentTarget.style.background = 'rgba(91,159,255,0.05)'; }}
                        onMouseOut={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                      >
                        <td style={{ ...tdStyle, width: 28, padding: '6px 4px', textAlign: 'center', fontSize: 12, color: isSelected ? C.accent : C.muted, transition: 'transform 0.15s ease' }}>
                          {isSelected ? '▾' : '▸'}
                        </td>
                        <td style={tdStyle}>{new Date(s.uploadDate).toLocaleDateString()}</td>
                        <td style={tdStyle}>{s.carrier}</td>
                        <td style={tdStyle}>{s.statementPeriod}</td>
                        <td style={{ ...tdStyle, fontSize: 10, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.fileName}</td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>{s.totalRecords}</td>
                        <td style={{ ...tdStyle, textAlign: 'center', color: C.green }}>{s.matched}</td>
                        <td style={{ ...tdStyle, color: C.green }}>{fmtDollar(s.totalAdvances)}</td>
                        <td style={{ ...tdStyle, color: C.red }}>{fmtDollar(s.totalRecoveries)}</td>
                        <td style={{ ...tdStyle, color: s.netAmount >= 0 ? C.green : C.red, fontWeight: 700 }}>{fmtDollar(s.netAmount)}</td>
                        <td style={{ ...tdStyle, textAlign: 'center', color: s.cancellationsDetected > 0 ? C.red : C.muted, fontWeight: s.cancellationsDetected > 0 ? 700 : 400 }}>
                          {s.cancellationsDetected}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              </>
            )}
          </Section>

          {/* Statement Detail (ledger entries for selected statement) */}
          {selectedStatement && (
            <Section title={`Detail — ${selectedStatement.fileName}`}>
              <StatementDetail statementId={selectedStatement.statementId} fileName={selectedStatement.fileName} />
            </Section>
          )}
        </div>
      )}

      {/* ═══════════════ RECONCILIATION VIEW ═══════════════ */}
      {subTab === 'reconciliation' && (
        <div>
          {!reconciliation ? (
            <div style={{ textAlign: 'center', padding: 40, color: C.muted }}>Loading reconciliation data...</div>
          ) : (
            <>
              {/* KPI row */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
                <KPICard label="Policies with Activity" value={reconciliation.summary.totalPolicies} color={C.accent} />
                <KPICard label="Total Expected" value={fmtDollar(reconciliation.summary.totalExpected)} color={C.muted} />
                <KPICard label="Total Received" value={fmtDollar(reconciliation.summary.totalReceived)} color={C.green} />
                <KPICard label="Variance" value={fmtDollar(reconciliation.summary.variance)} color={reconciliation.summary.variance >= 0 ? C.green : C.red} />
                <KPICard label="Discrepancies" value={reconciliation.summary.discrepancies} color={reconciliation.summary.discrepancies > 0 ? C.yellow : C.muted} />
              </div>

              <Section title="Policy Commission Balance">
                {reconciliation.policies.length === 0 ? (
                  <div style={{ fontSize: 12, color: C.muted, textAlign: 'center', padding: 20 }}>
                    No commission activity recorded yet. Upload a statement first.
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={{ ...thStyle, width: 28, padding: '6px 4px' }}></th>
                          <SortTh label="Policy #" field="policyNumber" {...reconSort} onSort={reconSort.toggle} style={thStyle} />
                          <SortTh label="Insured" field="insuredName" {...reconSort} onSort={reconSort.toggle} style={thStyle} />
                          <SortTh label="Carrier" field="carrier" {...reconSort} onSort={reconSort.toggle} style={thStyle} />
                          <SortTh label="Premium" field="premium" {...reconSort} onSort={reconSort.toggle} style={thStyle} />
                          <SortTh label="Expected" field="expectedCommission" {...reconSort} onSort={reconSort.toggle} style={thStyle} />
                          <SortTh label="Paid" field="totalPaid" {...reconSort} onSort={reconSort.toggle} style={thStyle} />
                          <SortTh label="Clawback" field="totalClawback" {...reconSort} onSort={reconSort.toggle} style={thStyle} />
                          <SortTh label="Net" field="netReceived" {...reconSort} onSort={reconSort.toggle} style={thStyle} />
                          <SortTh label="Balance" field="balance" {...reconSort} onSort={reconSort.toggle} style={thStyle} />
                          <SortTh label="Status" field="status" {...reconSort} onSort={reconSort.toggle} style={thStyle} />
                        </tr>
                      </thead>
                      <tbody>
                        {sortData(reconciliation.policies, reconSort.sortKey, reconSort.sortDir)
                          .map((p, i) => {
                          const isSelP = selectedPolicy?.policyNumber === p.policyNumber;
                          const baseBg = Math.abs(p.balance) > 100 ? C.redDim : p.totalClawback > 0 ? C.yellowDim : 'transparent';
                          return (
                          <tr key={i}
                            style={{
                              cursor: 'pointer',
                              background: isSelP ? 'rgba(91,159,255,0.08)' : baseBg,
                              borderLeft: isSelP ? `3px solid ${C.accent}` : '3px solid transparent',
                              transition: 'background 0.15s ease',
                            }}
                            onClick={() => setSelectedPolicy(isSelP ? null : p)}
                            onMouseOver={e => { if (!isSelP) e.currentTarget.style.background = 'rgba(91,159,255,0.05)'; }}
                            onMouseOut={e => { if (!isSelP) e.currentTarget.style.background = baseBg; }}
                          >
                            <td style={{ ...tdStyle, width: 28, padding: '6px 4px', textAlign: 'center', fontSize: 12, color: isSelP ? C.accent : C.muted }}>
                              {isSelP ? '▾' : '▸'}
                            </td>
                            <td style={tdStyle}>{p.policyNumber}</td>
                            <td style={tdStyle}>{p.insuredName}</td>
                            <td style={{ ...tdStyle, fontSize: 10 }}>{p.carrier}</td>
                            <td style={tdStyle}>{fmtDollar(p.premium)}</td>
                            <td style={tdStyle}>{fmtDollar(p.expectedCommission)}</td>
                            <td style={{ ...tdStyle, color: C.green }}>{fmtDollar(p.totalPaid)}</td>
                            <td style={{ ...tdStyle, color: p.totalClawback > 0 ? C.red : C.muted }}>{fmtDollar(p.totalClawback)}</td>
                            <td style={{ ...tdStyle, color: p.netReceived >= 0 ? C.green : C.red, fontWeight: 700 }}>{fmtDollar(p.netReceived)}</td>
                            <td style={{ ...tdStyle, color: Math.abs(p.balance) < 1 ? C.green : C.yellow }}>{fmtDollar(p.balance)}</td>
                            <td style={tdStyle}>
                              <span style={{
                                fontSize: 9, padding: '2px 6px', borderRadius: 4, fontWeight: 700,
                                background: p.status.includes('Active') ? C.greenDim : p.status.includes('Cancelled') ? C.redDim : C.yellowDim,
                                color: p.status.includes('Active') ? C.green : p.status.includes('Cancelled') ? C.red : C.yellow,
                              }}>
                                {p.status || '—'}
                              </span>
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Section>

              {/* Policy Cash Flow drill-down */}
              {selectedPolicy && (
                <Section title={`Cash Flow — ${selectedPolicy.insuredName} (${selectedPolicy.policyNumber})`}>
                  <PolicyCashFlow policyNumber={selectedPolicy.policyNumber} policySummary={selectedPolicy} />
                </Section>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Sub-component: loads and displays ledger entries for a specific statement
function StatementDetail({ statementId, fileName }) {
  const [entries, setEntries] = useState(null);
  const detailSort = useSort(null);

  useEffect(() => {
    fetch(`/api/commission-statements?view=ledger`)
      .then(r => r.json())
      .then(data => {
        const filtered = (data.entries || []).filter(e => e.statementFile === fileName);
        setEntries(filtered);
      })
      .catch(() => setEntries([]));
  }, [statementId, fileName]);

  if (!entries) return <div style={{ color: C.muted, fontSize: 12 }}>Loading...</div>;
  if (entries.length === 0) return <div style={{ color: C.muted, fontSize: 12 }}>No entries found for this statement.</div>;

  const thStyle = { textAlign: 'left', padding: '6px 10px', fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', borderBottom: `1px solid ${C.border}` };
  const tdStyle = { padding: '6px 10px', fontSize: 11, color: C.text, fontFamily: C.mono, borderBottom: `1px solid ${C.border}` };

  const sorted = sortData(entries, detailSort.sortKey, detailSort.sortDir);

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <SortTh label="Policy #" field="policyNumber" {...detailSort} onSort={detailSort.toggle} style={thStyle} />
            <SortTh label="Insured" field="insuredName" {...detailSort} onSort={detailSort.toggle} style={thStyle} />
            <SortTh label="Agent" field="agent" {...detailSort} onSort={detailSort.toggle} style={thStyle} />
            <SortTh label="Type" field="transactionType" {...detailSort} onSort={detailSort.toggle} style={thStyle} />
            <SortTh label="Amount" field="commissionAmount" {...detailSort} onSort={detailSort.toggle} style={thStyle} />
            <SortTh label="Balance" field="outstandingBalance" {...detailSort} onSort={detailSort.toggle} style={thStyle} />
            <SortTh label="Matched To" field="matchedPolicy" {...detailSort} onSort={detailSort.toggle} style={thStyle} />
            <SortTh label="Status" field="status" {...detailSort} onSort={detailSort.toggle} style={thStyle} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((e, i) => (
            <tr key={i}>
              <td style={tdStyle}>{e.policyNumber}</td>
              <td style={tdStyle}>{e.insuredName}</td>
              <td style={tdStyle}>{e.agent}</td>
              <td style={tdStyle}>{e.transactionType}</td>
              <td style={{ ...tdStyle, color: e.commissionAmount >= 0 ? C.green : C.red, fontWeight: 700 }}>{fmtDollar(e.commissionAmount)}</td>
              <td style={tdStyle}>{fmtDollar(e.outstandingBalance)}</td>
              <td style={tdStyle}>{e.matchedPolicy || '—'}</td>
              <td style={tdStyle}>
                <span style={{
                  fontSize: 9, padding: '2px 6px', borderRadius: 4, fontWeight: 700,
                  background: e.status === 'auto_matched' || e.status === 'approved' ? C.greenDim : e.status === 'pending_review' ? C.yellowDim : C.redDim,
                  color: e.status === 'auto_matched' || e.status === 'approved' ? C.green : e.status === 'pending_review' ? C.yellow : C.red,
                }}>
                  {e.status?.replace('_', ' ') || '—'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Sub-component: per-policy chronological cash flow with running balance
function PolicyCashFlow({ policyNumber, policySummary }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null);
    setError(null);
    fetch(`/api/commission-statements/policy/${encodeURIComponent(policyNumber)}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return; }
        setData(d);
      })
      .catch(e => setError(e.message));
  }, [policyNumber]);

  const thStyle = { textAlign: 'left', padding: '6px 10px', fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', borderBottom: `1px solid ${C.border}` };
  const tdStyle = { padding: '6px 10px', fontSize: 11, color: C.text, fontFamily: C.mono, borderBottom: `1px solid ${C.border}` };

  if (error) return <div style={{ color: C.red, fontSize: 12 }}>Error: {error}</div>;
  if (!data) return <div style={{ color: C.muted, fontSize: 12 }}>Loading cash flow...</div>;

  const info = data.policyInfo || {};
  const entries = (data.entries || [])
    .slice()
    .sort((a, b) => (a.statementDate || '').localeCompare(b.statementDate || ''));

  // Compute running balance
  let running = 0;
  const withRunning = entries.map(e => {
    running += e.commissionAmount || 0;
    return { ...e, runningBalance: running };
  });

  return (
    <div>
      {/* KPI cards */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <KPICard label="Insured" value={info.insuredName || policySummary.insuredName || '—'} color={C.text} />
        <KPICard label="Policy #" value={policyNumber} color={C.accent} />
        <KPICard label="Carrier" value={info.carrier || policySummary.carrier || '—'} color={C.muted} />
        <KPICard label="Agent" value={info.agent || '—'} color={C.muted} />
        <KPICard label="Premium" value={fmtDollar(info.premium || policySummary.premium || 0)} color={C.accent} />
        <KPICard label="Total Paid" value={fmtDollar(data.totalPaid || 0)} color={C.green} />
        <KPICard label="Clawbacks" value={fmtDollar(data.totalClawback || 0)} color={(data.totalClawback || 0) > 0 ? C.red : C.muted} />
        <KPICard label="Net Commission" value={fmtDollar(data.netCommission || 0)} color={(data.netCommission || 0) >= 0 ? C.green : C.red} />
      </div>

      {/* Chronological entries table */}
      {withRunning.length === 0 ? (
        <div style={{ fontSize: 12, color: C.muted, textAlign: 'center', padding: 20 }}>No ledger entries found for this policy.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Amount</th>
                <th style={thStyle}>Running Balance</th>
                <th style={thStyle}>Statement File</th>
                <th style={thStyle}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {withRunning.map((e, i) => (
                <tr key={i}>
                  <td style={tdStyle}>{e.statementDate ? new Date(e.statementDate).toLocaleDateString() : '—'}</td>
                  <td style={tdStyle}>
                    <span style={{
                      fontSize: 9, padding: '2px 6px', borderRadius: 4, fontWeight: 700,
                      background: e.transactionType === 'advance' ? C.greenDim : e.transactionType === 'override' ? '#1a2538' : C.redDim,
                      color: e.transactionType === 'advance' ? C.green : e.transactionType === 'override' ? C.accent : C.red,
                    }}>
                      {e.transactionType}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, color: e.commissionAmount >= 0 ? C.green : C.red, fontWeight: 700 }}>{fmtDollar(e.commissionAmount)}</td>
                  <td style={{ ...tdStyle, color: e.runningBalance >= 0 ? C.green : C.red, fontWeight: 700 }}>{fmtDollar(e.runningBalance)}</td>
                  <td style={{ ...tdStyle, fontSize: 10, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.statementFile || '—'}</td>
                  <td style={{ ...tdStyle, fontSize: 10, color: C.muted, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
