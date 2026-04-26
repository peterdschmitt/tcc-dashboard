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

function fmtDate(v, withTime = false) {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '—';
  return withTime ? d.toLocaleString() : d.toLocaleDateString();
}

function Field({ label, value, span }) {
  return (
    <div style={{ gridColumn: span === 'full' ? '1 / -1' : 'auto' }}>
      <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ color: C.text, fontSize: 13, fontFamily: 'monospace', wordBreak: 'break-word' }}>
        {value == null || value === '' ? '—' : value}
      </div>
    </div>
  );
}

function TagChips({ tags }) {
  if (!tags || tags.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {tags.map((t, i) => (
        <span key={i} style={{ background: C.card, color: C.muted, padding: '2px 8px', borderRadius: 10, fontSize: 11, fontFamily: 'monospace' }}>
          {t}
        </span>
      ))}
    </div>
  );
}

const MIN_WIDTH = 360;
const MAX_WIDTH = 900;
const DEFAULT_WIDTH = 480;

function clampWidth(n) {
  if (typeof n !== 'number' || isNaN(n)) return DEFAULT_WIDTH;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n));
}

export default function PortfolioDetailPanel({ contactId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [hoverHandle, setHoverHandle] = useState(false);

  useEffect(() => {
    if (!contactId) return;
    setLoading(true);
    fetch(`/api/portfolio/contact/${contactId}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [contactId]);

  function startDrag(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const onMove = (ev) => {
      // Panel is right-anchored; dragging LEFT (smaller clientX) grows width.
      const next = clampWidth(startWidth - (ev.clientX - startX));
      setWidth(next);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  if (!contactId) return null;

  const c = data?.contact;

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, height: '100vh', width, background: C.surface,
      borderLeft: `1px solid ${C.border}`, padding: 24, overflowY: 'auto', zIndex: 100, color: C.text,
      boxShadow: '-4px 0 24px rgba(0,0,0,0.5)',
    }}>
      {/* Resize handle */}
      <div
        onMouseDown={startDrag}
        onMouseEnter={() => setHoverHandle(true)}
        onMouseLeave={() => setHoverHandle(false)}
        style={{
          position: 'absolute', top: 0, left: 0, width: 4, height: '100%',
          cursor: 'ew-resize',
          background: hoverHandle ? C.accent : 'transparent',
          transition: 'background 120ms ease',
        }}
        title="Drag to resize"
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase' }}>Contact Detail</div>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 18 }}>✕</button>
      </div>
      {loading && <div style={{ color: C.muted }}>Loading...</div>}
      {c && (
        <>
          <h2 style={{ fontSize: 22, margin: '0 0 16px 0' }}>
            {(c.firstName || '') + ' ' + (c.lastName || '')}
          </h2>

          {/* Section 1: Contact Details */}
          <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', marginBottom: 8, letterSpacing: 0.3 }}>
            Contact Details
          </div>
          <div style={{ background: C.card, padding: 16, borderRadius: 6, marginBottom: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px' }}>
            <Field label="Phone" value={c.phone} />
            <Field label="Email" value={c.email} />
            <Field label="Date of Birth" value={fmtDate(c.dateOfBirth)} />
            <Field label="Gender" value={c.gender} />
            <Field label="Address" value={c.address1} />
            <Field label="City" value={c.city} />
            <Field label="State" value={c.state} />
            <Field label="Zip" value={c.postalCode} />
            <Field label="Country" value={c.country} />
            <Field label="First Seen" value={fmtDate(c.firstSeenAt, true)} />
            <Field label="Source" value={c.source} />
            <Field label="Total Calls" value={c.totalCalls} />
            {c.tags && c.tags.length > 0 && (
              <Field label="Tags" value={<TagChips tags={c.tags} />} span="full" />
            )}
          </div>

          {/* Section 2: Policies */}
          <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', marginBottom: 8, letterSpacing: 0.3 }}>
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

          {/* Section 3: Recent Calls */}
          <div style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', margin: '24px 0 8px 0', letterSpacing: 0.3 }}>
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
