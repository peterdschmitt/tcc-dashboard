'use client';
import { useState, useEffect } from 'react';
import { C, fmtDollar, STATUS_COLORS, POLICYHOLDER_STATUSES, LAPSE_REASONS, OUTREACH_METHODS, OUTREACH_OUTCOMES } from '../shared/theme';

function SortableTable({ columns, rows }) {
  return (
    <div style={{ overflowX: 'auto', marginTop: 8 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          {columns.map(col => (
            <th key={col.key} style={{
              padding: '8px 10px', textAlign: col.align || 'right', fontSize: 9, fontWeight: 700, color: C.muted,
              textTransform: 'uppercase', letterSpacing: 0.8, borderBottom: `1px solid ${C.border}`, background: C.surface,
              whiteSpace: 'nowrap',
            }}>{col.label}</th>
          ))}
        </tr></thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
              {columns.map(col => (
                <td key={col.key} style={{
                  padding: '8px 10px', textAlign: col.align || 'right', fontSize: 11,
                  color: C.text, fontFamily: col.mono ? C.mono : 'inherit',
                }}>
                  {col.render ? col.render(row[col.key], row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PolicyholderDetailModal({ policyNumber, onClose }) {
  const [policyholder, setPolicyholder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editStatus, setEditStatus] = useState(null);
  const [lapseReason, setLapseReason] = useState(null);
  const [outreachMethod, setOutreachMethod] = useState('Phone');
  const [outreachOutcome, setOutreachOutcome] = useState('Reached');
  const [outreachNotes, setOutreachNotes] = useState('');
  const [saveLoading, setSaveLoading] = useState(false);
  const [outreachHistory, setOutreachHistory] = useState([]);
  const [showOutreachForm, setShowOutreachForm] = useState(false);
  const [showLapseForm, setShowLapseForm] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/crm/policyholder/${policyNumber}`).then(r => r.json()),
      fetch(`/api/crm/tasks?policyNumber=${policyNumber}`).then(r => r.json()),
    ])
      .then(([ph, tasks]) => {
        setPolicyholder(ph);
        setEditStatus(ph.status);
        setOutreachHistory(tasks.tasks || []);
        setError(null);
      })
      .catch(err => {
        setError(err.message);
      })
      .finally(() => setLoading(false));
  }, [policyNumber]);

  const handleSaveStatus = async () => {
    if (!editStatus) return;
    setSaveLoading(true);
    try {
      const res = await fetch(`/api/crm/policyholder/${policyNumber}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: editStatus,
          ...(editStatus === 'Lapsed' && lapseReason ? { lapseReason } : {}),
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setPolicyholder(updated);
        setShowLapseForm(false);
      }
    } catch (err) {
      console.error('Error saving:', err);
    } finally {
      setSaveLoading(false);
    }
  };

  const handleLogOutreach = async () => {
    if (!outreachMethod || !outreachOutcome) return;
    setSaveLoading(true);
    try {
      const res = await fetch(`/api/crm/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          policyNumber,
          type: 'Outreach',
          method: outreachMethod,
          outcome: outreachOutcome,
          notes: outreachNotes,
        }),
      });
      if (res.ok) {
        const task = await res.json();
        setOutreachHistory([task, ...outreachHistory]);
        setOutreachMethod('Phone');
        setOutreachOutcome('Reached');
        setOutreachNotes('');
        setShowOutreachForm(false);
      }
    } catch (err) {
      console.error('Error logging outreach:', err);
    } finally {
      setSaveLoading(false);
    }
  };

  const overlayStyle = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 2000,
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto',
  };

  const cardStyle = {
    background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 24,
    maxWidth: 900, width: '100%', marginTop: 20, color: C.text,
  };

  if (loading) return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={cardStyle} onClick={e => e.stopPropagation()}>
        <div style={{ color: C.muted, textAlign: 'center' }}>Loading...</div>
      </div>
    </div>
  );

  if (error) return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={cardStyle} onClick={e => e.stopPropagation()}>
        <div style={{ color: C.red, textAlign: 'center' }}>Error: {error}</div>
      </div>
    </div>
  );

  if (!policyholder) return null;

  const fullName = policyholder.firstName && policyholder.lastName
    ? `${policyholder.firstName} ${policyholder.lastName}` : policyholder.firstName || '—';

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={cardStyle} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 4 }}>{fullName}</div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontFamily: C.mono, color: C.muted }}>Policy #{policyholder.policyNumber}</span>
              <span style={{
                display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                background: (STATUS_COLORS[policyholder.status] || C.muted) + '22', color: STATUS_COLORS[policyholder.status] || C.muted,
              }}>{policyholder.status || '—'}</span>
              <span style={{ fontSize: 12, fontFamily: C.mono, color: C.accent, fontWeight: 600 }}>
                {fmtDollar(parseFloat(policyholder.premium) || 0)}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer',
              fontSize: 24, padding: 0, lineHeight: 1, width: 24, height: 24,
            }}
          >
            ×
          </button>
        </div>

        {/* Info Grid */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 20,
          background: C.bg, padding: 12, borderRadius: 6, border: `1px solid ${C.border}`,
        }}>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 4 }}>Carrier</div>
            <div style={{ fontSize: 12, color: C.text }}>{policyholder.carrier || '—'}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 4 }}>Product</div>
            <div style={{ fontSize: 12, color: C.text }}>{policyholder.product || '—'}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 4 }}>Issue Date</div>
            <div style={{ fontSize: 12, fontFamily: C.mono, color: C.text }}>
              {policyholder.issueDate ? new Date(policyholder.issueDate).toLocaleDateString() : '—'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 4 }}>Agent</div>
            <div style={{ fontSize: 12, color: C.text }}>{policyholder.agent || '—'}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 4 }}>Days Since Payment</div>
            <div style={{ fontSize: 12, fontFamily: C.mono, color: C.text }}>
              {policyholder.lastPaymentDate
                ? Math.floor((new Date() - new Date(policyholder.lastPaymentDate)) / (1000 * 60 * 60 * 24)) + 'd'
                : '—'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 4 }}>Last Outreach</div>
            <div style={{ fontSize: 12, fontFamily: C.mono, color: C.text }}>
              {policyholder.lastOutreach ? new Date(policyholder.lastOutreach).toLocaleDateString() : '—'}
            </div>
          </div>
        </div>

        {/* Status Controls */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 8 }}>Status</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 12 }}>
            <select
              value={editStatus}
              onChange={(e) => {
                setEditStatus(e.target.value);
                if (e.target.value === 'Lapsed') setShowLapseForm(true);
                else setShowLapseForm(false);
              }}
              style={{
                background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px',
                color: C.text, fontFamily: C.sans, fontSize: 12, flex: 1,
              }}
            >
              {POLICYHOLDER_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button
              onClick={handleSaveStatus}
              disabled={saveLoading}
              style={{
                background: C.accent, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px',
                fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: saveLoading ? 0.6 : 1,
              }}
            >
              {saveLoading ? 'Saving...' : 'Save'}
            </button>
          </div>

          {showLapseForm && (
            <div style={{ padding: 12, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 8 }}>Lapse Reason</div>
              <select
                value={lapseReason || ''}
                onChange={(e) => setLapseReason(e.target.value)}
                style={{
                  background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px',
                  color: C.text, fontFamily: C.sans, fontSize: 12, width: '100%', marginBottom: 8,
                }}
              >
                <option value="">Select reason...</option>
                {LAPSE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* Outreach Form */}
        <div style={{ marginBottom: 20 }}>
          <button
            onClick={() => setShowOutreachForm(!showOutreachForm)}
            style={{
              background: 'transparent', border: 'none', color: C.accent, cursor: 'pointer',
              fontSize: 10, fontWeight: 700, textTransform: 'uppercase', padding: 0, marginBottom: 8,
            }}
          >
            {showOutreachForm ? '▼' : '▶'} Log Outreach
          </button>

          {showOutreachForm && (
            <div style={{ padding: 12, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 6 }}>Method</div>
                  <select
                    value={outreachMethod}
                    onChange={(e) => setOutreachMethod(e.target.value)}
                    style={{
                      background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px',
                      color: C.text, fontFamily: C.sans, fontSize: 12, width: '100%',
                    }}
                  >
                    {OUTREACH_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 6 }}>Outcome</div>
                  <select
                    value={outreachOutcome}
                    onChange={(e) => setOutreachOutcome(e.target.value)}
                    style={{
                      background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px',
                      color: C.text, fontFamily: C.sans, fontSize: 12, width: '100%',
                    }}
                  >
                    {OUTREACH_OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 6 }}>Notes</div>
                <textarea
                  value={outreachNotes}
                  onChange={(e) => setOutreachNotes(e.target.value)}
                  style={{
                    background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px',
                    color: C.text, fontFamily: C.sans, fontSize: 12, width: '100%', minHeight: 60, resize: 'vertical',
                  }}
                  placeholder="Notes about this outreach..."
                />
              </div>
              <button
                onClick={handleLogOutreach}
                disabled={saveLoading}
                style={{
                  background: C.accent, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: saveLoading ? 0.6 : 1, width: '100%',
                }}
              >
                {saveLoading ? 'Saving...' : 'Log Outreach'}
              </button>
            </div>
          )}
        </div>

        {/* Outreach History */}
        <div style={{ marginBottom: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 12 }}>Outreach History</div>
          {outreachHistory.length > 0 ? (
            <SortableTable
              columns={[
                { key: 'createdAt', label: 'Date', render: (val) => val ? new Date(val).toLocaleDateString() : '—' },
                { key: 'method', label: 'Method' },
                { key: 'outcome', label: 'Outcome' },
                { key: 'agent', label: 'Agent' },
                { key: 'notes', label: 'Notes' },
              ]}
              rows={outreachHistory}
            />
          ) : (
            <div style={{ color: C.muted, padding: 12, textAlign: 'center', fontSize: 11 }}>No outreach history</div>
          )}
        </div>
      </div>
    </div>
  );
}
