const fs = require('fs');
const path = require('path');
const { PATHS, ensureDir } = require('./store');

const API_BASE = 'https://api.github.com';
let syncQueue = Promise.resolve();

function getMutableFiles() {
  const staticFiles = [
    { repoPath: 'data/badges.json', localPath: PATHS.badgesFile },
    { repoPath: 'data/badge-links.csv', localPath: PATHS.badgeLinksCsvFile },
    { repoPath: 'data/app-state.json', localPath: PATHS.appStateFile },
    { repoPath: 'data/badge-catalog.json', localPath: PATHS.templatesFile },
    { repoPath: 'data/certificate-template.json', localPath: PATHS.certificateTemplateFile },
    { repoPath: 'data/site-config.json', localPath: PATHS.siteConfigFile },
    { repoPath: 'data/deleted-badges.json', localPath: PATHS.deletedBadgesFile },
    { repoPath: 'data/backups/manifest.json', localPath: PATHS.backupManifestFile },
    { repoPath: 'data/audit-log.ndjson', localPath: PATHS.auditLogFile },
    { repoPath: 'data/analytics-events.ndjson', localPath: PATHS.analyticsEventsFile },
    { repoPath: 'data/analytics-summary.json', localPath: PATHS.analyticsSummaryFile }
  ];

  const recursiveDirs = [
    { localDir: PATHS.backupsDir, repoDir: 'data/backups' }
  ];

  const files = [...staticFiles];
  for (const item of recursiveDirs) {
    if (!fs.existsSync(item.localDir)) {
      continue;
    }
    walkDir(item.localDir, (filePath) => {
      const relative = path.relative(item.localDir, filePath).replace(/\\/g, '/');
      const repoPath = `${item.repoDir}/${relative}`;
      if (!files.some((entry) => entry.localPath === filePath || entry.repoPath === repoPath)) {
        files.push({ repoPath, localPath: filePath });
      }
    });
  }

  return files;
}

function walkDir(dirPath, visit) {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, visit);
    } else {
      visit(fullPath);
    }
  }
}

function getConfig() {
  const token = String(process.env.GITHUB_TOKEN || '').trim();
  const repo = String(process.env.GITHUB_REPO || '').trim();
  const branch = String(process.env.GITHUB_DATA_BRANCH || 'badge-data').trim() || 'badge-data';
  const authorName = String(process.env.GITHUB_COMMIT_NAME || 'CSUN Career Center E-Badges').trim() || 'CSUN Career Center E-Badges';
  const authorEmail = String(process.env.GITHUB_COMMIT_EMAIL || 'career.center@csun.edu').trim() || 'career.center@csun.edu';
  return { token, repo, branch, authorName, authorEmail, enabled: Boolean(token && repo) };
}

async function githubRequest(endpoint, options = {}) {
  const config = getConfig();
  if (!config.enabled) {
    throw new Error('GitHub sync is not configured. Set GITHUB_TOKEN and GITHUB_REPO on Render.');
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${config.token}`,
      'User-Agent': 'csun-career-center-ebadges',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {})
    }
  });

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

function readLocalFile(localPath) {
  return fs.existsSync(localPath) ? fs.readFileSync(localPath) : null;
}

async function fetchBranchTreeRecursive(repo, branch) {
  const ref = await githubRequest(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  const commit = await githubRequest(`/repos/${repo}/git/commits/${ref.object.sha}`);
  return githubRequest(`/repos/${repo}/git/trees/${commit.tree.sha}?recursive=1`);
}

async function pullRemoteData() {
  const config = getConfig();
  if (!config.enabled) {
    return { ok: false, skipped: true, reason: 'GitHub sync not configured.' };
  }

  await ensureDataBranch();
  const tree = await fetchBranchTreeRecursive(config.repo, config.branch);
  const blobMap = new Map();
  for (const item of tree.tree || []) {
    if (item.type === 'blob' && item.path.startsWith('data/')) {
      blobMap.set(item.path, item);
    }
  }

  for (const file of getMutableFiles()) {
    const item = blobMap.get(file.repoPath);
    if (!item) {
      continue;
    }
    const blob = await githubRequest(`/repos/${config.repo}/git/blobs/${item.sha}`);
    const buffer = Buffer.from(String(blob.content || '').replace(/\n/g, ''), 'base64');
    ensureDir(path.dirname(file.localPath));
    fs.writeFileSync(file.localPath, buffer);
  }

  return { ok: true, skipped: false };
}

async function pushLocalData(reason = 'Update badge data') {
  const config = getConfig();
  if (!config.enabled) {
    return { ok: false, skipped: true, reason: 'GitHub sync not configured.' };
  }

  await ensureDataBranch();
  const ref = await githubRequest(`/repos/${config.repo}/git/ref/heads/${encodeURIComponent(config.branch)}`);
  const commit = await githubRequest(`/repos/${config.repo}/git/commits/${ref.object.sha}`);
  const baseTreeSha = commit.tree.sha;

  const tree = [];
  for (const file of getMutableFiles()) {
    const content = readLocalFile(file.localPath);
    if (content == null) {
      continue;
    }
    const blob = await githubRequest(`/repos/${config.repo}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({
        content: content.toString('base64'),
        encoding: 'base64'
      })
    });
    tree.push({
      path: file.repoPath,
      mode: '100644',
      type: 'blob',
      sha: blob.sha
    });
  }

  const newTree = await githubRequest(`/repos/${config.repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree
    })
  });

  const newCommit = await githubRequest(`/repos/${config.repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: reason,
      tree: newTree.sha,
      parents: [ref.object.sha],
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

  return { ok: true, skipped: false, commitSha: newCommit.sha };
}

function queuePushLocalData(reason) {
  syncQueue = syncQueue.catch(() => null).then(() => pushLocalData(reason));
  return syncQueue;
}

function snapshotMutableFiles() {
  return getMutableFiles().map((file) => ({
    ...file,
    exists: fs.existsSync(file.localPath),
    content: readLocalFile(file.localPath)
  }));
}

function restoreMutableFiles(snapshot) {
  for (const file of snapshot) {
    ensureDir(path.dirname(file.localPath));
    if (!file.exists || file.content == null) {
      if (fs.existsSync(file.localPath)) {
        fs.unlinkSync(file.localPath);
      }
      continue;
    }
    fs.writeFileSync(file.localPath, file.content);
  }
}

async function persistMutation(reason, mutateFn, rebuildFn) {
  const snapshot = snapshotMutableFiles();
  try {
    const result = await mutateFn();
    if (typeof rebuildFn === 'function') {
      rebuildFn();
    }
    await queuePushLocalData(reason);
    return result;
  } catch (error) {
    restoreMutableFiles(snapshot);
    if (typeof rebuildFn === 'function') {
      rebuildFn();
    }
    throw error;
  }
}

module.exports = {
  getConfig,
  pullRemoteData,
  pushLocalData,
  queuePushLocalData,
  persistMutation
};
