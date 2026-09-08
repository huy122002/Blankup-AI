/**
 * Test Isolation Helper
 *
 * Provides per-suite isolated file system storage and DB mock factory.
 * Each test suite gets its own temp directory for orders.json,
 * preventing cross-worker file corruption during parallel execution.
 *
 * IMPORTANT: jest.mock() factories are hoisted and cannot reference
 * out-of-scope variables. All mock factories must be self-contained.
 */
const os = require('os');
const path = require('path');
const fs = require('fs');

/**
 * Create a self-contained jest.mock factory for '../utils/fileStore'
 * that redirects orders.json operations to an isolated temp directory.
 *
 * The temp dir path is exposed on the returned mock as _testOrdersFile.
 *
 * Usage:
 *   jest.mock('../utils/fileStore', () => require('./helpers/testIsolation').fileStoreFactory('my-suite'));
 *   const { _testOrdersFile: ordersFile } = require('../utils/fileStore');
 */
function fileStoreFactory(suiteName) {
  const actual = jest.requireActual('../../utils/fileStore');
  const dir = path.join(
    os.tmpdir(),
    `blankup-${suiteName}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  fs.mkdirSync(dir, { recursive: true });
  const tempOrdersFile = path.join(dir, 'orders.json');
  fs.writeFileSync(tempOrdersFile, '[]', 'utf8');

  const mock = {
    readJson(filePath) {
      const p = String(filePath);
      if (p.endsWith('orders.json') && p.includes('data')) {
        return actual.readJson(tempOrdersFile);
      }
      return actual.readJson(filePath);
    },
    writeJson(filePath, data) {
      const p = String(filePath);
      if (p.endsWith('orders.json') && p.includes('data')) {
        return actual.writeJson(tempOrdersFile, data);
      }
      return actual.writeJson(filePath, data);
    },
    withLock: actual.withLock,
    DATA_DIR: dir,
    _testOrdersFile: tempOrdersFile,
    _testCleanup() {
      try {
        if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    },
  };
  return mock;
}

/**
 * Create a self-contained jest.mock factory for '../utils/fileStore'
 * that redirects EVERY backend/data/*.json operation to an isolated temp
 * directory (mirrored by basename). Use for suites that touch any data
 * file (follows, contacts, designs, ...) so tests can NEVER write the
 * real backend/data files, even when run in parallel workers.
 *
 * Usage:
 *   jest.mock('../utils/fileStore', () => require('./helpers/testIsolation').fileStoreFactoryAll('my-suite'));
 */
function fileStoreFactoryAll(suiteName) {
  const actual = jest.requireActual('../../utils/fileStore');
  const dir = path.join(
    os.tmpdir(),
    `blankup-${suiteName}-all-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  fs.mkdirSync(dir, { recursive: true });
  const mirror = (filePath) => path.join(dir, path.basename(String(filePath)));
  const mock = {
    readJson(filePath) {
      const m = mirror(filePath);
      if (fs.existsSync(m)) return actual.readJson(m);
      // Seed empty so route logic (read-modify-write) works on first touch.
      // Never fall through to the real file.
      return [];
    },
    writeJson(filePath, data) {
      return actual.writeJson(mirror(filePath), data);
    },
    withLock: actual.withLock,
    DATA_DIR: dir,
    _testDir: dir,
    _testCleanup() {
      try {
        if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    },
  };
  return mock;
}

/**
 * Create a self-contained jest.mock factory for '../db'
 * that provides authenticate middleware support + empty recordsets for other queries.
 */
function dbFactory() {
  function createChain() {
    const inputs = {};
    return {
      input: jest.fn().mockImplementation(function (name, type, value) {
        inputs[name] = value;
        return this;
      }),
      query: jest.fn().mockImplementation((sql) => {
        if (sql.includes('FROM Users WHERE id')) {
          const userId = inputs.id || 'u-test';
          const isAdmin = userId === 'u-admin';
          return Promise.resolve({
            recordset: [
              {
                id: userId,
                username: isAdmin ? 'admin' : 'testuser',
                fullName: isAdmin ? 'Admin User' : 'Test User',
                email: isAdmin ? 'admin@test.com' : 'test@test.com',
                avatar: null,
                provider: 'local',
                role: isAdmin ? 'admin' : 'user',
              },
            ],
          });
        }
        return Promise.resolve({ recordset: [] });
      }),
    };
  }
  return {
    getPool: jest.fn(() => ({ request: jest.fn(() => createChain()) })),
    sql: { NVarChar: 'NVarChar', Int: 'Int', DateTime: 'DateTime', Bit: 'Bit' },
  };
}

module.exports = { fileStoreFactory, fileStoreFactoryAll, dbFactory };
