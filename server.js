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
  sortBadgesDescending,
  writeText,
  normalizeUrl,
  hasConfiguredPublicUrl
} = require('./lib/store');
const { buildPublicSite } = require('./lib/site-generator');
const {
  renderLoginPage,
  renderDashboard,
  renderIssuePage,
  renderTemplatesPage,
  renderSettingsPage
} = require('./lib/admin-renderer');

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
ensureDataFiles();
buildPublicSite();

const PORT = Number(process.env.PORT || 8787);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'spider#5';
const sessions = new Map();

function createSession() {
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, { createdAt: Date.now() });
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
      if (body.length > 1e6) {
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

function filterBadges(badges, query) {
  const trimmed = String(query || '').trim().toLowerCase();
  if (!trimmed) {
    return sortBadgesDescending(badges);
  }
  return sortBadgesDescending(
    badges.filter((badge) =>
      [badge.awardeeName, badge.badgeTitle, badge.issueDate, badge.id, badge.meaning]
        .join(' ')
        .toLowerCase()
        .includes(trimmed)
    )
  );
}

function cleanText(value) {
  return String(value || '').trim();
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
  const template = badgeTemplateId
    ? loadBadgeTemplates().find((entry) => entry.id === badgeTemplateId)
    : null;

  if (badgeTemplateId && !template) {
    throw new Error('The selected badge template could not be found.');
  }

  const siteConfig = loadSiteConfig();
  const certificateTemplate = loadCertificateTemplate();

  return {
    awardeeName: cleanText(formData.awardeeName),
    issueDate: cleanText(formData.issueDate),
    badgeTemplateId,
    badgeTitle: cleanText(formData.badgeTitle) || cleanText(template && template.title),
    badgeLabel:
      cleanText(formData.badgeLabel) ||
      cleanText(template && (template.badgeLabel || template.title)) ||
      cleanText(formData.badgeTitle),
    description: cleanText(formData.description) || cleanText(template && template.description),
    meaning: cleanText(formData.meaning) || cleanText(template && template.meaning),
    criteria: cleanText(formData.criteria) || cleanText(template && template.criteria),
    issuerName:
      cleanText(formData.issuerName) ||
      cleanText(template && template.issuerName) ||
      cleanText(siteConfig.organizationName),
    issuerOrganization:
      cleanText(formData.issuerOrganization) ||
      cleanText(template && template.issuerOrganization) ||
      cleanText(siteConfig.organizationName),
    issuerWebsite:
      normalizeUrl(cleanText(formData.issuerWebsite) || cleanText(template && template.issuerWebsite) || cleanText(siteConfig.defaultCareerCenterUrl)),
    careerCenterUrl:
      normalizeUrl(cleanText(formData.careerCenterUrl) || cleanText(template && template.careerCenterUrl) || cleanText(siteConfig.defaultCareerCenterUrl)),
    badgeImage: cleanText(formData.badgeImage) || cleanText(template && template.badgeImage),
    certificateBackground:
      cleanText(formData.certificateBackground) ||
      cleanText(template && template.certificateBackground) ||
      cleanText(certificateTemplate.backgroundImage)
  };
}

function createBadgeRecord(formData) {
  const merged = mergeTemplateFields(formData);
  const {
    awardeeName,
    issueDate,
    badgeTemplateId,
    badgeTitle,
    badgeLabel,
    description,
    meaning,
    criteria,
    issuerName,
    issuerOrganization,
    issuerWebsite,
    careerCenterUrl,
    badgeImage,
    certificateBackground
  } = merged;

  if (!awardeeName || !badgeTitle || !description || !meaning || !criteria) {
    throw new Error('Awardee name, badge title, summary, meaning, and criteria are required.');
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
    issueDate: parsedDate.display,
    issueDateISO: parsedDate.iso,
    badgeTemplateId,
    badgeTitle,
    badgeLabel,
    description,
    meaning,
    criteria,
    issuerName,
    issuerOrganization,
    issuerWebsite,
    careerCenterUrl,
    badgeImage,
    certificateBackground,
    status: 'valid',
    neverExpires: true,
    createdAt: new Date().toISOString(),
    source: cleanText(formData.source) || 'admin'
  };

  candidate.slug = buildBadgeSlug(candidate);
  candidate.relativeUrl = buildRelativeBadgeUrl(candidate.slug);
  candidate.relativeJsonUrl = buildRelativeBadgeJsonUrl(candidate.slug);
  candidate.publicUrl = getPublicBadgeUrl(siteConfig, candidate.slug);
  candidate.repoPath = `docs/badges/${candidate.slug}/index.html`;
  candidate.detailsJsonPath = `docs/badges/${candidate.slug}/details.json`;
  return candidate;
}

function handleIssueBadge(formData) {
  const badges = loadBadges();
  const badge = createBadgeRecord(formData);
  badges.push(badge);
  saveBadges(badges);
  buildPublicSite();
  return badge;
}

function saveTemplate(formData) {
  const id = slugify(formData.id);
  if (!id) {
    throw new Error('Template ID is required.');
  }
  const template = {
    id,
    title: cleanText(formData.title),
    badgeLabel: cleanText(formData.badgeLabel),
    description: cleanText(formData.description),
    meaning: cleanText(formData.meaning),
    criteria: cleanText(formData.criteria),
    issuerName: cleanText(formData.issuerName),
    issuerOrganization: cleanText(formData.issuerOrganization),
    issuerWebsite: normalizeUrl(cleanText(formData.issuerWebsite)),
    careerCenterUrl: normalizeUrl(cleanText(formData.careerCenterUrl)),
    badgeImage: cleanText(formData.badgeImage),
    certificateBackground: cleanText(formData.certificateBackground)
  };

  if (!template.title || !template.description || !template.meaning || !template.criteria) {
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
  buildPublicSite();
}

function deleteTemplate(templateId) {
  const templates = loadBadgeTemplates().filter((entry) => entry.id !== templateId);
  saveBadgeTemplates(templates);
  buildPublicSite();
}

function deleteBadge(badgeId) {
  const badges = loadBadges().filter((badge) => badge.id !== badgeId);
  saveBadges(badges);
  buildPublicSite();
}

function parseNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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
  buildPublicSite();
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
  if (request.method === 'POST' && urlObject.pathname === '/api/public/issue') {
    try {
      const formData = await parseBody(request);
      const badge = handleIssueBadge({
        ...formData,
        source: 'public-generator'
      });
      const browserUrl = buildBrowserBadgeUrl(badge);
      sendText(
        response,
        JSON.stringify({
          ok: true,
          badge: {
            id: badge.id,
            awardeeName: badge.awardeeName,
            issueDate: badge.issueDate,
            badgeTitle: badge.badgeTitle,
            publicUrl: browserUrl,
            slug: badge.slug
          }
        }),
        201,
        'application/json; charset=utf-8'
      );
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
    const username = cleanText(formData.username);
    const password = cleanText(formData.password);
    if ((!username || username === ADMIN_USERNAME) && password === ADMIN_PASSWORD) {
      const sessionId = createSession();
      redirect(response, '/admin', {
        'Set-Cookie': `badge_admin_session=${encodeURIComponent(sessionId)}; HttpOnly; Path=/; SameSite=Lax`
      });
      return;
    }
    sendHtml(response, renderLoginPage('Incorrect username or password.'), 401);
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
      const badge = handleIssueBadge(formData);
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

  if (request.method === 'GET' && urlObject.pathname === '/admin/templates') {
    const editId = urlObject.searchParams.get('edit') || '';
    const templates = loadBadgeTemplates();
    const editTemplate = templates.find((entry) => entry.id === editId) || null;
    sendHtml(response, renderTemplatesPage({ templates, editTemplate, notice: queryNotice(urlObject) }));
    return;
  }

  if (request.method === 'POST' && urlObject.pathname === '/admin/templates/save') {
    try {
      const formData = await parseBody(request);
      saveTemplate(formData);
      redirect(response, buildNoticeUrl('/admin/templates', 'Template saved and site rebuilt.'));
    } catch (error) {
      const templates = loadBadgeTemplates();
      sendHtml(response, renderTemplatesPage({ templates, notice: error.message }), 400);
    }
    return;
  }

  if (request.method === 'POST' && urlObject.pathname === '/admin/templates/delete') {
    const formData = await parseBody(request);
    deleteTemplate(cleanText(formData.templateId));
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

  if (request.method === 'POST' && urlObject.pathname === '/admin/settings/save') {
    try {
      const formData = await parseBody(request);
      saveSettings(formData);
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

  if (request.method === 'GET' && urlObject.pathname === '/admin/export/csv') {
    const csvPath = path.join(PATHS.dataDir, 'badge-links.csv');
    const csv = fs.existsSync(csvPath) ? fs.readFileSync(csvPath, 'utf8') : 'credential_id,awardee_name,badge_title,issue_date,status,public_url,repo_badge_page,details_json\n';
    sendText(response, csv, 200, 'text/csv; charset=utf-8', {
      'Content-Disposition': 'attachment; filename="badge-links.csv"'
    });
    return;
  }

  if (request.method === 'POST' && urlObject.pathname === '/admin/badges/delete') {
    const formData = await parseBody(request);
    deleteBadge(cleanText(formData.badgeId));
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

    if (await handlePublicApiRequest(request, response, urlObject)) {
      return;
    }

    if (urlObject.pathname.startsWith('/admin-static/')) {
      const requestPath = urlObject.pathname.replace('/admin-static', '');
      if (serveStatic(PATHS.adminDir, requestPath, response)) {
        return;
      }
      sendHtml(response, '<h1>Not found</h1>', 404);
      return;
    }

    if (urlObject.pathname.startsWith('/admin')) {
      await handleAdminRequest(request, response, urlObject);
      return;
    }

    if (serveStatic(PATHS.docsDir, urlObject.pathname, response)) {
      return;
    }

    const notFoundPage = path.join(PATHS.docsDir, '404.html');
    if (fs.existsSync(notFoundPage)) {
      response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(notFoundPage).pipe(response);
      return;
    }

    sendHtml(response, '<h1>Not found</h1>', 404);
  } catch (error) {
    sendHtml(
      response,
      `<!DOCTYPE html><html><body><h1>Server error</h1><pre>${escapeHtml(error.stack || error.message)}</pre></body></html>`,
      500
    );
  }
}

if (process.argv.includes('--build')) {
  buildPublicSite();
  console.log('Public site rebuilt successfully.');
} else {
  http.createServer(requestListener).listen(PORT, () => {
    console.log(`Career Center badge system running at http://localhost:${PORT}`);
    console.log('Admin login:', ADMIN_USERNAME);
  });
}
