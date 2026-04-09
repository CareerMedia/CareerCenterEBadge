const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
  analyticsSummaryFile: path.join(ROOT, 'data', 'analytics-summary.json')
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
  footerNote: 'Official credential records are maintained by the CSUN Career Center.'
};

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
  widgetLayout: 'stacked'
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

function readJson(filePath, fallback) {
  try {
    if (!fileExists(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function writeText(filePath, text) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, text, 'utf8');
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
  if (!fileExists(PATHS.analyticsEventsFile)) {
    writeText(PATHS.analyticsEventsFile, '');
  }
  if (!fileExists(PATHS.analyticsSummaryFile)) {
    writeJson(PATHS.analyticsSummaryFile, DEFAULT_ANALYTICS_SUMMARY);
  }
  if (!fileExists(PATHS.appStateFile)) {
    syncAppStateFromFiles();
  }
}

function loadSiteConfig() {
  const stored = readJson(PATHS.siteConfigFile, DEFAULT_SITE_CONFIG);
  return {
    ...DEFAULT_SITE_CONFIG,
    ...stored,
    publicSiteUrl: normalizeUrl(stored.publicSiteUrl || DEFAULT_SITE_CONFIG.publicSiteUrl)
  };
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

function saveAnalyticsEvents(events) {
  const rows = Array.isArray(events) ? events : [];
  const content = rows.map((row) => JSON.stringify(row)).join('\n');
  writeText(PATHS.analyticsEventsFile, content ? `${content}\n` : '');
  syncAppStateFromFiles();
}

function saveAnalyticsSummary(summary) {
  writeJson(PATHS.analyticsSummaryFile, {
    ...DEFAULT_ANALYTICS_SUMMARY,
    ...(summary || {}),
    totals: {
      ...DEFAULT_ANALYTICS_SUMMARY.totals,
      ...(((summary || {}).totals) || {})
    }
  });
  syncAppStateFromFiles();
}

function loadAppState() {
  const fallback = {
    version: 3,
    badges: loadBadges(),
    deletedBadges: loadDeletedBadges(),
    templates: loadBadgeTemplates(),
    certificateTemplate: loadCertificateTemplate(),
    siteConfig: loadSiteConfig(),
    analyticsEvents: loadAnalyticsEvents(),
    analyticsSummary: loadAnalyticsSummary()
  };
  const stored = readJson(PATHS.appStateFile, fallback);
  return {
    version: 3,
    badges: Array.isArray(stored.badges) ? stored.badges : fallback.badges,
    deletedBadges: Array.isArray(stored.deletedBadges) ? stored.deletedBadges : fallback.deletedBadges,
    templates: (Array.isArray(stored.templates) ? stored.templates : fallback.templates).map(normalizeBadgeTemplate),
    certificateTemplate: normalizeCertificateConfig(stored.certificateTemplate || fallback.certificateTemplate || {}, DEFAULT_CERTIFICATE_TEMPLATE),
    siteConfig: {
      ...DEFAULT_SITE_CONFIG,
      ...(stored.siteConfig || fallback.siteConfig || {}),
      publicSiteUrl: normalizeUrl(((stored.siteConfig || fallback.siteConfig || {}).publicSiteUrl) || DEFAULT_SITE_CONFIG.publicSiteUrl)
    },
    analyticsEvents: Array.isArray(stored.analyticsEvents) ? stored.analyticsEvents : fallback.analyticsEvents,
    analyticsSummary: {
      ...DEFAULT_ANALYTICS_SUMMARY,
      ...((stored.analyticsSummary || fallback.analyticsSummary) || {}),
      totals: {
        ...DEFAULT_ANALYTICS_SUMMARY.totals,
        ...((((stored.analyticsSummary || fallback.analyticsSummary) || {}).totals) || {})
      }
    }
  };
}

function saveAppState(state) {
  writeJson(PATHS.appStateFile, {
    version: 3,
    badges: Array.isArray(state.badges) ? state.badges : loadBadges(),
    deletedBadges: Array.isArray(state.deletedBadges) ? state.deletedBadges : loadDeletedBadges(),
    templates: (Array.isArray(state.templates) ? state.templates : loadBadgeTemplates()).map(normalizeBadgeTemplate),
    certificateTemplate: normalizeCertificateConfig(state.certificateTemplate || loadCertificateTemplate(), DEFAULT_CERTIFICATE_TEMPLATE),
    siteConfig: state.siteConfig || loadSiteConfig(),
    analyticsEvents: Array.isArray(state.analyticsEvents) ? state.analyticsEvents : loadAnalyticsEvents(),
    analyticsSummary: state.analyticsSummary || loadAnalyticsSummary()
  });
}

function syncAppStateFromFiles() {
  saveAppState({
    badges: loadBadges(),
    deletedBadges: loadDeletedBadges(),
    templates: loadBadgeTemplates(),
    certificateTemplate: loadCertificateTemplate(),
    siteConfig: loadSiteConfig(),
    analyticsEvents: loadAnalyticsEvents(),
    analyticsSummary: loadAnalyticsSummary()
  });
}

function hydrateFilesFromAppState() {
  if (!fileExists(PATHS.appStateFile)) {
    return;
  }
  const state = loadAppState();
  writeJson(PATHS.badgesFile, state.badges);
  writeJson(PATHS.deletedBadgesFile, state.deletedBadges || []);
  writeText(PATHS.badgeLinksCsvFile, buildBadgeLinksCsv(state.badges));
  writeJson(PATHS.templatesFile, (state.templates || []).map(normalizeBadgeTemplate));
  writeJson(PATHS.certificateTemplateFile, normalizeCertificateConfig(state.certificateTemplate || {}, DEFAULT_CERTIFICATE_TEMPLATE));
  writeJson(PATHS.siteConfigFile, state.siteConfig);
  const analyticsContent = (state.analyticsEvents || []).map((row) => JSON.stringify(row)).join('\n');
  writeText(PATHS.analyticsEventsFile, analyticsContent ? `${analyticsContent}\n` : '');
  writeJson(PATHS.analyticsSummaryFile, {
    ...DEFAULT_ANALYTICS_SUMMARY,
    ...(state.analyticsSummary || {}),
    totals: {
      ...DEFAULT_ANALYTICS_SUMMARY.totals,
      ...(((state.analyticsSummary || {}).totals) || {})
    }
  });
}

function saveBadges(badges) {
  writeJson(PATHS.badgesFile, badges);
  writeText(PATHS.badgeLinksCsvFile, buildBadgeLinksCsv(badges));
  syncAppStateFromFiles();
}

function saveDeletedBadges(deletedBadges) {
  writeJson(PATHS.deletedBadgesFile, deletedBadges);
  syncAppStateFromFiles();
}

function saveBadgeTemplates(templates) {
  writeJson(PATHS.templatesFile, (Array.isArray(templates) ? templates : []).map(normalizeBadgeTemplate));
  syncAppStateFromFiles();
}

function saveSiteConfig(config) {
  writeJson(PATHS.siteConfigFile, config);
  syncAppStateFromFiles();
}

function saveCertificateTemplate(config) {
  writeJson(PATHS.certificateTemplateFile, normalizeCertificateConfig(config, DEFAULT_CERTIFICATE_TEMPLATE));
  syncAppStateFromFiles();
}

function buildCredentialId(badges, siteConfig, issueDateIso) {
  const prefix = slugify(siteConfig.credentialPrefix || 'CCE').toUpperCase() || 'CCE';
  const compactDate = String(issueDateIso || toIsoDate()).replace(/-/g, '');
  const matching = badges.filter((badge) => String(badge.id || '').startsWith(`${prefix}-${compactDate}-`));
  const sequence = String(matching.length + 1).padStart(4, '0');
  return `${prefix}-${compactDate}-${sequence}`;
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

function hashString(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function createBackupSnapshot(reason = 'Manual snapshot', actor = 'system') {
  ensureDataFiles();
  syncAppStateFromFiles();
  const state = loadAppState();
  const backupId = new Date().toISOString().replace(/[.:]/g, '-');
  const backupDir = path.join(PATHS.backupsDir, backupId);
  ensureDir(backupDir);

  const stateJson = JSON.stringify(state, null, 2) + '\n';
  const linksCsv = buildBadgeLinksCsv(state.badges);
  const metadata = {
    backupId,
    reason,
    actor,
    createdAt: new Date().toISOString(),
    counts: {
      badges: state.badges.length,
      deletedBadges: Array.isArray(state.deletedBadges) ? state.deletedBadges.length : 0,
      templates: state.templates.length
    },
    hashes: {
      appState: hashString(stateJson),
      badgeLinksCsv: hashString(linksCsv)
    },
    files: {
      appState: `data/backups/${backupId}/app-state.json`,
      badgeLinksCsv: `data/backups/${backupId}/badge-links.csv`
    }
  };

  writeText(path.join(backupDir, 'app-state.json'), stateJson);
  writeText(path.join(backupDir, 'badge-links.csv'), linksCsv);
  writeJson(path.join(backupDir, 'metadata.json'), metadata);

  const manifest = getBackupManifest();
  manifest.backups = [metadata, ...manifest.backups];
  saveBackupManifest(manifest);
  appendAuditLog({ action: 'backup.snapshot', actor, reason, backupId, createdAt: metadata.createdAt });
  return metadata;
}

function appendAuditLog(entry) {
  appendText(PATHS.auditLogFile, JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + '\n');
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
    siteConfig: {
      ...DEFAULT_SITE_CONFIG,
      ...(source.siteConfig || {}),
      publicSiteUrl: normalizeUrl((source.siteConfig && source.siteConfig.publicSiteUrl) || DEFAULT_SITE_CONFIG.publicSiteUrl)
    },
    analyticsEvents: Array.isArray(source.analyticsEvents) ? source.analyticsEvents : loadAnalyticsEvents(),
    analyticsSummary: {
      ...DEFAULT_ANALYTICS_SUMMARY,
      ...((source.analyticsSummary) || {}),
      totals: {
        ...DEFAULT_ANALYTICS_SUMMARY.totals,
        ...((((source.analyticsSummary) || {}).totals) || {})
      }
    }
  };

  return state;
}


function saveUploadedAssetFromDataUrl(input, options = {}) {
  const payload = String(input || '').trim();
  if (!payload || !payload.startsWith('data:')) {
    return cleanAssetPath(payload);
  }

  const match = payload.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error('The uploaded asset could not be decoded.');
  }

  const mimeType = match[1].toLowerCase();
  const extensionMap = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/webp': '.webp',
    'image/svg+xml': '.svg'
  };
  const ext = extensionMap[mimeType] || '.bin';
  const category = slugify(options.category || 'uploads') || 'uploads';
  const preferred = slugify(options.preferredName || 'asset') || 'asset';
  const filename = `${preferred}-${Date.now()}${ext}`;
  const relativeDir = path.posix.join('assets', 'uploads', category);
  const relativePath = path.posix.join(relativeDir, filename);
  const localPath = path.join(PATHS.docsDir, relativePath);
  ensureDir(path.dirname(localPath));
  fs.writeFileSync(localPath, Buffer.from(match[2], 'base64'));
  return relativePath.replace(/\\/g, '/');
}

function cleanAssetPath(value) {
  return String(value || '').trim().replace(/^\/+/, '');
}

function getCertificateTemplateForTemplate(template, globalTemplate = DEFAULT_CERTIFICATE_TEMPLATE) {
  const normalizedTemplate = normalizeBadgeTemplate(template || {});
  if (normalizedTemplate.certificateTemplateOverrideEnabled) {
    return normalizeCertificateConfig({
      ...normalizedTemplate.certificateTemplate,
      backgroundImage: normalizedTemplate.certificateTemplate.backgroundImage || normalizedTemplate.certificateBackground || globalTemplate.backgroundImage
    }, globalTemplate);
  }
  return normalizeCertificateConfig({
    ...globalTemplate,
    backgroundImage: normalizedTemplate.certificateBackground || globalTemplate.backgroundImage
  }, globalTemplate);
}

function applyAppState(state, options = {}) {
  const normalized = parseFullBackupJson(JSON.stringify(state));
  saveAppState(normalized);
  hydrateFilesFromAppState();
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
  appendText,
  loadSiteConfig,
  loadCertificateTemplate,
  loadBadgeTemplates,
  loadBadges,
  loadDeletedBadges,
  loadAnalyticsEvents,
  loadAnalyticsSummary,
  saveBadges,
  saveDeletedBadges,
  saveBadgeTemplates,
  saveSiteConfig,
  saveCertificateTemplate,
  saveAnalyticsEvents,
  saveAnalyticsSummary,
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
  hydrateFilesFromAppState,
  getBackupManifest,
  saveBackupManifest,
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
