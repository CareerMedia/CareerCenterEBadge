const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  PATHS,
  ensureDir,
  fileExists,
  loadBadges,
  loadBadgeTemplates,
  loadAppState,
  saveAppState,
  writeJson,
  writeText,
  appendText
} = require('./store');

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

function readNdjson(filePath) {
  if (!fileExists(filePath)) {
    return [];
  }
  const text = fs.readFileSync(filePath, 'utf8');
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

function writeNdjson(filePath, rows) {
  ensureDir(path.dirname(filePath));
  const content = rows.map((row) => JSON.stringify(row)).join('\n');
  writeText(filePath, content ? `${content}\n` : '');
}

function loadAnalyticsEvents() {
  return readNdjson(PATHS.analyticsEventsFile);
}

function saveAnalyticsEvents(events) {
  writeNdjson(PATHS.analyticsEventsFile, Array.isArray(events) ? events : []);
  syncAnalyticsIntoAppState();
}

function loadAnalyticsSummary() {
  if (!fileExists(PATHS.analyticsSummaryFile)) {
    return { ...DEFAULT_ANALYTICS_SUMMARY };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(PATHS.analyticsSummaryFile, 'utf8'));
    return {
      ...DEFAULT_ANALYTICS_SUMMARY,
      ...parsed,
      totals: {
        ...DEFAULT_ANALYTICS_SUMMARY.totals,
        ...((parsed && parsed.totals) || {})
      }
    };
  } catch (error) {
    return { ...DEFAULT_ANALYTICS_SUMMARY };
  }
}

function saveAnalyticsSummary(summary) {
  writeJson(PATHS.analyticsSummaryFile, {
    ...DEFAULT_ANALYTICS_SUMMARY,
    ...summary,
    totals: {
      ...DEFAULT_ANALYTICS_SUMMARY.totals,
      ...((summary && summary.totals) || {})
    }
  });
  syncAnalyticsIntoAppState();
}

function syncAnalyticsIntoAppState() {
  const state = loadAppState();
  state.analyticsEvents = loadAnalyticsEvents();
  state.analyticsSummary = loadAnalyticsSummary();
  saveAppState(state);
}

function makeEventId() {
  return crypto.randomUUID();
}

function monthKeyFor(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'unknown';
  }
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function yearKeyFor(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'unknown';
  }
  return String(date.getUTCFullYear());
}

function formatMonthLabel(monthKey) {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    return monthKey;
  }
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function currentIsoTimestamp() {
  return new Date().toISOString();
}

function normalizeEvent(input) {
  const timestamp = input.timestamp || currentIsoTimestamp();
  return {
    id: input.id || makeEventId(),
    type: String(input.type || '').trim(),
    timestamp,
    monthKey: monthKeyFor(timestamp),
    yearKey: yearKeyFor(timestamp),
    badgeId: input.badgeId || '',
    badgeSlug: input.badgeSlug || '',
    badgeTitle: input.badgeTitle || '',
    badgeTemplateId: input.badgeTemplateId || '',
    awardeeName: input.awardeeName || '',
    publicUrl: input.publicUrl || '',
    pageKind: input.pageKind || '',
    generatorKey: input.generatorKey || '',
    generatorLabel: input.generatorLabel || '',
    source: input.source || '',
    visitorId: input.visitorId || '',
    requestPath: input.requestPath || '',
    context: input.context || '',
    meta: input.meta && typeof input.meta === 'object' ? input.meta : {}
  };
}

function incrementCounter(record, key, value = 1) {
  record[key] = safeNumber(record[key]) + value;
}

function makeMonthRecord(monthKey) {
  return {
    key: monthKey,
    label: formatMonthLabel(monthKey),
    badgesIssued: 0,
    badgeViews: 0,
    certificateDownloads: 0,
    generatorOpens: 0,
    generatorCompletions: 0,
    uniqueVisitorsApprox: 0,
    conversionRate: 0
  };
}

function makeYearRecord(yearKey) {
  return {
    key: yearKey,
    label: yearKey,
    badgesIssued: 0,
    badgeViews: 0,
    certificateDownloads: 0,
    generatorOpens: 0,
    generatorCompletions: 0,
    uniqueVisitorsApprox: 0,
    conversionRate: 0
  };
}

function buildAnalyticsSummary({ badges = loadBadges(), templates = loadBadgeTemplates(), events = loadAnalyticsEvents() } = {}) {
  const now = currentIsoTimestamp();
  const monthMap = new Map();
  const yearMap = new Map();
  const badgeTypeMap = new Map();
  const badgePageMap = new Map();
  const generatorMap = new Map();
  const recipientMap = new Map();
  const totalVisitors = new Set();
  const visitorsByMonth = new Map();
  const visitorsByYear = new Map();

  function getMonthRecord(key) {
    if (!monthMap.has(key)) {
      monthMap.set(key, makeMonthRecord(key));
    }
    return monthMap.get(key);
  }

  function getYearRecord(key) {
    if (!yearMap.has(key)) {
      yearMap.set(key, makeYearRecord(key));
    }
    return yearMap.get(key);
  }

  function getBadgeTypeRecord(id, title) {
    const key = id || title || 'unassigned';
    if (!badgeTypeMap.has(key)) {
      badgeTypeMap.set(key, {
        id: id || key,
        title: title || id || 'Unassigned badge type',
        badgesIssued: 0,
        badgeViews: 0,
        certificateDownloads: 0,
        generatorOpens: 0,
        generatorCompletions: 0,
        conversionRate: 0
      });
    }
    const record = badgeTypeMap.get(key);
    if (!record.title && title) {
      record.title = title;
    }
    return record;
  }

  function getBadgePageRecord(badge) {
    const key = badge.slug || badge.badgeSlug || badge.id || badge.badgeId;
    if (!badgePageMap.has(key)) {
      badgePageMap.set(key, {
        slug: badge.slug || badge.badgeSlug || '',
        badgeId: badge.id || badge.badgeId || '',
        awardeeName: badge.awardeeName || '',
        badgeTitle: badge.badgeTitle || '',
        badgeTemplateId: badge.badgeTemplateId || '',
        publicUrl: badge.publicUrl || '',
        badgesIssued: 0,
        badgeViews: 0,
        certificateDownloads: 0,
        latestViewedAt: ''
      });
    }
    const record = badgePageMap.get(key);
    if (badge.publicUrl && !record.publicUrl) record.publicUrl = badge.publicUrl;
    if (badge.awardeeName && !record.awardeeName) record.awardeeName = badge.awardeeName;
    if (badge.badgeTitle && !record.badgeTitle) record.badgeTitle = badge.badgeTitle;
    if (badge.badgeTemplateId && !record.badgeTemplateId) record.badgeTemplateId = badge.badgeTemplateId;
    if (badge.id && !record.badgeId) record.badgeId = badge.id;
    if (badge.slug && !record.slug) record.slug = badge.slug;
    return record;
  }

  function getGeneratorRecord(key, label) {
    const stableKey = key || 'general';
    if (!generatorMap.has(stableKey)) {
      generatorMap.set(stableKey, {
        key: stableKey,
        label: label || (stableKey === 'general' ? 'General generator' : stableKey),
        pageKind: stableKey === 'general' ? 'general' : 'specific',
        templateId: stableKey === 'general' ? '' : stableKey,
        opens: 0,
        completions: 0,
        conversionRate: 0
      });
    }
    const record = generatorMap.get(stableKey);
    if (label && !record.label) record.label = label;
    return record;
  }

  function getRecipientRecord(name) {
    const key = String(name || '').trim() || 'Unknown recipient';
    if (!recipientMap.has(key)) {
      recipientMap.set(key, {
        awardeeName: key,
        badgesIssued: 0,
        badgeViews: 0,
        certificateDownloads: 0
      });
    }
    return recipientMap.get(key);
  }

  const templateMap = new Map(templates.map((template) => [template.id, template]));

  for (const badge of badges) {
    const issueTimestamp = badge.createdAt || (badge.issueDateISO ? `${badge.issueDateISO}T12:00:00.000Z` : now);
    const monthRecord = getMonthRecord(monthKeyFor(issueTimestamp));
    const yearRecord = getYearRecord(yearKeyFor(issueTimestamp));
    incrementCounter(monthRecord, 'badgesIssued');
    incrementCounter(yearRecord, 'badgesIssued');

    const template = templateMap.get(badge.badgeTemplateId) || {};
    const badgeType = getBadgeTypeRecord(badge.badgeTemplateId || template.id || badge.badgeTitle, template.title || badge.badgeTitle);
    incrementCounter(badgeType, 'badgesIssued');

    const badgePage = getBadgePageRecord(badge);
    incrementCounter(badgePage, 'badgesIssued');

    const recipient = getRecipientRecord(badge.awardeeName);
    incrementCounter(recipient, 'badgesIssued');
  }

  for (const rawEvent of events) {
    const event = normalizeEvent(rawEvent);
    const monthRecord = getMonthRecord(event.monthKey);
    const yearRecord = getYearRecord(event.yearKey);
    const badgeType = getBadgeTypeRecord(event.badgeTemplateId, event.badgeTitle);

    if (event.visitorId) {
      totalVisitors.add(event.visitorId);
      if (!visitorsByMonth.has(event.monthKey)) visitorsByMonth.set(event.monthKey, new Set());
      if (!visitorsByYear.has(event.yearKey)) visitorsByYear.set(event.yearKey, new Set());
      visitorsByMonth.get(event.monthKey).add(event.visitorId);
      visitorsByYear.get(event.yearKey).add(event.visitorId);
    }

    if (event.type === 'badge_viewed') {
      incrementCounter(monthRecord, 'badgeViews');
      incrementCounter(yearRecord, 'badgeViews');
      incrementCounter(badgeType, 'badgeViews');
      const badgePage = getBadgePageRecord({
        slug: event.badgeSlug,
        badgeId: event.badgeId,
        awardeeName: event.awardeeName,
        badgeTitle: event.badgeTitle,
        badgeTemplateId: event.badgeTemplateId,
        publicUrl: event.publicUrl
      });
      incrementCounter(badgePage, 'badgeViews');
      badgePage.latestViewedAt = event.timestamp;
      incrementCounter(getRecipientRecord(event.awardeeName), 'badgeViews');
    }

    if (event.type === 'certificate_downloaded') {
      incrementCounter(monthRecord, 'certificateDownloads');
      incrementCounter(yearRecord, 'certificateDownloads');
      incrementCounter(badgeType, 'certificateDownloads');
      if (event.badgeSlug || event.badgeId) {
        const badgePage = getBadgePageRecord({
          slug: event.badgeSlug,
          badgeId: event.badgeId,
          awardeeName: event.awardeeName,
          badgeTitle: event.badgeTitle,
          badgeTemplateId: event.badgeTemplateId,
          publicUrl: event.publicUrl
        });
        incrementCounter(badgePage, 'certificateDownloads');
      }
      incrementCounter(getRecipientRecord(event.awardeeName), 'certificateDownloads');
    }

    if (event.type === 'generator_opened') {
      incrementCounter(monthRecord, 'generatorOpens');
      incrementCounter(yearRecord, 'generatorOpens');
      incrementCounter(badgeType, 'generatorOpens');
      const generator = getGeneratorRecord(event.generatorKey, event.generatorLabel);
      incrementCounter(generator, 'opens');
    }

    if (event.type === 'generator_completed') {
      incrementCounter(monthRecord, 'generatorCompletions');
      incrementCounter(yearRecord, 'generatorCompletions');
      incrementCounter(badgeType, 'generatorCompletions');
      const generator = getGeneratorRecord(event.generatorKey, event.generatorLabel);
      incrementCounter(generator, 'completions');
    }
  }

  const months = [...monthMap.values()]
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((record) => ({
      ...record,
      uniqueVisitorsApprox: visitorsByMonth.has(record.key) ? visitorsByMonth.get(record.key).size : 0,
      conversionRate: record.generatorOpens ? Number(((record.generatorCompletions / record.generatorOpens) * 100).toFixed(1)) : 0
    }));

  const years = [...yearMap.values()]
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((record) => ({
      ...record,
      uniqueVisitorsApprox: visitorsByYear.has(record.key) ? visitorsByYear.get(record.key).size : 0,
      conversionRate: record.generatorOpens ? Number(((record.generatorCompletions / record.generatorOpens) * 100).toFixed(1)) : 0
    }));

  const badgeTypes = [...badgeTypeMap.values()]
    .map((record) => ({
      ...record,
      conversionRate: record.generatorOpens ? Number(((record.generatorCompletions / record.generatorOpens) * 100).toFixed(1)) : 0
    }))
    .sort((left, right) => (right.badgeViews + right.badgesIssued) - (left.badgeViews + left.badgesIssued));

  const badgePages = [...badgePageMap.values()]
    .sort((left, right) => (right.badgeViews * 1000 + right.certificateDownloads) - (left.badgeViews * 1000 + left.certificateDownloads));

  const generatorPages = [...generatorMap.values()]
    .map((record) => ({
      ...record,
      conversionRate: record.opens ? Number(((record.completions / record.opens) * 100).toFixed(1)) : 0
    }))
    .sort((left, right) => right.opens - left.opens);

  const recipientStats = [...recipientMap.values()]
    .sort((left, right) => (right.badgeViews + right.certificateDownloads + right.badgesIssued) - (left.badgeViews + left.certificateDownloads + left.badgesIssued));

  const totals = months.reduce(
    (accumulator, month) => {
      accumulator.badgesIssued += month.badgesIssued;
      accumulator.badgeViews += month.badgeViews;
      accumulator.certificateDownloads += month.certificateDownloads;
      accumulator.generatorOpens += month.generatorOpens;
      accumulator.generatorCompletions += month.generatorCompletions;
      return accumulator;
    },
    {
      badgesIssued: 0,
      badgeViews: 0,
      certificateDownloads: 0,
      generatorOpens: 0,
      generatorCompletions: 0,
      conversionRate: 0,
      uniqueVisitorsApprox: totalVisitors.size
    }
  );
  totals.conversionRate = totals.generatorOpens
    ? Number(((totals.generatorCompletions / totals.generatorOpens) * 100).toFixed(1))
    : 0;

  return {
    version: 1,
    updatedAt: now,
    totals,
    months,
    years,
    badgeTypes,
    badgePages,
    generatorPages,
    recipientStats
  };
}

function refreshAnalyticsSummary() {
  const summary = buildAnalyticsSummary();
  writeJson(PATHS.analyticsSummaryFile, summary);
  syncAnalyticsIntoAppState();
  return summary;
}

function appendAnalyticsEvent(eventInput) {
  const event = normalizeEvent(eventInput);
  appendText(PATHS.analyticsEventsFile, `${JSON.stringify(event)}\n`);
  const summary = refreshAnalyticsSummary();
  return { event, summary };
}

function backfillIssuedAnalyticsEvents() {
  const badges = loadBadges();
  const events = loadAnalyticsEvents();
  const seenBadgeIds = new Set(
    events.filter((event) => event.type === 'badge_issued').map((event) => String(event.badgeId || '').trim())
  );
  const missing = badges.filter((badge) => badge.id && !seenBadgeIds.has(String(badge.id)));
  if (!missing.length) {
    return { created: 0, events: [] };
  }
  const additions = missing.map((badge) => normalizeEvent({
    type: 'badge_issued',
    timestamp: badge.createdAt || (badge.issueDateISO ? `${badge.issueDateISO}T12:00:00.000Z` : currentIsoTimestamp()),
    badgeId: badge.id,
    badgeSlug: badge.slug,
    badgeTitle: badge.badgeTitle,
    badgeTemplateId: badge.badgeTemplateId,
    awardeeName: badge.awardeeName,
    publicUrl: badge.publicUrl,
    source: badge.source || 'system-backfill',
    context: 'backfill',
    meta: { backfilled: true }
  }));
  const merged = [...events, ...additions].sort((left, right) => String(left.timestamp).localeCompare(String(right.timestamp)));
  writeNdjson(PATHS.analyticsEventsFile, merged);
  const summary = refreshAnalyticsSummary();
  return { created: additions.length, events: additions, summary };
}

function createVisitorId(request) {
  const forwardedFor = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const remote = forwardedFor || String(request.socket && request.socket.remoteAddress || '').trim();
  const userAgent = String(request.headers['user-agent'] || '').trim();
  const input = `${remote}|${userAgent}`;
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 24);
}

function buildAnalyticsCsv(events) {
  const rows = Array.isArray(events) ? events : loadAnalyticsEvents();
  const header = [
    'id',
    'type',
    'timestamp',
    'badge_id',
    'badge_slug',
    'badge_title',
    'badge_template_id',
    'awardee_name',
    'generator_key',
    'page_kind',
    'public_url',
    'visitor_id',
    'request_path',
    'context'
  ];
  const escapeCsv = (value) => {
    const text = String(value == null ? '' : value);
    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };
  const lines = rows.map((event) => [
    event.id,
    event.type,
    event.timestamp,
    event.badgeId,
    event.badgeSlug,
    event.badgeTitle,
    event.badgeTemplateId,
    event.awardeeName,
    event.generatorKey,
    event.pageKind,
    event.publicUrl,
    event.visitorId,
    event.requestPath,
    event.context
  ].map(escapeCsv).join(','));
  return [header.join(','), ...lines].join('\n') + '\n';
}

module.exports = {
  DEFAULT_ANALYTICS_SUMMARY,
  loadAnalyticsEvents,
  saveAnalyticsEvents,
  loadAnalyticsSummary,
  saveAnalyticsSummary,
  buildAnalyticsSummary,
  refreshAnalyticsSummary,
  appendAnalyticsEvent,
  backfillIssuedAnalyticsEvents,
  createVisitorId,
  buildAnalyticsCsv,
  formatMonthLabel
};
