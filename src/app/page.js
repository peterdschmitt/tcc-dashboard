'use client';
import { useState, useEffect, useCallback } from 'react';
import Dashboard from '@/components/Dashboard';

export default function Home() {
  const [data, setData] = useState(null);
  const [allTimePolicies, setAllTimePolicies] = useState([]);
  const [goals, setGoals] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Default to ALL so data shows immediately
  const [dateRange, setDateRange] = useState({
    start: '2020-01-01', end: '2030-12-31', preset: 'all'
  });
  const [dataSource, setDataSource] = useState('Sheet1');

  const applyPreset = useCallback((preset) => {
    const today = new Date();
    const fmt = d => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    let start, end;
    if (preset === 'yesterday') {
      const y = new Date(); y.setDate(y.getDate() - 1);
      start = fmt(y); end = fmt(y);
    } else if (preset === 'today') {
      start = fmt(today); end = fmt(today);
    } else if (preset === 'last7') {
      const s = new Date(); s.setDate(s.getDate() - 6);
      start = fmt(s); end = fmt(today);
    } else if (preset === 'last30') {
      const s = new Date(); s.setDate(s.getDate() - 29);
      start = fmt(s); end = fmt(today);
    } else if (preset === 'wtd') {
      const day = today.getDay(); // 0=Sun, 1=Mon, ...
      const s = new Date(today); s.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
      start = fmt(s); end = fmt(today);
    } else if (preset === 'mtd') {
      start = fmt(new Date(today.getFullYear(), today.getMonth(), 1));
      end = fmt(today);
    } else if (preset === 'all') {
      start = '2020-01-01'; end = '2030-12-31';
    } else return;
    setDateRange({ start, end, preset });
  }, []);

  const setCustomRange = useCallback((field, value) => {
    setDateRange(r => ({ ...r, [field]: value, preset: 'custom' }));
  }, []);

  // One-time fetch of all-time policies (for status breakdown widget — ignores date range)
  useEffect(() => {
    let cancelled = false;
    fetch('/api/dashboard?start=2020-01-01&end=2030-12-31&source=' + dataSource)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d?.policies) setAllTimePolicies(d.policies); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [dataSource]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [dashRes, goalsRes] = await Promise.all([
          fetch('/api/dashboard?start=' + dateRange.start + '&end=' + dateRange.end + '&source=' + dataSource),
          fetch('/api/goals'),
        ]);
        if (!dashRes.ok) throw new Error('Dashboard API: ' + dashRes.status);
        if (!goalsRes.ok) throw new Error('Goals API: ' + goalsRes.status);
        const dashData = await dashRes.json();
        const goalsData = await goalsRes.json();
        if (!cancelled) { setData(dashData); setGoals(goalsData); }
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
      if (!cancelled) setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [dateRange, dataSource]);

  if (error) {
    return (
      <div style={{ background: '#0a0e13', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#e8ecf4', fontFamily: 'Inter, sans-serif' }}>
        <div style={{ background: '#111822', border: '1px solid #1c2940', borderRadius: 12, padding: 40, maxWidth: 500, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ margin: '0 0 12px', fontSize: 20 }}>Connection Error</h2>
          <p style={{ color: '#6b7a94', fontSize: 14, margin: '0 0 20px' }}>{error}</p>
          <button onClick={() => window.location.reload()} style={{
            marginTop: 16, padding: '10px 24px', background: '#4e8cff', color: '#fff',
            border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 600,
          }}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <Dashboard
      data={data}
      allTimePolicies={allTimePolicies}
      goals={goals}
      loading={loading}
      dateRange={dateRange}
      applyPreset={applyPreset}
      setCustomRange={setCustomRange}
      dataSource={dataSource}
      setDataSource={setDataSource}
    />
  );
}
