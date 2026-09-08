const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { generateTestToken, authHeader } = require('./helpers/setup');

jest.mock('../db', () => {
  function createChain() {
    const inputs = {};
    return {
      input: jest.fn().mockImplementation(function(name, type, value) {
        inputs[name] = value;
        return this;
      }),
      query: jest.fn().mockImplementation((sql) => {
        if (sql.includes('FROM Users WHERE username')) {
          const username = inputs.username || 'testuser';
          return Promise.resolve({
            recordset: [{
              id: 'u-profile', username, fullName: 'Profile User',
              email: 'profile@test.com', avatar: null, provider: 'local',
              role: 'user', createdAt: new Date().toISOString(),
            }],
          });
        }
        if (sql.includes('FROM Users WHERE id')) {
          const userId = inputs.id || 'u-test';
          return Promise.resolve({
            recordset: [{
              id: userId, username: 'testuser', fullName: 'Test User',
              email: 'test@test.com', avatar: null, provider: 'local', role: 'user',
            }],
          });
        }
        if (sql.includes('FROM Users WHERE id IN')) {
          return Promise.resolve({ recordset: [] });
        }
        return Promise.resolve({ recordset: [] });
      }),
    };
  }
  return {
    getPool: jest.fn(() => ({ request: jest.fn(() => createChain()) })),
    sql: { NVarChar: 'NVarChar' },
  };
});

jest.mock('../middleware/rateLimit', () => ({
  apiLimiter: (req, res, next) => next(),
  authLimiter: (req, res, next) => next(),
  otpLimiter: (req, res, next) => next(),
}));
jest.mock('../utils/fileStore', () => require('./helpers/testIsolation').fileStoreFactoryAll('users'));

const app = require('../app');
const { _testCleanup } = require('../utils/fileStore');

afterAll(() => {
  _testCleanup();
});

describe('GET /api/users/:username', () => {
  it('should return user profile', async () => {
    const res = await request(app).get('/api/users/testuser');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.username).toBe('testuser');
    expect(res.body.data.stats).toBeDefined();
  });
});

describe('POST /api/users/:username/follow', () => {
  it('should return 401 without token', async () => {
    const res = await request(app).post('/api/users/testuser/follow');
    expect(res.status).toBe(401);
  });

  it('should follow or unfollow a user with valid token', async () => {
    const token = generateTestToken({ id: 'u-viewer', username: 'viewer' });
    const res = await request(app)
      .post('/api/users/profileuser/follow')
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.following).toBe('boolean');
  });
});
