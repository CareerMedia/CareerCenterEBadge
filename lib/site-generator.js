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

function renderHomePage(siteConfig, stats, templates) {
  const canonical = buildCanonical(siteConfig, '');
  const badgeTypeCards = templates
    .map(
      (template) => `
        <article class="feature-card">
          <div class="feature-card__icon">🏅</div>
          <h3>${escapeHtml(template.title)}</h3>
          <p>${escapeHtml(template.description || template.meaning || '')}</p>
        </article>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(siteConfig.siteName)} | Digital Badges and Certificates</title>
    <meta name="description" content="Verify official Career Center badges, open the standalone generator page, and download certificates generated from a configurable template." />
    ${canonical ? `<link rel="canonical" href="${escapeAttribute(canonical)}" />` : ''}
    <link rel="stylesheet" href="assets/public.css" />
  </head>
  <body data-page="home">
    <header class="site-header">
      <div class="wrap site-header__inner">
        <div>
          <p class="eyebrow">${escapeHtml(siteConfig.organizationName)}</p>
          <h1>${escapeHtml(siteConfig.heroTitle)}</h1>
          <p class="lede">${escapeHtml(siteConfig.heroIntro)}</p>
        </div>
        <div class="hero-card">
          <p class="hero-card__label">Verification status</p>
          <div class="hero-card__stats">
            <div>
              <strong id="heroTotalIssued">${stats.totalIssued}</strong>
              <span>issued badges</span>
            </div>
            <div>
              <strong id="heroValidCount">${stats.validCount}</strong>
              <span>currently valid</span>
            </div>
          </div>
          <p class="hero-card__note">All published badge pages are marked as valid and never expire unless manually revoked.</p>
        </div>
      </div>
    </header>

    <main>
      <section class="section section--light">
        <div class="wrap section-grid section-grid--two">
          <div class="card card--elevated">
            <p class="section-label">Badge verification</p>
            <h2>Find an official e-badge</h2>
            <p>Search by recipient name, badge title, credential ID, or date. Every badge page includes a formal validation statement, issue date, badge image, issuer details, and a certificate download.</p>
            <form class="search-bar" action="registry/" method="get">
              <label class="sr-only" for="registrySearch">Search the badge registry</label>
              <input id="registrySearch" name="q" type="search" placeholder="Search by name, badge, or credential ID" />
              <button type="submit">Search registry</button>
            </form>
            <div class="pill-row">
              <span class="pill">Formal badge pages</span>
              <span class="pill">LinkedIn-ready verification URL</span>
              <span class="pill">Never expires</span>
            </div>
          </div>
          <div class="card card--elevated">
            <p class="section-label">Standalone generator</p>
            <h2>Open the embeddable issue page</h2>
            <p>Use the dedicated generator page to enter a recipient name, accept today’s prefilled date or edit it, create the public badge page, and download the named certificate PDF.</p>
            <div class="action-row">
              <a class="button-link" href="generator/">Open generator page</a>
              <a class="button-link button-link--secondary" href="registry/">Open registry</a>
            </div>
            <div class="pill-row">
              <span class="pill">Standalone page</span>
              <span class="pill">Admin searchable</span>
              <span class="pill">Certificate + badge</span>
            </div>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="wrap">
          <div class="section-heading">
            <div>
              <p class="section-label">What the public sees</p>
              <h2>Formal credential pages built for verification</h2>
            </div>
            <a class="text-link" href="registry/">Open full registry</a>
          </div>
          <div class="feature-grid">
            <article class="feature-card">
              <div class="feature-card__icon">✓</div>
              <h3>Visible validation status</h3>
              <p>Every badge page clearly states that the credential is valid and does not expire.</p>
            </article>
            <article class="feature-card">
              <div class="feature-card__icon">🔗</div>
              <h3>Shareable public URL</h3>
              <p>Recipients get a direct credential page URL they can place anywhere a profile link or credential URL is accepted.</p>
            </article>
            <article class="feature-card">
              <div class="feature-card__icon">📄</div>
              <h3>Coordinate-based certificate PDF</h3>
              <p>The same configurable X/Y placement rules from your original certificate builder are preserved throughout the system.</p>
            </article>
          </div>
        </div>
      </section>

      <section class="section section--light">
        <div class="wrap">
          <div class="section-heading">
            <div>
              <p class="section-label">Badge catalog</p>
              <h2>Configured badge types</h2>
            </div>
          </div>
          <div class="feature-grid">
            ${badgeTypeCards || '<p>No badge templates have been configured yet.</p>'}
          </div>
        </div>
      </section>

      <section class="section">
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

    <footer class="site-footer">
      <div class="wrap site-footer__inner">
        <div>
          <strong>${escapeHtml(siteConfig.siteName)}</strong>
          <p>${escapeHtml(siteConfig.footerNote)}</p>
        </div>
        <div class="footer-links">
          <a href="${escapeAttribute(siteConfig.defaultCareerCenterUrl)}" target="_blank" rel="noreferrer">Career Center website</a>
          <a href="generator/">Generator page</a>
          <a href="registry/">Badge registry</a>
          <a href="mailto:${escapeAttribute(siteConfig.supportEmail)}">${escapeHtml(siteConfig.supportEmail)}</a>
        </div>
      </div>
    </footer>

    <script src="assets/site.js"></script>
  </body>
</html>`;
}

function renderGeneratorPage(siteConfig, templates, certificateTemplate) {
  const canonical = buildCanonical(siteConfig, 'generator/');
  const payload = {
    submitEndpoint: '/api/public/issue',
    certificateTemplate: {
      ...certificateTemplate,
      backgroundImage: relativePathFromDepth(certificateTemplate.backgroundImage, 1)
    },
    templates: templates.map((template) => ({
      ...template,
      badgeImage: relativePathFromDepth(template.badgeImage, 1),
      certificateBackground: relativePathFromDepth(template.certificateBackground || certificateTemplate.backgroundImage, 1)
    }))
  };

  const templateOptions = templates
    .map((template) => `<option value="${escapeAttribute(template.id)}">${escapeHtml(template.title)}</option>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(siteConfig.siteName)} | Badge and Certificate Generator</title>
    <meta name="description" content="Create a public badge record, generate the matching certificate PDF, and copy the final verification URL." />
    ${canonical ? `<link rel="canonical" href="${escapeAttribute(canonical)}" />` : ''}
    <link rel="stylesheet" href="../assets/public.css" />
  </head>
  <body data-page="generator">
    <header class="subpage-header">
      <div class="wrap subpage-header__inner">
        <div>
          <p class="eyebrow">Standalone generator page</p>
          <h1>Generate a digital badge and certificate</h1>
          <p class="lede">Enter the recipient’s name, keep today’s long-form date or change it, and create the polished public badge page that can be shared on LinkedIn or anywhere else.</p>
        </div>
        <div class="action-row action-row--stack-mobile">
          <a class="button-link button-link--secondary" href="../">Back to home</a>
          <a class="button-link button-link--secondary" href="../registry/">Open registry</a>
        </div>
      </div>
    </header>

    <main>
      <section class="section section--light">
        <div class="wrap section-grid section-grid--two">
          <article class="card card--elevated">
            <p class="section-label">Issue a credential</p>
            <h2>Generator form</h2>
            <p>This page is designed to stand on its own, so you can link to it directly or embed it inside another site using an iframe.</p>
            <form id="publicGeneratorForm" class="certificate-form">
              <div class="form-grid">
                <label>
                  <span>Recipient name</span>
                  <input type="text" id="publicGeneratorName" name="awardeeName" placeholder="e.g., Jane Doe" required />
                </label>
                <label>
                  <span>Issue date</span>
                  <input type="text" id="publicGeneratorDate" name="issueDate" placeholder="April 7, 2026" required />
                </label>
              </div>
              <label>
                <span>Badge type</span>
                <select id="publicGeneratorTemplate" name="badgeTemplateId" required>
                  <option value="">Select a badge type</option>
                  ${templateOptions}
                </select>
              </label>
              <div class="action-row">
                <button type="button" id="publicPreviewButton">Preview certificate</button>
                <button type="submit" id="publicCreateButton">Create badge and certificate</button>
              </div>
              <p id="publicGeneratorStatus" class="status-message" aria-live="polite"></p>
            </form>
          </article>

          <article class="card card--elevated">
            <p class="section-label">Badge details</p>
            <h2 id="generatorTemplateTitle">Choose a badge type</h2>
            <p id="generatorTemplateDescription" class="generator-template-copy">Once you pick a badge template, the formal badge meaning, issuer, and badge image appear here.</p>
            <div class="generator-template-grid">
              <div class="badge-visual-card generator-badge-card">
                <img id="generatorTemplateImage" class="badge-visual-card__image" alt="Selected badge image" style="display:none;" />
                <div id="generatorTemplateImageEmpty" class="empty-state">Badge artwork preview</div>
              </div>
              <div class="detail-card generator-template-details">
                <p class="section-label">Meaning</p>
                <p id="generatorTemplateMeaning" class="generator-template-copy">Select a badge template to view the official badge meaning.</p>
                <div class="divider"></div>
                <p class="section-label">Issued by</p>
                <p id="generatorTemplateIssuer" class="generator-template-copy">Issuer details will appear here.</p>
                <div class="divider"></div>
                <p class="section-label">Career Center</p>
                <p id="generatorTemplateCareerCenter" class="generator-template-copy">Career Center link will appear here.</p>
              </div>
            </div>
          </article>
        </div>
      </section>

      <section class="section">
        <div class="wrap section-grid section-grid--two">
          <article class="card card--elevated">
            <p class="section-label">Certificate preview</p>
            <h2>Original coordinate-based PDF workflow</h2>
            <p>The certificate image below is rendered from your saved X/Y coordinate settings, just like the original tool.</p>
            <canvas id="publicGeneratorCanvas" class="is-hidden"></canvas>
            <div class="preview-shell">
              <img id="publicGeneratorImage" alt="Certificate preview" style="display:none;" />
              <div id="publicGeneratorPreviewEmpty" class="empty-state">Generate a preview to see the certificate here.</div>
            </div>
          </article>

          <article class="card card--elevated generator-result" id="generatorResultCard" hidden>
            <p class="section-label">Generated badge</p>
            <h2>Public badge page ready</h2>
            <p>Your badge page has been written to the system and can now be shared anywhere a credential URL is accepted.</p>
            <dl class="detail-list detail-list--stacked generator-result-list">
              <div><dt>Recipient</dt><dd id="generatorResultName"></dd></div>
              <div><dt>Badge</dt><dd id="generatorResultBadge"></dd></div>
              <div><dt>Issue date</dt><dd id="generatorResultDate"></dd></div>
              <div><dt>Credential ID</dt><dd id="generatorResultId"></dd></div>
              <div><dt>Verification URL</dt><dd><a id="generatorResultUrl" href="#" target="_blank" rel="noreferrer"></a></dd></div>
            </dl>
            <div class="action-row">
              <a class="button-link" id="generatorOpenBadge" href="#" target="_blank" rel="noreferrer">Open badge page</a>
              <button type="button" class="button-secondary" id="generatorCopyBadge">Copy badge link</button>
              <button type="button" class="button-secondary" id="generatorDownloadPdf">Download certificate PDF</button>
            </div>
          </article>
        </div>
      </section>
    </main>

    <footer class="site-footer site-footer--compact">
      <div class="wrap site-footer__inner">
        <div>
          <strong>${escapeHtml(siteConfig.siteName)}</strong>
          <p>${escapeHtml(siteConfig.footerNote)}</p>
        </div>
        <div class="footer-links">
          <a href="${escapeAttribute(siteConfig.defaultCareerCenterUrl)}" target="_blank" rel="noreferrer">Career Center website</a>
          <a href="../registry/">Badge registry</a>
          <a href="../">Home</a>
        </div>
      </div>
    </footer>

    <script>window.PUBLIC_GENERATOR_DATA = ${serializeForScript(payload)};</script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
    <script src="../assets/site.js"></script>
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
    <meta name="description" content="Search and verify official digital badges issued by the Career Center." />
    ${canonical ? `<link rel="canonical" href="${escapeAttribute(canonical)}" />` : ''}
    <link rel="stylesheet" href="../assets/public.css" />
  </head>
  <body data-page="registry">
    <header class="subpage-header">
      <div class="wrap subpage-header__inner">
        <div>
          <p class="eyebrow">Public verification registry</p>
          <h1>Search issued digital badges</h1>
          <p class="lede">Find a badge by recipient name, credential ID, badge title, or issue date.</p>
        </div>
        <a class="button-link" href="../">Back to home</a>
      </div>
    </header>

    <main class="section">
      <div class="wrap">
        <div class="card card--elevated registry-card">
          <form id="registryPageSearch" class="search-bar search-bar--wide">
            <label class="sr-only" for="registrySearchInput">Search the badge registry</label>
            <input id="registrySearchInput" name="q" type="search" placeholder="Search by name, badge title, date, or credential ID" />
            <button type="submit">Search</button>
          </form>
          <p class="muted">Every result links to a public credential page with validation details, badge image, issuer information, and certificate download.</p>
          <div id="registryResults" class="credential-list" data-source="../data/badges.json"></div>
        </div>
      </div>
    </main>

    <footer class="site-footer site-footer--compact">
      <div class="wrap site-footer__inner">
        <div>
          <strong>${escapeHtml(siteConfig.siteName)}</strong>
          <p>${escapeHtml(siteConfig.footerNote)}</p>
        </div>
        <div class="footer-links">
          <a href="${escapeAttribute(siteConfig.defaultCareerCenterUrl)}" target="_blank" rel="noreferrer">Career Center website</a>
          <a href="../generator/">Generator page</a>
          <a href="../">Home</a>
        </div>
      </div>
    </footer>

    <script src="../assets/site.js"></script>
  </body>
</html>`;
}

function render404Page(siteConfig) {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(siteConfig.siteName)} | Page not found</title>
    <link rel="stylesheet" href="assets/public.css" />
  </head>
  <body>
    <main class="not-found-page">
      <div class="card card--elevated not-found-card">
        <p class="eyebrow">404</p>
        <h1>That credential page could not be found.</h1>
        <p>Return to the registry to search for a valid badge or go back to the public home page.</p>
        <div class="action-row action-row--center">
          <a class="button-link" href="./">Go home</a>
          <a class="button-link button-link--secondary" href="registry/">Open registry</a>
        </div>
      </div>
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
    <header class="credential-hero">
      <div class="wrap credential-hero__inner">
        <div class="credential-hero__content">
          <p class="eyebrow">Official credential verification</p>
          <h1>${escapeHtml(badge.badgeTitle)}</h1>
          <p class="lede">Awarded to <strong>${escapeHtml(badge.awardeeName)}</strong>. This badge is valid, published by ${escapeHtml(badge.issuerName)}, and never expires.</p>
          <div class="status-row">
            <span class="status-chip status-chip--valid">Valid</span>
            <span class="status-chip">Never expires</span>
            <span class="status-chip">Credential ID ${escapeHtml(badge.id)}</span>
          </div>
          <div class="action-row">
            <a class="button-link" href="${escapeAttribute(badge.careerCenterUrl)}" target="_blank" rel="noreferrer">Career Center website</a>
            <button type="button" class="button-link button-link--secondary" data-copy-url="${escapeAttribute(badge.publicUrl)}">Copy verification link</button>
          </div>
        </div>
        <div class="credential-hero__visual">
          <div class="badge-visual-card">
            <img src="${escapeAttribute(badgeImageForPage)}" alt="${escapeAttribute(badge.badgeTitle)} badge image" class="badge-visual-card__image" />
          </div>
        </div>
      </div>
    </header>

    <main>
      <section class="section section--light">
        <div class="wrap details-grid">
          <article class="detail-card detail-card--highlight">
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
          <article class="detail-card">
            <p class="section-label">Badge meaning</p>
            <h2>What this badge represents</h2>
            <p>${escapeHtml(badge.meaning)}</p>
            <div class="divider"></div>
            <p class="section-label">Eligibility or criteria</p>
            <p>${escapeHtml(badge.criteria)}</p>
          </article>
          <article class="detail-card">
            <p class="section-label">Verification</p>
            <h2>Public credential record</h2>
            <p>This page is the official public verification destination for this credential.</p>
            <dl class="detail-list detail-list--stacked">
              <div><dt>Verification URL</dt><dd><a href="${escapeAttribute(badge.publicUrl)}">${escapeHtml(badge.publicUrl)}</a></dd></div>
              <div><dt>Issuer website</dt><dd><a href="${escapeAttribute(badge.issuerWebsite)}" target="_blank" rel="noreferrer">${escapeHtml(badge.issuerWebsite)}</a></dd></div>
              <div><dt>Career Center</dt><dd><a href="${escapeAttribute(badge.careerCenterUrl)}" target="_blank" rel="noreferrer">${escapeHtml(badge.careerCenterUrl)}</a></dd></div>
              <div><dt>Credential data</dt><dd><a href="details.json">Download metadata JSON</a></dd></div>
            </dl>
          </article>
        </div>
      </section>

      <section class="section">
        <div class="wrap section-grid section-grid--two">
          <article class="card card--elevated">
            <p class="section-label">Certificate</p>
            <h2>Download the named certificate PDF</h2>
            <p>This uses the same coordinate-based certificate system as your original tool, with the recipient name and issue date prefilled.</p>
            <div class="action-row">
              <button type="button" id="btnDownloadBadgeCertificate">Download PDF</button>
            </div>
            <canvas id="badgeCertCanvas" class="is-hidden"></canvas>
            <div class="preview-shell preview-shell--compact">
              <img id="badgeCertImage" alt="Certificate preview for ${escapeAttribute(badge.awardeeName)}" />
            </div>
          </article>
          <article class="card card--elevated">
            <p class="section-label">Issuer statement</p>
            <h2>${escapeHtml(badge.badgeLabel || badge.badgeTitle)}</h2>
            <p>${escapeHtml(badge.description || badge.meaning)}</p>
            <div class="info-callout">
              <strong>Issued by ${escapeHtml(badge.issuerName)}</strong>
              <p>${escapeHtml(badge.issuerOrganization || siteConfig.organizationName)}</p>
            </div>
            <div class="action-row">
              <a class="text-link" href="../../generator/">Generate another credential</a>
              <a class="text-link" href="../../registry/">Search all public badges</a>
              <a class="text-link" href="../../">Return to home</a>
            </div>
          </article>
        </div>
      </section>
    </main>

    <footer class="site-footer site-footer--compact">
      <div class="wrap site-footer__inner">
        <div>
          <strong>${escapeHtml(siteConfig.siteName)}</strong>
          <p>${escapeHtml(siteConfig.footerNote)}</p>
        </div>
        <div class="footer-links">
          <a href="../../generator/">Generator page</a>
          <a href="../../registry/">Badge registry</a>
          <a href="../../">Home</a>
          <a href="${escapeAttribute(badge.careerCenterUrl)}" target="_blank" rel="noreferrer">Career Center website</a>
        </div>
      </div>
    </footer>

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

function renderSitemap(siteConfig, badges) {
  const base = String(siteConfig.publicSiteUrl || '').replace(/\/+$/, '');
  if (!base || /YOUR-GITHUB-USERNAME|YOUR-REPO-NAME/.test(base)) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n';
  }

  const urls = [
    '',
    'generator/',
    'registry/',
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
  writeText(path.join(PATHS.docsDir, 'generator', 'index.html'), renderGeneratorPage(siteConfig, templates, certificateTemplate));
  writeText(path.join(PATHS.docsRegistryDir, 'index.html'), renderRegistryPage(siteConfig));
  writeText(path.join(PATHS.docsDir, '404.html'), render404Page(siteConfig));
  writeText(path.join(PATHS.docsDir, 'robots.txt'), renderRobots(siteConfig));
  writeText(path.join(PATHS.docsDir, 'sitemap.xml'), renderSitemap(siteConfig, badges));

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
