const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

// ---------------------------------------------------------------------------
// Locking: in-process mutex (fast path) + cross-process lockfile.
//
// The in-process Map alone cannot protect against concurrent Node processes
// (parallel jest workers, overlapping server instances, OneDrive-adjacent
// races). The lockfile `<target>.lock` is created with exclusive 'wx' mode,
// which is atomic on a single filesystem. Stale locks (dead holder) are
// reaped by mtime so a crashed process can never wedge writers forever.
//
// withLock(filePath, fn) signature is unchanged — all callers keep working.
// ---------------------------------------------------------------------------
const locks = new Map();

const LOCK_RETRY_MS = 5;
const LOCK_TIMEOUT_MS = 30000;
const LOCK_STALE_MS = 10000;
const lockOwner = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;

function lockPathFor(filePath) {
  return `${filePath}.lock`;
}

function isLockStale(lockPath) {
  try {
    const st = fs.statSync(lockPath);
    return Date.now() - st.mtimeMs > LOCK_STALE_MS;
  } catch {
    return true; // vanished between attempts -> treat as free
  }
}

function tryAcquireFileLock(lockPath) {
  try {
    fs.writeFileSync(lockPath, lockOwner, { flag: 'wx' });
    return true;
  } catch (err) {
    if (err && err.code === 'EEXIST') return false;
    throw err;
  }
}

async function acquireCrossProcessLock(filePath) {
  const lockPath = lockPathFor(filePath);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    if (tryAcquireFileLock(lockPath)) return lockPath;
    // Someone holds it: reap only if demonstrably stale, else wait.
    try {
      if (isLockStale(lockPath)) {
        try { fs.unlinkSync(lockPath); } catch {}
        continue;
      }
    } catch {}
    if (Date.now() > deadline) {
      throw new Error(`[fileStore] Lock timeout on ${path.basename(filePath)}`);
    }
    await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
  }
}

function releaseCrossProcessLock(lockPath) {
  // Only remove our own lock (content check) to avoid deleting a successor.
  try {
    if (fs.readFileSync(lockPath, 'utf8') === lockOwner) fs.unlinkSync(lockPath);
  } catch {}
}

function acquireLock(key) {
  return new Promise((resolve) => {
    const tryAcquire = () => {
      if (!locks.get(key)) {
        locks.set(key, true);
        resolve();
      } else {
        setTimeout(tryAcquire, 1);
      }
    };
    tryAcquire();
  });
}

function releaseLock(key) {
  locks.delete(key);
}

/**
 * Execute a function with exclusive access to a file path,
 * serialized within this process AND across concurrent processes.
 */
async function withLock(filePath, fn) {
  await acquireLock(filePath);
  let lockPath = null;
  try {
    lockPath = await acquireCrossProcessLock(filePath);
    return await fn();
  } finally {
    if (lockPath) releaseCrossProcessLock(lockPath);
    releaseLock(filePath);
  }
}

/**
 * Read a JSON file safely.
 *
 * - ENOENT (file does not exist yet) -> [] (ONLY this case).
 * - Malformed JSON -> THROW (after backing the corrupt file up).
 * - EPERM/EACCES (e.g. OneDrive/sync lock) and any other I/O error -> THROW.
 *
 * A failed read must NEVER be mistaken for an empty dataset: callers do
 * read-modify-write, and the throw propagates before any write happens.
 */
function readJson(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    console.error(`[fileStore] Read failed ${path.basename(filePath)}: ${err && err.code ? err.code : err && err.message}`);
    throw err;
  }
  try {
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    if (!raw.trim()) return [];
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[fileStore] Parse failed ${path.basename(filePath)}: ${err && err.message}`);
    try {
      const backup = `${filePath}.corrupt.${Date.now()}`;
      fs.copyFileSync(filePath, backup);
      console.error(`[fileStore] Corrupt file backed up to ${path.basename(backup)}`);
      // Prune old corrupt backups, keep max 5
      try {
        const dir = path.dirname(filePath);
        const base = path.basename(filePath);
        const olds = fs.readdirSync(dir).filter(f => f.startsWith(base + '.corrupt.')).sort().reverse();
        olds.slice(5).forEach(f => { try { fs.unlinkSync(path.join(dir, f)); } catch {} });
      } catch {}
    } catch {}
    throw err;
  }
}

const MAX_BACKUPS = 3;

function pruneBackups(filePath) {
  try {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    const olds = fs.readdirSync(dir).filter(f => f.startsWith(base + '.bak.')).sort().reverse();
    olds.slice(MAX_BACKUPS).forEach(f => { try { fs.unlinkSync(path.join(dir, f)); } catch {} });
  } catch {}
}

function purgeStaleTmp(filePath) {
  // Remove only our own-pattern tmp files older than 1h (never a live writer's).
  try {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    const cutoff = Date.now() - 3600000;
    fs.readdirSync(dir)
      .filter(f => f.startsWith(base + '.tmp.'))
      .forEach(f => {
        try {
          const full = path.join(dir, f);
          if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
        } catch {}
      });
  } catch {}
}

/**
 * Write data to a JSON file atomically (tmp + fsync + rename).
 *
 * Before destructively replacing an existing destination, the current
 * content is copied to a versioned backup (`<file>.bak.<timestamp>`,
 * max 3 kept) so no write can silently destroy the previous dataset.
 * Write/delete/recovery events are logged (paths + sizes only, never data).
 */
function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  purgeStaleTmp(filePath);
  let existed = false;
  try {
    const st = fs.statSync(filePath);
    existed = st.isFile();
  } catch {}
  if (existed) {
    try {
      const backup = `${filePath}.bak.${Date.now()}`;
      fs.copyFileSync(filePath, backup);
      console.log(`[fileStore] Backup ${path.basename(filePath)} -> ${path.basename(backup)}`);
      pruneBackups(filePath);
    } catch (err) {
      console.error(`[fileStore] Backup failed ${path.basename(filePath)}: ${err && err.message}`);
    }
  }
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const content = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmpPath, content, 'utf8');
  try {
    const fd = fs.openSync(tmpPath, 'r');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
  } catch {}
  try {
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    if (err.code === 'EPERM' || err.code === 'EEXIST') {
      try { fs.unlinkSync(filePath); } catch {}
      fs.renameSync(tmpPath, filePath);
    } else {
      try {
        fs.copyFileSync(tmpPath, filePath);
        fs.unlinkSync(tmpPath);
      } catch {
        throw err;
      }
    }
  }
  try {
    console.log(`[fileStore] Wrote ${path.basename(filePath)} (${Buffer.byteLength(content, 'utf8')} bytes)`);
  } catch {}
}

module.exports = { readJson, writeJson, withLock, DATA_DIR };
