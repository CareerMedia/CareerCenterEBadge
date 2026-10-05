#!/usr/bin/env node
/*
 * One-time cleanup of old backup snapshots on the GitHub data branch.
 *
 * Usage:
 *   GITHUB_TOKEN=... GITHUB_REPO=owner/repo node scripts/prune-remote-backups.js          # dry run
 *   GITHUB_TOKEN=... GITHUB_REPO=owner/repo node scripts/prune-remote-backups.js --apply  # delete
 *
 * Reads GITHUB_TOKEN, GITHUB_REPO, and GITHUB_DATA_BRANCH (default "badge-data") from the
 * environment or from a local .env file. Applies the same tiered retention policy the app
 * uses (lib/backup-retention.js) and removes everything else under data/backups/ in a
 * single commit, updating data/backups/manifest.json to match.
 */
const fs = require('fs');
const path = require('path');
const { selectBackupsToKeep, backupIdFromRepoPath, parseBackupTimestamp } = require('../lib/backup-retention');

const API_BASE = 'https://api.github.com';
const MANIFEST_PATH = 'data/backups/manifest.json';

function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }
    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    if (key && !(key in process.env)) {
      process.env[key] = trimmed.slice(index + 1).trim();
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function github(config, endpoint, options = {}) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let response;
    try {
      response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${config.token}`,
          'User-Agent': 'csun-career-center-ebadges-prune',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(options.headers || {})
        },
        signal: AbortSignal.timeout(60000)
      });
    } catch (error) {
      if (attempt === 3) throw error;
      await sleep(1000 * attempt);
      continue;
    }
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (response.ok) {
      return payload;
    }
    if ((response.status >= 500 || response.status === 429) && attempt < 3) {
      await sleep(1000 * attempt * 2);
      continue;
    }
    throw new Error(`GitHub API ${response.status}: ${(payload && payload.message) || text}`);
  }
  throw new Error('GitHub request failed after retries.');
}

function formatMb(bytes) {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

async function main() {
  loadEnvFile();
  const apply = process.argv.includes('--apply');
  const config = {
    token: String(process.env.GITHUB_TOKEN || '').trim(),
    repo: String(process.env.GITHUB_REPO || '').trim(),
    branch: String(process.env.GITHUB_DATA_BRANCH || 'badge-data').trim() || 'badge-data'
  };
  if (!config.token || !config.repo) {
    throw new Error('Set GITHUB_TOKEN and GITHUB_REPO (owner/repo) before running this script.');
  }

  const ref = await github(config, `/repos/${config.repo}/git/ref/heads/${encodeURIComponent(config.branch)}`);
  const commit = await github(config, `/repos/${config.repo}/git/commits/${ref.object.sha}`);
  const tree = await github(config, `/repos/${config.repo}/git/trees/${commit.tree.sha}?recursive=1`);
  if (tree.truncated) {
    throw new Error('The branch tree listing was truncated by GitHub; prune manually or in smaller steps.');
  }

  const blobs = (tree.tree || []).filter((item) => item.type === 'blob');
  const backupFiles = blobs.filter((item) => backupIdFromRepoPath(item.path));
  const backupIds = [...new Set(backupFiles.map((item) => backupIdFromRepoPath(item.path)))];
  const keep = selectBackupsToKeep(backupIds);
  const removeIds = backupIds.filter((id) => !keep.has(id));
  const removeFiles = backupFiles.filter((item) => !keep.has(backupIdFromRepoPath(item.path)));
  const removeBytes = removeFiles.reduce((total, item) => total + (item.size || 0), 0);
  const totalBytes = blobs.reduce((total, item) => total + (item.size || 0), 0);

  console.log(`Branch "${config.branch}" at ${ref.object.sha.slice(0, 7)}: ${blobs.length} files, ${formatMb(totalBytes)}.`);
  console.log(`Backups: ${backupIds.length} snapshots, keeping ${keep.size}, removing ${removeIds.length} (${removeFiles.length} files, ${formatMb(removeBytes)}).`);
  const sortedKeep = [...keep].sort((a, b) => (parseBackupTimestamp(b) || 0) - (parseBackupTimestamp(a) || 0));
  console.log('Keeping:');
  sortedKeep.forEach((id) => console.log(`  ${id}`));

  if (!removeIds.length) {
    console.log('Nothing to prune.');
    return;
  }
  if (!apply) {
    console.log('\nDry run only. Re-run with --apply to delete the snapshots listed as removed.');
    return;
  }

  const entries = removeFiles.map((item) => ({ path: item.path, mode: '100644', type: 'blob', sha: null }));
  const manifestItem = blobs.find((item) => item.path === MANIFEST_PATH);
  if (manifestItem) {
    const manifestBlob = await github(config, `/repos/${config.repo}/git/blobs/${manifestItem.sha}`);
    const manifest = JSON.parse(Buffer.from(String(manifestBlob.content || ''), 'base64').toString('utf8'));
    const backups = Array.isArray(manifest.backups) ? manifest.backups : [];
    const filtered = backups.filter((entry) => !entry || !entry.backupId || keep.has(entry.backupId));
    const newBlob = await github(config, `/repos/${config.repo}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({
        content: Buffer.from(`${JSON.stringify({ version: 1, backups: filtered }, null, 2)}\n`).toString('base64'),
        encoding: 'base64'
      })
    });
    entries.push({ path: MANIFEST_PATH, mode: '100644', type: 'blob', sha: newBlob.sha });
  }

  const newTree = await github(config, `/repos/${config.repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: commit.tree.sha, tree: entries })
  });
  const newCommit = await github(config, `/repos/${config.repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: `Prune ${removeIds.length} old backup snapshots (tiered retention)`,
      tree: newTree.sha,
      parents: [ref.object.sha]
    })
  });
  await github(config, `/repos/${config.repo}/git/refs/heads/${encodeURIComponent(config.branch)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: newCommit.sha })
  });
  console.log(`\nPruned ${removeIds.length} snapshots in commit ${newCommit.sha.slice(0, 7)}.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
