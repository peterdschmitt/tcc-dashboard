'use client';
import { useState, useEffect, useCallback } from 'react';
import Dashboard from '@/components/Dashboard';
import VoiceAgent from '@/components/VoiceAgent';

export default function Home() {
  const [data, setData] = useState(null);
  const [allTimePolicies, setAllTimePolicies] = useState([]);
  const [goals, setGoals] = useState(null);
  const [vaData, setVaData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [earliestDate, setEarliestDate] = useState(null);
  const [activeTab, setActiveTab] = useState('daily');
  const [voiceDrillTarget, setVoiceDrillTarget] = useState(null);
  const [aiPaneOpen, setAiPaneOpen] = useState(false);
  const [voiceTileTarget, setVoiceTileTarget] = useState(null);
  const [voicePanelOpen, setVoicePanelOpen] = useState(false);

  // Default to ALL so data shows immediately — uses wide range until we know the real earliest date
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
      start = earliestDate || '2020-01-01'; end = fmt(today);
    } else return;
    setDateRange({ start, end, preset });
  }, [earliestDate]);

  const setCustomRange = useCallback((field, value) => {
    setDateRange(r => ({ ...r, [field]: value, preset: 'custom' }));
  }, []);

  // Once we know the earliest date, update the "All" preset range
  useEffect(() => {
    if (earliestDate && dateRange.preset === 'all') {
      const today = new Date();
      const fmt = d => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      setDateRange({ start: earliestDate, end: fmt(today), preset: 'all' });
    }
  }, [earliestDate]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const isAllRange = dateRange.preset === 'all' ||
          (dateRange.start === '2020-01-01' && dateRange.end === '2030-12-31');

        const [dashRes, goalsRes, vaRes] = await Promise.all([
          fetch('/api/dashboard?start=' + dateRange.start + '&end=' + dateRange.end + '&source=' + dataSource),
          fetch('/api/goals'),
          fetch('/api/virtual-agent?start=' + dateRange.start + '&end=' + dateRange.end).catch(() => null),
        ]);
        if (!dashRes.ok) throw new Error('Dashboard API: ' + dashRes.status);
        if (!goalsRes.ok) throw new Error('Goals API: ' + goalsRes.status);
        const dashData = await dashRes.json();
        const goalsData = await goalsRes.json();
        const vaResult = vaRes?.ok ? await vaRes.json() : null;
        if (!cancelled) {
          setData(dashData);
          setGoals(goalsData);
          setVaData(vaResult);
          // When fetching all-time data, reuse it for the status breakdown widget
          // instead of making a separate API call
          if (isAllRange && dashData.policies) {
            setAllTimePolicies(dashData.policies);
          }
          if (dashData.meta?.earliestDate) setEarliestDate(dashData.meta.earliestDate);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
      if (!cancelled) setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [dateRange, dataSource]);

  // Fetch all-time policies only when using a filtered date range (not "all")
  // This avoids the double-fetch on initial load since "all" is the default
  useEffect(() => {
    if (dateRange.preset === 'all' || (dateRange.start === '2020-01-01' && dateRange.end === '2030-12-31')) return;
    if (allTimePolicies.length > 0) return; // Already have all-time data from initial load
    let cancelled = false;
    fetch('/api/dashboard?start=2020-01-01&end=2030-12-31&source=' + dataSource)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!cancelled && d?.policies) setAllTimePolicies(d.policies);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [dataSource]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const policies = data?.policies || [];
  const calls = data?.calls || [];
  const pnl = data?.pnl || [];

  return (
    <>
      <Dashboard
        data={data}
        allTimePolicies={allTimePolicies}
        goals={goals}
        vaData={vaData}
        loading={loading}
        dateRange={dateRange}
        applyPreset={applyPreset}
        setCustomRange={setCustomRange}
        dataSource={dataSource}
        setDataSource={setDataSource}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        voiceDrillTarget={voiceDrillTarget}
        setVoiceDrillTarget={setVoiceDrillTarget}
        aiPaneOpen={aiPaneOpen}
        setAiPaneOpen={setAiPaneOpen}
        voiceTileTarget={voiceTileTarget}
        setVoiceTileTarget={setVoiceTileTarget}
        voicePanelOpen={voicePanelOpen}
      />
      <VoiceAgent
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        applyPreset={applyPreset}
        setCustomRange={setCustomRange}
        dataSource={dataSource}
        setDataSource={setDataSource}
        dateRange={dateRange}
        setVoiceDrillTarget={setVoiceDrillTarget}
        policies={policies}
        calls={calls}
        pnl={pnl}
        goals={goals}
        aiPaneOpen={aiPaneOpen}
        setVoiceTileTarget={setVoiceTileTarget}
        onPanelOpenChange={setVoicePanelOpen}
      />
    </>
  );
}
