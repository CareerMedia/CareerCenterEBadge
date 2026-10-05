const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_RETENTION_POLICY = {
  keepAllMs: 2 * DAY_MS,
  dailyMs: 30 * DAY_MS,
  weeklyMs: 183 * DAY_MS,
  minKeep: 3
};

const BACKUP_ID_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/;

function parseBackupTimestamp(backupId) {
  const match = BACKUP_ID_PATTERN.exec(String(backupId || ''));
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, minute, second, ms] = match.map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, second, ms);
}

function isoWeekKey(timestamp) {
  const source = new Date(timestamp);
  const date = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth(), source.getUTCDate()));
  const dayNumber = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNumber);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${date.getUTCFullYear()}-W${week}`;
}

/**
 * Tiered retention: every snapshot from the last 48 hours, the newest snapshot per
 * day for 30 days, and the newest per ISO week for about 6 months. The newest
 * `minKeep` snapshots and any id that is not a recognizable timestamp are always kept.
 */
function selectBackupsToKeep(backupIds, options = {}) {
  const now = options.now == null ? Date.now() : Number(options.now);
  const policy = { ...DEFAULT_RETENTION_POLICY, ...(options.policy || {}) };
  const unique = [...new Set((backupIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  const keep = new Set();
  const entries = [];
  for (const id of unique) {
    const timestamp = parseBackupTimestamp(id);
    if (timestamp == null) {
      keep.add(id);
    } else {
      entries.push({ id, timestamp });
    }
  }
  entries.sort((left, right) => right.timestamp - left.timestamp);

  const days = new Set();
  const weeks = new Set();
  entries.forEach((entry, index) => {
    const age = now - entry.timestamp;
    if (index < policy.minKeep || age <= policy.keepAllMs) {
      keep.add(entry.id);
      return;
    }
    if (age <= policy.dailyMs) {
      const dayKey = new Date(entry.timestamp).toISOString().slice(0, 10);
      if (!days.has(dayKey)) {
        days.add(dayKey);
        keep.add(entry.id);
      }
      return;
    }
    if (age <= policy.weeklyMs) {
      const weekKey = isoWeekKey(entry.timestamp);
      if (!weeks.has(weekKey)) {
        weeks.add(weekKey);
        keep.add(entry.id);
      }
    }
  });
  return keep;
}

/**
 * Returns the backup id for a repo path like `data/backups/<id>/app-state.json`,
 * or '' for anything else (including the manifest).
 */
function backupIdFromRepoPath(repoPath) {
  const match = /^data\/backups\/([^/]+)\/.+/.exec(String(repoPath || ''));
  return match ? match[1] : '';
}

module.exports = {
  DAY_MS,
  DEFAULT_RETENTION_POLICY,
  parseBackupTimestamp,
  selectBackupsToKeep,
  backupIdFromRepoPath
};
