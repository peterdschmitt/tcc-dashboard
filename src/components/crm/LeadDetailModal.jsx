'use client';
import { useState, useEffect } from 'react';
import { C, fmt, STATUS_COLORS, LEAD_STATUSES } from '../shared/theme';

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

export default function LeadDetailModal({ leadId, onClose }) {
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editStatus, setEditStatus] = useState(null);
  const [editNotes, setEditNotes] = useState(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [callHistory, setCallHistory] = useState([]);
  const [showPolicies, setShowPolicies] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/crm/lead/${leadId}`).then(r => r.json()),
      fetch(`/api/crm/lead/${leadId}/calls`).then(r => r.json()),
    ])
      .then(([lead, calls]) => {
        setLead(lead);
        setEditStatus(lead.status);
        setEditNotes(lead.notes);
        setCallHistory(calls.calls || []);
        setError(null);
      })
      .catch(err => {
        setError(err.message);
      })
      .finally(() => setLoading(false));
  }, [leadId]);

  const handleSaveStatus = async () => {
    setSaveLoading(true);
    try {
      const res = await fetch(`/api/crm/lead/${leadId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: editStatus, notes: editNotes }),
      });
      if (res.ok) {
        const updated = await res.json();
        setLead(updated);
      }
    } catch (err) {
      console.error('Error saving:', err);
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
    maxWidth: 800, width: '100%', marginTop: 20, color: C.text,
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

  if (!lead) return null;

  const fullName = lead.firstName && lead.lastName ? `${lead.firstName} ${lead.lastName}` : lead.firstName || '—';

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={cardStyle} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: C.text, marginBottom: 4 }}>{fullName}</div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontFamily: C.mono, color: C.muted }}>{lead.phone || '—'}</span>
              <span style={{
                display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                background: (STATUS_COLORS[lead.status] || C.muted) + '22', color: STATUS_COLORS[lead.status] || C.muted,
              }}>{lead.status || '—'}</span>
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
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20,
          background: C.bg, padding: 12, borderRadius: 6, border: `1px solid ${C.border}`,
        }}>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 4 }}>Lead Source</div>
            <div style={{ fontSize: 12, color: C.text }}>{lead.source || '—'}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 4 }}>Primary Agent</div>
            <div style={{ fontSize: 12, color: C.text }}>{lead.agent || '—'}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 4 }}>First Contact</div>
            <div style={{ fontSize: 12, fontFamily: C.mono, color: C.text }}>
              {lead.createdAt ? new Date(lead.createdAt).toLocaleDateString() : '—'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 4 }}>Last Contact</div>
            <div style={{ fontSize: 12, fontFamily: C.mono, color: C.text }}>
              {lead.lastContact ? new Date(lead.lastContact).toLocaleDateString() : '—'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 4 }}>Follow-Up Due</div>
            <div style={{ fontSize: 12, fontFamily: C.mono, color: lead.followUpDue && new Date(lead.followUpDue) < new Date() ? C.red : C.text }}>
              {lead.followUpDue ? new Date(lead.followUpDue).toLocaleDateString() : '—'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 4 }}>Attempts</div>
            <div style={{ fontSize: 12, fontFamily: C.mono, color: C.text }}>{lead.attempts || 0}</div>
          </div>
        </div>

        {/* Status Controls */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 8 }}>Status</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              value={editStatus}
              onChange={(e) => setEditStatus(e.target.value)}
              style={{
                background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px',
                color: C.text, fontFamily: C.sans, fontSize: 12, flex: 1,
              }}
            >
              {LEAD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
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
        </div>

        {/* Notes Section */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 8 }}>Notes</div>
          <textarea
            value={editNotes || ''}
            onChange={(e) => setEditNotes(e.target.value)}
            style={{
              background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px',
              color: C.text, fontFamily: C.sans, fontSize: 12, width: '100%', minHeight: 80, resize: 'vertical',
            }}
            placeholder="Add notes about this lead..."
          />
        </div>

        {/* Call History */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 12 }}>Call History</div>
          {callHistory.length > 0 ? (
            <SortableTable
              columns={[
                { key: 'date', label: 'Date', render: (val) => val ? new Date(val).toLocaleDateString() : '—' },
                { key: 'duration', label: 'Duration (s)', mono: true },
                { key: 'campaign', label: 'Campaign' },
                { key: 'status', label: 'Status' },
                { key: 'type', label: 'Type' },
              ]}
              rows={callHistory}
            />
          ) : (
            <div style={{ color: C.muted, padding: 12, textAlign: 'center', fontSize: 11 }}>No call history</div>
          )}
        </div>

        {/* Policy Summary */}
        <div style={{ marginBottom: 0 }}>
          <button
            onClick={() => setShowPolicies(!showPolicies)}
            style={{
              background: 'transparent', border: 'none', color: C.accent, cursor: 'pointer',
              fontSize: 10, fontWeight: 700, textTransform: 'uppercase', padding: 0, marginBottom: 8,
            }}
          >
            {showPolicies ? '▼' : '▶'} Converted Policies ({lead.convertedPolicies?.length || 0})
          </button>
          {showPolicies && lead.convertedPolicies && lead.convertedPolicies.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {lead.convertedPolicies.map((pol, i) => (
                <div key={i} style={{
                  padding: 8, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, marginBottom: 4,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.text }}>Policy #{pol.policyNumber}</div>
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>
                    {pol.carrier} | {pol.product} | ${pol.premium}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
