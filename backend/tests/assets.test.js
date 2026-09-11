const request = require('supertest');
const fs = require('fs');
const path = require('path');

// Mock database BEFORE app is required
jest.mock('../db', () => ({
  getPool: () => ({
    request: () => ({
      input: jest.fn().mockReturnThis(),
      query: jest.fn().mockResolvedValue({ recordset: [] }),
    }),
  }),
  sql: { NVarChar: 'NVarChar', Int: 'Int', DateTime: 'DateTime', Bit: 'Bit' },
}));

jest.mock('../middleware/rateLimit', () => ({
  apiLimiter: (req, res, next) => next(),
  authLimiter: (req, res, next) => next(),
  otpLimiter: (req, res, next) => next(),
  galleryLimiter: (req, res, next) => next(),
}));

jest.mock('../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      if (token.startsWith('mock-token-')) {
        req.user = { id: token.replace('mock-token-', ''), username: 'testuser', role: 'user' };
      } else {
        req.user = { id: 'u-test', username: 'testuser', role: 'user' };
      }
      return next();
    }
    res.status(401).json({ success: false, error: 'Access denied. No token provided.' });
  },
  requireAdmin: (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Authentication required.' });
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, error: 'Forbidden. Admin access required.' });
    next();
  },
  optionalAuthenticate: (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      if (token.startsWith('mock-token-')) {
        req.user = { id: token.replace('mock-token-', ''), username: 'testuser', role: 'user' };
      } else {
        req.user = { id: 'u-test', username: 'testuser', role: 'user' };
      }
    }
    next();
  },
}));

const app = require('../app');

const TEST_ASSETS_DIR = path.join(__dirname, '..', 'uploads', 'assets');
const TEST_DATA_DIR = path.join(__dirname, '..', 'data');

function createTestImage() {
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  return Buffer.from(pngBase64, 'base64');
}

function createLargeTestImage(sizeMB) {
  const base = createTestImage();
  const chunks = [];
  const targetBytes = sizeMB * 1024 * 1024;
  while (Buffer.concat(chunks).length < targetBytes) {
    chunks.push(base);
  }
  return Buffer.concat(chunks).slice(0, targetBytes);
}

function createFakeExecutable() {
  return Buffer.from('MZ\x90\x00', 'binary');
}

function createMaliciousSVG() {
  return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'utf8');
}

function createValidJPG() {
  const jpgBase64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwA/AB//2Q==';
  return Buffer.from(jpgBase64, 'base64');
}

function createValidWEBP() {
  const webpBase64 = 'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
  return Buffer.from(webpBase64, 'base64');
}

beforeAll(() => {
  if (!fs.existsSync(TEST_ASSETS_DIR)) {
    fs.mkdirSync(TEST_ASSETS_DIR, { recursive: true });
  }
});

afterAll(() => {
  if (fs.existsSync(TEST_ASSETS_DIR)) {
    fs.readdirSync(TEST_ASSETS_DIR).forEach(f => {
      try { fs.unlinkSync(path.join(TEST_ASSETS_DIR, f)); } catch {}
    });
    try { fs.rmdirSync(TEST_ASSETS_DIR); } catch {}
  }
});

describe('Assets API — Phase 1', () => {
  const token = 'Bearer mock-token-u-test';
  const authHeader = { Authorization: token };

  describe('POST /api/assets/upload', () => {
    it('should upload valid PNG and return asset metadata', async () => {
      const res = await request(app)
        .post('/api/assets/upload')
        .set(authHeader)
        .attach('file', createTestImage(), 'test.png')
        .field('kind', 'asset');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.asset).toBeDefined();
      expect(res.body.asset.assetId).toMatch(/^[a-f0-9-]{36}$/);
      expect(res.body.asset.url).toMatch(/^\/uploads\/assets\/asset-[a-f0-9-]{36}\.png$/);
      expect(res.body.asset.kind).toBe('asset');
      expect(res.body.asset.name).toBe('test.png');
      expect(res.body.asset.mimeType).toBe('image/png');
      expect(typeof res.body.asset.size).toBe('number');
      expect(typeof res.body.asset.width).toBe('number');
      expect(typeof res.body.asset.height).toBe('number');
      expect(res.body.asset.exifStripped).toBeDefined();
      expect(res.body.asset.createdAt).toBeDefined();
    });

    it('should upload valid JPG and return asset metadata', async () => {
      const res = await request(app)
        .post('/api/assets/upload')
        .set(authHeader)
        .attach('file', createValidJPG(), 'test.jpg')
        .field('kind', 'asset');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.asset.mimeType).toBe('image/jpeg');
      expect(res.body.asset.url).toMatch(/\.jpg$/);
    });

    it('should upload valid WEBP and return asset metadata', async () => {
      const res = await request(app)
        .post('/api/assets/upload')
        .set(authHeader)
        .attach('file', createValidWEBP(), 'test.webp')
        .field('kind', 'asset');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.asset.mimeType).toBe('image/webp');
    });

    it('should reject file > 10MB with 413', async () => {
      const largeBuffer = createLargeTestImage(11);

      const res = await request(app)
        .post('/api/assets/upload')
        .set(authHeader)
        .attach('file', largeBuffer, 'large.png')
        .field('kind', 'asset');

      expect(res.status).toBe(413);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/too large|File too large/i);
    });

    it('should reject invalid MIME type (.exe) with 400', async () => {
      const res = await request(app)
        .post('/api/assets/upload')
        .set(authHeader)
        .attach('file', createFakeExecutable(), 'evil.exe')
        .field('kind', 'asset');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/invalid file type|file type/i);
    });

    it('should reject malicious SVG with script with 400', async () => {
      const res = await request(app)
        .post('/api/assets/upload')
        .set(authHeader)
        .attach('file', createMaliciousSVG(), 'evil.svg')
        .field('kind', 'asset');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/invalid file type|file type|script/i);
    });

    it('should reject missing file with 400', async () => {
      const res = await request(app)
        .post('/api/assets/upload')
        .set(authHeader)
        .field('kind', 'asset');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/required|file/i);
    });

    it('should default kind to asset when not provided', async () => {
      const res = await request(app)
        .post('/api/assets/upload')
        .set(authHeader)
        .attach('file', createTestImage(), 'test.png');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.asset.kind).toBe('asset');
    });

    it('should accept kind=reference and store as reference', async () => {
      const res = await request(app)
        .post('/api/assets/upload')
        .set(authHeader)
        .attach('file', createTestImage(), 'ref.png')
        .field('kind', 'reference');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.asset.kind).toBe('reference');
    });

    it('should reject invalid kind value', async () => {
      const res = await request(app)
        .post('/api/assets/upload')
        .set(authHeader)
        .attach('file', createTestImage(), 'test.png')
        .field('kind', 'invalid');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/kind/i);
    });

    it('should require authentication', async () => {
      const res = await request(app)
        .post('/api/assets/upload')
        .attach('file', createTestImage(), 'test.png')
        .field('kind', 'asset');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/assets', () => {
    let uploadedAssetId;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/assets/upload')
        .set(authHeader)
        .attach('file', createTestImage(), 'list-test.png')
        .field('kind', 'asset');
      uploadedAssetId = res.body.asset.assetId;
    });

    it('should list user assets (kind=asset only)', async () => {
      const res = await request(app)
        .get('/api/assets')
        .set(authHeader);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      const myAsset = res.body.data.find(a => a.assetId === uploadedAssetId);
      expect(myAsset).toBeDefined();
      expect(myAsset.kind).toBe('asset');
    });

    it('should require authentication', async () => {
      const res = await request(app).get('/api/assets');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/assets/:id', () => {
    let uploadedAssetId;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/assets/upload')
        .set(authHeader)
        .attach('file', createTestImage(), 'get-test.png')
        .field('kind', 'asset');
      uploadedAssetId = res.body.asset.assetId;
    });

    it('should return asset metadata for owner', async () => {
      const res = await request(app)
        .get(`/api/assets/${uploadedAssetId}`)
        .set(authHeader);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.asset.assetId).toBe(uploadedAssetId);
      expect(res.body.asset.kind).toBe('asset');
    });

    it('should return 404 for non-existent asset', async () => {
      const res = await request(app)
        .get('/api/assets/00000000-0000-0000-0000-000000000000')
        .set(authHeader);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('should require authentication', async () => {
      const res = await request(app).get(`/api/assets/${uploadedAssetId}`);
      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /api/assets/:id', () => {
    it('should soft-delete owned asset', async () => {
      const uploadRes = await request(app)
        .post('/api/assets/upload')
        .set(authHeader)
        .attach('file', createTestImage(), 'delete-test.png')
        .field('kind', 'asset');
      const assetId = uploadRes.body.asset.assetId;

      const res = await request(app)
        .delete(`/api/assets/${assetId}`)
        .set(authHeader);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const getRes = await request(app)
        .get(`/api/assets/${assetId}`)
        .set(authHeader);
      expect(getRes.status).toBe(404);
    });

    it('should not allow deleting another user asset', async () => {
      const uploadRes = await request(app)
        .post('/api/assets/upload')
        .set(authHeader)
        .attach('file', createTestImage(), 'cross-user.png')
        .field('kind', 'asset');
      const assetId = uploadRes.body.asset.assetId;

      const adminHeader = { Authorization: 'Bearer mock-token-u-admin' };
      const res = await request(app)
        .delete(`/api/assets/${assetId}`)
        .set(adminHeader);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('should require authentication', async () => {
      const res = await request(app).delete('/api/assets/some-id');
      expect(res.status).toBe(401);
    });
  });

  describe('Asset file storage', () => {
    it('should store file in uploads/assets/ with UUID name', async () => {
      const res = await request(app)
        .post('/api/assets/upload')
        .set(authHeader)
        .attach('file', createTestImage(), 'storage-test.png')
        .field('kind', 'asset');

      expect(res.status).toBe(201);
      const assetUrl = res.body.asset.url;
      const filename = path.basename(assetUrl);
      const filePath = path.join(TEST_ASSETS_DIR, filename);
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('should not allow path traversal in filename', async () => {
      const res = await request(app)
        .post('/api/assets/upload')
        .set(authHeader)
        .attach('file', createTestImage(), '../../../etc/passwd.png')
        .field('kind', 'asset');

      expect(res.status).toBe(201);
      const assetUrl = res.body.asset.url;
      expect(assetUrl).not.toMatch(/\.\./);
      expect(assetUrl).toMatch(/^\/uploads\/assets\/asset-[a-f0-9-]{36}\.png$/);
    });
  });
});

describe('Assets API — Cross-user isolation', () => {
  const user1Header = { Authorization: 'Bearer mock-token-u-user1' };
  const user2Header = { Authorization: 'Bearer mock-token-u-user2' };

  const createTestImage = () => Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

  it('should not list user2 assets for user1', async () => {
    const uploadRes = await request(app)
      .post('/api/assets/upload')
      .set(user2Header)
      .attach('file', createTestImage(), 'user2-asset.png')
      .field('kind', 'asset');
    const user2AssetId = uploadRes.body.asset.assetId;

    const listRes = await request(app).get('/api/assets').set(user1Header);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.find(a => a.assetId === user2AssetId)).toBeUndefined();
  });

  it('should not allow user1 to GET user2 asset', async () => {
    const uploadRes = await request(app)
      .post('/api/assets/upload')
      .set(user2Header)
      .attach('file', createTestImage(), 'user2-asset2.png')
      .field('kind', 'asset');
    const user2AssetId = uploadRes.body.asset.assetId;

    const getRes = await request(app).get(`/api/assets/${user2AssetId}`).set(user1Header);
    expect(getRes.status).toBe(404);
  });

  it('should not allow user1 to DELETE user2 asset', async () => {
    const uploadRes = await request(app)
      .post('/api/assets/upload')
      .set(user2Header)
      .attach('file', createTestImage(), 'user2-asset3.png')
      .field('kind', 'asset');
    const user2AssetId = uploadRes.body.asset.assetId;

    const delRes = await request(app).delete(`/api/assets/${user2AssetId}`).set(user1Header);
    expect(delRes.status).toBe(403);
  });
});

describe('Assets API — Concurrent safety', () => {
  const token = 'Bearer mock-token-u-test';
  const authHeader = { Authorization: token };

  it('should handle concurrent uploads without corruption', async () => {
    const promises = Array.from({ length: 5 }, (_, i) =>
      request(app)
        .post('/api/assets/upload')
        .set(authHeader)
        .attach('file', createTestImage(), `concurrent-${i}.png`)
        .field('kind', 'asset')
    );
    const results = await Promise.all(promises);
    results.forEach(res => {
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.asset.assetId).toBeDefined();
    });
    const ids = results.map(r => r.body.asset.assetId);
    expect(new Set(ids).size).toBe(5);
  });
});