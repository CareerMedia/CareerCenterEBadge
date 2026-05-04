const nodemailer = require('nodemailer');
const { normalizeUrl, hasConfiguredPublicUrl, escapeHtml, escapeAttribute, appendEmailLogLine, appendAppErrorLog } = require('./store');
const { queuePushLocalData } = require('./github-sync');

const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';
const BREVO_ACCOUNT_URL = 'https://api.brevo.com/v3/account';

/** Documented placeholders for the Email admin UI (token → meaning). */
const AWARD_EMAIL_TEMPLATE_TAGS = [
  { token: '{recipient-name}', description: 'Awardee full name' },
  { token: '{badge-name}', description: 'Badge title' },
  { token: '{badge-link}', description: 'Public badge URL (HTML version becomes a clickable link)' },
  { token: '{badge-id}', description: 'Credential / badge ID (e.g. CSUNCC-…)' },
  { token: '{sender-name}', description: 'Sender display name from Email settings' },
  { token: '{site-name}', description: 'Site name from Settings' },
  { token: '{organization-name}', description: 'Organization name from Settings' },
  { token: '{support-email}', description: 'Support email from Settings' }
];

function normalizeSecret(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .trim()
    .replace(/^["']+|["']+$/g, '');
}

/** Normalize a Brevo REST API key from env or pasted input (does not log the key). */
function normalizeBrevoApiKey(value) {
  let s = String(value || '')
    .replace(/^\uFEFF/, '')
    .replace(/\u200B|\u200C|\u200D/g, '')
    .trim();
  s = s.replace(/^["']+|["']+$/g, '');
  s = s.replace(/^bearer\s+/i, '').trim();
  s = s.replace(/[\r\n\t\f\v\u00a0\u2028\u2029]/g, '');
  return s.trim();
}

/**
 * REST keys are read only from host env, in this order (Render: use BREVO_API_KEY).
 * SENDINBLUE_API_KEY is legacy naming for the same Brevo product.
 */
function getHostEnvBrevoKeyMeta() {
  const tryNames = ['BREVO_API_KEY', 'SENDINBLUE_API_KEY'];
  for (const varName of tryNames) {
    const key = normalizeBrevoApiKey(process.env[varName]);
    if (key) {
      return { key, varName };
    }
  }
  return { key: '', varName: '' };
}

function getBrevoApiKey(siteConfig) {
  const host = getHostEnvBrevoKeyMeta();
  if (host.key) {
    return host.key;
  }
  return normalizeBrevoApiKey((siteConfig && siteConfig.emailBrevoApiKey) || '');
}

/** Where the REST API key came from for logging (never logs the key itself). */
function getBrevoApiKeySource(siteConfig) {
  if (getHostEnvBrevoKeyMeta().key) {
    return 'env';
  }
  if (normalizeBrevoApiKey((siteConfig && siteConfig.emailBrevoApiKey) || '')) {
    return 'stored';
  }
  return 'none';
}

function getBrevoHostEnvVarName() {
  return getHostEnvBrevoKeyMeta().varName || '';
}

function envVarRawTrimmedLength(name) {
  if (!name || !Object.prototype.hasOwnProperty.call(process.env, name)) {
    return 0;
  }
  return String(process.env[name] || '').trim().length;
}

function getBrevoHostEnvDiagnostics() {
  const meta = getHostEnvBrevoKeyMeta();
  return {
    hostKeyActive: Boolean(meta.key),
    hostKeyVarName: meta.varName || '',
    hostKeyLength: meta.key ? meta.key.length : 0,
    brevoVarPresent: envVarRawTrimmedLength('BREVO_API_KEY') > 0,
    sendinblueVarPresent: envVarRawTrimmedLength('SENDINBLUE_API_KEY') > 0
  };
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
  const envApi = Boolean(getHostEnvBrevoKeyMeta().key);
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

function sanitizeOneLine(value) {
  return String(value || '')
    .replace(/[\r\n\u2028\u2029]+/g, ' ')
    .trim();
}

function getBuiltinAwardEmailTemplates() {
  const subject = 'Your {badge-name} Badge Has Been Awarded';
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /></head>
<body style="font-family: Georgia, 'Times New Roman', serif; line-height: 1.6; color: #222;">
  <p>Hello {recipient-name},</p>
  <p>Congratulations on earning the <strong>{badge-name} Badge</strong> and successfully completing all of the required steps to achieve it. This accomplishment reflects your dedication, effort, and commitment to your professional growth, and we are excited to celebrate this milestone with you.</p>
  <p>Your official e-badge is included below and is now ready for you to use. You can proudly display it on LinkedIn, add it to your digital portfolio, or share it across your social media platforms to highlight your achievement and showcase your continued career development.</p>
  <p>We hope this badge serves as both a recognition of what you have accomplished and a reminder to keep building momentum as you continue your journey toward success.</p>
  <p><strong>Badge:</strong> {badge-link}</p>
  <p>Rise like a Matador.</p>
  <p>Best regards,<br />{sender-name}</p>
</body>
</html>`;
  const text = [
    'Hello {recipient-name},',
    '',
    'Congratulations on earning the {badge-name} Badge and successfully completing all of the required steps to achieve it. This accomplishment reflects your dedication, effort, and commitment to your professional growth, and we are excited to celebrate this milestone with you.',
    '',
    'Your official e-badge is included below and is now ready for you to use. You can proudly display it on LinkedIn, add it to your digital portfolio, or share it across your social media platforms to highlight your achievement and showcase your continued career development.',
    '',
    'We hope this badge serves as both a recognition of what you have accomplished and a reminder to keep building momentum as you continue your journey toward success.',
    '',
    'Badge: {badge-link}',
    '',
    'Rise like a Matador.',
    '',
    'Best regards,',
    '{sender-name}'
  ].join('\n');
  return { subject, html, text };
}

function resolveAwardEmailTemplates(siteConfig) {
  const b = getBuiltinAwardEmailTemplates();
  const subject = String((siteConfig && siteConfig.emailAwardSubjectTemplate) || '').trim();
  const html = String((siteConfig && siteConfig.emailAwardHtmlTemplate) || '').trim();
  const text = String((siteConfig && siteConfig.emailAwardTextTemplate) || '').trim();
  return {
    subjectTpl: subject || b.subject,
    htmlTpl: html || b.html,
    textTpl: text || b.text
  };
}

function buildAwardTokenContext(siteConfig, { recipientName, badgeName, badgeUrl, badgeId }) {
  const senderName = String((siteConfig && siteConfig.emailBrevoSenderName) || 'CSUN Career Center').trim() || 'CSUN Career Center';
  return {
    recipientName: String(recipientName || '').trim() || 'Recipient',
    badgeName: String(badgeName || '').trim() || 'E-Badge',
    badgeUrl: String(badgeUrl || ''),
    badgeId: String(badgeId || '').trim(),
    senderName,
    siteName: String((siteConfig && siteConfig.siteName) || '').trim(),
    organizationName: String((siteConfig && siteConfig.organizationName) || '').trim(),
    supportEmail: String((siteConfig && siteConfig.supportEmail) || '').trim()
  };
}

function applyPlainAwardTemplate(template, ctx) {
  let s = String(template || '');
  s = s.replace(/\{recipient-name\}/gi, ctx.recipientName);
  s = s.replace(/\{badge-name\}/gi, ctx.badgeName);
  s = s.replace(/\{badge-link\}/gi, ctx.badgeUrl);
  s = s.replace(/\{badge-id\}/gi, ctx.badgeId);
  s = s.replace(/\{sender-name\}/gi, ctx.senderName);
  s = s.replace(/\{site-name\}/gi, ctx.siteName);
  s = s.replace(/\{organization-name\}/gi, ctx.organizationName);
  s = s.replace(/\{support-email\}/gi, ctx.supportEmail);
  return s;
}

function applyHtmlAwardTemplate(template, ctx) {
  const href = safeLinkHref(ctx.badgeUrl);
  const linkHtml = href
    ? `<a href="${escapeAttribute(href)}">${escapeHtml(ctx.badgeUrl)}</a>`
    : escapeHtml(ctx.badgeUrl);
  let s = String(template || '');
  s = s.replace(/\{badge-link\}/gi, linkHtml);
  s = s.replace(/\{recipient-name\}/gi, escapeHtml(ctx.recipientName));
  s = s.replace(/\{badge-name\}/gi, escapeHtml(ctx.badgeName));
  s = s.replace(/\{badge-id\}/gi, escapeHtml(ctx.badgeId));
  s = s.replace(/\{sender-name\}/gi, escapeHtml(ctx.senderName));
  s = s.replace(/\{site-name\}/gi, escapeHtml(ctx.siteName));
  s = s.replace(/\{organization-name\}/gi, escapeHtml(ctx.organizationName));
  s = s.replace(/\{support-email\}/gi, escapeHtml(ctx.supportEmail));
  return s;
}

function applySubjectAwardTemplate(template, ctx) {
  const lineCtx = {
    ...ctx,
    recipientName: sanitizeOneLine(ctx.recipientName),
    badgeName: sanitizeOneLine(ctx.badgeName),
    badgeUrl: sanitizeOneLine(ctx.badgeUrl),
    badgeId: sanitizeOneLine(ctx.badgeId),
    senderName: sanitizeOneLine(ctx.senderName),
    siteName: sanitizeOneLine(ctx.siteName),
    organizationName: sanitizeOneLine(ctx.organizationName),
    supportEmail: sanitizeOneLine(ctx.supportEmail)
  };
  return sanitizeOneLine(applyPlainAwardTemplate(template, lineCtx)).slice(0, 998);
}

function buildAwardEmailContent(siteConfig, { recipientName, badgeName, badgeUrl, badgeId }) {
  const ctx = buildAwardTokenContext(siteConfig, { recipientName, badgeName, badgeUrl, badgeId });
  const { subjectTpl, htmlTpl, textTpl } = resolveAwardEmailTemplates(siteConfig);
  return {
    subject: applySubjectAwardTemplate(subjectTpl, ctx),
    htmlContent: applyHtmlAwardTemplate(htmlTpl, ctx),
    textContent: applyPlainAwardTemplate(textTpl, ctx)
  };
}

async function verifyBrevoRestApiKey(apiKey) {
  const key = normalizeBrevoApiKey(apiKey);
  if (!key) {
    throw new Error('No API key to verify.');
  }
  let response;
  try {
    response = await fetch(BREVO_ACCOUNT_URL, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'api-key': key
      }
    });
  } catch (networkErr) {
    throw new Error(
      `Could not reach Brevo to verify the key: ${(networkErr && networkErr.message) || String(networkErr)}`
    );
  }
  const raw = await response.text();
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    const message = (parsed && (parsed.message || parsed.error)) || raw || response.statusText;
    throw new Error(`HTTP ${response.status}: ${message}`);
  }
  return { ok: true };
}

function truncateForEmailLog(text, maxLen = 1800) {
  const s = String(text || '');
  if (s.length <= maxLen) {
    return s;
  }
  return `${s.slice(0, maxLen)}…`;
}

async function sendBadgeAwardedEmailViaApi(siteConfig, payload) {
  const apiKey = getBrevoApiKey(siteConfig);
  if (!apiKey) {
    return { skipped: true, reason: 'no_api_key', transport: 'api' };
  }
  let response;
  try {
    response = await fetch(BREVO_SEND_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': apiKey
      },
      body: JSON.stringify(payload)
    });
  } catch (networkErr) {
    const hint =
      'Request never reached Brevo (no HTTP response). Typical causes: DNS/TLS failure, outbound firewall, or transient network error on the host.';
    const err = new Error(
      `${hint} Underlying: ${(networkErr && networkErr.message) || String(networkErr)}`
    );
    err.httpStatus = 0;
    err.brevoReachable = false;
    throw err;
  }

  const raw = await response.text();
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const message = (parsed && (parsed.message || parsed.error)) || raw || response.statusText;
    const err = new Error(`Brevo API ${response.status}: ${message}`);
    err.httpStatus = response.status;
    err.brevoReachable = true;
    err.brevoResponseBody = truncateForEmailLog(raw);
    throw err;
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
  const badgeId = String((badge && badge.id) || '').trim();
  const { subject, htmlContent, textContent } = buildAwardEmailContent(siteConfig, {
    recipientName,
    badgeName,
    badgeUrl: badgeUrl || '(link unavailable — set Public site URL in Settings)',
    badgeId
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

function buildEmailLogEntry(siteConfig, badge, result, errorMessage = '', logExtras = {}) {
  const transport = (result && result.transport) || getEmailTransport(siteConfig);
  const apiKeySource = logExtras.apiKeySource != null ? logExtras.apiKeySource : getBrevoApiKeySource(siteConfig);
  const badgeId = (badge && badge.id) || '';
  const badgeTitle = (badge && badge.badgeTitle) || '';
  const toEmail = String((badge && badge.awardeeEmail) || '').trim().toLowerCase();
  const badgeUrl = getAbsoluteBadgeUrl(siteConfig, badge);
  const subject = buildAwardEmailContent(siteConfig, {
    recipientName: (badge && badge.awardeeName) || 'Recipient',
    badgeName: badgeTitle || 'E-Badge',
    badgeUrl: badgeUrl || '',
    badgeId
  }).subject;
  if (errorMessage) {
    const httpStatus =
      logExtras.httpStatus !== undefined && logExtras.httpStatus !== null && logExtras.httpStatus !== ''
        ? logExtras.httpStatus
        : '';
    return {
      badgeId,
      badgeTitle,
      to: toEmail,
      subject,
      status: 'error',
      reason: 'send_failed',
      transport,
      messageId: '',
      errorMessage,
      httpStatus,
      apiKeySource,
      brevoHostEnvVar: logExtras.brevoHostEnvVar || '',
      brevoResponseBody: logExtras.brevoResponseBody || '',
      brevoReachable: logExtras.brevoReachable
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
      errorMessage: '',
      httpStatus: '',
      apiKeySource,
      brevoHostEnvVar: logExtras.brevoHostEnvVar || ''
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
    errorMessage: '',
    httpStatus: '',
    apiKeySource,
    brevoHostEnvVar: logExtras.brevoHostEnvVar || ''
  };
}

function queueBadgeAwardedEmail(loadSiteConfig, badge) {
  if (!badge || !loadSiteConfig) {
    return;
  }
  void (async () => {
    const siteConfig = loadSiteConfig();
    const apiKeySource = getBrevoApiKeySource(siteConfig);
    const brevoHostEnvVar = apiKeySource === 'env' ? getBrevoHostEnvVarName() : '';
    let result = null;
    let errorMessage = '';
    let logExtras = { apiKeySource, brevoHostEnvVar };
    try {
      result = await sendBadgeAwardedEmail(siteConfig, badge);
    } catch (error) {
      errorMessage = error.message || String(error);
      result = { skipped: false, transport: getEmailTransport(siteConfig) };
      logExtras = {
        apiKeySource,
        brevoHostEnvVar,
        httpStatus: error.httpStatus,
        brevoResponseBody: error.brevoResponseBody || '',
        brevoReachable: error.brevoReachable
      };
    }
    try {
      appendEmailLogLine(buildEmailLogEntry(siteConfig, badge, result, errorMessage, logExtras));
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
  getBrevoApiKeySource,
  getBrevoHostEnvDiagnostics,
  getBuiltinAwardEmailTemplates,
  verifyBrevoRestApiKey,
  AWARD_EMAIL_TEMPLATE_TAGS,
  getAbsoluteBadgeUrl,
  isAwardEmailActive,
  getEmailTransport,
  hasSmtpCredentialsConfigured
};
