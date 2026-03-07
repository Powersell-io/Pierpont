// Daily Email Report — sends new high-value leads every morning
const nodemailer = require('nodemailer');
const db = require('../db/init');
const utils = require('./utils');

const MIN_VALUE = 300000;

// SMTP config — defaults to Mailjet, supports any SMTP provider
// Env vars: MAILJET_API_KEY, MAILJET_SECRET_KEY, EMAIL_FROM, EMAIL_TO
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

function formatCurrency(val) {
  if (!val) return 'N/A';
  return '$' + Number(val).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function buildEmailHtml(leads) {
  const rows = leads.map(lead => `
    <tr style="border-bottom:1px solid #e2e8f0;">
      <td style="padding:10px 12px;font-weight:600;color:#1a202c;">${lead.address || 'N/A'}</td>
      <td style="padding:10px 12px;">${lead.municipality || ''}</td>
      <td style="padding:10px 12px;font-weight:700;color:#2B6CB0;">${formatCurrency(lead.project_value)}</td>
      <td style="padding:10px 12px;">${lead.builder_company || lead.builder_name || 'Unknown'}</td>
      <td style="padding:10px 12px;">${lead.builder_phone || ''}</td>
      <td style="padding:10px 12px;">${lead.builder_email ? `<a href="mailto:${lead.builder_email}" style="color:#2B6CB0;">${lead.builder_email}</a>` : ''}</td>
      <td style="padding:10px 12px;">${lead.owner_name || ''}</td>
      <td style="padding:10px 12px;font-size:12px;color:#718096;">${lead.inspection_date || ''}</td>
    </tr>
  `).join('');

  const totalValue = leads.reduce((sum, l) => sum + (l.project_value || 0), 0);
  const withPhone = leads.filter(l => l.builder_phone).length;
  const withEmail = leads.filter(l => l.builder_email).length;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f7fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:900px;margin:0 auto;padding:20px;">
    <div style="background:linear-gradient(135deg,#1a365d,#2B6CB0);border-radius:12px;padding:24px 28px;margin-bottom:20px;">
      <h1 style="margin:0;color:white;font-size:22px;">Pierpont Daily Leads</h1>
      <p style="margin:6px 0 0;color:rgba(255,255,255,0.8);font-size:14px;">
        ${leads.length} new lead${leads.length !== 1 ? 's' : ''} over ${formatCurrency(MIN_VALUE)} &bull;
        Total value: ${formatCurrency(totalValue)} &bull;
        ${withPhone} with phone &bull; ${withEmail} with email
      </p>
    </div>

    <div style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#edf2f7;">
            <th style="padding:10px 12px;text-align:left;font-weight:600;color:#4a5568;">Address</th>
            <th style="padding:10px 12px;text-align:left;font-weight:600;color:#4a5568;">Municipality</th>
            <th style="padding:10px 12px;text-align:left;font-weight:600;color:#4a5568;">Value</th>
            <th style="padding:10px 12px;text-align:left;font-weight:600;color:#4a5568;">Builder</th>
            <th style="padding:10px 12px;text-align:left;font-weight:600;color:#4a5568;">Phone</th>
            <th style="padding:10px 12px;text-align:left;font-weight:600;color:#4a5568;">Email</th>
            <th style="padding:10px 12px;text-align:left;font-weight:600;color:#4a5568;">Owner</th>
            <th style="padding:10px 12px;text-align:left;font-weight:600;color:#4a5568;">Inspection</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <p style="text-align:center;color:#a0aec0;font-size:11px;margin-top:20px;">
      Pierpont Money Printer &mdash; Automated daily lead report
    </p>
  </div>
</body>
</html>`;
}

async function sendDailyEmail() {
  const transporter = getTransporter();
  if (!transporter) return { sent: false, reason: 'no email config' };

  const to = process.env.EMAIL_TO || process.env.EMAIL_FROM;
  if (!to) {
    utils.log('[Email] No EMAIL_TO configured');
    return { sent: false, reason: 'no recipient' };
  }

  try {
    const leads = await db.getNewHighValueLeads(MIN_VALUE);

    if (leads.length === 0) {
      utils.log('[Email] No new leads over ' + formatCurrency(MIN_VALUE) + ' — skipping email');
      return { sent: false, reason: 'no new leads', count: 0 };
    }

    utils.log(`[Email] Sending ${leads.length} new leads over ${formatCurrency(MIN_VALUE)} to ${to}...`);

    const html = buildEmailHtml(leads);
    const subject = `${leads.length} New Lead${leads.length !== 1 ? 's' : ''} Over ${formatCurrency(MIN_VALUE)} — Pierpont`;

    await transporter.sendMail({
      from: `"Pierpont Money Printer" <${process.env.EMAIL_FROM}>`,
      to,
      subject,
      html,
    });

    // Mark these permits as emailed so they don't get sent again
    await db.markPermitsEmailed(leads.map(l => l.id));

    utils.log(`[Email] Sent ${leads.length} leads to ${to}`);
    return { sent: true, count: leads.length, to };
  } catch (err) {
    utils.log(`[Email] Send failed: ${err.message}`);
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendDailyEmail, buildEmailHtml, MIN_VALUE };
