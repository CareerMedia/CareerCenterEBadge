const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const {
  PATHS,
  ensureDataFiles,
  loadBadges,
  saveBadges,
  loadBadgeTemplates,
  saveBadgeTemplates,
  loadDeletedBadges,
  saveDeletedBadges,
  loadCertificateTemplate,
  saveCertificateTemplate,
  loadSiteConfig,
  saveSiteConfig,
  formatLongDate,
  parseIssueDate,
  slugify,
  buildCredentialId,
  buildBadgeSlug,
  getPublicBadgeUrl,
  sanitizeFilePart,
  escapeHtml,
  escapeAttribute,
  sortBadgesDescending,
  writeText,
  normalizeUrl,
  hasConfiguredPublicUrl,
  hydrateFilesFromAppState,
  syncAppStateFromFiles,
  loadAppState,
  createBackupSnapshot,
  getRecentBackups,
  parseFullBackupJson,
  applyAppState,
  importBadgesFromCsv,
  parseCsv,
  appendAuditLog,
  saveUploadedAssetFromDataUrl,
  parseList,
  cleanAssetPath,
  getCertificateTemplateForTemplate,
  normalizeCertificateConfig,
  loadBulkIssueJobs,
  saveBulkIssueJobs
} = require('./lib/store');
const { buildPublicSite } = require('./lib/site-generator');
const { pullRemoteData, persistMutation, getConfig, queuePushLocalData } = require('./lib/github-sync');
const {
  loadAnalyticsEvents,
  loadAnalyticsSummary,
  buildAnalyticsSummary,
  appendAnalyticsEvent,
  backfillIssuedAnalyticsEvents,
  createVisitorId,
  buildAnalyticsCsv
} = require('./lib/analytics');
const {
  renderLoginPage,
  renderDashboard,
  renderIssuePage,
  renderTemplatesPage,
  renderSettingsPage,
  renderAnalyticsPage,
  renderBackupsPage,
  renderBulkIssuePage,
  renderBulkIssueValidationPage,
  renderBulkIssueSuccessPage
} = require('./lib/admin-renderer');
const {
  parseListField,
  normalizeEvidence,
  normalizeIssuerTrust,
  normalizeVerificationSections,
  normalizePathway,
  buildVerificationHash,
  buildWidgetEmbedCode,
  buildGeneratorRoute
} = require('./lib/credential-utils');

function loadEnvFile() {
  const envPath = path.join(PATHS.root, '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }
    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

async function initializeApp() {
  ensureDataFiles();
  const syncConfig = getConfig();
  if (syncConfig.enabled) {
    try {
      await pullRemoteData();
      hydrateFilesFromAppState();
      console.log(`Loaded persistent badge data from GitHub branch "${syncConfig.branch}".`);
    } catch (error) {
      console.warn(`GitHub data restore failed: ${error.message}`);
    }
  } else {
    console.warn('GitHub sync is not configured. Badge data will reset on Render redeploys until GITHUB_TOKEN and GITHUB_REPO are set.');
  }
  syncAppStateFromFiles();
  const analyticsBackfill = backfillIssuedAnalyticsEvents();
  if (analyticsBackfill.created && syncConfig.enabled) {
    try {
      await queuePushLocalData(`Backfill ${analyticsBackfill.created} analytics issuance events`);
    } catch (error) {
      console.warn(`Analytics backfill sync failed: ${error.message}`);
    }
  }
  buildPublicSite();
  if (!getRecentBackups(1).length) {
    createBackupSnapshot('Initial protected baseline', 'system');
  }
}

const PORT = Number(process.env.PORT || 8787);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'spider#5';
const PUBLIC_PASSWORD = process.env.PUBLIC_PASSWORD || ADMIN_PASSWORD;
const sessions = new Map();
const publicSessions = new Map();

function createSession(sessionStore = sessions) {
  const sessionId = crypto.randomUUID();
  sessionStore.set(sessionId, { createdAt: Date.now() });
  return sessionId;
}

function parseCookies(request) {
  const raw = request.headers.cookie || '';
  return raw.split(';').reduce((accumulator, pair) => {
    const [key, ...rest] = pair.trim().split('=');
    if (!key) return accumulator;
    accumulator[key] = decodeURIComponent(rest.join('='));
    return accumulator;
  }, {});
}

function getSessionId(request) {
  const cookies = parseCookies(request);
  return cookies.badge_admin_session || '';
}

function isAuthenticated(request) {
  const sessionId = getSessionId(request);
  return Boolean(sessionId && sessions.has(sessionId));
}

function isPublicAuthenticated(request) {
  if (isAuthenticated(request)) {
    return true;
  }
  const sessionId = parseCookies(request).badge_public_session || '';
  return Boolean(sessionId && publicSessions.has(sessionId));
}

function clearSession(request) {
  const sessionId = getSessionId(request);
  if (sessionId) {
    sessions.delete(sessionId);
  }
}

function sendHtml(response, html, statusCode = 200) {
  response.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(html);
}

function sendNotFoundPage(response) {
  const notFoundPage = path.join(PATHS.docsDir, '404.html');
  if (fs.existsSync(notFoundPage)) {
    response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(notFoundPage).pipe(response);
    return;
  }
  sendHtml(response, '<!DOCTYPE html><html><body><h1>Page not found</h1></body></html>', 404);
}

function sendText(response, text, statusCode = 200, contentType = 'text/plain; charset=utf-8', headers = {}) {
  response.writeHead(statusCode, { 'Content-Type': contentType, ...headers });
  response.end(text);
}

function redirect(response, location, headers = {}) {
  response.writeHead(302, { Location: location, ...headers });
  response.end();
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2e7) {
        reject(new Error('Request body too large'));
        request.destroy();
      }
    });
    request.on('end', () => {
      const contentType = request.headers['content-type'] || '';
      if (contentType.includes('application/x-www-form-urlencoded')) {
        const params = new URLSearchParams(body);
        resolve(Object.fromEntries(params.entries()));
        return;
      }
      if (contentType.includes('application/json')) {
        try {
          resolve(JSON.parse(body || '{}'));
        } catch (error) {
          reject(error);
        }
        return;
      }
      resolve({});
    });
    request.on('error', reject);
  });
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.xml': 'application/xml; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8'
  };
  return map[ext] || 'application/octet-stream';
}

function safeResolve(baseDir, requestPath) {
  const cleaned = decodeURIComponent(requestPath.split('?')[0]);
  const resolved = path.resolve(baseDir, `.${cleaned}`);
  if (!resolved.startsWith(baseDir)) {
    return null;
  }
  return resolved;
}

function serveStatic(baseDir, requestPath, response) {
  const resolved = safeResolve(baseDir, requestPath);
  if (!resolved) {
    return false;
  }

  let filePath = resolved;
  if (requestPath.endsWith('/')) {
    filePath = path.join(resolved, 'index.html');
  } else if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    filePath = path.join(resolved, 'index.html');
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return false;
  }

  response.writeHead(200, { 'Content-Type': contentTypeFor(filePath) });
  fs.createReadStream(filePath).pipe(response);
  return true;
}

function requireAuth(request, response) {
  if (!isAuthenticated(request)) {
    redirect(response, '/admin/login');
    return false;
  }
  return true;
}

function buildNoticeUrl(pathname, notice) {
  return `${pathname}?notice=${encodeURIComponent(notice)}`;
}

function queryNotice(urlObject) {
  return urlObject.searchParams.get('notice') || '';
}

function getSafeNextPath(value) {
  const nextPath = String(value || '').trim();
  if (!nextPath.startsWith('/')) {
    return '/';
  }
  if (nextPath.startsWith('//') || nextPath.startsWith('/admin') || nextPath.startsWith('/access')) {
    return '/';
  }
  return nextPath;
}

function requiresPublicPassword(pathname) {
  const normalized = String(pathname || '').replace(/\/+$/, '') || '/';
  return (
    normalized === '/' ||
    normalized === '/index.html' ||
    normalized === '/registry' ||
    normalized === '/registry/index.html' ||
    normalized === '/lookup' ||
    normalized === '/lookup/index.html' ||
    normalized.startsWith('/data')
  );
}

function renderPublicAccessPage(nextPath = '/', message = '') {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>CSUN Career Center E-Badges | Protected access</title>
    <link rel="stylesheet" href="/assets/public.css" />
  </head>
  <body class="public-access-page">
    <main class="public-access-shell">
      <section class="panel panel--surface public-access-card">
        <div class="brand-lockup">
          <img class="brand-lockup__logo" src="/assets/CC_Logo_Lockup_Main@5x.png" alt="CSUN Career Center logo" />
          <div class="brand-lockup__text">
            <strong>CSUN Career Center E-Badges</strong>
            <span>Protected credential workspace</span>
          </div>
        </div>
        <p class="eyebrow">Protected access</p>
        <h1>Enter the badge directory</h1>
        <p class="lede">The directory home and registry search tools are password protected. Public badge verification pages remain shareable through their direct credential links.</p>
        ${message ? `<div class="public-access-error">${escapeHtml(message)}</div>` : ''}
        <form method="post" action="/access" class="certificate-form public-access-form">
          <input type="hidden" name="next" value="${escapeAttribute(nextPath)}" />
          <label>
            <span>Password</span>
            <input type="password" name="password" autocomplete="current-password" required />
          </label>
          <button type="submit">Enter protected directory</button>
        </form>
      </section>
    </main>
  </body>
</html>`;
}

function filterBadges(badges, query) {
  const trimmed = String(query || '').trim().toLowerCase();
  if (!trimmed) {
    return sortBadgesDescending(badges);
  }
  return sortBadgesDescending(
    badges.filter((badge) =>
      [badge.awardeeName, badge.awardeeEmail, badge.badgeTitle, badge.issueDate, badge.id, badge.meaning]
        .join(' ')
        .toLowerCase()
        .includes(trimmed)
    )
  );
}

function cleanText(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return cleanText(value).toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function sanitizeBadgeResponse(badge) {
  return {
    id: badge.id,
    awardeeName: badge.awardeeName,
    awardeeEmail: badge.awardeeEmail || '',
    issueDate: badge.issueDate,
    badgeTitle: badge.badgeTitle,
    publicUrl: buildBrowserBadgeUrl(badge),
    slug: badge.slug
  };
}

function buildBulkIssueTemplateCsv() {
  return ['awardee_name,awardee_email,issue_date', 'Jane Doe,jane.doe@csun.edu,2026-04-28'].join('\n') + '\n';
}

function parseBulkIssueRowsFromForm(formData, rowCount) {
  const rows = [];
  const count = Number(rowCount || 0);
  for (let index = 0; index < count; index += 1) {
    rows.push({
      rowNumber: index + 2,
      awardeeName: cleanText(formData[`row_${index}_awardeeName`]),
      awardeeEmail: normalizeEmail(formData[`row_${index}_awardeeEmail`]),
      issueDateRaw: cleanText(formData[`row_${index}_issueDate`])
    });
  }
  return rows;
}

function validateBulkIssueRows(rows, issueDateMode = 'today') {
  const useToday = issueDateMode !== 'report';
  const today = formatLongDate();
  const validatedRows = rows.map((row) => {
    const errors = [];
    if (!cleanText(row.awardeeName)) {
      errors.push('Recipient name is required.');
    }
    if (!isValidEmail(row.awardeeEmail)) {
      errors.push('Recipient email must be a valid address.');
    }
    const sourceDate = useToday ? today : cleanText(row.issueDateRaw);
    if (!useToday && !sourceDate) {
      errors.push('Issue date is required when using report dates.');
    }
    const normalizedDate = sourceDate ? parseIssueDate(sourceDate).display : '';
    return {
      rowNumber: row.rowNumber,
      awardeeName: cleanText(row.awardeeName),
      awardeeEmail: normalizeEmail(row.awardeeEmail),
      issueDate: normalizedDate,
      issueDateRaw: cleanText(row.issueDateRaw),
      errors
    };
  });
  return {
    rows: validatedRows,
    hasBlockingErrors: validatedRows.some((row) => row.errors.length > 0)
  };
}

function createBulkIssueValidationJob(formData) {
  const badgeTemplateId = cleanText(formData.badgeTemplateId);
  const issueDateMode = cleanText(formData.issueDateMode) === 'report' ? 'report' : 'today';
  const templates = loadBadgeTemplates();
  const template = templates.find((entry) => entry.id === badgeTemplateId);
  if (!template) {
    throw new Error('Select a valid badge template before validating.');
  }
  let parsedRows = [];
  if (formData.jobId) {
    parsedRows = parseBulkIssueRowsFromForm(formData, formData.rowCount);
  } else {
    const rows = parseCsv(formData.csvContent || '');
    if (!rows.length) {
      throw new Error('The uploaded CSV is empty.');
    }
    const header = rows[0].map((value) => cleanText(value).toLowerCase());
    const nameIndex = header.indexOf('awardee_name');
    const emailIndex = header.indexOf('awardee_email');
    const issueDateIndex = header.indexOf('issue_date');
    if (nameIndex < 0 || emailIndex < 0) {
      throw new Error('CSV must include awardee_name and awardee_email columns.');
    }
    parsedRows = rows.slice(1).map((columns, rowOffset) => ({
      rowNumber: rowOffset + 2,
      awardeeName: cleanText(columns[nameIndex]),
      awardeeEmail: normalizeEmail(columns[emailIndex]),
      issueDateRaw: cleanText(issueDateIndex >= 0 ? columns[issueDateIndex] : '')
    }));
  }
  if (!parsedRows.length) {
    throw new Error('CSV has no data rows to validate.');
  }
  const validation = validateBulkIssueRows(parsedRows, issueDateMode);

  const jobs = loadBulkIssueJobs();
  const now = new Date().toISOString();
  const id = formData.jobId ? cleanText(formData.jobId) : `bulk-${Date.now()}`;
  const existingIndex = jobs.findIndex((entry) => entry.id === id);
  const job = {
    id,
    status: validation.hasBlockingErrors ? 'validation_failed' : 'validated',
    createdAt: existingIndex >= 0 ? jobs[existingIndex].createdAt : now,
    startedAt: '',
    finishedAt: '',
    badgeTemplateId: template.id,
    badgeTemplateTitle: template.title,
    issueDateMode,
    totalRows: validation.rows.length,
    processedRows: 0,
    completedRows: 0,
    failedRows: 0,
    progressPercent: 0,
    rows: validation.rows,
    results: [],
    errors: []
  };
  if (existingIndex >= 0) {
    jobs[existingIndex] = { ...jobs[existingIndex], ...job };
  } else {
    jobs.unshift(job);
  }
  saveBulkIssueJobs(jobs.slice(0, 75));
  return job;
}

async function processBulkIssueJobSync(jobId) {
  const jobs = loadBulkIssueJobs();
  const index = jobs.findIndex((job) => job.id === jobId);
  if (index < 0) {
    throw new Error('Bulk issue job not found.');
  }
  const job = jobs[index];
  if (!Array.isArray(job.rows) || !job.rows.length) {
    throw new Error('Bulk issue job has no rows to process.');
  }
  if (job.rows.some((row) => Array.isArray(row.errors) && row.errors.length)) {
    throw new Error('Resolve validation errors before issuing badges.');
  }

  job.status = 'processing';
  job.startedAt = new Date().toISOString();
  job.processedRows = 0;
  job.completedRows = 0;
  job.failedRows = 0;
  job.progressPercent = 0;
  job.results = [];
  job.errors = [];
  saveBulkIssueJobs(jobs);

  for (const row of job.rows) {
    try {
      const badge = await persistMutation(
        `Bulk issue badge row ${row.rowNumber} (${jobId})`,
        () => handleIssueBadge({
          awardeeName: row.awardeeName,
          awardeeEmail: row.awardeeEmail,
          issueDate: row.issueDate,
          badgeTemplateId: job.badgeTemplateId,
          source: 'admin-bulk-issue'
        }),
        buildPublicSite
      );
      job.completedRows += 1;
      job.results.push({
        rowNumber: row.rowNumber,
        awardeeName: row.awardeeName,
        badgeId: badge.id,
        publicUrl: buildBrowserBadgeUrl(badge)
      });
    } catch (error) {
      job.failedRows += 1;
      job.errors.push({ rowNumber: row.rowNumber, message: error.message });
    }
    job.processedRows = job.completedRows + job.failedRows;
    job.progressPercent = job.totalRows ? Math.round((job.processedRows / job.totalRows) * 100) : 100;
    saveBulkIssueJobs(jobs);
  }
  job.status = job.failedRows ? (job.completedRows ? 'completed_with_errors' : 'failed') : 'completed';
  job.finishedAt = new Date().toISOString();
  saveBulkIssueJobs(jobs);
  return job;
}


function parseListInput(value) {
  return parseListField(value);
}

function parseBooleanInput(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'on' || normalized === 'yes';
}

function persistAssetField({ uploadValue, manualValue, category, preferredName }) {
  const uploaded = cleanText(uploadValue);
  if (uploaded) {
    return saveUploadedAssetFromDataUrl(uploaded, { category, preferredName });
  }
  return cleanAssetPath(manualValue);
}

function buildTemplateCertificateOverride(formData, fallbackBackground) {
  const enabled = parseBooleanInput(formData.certificateTemplateOverrideEnabled);
  return {
    certificateTemplateOverrideEnabled: enabled,
    certificateTemplate: normalizeCertificateConfig({
      backgroundImage: cleanText(formData.certificateBackgroundOverride) || cleanText(fallbackBackground),
      fileNameSuffix: cleanText(formData.fileNameSuffixOverride) || cleanText(formData.fileNameSuffix) || '_Certificate',
      name: {
        x: parseNumber(formData.templateNameX, parseNumber(formData.nameX, 2000)),
        y: parseNumber(formData.templateNameY, parseNumber(formData.nameY, 1400)),
        fontSize: parseNumber(formData.templateNameFontSize, parseNumber(formData.nameFontSize, 180)),
        fontFamily: cleanText(formData.templateNameFontFamily) || cleanText(formData.nameFontFamily) || 'Times New Roman',
        fontWeight: cleanText(formData.templateNameFontWeight) || cleanText(formData.nameFontWeight) || 'bold',
        color: cleanText(formData.templateNameColor) || cleanText(formData.nameColor) || '#000000',
        align: cleanText(formData.templateNameAlign) || cleanText(formData.nameAlign) || 'center',
        maxWidth: parseNumber(formData.templateNameMaxWidth, parseNumber(formData.nameMaxWidth, 2400))
      },
      date: {
        x: parseNumber(formData.templateDateX, parseNumber(formData.dateX, 1150)),
        y: parseNumber(formData.templateDateY, parseNumber(formData.dateY, 2150)),
        fontSize: parseNumber(formData.templateDateFontSize, parseNumber(formData.dateFontSize, 48)),
        fontFamily: cleanText(formData.templateDateFontFamily) || cleanText(formData.dateFontFamily) || 'Arial',
        fontWeight: cleanText(formData.templateDateFontWeight) || cleanText(formData.dateFontWeight) || 'normal',
        color: cleanText(formData.templateDateColor) || cleanText(formData.dateColor) || '#333333',
        align: cleanText(formData.templateDateAlign) || cleanText(formData.dateAlign) || 'center',
        maxWidth: parseNumber(formData.templateDateMaxWidth, parseNumber(formData.dateMaxWidth, 700))
      }
    })
  };
}

function buildRelativeBadgeUrl(slug) {
  return `../badges/${slug}/`;
}

function buildRelativeBadgeJsonUrl(slug) {
  return `../badges/${slug}/details.json`;
}

function buildBrowserBadgeUrl(badge) {
  if (!badge) {
    return '/badges/';
  }
  if (String(badge.publicUrl || '').startsWith('http')) {
    return badge.publicUrl;
  }
  return `/badges/${badge.slug}/`;
}

function mergeTemplateFields(formData) {
  const badgeTemplateId = cleanText(formData.badgeTemplateId);
  const template = badgeTemplateId ? loadBadgeTemplates().find((entry) => entry.id === badgeTemplateId) : null;

  if (badgeTemplateId && !template) {
    throw new Error('The selected badge template could not be found.');
  }

  const siteConfig = loadSiteConfig();
  const certificateTemplate = loadCertificateTemplate();
  const badgeImage = persistAssetField({
    uploadValue: formData.badgeImageUploadDataUrl,
    manualValue: cleanText(formData.badgeImage) || cleanText(template && template.badgeImage),
    category: 'badge-icons',
    preferredName: `${badgeTemplateId || cleanText(formData.badgeTitle) || 'badge'}-icon`
  });
  const certificateBackground = persistAssetField({
    uploadValue: formData.certificateBackgroundUploadDataUrl,
    manualValue: cleanText(formData.certificateBackground) || cleanText(template && template.certificateBackground) || cleanText(certificateTemplate.backgroundImage),
    category: 'certificate-backgrounds',
    preferredName: `${badgeTemplateId || cleanText(formData.badgeTitle) || 'badge'}-certificate`
  });

  const merged = {
    awardeeName: cleanText(formData.awardeeName),
    awardeeEmail: normalizeEmail(formData.awardeeEmail),
    issueDate: cleanText(formData.issueDate),
    badgeTemplateId,
    badgeTitle: cleanText(formData.badgeTitle) || cleanText(template && template.title),
    badgeLabel: cleanText(formData.badgeLabel) || cleanText(template && (template.badgeLabel || template.title)) || cleanText(formData.badgeTitle),
    description: cleanText(formData.description) || cleanText(template && template.description),
    publicSummary: cleanText(formData.publicSummary) || cleanText(formData.description) || cleanText(template && (template.publicSummary || template.description)),
    meaning: cleanText(formData.meaning) || cleanText(template && template.meaning),
    criteria: cleanText(formData.criteria) || cleanText(template && template.criteria),
    evidenceLabel: cleanText(formData.evidenceLabel) || cleanText(template && template.evidenceLabel) || 'Evidence',
    evidencePrompt: cleanText(formData.evidencePrompt) || cleanText(template && template.evidencePrompt),
    evidenceExampleUrl: cleanText(formData.evidenceExampleUrl) || cleanText(template && template.evidenceExampleUrl),
    evidenceDescription: cleanText(formData.evidenceDescription) || cleanText(template && template.evidenceDescription),
    evidenceUrl: cleanText(formData.evidenceUrl),
    evidenceText: cleanText(formData.evidenceText),
    skills: parseListInput(formData.skills).length ? parseListInput(formData.skills) : parseListInput(template && template.skills),
    standards: parseListInput(formData.standards).length ? parseListInput(formData.standards) : parseListInput(template && template.standards),
    pathwayId: cleanText(formData.pathwayId) || cleanText(template && template.pathwayId),
    pathwayTitle: cleanText(formData.pathwayTitle) || cleanText(template && template.pathwayTitle),
    pathwayDescription: cleanText(formData.pathwayDescription) || cleanText(template && template.pathwayDescription),
    pathwayOrder: parseNumber(formData.pathwayOrder, parseNumber(template && template.pathwayOrder, 1)),
    pathwayItems: parseListInput(formData.pathwayItems).length ? parseListInput(formData.pathwayItems) : parseListInput(template && template.pathwayItems),
    issuerName: cleanText(formData.issuerName) || cleanText(template && template.issuerName) || cleanText(siteConfig.organizationName),
    issuerOrganization: cleanText(formData.issuerOrganization) || cleanText(template && template.issuerOrganization) || cleanText(siteConfig.organizationName),
    issuerWebsite: normalizeUrl(cleanText(formData.issuerWebsite) || cleanText(template && template.issuerWebsite) || cleanText(siteConfig.defaultCareerCenterUrl)),
    careerCenterUrl: normalizeUrl(cleanText(formData.careerCenterUrl) || cleanText(template && template.careerCenterUrl) || cleanText(siteConfig.defaultCareerCenterUrl)),
    issuerContactEmail: cleanText(formData.issuerContactEmail) || cleanText(template && template.issuerContactEmail) || cleanText(siteConfig.supportEmail),
    issuerVerificationNote: cleanText(formData.issuerVerificationNote) || cleanText(template && template.issuerVerificationNote) || cleanText(siteConfig.footerNote),
    issuerRegistryUrl: normalizeUrl(cleanText(formData.issuerRegistryUrl) || cleanText(template && template.issuerRegistryUrl)),
    issuerTrustLabel: cleanText(formData.issuerTrustLabel) || cleanText(template && template.issuerTrustLabel) || 'Official issuer',
    badgeImage,
    certificateBackground,
    source: cleanText(formData.source) || 'admin',
    verificationSections: normalizeVerificationSections(template)
  };

  merged.certificateTemplateApplied = badgeTemplateId
    ? getCertificateTemplateForTemplate({ ...template, certificateBackground }, certificateTemplate)
    : normalizeCertificateConfig({ ...certificateTemplate, backgroundImage: certificateBackground }, certificateTemplate);

  return merged;
}

function createBadgeRecord(formData) {
  const merged = mergeTemplateFields(formData);
  const { awardeeName, awardeeEmail, issueDate, badgeTemplateId, badgeTitle, badgeLabel, description, publicSummary, meaning, criteria, issuerName, issuerOrganization, issuerWebsite, careerCenterUrl, badgeImage, certificateBackground } = merged;

  if (!awardeeName || !awardeeEmail || !badgeTitle || !publicSummary || !meaning || !criteria) {
    throw new Error('Awardee name, awardee email, badge title, summary, meaning, and criteria are required.');
  }
  if (!isValidEmail(awardeeEmail)) {
    throw new Error('Awardee email must be a valid email address.');
  }
  if (!issuerName || !issuerOrganization || !issuerWebsite || !careerCenterUrl) {
    throw new Error('Issuer and Career Center URLs are required.');
  }
  if (!badgeImage || !certificateBackground) {
    throw new Error('Badge image path and certificate background path are required.');
  }

  const siteConfig = loadSiteConfig();
  const badges = loadBadges();
  const parsedDate = parseIssueDate(issueDate);
  const id = buildCredentialId(badges, siteConfig, parsedDate.iso);

  const candidate = {
    id,
    awardeeName,
    awardeeEmail,
    issueDate: parsedDate.display,
    issueDateISO: parsedDate.iso,
    badgeTemplateId,
    badgeTitle,
    badgeLabel,
    description,
    publicSummary,
    meaning,
    criteria,
    evidenceLabel: merged.evidenceLabel,
    evidencePrompt: merged.evidencePrompt,
    evidenceExampleUrl: merged.evidenceExampleUrl,
    evidenceDescription: merged.evidenceDescription,
    evidenceUrl: merged.evidenceUrl,
    evidenceText: merged.evidenceText,
    skills: merged.skills,
    standards: merged.standards,
    pathwayId: merged.pathwayId,
    pathwayTitle: merged.pathwayTitle,
    pathwayDescription: merged.pathwayDescription,
    pathwayOrder: merged.pathwayOrder,
    pathwayItems: merged.pathwayItems,
    issuerName,
    issuerOrganization,
    issuerWebsite,
    careerCenterUrl,
    issuerContactEmail: merged.issuerContactEmail,
    issuerVerificationNote: merged.issuerVerificationNote,
    issuerRegistryUrl: merged.issuerRegistryUrl,
    issuerTrustLabel: merged.issuerTrustLabel,
    badgeImage,
    certificateBackground,
    certificateTemplateApplied: merged.certificateTemplateApplied,
    verificationSections: merged.verificationSections,
    status: 'valid',
    neverExpires: true,
    createdAt: new Date().toISOString(),
    source: merged.source
  };

  candidate.slug = buildBadgeSlug(candidate);
  candidate.relativeUrl = buildRelativeBadgeUrl(candidate.slug);
  candidate.relativeJsonUrl = buildRelativeBadgeJsonUrl(candidate.slug);
  candidate.publicUrl = getPublicBadgeUrl(siteConfig, candidate.slug);
  candidate.repoPath = `docs/badges/${candidate.slug}/index.html`;
  candidate.detailsJsonPath = `docs/badges/${candidate.slug}/details.json`;
  candidate.openBadgeJsonPath = `docs/badges/${candidate.slug}/open-badge.json`;
  candidate.verifiableCredentialPath = `docs/badges/${candidate.slug}/credential.json`;
  candidate.verificationHash = buildVerificationHash(candidate);
  return candidate;
}

function handleIssueBadge(formData) {
  const badges = loadBadges();
  const badge = createBadgeRecord(formData);
  badges.push(badge);
  saveBadges(badges);
  appendAnalyticsEvent({
    type: 'badge_issued',
    timestamp: badge.createdAt,
    badgeId: badge.id,
    badgeSlug: badge.slug,
    badgeTitle: badge.badgeTitle,
    badgeTemplateId: badge.badgeTemplateId,
    awardeeName: badge.awardeeName,
    awardeeEmail: badge.awardeeEmail || '',
    publicUrl: buildBrowserBadgeUrl(badge),
    source: badge.source || 'admin',
    context: 'issuance'
  });
  createBackupSnapshot(`Issued badge ${badge.id}`, 'admin');
  appendAuditLog({ action: 'badge.issue', actor: 'admin', badgeId: badge.id, awardeeName: badge.awardeeName });
  return badge;
}

function saveTemplate(formData) {
  const id = slugify(formData.id);
  if (!id) {
    throw new Error('Template ID is required.');
  }

  const existing = loadBadgeTemplates().find((entry) => entry.id === id) || null;
  const badgeImage = persistAssetField({
    uploadValue: formData.badgeImageUploadDataUrl,
    manualValue: cleanText(formData.badgeImage) || cleanText(existing && existing.badgeImage),
    category: 'badge-icons',
    preferredName: `${id}-icon`
  });
  const certificateBackground = persistAssetField({
    uploadValue: formData.certificateBackgroundUploadDataUrl,
    manualValue: cleanText(formData.certificateBackground) || cleanText(existing && existing.certificateBackground),
    category: 'certificate-backgrounds',
    preferredName: `${id}-certificate`
  });

  const template = {
    id,
    title: cleanText(formData.title),
    badgeLabel: cleanText(formData.badgeLabel),
    description: cleanText(formData.description),
    publicSummary: cleanText(formData.publicSummary) || cleanText(formData.description),
    meaning: cleanText(formData.meaning),
    criteria: cleanText(formData.criteria),
    evidenceLabel: cleanText(formData.evidenceLabel) || 'Evidence',
    evidencePrompt: cleanText(formData.evidencePrompt),
    evidenceExampleUrl: cleanText(formData.evidenceExampleUrl),
    evidenceDescription: cleanText(formData.evidenceDescription),
    skills: parseListInput(formData.skills),
    standards: parseListInput(formData.standards),
    pathwayId: cleanText(formData.pathwayId),
    pathwayTitle: cleanText(formData.pathwayTitle),
    pathwayDescription: cleanText(formData.pathwayDescription),
    pathwayOrder: parseNumber(formData.pathwayOrder, 1),
    pathwayItems: parseListInput(formData.pathwayItems),
    issuerName: cleanText(formData.issuerName),
    issuerOrganization: cleanText(formData.issuerOrganization),
    issuerWebsite: normalizeUrl(cleanText(formData.issuerWebsite)),
    careerCenterUrl: normalizeUrl(cleanText(formData.careerCenterUrl)),
    issuerContactEmail: cleanText(formData.issuerContactEmail),
    issuerVerificationNote: cleanText(formData.issuerVerificationNote),
    issuerRegistryUrl: normalizeUrl(cleanText(formData.issuerRegistryUrl)),
    issuerTrustLabel: cleanText(formData.issuerTrustLabel) || 'Official issuer',
    badgeImage,
    certificateBackground,
    widgetLayout: cleanText(formData.widgetLayout) || 'stacked',
    verificationSections: buildTemplateVerificationSections(formData),
    ...buildTemplateCertificateOverride(formData, certificateBackground)
  };

  if (!template.title || !template.publicSummary || !template.meaning || !template.criteria) {
    throw new Error('Template title, summary, meaning, and criteria are required.');
  }

  const templates = loadBadgeTemplates();
  const existingIndex = templates.findIndex((entry) => entry.id === id);
  if (existingIndex >= 0) {
    templates[existingIndex] = template;
  } else {
    templates.push(template);
  }
  saveBadgeTemplates(templates);
  createBackupSnapshot(`Saved template ${id}`, 'admin');
  appendAuditLog({ action: 'template.save', actor: 'admin', templateId: id });
}

function deleteTemplate(templateId) {

  const templates = loadBadgeTemplates().filter((entry) => entry.id !== templateId);
  saveBadgeTemplates(templates);
  createBackupSnapshot(`Deleted template ${templateId}`, 'admin');
  appendAuditLog({ action: 'template.delete', actor: 'admin', templateId });
}

function deleteBadge(badgeId) {
  const badges = loadBadges();
  const deletedBadge = badges.find((badge) => badge.id === badgeId);
  const remaining = badges.filter((badge) => badge.id !== badgeId);
  if (deletedBadge) {
    const deleted = loadDeletedBadges();
    deleted.unshift({ ...deletedBadge, deletedAt: new Date().toISOString() });
    saveDeletedBadges(deleted);
  }
  saveBadges(remaining);
  createBackupSnapshot(`Deleted badge ${badgeId}`, 'admin');
  appendAuditLog({ action: 'badge.delete', actor: 'admin', badgeId });
}

function parseNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBooleanFormValue(value) {
  return value === true || value === 'true' || value == 'on' || value == '1';
}

function buildTemplateVerificationSections(formData) {
  return normalizeVerificationSections({
    recipient: parseBooleanFormValue(formData.sectionRecipient),
    meaning: parseBooleanFormValue(formData.sectionMeaning),
    criteria: parseBooleanFormValue(formData.sectionCriteria),
    issuerTrust: parseBooleanFormValue(formData.sectionIssuerTrust),
    evidence: parseBooleanFormValue(formData.sectionEvidence),
    skills: parseBooleanFormValue(formData.sectionSkills),
    pathway: parseBooleanFormValue(formData.sectionPathway),
    certificate: parseBooleanFormValue(formData.sectionCertificate)
  });
}

function saveSettings(formData) {
  const siteConfig = {
    siteName: cleanText(formData.siteName),
    organizationName: cleanText(formData.organizationName),
    publicSiteUrl: normalizeUrl(cleanText(formData.publicSiteUrl)),
    defaultCareerCenterUrl: normalizeUrl(cleanText(formData.defaultCareerCenterUrl)),
    supportEmail: cleanText(formData.supportEmail),
    credentialPrefix: cleanText(formData.credentialPrefix),
    heroTitle: cleanText(formData.heroTitle),
    heroIntro: cleanText(formData.heroIntro),
    footerNote: cleanText(formData.footerNote)
  };

  const certificateTemplate = {
    backgroundImage: cleanText(formData.backgroundImage),
    fileNameSuffix: cleanText(formData.fileNameSuffix),
    name: {
      x: parseNumber(formData.nameX),
      y: parseNumber(formData.nameY),
      fontSize: parseNumber(formData.nameFontSize),
      fontFamily: cleanText(formData.nameFontFamily),
      fontWeight: cleanText(formData.nameFontWeight),
      color: cleanText(formData.nameColor),
      align: cleanText(formData.nameAlign),
      maxWidth: parseNumber(formData.nameMaxWidth)
    },
    date: {
      x: parseNumber(formData.dateX),
      y: parseNumber(formData.dateY),
      fontSize: parseNumber(formData.dateFontSize),
      fontFamily: cleanText(formData.dateFontFamily),
      fontWeight: cleanText(formData.dateFontWeight),
      color: cleanText(formData.dateColor),
      align: cleanText(formData.dateAlign),
      maxWidth: parseNumber(formData.dateMaxWidth)
    }
  };

  saveSiteConfig(siteConfig);
  saveCertificateTemplate(certificateTemplate);

  const badges = loadBadges();
  const updatedBadges = badges.map((badge) => ({
    ...badge,
    publicUrl: getPublicBadgeUrl(siteConfig, badge.slug)
  }));
  saveBadges(updatedBadges);
  createBackupSnapshot('Saved settings', 'admin');
  appendAuditLog({ action: 'settings.save', actor: 'admin' });
}

function restoreFullBackup(jsonText) {
  const state = parseFullBackupJson(jsonText);
  applyAppState(state, { reason: 'Full backup restored from admin', actor: 'admin', snapshot: false });
  createBackupSnapshot('Restored full system backup', 'admin');
}


function buildGeneratorKey(templateId, pageKind = 'general') {
  if (!templateId || pageKind === 'general') {
    return 'general';
  }
  return templateId;
}

function badgeMatchesAnalyticsFilter(badge, filters = {}) {
  if (filters.badgeType && String(badge.badgeTemplateId || '') !== String(filters.badgeType)) {
    return false;
  }
  const year = filters.year ? String(filters.year) : '';
  const month = filters.month ? String(filters.month) : '';
  const badgeYear = String(badge.issueDateISO || badge.createdAt || '').slice(0, 4);
  const badgeMonth = String(badge.issueDateISO || badge.createdAt || '').slice(0, 7);
  if (year && badgeYear !== year) {
    return false;
  }
  if (month && badgeMonth !== month) {
    return false;
  }
  return true;
}

function eventMatchesAnalyticsFilter(event, filters = {}) {
  if (filters.badgeType && String(event.badgeTemplateId || '') !== String(filters.badgeType)) {
    return false;
  }
  if (filters.year && String(event.yearKey || '').trim() !== String(filters.year)) {
    return false;
  }
  if (filters.month && String(event.monthKey || '').trim() !== String(filters.month)) {
    return false;
  }
  return true;
}

function buildAnalyticsViewModel(urlObject) {
  const templates = loadBadgeTemplates();
  const filters = {
    year: cleanText(urlObject.searchParams.get('year')),
    month: cleanText(urlObject.searchParams.get('month')),
    badgeType: cleanText(urlObject.searchParams.get('badgeType'))
  };
  const badges = loadBadges();
  const events = loadAnalyticsEvents();
  const filteredBadges = badges.filter((badge) => badgeMatchesAnalyticsFilter(badge, filters));
  const filteredEvents = events.filter((event) => eventMatchesAnalyticsFilter(event, filters));
  const hasFilters = Boolean(filters.year || filters.month || filters.badgeType);
  const summary = hasFilters
    ? buildAnalyticsSummary({ badges: filteredBadges, templates, events: filteredEvents })
    : loadAnalyticsSummary();
  const recentEvents = filteredEvents
    .slice()
    .sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || '')))
    .slice(0, 30);
  const queryParams = new URLSearchParams();
  if (filters.year) queryParams.set('year', filters.year);
  if (filters.month) queryParams.set('month', filters.month);
  if (filters.badgeType) queryParams.set('badgeType', filters.badgeType);
  return {
    summary,
    filters: {
      ...filters,
      queryString: queryParams.toString()
    },
    recentEvents,
    badgeTypeOptions: templates.map((template) => ({ id: template.id, title: template.title }))
  };
}

async function trackAnalyticsEvent(eventInput, reason = 'Track analytics event') {
  appendAnalyticsEvent(eventInput);
  try {
    await queuePushLocalData(reason);
  } catch (error) {
    console.warn(`Analytics sync failed: ${error.message}`);
  }
}

function restoreBadgesCsv(csvText) {
  const importedBadges = importBadgesFromCsv(csvText);
  saveBadges(importedBadges);
  createBackupSnapshot('Restored issued badges from CSV', 'admin');
  appendAuditLog({ action: 'badges.restore_csv', actor: 'admin', count: importedBadges.length });
}

function renderDashboardPage(urlObject) {
  const siteConfig = loadSiteConfig();
  const filteredBadges = filterBadges(loadBadges(), urlObject.searchParams.get('q') || '').map((badge) => ({
    ...badge,
    publicUrl: buildBrowserBadgeUrl(badge)
  }));
  const successLink = urlObject.searchParams.get('successLink') || '';
  const successBadgeId = urlObject.searchParams.get('successBadgeId') || '';
  return renderDashboard({
    badges: filteredBadges,
    query: urlObject.searchParams.get('q') || '',
    siteConfig: {
      ...siteConfig,
      publicSiteUrl: hasConfiguredPublicUrl(siteConfig) ? siteConfig.publicSiteUrl : '/'
    },
    successLink,
    successBadgeId
  });
}

async function handlePublicApiRequest(request, response, urlObject) {
  if (request.method === 'POST' && urlObject.pathname === '/api/public/badges-by-email') {
    try {
      const formData = await parseBody(request);
      const email = normalizeEmail(formData.email);
      if (!isValidEmail(email)) {
        sendText(response, JSON.stringify({ ok: false, error: 'Enter a valid email address.' }), 400, 'application/json; charset=utf-8');
        return true;
      }
      const matches = sortBadgesDescending(loadBadges())
        .filter((badge) => normalizeEmail(badge.awardeeEmail) === email)
        .map((badge) => sanitizeBadgeResponse(badge));
      sendText(response, JSON.stringify({ ok: true, matches }), 200, 'application/json; charset=utf-8');
    } catch (error) {
      sendText(response, JSON.stringify({ ok: false, error: error.message }), 400, 'application/json; charset=utf-8');
    }
    return true;
  }

  if (request.method === 'POST' && urlObject.pathname === '/api/public/issue') {
    try {
      const formData = await parseBody(request);
      const badge = await persistMutation('Issue badge from public generator', () => {
        const issuedBadge = handleIssueBadge({
          ...formData,
          source: 'public-generator'
        });
        appendAnalyticsEvent({
          type: 'generator_completed',
          timestamp: new Date().toISOString(),
          badgeId: issuedBadge.id,
          badgeSlug: issuedBadge.slug,
          badgeTitle: issuedBadge.badgeTitle,
          badgeTemplateId: issuedBadge.badgeTemplateId,
          awardeeName: issuedBadge.awardeeName,
          publicUrl: buildBrowserBadgeUrl(issuedBadge),
          generatorKey: buildGeneratorKey(issuedBadge.badgeTemplateId, cleanText(formData.pageKind) || 'general'),
          generatorLabel: cleanText(formData.generatorLabel) || (cleanText(formData.pageKind) === 'specific' ? `${issuedBadge.badgeTitle} generator` : 'General generator'),
          pageKind: cleanText(formData.pageKind) || 'general',
          source: 'public-generator',
          context: 'completion'
        });
        return issuedBadge;
      }, buildPublicSite);
      const browserUrl = buildBrowserBadgeUrl(badge);
      sendText(response, JSON.stringify({ ok: true, badge: sanitizeBadgeResponse({ ...badge, publicUrl: browserUrl }) }), 201, 'application/json; charset=utf-8');
    } catch (error) {
      sendText(
        response,
        JSON.stringify({ ok: false, error: error.message }),
        400,
        'application/json; charset=utf-8'
      );
    }
    return true;
  }

  if (request.method === 'POST' && urlObject.pathname === '/api/analytics/track') {
    try {
      const formData = await parseBody(request);
      const type = cleanText(formData.type);
      const allowed = new Set(['badge_viewed', 'certificate_downloaded', 'generator_opened']);
      if (!allowed.has(type)) {
        sendText(response, JSON.stringify({ ok: false, error: 'Unsupported analytics event.' }), 400, 'application/json; charset=utf-8');
        return true;
      }
      await trackAnalyticsEvent({
        type,
        timestamp: new Date().toISOString(),
        badgeId: cleanText(formData.badgeId),
        badgeSlug: cleanText(formData.badgeSlug),
        badgeTitle: cleanText(formData.badgeTitle),
        badgeTemplateId: cleanText(formData.badgeTemplateId),
        awardeeName: cleanText(formData.awardeeName),
        awardeeEmail: normalizeEmail(formData.awardeeEmail),
        publicUrl: cleanText(formData.publicUrl),
        generatorKey: buildGeneratorKey(cleanText(formData.badgeTemplateId), cleanText(formData.pageKind) || 'general'),
        generatorLabel: cleanText(formData.generatorLabel),
        pageKind: cleanText(formData.pageKind),
        source: cleanText(formData.source) || 'public-site',
        requestPath: urlObject.pathname,
        visitorId: createVisitorId(request),
        context: cleanText(formData.context)
      }, `Analytics: ${type}`);
      sendText(response, JSON.stringify({ ok: true }), 202, 'application/json; charset=utf-8');
    } catch (error) {
      sendText(response, JSON.stringify({ ok: false, error: error.message }), 400, 'application/json; charset=utf-8');
    }
    return true;
  }

  return false;
}

async function handleAdminRequest(request, response, urlObject) {
  if (request.method === 'GET' && urlObject.pathname === '/admin/login') {
    if (isAuthenticated(request)) {
      redirect(response, '/admin');
      return;
    }
    sendHtml(response, renderLoginPage(queryNotice(urlObject)));
    return;
  }

  if (request.method === 'POST' && urlObject.pathname === '/admin/login') {
    const formData = await parseBody(request);
    const password = cleanText(formData.password);
    if (password === ADMIN_PASSWORD) {
      const sessionId = createSession();
      redirect(response, '/admin', {
        'Set-Cookie': `badge_admin_session=${encodeURIComponent(sessionId)}; HttpOnly; Path=/; SameSite=Lax`
      });
      return;
    }
    sendHtml(response, renderLoginPage('Incorrect password.'), 401);
    return;
  }

  if (request.method === 'POST' && urlObject.pathname === '/admin/logout') {
    clearSession(request);
    redirect(response, '/admin/login', {
      'Set-Cookie': 'badge_admin_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax'
    });
    return;
  }

  if (!requireAuth(request, response)) {
    return;
  }

  if (request.method === 'GET' && (urlObject.pathname === '/admin' || urlObject.pathname === '/admin/')) {
    sendHtml(response, renderDashboardPage(urlObject));
    return;
  }

  if (request.method === 'GET' && urlObject.pathname === '/admin/issue') {
    const siteConfig = loadSiteConfig();
    sendHtml(
      response,
      renderIssuePage({
        templates: loadBadgeTemplates(),
        defaultDate: formatLongDate(),
        defaultCareerCenterUrl: siteConfig.defaultCareerCenterUrl,
        siteConfig,
        notice: queryNotice(urlObject)
      })
    );
    return;
  }

  if (request.method === 'POST' && urlObject.pathname === '/admin/issue') {
    try {
      const formData = await parseBody(request);
      const badge = await persistMutation('Issue badge from admin dashboard', () => handleIssueBadge(formData), buildPublicSite);
      const successLink = badge.publicUrl.startsWith('http') ? badge.publicUrl : `/badges/${badge.slug}/`;
      redirect(
        response,
        `/admin?notice=${encodeURIComponent('Badge issued successfully.')}&successLink=${encodeURIComponent(successLink)}&successBadgeId=${encodeURIComponent(badge.id)}`
      );
    } catch (error) {
      const siteConfig = loadSiteConfig();
      sendHtml(
        response,
        renderIssuePage({
          templates: loadBadgeTemplates(),
          defaultDate: formatLongDate(),
          defaultCareerCenterUrl: siteConfig.defaultCareerCenterUrl,
          siteConfig,
          notice: error.message
        }),
        400
      );
    }
    return;
  }

  if (request.method === 'GET' && urlObject.pathname === '/admin/bulk-issue') {
    sendHtml(
      response,
      renderBulkIssuePage({
        templates: loadBadgeTemplates(),
        jobs: loadBulkIssueJobs(),
        notice: queryNotice(urlObject),
        defaultDate: formatLongDate()
      })
    );
    return;
  }

  if (request.method === 'GET' && urlObject.pathname === '/admin/bulk-issue/template.csv') {
    sendText(response, buildBulkIssueTemplateCsv(), 200, 'text/csv; charset=utf-8', {
      'Content-Disposition': 'attachment; filename="bulk-badge-issue-template.csv"'
    });
    return;
  }

  if (request.method === 'GET' && urlObject.pathname === '/admin/bulk-issue/jobs.json') {
    sendText(response, JSON.stringify({ ok: true, jobs: loadBulkIssueJobs() }), 200, 'application/json; charset=utf-8');
    return;
  }

  if (request.method === 'POST' && urlObject.pathname === '/admin/bulk-issue/validate') {
    try {
      const formData = await parseBody(request);
      const job = createBulkIssueValidationJob(formData);
      appendAuditLog({ action: 'bulk.issue.validate', actor: 'admin', jobId: job.id, totalRows: job.totalRows, badgeTemplateId: job.badgeTemplateId });
      redirect(response, `/admin/bulk-issue/validate?job=${encodeURIComponent(job.id)}`);
    } catch (error) {
      sendHtml(response, renderBulkIssuePage({ templates: loadBadgeTemplates(), jobs: loadBulkIssueJobs(), notice: error.message, defaultDate: formatLongDate() }), 400);
    }
    return;
  }

  if (request.method === 'GET' && urlObject.pathname === '/admin/bulk-issue/validate') {
    const jobId = cleanText(urlObject.searchParams.get('job'));
    const job = loadBulkIssueJobs().find((entry) => entry.id === jobId);
    if (!job) {
      redirect(response, buildNoticeUrl('/admin/bulk-issue', 'Bulk issue validation job not found.'));
      return;
    }
    sendHtml(response, renderBulkIssueValidationPage({ job, notice: queryNotice(urlObject) }));
    return;
  }

  if (request.method === 'POST' && urlObject.pathname === '/admin/bulk-issue/start') {
    let jobId = '';
    try {
      const formData = await parseBody(request);
      jobId = cleanText(formData.jobId);
      const job = await processBulkIssueJobSync(jobId);
      appendAuditLog({ action: 'bulk.issue.start', actor: 'admin', jobId: job.id, totalRows: job.totalRows, completedRows: job.completedRows, failedRows: job.failedRows, badgeTemplateId: job.badgeTemplateId });
      redirect(response, `/admin/bulk-issue/success?job=${encodeURIComponent(job.id)}`);
    } catch (error) {
      redirect(response, `${buildNoticeUrl('/admin/bulk-issue/validate', error.message)}&job=${encodeURIComponent(jobId)}`);
    }
    return;
  }

  if (request.method === 'GET' && urlObject.pathname === '/admin/bulk-issue/success') {
    const jobId = cleanText(urlObject.searchParams.get('job'));
    const job = loadBulkIssueJobs().find((entry) => entry.id === jobId);
    if (!job) {
      redirect(response, buildNoticeUrl('/admin/bulk-issue', 'Bulk issue job not found.'));
      return;
    }
    sendHtml(response, renderBulkIssueSuccessPage({ job, notice: queryNotice(urlObject) }));
    return;
  }

  if (request.method === 'GET' && urlObject.pathname === '/admin/templates') {
    const editId = urlObject.searchParams.get('edit') || '';
    const templates = loadBadgeTemplates();
    const editTemplate = templates.find((entry) => entry.id === editId) || null;
    sendHtml(response, renderTemplatesPage({ templates, editTemplate, notice: queryNotice(urlObject), siteConfig: loadSiteConfig(), certificateTemplate: loadCertificateTemplate() }));
    return;
  }

  if (request.method === 'POST' && urlObject.pathname === '/admin/templates/save') {
    try {
      const formData = await parseBody(request);
      await persistMutation('Save badge template', () => saveTemplate(formData), buildPublicSite);
      redirect(response, buildNoticeUrl('/admin/templates', 'Template saved and site rebuilt.'));
    } catch (error) {
      const templates = loadBadgeTemplates();
      sendHtml(response, renderTemplatesPage({ templates, notice: error.message, siteConfig: loadSiteConfig(), certificateTemplate: loadCertificateTemplate() }), 400);
    }
    return;
  }

  if (request.method === 'POST' && urlObject.pathname === '/admin/templates/delete') {
    const formData = await parseBody(request);
    await persistMutation('Delete badge template', () => deleteTemplate(cleanText(formData.templateId)), buildPublicSite);
    redirect(response, buildNoticeUrl('/admin/templates', 'Template deleted.'));
    return;
  }

  if (request.method === 'GET' && urlObject.pathname === '/admin/settings') {
    sendHtml(
      response,
      renderSettingsPage({
        siteConfig: loadSiteConfig(),
        certificateTemplate: loadCertificateTemplate(),
        today: formatLongDate(),
        notice: queryNotice(urlObject)
      })
    );
    return;
  }

  if (request.method === 'GET' && urlObject.pathname === '/admin/analytics') {
    sendHtml(response, renderAnalyticsPage(buildAnalyticsViewModel(urlObject)));
    return;
  }

  if (request.method === 'GET' && urlObject.pathname === '/admin/backups') {
    sendHtml(
      response,
      renderBackupsPage({
        backups: getRecentBackups(50),
        appState: loadAppState(),
        notice: queryNotice(urlObject)
      })
    );
    return;
  }

  if (request.method === 'POST' && urlObject.pathname === '/admin/settings/save') {
    try {
      const formData = await parseBody(request);
      await persistMutation('Save badge system settings', () => saveSettings(formData), buildPublicSite);
      redirect(response, buildNoticeUrl('/admin/settings', 'Settings saved and site rebuilt.'));
    } catch (error) {
      sendHtml(
        response,
        renderSettingsPage({
          siteConfig: loadSiteConfig(),
          certificateTemplate: loadCertificateTemplate(),
          today: formatLongDate(),
          notice: error.message
        }),
        400
      );
    }
    return;
  }


  if (request.method === 'POST' && urlObject.pathname === '/admin/backups/snapshot') {
    await persistMutation('Create manual backup snapshot', () => {
      createBackupSnapshot('Manual snapshot from admin', 'admin');
    }, buildPublicSite);
    redirect(response, buildNoticeUrl('/admin/backups', 'Snapshot created and synced.'));
    return;
  }

  if (request.method === 'POST' && urlObject.pathname === '/admin/backups/restore-json') {
    try {
      const formData = await parseBody(request);
      await persistMutation('Restore full app state from backup JSON', () => restoreFullBackup(formData.jsonBackupContent), buildPublicSite);
      redirect(response, buildNoticeUrl('/admin/backups', 'Full system backup restored.'));
    } catch (error) {
      sendHtml(response, renderBackupsPage({ backups: getRecentBackups(50), appState: loadAppState(), notice: error.message }), 400);
    }
    return;
  }

  if (request.method === 'POST' && urlObject.pathname === '/admin/backups/restore-csv') {
    try {
      const formData = await parseBody(request);
      await persistMutation('Restore issued badges from CSV', () => restoreBadgesCsv(formData.csvBackupContent), buildPublicSite);
      redirect(response, buildNoticeUrl('/admin/backups', 'Issued badges restored from CSV.'));
    } catch (error) {
      sendHtml(response, renderBackupsPage({ backups: getRecentBackups(50), appState: loadAppState(), notice: error.message }), 400);
    }
    return;
  }

  if (request.method === 'GET' && urlObject.pathname === '/admin/export/app-state') {
    const json = JSON.stringify({ appState: loadAppState() }, null, 2) + '\n';
    sendText(response, json, 200, 'application/json; charset=utf-8', {
      'Content-Disposition': 'attachment; filename="csun-ebadges-app-state-backup.json"'
    });
    return;
  }

  if (request.method === 'GET' && urlObject.pathname === '/admin/export/csv') {
    const csvPath = path.join(PATHS.dataDir, 'badge-links.csv');
    const csv = fs.existsSync(csvPath) ? fs.readFileSync(csvPath, 'utf8') : 'credential_id,awardee_name,badge_title,issue_date,status,public_url,repo_badge_page,details_json\n';
    sendText(response, csv, 200, 'text/csv; charset=utf-8', {
      'Content-Disposition': 'attachment; filename="badge-links.csv"'
    });
    return;
  }

  if (request.method === 'GET' && urlObject.pathname === '/admin/export/analytics.csv') {
    const filters = buildAnalyticsViewModel(urlObject);
    const csv = buildAnalyticsCsv(filters.recentEvents.length || filters.filters.year || filters.filters.month || filters.filters.badgeType
      ? loadAnalyticsEvents().filter((event) => eventMatchesAnalyticsFilter(event, filters.filters))
      : loadAnalyticsEvents());
    sendText(response, csv, 200, 'text/csv; charset=utf-8', {
      'Content-Disposition': 'attachment; filename="badge-analytics.csv"'
    });
    return;
  }

  if (request.method === 'POST' && urlObject.pathname === '/admin/badges/delete') {
    const formData = await parseBody(request);
    await persistMutation('Delete issued badge', () => deleteBadge(cleanText(formData.badgeId)), buildPublicSite);
    redirect(response, buildNoticeUrl('/admin', 'Badge deleted and public files refreshed.'));
    return;
  }

  sendHtml(response, renderDashboardPage(urlObject), 404);
}

async function requestListener(request, response) {
  const urlObject = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  try {
    if (urlObject.pathname === '/generate' || urlObject.pathname === '/generate/') {
      redirect(response, '/generator/');
      return;
    }

    if (request.method === 'GET' && urlObject.pathname === '/access') {
      if (isPublicAuthenticated(request)) {
        redirect(response, getSafeNextPath(urlObject.searchParams.get('next')));
        return;
      }
      sendHtml(response, renderPublicAccessPage(getSafeNextPath(urlObject.searchParams.get('next')), queryNotice(urlObject)));
      return;
    }

    if (request.method === 'POST' && urlObject.pathname === '/access') {
      const formData = await parseBody(request);
      const nextPath = getSafeNextPath(formData.next);
      if (cleanText(formData.password) === PUBLIC_PASSWORD) {
        const sessionId = createSession(publicSessions);
        redirect(response, nextPath, {
          'Set-Cookie': `badge_public_session=${encodeURIComponent(sessionId)}; HttpOnly; Path=/; SameSite=Lax`
        });
        return;
      }
      sendHtml(response, renderPublicAccessPage(nextPath, 'Incorrect password.'), 401);
      return;
    }

    if (await handlePublicApiRequest(request, response, urlObject)) {
      return;
    }

    if (urlObject.pathname.startsWith('/admin-static/')) {
      const requestPath = urlObject.pathname.replace('/admin-static', '');
      if (serveStatic(PATHS.adminDir, requestPath, response)) {
        return;
      }
      sendNotFoundPage(response);
      return;
    }

    if (urlObject.pathname.startsWith('/admin')) {
      await handleAdminRequest(request, response, urlObject);
      return;
    }

    if (requiresPublicPassword(urlObject.pathname) && !isPublicAuthenticated(request)) {
      const nextPath = `${urlObject.pathname}${urlObject.search || ''}`;
      redirect(response, `/access?next=${encodeURIComponent(nextPath)}`);
      return;
    }

    if (serveStatic(PATHS.docsDir, urlObject.pathname, response)) {
      return;
    }

    sendNotFoundPage(response);
  } catch (error) {
    sendHtml(
      response,
      `<!DOCTYPE html><html><body><h1>Server error</h1><pre>${escapeHtml(error.stack || error.message)}</pre></body></html>`,
      500
    );
  }
}

if (process.argv.includes('--build')) {
  initializeApp().then(() => {
    console.log('Public site rebuilt successfully.');
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else {
  initializeApp().then(() => {
    http.createServer(requestListener).listen(PORT, () => {
      console.log(`CSUN Career Center E-Badges running at http://localhost:${PORT}`);
      console.log('Admin password-only login is enabled.');
    });
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
