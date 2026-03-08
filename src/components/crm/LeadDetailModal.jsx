'use client';
import { useState, useEffect } from 'react';
import { C, fmt, fmtDollar, STATUS_COLORS, LEAD_STATUSES } from '../shared/theme';

function InfoItem({ label, value, color }) {
  return (
    <div>
      <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 12, fontFamily: C.mono, color: color || C.text }}>{value || '—'}</div>
    </div>
  );
}

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

function formatDuration(seconds) {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function LeadDetailModal({ leadId, onClose }) {
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editStatus, setEditStatus] = useState(null);
  const [editNotes, setEditNotes] = useState(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [showPolicies, setShowPolicies] = useState(false);
  const [showApplicant, setShowApplicant] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/crm/lead/${leadId}`)
      .then(r => r.json())
      .then(data => {
        setLead(data);
        setEditStatus(data.status);
        setEditNotes(data.notes);
        setError(null);
      })
      .catch(err => setError(err.message))
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
        setLead(prev => ({ ...prev, ...updated }));
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
    maxWidth: 900, width: '100%', marginTop: 20, color: C.text,
  };

  const sectionHeaderStyle = {
    fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 12,
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

  const fullName = lead.firstName && lead.lastName ? `${lead.firstName} ${lead.lastName}` : (lead.name || '—');
  const calls = lead.recentCalls || [];
  const applicant = lead.applicant;
  const policy = lead.policy;

  // Call history columns — enriched with new fields
  const callColumns = [
    { key: 'date', label: 'Date', align: 'left', render: (val) => val ? new Date(val).toLocaleDateString() : '—' },
    { key: 'rep', label: 'Agent', align: 'left' },
    { key: 'campaign', label: 'Campaign', align: 'left' },
    { key: 'callStatus', label: 'Status', align: 'left', render: (val) => (
      <span style={{ color: val === 'SALE' ? C.green : val === 'DNC' ? C.red : C.text }}>{val || '—'}</span>
    )},
    { key: 'callType', label: 'Type', align: 'left' },
    { key: 'duration', label: 'Duration', mono: true, render: (val) => formatDuration(val) },
    { key: 'holdTime', label: 'Hold', mono: true, render: (val) => val ? `${val}s` : '—' },
    { key: 'hangupSource', label: 'Hangup', align: 'left', render: (val) => (
      <span style={{ color: val === 'Agent' ? C.yellow : val === 'Customer' ? C.muted : C.text }}>{val || '—'}</span>
    )},
    { key: 'inboundSource', label: 'Inbound Src', align: 'left' },
    { key: 'recording', label: '', align: 'center', render: (val) => val ? (
      <a href={val} target="_blank" rel="noopener noreferrer" style={{ color: C.accent, fontSize: 10, textDecoration: 'none' }}>▶ Play</a>
    ) : '—' },
  ];

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
              {lead.doNotCall && (
                <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: C.redDim, color: C.red }}>DNC</span>
              )}
              {lead.tags && (
                <span style={{ fontSize: 10, color: C.purple }}>{lead.tags}</span>
              )}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 24, padding: 0, lineHeight: 1, width: 24, height: 24 }}>×</button>
        </div>

        {/* Info Grid */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 20,
          background: C.bg, padding: 12, borderRadius: 6, border: `1px solid ${C.border}`,
        }}>
          <InfoItem label="Lead Source" value={lead.source} />
          <InfoItem label="Primary Agent" value={lead.agent} />
          <InfoItem label="Attempts" value={lead.attempts || 0} />
          <InfoItem label="First Contact" value={lead.createdAt ? new Date(lead.createdAt).toLocaleDateString() : null} />
          <InfoItem label="Last Contact" value={lead.lastContact ? new Date(lead.lastContact).toLocaleDateString() : null} />
          <InfoItem label="Follow-Up Due" value={lead.followUpDue ? new Date(lead.followUpDue).toLocaleDateString() : null}
            color={lead.followUpDue && new Date(lead.followUpDue) < new Date() ? C.red : C.text} />
        </div>

        {/* Applicant Details — collapsible */}
        {applicant && (applicant.email || applicant.address || applicant.dob) && (
          <div style={{ marginBottom: 20 }}>
            <button onClick={() => setShowApplicant(!showApplicant)}
              style={{ background: 'transparent', border: 'none', color: C.accent, cursor: 'pointer', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', padding: 0, marginBottom: 8 }}>
              {showApplicant ? '▼' : '▶'} Applicant Details
            </button>
            {showApplicant && (
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 8,
                background: C.bg, padding: 12, borderRadius: 6, border: `1px solid ${C.border}`,
              }}>
                <InfoItem label="Full Name" value={[applicant.firstName, applicant.lastName].filter(Boolean).join(' ')} />
                <InfoItem label="Gender" value={applicant.gender} />
                <InfoItem label="Date of Birth" value={applicant.dob} />
                <InfoItem label="Email" value={applicant.email} />
                <InfoItem label="Phone" value={applicant.phone} />
                <InfoItem label="Text Friendly" value={applicant.textFriendly} color={applicant.textFriendly === 'Yes' ? C.green : C.muted} />
                <InfoItem label="Address" value={applicant.address} />
                <InfoItem label="City / State" value={[applicant.city, applicant.state].filter(Boolean).join(', ')} />
                <InfoItem label="Zip" value={applicant.zip} />
                <InfoItem label="SSN Billing Match" value={applicant.ssnMatch} color={applicant.ssnMatch === 'Yes' ? C.green : applicant.ssnMatch === 'No' ? C.red : C.muted} />
              </div>
            )}
          </div>
        )}

        {/* Status Controls */}
        <div style={{ marginBottom: 20 }}>
          <div style={sectionHeaderStyle}>Status</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}
              style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', color: C.text, fontFamily: C.sans, fontSize: 12, flex: 1 }}>
              {LEAD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={handleSaveStatus} disabled={saveLoading}
              style={{ background: C.accent, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: saveLoading ? 0.6 : 1 }}>
              {saveLoading ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 20 }}>
          <div style={sectionHeaderStyle}>Notes</div>
          <textarea value={editNotes || ''} onChange={(e) => setEditNotes(e.target.value)}
            style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', color: C.text, fontFamily: C.sans, fontSize: 12, width: '100%', minHeight: 80, resize: 'vertical', boxSizing: 'border-box' }}
            placeholder="Add notes about this lead..." />
        </div>

        {/* Call History — enriched */}
        <div style={{ marginBottom: 20 }}>
          <div style={sectionHeaderStyle}>Call History ({calls.length})</div>
          {calls.length > 0 ? (
            <SortableTable columns={callColumns} rows={calls} />
          ) : (
            <div style={{ color: C.muted, padding: 12, textAlign: 'center', fontSize: 11 }}>No call history</div>
          )}
        </div>

        {/* Converted Policies */}
        <div style={{ marginBottom: 0 }}>
          <button onClick={() => setShowPolicies(!showPolicies)}
            style={{ background: 'transparent', border: 'none', color: C.accent, cursor: 'pointer', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', padding: 0, marginBottom: 8 }}>
            {showPolicies ? '▼' : '▶'} Converted Policies ({lead.convertedPolicies?.length || 0})
          </button>
          {showPolicies && lead.convertedPolicies && lead.convertedPolicies.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {lead.convertedPolicies.map((pol, i) => (
                <div key={i} style={{ padding: 12, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, marginBottom: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Policy #{pol.policyNumber}</div>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                      background: pol.status === 'Active - In Force' ? C.greenDim : pol.status === 'Declined' ? C.redDim : C.yellowDim,
                      color: pol.status === 'Active - In Force' ? C.green : pol.status === 'Declined' ? C.red : C.yellow,
                    }}>{pol.status}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    <InfoItem label="Carrier" value={pol.carrier} />
                    <InfoItem label="Product" value={pol.product} />
                    <InfoItem label="Monthly Premium" value={fmtDollar(pol.premium)} />
                    <InfoItem label="Face Amount" value={fmtDollar(pol.faceAmount)} />
                    <InfoItem label="Term Length" value={pol.termLength} />
                    <InfoItem label="Effective Date" value={pol.effectiveDate ? new Date(pol.effectiveDate).toLocaleDateString() : null} />
                    <InfoItem label="Payment" value={[pol.paymentType, pol.paymentFrequency].filter(Boolean).join(' / ')} />
                    <InfoItem label="Submitted" value={pol.submissionDate ? new Date(pol.submissionDate).toLocaleDateString() : null} />
                    <InfoItem label="Agent" value={pol.agent} />
                  </div>
                  {pol.salesNotes && (
                    <div style={{ marginTop: 8, padding: 8, background: C.card, borderRadius: 4, fontSize: 11, color: C.muted }}>{pol.salesNotes}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
