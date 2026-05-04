/**
 * Shared award-email defaults, migration, and plain/HTML body sync (no store/brevo deps).
 */

const LINK_MARKDOWN = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/gi;

function escapeHtmlLite(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttrLite(text) {
  return escapeHtmlLite(text).replace(/'/g, '&#39;');
}

/** Placeholders like {badge-link} — preserve through plain→HTML. */
function protectTokens(s) {
  const tokens = [];
  const out = String(s || '').replace(/\{[a-z0-9-]+\}/gi, (m) => {
    tokens.push(m);
    return `\u0001T${tokens.length - 1}\u0002`;
  });
  return { text: out, tokens };
}

function unprotectTokens(s, tokens) {
  let out = String(s || '');
  for (let i = 0; i < tokens.length; i += 1) {
    out = out.replace(`\u0001T${i}\u0002`, tokens[i]);
  }
  return out;
}

function escapeBlockWithMarkdownLinks(block) {
  const links = [];
  let t = String(block || '').replace(LINK_MARKDOWN, (_, label, url) => {
    const idx = links.length;
    const safeUrl = String(url || '').trim();
    const safeLabel = String(label || '').trim();
    links.push(`<a href="${escapeAttrLite(safeUrl)}">${escapeHtmlLite(safeLabel)}</a>`);
    return `@@LINK${idx}@@`;
  });
  t = escapeHtmlLite(t);
  for (let i = 0; i < links.length; i += 1) {
    t = t.replace(`@@LINK${i}@@`, links[i]);
  }
  return t;
}

/**
 * Plain "WordPress text" body: paragraphs split by blank line, single newlines → <br>,
 * [label](https://...) links. Curly placeholders pass through.
 */
function plainBodyToHtmlFragment(plain) {
  const { text, tokens } = protectTokens(plain);
  let t = text.replace(/\r\n/g, '\n');
  const blocks = t.split(/\n\n+/);
  const inner = blocks
    .map((block) => {
      const lines = block.split('\n');
      const withBr = lines.map((line) => escapeBlockWithMarkdownLinks(line)).join('<br />\n');
      return `<p style="margin:0 0 1em 0;">${withBr}</p>`;
    })
    .join('\n');
  return unprotectTokens(inner, tokens);
}

/**
 * Reverse HTML fragment → plain with [text](url) and newlines (lossy but usable).
 */
function htmlFragmentToPlainBody(html) {
  let s = String(html || '');
  s = s.replace(/<\/?(html|head|body)[^>]*>/gi, '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => {
    const text = String(inner || '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return `[${text || href}](${href})`;
  });
  s = s.replace(/<\/p>\s*/gi, '\n\n');
  s = s.replace(/<p[^>]*>/gi, '');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(div|h[1-6])>/gi, '\n\n');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

function getBuiltinAwardEmailParts() {
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

function createDefaultEmailAwardTemplates() {
  const b = getBuiltinAwardEmailParts();
  return {
    templates: [
      {
        id: 'default',
        name: 'Default award email',
        subject: b.subject,
        bodyPlain: b.text,
        bodyHtml: b.html
      }
    ],
    defaultTemplateId: 'default'
  };
}

function wrapEmailHtmlDocument(inner) {
  const s = String(inner || '').trim();
  if (!s) {
    return '';
  }
  if (/<!DOCTYPE|<html[\s>]/i.test(s)) {
    return s;
  }
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /></head>
<body style="font-family: Georgia, 'Times New Roman', serif; line-height: 1.6; color: #222;">
${s}
</body>
</html>`;
}

/**
 * Build initial templates array from legacy flat siteConfig fields or builtins.
 */
function migrateLegacyEmailTemplates(siteConfig) {
  const sub = String((siteConfig && siteConfig.emailAwardSubjectTemplate) || '').trim();
  const html = String((siteConfig && siteConfig.emailAwardHtmlTemplate) || '').trim();
  const text = String((siteConfig && siteConfig.emailAwardTextTemplate) || '').trim();
  const b = getBuiltinAwardEmailParts();
  const hasLegacy = Boolean(sub || html || text);
  if (!hasLegacy) {
    return createDefaultEmailAwardTemplates();
  }
  const bodyPlain = text || htmlFragmentToPlainBody(html || b.html);
  const bodyHtml = html || wrapEmailHtmlDocument(plainBodyToHtmlFragment(bodyPlain || b.text));
  return {
    templates: [
      {
        id: 'default',
        name: 'Default award email',
        subject: sub || b.subject,
        bodyPlain: bodyPlain || b.text,
        bodyHtml: bodyHtml || b.html
      }
    ],
    defaultTemplateId: 'default'
  };
}

function normalizeEmailAwardTemplateEntry(entry) {
  const id = String((entry && entry.id) || '')
    .trim()
    .replace(/[^a-z0-9-]/gi, '-')
    .toLowerCase();
  const name = String((entry && entry.name) || '').trim() || 'Untitled';
  const subject = String((entry && entry.subject) || '').trim();
  const bodyPlain = String((entry && entry.bodyPlain) != null ? entry.bodyPlain : '').replace(/\r\n/g, '\n');
  let bodyHtml = String((entry && entry.bodyHtml) != null ? entry.bodyHtml : '').replace(/\r\n/g, '\n');
  if (!bodyHtml.trim() && bodyPlain.trim()) {
    bodyHtml = wrapEmailHtmlDocument(plainBodyToHtmlFragment(bodyPlain));
  }
  if (!bodyPlain.trim() && bodyHtml.trim()) {
    bodyHtml = bodyHtml.trim();
    bodyPlain = htmlFragmentToPlainBody(bodyHtml);
  }
  return { id: id || `tmpl-${Date.now()}`, name, subject, bodyPlain, bodyHtml };
}

module.exports = {
  plainBodyToHtmlFragment,
  htmlFragmentToPlainBody,
  wrapEmailHtmlDocument,
  getBuiltinAwardEmailParts,
  createDefaultEmailAwardTemplates,
  migrateLegacyEmailTemplates,
  normalizeEmailAwardTemplateEntry,
  escapeHtmlLite
};
