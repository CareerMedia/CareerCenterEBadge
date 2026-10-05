const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const {
  PATHS,
  ensureDir,
  ensureDataFiles,
  flushAppState,
  writeFileAtomic,
  loadBadges,
  loadBadgesReadOnly,
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
  markAppStateDirty,
  loadAppState,
  loadEmailLogEntries,
  appendAppErrorLog,
  loadAppErrorLogEntries,
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
const {
  buildPublicSite,
  publishBadgeArtifacts,
  ensureBadgeArtifacts,
  unpublishBadgeArtifacts,
  publishBadgeIndexes,
  publishTemplateAssets,
  publishBadgesForTemplate,
  removeGeneratorAndWidgetForTemplate
} = require('./lib/site-generator');
const {
  pullRemoteData,
  persistMutation,
  afterMutationCommit,
  runWhenMutationIdle,
  getConfig,
  getSyncStatus,
  queuePushLocalData,
  flushPendingPushes
} = require('./lib/github-sync');
const {
  buildAnalyticsSummary,
  ensureAnalyticsSummaryFresh,
  isAnalyticsSummaryStale,
  refreshAnalyticsSummary,
  iterateNdjson,
  ANALYTICS_CSV_HEADER,
  analyticsCsvRow,
  appendAnalyticsEvent,
  backfillIssuedAnalyticsEvents,
  createVisitorId
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
  renderBulkIssueSuccessPage,
  renderBulkIssueProgressPage,
  renderJobsPage,
  renderEmailPage,
  renderEmailLogPage,
  renderDebugLogPage
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
const {
  queueBadgeAwardedEmail,
  waitForEmailQueue,
  getBrevoApiKey,
  getBrevoHostEnvDiagnostics,
  hasSmtpCredentialsConfigured,
  verifyBrevoRestApiKey
} = require('./lib/brevo-mailer');
const {
  normalizeEmailAwardTemplateEntry,
  createDefaultEmailAwardTemplates,
  plainBodyToHtmlFragment,
  htmlFragmentToPlainBody,
  wrapEmailHtmlDocument
} = require('./lib/award-email-shared');

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

let globalErrorHandlersRegistered = false;

function registerGlobalErrorLogging() {
  if (globalErrorHandlersRegistered) {
    return;
  }
  globalErrorHandlersRegistered = true;
  process.on('unhandledRejection', (reason) => {
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : (() => {
              try {
                return JSON.stringify(reason);
              } catch {
                return String(reason);
              }
            })();
    const stack = reason instanceof Error && reason.stack ? reason.stack : '';
    appendAppErrorLog({
      severity: 'error',
      source: 'unhandled_rejection',
      message,
      stack
    });
    console.error('Unhandled rejection:', reason);
  });
  process.on('uncaughtException', (error) => {
    appendAppErrorLog({
      severity: 'critical',
      source: 'uncaught_exception',
      message: error.message || String(error),
      stack: error.stack || ''
    });
    console.error('Uncaught exception:', error);
  });
}

function logHttpRequestError(request, urlObject, error) {
  appendAppErrorLog({
    severity: 'error',
    source: 'http_request',
    message: error.message || String(error),
    stack: error.stack || '',
    path: urlObject && urlObject.pathname != null ? String(urlObject.pathname) : '',
    method: request && request.method ? String(request.method) : ''
  });
}

async function pullWithRetries(attempts = 3) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await pullRemoteData();
    } catch (error) {
      if (attempt >= attempts) {
        throw error;
      }
      console.warn(`GitHub data restore attempt ${attempt} failed (${error.message}); retrying.`);
      await new Promise((resolve) => setTimeout(resolve, 5000 * attempt));
    }
  }
}

async function initializeApp(options = {}) {
  // Let server.listen() bind the port before the synchronous loading work below.
  await new Promise((resolve) => setImmediate(resolve));
  ensureDataFiles();
  registerGlobalErrorLogging();
  const syncConfig = getConfig();
  if (syncConfig.enabled) {
    try {
      const pulled = await pullWithRetries();
      hydrateFilesFromAppState();
      console.log(
        `Loaded persistent badge data from GitHub branch "${syncConfig.branch}" (${pulled.restored || 0} files updated, ${pulled.skippedBackups || 0} backup files left on GitHub).`
      );
    } catch (error) {
      console.warn(`GitHub data restore failed: ${error.message}`);
      appendAppErrorLog({
        severity: 'warning',
        source: 'startup_github_pull',
        message: error.message || String(error),
        stack: error.stack || ''
      });
    }
  } else {
    console.warn('GitHub sync is not configured. Badge data will reset on Render redeploys until GITHUB_TOKEN and GITHUB_REPO are set.');
  }
  markAppStateDirty();
  const analyticsBackfill = backfillIssuedAnalyticsEvents();
  if (analyticsBackfill.created && syncConfig.enabled) {
    queuePushLocalData(`Backfill ${analyticsBackfill.created} analytics issuance events`, { debounceMs: 30000 }).catch((error) => {
      console.warn(`Analytics backfill sync failed: ${error.message}`);
    });
  } else if (isAnalyticsSummaryStale()) {
    refreshAnalyticsSummary();
  }
  buildPublicSite({ badgePages: options.backgroundBadgePages ? 'background' : 'sync' });
  if (!getRecentBackups(1).length) {
    createBackupSnapshot('Initial protected baseline', 'system');
  }
  if (!options.skipBulkRecovery) {
    recoverInterruptedBulkJobs();
  }
}

const PORT = Number(process.env.PORT || 8787);

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_FAILS = 5;
const RATE_LIMIT_LOCK_MS = 15 * 60 * 1000;
const COOKIE_SECURE_FLAG =
  String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true' ||
  String(process.env.NODE_ENV || '').toLowerCase() === 'production';

function fatalConfigError(message) {
  console.error(`FATAL: ${message}`);
  try {
    appendAppErrorLog({
      severity: 'critical',
      source: 'startup_config',
      message,
      stack: ''
    });
  } catch {}
  process.exit(1);
}

function readRequiredPassword(varName) {
  const raw = String(process.env[varName] || '');
  const trimmed = raw.trim();
  if (!trimmed) {
    fatalConfigError(
      `${varName} is not set. Configure it in your environment (Render → Environment) before starting the app.`
    );
  }
  return trimmed;
}

const ADMIN_PASSWORD = readRequiredPassword('ADMIN_PASSWORD');
const PUBLIC_PASSWORD = readRequiredPassword('PUBLIC_PASSWORD');

const sessions = new Map();
const publicSessions = new Map();

function safeEquals(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length) {
    const padLen = Math.max(bufA.length, bufB.length, 1);
    const padA = Buffer.alloc(padLen);
    const padB = Buffer.alloc(padLen);
    bufA.copy(padA);
    bufB.copy(padB);
    crypto.timingSafeEqual(padA, padB);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// Render sits behind Cloudflare, which sets CF-Connecting-IP to the real client and
// rejects client-supplied values. X-Forwarded-For is only appended to by Render, so its
// leftmost entry is attacker-controlled and is not trusted unless TRUSTED_PROXY_HOPS is set.
const TRUSTED_PROXY_HOPS = Math.max(0, Number(process.env.TRUSTED_PROXY_HOPS) || 0);

function getClientIp(request) {
  const headers = (request && request.headers) || {};
  const cloudflare = String(headers['cf-connecting-ip'] || headers['true-client-ip'] || '').trim();
  if (cloudflare) {
    return cloudflare;
  }
  if (TRUSTED_PROXY_HOPS > 0) {
    const chain = String(headers['x-forwarded-for'] || '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    const candidate = chain[chain.length - TRUSTED_PROXY_HOPS];
    if (candidate) {
      return candidate;
    }
  }
  return String((request.socket && request.socket.remoteAddress) || '').trim() || 'unknown';
}

function createRateLimiter({ windowMs, max }) {
  const hits = new Map();
  return {
    // Returns 0 when allowed, otherwise the number of seconds until the next allowed request.
    take(key) {
      const now = Date.now();
      let entry = hits.get(key);
      if (!entry || now - entry.windowStart >= windowMs) {
        entry = { windowStart: now, count: 0 };
        hits.set(key, entry);
      }
      entry.count += 1;
      if (entry.count > max) {
        return Math.max(1, Math.ceil((entry.windowStart + windowMs - now) / 1000));
      }
      return 0;
    },
    sweep() {
      const now = Date.now();
      for (const [key, entry] of hits) {
        if (now - entry.windowStart >= windowMs) {
          hits.delete(key);
        }
      }
    }
  };
}

const publicIssueLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 60 });
const badgeLookupLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 30 });
const analyticsTrackLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 240 });

const loginAttemptTracker = new Map();

function getRateLimitState(ip) {
  const now = Date.now();
  const entry = loginAttemptTracker.get(ip);
  if (!entry) {
    return { locked: false, retryAfterSec: 0 };
  }
  if (entry.blockedUntil && entry.blockedUntil > now) {
    return {
      locked: true,
      retryAfterSec: Math.max(1, Math.ceil((entry.blockedUntil - now) / 1000))
    };
  }
  if (entry.windowStart && now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    loginAttemptTracker.delete(ip);
  }
  return { locked: false, retryAfterSec: 0 };
}

function recordLoginFailure(ip) {
  const now = Date.now();
  const existing = loginAttemptTracker.get(ip);
  if (!existing || (existing.windowStart && now - existing.windowStart > RATE_LIMIT_WINDOW_MS)) {
    loginAttemptTracker.set(ip, { fails: 1, windowStart: now, blockedUntil: 0 });
    return;
  }
  existing.fails = (existing.fails || 0) + 1;
  if (existing.fails >= RATE_LIMIT_MAX_FAILS) {
    existing.blockedUntil = now + RATE_LIMIT_LOCK_MS;
  }
  loginAttemptTracker.set(ip, existing);
}

function clearLoginFailures(ip) {
  loginAttemptTracker.delete(ip);
}

function sweepExpiredState() {
  const now = Date.now();
  for (const store of [sessions, publicSessions]) {
    for (const [sessionId, entry] of store) {
      if (!entry || (entry.expiresAt && entry.expiresAt <= now)) {
        store.delete(sessionId);
      }
    }
  }
  for (const [ip, entry] of loginAttemptTracker) {
    const windowOver = !entry.windowStart || now - entry.windowStart > RATE_LIMIT_WINDOW_MS;
    const unlocked = !entry.blockedUntil || entry.blockedUntil <= now;
    if (windowOver && unlocked) {
      loginAttemptTracker.delete(ip);
    }
  }
  publicIssueLimiter.sweep();
  badgeLookupLimiter.sweep();
  analyticsTrackLimiter.sweep();
}

setInterval(sweepExpiredState, 10 * 60 * 1000).unref();

function buildSessionCookie(name, sessionId, options = {}) {
  const sameSite = options.sameSite || 'Strict';
  const maxAge = options.maxAge != null ? options.maxAge : Math.floor(SESSION_TTL_MS / 1000);
  const parts = [
    `${name}=${encodeURIComponent(sessionId)}`,
    'HttpOnly',
    'Path=/',
    `SameSite=${sameSite}`,
    `Max-Age=${maxAge}`
  ];
  if (COOKIE_SECURE_FLAG) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function buildClearedCookie(name, options = {}) {
  return buildSessionCookie(name, '', { ...options, maxAge: 0 });
}

function createSession(sessionStore = sessions) {
  const sessionId = crypto.randomUUID();
  const now = Date.now();
  sessionStore.set(sessionId, { createdAt: now, expiresAt: now + SESSION_TTL_MS });
  return sessionId;
}

function parseCookies(request) {
  const raw = request.headers.cookie || '';
  return raw.split(';').reduce((accumulator, pair) => {
    const [key, ...rest] = pair.trim().split('=');
    if (!key) return accumulator;
    const value = rest.join('=');
    try {
      accumulator[key] = decodeURIComponent(value);
    } catch {
      accumulator[key] = value;
    }
    return accumulator;
  }, {});
}

function getSessionId(request) {
  const cookies = parseCookies(request);
  return cookies.badge_admin_session || '';
}

function isSessionLive(store, sessionId) {
  if (!sessionId || !store.has(sessionId)) {
    return false;
  }
  const entry = store.get(sessionId);
  if (!entry || (entry.expiresAt && entry.expiresAt <= Date.now())) {
    store.delete(sessionId);
    return false;
  }
  return true;
}

function isAuthenticated(request) {
  return isSessionLive(sessions, getSessionId(request));
}

function isPublicAuthenticated(request) {
  if (isAuthenticated(request)) {
    return true;
  }
  const sessionId = parseCookies(request).badge_public_session || '';
  return isSessionLive(publicSessions, sessionId);
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
    const stream = fs.createReadStream(notFoundPage);
    stream.on('error', () => {
      if (!response.headersSent) {
        sendHtml(response, '<!DOCTYPE html><html><body><h1>Page not found</h1></body></html>', 404);
      } else {
        response.destroy();
      }
    });
    stream.once('open', () => {
      response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      stream.pipe(response);
    });
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

const ADMIN_BODY_LIMIT_BYTES = 20 * 1024 * 1024;
const PUBLIC_BODY_LIMIT_BYTES = 256 * 1024;

function parseBody(request, options = {}) {
  const limit = Number(options.limit) || ADMIN_BODY_LIMIT_BYTES;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    let tooLarge = false;
    request.on('data', (chunk) => {
      if (tooLarge) {
        return;
      }
      received += chunk.length;
      if (received > limit) {
        tooLarge = true;
        chunks.length = 0;
        const error = new Error('Request body too large');
        error.statusCode = 413;
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) {
        return;
      }
      const body = Buffer.concat(chunks).toString('utf8');
      chunks.length = 0;
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
  let cleaned;
  try {
    cleaned = decodeURIComponent(String(requestPath || '').split('?')[0]);
  } catch {
    return null;
  }
  if (cleaned.includes('\0')) {
    return null;
  }
  const root = path.resolve(baseDir);
  const resolved = path.resolve(root, `.${cleaned}`);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return null;
  }
  return resolved;
}

async function statOrNull(filePath) {
  try {
    return await fs.promises.stat(filePath);
  } catch {
    return null;
  }
}

function cacheControlFor(requestPath, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (requestPath.startsWith('/assets/uploads/')) {
    // Upload filenames include a timestamp, so a given URL never changes.
    return 'public, max-age=31536000, immutable';
  }
  if (ext === '.html' || ext === '.json' || ext === '.csv' || ext === '.xml' || ext === '.txt') {
    return 'no-cache';
  }
  return 'public, max-age=3600';
}

function securityHeadersFor(requestPath) {
  if (requestPath.startsWith('/assets/uploads/')) {
    return { 'Content-Security-Policy': 'sandbox', 'X-Content-Type-Options': 'nosniff' };
  }
  return { 'X-Content-Type-Options': 'nosniff' };
}

async function serveStatic(baseDir, requestPath, response, request) {
  const resolved = safeResolve(baseDir, requestPath);
  if (!resolved) {
    return false;
  }

  let filePath = resolved;
  let stat = null;
  if (requestPath.endsWith('/')) {
    filePath = path.join(resolved, 'index.html');
  } else {
    stat = await statOrNull(resolved);
    if (stat && stat.isDirectory()) {
      filePath = path.join(resolved, 'index.html');
      stat = null;
    }
  }
  if (!stat) {
    stat = await statOrNull(filePath);
  }
  if (!stat || !stat.isFile()) {
    return false;
  }

  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': contentTypeFor(filePath),
    'Cache-Control': cacheControlFor(requestPath, filePath),
    ETag: etag,
    'Last-Modified': stat.mtime.toUTCString(),
    ...securityHeadersFor(requestPath)
  };
  const ifNoneMatch = request && request.headers ? String(request.headers['if-none-match'] || '') : '';
  if (ifNoneMatch && ifNoneMatch.split(',').map((tag) => tag.trim()).includes(etag)) {
    response.writeHead(304, headers);
    response.end();
    return true;
  }

  headers['Content-Length'] = stat.size;
  if (request && request.method === 'HEAD') {
    response.writeHead(200, headers);
    response.end();
    return true;
  }

  const stream = fs.createReadStream(filePath);
  stream.on('error', (error) => {
    if (!response.headersSent) {
      sendText(response, 'File could not be read.', 500);
    } else {
      response.destroy(error);
    }
  });
  stream.once('open', () => {
    response.writeHead(200, headers);
    stream.pipe(response);
  });
  return true;
}

function requireAuth(request, response) {
  if (!isAuthenticated(request)) {
    redirect(response, '/admin/login');
    return false;
  }
  return true;
}

async function tryServeUploadFromGithub(baseDir, requestPath, response) {
  const reqPath = String(requestPath || '');
  if (!reqPath.startsWith('/assets/uploads/')) {
    return false;
  }
  const cfg = getConfig();
  if (!cfg.enabled || !cfg.repo || !cfg.branch) {
    return false;
  }
  const resolved = safeResolve(baseDir, reqPath);
  if (!resolved) {
    return false;
  }
  // If file exists, normal static handler should have served it.
  const existing = await statOrNull(resolved);
  if (existing && !existing.isDirectory()) {
    return false;
  }
  const remotePath = `docs${reqPath}`.replace(/^\/+/, '');
  const rawUrl = `https://raw.githubusercontent.com/${cfg.repo}/${encodeURIComponent(cfg.branch)}/${remotePath
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')}`;
  const headers = { 'User-Agent': 'csun-career-center-ebadges' };
  if (cfg.token) {
    headers.Authorization = `Bearer ${cfg.token}`;
  }
  let upstream;
  try {
    upstream = await fetch(rawUrl, { headers, signal: AbortSignal.timeout(20000) });
  } catch {
    return false;
  }
  const declaredLength = Number(upstream.headers.get('content-length') || 0);
  if (!upstream.ok || declaredLength > UPLOAD_PROXY_MAX_BYTES) {
    upstream.body && upstream.body.cancel().catch(() => {});
    return false;
  }
  let buffer;
  try {
    buffer = Buffer.from(await upstream.arrayBuffer());
  } catch {
    return false;
  }
  if (buffer.length > UPLOAD_PROXY_MAX_BYTES) {
    return false;
  }
  try {
    ensureDir(path.dirname(resolved));
    writeFileAtomic(resolved, buffer);
  } catch {
    // If caching fails, still return the bytes.
  }
  response.writeHead(200, {
    'Content-Type': contentTypeFor(resolved),
    'Cache-Control': cacheControlFor(reqPath, resolved),
    ...securityHeadersFor(reqPath)
  });
  response.end(buffer);
  return true;
}

const UPLOAD_PROXY_MAX_BYTES = 15 * 1024 * 1024;

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

const BULK_ISSUE_CHUNK_SIZE = 25;
const runningBulkJobs = new Set();

// Applies a change to one job, re-reading the jobs file so concurrent edits to other
// jobs are not overwritten.
function updateBulkJob(jobId, update) {
  const jobs = loadBulkIssueJobs();
  const job = jobs.find((entry) => entry.id === jobId);
  if (!job) {
    return null;
  }
  update(job);
  saveBulkIssueJobs(jobs);
  return job;
}

function markBulkJobStarted(jobId) {
  return updateBulkJob(jobId, (job) => {
    job.status = 'processing';
    job.startedAt = new Date().toISOString();
    job.finishedAt = '';
    job.processedRows = 0;
    job.completedRows = 0;
    job.failedRows = 0;
    job.progressPercent = 0;
    job.results = [];
    job.errors = [];
  });
}

async function processBulkIssueJobSync(jobId) {
  if (runningBulkJobs.has(jobId)) {
    throw new Error('This bulk issue job is already running.');
  }
  const initial = loadBulkIssueJobs().find((job) => job.id === jobId);
  if (!initial) {
    throw new Error('Bulk issue job not found.');
  }
  if (!Array.isArray(initial.rows) || !initial.rows.length) {
    throw new Error('Bulk issue job has no rows to process.');
  }
  if (initial.rows.some((row) => Array.isArray(row.errors) && row.errors.length)) {
    throw new Error('Resolve validation errors before issuing badges.');
  }

  runningBulkJobs.add(jobId);
  try {
    if (initial.status !== 'processing') {
      markBulkJobStarted(jobId);
    }
    const startJob = loadBulkIssueJobs().find((job) => job.id === jobId);
    const handled = new Set([
      ...(startJob.results || []).map((entry) => entry.rowNumber),
      ...(startJob.errors || []).map((entry) => entry.rowNumber)
    ]);
    const pendingRows = startJob.rows.filter((row) => !handled.has(row.rowNumber));

    for (let offset = 0; offset < pendingRows.length; offset += BULK_ISSUE_CHUNK_SIZE) {
      const chunk = pendingRows.slice(offset, offset + BULK_ISSUE_CHUNK_SIZE);
      let issued = [];
      await persistMutation(
        `Bulk issue rows ${chunk[0].rowNumber}-${chunk[chunk.length - 1].rowNumber} (${jobId})`,
        () => {
          const outcome = issueBadgeBatch(
            chunk.map((row) => ({
              awardeeName: row.awardeeName,
              awardeeEmail: row.awardeeEmail,
              issueDate: row.issueDate,
              badgeTemplateId: startJob.badgeTemplateId,
              source: 'admin-bulk-issue'
            }))
          );
          issued = outcome.badges;
          // Progress is saved in the same mutation as the badges so a restart can resume
          // without issuing any row twice.
          updateBulkJob(jobId, (job) => {
            job.results = job.results || [];
            job.errors = job.errors || [];
            outcome.results.forEach((result, index) => {
              const row = chunk[index];
              if (result.badge) {
                job.completedRows = (job.completedRows || 0) + 1;
                job.results.push({
                  rowNumber: row.rowNumber,
                  awardeeName: row.awardeeName,
                  badgeId: result.badge.id,
                  publicUrl: buildBrowserBadgeUrl(result.badge)
                });
              } else {
                job.failedRows = (job.failedRows || 0) + 1;
                job.errors.push({ rowNumber: row.rowNumber, message: result.error });
              }
            });
            job.processedRows = (job.completedRows || 0) + (job.failedRows || 0);
            job.progressPercent = job.totalRows ? Math.round((job.processedRows / job.totalRows) * 100) : 100;
          });
          return outcome;
        },
        () => {
          const ctx = { siteConfig: loadSiteConfig(), certificateTemplate: loadCertificateTemplate() };
          issued.forEach((badge) => publishBadgeArtifacts(badge, ctx));
          if (issued.length) {
            schedulePublishBadgeIndexes();
          }
        },
        { debounceMs: 5000 }
      );
      await new Promise((resolve) => setImmediate(resolve));
    }

    const finished = await persistMutation(`Finish bulk issue job ${jobId}`, () =>
      updateBulkJob(jobId, (job) => {
        job.status = job.failedRows ? (job.completedRows ? 'completed_with_errors' : 'failed') : 'completed';
        job.finishedAt = new Date().toISOString();
      })
    );
    if (finished && finished.completedRows > 0) {
      scheduleBackgroundSnapshot(`Bulk issued ${finished.completedRows} badge${finished.completedRows === 1 ? '' : 's'} (${jobId})`);
    }
    return finished;
  } catch (error) {
    try {
      await persistMutation(`Stop bulk issue job ${jobId}`, () =>
        updateBulkJob(jobId, (job) => {
          job.status = job.completedRows ? 'completed_with_errors' : 'failed';
          job.finishedAt = new Date().toISOString();
          job.errors = [...(job.errors || []), { rowNumber: 0, message: `Job stopped: ${error.message}` }];
        })
      );
    } catch {}
    throw error;
  } finally {
    runningBulkJobs.delete(jobId);
  }
}

function startBulkIssueJobInBackground(jobId) {
  setImmediate(() => {
    void (async () => {
      try {
        const finished = await processBulkIssueJobSync(jobId);
        appendAuditLog({
          action: 'bulk.issue.start',
          actor: 'admin',
          jobId: finished.id,
          totalRows: finished.totalRows,
          completedRows: finished.completedRows,
          failedRows: finished.failedRows,
          badgeTemplateId: finished.badgeTemplateId
        });
      } catch (err) {
        appendAppErrorLog({
          severity: 'error',
          source: 'bulk_issue_async',
          message: err.message || String(err),
          stack: err.stack || '',
          context: String(jobId || '')
        });
      }
    })();
  });
}

function recoverInterruptedBulkJobs() {
  const interrupted = loadBulkIssueJobs().filter((job) => job.status === 'processing');
  for (const job of interrupted) {
    console.log(`Resuming bulk issue job ${job.id} interrupted by a restart.`);
    startBulkIssueJobInBackground(job.id);
  }
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
  const backgroundImage = cleanText(fallbackBackground);
  return {
    certificateTemplateOverrideEnabled: enabled,
    certificateTemplate: normalizeCertificateConfig({
      backgroundImage,
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

function mergeTemplateFields(formData, ctx = {}) {
  const badgeTemplateId = cleanText(formData.badgeTemplateId);
  const templates = ctx.templates || loadBadgeTemplates();
  const template = badgeTemplateId ? templates.find((entry) => entry.id === badgeTemplateId) : null;

  if (badgeTemplateId && !template) {
    throw new Error('The selected badge template could not be found.');
  }

  const siteConfig = ctx.siteConfig || loadSiteConfig();
  const certificateTemplate = ctx.certificateTemplate || loadCertificateTemplate();
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

function createBadgeRecord(formData, ctx = {}) {
  const merged = mergeTemplateFields(formData, ctx);
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

  const siteConfig = ctx.siteConfig || loadSiteConfig();
  const badges = ctx.badges || loadBadges();
  const parsedDate = parseIssueDate(issueDate);
  const id = buildCredentialId(badges, siteConfig, parsedDate.iso, ctx.reservedIds);

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

function recordIssuedBadge(badge) {
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
  appendAuditLog({ action: 'badge.issue', actor: 'admin', badgeId: badge.id, awardeeName: badge.awardeeName });
  // Emails go out only once the badge is safely saved; a rolled-back issue sends nothing.
  afterMutationCommit(() => queueBadgeAwardedEmail(loadSiteConfig, badge));
}

/**
 * Issues several badges with one read and one write of the badge registry.
 * Rows that fail validation are reported individually and do not stop the batch.
 */
function issueBadgeBatch(formDataList) {
  const badges = loadBadges();
  const ctx = {
    badges,
    templates: loadBadgeTemplates(),
    siteConfig: loadSiteConfig(),
    certificateTemplate: loadCertificateTemplate(),
    reservedIds: loadDeletedBadges().map((entry) => entry && entry.id)
  };
  const results = formDataList.map((formData) => {
    try {
      const badge = createBadgeRecord(formData, ctx);
      badges.push(badge);
      return { badge };
    } catch (error) {
      return { error: error.message || String(error) };
    }
  });
  const issued = results.filter((result) => result.badge).map((result) => result.badge);
  if (issued.length) {
    saveBadges(badges);
    issued.forEach(recordIssuedBadge);
    scheduleAnalyticsSummaryRefresh();
  }
  return { badges: issued, results };
}

function handleIssueBadge(formData) {
  const outcome = issueBadgeBatch([formData]);
  const [result] = outcome.results;
  if (!result || !result.badge) {
    throw new Error((result && result.error) || 'The badge could not be issued.');
  }
  return result.badge;
}

// The home page, registry data, and sitemap all depend on the full badge list.
// Rebuild them at most once every few seconds, no matter how many badges are issued.
const BADGE_INDEX_THROTTLE_MS = 3000;
let lastBadgeIndexPublish = 0;
let badgeIndexTimer = null;

function runPublishBadgeIndexes() {
  lastBadgeIndexPublish = Date.now();
  try {
    publishBadgeIndexes();
  } catch (error) {
    appendAppErrorLog({
      severity: 'warning',
      source: 'publish_badge_indexes',
      message: error.message || String(error),
      stack: error.stack || ''
    });
  }
}

function schedulePublishBadgeIndexes() {
  const wait = BADGE_INDEX_THROTTLE_MS - (Date.now() - lastBadgeIndexPublish);
  if (wait <= 0 && !badgeIndexTimer) {
    runPublishBadgeIndexes();
    return;
  }
  if (!badgeIndexTimer) {
    badgeIndexTimer = setTimeout(() => {
      badgeIndexTimer = null;
      runPublishBadgeIndexes();
    }, Math.max(wait, 50));
  }
}

const ANALYTICS_SUMMARY_DELAY_MS = 30 * 1000;
const ANALYTICS_PUSH_DEBOUNCE_MS = 60 * 1000;
let analyticsSummaryTimer = null;

function scheduleAnalyticsSummaryRefresh() {
  if (analyticsSummaryTimer) {
    return;
  }
  analyticsSummaryTimer = setTimeout(() => {
    analyticsSummaryTimer = null;
    runWhenMutationIdle(() => {
      try {
        if (isAnalyticsSummaryStale()) {
          refreshAnalyticsSummary();
        }
      } catch (error) {
        console.warn(`Analytics summary refresh failed: ${error.message}`);
      }
      queuePushLocalData('Update analytics', { debounceMs: ANALYTICS_PUSH_DEBOUNCE_MS }).catch(() => {});
    });
  }, ANALYTICS_SUMMARY_DELAY_MS);
  analyticsSummaryTimer.unref();
}

// Automatic snapshots (after issuing, editing, deleting) are coalesced so that a busy
// hour produces one snapshot instead of hundreds. Manual and restore snapshots are
// still taken immediately.
const BACKGROUND_SNAPSHOT_INTERVAL_MS = 60 * 60 * 1000;
let lastBackgroundSnapshotAt = 0;
let backgroundSnapshotTimer = null;
const pendingSnapshotReasons = [];

function scheduleBackgroundSnapshot(reason, actor = 'admin') {
  pendingSnapshotReasons.push(String(reason || 'Automatic snapshot'));
  if (backgroundSnapshotTimer) {
    return;
  }
  const wait = Math.max(0, lastBackgroundSnapshotAt + BACKGROUND_SNAPSHOT_INTERVAL_MS - Date.now());
  backgroundSnapshotTimer = setTimeout(() => {
    backgroundSnapshotTimer = null;
    const reasons = pendingSnapshotReasons.splice(0);
    if (!reasons.length) {
      return;
    }
    lastBackgroundSnapshotAt = Date.now();
    const combined = reasons.length === 1 ? reasons[0] : `${reasons[reasons.length - 1]} (+${reasons.length - 1} earlier changes)`;
    persistMutation('Automatic backup snapshot', () => createBackupSnapshot(combined, actor), null, { debounceMs: 30000 }).catch((err) => {
      appendAppErrorLog({
        severity: 'warning',
        source: 'backup_snapshot_async',
        message: err.message || String(err),
        stack: err.stack || '',
        context: combined
      });
    });
  }, Math.max(wait, 1000));
  backgroundSnapshotTimer.unref();
}

function hasInlineUploadedAssets(formData) {
  const a = String((formData && formData.badgeImageUploadDataUrl) || '').trim();
  const b = String((formData && formData.certificateBackgroundUploadDataUrl) || '').trim();
  return (a && a.startsWith('data:')) || (b && b.startsWith('data:'));
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
    emailAwardTemplateId: cleanText(formData.emailAwardTemplateId),
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
  appendAuditLog({ action: 'template.save', actor: 'admin', templateId: id });
  return template;
}

function deleteTemplate(templateId) {
  const templates = loadBadgeTemplates().filter((entry) => entry.id !== templateId);
  saveBadgeTemplates(templates);
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
  appendAuditLog({ action: 'badge.delete', actor: 'admin', badgeId });
  return deletedBadge || null;
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
  const previous = loadSiteConfig();
  const siteConfig = {
    ...previous,
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

const EMAIL_TEMPLATE_MAX = 120000;

function parseEmailAwardTemplatesFromForm(formData, previous) {
  const raw = String(formData.emailAwardTemplatesJson || '').trim();
  const fallbackToPrev = () => {
    const prev = Array.isArray(previous.emailAwardTemplates) ? previous.emailAwardTemplates : [];
    if (prev.length) {
      return prev.map((e) => normalizeEmailAwardTemplateEntry(e));
    }
    const seed = createDefaultEmailAwardTemplates();
    return seed.templates.map((e) => normalizeEmailAwardTemplateEntry(e));
  };
  if (!raw) {
    return fallbackToPrev();
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Email templates: invalid JSON (${e.message}).`);
  }
  if (!Array.isArray(parsed) || !parsed.length) {
    return fallbackToPrev();
  }
  return parsed.map((e) => normalizeEmailAwardTemplateEntry(e));
}

// Validates email settings (including the network check against Brevo) without holding
// the mutation lock; applyEmailSettings then saves the result inside a mutation.
async function prepareEmailSettings(formData) {
  const previous = loadSiteConfig();
  const saveMode = cleanText(formData.saveMode) === 'templates_only' ? 'templates_only' : 'full';
  const templatesOnly = saveMode === 'templates_only';
  const clearKey = parseBooleanInput(formData.emailBrevoClearApiKey);
  const apiKeyInput = String(formData.emailBrevoApiKey || '').trim();
  let emailBrevoApiKey = String(previous.emailBrevoApiKey || '').trim();
  if (clearKey) {
    emailBrevoApiKey = '';
  } else if (apiKeyInput) {
    emailBrevoApiKey = apiKeyInput;
  }
  const transport = cleanText(formData.emailBrevoTransport) === 'smtp' ? 'smtp' : 'api';
  const emailAwardTemplates = parseEmailAwardTemplatesFromForm(formData, previous);
  let emailAwardDefaultTemplateId = cleanText(formData.emailAwardDefaultTemplateId) || '';
  if (!emailAwardDefaultTemplateId || !emailAwardTemplates.some((t) => t.id === emailAwardDefaultTemplateId)) {
    emailAwardDefaultTemplateId = emailAwardTemplates[0].id;
  }
  const siteConfig = {
    ...previous,
    emailBrevoEnabled: parseBooleanInput(formData.emailBrevoEnabled),
    emailBrevoApiKey,
    emailBrevoSenderEmail: normalizeEmail(formData.emailBrevoSenderEmail),
    emailBrevoSenderName: cleanText(formData.emailBrevoSenderName) || 'CSUN Career Center',
    emailBrevoReplyTo: normalizeEmail(formData.emailBrevoReplyTo),
    emailBrevoTransport: transport,
    emailAwardTemplates,
    emailAwardDefaultTemplateId
  };
  if (!templatesOnly && siteConfig.emailBrevoEnabled) {
    if (transport === 'smtp') {
      if (!hasSmtpCredentialsConfigured()) {
        throw new Error(
          'SMTP relay: set BREVO_SMTP_LOGIN and BREVO_SMTP_PASSWORD on the server (Brevo → SMTP & API → SMTP — use the SMTP key, not the REST API key).'
        );
      }
    } else if (!getBrevoApiKey(siteConfig)) {
      throw new Error('REST API: set a Brevo API key here or as BREVO_API_KEY on the server.');
    }
    if (!isValidEmail(siteConfig.emailBrevoSenderEmail)) {
      throw new Error('Sender email must be a valid address (and verified as a sender in Brevo).');
    }
    if (siteConfig.emailBrevoReplyTo && !isValidEmail(siteConfig.emailBrevoReplyTo)) {
      throw new Error('Reply-to must be a valid email address when provided.');
    }
  }
  if (!templatesOnly && transport === 'api' && getBrevoApiKey(siteConfig)) {
    try {
      await verifyBrevoRestApiKey(getBrevoApiKey(siteConfig));
    } catch (err) {
      const hint =
        'Create a new **v3 API key** in Brevo under **SMTP & API** → **API keys** (not the SMTP password). On Render: **Environment** → add or update **BREVO_API_KEY** with that exact key, then **Manual Deploy** so the service restarts. Legacy env name **SENDINBLUE_API_KEY** is also supported if **BREVO_API_KEY** is unset.';
      throw new Error(`Brevo rejected this REST API key (${err.message || String(err)}). ${hint}`);
    }
  }
  return { siteConfig, templatesOnly };
}

const EMAIL_SETTING_KEYS = [
  'emailBrevoEnabled',
  'emailBrevoApiKey',
  'emailBrevoSenderEmail',
  'emailBrevoSenderName',
  'emailBrevoReplyTo',
  'emailBrevoTransport',
  'emailAwardTemplates',
  'emailAwardDefaultTemplateId'
];

function applyEmailSettings(prepared) {
  const current = loadSiteConfig();
  const next = { ...current };
  for (const key of EMAIL_SETTING_KEYS) {
    next[key] = prepared.siteConfig[key];
  }
  saveSiteConfig(next);
  createBackupSnapshot('Saved Brevo email settings', 'admin');
  appendAuditLog({
    action: prepared.templatesOnly ? 'email.templates.save' : 'email.settings.save',
    actor: 'admin'
  });
}

function rebuildPublicSiteInBackground() {
  buildPublicSite({ badgePages: 'background' });
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

function parseAnalyticsFilters(urlObject) {
  return {
    year: cleanText(urlObject.searchParams.get('year')),
    month: cleanText(urlObject.searchParams.get('month')),
    badgeType: cleanText(urlObject.searchParams.get('badgeType'))
  };
}

function* iterateFilteredAnalyticsEvents(filters) {
  for (const event of iterateNdjson(PATHS.analyticsEventsFile)) {
    if (eventMatchesAnalyticsFilter(event, filters)) {
      yield event;
    }
  }
}

// Writes a (possibly very large) download piece by piece, honouring backpressure, so the
// whole file never has to exist as one string in memory.
async function streamToResponse(response, headers, pieces) {
  response.writeHead(200, { 'Cache-Control': 'no-store', ...headers });
  let batch = '';
  const writeBatch = async () => {
    if (!batch) {
      return;
    }
    const text = batch;
    batch = '';
    if (!response.write(text)) {
      await new Promise((resolve) => {
        response.once('drain', resolve);
        response.once('close', resolve);
      });
    }
  };
  try {
    for (const piece of pieces) {
      if (response.destroyed) {
        return;
      }
      batch += piece;
      if (batch.length >= 256 * 1024) {
        await writeBatch();
      }
    }
    await writeBatch();
    response.end();
  } catch (error) {
    console.error(`Download failed: ${error.message}`);
    response.destroy(error);
  }
}

// The Backups page inlines the full backup JSON. That stays as-is for small registries,
// but past a few megabytes rendering it would use hundreds of MB, so the page links to
// the streamed download instead.
const BACKUP_PREVIEW_MAX_BYTES = 3 * 1024 * 1024;

function loadBackupPreview() {
  flushAppState();
  const size = fs.statSync(PATHS.appStateFile, { throwIfNoEntry: false });
  if (size && size.size > BACKUP_PREVIEW_MAX_BYTES) {
    return { appState: null, previewTooLargeBytes: size.size };
  }
  const appState = loadAppState();
  const siteConfig = { ...(appState.siteConfig || {}) };
  delete siteConfig.emailBrevoApiKey;
  return { appState: { ...appState, siteConfig } };
}

// Same shape as the previous full export ({ appState: { ..., analyticsEvents } }), but
// generated incrementally. The Brevo API key is left out like in every other backup.
function* generateAppStateExport() {
  const state = loadAppState();
  const siteConfig = { ...(state.siteConfig || {}) };
  delete siteConfig.emailBrevoApiKey;
  state.siteConfig = siteConfig;
  yield '{"appState":{';
  let firstKey = true;
  for (const [key, value] of Object.entries(state)) {
    if (value === undefined) {
      continue;
    }
    yield `${firstKey ? '' : ','}${JSON.stringify(key)}:`;
    firstKey = false;
    if (Array.isArray(value)) {
      yield '[';
      for (let index = 0; index < value.length; index += 1) {
        yield `${index ? ',' : ''}${JSON.stringify(value[index]) ?? 'null'}`;
      }
      yield ']';
    } else {
      yield JSON.stringify(value);
    }
  }
  yield `${firstKey ? '' : ','}"analyticsEvents":[`;
  let firstEvent = true;
  for (const event of iterateNdjson(PATHS.analyticsEventsFile)) {
    yield `${firstEvent ? '' : ','}${JSON.stringify(event)}`;
    firstEvent = false;
  }
  yield ']}}\n';
}

function collectRecentAnalyticsEvents(filters, limit) {
  const byNewest = (left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || ''));
  let recent = [];
  for (const event of iterateFilteredAnalyticsEvents(filters)) {
    recent.push(event);
    if (recent.length > limit * 8) {
      recent = recent.sort(byNewest).slice(0, limit);
    }
  }
  return recent.sort(byNewest).slice(0, limit);
}

function buildAnalyticsViewModel(urlObject) {
  const templates = loadBadgeTemplates();
  const filters = parseAnalyticsFilters(urlObject);
  const hasFilters = Boolean(filters.year || filters.month || filters.badgeType);
  const summary = hasFilters
    ? buildAnalyticsSummary({
        badges: loadBadgesReadOnly().filter((badge) => badgeMatchesAnalyticsFilter(badge, filters)),
        templates,
        events: iterateFilteredAnalyticsEvents(filters)
      })
    : ensureAnalyticsSummaryFresh();
  const recentEvents = collectRecentAnalyticsEvents(filters, 30);
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

// Analytics are best-effort: the event is appended once no mutation is running, the
// summary is rebuilt later in one pass, and GitHub sync is batched.
function trackAnalyticsEvent(eventInput) {
  runWhenMutationIdle(() => {
    try {
      appendAnalyticsEvent(eventInput);
      scheduleAnalyticsSummaryRefresh();
    } catch (error) {
      console.warn(`Analytics event could not be recorded: ${error.message}`);
    }
  });
}

function restoreBadgesCsv(csvText) {
  const importedBadges = importBadgesFromCsv(csvText);
  saveBadges(importedBadges);
  createBackupSnapshot('Restored issued badges from CSV', 'admin');
  appendAuditLog({ action: 'badges.restore_csv', actor: 'admin', count: importedBadges.length });
}

function renderDashboardPage(urlObject) {
  const siteConfig = loadSiteConfig();
  const filteredBadges = filterBadges(loadBadgesReadOnly(), urlObject.searchParams.get('q') || '').map((badge) => ({
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

function sendJson(response, statusCode, payload, headers = {}) {
  sendText(response, JSON.stringify(payload), statusCode, 'application/json; charset=utf-8', headers);
}

function sendRateLimited(response, retryAfterSec) {
  sendJson(
    response,
    429,
    { ok: false, error: 'Too many requests. Please wait a moment and try again.' },
    { 'Retry-After': String(retryAfterSec) }
  );
}

const PUBLIC_ISSUE_FIELD_LIMITS = {
  awardeeName: 120,
  awardeeEmail: 254,
  issueDate: 40,
  badgeTemplateId: 120,
  pageKind: 20,
  generatorLabel: 160
};

// The public generator may only choose a template and supply the recipient's details.
// Everything else (badge text, images, issuer) always comes from the template.
function pickPublicIssueFields(formData) {
  const picked = {};
  for (const [key, maxLength] of Object.entries(PUBLIC_ISSUE_FIELD_LIMITS)) {
    const value = cleanText(formData && formData[key]);
    if (value.length > maxLength) {
      throw new Error(`The ${key} field is too long.`);
    }
    picked[key] = value;
  }
  if (!picked.badgeTemplateId) {
    throw new Error('Choose a badge before generating it.');
  }
  return picked;
}

async function handlePublicApiRequest(request, response, urlObject) {
  if (request.method === 'POST' && urlObject.pathname === '/api/public/badges-by-email') {
    const retryAfter = badgeLookupLimiter.take(getClientIp(request));
    if (retryAfter) {
      sendRateLimited(response, retryAfter);
      return true;
    }
    try {
      const formData = await parseBody(request, { limit: PUBLIC_BODY_LIMIT_BYTES });
      const email = normalizeEmail(formData.email);
      if (!isValidEmail(email)) {
        sendText(response, JSON.stringify({ ok: false, error: 'Enter a valid email address.' }), 400, 'application/json; charset=utf-8');
        return true;
      }
      const matches = sortBadgesDescending(loadBadgesReadOnly())
        .filter((badge) => normalizeEmail(badge.awardeeEmail) === email)
        .map((badge) => sanitizeBadgeResponse(badge));
      sendText(response, JSON.stringify({ ok: true, matches }), 200, 'application/json; charset=utf-8');
    } catch (error) {
      sendJson(response, error.statusCode === 413 ? 413 : 400, { ok: false, error: error.message });
    }
    return true;
  }

  if (request.method === 'POST' && urlObject.pathname === '/api/public/issue') {
    const retryAfter = publicIssueLimiter.take(getClientIp(request));
    if (retryAfter) {
      sendRateLimited(response, retryAfter);
      return true;
    }
    try {
      const formData = pickPublicIssueFields(await parseBody(request, { limit: PUBLIC_BODY_LIMIT_BYTES }));
      let issuedBadgeRef = null;
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
        issuedBadgeRef = issuedBadge;
        return issuedBadge;
      }, () => {
        if (issuedBadgeRef) {
          publishBadgeArtifacts(issuedBadgeRef);
          schedulePublishBadgeIndexes();
        }
      }, { debounceMs: 3000 });
      scheduleBackgroundSnapshot(`Issued badge ${badge.id}`);
      const browserUrl = buildBrowserBadgeUrl(badge);
      sendText(response, JSON.stringify({ ok: true, badge: sanitizeBadgeResponse({ ...badge, publicUrl: browserUrl }) }), 201, 'application/json; charset=utf-8');
    } catch (error) {
      sendJson(response, error.statusCode === 413 ? 413 : 400, { ok: false, error: error.message });
    }
    return true;
  }

  if (request.method === 'POST' && urlObject.pathname === '/api/analytics/track') {
    const retryAfter = analyticsTrackLimiter.take(getClientIp(request));
    if (retryAfter) {
      sendRateLimited(response, retryAfter);
      return true;
    }
    try {
      const formData = await parseBody(request, { limit: 16 * 1024 });
      const type = cleanText(formData.type);
      const allowed = new Set(['badge_viewed', 'certificate_downloaded', 'generator_opened']);
      if (!allowed.has(type)) {
        sendText(response, JSON.stringify({ ok: false, error: 'Unsupported analytics event.' }), 400, 'application/json; charset=utf-8');
        return true;
      }
      const field = (value, max = 300) => cleanText(value).slice(0, max);
      trackAnalyticsEvent({
        type,
        timestamp: new Date().toISOString(),
        badgeId: field(formData.badgeId, 80),
        badgeSlug: field(formData.badgeSlug, 200),
        badgeTitle: field(formData.badgeTitle),
        badgeTemplateId: field(formData.badgeTemplateId, 120),
        awardeeName: field(formData.awardeeName, 160),
        awardeeEmail: normalizeEmail(formData.awardeeEmail).slice(0, 254),
        publicUrl: field(formData.publicUrl, 500),
        generatorKey: buildGeneratorKey(field(formData.badgeTemplateId, 120), field(formData.pageKind, 20) || 'general'),
        generatorLabel: field(formData.generatorLabel, 160),
        pageKind: field(formData.pageKind, 20),
        source: field(formData.source, 60) || 'public-site',
        requestPath: urlObject.pathname,
        visitorId: createVisitorId(request, getClientIp(request)),
        context: field(formData.context, 120)
      });
      sendText(response, JSON.stringify({ ok: true }), 202, 'application/json; charset=utf-8');
    } catch (error) {
      sendJson(response, error.statusCode === 413 ? 413 : 400, { ok: false, error: error.message });
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
    const ip = getClientIp(request);
    const limit = getRateLimitState(ip);
    if (limit.locked) {
      const minutes = Math.ceil(limit.retryAfterSec / 60);
      response.writeHead(429, {
        'Content-Type': 'text/html; charset=utf-8',
        'Retry-After': String(limit.retryAfterSec)
      });
      response.end(
        renderLoginPage(`Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`)
      );
      return;
    }
    const formData = await parseBody(request);
    const password = cleanText(formData.password);
    if (password && safeEquals(password, ADMIN_PASSWORD)) {
      clearLoginFailures(ip);
      const sessionId = createSession();
      redirect(response, '/admin', {
        'Set-Cookie': buildSessionCookie('badge_admin_session', sessionId, { sameSite: 'Strict' })
      });
      return;
    }
    recordLoginFailure(ip);
    try {
      appendAuditLog({ action: 'auth.fail', actor: 'anonymous', path: urlObject.pathname, ip });
    } catch {}
    sendHtml(response, renderLoginPage('Incorrect password.'), 401);
    return;
  }

  if (request.method === 'POST' && urlObject.pathname === '/admin/logout') {
    clearSession(request);
    redirect(response, '/admin/login', {
      'Set-Cookie': buildClearedCookie('badge_admin_session', { sameSite: 'Strict' })
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
      let issuedBadgeRef = null;
      const syncPush = hasInlineUploadedAssets(formData);
      const badge = await persistMutation(
        'Issue badge from admin dashboard',
        () => {
          issuedBadgeRef = handleIssueBadge(formData);
          return issuedBadgeRef;
        },
        () => {
          if (issuedBadgeRef) {
            publishBadgeArtifacts(issuedBadgeRef);
            schedulePublishBadgeIndexes();
          }
        },
        { syncPush }
      );
      scheduleBackgroundSnapshot(`Issued badge ${badge.id}`);
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
      const job = loadBulkIssueJobs().find((entry) => entry.id === jobId);
      if (!job) {
        redirect(response, buildNoticeUrl('/admin/bulk-issue', 'Bulk issue job not found.'));
        return;
      }
      if (job.status === 'processing') {
        redirect(response, `/admin/bulk-issue/progress?job=${encodeURIComponent(job.id)}`);
        return;
      }
      if (!Array.isArray(job.rows) || !job.rows.length) {
        redirect(response, buildNoticeUrl('/admin/bulk-issue/validate', 'Bulk issue job has no rows to process.') + `&job=${encodeURIComponent(jobId)}`);
        return;
      }
      if (job.rows.some((row) => Array.isArray(row.errors) && row.errors.length)) {
        redirect(response, buildNoticeUrl('/admin/bulk-issue/validate', 'Resolve validation errors before issuing badges.') + `&job=${encodeURIComponent(jobId)}`);
        return;
      }
      if (runningBulkJobs.has(jobId)) {
        redirect(response, `/admin/bulk-issue/progress?job=${encodeURIComponent(job.id)}`);
        return;
      }
      // Mark the job as processing before redirecting so a double-click cannot start it twice.
      await persistMutation(`Start bulk issue job ${jobId}`, () => markBulkJobStarted(jobId));
      startBulkIssueJobInBackground(jobId);
      redirect(response, `/admin/bulk-issue/progress?job=${encodeURIComponent(job.id)}`);
    } catch (error) {
      redirect(response, `${buildNoticeUrl('/admin/bulk-issue/validate', error.message)}&job=${encodeURIComponent(jobId)}`);
    }
    return;
  }

  if (request.method === 'GET' && urlObject.pathname === '/admin/bulk-issue/progress') {
    const jobId = cleanText(urlObject.searchParams.get('job'));
    const job = loadBulkIssueJobs().find((entry) => entry.id === jobId);
    if (!job) {
      redirect(response, buildNoticeUrl('/admin/bulk-issue', 'Bulk issue job not found.'));
      return;
    }
    if (job.status === 'completed' || job.status === 'completed_with_errors') {
      redirect(response, `/admin/bulk-issue/success?job=${encodeURIComponent(job.id)}`);
      return;
    }
    if (job.status === 'failed') {
      redirect(response, buildNoticeUrl('/admin/bulk-issue/validate', 'Bulk issue job failed. Review and try again.') + `&job=${encodeURIComponent(job.id)}`);
      return;
    }
    sendHtml(response, renderBulkIssueProgressPage({ job, notice: queryNotice(urlObject) }));
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
    let formData = null;
    try {
      formData = await parseBody(request);
      let savedTemplate = null;
      const syncPush = hasInlineUploadedAssets(formData);
      await persistMutation(
        'Save badge template',
        () => {
          savedTemplate = saveTemplate(formData);
          return savedTemplate;
        },
        () => {
          publishTemplateAssets();
          if (savedTemplate && savedTemplate.id) {
            publishBadgesForTemplate(savedTemplate.id, { background: true });
          }
        },
        { syncPush }
      );
      if (savedTemplate && savedTemplate.id) {
        scheduleBackgroundSnapshot(`Saved template ${savedTemplate.id}`);
      }
      redirect(
        response,
        `/admin/templates?edit=${encodeURIComponent(savedTemplate.id)}&notice=${encodeURIComponent('Template saved and public files refreshed.')}`
      );
    } catch (error) {
      const templates = loadBadgeTemplates();
      const editId = formData ? slugify(formData.id) : '';
      const editTemplate = editId ? templates.find((entry) => entry.id === editId) || null : null;
      sendHtml(
        response,
        renderTemplatesPage({
          templates,
          editTemplate,
          notice: error.message,
          siteConfig: loadSiteConfig(),
          certificateTemplate: loadCertificateTemplate()
        }),
        400
      );
    }
    return;
  }

  if (request.method === 'POST' && urlObject.pathname === '/admin/templates/delete') {
    const formData = await parseBody(request);
    const targetId = cleanText(formData.templateId);
    await persistMutation(
      'Delete badge template',
      () => deleteTemplate(targetId),
      () => {
        removeGeneratorAndWidgetForTemplate(targetId);
        publishTemplateAssets();
      }
    );
    if (targetId) {
      scheduleBackgroundSnapshot(`Deleted template ${targetId}`);
    }
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

  if (request.method === 'GET' && urlObject.pathname === '/admin/email') {
    const brevoEnv = getBrevoHostEnvDiagnostics();
    sendHtml(
      response,
      renderEmailPage({
        siteConfig: loadSiteConfig(),
        envBrevoKeyConfigured: Boolean(brevoEnv.hostKeyActive),
        brevoEnv,
        envSmtpConfigured: hasSmtpCredentialsConfigured(),
        notice: queryNotice(urlObject)
      })
    );
    return;
  }

  if (request.method === 'POST' && urlObject.pathname === '/admin/email/sync-body') {
    try {
      const payload = await parseBody(request);
      const mode = cleanText(payload.mode);
      const text = String(payload.text ?? '');
      let out = '';
      if (mode === 'plainToHtml') {
        out = wrapEmailHtmlDocument(plainBodyToHtmlFragment(text));
      } else if (mode === 'htmlToPlain') {
        out = htmlFragmentToPlainBody(text);
      } else {
        throw new Error('mode must be plainToHtml or htmlToPlain');
      }
      sendText(response, JSON.stringify({ ok: true, text: out }), 200, 'application/json; charset=utf-8');
    } catch (error) {
      sendText(
        response,
        JSON.stringify({ ok: false, error: error.message || String(error) }),
        400,
        'application/json; charset=utf-8'
      );
    }
    return;
  }

  if (request.method === 'GET' && urlObject.pathname === '/admin/email-log') {
    sendHtml(
      response,
      renderEmailLogPage({
        entries: loadEmailLogEntries(200),
        notice: queryNotice(urlObject)
      })
    );
    return;
  }

  if (request.method === 'GET' && urlObject.pathname === '/admin/debug-log') {
    sendHtml(
      response,
      renderDebugLogPage({
        entries: loadAppErrorLogEntries(250),
        notice: queryNotice(urlObject)
      })
    );
    return;
  }

  if (request.method === 'GET' && urlObject.pathname === '/admin/jobs') {
    if (!requireAuth(request, response)) {
      return;
    }
    sendHtml(
      response,
      renderJobsPage({
        syncStatus: getSyncStatus(),
        bulkJobs: loadBulkIssueJobs(),
        notice: queryNotice(urlObject)
      })
    );
    return;
  }

  if (request.method === 'POST' && urlObject.pathname === '/admin/jobs/sync') {
    if (!requireAuth(request, response)) {
      return;
    }
    try {
      const formData = await parseBody(request);
      const scope = cleanText(formData.scope) || 'all';
      // Pushes only send files that changed, so every scope syncs everything that is out of date.
      const reason = `Force sync (${scope}) from admin`;
      const result = await queuePushLocalData(reason);
      if (result && result.ok) {
        const detail = result.unchanged ? 'GitHub was already up to date' : `Commit ${result.commitSha || ''}`;
        redirect(response, buildNoticeUrl('/admin/jobs', `Sync complete (${scope}). ${detail}`));
        return;
      }
      redirect(response, buildNoticeUrl('/admin/jobs', `Sync skipped (${scope}): ${(result && result.reason) || 'unknown'}`));
    } catch (error) {
      redirect(response, buildNoticeUrl('/admin/jobs', `Sync failed: ${error.message || String(error)}`));
    }
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
        ...loadBackupPreview(),
        notice: queryNotice(urlObject)
      })
    );
    return;
  }

  if (request.method === 'POST' && urlObject.pathname === '/admin/settings/save') {
    try {
      const formData = await parseBody(request);
      await persistMutation('Save badge system settings', () => saveSettings(formData), rebuildPublicSiteInBackground);
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

  if (request.method === 'POST' && urlObject.pathname === '/admin/email/save') {
    try {
      const formData = await parseBody(request);
      const prepared = await prepareEmailSettings(formData);
      await persistMutation('Save Brevo email settings', () => applyEmailSettings(prepared));
      const templatesOnly = cleanText(formData.saveMode) === 'templates_only';
      redirect(
        response,
        buildNoticeUrl(
          '/admin/email',
          templatesOnly
            ? 'Email templates saved. Brevo credentials were not re-validated.'
            : 'Email settings saved.'
        )
      );
    } catch (error) {
      sendHtml(
        response,
        renderEmailPage({
          siteConfig: loadSiteConfig(),
          envBrevoKeyConfigured: Boolean(getBrevoHostEnvDiagnostics().hostKeyActive),
          brevoEnv: getBrevoHostEnvDiagnostics(),
          envSmtpConfigured: hasSmtpCredentialsConfigured(),
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
    });
    redirect(response, buildNoticeUrl('/admin/backups', 'Snapshot created and synced.'));
    return;
  }

  if (request.method === 'POST' && urlObject.pathname === '/admin/backups/restore-json') {
    try {
      const formData = await parseBody(request);
      await persistMutation(
        'Restore full app state from backup JSON',
        () => restoreFullBackup(formData.jsonBackupContent),
        rebuildPublicSiteInBackground,
        { syncPush: true }
      );
      redirect(response, buildNoticeUrl('/admin/backups', 'Full system backup restored.'));
    } catch (error) {
      sendHtml(response, renderBackupsPage({ backups: getRecentBackups(50), ...loadBackupPreview(), notice: error.message }), 400);
    }
    return;
  }

  if (request.method === 'POST' && urlObject.pathname === '/admin/backups/restore-csv') {
    try {
      const formData = await parseBody(request);
      await persistMutation(
        'Restore issued badges from CSV',
        () => restoreBadgesCsv(formData.csvBackupContent),
        rebuildPublicSiteInBackground,
        { syncPush: true }
      );
      redirect(response, buildNoticeUrl('/admin/backups', 'Issued badges restored from CSV.'));
    } catch (error) {
      sendHtml(response, renderBackupsPage({ backups: getRecentBackups(50), ...loadBackupPreview(), notice: error.message }), 400);
    }
    return;
  }

  if (request.method === 'GET' && urlObject.pathname === '/admin/export/app-state') {
    await streamToResponse(response, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="csun-ebadges-app-state-backup.json"'
    }, generateAppStateExport());
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
    const filters = parseAnalyticsFilters(urlObject);
    await streamToResponse(response, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="badge-analytics.csv"'
    }, (function* analyticsCsvLines() {
      yield `${ANALYTICS_CSV_HEADER}\n`;
      for (const event of iterateFilteredAnalyticsEvents(filters)) {
        yield `${analyticsCsvRow(event)}\n`;
      }
    })());
    return;
  }

  if (request.method === 'POST' && urlObject.pathname === '/admin/badges/delete') {
    const formData = await parseBody(request);
    const targetId = cleanText(formData.badgeId);
    let removedBadge = null;
    await persistMutation(
      'Delete issued badge',
      () => {
        removedBadge = deleteBadge(targetId);
        return removedBadge;
      },
      () => {
        if (removedBadge && removedBadge.slug) {
          unpublishBadgeArtifacts(removedBadge.slug);
        }
        schedulePublishBadgeIndexes();
      }
    );
    if (removedBadge) {
      scheduleBackgroundSnapshot(`Deleted badge ${removedBadge.id || targetId}`);
    }
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
      const ip = getClientIp(request);
      const limit = getRateLimitState(ip);
      const formData = await parseBody(request, { limit: PUBLIC_BODY_LIMIT_BYTES });
      const nextPath = getSafeNextPath(formData.next);
      if (limit.locked) {
        const minutes = Math.ceil(limit.retryAfterSec / 60);
        response.writeHead(429, {
          'Content-Type': 'text/html; charset=utf-8',
          'Retry-After': String(limit.retryAfterSec)
        });
        response.end(
          renderPublicAccessPage(
            nextPath,
            `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
          )
        );
        return;
      }
      const password = cleanText(formData.password);
      if (password && safeEquals(password, PUBLIC_PASSWORD)) {
        clearLoginFailures(ip);
        const sessionId = createSession(publicSessions);
        redirect(response, nextPath, {
          'Set-Cookie': buildSessionCookie('badge_public_session', sessionId, { sameSite: 'Lax' })
        });
        return;
      }
      recordLoginFailure(ip);
      try {
        appendAuditLog({ action: 'auth.fail', actor: 'anonymous', path: urlObject.pathname, ip });
      } catch {}
      sendHtml(response, renderPublicAccessPage(nextPath, 'Incorrect password.'), 401);
      return;
    }

    if (await handlePublicApiRequest(request, response, urlObject)) {
      return;
    }

    if (urlObject.pathname.startsWith('/admin-static/')) {
      const requestPath = urlObject.pathname.replace('/admin-static', '');
      if (await serveStatic(PATHS.adminDir, requestPath, response, request)) {
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

    const badgeMatch = urlObject.pathname.match(/^\/badges\/([^/]+)(\/|$)/);
    if (badgeMatch) {
      // Badge folders are regenerated in the background after startup; build one now if
      // a visitor arrives before the background pass reaches it.
      let slug = '';
      try {
        slug = decodeURIComponent(badgeMatch[1]);
      } catch {}
      if (slug) {
        ensureBadgeArtifacts(slug);
      }
    }

    if (await serveStatic(PATHS.docsDir, urlObject.pathname, response, request)) {
      return;
    }
    if (await tryServeUploadFromGithub(PATHS.docsDir, urlObject.pathname, response)) {
      return;
    }

    sendNotFoundPage(response);
  } catch (error) {
    logHttpRequestError(request, urlObject, error);
    if (response.headersSent) {
      response.destroy();
      return;
    }
    if (error.statusCode === 413) {
      sendHtml(response, '<!DOCTYPE html><html><body><h1>Upload too large</h1><p>The request was larger than the server accepts.</p></body></html>', 413);
      return;
    }
    const reference = new Date().toISOString();
    sendHtml(
      response,
      `<!DOCTYPE html><html><body><h1>Server error</h1><p>Something went wrong while handling this request. The details were saved to the debug log (reference ${escapeHtml(reference)}).</p><p>${escapeHtml(error.message || '')}</p></body></html>`,
      500
    );
  }
}

let appReady = false;

function renderStartingUpPage() {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="5" />
    <title>Starting up | CSUN Career Center E-Badges</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; background: #f6f7f9; color: #1f2933; }
      main { text-align: center; padding: 2rem; max-width: 32rem; }
      .spinner { width: 2.5rem; height: 2.5rem; margin: 0 auto 1.25rem; border: 4px solid #d8dde3; border-top-color: #d22030; border-radius: 50%; animation: spin 0.9s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
    </style>
  </head>
  <body>
    <main>
      <div class="spinner" aria-hidden="true"></div>
      <h1>The badge system is starting up</h1>
      <p>This usually takes less than a minute. This page will refresh automatically.</p>
    </main>
  </body>
</html>`;
}

function handleRequestWhileStarting(request, response, pathname) {
  if (pathname.startsWith('/api/')) {
    sendJson(response, 503, { ok: false, error: 'The badge system is starting up. Please try again in a few seconds.' }, { 'Retry-After': '5' });
    return;
  }
  response.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '5', 'Cache-Control': 'no-store' });
  response.end(renderStartingUpPage());
}

function mainRequestHandler(request, response) {
  const pathname = String(request.url || '/').split('?')[0];
  if (pathname === '/healthz') {
    sendJson(response, 200, { ok: true, ready: appReady }, { 'Cache-Control': 'no-store' });
    return;
  }
  if (!appReady) {
    handleRequestWhileStarting(request, response, pathname);
    return;
  }
  requestListener(request, response).catch((error) => {
    console.error('Unhandled request error:', error);
    if (!response.headersSent) {
      sendText(response, 'Server error', 500);
    } else {
      response.destroy();
    }
  });
}

let shuttingDown = false;

async function shutdown(server, signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`${signal} received: finishing pending work before exit.`);
  const hardExit = setTimeout(() => process.exit(0), 25000);
  hardExit.unref();
  server.close();
  try {
    await waitForEmailQueue(8000);
    if (appReady && isAnalyticsSummaryStale()) {
      refreshAnalyticsSummary();
    }
    if (appReady) {
      queuePushLocalData(`Save pending changes before restart (${signal})`).catch(() => {});
    }
    const flushed = await flushPendingPushes(15000);
    console.log(flushed ? 'Pending changes synced to GitHub.' : 'Shutdown timed out before every change was synced.');
  } catch (error) {
    console.error(`Shutdown flush failed: ${error.message}`);
  }
  process.exit(0);
}

if (process.argv.includes('--build')) {
  initializeApp({ skipBulkRecovery: true }).then(() => {
    console.log('Public site rebuilt successfully.');
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else {
  // Open the port first so Render's port scan succeeds while data is still loading.
  const server = http.createServer(mainRequestHandler);
  server.headersTimeout = 30000;
  server.requestTimeout = 120000;
  server.keepAliveTimeout = 65000;
  server.listen(PORT, () => {
    console.log(`CSUN Career Center E-Badges listening at http://localhost:${PORT} (loading data...)`);
  });
  process.on('SIGTERM', () => shutdown(server, 'SIGTERM'));
  process.on('SIGINT', () => shutdown(server, 'SIGINT'));
  initializeApp({ backgroundBadgePages: true }).then(() => {
    appReady = true;
    console.log('CSUN Career Center E-Badges is ready.');
    console.log('Admin password-only login is enabled.');
  }).catch((error) => {
    console.error(error);
    appendAppErrorLog({
      severity: 'critical',
      source: 'startup',
      message: error.message || String(error),
      stack: error.stack || ''
    });
    process.exit(1);
  });
}
