'use client';

import { useState } from 'react';

const C = {
  bg: '#080b10', surface: '#0f1520', card: '#131b28', border: '#1a2538',
  text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff',
  mono: "'SF Mono', 'Fira Code', monospace",
  sans: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
};

export function renderDeepDiveMarkdown(text) {
  if (!text) return null;
  const lines = text.split('\n');
  const out = [];
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push(<div key={`sp-${i}`} style={{ height: 8 }} />);
      return;
    }
    const hMatch = trimmed.match(/^(#{1,6})\s+(.+)/);
    if (hMatch) {
      out.push(
        <div key={i} style={{ fontSize: 12, fontWeight: 700, color: C.text, marginTop: 8, marginBottom: 4 }}>
          {hMatch[2].replace(/\*\*/g, '')}
        </div>
      );
      return;
    }
    const isBullet = /^[-•]\s+/.test(trimmed);
    const body = isBullet ? trimmed.replace(/^[-•]\s+/, '') : trimmed;
    const segments = body.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
    const rendered = segments.map((seg, j) => {
      if (seg.startsWith('**') && seg.endsWith('**')) {
        return <strong key={j} style={{ color: C.accent, fontWeight: 700 }}>{seg.slice(2, -2)}</strong>;
      }
      return <span key={j}>{seg}</span>;
    });
    out.push(
      <div key={i} style={{ marginBottom: 4, paddingLeft: isBullet ? 14 : 0, textIndent: isBullet ? -10 : 0, fontSize: 12, lineHeight: 1.6, color: C.text }}>
        {isBullet ? '• ' : ''}{rendered}
      </div>
    );
  });
  return out;
}

export default function DeepDiveCard({ entity, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const previewText = (entity.content || '').replace(/[#*`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 180);
  return (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, marginBottom: 8, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', padding: '10px 14px', background: 'none', border: 'none',
          color: C.text, cursor: 'pointer', textAlign: 'left', fontFamily: C.sans,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.accent }}>{entity.name || 'Unknown Agent'}</span>
          {!open && previewText && (
            <span style={{ fontSize: 11, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {previewText}…
            </span>
          )}
        </div>
        <span style={{ color: C.muted, fontSize: 12, marginLeft: 10, flexShrink: 0 }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div style={{ padding: '4px 14px 14px 14px', borderTop: `1px solid ${C.border}` }}>
          {renderDeepDiveMarkdown(entity.content)}
        </div>
      )}
    </div>
  );
}
