'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useVoiceMode } from '@/hooks/useVoiceMode';

const isPlacedPolicy = p => ['Advance Released', 'Active - In Force', 'Submitted - Pending'].includes(p.placed);

function getTargetDateRange(text) {
  const today = new Date();
  const fmt = d => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const lower = text.toLowerCase();
  if (lower.includes('yesterday')) { const y = new Date(); y.setDate(y.getDate() - 1); return { start: fmt(y), end: fmt(y) }; }
  if (lower.includes('today')) return { start: fmt(today), end: fmt(today) };
  if (/last\s*(7|seven)/.test(lower)) { const s = new Date(); s.setDate(s.getDate() - 6); return { start: fmt(s), end: fmt(today) }; }
  if (/last\s*(30|thirty)/.test(lower)) { const s = new Date(); s.setDate(s.getDate() - 29); return { start: fmt(s), end: fmt(today) }; }
  if (lower.includes('this month') || lower.includes('mtd')) return { start: fmt(new Date(today.getFullYear(), today.getMonth(), 1)), end: fmt(today) };
  if (lower.includes('this week') || lower.includes('wtd')) { const day = today.getDay(); const s = new Date(today); s.setDate(today.getDate() - (day === 0 ? 6 : day - 1)); return { start: fmt(s), end: fmt(today) }; }
  return { start: fmt(today), end: fmt(today) };
}

function buildLiveDataContext(policies, calls, pnl, dateRange) {
  if (!policies?.length && !calls?.length) return '';
  const placed = (policies || []).filter(isPlacedPolicy);
  const totalPremium = (policies || []).reduce((s, p) => s + (p.premium || 0), 0);
  const totalLeadSpend = (pnl || []).reduce((s, p) => s + (p.leadSpend || 0), 0);
  const totalGAR = (policies || []).reduce((s, p) => s + (p.grossAdvancedRevenue || 0), 0);
  const totalComm = (policies || []).reduce((s, p) => s + (p.commission || 0), 0);
  const billable = (calls || []).filter(c => c.isBillable).length;
  const totalCalls = (calls || []).length;
  const apps = (policies || []).length;
  const cpa = apps > 0 ? totalLeadSpend / apps : 0;
  const closeRate = billable > 0 ? apps / billable * 100 : 0;
  const placementRate = apps > 0 ? placed.length / apps * 100 : 0;
  const avgPremium = apps > 0 ? totalPremium / apps : 0;
  const billableRate = totalCalls > 0 ? billable / totalCalls * 100 : 0;
  const rpc = totalCalls > 0 ? totalLeadSpend / totalCalls : 0;
  const netRevenue = totalGAR - totalLeadSpend - totalComm;
  const premCost = totalLeadSpend > 0 ? totalPremium / totalLeadSpend : 0;
  const agentMap = {};
  (policies || []).forEach(p => {
    if (!agentMap[p.agent]) agentMap[p.agent] = { apps: 0, placed: 0, premium: 0 };
    agentMap[p.agent].apps++;
    if (isPlacedPolicy(p)) { agentMap[p.agent].placed++; agentMap[p.agent].premium += p.premium || 0; }
  });
  const agentSummary = Object.entries(agentMap).map(([name, a]) => `${name}: ${a.apps} apps, ${a.placed} placed, $${a.premium.toFixed(0)} premium`).join('\n  ');
  const pubSummary = (pnl || []).map(p => {
    const pubRpc = p.totalCalls > 0 ? (p.leadSpend / p.totalCalls) : 0;
    const pubBillRate = p.totalCalls > 0 ? (p.billableCalls / p.totalCalls * 100) : 0;
    return `${p.campaign} (${p.vendor || ''}): ${p.totalCalls} calls, ${p.billableCalls} billable (${pubBillRate.toFixed(1)}%), $${p.leadSpend.toFixed(2)} spend, RPC $${pubRpc.toFixed(2)}, ${p.placedCount} placed`;
  }).join('\n  ');
  return `\nLIVE DASHBOARD DATA (${dateRange?.start || ''} to ${dateRange?.end || ''}):\nThese are the exact numbers currently displayed. USE THESE NUMBERS, not report data.\n\nSUMMARY: Apps: ${apps}, Placed: ${placed.length}, Calls: ${totalCalls}, Billable: ${billable} (${billableRate.toFixed(1)}%), Premium: $${totalPremium.toFixed(2)}, GAR: $${totalGAR.toFixed(0)}, Lead Spend: $${totalLeadSpend.toFixed(0)}, Commission: $${totalComm.toFixed(0)}, Net Revenue: $${netRevenue.toFixed(0)}, CPA: $${cpa.toFixed(2)}, RPC: $${rpc.toFixed(2)}, Close Rate: ${closeRate.toFixed(1)}%, Placement Rate: ${placementRate.toFixed(1)}%, Premium:Cost: ${premCost.toFixed(2)}x, Avg Premium: $${avgPremium.toFixed(2)}\n\nAGENTS:\n  ${agentSummary || 'No agent data'}\n\nPUBLISHERS:\n  ${pubSummary || 'No publisher data'}`;
}

const C = {
  bg: '#080b10',
  surface: '#0f1520',
  card: '#131b28',
  border: '#1a2538',
  text: '#f0f3f9',
  muted: '#8fa3be',
  accent: '#5b9fff',
  green: '#4ade80',
  red: '#f87171',
  yellow: '#facc15',
  purple: '#a855f7',
  mono: "'SF Mono', 'Fira Code', monospace",
  sans: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
};

const CATEGORIES = [
  { id: 'funnel_analyzer', label: 'Funnel Analyzer' },
  { id: 'lead_quality', label: 'Lead Quality' },
  { id: 'volume_capacity', label: 'Volume & Capacity' },
  { id: 'sales_execution', label: 'Sales Execution' },
  { id: 'profitability', label: 'Profitability' },
  { id: 'funnel_health', label: 'Funnel Health' },
];

const MIN_TOP_HEIGHT = 120;
const MIN_BOTTOM_HEIGHT = 100;
const DEFAULT_SPLIT = 0.6; // 60% top, 40% bottom

// --- Markdown-ish text formatter ---
function formatInsightText(text) {
  if (!text) return null;
  const lines = text.split('\n');
  return lines.map((line, i) => {
    let content = line;
    const parts = [];
    const boldRegex = /\*\*(.*?)\*\*/g;
    let lastIndex = 0;
    let match;
    while ((match = boldRegex.exec(content)) !== null) {
      if (match.index > lastIndex) parts.push(content.slice(lastIndex, match.index));
      parts.push(<strong key={`b-${i}-${match.index}`} style={{ color: C.accent, fontWeight: 700 }}>{match[1]}</strong>);
      lastIndex = boldRegex.lastIndex;
    }
    if (lastIndex < content.length) parts.push(content.slice(lastIndex));
    const isBullet = line.trimStart().startsWith('- ') || line.trimStart().startsWith('* ');
    const bulletIndent = isBullet ? { paddingLeft: 16, textIndent: -10 } : {};
    return <div key={i} style={{ marginBottom: 4, ...bulletIndent }}>{parts.length > 0 ? parts : content}</div>;
  });
}

function TypingIndicator() {
  return (
    <div style={{ display: 'flex', gap: 4, padding: '10px 14px', alignItems: 'center' }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: C.muted, animation: 'typingDot 1.4s infinite', animationDelay: `${i * 0.2}s` }} />
      ))}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {[100, 85, 92, 70, 88, 95, 60].map((w, i) => (
        <div key={i} style={{ height: 12, width: `${w}%`, borderRadius: 4, background: `linear-gradient(90deg, ${C.border} 25%, ${C.card} 50%, ${C.border} 75%)`, backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite' }} />
      ))}
    </div>
  );
}

// --- Parse sections from report content ---
function parseSections(content) {
  if (!content) return [];
  const lines = content.split('\n');
  const sections = [];
  let charIdx = 0;

  lines.forEach((line, lineIdx) => {
    const trimmed = line.trim();
    // Markdown headers: # ## ###
    const headerMatch = trimmed.match(/^(#{1,3})\s+(.+)/);
    // Bold section: **Title**
    const boldMatch = trimmed.match(/^\*\*(.+?)\*\*\s*$/);
    // Numbered section: 1. Title or 1) Title
    const numberedMatch = trimmed.match(/^\d+[.)]\s+(.+)/);
    // ALL CAPS short line (likely a section header)
    const allCaps = trimmed.length > 3 && trimmed.length < 80 && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed);

    let title = null;
    if (headerMatch) title = headerMatch[2].replace(/\*\*/g, '').trim();
    else if (boldMatch) title = boldMatch[1].trim();
    else if (numberedMatch && numberedMatch[1].length < 60) title = numberedMatch[1].trim();
    else if (allCaps) title = trimmed;

    if (title && title.length > 2) {
      sections.push({
        id: `section-${sections.length}`,
        title,
        lineIndex: lineIdx,
        charIndex: charIdx,
      });
    }
    charIdx += line.length + 1;
  });

  return sections;
}

// =====================================================================
// REPORT CONTENT RENDERING
// =====================================================================

// --- Strip email headers, Gmail noise, preamble before executive content ---
function cleanContent(raw) {
  if (!raw) return '';
  let lines = raw.split('\n');

  // Skip everything before the first real analytical content.
  const bodyMarkers = [
    /executive\s+read/i, /company[\s-]*(wide|level|overall)/i,
    /profitability/i, /campaign\s+performance/i, /agent\s+performance/i,
    /funnel/i, /volume/i, /lead\s+quality/i, /sales\s+execution/i,
    /scope\s*\/?\s*row/i, /^analyzed\s+\d{4}/i,
  ];
  let contentStart = 0;
  for (let i = 0; i < Math.min(lines.length, 80); i++) {
    const t = lines[i].trim();
    if (bodyMarkers.some(rx => rx.test(t))) { contentStart = i; break; }
  }
  lines = lines.slice(contentStart);

  // Remove noise lines (email headers, Gmail artifacts, report metadata)
  return lines.filter(line => {
    const t = line.trim();
    if (!t) return true;
    if (t.startsWith('https://mail.google.com')) return false;
    if (/^\d+\/\d+$/.test(t)) return false;
    if (/^\d+\/\d+\/\d+,\s+\d+:\d+\s+(AM|PM)\s+Gmail/.test(t)) return false;
    if (/Gmail\s*-\s*Fw:/i.test(t)) return false;
    if (/^Fw:\s/i.test(t)) return false;
    if (/^From:\s/i.test(t)) return false;
    if (/^To:\s/i.test(t)) return false;
    if (/^Sent:\s/i.test(t)) return false;
    if (/^Subject:\s/i.test(t)) return false;
    if (/^Date:\s.*\d{4}/i.test(t)) return false;
    if (t.includes('simpl=msg')) return false;
    if (t.includes('@converselyai.com') || t.includes('@gmail.com')) return false;
    if (/^\d+\s+messages?$/i.test(t)) return false;
    if (/^CONVERSELY\.AI$/i.test(t)) return false;
    if (/^Scheduled Report$/i.test(t)) return false;
    if (/^TrueChoice\s*-/i.test(t)) return false;
    if (/^Period:\s/i.test(t)) return false;
    if (/^Run time:/i.test(t)) return false;
    if (/^Generated:/i.test(t)) return false;
    if (/^Peter\s+Schmitt\s*</i.test(t)) return false;
    if (/^"?peter\.d\.schmitt/i.test(t)) return false;
    return true;
  }).join('\n');
}

// --- Inline text formatter — highlights metrics, bold, arrows ---
function Fmt({ text, lineKey }) {
  if (!text) return null;
  const parts = [];
  const regex = /\*\*(.*?)\*\*|(\b\d+\.?\d*%)|(\$[\d,.]+)|(\b\d{2,}\.?\d*s\b)|(≈\s*[\d,.]+)|(→[^.;]*[.;]?)|(N\/A)/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(<span key={`${lineKey}-${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>);
    if (match[1]) parts.push(<strong key={`${lineKey}-b${match.index}`} style={{ color: C.text, fontWeight: 700 }}>{match[1]}</strong>);
    else if (match[2]) { const v = parseFloat(match[2]); const clr = v >= 70 ? C.green : v >= 40 ? C.yellow : C.red; parts.push(<span key={`${lineKey}-p${match.index}`} style={{ color: clr, fontWeight: 700, fontFamily: C.mono }}>{match[2]}</span>); }
    else if (match[3]) parts.push(<span key={`${lineKey}-d${match.index}`} style={{ color: C.green, fontWeight: 700, fontFamily: C.mono }}>{match[3]}</span>);
    else if (match[4]) parts.push(<span key={`${lineKey}-s${match.index}`} style={{ color: C.accent, fontFamily: C.mono }}>{match[4]}</span>);
    else if (match[5]) parts.push(<span key={`${lineKey}-a${match.index}`} style={{ color: C.accent, fontFamily: C.mono }}>{match[5]}</span>);
    else if (match[6]) parts.push(<span key={`${lineKey}-ar${match.index}`} style={{ color: C.yellow, fontStyle: 'italic' }}>{match[6]}</span>);
    else if (match[7]) parts.push(<span key={`${lineKey}-na${match.index}`} style={{ color: C.muted, fontStyle: 'italic' }}>{match[7]}</span>);
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) parts.push(<span key={`${lineKey}-e`}>{text.slice(lastIndex)}</span>);
  return <>{parts.length > 0 ? parts : text}</>;
}

// --- Classify a line's role for rendering ---
function classifyLine(trimmed, prevType) {
  if (!trimmed) return 'blank';

  // H1: Major sections — longer descriptive titles, often with parens qualifier
  // e.g. "Campaign performance (4 rows: Lead Performance by Campaign)"
  // e.g. "Executive read on Volume & Capacity (Are we getting enough...)"
  // e.g. "Agent performance (4 rows: Lead Performance by Agent)"
  // e.g. "Driver view: where CPA is moving (uses all 12 campaign×agent rows)"
  // e.g. "Profitability & efficiency (2026-04-09)"
  // e.g. "Scope / row accounting (all 21 rows)"
  // e.g. "Goals vs signals"
  const isH1 = (
    /^(executive\s+read|scope\s*\/|goals\s+vs|profitability|campaign\s+performance|agent\s+performance|driver\s+view|company[\s-]*(wide|level)|bright\s+spots|biggest\s+cpa|funnel|lead\s+quality|sales\s+execution|mix\s+and\s+product|volume)/i.test(trimmed)
    || (/\(\d+\s+rows?:/i.test(trimmed) && trimmed.length > 20)
  );
  if (isH1) return 'h1';

  // H2: Numbered sub-items or named entities with call counts
  // e.g. "1) INU Virtual Agent (27 calls)"
  // e.g. "Michael P (32 calls)"
  // e.g. "Kari M (20 calls)"
  // e.g. "Bright spots to scale"
  // e.g. "Biggest CPA improvement opportunities"
  if (/^\d+\)\s+/.test(trimmed)) return 'h2';
  if (/^[A-Z][a-zA-Z\s]+\(\d+\s+calls?\)/i.test(trimmed) && trimmed.length < 60) return 'h2';
  if (/^(bright\s+spots|biggest|key\s+capacity|overall\s+reached|overall\s+billable|overall\s+ivr)/i.test(trimmed) && trimmed.length < 80) return 'h2';

  // Callout: Takeaway, Action, Interpretation, Watchout, Risk, etc.
  if (/^(takeaway|action|interpretation|watchout|what\s+this\s+suggests|key\s+cap|driver\s+of|likely\s+cause|note|risk|opportunity|⚠)/i.test(trimmed)) return 'callout';

  // Bullet
  if (/^[-•]\s+/.test(trimmed)) return 'bullet';

  // Metric line — contains a colon with a number/percentage right after
  if (/:\s*[\d$≈]/.test(trimmed) && trimmed.length < 120 && !/^(from|to|sent|subject|date)/i.test(trimmed)) return 'metric';

  return 'paragraph';
}

function buildReportContent(content) {
  if (!content) return { elements: [], tocEntries: [] };

  const cleaned = cleanContent(content);
  const lines = cleaned.split('\n');

  const elements = [];
  const tocEntries = [];
  let prevType = '';
  let sectionIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const type = classifyLine(trimmed, prevType);

    if (type === 'blank') {
      if (prevType !== 'blank') elements.push(<div key={i} style={{ height: 16 }} />);
      prevType = type;
      continue;
    }
    prevType = type;

    // --- H1: Large bold section header with bottom border ---
    if (type === 'h1') {
      const id = `sec-${sectionIdx++}`;
      const title = trimmed.replace(/\*\*/g, '');
      tocEntries.push({ id, title });
      elements.push(
        <h2 key={i} id={id} style={{
          fontSize: 22, fontWeight: 700, color: C.text, fontFamily: C.sans,
          marginTop: i === 0 ? 0 : 40, marginBottom: 16, paddingBottom: 10,
          borderBottom: `1px solid ${C.border}`,
          letterSpacing: -0.3, lineHeight: 1.3,
        }}>
          {title}
        </h2>
      );
      continue;
    }

    // --- H2: Bold sub-heading, numbered or plain ---
    if (type === 'h2') {
      const numMatch = trimmed.match(/^(\d+)\)\s+(.+)/);
      const display = numMatch ? `${numMatch[1]}) ${numMatch[2]}` : trimmed;
      elements.push(
        <h3 key={i} style={{
          fontSize: 18, fontWeight: 700, color: C.text, fontFamily: C.sans,
          marginTop: 28, marginBottom: 12, lineHeight: 1.35,
        }}>
          {display}
        </h3>
      );
      continue;
    }

    // --- Callout: Bold label with body text ---
    if (type === 'callout') {
      let calloutText = trimmed;
      while (i + 1 < lines.length) {
        const nextTrimmed = lines[i + 1].trim();
        const nextType = classifyLine(nextTrimmed, type);
        if (nextTrimmed && nextType === 'paragraph' && nextTrimmed.length < 120) {
          calloutText += ' ' + nextTrimmed;
          i++;
        } else break;
      }

      const labelMatch = calloutText.match(/^(Takeaway|Action|Interpretation|Watchout|What this suggests|Key\s+[^:]+|Driver of\s+[^:]+|Likely cause|Note|Risk|Opportunity|⚠)\s*:\s*(.*)/i);
      elements.push(
        <p key={i} style={{
          fontSize: 15, lineHeight: 1.7, margin: '16px 0', color: C.text,
        }}>
          {labelMatch ? (
            <>
              <strong style={{ fontWeight: 700, textDecoration: 'underline' }}>{labelMatch[1]}:</strong>{' '}
              <Fmt text={labelMatch[2]} lineKey={i} />
            </>
          ) : (
            <Fmt text={calloutText} lineKey={i} />
          )}
        </p>
      );
      continue;
    }

    // --- Bullet: dash-prefixed list item ---
    if (type === 'bullet') {
      const bulletText = trimmed.replace(/^[-•]\s+/, '');
      const colonSplit = bulletText.match(/^(.+?):\s+(.+)/);
      elements.push(
        <div key={i} style={{
          display: 'flex', gap: 6, paddingLeft: 4, marginBottom: 4,
          fontSize: 15, lineHeight: 1.7, color: C.text,
        }}>
          <span style={{ flexShrink: 0 }}>-</span>
          <span>
            {colonSplit ? (
              <>
                <strong style={{ fontWeight: 700 }}>{colonSplit[1]}:</strong>{' '}
                <Fmt text={colonSplit[2]} lineKey={i} />
              </>
            ) : (
              <Fmt text={bulletText} lineKey={i} />
            )}
          </span>
        </div>
      );
      continue;
    }

    // --- Metric line (key: value) — render as bold inline ---
    if (type === 'metric') {
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        const label = trimmed.slice(0, colonIdx).trim();
        const value = trimmed.slice(colonIdx + 1).trim();
        elements.push(
          <p key={i} style={{
            fontSize: 15, lineHeight: 1.7, margin: '4px 0', color: C.text,
          }}>
            <strong style={{ fontWeight: 700 }}>{label}:</strong>{' '}
            <Fmt text={value} lineKey={i} />
          </p>
        );
        continue;
      }
    }

    // --- Regular paragraph ---
    elements.push(
      <p key={i} style={{
        fontSize: 15, lineHeight: 1.7, margin: '4px 0', color: C.text,
      }}>
        <Fmt text={trimmed} lineKey={i} />
      </p>
    );
  }

  return { elements, tocEntries };
}


export default function AiAnalystPane({ activeTab, activeEntity, setActiveTab, applyPreset, setCustomRange, dataSource, setDataSource, dateRange, setVoiceDrillTarget, policies: dashPolicies, calls: dashCalls, pnl: dashPnl, goals: dashGoals, onOpenChange }) {
  const liveDataContext = useMemo(() => buildLiveDataContext(dashPolicies, dashCalls, dashPnl, dateRange), [dashPolicies, dashCalls, dashPnl, dateRange]);
  const [open, setOpen] = useState(false);
  const [paneHeight, setPaneHeight] = useState(0);
  const [splitRatio, setSplitRatio] = useState(DEFAULT_SPLIT);

  // Data state
  const [reports, setReports] = useState([]);
  const [availableDates, setAvailableDates] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [reportContent, setReportContent] = useState(null);
  const [reportSections, setReportSections] = useState([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);

  // Chat state
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);

  // Drag state
  const [isDraggingPane, setIsDraggingPane] = useState(false);
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);

  const chatEndRef = useRef(null);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);
  const paneRef = useRef(null);
  const topPanelRef = useRef(null);
  const contentScrollRef = useRef(null);
  const dragStartRef = useRef({ y: 0, height: 0 });

  // Voice navigation handler
  const handleNavigation = useCallback((nav) => {
    console.log('[VoiceNav] Executing navigation:', nav);
    if (nav.tab && setActiveTab) { console.log('[VoiceNav] Switching tab to:', nav.tab); setActiveTab(nav.tab); }
    if (nav.datePreset && applyPreset) { console.log('[VoiceNav] Applying preset:', nav.datePreset); applyPreset(nav.datePreset); }
    if (nav.dataSource && setDataSource) { console.log('[VoiceNav] Switching data source:', nav.dataSource); setDataSource(nav.dataSource); }
    if (nav.drillDown && setVoiceDrillTarget) { console.log('[VoiceNav] Drilling down:', nav.drillDown); setVoiceDrillTarget(nav.drillDown); }
  }, [setActiveTab, applyPreset, setDataSource, setVoiceDrillTarget]);

  // Voice mode hook
  const {
    voiceModeActive, voiceState, transcript: voiceTranscript, lastResponseText,
    toggleVoiceMode, interruptSpeaking, error: voiceError, clearError: clearVoiceError,
  } = useVoiceMode({
    onSend: async (text) => {
      // AI pane is open — use reports as the data source, not live tile data
      const res = await fetch('/api/ai-analyst', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: text,
          tab: activeTab || 'daily',
          entity: activeEntity,
          reportContent: reportContent || undefined,
          voiceMode: true,
          liveData: null,
        }),
      });
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      return await res.json();
    },
    onResponse: (response) => {
      // Cancel any browser TTS before adding messages (prevents dual voice)
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      setMessages(prev => [...prev,
        { role: 'user', content: response.userText },
        { role: 'assistant', content: response.answer || response.spokenText || '' },
      ]);
    },
    onNavigation: handleNavigation,
    ttsVoice: 'nova',
  });

  // Inject keyframes
  useEffect(() => {
    const styleId = 'ai-analyst-keyframes';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @keyframes typingDot { 0%, 60%, 100% { opacity: 0.3; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-4px); } }
      @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
      @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      @keyframes slideUp { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      @keyframes voicePulse { 0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(91,159,255,0.4); } 50% { transform: scale(1.05); box-shadow: 0 0 0 20px rgba(91,159,255,0); } }
      @keyframes eqBar { 0%, 100% { height: 4px; } 50% { height: 20px; } }
    `;
    document.head.appendChild(style);
    return () => { const el = document.getElementById(styleId); if (el) el.remove(); };
  }, []);

  // Set pane height based on window
  useEffect(() => {
    if (!open) return;
    const h = Math.min(window.innerHeight * 0.7, 700);
    setPaneHeight(h);
  }, [open]);

  // Fetch report list when pane opens
  useEffect(() => {
    if (!open) return;
    loadReportList();
  }, [open]);

  const loadReportList = async () => {
    setListLoading(true);
    try {
      const res = await fetch('/api/ai-analyst?action=list-reports');
      if (res.ok) {
        const data = await res.json();
        setReports(data.reports || []);
        setAvailableDates(data.dates || []);
        if (data.dates?.length > 0 && !selectedDate) {
          setSelectedDate(data.dates[0]);
        }
      }
    } catch (e) {
      console.error('Failed to load reports:', e);
    } finally {
      setListLoading(false);
    }
  };

  // Load report content when category + date selected
  useEffect(() => {
    if (!selectedCategory || !open) return;
    loadReport();
  }, [selectedCategory, selectedDate]);

  const loadReport = async () => {
    // Find matching report
    const match = reports.find(r => r.type === selectedCategory && (!selectedDate || r.date === selectedDate));
    if (!match) {
      setReportContent(null);
      setReportSections([]);
      return;
    }

    setReportLoading(true);
    try {
      const res = await fetch(`/api/ai-analyst?action=get-report&id=${match.id}`);
      if (res.ok) {
        const data = await res.json();
        setReportContent(data.content || '');
        setReportSections(data.sections || parseSections(data.content || ''));
      }
    } catch (e) {
      console.error('Failed to load report:', e);
    } finally {
      setReportLoading(false);
    }
  };

  // Auto-scroll chat
  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [messages, chatLoading]);

  // When voice mode activates, kill browser TTS
  useEffect(() => {
    if (voiceModeActive) {
      setTtsEnabled(false);
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    }
  }, [voiceModeActive]);

  // TTS (browser-based, only when voice mode is OFF)
  useEffect(() => {
    if (!ttsEnabled || voiceModeActive || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role === 'assistant' && typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(last.content);
      u.rate = 1.0; u.pitch = 1.0;
      window.speechSynthesis.speak(u);
    }
  }, [messages, ttsEnabled, voiceModeActive]);

  const sendMessage = useCallback(async (text) => {
    const question = text || input;
    if (!question.trim()) return;
    const userMsg = { role: 'user', content: question.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setChatLoading(true);
    try {
      const res = await fetch('/api/ai-analyst', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: question.trim(),
          tab: activeTab || 'daily',
          entity: activeEntity || undefined,
          reportContent: reportContent || undefined,
          liveData: liveDataContext,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: data.answer || 'No response received.',
          suggestedQuestions: data.suggestedFollowUps || [],
        }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, I encountered an error. Please try again.' }]);
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, I encountered an error. Please try again.' }]);
    } finally {
      setChatLoading(false);
    }
  }, [input, activeTab, activeEntity, reportContent]);

  const handleKeyDown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } };

  // Speech-to-text
  const toggleListening = useCallback(() => {
    if (typeof window === 'undefined') return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    if (isListening && recognitionRef.current) { recognitionRef.current.stop(); setIsListening(false); return; }
    const r = new SR();
    r.continuous = false; r.interimResults = false; r.lang = 'en-US';
    r.onresult = (e) => { const t = e.results[0][0].transcript; setInput(t); setIsListening(false); setTimeout(() => sendMessage(t), 100); };
    r.onerror = () => setIsListening(false);
    r.onend = () => setIsListening(false);
    recognitionRef.current = r;
    r.start();
    setIsListening(true);
  }, [isListening, sendMessage]);

  const toggleTts = () => {
    if (ttsEnabled && typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
    setTtsEnabled(!ttsEnabled);
  };

  // Pane resize (top edge drag)
  const handlePaneDragStart = (e) => {
    e.preventDefault();
    setIsDraggingPane(true);
    dragStartRef.current = { y: e.clientY, height: paneHeight };
    const onMove = (ev) => {
      const delta = dragStartRef.current.y - ev.clientY;
      setPaneHeight(Math.min(window.innerHeight * 0.9, Math.max(300, dragStartRef.current.height + delta)));
    };
    const onUp = () => { setIsDraggingPane(false); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // Split resize (horizontal divider between top and bottom panels)
  const handleSplitDragStart = (e) => {
    e.preventDefault();
    setIsDraggingSplit(true);
    const paneEl = paneRef.current;
    if (!paneEl) return;
    const onMove = (ev) => {
      const rect = paneEl.getBoundingClientRect();
      const headerH = 46; // header height approx
      const availH = rect.height - headerH;
      const relY = ev.clientY - rect.top - headerH;
      const ratio = Math.min(0.85, Math.max(0.15, relY / availH));
      setSplitRatio(ratio);
    };
    const onUp = () => { setIsDraggingSplit(false); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const scrollToSection = (sectionId) => {
    const el = document.getElementById(sectionId);
    const scrollContainer = contentScrollRef.current;
    if (el && scrollContainer) {
      // Calculate offset relative to the scroll container
      const containerRect = scrollContainer.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const offset = elRect.top - containerRect.top + scrollContainer.scrollTop - 20;
      scrollContainer.scrollTo({ top: offset, behavior: 'smooth' });
    }
  };

  // Get reports for selected date and category counts
  const reportsForDate = reports.filter(r => !selectedDate || r.date === selectedDate);
  const categoryCounts = {};
  reportsForDate.forEach(r => { categoryCounts[r.type] = (categoryCounts[r.type] || 0) + 1; });

  // Build rendered report content + TOC entries from raw content
  const { renderedElements, tocEntries } = useMemo(() => {
    if (!reportContent) return { renderedElements: null, tocEntries: [] };
    const result = buildReportContent(reportContent);
    return { renderedElements: result.elements, tocEntries: result.tocEntries };
  }, [reportContent]);

  // ---------- TOGGLE BUTTON (top-right, always visible) ----------
  const toggleButton = (
    <button
      onClick={() => { const next = !open; setOpen(next); if (onOpenChange) onOpenChange(next); }}
      style={{
        background: open ? C.accent : C.surface,
        border: `1px solid ${open ? C.accent : C.border}`,
        color: open ? '#fff' : C.accent,
        borderRadius: 8,
        padding: '7px 14px',
        fontSize: 12,
        fontWeight: 700,
        fontFamily: C.sans,
        letterSpacing: -0.3,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        transition: 'all 0.2s',
        whiteSpace: 'nowrap',
      }}
      title="AI Analyst"
    >
      AI Analyst
    </button>
  );

  if (!open) return <div style={{ position: 'fixed', top: 12, right: 16, zIndex: 1001 }}>{toggleButton}</div>;

  // ---------- EXPANDED PANE ----------
  return (
    <>
      {/* Top-right button */}
      <div style={{ position: 'fixed', top: 12, right: 16, zIndex: 1002 }}>{toggleButton}</div>

      {/* Pane */}
      <div
        ref={paneRef}
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          height: paneHeight,
          background: C.surface,
          borderTop: `2px solid ${C.accent}`,
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          animation: 'slideUp 0.3s ease',
          transition: isDraggingPane || isDraggingSplit ? 'none' : 'height 0.2s ease',
        }}
      >
        {/* Top edge drag handle */}
        <div
          onMouseDown={handlePaneDragStart}
          style={{
            position: 'absolute', top: -5, left: 0, right: 0, height: 10,
            cursor: 'ns-resize', zIndex: 1001,
            display: 'flex', justifyContent: 'center', alignItems: 'center',
          }}
        >
          <div style={{ width: 40, height: 3, borderRadius: 2, background: C.accent, opacity: 0.5 }} />
        </div>

        {/* Header bar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 16px', borderBottom: `1px solid ${C.border}`, flexShrink: 0, minHeight: 46,
        }}>
          {/* Left: category buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {CATEGORIES.map(cat => {
              const active = selectedCategory === cat.id;
              const hasReport = !!categoryCounts[cat.id];
              return (
                <button
                  key={cat.id}
                  onClick={() => {
                    setSelectedCategory(active ? null : cat.id);
                    if (active) { setReportContent(null); setReportSections([]); }
                  }}
                  style={{
                    background: active ? C.accent : hasReport ? C.card : C.bg,
                    border: `1px solid ${active ? C.accent : hasReport ? C.border : '#0d1117'}`,
                    color: active ? '#fff' : hasReport ? C.text : C.muted,
                    opacity: hasReport ? 1 : 0.45,
                    borderRadius: 6,
                    padding: '5px 12px',
                    fontSize: 11,
                    fontWeight: 600,
                    fontFamily: C.sans,
                    letterSpacing: -0.2,
                    cursor: hasReport ? 'pointer' : 'default',
                    display: 'flex', alignItems: 'center', gap: 4,
                    transition: 'all 0.15s',
                    whiteSpace: 'nowrap',
                  }}
                  disabled={!hasReport}
                  title={hasReport ? cat.label : `${cat.label} — no report for this date`}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>

          {/* Right: date picker + close */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {availableDates.length > 0 && (
              <select
                value={selectedDate || ''}
                onChange={(e) => {
                  setSelectedDate(e.target.value);
                  setReportContent(null);
                  setReportSections([]);
                }}
                style={{
                  background: C.bg, border: `1px solid ${C.border}`, color: C.text,
                  borderRadius: 6, padding: '4px 8px', fontSize: 11, fontFamily: C.mono,
                  cursor: 'pointer', outline: 'none',
                }}
              >
                {availableDates.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            )}
            <button
              onClick={() => { setOpen(false); if (onOpenChange) onOpenChange(false); }}
              style={{
                background: 'none', border: 'none', color: C.muted, fontSize: 16,
                cursor: 'pointer', padding: '4px 8px', borderRadius: 4,
              }}
              title="Close"
            >✕</button>
          </div>
        </div>

        {/* Top panel: Report content */}
        <div
          ref={topPanelRef}
          style={{
            height: `${splitRatio * 100}%`,
            overflow: 'hidden',
            display: 'flex',
            flexShrink: 0,
          }}
        >
          {/* Section nav sidebar (when report is loaded) */}
          {reportContent && tocEntries.length > 0 && (
            <div style={{
              width: 200, minWidth: 200, borderRight: `1px solid ${C.border}`,
              overflow: 'auto', padding: '12px 8px', flexShrink: 0,
            }}>
              <div style={{
                fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase',
                letterSpacing: 1, marginBottom: 8, fontFamily: C.mono,
              }}>
                Sections
              </div>
              {tocEntries.map(s => (
                <button
                  key={s.id}
                  onClick={() => scrollToSection(s.id)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    background: 'none', border: 'none', color: C.accent,
                    fontSize: 10, fontFamily: C.mono, padding: '4px 6px',
                    cursor: 'pointer', borderRadius: 4, marginBottom: 2,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => e.target.style.background = C.card}
                  onMouseLeave={e => e.target.style.background = 'none'}
                  title={s.title}
                >
                  {s.title}
                </button>
              ))}
            </div>
          )}

          {/* Report content area */}
          <div ref={contentScrollRef} style={{ flex: 1, overflow: 'auto', padding: '20px 28px', fontFamily: C.sans }}>
            {!selectedCategory && !reportLoading && (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', height: '100%', color: C.muted,
                fontSize: 13, fontFamily: C.mono, textAlign: 'center', gap: 8,
              }}>
                <span style={{ fontSize: 28, opacity: 0.5 }}>✦</span>
                <div>Select a report category above to view</div>
                <div style={{ fontSize: 11, opacity: 0.7 }}>
                  {listLoading ? 'Loading reports...' : `${reports.length} reports available`}
                </div>
              </div>
            )}

            {selectedCategory && reportLoading && <LoadingSkeleton />}

            {selectedCategory && !reportLoading && !reportContent && (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', height: '100%', color: C.muted,
                fontSize: 12, fontFamily: C.mono, textAlign: 'center',
              }}>
                No report found for {CATEGORIES.find(c => c.id === selectedCategory)?.label} on {selectedDate || 'this date'}
              </div>
            )}

            {selectedCategory && !reportLoading && reportContent && renderedElements && (
              <>{renderedElements}</>
            )}
          </div>
        </div>

        {/* Split divider (draggable) */}
        <div
          onMouseDown={handleSplitDragStart}
          style={{
            height: 6, cursor: 'ns-resize', flexShrink: 0,
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            background: isDraggingSplit ? C.accent + '33' : 'transparent',
            borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`,
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = C.accent + '22'}
          onMouseLeave={e => { if (!isDraggingSplit) e.currentTarget.style.background = 'transparent'; }}
        >
          <div style={{ width: 30, height: 2, borderRadius: 1, background: C.muted, opacity: 0.4 }} />
        </div>

        {/* Bottom panel: Chat */}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: MIN_BOTTOM_HEIGHT,
        }}>
          {/* Chat messages */}
          <div style={{
            flex: 1, overflow: 'auto', padding: 12,
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            {messages.length === 0 && !chatLoading && (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flex: 1, color: C.muted, fontSize: 11, fontFamily: C.mono,
                textAlign: 'center', padding: 20,
              }}>
                Ask a question about the reports or your dashboard data
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i}>
                <div style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div style={{
                    maxWidth: '85%', padding: '10px 14px', borderRadius: 12,
                    fontSize: 12, lineHeight: 1.5, fontFamily: C.mono,
                    ...(msg.role === 'user'
                      ? { background: C.accent, color: '#fff', borderBottomRightRadius: 4 }
                      : { background: C.card, border: `1px solid ${C.border}`, color: C.text, borderBottomLeftRadius: 4 }),
                  }}>
                    {msg.role === 'assistant' ? formatInsightText(msg.content) : msg.content}
                  </div>
                </div>
                {msg.role === 'assistant' && msg.suggestedQuestions?.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6, paddingLeft: 4 }}>
                    {msg.suggestedQuestions.map((q, qi) => (
                      <button
                        key={qi}
                        onClick={() => sendMessage(q)}
                        style={{
                          background: 'transparent', border: `1px solid ${C.accent}`,
                          color: C.accent, borderRadius: 16, fontSize: 10,
                          padding: '3px 10px', cursor: 'pointer', fontFamily: C.mono,
                          transition: 'all 0.15s', whiteSpace: 'nowrap',
                        }}
                        onMouseEnter={e => { e.target.style.background = C.accent; e.target.style.color = '#fff'; }}
                        onMouseLeave={e => { e.target.style.background = 'transparent'; e.target.style.color = C.accent; }}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {chatLoading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, borderBottomLeftRadius: 4 }}>
                  <TypingIndicator />
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input bar — switches between text mode and voice mode */}
          {voiceModeActive ? (
            /* ── Voice Mode UI ── */
            <div style={{
              padding: '12px', borderTop: `1px solid ${C.border}`, flexShrink: 0,
            }}>
              {/* Voice error display */}
              {voiceError && (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '8px 12px', marginBottom: 8, background: '#2e0a0a',
                  borderRadius: 8, border: '1px solid #f8717133',
                }}>
                  <span style={{ color: C.red, fontSize: 11 }}>
                    {voiceError === 'no-mic-permission' ? 'Microphone access required. Please allow mic access and try again.'
                      : voiceError === 'browser-unsupported' ? 'Voice mode requires Chrome, Edge, or Safari.'
                      : 'Voice error occurred.'}
                  </span>
                  <button onClick={() => { clearVoiceError(); toggleVoiceMode(); }} style={{
                    background: C.red, border: 'none', color: '#fff', borderRadius: 4,
                    padding: '3px 8px', fontSize: 10, cursor: 'pointer', fontWeight: 600,
                  }}>Retry</button>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                {/* State indicator */}
                {voiceState === 'listening' && (
                  <>
                    <div style={{
                      width: 56, height: 56, borderRadius: '50%', background: `${C.accent}22`,
                      border: `2px solid ${C.accent}`, display: 'flex', alignItems: 'center',
                      justifyContent: 'center', fontSize: 24, animation: 'voicePulse 2s ease-in-out infinite',
                    }}>🎤</div>
                    <span style={{ fontSize: 10, color: C.accent, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>Listening...</span>
                    {voiceTranscript && (
                      <p style={{ fontSize: 11, color: C.muted, fontStyle: 'italic', margin: 0, textAlign: 'center', maxWidth: '90%' }}>
                        "{voiceTranscript}"
                      </p>
                    )}
                  </>
                )}

                {voiceState === 'processing' && (
                  <>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center', height: 32, justifyContent: 'center' }}>
                      {[0, 1, 2].map(i => (
                        <div key={i} style={{
                          width: 8, height: 8, borderRadius: '50%', background: C.accent,
                          animation: `typingDot 1.4s ease-in-out ${i * 0.2}s infinite`,
                        }} />
                      ))}
                    </div>
                    <span style={{ fontSize: 10, color: C.yellow, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>Thinking...</span>
                    {voiceTranscript && (
                      <p style={{ fontSize: 11, color: C.muted, fontStyle: 'italic', margin: '4px 0 0', textAlign: 'center', maxWidth: '90%' }}>
                        You said: "{voiceTranscript}"
                      </p>
                    )}
                  </>
                )}

                {voiceState === 'speaking' && (
                  <>
                    <div
                      onClick={interruptSpeaking}
                      style={{
                        display: 'flex', gap: 3, alignItems: 'flex-end', height: 32,
                        justifyContent: 'center', cursor: 'pointer', paddingBottom: 4,
                      }}
                      title="Click to interrupt and speak"
                    >
                      {[0, 1, 2, 3, 4, 5, 6].map(i => (
                        <div key={i} style={{
                          width: 4, borderRadius: 2, background: C.green,
                          animation: `eqBar 0.8s ease-in-out ${i * 0.1}s infinite`,
                        }} />
                      ))}
                    </div>
                    {lastResponseText && (
                      <div style={{
                        maxHeight: 120, overflowY: 'auto', padding: '8px 12px',
                        background: `${C.card}`, borderRadius: 8, border: `1px solid ${C.border}`,
                        width: '100%', marginTop: 4,
                      }}>
                        <p style={{ fontSize: 12, color: C.text, margin: 0, lineHeight: 1.5, fontFamily: C.sans }}>
                          {lastResponseText}
                        </p>
                      </div>
                    )}
                    <span style={{ fontSize: 9, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginTop: 4 }}>tap or speak to interrupt</span>
                  </>
                )}

                {/* Stop voice mode button */}
                <button
                  onClick={toggleVoiceMode}
                  style={{
                    background: '#ef4444', border: '2px solid #ef4444', color: '#fff',
                    borderRadius: 20, padding: '8px 18px', fontSize: 13, cursor: 'pointer',
                    fontWeight: 700, transition: 'all 0.2s', marginTop: 8,
                    boxShadow: '0 0 12px #ef444444',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}
                  onMouseEnter={e => { e.target.style.boxShadow = '0 0 20px #ef444488'; }}
                  onMouseLeave={e => { e.target.style.boxShadow = '0 0 12px #ef444444'; }}
                >
                  ⏹ Stop Voice Mode
                </button>
              </div>
            </div>
          ) : (
            /* ── Text Mode UI ── */
            <div style={{
              padding: '8px 12px', borderTop: `1px solid ${C.border}`,
              display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0,
            }}>
              <button
                onClick={toggleVoiceMode}
                style={{
                  background: C.accent,
                  border: `2px solid ${C.accent}`,
                  color: '#fff',
                  borderRadius: 20, padding: '8px 18px',
                  display: 'flex', alignItems: 'center', gap: 6,
                  cursor: 'pointer', fontSize: 13, fontWeight: 700, flexShrink: 0, transition: 'all 0.2s',
                  boxShadow: `0 0 12px ${C.accent}44`,
                }}
                title="Start Voice Mode"
                onMouseEnter={e => { e.target.style.boxShadow = `0 0 20px ${C.accent}88`; }}
                onMouseLeave={e => { e.target.style.boxShadow = `0 0 12px ${C.accent}44`; }}
              >
                🎙 Voice Mode
              </button>

              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about the reports..."
                style={{
                  flex: 1, background: C.bg, border: `1px solid ${C.border}`,
                  color: C.text, borderRadius: 20, padding: '8px 16px',
                  fontSize: 12, fontFamily: C.mono, outline: 'none',
                  transition: 'border-color 0.2s',
                }}
                onFocus={e => e.target.style.borderColor = C.accent}
                onBlur={e => e.target.style.borderColor = C.border}
              />

              <button
                onClick={() => sendMessage()}
                disabled={!input.trim()}
                style={{
                  background: input.trim() ? C.accent : C.border,
                  border: 'none', color: input.trim() ? '#fff' : C.muted,
                  borderRadius: '50%', width: 30, height: 30,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: input.trim() ? 'pointer' : 'default',
                  fontSize: 14, flexShrink: 0, transition: 'all 0.2s',
                }}
                title="Send"
              >
                ➤
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
