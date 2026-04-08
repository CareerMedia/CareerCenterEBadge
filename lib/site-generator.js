const fs = require('fs');
const path = require('path');
const {
  PATHS,
  ensureDir,
  writeJson,
  writeText,
  loadBadges,
  loadBadgeTemplates,
  loadCertificateTemplate,
  loadSiteConfig,
  escapeHtml,
  escapeAttribute,
  serializeForScript,
  sortBadgesDescending,
  computeBadgeStats,
  getPublicHomeUrl,
  getPublicRegistryUrl,
  removeDirectoryContents,
  buildBadgeLinksCsv
} = require('./store');

function relativePathFromDepth(assetPath, depth) {
  if (!assetPath) {
    return '';
  }
  if (/^https?:\/\//i.test(assetPath) || assetPath.startsWith('data:')) {
    return assetPath;
  }
  const prefix = depth <= 0 ? '' : '../'.repeat(depth);
  return `${prefix}${String(assetPath).replace(/^\/+/, '')}`;
}

function buildCanonical(siteConfig, relativePath) {
  const base = String(siteConfig.publicSiteUrl || '').replace(/\/+$/, '');
  if (!base || /YOUR-GITHUB-USERNAME|YOUR-REPO-NAME/.test(base)) {
    return '';
  }
  const suffix = relativePath ? `/${String(relativePath).replace(/^\/+/, '')}` : '/';
  return `${base}${suffix}`.replace(/([^:])\/+/g, '$1/');
}

function buildStructuredData(badge, siteConfig) {
  return {
    '@context': 'https://schema.org',
    '@type': 'EducationalOccupationalCredential',
    name: badge.badgeTitle,
    description: badge.description || badge.meaning,
    credentialCategory: 'Digital Badge',
    url: badge.publicUrl,
    validFor: 'Never expires',
    recognizedBy: {
      '@type': 'Organization',
      name: badge.issuerOrganization || siteConfig.organizationName || badge.issuerName,
      url: badge.issuerWebsite || badge.careerCenterUrl || siteConfig.defaultCareerCenterUrl
    },
    creator: {
      '@type': 'Organization',
      name: badge.issuerName || siteConfig.organizationName,
      url: badge.issuerWebsite || badge.careerCenterUrl || siteConfig.defaultCareerCenterUrl
    },
    dateCreated: badge.issueDateISO,
    recipient: {
      '@type': 'Person',
      name: badge.awardeeName
    }
  };
}

function renderBrandLockup(depth, siteConfig, options = {}) {
  const logo = relativePathFromDepth('assets/CC_Logo_Lockup_Main@5x.png', depth);
  const subtitle = options.subtitle || 'Official digital credentials';
  const light = options.light ? ' brand-lockup--light' : '';
  return `
    <div class="brand-lockup${light}">
      <img class="brand-lockup__logo" src="${escapeAttribute(logo)}" alt="${escapeAttribute(siteConfig.organizationName)} logo" />
      <div class="brand-lockup__text">
        <strong>${escapeHtml(siteConfig.siteName)}</strong>
        <span>${escapeHtml(subtitle)}</span>
      </div>
    </div>`;
}

function renderTopBar(depth, siteConfig, options = {}) {
  const actions = (options.actions || [])
    .map((action) => `<a class="topbar-link${action.primary ? ' topbar-link--primary' : ''}" href="${escapeAttribute(action.href)}"${action.external ? ' target="_blank" rel="noreferrer"' : ''}>${escapeHtml(action.label)}</a>`)
    .join('');
  const compact = options.compact ? ' public-topbar--compact' : '';
  return `
    <div class="public-topbar${compact}">
      <div class="wrap public-topbar__inner">
        ${renderBrandLockup(depth, siteConfig, { subtitle: options.subtitle, light: options.light })}
        <div class="topbar-actions">${actions}</div>
      </div>
    </div>`;
}

function renderStatPills(stats) {
  return `
    <div class="metric-strip">
      <article class="metric-card">
        <span class="metric-card__label">Issued credentials</span>
        <strong id="heroTotalIssued">${stats.totalIssued}</strong>
      </article>
      <article class="metric-card">
        <span class="metric-card__label">Valid credentials</span>
        <strong id="heroValidCount">${stats.validCount}</strong>
      </article>
      <article class="metric-card">
        <span class="metric-card__label">Latest issue</span>
        <strong>${escapeHtml(stats.latestIssueDate)}</strong>
      </article>
    </div>`;
}

function renderHomePage(siteConfig, stats, templates) {
  const canonical = buildCanonical(siteConfig, '');
  const generatorCards = templates
    .map(
      (template) => `
        <article class="template-card">
          <div class="template-card__head">
            <div class="template-card__icon-wrap">
              ${template.badgeImage ? `<img src="${escapeAttribute(template.badgeImage)}" alt="${escapeAttribute(template.title)} icon" class="template-card__icon" />` : '<span class="template-card__placeholder">★</span>'}
            </div>
            <div>
              <p class="section-label">Specific generator</p>
              <h3>${escapeHtml(template.title)}</h3>
            </div>
          </div>
          <p>${escapeHtml(template.description || template.meaning || '')}</p>
          <div class="template-card__actions">
            <a class="button-link" href="generator/${encodeURIComponent(template.id)}/">Open generator</a>
            <span class="route-chip">/generator/${escapeHtml(template.id)}/</span>
          </div>
        </article>`
    )
    .join('');

  const badgeTypeCards = templates
    .map(
      (template) => `
        <article class="feature-card feature-card--catalog">
          <div class="feature-card__media">
            ${template.badgeImage ? `<img src="${escapeAttribute(template.badgeImage)}" alt="${escapeAttribute(template.title)} badge" />` : '<div class="feature-card__fallback">★</div>'}
          </div>
          <div>
            <p class="section-label">Badge type</p>
            <h3>${escapeHtml(template.title)}</h3>
            <p>${escapeHtml(template.description || template.meaning || '')}</p>
          </div>
        </article>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(siteConfig.siteName)} | Protected directory</title>
    <meta name="description" content="Access the protected CSUN Career Center E-Badges directory, search official credentials, and open polished credential generator pages." />
    ${canonical ? `<link rel="canonical" href="${escapeAttribute(canonical)}" />` : ''}
    <link rel="stylesheet" href="assets/public.css" />
  </head>
  <body data-page="home">
    ${renderTopBar(0, siteConfig, {
      subtitle: 'Protected directory',
      actions: [
        { href: 'registry/', label: 'Open registry' },
        { href: 'generator/', label: 'General generator', primary: true }
      ]
    })}

    <main class="page-stack">
      <section class="hero-shell hero-shell--home">
        <div class="wrap hero-shell__inner hero-shell__inner--home">
          <div class="hero-copy">
            <p class="eyebrow">${escapeHtml(siteConfig.organizationName)}</p>
            <h1>${escapeHtml(siteConfig.heroTitle)}</h1>
            <p class="lede">${escapeHtml(siteConfig.heroIntro)}</p>
            <div class="pill-row">
              <span class="pill pill--accent">Protected search</span>
              <span class="pill">Public verification pages</span>
              <span class="pill">Certificate PDF downloads</span>
            </div>
          </div>
          <div class="hero-showcase">
            <section class="showcase-panel showcase-panel--dark">
              <p class="section-label section-label--light">Trust layer</p>
              <h2>One credential system. Multiple badge programs.</h2>
              <p>Deliver premium verification pages, keep a searchable archive for your team, and publish a badge link recipients can use anywhere.</p>
              ${renderStatPills(stats)}
            </section>
          </div>
        </div>
      </section>

      <section class="page-section">
        <div class="wrap split-grid split-grid--hero-cards">
          <article class="panel panel--soft">
            <div class="panel-heading">
              <div>
                <p class="section-label">Verification</p>
                <h2>Search official credentials</h2>
              </div>
            </div>
            <p>Search by recipient, badge title, credential ID, or date. Every result opens a formal badge page with meaning, issuer details, certificate access, and validation status.</p>
            <form class="search-bar" action="registry/" method="get">
              <label class="sr-only" for="registrySearch">Search the badge registry</label>
              <input id="registrySearch" name="q" type="search" placeholder="Search by recipient, badge, or credential ID" />
              <button type="submit">Search registry</button>
            </form>
          </article>
          <article class="panel panel--gradient">
            <div class="panel-heading">
              <div>
                <p class="section-label">Issuance</p>
                <h2>General and badge-specific generators</h2>
              </div>
            </div>
            <p>Use the general generator for any credential, or send a dedicated page for a single badge type so recipients can only issue that exact credential.</p>
            <div class="panel-actions">
              <a class="button-link" href="generator/">Open general generator</a>
            </div>
          </article>
        </div>
      </section>

      <section class="page-section page-section--dense">
        <div class="wrap">
          <div class="section-heading">
            <div>
              <p class="section-label">Specific generators</p>
              <h2>Direct issue pages for each badge type</h2>
            </div>
          </div>
          <div class="template-card-grid">
            ${generatorCards || '<div class="empty-state">No badge templates have been configured yet.</div>'}
          </div>
        </div>
      </section>

      <section class="page-section page-section--muted">
        <div class="wrap">
          <div class="section-heading">
            <div>
              <p class="section-label">Badge catalog</p>
              <h2>Configured badge experiences</h2>
            </div>
          </div>
          <div class="feature-grid feature-grid--catalog">
            ${badgeTypeCards || '<div class="empty-state">No badge templates have been configured yet.</div>'}
          </div>
        </div>
      </section>

      <section class="page-section">
        <div class="wrap">
          <div class="section-heading">
            <div>
              <p class="section-label">Recently issued</p>
              <h2>Latest public credentials</h2>
            </div>
            <span class="muted">Newest badges appear here automatically.</span>
          </div>
          <div id="recentBadges" class="credential-list" data-source="data/badges.json"></div>
        </div>
      </section>
    </main>

    <script src="assets/site.js"></script>
  </body>
</html>`;
}

function renderGeneratorPage(siteConfig, templates, certificateTemplate, options = {}) {
  const fixedTemplateId = options.fixedTemplateId || '';
  const fixedTemplate = fixedTemplateId ? templates.find((template) => template.id === fixedTemplateId) : null;
  const relativePath = options.relativePath || (fixedTemplate ? `generator/${fixedTemplate.id}/` : 'generator/');
  const depth = options.depth == null ? (fixedTemplate ? 2 : 1) : options.depth;
  const canonical = buildCanonical(siteConfig, relativePath);
  const payload = {
    submitEndpoint: '/api/public/issue',
    fixedTemplateId: fixedTemplate ? fixedTemplate.id : '',
    certificateTemplate: {
      ...certificateTemplate,
      backgroundImage: relativePathFromDepth(certificateTemplate.backgroundImage, depth)
    },
    templates: templates.map((template) => ({
      ...template,
      badgeImage: relativePathFromDepth(template.badgeImage, depth),
      certificateBackground: relativePathFromDepth(template.certificateBackground || certificateTemplate.backgroundImage, depth)
    }))
  };

  const templateOptions = templates
    .map((template) => `<option value="${escapeAttribute(template.id)}">${escapeHtml(template.title)}</option>`)
    .join('');

  const title = fixedTemplate ? `${fixedTemplate.title} Generator` : 'General Credential Generator';
  const intro = fixedTemplate
    ? `Create the ${fixedTemplate.title} badge and matching certificate. This page is locked to a single badge type so recipients only issue that credential.`
    : 'Enter the recipient name, keep today’s prefilled date or change it, and create a polished public badge page with a matching certificate PDF.';
  const leadBadge = fixedTemplate
    ? `<span class="pill pill--accent">Locked to ${escapeHtml(fixedTemplate.title)}</span>`
    : '<span class="pill pill--accent">Any configured badge type</span>';

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(siteConfig.siteName)} | ${escapeHtml(title)}</title>
    <meta name="description" content="Create a public badge record, generate the matching certificate PDF, and copy the final verification URL." />
    ${canonical ? `<link rel="canonical" href="${escapeAttribute(canonical)}" />` : ''}
    <link rel="stylesheet" href="${'../'.repeat(depth)}assets/public.css" />
  </head>
  <body data-page="generator">
    ${renderTopBar(depth, siteConfig, {
      subtitle: fixedTemplate ? `${fixedTemplate.title} generator` : 'General generator',
      compact: true
    })}

    <main class="page-stack page-stack--generator">
      <section class="hero-shell hero-shell--generator">
        <div class="wrap hero-shell__inner hero-shell__inner--generator">
          <div class="hero-copy">
            <p class="eyebrow">${escapeHtml(siteConfig.siteName)}</p>
            <h1>${escapeHtml(title)}</h1>
            <p class="lede">${escapeHtml(intro)}</p>
            <div class="pill-row">
              ${leadBadge}
              <span class="pill">Named PDF certificate</span>
              <span class="pill">Shareable badge page</span>
            </div>
          </div>
        </div>
      </section>

      <section class="page-section">
        <div class="wrap generator-layout">
          <div class="generator-main">
            <article class="panel panel--form panel--surface">
              <div class="panel-heading">
                <div>
                  <p class="section-label">Issue a credential</p>
                  <h2>Credential generator</h2>
                </div>
              </div>
              <form id="publicGeneratorForm" class="certificate-form certificate-form--generator">
                <div class="form-grid form-grid--two">
                  <label>
                    <span>Recipient name</span>
                    <input type="text" id="publicGeneratorName" name="awardeeName" placeholder="Enter the recipient’s full name" required />
                  </label>
                  <label>
                    <span>Issue date</span>
                    <input type="text" id="publicGeneratorDate" name="issueDate" value="" required />
                  </label>
                  <label class="generator-selector-wrap${fixedTemplate ? ' generator-selector-wrap--hidden' : ''}">
                    <span>Badge type</span>
                    <select id="publicGeneratorTemplate" name="badgeTemplateId" ${fixedTemplate ? 'disabled' : ''} required>
                      <option value="">Select a badge template</option>
                      ${templateOptions}
                    </select>
                  </label>
                </div>
                <div class="form-actions form-actions--generator">
                  <button type="button" id="publicPreviewButton" class="button-secondary">Preview certificate</button>
                  <button type="submit" id="publicCreateButton">Create badge and certificate</button>
                </div>
                <p id="publicGeneratorStatus" class="status-message" role="status" aria-live="polite"></p>
              </form>
            </article>

            <article class="panel panel--surface generator-result" id="generatorResultCard" hidden>
              <div class="panel-heading">
                <div>
                  <p class="section-label">Credential created</p>
                  <h2>Your verification page is ready</h2>
                </div>
              </div>
              <dl class="detail-list detail-list--stacked generator-result-list">
                <div><dt>Recipient</dt><dd id="generatorResultName"></dd></div>
                <div><dt>Badge</dt><dd id="generatorResultBadge"></dd></div>
                <div><dt>Issue date</dt><dd id="generatorResultDate"></dd></div>
                <div><dt>Credential ID</dt><dd id="generatorResultId"></dd></div>
                <div><dt>Verification URL</dt><dd><a id="generatorResultUrl" href="#" target="_blank" rel="noreferrer"></a></dd></div>
              </dl>
              <div class="form-actions form-actions--stacked">
                <a class="button-link" id="generatorOpenBadge" href="#" target="_blank" rel="noreferrer">Open badge page</a>
                <button type="button" class="button-secondary" id="generatorCopyBadge">Copy badge link</button>
                <button type="button" class="button-secondary" id="generatorDownloadPdf">Download certificate PDF</button>
              </div>
            </article>
          </div>

          <aside class="generator-aside">
            <article class="panel panel--surface panel--preview">
              <div class="panel-heading">
                <div>
                  <p class="section-label">Credential profile</p>
                  <h2 id="generatorTemplateTitle">Choose a badge type</h2>
                </div>
              </div>
              <p id="generatorTemplateDescription" class="generator-template-copy">Once you pick a badge template, the public summary, issuer, and badge artwork appear here.</p>
              <div class="generator-profile-grid">
                <div class="badge-visual-card generator-badge-card">
                  <img id="generatorTemplateImage" class="badge-visual-card__image" alt="Selected badge image" style="display:none;" />
                  <div id="generatorTemplateImageEmpty" class="empty-state">Badge artwork preview</div>
                </div>
                <div class="detail-card generator-template-details">
                  <div>
                    <p class="section-label">Meaning</p>
                    <p id="generatorTemplateMeaning" class="generator-template-copy">Select a badge template to view the official badge meaning.</p>
                  </div>
                  <div>
                    <p class="section-label">Issuer</p>
                    <p id="generatorTemplateIssuer" class="generator-template-copy">Issuer details will appear here.</p>
                  </div>
                  <div>
                    <p class="section-label">Career Center</p>
                    <p id="generatorTemplateCareerCenter" class="generator-template-copy">Career Center link will appear here.</p>
                  </div>
                </div>
              </div>
            </article>

            <article class="panel panel--surface panel--preview">
              <div class="panel-heading">
                <div>
                  <p class="section-label">Certificate preview</p>
                  <h2>Live render</h2>
                </div>
              </div>
              <div class="preview-shell preview-shell--generator">
                <canvas id="publicGeneratorCanvas" class="is-hidden"></canvas>
                <img id="publicGeneratorImage" alt="Certificate preview" style="display:none;" />
                <div id="publicGeneratorPreviewEmpty" class="empty-state">Preview the certificate before publishing.</div>
              </div>
            </article>
          </aside>
        </div>
      </section>

      <section class="page-section page-section--dense page-section--how-it-works">
        <div class="wrap">
          <article class="panel panel--surface panel--process">
            <div class="panel-heading">
              <div>
                <p class="section-label">How it works</p>
                <h2>One clean flow from issuance to verification.</h2>
              </div>
            </div>
            <ol class="process-list">
              <li>Enter the recipient name and review the issue date.</li>
              <li>${fixedTemplate ? `The badge type is already set to ${escapeHtml(fixedTemplate.title)}.` : 'Choose the badge type you want to issue.'}</li>
              <li>Create the credential, copy the verification URL, and download the certificate PDF.</li>
            </ol>
          </article>
        </div>
      </section>
    </main>

    <script>window.PUBLIC_GENERATOR_DATA = ${serializeForScript(payload)};</script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
    <script src="${'../'.repeat(depth)}assets/site.js"></script>
  </body>
</html>`;
}

function renderRegistryPage(siteConfig) {
  const canonical = buildCanonical(siteConfig, 'registry/');
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(siteConfig.siteName)} | Badge Registry</title>
    <meta name="description" content="Search and verify official digital badges issued by the CSUN Career Center." />
    ${canonical ? `<link rel="canonical" href="${escapeAttribute(canonical)}" />` : ''}
    <link rel="stylesheet" href="../assets/public.css" />
  </head>
  <body data-page="registry">
    ${renderTopBar(1, siteConfig, {
      subtitle: 'Protected registry',
      actions: [{ href: '../generator/', label: 'General generator', primary: true }]
    })}

    <main class="page-stack">
      <section class="hero-shell hero-shell--registry">
        <div class="wrap hero-shell__inner hero-shell__inner--registry">
          <div class="hero-copy">
            <p class="eyebrow">Protected verification registry</p>
            <h1>Search issued digital badges</h1>
            <p class="lede">Find a credential by recipient name, badge title, credential ID, or issue date.</p>
          </div>
          <div class="showcase-panel showcase-panel--light">
            <p class="section-label">Verification standard</p>
            <h2>Every result opens the official credential record.</h2>
            <p>Search results point to a polished public page with the badge meaning, issuer, certificate preview, and shareable verification URL.</p>
          </div>
        </div>
      </section>

      <section class="page-section">
        <div class="wrap">
          <div class="panel panel--surface panel--search">
            <form id="registryPageSearch" class="search-bar search-bar--wide">
              <label class="sr-only" for="registrySearchInput">Search the badge registry</label>
              <input id="registrySearchInput" name="q" type="search" placeholder="Search by recipient, badge title, date, or credential ID" />
              <button type="submit">Search</button>
            </form>
            <p class="muted">Every result links to a public credential page with validation details, badge image, issuer information, and certificate download.</p>
            <div id="registryResults" class="credential-list" data-source="../data/badges.json"></div>
          </div>
        </div>
      </section>
    </main>

    <script src="../assets/site.js"></script>
  </body>
</html>`;
}

function render404Page(siteConfig) {
  const logo = '/assets/CC_Logo_Lockup_Main@5x.png';
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(siteConfig.siteName)} | Page not found</title>
    <link rel="stylesheet" href="/assets/public.css" />
  </head>
  <body class="public-access-page">
    <main class="public-access-shell">
      <section class="panel panel--surface public-access-card public-access-card--notfound">
        <div class="brand-lockup">
          <img class="brand-lockup__logo" src="${escapeAttribute(logo)}" alt="${escapeAttribute(siteConfig.organizationName)} logo" />
          <div class="brand-lockup__text">
            <strong>${escapeHtml(siteConfig.siteName)}</strong>
            <span>Official digital credentials</span>
          </div>
        </div>
        <p class="eyebrow">404</p>
        <h1>That credential page could not be found.</h1>
        <p class="lede">Return to the registry to search for a valid badge, or go back to the protected home page.</p>
        <div class="form-actions">
          <a class="button-link" href="/">Go home</a>
          <a class="button-link button-link--secondary" href="/registry/">Open registry</a>
        </div>
      </section>
    </main>
  </body>
</html>`;
}

function renderBadgePage(badge, siteConfig, certificateTemplate) {
  const canonical = buildCanonical(siteConfig, `badges/${badge.slug}/`);
  const pageTitle = `${badge.badgeTitle} | ${badge.awardeeName}`;
  const pageDescription = `${badge.awardeeName} was awarded the ${badge.badgeTitle} by ${badge.issuerName}. This credential is valid and never expires.`;
  const badgeImageForPage = relativePathFromDepth(badge.badgeImage, 2);
  const certificateConfigForPage = {
    ...certificateTemplate,
    backgroundImage: relativePathFromDepth(badge.certificateBackground || certificateTemplate.backgroundImage, 2)
  };
  const structuredData = buildStructuredData(badge, siteConfig);

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(pageTitle)}</title>
    <meta name="description" content="${escapeAttribute(pageDescription)}" />
    ${canonical ? `<link rel="canonical" href="${escapeAttribute(canonical)}" />` : ''}
    <meta property="og:title" content="${escapeAttribute(pageTitle)}" />
    <meta property="og:description" content="${escapeAttribute(pageDescription)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${escapeAttribute(badge.publicUrl)}" />
    <meta property="og:image" content="${escapeAttribute(/^https?:\/\//i.test(badge.badgeImage) ? badge.badgeImage : buildCanonical(siteConfig, badge.badgeImage))}" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="stylesheet" href="../../assets/public.css" />
    <script type="application/ld+json">${serializeForScript(structuredData)}</script>
  </head>
  <body data-page="badge">
    ${renderTopBar(2, siteConfig, {
      subtitle: 'Official badge verification',
      compact: true
    })}

    <main class="page-stack page-stack--badge">
      <section class="hero-shell hero-shell--badge">
        <div class="wrap badge-hero-grid">
          <div class="hero-copy">
            <p class="eyebrow">Official credential verification</p>
            <h1>${escapeHtml(badge.badgeTitle)}</h1>
            <p class="lede">Awarded to <strong>${escapeHtml(badge.awardeeName)}</strong>. This badge is valid, issued by ${escapeHtml(badge.issuerName)}, and marked as never expiring.</p>
            <div class="pill-row">
              <span class="pill pill--accent">Valid</span>
              <span class="pill">Never expires</span>
              <span class="pill">Credential ID ${escapeHtml(badge.id)}</span>
            </div>
            <div class="form-actions badge-hero-actions">
              <button type="button" class="button-secondary" data-copy-url="${escapeAttribute(badge.publicUrl)}">Copy verification link</button>
              <a class="button-link button-link--secondary" href="${escapeAttribute(badge.careerCenterUrl)}" target="_blank" rel="noreferrer">Career Center website</a>
            </div>
          </div>
          <div class="badge-hero-art">
            <div class="badge-display">
              <img src="${escapeAttribute(badgeImageForPage)}" alt="${escapeAttribute(badge.badgeTitle)} badge image" class="badge-display__image" />
            </div>
          </div>
        </div>
      </section>

      <section class="page-section page-section--dense">
        <div class="wrap badge-detail-grid">
          <article class="panel panel--surface panel--credential-fact">
            <p class="section-label">Recipient</p>
            <h2>${escapeHtml(badge.awardeeName)}</h2>
            <dl class="detail-list">
              <div><dt>Issue date</dt><dd>${escapeHtml(badge.issueDate)}</dd></div>
              <div><dt>Expiration</dt><dd>Never expires</dd></div>
              <div><dt>Issued by</dt><dd>${escapeHtml(badge.issuerName)}</dd></div>
              <div><dt>Organization</dt><dd>${escapeHtml(badge.issuerOrganization || siteConfig.organizationName)}</dd></div>
              <div><dt>Credential ID</dt><dd>${escapeHtml(badge.id)}</dd></div>
            </dl>
          </article>
          <article class="panel panel--surface panel--meaning">
            <p class="section-label">Meaning</p>
            <h2>What this credential represents</h2>
            <p>${escapeHtml(badge.meaning)}</p>
            <div class="divider"></div>
            <p class="section-label">Eligibility or criteria</p>
            <p>${escapeHtml(badge.criteria)}</p>
          </article>
          <article class="panel panel--surface panel--verification">
            <p class="section-label">Verification</p>
            <h2>Official credential record</h2>
            <dl class="detail-list detail-list--stacked">
              <div><dt>Verification URL</dt><dd><a href="${escapeAttribute(badge.publicUrl)}">${escapeHtml(badge.publicUrl)}</a></dd></div>
              <div><dt>Issuer website</dt><dd><a href="${escapeAttribute(badge.issuerWebsite)}" target="_blank" rel="noreferrer">${escapeHtml(badge.issuerWebsite)}</a></dd></div>
              <div><dt>Career Center</dt><dd><a href="${escapeAttribute(badge.careerCenterUrl)}" target="_blank" rel="noreferrer">${escapeHtml(badge.careerCenterUrl)}</a></dd></div>
              <div><dt>Credential data</dt><dd><a href="details.json">Download metadata JSON</a></dd></div>
            </dl>
          </article>
        </div>
      </section>

      <section class="page-section">
        <div class="wrap split-grid split-grid--badge-bottom">
          <article class="panel panel--surface panel--certificate">
            <div class="panel-heading">
              <div>
                <p class="section-label">Certificate</p>
                <h2>Download the matching certificate PDF</h2>
              </div>
            </div>
            <p>Celebrate this achievement with a presentation-ready certificate.</p>
            <div class="form-actions">
              <button type="button" id="btnDownloadBadgeCertificate">Download PDF</button>
            </div>
            <canvas id="badgeCertCanvas" class="is-hidden"></canvas>
            <div class="preview-shell preview-shell--compact">
              <img id="badgeCertImage" alt="Certificate preview for ${escapeAttribute(badge.awardeeName)}" />
            </div>
          </article>
          <article class="panel panel--surface panel--issuer-statement">
            <p class="section-label">Issuer statement</p>
            <h2>${escapeHtml(badge.badgeLabel || badge.badgeTitle)}</h2>
            <p>${escapeHtml(badge.description || badge.meaning)}</p>
            <div class="info-callout info-callout--accented">
              <strong>Issued by ${escapeHtml(badge.issuerName)}</strong>
              <p>${escapeHtml(badge.issuerOrganization || siteConfig.organizationName)}</p>
            </div>
          </article>
        </div>
      </section>
    </main>

    <script>window.BADGE_PAGE_DATA = ${serializeForScript({
      awardeeName: badge.awardeeName,
      issueDate: badge.issueDate,
      badgeTitle: badge.badgeTitle,
      publicUrl: badge.publicUrl,
      fileNameSuffix: certificateTemplate.fileNameSuffix
    })};</script>
    <script>window.CERTIFICATE_TEMPLATE = ${serializeForScript(certificateConfigForPage)};</script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
    <script src="../../assets/site.js"></script>
  </body>
</html>`;
}

function renderRobots(siteConfig) {
  const sitemapUrl = buildCanonical(siteConfig, 'sitemap.xml');
  return `User-agent: *\nAllow: /\n${sitemapUrl ? `Sitemap: ${sitemapUrl}\n` : ''}`;
}

function renderSitemap(siteConfig, badges, templates) {
  const base = String(siteConfig.publicSiteUrl || '').replace(/\/+$/, '');
  if (!base || /YOUR-GITHUB-USERNAME|YOUR-REPO-NAME/.test(base)) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n';
  }

  const urls = [
    '',
    'generator/',
    'registry/',
    ...templates.map((template) => `generator/${template.id}/`),
    ...badges.map((badge) => `badges/${badge.slug}/`)
  ];

  const items = urls
    .map((relativePath) => {
      const loc = relativePath ? `${base}/${relativePath}` : `${base}/`;
      return `  <url><loc>${escapeHtml(loc)}</loc></url>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</urlset>\n`;
}

function buildPublicSite() {
  ensureDir(PATHS.docsDir);
  ensureDir(PATHS.docsDataDir);
  ensureDir(PATHS.docsBadgesDir);
  ensureDir(PATHS.docsRegistryDir);
  ensureDir(path.join(PATHS.docsDir, 'generator'));

  const siteConfig = loadSiteConfig();
  const certificateTemplate = loadCertificateTemplate();
  const templates = loadBadgeTemplates();
  const badges = sortBadgesDescending(loadBadges());
  const stats = computeBadgeStats(badges);

  writeText(PATHS.badgeLinksCsvFile, buildBadgeLinksCsv(badges));

  writeJson(path.join(PATHS.docsDataDir, 'badges.json'), badges);
  writeJson(path.join(PATHS.docsDataDir, 'templates.json'), templates);
  writeJson(path.join(PATHS.docsDataDir, 'certificate-template.json'), certificateTemplate);
  writeJson(path.join(PATHS.docsDataDir, 'site-config.json'), siteConfig);
  writeText(path.join(PATHS.docsDataDir, 'badge-links.csv'), fs.readFileSync(PATHS.badgeLinksCsvFile, 'utf8'));

  writeText(path.join(PATHS.docsDir, 'index.html'), renderHomePage(siteConfig, stats, templates));

  const docsGeneratorDir = path.join(PATHS.docsDir, 'generator');
  removeDirectoryContents(docsGeneratorDir);
  ensureDir(docsGeneratorDir);
  writeText(path.join(docsGeneratorDir, 'index.html'), renderGeneratorPage(siteConfig, templates, certificateTemplate));
  for (const template of templates) {
    const generatorDir = path.join(docsGeneratorDir, template.id);
    ensureDir(generatorDir);
    writeText(path.join(generatorDir, 'index.html'), renderGeneratorPage(siteConfig, templates, certificateTemplate, {
      fixedTemplateId: template.id,
      depth: 2,
      relativePath: `generator/${template.id}/`
    }));
  }

  writeText(path.join(PATHS.docsRegistryDir, 'index.html'), renderRegistryPage(siteConfig));
  writeText(path.join(PATHS.docsDir, '404.html'), render404Page(siteConfig));
  writeText(path.join(PATHS.docsDir, 'robots.txt'), renderRobots(siteConfig));
  writeText(path.join(PATHS.docsDir, 'sitemap.xml'), renderSitemap(siteConfig, badges, templates));

  removeDirectoryContents(PATHS.docsBadgesDir);

  for (const badge of badges) {
    const badgeDir = path.join(PATHS.docsBadgesDir, badge.slug);
    ensureDir(badgeDir);
    writeText(path.join(badgeDir, 'index.html'), renderBadgePage(badge, siteConfig, certificateTemplate));
    writeJson(path.join(badgeDir, 'details.json'), badge);
  }

  return {
    siteConfig,
    certificateTemplate,
    templates,
    badges,
    stats,
    homeUrl: getPublicHomeUrl(siteConfig),
    registryUrl: getPublicRegistryUrl(siteConfig)
  };
}

module.exports = {
  buildPublicSite,
  relativePathFromDepth,
  renderHomePage,
  renderGeneratorPage,
  renderRegistryPage,
  renderBadgePage,
  renderSitemap,
  renderRobots
};
