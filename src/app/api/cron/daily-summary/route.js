import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { buildDailySummaryEmail } from '@/lib/email-templates';

function getBaseUrl() {
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:' + (process.env.PORT || 3003);
}

export async function GET(request) {
  // Verify cron secret in production
  if (process.env.CRON_SECRET) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const baseUrl = getBaseUrl();
    const now = new Date();
    const etDay = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' })).getDay();
    const isWeeklyDay = etDay === 0 || etDay === 1; // Sunday=0, Monday=1

    // 1. Generate daily summary (always)
    console.log('[cron/daily-summary] Fetching daily summary...');
    const summaryRes = await fetch(`${baseUrl}/api/daily-summary`);
    if (!summaryRes.ok) throw new Error(`Summary API returned ${summaryRes.status}`);
    const summary = await summaryRes.json();
    console.log('[cron/daily-summary] Daily summary generated for:', summary.date);

    // 2. If Sunday or Monday, also generate weekly summary for last week (Mon-Fri)
    let weeklySummary = null;
    if (isWeeklyDay) {
      const fmt = d => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      const today = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      // Last Monday
      const lastMon = new Date(today);
      const daysSinceMon = etDay === 0 ? 6 : etDay === 1 ? 7 : etDay - 1;
      lastMon.setDate(today.getDate() - daysSinceMon);
      // Last Friday
      const lastFri = new Date(lastMon);
      lastFri.setDate(lastMon.getDate() + 4);

      console.log('[cron/daily-summary] Weekly summary:', fmt(lastMon), 'to', fmt(lastFri));
      const weeklyRes = await fetch(`${baseUrl}/api/daily-summary?start=${fmt(lastMon)}&end=${fmt(lastFri)}&mode=weekly`);
      if (weeklyRes.ok) {
        weeklySummary = await weeklyRes.json();
        console.log('[cron/daily-summary] Weekly summary generated');
      }
    }

    // 2. Send email via Resend
    const apiKey = process.env.RESEND_API_KEY;
    const emailTo = process.env.SUMMARY_EMAIL_TO;

    if (!apiKey || !emailTo) {
      console.warn('[cron/daily-summary] RESEND_API_KEY or SUMMARY_EMAIL_TO not set, skipping email');
      return NextResponse.json({
        success: true,
        date: summary.date,
        emailSent: false,
        reason: 'Missing RESEND_API_KEY or SUMMARY_EMAIL_TO',
      });
    }

    const resend = new Resend(apiKey);
    const recipients = emailTo.split(',').map(e => e.trim()).filter(Boolean);
    const fromEmail = process.env.RESEND_FROM || 'TCC Dashboard <onboarding@resend.dev>';

    // Send daily email
    const html = buildDailySummaryEmail(summary);
    const alertCount = (summary.alerts || []).length;
    const redCount = (summary.alerts || []).filter(a => a.status === 'red').length;
    const subjectPrefix = redCount > 0 ? '🔴' : alertCount > 0 ? '🟡' : '🟢';
    const subject = `${subjectPrefix} TCC Daily Summary — ${summary.date} | ${summary.sales.total} apps, ${summary.calls.total} calls, $${(summary.financials.netRevenue || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })} net`;

    const emailResult = await resend.emails.send({
      from: fromEmail,
      to: recipients,
      subject,
      html,
    });

    // Send weekly email if available
    let weeklyEmailResult = null;
    if (weeklySummary) {
      const weeklyHtml = buildDailySummaryEmail(weeklySummary);
      const wAlerts = (weeklySummary.alerts || []).length;
      const wRed = (weeklySummary.alerts || []).filter(a => a.status === 'red').length;
      const wPrefix = wRed > 0 ? '🔴' : wAlerts > 0 ? '🟡' : '🟢';
      const weeklySubject = `${wPrefix} TCC Weekly Summary — ${weeklySummary.startDate} to ${weeklySummary.endDate} | ${weeklySummary.sales.total} apps, ${weeklySummary.calls.total} calls`;

      weeklyEmailResult = await resend.emails.send({
        from: fromEmail,
        to: recipients,
        subject: weeklySubject,
        html: weeklyHtml,
      });
      console.log('[cron/daily-summary] Weekly email sent:', weeklyEmailResult);
    }

    console.log('[cron/daily-summary] Email sent:', emailResult);

    return NextResponse.json({
      success: true,
      date: summary.date,
      emailSent: true,
      emailId: emailResult?.data?.id,
      alertCount,
      redCount,
      weeklyIncluded: !!weeklySummary,
      weeklyEmailId: weeklyEmailResult?.data?.id,
    });
  } catch (err) {
    console.error('[cron/daily-summary] Error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
