/**
 * P0 Financial Integrity Tests — P0-07, P0-08, P0-09
 */

const request = require('supertest');
const { generateAdminToken, generateTestToken, authHeader } = require('./helpers/setup');

let mockDb;

jest.mock('../db', () => ({
  getPool: jest.fn(() => ({
    request: jest.fn(() => {
      const inputs = {};
      return {
        input: jest.fn().mockImplementation(function (name, type, value) {
          inputs[name] = value;
          return this;
        }),
        query: jest.fn().mockImplementation((sql) => mockDb(inputs, sql)),
      };
    }),
    transaction: jest.fn(() => ({
      begin: jest.fn(() => Promise.resolve()),
      commit: jest.fn(() => Promise.resolve()),
      rollback: jest.fn(() => Promise.resolve()),
      request: jest.fn(() => {
        const txInputs = {};
        return {
          input: jest.fn().mockImplementation(function (name, type, value) {
            txInputs[name] = value;
            return this;
          }),
          query: jest.fn().mockImplementation((sql) => mockDb(txInputs, sql)),
        };
      }),
    })),
  })),
  sql: { NVarChar: 'NVarChar', Int: 'Int' },
}));

jest.mock('../middleware/rateLimit', () => ({
  apiLimiter: (req, res, next) => next(),
  authLimiter: (req, res, next) => next(),
  otpLimiter: (req, res, next) => next(),
  aiLimiter: (req, res, next) => next(),
}));

const app = require('../app');

function ok() { return Promise.resolve({ recordset: [], rowsAffected: [1] }); }

function handleAuth(inputs, sql) {
  if (sql.includes('FROM Users WHERE id')) {
    const userId = inputs.id;
    const users = {
      'u-admin': { id: 'u-admin', username: 'admin', role: 'admin' },
      'u-buyer': { id: 'u-buyer', username: 'buyer', role: 'user' },
      'u-voucher-test': { id: 'u-voucher-test', username: 'testuser', role: 'user' },
    };
    return Promise.resolve({ recordset: users[userId] ? [users[userId]] : [] });
  }
  return null;
}

// ---------------------------------------------------------------------------
// P0-07: ADMIN CONFIRM DOUBLE-CREDIT
// ---------------------------------------------------------------------------
describe('P0-07: Admin Confirm — Atomic Credit Issuance', () => {
  const adminToken = generateAdminToken();
  const purchaseId = 'purchase-p07-001';

  beforeEach(() => {
    let confirmCount = 0;
    let alreadyProcessed = false;
    mockDb = (inputs, sql) => {
      const auth = handleAuth(inputs, sql);
      if (auth) return auth;

      if (sql.includes('UPDATE AiPlanPurchases') && sql.includes("paymentStatus = 'paid'") && sql.includes('OUTPUT inserted')) {
        confirmCount++;
        if (!alreadyProcessed && confirmCount === 1) {
          alreadyProcessed = true;
          return Promise.resolve({
            recordset: [{
              id: purchaseId, userId: 'u-buyer', planId: 'plan-pro',
              highCreditsAdded: 100, lowCreditsAdded: 50, paymentStatus: 'paid',
            }],
            rowsAffected: [1],
          });
        }
        return Promise.resolve({ recordset: [], rowsAffected: [0] });
      }
      if (sql.includes('UPDATE AiPlanPurchases') && sql.includes('paymentStatus') && !sql.includes('OUTPUT')) {
        alreadyProcessed = true;
        return ok();
      }
      if (sql.includes('SELECT paymentStatus FROM AiPlanPurchases')) {
        if (alreadyProcessed) {
          return Promise.resolve({ recordset: [{ paymentStatus: 'paid' }] });
        }
        return Promise.resolve({ recordset: [] });
      }
      if (sql.includes('SELECT * FROM UserAiAccounts')) {
        return Promise.resolve({
          recordset: [{ userId: 'u-buyer', highCredits: 0, bonusLowCredits: 0 }],
        });
      }
      if (sql.includes('UPDATE UserAiAccounts')) return ok();
      if (sql.includes('INSERT INTO AiCreditLedger')) return ok();
      return ok();
    };
  });

  it('should confirm payment and add credits once', async () => {
    const res = await request(app)
      .post(`/api/ai-plans/purchase/${purchaseId}/confirm`)
      .set(authHeader(adminToken))
      .send({ paymentStatus: 'paid', note: 'Verified' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('should reject second confirm (already paid)', async () => {
    await request(app)
      .post(`/api/ai-plans/purchase/${purchaseId}/confirm`)
      .set(authHeader(adminToken))
      .send({ paymentStatus: 'paid' });
    const res2 = await request(app)
      .post(`/api/ai-plans/purchase/${purchaseId}/confirm`)
      .set(authHeader(adminToken))
      .send({ paymentStatus: 'paid' });
    expect(res2.status).toBe(400);
    expect(res2.body.error).toMatch(/đã được xác nhận|xử lý/i);
  });

  it('should handle 10 concurrent confirms — only 1 succeeds financially', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app)
          .post(`/api/ai-plans/purchase/${purchaseId}/confirm`)
          .set(authHeader(adminToken))
          .send({ paymentStatus: 'paid' })
      )
    );
    const successes = results.filter(r => r.status === 200);
    const failures = results.filter(r => r.status === 400);
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(9);
  });

  it('should return 404 for non-existent purchase', async () => {
    mockDb = (inputs, sql) => {
      const auth = handleAuth(inputs, sql);
      if (auth) return auth;
      if (sql.includes('UPDATE AiPlanPurchases') && sql.includes('OUTPUT')) {
        return Promise.resolve({ recordset: [], rowsAffected: [0] });
      }
      if (sql.includes('SELECT paymentStatus')) {
        return Promise.resolve({ recordset: [] });
      }
      return ok();
    };
    const res = await request(app)
      .post('/api/ai-plans/purchase/purchase-nonexistent/confirm')
      .set(authHeader(adminToken))
      .send({ paymentStatus: 'paid' });
    expect(res.status).toBe(404);
  });

  it('should return 400 for invalid paymentStatus', async () => {
    const res = await request(app)
      .post(`/api/ai-plans/purchase/${purchaseId}/confirm`)
      .set(authHeader(adminToken))
      .send({ paymentStatus: 'invalid' });
    expect(res.status).toBe(400);
  });

  it('should reject customer attempting admin confirm', async () => {
    const customerToken = generateTestToken({ id: 'u-buyer', role: 'user' });
    const res = await request(app)
      .post(`/api/ai-plans/purchase/${purchaseId}/confirm`)
      .set(authHeader(customerToken))
      .send({ paymentStatus: 'paid' });
    expect(res.status).toBe(403);
  });

  it('should mark as failed atomically (not idempotent with paid)', async () => {
    const res1 = await request(app)
      .post(`/api/ai-plans/purchase/${purchaseId}/confirm`)
      .set(authHeader(adminToken))
      .send({ paymentStatus: 'failed' });
    expect(res1.status).toBe(200);
    const res2 = await request(app)
      .post(`/api/ai-plans/purchase/${purchaseId}/confirm`)
      .set(authHeader(adminToken))
      .send({ paymentStatus: 'paid' });
    expect(res2.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// P0-08: SEPAY WEBHOOK DOUBLE-CREDIT
// ---------------------------------------------------------------------------
describe('P0-08: Sepay Webhook — Atomic Credit Issuance', () => {
  const purchaseId = 'purchase-sepay-001';

  beforeEach(() => {
    let webhookCount = 0;
    let pendingTx = null;
    mockDb = (inputs, sql) => {
      // Transaction support
      if (sql.includes('BEGIN TRANSACTION') || sql.includes('COMMIT TRANSACTION') || sql.includes('ROLLBACK TRANSACTION')) {
        return Promise.resolve({ recordset: [] });
      }
      
      // UPDATE with OUTPUT inserted and transferContent (webhook paid)
      if (sql.includes('UPDATE AiPlanPurchases') && sql.includes("paymentStatus = 'paid'") && sql.includes('OUTPUT inserted') && sql.includes('transferContent')) {
        webhookCount++;
        if (webhookCount === 1) {
          return Promise.resolve({
            recordset: [{
              id: purchaseId, userId: 'u-buyer', planId: 'plan-pro',
              highCreditsAdded: 100, lowCreditsAdded: 50, finalAmount: 100000,
              paymentStatus: 'pending', // before update
            }],
            rowsAffected: [1],
          });
        }
        return Promise.resolve({ recordset: [], rowsAffected: [0] });
      }
      
      // Voucher lookup with FOR UPDATE (row lock)
      if (sql.includes('FROM Vouchers') && sql.includes('WITH (UPDLOCK, HOLDLOCK, ROWLOCK)')) {
        return Promise.resolve({ recordset: [] });
      }
      
      if (sql.includes('FROM Vouchers') && sql.includes('code = @code')) {
        return Promise.resolve({ recordset: [] });
      }
      
      if (sql.includes('SELECT * FROM UserAiAccounts')) {
        return Promise.resolve({
          recordset: [{ userId: 'u-buyer', highCredits: 0, bonusLowCredits: 0 }],
        });
      }
      if (sql.includes('SELECT paymentStatus FROM AiPlanPurchases')) {
        return Promise.resolve({ recordset: [{ paymentStatus: 'pending' }] });
      }
      if (sql.includes('UPDATE UserAiAccounts')) return ok();
      if (sql.includes('INSERT INTO AiCreditLedger')) return ok();
      return ok();
    };
  });

  it('should process webhook and add credits', async () => {
    const res = await request(app)
      .post('/api/ai-plans/webhook/sepay')
      .send({ transactionId: 'tx-001', amount: 100000, content: 'BLANKUP-AI-PRO', bankAccount: '0967145402', status: 'success' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('should return idempotent success on duplicate webhook', async () => {
    const body = { transactionId: 'tx-dup', amount: 100000, content: 'BLANKUP-AI-PRO', bankAccount: '0967145402', status: 'success' };
    const res1 = await request(app).post('/api/ai-plans/webhook/sepay').send(body);
    expect(res1.status).toBe(200);
    const res2 = await request(app).post('/api/ai-plans/webhook/sepay').send(body);
    expect(res2.status).toBe(200);
    expect(res2.body.message).toMatch(/already processed|No matching/i);
  });

  it('should handle 10 concurrent webhooks — only 1 succeeds financially', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app).post('/api/ai-plans/webhook/sepay')
          .send({ transactionId: 'tx-concurrent', amount: 100000, content: 'BLANKUP-AI-PRO', bankAccount: '0967145402', status: 'success' })
      )
    );
    const successes = results.filter(r => r.status === 200 && r.body.message === 'Payment confirmed');
    const idempotent = results.filter(r => r.status === 200 && r.body.message !== 'Payment confirmed');
    expect(successes.length).toBe(1);
    expect(idempotent.length).toBe(9);
  });

  it('should ignore webhook with non-matching content', async () => {
    const res = await request(app)
      .post('/api/ai-plans/webhook/sepay')
      .send({ transactionId: 'tx-other', amount: 50000, content: 'SOME-OTHER-BANK', bankAccount: '0967145402', status: 'success' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/Not a Blankup/i);
  });

  it('should handle amount mismatch gracefully', async () => {
    mockDb = () => Promise.resolve({ recordset: [], rowsAffected: [0] });
    const res = await request(app)
      .post('/api/ai-plans/webhook/sepay')
      .send({ transactionId: 'tx-wrong', amount: 999, content: 'BLANKUP-AI-PRO', bankAccount: '0967145402', status: 'success' });
    expect(res.status).toBe(200);
  });

  it('should return 401 with invalid webhook secret', async () => {
    process.env.SEPAY_WEBHOOK_SECRET = 'test-secret';
    try {
      const res = await request(app)
        .post('/api/ai-plans/webhook/sepay')
        .set('x-sepay-secret', 'wrong-secret')
        .send({ transactionId: 'tx-auth', amount: 100000, content: 'BLANKUP-AI-PRO', status: 'success' });
      expect(res.status).toBe(401);
    } finally {
      delete process.env.SEPAY_WEBHOOK_SECRET;
    }
  });

  it('should process webhook 24h later (replay) — idempotent', async () => {
    const body = { transactionId: 'tx-replay', amount: 100000, content: 'BLANKUP-AI-PRO', bankAccount: '0967145402', status: 'success' };
    const res1 = await request(app).post('/api/ai-plans/webhook/sepay').send(body);
    expect(res1.status).toBe(200);
    const res2 = await request(app).post('/api/ai-plans/webhook/sepay').send(body);
    expect(res2.status).toBe(200);
    expect(res2.body.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// P0-09: VOUCHER DOUBLE-SPENDING
// ---------------------------------------------------------------------------
describe('P0-09: Voucher — Concurrency-Safe Redemption', () => {
  const userToken = generateTestToken({ id: 'u-voucher-test', role: 'user' });
  let voucherUsedCount;

  beforeEach(() => {
    voucherUsedCount = 0;
    mockDb = (inputs, sql) => {
      const auth = handleAuth(inputs, sql);
      if (auth) return auth;

      if (sql.includes('FROM AiPlans') && sql.includes('isActive')) {
        return Promise.resolve({
          recordset: [{
            id: 'plan-pro', code: 'PRO', name: 'Pro Plan',
            priceVnd: 100000, highCredits: 100, bonusLowCredits: 50,
            dailyFreeLowCredits: 0, outputQuality: 'high',
            planRank: 1, isPaid: true, isActive: true,
          }],
        });
      }
      if (sql.includes('FROM Vouchers') && sql.includes('code = @code')) {
        const code = inputs.code;
        const vouchers = {
          VALID: { id: 'v-001', code: 'VALID', status: 'active', discountType: 'fixed', discountValue: 10000, appliesTo: 'all', totalUsageLimit: 5, usedCount: voucherUsedCount, perUserLimit: 2, startsAt: null, expiresAt: null, eligiblePlanCodes: null, bonusHighCredits: 0, bonusLowCredits: 0, maxDiscountAmount: null },
          LIMIT1: { id: 'v-limit', code: 'LIMIT1', status: 'active', discountType: 'fixed', discountValue: 5000, appliesTo: 'all', totalUsageLimit: 1, usedCount: voucherUsedCount, perUserLimit: 1, startsAt: null, expiresAt: null, eligiblePlanCodes: null, bonusHighCredits: 0, bonusLowCredits: 0, maxDiscountAmount: null },
          USERLIMIT: { id: 'v-userlimit', code: 'USERLIMIT', status: 'active', discountType: 'fixed', discountValue: 5000, appliesTo: 'all', totalUsageLimit: 100, usedCount: 0, perUserLimit: 1, startsAt: null, expiresAt: null, eligiblePlanCodes: null, bonusHighCredits: 0, bonusLowCredits: 0, maxDiscountAmount: null },
        };
        return Promise.resolve({ recordset: vouchers[code] ? [vouchers[code]] : [] });
      }
      if (sql.includes('SELECT COUNT(*)') && sql.includes('VoucherRedemptions')) {
        if (inputs.voucherId === 'v-userlimit') {
          return Promise.resolve({ recordset: [{ cnt: 1 }] });
        }
        return Promise.resolve({ recordset: [{ cnt: 0 }] });
      }
      if (sql.includes('INSERT INTO AiPlanPurchases')) return ok();
      if (sql.includes('INSERT INTO VoucherRedemptions')) {
        voucherUsedCount++;
        return ok();
      }
      return ok();
    };
  });

  it('should create purchase with valid voucher', async () => {
    const res = await request(app)
      .post('/api/ai-plans/purchase')
      .set(authHeader(userToken))
      .send({ planCode: 'PRO', voucherCode: 'VALID' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('should reject non-existent voucher', async () => {
    const res = await request(app)
      .post('/api/ai-plans/purchase')
      .set(authHeader(userToken))
      .send({ planCode: 'PRO', voucherCode: 'NOPE' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/không tồn tại/i);
  });

  it('should enforce total usage limit', async () => {
    voucherUsedCount = 1;
    mockDb = (inputs, sql) => {
      const auth = handleAuth(inputs, sql);
      if (auth) return auth;
      if (sql.includes('FROM AiPlans') && sql.includes('isActive')) {
        return Promise.resolve({
          recordset: [{ id: 'plan-pro', code: 'PRO', name: 'Pro', priceVnd: 100000, highCredits: 100, bonusLowCredits: 50, dailyFreeLowCredits: 0, outputQuality: 'high', planRank: 1, isPaid: true, isActive: true }],
        });
      }
      if (sql.includes('FROM Vouchers') && sql.includes('code = @code')) {
        return Promise.resolve({
          recordset: [{ id: 'v-001', code: 'VALID', status: 'active', discountType: 'fixed', discountValue: 10000, appliesTo: 'all', totalUsageLimit: 1, usedCount: 1, perUserLimit: 5, startsAt: null, expiresAt: null, eligiblePlanCodes: null, bonusHighCredits: 0, bonusLowCredits: 0, maxDiscountAmount: null }],
        });
      }
      if (sql.includes('SELECT COUNT(*)') && sql.includes('VoucherRedemptions')) {
        return Promise.resolve({ recordset: [{ cnt: 0 }] });
      }
      return ok();
    };
    const res = await request(app)
      .post('/api/ai-plans/purchase')
      .set(authHeader(userToken))
      .send({ planCode: 'PRO', voucherCode: 'VALID' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/hết lượt/i);
  });

  it('should enforce per-user limit', async () => {
    const res = await request(app)
      .post('/api/ai-plans/purchase')
      .set(authHeader(userToken))
      .send({ planCode: 'PRO', voucherCode: 'USERLIMIT' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tối đa số lần/i);
  });

  it('should handle 10 concurrent purchases with same voucher — respect limit', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app)
          .post('/api/ai-plans/purchase')
          .set(authHeader(userToken))
          .send({ planCode: 'PRO', voucherCode: 'LIMIT1' })
      )
    );
    const successes = results.filter(r => r.status === 201);
    const failures = results.filter(r => r.status === 400);
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(9);
  });

  it('should allow purchases without voucher', async () => {
    const res = await request(app)
      .post('/api/ai-plans/purchase')
      .set(authHeader(userToken))
      .send({ planCode: 'PRO' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('should return 404 for non-existent plan', async () => {
    mockDb = (inputs, sql) => {
      const auth = handleAuth(inputs, sql);
      if (auth) return auth;
      return Promise.resolve({ recordset: [] });
    };
    const res = await request(app)
      .post('/api/ai-plans/purchase')
      .set(authHeader(userToken))
      .send({ planCode: 'NONEXISTENT' });
    expect(res.status).toBe(404);
  });

  it('should return 400 when missing planId/planCode', async () => {
    const res = await request(app)
      .post('/api/ai-plans/purchase')
      .set(authHeader(userToken))
      .send({});
    expect(res.status).toBe(400);
  });

  it('should return 401 without auth token', async () => {
    const res = await request(app)
      .post('/api/ai-plans/purchase')
      .send({ planCode: 'PRO', voucherCode: 'VALID' });
    expect(res.status).toBe(401);
  });
});
