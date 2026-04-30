const { normalizeUrl, hasConfiguredPublicUrl, escapeHtml, escapeAttribute } = require('./store');

const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';

function getBrevoApiKey(siteConfig) {
  const fromEnv = String(process.env.BREVO_API_KEY || '').trim();
  if (fromEnv) {
    return fromEnv;
  }
  return String((siteConfig && siteConfig.emailBrevoApiKey) || '').trim();
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

async function sendBadgeAwardedEmail(siteConfig, badge) {
  if (!siteConfig || !siteConfig.emailBrevoEnabled) {
    return { skipped: true, reason: 'disabled' };
  }
  const apiKey = getBrevoApiKey(siteConfig);
  if (!apiKey) {
    return { skipped: true, reason: 'no_api_key' };
  }
  const senderEmail = String(siteConfig.emailBrevoSenderEmail || '').trim().toLowerCase();
  if (!senderEmail) {
    return { skipped: true, reason: 'no_sender_email' };
  }
  const toEmail = String((badge && badge.awardeeEmail) || '').trim().toLowerCase();
  if (!toEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
    return { skipped: true, reason: 'invalid_recipient' };
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

  const replyTo = String(siteConfig.emailBrevoReplyTo || '').trim().toLowerCase();
  if (replyTo && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) {
    payload.replyTo = { email: replyTo, name: senderName.slice(0, 70) };
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

  return { ok: true, messageId: parsed && parsed.messageId };
}

function queueBadgeAwardedEmail(loadSiteConfig, badge) {
  if (!badge || !loadSiteConfig) {
    return;
  }
  const siteConfig = loadSiteConfig();
  void sendBadgeAwardedEmail(siteConfig, badge).catch((error) => {
    console.warn(`Brevo badge email failed for ${badge.id || badge.slug || 'unknown'}: ${error.message}`);
  });
}

module.exports = {
  sendBadgeAwardedEmail,
  queueBadgeAwardedEmail,
  getBrevoApiKey,
  getAbsoluteBadgeUrl
};
