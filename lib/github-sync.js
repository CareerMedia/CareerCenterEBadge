const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const {
  PATHS,
  appendAppErrorLog,
  writeFileAtomic,
  copyFileAtomic,
  flushAppState,
  markAppStateDirty,
  applyBackupRetention
} = require('./store');
const { backupIdFromRepoPath } = require('./backup-retention');

// Overridable only so scripts/load-test.js can point sync at a local mock of the API.
const API_BASE = String(process.env.GITHUB_API_BASE || 'https://api.github.com').replace(/\/+$/, '');
const DEFAULT_TIMEOUT_MS = 30000;
const BLOB_TIMEOUT_MS = 120000;
const MAX_ATTEMPTS = 3;
const TRANSFER_CONCURRENCY = 4;
const LARGE_UPLOAD_BYTES = 2 * 1024 * 1024;
const PUSH_STAGING_DIR = path.join(os.tmpdir(), `ebadge-push-${process.pid}`);

const syncStatus = {
  inFlight: false,
  queuedCount: 0,
  startedAt: '',
  finishedAt: '',
  lastReason: '',
  lastError: ''
};

const STATIC_FILES = [
  { repoPath: 'data/badges.json', localPath: PATHS.badgesFile },
  { repoPath: 'data/badge-links.csv', localPath: PATHS.badgeLinksCsvFile },
  { repoPath: 'data/app-state.json', localPath: PATHS.appStateFile },
  { repoPath: 'data/badge-catalog.json', localPath: PATHS.templatesFile },
  { repoPath: 'data/certificate-template.json', localPath: PATHS.certificateTemplateFile },
  { repoPath: 'data/site-config.json', localPath: PATHS.siteConfigFile },
  { repoPath: 'data/email-config.json', localPath: PATHS.emailConfigFile },
  { repoPath: 'data/deleted-badges.json', localPath: PATHS.deletedBadgesFile },
  { repoPath: 'data/backups/manifest.json', localPath: PATHS.backupManifestFile },
  { repoPath: 'data/audit-log.ndjson', localPath: PATHS.auditLogFile },
  { repoPath: 'data/email-log.ndjson', localPath: PATHS.emailLogFile },
  { repoPath: 'data/app-error-log.ndjson', localPath: PATHS.appErrorLogFile },
  { repoPath: 'data/analytics-events.ndjson', localPath: PATHS.analyticsEventsFile },
  { repoPath: 'data/analytics-summary.json', localPath: PATHS.analyticsSummaryFile },
  { repoPath: 'data/bulk-issue-jobs.json', localPath: PATHS.bulkIssueJobsFile }
];
const STATIC_BY_REPO_PATH = new Map(STATIC_FILES.map((file) => [file.repoPath, file.localPath]));

const RECURSIVE_DIRS = [
  { repoDir: 'data/backups', localDir: PATHS.backupsDir },
  { repoDir: 'docs/assets/uploads', localDir: PATHS.docsUploadsDir }
];

// Copied before each mutation so a failed change can be undone. Uploads and backup
// folders are intentionally excluded; they are only ever added, never edited.
const ROLLBACK_FILES = [
  PATHS.badgesFile,
  PATHS.badgeLinksCsvFile,
  PATHS.templatesFile,
  PATHS.certificateTemplateFile,
  PATHS.siteConfigFile,
  PATHS.emailConfigFile,
  PATHS.deletedBadgesFile,
  PATHS.backupManifestFile,
  PATHS.analyticsSummaryFile,
  PATHS.bulkIssueJobsFile
];
const APPEND_ONLY_ROLLBACK_FILES = [PATHS.auditLogFile, PATHS.analyticsEventsFile];

const remoteState = {
  loaded: false,
  commitSha: '',
  treeSha: '',
  truncated: false,
  shas: new Map()
};

const localShaCache = new Map();

function getConfig() {
  const token = String(process.env.GITHUB_TOKEN || '').trim();
  const repo = String(process.env.GITHUB_REPO || '').trim();
  const branch = String(process.env.GITHUB_DATA_BRANCH || 'badge-data').trim() || 'badge-data';
  const authorName = String(process.env.GITHUB_COMMIT_NAME || 'CSUN Career Center E-Badges').trim() || 'CSUN Career Center E-Badges';
  const authorEmail = String(process.env.GITHUB_COMMIT_EMAIL || 'career.center@csun.edu').trim() || 'career.center@csun.edu';
  return { token, repo, branch, authorName, authorEmail, enabled: Boolean(token && repo) };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(attempt, response) {
  const retryAfter = response ? Number(response.headers.get('retry-after')) : NaN;
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, 30000);
  }
  return 1000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
}

async function githubFetch(endpoint, options = {}) {
  const config = getConfig();
  if (!config.enabled) {
    throw new Error('GitHub sync is not configured. Set GITHUB_TOKEN and GITHUB_REPO on Render.');
  }
  const { timeoutMs = DEFAULT_TIMEOUT_MS, headers = {}, body: bodyOption, ...fetchOptions } = options;

  for (let attempt = 1; ; attempt += 1) {
    let response;
    try {
      const body = typeof bodyOption === 'function' ? bodyOption() : bodyOption;
      response = await fetch(`${API_BASE}${endpoint}`, {
        ...fetchOptions,
        ...(body === undefined ? {} : { body }),
        ...(body && typeof body[Symbol.asyncIterator] === 'function' ? { duplex: 'half' } : {}),
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${config.token}`,
          'User-Agent': 'csun-career-center-ebadges',
          'X-GitHub-Api-Version': '2022-11-28',
          ...headers
        },
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS) {
        const wrapped = new Error(`GitHub request failed (${endpoint.split('?')[0]}): ${error.message || error}`);
        wrapped.cause = error;
        throw wrapped;
      }
      await sleep(retryDelayMs(attempt));
      continue;
    }

    const rateLimited = response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0');
    if ((response.status >= 500 || rateLimited) && attempt < MAX_ATTEMPTS) {
      await response.arrayBuffer().catch(() => null);
      await sleep(retryDelayMs(attempt, response));
      continue;
    }
    return response;
  }
}

async function githubRequest(endpoint, options = {}) {
  const response = await githubFetch(endpoint, options);
  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      payload = text;
    }
  }

  if (!response.ok) {
    const detail = payload && typeof payload === 'object' ? payload.message || JSON.stringify(payload) : String(payload || response.statusText);
    const error = new Error(`GitHub API ${response.status}: ${detail}`);
    error.statusCode = response.status;
    throw error;
  }

  return payload;
}

// Streams the raw blob straight to disk (via a temp file and rename) so large data files
// are never fully buffered in memory. Falls back to the base64 JSON form if needed.
async function downloadBlobToFile(repo, sha, localPath) {
  const response = await githubFetch(`/repos/${repo}/git/blobs/${sha}`, {
    headers: { Accept: 'application/vnd.github.raw+json' },
    timeoutMs: BLOB_TIMEOUT_MS
  });
  const contentType = String(response.headers.get('content-type') || '');
  const isRaw = response.ok && response.body && !(contentType.includes('json') && !contentType.includes('vnd.github.raw'));
  if (!isRaw) {
    writeFileAtomic(localPath, await readBlobResponse(response, sha));
    return;
  }
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  const tempPath = `${localPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(tempPath));
    fs.renameSync(tempPath, localPath);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
}

async function readBlobResponse(response, sha) {
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    const error = new Error(`GitHub API ${response.status}: ${buffer.toString('utf8').slice(0, 300)}`);
    error.statusCode = response.status;
    throw error;
  }
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('vnd.github.raw') && contentType.includes('json')) {
    try {
      const payload = JSON.parse(buffer.toString('utf8'));
      if (payload && payload.sha === sha && payload.encoding === 'base64' && typeof payload.content === 'string') {
        return Buffer.from(payload.content.replace(/\n/g, ''), 'base64');
      }
    } catch {}
  }
  return buffer;
}

async function mapWithConcurrency(items, limit, worker) {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await worker(current);
    }
  });
  await Promise.all(runners);
}

function gitBlobSha(buffer) {
  return crypto.createHash('sha1').update(`blob ${buffer.length}\0`).update(buffer).digest('hex');
}

function statOrNull(localPath) {
  try {
    return fs.statSync(localPath);
  } catch {
    return null;
  }
}

function localFileSha(localPath) {
  const stat = statOrNull(localPath);
  if (!stat || !stat.isFile()) {
    localShaCache.delete(localPath);
    return '';
  }
  const cached = localShaCache.get(localPath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.sha;
  }
  const hash = crypto.createHash('sha1').update(`blob ${stat.size}\0`);
  forEachFileChunk(localPath, (chunk) => hash.update(chunk));
  const sha = hash.digest('hex');
  localShaCache.set(localPath, { mtimeMs: stat.mtimeMs, size: stat.size, sha });
  return sha;
}

// Chunk size is a multiple of 3 so per-chunk base64 output concatenates cleanly.
const FILE_CHUNK_BYTES = 3 * 1024 * 1024;

function forEachFileChunk(localPath, visit) {
  const fd = fs.openSync(localPath, 'r');
  const buffer = Buffer.allocUnsafe(FILE_CHUNK_BYTES);
  try {
    for (;;) {
      let filled = 0;
      while (filled < buffer.length) {
        const read = fs.readSync(fd, buffer, filled, buffer.length - filled, null);
        if (!read) {
          break;
        }
        filled += read;
      }
      if (!filled) {
        break;
      }
      visit(buffer.subarray(0, filled));
      if (filled < buffer.length) {
        break;
      }
    }
  } finally {
    fs.closeSync(fd);
  }
}

const BLOB_BODY_PREFIX = Buffer.from('{"encoding":"base64","content":"');
const BLOB_BODY_SUFFIX = Buffer.from('"}');

function blobUploadBodyLength(size) {
  return BLOB_BODY_PREFIX.length + Math.ceil(size / 3) * 4 + BLOB_BODY_SUFFIX.length;
}

// Streams the blob-upload JSON body from disk, base64-encoding a few megabytes at a time,
// so uploading a large data file never holds the whole file (or its base64 form) in memory.
async function* streamBlobUploadBody(localPath) {
  yield BLOB_BODY_PREFIX;
  const handle = await fs.promises.open(localPath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(FILE_CHUNK_BYTES);
    for (;;) {
      let filled = 0;
      while (filled < buffer.length) {
        const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, null);
        if (!bytesRead) {
          break;
        }
        filled += bytesRead;
      }
      if (!filled) {
        break;
      }
      yield Buffer.from(buffer.subarray(0, filled).toString('base64'), 'latin1');
      if (filled < buffer.length) {
        break;
      }
    }
  } finally {
    await handle.close();
  }
  yield BLOB_BODY_SUFFIX;
}

function walkDir(dirPath, visit) {
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, visit);
    } else if (entry.isFile() && !entry.name.endsWith('.tmp')) {
      visit(fullPath);
    }
  }
}

function getMutableFiles() {
  const files = [...STATIC_FILES];
  const seen = new Set(files.map((file) => file.repoPath));
  for (const item of RECURSIVE_DIRS) {
    walkDir(item.localDir, (filePath) => {
      const relative = path.relative(item.localDir, filePath).replace(/\\/g, '/');
      const repoPath = `${item.repoDir}/${relative}`;
      if (!seen.has(repoPath)) {
        seen.add(repoPath);
        files.push({ repoPath, localPath: filePath });
      }
    });
  }
  return files;
}

function resolveRemotePathToLocal(repoPath) {
  const explicit = STATIC_BY_REPO_PATH.get(repoPath);
  if (explicit) {
    return explicit;
  }
  for (const mapping of RECURSIVE_DIRS) {
    const prefix = `${mapping.repoDir}/`;
    if (repoPath.startsWith(prefix)) {
      const remainder = repoPath.slice(prefix.length);
      if (!remainder || remainder.split('/').some((part) => !part || part === '.' || part === '..')) {
        return null;
      }
      return path.join(mapping.localDir, remainder.replace(/\//g, path.sep));
    }
  }
  return null;
}

async function ensureDataBranch() {
  const config = getConfig();
  if (!config.enabled) {
    return null;
  }

  try {
    const existing = await githubRequest(`/repos/${config.repo}/git/ref/heads/${encodeURIComponent(config.branch)}`);
    return existing.object.sha;
  } catch (error) {
    if (error.statusCode !== 404) {
      throw error;
    }
  }

  const repoInfo = await githubRequest(`/repos/${config.repo}`);
  const baseRef = await githubRequest(`/repos/${config.repo}/git/ref/heads/${encodeURIComponent(repoInfo.default_branch)}`);
  await githubRequest(`/repos/${config.repo}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({
      ref: `refs/heads/${config.branch}`,
      sha: baseRef.object.sha
    })
  });
  return baseRef.object.sha;
}

async function loadRemoteState(config, headSha) {
  const commit = await githubRequest(`/repos/${config.repo}/git/commits/${headSha}`);
  const tree = await githubRequest(`/repos/${config.repo}/git/trees/${commit.tree.sha}?recursive=1`, { timeoutMs: BLOB_TIMEOUT_MS });
  const shas = new Map();
  for (const item of tree.tree || []) {
    if (item.type === 'blob') {
      shas.set(item.path, item.sha);
    }
  }
  remoteState.loaded = true;
  remoteState.commitSha = headSha;
  remoteState.treeSha = commit.tree.sha;
  remoteState.truncated = Boolean(tree.truncated);
  remoteState.shas = shas;
  return remoteState;
}

// Until a pull has succeeded, local files may be stale seed data from the code repo.
// Pushing them would overwrite the real records on GitHub, so pushes are refused.
let pushesBlockedReason = '';

function blockPushes(reason) {
  pushesBlockedReason = String(reason || 'GitHub data has not been loaded yet.');
}

async function pullRemoteData() {
  const config = getConfig();
  if (!config.enabled) {
    return { ok: false, skipped: true, reason: 'GitHub sync not configured.' };
  }
  try {
    const result = await pullRemoteDataOnce(config);
    pushesBlockedReason = '';
    return result;
  } catch (error) {
    blockPushes(
      `Changes are not being saved to GitHub because loading data from GitHub failed at startup (${error.message || error}). Restart the service once GitHub is reachable.`
    );
    throw error;
  }
}

async function pullRemoteDataOnce(config) {
  const headSha = await ensureDataBranch();
  await loadRemoteState(config, headSha);

  const downloads = [];
  let skippedBackups = 0;
  for (const [repoPath, sha] of remoteState.shas) {
    // Backup snapshots stay on GitHub; only the manifest is needed locally.
    if (backupIdFromRepoPath(repoPath)) {
      skippedBackups += 1;
      continue;
    }
    const localPath = resolveRemotePathToLocal(repoPath);
    if (!localPath || localFileSha(localPath) === sha) {
      continue;
    }
    downloads.push({ localPath, sha });
  }

  await mapWithConcurrency(downloads, TRANSFER_CONCURRENCY, (item) => downloadBlobToFile(config.repo, item.sha, item.localPath));

  return { ok: true, skipped: false, restored: downloads.length, skippedBackups };
}

// Runs synchronously while no mutation can change files, so the commit is a consistent
// snapshot. Only files whose content differs from the remote tree are staged for upload.
function collectChangedFiles() {
  flushAppState();

  const remoteBackupIds = new Set();
  for (const repoPath of remoteState.shas.keys()) {
    const id = backupIdFromRepoPath(repoPath);
    if (id) {
      remoteBackupIds.add(id);
    }
  }
  const keep = applyBackupRetention({ extraIds: [...remoteBackupIds] });

  // Changed files are copied to a staging folder (a disk copy, not a memory copy) so
  // the upload can happen after the lock is released without mixing in later edits.
  fs.rmSync(PUSH_STAGING_DIR, { recursive: true, force: true });
  fs.mkdirSync(PUSH_STAGING_DIR, { recursive: true });
  const uploads = [];
  for (const file of getMutableFiles()) {
    const sha = localFileSha(file.localPath);
    if (!sha) {
      continue;
    }
    if (!remoteState.truncated && remoteState.shas.get(file.repoPath) === sha) {
      continue;
    }
    try {
      const stagedPath = path.join(PUSH_STAGING_DIR, String(uploads.length));
      fs.copyFileSync(file.localPath, stagedPath);
      uploads.push({ repoPath: file.repoPath, stagedPath, size: fs.statSync(stagedPath).size });
    } catch {}
  }

  const deletions = [];
  for (const repoPath of remoteState.shas.keys()) {
    const id = backupIdFromRepoPath(repoPath);
    if (id && !keep.has(id)) {
      deletions.push(repoPath);
    }
  }
  return { uploads, deletions };
}

async function buildPushEntries(config) {
  const { uploads, deletions } = await withFilesStable(collectChangedFiles);
  const entries = deletions.map((repoPath) => ({ path: repoPath, mode: '100644', type: 'blob', sha: null }));

  const uploadOne = async (upload) => {
    const blob = await githubRequest(`/repos/${config.repo}/git/blobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(blobUploadBodyLength(upload.size))
      },
      // A factory, so each retry attempt gets a fresh stream.
      body: () => streamBlobUploadBody(upload.stagedPath),
      timeoutMs: BLOB_TIMEOUT_MS
    });
    fs.rmSync(upload.stagedPath, { force: true });
    entries.push({ path: upload.repoPath, mode: '100644', type: 'blob', sha: blob.sha });
  };

  try {
    // Small files upload in parallel; large ones one at a time to cap peak memory.
    await mapWithConcurrency(uploads.filter((upload) => upload.size < LARGE_UPLOAD_BYTES), TRANSFER_CONCURRENCY, uploadOne);
    for (const upload of uploads.filter((entry) => entry.size >= LARGE_UPLOAD_BYTES)) {
      await uploadOne(upload);
    }
  } finally {
    fs.rmSync(PUSH_STAGING_DIR, { recursive: true, force: true });
  }

  return entries;
}

async function pushOnce(config, reason) {
  const headSha = await ensureDataBranch();
  if (!remoteState.loaded || remoteState.commitSha !== headSha) {
    await loadRemoteState(config, headSha);
  }

  const entries = await buildPushEntries(config);
  if (!entries.length) {
    return { ok: true, skipped: false, unchanged: true, commitSha: headSha };
  }

  const newTree = await githubRequest(`/repos/${config.repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: remoteState.treeSha, tree: entries }),
    timeoutMs: BLOB_TIMEOUT_MS
  });

  const newCommit = await githubRequest(`/repos/${config.repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: reason,
      tree: newTree.sha,
      parents: [headSha],
      author: {
        name: config.authorName,
        email: config.authorEmail
      }
    })
  });

  await githubRequest(`/repos/${config.repo}/git/refs/heads/${encodeURIComponent(config.branch)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: newCommit.sha })
  });

  remoteState.commitSha = newCommit.sha;
  remoteState.treeSha = newTree.sha;
  for (const entry of entries) {
    if (entry.sha) {
      remoteState.shas.set(entry.path, entry.sha);
    } else {
      remoteState.shas.delete(entry.path);
    }
  }
  return { ok: true, skipped: false, commitSha: newCommit.sha, changedFiles: entries.length };
}

async function pushLocalData(reason = 'Update badge data') {
  const config = getConfig();
  if (!config.enabled) {
    return { ok: false, skipped: true, reason: 'GitHub sync not configured.' };
  }
  if (pushesBlockedReason) {
    syncStatus.lastError = pushesBlockedReason;
    throw new Error(pushesBlockedReason);
  }

  syncStatus.inFlight = true;
  syncStatus.startedAt = new Date().toISOString();
  syncStatus.lastReason = String(reason || '');
  syncStatus.lastError = '';
  try {
    let result;
    try {
      result = await pushOnce(config, reason);
    } catch (error) {
      // 422 means the branch moved underneath us (not a fast-forward); reload and retry once.
      if (error.statusCode !== 422 && error.statusCode !== 409) {
        throw error;
      }
      remoteState.loaded = false;
      result = await pushOnce(config, reason);
    }
    return result;
  } catch (error) {
    remoteState.loaded = false;
    syncStatus.lastError = error.message || String(error);
    throw error;
  } finally {
    syncStatus.finishedAt = new Date().toISOString();
    syncStatus.inFlight = false;
  }
}

// Push queue: at most one push runs at a time and at most one more waits behind it.
// Every request made while a push is waiting joins that pending push.
let runningPush = null;
let pendingPush = null;

function createPendingPush() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => {});
  return { promise, resolve, reject, reasons: [], dueAt: Infinity, timer: null };
}

function schedulePendingPush() {
  if (!pendingPush) {
    return;
  }
  if (pendingPush.timer) {
    clearTimeout(pendingPush.timer);
    pendingPush.timer = null;
  }
  const delay = Math.max(0, pendingPush.dueAt - Date.now());
  // Detach from any mutation context so the push never believes it already holds the lock.
  pendingPush.timer = mutationContext.exit(() =>
    setTimeout(() => {
      if (pendingPush) {
        pendingPush.timer = null;
        pendingPush.ready = true;
      }
      startPendingPush();
    }, delay)
  );
  if (typeof pendingPush.timer.unref === 'function') {
    pendingPush.timer.unref();
  }
}

function combinedReason(reasons) {
  const unique = [...new Set(reasons.filter(Boolean))];
  if (!unique.length) {
    return 'Update badge data';
  }
  if (unique.length === 1) {
    return unique[0];
  }
  const shown = unique.slice(0, 5).map((reason) => `- ${reason}`).join('\n');
  const extra = unique.length > 5 ? `\n- ...and ${unique.length - 5} more` : '';
  return `${unique[0]} (+${unique.length - 1} more)\n\n${shown}${extra}`;
}

function startPendingPush() {
  if (runningPush || !pendingPush || !pendingPush.ready) {
    syncStatus.queuedCount = pendingPush ? 1 : 0;
    return;
  }
  const job = pendingPush;
  pendingPush = null;
  syncStatus.queuedCount = 0;
  const reason = combinedReason(job.reasons);
  runningPush = pushLocalData(reason)
    .then(job.resolve, (error) => {
      appendAppErrorLog({
        severity: 'warning',
        source: 'github_sync',
        message: error.message || String(error),
        stack: error.stack || '',
        context: reason.split('\n')[0]
      });
      job.reject(error);
    })
    .finally(() => {
      runningPush = null;
      startPendingPush();
    });
}

function queuePushLocalData(reason, options = {}) {
  const debounceMs = Math.max(0, Number(options.debounceMs) || 0);
  if (!pendingPush) {
    pendingPush = createPendingPush();
  }
  pendingPush.reasons.push(String(reason || ''));
  const dueAt = Date.now() + debounceMs;
  if (dueAt < pendingPush.dueAt) {
    pendingPush.dueAt = dueAt;
    pendingPush.ready = false;
    schedulePendingPush();
  }
  syncStatus.queuedCount = 1;
  return pendingPush.promise;
}

async function flushPendingPushes(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while ((pendingPush || runningPush) && Date.now() < deadline) {
    if (pendingPush && !pendingPush.ready) {
      pendingPush.dueAt = Date.now();
      schedulePendingPush();
    }
    const current = runningPush || (pendingPush && pendingPush.promise);
    const remaining = Math.max(0, deadline - Date.now());
    await Promise.race([Promise.resolve(current).catch(() => null), sleep(Math.min(remaining, 1000))]);
  }
  return !pendingPush && !runningPush;
}

function getSyncStatus() {
  const cfg = getConfig();
  return {
    enabled: Boolean(cfg.enabled),
    repo: cfg.repo || '',
    branch: cfg.branch || '',
    inFlight: Boolean(syncStatus.inFlight),
    queuedCount: Number(syncStatus.queuedCount || 0),
    startedAt: syncStatus.startedAt || '',
    finishedAt: syncStatus.finishedAt || '',
    lastReason: syncStatus.lastReason || '',
    lastError: syncStatus.lastError || ''
  };
}

// Mutations run one at a time. Nested calls from inside a mutation run inline.
const mutationContext = new AsyncLocalStorage();
let mutationChain = Promise.resolve();
let activeMutations = 0;
let idleCallbacks = [];

function runExclusive(fn) {
  const run = mutationChain.then(() => {
    activeMutations += 1;
    return fn();
  });
  mutationChain = run
    .catch(() => null)
    .then(() => {
      activeMutations -= 1;
      if (activeMutations === 0 && idleCallbacks.length) {
        const callbacks = idleCallbacks;
        idleCallbacks = [];
        callbacks.forEach((callback) => {
          try {
            callback();
          } catch (error) {
            console.error(`Deferred task failed: ${error.message}`);
          }
        });
      }
    });
  return run;
}

function isMutationActive() {
  return activeMutations > 0;
}

// Number of mutations currently holding the lock while waiting for a push to finish
// (syncPush). While one is waiting, files cannot change, so the push may read them
// without taking the lock itself (taking it would deadlock).
let lockHoldersAwaitingPush = 0;

function withFilesStable(fn) {
  if (lockHoldersAwaitingPush > 0 || mutationContext.getStore()) {
    return Promise.resolve().then(fn);
  }
  return runExclusive(fn);
}

// Runs fn now if no mutation is in progress, otherwise right after the current one
// finishes. Used for append-only writes that must not be undone by a rollback.
function runWhenMutationIdle(fn) {
  if (activeMutations === 0 && !mutationContext.getStore()) {
    fn();
    return;
  }
  idleCallbacks.push(fn);
}

function afterMutationCommit(fn) {
  const store = mutationContext.getStore();
  if (store) {
    store.afterCommit.push(fn);
    return;
  }
  setImmediate(() => runHook(fn));
}

function runHook(fn) {
  try {
    const result = fn();
    if (result && typeof result.catch === 'function') {
      result.catch((error) => console.error(`After-commit task failed: ${error.message || error}`));
    }
  } catch (error) {
    console.error(`After-commit task failed: ${error.message || error}`);
  }
}

function listBackupDirs() {
  try {
    return new Set(fs.readdirSync(PATHS.backupsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name));
  } catch {
    return new Set();
  }
}

// Rollback copies live on disk rather than in memory: with thousands of badges the core
// files are tens of megabytes, and mutations run one at a time so one folder is enough.
const ROLLBACK_DIR = path.join(os.tmpdir(), `ebadge-rollback-${process.pid}`);

function captureRollbackPoint() {
  fs.mkdirSync(ROLLBACK_DIR, { recursive: true });
  return {
    files: ROLLBACK_FILES.map((localPath, index) => {
      const copyPath = path.join(ROLLBACK_DIR, `${index}-${path.basename(localPath)}`);
      try {
        fs.copyFileSync(localPath, copyPath);
        return { localPath, copyPath };
      } catch {
        fs.rmSync(copyPath, { force: true });
        return { localPath, copyPath: null };
      }
    }),
    appendOnly: APPEND_ONLY_ROLLBACK_FILES.map((localPath) => {
      const stat = statOrNull(localPath);
      return { localPath, size: stat ? stat.size : 0 };
    }),
    backupDirs: listBackupDirs()
  };
}

function restoreRollbackPoint(point) {
  for (const file of point.files) {
    try {
      if (file.copyPath == null) {
        fs.rmSync(file.localPath, { force: true });
      } else {
        copyFileAtomic(file.copyPath, file.localPath);
      }
    } catch (error) {
      console.error(`Rollback failed for ${file.localPath}: ${error.message}`);
    }
  }
  for (const file of point.appendOnly) {
    const stat = statOrNull(file.localPath);
    if (stat && stat.size > file.size) {
      try {
        fs.truncateSync(file.localPath, file.size);
      } catch (error) {
        console.error(`Rollback failed for ${file.localPath}: ${error.message}`);
      }
    }
  }
  for (const name of listBackupDirs()) {
    if (!point.backupDirs.has(name)) {
      fs.rmSync(path.join(PATHS.backupsDir, name), { recursive: true, force: true });
    }
  }
  markAppStateDirty();
}

function discardRollbackPoint(point) {
  for (const file of point.files) {
    if (file.copyPath) {
      fs.rmSync(file.copyPath, { force: true });
    }
  }
}

async function runMutation(reason, mutateFn, rebuildFn, options) {
  const syncPush = Boolean(options && options.syncPush);
  const context = { afterCommit: [] };
  const point = captureRollbackPoint();
  try {
    const result = await mutationContext.run(context, async () => {
      const value = await mutateFn();
      if (typeof rebuildFn === 'function') {
        await rebuildFn();
      }
      return value;
    });
    discardRollbackPoint(point);
    if (syncPush) {
      lockHoldersAwaitingPush += 1;
      try {
        await queuePushLocalData(reason);
      } finally {
        lockHoldersAwaitingPush -= 1;
      }
    } else {
      queuePushLocalData(reason, { debounceMs: options && options.debounceMs }).catch(() => {});
    }
    context.afterCommit.forEach((fn) => setImmediate(() => runHook(fn)));
    return result;
  } catch (error) {
    appendAppErrorLog({
      severity: 'error',
      source: 'persist_mutation',
      message: error.message || String(error),
      stack: error.stack || '',
      context: String(reason || '')
    });
    restoreRollbackPoint(point);
    discardRollbackPoint(point);
    if (typeof rebuildFn === 'function') {
      try {
        await rebuildFn();
      } catch (rebuildError) {
        console.error(`Rebuild after rollback failed: ${rebuildError.message}`);
      }
    }
    throw error;
  }
}

async function persistMutation(reason, mutateFn, rebuildFn, options = {}) {
  if (mutationContext.getStore()) {
    const value = await mutateFn();
    if (typeof rebuildFn === 'function') {
      await rebuildFn();
    }
    return value;
  }
  return runExclusive(() => runMutation(reason, mutateFn, rebuildFn, options));
}

module.exports = {
  getConfig,
  getSyncStatus,
  pullRemoteData,
  pushLocalData,
  queuePushLocalData,
  flushPendingPushes,
  persistMutation,
  afterMutationCommit,
  runWhenMutationIdle,
  isMutationActive,
  gitBlobSha
};
