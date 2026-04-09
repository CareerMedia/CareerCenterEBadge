const { escapeHtml, escapeAttribute, serializeForScript, computeBadgeStats, getCertificateTemplateForTemplate } = require('./store');
const { buildWidgetEmbedCode } = require('./credential-utils');

function adminLayout({ title, active = 'dashboard', body, notice = '', extraHead = '', extraScripts = '' }) {
  const nav = [
    { key: 'dashboard', href: '/admin', label: 'Dashboard' },
    { key: 'issue', href: '/admin/issue', label: 'Issue badge' },
    { key: 'templates', href: '/admin/templates', label: 'Badge templates' },
    { key: 'settings', href: '/admin/settings', label: 'Settings' },
    { key: 'analytics', href: '/admin/analytics', label: 'Analytics' },
    { key: 'backups', href: '/admin/backups', label: 'Backups' }
  ]
    .map(
      (item) => `
      <a class="admin-nav__link ${item.key === active ? 'is-active' : ''}" href="${item.href}">${item.label}</a>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} | Admin</title>
    <link rel="stylesheet" href="/admin-static/admin.css" />
    ${extraHead}
  </head>
  <body>
    <div class="admin-shell">
      <aside class="admin-sidebar">
        <div class="admin-sidebar__top">
          <div class="admin-brand">
            <img class="admin-brand__logo" src="/assets/CC_Logo_Lockup_Main@5x.png" alt="CSUN Career Center logo" />
            <div>
              <div class="admin-brand__title">CSUN Career Center E-Badges</div>
              <div class="admin-brand__subtitle">Secure credential operations</div>
            </div>
          </div>
          <p class="admin-sidebar__copy">Issue public credentials, manage badge templates, preserve certificate settings, and maintain recovery-grade backups from one clean workspace.</p>
          <nav class="admin-nav">${nav}</nav>
        </div>
        <form method="post" action="/admin/logout" class="logout-form">
          <button type="submit" class="button button--ghost">Log out</button>
        </form>
      </aside>
      <main class="admin-main">
        ${notice ? `<div class="admin-notice">${escapeHtml(notice)}</div>` : ''}
        ${body}
      </main>
    </div>
    <script src="/admin-static/admin.js"></script>
    ${extraScripts}
  </body>
</html>`;
}

function renderLoginPage(message = '') {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Admin login</title>
    <link rel="stylesheet" href="/admin-static/admin.css" />
  </head>
  <body class="admin-login-page">
    <main class="admin-login-card">
      <div class="admin-login-brand">
        <img src="/assets/CC_Logo_Lockup_Main@5x.png" alt="CSUN Career Center logo" />
        <div>
          <p class="admin-section-label">Private admin</p>
          <h1>CSUN Career Center E-Badges</h1>
        </div>
      </div>
      <p>Sign in to issue credentials, open badge-specific generators, manage templates, and protect the certificate system that powers each public verification page.</p>
      ${message ? `<div class="admin-error">${escapeHtml(message)}</div>` : ''}
      <form method="post" action="/admin/login" class="admin-form admin-form--stacked">
        <label>
          <span>Password</span>
          <input type="password" name="password" autocomplete="current-password" required />
        </label>
        <button type="submit">Log in</button>
      </form>
    </main>
  </body>
</html>`;
}

function renderDashboard({ badges, query = '', siteConfig, successLink = '', successBadgeId = '' }) {
  const stats = computeBadgeStats(badges);
  const rows = badges.length
    ? badges
        .map(
          (badge) => `
        <tr>
          <td>
            <strong>${escapeHtml(badge.awardeeName)}</strong>
            <div class="table-subtext">${escapeHtml(badge.badgeTitle)}</div>
          </td>
          <td>${escapeHtml(badge.issueDate)}</td>
          <td>${escapeHtml(badge.id)}</td>
          <td><span class="status-tag">${escapeHtml(badge.status || 'valid')}</span></td>
          <td>
            <div class="inline-actions">
              <a class="text-link" href="${escapeAttribute(badge.publicUrl)}" target="_blank" rel="noreferrer">Open</a>
              <button type="button" class="button button--small button--ghost" data-copy="${escapeAttribute(badge.publicUrl)}">Copy link</button>
            </div>
            <div class="table-subtext">${escapeHtml(badge.repoPath)}</div>
          </td>
          <td>
            <form method="post" action="/admin/badges/delete" data-confirm="Delete ${escapeAttribute(badge.awardeeName)}'s badge page?">
              <input type="hidden" name="badgeId" value="${escapeAttribute(badge.id)}" />
              <button type="submit" class="button button--small button--danger">Delete</button>
            </form>
          </td>
        </tr>`
        )
        .join('')
    : '<tr><td colspan="6" class="empty-row">No badges match your search yet.</td></tr>';

  const successPanel = successLink
    ? `
      <div class="admin-panel admin-panel--success">
        <p class="admin-panel__eyebrow">Badge created</p>
        <h2>Verification page ready</h2>
        <p>The badge page is published and included in your badge link index.</p>
        <div class="success-grid">
          <div>
            <span class="muted-label">Credential ID</span>
            <strong>${escapeHtml(successBadgeId)}</strong>
          </div>
          <div>
            <span class="muted-label">Public URL</span>
            <a class="text-link" href="${escapeAttribute(successLink)}" target="_blank" rel="noreferrer">${escapeHtml(successLink)}</a>
          </div>
        </div>
        <div class="inline-actions">
          <button type="button" class="button button--ghost" data-copy="${escapeAttribute(successLink)}">Copy link</button>
          <a class="button" href="/admin/issue">Issue another badge</a>
        </div>
      </div>`
    : '';

  const body = `
    <section class="admin-header">
      <div>
        <p class="admin-section-label">Overview</p>
        <h2>Issued badge registry</h2>
        <p>Search awardees, copy public URLs, export the master CSV, or delete a badge and regenerate the site.</p>
      </div>
      <div class="inline-actions">
        <a class="button" href="/admin/issue">Issue badge</a>
        <a class="button button--ghost" href="/generator/" target="_blank" rel="noreferrer">Open general generator</a>
        <a class="button button--ghost" href="/admin/export/csv">Download links CSV</a>
        <a class="button button--ghost" href="${escapeAttribute(siteConfig.publicSiteUrl || '/') }" target="_blank" rel="noreferrer">Open public site</a>
      </div>
    </section>

    ${successPanel}

    <section class="stats-grid">
      <article class="stat-card"><span>Total issued</span><strong>${stats.totalIssued}</strong></article>
      <article class="stat-card"><span>Valid badges</span><strong>${stats.validCount}</strong></article>
      <article class="stat-card"><span>Latest issue date</span><strong>${escapeHtml(stats.latestIssueDate)}</strong></article>
    </section>

    <section class="admin-panel">
      <form method="get" action="/admin" class="search-toolbar">
        <label class="search-toolbar__field">
          <span>Search badges</span>
          <input type="search" name="q" value="${escapeAttribute(query)}" placeholder="Search by name, badge title, date, or credential ID" />
        </label>
        <button type="submit">Search</button>
      </form>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Awardee / badge</th>
              <th>Issue date</th>
              <th>Credential ID</th>
              <th>Status</th>
              <th>Verification page</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>

    <section class="admin-panel">
      <div class="admin-section-heading">
        <div>
          <p class="admin-section-label">File outputs</p>
          <h3>Where the generated links live</h3>
        </div>
      </div>
      <ul class="file-list">
        <li><code>data/badge-links.csv</code> — private master file with every public URL and repo path.</li>
        <li><code>docs/data/badge-links.csv</code> — public copy of the CSV for quick reference.</li>
        <li><code>docs/badges/&lt;badge-slug&gt;/index.html</code> — each formal public badge verification page.</li>
        <li><code>docs/badges/&lt;badge-slug&gt;/details.json</code> — metadata file for that badge.</li>
      </ul>
    </section>
  `;

  return adminLayout({ title: 'Dashboard', active: 'dashboard', body });
}

function renderIssuePage({ templates, defaultDate, defaultCareerCenterUrl, siteConfig, notice = '' }) {
  const templateOptions = templates
    .map((template) => `<option value="${escapeAttribute(template.id)}">${escapeHtml(template.title)}</option>`)
    .join('');

  const body = `
    <section class="admin-header">
      <div>
        <p class="admin-section-label">Issue a badge</p>
        <h2>Create a new public credential page</h2>
        <p>Select a badge template to auto-fill every credential field, or leave the dropdown blank and build a one-off custom badge manually.</p>
      </div>
    </section>

    <section class="admin-panel">
      <form method="post" action="/admin/issue" class="admin-form admin-form--stacked">
        <div class="form-grid form-grid--two">
          <label><span>Recipient name</span><input type="text" name="awardeeName" required /></label>
          <label><span>Issue date</span><input type="text" name="issueDate" value="${escapeAttribute(defaultDate)}" required /></label>
          <label>
            <span>Badge template</span>
            <select id="badgeTemplateId" name="badgeTemplateId">
              <option value="">Custom one-off badge</option>
              ${templateOptions}
            </select>
          </label>
          <label><span>Badge title</span><input id="badgeTitle" type="text" name="badgeTitle" /></label>
          <label><span>Badge label</span><input id="badgeLabel" type="text" name="badgeLabel" /></label>
          <label><span>Career Center URL</span><input id="careerCenterUrl" type="url" name="careerCenterUrl" value="${escapeAttribute(defaultCareerCenterUrl)}" /></label>
          <label><span>Issuer name</span><input id="issuerName" type="text" name="issuerName" value="${escapeAttribute(siteConfig.organizationName)}" /></label>
          <label><span>Issuer organization</span><input id="issuerOrganization" type="text" name="issuerOrganization" value="${escapeAttribute(siteConfig.organizationName)}" /></label>
          <label><span>Issuer website</span><input id="issuerWebsite" type="url" name="issuerWebsite" value="${escapeAttribute(siteConfig.defaultCareerCenterUrl)}" /></label>
          <label><span>Issuer contact email</span><input id="issuerContactEmail" type="email" name="issuerContactEmail" value="${escapeAttribute(siteConfig.supportEmail)}" /></label>
          <label><span>Issuer registry URL</span><input id="issuerRegistryUrl" type="url" name="issuerRegistryUrl" /></label>
          <label><span>Badge image path or URL</span><input id="badgeImage" type="text" name="badgeImage" /></label>
          <label><span>Certificate background path or URL</span><input id="certificateBackground" type="text" name="certificateBackground" /></label>
          <label><span>Evidence URL</span><input id="evidenceUrl" type="url" name="evidenceUrl" placeholder="https://..." /></label>
          <label><span>Evidence note</span><input id="evidenceText" type="text" name="evidenceText" placeholder="Optional supporting note" /></label>
        </div>
        <label><span>Public summary</span><textarea id="publicSummary" name="publicSummary" rows="3"></textarea></label>
        <label><span>Meaning</span><textarea id="meaning" name="meaning" rows="4"></textarea></label>
        <label><span>Criteria</span><textarea id="criteria" name="criteria" rows="4"></textarea></label>
        <div class="form-grid form-grid--two">
          <label><span>Skills</span><textarea id="skills" name="skills" rows="4" placeholder="One per line or comma separated"></textarea></label>
          <label><span>Standards / mappings</span><textarea id="standards" name="standards" rows="4" placeholder="One per line or comma separated"></textarea></label>
          <label><span>Pathway title</span><input id="pathwayTitle" type="text" name="pathwayTitle" /></label>
          <label><span>Pathway order</span><input id="pathwayOrder" type="number" name="pathwayOrder" min="1" value="1" /></label>
          <label class="form-span-2"><span>Pathway steps</span><textarea id="pathwayItems" name="pathwayItems" rows="3" placeholder="Career Champion&#10;Interview Ready&#10;Internship Ready"></textarea></label>
        </div>
        <label><span>Issuer verification note</span><textarea id="issuerVerificationNote" name="issuerVerificationNote" rows="3"></textarea></label>
        <div class="inline-actions">
          <button type="submit">Issue badge and rebuild site</button>
          <span class="muted">Selecting a template auto-fills the form, but you can still override any field for a one-off custom credential.</span>
        </div>
      </form>
    </section>
  `;

  return adminLayout({
    title: 'Issue badge',
    active: 'issue',
    body,
    notice,
    extraScripts: `<script>window.__TEMPLATES__ = ${serializeForScript(templates)};</script>`
  });
}

function renderTemplatesPage({ templates, editTemplate = null, notice = '', siteConfig, certificateTemplate }) {
  const publicBase = escapeAttribute((siteConfig && siteConfig.publicSiteUrl) || 'https://YOUR-RENDER-URL.onrender.com');
  const rows = templates
    .map((template) => {
      const widgetCode = buildWidgetEmbedCode((siteConfig && siteConfig.publicSiteUrl) || '', template.id, { layout: template.widgetLayout || 'split' });
      return `
      <tr>
        <td>
          <strong>${escapeHtml(template.title)}</strong>
          <div class="table-subtext">${escapeHtml(template.id)}</div>
        </td>
        <td>${escapeHtml(template.issuerName || '')}</td>
        <td>
          <div class="table-subtext"><a class="text-link" href="/generator/${encodeURIComponent(template.id)}/" target="_blank" rel="noreferrer">Specific generator</a></div>
          <div class="table-subtext"><a class="text-link" href="/widget/${encodeURIComponent(template.id)}/" target="_blank" rel="noreferrer">Embeddable widget</a></div>
        </td>
        <td>
          <div class="inline-actions">
            <a class="button button--small button--ghost" href="/admin/templates?edit=${encodeURIComponent(template.id)}">Edit</a>
            <button type="button" class="button button--small button--ghost" data-copy="${escapeAttribute(widgetCode)}">Copy embed code</button>
            <form method="post" action="/admin/templates/delete" data-confirm="Delete template ${escapeAttribute(template.title)}?">
              <input type="hidden" name="templateId" value="${escapeAttribute(template.id)}" />
              <button type="submit" class="button button--small button--danger">Delete</button>
            </form>
          </div>
        </td>
      </tr>`;
    })
    .join('');

  const current = editTemplate || {
    id: '', title: '', badgeLabel: '', description: '', publicSummary: '', meaning: '', criteria: '',
    evidenceLabel: 'Evidence', evidencePrompt: '', evidenceExampleUrl: '', evidenceDescription: '',
    skills: [], standards: [], pathwayId: '', pathwayTitle: '', pathwayDescription: '', pathwayOrder: 1, pathwayItems: [],
    issuerName: siteConfig.organizationName, issuerOrganization: siteConfig.organizationName, issuerWebsite: siteConfig.defaultCareerCenterUrl, careerCenterUrl: siteConfig.defaultCareerCenterUrl,
    issuerContactEmail: siteConfig.supportEmail, issuerVerificationNote: siteConfig.footerNote, issuerRegistryUrl: '', issuerTrustLabel: 'Official issuer',
    badgeImage: 'assets/badges/career-champion-badge.svg', certificateBackground: certificateTemplate.backgroundImage,
    certificateTemplateOverrideEnabled: false, certificateTemplate: certificateTemplate, widgetLayout: 'stacked'
  };
  const effectiveTemplateCertificate = getCertificateTemplateForTemplate(current, certificateTemplate);
  const widgetCode = buildWidgetEmbedCode((siteConfig && siteConfig.publicSiteUrl) || '', current.id || 'badge-template', { layout: current.widgetLayout || 'split' });

  const body = `
    <section class="admin-header">
      <div>
        <p class="admin-section-label">Badge templates</p>
        <h2>Manage reusable badge definitions</h2>
        <p>Templates power public badge pages, specific generators, embeddable widgets, metadata exports, pathway mapping, and certificate layout overrides.</p>
      </div>
    </section>

    <section class="admin-panel">
      <form method="post" action="/admin/templates/save" class="admin-form admin-form--stacked" id="badgeTemplateForm">
        <div class="form-grid form-grid--two">
          <label><span>Template ID</span><input type="text" name="id" value="${escapeAttribute(current.id)}" required placeholder="career-champion" /></label>
          <label><span>Badge title</span><input type="text" name="title" value="${escapeAttribute(current.title)}" required /></label>
          <label><span>Badge label</span><input type="text" name="badgeLabel" value="${escapeAttribute(current.badgeLabel)}" /></label>
          <label><span>Widget layout</span><select name="widgetLayout"><option value="stacked" ${current.widgetLayout === 'stacked' ? 'selected' : ''}>Stacked</option><option value="split" ${current.widgetLayout === 'split' ? 'selected' : ''}>Split</option></select></label>
          <label><span>Badge image path or URL</span><input type="text" name="badgeImage" id="templateBadgeImage" value="${escapeAttribute(current.badgeImage)}" required /></label>
          <label><span>Upload badge image</span><input type="file" data-upload-target="badgeImageUploadDataUrl" data-preview-target="templateBadgeImage" accept=".png,.jpg,.jpeg,.webp,.svg,image/*" /><input type="hidden" name="badgeImageUploadDataUrl" id="badgeImageUploadDataUrl" /></label>
          <label><span>Certificate background path or URL</span><input type="text" name="certificateBackground" id="templateCertificateBackground" value="${escapeAttribute(current.certificateBackground)}" required /></label>
          <label><span>Upload certificate background</span><input type="file" data-upload-target="certificateBackgroundUploadDataUrl" data-preview-target="templateCertificateBackground" accept=".png,.jpg,.jpeg,.webp,.svg,image/*" /><input type="hidden" name="certificateBackgroundUploadDataUrl" id="certificateBackgroundUploadDataUrl" /></label>
          <label><span>Issuer name</span><input type="text" name="issuerName" value="${escapeAttribute(current.issuerName)}" required /></label>
          <label><span>Issuer organization</span><input type="text" name="issuerOrganization" value="${escapeAttribute(current.issuerOrganization)}" required /></label>
          <label><span>Issuer website</span><input type="url" name="issuerWebsite" value="${escapeAttribute(current.issuerWebsite)}" required /></label>
          <label><span>Career Center website</span><input type="url" name="careerCenterUrl" value="${escapeAttribute(current.careerCenterUrl)}" required /></label>
          <label><span>Issuer contact email</span><input type="email" name="issuerContactEmail" value="${escapeAttribute(current.issuerContactEmail || '')}" /></label>
          <label><span>Issuer registry URL</span><input type="url" name="issuerRegistryUrl" value="${escapeAttribute(current.issuerRegistryUrl || '')}" /></label>
          <label><span>Issuer trust label</span><input type="text" name="issuerTrustLabel" value="${escapeAttribute(current.issuerTrustLabel || '')}" /></label>
        </div>
        <label><span>Public summary</span><textarea name="description" rows="3" required>${escapeHtml(current.description || current.publicSummary)}</textarea></label>
        <label><span>Meaning</span><textarea name="meaning" rows="4" required>${escapeHtml(current.meaning)}</textarea></label>
        <label><span>Eligibility or criteria</span><textarea name="criteria" rows="4" required>${escapeHtml(current.criteria)}</textarea></label>
        <label><span>Issuer verification note</span><textarea name="issuerVerificationNote" rows="3">${escapeHtml(current.issuerVerificationNote || '')}</textarea></label>

        <div class="form-grid form-grid--two">
          <label><span>Evidence label</span><input type="text" name="evidenceLabel" value="${escapeAttribute(current.evidenceLabel || 'Evidence')}" /></label>
          <label><span>Example evidence URL</span><input type="url" name="evidenceExampleUrl" value="${escapeAttribute(current.evidenceExampleUrl || '')}" /></label>
          <label class="form-span-2"><span>Evidence prompt</span><textarea name="evidencePrompt" rows="3">${escapeHtml(current.evidencePrompt || '')}</textarea></label>
          <label class="form-span-2"><span>Evidence description</span><textarea name="evidenceDescription" rows="3">${escapeHtml(current.evidenceDescription || '')}</textarea></label>
          <label><span>Skills</span><textarea name="skills" rows="4">${escapeHtml((current.skills || []).join('\n'))}</textarea></label>
          <label><span>Standards / mappings</span><textarea name="standards" rows="4">${escapeHtml((current.standards || []).join('\n'))}</textarea></label>
          <label><span>Pathway ID</span><input type="text" name="pathwayId" value="${escapeAttribute(current.pathwayId || '')}" /></label>
          <label><span>Pathway title</span><input type="text" name="pathwayTitle" value="${escapeAttribute(current.pathwayTitle || '')}" /></label>
          <label><span>Pathway order</span><input type="number" name="pathwayOrder" min="1" value="${escapeAttribute(current.pathwayOrder || 1)}" /></label>
          <label class="form-span-2"><span>Pathway description</span><textarea name="pathwayDescription" rows="3">${escapeHtml(current.pathwayDescription || '')}</textarea></label>
          <label class="form-span-2"><span>Pathway steps</span><textarea name="pathwayItems" rows="3">${escapeHtml((current.pathwayItems || []).join('\n'))}</textarea></label>
        </div>

        <section class="template-config-shell">
          <div class="template-config-shell__header">
            <div>
              <p class="admin-section-label">Embeddable widget</p>
              <h3>Copy the widget code for this badge type</h3>
            </div>
            <button type="button" class="button button--ghost" data-copy="${escapeAttribute(widgetCode)}">Copy embed code</button>
          </div>
          <textarea rows="5" readonly>${escapeHtml(widgetCode)}</textarea>
        </section>

        <section class="template-config-shell">
          <div class="template-config-shell__header">
            <div>
              <p class="admin-section-label">Certificate override</p>
              <h3>Optional template-specific coordinates</h3>
            </div>
            <label class="checkbox-inline"><input type="checkbox" name="certificateTemplateOverrideEnabled" id="certificateTemplateOverrideEnabled" ${current.certificateTemplateOverrideEnabled ? 'checked' : ''} /><span>Use template-specific certificate coordinates</span></label>
          </div>
          <div class="coordinate-editor-grid">
            <div class="certificate-coordinate-preview" id="certificateCoordinatePreview">
              <img id="certificateCoordinateImage" src="${escapeAttribute(current.certificateBackground)}" alt="Certificate preview" />
              <div class="coordinate-marker coordinate-marker--name" data-coordinate-target="name">
                <button type="button" class="coordinate-dot coordinate-dot--name" aria-label="Drag name placement handle"></button>
                <div class="coordinate-chip coordinate-chip--name">
                  <span class="coordinate-chip__eyebrow">Name</span>
                  <span class="coordinate-chip__value" id="coordinatePreviewName">First Last</span>
                </div>
              </div>
              <div class="coordinate-marker coordinate-marker--date" data-coordinate-target="date">
                <button type="button" class="coordinate-dot coordinate-dot--date" aria-label="Drag date placement handle"></button>
                <div class="coordinate-chip coordinate-chip--date">
                  <span class="coordinate-chip__eyebrow">Date</span>
                  <span class="coordinate-chip__value" id="coordinatePreviewDate">January 1, 2026</span>
                </div>
              </div>
            </div>
            <div class="form-grid form-grid--two">
              <input type="hidden" name="certificateBackgroundOverride" value="${escapeAttribute(current.certificateBackground)}" />
              <label><span>Name X</span><input type="number" name="templateNameX" id="templateNameX" value="${escapeAttribute(effectiveTemplateCertificate.name.x)}" /></label>
              <label><span>Name Y</span><input type="number" name="templateNameY" id="templateNameY" value="${escapeAttribute(effectiveTemplateCertificate.name.y)}" /></label>
              <label><span>Name font size</span><input type="number" name="templateNameFontSize" id="templateNameFontSize" value="${escapeAttribute(effectiveTemplateCertificate.name.fontSize)}" /></label>
              <label><span>Name max width</span><input type="number" name="templateNameMaxWidth" value="${escapeAttribute(effectiveTemplateCertificate.name.maxWidth)}" /></label>
              <label><span>Date X</span><input type="number" name="templateDateX" id="templateDateX" value="${escapeAttribute(effectiveTemplateCertificate.date.x)}" /></label>
              <label><span>Date Y</span><input type="number" name="templateDateY" id="templateDateY" value="${escapeAttribute(effectiveTemplateCertificate.date.y)}" /></label>
              <label><span>Date font size</span><input type="number" name="templateDateFontSize" id="templateDateFontSize" value="${escapeAttribute(effectiveTemplateCertificate.date.fontSize)}" /></label>
              <label><span>Date max width</span><input type="number" name="templateDateMaxWidth" value="${escapeAttribute(effectiveTemplateCertificate.date.maxWidth)}" /></label>
              <input type="hidden" name="templateNameFontFamily" value="${escapeAttribute(effectiveTemplateCertificate.name.fontFamily)}" />
              <input type="hidden" name="templateNameFontWeight" value="${escapeAttribute(effectiveTemplateCertificate.name.fontWeight)}" />
              <input type="hidden" name="templateNameColor" value="${escapeAttribute(effectiveTemplateCertificate.name.color)}" />
              <input type="hidden" name="templateNameAlign" value="${escapeAttribute(effectiveTemplateCertificate.name.align)}" />
              <input type="hidden" name="templateDateFontFamily" value="${escapeAttribute(effectiveTemplateCertificate.date.fontFamily)}" />
              <input type="hidden" name="templateDateFontWeight" value="${escapeAttribute(effectiveTemplateCertificate.date.fontWeight)}" />
              <input type="hidden" name="templateDateColor" value="${escapeAttribute(effectiveTemplateCertificate.date.color)}" />
              <input type="hidden" name="templateDateAlign" value="${escapeAttribute(effectiveTemplateCertificate.date.align)}" />
              <input type="hidden" name="fileNameSuffixOverride" value="${escapeAttribute(effectiveTemplateCertificate.fileNameSuffix)}" />
            </div>
          </div>
        </section>

        <div class="inline-actions">
          <button type="submit">Save template</button>
          <a class="button button--ghost" href="/admin/templates">Clear form</a>
          <a class="button button--ghost" href="/generator/${encodeURIComponent(current.id || '')}/" target="_blank" rel="noreferrer">Open specific generator</a>
        </div>
      </form>
    </section>

    <section class="admin-panel">
      <div class="admin-section-heading">
        <div>
          <p class="admin-section-label">Existing templates</p>
          <h3>Reusable badge configurations</h3>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Template</th>
              <th>Issuer</th>
              <th>Generators</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="4" class="empty-row">No templates found.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  `;

  return adminLayout({
    title: 'Badge templates',
    active: 'templates',
    body,
    notice,
    extraScripts: `<script>window.__TEMPLATES__ = ${serializeForScript(templates)}; window.__TEMPLATE_EDITOR__ = ${serializeForScript({ backgroundImage: current.certificateBackground, nameX: effectiveTemplateCertificate.name.x, nameY: effectiveTemplateCertificate.name.y, dateX: effectiveTemplateCertificate.date.x, dateY: effectiveTemplateCertificate.date.y })};</script>`
  });
}

function renderSettingsPage({ siteConfig, certificateTemplate, today, notice = '' }) {
  const body = `
    <section class="admin-header">
      <div>
        <p class="admin-section-label">Settings</p>
        <h2>Site settings and certificate placement</h2>
        <p>Use this page to control your public site URL, issuer details, and the X/Y coordinate values used when the certificate PDF is generated.</p>
      </div>
    </section>

    <section class="admin-panel">
      <form method="post" action="/admin/settings/save" class="admin-form">
        <div class="admin-section-heading">
          <div>
            <p class="admin-section-label">Public site</p>
            <h3>GitHub Pages and issuer information</h3>
          </div>
        </div>
        <div class="form-grid form-grid--two">
          <label>
            <span>Site name</span>
            <input type="text" name="siteName" value="${escapeAttribute(siteConfig.siteName)}" required />
          </label>
          <label>
            <span>Organization name</span>
            <input type="text" name="organizationName" value="${escapeAttribute(siteConfig.organizationName)}" required />
          </label>
          <label>
            <span>Public site URL</span>
            <input type="url" name="publicSiteUrl" value="${escapeAttribute(siteConfig.publicSiteUrl)}" required />
          </label>
          <label>
            <span>Career Center default URL</span>
            <input type="url" name="defaultCareerCenterUrl" value="${escapeAttribute(siteConfig.defaultCareerCenterUrl)}" required />
          </label>
          <label>
            <span>Support email</span>
            <input type="email" name="supportEmail" value="${escapeAttribute(siteConfig.supportEmail)}" required />
          </label>
          <label>
            <span>Credential prefix</span>
            <input type="text" name="credentialPrefix" value="${escapeAttribute(siteConfig.credentialPrefix)}" required />
          </label>
          <label>
            <span>Hero title</span>
            <input type="text" name="heroTitle" value="${escapeAttribute(siteConfig.heroTitle)}" required />
          </label>
        </div>
        <label>
          <span>Hero intro</span>
          <textarea name="heroIntro" rows="3" required>${escapeHtml(siteConfig.heroIntro)}</textarea>
        </label>
        <label>
          <span>Footer note</span>
          <textarea name="footerNote" rows="2" required>${escapeHtml(siteConfig.footerNote)}</textarea>
        </label>

        <div class="admin-section-heading">
          <div>
            <p class="admin-section-label">Certificate template</p>
            <h3>Coordinate-based placement controls</h3>
          </div>
        </div>
        <div class="form-grid form-grid--two">
          <label>
            <span>Background image path</span>
            <input type="text" name="backgroundImage" value="${escapeAttribute(certificateTemplate.backgroundImage)}" required />
          </label>
          <label>
            <span>Download file suffix</span>
            <input type="text" name="fileNameSuffix" value="${escapeAttribute(certificateTemplate.fileNameSuffix)}" required />
          </label>

          <label><span>Name X</span><input type="number" name="nameX" value="${escapeAttribute(certificateTemplate.name.x)}" required /></label>
          <label><span>Name Y</span><input type="number" name="nameY" value="${escapeAttribute(certificateTemplate.name.y)}" required /></label>
          <label><span>Name font size</span><input type="number" name="nameFontSize" value="${escapeAttribute(certificateTemplate.name.fontSize)}" required /></label>
          <label><span>Name font family</span><input type="text" name="nameFontFamily" value="${escapeAttribute(certificateTemplate.name.fontFamily)}" required /></label>
          <label><span>Name font weight</span><input type="text" name="nameFontWeight" value="${escapeAttribute(certificateTemplate.name.fontWeight)}" required /></label>
          <label><span>Name color</span><input type="text" name="nameColor" value="${escapeAttribute(certificateTemplate.name.color)}" required /></label>
          <label><span>Name align</span><input type="text" name="nameAlign" value="${escapeAttribute(certificateTemplate.name.align)}" required /></label>
          <label><span>Name max width</span><input type="number" name="nameMaxWidth" value="${escapeAttribute(certificateTemplate.name.maxWidth)}" required /></label>

          <label><span>Date X</span><input type="number" name="dateX" value="${escapeAttribute(certificateTemplate.date.x)}" required /></label>
          <label><span>Date Y</span><input type="number" name="dateY" value="${escapeAttribute(certificateTemplate.date.y)}" required /></label>
          <label><span>Date font size</span><input type="number" name="dateFontSize" value="${escapeAttribute(certificateTemplate.date.fontSize)}" required /></label>
          <label><span>Date font family</span><input type="text" name="dateFontFamily" value="${escapeAttribute(certificateTemplate.date.fontFamily)}" required /></label>
          <label><span>Date font weight</span><input type="text" name="dateFontWeight" value="${escapeAttribute(certificateTemplate.date.fontWeight)}" required /></label>
          <label><span>Date color</span><input type="text" name="dateColor" value="${escapeAttribute(certificateTemplate.date.color)}" required /></label>
          <label><span>Date align</span><input type="text" name="dateAlign" value="${escapeAttribute(certificateTemplate.date.align)}" required /></label>
          <label><span>Date max width</span><input type="number" name="dateMaxWidth" value="${escapeAttribute(certificateTemplate.date.maxWidth)}" required /></label>
        </div>
        <div class="inline-actions">
          <button type="submit">Save settings and rebuild site</button>
          <span class="muted">Today defaults to ${escapeHtml(today)} on the public certificate form and badge issuance form.</span>
        </div>
      </form>
    </section>
  `;

  return adminLayout({ title: 'Settings', active: 'settings', body, notice });
}


function renderBackupsPage({ backups = [], appState, notice = '' }) {
  const rows = backups.length
    ? backups
        .map(
          (backup) => `
      <tr>
        <td><strong>${escapeHtml(backup.backupId)}</strong><div class="table-subtext">${escapeHtml(backup.reason || '')}</div></td>
        <td>${escapeHtml(backup.createdAt || '')}</td>
        <td>${escapeHtml(String((backup.counts && backup.counts.badges) || 0))}</td>
        <td>${escapeHtml(String((backup.counts && backup.counts.templates) || 0))}</td>
        <td><code>${escapeHtml((backup.hashes && backup.hashes.appState) || '')}</code></td>
      </tr>`
        )
        .join('')
    : '';

  const exportJson = escapeHtml(JSON.stringify({ appState }, null, 2));
  const exportCsv = escapeHtml((appState && Array.isArray(appState.badges) ? appState.badges : []).length ? '' : '');

  const body = `
    <section class="admin-header">
      <div>
        <p class="admin-section-label">Recovery and backups</p>
        <h2>Vault-grade restore tools</h2>
        <p>Create immutable snapshots, export a full JSON backup, and restore either the whole app state or just issued badges from a spreadsheet-style CSV.</p>
      </div>
      <div class="inline-actions">
        <form method="post" action="/admin/backups/snapshot">
          <button type="submit">Create snapshot now</button>
        </form>
        <a class="button button--ghost" href="/admin/export/app-state">Download full JSON backup</a>
        <a class="button button--ghost" href="/admin/export/csv">Download badges CSV</a>
      </div>
    </section>

    <section class="admin-panel">
      <div class="admin-section-heading">
        <div>
          <p class="admin-section-label">Restore</p>
          <h3>Recover from a backup file</h3>
        </div>
      </div>
      <div class="form-grid form-grid--two">
        <form method="post" action="/admin/backups/restore-json" class="admin-form admin-form--stacked">
          <label>
            <span>Full app-state JSON backup</span>
            <input type="file" data-load-file="jsonBackupContent" accept=".json,application/json" />
          </label>
          <label>
            <span>Or paste the JSON backup here</span>
            <textarea id="jsonBackupContent" name="jsonBackupContent" rows="12" placeholder='{"appState": {...}}' required></textarea>
          </label>
          <button type="submit">Restore full system backup</button>
        </form>

        <form method="post" action="/admin/backups/restore-csv" class="admin-form admin-form--stacked">
          <label>
            <span>Issued badges CSV</span>
            <input type="file" data-load-file="csvBackupContent" accept=".csv,text/csv" />
          </label>
          <label>
            <span>Or paste the CSV here</span>
            <textarea id="csvBackupContent" name="csvBackupContent" rows="12" placeholder="credential_id,awardee_name,badge_title,issue_date,..." required></textarea>
          </label>
          <button type="submit">Restore badges from CSV</button>
        </form>
      </div>
    </section>

    <section class="admin-panel">
      <div class="admin-section-heading">
        <div>
          <p class="admin-section-label">Recent snapshots</p>
          <h3>Automatic recovery points</h3>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Backup</th>
              <th>Created</th>
              <th>Badges</th>
              <th>Templates</th>
              <th>App-state SHA-256</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="5" class="empty-row">No backups have been created yet.</td></tr>'}</tbody>
        </table>
      </div>
    </section>

    <section class="admin-panel">
      <div class="admin-section-heading">
        <div>
          <p class="admin-section-label">Live export</p>
          <h3>Current full backup JSON</h3>
        </div>
      </div>
      <textarea rows="14" readonly>${exportJson}</textarea>
    </section>
  `;

  return adminLayout({ title: 'Backups', active: 'backups', body, notice });
}


function formatAnalyticsEventLabel(type) {
  const labels = {
    badge_issued: 'Badge issued',
    badge_viewed: 'Badge viewed',
    certificate_downloaded: 'Certificate downloaded',
    generator_opened: 'Generator opened',
    generator_completed: 'Generator completed'
  };
  return labels[type] || String(type || '').replace(/_/g, ' ');
}

function formatAnalyticsTimestamp(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) {
    return value || '';
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

function renderMiniBars(items, key, emptyMessage) {
  if (!Array.isArray(items) || !items.length) {
    return `<div class="empty-row">${escapeHtml(emptyMessage || 'No data yet.')}</div>`;
  }
  const max = Math.max(...items.map((item) => Number(item[key] || 0)), 1);
  return `
    <div class="analytics-bar-list">
      ${items.map((item) => {
        const value = Number(item[key] || 0);
        const width = Math.max(6, Math.round((value / max) * 100));
        return `
          <div class="analytics-bar-row">
            <div class="analytics-bar-row__head">
              <span>${escapeHtml(item.label || item.title || item.key || '')}</span>
              <strong>${escapeHtml(String(value))}</strong>
            </div>
            <div class="analytics-bar-track"><span style="width:${width}%"></span></div>
          </div>`;
      }).join('')}
    </div>`;
}

function renderAnalyticsPage({ summary, filters = {}, recentEvents = [], badgeTypeOptions = [] }) {
  const months = Array.isArray(summary.months) ? summary.months : [];
  const years = Array.isArray(summary.years) ? summary.years : [];
  const badgeTypes = Array.isArray(summary.badgeTypes) ? summary.badgeTypes : [];
  const badgePages = Array.isArray(summary.badgePages) ? summary.badgePages : [];
  const generatorPages = Array.isArray(summary.generatorPages) ? summary.generatorPages : [];
  const totals = summary.totals || {};
  const latestMonth = months.length ? months[months.length - 1] : null;
  const latestYear = years.length ? years[years.length - 1] : null;
  const monthOptions = months.map((entry) => `<option value="${escapeAttribute(entry.key)}" ${filters.month === entry.key ? 'selected' : ''}>${escapeHtml(entry.label)}</option>`).join('');
  const yearOptions = years.map((entry) => `<option value="${escapeAttribute(entry.key)}" ${filters.year === entry.key ? 'selected' : ''}>${escapeHtml(entry.label)}</option>`).join('');
  const badgeOptions = badgeTypeOptions.map((entry) => `<option value="${escapeAttribute(entry.id)}" ${filters.badgeType === entry.id ? 'selected' : ''}>${escapeHtml(entry.title)}</option>`).join('');

  const recentRows = recentEvents.length
    ? recentEvents.map((event) => `
        <tr>
          <td><strong>${escapeHtml(formatAnalyticsEventLabel(event.type))}</strong><div class="table-subtext">${escapeHtml(event.badgeTitle || event.generatorLabel || event.requestPath || '')}</div></td>
          <td>${escapeHtml(event.awardeeName || '—')}</td>
          <td>${escapeHtml(event.badgeTemplateId || event.generatorKey || '—')}</td>
          <td>${escapeHtml(formatAnalyticsTimestamp(event.timestamp))}</td>
        </tr>`).join('')
    : '<tr><td colspan="4" class="empty-row">No activity matches these filters yet.</td></tr>';

  const topBadgeRows = badgePages.slice(0, 8).map((page) => `
    <tr>
      <td><strong>${escapeHtml(page.awardeeName || 'Unknown')}</strong><div class="table-subtext">${escapeHtml(page.badgeTitle || page.slug || '')}</div></td>
      <td>${escapeHtml(String(page.badgeViews || 0))}</td>
      <td>${escapeHtml(String(page.certificateDownloads || 0))}</td>
      <td>${page.publicUrl ? `<a class="text-link" href="${escapeAttribute(page.publicUrl)}" target="_blank" rel="noreferrer">Open</a>` : '—'}</td>
    </tr>`).join('') || '<tr><td colspan="4" class="empty-row">No badge page traffic has been captured yet.</td></tr>';

  const badgeTypeRows = badgeTypes.slice(0, 10).map((item) => `
    <tr>
      <td><strong>${escapeHtml(item.title || item.id || 'Unknown')}</strong><div class="table-subtext">${escapeHtml(item.id || '')}</div></td>
      <td>${escapeHtml(String(item.badgesIssued || 0))}</td>
      <td>${escapeHtml(String(item.badgeViews || 0))}</td>
      <td>${escapeHtml(String(item.certificateDownloads || 0))}</td>
      <td>${escapeHtml(String(item.generatorCompletions || 0))}</td>
    </tr>`).join('') || '<tr><td colspan="5" class="empty-row">No badge type activity has been captured yet.</td></tr>';

  const generatorRows = generatorPages.map((item) => `
    <tr>
      <td><strong>${escapeHtml(item.label || item.key || '')}</strong><div class="table-subtext">${escapeHtml(item.pageKind || '')}</div></td>
      <td>${escapeHtml(String(item.opens || 0))}</td>
      <td>${escapeHtml(String(item.completions || 0))}</td>
      <td>${escapeHtml(String(item.conversionRate || 0))}%</td>
    </tr>`).join('') || '<tr><td colspan="4" class="empty-row">No generator activity has been captured yet.</td></tr>';

  const body = `
    <section class="admin-header">
      <div>
        <p class="admin-section-label">Analytics</p>
        <h2>Performance, engagement, and conversion</h2>
        <p>Track issuance momentum, public badge traffic, certificate downloads, and how well your generators convert visits into published credentials.</p>
      </div>
      <div class="inline-actions">
        <a class="button button--ghost" href="/admin/export/analytics.csv${filters.queryString ? `?${escapeAttribute(filters.queryString)}` : ''}">Export analytics CSV</a>
      </div>
    </section>

    <section class="admin-panel">
      <form method="get" action="/admin/analytics" class="search-toolbar analytics-filters">
        <label class="search-toolbar__field">
          <span>Year</span>
          <select name="year">
            <option value="">All years</option>
            ${yearOptions}
          </select>
        </label>
        <label class="search-toolbar__field">
          <span>Month</span>
          <select name="month">
            <option value="">All months</option>
            ${monthOptions}
          </select>
        </label>
        <label class="search-toolbar__field">
          <span>Badge type</span>
          <select name="badgeType">
            <option value="">All badge types</option>
            ${badgeOptions}
          </select>
        </label>
        <div class="inline-actions analytics-filter-actions">
          <button type="submit">Apply filters</button>
          <a class="button button--ghost" href="/admin/analytics">Reset</a>
        </div>
      </form>
    </section>

    <section class="stats-grid stats-grid--five">
      <article class="stat-card"><span>Total badges issued</span><strong>${escapeHtml(String(totals.badgesIssued || 0))}</strong></article>
      <article class="stat-card"><span>Badge page views</span><strong>${escapeHtml(String(totals.badgeViews || 0))}</strong></article>
      <article class="stat-card"><span>Certificate downloads</span><strong>${escapeHtml(String(totals.certificateDownloads || 0))}</strong></article>
      <article class="stat-card"><span>Generator conversion</span><strong>${escapeHtml(String(totals.conversionRate || 0))}%</strong></article>
      <article class="stat-card"><span>Unique visitors approx.</span><strong>${escapeHtml(String(totals.uniqueVisitorsApprox || 0))}</strong></article>
    </section>

    <section class="analytics-grid analytics-grid--two">
      <article class="admin-panel">
        <div class="admin-section-heading">
          <div>
            <p class="admin-section-label">Month to month</p>
            <h3>Issuance trend</h3>
          </div>
          <span class="muted">Latest month: ${escapeHtml(latestMonth ? `${latestMonth.badgesIssued} issued` : 'No data')}</span>
        </div>
        ${renderMiniBars(months.slice(-12), 'badgesIssued', 'Issue a badge to start the monthly trend line.')}
      </article>

      <article class="admin-panel">
        <div class="admin-section-heading">
          <div>
            <p class="admin-section-label">Engagement</p>
            <h3>Badge page views by month</h3>
          </div>
          <span class="muted">Latest month: ${escapeHtml(latestMonth ? `${latestMonth.badgeViews} views` : 'No data')}</span>
        </div>
        ${renderMiniBars(months.slice(-12), 'badgeViews', 'Public badge page views will appear here once visitors arrive.')}
      </article>

      <article class="admin-panel">
        <div class="admin-section-heading">
          <div>
            <p class="admin-section-label">Year over year</p>
            <h3>Annual issuance</h3>
          </div>
          <span class="muted">Latest year: ${escapeHtml(latestYear ? `${latestYear.badgesIssued} issued` : 'No data')}</span>
        </div>
        ${renderMiniBars(years, 'badgesIssued', 'Year-over-year totals will appear once you have badges across multiple years.')}
      </article>

      <article class="admin-panel">
        <div class="admin-section-heading">
          <div>
            <p class="admin-section-label">Downloads</p>
            <h3>Certificate downloads by month</h3>
          </div>
          <span class="muted">Latest month: ${escapeHtml(latestMonth ? `${latestMonth.certificateDownloads} downloads` : 'No data')}</span>
        </div>
        ${renderMiniBars(months.slice(-12), 'certificateDownloads', 'Download activity will appear once recipients save certificates.')}
      </article>
    </section>

    <section class="analytics-grid analytics-grid--two">
      <article class="admin-panel">
        <div class="admin-section-heading">
          <div>
            <p class="admin-section-label">Badge types</p>
            <h3>Views by badge type</h3>
          </div>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Badge type</th><th>Issued</th><th>Views</th><th>Downloads</th><th>Completed</th></tr></thead>
            <tbody>${badgeTypeRows}</tbody>
          </table>
        </div>
      </article>

      <article class="admin-panel">
        <div class="admin-section-heading">
          <div>
            <p class="admin-section-label">Top performers</p>
            <h3>Most-viewed badge pages</h3>
          </div>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Recipient / badge</th><th>Views</th><th>Downloads</th><th>Link</th></tr></thead>
            <tbody>${topBadgeRows}</tbody>
          </table>
        </div>
      </article>
    </section>

    <section class="analytics-grid analytics-grid--two">
      <article class="admin-panel">
        <div class="admin-section-heading">
          <div>
            <p class="admin-section-label">Generator usage</p>
            <h3>Which generator pages are performing</h3>
          </div>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Generator page</th><th>Opens</th><th>Completions</th><th>Conversion</th></tr></thead>
            <tbody>${generatorRows}</tbody>
          </table>
        </div>
      </article>

      <article class="admin-panel">
        <div class="admin-section-heading">
          <div>
            <p class="admin-section-label">Recent activity</p>
            <h3>Latest tracked events</h3>
          </div>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Event</th><th>Recipient</th><th>Badge type</th><th>When</th></tr></thead>
            <tbody>${recentRows}</tbody>
          </table>
        </div>
      </article>
    </section>
  `;

  return adminLayout({ title: 'Analytics', active: 'analytics', body });
}

module.exports = {
  renderLoginPage,
  renderDashboard,
  renderIssuePage,
  renderTemplatesPage,
  renderSettingsPage,
  renderAnalyticsPage,
  renderBackupsPage
};
