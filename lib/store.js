const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { migrateLegacyEmailTemplates, normalizeEmailAwardTemplateEntry } = require('./award-email-shared');
const { selectBackupsToKeep } = require('./backup-retention');

const ROOT = path.resolve(__dirname, '..');
const PATHS = {
  root: ROOT,
  dataDir: path.join(ROOT, 'data'),
  docsDir: path.join(ROOT, 'docs'),
  docsDataDir: path.join(ROOT, 'docs', 'data'),
  docsBadgesDir: path.join(ROOT, 'docs', 'badges'),
  docsAssetsDir: path.join(ROOT, 'docs', 'assets'),
  docsUploadsDir: path.join(ROOT, 'docs', 'assets', 'uploads'),
  docsRegistryDir: path.join(ROOT, 'docs', 'registry'),
  adminDir: path.join(ROOT, 'admin'),
  badgesFile: path.join(ROOT, 'data', 'badges.json'),
  templatesFile: path.join(ROOT, 'data', 'badge-catalog.json'),
  certificateTemplateFile: path.join(ROOT, 'data', 'certificate-template.json'),
  siteConfigFile: path.join(ROOT, 'data', 'site-config.json'),
  badgeLinksCsvFile: path.join(ROOT, 'data', 'badge-links.csv'),
  appStateFile: path.join(ROOT, 'data', 'app-state.json'),
  backupsDir: path.join(ROOT, 'data', 'backups'),
  backupManifestFile: path.join(ROOT, 'data', 'backups', 'manifest.json'),
  deletedBadgesFile: path.join(ROOT, 'data', 'deleted-badges.json'),
  auditLogFile: path.join(ROOT, 'data', 'audit-log.ndjson'),
  analyticsEventsFile: path.join(ROOT, 'data', 'analytics-events.ndjson'),
  analyticsSummaryFile: path.join(ROOT, 'data', 'analytics-summary.json'),
  bulkIssueJobsFile: path.join(ROOT, 'data', 'bulk-issue-jobs.json'),
  emailConfigFile: path.join(ROOT, 'data', 'email-config.json'),
  emailLogFile: path.join(ROOT, 'data', 'email-log.ndjson'),
  appErrorLogFile: path.join(ROOT, 'data', 'app-error-log.ndjson')
};

const DEFAULT_SITE_CONFIG = {
  siteName: 'CSUN Career Center E-Badges',
  organizationName: 'CSUN Career Center',
  heroTitle: 'CSUN Career Center E-Badges',
  heroIntro:
    'Access the protected badge directory, verify official CSUN Career Center credentials, and issue polished e-badges with matching certificates.',
  publicSiteUrl: 'https://YOUR-GITHUB-USERNAME.github.io/YOUR-REPO-NAME',
  defaultCareerCenterUrl: 'https://csun.edu/career',
  supportEmail: 'career.center@csun.edu',
  credentialPrefix: 'CSUNCC',
  footerNote: 'Official credential records are maintained by the CSUN Career Center.',
  emailBrevoEnabled: false,
  emailBrevoApiKey: '',
  emailBrevoSenderEmail: '',
  emailBrevoSenderName: 'CSUN Career Center',
  emailBrevoReplyTo: '',
  emailBrevoTransport: 'api',
  emailAwardTemplates: [],
  emailAwardDefaultTemplateId: 'default'
};

const EMAIL_CONFIG_KEYS = [
  'emailBrevoEnabled',
  'emailBrevoApiKey',
  'emailBrevoSenderEmail',
  'emailBrevoSenderName',
  'emailBrevoReplyTo',
  'emailBrevoTransport',
  'emailAwardTemplates',
  'emailAwardDefaultTemplateId'
];

function pickEmailKeys(source) {
  const out = {};
  if (!source || typeof source !== 'object') {
    return out;
  }
  for (const key of EMAIL_CONFIG_KEYS) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      out[key] = source[key];
    }
  }
  return out;
}

function stripEmailKeys(source) {
  if (!source || typeof source !== 'object') {
    return {};
  }
  const out = { ...source };
  for (const key of EMAIL_CONFIG_KEYS) {
    delete out[key];
  }
  return out;
}

function ensureEmailAwardTemplatesOnMerge(merged) {
  const arr = merged.emailAwardTemplates;
  if (Array.isArray(arr) && arr.length > 0) {
    const cleaned = arr.map((e) => normalizeEmailAwardTemplateEntry(e));
    const defId = String(merged.emailAwardDefaultTemplateId || '').trim();
    const validDefault = cleaned.some((t) => t.id === defId) ? defId : cleaned[0].id;
    return { ...merged, emailAwardTemplates: cleaned, emailAwardDefaultTemplateId: validDefault };
  }
  const mig = migrateLegacyEmailTemplates(merged);
  return {
    ...merged,
    emailAwardTemplates: mig.templates.map((e) => normalizeEmailAwardTemplateEntry(e)),
    emailAwardDefaultTemplateId: mig.defaultTemplateId
  };
}

function mergeSiteConfigFromSources(siteBlob, emailFileBlob) {
  const site = siteBlob && typeof siteBlob === 'object' ? siteBlob : {};
  const emailCfg = emailFileBlob && typeof emailFileBlob === 'object' ? emailFileBlob : {};
  const strippedBase = stripEmailKeys({ ...DEFAULT_SITE_CONFIG, ...site });
  const emailMerged = {
    ...pickEmailKeys(DEFAULT_SITE_CONFIG),
    ...pickEmailKeys(site),
    ...emailCfg
  };
  const merged = {
    ...DEFAULT_SITE_CONFIG,
    ...strippedBase,
    ...emailMerged,
    publicSiteUrl: normalizeUrl(site.publicSiteUrl || DEFAULT_SITE_CONFIG.publicSiteUrl)
  };
  return ensureEmailAwardTemplatesOnMerge(merged);
}

function persistSiteConfigSplit(fullMerged) {
  const siteOnly = stripEmailKeys(fullMerged);
  const emailOnly = { ...pickEmailKeys(DEFAULT_SITE_CONFIG), ...pickEmailKeys(fullMerged) };
  writeJson(PATHS.siteConfigFile, siteOnly);
  writeJson(PATHS.emailConfigFile, emailOnly);
}

function migrateEmailConfigFromSiteFile() {
  if (fileExists(PATHS.emailConfigFile)) {
    return;
  }
  if (!fileExists(PATHS.siteConfigFile)) {
    writeJson(PATHS.emailConfigFile, pickEmailKeys(DEFAULT_SITE_CONFIG));
    return;
  }
  const site = readJson(PATHS.siteConfigFile, {});
  const emailPart = { ...pickEmailKeys(DEFAULT_SITE_CONFIG), ...pickEmailKeys(site) };
  writeJson(PATHS.emailConfigFile, emailPart);
  writeJson(PATHS.siteConfigFile, stripEmailKeys(site));
}

const DEFAULT_CERTIFICATE_TEMPLATE = {
  backgroundImage: 'assets/certificate.png',
  fileNameSuffix: '_Certificate',
  name: {
    x: 2000,
    y: 1400,
    fontSize: 180,
    fontFamily: 'Times New Roman',
    fontWeight: 'bold',
    color: '#000000',
    align: 'center',
    maxWidth: 2400
  },
  date: {
    x: 1150,
    y: 2150,
    fontSize: 48,
    fontFamily: 'Arial',
    fontWeight: 'normal',
    color: '#333333',
    align: 'center',
    maxWidth: 700
  }
};

const DEFAULT_VERIFICATION_SECTIONS = {
  recipient: true,
  meaning: true,
  criteria: true,
  issuerTrust: true,
  evidence: true,
  skills: true,
  pathway: true,
  certificate: true
};

function normalizeVerificationSections(source) {
  const value = source && typeof source === 'object' ? source : {};
  return {
    recipient: value.recipient !== false,
    meaning: value.meaning !== false,
    criteria: value.criteria !== false,
    issuerTrust: value.issuerTrust !== false,
    evidence: value.evidence !== false,
    skills: value.skills !== false,
    pathway: value.pathway !== false,
    certificate: value.certificate !== false
  };
}

const DEFAULT_TEMPLATE_FIELDS = {
  id: '',
  title: '',
  badgeLabel: '',
  description: '',
  publicSummary: '',
  meaning: '',
  criteria: '',
  evidenceLabel: 'Evidence',
  evidencePrompt: '',
  evidenceExampleUrl: '',
  evidenceDescription: '',
  skills: [],
  standards: [],
  pathwayId: '',
  pathwayTitle: '',
  pathwayDescription: '',
  pathwayOrder: 1,
  pathwayItems: [],
  issuerName: 'CSUN Career Center',
  issuerOrganization: 'CSUN Career Center',
  issuerWebsite: 'https://csun.edu',
  careerCenterUrl: 'https://csun.edu/career',
  issuerContactEmail: 'career.center@csun.edu',
  issuerVerificationNote: 'Issued directly by the CSUN Career Center and maintained in the official credential registry.',
  issuerRegistryUrl: '',
  issuerTrustLabel: 'Official issuer',
  badgeImage: 'assets/badges/career-champion-badge.svg',
  certificateBackground: 'assets/certificate.png',
  verificationSections: DEFAULT_VERIFICATION_SECTIONS,
  certificateTemplateOverrideEnabled: false,
  certificateTemplate: DEFAULT_CERTIFICATE_TEMPLATE,
  widgetLayout: 'stacked',
  emailAwardTemplateId: ''
};

const DEFAULT_BADGE_TEMPLATES = [
  {
    ...DEFAULT_TEMPLATE_FIELDS,
    id: 'career-champion',
    title: 'Career Champion',
    badgeLabel: 'Career Champion',
    description:
      'Recognizes students who have demonstrated sustained engagement with career readiness, professional development, and leadership through the CSUN Career Center.',
    publicSummary:
      'Recognizes students who have demonstrated sustained engagement with career readiness, professional development, and leadership through the CSUN Career Center.',
    meaning:
      'The Career Champion badge signifies that the recipient completed an approved CSUN Career Center experience centered on career readiness, professional growth, and active participation in career development programming.',
    criteria:
      'Awarded to participants who successfully completed the qualifying CSUN Career Center program, workshop series, leadership experience, or milestone designated for Career Champion recognition.',
    evidencePrompt: 'Optionally add a portfolio link, project, or proof of completion that supports this credential.',
    evidenceDescription: 'Recipients may attach a portfolio item, project page, or workshop completion artifact as supporting evidence.',
    skills: ['Career readiness', 'Professional development', 'Leadership'],
    standards: ['CSUN Career Center milestones'],
    pathwayId: 'career-readiness',
    pathwayTitle: 'Career Readiness Pathway',
    pathwayDescription: 'A stacked pathway that can build from early engagement to advanced career readiness milestones.',
    pathwayOrder: 1,
    pathwayItems: ['Career Champion', 'Interview Ready', 'Internship Ready', 'Career Ready'],
    issuerContactEmail: 'career.center@csun.edu',
    issuerVerificationNote: 'Issued directly by the CSUN Career Center and maintained in the official credential registry.',
    issuerTrustLabel: 'Official issuer',
    badgeImage: 'assets/badges/career-champion-badge.svg',
    certificateBackground: 'assets/certificate.png'
  }
];

function normalizeCertificateConfig(config, fallback = DEFAULT_CERTIFICATE_TEMPLATE) {
  return {
    ...DEFAULT_CERTIFICATE_TEMPLATE,
    ...(fallback || {}),
    ...(config || {}),
    name: {
      ...DEFAULT_CERTIFICATE_TEMPLATE.name,
      ...(((fallback || {}).name) || {}),
      ...(((config || {}).name) || {})
    },
    date: {
      ...DEFAULT_CERTIFICATE_TEMPLATE.date,
      ...(((fallback || {}).date) || {}),
      ...(((config || {}).date) || {})
    }
  };
}

function parseList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(/\r?\n|,|;/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeBadgeTemplate(template) {
  const source = template || {};
  return {
    ...DEFAULT_TEMPLATE_FIELDS,
    ...source,
    publicSummary: source.publicSummary || source.description || '',
    description: source.description || source.publicSummary || '',
    skills: parseList(source.skills),
    standards: parseList(source.standards),
    pathwayItems: parseList(source.pathwayItems),
    pathwayOrder: Number(source.pathwayOrder || 1) || 1,
    verificationSections: normalizeVerificationSections(source.verificationSections),
    certificateTemplateOverrideEnabled: Boolean(source.certificateTemplateOverrideEnabled),
    certificateTemplate: normalizeCertificateConfig(source.certificateTemplate, DEFAULT_CERTIFICATE_TEMPLATE)
  };
}

const DEFAULT_ANALYTICS_SUMMARY = {
  version: 1,
  updatedAt: '',
  totals: {
    badgesIssued: 0,
    badgeViews: 0,
    certificateDownloads: 0,
    generatorOpens: 0,
    generatorCompletions: 0,
    conversionRate: 0,
    uniqueVisitorsApprox: 0
  },
  months: [],
  years: [],
  badgeTypes: [],
  badgePages: [],
  generatorPages: [],
  recipientStats: []
};

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function fileExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch (error) {
    return false;
  }
}

// Files whose parsed contents are cached in memory between reads.
const CACHEABLE_JSON_FILES = new Set([
  PATHS.badgesFile,
  PATHS.templatesFile,
  PATHS.certificateTemplateFile,
  PATHS.siteConfigFile,
  PATHS.emailConfigFile,
  PATHS.deletedBadgesFile,
  PATHS.bulkIssueJobsFile,
  PATHS.analyticsSummaryFile,
  PATHS.backupManifestFile
]);

// Files that must never silently read as empty: a parse failure here would let the
// next save overwrite the real registry with nothing.
const CORE_JSON_FILES = new Set([PATHS.badgesFile, PATHS.templatesFile, PATHS.deletedBadgesFile]);

// Large machine-maintained files are written without indentation to keep them small.
const COMPACT_JSON_FILES = new Set([
  PATHS.badgesFile,
  PATHS.appStateFile,
  PATHS.deletedBadgesFile,
  PATHS.bulkIssueJobsFile,
  PATHS.analyticsSummaryFile
]);

const jsonFileCache = new Map();

function statOrNull(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function cloneJsonValue(value) {
  return value === undefined || value === null || typeof value !== 'object' ? value : structuredClone(value);
}

function reportCorruptDataFile(filePath, error, usedCachedCopy) {
  const message = `Could not parse ${path.relative(ROOT, filePath)}: ${error.message}${usedCachedCopy ? ' (serving last good copy from memory)' : ''}`;
  console.error(message);
  try {
    appendAppErrorLog({ severity: 'critical', source: 'data_file_corrupt', message, stack: error.stack || '' });
  } catch {}
}

function readJson(filePath, fallback) {
  return readJsonValue(filePath, fallback, cloneJsonValue);
}

// Read-only access to a cached file's parsed value, skipping the defensive deep clone.
// Callers must not modify the result.
function readJsonShared(filePath, fallback) {
  return readJsonValue(filePath, fallback, (value) => value);
}

function readJsonValue(filePath, fallback, copy) {
  const stat = statOrNull(filePath);
  if (!stat) {
    return fallback;
  }
  const cacheable = CACHEABLE_JSON_FILES.has(filePath);
  const cached = cacheable ? jsonFileCache.get(filePath) : null;
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return copy(cached.value);
  }
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (cacheable) {
      jsonFileCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, value });
      return copy(value);
    }
    return value;
  } catch (error) {
    reportCorruptDataFile(filePath, error, Boolean(cached));
    if (cached) {
      return copy(cached.value);
    }
    if (CORE_JSON_FILES.has(filePath)) {
      const corrupt = new Error(
        `The data file ${path.basename(filePath)} is unreadable, so the change was not saved to avoid overwriting existing records. Restore it from a backup or the GitHub data branch.`
      );
      corrupt.code = 'DATA_FILE_CORRUPT';
      throw corrupt;
    }
    return fallback;
  }
}

function writeFileAtomic(filePath, content) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tempPath, content);
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch {}
    throw error;
  }
  jsonFileCache.delete(filePath);
}

// Copies without loading the file into memory; the rename keeps readers from ever
// seeing a partially written target.
function copyFileAtomic(sourcePath, targetPath) {
  ensureDir(path.dirname(targetPath));
  const tempPath = `${targetPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.copyFileSync(sourcePath, tempPath);
    fs.renameSync(tempPath, targetPath);
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch {}
    throw error;
  }
  jsonFileCache.delete(targetPath);
}

// Writes the same bytes as `${JSON.stringify(value)}\n`, but serializes arrays (top-level
// or one level inside a top-level object) element by element in ~1 MB chunks, so a
// registry with thousands of badges never has to exist as one giant string in memory.
function writeCompactJsonStreamed(filePath, value, mapItem = null) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const fd = fs.openSync(tempPath, 'w');
  let pending = [];
  let pendingLength = 0;
  const flush = () => {
    if (pending.length) {
      fs.writeSync(fd, pending.join(''));
      pending = [];
      pendingLength = 0;
    }
  };
  const emit = (text) => {
    pending.push(text);
    pendingLength += text.length;
    if (pendingLength >= 1024 * 1024) {
      flush();
    }
  };
  const emitArray = (items, mapFn) => {
    emit('[');
    for (let index = 0; index < items.length; index += 1) {
      if (index) {
        emit(',');
      }
      const item = mapFn ? mapFn(items[index]) : items[index];
      const text = JSON.stringify(item);
      emit(text === undefined ? 'null' : text);
    }
    emit(']');
  };
  try {
    if (Array.isArray(value)) {
      emitArray(value, mapItem);
    } else if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && typeof value.toJSON !== 'function') {
      emit('{');
      let first = true;
      for (const [key, entry] of Object.entries(value)) {
        if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol') {
          continue;
        }
        emit(`${first ? '' : ','}${JSON.stringify(key)}:`);
        first = false;
        if (Array.isArray(entry)) {
          emitArray(entry, null);
        } else {
          emit(JSON.stringify(entry));
        }
      }
      emit('}');
    } else {
      emit(String(JSON.stringify(value)));
    }
    emit('\n');
    flush();
    fs.closeSync(fd);
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.closeSync(fd);
    } catch {}
    try {
      fs.unlinkSync(tempPath);
    } catch {}
    throw error;
  }
  jsonFileCache.delete(filePath);
}

function writeJson(filePath, data) {
  if (COMPACT_JSON_FILES.has(filePath)) {
    writeCompactJsonStreamed(filePath, data);
    return;
  }
  writeFileAtomic(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function writeText(filePath, text) {
  writeFileAtomic(filePath, text);
}

function appendText(filePath, text) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, text, 'utf8');
}

function normalizeUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function formatLongDate(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
}

function toIsoDate(input = new Date()) {
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return input;
  }

  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    const today = new Date();
    return today.toISOString().slice(0, 10);
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseIssueDate(displayDate) {
  const trimmed = String(displayDate || '').trim();
  if (!trimmed) {
    return { display: formatLongDate(), iso: toIsoDate() };
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return {
      display: formatLongDate(parsed),
      iso: toIsoDate(parsed)
    };
  }

  return {
    display: trimmed,
    iso: toIsoDate()
  };
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 80);
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function serializeForScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function sanitizeFilePart(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'Certificate';
}

function sortBadgesDescending(badges) {
  return [...badges].sort((left, right) => {
    const rightKey = `${right.issueDateISO || ''}|${right.createdAt || ''}|${right.id || ''}`;
    const leftKey = `${left.issueDateISO || ''}|${left.createdAt || ''}|${left.id || ''}`;
    return rightKey.localeCompare(leftKey);
  });
}

function ensureDataFiles() {
  ensureDir(PATHS.dataDir);
  ensureDir(PATHS.docsDir);
  ensureDir(PATHS.docsDataDir);
  ensureDir(PATHS.docsBadgesDir);
  ensureDir(PATHS.docsAssetsDir);
  ensureDir(PATHS.docsUploadsDir);
  ensureDir(PATHS.docsRegistryDir);
  ensureDir(PATHS.adminDir);
  ensureDir(PATHS.backupsDir);

  if (!fileExists(PATHS.badgesFile)) {
    writeJson(PATHS.badgesFile, []);
  }
  if (!fileExists(PATHS.templatesFile)) {
    writeJson(PATHS.templatesFile, DEFAULT_BADGE_TEMPLATES);
  }
  if (!fileExists(PATHS.certificateTemplateFile)) {
    writeJson(PATHS.certificateTemplateFile, DEFAULT_CERTIFICATE_TEMPLATE);
  }
  if (!fileExists(PATHS.siteConfigFile)) {
    writeJson(PATHS.siteConfigFile, DEFAULT_SITE_CONFIG);
  }
  if (!fileExists(PATHS.badgeLinksCsvFile)) {
    writeText(PATHS.badgeLinksCsvFile, buildBadgeLinksCsv([]));
  }
  if (!fileExists(PATHS.deletedBadgesFile)) {
    writeJson(PATHS.deletedBadgesFile, []);
  }
  if (!fileExists(PATHS.backupManifestFile)) {
    writeJson(PATHS.backupManifestFile, { version: 1, backups: [] });
  }
  if (!fileExists(PATHS.auditLogFile)) {
    writeText(PATHS.auditLogFile, '');
  }
  if (!fileExists(PATHS.emailLogFile)) {
    writeText(PATHS.emailLogFile, '');
  }
  if (!fileExists(PATHS.appErrorLogFile)) {
    writeText(PATHS.appErrorLogFile, '');
  }
  if (!fileExists(PATHS.analyticsEventsFile)) {
    writeText(PATHS.analyticsEventsFile, '');
  }
  if (!fileExists(PATHS.analyticsSummaryFile)) {
    writeJson(PATHS.analyticsSummaryFile, DEFAULT_ANALYTICS_SUMMARY);
  }
  if (!fileExists(PATHS.bulkIssueJobsFile)) {
    writeJson(PATHS.bulkIssueJobsFile, []);
  }
  if (!fileExists(PATHS.appStateFile)) {
    syncAppStateFromFiles();
  }
  migrateEmailConfigFromSiteFile();
}

function loadSiteConfig() {
  const storedSite = readJson(PATHS.siteConfigFile, DEFAULT_SITE_CONFIG);
  const emailFile = fileExists(PATHS.emailConfigFile) ? readJson(PATHS.emailConfigFile, {}) : {};
  return mergeSiteConfigFromSources(storedSite, emailFile);
}

function siteConfigForPublicDocs() {
  return stripEmailKeys(loadSiteConfig());
}

function loadCertificateTemplate() {
  const stored = readJson(PATHS.certificateTemplateFile, DEFAULT_CERTIFICATE_TEMPLATE);
  return normalizeCertificateConfig(stored, DEFAULT_CERTIFICATE_TEMPLATE);
}

function loadBadgeTemplates() {
  const templates = readJson(PATHS.templatesFile, DEFAULT_BADGE_TEMPLATES);
  return (Array.isArray(templates) ? templates : DEFAULT_BADGE_TEMPLATES).map(normalizeBadgeTemplate);
}

function loadBadges() {
  const badges = readJson(PATHS.badgesFile, []);
  return Array.isArray(badges) ? badges : [];
}

// The cached badge list itself, without the per-call deep clone (which costs ~100 MB of
// heap at 15,000 badges). For read-only use only: never modify the array or its badges.
function loadBadgesReadOnly() {
  const badges = readJsonShared(PATHS.badgesFile, []);
  return Array.isArray(badges) ? badges : [];
}

function loadDeletedBadges() {
  const deleted = readJson(PATHS.deletedBadgesFile, []);
  return Array.isArray(deleted) ? deleted : [];
}


function loadAnalyticsEvents() {
  if (!fileExists(PATHS.analyticsEventsFile)) {
    return [];
  }
  const text = fs.readFileSync(PATHS.analyticsEventsFile, 'utf8');
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean);
}

function loadAnalyticsSummary() {

  const stored = readJson(PATHS.analyticsSummaryFile, DEFAULT_ANALYTICS_SUMMARY);
  return {
    ...DEFAULT_ANALYTICS_SUMMARY,
    ...stored,
    totals: {
      ...DEFAULT_ANALYTICS_SUMMARY.totals,
      ...((stored && stored.totals) || {})
    }
  };
}

function loadBulkIssueJobs() {
  const jobs = readJson(PATHS.bulkIssueJobsFile, []);
  return Array.isArray(jobs) ? jobs : [];
}

function saveAnalyticsEvents(events) {
  const rows = Array.isArray(events) ? events : [];
  const content = rows.map((row) => JSON.stringify(row)).join('\n');
  writeText(PATHS.analyticsEventsFile, content ? `${content}\n` : '');
}

function normalizeAnalyticsSummary(summary) {
  return {
    ...DEFAULT_ANALYTICS_SUMMARY,
    ...(summary || {}),
    totals: {
      ...DEFAULT_ANALYTICS_SUMMARY.totals,
      ...(((summary || {}).totals) || {})
    }
  };
}

function saveAnalyticsSummary(summary) {
  writeJson(PATHS.analyticsSummaryFile, normalizeAnalyticsSummary(summary));
}

function saveBulkIssueJobs(jobs) {
  writeJson(PATHS.bulkIssueJobsFile, Array.isArray(jobs) ? jobs : []);
  markAppStateDirty();
}

// app-state.json is a combined copy of the core data files, used for restores and
// exports. Analytics events and the Brevo API key are deliberately left out: the
// events have their own NDJSON file and grow without bound, and the key is a secret.
function loadAppState(options = {}) {
  flushAppState();
  const stored = readJson(PATHS.appStateFile, null) || {};
  const state = {
    version: 3,
    badges: Array.isArray(stored.badges) ? stored.badges : loadBadges(),
    deletedBadges: Array.isArray(stored.deletedBadges) ? stored.deletedBadges : loadDeletedBadges(),
    templates: (Array.isArray(stored.templates) ? stored.templates : loadBadgeTemplates()).map(normalizeBadgeTemplate),
    certificateTemplate: normalizeCertificateConfig(stored.certificateTemplate || loadCertificateTemplate(), DEFAULT_CERTIFICATE_TEMPLATE),
    siteConfig: mergeSiteConfigFromSources(
      stored.siteConfig || loadSiteConfig(),
      fileExists(PATHS.emailConfigFile) ? readJson(PATHS.emailConfigFile, {}) : {}
    ),
    bulkIssueJobs: Array.isArray(stored.bulkIssueJobs) ? stored.bulkIssueJobs : loadBulkIssueJobs(),
    analyticsSummary: normalizeAnalyticsSummary(stored.analyticsSummary || loadAnalyticsSummary())
  };
  if (options.includeAnalytics) {
    state.analyticsEvents = loadAnalyticsEvents();
  }
  return state;
}

function saveAppState(state) {
  const siteConfig = { ...(state.siteConfig || loadSiteConfig()) };
  delete siteConfig.emailBrevoApiKey;
  writeJson(PATHS.appStateFile, {
    version: 3,
    badges: Array.isArray(state.badges) ? state.badges : loadBadges(),
    deletedBadges: Array.isArray(state.deletedBadges) ? state.deletedBadges : loadDeletedBadges(),
    templates: (Array.isArray(state.templates) ? state.templates : loadBadgeTemplates()).map(normalizeBadgeTemplate),
    certificateTemplate: normalizeCertificateConfig(state.certificateTemplate || loadCertificateTemplate(), DEFAULT_CERTIFICATE_TEMPLATE),
    siteConfig,
    bulkIssueJobs: Array.isArray(state.bulkIssueJobs) ? state.bulkIssueJobs : loadBulkIssueJobs(),
    analyticsSummary: normalizeAnalyticsSummary(state.analyticsSummary || loadAnalyticsSummary())
  });
}

function syncAppStateFromFiles() {
  appStateDirty = false;
  const sharedArray = (filePath) => {
    const value = readJsonShared(filePath, []);
    return Array.isArray(value) ? value : [];
  };
  saveAppState({
    badges: sharedArray(PATHS.badgesFile),
    deletedBadges: sharedArray(PATHS.deletedBadgesFile),
    templates: loadBadgeTemplates(),
    certificateTemplate: loadCertificateTemplate(),
    siteConfig: loadSiteConfig(),
    bulkIssueJobs: sharedArray(PATHS.bulkIssueJobsFile),
    analyticsSummary: loadAnalyticsSummary()
  });
}

// Saves only mark app-state as stale. Rebuilding it means serializing every badge, so
// it happens lazily: before each push, snapshot, export, or read via loadAppState().
let appStateDirty = false;

function markAppStateDirty() {
  appStateDirty = true;
}

function flushAppState() {
  if (!appStateDirty && fileExists(PATHS.appStateFile)) {
    return false;
  }
  syncAppStateFromFiles();
  return true;
}

function writeStateToFiles(state, options = {}) {
  const has = (key) => Object.prototype.hasOwnProperty.call(state, key) && state[key] != null;
  if (has('badges') && Array.isArray(state.badges)) {
    writeJson(PATHS.badgesFile, state.badges);
    writeText(PATHS.badgeLinksCsvFile, buildBadgeLinksCsv(state.badges));
  }
  if (has('deletedBadges') && Array.isArray(state.deletedBadges)) {
    writeJson(PATHS.deletedBadgesFile, state.deletedBadges);
  }
  if (has('templates') && Array.isArray(state.templates)) {
    writeJson(PATHS.templatesFile, state.templates.map(normalizeBadgeTemplate));
  }
  if (has('certificateTemplate')) {
    writeJson(PATHS.certificateTemplateFile, normalizeCertificateConfig(state.certificateTemplate || {}, DEFAULT_CERTIFICATE_TEMPLATE));
  }
  if (has('siteConfig')) {
    const emailDisk = fileExists(PATHS.emailConfigFile) ? readJson(PATHS.emailConfigFile, {}) : {};
    persistSiteConfigSplit(mergeSiteConfigFromSources(state.siteConfig || {}, emailDisk));
  }
  if (has('bulkIssueJobs') && Array.isArray(state.bulkIssueJobs)) {
    writeJson(PATHS.bulkIssueJobsFile, state.bulkIssueJobs);
  }
  if (has('analyticsSummary')) {
    writeJson(PATHS.analyticsSummaryFile, normalizeAnalyticsSummary(state.analyticsSummary));
  }
  if (has('analyticsEvents') && Array.isArray(state.analyticsEvents)) {
    const existingSize = statOrNull(PATHS.analyticsEventsFile);
    const hasExistingEvents = Boolean(existingSize && existingSize.size > 0);
    if (!options.preferExistingAnalytics || !hasExistingEvents) {
      saveAnalyticsEvents(state.analyticsEvents);
    }
  }
}

function hydrateFilesFromAppState() {
  if (!fileExists(PATHS.appStateFile)) {
    return;
  }
  const stored = readJson(PATHS.appStateFile, null);
  if (!stored || typeof stored !== 'object') {
    return;
  }
  writeStateToFiles(stored, { preferExistingAnalytics: true });
  markAppStateDirty();
}

function saveBadges(badges) {
  writeJson(PATHS.badgesFile, badges);
  writeText(PATHS.badgeLinksCsvFile, buildBadgeLinksCsv(badges));
  markAppStateDirty();
}

function saveDeletedBadges(deletedBadges) {
  writeJson(PATHS.deletedBadgesFile, deletedBadges);
  markAppStateDirty();
}

function saveBadgeTemplates(templates) {
  writeJson(PATHS.templatesFile, (Array.isArray(templates) ? templates : []).map(normalizeBadgeTemplate));
  markAppStateDirty();
}

function saveSiteConfig(config) {
  persistSiteConfigSplit(config);
  markAppStateDirty();
}

function saveCertificateTemplate(config) {
  writeJson(PATHS.certificateTemplateFile, normalizeCertificateConfig(config, DEFAULT_CERTIFICATE_TEMPLATE));
  markAppStateDirty();
}

function buildCredentialId(badges, siteConfig, issueDateIso, reservedIds = null) {
  const prefix = slugify(siteConfig.credentialPrefix || 'CCE').toUpperCase() || 'CCE';
  const compactDate = String(issueDateIso || toIsoDate()).replace(/-/g, '');
  const stem = `${prefix}-${compactDate}-`;
  const taken = new Set();
  let highest = 0;
  const consider = (id) => {
    const value = String(id || '');
    if (!value.startsWith(stem)) {
      return;
    }
    taken.add(value);
    const sequence = Number.parseInt(value.slice(stem.length), 10);
    if (Number.isFinite(sequence) && sequence > highest) {
      highest = sequence;
    }
  };
  (Array.isArray(badges) ? badges : []).forEach((badge) => consider(badge && badge.id));
  const reserved = reservedIds || loadDeletedBadges().map((entry) => entry && (entry.id || (entry.badge && entry.badge.id)));
  for (const id of reserved) {
    consider(id);
  }
  let next = highest + 1;
  let candidate = `${stem}${String(next).padStart(4, '0')}`;
  while (taken.has(candidate)) {
    next += 1;
    candidate = `${stem}${String(next).padStart(4, '0')}`;
  }
  return candidate;
}

function buildBadgeSlug(badge) {
  const base = slugify(`${badge.awardeeName}-${badge.badgeTitle}`) || slugify(badge.id) || 'badge';
  return `${base}-${slugify(badge.id).toLowerCase()}`;
}

function hasConfiguredPublicUrl(siteConfig) {
  const base = normalizeUrl(siteConfig.publicSiteUrl || '');
  return Boolean(base) && !/YOUR-GITHUB-USERNAME|YOUR-REPO-NAME/.test(base);
}

function getPublicBadgeUrl(siteConfig, slug) {
  if (!hasConfiguredPublicUrl(siteConfig)) {
    return `/badges/${slug}/`;
  }
  return `${normalizeUrl(siteConfig.publicSiteUrl)}/badges/${slug}/`;
}

function getPublicRegistryUrl(siteConfig) {
  if (!hasConfiguredPublicUrl(siteConfig)) {
    return '/registry/';
  }
  return `${normalizeUrl(siteConfig.publicSiteUrl)}/registry/`;
}

function getPublicHomeUrl(siteConfig) {
  if (!hasConfiguredPublicUrl(siteConfig)) {
    return '/';
  }
  return `${normalizeUrl(siteConfig.publicSiteUrl)}/`;
}

function buildBadgeLinksCsv(badges) {
  const header = [
    'credential_id',
    'awardee_name',
    'awardee_email',
    'badge_title',
    'issue_date',
    'status',
    'public_url',
    'repo_badge_page',
    'details_json'
  ];

  const lines = sortBadgesDescending(badges).map((badge) => {
    const values = [
      badge.id,
      badge.awardeeName,
      badge.awardeeEmail || '',
      badge.badgeTitle,
      badge.issueDate,
      badge.status,
      badge.publicUrl,
      badge.repoPath,
      badge.detailsJsonPath
    ].map(csvEscape);
    return values.join(',');
  });

  return [header.join(','), ...lines].join('\n') + '\n';
}

function csvEscape(value) {
  const text = String(value == null ? '' : value);
  if (/[,"\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const input = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ',') {
      row.push(cell);
      cell = '';
      continue;
    }
    if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    if (char === '\r') {
      continue;
    }
    cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((currentRow) => currentRow.some((value) => String(value || '').trim() !== ''));
}

function importBadgesFromCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) {
    throw new Error('The CSV file is empty.');
  }
  const header = rows[0].map((item) => String(item || '').trim());
  const required = ['credential_id', 'awardee_name', 'badge_title', 'issue_date'];
  for (const field of required) {
    if (!header.includes(field)) {
      throw new Error(`The CSV is missing the required column: ${field}`);
    }
  }
  const getIndex = (name) => header.indexOf(name);
  const siteConfig = loadSiteConfig();
  const imported = rows.slice(1).map((columns, index) => {
    const id = String(columns[getIndex('credential_id')] || '').trim() || `IMPORT-${Date.now()}-${index + 1}`;
    const awardeeName = String(columns[getIndex('awardee_name')] || '').trim();
    const badgeTitle = String(columns[getIndex('badge_title')] || '').trim();
    const issueDate = String(columns[getIndex('issue_date')] || '').trim();
    if (!awardeeName || !badgeTitle || !issueDate) {
      throw new Error(`Row ${index + 2} is missing an awardee name, badge title, or issue date.`);
    }
    const parsedDate = parseIssueDate(issueDate);
    const slug = buildBadgeSlug({ awardeeName, badgeTitle, id });
    return {
      id,
      awardeeName,
      awardeeEmail: String(columns[getIndex('awardee_email')] || '').trim().toLowerCase(),
      badgeTitle,
      issueDate: parsedDate.display,
      issueDateISO: parsedDate.iso,
      status: String(columns[getIndex('status')] || 'valid').trim() || 'valid',
      publicUrl: String(columns[getIndex('public_url')] || '').trim() || getPublicBadgeUrl(siteConfig, slug),
      repoPath: String(columns[getIndex('repo_badge_page')] || '').trim() || `docs/badges/${slug}/index.html`,
      detailsJsonPath: String(columns[getIndex('details_json')] || '').trim() || `docs/badges/${slug}/details.json`,
      slug,
      createdAt: new Date().toISOString(),
      restoredFromCsv: true
    };
  });

  const seen = new Set();
  return imported.filter((badge) => {
    if (seen.has(badge.id)) {
      return false;
    }
    seen.add(badge.id);
    return true;
  });
}

function computeBadgeStats(badges) {
  return {
    totalIssued: badges.length,
    validCount: badges.filter((badge) => badge.status === 'valid').length,
    latestIssueDate: badges.length ? sortBadgesDescending(badges)[0].issueDate : 'No badges issued yet'
  };
}

function removeDirectoryContents(dirPath, keepNames = []) {
  if (!fileExists(dirPath)) {
    return;
  }
  for (const entry of fs.readdirSync(dirPath)) {
    if (keepNames.includes(entry)) {
      continue;
    }
    fs.rmSync(path.join(dirPath, entry), { recursive: true, force: true });
  }
}

function getBackupManifest() {
  const stored = readJson(PATHS.backupManifestFile, { version: 1, backups: [] });
  return {
    version: 1,
    backups: Array.isArray(stored.backups) ? stored.backups : []
  };
}

function saveBackupManifest(manifest) {
  writeJson(PATHS.backupManifestFile, {
    version: 1,
    backups: Array.isArray(manifest.backups) ? manifest.backups : []
  });
}

function hashFile(filePath) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return '';
  }
}

function listLocalBackupIds() {
  try {
    return fs
      .readdirSync(PATHS.backupsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

// Applies the tiered retention policy to local backup folders and the manifest.
// extraIds lets the caller include snapshots that only exist on GitHub, so that
// one keep-set covers both. Returns the set of backup ids to keep.
function applyBackupRetention(options = {}) {
  const manifest = getBackupManifest();
  const localIds = listLocalBackupIds();
  const manifestIds = manifest.backups.map((entry) => entry && entry.backupId).filter(Boolean);
  const allIds = [...new Set([...localIds, ...manifestIds, ...(options.extraIds || [])])];
  const keep = selectBackupsToKeep(allIds, { now: options.now });

  for (const id of localIds) {
    if (!keep.has(id)) {
      fs.rmSync(path.join(PATHS.backupsDir, id), { recursive: true, force: true });
    }
  }
  const kept = manifest.backups.filter((entry) => !entry || !entry.backupId || keep.has(entry.backupId));
  if (kept.length !== manifest.backups.length) {
    saveBackupManifest({ backups: kept });
  }
  return keep;
}

// Copies the already-built app-state.json and badge-links.csv instead of re-serializing
// every badge, which keeps snapshot memory flat as the registry grows.
function createBackupSnapshot(reason = 'Manual snapshot', actor = 'system') {
  ensureDataFiles();
  flushAppState();
  if (!fileExists(PATHS.badgeLinksCsvFile)) {
    writeText(PATHS.badgeLinksCsvFile, buildBadgeLinksCsv(loadBadgesReadOnly()));
  }
  const backupId = new Date().toISOString().replace(/[.:]/g, '-');
  const backupDir = path.join(PATHS.backupsDir, backupId);
  ensureDir(backupDir);

  const appStateTarget = path.join(backupDir, 'app-state.json');
  const linksTarget = path.join(backupDir, 'badge-links.csv');
  copyFileAtomic(PATHS.appStateFile, appStateTarget);
  copyFileAtomic(PATHS.badgeLinksCsvFile, linksTarget);

  const metadata = {
    backupId,
    reason,
    actor,
    createdAt: new Date().toISOString(),
    counts: {
      badges: loadBadgesReadOnly().length,
      deletedBadges: [].concat(readJsonShared(PATHS.deletedBadgesFile, [])).length,
      templates: loadBadgeTemplates().length
    },
    hashes: {
      appState: hashFile(appStateTarget),
      badgeLinksCsv: hashFile(linksTarget)
    },
    files: {
      appState: `data/backups/${backupId}/app-state.json`,
      badgeLinksCsv: `data/backups/${backupId}/badge-links.csv`
    }
  };

  writeJson(path.join(backupDir, 'metadata.json'), metadata);

  const manifest = getBackupManifest();
  manifest.backups = [metadata, ...manifest.backups];
  saveBackupManifest(manifest);
  applyBackupRetention();
  appendAuditLog({ action: 'backup.snapshot', actor, reason, backupId, createdAt: metadata.createdAt });
  return metadata;
}

function appendAuditLog(entry) {
  appendText(PATHS.auditLogFile, JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + '\n');
}

function appendEmailLogLine(entry) {
  appendText(PATHS.emailLogFile, JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + '\n');
}

function loadEmailLogEntries(limit = 150) {
  if (!fileExists(PATHS.emailLogFile)) {
    return [];
  }
  const text = fs.readFileSync(PATHS.emailLogFile, 'utf8');
  const cap = Math.min(500, Math.max(1, Number(limit) || 150));
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || '')));
  return rows.slice(0, cap);
}

const APP_ERROR_STACK_MAX = 6000;

function truncateForErrorLog(text, maxLen = APP_ERROR_STACK_MAX) {
  const s = String(text || '');
  if (s.length <= maxLen) {
    return s;
  }
  return `${s.slice(0, maxLen)}…`;
}

function appendAppErrorLog(entry = {}) {
  const row = {
    timestamp: new Date().toISOString(),
    severity: String(entry.severity || 'error'),
    source: String(entry.source || 'unknown'),
    message: truncateForErrorLog(entry.message != null ? String(entry.message) : '', 2000),
    stack: entry.stack ? truncateForErrorLog(String(entry.stack), APP_ERROR_STACK_MAX) : '',
    path: entry.path != null ? String(entry.path) : '',
    method: entry.method != null ? String(entry.method) : '',
    context: entry.context != null ? truncateForErrorLog(String(entry.context), 1500) : ''
  };
  try {
    appendText(PATHS.appErrorLogFile, JSON.stringify(row) + '\n');
  } catch (writeError) {
    console.error(`appendAppErrorLog failed: ${writeError.message}`);
  }
}

function loadAppErrorLogEntries(limit = 200) {
  if (!fileExists(PATHS.appErrorLogFile)) {
    return [];
  }
  const text = fs.readFileSync(PATHS.appErrorLogFile, 'utf8');
  const cap = Math.min(500, Math.max(1, Number(limit) || 200));
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || '')));
  return rows.slice(0, cap);
}

function getRecentBackups(limit = 25) {
  return getBackupManifest().backups.slice(0, limit);
}

function parseFullBackupJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text || ''));
  } catch (error) {
    throw new Error('The uploaded JSON backup is not valid JSON.');
  }

  const source = parsed && typeof parsed === 'object' && parsed.appState ? parsed.appState : parsed;
  if (!source || typeof source !== 'object') {
    throw new Error('The JSON backup must contain an appState object or app-state JSON.');
  }

  const state = {
    version: 3,
    badges: Array.isArray(source.badges) ? source.badges : [],
    deletedBadges: Array.isArray(source.deletedBadges) ? source.deletedBadges : [],
    templates: (Array.isArray(source.templates) ? source.templates : []).map(normalizeBadgeTemplate),
    certificateTemplate: normalizeCertificateConfig(source.certificateTemplate || {}, DEFAULT_CERTIFICATE_TEMPLATE),
    siteConfig: mergeSiteConfigFromSources(source.siteConfig || {}, pickEmailKeys(source.siteConfig || {})),
    bulkIssueJobs: Array.isArray(source.bulkIssueJobs) ? source.bulkIssueJobs : loadBulkIssueJobs(),
    analyticsSummary: normalizeAnalyticsSummary(source.analyticsSummary)
  };
  if (Array.isArray(source.analyticsEvents)) {
    state.analyticsEvents = source.analyticsEvents;
  }

  return state;
}


function saveUploadedAssetFromDataUrl(input, options = {}) {
  const payload = String(input || '').trim();
  if (!payload || !payload.startsWith('data:')) {
    return cleanAssetPath(payload);
  }

  const match = payload.match(/^data:([^;,]+);base64,(.+)$/s);
  if (!match) {
    throw new Error('The uploaded asset could not be decoded.');
  }

  const mimeType = match[1].toLowerCase();
  const extensionMap = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/webp': '.webp'
  };
  if (options.allowSvg !== false) {
    extensionMap['image/svg+xml'] = '.svg';
  }
  const ext = extensionMap[mimeType];
  if (!ext) {
    throw new Error(`Unsupported image type (${mimeType}). Upload a PNG, JPG, WebP${options.allowSvg !== false ? ', or SVG' : ''} file.`);
  }
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) {
    throw new Error('The uploaded image is empty.');
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error(`The uploaded image is too large (${(buffer.length / 1048576).toFixed(1)} MB). The limit is ${MAX_UPLOAD_BYTES / 1048576} MB.`);
  }
  const category = slugify(options.category || 'uploads') || 'uploads';
  const preferred = slugify(options.preferredName || 'asset') || 'asset';
  const filename = `${preferred}-${Date.now()}${ext}`;
  const relativeDir = path.posix.join('assets', 'uploads', category);
  const relativePath = path.posix.join(relativeDir, filename);
  const localPath = path.join(PATHS.docsDir, relativePath);
  writeFileAtomic(localPath, buffer);
  return relativePath.replace(/\\/g, '/');
}

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

function cleanAssetPath(value) {
  return String(value || '').trim().replace(/^\/+/, '');
}

function getCertificateTemplateForTemplate(template, globalTemplate = DEFAULT_CERTIFICATE_TEMPLATE) {
  const normalizedTemplate = normalizeBadgeTemplate(template || {});
  if (normalizedTemplate.certificateTemplateOverrideEnabled) {
    return normalizeCertificateConfig({
      ...normalizedTemplate.certificateTemplate,
      backgroundImage:
        normalizedTemplate.certificateBackground ||
        normalizedTemplate.certificateTemplate.backgroundImage ||
        globalTemplate.backgroundImage
    }, globalTemplate);
  }
  return normalizeCertificateConfig({
    ...globalTemplate,
    backgroundImage: normalizedTemplate.certificateBackground || globalTemplate.backgroundImage
  }, globalTemplate);
}

function applyAppState(state, options = {}) {
  const normalized = parseFullBackupJson(JSON.stringify(state));
  writeStateToFiles(normalized, { preferExistingAnalytics: false });
  syncAppStateFromFiles();
  if (options.snapshot !== false) {
    createBackupSnapshot(options.reason || 'State restored', options.actor || 'admin');
  }
  appendAuditLog({ action: 'state.restore', actor: options.actor || 'admin', reason: options.reason || 'State restored' });
  return normalized;
}

module.exports = {
  PATHS,
  ROOT,
  DEFAULT_SITE_CONFIG,
  DEFAULT_CERTIFICATE_TEMPLATE,
  DEFAULT_BADGE_TEMPLATES,
  DEFAULT_ANALYTICS_SUMMARY,
  ensureDir,
  ensureDataFiles,
  fileExists,
  readJson,
  writeJson,
  writeText,
  writeFileAtomic,
  copyFileAtomic,
  writeCompactJsonStreamed,
  readJsonShared,
  appendText,
  loadSiteConfig,
  siteConfigForPublicDocs,
  appendEmailLogLine,
  loadEmailLogEntries,
  appendAppErrorLog,
  loadAppErrorLogEntries,
  loadCertificateTemplate,
  loadBadgeTemplates,
  loadBadges,
  loadBadgesReadOnly,
  loadDeletedBadges,
  loadAnalyticsEvents,
  loadAnalyticsSummary,
  loadBulkIssueJobs,
  saveBadges,
  saveDeletedBadges,
  saveBadgeTemplates,
  saveSiteConfig,
  saveCertificateTemplate,
  saveAnalyticsEvents,
  saveAnalyticsSummary,
  saveBulkIssueJobs,
  formatLongDate,
  toIsoDate,
  parseIssueDate,
  slugify,
  escapeHtml,
  escapeAttribute,
  serializeForScript,
  sanitizeFilePart,
  sortBadgesDescending,
  buildCredentialId,
  buildBadgeSlug,
  getPublicBadgeUrl,
  getPublicRegistryUrl,
  getPublicHomeUrl,
  buildBadgeLinksCsv,
  parseCsv,
  importBadgesFromCsv,
  computeBadgeStats,
  removeDirectoryContents,
  normalizeUrl,
  hasConfiguredPublicUrl,
  loadAppState,
  saveAppState,
  syncAppStateFromFiles,
  markAppStateDirty,
  flushAppState,
  hydrateFilesFromAppState,
  getBackupManifest,
  saveBackupManifest,
  applyBackupRetention,
  createBackupSnapshot,
  getRecentBackups,
  appendAuditLog,
  parseFullBackupJson,
  applyAppState,
  DEFAULT_TEMPLATE_FIELDS,
  normalizeCertificateConfig,
  normalizeBadgeTemplate,
  parseList,
  saveUploadedAssetFromDataUrl,
  cleanAssetPath,
  getCertificateTemplateForTemplate
};
