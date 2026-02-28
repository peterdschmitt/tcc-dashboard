'use client';
import { useState, useEffect, useCallback } from 'react';

const C = {
  bg: '#080b10', surface: '#0f1520', card: '#131b28', border: '#1a2538',
  text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff', accentDim: '#1e3a5f',
  green: '#22c55e', greenDim: '#0a2e1a', yellow: '#eab308', yellowDim: '#2e2a0a',
  red: '#ef4444', redDim: '#2e0a0a', purple: '#a855f7', cyan: '#06b6d4',
  mono: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
  sans: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
};

const inputStyle = {
  background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4,
  color: C.text, padding: '6px 10px', fontSize: 12, fontFamily: C.mono,
  outline: 'none', width: '100%', boxSizing: 'border-box',
};
const inputFocusColor = C.accent;

function Toast({ message, type, onClose }) {
  if (!message) return null;
  const bg = type === 'error' ? C.redDim : C.greenDim;
  const borderColor = type === 'error' ? C.red : C.green;
  return (
    <div style={{
      position: 'fixed', top: 20, right: 20, zIndex: 9999,
      background: bg, border: `1px solid ${borderColor}`, borderRadius: 8,
      padding: '12px 20px', color: C.text, fontSize: 13, fontFamily: C.sans,
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)', display: 'flex', gap: 12, alignItems: 'center',
      animation: 'slideIn 0.3s ease',
    }}>
      <span>{type === 'error' ? '✗' : '✓'}</span>
      <span>{message}</span>
      <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 16 }}>×</button>
    </div>
  );
}

function SectionHeader({ title, subtitle, rightContent }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
      <div>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: 0 }}>{title}</h2>
        {subtitle && <p style={{ fontSize: 11, color: C.muted, margin: '4px 0 0' }}>{subtitle}</p>}
      </div>
      {rightContent}
    </div>
  );
}

function Btn({ children, onClick, variant = 'primary', disabled, small, style: extraStyle }) {
  const styles = {
    primary: { background: C.accent, color: '#fff', border: 'none' },
    danger: { background: C.red, color: '#fff', border: 'none' },
    ghost: { background: 'transparent', color: C.accent, border: `1px solid ${C.border}` },
    success: { background: C.green, color: '#fff', border: 'none' },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{
      ...styles[variant], borderRadius: 6, padding: small ? '4px 10px' : '7px 16px',
      fontSize: small ? 11 : 12, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1, fontFamily: C.sans, transition: 'all 0.15s',
      ...(extraStyle || {}),
    }}>{children}</button>
  );
}

// ─── EDITABLE TABLE ─────────────────────────────────────
function EditableTable({ headers, rows, onSave, onDelete, onAdd, saving, section }) {
  const [editRow, setEditRow] = useState(null); // rowIndex being edited
  const [editData, setEditData] = useState({});
  const [addMode, setAddMode] = useState(false);
  const [newRow, setNewRow] = useState({});

  const displayHeaders = headers.filter(h => h && !h.startsWith('_'));

  function startEdit(row, idx) {
    setEditRow(idx);
    const d = {};
    displayHeaders.forEach(h => d[h] = row[h] || '');
    setEditData(d);
  }

  function cancelEdit() {
    setEditRow(null);
    setEditData({});
  }

  async function saveEdit(row) {
    await onSave(row._rowIndex, editData);
    setEditRow(null);
    setEditData({});
  }

  async function handleAdd() {
    await onAdd(newRow);
    setNewRow({});
    setAddMode(false);
  }

  function handleDelete(row) {
    if (!window.confirm(`Delete this row? This will remove it from the Google Sheet.`)) return;
    onDelete(row._rowIndex);
  }

  // Column width hints based on header name
  function colWidth(h) {
    const hl = h.toLowerCase();
    if (hl.includes('status') || hl.includes('active')) return 80;
    if (hl.includes('buffer') || hl.includes('rate') || hl.includes('price') || hl.includes('payout')) return 100;
    if (hl.includes('vendor') || hl.includes('category')) return 120;
    if (hl.includes('campaign') || hl.includes('carrier') || hl.includes('product') || hl.includes('agent') || hl.includes('name') || hl.includes('metric') || hl.includes('goal')) return 180;
    return 130;
  }

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: C.mono, fontSize: 12 }}>
          <thead>
            <tr style={{ background: C.surface }}>
              {displayHeaders.map(h => (
                <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: 1, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap', minWidth: colWidth(h) }}>{h}</th>
              ))}
              <th style={{ padding: '10px 12px', borderBottom: `1px solid ${C.border}`, width: 120, textAlign: 'center', fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx} style={{ borderBottom: `1px solid ${C.border}`, background: editRow === idx ? C.accentDim : 'transparent' }}>
                {displayHeaders.map(h => (
                  <td key={h} style={{ padding: '8px 12px', color: C.text }}>
                    {editRow === idx ? (
                      <input
                        value={editData[h] || ''}
                        onChange={e => setEditData(d => ({ ...d, [h]: e.target.value }))}
                        style={inputStyle}
                        onFocus={e => e.target.style.borderColor = inputFocusColor}
                        onBlur={e => e.target.style.borderColor = C.border}
                      />
                    ) : (
                      <span style={{ color: row[h] ? C.text : C.muted }}>{row[h] || '—'}</span>
                    )}
                  </td>
                ))}
                <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                  {editRow === idx ? (
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                      <Btn small variant="success" onClick={() => saveEdit(row)} disabled={saving}>Save</Btn>
                      <Btn small variant="ghost" onClick={cancelEdit}>Cancel</Btn>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                      <Btn small variant="ghost" onClick={() => startEdit(row, idx)}>Edit</Btn>
                      <Btn small variant="danger" onClick={() => handleDelete(row)} disabled={saving}>✗</Btn>
                    </div>
                  )}
                </td>
              </tr>
            ))}

            {/* Add new row */}
            {addMode && (
              <tr style={{ background: C.greenDim }}>
                {displayHeaders.map(h => (
                  <td key={h} style={{ padding: '8px 12px' }}>
                    <input
                      value={newRow[h] || ''}
                      onChange={e => setNewRow(d => ({ ...d, [h]: e.target.value }))}
                      placeholder={h}
                      style={inputStyle}
                      onFocus={e => e.target.style.borderColor = inputFocusColor}
                      onBlur={e => e.target.style.borderColor = C.border}
                    />
                  </td>
                ))}
                <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                    <Btn small variant="success" onClick={handleAdd} disabled={saving}>Add</Btn>
                    <Btn small variant="ghost" onClick={() => { setAddMode(false); setNewRow({}); }}>Cancel</Btn>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!addMode && (
        <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'flex-end' }}>
          <Btn onClick={() => setAddMode(true)} variant="ghost">+ Add Row</Btn>
        </div>
      )}
    </div>
  );
}


// ─── MAIN SETTINGS PAGE ────────────────────────────────
export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('pricing');
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/settings?section=all');
      const json = await res.json();
      setData(json);
    } catch (e) {
      showToast('Failed to load settings: ' + e.message, 'error');
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function handleSave(section, rowNumber, rowData) {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section, action: 'update', rowNumber, rowData }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      showToast('Row updated successfully');
      await loadAll();
    } catch (e) {
      showToast('Save failed: ' + e.message, 'error');
    }
    setSaving(false);
  }

  async function handleAdd(section, rowData) {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section, action: 'add', rowData }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      showToast('Row added successfully');
      await loadAll();
    } catch (e) {
      showToast('Add failed: ' + e.message, 'error');
    }
    setSaving(false);
  }

  async function handleDelete(section, rowNumber) {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section, action: 'delete', rowNumber }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      showToast('Row deleted');
      await loadAll();
    } catch (e) {
      showToast('Delete failed: ' + e.message, 'error');
    }
    setSaving(false);
  }

  const tabs = [
    { id: 'pricing', label: 'Publisher Pricing', icon: '📡', description: 'Campaign codes, vendors, price per billable call, buffer thresholds' },
    { id: 'companyGoals', label: 'Company Daily Goals', icon: '🎯', description: 'CPA targets, close rates, premium goals' },
    { id: 'agentGoals', label: 'Agent Daily Goals', icon: '👤', description: 'Per-agent performance targets' },
    { id: 'commission', label: 'Commission Rates', icon: '💰', description: 'Carrier/product commission schedule' },
  ];

  const currentTab = tabs.find(t => t.id === activeTab);
  const currentData = data[activeTab] || { headers: [], rows: [] };

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text, fontFamily: C.sans }}>
      <style>{`
        @keyframes slideIn { from { transform: translateX(100px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        input:focus { border-color: ${C.accent} !important; box-shadow: 0 0 0 2px ${C.accentDim}; }
      `}</style>

      <Toast message={toast?.message} type={toast?.type} onClose={() => setToast(null)} />

      {/* Header */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: '12px 24px', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <a href="/" style={{ color: C.accent, fontSize: 12, textDecoration: 'none', fontWeight: 600 }}>← Dashboard</a>
            <div>
              <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0, letterSpacing: -0.3 }}>⚙ Settings</h1>
              <p style={{ fontSize: 10, color: C.muted, margin: '2px 0 0' }}>
                Manage pricing, goals, and commission rates · Changes write directly to Google Sheets
              </p>
            </div>
          </div>
          <Btn variant="ghost" onClick={loadAll} disabled={loading}>
            {loading ? '↻ Loading...' : '↻ Refresh'}
          </Btn>
        </div>
      </div>

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '20px 24px', display: 'flex', gap: 24 }}>

        {/* Sidebar */}
        <div style={{ width: 220, flexShrink: 0 }}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', position: 'sticky', top: 80 }}>
            {tabs.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                padding: '14px 16px', border: 'none', borderBottom: `1px solid ${C.border}`,
                background: activeTab === tab.id ? C.accentDim : 'transparent',
                borderLeft: activeTab === tab.id ? `3px solid ${C.accent}` : '3px solid transparent',
                color: activeTab === tab.id ? C.text : C.muted,
                cursor: 'pointer', textAlign: 'left', fontSize: 12, fontWeight: 600,
                fontFamily: C.sans, transition: 'all 0.15s',
              }}>
                <span style={{ fontSize: 16 }}>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Sheet info */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16, marginTop: 12, fontSize: 10, color: C.muted, lineHeight: 1.6 }}>
            <div style={{ fontWeight: 700, color: C.text, marginBottom: 6 }}>How it works</div>
            <p style={{ margin: 0 }}>
              Edits here write directly to the Google Sheet via the service account. Changes take effect on the next dashboard refresh.
            </p>
            <p style={{ margin: '8px 0 0' }}>
              <span style={{ color: C.yellow }}>⚠</span> Delete is permanent — rows are removed from the sheet.
            </p>
          </div>
        </div>

        {/* Main content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 60 }}>
              <div style={{ width: 40, height: 40, border: `3px solid ${C.border}`, borderTopColor: C.accent, borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
              <p style={{ color: C.muted }}>Loading settings...</p>
            </div>
          ) : (
            <>
              <SectionHeader
                title={currentTab.icon + ' ' + currentTab.label}
                subtitle={currentTab.description}
                rightContent={
                  <span style={{ fontSize: 11, color: C.muted, fontFamily: C.mono }}>
                    {currentData.rows?.length || 0} rows
                  </span>
                }
              />

              {currentData.error ? (
                <div style={{ background: C.yellowDim, border: `1px solid ${C.yellow}`, borderRadius: 8, padding: 20, marginBottom: 16 }}>
                  <p style={{ margin: 0, fontSize: 13, color: C.text }}>
                    <strong>Tab not found:</strong> {currentData.error}
                  </p>
                  <p style={{ margin: '8px 0 0', fontSize: 11, color: C.muted }}>
                    Create a tab named "{tabs.find(t => t.id === activeTab)?.label}" in your Goals & Pricing spreadsheet,
                    or update the env var to match an existing tab name.
                  </p>
                  <TabSetupHelper section={activeTab} />
                </div>
              ) : currentData.headers?.length > 0 ? (
                <EditableTable
                  section={activeTab}
                  headers={currentData.headers}
                  rows={currentData.rows || []}
                  onSave={(rowNum, rowData) => handleSave(activeTab, rowNum, rowData)}
                  onDelete={(rowNum) => handleDelete(activeTab, rowNum)}
                  onAdd={(rowData) => handleAdd(activeTab, rowData)}
                  saving={saving}
                />
              ) : (
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 40, textAlign: 'center' }}>
                  <p style={{ color: C.muted, fontSize: 13 }}>No data found in this tab.</p>
                  <TabSetupHelper section={activeTab} />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── SETUP HELPER ──────────────────────────────────────
function TabSetupHelper({ section }) {
  const templates = {
    pricing: {
      headers: ['Campaign Code', 'Vendor', 'Category', 'Price per Billable Call ($)', 'Buffer (seconds)', 'Status'],
      example: ['BCL', 'BatchLeads', 'Final Expense', '45', '120', 'Active'],
    },
    companyGoals: {
      headers: ['Metric', 'Value', 'Notes'],
      example: ['CPA', '250', 'Target cost per acquisition'],
    },
    agentGoals: {
      headers: ['Agent', 'Apps Per Day', 'Premium Target', 'Close Rate'],
      example: ['John Smith', '3', '500', '5%'],
    },
    commission: {
      headers: ['Carrier', 'Product', 'Age Range', 'Commission Rate'],
      example: ['American Amicable', 'Senior Choice', '50-70', '135%'],
    },
  };

  const t = templates[section];
  if (!t) return null;

  return (
    <div style={{ marginTop: 16, textAlign: 'left' }}>
      <p style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>Expected column headers:</p>
      <div style={{ background: C.surface, borderRadius: 6, padding: 12, fontFamily: C.mono, fontSize: 11, overflowX: 'auto' }}>
        <div style={{ color: C.accent, marginBottom: 4 }}>{t.headers.join(' | ')}</div>
        <div style={{ color: C.muted }}>{t.example.join(' | ')}</div>
      </div>
    </div>
  );
}
