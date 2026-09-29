/**
 * PHASE 4 — Saved designs CRUD (REAL logic, in-memory fileStore).
 *
 * Proves: create/update identity, owner-scoped listing, strict ownership
 * (user B cannot read/update/delete user A's design), payload sanitization,
 * order-snapshot pipeline untouched (orders.json is a different store).
 */
const request = require('supertest');

const USER_A = { id: 'u-A', username: 'userA', fullName: 'User A', role: 'user' };
const USER_B = { id: 'u-B', username: 'userB', fullName: 'User B', role: 'user' };

const mockUsers = {
  'u-A': { id: 'u-A', username: 'userA', fullName: 'User A', email: null, avatar: null, provider: 'local', role: 'user' },
  'u-B': { id: 'u-B', username: 'userB', fullName: 'User B', email: null, avatar: null, provider: 'local', role: 'user' },
};

let mockSaved = [];
let mockDesigns = [];

jest.mock('../utils/fileStore', () => ({
  readJson: jest.fn((filePath) => {
    if (String(filePath).includes('saved-designs')) return mockSaved;
    return mockDesigns;
  }),
  writeJson: jest.fn((filePath, data) => {
    if (String(filePath).includes('saved-designs')) { mockSaved = data; return; }
    mockDesigns = data;
  }),
  withLock: jest.fn(async (_key, fn) => fn()),
  DATA_DIR: '/tmp/blankup-test',
}));

jest.mock('../db', () => {
  function createChain() {
    const inputs = {};
    return {
      input: jest.fn().mockImplementation(function (name, _type, value) { inputs[name] = value; return this; }),
      query: jest.fn().mockImplementation((sqlText) => {
        if (sqlText.includes('FROM Users WHERE id')) {
          const u = mockUsers[inputs.id];
          return Promise.resolve({ recordset: u ? [u] : [] });
        }
        return Promise.resolve({ recordset: [] });
      }),
    };
  }
  return {
    getPool: jest.fn(() => ({ request: jest.fn(() => createChain()) })),
    sql: { NVarChar: 'NVarChar', Int: 'Int', DateTime: 'DateTime', Bit: 'Bit' },
  };
});

jest.mock('../middleware/rateLimit', () => ({
  apiLimiter: (req, res, next) => next(),
  authLimiter: (req, res, next) => next(),
  otpLimiter: (req, res, next) => next(),
  aiLimiter: (req, res, next) => next(),
  galleryLimiter: (req, res, next) => next(),
  orderLimiter: (req, res, next) => next(),
}));

const app = require('../app');
const { generateTestToken, authHeader } = require('./helpers/setup');

const tokenA = () => generateTestToken(USER_A);
const tokenB = () => generateTestToken(USER_B);

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function validPayload(overrides = {}) {
  return {
    name: 'Hoodie con chó mèo',
    productType: 'hoodie',
    color: '#1e293b',
    size: 'L',
    front: {
      layers: [
        { url: PNG_DATA_URL, name: 'Chó', x: 0, y: -10, scale: 1.2, rotation: 15, opacity: 0.9, z: 1, crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } },
        { url: PNG_DATA_URL, name: 'Mèo', x: 20, y: 5, scale: 0.8, z: 2, locked: true },
      ],
      text: { content: 'BLANKUP', placement: { x: 0, y: 25, scale: 1.1, rotation: 0, opacity: 1 }, style: { font: 'poster', color: '#e63946', transform: 'upper' }, locked: false },
    },
    back: { layers: [{ url: PNG_DATA_URL, name: 'Mặt sau', x: -5, y: 0, scale: 1, z: 1 }], text: null },
    ...overrides,
  };
}

beforeEach(() => {
  mockSaved = [];
  mockDesigns = [];
  jest.clearAllMocks();
});

describe('POST /api/ai-design/saved — create & update identity', () => {
  it('requires authentication', async () => {
    const res = await request(app).post('/api/ai-design/saved').send(validPayload());
    expect(res.status).toBe(401);
  });

  it('creates a record with stable designId and full editable state', async () => {
    const res = await request(app).post('/api/ai-design/saved').set(authHeader(tokenA())).send(validPayload());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.created).toBe(true);
    expect(res.body.designId).toMatch(/^saved-/);
    expect(mockSaved).toHaveLength(1);
    const rec = mockSaved[0];
    expect(rec.userId).toBe('u-A');
    expect(rec.productType).toBe('hoodie');
    expect(rec.front.layers).toHaveLength(2);
    expect(rec.front.layers[0].crop).toEqual({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
    expect(rec.front.layers[1].locked).toBe(true);
    expect(rec.front.text.content).toBe('BLANKUP');
    expect(rec.front.text.style.font).toBe('poster');
    expect(rec.back.layers).toHaveLength(1);
    expect(rec.createdAt).toBeTruthy();
    expect(rec.updatedAt).toBeTruthy();
  });

  it('same designId updates the SAME record (no duplicate identity)', async () => {
    const first = await request(app).post('/api/ai-design/saved').set(authHeader(tokenA())).send(validPayload());
    const id = first.body.designId;
    const edited = validPayload({ name: 'Bản chỉnh lần 2' });
    edited.front.layers[0].x = 42;
    const second = await request(app).post('/api/ai-design/saved').set(authHeader(tokenA())).send({ ...edited, designId: id });
    expect(second.body.success).toBe(true);
    expect(second.body.created).toBe(false);
    expect(second.body.designId).toBe(id);
    expect(mockSaved).toHaveLength(1); // identity giữ nguyên
    expect(mockSaved[0].name).toBe('Bản chỉnh lần 2');
    expect(mockSaved[0].front.layers[0].x).toBe(42);
  });

  it('rejects empty payload (no layers, no text)', async () => {
    const res = await request(app).post('/api/ai-design/saved').set(authHeader(tokenA())).send({ name: 'trống', front: { layers: [] }, back: { layers: [] } });
    expect(res.status).toBe(400);
    expect(mockSaved).toHaveLength(0);
  });

  it('sanitizes hostile url payloads (traversal, external) — layers dropped, not stored', async () => {
    const payload = validPayload();
    payload.front.layers[0].url = '/uploads/../.env';
    payload.front.layers[1].url = 'https://evil.example.com/steal.png';
    const res = await request(app).post('/api/ai-design/saved').set(authHeader(tokenA())).send(payload);
    expect(res.status).toBe(200);
    // Sanitizer DROP hẳn layer có URL không hợp lệ (chỉ chấp nhận dataURL hoặc
    // /uploads/ nội bộ, chặn traversal) — không lưu URL độc hại dưới bất kỳ dạng nào.
    expect(mockSaved[0].front.layers).toHaveLength(0);
    expect(JSON.stringify(mockSaved)).not.toContain('evil.example.com');
    expect(JSON.stringify(mockSaved)).not.toContain('.env');
    // Layer hợp lệ ở side back vẫn được giữ nguyên vẹn.
    expect(mockSaved[0].back.layers).toHaveLength(1);
    expect(mockSaved[0].back.layers[0].url).toBe(PNG_DATA_URL);
  });

  it('unknown productType falls back to tshirt (never crashes)', async () => {
    const res = await request(app).post('/api/ai-design/saved').set(authHeader(tokenA())).send(validPayload({ productType: 'space-rocket' }));
    expect(res.status).toBe(200);
    expect(mockSaved[0].productType).toBe('tshirt');
  });
});

describe('GET /api/ai-design/saved — owner-scoped listing', () => {
  it('lists only MY designs with counts, without full layer payload', async () => {
    await request(app).post('/api/ai-design/saved').set(authHeader(tokenA())).send(validPayload());
    await request(app).post('/api/ai-design/saved').set(authHeader(tokenB())).send(validPayload({ name: 'Của B' }));
    const resA = await request(app).get('/api/ai-design/saved').set(authHeader(tokenA()));
    expect(resA.status).toBe(200);
    expect(resA.body.data).toHaveLength(1);
    expect(resA.body.data[0].name).toBe('Hoodie con chó mèo');
    expect(resA.body.data[0].counts.front).toBe(2);
    expect(resA.body.data[0].front).toBeUndefined(); // không trả payload nặng trong list
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/ai-design/saved');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/ai-design/saved/:id — ownership enforced', () => {
  it('owner reads full editable state', async () => {
    const created = await request(app).post('/api/ai-design/saved').set(authHeader(tokenA())).send(validPayload());
    const res = await request(app).get(`/api/ai-design/saved/${created.body.designId}`).set(authHeader(tokenA()));
    expect(res.status).toBe(200);
    expect(res.body.record.productType).toBe('hoodie');
    expect(res.body.record.front.layers[0].scale).toBe(1.2);
    expect(res.body.record.front.layers[0].rotation).toBe(15);
    expect(res.body.record.front.layers[1].locked).toBe(true);
    expect(res.body.record.front.text.content).toBe('BLANKUP');
  });

  it('user B CANNOT read user A design (403)', async () => {
    const created = await request(app).post('/api/ai-design/saved').set(authHeader(tokenA())).send(validPayload());
    const res = await request(app).get(`/api/ai-design/saved/${created.body.designId}`).set(authHeader(tokenB()));
    expect(res.status).toBe(403);
  });

  it('404 for unknown id', async () => {
    const res = await request(app).get('/api/ai-design/saved/saved-xxx').set(authHeader(tokenA()));
    expect(res.status).toBe(404);
  });
});

describe('POST saved with existing id — user B cannot overwrite user A', () => {
  it('returns 403 and keeps A record intact', async () => {
    const created = await request(app).post('/api/ai-design/saved').set(authHeader(tokenA())).send(validPayload());
    const id = created.body.designId;
    const res = await request(app).post('/api/ai-design/saved').set(authHeader(tokenB())).send({ ...validPayload({ name: 'Hijacked' }), designId: id });
    expect(res.status).toBe(403);
    expect(mockSaved[0].name).toBe('Hoodie con chó mèo');
    expect(mockSaved[0].userId).toBe('u-A');
  });
});

describe('DELETE /api/ai-design/saved/:id — owner-only', () => {
  it('owner deletes own design', async () => {
    const created = await request(app).post('/api/ai-design/saved').set(authHeader(tokenA())).send(validPayload());
    const res = await request(app).delete(`/api/ai-design/saved/${created.body.designId}`).set(authHeader(tokenA()));
    expect(res.status).toBe(200);
    expect(mockSaved).toHaveLength(0);
  });

  it('user B CANNOT delete user A design (403, record intact)', async () => {
    const created = await request(app).post('/api/ai-design/saved').set(authHeader(tokenA())).send(validPayload());
    const res = await request(app).delete(`/api/ai-design/saved/${created.body.designId}`).set(authHeader(tokenB()));
    expect(res.status).toBe(403);
    expect(mockSaved).toHaveLength(1);
  });
});

describe('PHASE 4 regression guards', () => {
  it('orders.json untouched by saved-design flow (separate store)', async () => {
    await request(app).post('/api/ai-design/saved').set(authHeader(tokenA())).send(validPayload());
    const { readJson } = require('../utils/fileStore');
    // Không có writeJson nào cho orders trong luồng saved-design
    const writeCalls = require('../utils/fileStore').writeJson.mock.calls.filter(c => String(c[0]).includes('orders'));
    expect(writeCalls).toHaveLength(0);
    expect(readJson).toBeDefined();
  });

  it('save + reopen preserves z-order and visibility semantics', async () => {
    const payload = validPayload();
    payload.front.layers[0].visible = false;
    payload.front.layers[1].z = 7;
    await request(app).post('/api/ai-design/saved').set(authHeader(tokenA())).send(payload);
    const res = await request(app).get(`/api/ai-design/saved/${mockSaved[0].designId}`).set(authHeader(tokenA()));
    expect(res.body.record.front.layers[0].visible).toBe(false);
    expect(res.body.record.front.layers[1].z).toBe(7);
  });
});
