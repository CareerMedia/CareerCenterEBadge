const nodemailer = require('nodemailer');
const { normalizeUrl, hasConfiguredPublicUrl, escapeHtml, escapeAttribute, appendEmailLogLine, appendAppErrorLog } = require('./store');
const { queuePushLocalData } = require('./github-sync');

const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';

function normalizeSecret(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .trim()
    .replace(/^["']+|["']+$/g, '');
}

function getBrevoApiKey(siteConfig) {
  const fromEnv = normalizeSecret(process.env.BREVO_API_KEY);
  if (fromEnv) {
    return fromEnv;
  }
  return normalizeSecret((siteConfig && siteConfig.emailBrevoApiKey) || '');
}

function getSmtpCredentials() {
  return {
    login: normalizeSecret(process.env.BREVO_SMTP_LOGIN),
    password: normalizeSecret(process.env.BREVO_SMTP_PASSWORD)
  };
}

function getEmailTransport(siteConfig) {
  return String((siteConfig && siteConfig.emailBrevoTransport) || 'api').toLowerCase() === 'smtp' ? 'smtp' : 'api';
}

function isAwardEmailActive(siteConfig) {
  if (!siteConfig) {
    return false;
  }
  if (siteConfig.emailBrevoEnabled === true) {
    return true;
  }
  const envApi = Boolean(normalizeSecret(process.env.BREVO_API_KEY));
  const sender = String(siteConfig.emailBrevoSenderEmail || '').trim();
  return Boolean(envApi && sender);
}

function getAbsoluteBadgeUrl(siteConfig, badge) {
  const slug = String((badge && badge.slug) || '').trim();
  if (!slug) {
    return '';
  }
  const stored = String((badge && badge.publicUrl) || '').trim();
  if (/^https?:\/\//i.test(stored)) {
    return stored;
  }
  const base = normalizeUrl((siteConfig && siteConfig.publicSiteUrl) || '');
  if (base && hasConfiguredPublicUrl(siteConfig)) {
    return `${base}/badges/${slug}/`;
  }
  return stored || `/badges/${slug}/`;
}

function safeLinkHref(url) {
  const u = String(url || '').trim();
  return /^https?:\/\//i.test(u) ? u : '';
}

function buildAwardEmailContent({ recipientName, badgeName, badgeUrl }) {
  const subject = `Your ${badgeName} Badge Has Been Awarded`;
  const safeName = escapeHtml(recipientName);
  const safeBadge = escapeHtml(badgeName);
  const safeUrlText = escapeHtml(badgeUrl);
  const href = safeLinkHref(badgeUrl);
  const hrefAttr = href ? escapeAttribute(href) : '';
  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /></head>
<body style="font-family: Georgia, 'Times New Roman', serif; line-height: 1.6; color: #222;">
  <p>Hello ${safeName},</p>
  <p>Congratulations on earning the <strong>${safeBadge} Badge</strong> and successfully completing all of the required steps to achieve it. This accomplishment reflects your dedication, effort, and commitment to your professional growth, and we are excited to celebrate this milestone with you.</p>
  <p>Your official e-badge is included below and is now ready for you to use. You can proudly display it on LinkedIn, add it to your digital portfolio, or share it across your social media platforms to highlight your achievement and showcase your continued career development.</p>
  <p>We hope this badge serves as both a recognition of what you have accomplished and a reminder to keep building momentum as you continue your journey toward success.</p>
  <p><strong>Badge:</strong> ${hrefAttr ? `<a href="${hrefAttr}">${safeUrlText}</a>` : safeUrlText}</p>
  <p>Rise like a Matador.</p>
  <p>Best regards,<br />CSUN Career Center</p>
</body>
</html>`;

  const textContent = [
    `Hello ${recipientName},`,
    '',
    `Congratulations on earning the ${badgeName} Badge and successfully completing all of the required steps to achieve it. This accomplishment reflects your dedication, effort, and commitment to your professional growth, and we are excited to celebrate this milestone with you.`,
    '',
    'Your official e-badge is included below and is now ready for you to use. You can proudly display it on LinkedIn, add it to your digital portfolio, or share it across your social media platforms to highlight your achievement and showcase your continued career development.',
    '',
    'We hope this badge serves as both a recognition of what you have accomplished and a reminder to keep building momentum as you continue your journey toward success.',
    '',
    `Badge: ${badgeUrl}`,
    '',
    'Rise like a Matador.',
    '',
    'Best regards,',
    'CSUN Career Center'
  ].join('\n');

  return { subject, htmlContent, textContent };
}

async function sendBadgeAwardedEmailViaApi(siteConfig, payload) {
  const apiKey = getBrevoApiKey(siteConfig);
  if (!apiKey) {
    return { skipped: true, reason: 'no_api_key', transport: 'api' };
  }
  const response = await fetch(BREVO_SEND_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': apiKey
    },
    body: JSON.stringify(payload)
  });

  const raw = await response.text();
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const message = (parsed && (parsed.message || parsed.error)) || raw || response.statusText;
    throw new Error(`Brevo API ${response.status}: ${message}`);
  }

  return { ok: true, messageId: parsed && parsed.messageId, transport: 'api' };
}

async function sendBadgeAwardedEmailViaSmtp(siteConfig, mail) {
  const { login, password } = getSmtpCredentials();
  if (!login || !password) {
    return { skipped: true, reason: 'no_smtp_credentials', transport: 'smtp' };
  }
  const host = normalizeSecret(process.env.BREVO_SMTP_HOST) || 'smtp-relay.brevo.com';
  const port = Number(process.env.BREVO_SMTP_PORT) || 587;
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user: login, pass: password }
  });

  const mailOptions = {
    from: `"${mail.senderName}" <${mail.senderEmail}>`,
    to: `"${mail.recipientName}" <${mail.toEmail}>`,
    subject: mail.subject,
    text: mail.textContent,
    html: mail.htmlContent
  };
  if (mail.replyTo) {
    mailOptions.replyTo = mail.replyTo;
  }

  const info = await transporter.sendMail(mailOptions);
  return { ok: true, messageId: info && info.messageId, transport: 'smtp' };
}

async function sendBadgeAwardedEmail(siteConfig, badge) {
  const transport = getEmailTransport(siteConfig);
  if (!isAwardEmailActive(siteConfig)) {
    return { skipped: true, reason: 'disabled', transport: transport };
  }

  const senderEmail = String(siteConfig.emailBrevoSenderEmail || '').trim().toLowerCase();
  if (!senderEmail) {
    return { skipped: true, reason: 'no_sender_email', transport };
  }
  const toEmail = String((badge && badge.awardeeEmail) || '').trim().toLowerCase();
  if (!toEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
    return { skipped: true, reason: 'invalid_recipient', transport };
  }

  if (transport === 'smtp') {
    const { login, password } = getSmtpCredentials();
    if (!login || !password) {
      return { skipped: true, reason: 'no_smtp_credentials', transport: 'smtp' };
    }
  } else if (!getBrevoApiKey(siteConfig)) {
    return { skipped: true, reason: 'no_api_key', transport: 'api' };
  }

  const senderName = String(siteConfig.emailBrevoSenderName || 'CSUN Career Center').trim() || 'CSUN Career Center';
  const recipientName = String((badge && badge.awardeeName) || '').trim() || 'Recipient';
  const badgeName = String((badge && badge.badgeTitle) || '').trim() || 'E-Badge';
  const badgeUrl = getAbsoluteBadgeUrl(siteConfig, badge);
  const { subject, htmlContent, textContent } = buildAwardEmailContent({
    recipientName,
    badgeName,
    badgeUrl: badgeUrl || '(link unavailable — set Public site URL in Settings)'
  });

  const replyToRaw = String(siteConfig.emailBrevoReplyTo || '').trim().toLowerCase();
  const replyTo = replyToRaw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyToRaw) ? replyToRaw : '';

  if (transport === 'smtp') {
    return sendBadgeAwardedEmailViaSmtp(siteConfig, {
      senderName,
      senderEmail,
      recipientName,
      toEmail,
      subject,
      textContent,
      htmlContent,
      replyTo
    });
  }

  const payload = {
    sender: {
      name: senderName.slice(0, 70),
      email: senderEmail
    },
    to: [{ email: toEmail, name: recipientName.slice(0, 200) }],
    subject,
    htmlContent,
    textContent,
    tags: ['badge-issued', 'csun-ebadges']
  };

  if (replyTo) {
    payload.replyTo = { email: replyTo, name: senderName.slice(0, 70) };
  }

  return sendBadgeAwardedEmailViaApi(siteConfig, payload);
}

function buildEmailLogEntry(siteConfig, badge, result, errorMessage = '') {
  const transport = (result && result.transport) || getEmailTransport(siteConfig);
  const badgeId = (badge && badge.id) || '';
  const badgeTitle = (badge && badge.badgeTitle) || '';
  const toEmail = String((badge && badge.awardeeEmail) || '').trim().toLowerCase();
  const subject = `Your ${badgeTitle || 'E-Badge'} Badge Has Been Awarded`;
  if (errorMessage) {
    return {
      badgeId,
      badgeTitle,
      to: toEmail,
      subject,
      status: 'error',
      reason: 'send_failed',
      transport,
      messageId: '',
      errorMessage
    };
  }
  if (result && result.skipped) {
    return {
      badgeId,
      badgeTitle,
      to: toEmail,
      subject,
      status: 'skipped',
      reason: result.reason || 'skipped',
      transport,
      messageId: '',
      errorMessage: ''
    };
  }
  return {
    badgeId,
    badgeTitle,
    to: toEmail,
    subject,
    status: 'success',
    reason: '',
    transport,
    messageId: String((result && result.messageId) || ''),
    errorMessage: ''
  };
}

function queueBadgeAwardedEmail(loadSiteConfig, badge) {
  if (!badge || !loadSiteConfig) {
    return;
  }
  void (async () => {
    const siteConfig = loadSiteConfig();
    let result = null;
    let errorMessage = '';
    try {
      result = await sendBadgeAwardedEmail(siteConfig, badge);
    } catch (error) {
      errorMessage = error.message || String(error);
      result = { skipped: false, transport: getEmailTransport(siteConfig) };
    }
    try {
      appendEmailLogLine(buildEmailLogEntry(siteConfig, badge, result, errorMessage));
    } catch (logError) {
      console.warn(`Email log write failed: ${logError.message}`);
    }
    try {
      await queuePushLocalData('Update email activity log');
    } catch (syncError) {
      console.warn(`Email log GitHub sync failed: ${syncError.message}`);
      appendAppErrorLog({
        severity: 'warning',
        source: 'email_log_github_sync',
        message: syncError.message || String(syncError),
        stack: syncError.stack || '',
        context: badge && badge.id ? `badgeId:${badge.id}` : ''
      });
    }
    if (errorMessage) {
      console.warn(`Brevo badge email failed for ${badge.id || badge.slug || 'unknown'}: ${errorMessage}`);
    }
  })();
}

function hasSmtpCredentialsConfigured() {
  const { login, password } = getSmtpCredentials();
  return Boolean(login && password);
}

module.exports = {
  sendBadgeAwardedEmail,
  queueBadgeAwardedEmail,
  getBrevoApiKey,
  getAbsoluteBadgeUrl,
  isAwardEmailActive,
  getEmailTransport,
  hasSmtpCredentialsConfigured
};
