'use client';
import { createContext, useCallback, useContext, useState } from 'react';
import { buildHolderKey } from '@/lib/statement-records';

const Ctx = createContext(null);

function splitName(fullName) {
  const s = String(fullName || '').trim();
  if (!s) return { first: '', last: '' };
  if (s.includes(',')) {
    const [last, first] = s.split(',').map(p => p.trim());
    return { first: first || '', last: last || '' };
  }
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { first: '', last: parts[0] };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

export function StatementRecordDrawerProvider({ children }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ holder: null, periods: [], loading: false, error: null });

  const openDrawer = useCallback(async ({ holderName, policyNumber }) => {
    const { first, last } = splitName(holderName);
    const key = buildHolderKey(first, last);
    setOpen(true);
    setData({ holder: null, periods: [], loading: true, error: null });
    try {
      const qs = policyNumber ? `?policyNumber=${encodeURIComponent(policyNumber)}` : '';
      const res = await fetch(`/api/statement-records/${encodeURIComponent(key)}${qs}`);
      const json = await res.json();
      setData({ holder: json.holder, periods: json.periods || [], loading: false, error: json.error || null });
    } catch (e) {
      setData({ holder: null, periods: [], loading: false, error: e.message });
    }
  }, []);

  const closeDrawer = useCallback(() => setOpen(false), []);

  return (
    <Ctx.Provider value={{ open, data, openDrawer, closeDrawer }}>
      {children}
    </Ctx.Provider>
  );
}

export function useStatementRecordDrawer() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStatementRecordDrawer must be used within StatementRecordDrawerProvider');
  return v;
}
