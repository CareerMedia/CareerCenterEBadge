const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PATHS = {
  root: ROOT,
  dataDir: path.join(ROOT, 'data'),
  docsDir: path.join(ROOT, 'docs'),
  docsDataDir: path.join(ROOT, 'docs', 'data'),
  docsBadgesDir: path.join(ROOT, 'docs', 'badges'),
  docsAssetsDir: path.join(ROOT, 'docs', 'assets'),
  docsRegistryDir: path.join(ROOT, 'docs', 'registry'),
  adminDir: path.join(ROOT, 'admin'),
  badgesFile: path.join(ROOT, 'data', 'badges.json'),
  templatesFile: path.join(ROOT, 'data', 'badge-catalog.json'),
  certificateTemplateFile: path.join(ROOT, 'data', 'certificate-template.json'),
  siteConfigFile: path.join(ROOT, 'data', 'site-config.json'),
  badgeLinksCsvFile: path.join(ROOT, 'data', 'badge-links.csv')
};

const DEFAULT_SITE_CONFIG = {
  siteName: 'Career Center Credentials',
  organizationName: 'Career Center',
  heroTitle: 'Official Digital Badges and Certificates',
  heroIntro:
    'Verify a credential, review formal badge details, and download a certificate that uses your configured placement coordinates.',
  publicSiteUrl: 'https://YOUR-GITHUB-USERNAME.github.io/YOUR-REPO-NAME',
  defaultCareerCenterUrl: 'https://career.example.edu',
  supportEmail: 'careercenter@example.edu',
  credentialPrefix: 'CCE',
  footerNote: 'Official credential records are maintained by the Career Center.'
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

const DEFAULT_BADGE_TEMPLATES = [
  {
    id: 'career-explorer',
    title: 'Career Explorer Digital Badge',
    badgeLabel: 'Career Readiness Recognition',
    description:
      'Recognizes meaningful engagement with career exploration programming and readiness development.',
    meaning:
      'This badge affirms that the recipient completed a verified experience aligned with career readiness and professional growth.',
    criteria:
      'Awarded to participants who completed the approved experience or milestone defined by the Career Center.',
    issuerName: 'Career Center',
    issuerOrganization: 'Your Institution Name',
    issuerWebsite: 'https://career.example.edu',
    careerCenterUrl: 'https://career.example.edu',
    badgeImage: 'assets/badges/career-explorer-badge.svg',
    certificateBackground: 'assets/certificate.png'
  }
];

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
  ensureDir(PATHS.docsRegistryDir);
  ensureDir(PATHS.adminDir);

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
  return {
    ...DEFAULT_CERTIFICATE_TEMPLATE,
    ...stored,
    name: {
      ...DEFAULT_CERTIFICATE_TEMPLATE.name,
      ...(stored.name || {})
    },
    date: {
      ...DEFAULT_CERTIFICATE_TEMPLATE.date,
      ...(stored.date || {})
    }
  };
}

function loadBadgeTemplates() {
  return readJson(PATHS.templatesFile, DEFAULT_BADGE_TEMPLATES);
}

function loadBadges() {
  const badges = readJson(PATHS.badgesFile, []);
  return Array.isArray(badges) ? badges : [];
}

function saveBadges(badges) {
  writeJson(PATHS.badgesFile, badges);
  writeText(PATHS.badgeLinksCsvFile, buildBadgeLinksCsv(badges));
}

function saveBadgeTemplates(templates) {
  writeJson(PATHS.templatesFile, templates);
}

function saveSiteConfig(config) {
  writeJson(PATHS.siteConfigFile, config);
}

function saveCertificateTemplate(config) {
  writeJson(PATHS.certificateTemplateFile, config);
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

module.exports = {
  PATHS,
  ROOT,
  DEFAULT_SITE_CONFIG,
  DEFAULT_CERTIFICATE_TEMPLATE,
  DEFAULT_BADGE_TEMPLATES,
  ensureDir,
  ensureDataFiles,
  fileExists,
  readJson,
  writeJson,
  writeText,
  loadSiteConfig,
  loadCertificateTemplate,
  loadBadgeTemplates,
  loadBadges,
  saveBadges,
  saveBadgeTemplates,
  saveSiteConfig,
  saveCertificateTemplate,
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
  computeBadgeStats,
  removeDirectoryContents,
  normalizeUrl,
  hasConfiguredPublicUrl
};
