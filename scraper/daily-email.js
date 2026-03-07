// Daily Email Report — sends new high-value leads every morning via Mailjet
const nodemailer = require('nodemailer');
const db = require('../db/init');
const utils = require('./utils');

const MIN_VALUE = 300000;

function getTransporter() {
  const apiKey = process.env.MAILJET_API_KEY;
  const secretKey = process.env.MAILJET_SECRET_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !secretKey || !from) {
    utils.log('[Email] Missing MAILJET_API_KEY, MAILJET_SECRET_KEY, or EMAIL_FROM — email disabled');
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.EMAIL_SMTP_HOST || 'in-v3.mailjet.com',
    port: parseInt(process.env.EMAIL_SMTP_PORT || '587'),
    secure: false,
    auth: { user: apiKey, pass: secretKey },
  });
}

function fmt(val) {
  if (!val && val !== 0) return '';
  return '$' + Number(val).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtDate(d) {
  if (!d) return '';
  try {
    const dt = new Date(d);
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return d; }
}

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Build CSV content for attachment
function buildCsv(leads) {
  const headers = ['Address', 'Municipality', 'Value', 'Builder', 'Phone', 'Email', 'Owner', 'Inspection Type', 'Inspection Date', 'Permit #'];
  const rows = leads.map(l => [
    `"${(l.address || '').replace(/"/g, '""')}"`,
    `"${(l.municipality || '').replace(/"/g, '""')}"`,
    l.project_value || '',
    `"${(l.builder_company || l.builder_name || '').replace(/"/g, '""')}"`,
    `"${(l.builder_phone || '').replace(/"/g, '""')}"`,
    `"${(l.builder_email || '').replace(/"/g, '""')}"`,
    `"${(l.owner_name || '').replace(/"/g, '""')}"`,
    `"${(l.inspection_type || '').replace(/"/g, '""')}"`,
    l.inspection_date || '',
    `"${(l.permit_number || '').replace(/"/g, '""')}"`,
  ].join(','));
  return [headers.join(','), ...rows].join('\n');
}

function buildEmailHtml(leads, isFirstRun) {
  const totalValue = leads.reduce((sum, l) => sum + (l.project_value || 0), 0);
  const withPhone = leads.filter(l => l.builder_phone).length;
  const withEmail = leads.filter(l => l.builder_email).length;
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  const headerText = isFirstRun
    ? `Full Pipeline — ${leads.length} Active Leads`
    : `${leads.length} New Lead${leads.length !== 1 ? 's' : ''} Since Last Report`;

  const rows = leads.map((l, i) => {
    const bg = i % 2 === 0 ? '#ffffff' : '#f8fafc';
    const builder = escHtml(l.builder_company || l.builder_name || '');
    const phone = l.builder_phone || '';
    const email = l.builder_email || '';
    const phoneLink = phone ? `<a href="tel:${phone.replace(/[^\d+]/g, '')}" style="color:#2B6CB0;text-decoration:none;">${escHtml(phone)}</a>` : '<span style="color:#cbd5e0;">—</span>';
    const emailLink = email ? `<a href="mailto:${email}" style="color:#2B6CB0;text-decoration:none;">${escHtml(email)}</a>` : '<span style="color:#cbd5e0;">—</span>';

    return `
    <tr style="background:${bg};">
      <td style="padding:12px 14px;border-bottom:1px solid #edf2f7;">
        <div style="font-weight:600;color:#1a202c;font-size:14px;">${escHtml(l.address || 'N/A')}</div>
        <div style="font-size:11px;color:#a0aec0;margin-top:2px;">${escHtml(l.municipality || '')} &bull; ${escHtml(l.permit_number || '')}</div>
      </td>
      <td style="padding:12px 14px;border-bottom:1px solid #edf2f7;text-align:right;">
        <div style="font-weight:700;color:#2B6CB0;font-size:16px;">${fmt(l.project_value)}</div>
      </td>
      <td style="padding:12px 14px;border-bottom:1px solid #edf2f7;">
        <div style="font-weight:500;color:#2d3748;">${builder || '<span style="color:#cbd5e0;">Unknown</span>'}</div>
        <div style="font-size:12px;margin-top:3px;">${phoneLink}</div>
        <div style="font-size:12px;margin-top:1px;">${emailLink}</div>
      </td>
      <td style="padding:12px 14px;border-bottom:1px solid #edf2f7;">
        <div style="font-size:13px;color:#4a5568;">${escHtml(l.owner_name || '')}</div>
      </td>
      <td style="padding:12px 14px;border-bottom:1px solid #edf2f7;">
        <div style="font-size:12px;color:#4a5568;">${escHtml(l.inspection_type || '')}</div>
        <div style="font-size:11px;color:#a0aec0;margin-top:2px;">${fmtDate(l.inspection_date)}</div>
        <div style="font-size:11px;color:${l.inspection_status && l.inspection_status.toLowerCase().includes('pass') ? '#38a169' : '#e53e3e'};font-weight:600;margin-top:1px;">${escHtml(l.inspection_status || '')}</div>
      </td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:800px;margin:0 auto;padding:16px;">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 50%,#2B6CB0 100%);border-radius:14px;padding:28px 32px;margin-bottom:16px;">
      <h1 style="margin:0;color:white;font-size:24px;font-weight:700;letter-spacing:-0.3px;">Pierpont Money Printer</h1>
      <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:15px;">${headerText}</p>
      <p style="margin:4px 0 0;color:rgba(255,255,255,0.6);font-size:12px;">${today}</p>
    </div>

    <!-- Stats bar -->
    <div style="display:flex;gap:10px;margin-bottom:16px;">
      <div style="flex:1;background:white;border-radius:10px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#a0aec0;font-weight:600;">Leads</div>
        <div style="font-size:22px;font-weight:700;color:#1a202c;">${leads.length}</div>
      </div>
      <div style="flex:1;background:white;border-radius:10px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#a0aec0;font-weight:600;">Total Value</div>
        <div style="font-size:22px;font-weight:700;color:#2B6CB0;">${fmt(totalValue)}</div>
      </div>
      <div style="flex:1;background:white;border-radius:10px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#a0aec0;font-weight:600;">w/ Phone</div>
        <div style="font-size:22px;font-weight:700;color:#38a169;">${withPhone}</div>
      </div>
      <div style="flex:1;background:white;border-radius:10px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#a0aec0;font-weight:600;">w/ Email</div>
        <div style="font-size:22px;font-weight:700;color:#2B6CB0;">${withEmail}</div>
      </div>
    </div>

    <!-- Leads table -->
    <div style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#1a365d;">
            <th style="padding:12px 14px;text-align:left;font-weight:600;color:white;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Property</th>
            <th style="padding:12px 14px;text-align:right;font-weight:600;color:white;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Value</th>
            <th style="padding:12px 14px;text-align:left;font-weight:600;color:white;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Builder / Contact</th>
            <th style="padding:12px 14px;text-align:left;font-weight:600;color:white;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Owner</th>
            <th style="padding:12px 14px;text-align:left;font-weight:600;color:white;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Inspection</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <p style="text-align:center;color:#a0aec0;font-size:11px;margin-top:20px;">
      Pierpont Money Printer &mdash; CSV attached for your records
    </p>
  </div>
</body>
</html>`;
}

/**
 * Send the daily email.
 * Options:
 *   fullRun: true  — send ALL leads >= $300k (first run / reset)
 *   fullRun: false — send only un-emailed leads (daily incremental)
 */
async function sendDailyEmail({ fullRun = false } = {}) {
  const transporter = getTransporter();
  if (!transporter) return { sent: false, reason: 'no email config' };

  const to = process.env.EMAIL_TO || process.env.EMAIL_FROM;
  if (!to) {
    utils.log('[Email] No EMAIL_TO configured');
    return { sent: false, reason: 'no recipient' };
  }

  try {
    let leads;
    if (fullRun) {
      // First run: get ALL leads >= $300k regardless of emailed_at
      leads = await db.getAllHighValueLeads(MIN_VALUE);
    } else {
      // Incremental: only un-emailed leads
      leads = await db.getNewHighValueLeads(MIN_VALUE);
    }

    if (leads.length === 0) {
      utils.log('[Email] No ' + (fullRun ? '' : 'new ') + 'leads over ' + fmt(MIN_VALUE) + ' — skipping email');
      return { sent: false, reason: 'no leads', count: 0 };
    }

    const today = new Date();
    const dateStr = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    // Group by inspection type for subject line
    const types = {};
    for (const l of leads) {
      const t = (l.inspection_type || 'Unknown').replace(/^Residential\s+/i, '').replace(/^Commercial\s+/i, '');
      types[t] = (types[t] || 0) + 1;
    }
    const topType = Object.entries(types).sort((a, b) => b[1] - a[1])[0];
    const typeLabel = topType ? topType[0] : 'Building';

    const subject = fullRun
      ? `${typeLabel} Inspections Passed — Full Pipeline ${dateStr} — ${leads.length} Leads`
      : `${typeLabel} Inspections Passed — ${dateStr} — ${leads.length} New Lead${leads.length !== 1 ? 's' : ''}`;

    utils.log(`[Email] Sending ${leads.length} leads to ${to} (${fullRun ? 'full run' : 'incremental'})...`);

    const html = buildEmailHtml(leads, fullRun);
    const csv = buildCsv(leads);
    const csvFilename = `pierpont-leads-${today.toISOString().slice(0, 10)}.csv`;

    await transporter.sendMail({
      from: `"Pierpont Money Printer" <${process.env.EMAIL_FROM}>`,
      to,
      subject,
      html,
      attachments: [{
        filename: csvFilename,
        content: csv,
        contentType: 'text/csv',
      }],
    });

    // Mark these permits as emailed
    await db.markPermitsEmailed(leads.map(l => l.id));

    utils.log(`[Email] Sent ${leads.length} leads to ${to}`);
    return { sent: true, count: leads.length, to, subject };
  } catch (err) {
    utils.log(`[Email] Send failed: ${err.message}`);
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendDailyEmail, buildEmailHtml, buildCsv, MIN_VALUE };
