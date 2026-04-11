'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useVoiceMode } from '@/hooks/useVoiceMode';

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
  sans: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
};

const isPlaced = p => ['Advance Released', 'Active - In Force', 'Submitted - Pending'].includes(p.placed);

function buildLiveDataContext(policies, calls, pnl, dateRange) {
  if (!policies?.length && !calls?.length) return '';
  const placed = (policies || []).filter(isPlaced);
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

  // Per-agent breakdown
  const agentMap = {};
  (policies || []).forEach(p => {
    if (!agentMap[p.agent]) agentMap[p.agent] = { apps: 0, placed: 0, premium: 0, commission: 0 };
    agentMap[p.agent].apps++;
    if (isPlaced(p)) { agentMap[p.agent].placed++; agentMap[p.agent].premium += p.premium || 0; agentMap[p.agent].commission += p.commission || 0; }
  });
  const agentSummary = Object.entries(agentMap).map(([name, a]) => `${name}: ${a.apps} apps, ${a.placed} placed, $${a.premium.toFixed(0)} premium`).join('\n  ');

  // Per-publisher breakdown (include RPC, billable rate, CPA)
  const pubSummary = (pnl || []).map(p => {
    const pubRpc = p.totalCalls > 0 ? (p.leadSpend / p.totalCalls) : 0;
    const pubBillRate = p.totalCalls > 0 ? (p.billableCalls / p.totalCalls * 100) : 0;
    const pubCpa = p.placedCount > 0 ? (p.leadSpend / p.placedCount) : 0;
    return `${p.campaign} (${p.vendor || ''}): ${p.totalCalls} calls, ${p.billableCalls} billable (${pubBillRate.toFixed(1)}%), $${p.leadSpend.toFixed(2)} spend, RPC $${pubRpc.toFixed(2)}, ${p.placedCount} placed${p.placedCount > 0 ? ', CPA $' + pubCpa.toFixed(2) : ''}`;
  }).join('\n  ');

  return `
LIVE DASHBOARD DATA (${dateRange?.start || ''} to ${dateRange?.end || ''}):
These are the exact numbers currently displayed on the dashboard. USE THESE NUMBERS in your response, not report data.

SUMMARY METRICS:
- Apps Submitted: ${apps}
- Policies Placed: ${placed.length}
- Total Calls: ${totalCalls}
- Billable Calls: ${billable}
- Billable Rate: ${billableRate.toFixed(1)}%
- Monthly Premium: $${totalPremium.toFixed(2)}
- Gross Advanced Revenue: $${totalGAR.toFixed(0)}
- Lead Spend: $${totalLeadSpend.toFixed(0)}
- Agent Commission: $${totalComm.toFixed(0)}
- Net Revenue: $${netRevenue.toFixed(0)}
- CPA: $${cpa.toFixed(2)}
- RPC: $${rpc.toFixed(2)}
- Close Rate: ${closeRate.toFixed(1)}%
- Placement Rate: ${placementRate.toFixed(1)}%
- Premium:Cost Ratio: ${premCost.toFixed(2)}x
- Avg Premium: $${avgPremium.toFixed(2)}

AGENTS:
  ${agentSummary || 'No agent data'}

PUBLISHERS:
  ${pubSummary || 'No publisher data'}
`;
}

function getTargetDateRange(text) {
  const today = new Date();
  const fmt = d => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const lower = text.toLowerCase();
  if (lower.includes('yesterday')) {
    const y = new Date(); y.setDate(y.getDate() - 1);
    return { start: fmt(y), end: fmt(y) };
  }
  if (lower.includes('today')) {
    return { start: fmt(today), end: fmt(today) };
  }
  if (/last\s*(7|seven)/.test(lower)) {
    const s = new Date(); s.setDate(s.getDate() - 6);
    return { start: fmt(s), end: fmt(today) };
  }
  if (/last\s*(30|thirty)/.test(lower)) {
    const s = new Date(); s.setDate(s.getDate() - 29);
    return { start: fmt(s), end: fmt(today) };
  }
  if (lower.includes('this month') || lower.includes('mtd')) {
    return { start: fmt(new Date(today.getFullYear(), today.getMonth(), 1)), end: fmt(today) };
  }
  if (lower.includes('this week') || lower.includes('wtd')) {
    const day = today.getDay();
    const s = new Date(today); s.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
    return { start: fmt(s), end: fmt(today) };
  }
  return { start: fmt(today), end: fmt(today) };
}

export default function VoiceAgent({ activeTab, setActiveTab, applyPreset, setCustomRange, dataSource, setDataSource, dateRange, setVoiceDrillTarget, policies, calls, pnl, goals, aiPaneOpen, setVoiceTileTarget, onPanelOpenChange }) {
  const [expanded, setExpanded] = useState(false);

  // Notify parent when panel opens/closes
  useEffect(() => {
    if (onPanelOpenChange) onPanelOpenChange(expanded);
  }, [expanded, onPanelOpenChange]);
  const [conversation, setConversation] = useState([]);
  const chatEndRef = useRef(null);

  const handleNavigation = useCallback((nav) => {
    if (nav.tab && setActiveTab) setActiveTab(nav.tab);
    if (nav.datePreset && applyPreset) applyPreset(nav.datePreset);
    if (nav.dataSource && setDataSource) setDataSource(nav.dataSource);
    if (nav.drillDown && setVoiceDrillTarget) setVoiceDrillTarget(nav.drillDown);
    if (nav.openTile && setVoiceTileTarget) setVoiceTileTarget(nav.openTile);
  }, [setActiveTab, applyPreset, setDataSource, setVoiceDrillTarget, setVoiceTileTarget]);

  // Store dateRange and dataSource in refs so onSend always has current values
  const dateRangeRef = useRef(dateRange);
  const dataSourceRef = useRef(dataSource);
  useEffect(() => { dateRangeRef.current = dateRange; }, [dateRange]);
  useEffect(() => { dataSourceRef.current = dataSource; }, [dataSource]);

  const {
    voiceModeActive, voiceState, transcript: voiceTranscript, lastResponseText,
    toggleVoiceMode, interruptSpeaking, error: voiceError, clearError: clearVoiceError,
  } = useVoiceMode({
    onSend: async (text) => {
      // ALWAYS fetch fresh data from the dashboard API — no closures, no caching
      // This guarantees the voice numbers match exactly what's in the tiles
      const dr = dateRangeRef.current;
      const ds = dataSourceRef.current || 'Sheet1';

      const dateChangeWords = /yesterday|today|last\s*(7|seven|30|thirty)|this\s*(week|month)|mtd|wtd/i;
      const impliesDateChange = dateChangeWords.test(text);

      // Determine target date range
      const targetRange = impliesDateChange ? getTargetDateRange(text) : { start: dr.start, end: dr.end };

      // Fetch live data directly from the API — zero dependency on React state/closures
      let dataContext = null;
      try {
        const freshRes = await fetch(`/api/dashboard?start=${targetRange.start}&end=${targetRange.end}&source=${ds}`);
        if (freshRes.ok) {
          const freshData = await freshRes.json();
          dataContext = buildLiveDataContext(
            freshData.policies || [],
            freshData.calls || [],
            freshData.pnl || [],
            targetRange
          );
        }
      } catch (e) {
        console.warn('[VoiceAgent] Failed to fetch dashboard data:', e);
      }

      console.log('[VoiceAgent] Live data:', dataContext ? `YES (${dataContext.length} chars)` : 'NONE — will fall back to reports');

      const res = await fetch('/api/ai-analyst', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: text,
          tab: activeTab || 'daily',
          voiceMode: true,
          liveData: dataContext,
        }),
      });
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      return await res.json();
    },
    onResponse: (response) => {
      setConversation(prev => [...prev,
        { role: 'user', text: response.userText },
        { role: 'assistant', text: response.answer || response.spokenText || '' },
      ]);
      if (response.navigation) handleNavigation(response.navigation);
    },
    onNavigation: handleNavigation,
    ttsVoice: 'nova',
  });

  // Auto-expand when voice mode activates
  useEffect(() => {
    if (voiceModeActive) setExpanded(true);
  }, [voiceModeActive]);

  // Auto-scroll conversation
  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [conversation, lastResponseText]);

  // Inject keyframes
  useEffect(() => {
    const styleId = 'voice-agent-keyframes';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @keyframes voiceAgentPulse { 0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(91,159,255,0.5); } 50% { transform: scale(1.08); box-shadow: 0 0 0 14px rgba(91,159,255,0); } }
      @keyframes voiceAgentEq { 0%, 100% { height: 4px; } 50% { height: 18px; } }
      @keyframes voiceAgentDot { 0%, 60%, 100% { opacity: 0.3; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }
      @keyframes voiceAgentGlow { 0%, 100% { box-shadow: 0 0 20px rgba(91,159,255,0.3); } 50% { box-shadow: 0 0 40px rgba(91,159,255,0.6); } }
    `;
    document.head.appendChild(style);
    return () => { const el = document.getElementById(styleId); if (el) el.remove(); };
  }, []);

  // Floating button (always visible)
  if (!expanded) {
    return (
      <button
        onClick={() => { setExpanded(true); if (!voiceModeActive) toggleVoiceMode(); }}
        style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 1000,
          width: 56, height: 56, borderRadius: '50%',
          background: voiceModeActive ? C.green : C.accent,
          border: 'none', color: '#fff', fontSize: 24,
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: `0 4px 20px ${voiceModeActive ? C.green : C.accent}66`,
          animation: voiceModeActive ? 'voiceAgentPulse 2s ease-in-out infinite' : 'voiceAgentGlow 3s ease-in-out infinite',
          transition: 'background 0.3s',
        }}
        title="Voice Agent"
      >
        🎙
      </button>
    );
  }

  // Full-height right panel
  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 1000,
      width: 380, display: 'flex', flexDirection: 'column',
      background: C.surface, borderLeft: `1px solid ${C.border}`,
      boxShadow: '-4px 0 30px rgba(0,0,0,0.4)',
      fontFamily: C.sans,
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderBottom: `1px solid ${C.border}`, background: C.card, flexShrink: 0,
      }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>🎙 Voice Agent</span>
        <button
          onClick={() => { if (voiceModeActive) toggleVoiceMode(); setExpanded(false); }}
          style={{
            background: 'transparent', border: 'none', color: C.muted, fontSize: 18,
            cursor: 'pointer', padding: '2px 6px', borderRadius: 4,
          }}
        >✕</button>
      </div>

      {/* Conversation history — scrollable */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '12px 16px',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        {conversation.length === 0 && !voiceModeActive && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
            <div style={{ fontSize: 40 }}>🎙</div>
            <p style={{ color: C.muted, fontSize: 13, textAlign: 'center', margin: 0 }}>
              Start a voice conversation with your dashboard
            </p>
            <button
              onClick={toggleVoiceMode}
              style={{
                background: C.accent, border: '2px solid ' + C.accent, color: '#fff',
                borderRadius: 20, padding: '12px 28px', fontSize: 14, fontWeight: 700,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                boxShadow: `0 0 16px ${C.accent}44`,
              }}
            >
              🎙 Start Voice Mode
            </button>
          </div>
        )}

        {/* Past messages */}
        {conversation.map((msg, i) => (
          <div key={i} style={{
            display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
          }}>
            <div style={{
              maxWidth: '85%', padding: '8px 12px', borderRadius: 12,
              background: msg.role === 'user' ? C.accent : C.card,
              border: msg.role === 'user' ? 'none' : `1px solid ${C.border}`,
              borderBottomRightRadius: msg.role === 'user' ? 4 : 12,
              borderBottomLeftRadius: msg.role === 'user' ? 12 : 4,
            }}>
              <p style={{
                fontSize: 12, color: msg.role === 'user' ? '#fff' : C.text,
                margin: 0, lineHeight: 1.5,
              }}>
                {msg.text}
              </p>
            </div>
          </div>
        ))}

        {/* Current state indicator */}
        {voiceModeActive && voiceState === 'listening' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '12px 0' }}>
            <div style={{
              width: 48, height: 48, borderRadius: '50%', background: `${C.accent}22`,
              border: `2px solid ${C.accent}`, display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 20, animation: 'voiceAgentPulse 2s ease-in-out infinite',
            }}>🎤</div>
            <span style={{ fontSize: 10, color: C.accent, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>Listening...</span>
            {voiceTranscript && (
              <p style={{ fontSize: 11, color: C.muted, fontStyle: 'italic', margin: 0, textAlign: 'center' }}>
                "{voiceTranscript}"
              </p>
            )}
          </div>
        )}

        {voiceModeActive && voiceState === 'processing' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '12px 0' }}>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', height: 32 }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: 8, height: 8, borderRadius: '50%', background: C.accent,
                  animation: `voiceAgentDot 1.4s ease-in-out ${i * 0.2}s infinite`,
                }} />
              ))}
            </div>
            <span style={{ fontSize: 10, color: C.yellow, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>Thinking...</span>
          </div>
        )}

        {voiceModeActive && voiceState === 'speaking' && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
            <div onClick={interruptSpeaking} style={{ display: 'flex', gap: 3, alignItems: 'flex-end', cursor: 'pointer', padding: '4px 12px' }} title="Tap to interrupt">
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} style={{
                  width: 3, borderRadius: 2, background: C.green,
                  animation: `voiceAgentEq 0.8s ease-in-out ${i * 0.1}s infinite`,
                }} />
              ))}
              <span style={{ fontSize: 9, color: C.green, marginLeft: 6, fontWeight: 600 }}>Speaking — tap to interrupt</span>
            </div>
          </div>
        )}

        {/* Error */}
        {voiceError && (
          <div style={{
            padding: '10px 14px', background: '#2e0a0a', borderRadius: 8,
            border: '1px solid #f8717133', textAlign: 'center',
          }}>
            <span style={{ color: C.red, fontSize: 12 }}>
              {voiceError === 'no-mic-permission' ? 'Microphone access required.'
                : voiceError === 'browser-unsupported' ? 'Voice requires Chrome, Edge, or Safari.'
                : 'Voice error occurred.'}
            </span>
            <button onClick={() => { clearVoiceError(); toggleVoiceMode(); }} style={{
              background: C.red, border: 'none', color: '#fff', borderRadius: 4,
              padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600, marginLeft: 8,
            }}>Retry</button>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Footer */}
      <div style={{
        padding: '12px 16px', borderTop: `1px solid ${C.border}`, background: C.card, flexShrink: 0,
        display: 'flex', justifyContent: 'center', gap: 8,
      }}>
        {voiceModeActive ? (
          <button
            onClick={() => { toggleVoiceMode(); }}
            style={{
              background: '#ef4444', border: '2px solid #ef4444', color: '#fff',
              borderRadius: 20, padding: '10px 24px', fontSize: 13, fontWeight: 700,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              boxShadow: '0 0 12px #ef444444', flex: 1, justifyContent: 'center',
            }}
          >
            ⏹ Stop
          </button>
        ) : (
          <button
            onClick={toggleVoiceMode}
            style={{
              background: C.accent, border: '2px solid ' + C.accent, color: '#fff',
              borderRadius: 20, padding: '10px 24px', fontSize: 13, fontWeight: 700,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              boxShadow: `0 0 16px ${C.accent}44`, flex: 1, justifyContent: 'center',
            }}
          >
            🎙 Start
          </button>
        )}
      </div>
    </div>
  );
}
