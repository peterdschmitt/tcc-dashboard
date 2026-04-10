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
function SortTh({ label, field, sortKey, sortDir, onSort, style, tooltip }) {
  const active = sortKey === field;
  return (
    <th
      title={tooltip || ''}
      onClick={() => onSort(field)}
      style={{
        ...style, cursor: tooltip ? 'help' : 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
        color: active ? C.accent : style?.color || C.muted,
      }}
    >
      {label}{tooltip && <span style={{ marginLeft: 3, fontSize: 7, opacity: 0.5 }}>ⓘ</span>} <span style={{ fontSize: 8, opacity: active ? 1 : 0.3 }}>{active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
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

function KPICard({ label, value, color, subtitle, tooltip }) {
  return (
    <div title={tooltip || ''} style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
      padding: '12px 16px', minWidth: 120, borderTop: `3px solid ${color || C.accent}`,
      cursor: tooltip ? 'help' : 'default',
    }}>
      <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}{tooltip && <span style={{ marginLeft: 4, fontSize: 8, opacity: 0.6 }}>ⓘ</span>}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || C.text, fontFamily: C.mono, marginTop: 4 }}>{value}</div>
      {subtitle && <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{subtitle}</div>}
    </div>
  );
}

const SUB_TABS = [
  { id: 'upload', label: 'Upload' },
  { id: 'history', label: 'History' },
  { id: 'reconciliation', label: 'Reconciliation' },
  { id: 'waterfall', label: 'Waterfall' },
  { id: 'organize', label: 'Organize Files' },
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

  // Organize files state
  const [organizeStatus, setOrganizeStatus] = useState(null); // null | 'scanning' | 'preview' | 'organizing' | 'done' | 'error'
  const [organizePreview, setOrganizePreview] = useState(null);
  const [organizeResult, setOrganizeResult] = useState(null);
  const [organizeError, setOrganizeError] = useState(null);

  // File listing state
  const [fileList, setFileList] = useState(null);
  const [fileListLoading, setFileListLoading] = useState(false);
  const [fileListError, setFileListError] = useState(null);

  // Sort state for each table
  const historySort = useSort('uploadDate', 'desc');
  const reconSort = useSort('balance', 'desc');
  const matchedSort = useSort(null);
  const unmatchedSort = useSort(null);
  const [reconGroupBy, setReconGroupBy] = useState('none'); // 'none' | 'status' | 'month'

  // Waterfall state
  const [waterfall, setWaterfall] = useState(null);
  const [waterfallCollapsed, setWaterfallCollapsed] = useState({});
  const waterfallSort = useSort('submitDate', 'desc');

  // Load data on mount and tab change
  useEffect(() => {
    if (subTab === 'history') loadStatements();
    if (subTab === 'reconciliation') loadReconciliation();
    if (subTab === 'waterfall') loadWaterfall();
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

  const loadWaterfall = async () => {
    try {
      const res = await fetch('/api/commission-statements?view=waterfall');
      const data = await res.json();
      setWaterfall(data);
    } catch (e) { console.error('Failed to load waterfall:', e); }
  };

  const loadPending = async () => {
    try {
      const res = await fetch('/api/commission-statements?view=pending');
      const data = await res.json();
      setPendingReviews(data.pendingReviews || []);
    } catch (e) { console.error('Failed to load pending:', e); }
  };

  const handleUpload = async (dryRun = false, skipDuplicate = false) => {
    if (!file) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('carrier', carrier);
      formData.append('dryRun', dryRun.toString());
      if (skipDuplicate) formData.append('skipDuplicate', 'true');

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

  const handleOrganizeScan = async () => {
    setOrganizeStatus('scanning');
    setOrganizePreview(null);
    setOrganizeResult(null);
    setOrganizeError(null);
    try {
      const res = await fetch('/api/commission-statements/organize');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setOrganizePreview(data);
      setOrganizeStatus('preview');
    } catch (err) {
      setOrganizeError(err.message);
      setOrganizeStatus('error');
    }
  };

  const handleOrganizeExecute = async () => {
    setOrganizeStatus('organizing');
    setOrganizeError(null);
    try {
      const res = await fetch('/api/commission-statements/organize', { method: 'POST' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setOrganizeResult(data);
      setOrganizeStatus('done');
    } catch (err) {
      setOrganizeError(err.message);
      setOrganizeStatus('error');
    }
  };

  const handleListFiles = async () => {
    setFileListLoading(true);
    setFileListError(null);
    try {
      const res = await fetch('/api/commission-statements/files');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setFileList(data);
    } catch (err) {
      setFileListError(err.message);
    } finally {
      setFileListLoading(false);
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
                          <th style={thStyle}>Saved As</th>
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
                            <td style={tdStyle}>
                              <span style={{
                                background: C.accent + '22', border: `1px solid ${C.accent}44`, borderRadius: 4,
                                padding: '2px 6px', fontSize: 10, color: C.accent, fontWeight: 600,
                              }}>{r.carrier}</span>
                            </td>
                            <td style={{ ...tdStyle, fontSize: 9, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: C.mono, color: C.muted }}>{r.organizedFilename || r.payPeriod || '—'}</td>
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

                  {/* Duplicate warning */}
                  {uploadResult.duplicateWarning && (
                    <div style={{ background: C.yellowDim, border: `1px solid ${C.yellow}`, borderRadius: 8, padding: '12px 16px', marginBottom: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.yellow, textTransform: 'uppercase', marginBottom: 6 }}>Possible Duplicate</div>
                      <div style={{ fontSize: 12, color: C.text, marginBottom: 8 }}>{uploadResult.duplicateWarning.message}</div>
                      {uploadResult.dryRun && (
                        <div style={{ display: 'flex', gap: 10 }}>
                          <button
                            onClick={() => handleUpload(false, true)}
                            disabled={uploading}
                            style={{ background: C.yellow, border: 'none', borderRadius: 6, color: '#000', fontSize: 11, fontWeight: 700, padding: '6px 14px', cursor: 'pointer' }}
                          >
                            Process Anyway
                          </button>
                          <button
                            onClick={() => setUploadResult(null)}
                            style={{ background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, color: C.muted, fontSize: 11, padding: '6px 14px', cursor: 'pointer' }}
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Organized filename */}
                  {uploadResult.organizedFilename && (
                    <div style={{ fontSize: 11, color: C.green, marginBottom: 12, fontFamily: C.mono }}>
                      Saved to Drive: {uploadResult.organizedFilename}
                    </div>
                  )}

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
                <KPICard label="Policies with Activity" value={reconciliation.summary.totalPolicies} color={C.accent} tooltip="Count of policies that have at least one entry in the Commission Ledger (from uploaded carrier statements)" />
                <KPICard label="Total Expected" value={fmtDollar(reconciliation.summary.totalExpected)} color={C.muted} tooltip="Sum of expected commissions across all policies with activity. Expected = Premium × Commission Rate × 9 months (from Commission Rates sheet)" />
                <KPICard label="Total Received" value={fmtDollar(reconciliation.summary.totalReceived)} color={C.green} tooltip="Net commission received from carriers = Total Paid - Total Clawbacks (from uploaded commission statements)" />
                <KPICard label="Variance" value={fmtDollar(reconciliation.summary.variance)} color={reconciliation.summary.variance >= 0 ? C.green : C.red} tooltip="Difference between what was received and what was expected. Variance = Total Received - Total Expected. Negative means carriers owe more." />
                <KPICard label="Discrepancies" value={reconciliation.summary.discrepancies} color={reconciliation.summary.discrepancies > 0 ? C.yellow : C.muted} tooltip="Number of policies where the outstanding balance exceeds $1. These may need follow-up with the carrier." />
              </div>

              {/* Status breakdown counts */}
              {(() => {
                const counts = {};
                (reconciliation.policies || []).forEach(p => {
                  const s = p.status || 'Unknown';
                  counts[s] = (counts[s] || 0) + 1;
                });
                const statusColor = (s) => s.includes('Active') || s.includes('In Force') ? C.green : s.includes('Pending') ? C.yellow : s.includes('Cancel') || s.includes('Declined') || s.includes('Lapsed') ? C.red : C.muted;
                return Object.keys(counts).length > 0 ? (
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
                    {Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
                      <KPICard key={status} label={status} value={count} color={statusColor(status)} />
                    ))}
                  </div>
                ) : null;
              })()}

              {/* Group by toggle */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 10, color: C.muted, fontWeight: 600, textTransform: 'uppercase' }}>Group by:</span>
                {[['none', 'None'], ['status', 'Status'], ['month', 'Month'], ['carrier', 'Carrier']].map(([val, lbl]) => (
                  <button key={val} style={pillStyle(reconGroupBy === val)} onClick={() => setReconGroupBy(val)}>{lbl}</button>
                ))}
              </div>

              {reconciliation.policies.length === 0 ? (
                <Section title="Policy Commission Balance">
                  <div style={{ fontSize: 12, color: C.muted, textAlign: 'center', padding: 20 }}>
                    No commission activity recorded yet. Upload a statement first.
                  </div>
                </Section>
              ) : (() => {
                // Build groups
                const policies = sortData(reconciliation.policies, reconSort.sortKey, reconSort.sortDir);
                const statusColor = (s) => (s || '').includes('Active') || (s || '').includes('In Force') ? C.green : (s || '').includes('Pending') ? C.yellow : (s || '').includes('Cancel') || (s || '').includes('Declined') || (s || '').includes('Lapsed') ? C.red : C.muted;

                // Parse dates that may be MM-DD-YYYY or YYYY-MM-DD
                const parseDate = (str) => {
                  if (!str) return null;
                  const mdy = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
                  if (mdy) return new Date(parseInt(mdy[3]), parseInt(mdy[1]) - 1, parseInt(mdy[2]));
                  const ymd = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
                  if (ymd) return new Date(parseInt(ymd[1]), parseInt(ymd[2]) - 1, parseInt(ymd[3]));
                  const d = new Date(str);
                  return isNaN(d.getTime()) ? null : d;
                };

                let groups;
                if (reconGroupBy === 'status') {
                  const map = {};
                  policies.forEach(p => { const k = p.status || 'Unknown'; if (!map[k]) map[k] = []; map[k].push(p); });
                  groups = Object.entries(map).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => ({ label: k, color: statusColor(k), policies: v }));
                } else if (reconGroupBy === 'carrier') {
                  const map = {};
                  policies.forEach(p => { const k = p.carrier || 'Unknown'; if (!map[k]) map[k] = []; map[k].push(p); });
                  groups = Object.entries(map).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => ({ label: k, color: C.accent, policies: v }));
                } else if (reconGroupBy === 'month') {
                  const map = {};
                  policies.forEach(p => {
                    const d = parseDate(p.submitDate) || parseDate(p.effectiveDate);
                    const m = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : 'Unknown';
                    if (!map[m]) map[m] = [];
                    map[m].push(p);
                  });
                  groups = Object.entries(map).sort((a, b) => b[0].localeCompare(a[0])).map(([k, v]) => {
                    const lbl = k === 'Unknown' ? 'Unknown' : new Date(parseInt(k.split('-')[0]), parseInt(k.split('-')[1]) - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
                    return { label: lbl, color: C.accent, policies: v };
                  });
                } else {
                  groups = [{ label: 'All Policies', color: C.accent, policies }];
                }

                // Pre-compute _daysActive and _effDateParsed for sorting/display
                policies.forEach(p => {
                  const d = parseDate(p.effectiveDate) || parseDate(p.submitDate);
                  p._effDateParsed = d;
                  p._daysActive = d ? Math.floor((Date.now() - d.getTime()) / 86400000) : null;
                });

                const renderPolicyRow = (p, i) => {
                  const isSelP = selectedPolicy?.policyNumber === p.policyNumber;
                  const baseBg = Math.abs(p.balance) > 100 ? C.redDim : p.totalClawback > 0 ? C.yellowDim : 'transparent';
                  const days = p._daysActive;
                  const daysColor = days === null ? C.muted : days > 180 ? C.green : days > 90 ? C.accent : days > 30 ? C.yellow : C.muted;
                  return (
                    <tr key={i}
                      style={{ cursor: 'pointer', background: isSelP ? 'rgba(91,159,255,0.08)' : baseBg, borderLeft: isSelP ? `3px solid ${C.accent}` : '3px solid transparent', transition: 'background 0.15s ease' }}
                      onClick={() => setSelectedPolicy(isSelP ? null : p)}
                      onMouseOver={e => { if (!isSelP) e.currentTarget.style.background = 'rgba(91,159,255,0.05)'; }}
                      onMouseOut={e => { if (!isSelP) e.currentTarget.style.background = baseBg; }}
                    >
                      <td style={{ ...tdStyle, width: 28, padding: '6px 4px', textAlign: 'center', fontSize: 12, color: isSelP ? C.accent : C.muted }}>{isSelP ? '▾' : '▸'}</td>
                      <td style={tdStyle}>{p.policyNumber}</td>
                      <td style={tdStyle}>{p.insuredName}</td>
                      <td style={{ ...tdStyle, fontSize: 10 }}>{p.carrier}</td>
                      <td style={tdStyle}>{fmtDollar(p.premium)}</td>
                      <td style={tdStyle}>{fmtDollar(p.expectedCommission)}</td>
                      <td style={{ ...tdStyle, color: C.green }}>{fmtDollar(p.totalPaid)}</td>
                      <td style={{ ...tdStyle, color: p.totalClawback > 0 ? C.red : C.muted }}>{fmtDollar(p.totalClawback)}</td>
                      <td style={{ ...tdStyle, color: p.netReceived >= 0 ? C.green : C.red, fontWeight: 700 }}>{fmtDollar(p.netReceived)}</td>
                      <td style={{ ...tdStyle, color: Math.abs(p.balance) < 1 ? C.green : C.yellow }}>{fmtDollar(p.balance)}</td>
                      <td style={{ ...tdStyle, fontSize: 10 }}>{p._effDateParsed ? p._effDateParsed.toLocaleDateString() : '—'}</td>
                      <td style={{ ...tdStyle, textAlign: 'center', color: daysColor, fontWeight: 600 }}>{days !== null ? days : '—'}</td>
                      <td style={tdStyle}>
                        <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, fontWeight: 700, background: (p.status || '').includes('Active') ? C.greenDim : (p.status || '').includes('Cancelled') ? C.redDim : C.yellowDim, color: statusColor(p.status) }}>{p.status || '—'}</span>
                      </td>
                    </tr>
                  );
                };

                const tableHeader = (
                  <thead>
                    <tr>
                      <th style={{ ...thStyle, width: 28, padding: '6px 4px' }}></th>
                      <SortTh label="Policy #" field="policyNumber" {...reconSort} onSort={reconSort.toggle} style={thStyle} tooltip="Policy number from the sales/application tracker" />
                      <SortTh label="Insured" field="insuredName" {...reconSort} onSort={reconSort.toggle} style={thStyle} tooltip="Policyholder name from the sales tracker (First + Last)" />
                      <SortTh label="Carrier" field="carrier" {...reconSort} onSort={reconSort.toggle} style={thStyle} tooltip="Insurance carrier from the 'Carrier + Product + Payout' field in the sales tracker" />
                      <SortTh label="Premium" field="premium" {...reconSort} onSort={reconSort.toggle} style={thStyle} tooltip="Monthly premium from the sales tracker" />
                      <SortTh label="Expected" field="expectedCommission" {...reconSort} onSort={reconSort.toggle} style={thStyle} tooltip="Expected total commission = Premium × Commission Rate × 9 months advance. Rate comes from the Commission Rates sheet." />
                      <SortTh label="Paid" field="totalPaid" {...reconSort} onSort={reconSort.toggle} style={thStyle} tooltip="Total advances paid by the carrier, from uploaded commission statements (positive amounts in the Commission Ledger)" />
                      <SortTh label="Clawback" field="totalClawback" {...reconSort} onSort={reconSort.toggle} style={thStyle} tooltip="Total chargebacks/recoveries from the carrier, from uploaded commission statements (negative amounts in the Commission Ledger)" />
                      <SortTh label="Net" field="netReceived" {...reconSort} onSort={reconSort.toggle} style={thStyle} tooltip="Net commission received = Paid - Clawback. From carrier commission statements." />
                      <SortTh label="Balance" field="balance" {...reconSort} onSort={reconSort.toggle} style={thStyle} tooltip="Outstanding balance = Expected - Paid + Clawback. Positive means carrier still owes money. Zero means fully paid." />
                      <SortTh label="Effective" field="effectiveDate" {...reconSort} onSort={reconSort.toggle} style={thStyle} tooltip="Policy effective date from the sales tracker" />
                      <SortTh label="Days" field="_daysActive" {...reconSort} onSort={reconSort.toggle} style={thStyle} tooltip="Days since effective date. Calculated as today minus effective date." />
                      <SortTh label="Status" field="status" {...reconSort} onSort={reconSort.toggle} style={thStyle} tooltip="Policy status from the sales tracker (Policy Status or Placed? column)" />
                    </tr>
                  </thead>
                );

                return groups.map((g, gi) => {
                  const grpPaid = g.policies.reduce((s, p) => s + p.totalPaid, 0);
                  const grpClawback = g.policies.reduce((s, p) => s + p.totalClawback, 0);
                  const grpNet = g.policies.reduce((s, p) => s + p.netReceived, 0);
                  const grpPremium = g.policies.reduce((s, p) => s + p.premium, 0);
                  return (
                    <Section key={gi} title={
                      reconGroupBy === 'none' ? 'Policy Commission Balance' :
                      `${g.label} — ${g.policies.length} ${g.policies.length === 1 ? 'policy' : 'policies'} · Premium ${fmtDollar(grpPremium)} · Net ${fmtDollar(grpNet)}`
                    }>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          {tableHeader}
                          <tbody>
                            {g.policies.map(renderPolicyRow)}
                            {reconGroupBy !== 'none' && g.policies.length > 1 && (
                              <tr style={{ background: C.surface, fontWeight: 700 }}>
                                <td style={tdStyle}></td>
                                <td colSpan={3} style={{ ...tdStyle, fontSize: 10, color: C.muted }}>SUBTOTAL ({g.policies.length})</td>
                                <td style={tdStyle}>{fmtDollar(grpPremium)}</td>
                                <td style={tdStyle}>{fmtDollar(g.policies.reduce((s, p) => s + p.expectedCommission, 0))}</td>
                                <td style={{ ...tdStyle, color: C.green }}>{fmtDollar(grpPaid)}</td>
                                <td style={{ ...tdStyle, color: grpClawback > 0 ? C.red : C.muted }}>{fmtDollar(grpClawback)}</td>
                                <td style={{ ...tdStyle, color: grpNet >= 0 ? C.green : C.red }}>{fmtDollar(grpNet)}</td>
                                <td style={{ ...tdStyle, color: C.yellow }}>{fmtDollar(g.policies.reduce((s, p) => s + p.balance, 0))}</td>
                                <td style={tdStyle}></td>
                                <td style={{ ...tdStyle, textAlign: 'center', color: C.muted, fontSize: 10 }}>{Math.round(g.policies.filter(p => p._daysActive != null).reduce((s, p) => s + (p._daysActive || 0), 0) / Math.max(1, g.policies.filter(p => p._daysActive != null).length))}d avg</td>
                                <td style={tdStyle}></td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </Section>
                  );
                });
              })()}

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

      {/* ═══════════════ WATERFALL VIEW ═══════════════ */}
      {subTab === 'waterfall' && (
        <div>
          {!waterfall ? (
            <div style={{ textAlign: 'center', padding: 40, color: C.muted }}>Loading waterfall data...</div>
          ) : (
            <>
              {/* KPI Summary */}
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
                <KPICard label="Total Policies" value={waterfall.summary.totalPolicies} color={C.accent} />
                <KPICard label="Monthly Premium" value={fmtDollar(waterfall.summary.totalPremium)} color={C.text} />
                <KPICard label="Carrier Paid" value={`${waterfall.summary.paidCount}/${waterfall.summary.totalPolicies}`}
                  color={waterfall.summary.paidCount > 0 ? C.green : C.muted}
                  subtitle={fmtDollar(waterfall.summary.totalReceived)} />
                <KPICard label="Expected Commission" value={fmtDollar(waterfall.summary.totalExpected)} color={C.accent}
                  subtitle={`${waterfall.summary.paidCount} policies with activity`} />
                <KPICard label="Outstanding Balance" value={fmtDollar(waterfall.summary.totalBalance)}
                  color={waterfall.summary.totalBalance > 100 ? C.red : C.green}
                  tooltip="Positive = carriers owe you. Negative = overpaid." />
              </div>

              {/* Status Groups */}
              {(() => {
                const STATUS_ORDER = [
                  'Active - In Force', 'Advance Released', 'Submitted - Pending',
                  'Pending', 'Hold Application', 'NeedReqmnt', 'Initial Premium Not Paid',
                  'Declined', 'Canceled', 'Cancelled', 'Lapsed', '(Carrier Only)', '(No Status)',
                ];
                const STATUS_ICON = {
                  'Active - In Force': '●', 'Advance Released': '●',
                  'Submitted - Pending': '◐', 'Pending': '◐',
                  'Hold Application': '◯', 'NeedReqmnt': '◯', 'Initial Premium Not Paid': '◯',
                  'Declined': '✗', 'Canceled': '✗', 'Cancelled': '✗', 'Lapsed': '✗',
                  '(Carrier Only)': '◇', '(No Status)': '?',
                };
                const STATUS_COLOR = {
                  'Active - In Force': C.green, 'Advance Released': C.green,
                  'Submitted - Pending': C.yellow, 'Pending': C.yellow,
                  'Hold Application': C.muted, 'NeedReqmnt': C.muted, 'Initial Premium Not Paid': C.muted,
                  'Declined': C.red, 'Canceled': C.red, 'Cancelled': C.red, 'Lapsed': C.red,
                  '(Carrier Only)': C.accent, '(No Status)': C.muted,
                };

                // Group policies by status
                const groups = {};
                for (const p of waterfall.policies) {
                  const st = p.status || '(No Status)';
                  if (!groups[st]) groups[st] = [];
                  groups[st].push(p);
                }

                // Sort groups by STATUS_ORDER
                const orderedStatuses = STATUS_ORDER.filter(s => groups[s]);
                // Add any statuses not in our order list
                Object.keys(groups).forEach(s => { if (!orderedStatuses.includes(s)) orderedStatuses.push(s); });

                return orderedStatuses.map(status => {
                  const grp = groups[status];
                  const collapsed = waterfallCollapsed[status];
                  const grpPrem = grp.reduce((s, p) => s + p.premium, 0);
                  const grpPaid = grp.filter(p => p.carrierPaid).length;
                  const grpReceived = grp.reduce((s, p) => s + p.netReceived, 0);
                  const grpBalance = grp.reduce((s, p) => s + p.balance, 0);
                  const icon = STATUS_ICON[status] || '?';
                  const color = STATUS_COLOR[status] || C.muted;

                  const sorted = sortData(grp, waterfallSort.sortKey, waterfallSort.sortDir);

                  return (
                    <div key={status} style={{ marginTop: 12, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
                      {/* Group Header */}
                      <div
                        onClick={() => setWaterfallCollapsed(prev => ({ ...prev, [status]: !prev[status] }))}
                        style={{
                          padding: '10px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12,
                          borderBottom: collapsed ? 'none' : `1px solid ${C.border}`,
                          background: collapsed ? 'transparent' : 'rgba(255,255,255,0.02)',
                        }}
                      >
                        <span style={{ color: C.muted, fontSize: 10, width: 12 }}>{collapsed ? '▸' : '▾'}</span>
                        <span style={{ color, fontSize: 14, fontWeight: 700 }}>{icon}</span>
                        <span style={{ color, fontSize: 13, fontWeight: 700 }}>{status}</span>
                        <span style={{ color: C.muted, fontSize: 11 }}>— {grp.length} policies</span>
                        <span style={{ color: C.muted, fontSize: 11, marginLeft: 'auto' }}>
                          {fmtDollar(grpPrem)}/mo
                        </span>
                        <span style={{ color: grpPaid > 0 ? C.green : C.muted, fontSize: 10 }}>
                          Paid {grpPaid}/{grp.length}
                        </span>
                        {grpReceived !== 0 && (
                          <span style={{ color: grpReceived >= 0 ? C.green : C.red, fontSize: 10, fontFamily: C.mono }}>
                            Rcvd {fmtDollar(grpReceived)}
                          </span>
                        )}
                        {grpBalance !== 0 && (
                          <span style={{ color: grpBalance > 0 ? C.yellow : C.green, fontSize: 10, fontFamily: C.mono }}>
                            Bal {fmtDollar(grpBalance)}
                          </span>
                        )}
                      </div>

                      {/* Table */}
                      {!collapsed && (
                        <div style={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                            <thead>
                              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                                <SortTh label="Policy #" field="policyNumber" {...waterfallSort} onSort={waterfallSort.toggle} style={{ padding: '6px 10px', fontSize: 9, color: C.muted, textAlign: 'left' }} />
                                <SortTh label="Insured" field="insuredName" {...waterfallSort} onSort={waterfallSort.toggle} style={{ padding: '6px 10px', fontSize: 9, color: C.muted, textAlign: 'left' }} />
                                <SortTh label="Agent" field="agent" {...waterfallSort} onSort={waterfallSort.toggle} style={{ padding: '6px 10px', fontSize: 9, color: C.muted, textAlign: 'left' }} />
                                <SortTh label="Carrier" field="carrier" {...waterfallSort} onSort={waterfallSort.toggle} style={{ padding: '6px 10px', fontSize: 9, color: C.muted, textAlign: 'left' }} />
                                <SortTh label="Premium" field="premium" {...waterfallSort} onSort={waterfallSort.toggle} style={{ padding: '6px 10px', fontSize: 9, color: C.muted, textAlign: 'right' }} />
                                <SortTh label="Submitted" field="submitDate" {...waterfallSort} onSort={waterfallSort.toggle} style={{ padding: '6px 10px', fontSize: 9, color: C.muted, textAlign: 'left' }} />
                                <SortTh label="Effective" field="effectiveDate" {...waterfallSort} onSort={waterfallSort.toggle} style={{ padding: '6px 10px', fontSize: 9, color: C.muted, textAlign: 'left' }} />
                                <SortTh label="Paid" field="carrierPaid" {...waterfallSort} onSort={waterfallSort.toggle} style={{ padding: '6px 10px', fontSize: 9, color: C.muted, textAlign: 'center' }} />
                                <SortTh label="Expected" field="expectedCommission" {...waterfallSort} onSort={waterfallSort.toggle} style={{ padding: '6px 10px', fontSize: 9, color: C.muted, textAlign: 'right' }} />
                                <SortTh label="Received" field="netReceived" {...waterfallSort} onSort={waterfallSort.toggle} style={{ padding: '6px 10px', fontSize: 9, color: C.muted, textAlign: 'right' }} />
                                <SortTh label="Balance" field="balance" {...waterfallSort} onSort={waterfallSort.toggle} style={{ padding: '6px 10px', fontSize: 9, color: C.muted, textAlign: 'right' }} />
                                <th style={{ padding: '6px 10px', fontSize: 9, color: C.muted, width: 30 }}></th>
                              </tr>
                            </thead>
                            <tbody>
                              {sorted.map((p, i) => {
                                const flag = p.unpaid ? '⚠' : p.hasChargeback && p.netReceived < 0 ? '‼' : '';
                                return (
                                  <tr key={p.policyNumber} style={{
                                    borderBottom: `1px solid ${C.border}`,
                                    background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)',
                                  }}>
                                    <td style={{ padding: '5px 10px', fontFamily: C.mono, fontSize: 10, color: C.text }}>{p.policyNumber}</td>
                                    <td style={{ padding: '5px 10px', fontSize: 10, color: C.text, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.insuredName}</td>
                                    <td style={{ padding: '5px 10px', fontSize: 10, color: C.muted, maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.agent}</td>
                                    <td style={{ padding: '5px 10px', fontSize: 9, color: C.muted, maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.carrier}</td>
                                    <td style={{ padding: '5px 10px', fontFamily: C.mono, fontSize: 10, color: C.text, textAlign: 'right' }}>{fmtDollar(p.premium)}</td>
                                    <td style={{ padding: '5px 10px', fontSize: 9, color: C.muted }}>{p.submitDate}</td>
                                    <td style={{ padding: '5px 10px', fontSize: 9, color: C.muted }}>{p.effectiveDate}</td>
                                    <td style={{ padding: '5px 10px', textAlign: 'center', fontSize: 12 }}>
                                      {p.carrierPaid
                                        ? <span style={{ color: C.green }}>✓</span>
                                        : <span style={{ color: C.muted, fontSize: 9 }}>—</span>}
                                    </td>
                                    <td style={{ padding: '5px 10px', fontFamily: C.mono, fontSize: 10, color: p.expectedCommission > 0 ? C.text : C.muted, textAlign: 'right' }}>
                                      {p.expectedCommission > 0 ? fmtDollar(p.expectedCommission) : '—'}
                                    </td>
                                    <td style={{ padding: '5px 10px', fontFamily: C.mono, fontSize: 10, textAlign: 'right',
                                      color: p.netReceived > 0 ? C.green : p.netReceived < 0 ? C.red : C.muted }}>
                                      {p.carrierPaid ? fmtDollar(p.netReceived) : '—'}
                                    </td>
                                    <td style={{ padding: '5px 10px', fontFamily: C.mono, fontSize: 10, textAlign: 'right',
                                      color: p.balance > 1 ? C.yellow : p.balance < -1 ? C.green : C.muted }}>
                                      {p.expectedCommission > 0 ? fmtDollar(p.balance) : '—'}
                                    </td>
                                    <td style={{ padding: '5px 10px', fontSize: 12, textAlign: 'center', color: flag === '⚠' ? C.yellow : flag === '‼' ? C.red : 'transparent' }}>
                                      {flag}
                                    </td>
                                  </tr>
                                );
                              })}
                              {/* Subtotal row */}
                              <tr style={{ borderTop: `2px solid ${C.border}`, background: 'rgba(91,159,255,0.05)' }}>
                                <td colSpan={4} style={{ padding: '6px 10px', fontSize: 10, fontWeight: 700, color: C.accent }}>
                                  {grp.length} {grp.length === 1 ? 'policy' : 'policies'}
                                </td>
                                <td style={{ padding: '6px 10px', fontFamily: C.mono, fontSize: 10, fontWeight: 700, color: C.accent, textAlign: 'right' }}>
                                  {fmtDollar(grpPrem)}
                                </td>
                                <td colSpan={2}></td>
                                <td style={{ padding: '6px 10px', textAlign: 'center', fontSize: 10, color: C.accent }}>{grpPaid}</td>
                                <td style={{ padding: '6px 10px', fontFamily: C.mono, fontSize: 10, fontWeight: 700, color: C.accent, textAlign: 'right' }}>
                                  {fmtDollar(grp.reduce((s, p) => s + p.expectedCommission, 0))}
                                </td>
                                <td style={{ padding: '6px 10px', fontFamily: C.mono, fontSize: 10, fontWeight: 700, textAlign: 'right',
                                  color: grpReceived >= 0 ? C.green : C.red }}>
                                  {fmtDollar(grpReceived)}
                                </td>
                                <td style={{ padding: '6px 10px', fontFamily: C.mono, fontSize: 10, fontWeight: 700, textAlign: 'right',
                                  color: grpBalance > 1 ? C.yellow : C.green }}>
                                  {fmtDollar(grpBalance)}
                                </td>
                                <td></td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                });
              })()}

              {/* Gap Analysis */}
              <Section title="Gap Analysis">
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <KPICard label="Active — Unpaid"
                    value={waterfall.gaps.unpaidActive.count}
                    color={waterfall.gaps.unpaidActive.count > 0 ? C.red : C.green}
                    subtitle={`${fmtDollar(waterfall.gaps.unpaidActive.premium)}/mo at risk`}
                    tooltip="Active policies where the carrier has not paid any commission yet" />
                  <KPICard label="Pending — Unpaid"
                    value={waterfall.gaps.unpaidPending.count}
                    color={waterfall.gaps.unpaidPending.count > 0 ? C.yellow : C.green}
                    subtitle={`${fmtDollar(waterfall.gaps.unpaidPending.premium)}/mo pending`}
                    tooltip="Submitted/pending policies awaiting carrier payment" />
                  <KPICard label="Chargebacks"
                    value={waterfall.gaps.chargebacks.count}
                    color={waterfall.gaps.chargebacks.count > 0 ? C.red : C.green}
                    subtitle={fmtDollar(waterfall.gaps.chargebacks.amount)}
                    tooltip="Policies where the carrier clawed back commission" />
                </div>
              </Section>
            </>
          )}
        </div>
      )}

      {/* ═══════════════ ORGANIZE FILES VIEW ═══════════════ */}
      {subTab === 'organize' && (
        <div>
          <Section title="Organize Commission Files">
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
              Scan your Google Drive folder and organize commission files into carrier subfolders with standardized names.
              Files that can&apos;t be detected will stay in the root folder.
            </div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
              <button
                onClick={handleOrganizeScan}
                disabled={organizeStatus === 'scanning' || organizeStatus === 'organizing'}
                style={{
                  background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6,
                  color: C.muted, fontSize: 11, fontWeight: 600, padding: '6px 14px',
                  cursor: organizeStatus === 'scanning' || organizeStatus === 'organizing' ? 'not-allowed' : 'pointer',
                  opacity: organizeStatus === 'scanning' || organizeStatus === 'organizing' ? 0.5 : 1,
                }}
              >
                {organizeStatus === 'scanning' ? '⏳ Scanning Drive...' : 'Scan Files'}
              </button>
              <button
                onClick={handleListFiles}
                disabled={fileListLoading}
                style={{
                  background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6,
                  color: C.accent, fontSize: 11, fontWeight: 600, padding: '6px 14px',
                  cursor: fileListLoading ? 'not-allowed' : 'pointer',
                  opacity: fileListLoading ? 0.5 : 1,
                }}
              >
                {fileListLoading ? '⏳ Loading...' : '📂 View Synced Files'}
              </button>
              {organizePreview && organizePreview.proposals?.filter(p => p.status === 'will_move').length > 0 && (
                <button
                  onClick={handleOrganizeExecute}
                  disabled={organizeStatus === 'organizing'}
                  style={{
                    background: C.accent, border: 'none', borderRadius: 6,
                    color: '#fff', fontSize: 11, fontWeight: 700, padding: '6px 14px',
                    cursor: organizeStatus === 'organizing' ? 'not-allowed' : 'pointer',
                    opacity: organizeStatus === 'organizing' ? 0.5 : 1,
                  }}
                >
                  {organizeStatus === 'organizing' ? 'Organizing...' : `Organize ${organizePreview.proposals.filter(p => p.status === 'will_move').length} Files`}
                </button>
              )}
            </div>

            {organizeStatus === 'scanning' && (
              <div style={{ padding: '20px 0', textAlign: 'center' }}>
                <div style={{ fontSize: 14, color: C.accent, fontWeight: 600, marginBottom: 6 }}>Scanning Google Drive...</div>
                <div style={{ fontSize: 11, color: C.muted }}>Downloading and analyzing each file to detect carrier. This may take 30-60 seconds.</div>
              </div>
            )}

            {/* Already organized summary */}
            {organizePreview && organizePreview.subfolderSummary && Object.keys(organizePreview.subfolderSummary).length > 0 && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
                {Object.entries(organizePreview.subfolderSummary).map(([folder, count]) => (
                  <KPICard key={folder} label={folder} value={count} color={C.accent} subtitle="files in subfolder" />
                ))}
              </div>
            )}

            {/* Scan preview table */}
            {organizeStatus === 'preview' && organizePreview?.proposals?.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, color: C.text }}>{organizePreview.rootFilesCount}</span> files in root folder &nbsp;·&nbsp;
                  <span style={{ fontWeight: 700, color: C.green }}>{organizePreview.proposals.filter(p => p.status === 'will_move').length}</span> can be organized &nbsp;·&nbsp;
                  <span style={{ fontWeight: 700, color: organizePreview.proposals.filter(p => p.status === 'undetected').length > 0 ? C.yellow : C.muted }}>{organizePreview.proposals.filter(p => p.status === 'undetected').length}</span> undetected
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Current Name</th>
                      <th style={thStyle}>Carrier</th>
                      <th style={thStyle}>Pay Period</th>
                      <th style={thStyle}>Records</th>
                      <th style={thStyle}>Target Folder</th>
                      <th style={thStyle}>New Name</th>
                    </tr>
                  </thead>
                  <tbody>
                    {organizePreview.proposals.map((p, i) => (
                      <tr key={i} style={{ background: p.status === 'undetected' ? C.yellowDim : 'transparent' }}>
                        <td style={{ ...tdStyle, fontSize: 10, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.currentName}</td>
                        <td style={tdStyle}>
                          {p.carrier ? (
                            <span style={{
                              background: C.accent + '22', border: `1px solid ${C.accent}44`, borderRadius: 4,
                              padding: '2px 6px', fontSize: 10, color: C.accent, fontWeight: 600,
                            }}>{p.carrier}</span>
                          ) : (
                            <span style={{ fontSize: 10, color: C.yellow }}>Unknown</span>
                          )}
                        </td>
                        <td style={{ ...tdStyle, fontSize: 11 }}>{p.payPeriod || '—'}</td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>{p.recordCount || '—'}</td>
                        <td style={{ ...tdStyle, fontSize: 11, color: p.targetFolder ? C.green : C.yellow }}>{p.targetFolder || 'Root (unchanged)'}</td>
                        <td style={{ ...tdStyle, fontSize: 9, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: C.mono, color: C.muted }}>
                          {p.proposedName || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {organizeStatus === 'preview' && organizePreview?.proposals?.length === 0 && (
              <div style={{ fontSize: 12, color: C.green, fontWeight: 600 }}>
                All files are already organized — nothing in the root folder to move.
              </div>
            )}

            {/* Organize results */}
            {organizeStatus === 'done' && organizeResult && (
              <div style={{ background: C.greenDim, border: `1px solid ${C.green}`, borderRadius: 8, padding: '12px 16px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.green, textTransform: 'uppercase', marginBottom: 10 }}>
                  Organization Complete
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                  <KPICard label="Files Moved" value={organizeResult.moved} color={C.green} />
                  {organizeResult.failed > 0 && <KPICard label="Failed" value={organizeResult.failed} color={C.red} />}
                  {Object.entries(organizeResult.movedByCarrier || {}).map(([carrier, count]) => (
                    <KPICard key={carrier} label={carrier} value={count} color={C.accent} />
                  ))}
                </div>
                {organizeResult.results?.length > 0 && (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Original</th>
                          <th style={thStyle}>Carrier</th>
                          <th style={thStyle}>New Name</th>
                          <th style={thStyle}>Folder</th>
                        </tr>
                      </thead>
                      <tbody>
                        {organizeResult.results.map((r, i) => (
                          <tr key={i}>
                            <td style={{ ...tdStyle, fontSize: 10, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.originalName}</td>
                            <td style={tdStyle}>
                              <span style={{
                                background: C.accent + '22', border: `1px solid ${C.accent}44`, borderRadius: 4,
                                padding: '2px 6px', fontSize: 10, color: C.accent, fontWeight: 600,
                              }}>{r.carrier}</span>
                            </td>
                            <td style={{ ...tdStyle, fontSize: 9, fontFamily: C.mono, color: C.muted }}>{r.newName}</td>
                            <td style={{ ...tdStyle, fontSize: 11, color: C.green }}>{r.folder}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {organizeResult.errors?.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: C.red, textTransform: 'uppercase', marginBottom: 4 }}>Errors</div>
                    {organizeResult.errors.map((e, i) => (
                      <div key={i} style={{ fontSize: 11, color: C.red, fontFamily: C.mono }}>{e.filename}: {e.error}</div>
                    ))}
                  </div>
                )}
                <button
                  onClick={() => { setOrganizeStatus(null); setOrganizePreview(null); setOrganizeResult(null); }}
                  style={{ marginTop: 10, background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, color: C.muted, fontSize: 10, padding: '4px 10px', cursor: 'pointer' }}
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* Error */}
            {organizeStatus === 'error' && organizeError && (
              <div style={{ background: C.redDim, border: `1px solid ${C.red}`, borderRadius: 8, padding: '12px 16px' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.red }}>Error: {organizeError}</div>
                <button
                  onClick={() => { setOrganizeStatus(null); setOrganizeError(null); }}
                  style={{ marginTop: 8, background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, color: C.muted, fontSize: 10, padding: '4px 10px', cursor: 'pointer' }}
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* File listing error */}
            {fileListError && (
              <div style={{ fontSize: 12, color: C.red, marginTop: 12 }}>Error loading files: {fileListError}</div>
            )}

            {/* File listing by carrier */}
            {fileList && (
              <div style={{ marginTop: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
                    Synced Files — <span style={{ color: C.accent }}>{fileList.totalFiles}</span> total
                  </div>
                  <button
                    onClick={() => setFileList(null)}
                    style={{ background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, color: C.muted, fontSize: 10, padding: '4px 10px', cursor: 'pointer' }}
                  >
                    Hide
                  </button>
                </div>

                {Object.entries(fileList.carriers).sort((a, b) => a[0].localeCompare(b[0])).map(([carrier, files]) => (
                  <div key={carrier} style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{
                        background: C.accent + '22', border: `1px solid ${C.accent}44`, borderRadius: 4,
                        padding: '2px 8px', fontSize: 11, color: C.accent, fontWeight: 700,
                      }}>{carrier}</span>
                      <span style={{ fontSize: 10, color: C.muted }}>{files.length} file{files.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            <th style={thStyle}>Filename</th>
                            <th style={thStyle}>Size</th>
                            <th style={thStyle}>Modified</th>
                          </tr>
                        </thead>
                        <tbody>
                          {files.map((f, i) => (
                            <tr key={f.id || i}>
                              <td style={{ ...tdStyle, fontSize: 11 }}>{f.name}</td>
                              <td style={{ ...tdStyle, fontSize: 10, color: C.muted, whiteSpace: 'nowrap' }}>{f.size}</td>
                              <td style={{ ...tdStyle, fontSize: 10, color: C.muted, whiteSpace: 'nowrap' }}>
                                {f.modified ? new Date(f.modified).toLocaleDateString() : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}

                {fileList.root.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{
                        background: C.yellowDim, border: `1px solid ${C.yellow}44`, borderRadius: 4,
                        padding: '2px 8px', fontSize: 11, color: C.yellow, fontWeight: 700,
                      }}>Root (Unorganized)</span>
                      <span style={{ fontSize: 10, color: C.muted }}>{fileList.root.length} file{fileList.root.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            <th style={thStyle}>Filename</th>
                            <th style={thStyle}>Size</th>
                            <th style={thStyle}>Modified</th>
                          </tr>
                        </thead>
                        <tbody>
                          {fileList.root.map((f, i) => (
                            <tr key={f.id || i}>
                              <td style={{ ...tdStyle, fontSize: 11, color: C.yellow }}>{f.name}</td>
                              <td style={{ ...tdStyle, fontSize: 10, color: C.muted, whiteSpace: 'nowrap' }}>{f.size}</td>
                              <td style={{ ...tdStyle, fontSize: 10, color: C.muted, whiteSpace: 'nowrap' }}>
                                {f.modified ? new Date(f.modified).toLocaleDateString() : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Section>
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
