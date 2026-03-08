// Shared theme constants and utility functions for TCC Dashboard
// Extracted from Dashboard.jsx for reuse across CRM components

export const C = {
  bg: '#080b10', surface: '#0f1520', card: '#131b28', border: '#1a2538',
  text: '#f0f3f9', muted: '#8fa3be', accent: '#5b9fff', accentDim: '#1e3a5f',
  green: '#4ade80', greenDim: '#0a2e1a', yellow: '#facc15', yellowDim: '#2e2a0a',
  red: '#f87171', redDim: '#2e0a0a', purple: '#a855f7',
  mono: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
  sans: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
};

export function fmt(n, d = 0) {
  if (n == null || isNaN(n)) return '—';
  const num = typeof n === 'number' ? n : parseFloat(n);
  if (isNaN(num)) return '—';
  const digits = (typeof d === 'number' && !isNaN(d)) ? Math.max(0, Math.min(20, Math.floor(d))) : 0;
  return num.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtDollar(n, d = 0) {
  if (n == null || isNaN(n)) return '—';
  const num = typeof n === 'number' ? n : parseFloat(n);
  if (isNaN(num)) return '—';
  const digits = (typeof d === 'number' && !isNaN(d)) ? Math.max(0, Math.min(20, Math.floor(d))) : 0;
  return (num < 0 ? '-$' : '$') + Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  return parseFloat(n).toFixed(1) + '%';
}

export function goalColor(actual, goal, lower = false, yellowPct = 80) {
  if (!goal || !actual) return C.muted;
  const r = lower ? goal / actual : actual / goal;
  return r >= 1 ? C.green : r >= (yellowPct / 100) ? C.yellow : C.red;
}

export function goalBg(actual, goal, lower = false) {
  if (!goal || !actual) return 'transparent';
  const r = lower ? goal / actual : actual / goal;
  return r >= 1 ? C.greenDim : r >= 0.8 ? C.yellowDim : C.redDim;
}

export function calcDays(s, e) {
  if (!s || !e) return 1;
  return Math.max(Math.ceil((new Date(e) - new Date(s)) / 864e5) + 1, 1);
}

export const isPlaced = p => ['Advance Released', 'Active - In Force', 'Submitted - Pending'].includes(p.placed);

// CRM-specific status colors
export const STATUS_COLORS = {
  // Dialer Call Status values (lead disposition)
  'SALE': C.green,
  'CONVERTED': C.green,
  'CALLBACK': C.yellow,
  'CALLBK': C.yellow,
  'DNC': C.red,
  'DNCC': C.red,
  'NI': C.muted,
  'NA': C.muted,
  'NO ANSWER': C.muted,
  'VOICEMAIL': C.muted,
  'VM': C.muted,
  'BUSY': C.muted,
  'B': C.muted,
  'HANGUP': C.red,
  'DROP': '#666',
  'DEAD': '#666',
  'DEC': C.red,
  'XFER': C.accent,
  'A': C.accent,
  'UNKNOWN': '#555',
  // Legacy lead statuses
  'New': C.accent,
  'Contacted': C.yellow,
  'Follow-Up': C.purple,
  'Converted': C.green,
  'Dead': C.muted,
  'Pooled': C.red,
  // Policyholder statuses
  'Active': C.green,
  'At-Risk': C.yellow,
  'Lapsed': C.red,
  'Win-Back': C.purple,
  'Reinstated': C.green,
  'Lost': C.muted,
};

export const LEAD_STATUSES = ['New', 'Contacted', 'Follow-Up', 'Converted', 'Dead', 'Pooled'];
export const POLICYHOLDER_STATUSES = ['Active', 'At-Risk', 'Lapsed', 'Win-Back', 'Reinstated', 'Lost'];
export const LAPSE_REASONS = ['Non-Payment', 'Customer Cancelled', 'NSF', 'Not-Taken', 'Replaced', 'Deceased', 'Moved', 'Other'];
export const OUTREACH_METHODS = ['Phone', 'SMS', 'Email'];
export const OUTREACH_OUTCOMES = ['Reached', 'Voicemail', 'No Answer', 'Declined', 'Wrong Number', 'Disconnected'];
export const TASK_TYPES = ['Lead Follow-Up', 'Policy Lapse', 'Win-Back'];
export const TASK_STATUSES = ['Not Started', 'In Progress', 'Completed', 'Failed', 'Cancelled'];
