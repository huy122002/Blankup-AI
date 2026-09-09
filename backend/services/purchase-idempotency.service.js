/**
 * Persistent purchase idempotency — survives process restart, deploy,
 * and concurrent Node processes (unlike the old in-memory Map).
 *
 * Table PurchaseIdempotency (userId, idemKey) PK:
 *   bodyHash      - canonical hash of the semantic request
 *   responseJson  - stored purchase response for deterministic replay
 *   status        - 'in_progress' | 'complete'
 *
 * Protocol (claim-first):
 *  1. SELECT existing claim. If found:
 *     - bodyHash mismatch -> 409 conflict (same key, different body).
 *     - responseJson present -> deterministic replay.
 *     - in_progress + fresh -> caller waits (poll) for the winner.
 *     - in_progress + stale -> reclaim (delete + proceed as new).
 *  2. INSERT claim row. On UNIQUE violation (2627/2601) another
 *     process won the race -> re-SELECT and follow step 1.
 *  3. Do the purchase work inside ONE SQL transaction, then UPDATE
 *     the claim with the response and commit together.
 *
 * No secrets are stored: only the purchase response payload
 * (purchaseId, amounts, transferContent — same as API responses).
 */
const crypto = require('crypto');

const IDEM_TTL_MS = 24 * 60 * 60 * 1000;
const IN_PROGRESS_TIMEOUT_MS = 10 * 60 * 1000;
const WAIT_POLL_MS = 200;
const WAIT_TIMEOUT_MS = 30000;

function hashBody({ planId, planCode, voucherCode } = {}) {
  // Canonical subset: same semantic request -> same hash.
  // MUST stay byte-identical to the historical hashPurchaseBody or
  // old in-flight keys would mismatch. Key order fixed intentionally.
  const stable = JSON.stringify({
    planId: planId || null,
    planCode: planCode || null,
    voucherCode: voucherCode ? String(voucherCode).trim().toUpperCase() : null,
  });
  return crypto.createHash('sha256').update(stable).digest('hex');
}

function isUniqueViolation(err) {
  if (!err) return false;
  const msg = String(err.message || '');
  return err.number === 2627 || err.number === 2601 || /UNIQUE|duplicate/i.test(msg);
}

async function getRecord(pool, sql, userId, key) {
  const r = await pool.request()
    .input('userId', sql.NVarChar, userId)
    .input('key', sql.NVarChar, String(key))
    .query(`SELECT userId, idemKey, bodyHash, responseJson, status, createdAt
            FROM PurchaseIdempotency WHERE userId = @userId AND idemKey = @key`);
  return r.recordset[0] || null;
}

function isStale(row) {
  if (!row || !row.createdAt) return true;
  return Date.now() - new Date(row.createdAt).getTime() > IN_PROGRESS_TIMEOUT_MS;
}

async function deleteClaim(pool, sql, userId, key) {
  await pool.request()
    .input('userId', sql.NVarChar, userId)
    .input('key', sql.NVarChar, String(key))
    .query(`DELETE FROM PurchaseIdempotency WHERE userId = @userId AND idemKey = @key`);
}

/**
 * Wait (outside any transaction) for a winner to publish its response.
 * Returns the row once responseJson appears, or null on timeout.
 */
async function waitForCompletion(pool, sql, userId, key, timeoutMs = WAIT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = await getRecord(pool, sql, userId, key);
    if (row && row.responseJson) return row;
    if (!row) return null; // winner rolled back / claim gone
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, WAIT_POLL_MS));
  }
}

function parseResponse(row) {
  try {
    return JSON.parse(row.responseJson);
  } catch {
    return null;
  }
}

/**
 * Safe startup/background cleanup: delete ONLY completed records older
 * than TTL. In-progress rows are never deleted here (reclaim handles them
 * per-request with an age check, so cleanup can never race active work).
 */
async function cleanupExpired(pool, sql, ttlMs = IDEM_TTL_MS) {
  const r = await pool.request()
    .input('cutoff', sql.DateTime, new Date(Date.now() - ttlMs))
    .query(`DELETE FROM PurchaseIdempotency WHERE status = 'complete' AND createdAt < @cutoff`);
  return (r.rowsAffected && r.rowsAffected[0]) || 0;
}

module.exports = {
  hashBody,
  isUniqueViolation,
  getRecord,
  isStale,
  deleteClaim,
  waitForCompletion,
  parseResponse,
  cleanupExpired,
  IDEM_TTL_MS,
  IN_PROGRESS_TIMEOUT_MS,
};
