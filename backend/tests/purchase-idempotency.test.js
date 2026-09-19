/**
 * Persistent purchase idempotency (Phase 1 RED).
 *
 * Unit parts use a fake pool. Integration parts use the REAL SQL Server
 * (skipped gracefully when unreachable) with test-scoped keys
 * (`test-...`) that are cleaned up afterwards. Pre-existing rows are
 * never touched.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function loadEnv() {
  for (const f of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')]) {
    if (!fs.existsSync(f)) continue;
    fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#') || !t.includes('=')) return;
      const i = t.indexOf('=');
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (k && process.env[k] === undefined) process.env[k] = v;
    });
  }
}
loadEnv();

let sql = null;
let pool = null;
let SQL_OK = false;

async function tryConnect() {
  try {
    // Use the msnodesqlv8 backend so Windows Auth works when SQL_USER/SQL_PASSWORD
    // are not configured (mirrors db.js connection setup).
    sql = require('mssql/msnodesqlv8');
    const server = (process.env.SQL_SERVER || 'localhost').split('\\')[0];
    const useWindowsAuth = !process.env.SQL_USER && !process.env.SQL_PASSWORD;
    pool = await sql.connect({
      driver: process.env.SQL_ODBC_DRIVER || 'ODBC Driver 17 for SQL Server',
      server,
      port: Number(process.env.SQL_PORT || 1433),
      database: process.env.SQL_DATABASE || 'BlankupDB',
      ...(useWindowsAuth ? {} : { user: process.env.SQL_USER, password: process.env.SQL_PASSWORD }),
      options: { encrypt: false, trustServerCertificate: true, ...(useWindowsAuth ? { trustedConnection: true } : {}) },
    });
    await pool.request().query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

const itReal = it;

beforeAll(async () => {
  // Integration tests REQUIRE the real SQL Server. Fail loudly if missing —
  // silent skips would let regressions hide. Unit tests above need no DB.
  SQL_OK = await tryConnect();
  if (!SQL_OK) throw new Error('REAL SQL Server required for purchase-idempotency integration tests');
}, 60000);

afterAll(async () => {
  try { await pool.close(); } catch {}
});

const TEST_UID = () => 'u-test-idem-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function cleanupTestPurchases(client, ids) {
  // ONLY rows this suite created (explicit ids). Pre-existing data untouched.
  for (const pid of [...new Set(ids)].filter(Boolean)) {
    try {
      await client.request().input('p', sql.NVarChar, pid)
        .query(`DELETE FROM VoucherRedemptions WHERE purchaseId = @p`);
      await client.request().input('p', sql.NVarChar, pid)
        .query(`DELETE FROM AiPlanPurchases WHERE id = @p`);
    } catch {}
  }
}

async function cleanupIdemKey(client, key) {
  try {
    await client.request().input('k', sql.NVarChar, key)
      .query(`DELETE FROM PurchaseIdempotency WHERE idemKey = @k`);
  } catch {}
}

describe('purchase-idempotency service (unit, no DB)', () => {
  const svc = require('../services/purchase-idempotency.service');

  it('hashBody is canonical: same semantic request -> same hash', () => {
    const a = svc.hashBody({ planId: 'plan-pro', voucherCode: '  blankup50 ' });
    const b = svc.hashBody({ planCode: undefined, planId: 'plan-pro', voucherCode: 'BLANKUP50' });
    expect(a).toBe(b);
    expect(svc.hashBody({ planId: 'plan-pro' })).not.toBe(svc.hashBody({ planId: 'plan-premium' }));
  });

  it('isUniqueViolation detects 2627/2601 and unique messages', () => {
    expect(svc.isUniqueViolation({ number: 2627, message: 'x' })).toBe(true);
    expect(svc.isUniqueViolation({ number: 2601, message: 'x' })).toBe(true);
    expect(svc.isUniqueViolation(new Error('duplicate key'))).toBe(true);
    expect(svc.isUniqueViolation(new Error('timeout'))).toBe(false);
    expect(svc.isUniqueViolation(null)).toBe(false);
  });

  it('isStale flags old in-progress claims only', () => {
    expect(svc.isStale(null)).toBe(true);
    expect(svc.isStale({ createdAt: new Date(Date.now() - 20 * 60 * 1000) })).toBe(true);
    expect(svc.isStale({ createdAt: new Date() })).toBe(false);
  });

  it('parseResponse decodes stored payloads, null on garbage', () => {
    expect(svc.parseResponse({ responseJson: '{"a":1}' })).toEqual({ a: 1 });
    expect(svc.parseResponse({ responseJson: null })).toBeNull();
    expect(svc.parseResponse({ responseJson: 'not-json' })).toBeNull();
  });
});

const { spawn: spawnProc } = require('child_process');

function runChild(args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const p = spawnProc(process.execPath, [path.join(__dirname, 'helpers', 'idem-child.js'), ...args], { timeout: timeoutMs });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', reject);
    p.on('close', () => {
      try {
        const last = out.trim().split('\n').filter(Boolean).pop();
        resolve(JSON.parse(last));
      } catch (e) { reject(new Error('child bad output: ' + out.slice(0, 200))); }
    });
  });
}

describe('persistent idempotency (REAL SQL Server)', () => {
  itReal('T0: PurchaseIdempotency table + constraints exist', async () => {
    const r = await pool.request().query(
      `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'PurchaseIdempotency'`
    );
    expect(r.recordset[0].n).toBe(1);
    const uq = await pool.request().query(
      `SELECT COUNT(*) AS n FROM sys.indexes i JOIN sys.tables t ON t.object_id = i.object_id
       WHERE t.name = 'AiPlanPurchases' AND i.is_unique = 1 AND EXISTS (
         SELECT 1 FROM sys.index_columns ic JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
         WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND c.name = 'transferContent')`
    );
    expect(uq.recordset[0].n).toBeGreaterThanOrEqual(1);
  });

  itReal('T8: duplicate transferContent is rejected safely', async () => {
    const tx = pool.transaction();
    await tx.begin();
    try {
      await tx.request()
        .input('id', sql.NVarChar, 'test-dup-1')
        .input('userId', sql.NVarChar, 'u-1')
        .input('planId', sql.NVarChar, 'plan-pro')
        .query(`INSERT INTO AiPlanPurchases (id, userId, planId, priceVnd, finalAmount, transferContent, paymentMethod, paymentStatus)
                VALUES (@id, @userId, @planId, 129000, 129000, 'BLANKUP-TEST-DUP', 'BANK_TRANSFER', 'pending')`);
      let dupErr = null;
      try {
        await tx.request()
          .input('id', sql.NVarChar, 'test-dup-2')
          .input('userId', sql.NVarChar, 'u-1')
          .input('planId', sql.NVarChar, 'plan-pro')
          .query(`INSERT INTO AiPlanPurchases (id, userId, planId, priceVnd, finalAmount, transferContent, paymentMethod, paymentStatus)
                  VALUES (@id, @userId, @planId, 129000, 129000, 'BLANKUP-TEST-DUP', 'BANK_TRANSFER', 'pending')`);
      } catch (e) { dupErr = e; }
      expect(dupErr).not.toBeNull();
      expect(String(dupErr.message)).toMatch(/2627|2601|duplicate|UNIQUE/i);
    } finally {
      await tx.rollback();
    }
    const r = await pool.request().query(
      `SELECT COUNT(*) AS n FROM AiPlanPurchases WHERE transferContent = 'BLANKUP-TEST-DUP'`);
    expect(r.recordset[0].n).toBe(0);
  });

  itReal('T1: SAME key + SAME body twice -> exact same purchase, one row', async () => {
    const key = 'test-replay-' + Date.now().toString(36);
    const created = [];
    try {
      const r1 = await runChild([key, 'pro']);
      expect(r1.status).toBe(201);
      expect(r1.purchaseId).toMatch(/^purchase-/);
      created.push(r1.purchaseId);
      const r2 = await runChild([key, 'pro']);
      expect(r2.status).toBe(200);
      expect(r2.idempotent).toBe(true);
      expect(r2.purchaseId).toBe(r1.purchaseId);
      const cnt = await pool.request().input('k', sql.NVarChar, key)
        .query(`SELECT COUNT(*) AS n FROM AiPlanPurchases WHERE idempotencyKey = @k`);
      expect(cnt.recordset[0].n).toBe(1);
    } finally {
      await cleanupTestPurchases(pool, created);
      await cleanupIdemKey(pool, key);

    }
  }, 180000);

  itReal('T2: SAME key + DIFFERENT body -> 409, no mutation', async () => {
    const key = 'test-mismatch-' + Date.now().toString(36);
    const created = [];
    try {
      const r1 = await runChild([key, 'pro']);
      expect(r1.status).toBe(201);
      created.push(r1.purchaseId);
      const before = await pool.request().query(`SELECT COUNT(*) AS n FROM AiPlanPurchases`);
      const r2 = await runChild([key, 'premium']);
      expect(r2.status).toBe(409);
      const after = await pool.request().query(`SELECT COUNT(*) AS n FROM AiPlanPurchases`);
      expect(after.recordset[0].n).toBe(before.recordset[0].n);
    } finally {
      await cleanupTestPurchases(pool, created);
      await cleanupIdemKey(pool, key);

    }
  }, 180000);

  itReal('T3: RESTART (fresh process) replays same purchase, no new row', async () => {
    // Each runChild boots a brand-new Node process: empty in-memory state.
    // This is the exact restart/deploy scenario.
    const key = 'test-restart-' + Date.now().toString(36);
    const created = [];
    try {
      const r1 = await runChild([key, 'pro']);
      expect(r1.status).toBe(201);
      created.push(r1.purchaseId);
      const r2 = await runChild([key, 'pro']);
      expect(r2.status).toBe(200);
      expect(r2.purchaseId).toBe(r1.purchaseId);
      const cnt = await pool.request().input('k', sql.NVarChar, key)
        .query(`SELECT COUNT(*) AS n FROM AiPlanPurchases WHERE idempotencyKey = @k`);
      expect(cnt.recordset[0].n).toBe(1);
    } finally {
      await cleanupTestPurchases(pool, created);
      await cleanupIdemKey(pool, key);

    }
  }, 180000);

  itReal('T4: CROSS-PROCESS race (2 procs, same key) -> exactly 1 purchase', async () => {
    const key = 'test-race-' + Date.now().toString(36);
    const results = await Promise.all([
      runChild([key, 'pro']),
      runChild([key, 'pro']),
    ]);
    const created = results.filter(r => r.purchaseId).map(r => r.purchaseId);
    try {
      const ids = new Set(results.map(r => r.purchaseId).filter(Boolean));
      expect(ids.size).toBe(1);
      const cnt = await pool.request().input('k', sql.NVarChar, key)
        .query(`SELECT COUNT(*) AS n FROM AiPlanPurchases WHERE idempotencyKey = @k`);
      expect(cnt.recordset[0].n).toBe(1);
      // At least one side observed replay OR both got the same id
      expect(results.every(r => r.purchaseId === results[0].purchaseId)).toBe(true);
    } finally {
      await cleanupTestPurchases(pool, [...new Set(created)]);
      await cleanupIdemKey(pool, key);

    }
  }, 180000);

  itReal('T6+T7: voucher limit 1, 4 concurrent racers -> exactly 1 win, no orphans', async () => {
    const vcode = 'TESTIDEM' + Date.now().toString(36).toUpperCase();
    const keyBase = 'test-vouch-' + Date.now().toString(36);
    await pool.request()
      .input('code', sql.NVarChar, vcode)
      .query(`INSERT INTO Vouchers (id, code, title, discountType, discountValue, minOrderAmount, bonusHighCredits, bonusLowCredits, appliesTo, totalUsageLimit, perUserLimit, usedCount, status)
              VALUES ('v-test-' + REPLACE(CONVERT(NVARCHAR(36), NEWID()), '-', ''), @code, N'Test voucher', 'fixed', 1000, 0, 0, 0, 'plan', 1, 1, 0, 'active')`);
    const vRow = await pool.request().input('code', sql.NVarChar, vcode)
      .query(`SELECT id FROM Vouchers WHERE code = @code`);
    const voucherId = vRow.recordset[0].id;
    const created = [];
    try {
      const results = await Promise.all([0, 1, 2, 3].map(i =>
        runChild([`${keyBase}-${i}`, 'pro', vcode])));
      console.log('T6T7 child results: ' + JSON.stringify(results.map(r => ({ s: r.status, e: r.error, f: r.fatal }))));
      const ok = results.filter(r => r.status === 201);
      results.filter(r => r.purchaseId).forEach(r => created.push(r.purchaseId));
      expect(ok.length).toBe(1);
      const red = await pool.request().input('v', sql.NVarChar, voucherId)
        .query(`SELECT COUNT(*) AS n FROM VoucherRedemptions WHERE voucherId = @v`);
      expect(red.recordset[0].n).toBe(1);
      const used = await pool.request().input('v', sql.NVarChar, voucherId)
        .query(`SELECT usedCount FROM Vouchers WHERE id = @v`);
      expect(Number(used.recordset[0].usedCount)).toBe(1);
      // No orphans: every voucher purchase has its redemption and vice versa
      const orph = await pool.request().input('v', sql.NVarChar, voucherId).query(`
        SELECT
          (SELECT COUNT(*) FROM AiPlanPurchases p WHERE p.voucherCode = @v AND p.id NOT IN (SELECT purchaseId FROM VoucherRedemptions WHERE voucherId = @v)) AS purchWithoutRed,
          (SELECT COUNT(*) FROM VoucherRedemptions r WHERE r.voucherId = @v AND r.purchaseId NOT IN (SELECT id FROM AiPlanPurchases)) AS redWithoutPurch`);
      expect(orph.recordset[0].purchWithoutRed).toBe(0);
      expect(orph.recordset[0].redWithoutPurch).toBe(0);
    } finally {
      await cleanupTestPurchases(pool, [...new Set(created)]);
      await pool.request().input('v', sql.NVarChar, voucherId)
        .query(`DELETE FROM VoucherRedemptions WHERE voucherId = @v`);
      await pool.request().input('v', sql.NVarChar, voucherId)
        .query(`DELETE FROM Vouchers WHERE id = @v`);
      for (let i = 0; i < 4; i++) {
        await cleanupIdemKey(pool, `${keyBase}-${i}`);

      }
    }
  }, 240000);
});
