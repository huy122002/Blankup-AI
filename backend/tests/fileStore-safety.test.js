/**
 * fileStore SAFETY tests (storage hardening).
 * Uses isolated temp dirs + real fs. Never touches backend/data.
 *
 * Contract under test:
 * - ENOENT (missing file) -> [] (ONLY this case)
 * - malformed JSON -> THROW
 * - EPERM/EACCES (e.g. OneDrive lock) -> THROW
 * - read failure must NEVER become a [] write (N records preserved)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { readJson, writeJson, withLock } = require('../utils/fileStore');

let dir;
let file;
const N = 25;
const seedRecords = () => Array.from({ length: N }, (_, i) => ({ orderId: `BU-TEST-${i}` }));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blankup-safety-'));
  file = path.join(dir, 'orders.json');
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('readJson failure semantics', () => {
  it('missing file -> [] (ENOENT only)', () => {
    expect(readJson(path.join(dir, 'nope.json'))).toEqual([]);
  });

  it('malformed JSON -> throws (never [])', () => {
    fs.writeFileSync(file, '{invalid json', 'utf8');
    expect(() => readJson(file)).toThrow();
  });

  it('EISDIR (read a directory) -> throws', () => {
    expect(() => readJson(dir)).toThrow();
  });

  it('EPERM (simulated OneDrive lock) -> throws', () => {
    fs.writeFileSync(file, JSON.stringify(seedRecords()));
    const err = new Error('operation not permitted');
    err.code = 'EPERM';
    jest.spyOn(fs, 'readFileSync').mockImplementationOnce(() => { throw err; });
    expect(() => readJson(file)).toThrow(/permitted|EPERM/);
  });
});

describe('no write-after-failed-read (N records preserved)', () => {
  it('failed read + caller read-modify-write attempt keeps N records', () => {
    writeJson(file, seedRecords());
    const err = new Error('operation not permitted');
    err.code = 'EPERM';
    jest.spyOn(fs, 'readFileSync').mockImplementationOnce(() => { throw err; });
    // Simulated caller pattern used by all routes: read -> push -> write
    expect(() => {
      const orders = readJson(file);
      orders.push({ orderId: 'BU-NEW' });
      writeJson(file, orders);
    }).toThrow();
    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(after).toHaveLength(N);
    expect(after.some(o => o.orderId === 'BU-NEW')).toBe(false);
  });
});

describe('concurrent writers (same process)', () => {
  it('20 parallel withLock increments lose nothing', async () => {
    writeJson(file, [{ n: 0 }]);
    await Promise.all(Array.from({ length: 20 }, () =>
      withLock(file, () => {
        const cur = readJson(file);
        cur[0].n += 1;
        writeJson(file, cur);
      })
    ));
    expect(readJson(file)[0].n).toBe(20);
  }, 30000);
});

describe('multi-process writers (cross-process lock)', () => {
  it('2 processes x 10 increments = 20, no lost updates', async () => {
    writeJson(file, [{ n: 0 }]);
    const worker = path.join(dir, 'worker.js');
    fs.writeFileSync(worker, `
      const { readJson, writeJson, withLock } = require(${JSON.stringify(require.resolve('../utils/fileStore'))});
      (async () => {
        const f = process.argv[2];
        for (let i = 0; i < 10; i++) {
          await withLock(f, () => {
            const cur = readJson(f);
            cur[0].n += 1;
            writeJson(f, cur);
          });
        }
      })();
    `);
    // Truly concurrent: both processes run at the same time
    const run = () => new Promise((resolve, reject) => {
      const p = spawn(process.execPath, [worker, file], { timeout: 60000 });
      p.on('error', reject);
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('worker exit ' + code))));
    });
    await Promise.all([run(), run()]);
    expect(readJson(file)[0].n).toBe(20);
  }, 120000);
});

describe('backup rotation + recovery', () => {
  it('keeps versioned backups and restores byte-identical content', () => {
    const v1 = seedRecords();
    writeJson(file, v1);
    const v2 = seedRecords().map(r => ({ ...r, v: 2 }));
    writeJson(file, v2);
    const backups = fs.readdirSync(dir).filter(f => f.includes('.bak.'));
    expect(backups.length).toBeGreaterThanOrEqual(1);
    expect(backups.length).toBeLessThanOrEqual(3);
    const bak = JSON.parse(fs.readFileSync(path.join(dir, backups.sort().reverse()[0]), 'utf8'));
    expect(bak).toEqual(v1);
  });

  it('interrupted write (orphan tmp, no rename) leaves original intact', () => {
    writeJson(file, seedRecords());
    // Simulate crash residue: stray tmp file, destination untouched
    fs.writeFileSync(file + '.tmp.99999.12345.abcdef', '[{"orderId":"BU-PARTIAL"}]', 'utf8');
    const after = readJson(file);
    expect(after).toHaveLength(N);
  });
});
