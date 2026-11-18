// Email adapter for booking notifications.
//
// Mirrors the Google/WhatsApp approach: works with zero configuration so the
// whole flow is testable, and switches to real delivery when credentials exist.
//
//   * MOCK (default) — no SMTP configured, or EMAIL_MODE=mock. Logs the message
//     and returns { mode:'mock' }. Nothing is actually sent.
//   * SMTP (real)    — when SMTP_URL, or SMTP_HOST is set. Sends via nodemailer
//     (lazy-required so mock mode never needs the dependency installed).
//
// Config (env):
//   EMAIL_MODE=mock            force mock even if SMTP is configured
//   SMTP_URL=smtp://user:pass@host:587   full connection string, OR
//   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_SECURE=true
//   EMAIL_FROM="EPR Consultations <no-reply@yourdomain>"

const FROM = process.env.EMAIL_FROM || 'Neubrain Solutions Bookings <no-reply@neubrain.local>';

function isConfigured() {
  if (String(process.env.EMAIL_MODE || '').toLowerCase() === 'mock') return false;
  return !!(process.env.SMTP_URL || process.env.SMTP_HOST);
}

let _transport = null;
function transport() {
  if (_transport) return _transport;
  // Lazy require: only pulled in when actually sending over SMTP.
  const nodemailer = require('nodemailer');
  if (process.env.SMTP_URL) {
    _transport = nodemailer.createTransport(process.env.SMTP_URL);
  } else {
    _transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
      auth: (process.env.SMTP_USER || process.env.SMTP_PASS)
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
  }
  return _transport;
}

/**
 * Send an email. Returns { mode:'mock'|'smtp', messageId? }.
 * @param {{to:string, subject:string, html:string, text:string}} msg
 */
async function sendEmail({ to, subject, html, text }) {
  if (!to) return { skipped: true, reason: 'no_recipient' };
  if (!isConfigured()) {
    console.log(`[email:mock] to=${to} subject="${subject}"`);
    return { mode: 'mock' };
  }
  try {
    const info = await transport().sendMail({ from: FROM, to, subject, text, html });
    return { mode: 'smtp', messageId: info.messageId };
  } catch (err) {
    // Reset a possibly-broken transport so the next call rebuilds it.
    _transport = null;
    throw err;
  }
}

// Minimal, email-client-safe HTML wrapper (inline styles, no external assets).
function renderEmailHtml({ heading, intro, rows = [], meetUrl, footer }) {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rowHtml = rows.map(([k, v]) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#64748b;font-size:14px;white-space:nowrap;vertical-align:top">${esc(k)}</td>` +
    `<td style="padding:4px 0;color:#0f172a;font-size:14px;font-weight:600">${esc(v)}</td></tr>`
  ).join('');
  const button = meetUrl
    ? `<p style="margin:22px 0 6px"><a href="${esc(meetUrl)}" style="background:#16794a;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:700;display:inline-block">Join Google Meet</a></p>`
    : '';
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
    <h1 style="font-size:20px;margin:0 0 8px">${esc(heading)}</h1>
    ${intro ? `<p style="color:#475569;font-size:15px;margin:0 0 16px">${esc(intro)}</p>` : ''}
    <table style="border-collapse:collapse;margin:8px 0">${rowHtml}</table>
    ${button}
    ${footer ? `<p style="color:#94a3b8;font-size:12.5px;margin-top:22px">${esc(footer)}</p>` : ''}
  </div>`;
}

module.exports = { sendEmail, isConfigured, renderEmailHtml };
