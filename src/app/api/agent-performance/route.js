export const dynamic = 'force-dynamic';
import { fetchSheet } from '@/lib/sheets';
import { parseFlexDate } from '@/lib/utils';
import { NextResponse } from 'next/server';

function parseTime(raw) {
  if (!raw) return 0;
  const match = raw.match(/(\d+):(\d+):(\d+)/);
  if (match) return parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]);
  return 0;
}

function fmtSec(s) {
  if (!s) return '0:00:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('start');
    const endDate = searchParams.get('end');

    const raw = await fetchSheet(
      process.env.AGENT_PERF_SHEET_ID,
      process.env.AGENT_PERF_TAB_NAME || 'Sheet1'
    );

    let rows = raw
      .filter(r => r['Rep'] && r['Date'])
      .map(r => {
        const date = parseFlexDate(r['Date']);
        const loggedIn = parseTime(r['Logged In Time']);
        const paused = parseTime(r['Time Paused']);
        const talkTime = parseTime(r['Talk Time']);
        const waitTime = parseTime(r['Wait Time']);
        const wrapUp = parseTime(r['Wrap Up Time']);
        const available = loggedIn - paused;
        const availPct = loggedIn > 0 ? (available / loggedIn) * 100 : 0;
        const talkPct = available > 0 ? (talkTime / available) * 100 : 0;
        const pausePct = loggedIn > 0 ? (paused / loggedIn) * 100 : 0;

        return {
          date,
          rep: r['Rep']?.trim(),
          team: r['Team']?.trim() || '',
          dialed: parseInt(r['Dialed']) || 0,
          connects: parseInt(r['Connects']) || 0,
          contacts: parseInt(r['Contacts']) || 0,
          hoursWorked: parseFloat(r['Hours Worked']) || 0,
          sales: parseInt(r['Sale/Lead/App']) || 0,
          connectsPerHour: parseFloat(r['Connects per Hour']) || 0,
          slaPerHour: parseFloat(r['S-L-A/HR']) || 0,
          conversionRate: parseFloat((r['Conversion Rate'] || '0').replace('%', '')) || 0,
          conversionFactor: parseFloat((r['Conversion Factor'] || '0').replace('%', '')) || 0,
          talkTime: talkTime,
          talkTimeStr: r['Talk Time']?.trim() || '0:00:00',
          avgTalkTime: parseTime(r['Avg Talk Time']),
          avgTalkTimeStr: r['Avg Talk Time']?.trim() || '0:00:00',
          paused: paused,
          pausedStr: r['Time Paused']?.trim() || '0:00:00',
          waitTime: waitTime,
          waitTimeStr: r['Wait Time']?.trim() || '0:00:00',
          avgWaitTime: parseTime(r['Avg Wait Time']),
          avgWaitTimeStr: r['Avg Wait Time']?.trim() || '0:00:00',
          wrapUp: wrapUp,
          wrapUpStr: r['Wrap Up Time']?.trim() || '0:00:00',
          avgWrapUp: parseTime(r['Avg Wrap Up Time']),
          avgWrapUpStr: r['Avg Wrap Up Time']?.trim() || '0:00:00',
          loggedIn: loggedIn,
          loggedInStr: r['Logged In Time']?.trim() || '0:00:00',
          available: available,
          availableStr: fmtSec(available),
          availPct: availPct,
          talkPct: talkPct,
          pausePct: pausePct,
        };
      });

    if (startDate) rows = rows.filter(r => r.date >= startDate);
    if (endDate) rows = rows.filter(r => r.date <= endDate);

    // Exclude agents
    try {
      const excludedRaw = await fetchSheet(
        process.env.GOALS_SHEET_ID,
        process.env.EXCLUDED_AGENTS_TAB || 'Excluded Agents', 1800
      );
      const excludedSet = new Set(
        excludedRaw.map(r => (r['Agent Name'] || r['Agent'] || r['Name'] || '').trim().toLowerCase()).filter(Boolean)
      );
      if (excludedSet.size > 0) {
        rows = rows.filter(r => !excludedSet.has((r.rep || '').toLowerCase()));
      }
    } catch (e) { /* no exclusion tab yet — that's ok */ }

    // Aggregate by agent
    const byAgent = {};
    rows.forEach(r => {
      if (!byAgent[r.rep]) {
        byAgent[r.rep] = {
          rep: r.rep, team: r.team, days: 0,
          dialed: 0, connects: 0, contacts: 0, sales: 0,
          talkTime: 0, paused: 0, waitTime: 0, wrapUp: 0, loggedIn: 0,
          hoursWorked: 0,
        };
      }
      const a = byAgent[r.rep];
      a.days++;
      a.dialed += r.dialed;
      a.connects += r.connects;
      a.contacts += r.contacts;
      a.sales += r.sales;
      a.talkTime += r.talkTime;
      a.paused += r.paused;
      a.waitTime += r.waitTime;
      a.wrapUp += r.wrapUp;
      a.loggedIn += r.loggedIn;
      a.hoursWorked += r.hoursWorked;
    });

    const agents = Object.values(byAgent).map(a => {
      const available = a.loggedIn - a.paused;
      return {
        ...a,
        available,
        availableStr: fmtSec(available),
        loggedInStr: fmtSec(a.loggedIn),
        pausedStr: fmtSec(a.paused),
        talkTimeStr: fmtSec(a.talkTime),
        waitTimeStr: fmtSec(a.waitTime),
        wrapUpStr: fmtSec(a.wrapUp),
        availPct: a.loggedIn > 0 ? (available / a.loggedIn) * 100 : 0,
        talkPct: available > 0 ? (a.talkTime / available) * 100 : 0,
        pausePct: a.loggedIn > 0 ? (a.paused / a.loggedIn) * 100 : 0,
        connectsPerHour: a.hoursWorked > 0 ? a.connects / a.hoursWorked : 0,
        slaPerHour: a.hoursWorked > 0 ? a.sales / a.hoursWorked : 0,
        conversionRate: a.connects > 0 ? (a.sales / a.connects) * 100 : 0,
        avgTalkTimeStr: fmtSec(a.connects > 0 ? Math.round(a.talkTime / a.connects) : 0),
        avgWaitTimeStr: fmtSec(a.connects > 0 ? Math.round(a.waitTime / a.connects) : 0),
        avgWrapUpStr: fmtSec(a.connects > 0 ? Math.round(a.wrapUp / a.connects) : 0),
      };
    });

    return NextResponse.json({ daily: rows, agents, meta: { totalRows: rows.length } });
  } catch (error) {
    console.error('[agent-perf] API error:', error);
    return NextResponse.json({ daily: [], agents: [], meta: { error: error.message } });
  }
}
