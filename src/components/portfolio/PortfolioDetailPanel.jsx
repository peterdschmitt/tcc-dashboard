// src/components/portfolio/PortfolioDetailPanel.jsx
'use client';
import { useEffect, useState } from 'react';

const C = { bg: '#080b10', surface: '#0f1520', card: '#131b28', border: '#1a2538', text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff', green: '#4ade80', yellow: '#facc15', red: '#f87171' };

function statusColor(s) {
  if (!s) return C.muted;
  const x = s.toLowerCase();
  if (x.includes('active') || x.includes('in force') || x.includes('advance')) return C.green;
  if (x.includes('pending') || x.includes('submitted')) return C.yellow;
  if (x.includes('lapsed') || x.includes('canceled') || x.includes('declined')) return C.red;
  return C.muted;
}

export default function PortfolioDetailPanel({ contactId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!contactId) return;
    setLoading(true);
    fetch(`/api/portfolio/contact/${contactId}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [contactId]);

  if (!contactId) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, height: '100vh', width: 480, background: C.surface,
      borderLeft: `1px solid ${C.border}`, padding: 24, overflowY: 'auto', zIndex: 100, color: C.text,
      boxShadow: '-4px 0 24px rgba(0,0,0,0.5)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase' }}>Contact Detail</div>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 18 }}>✕</button>
      </div>
      {loading && <div style={{ color: C.muted }}>Loading...</div>}
      {data?.contact && (
        <>
          <h2 style={{ fontSize: 22, margin: '0 0 4px 0' }}>
            {(data.contact.firstName || '') + ' ' + (data.contact.lastName || '')}
          </h2>
          <div style={{ color: C.muted, fontSize: 13, marginBottom: 16 }}>
            {data.contact.phone} {data.contact.email ? '• ' + data.contact.email : ''}
          </div>
          <div style={{ color: C.muted, fontSize: 13, marginBottom: 24 }}>
            {[data.contact.address1, data.contact.city, data.contact.state, data.contact.postalCode].filter(Boolean).join(', ') || '(no address)'}
          </div>

          {/* Policies */}
          <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', marginBottom: 8 }}>
            Policies ({data.policies.length})
          </div>
          {data.policies.length === 0 && <div style={{ color: C.muted, fontSize: 13, marginBottom: 24 }}>No policies on file.</div>}
          {data.policies.map(p => (
            <div key={p.id} style={{ background: C.card, padding: 12, borderRadius: 6, marginBottom: 12, borderLeft: `3px solid ${statusColor(p.placedStatus)}` }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{p.policyNumber || '(no policy #)'}</div>
              <div style={{ color: C.muted, fontSize: 12 }}>{p.carrierProductRaw || `${p.carrierName} / ${p.productName}`}</div>
              <div style={{ marginTop: 4, fontSize: 12 }}>
                <span style={{ color: statusColor(p.placedStatus) }}>{p.placedStatus || 'no status'}</span>
                {p.monthlyPremium && <span style={{ marginLeft: 12, color: C.text }}>${Number(p.monthlyPremium).toFixed(2)}/mo</span>}
              </div>
              <div style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>
                Submitted: {p.applicationDate ? new Date(p.applicationDate).toLocaleDateString() : '—'}
                {' · '}Effective: {p.effectiveDate ? new Date(p.effectiveDate).toLocaleDateString() : '—'}
                {' · '}Agent: {p.agentName || p.salesAgentRaw || '—'}
              </div>
            </div>
          ))}

          {/* Calls */}
          <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', margin: '24px 0 8px 0' }}>
            Recent Calls ({data.calls.length})
          </div>
          {data.calls.slice(0, 20).map(ca => (
            <div key={ca.id} style={{ borderBottom: `1px solid ${C.border}`, padding: '8px 0', fontSize: 12 }}>
              <div style={{ color: C.text }}>
                {new Date(ca.callDate).toLocaleString()}
                {' • '}{ca.campaignCode || '—'}
                {' • '}{ca.callStatus || '—'}
                {ca.durationSeconds && ` • ${ca.durationSeconds}s`}
              </div>
              <div style={{ color: C.muted }}>
                Rep: {ca.repName || '—'}{ca.recordingUrl && ' • '}
                {ca.recordingUrl && <a href={ca.recordingUrl} target="_blank" rel="noreferrer" style={{ color: C.accent }}>Recording</a>}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
