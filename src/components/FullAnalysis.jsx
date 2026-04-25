'use client';
import { useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { parseSections } from '@/lib/parse-sections';

const C = {
  bg: '#080b10', surface: '#0f1520', card: '#131b28', border: '#1a2538',
  text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff',
  mono: "'SF Mono', 'Fira Code', monospace",
  sans: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
};

const headingStyle = {
  fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2,
  color: C.accent, fontFamily: C.sans,
  borderBottom: `1px solid ${C.border}`, paddingBottom: 6,
  marginTop: 28, marginBottom: 12,
};

const markdownComponents = {
  table: ({ node, ...props }) => (
    <div style={{ overflowX: 'auto', margin: '12px 0' }}>
      <table {...props} style={{
        borderCollapse: 'collapse', width: '100%', fontFamily: C.sans, fontSize: 12,
        border: `1px solid ${C.border}`,
      }} />
    </div>
  ),
  thead: ({ node, ...props }) => (
    <thead {...props} style={{ background: C.surface }} />
  ),
  th: ({ node, ...props }) => (
    <th {...props} style={{
      padding: '8px 10px', textAlign: 'left', color: C.muted,
      fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6,
      borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}`,
    }} />
  ),
  td: ({ node, ...props }) => (
    <td {...props} style={{
      padding: '7px 10px', color: C.text, fontFamily: C.mono, fontSize: 12,
      borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}`,
      verticalAlign: 'top',
    }} />
  ),
  h1: ({ node, ...props }) => <h3 {...props} style={{ fontSize: 16, fontWeight: 800, color: C.text, marginTop: 20, marginBottom: 8 }} />,
  h2: ({ node, ...props }) => <h4 {...props} style={{ fontSize: 14, fontWeight: 700, color: C.text, marginTop: 16, marginBottom: 6 }} />,
  h3: ({ node, ...props }) => <h5 {...props} style={{ fontSize: 13, fontWeight: 700, color: C.text, marginTop: 14, marginBottom: 6 }} />,
  h4: ({ node, ...props }) => <h6 {...props} style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 12, marginBottom: 4 }} />,
  p:  ({ node, ...props }) => <p  {...props} style={{ fontSize: 12, lineHeight: 1.55, color: C.text, margin: '6px 0' }} />,
  ul: ({ node, ...props }) => <ul {...props} style={{ fontSize: 12, lineHeight: 1.55, color: C.text, paddingLeft: 22, margin: '6px 0' }} />,
  ol: ({ node, ...props }) => <ol {...props} style={{ fontSize: 12, lineHeight: 1.55, color: C.text, paddingLeft: 22, margin: '6px 0' }} />,
  li: ({ node, ...props }) => <li {...props} style={{ margin: '3px 0' }} />,
  code: ({ node, inline, ...props }) => inline
    ? <code {...props} style={{ fontFamily: C.mono, fontSize: 11, background: C.surface, padding: '1px 4px', borderRadius: 3, color: C.accent }} />
    : <code {...props} style={{ fontFamily: C.mono, fontSize: 11, display: 'block', background: C.surface, padding: 10, borderRadius: 4, color: C.text, overflowX: 'auto' }} />,
  strong: ({ node, ...props }) => <strong {...props} style={{ color: C.text, fontWeight: 700 }} />,
  hr: () => <hr style={{ border: 'none', borderTop: `1px solid ${C.border}`, margin: '16px 0' }} />,
};

export default function FullAnalysis({ rawMarkdown, evidenceTables, meta }) {
  const containerRef = useRef(null);
  const sections = useMemo(() => parseSections(rawMarkdown || ''), [rawMarkdown]);

  if (!rawMarkdown && (!evidenceTables || evidenceTables.length === 0)) return null;

  // TOC chips scroll to the first rendered heading/bold-lead node matching the section title text.
  // We don't inject anchors into the markdown; we match by textContent after render.
  const scrollToSection = (title) => {
    if (!containerRef.current) return;
    const target = Array.from(containerRef.current.querySelectorAll('h3, h4, h5, h6, p strong'))
      .find(node => (node.textContent || '').trim() === title);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div style={{ marginTop: 8 }}>
      <div style={headingStyle}>Full Analysis</div>

      <div style={{ color: C.muted, fontSize: 11, fontFamily: C.mono, marginBottom: 10 }}>
        {sections.length} section{sections.length === 1 ? '' : 's'}
        {' · '}{(evidenceTables || []).length} evidence table{(evidenceTables || []).length === 1 ? '' : 's'}
      </div>

      {sections.length > 0 && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14,
          padding: '8px 10px', background: C.bg, borderRadius: 4,
          border: `1px solid ${C.border}`,
        }}>
          {sections.map(s => (
            <button key={s.id} onClick={() => scrollToSection(s.title)} style={{
              background: 'transparent', border: `1px solid ${C.border}`,
              color: C.muted, borderRadius: 3, padding: '3px 8px', fontSize: 10,
              cursor: 'pointer', fontFamily: C.sans, whiteSpace: 'nowrap',
            }}>{s.title}</button>
          ))}
        </div>
      )}

      <div ref={containerRef} style={{
        background: C.bg, padding: '14px 18px', borderRadius: 4,
        border: `1px solid ${C.border}`, fontFamily: C.sans,
      }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {rawMarkdown || ''}
        </ReactMarkdown>
      </div>
    </div>
  );
}
