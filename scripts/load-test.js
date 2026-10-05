#!/usr/bin/env node
/*
 * Load test: runs the real server against a throwaway copy of the app seeded with
 * thousands of badges and analytics events, then exercises the busiest routes and
 * reports timings, peak memory, and correctness checks.
 *
 * Usage: node scripts/load-test.js [--badges 5000] [--events 50000] [--keep] [--seed-only]
 *   --keep       leave the temporary workspace on disk afterwards
 *   --seed-only  only build the seeded workspace (for profiling) and print its path
 *   --heap N     override the --max-old-space-size taken from the npm start script
 *
 * Nothing in this checkout's data/ or docs/ folders is touched, and nothing is sent to the
 * real GitHub: sync runs against an in-memory mock of the Git Data API, which also lets the
 * test verify the shutdown push and a fresh-deploy restore.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? Number(process.argv[index + 1]) : fallback;
}

const BADGE_COUNT = argValue('--badges', 5000);
const EVENT_COUNT = argValue('--events', 50000);
const KEEP = process.argv.includes('--keep');
const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const START_FLAGS = argValue('--heap', 0)
  ? `--max-old-space-size=${argValue('--heap', 0)}`
  : (String(require(path.join(ROOT, 'package.json')).scripts.start || '').match(/--max-old-space-size=\d+/) || [])[0];
const MEMORY_BUDGET_MB = 450;
const ADMIN_PASSWORD = 'load-test-admin';
const PUBLIC_PASSWORD = 'load-test-public';

const results = [];
let failures = 0;

function check(label, ok, detail = '') {
  results.push({ label, ok, detail });
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

function copyDir(source, target, skip = () => false) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (skip(from, entry)) continue;
    if (entry.isDirectory()) copyDir(from, to, skip);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

function prepareWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ebadge-load-'));
  for (const file of ['server.js', 'build-site.js', 'package.json']) {
    fs.copyFileSync(path.join(ROOT, file), path.join(dir, file));
  }
  copyDir(path.join(ROOT, 'lib'), path.join(dir, 'lib'), (from) => from.endsWith('.bak'));
  copyDir(path.join(ROOT, 'admin'), path.join(dir, 'admin'));
  copyDir(path.join(ROOT, 'docs', 'assets'), path.join(dir, 'docs', 'assets'), (from) => from.includes(`${path.sep}uploads${path.sep}`));
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  for (const file of ['badge-catalog.json', 'certificate-template.json', 'site-config.json']) {
    const source = path.join(ROOT, 'data', file);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(dir, 'data', file));
  }
  return dir;
}

function seedData(dir) {
  // Use the workspace's own store so seeded records match the app's format exactly.
  const store = require(path.join(dir, 'lib', 'store.js'));
  store.ensureDataFiles();
  const templates = store.loadBadgeTemplates();
  const siteConfig = store.loadSiteConfig();
  const certificateTemplate = store.loadCertificateTemplate();
  const badges = [];
  const start = Date.UTC(2025, 0, 1);
  for (let index = 0; index < BADGE_COUNT; index += 1) {
    const template = templates[index % templates.length];
    const created = new Date(start + index * 3600 * 1000);
    const iso = created.toISOString().slice(0, 10);
    const badge = {
      id: `${String(siteConfig.credentialPrefix || 'CCE').toUpperCase()}-${iso.replace(/-/g, '')}-${String((index % 24) + 1).padStart(4, '0')}`,
      awardeeName: `Load Tester ${index}`,
      awardeeEmail: `tester${index}@example.edu`,
      issueDate: store.formatLongDate(created),
      issueDateISO: iso,
      badgeTemplateId: template.id,
      badgeTitle: template.title,
      badgeLabel: template.badgeLabel || template.title,
      description: template.description,
      publicSummary: template.publicSummary,
      meaning: template.meaning,
      criteria: template.criteria,
      skills: template.skills,
      standards: template.standards,
      issuerName: template.issuerName,
      issuerOrganization: template.issuerOrganization,
      issuerWebsite: template.issuerWebsite,
      careerCenterUrl: template.careerCenterUrl,
      badgeImage: template.badgeImage,
      certificateBackground: template.certificateBackground,
      certificateTemplateApplied: store.getCertificateTemplateForTemplate(template, certificateTemplate),
      status: 'valid',
      neverExpires: true,
      createdAt: created.toISOString(),
      source: 'load-test'
    };
    badge.slug = store.buildBadgeSlug(badge);
    badge.publicUrl = store.getPublicBadgeUrl(siteConfig, badge.slug);
    badge.repoPath = `docs/badges/${badge.slug}/index.html`;
    badge.detailsJsonPath = `docs/badges/${badge.slug}/details.json`;
    badges.push(badge);
  }
  store.saveBadges(badges);

  const lines = [];
  const types = ['badge_viewed', 'certificate_downloaded', 'generator_opened', 'badge_issued'];
  for (let index = 0; index < EVENT_COUNT; index += 1) {
    const badge = badges[index % badges.length];
    const timestamp = new Date(start + index * 600 * 1000).toISOString();
    lines.push(
      JSON.stringify({
        id: `evt-${index}`,
        type: types[index % types.length],
        timestamp,
        monthKey: timestamp.slice(0, 7),
        yearKey: timestamp.slice(0, 4),
        badgeId: badge.id,
        badgeSlug: badge.slug,
        badgeTitle: badge.badgeTitle,
        badgeTemplateId: badge.badgeTemplateId,
        awardeeName: badge.awardeeName,
        visitorId: `visitor-${index % 900}`
      })
    );
  }
  fs.writeFileSync(path.join(dir, 'data', 'analytics-events.ndjson'), `${lines.join('\n')}\n`);
  store.syncAppStateFromFiles();
  return { badges, templates };
}

function rssMb(pid) {
  try {
    const kb = Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)]).toString().trim());
    return Math.round(kb / 1024);
  } catch {
    return 0;
  }
}

function startServer(dir, extraEnv = {}) {
  const child = spawn(process.execPath, [...(START_FLAGS ? [START_FLAGS] : []), 'server.js'], {
    cwd: dir,
    env: {
      PATH: process.env.PATH,
      PORT: String(PORT),
      ADMIN_PASSWORD,
      PUBLIC_PASSWORD,
      NODE_ENV: 'test',
      ...(process.env.NODE_OPTIONS ? { NODE_OPTIONS: process.env.NODE_OPTIONS } : {}),
      ...extraEnv
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const relay = (label) => (chunk) => {
    for (const line of String(chunk).split('\n')) {
      if (line.trim() && !line.startsWith('Published badge')) {
        process.stdout.write(`  [${label}] ${line}\n`);
      }
    }
  };
  child.stdout.on('data', relay('server'));
  child.stderr.on('data', relay('server:err'));
  return child;
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 30000))]);
}

function sampleMemory(child) {
  const state = { peak: 0 };
  const timer = setInterval(() => {
    state.peak = Math.max(state.peak, rssMb(child.pid));
  }, 200);
  state.stop = () => clearInterval(timer);
  return state;
}

/*
 * Minimal in-memory stand-in for the GitHub Git Data API endpoints used by
 * lib/github-sync.js (refs, commits, recursive trees, blobs). It records every commit so
 * the test can confirm that later pushes only upload files that actually changed.
 */
function startMockGithub(port) {
  const sha1 = (data) => crypto.createHash('sha1').update(data).digest('hex');
  const blobs = new Map();
  const trees = new Map();
  const commits = new Map();
  const refs = new Map();
  const commitLog = [];
  const stats = { blobUploads: 0, blobBytes: 0, blobDownloads: 0 };

  const saveTree = (entries) => {
    const sorted = [...entries.values()].sort((a, b) => a.path.localeCompare(b.path));
    const sha = sha1(JSON.stringify(sorted));
    trees.set(sha, sorted);
    return sha;
  };
  const emptyTree = saveTree(new Map());
  const rootCommit = sha1('root');
  commits.set(rootCommit, { sha: rootCommit, tree: { sha: emptyTree }, parents: [] });
  refs.set('main', rootCommit);

  const send = (response, status, payload, contentType = 'application/json') => {
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload));
    response.writeHead(status, { 'Content-Type': contentType, 'Content-Length': body.length });
    response.end(body);
  };

  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const body = raw.length ? JSON.parse(raw.toString('utf8')) : {};
    const url = new URL(request.url, 'http://mock');
    const parts = url.pathname.split('/').filter(Boolean);
    const [, , , ...rest] = parts;
    const route = rest.join('/');

    if (parts.length === 3 && request.method === 'GET') return send(response, 200, { default_branch: 'main' });
    if (route.startsWith('git/ref/heads/') && request.method === 'GET') {
      const sha = refs.get(decodeURIComponent(route.slice('git/ref/heads/'.length)));
      return sha ? send(response, 200, { object: { sha } }) : send(response, 404, { message: 'Not Found' });
    }
    if (route === 'git/refs' && request.method === 'POST') {
      refs.set(body.ref.replace('refs/heads/', ''), body.sha);
      return send(response, 201, { object: { sha: body.sha } });
    }
    if (route.startsWith('git/refs/heads/') && request.method === 'PATCH') {
      refs.set(decodeURIComponent(route.slice('git/refs/heads/'.length)), body.sha);
      return send(response, 200, { object: { sha: body.sha } });
    }
    if (route.startsWith('git/commits/') && request.method === 'GET') {
      const commit = commits.get(route.slice('git/commits/'.length));
      return commit ? send(response, 200, commit) : send(response, 404, { message: 'Not Found' });
    }
    if (route === 'git/commits' && request.method === 'POST') {
      const sha = sha1(JSON.stringify(body) + commits.size);
      commits.set(sha, { sha, tree: { sha: body.tree }, parents: body.parents, message: body.message });
      return send(response, 201, { sha, tree: { sha: body.tree } });
    }
    if (route.startsWith('git/trees/') && request.method === 'GET') {
      const tree = trees.get(route.slice('git/trees/'.length));
      return tree ? send(response, 200, { sha: route.slice(10), truncated: false, tree }) : send(response, 404, { message: 'Not Found' });
    }
    if (route === 'git/trees' && request.method === 'POST') {
      const entries = new Map((trees.get(body.base_tree) || []).map((entry) => [entry.path, entry]));
      let uploaded = 0;
      let deleted = 0;
      for (const entry of body.tree) {
        if (entry.sha === null) {
          entries.delete(entry.path);
          deleted += 1;
        } else {
          entries.set(entry.path, { path: entry.path, mode: entry.mode, type: 'blob', sha: entry.sha });
          uploaded += 1;
        }
      }
      const sha = saveTree(entries);
      commitLog.push({ uploaded, deleted, totalFiles: entries.size, paths: body.tree.filter((entry) => entry.sha).map((entry) => entry.path) });
      return send(response, 201, { sha });
    }
    if (route === 'git/blobs' && request.method === 'POST') {
      const content = Buffer.from(body.content, 'base64');
      const sha = sha1(Buffer.concat([Buffer.from(`blob ${content.length}\0`), content]));
      blobs.set(sha, content);
      stats.blobUploads += 1;
      stats.blobBytes += content.length;
      return send(response, 201, { sha });
    }
    if (route.startsWith('git/blobs/') && request.method === 'GET') {
      const content = blobs.get(route.slice('git/blobs/'.length));
      stats.blobDownloads += 1;
      return content ? send(response, 200, content, 'application/vnd.github.raw') : send(response, 404, { message: 'Not Found' });
    }
    send(response, 404, { message: `Mock does not implement ${request.method} ${url.pathname}` });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${port}`,
        stats,
        commitLog,
        headFiles(branch = 'badge-data') {
          const commit = commits.get(refs.get(branch));
          const tree = commit ? trees.get(commit.tree.sha) : [];
          return new Map((tree || []).map((entry) => [entry.path, blobs.get(entry.sha)]));
        },
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

async function waitFor(fn, timeoutMs, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

async function timed(fn) {
  const started = performance.now();
  const value = await fn();
  return { value, ms: Math.round(performance.now() - started) };
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] || 0;
}

async function runConcurrent(count, concurrency, task) {
  const durations = [];
  const statuses = {};
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < count) {
        const index = next;
        next += 1;
        const started = performance.now();
        let status = 0;
        try {
          status = await task(index);
        } catch {
          status = -1;
        }
        durations.push(performance.now() - started);
        statuses[status] = (statuses[status] || 0) + 1;
      }
    })
  );
  return { p50: Math.round(percentile(durations, 50)), p95: Math.round(percentile(durations, 95)), statuses };
}

async function main() {
  console.log(`Preparing workspace with ${BADGE_COUNT} badges and ${EVENT_COUNT} analytics events...`);
  const dir = prepareWorkspace();
  const { badges, templates } = seedData(dir);
  const templateId = templates[0].id;
  console.log(`Workspace: ${dir}`);
  if (process.argv.includes('--seed-only')) {
    return;
  }

  const mock = await startMockGithub(PORT + 1);
  const syncEnv = { GITHUB_TOKEN: 'load-test-token', GITHUB_REPO: 'csun/ebadge-load-test', GITHUB_API_BASE: mock.url };
  const child = startServer(dir, syncEnv);
  const memory = sampleMemory(child);
  let expectedTotal = 0;
  let restoreDir = '';

  try {
    const portOpen = await timed(() => waitFor(() => fetch(`${BASE}/healthz`).then((r) => r.ok), 15000, 50));
    check('Port opens before data finishes loading', Boolean(portOpen.value), `${portOpen.ms} ms`);

    const starting = await fetch(`${BASE}/registry/`).catch(() => null);
    if (starting && starting.status === 503) {
      check('Starting-up page is served while loading', true, '503 with auto-refresh');
    }

    const ready = await timed(() => waitFor(() => fetch(`${BASE}/healthz`).then((r) => r.json()).then((j) => j.ready), 120000, 100));
    check('App becomes ready', Boolean(ready.value), `${ready.ms} ms after port opened; RSS ${rssMb(child.pid)} MB`);

    const sampleBadge = badges[Math.floor(badges.length / 2)];
    const badgePage = await fetch(`${BASE}/badges/${sampleBadge.slug}/`);
    check('Badge page served right after startup (on-demand generation)', badgePage.status === 200, `status ${badgePage.status}`);
    let etag = badgePage.headers.get('etag');
    await badgePage.text();
    if (etag) {
      // The startup background rebuild may rewrite the page (new ETag) between requests.
      let revalidatedStatus = 0;
      for (let attempt = 0; attempt < 5 && revalidatedStatus !== 304; attempt += 1) {
        const revalidated = await fetch(`${BASE}/badges/${sampleBadge.slug}/`, { headers: { 'if-none-match': etag } });
        revalidatedStatus = revalidated.status;
        etag = revalidated.headers.get('etag') || etag;
        await revalidated.arrayBuffer();
      }
      check('ETag revalidation returns 304', revalidatedStatus === 304, `status ${revalidatedStatus}`);
    }

    const details = await fetch(`${BASE}/badges/${sampleBadge.slug}/details.json`).then((r) => r.json());
    check('details.json does not expose the recipient email', details && details.id === sampleBadge.id && !('awardeeEmail' in details));

    const traversal = await fetch(`${BASE}/%2e%2e/%2e%2e/etc/passwd`);
    check('Path traversal is rejected', traversal.status === 404, `status ${traversal.status}`);

    // Public session for protected data feeds.
    const access = await fetch(`${BASE}/access`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password: PUBLIC_PASSWORD, next: '/' }).toString() });
    const publicCookie = String(access.headers.get('set-cookie') || '').split(';')[0];
    const feed = await fetch(`${BASE}/data/badges.json`, { headers: { cookie: publicCookie } }).then((r) => r.json());
    check('Registry feed lists every badge', Array.isArray(feed) && feed.length === BADGE_COUNT, `${Array.isArray(feed) ? feed.length : 'n/a'} badges`);
    check('Registry feed does not expose recipient emails', Array.isArray(feed) && feed.every((badge) => !('awardeeEmail' in badge)));

    const views = await runConcurrent(400, 40, async (index) => {
      const badge = badges[index % badges.length];
      const response = await fetch(`${BASE}/badges/${badge.slug}/`);
      await response.arrayBuffer();
      return response.status;
    });
    check('400 badge page views (40 concurrent)', (views.statuses[200] || 0) === 400, `p50 ${views.p50} ms, p95 ${views.p95} ms, statuses ${JSON.stringify(views.statuses)}`);

    const tracking = await runConcurrent(200, 40, async (index) => {
      const badge = badges[index % badges.length];
      const response = await fetch(`${BASE}/api/analytics/track`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'badge_viewed', badgeId: badge.id, badgeSlug: badge.slug, badgeTitle: badge.badgeTitle })
      });
      await response.arrayBuffer();
      return response.status;
    });
    check('200 analytics events accepted with 202', (tracking.statuses[202] || 0) === 200, `p50 ${tracking.p50} ms, p95 ${tracking.p95} ms`);

    const issued = [];
    const issuing = await runConcurrent(30, 10, async (index) => {
      const response = await fetch(`${BASE}/api/public/issue`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          awardeeName: `Public Issuer ${index}`,
          awardeeEmail: `public${index}@example.edu`,
          issueDate: 'October 5, 2026',
          badgeTemplateId: templateId,
          pageKind: 'general',
          badgeTitle: 'INJECTED TITLE',
          badgeImageUploadDataUrl: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (payload && payload.badge) issued.push(payload.badge);
      return response.status;
    });
    check('30 public generator issues (10 concurrent)', (issuing.statuses[201] || 0) === 30, `p50 ${issuing.p50} ms, p95 ${issuing.p95} ms, statuses ${JSON.stringify(issuing.statuses)}`);
    const ids = new Set(issued.map((badge) => badge.id));
    check('Concurrent issues receive unique credential IDs', ids.size === issued.length, `${ids.size}/${issued.length} unique`);
    check('Public issue ignores fields other than recipient details', issued.every((badge) => badge.badgeTitle !== 'INJECTED TITLE'));

    const missingTemplate = await fetch(`${BASE}/api/public/issue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ awardeeName: 'No Template', awardeeEmail: 'none@example.edu' })
    });
    check('Public issue requires a template', missingTemplate.status === 400, `status ${missingTemplate.status}`);

    const oversized = await fetch(`${BASE}/api/public/issue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ awardeeName: 'x'.repeat(400 * 1024) })
    }).catch(() => null);
    check('Oversized public request is rejected', Boolean(oversized) && oversized.status === 413, `status ${oversized ? oversized.status : 'connection closed'}`);

    const lookup = await fetch(`${BASE}/api/public/badges-by-email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: sampleBadge.awardeeEmail })
    }).then((r) => r.json());
    check('Lookup by email finds the badge', lookup.ok && lookup.matches.some((match) => match.id === sampleBadge.id));

    // Admin flows.
    const login = await fetch(`${BASE}/admin/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password: ADMIN_PASSWORD }).toString() });
    const adminCookie = String(login.headers.get('set-cookie') || '').split(';')[0];
    check('Admin login works', login.status === 302 && adminCookie.startsWith('badge_admin_session='));
    const adminHeaders = { cookie: adminCookie, 'content-type': 'application/x-www-form-urlencoded' };

    const dashboard = await timed(() => fetch(`${BASE}/admin`, { headers: { cookie: adminCookie } }).then((r) => r.text()));
    check('Admin dashboard renders', dashboard.value.includes('</html>'), `${dashboard.ms} ms`);

    const analyticsPage = await timed(() => fetch(`${BASE}/admin/analytics`, { headers: { cookie: adminCookie } }).then((r) => r.status));
    check('Analytics page renders with all events', analyticsPage.value === 200, `${analyticsPage.ms} ms; RSS ${rssMb(child.pid)} MB`);

    const filteredAnalytics = await timed(() => fetch(`${BASE}/admin/analytics?year=2025`, { headers: { cookie: adminCookie } }).then((r) => r.status));
    check('Filtered analytics page renders', filteredAnalytics.value === 200, `${filteredAnalytics.ms} ms`);

    const csvRows = ['awardee_name,awardee_email,issue_date'];
    for (let index = 0; index < 200; index += 1) csvRows.push(`Bulk Person ${index},bulk${index}@example.edu,2026-10-05`);
    const validate = await fetch(`${BASE}/admin/bulk-issue/validate`, {
      method: 'POST',
      redirect: 'manual',
      headers: adminHeaders,
      body: new URLSearchParams({ badgeTemplateId: templateId, issueDateMode: 'today', csvContent: csvRows.join('\n') }).toString()
    });
    const jobId = new URL(validate.headers.get('location') || '/', BASE).searchParams.get('job');
    check('Bulk issue CSV validates', Boolean(jobId), jobId || `status ${validate.status}`);

    const bulkStarted = performance.now();
    await fetch(`${BASE}/admin/bulk-issue/start`, { method: 'POST', redirect: 'manual', headers: adminHeaders, body: new URLSearchParams({ jobId }).toString() });
    const secondClick = await fetch(`${BASE}/admin/bulk-issue/start`, { method: 'POST', redirect: 'manual', headers: adminHeaders, body: new URLSearchParams({ jobId }).toString() });
    check('Double-clicking start does not start the job twice', String(secondClick.headers.get('location') || '').includes('/progress'));
    const finishedJob = await waitFor(async () => {
      const { jobs } = await fetch(`${BASE}/admin/bulk-issue/jobs.json`, { headers: { cookie: adminCookie } }).then((r) => r.json());
      const job = jobs.find((entry) => entry.id === jobId);
      return job && job.status !== 'processing' && job.status !== 'validated' ? job : null;
    }, 180000, 250);
    const bulkMs = Math.round(performance.now() - bulkStarted);
    check('Bulk issue of 200 rows completes', finishedJob && finishedJob.completedRows === 200, finishedJob ? `${finishedJob.status}, ${finishedJob.completedRows} issued in ${bulkMs} ms` : 'timed out');

    expectedTotal = BADGE_COUNT + issued.length + (finishedJob ? finishedJob.completedRows : 0);
    const stored = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'badges.json'), 'utf8'));
    const allIds = new Set(stored.map((badge) => badge.id));
    check('All credential IDs remain unique after concurrent and bulk issuing', allIds.size === stored.length && stored.length === expectedTotal, `${allIds.size} unique of ${stored.length} stored, ${expectedTotal} expected`);

    // The public feed is rebuilt on a short throttle, so allow it a few seconds to catch up.
    const feedCaughtUp = await waitFor(async () => {
      const feedNow = await fetch(`${BASE}/data/badges.json`, { headers: { cookie: publicCookie } }).then((r) => r.json());
      return feedNow.length === expectedTotal ? feedNow : null;
    }, 15000, 500);
    check('Public registry feed catches up with every issued badge', Boolean(feedCaughtUp), feedCaughtUp ? `${feedCaughtUp.length} badges` : 'feed did not update within 15 s');

    const adminPages = ['/admin/issue', '/admin/bulk-issue', '/admin/templates', '/admin/settings', '/admin/email', '/admin/email-log', '/admin/debug-log', '/admin/jobs', '/admin/backups'];
    const pageStatuses = await Promise.all(adminPages.map((page) => fetch(`${BASE}${page}`, { headers: { cookie: adminCookie } }).then(async (r) => { await r.arrayBuffer(); return `${page}:${r.status}`; })));
    check('Every admin page renders', pageStatuses.every((entry) => entry.endsWith(':200')), pageStatuses.filter((entry) => !entry.endsWith(':200')).join(', ') || `${adminPages.length} pages`);

    const snapshot = await fetch(`${BASE}/admin/backups/snapshot`, { method: 'POST', redirect: 'manual', headers: adminHeaders, body: '' });
    check('Manual backup snapshot succeeds', snapshot.status === 302 && !/error|fail/i.test(String(snapshot.headers.get('location') || '')), String(snapshot.headers.get('location') || snapshot.status));

    const exported = await fetch(`${BASE}/admin/export/app-state`, { headers: { cookie: adminCookie } }).then((r) => r.json());
    check('Full export includes every badge and the analytics events', exported.appState && exported.appState.badges.length === expectedTotal && Array.isArray(exported.appState.analyticsEvents) && exported.appState.analyticsEvents.length >= EVENT_COUNT, `${exported.appState ? exported.appState.badges.length : 0} badges, ${exported.appState && exported.appState.analyticsEvents ? exported.appState.analyticsEvents.length : 0} events`);
    check('Full export does not include the Brevo API key', !('emailBrevoApiKey' in ((exported.appState && exported.appState.siteConfig) || {})) || !exported.appState.siteConfig.emailBrevoApiKey);

    const csvExport = await fetch(`${BASE}/admin/export/analytics.csv`, { headers: { cookie: adminCookie } });
    const csvText = await csvExport.text();
    check('Analytics CSV export streams every event', csvExport.status === 200 && csvText.split('\n').filter(Boolean).length > EVENT_COUNT, `${csvText.split('\n').filter(Boolean).length - 1} rows`);

    const healthz = await fetch(`${BASE}/healthz`).then((r) => r.json());
    check('Health check stays up after load', healthz.ok === true);

    // Shutdown (Render's SIGTERM on redeploy) must push every pending change.
    await stopServer(child);
    memory.stop();
    // Render's free plan stops the service at 512 MB; keep a safety margin below that.
    check(`Peak server memory stays under ${MEMORY_BUDGET_MB} MB`, memory.peak > 0 && memory.peak < MEMORY_BUDGET_MB, `${memory.peak} MB peak RSS (${START_FLAGS || 'default heap'})`);

    const appState = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'app-state.json'), 'utf8'));
    check('app-state.json excludes analytics events and the API key', !('analyticsEvents' in appState) && !('emailBrevoApiKey' in (appState.siteConfig || {})));
    check('app-state.json was brought up to date before the final push', Array.isArray(appState.badges) && appState.badges.length === expectedTotal, `${appState.badges ? appState.badges.length : 0} badges`);

    const remote = mock.headFiles();
    const remoteBadges = remote.get('data/badges.json');
    const localBadges = fs.readFileSync(path.join(dir, 'data', 'badges.json'));
    check('GitHub has the final badges.json after shutdown', Boolean(remoteBadges) && remoteBadges.equals(localBadges), remoteBadges ? `${JSON.parse(remoteBadges).length} badges on GitHub` : 'missing');
    const remoteAppState = remote.get('data/app-state.json');
    check('GitHub app-state.json matches the pushed badges', Boolean(remoteAppState) && JSON.parse(remoteAppState).badges.length === expectedTotal);
    const [firstPush, ...laterPushes] = mock.commitLog;
    const largestLater = laterPushes.reduce((max, push) => Math.max(max, push.uploaded), 0);
    check(
      'Later pushes upload only changed files',
      Boolean(firstPush) && laterPushes.length > 0 && largestLater < firstPush.totalFiles,
      `${mock.commitLog.length} commits; first uploaded ${firstPush ? firstPush.uploaded : 0} files, later pushes at most ${largestLater} of ${firstPush ? firstPush.totalFiles : 0}`
    );
    const remoteBackupIds = new Set([...remote.keys()].map((repoPath) => (repoPath.match(/^data\/backups\/([^/]+)\//) || [])[1]).filter(Boolean));
    check('Backups on GitHub match the local backups after retention', remoteBackupIds.size > 0 && remoteBackupIds.size === fs.readdirSync(path.join(dir, 'data', 'backups')).filter((name) => name !== 'manifest.json').length, `${remoteBackupIds.size} snapshot(s)`);

    // A fresh deploy starts from an empty checkout and must restore everything from GitHub.
    restoreDir = prepareWorkspace();
    const restored = startServer(restoreDir, syncEnv);
    const restoreMemory = sampleMemory(restored);
    const downloadsBefore = mock.stats.blobDownloads;
    const restoreReady = await timed(() => waitFor(() => fetch(`${BASE}/healthz`).then((r) => r.json()).then((j) => j.ready), 120000, 100));
    check('Fresh deploy restores from GitHub and becomes ready', Boolean(restoreReady.value), `${restoreReady.ms} ms, ${mock.stats.blobDownloads - downloadsBefore} files downloaded`);
    const restoredAccess = await fetch(`${BASE}/access`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password: PUBLIC_PASSWORD, next: '/' }).toString() });
    const restoredCookie = String(restoredAccess.headers.get('set-cookie') || '').split(';')[0];
    const restoredFeed = await fetch(`${BASE}/data/badges.json`, { headers: { cookie: restoredCookie } }).then((r) => r.json());
    check('Restored registry has every badge', restoredFeed.length === expectedTotal, `${restoredFeed.length} of ${expectedTotal}`);
    const restoredPage = await fetch(`${BASE}/badges/${restoredFeed[0].slug}/`);
    check('Restored badge pages are served', restoredPage.status === 200, `status ${restoredPage.status}`);
    await restoredPage.arrayBuffer();
    await stopServer(restored);
    restoreMemory.stop();
    check(`Restore peak memory stays under ${MEMORY_BUDGET_MB} MB`, restoreMemory.peak > 0 && restoreMemory.peak < MEMORY_BUDGET_MB, `${restoreMemory.peak} MB peak RSS`);
  } finally {
    memory.stop();
    await stopServer(child);
    await mock.close();
    for (const workspace of [dir, restoreDir].filter(Boolean)) {
      if (!KEEP) {
        fs.rmSync(workspace, { recursive: true, force: true });
      } else {
        console.log(`Workspace kept at ${workspace}`);
      }
    }
  }

  console.log(`\n${results.length - failures}/${results.length} checks passed.`);
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
