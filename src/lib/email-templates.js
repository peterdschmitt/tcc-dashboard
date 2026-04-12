export function buildDailySummaryEmail(summary) {
  const { date, sales, financials, calls, agentPerf, alerts } = summary;
  const fmt = (n, d = 0) => n != null ? n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
  const fmtD = (n, d = 0) => n != null ? (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
  const fmtP = n => n != null ? n.toFixed(1) + '%' : '—';

  const alertColor = s => s === 'red' ? '#f87171' : s === 'yellow' ? '#facc15' : '#4ade80';
  const alertBg = s => s === 'red' ? '#2e0a0a' : s === 'yellow' ? '#2e2a0a' : '#0a2e1a';

  const agentRows = Object.entries(sales.byAgent || {}).map(([name, a]) => `
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #1a2538;color:#f0f3f9;font-size:13px">${name}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #1a2538;color:#f0f3f9;text-align:center">${a.apps}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #1a2538;color:${a.placed > 0 ? '#4ade80' : '#8fa3be'};text-align:center">${a.placed}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #1a2538;color:#4ade80;text-align:right">${fmtD(a.premium)}</td>
    </tr>`).join('');

  const campRows = Object.entries(sales.byCampaign || {}).map(([name, c]) => `
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #1a2538;color:#f0f3f9;font-size:13px">${name}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #1a2538;color:#8fa3be;font-size:12px">${c.vendor || ''}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #1a2538;color:#f0f3f9;text-align:center">${c.calls}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #1a2538;color:#f0f3f9;text-align:center">${c.billable}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #1a2538;color:${c.billableRate > 15 ? '#4ade80' : '#f87171'};text-align:center">${fmtP(c.billableRate)}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #1a2538;color:#facc15;text-align:right">${fmtD(c.spend)}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #1a2538;color:#f0f3f9;text-align:right">${fmtD(c.rpc, 2)}</td>
    </tr>`).join('');

  const alertRows = (alerts || []).map(a => `
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #1a2538;color:${alertColor(a.status)};font-weight:700;font-size:13px">${a.status === 'red' ? '🔴' : '🟡'} ${a.metric}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #1a2538;color:#f0f3f9;text-align:center">${a.agent || '—'}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #1a2538;color:${alertColor(a.status)};text-align:center;font-weight:600">${typeof a.actual === 'number' ? a.actual.toFixed(1) : a.actual}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #1a2538;color:#8fa3be;text-align:center">${a.goal}</td>
    </tr>`).join('');

  const dialerRows = (agentPerf || []).map(a => `
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #1a2538;color:#f0f3f9;font-size:13px">${a.rep}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #1a2538;color:${(a.availPct || 0) >= 70 ? '#4ade80' : '#f87171'};text-align:center">${fmtP(a.availPct)}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #1a2538;color:${(a.pausePct || 0) <= 30 ? '#4ade80' : '#f87171'};text-align:center">${fmtP(a.pausePct)}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #1a2538;color:#f0f3f9;text-align:center">${a.loggedInStr || '—'}</td>
    </tr>`).join('');

  const dashUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3003';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#080b10;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:680px;margin:0 auto;padding:24px">

  <!-- Header -->
  <div style="background:#0f1520;border:1px solid #1a2538;border-radius:12px;padding:20px 24px;margin-bottom:16px">
    <h1 style="margin:0;color:#f0f3f9;font-size:20px;font-weight:700">TCC Daily Summary</h1>
    <p style="margin:4px 0 0;color:#8fa3be;font-size:13px">${date} &middot; ${sales.total} apps &middot; ${fmt(calls.total)} calls &middot; ${fmtD(financials.leadSpend)} spend</p>
  </div>

  <!-- AI Narrative -->
  ${summary.narrative ? `
  <div style="background:#131b28;border:1px solid #1a2538;border-radius:12px;padding:16px 20px;margin-bottom:16px">
    <h2 style="margin:0 0 8px;color:#5b9fff;font-size:14px;font-weight:600">Executive Summary</h2>
    <p style="margin:0;color:#f0f3f9;font-size:13px;line-height:1.6">${summary.narrative}</p>
  </div>` : ''}

  <!-- KPI Cards -->
  <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
    <div style="flex:1;min-width:100px;background:#131b28;border:1px solid #1a2538;border-radius:8px;padding:12px;text-align:center">
      <div style="color:#8fa3be;font-size:10px;text-transform:uppercase;letter-spacing:0.5px">CPA</div>
      <div style="color:#f0f3f9;font-size:20px;font-weight:800;margin-top:4px">${fmtD(financials.cpa)}</div>
    </div>
    <div style="flex:1;min-width:100px;background:#131b28;border:1px solid #1a2538;border-radius:8px;padding:12px;text-align:center">
      <div style="color:#8fa3be;font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Gross Revenue</div>
      <div style="color:#4ade80;font-size:20px;font-weight:800;margin-top:4px">${fmtD(financials.gar)}</div>
    </div>
    <div style="flex:1;min-width:100px;background:#131b28;border:1px solid #1a2538;border-radius:8px;padding:12px;text-align:center">
      <div style="color:#8fa3be;font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Net Revenue</div>
      <div style="color:${financials.netRevenue >= 0 ? '#4ade80' : '#f87171'};font-size:20px;font-weight:800;margin-top:4px">${fmtD(financials.netRevenue)}</div>
    </div>
    <div style="flex:1;min-width:100px;background:#131b28;border:1px solid #1a2538;border-radius:8px;padding:12px;text-align:center">
      <div style="color:#8fa3be;font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Close Rate</div>
      <div style="color:#f0f3f9;font-size:20px;font-weight:800;margin-top:4px">${fmtP(financials.closeRate)}</div>
    </div>
  </div>

  ${alerts.length > 0 ? `
  <!-- Alerts -->
  <div style="background:#131b28;border:1px solid #1a2538;border-radius:12px;padding:16px 20px;margin-bottom:16px">
    <h2 style="margin:0 0 12px;color:#f87171;font-size:14px;font-weight:600">Alerts</h2>
    <table style="width:100%;border-collapse:collapse">
      <tr>
        <th style="padding:6px 12px;color:#8fa3be;font-size:10px;text-transform:uppercase;text-align:left;border-bottom:1px solid #1a2538">Metric</th>
        <th style="padding:6px 12px;color:#8fa3be;font-size:10px;text-transform:uppercase;text-align:center;border-bottom:1px solid #1a2538">Agent</th>
        <th style="padding:6px 12px;color:#8fa3be;font-size:10px;text-transform:uppercase;text-align:center;border-bottom:1px solid #1a2538">Actual</th>
        <th style="padding:6px 12px;color:#8fa3be;font-size:10px;text-transform:uppercase;text-align:center;border-bottom:1px solid #1a2538">Goal</th>
      </tr>
      ${alertRows}
    </table>
  </div>` : ''}

  <!-- Sales by Agent -->
  <div style="background:#131b28;border:1px solid #1a2538;border-radius:12px;padding:16px 20px;margin-bottom:16px">
    <h2 style="margin:0 0 12px;color:#5b9fff;font-size:14px;font-weight:600">Sales by Agent</h2>
    <table style="width:100%;border-collapse:collapse">
      <tr>
        <th style="padding:6px 12px;color:#8fa3be;font-size:10px;text-transform:uppercase;text-align:left;border-bottom:1px solid #1a2538">Agent</th>
        <th style="padding:6px 12px;color:#8fa3be;font-size:10px;text-transform:uppercase;text-align:center;border-bottom:1px solid #1a2538">Apps</th>
        <th style="padding:6px 12px;color:#8fa3be;font-size:10px;text-transform:uppercase;text-align:center;border-bottom:1px solid #1a2538">Placed</th>
        <th style="padding:6px 12px;color:#8fa3be;font-size:10px;text-transform:uppercase;text-align:right;border-bottom:1px solid #1a2538">Premium</th>
      </tr>
      ${agentRows}
    </table>
  </div>

  <!-- Calls by Campaign -->
  <div style="background:#131b28;border:1px solid #1a2538;border-radius:12px;padding:16px 20px;margin-bottom:16px">
    <h2 style="margin:0 0 12px;color:#5b9fff;font-size:14px;font-weight:600">Calls by Campaign</h2>
    <table style="width:100%;border-collapse:collapse">
      <tr>
        <th style="padding:6px 12px;color:#8fa3be;font-size:10px;text-transform:uppercase;text-align:left;border-bottom:1px solid #1a2538">Campaign</th>
        <th style="padding:6px 12px;color:#8fa3be;font-size:10px;text-transform:uppercase;text-align:left;border-bottom:1px solid #1a2538">Vendor</th>
        <th style="padding:6px 12px;color:#8fa3be;font-size:10px;text-transform:uppercase;text-align:center;border-bottom:1px solid #1a2538">Calls</th>
        <th style="padding:6px 12px;color:#8fa3be;font-size:10px;text-transform:uppercase;text-align:center;border-bottom:1px solid #1a2538">Billable</th>
        <th style="padding:6px 12px;color:#8fa3be;font-size:10px;text-transform:uppercase;text-align:center;border-bottom:1px solid #1a2538">Bill %</th>
        <th style="padding:6px 12px;color:#8fa3be;font-size:10px;text-transform:uppercase;text-align:right;border-bottom:1px solid #1a2538">Spend</th>
        <th style="padding:6px 12px;color:#8fa3be;font-size:10px;text-transform:uppercase;text-align:right;border-bottom:1px solid #1a2538">RPC</th>
      </tr>
      ${campRows}
    </table>
  </div>

  ${dialerRows ? `
  <!-- Agent Dialer -->
  <div style="background:#131b28;border:1px solid #1a2538;border-radius:12px;padding:16px 20px;margin-bottom:16px">
    <h2 style="margin:0 0 12px;color:#5b9fff;font-size:14px;font-weight:600">Agent Dialer Performance</h2>
    <table style="width:100%;border-collapse:collapse">
      <tr>
        <th style="padding:6px 12px;color:#8fa3be;font-size:10px;text-transform:uppercase;text-align:left;border-bottom:1px solid #1a2538">Agent</th>
        <th style="padding:6px 12px;color:#8fa3be;font-size:10px;text-transform:uppercase;text-align:center;border-bottom:1px solid #1a2538">Avail %</th>
        <th style="padding:6px 12px;color:#8fa3be;font-size:10px;text-transform:uppercase;text-align:center;border-bottom:1px solid #1a2538">Pause %</th>
        <th style="padding:6px 12px;color:#8fa3be;font-size:10px;text-transform:uppercase;text-align:center;border-bottom:1px solid #1a2538">Logged In</th>
      </tr>
      ${dialerRows}
    </table>
  </div>` : ''}

  <!-- Footer -->
  <div style="text-align:center;padding:16px">
    <a href="${dashUrl}" style="color:#5b9fff;font-size:13px;text-decoration:none">Open Dashboard →</a>
    <p style="color:#8fa3be;font-size:11px;margin-top:8px">Generated ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}</p>
  </div>

</div>
</body>
</html>`;
}
