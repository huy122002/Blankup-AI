/**
 * Regression tests — AI-credit SePay webhook (POST /api/ai-plans/webhook/sepay)
 *
 * Guards the two production-breaking bugs found in the original implementation:
 *   1. It read `req.body.amount`, but the real SePay payload sends
 *      `transferAmount` → every real transfer was rejected as "Amount mismatch"
 *      and credits were never issued. Fixed via normalizeSepayPayload().
 *   2. It matched `/^BLANKUP-AI-(.+)$/i` against the raw content, but banks /
 *      SePay prepend/append noise (e.g. "CK TOI ... MBVCB.328471") → lookup
 *      missed. Fixed with prefix-anywhere match + case/separator-invariant key.
 *
 * The DB layer is mocked (same pattern as financial-integrity.test.js) and
 * orders.json is isolated to a temp dir, so tests never touch real data.
 */
const request = require('supertest');
const { generateTestToken, authHeader } = require('./helpers/setup');

jest.mock('../utils/fileStore', () => require('./helpers/testIsolation').fileStoreFactory('sepay-credit-webhook'));

// --- DB mock: records purchases + accounts, captures UPDATE inputs ----------
const mockCaptured = { updates: [], purchaseLookups: [], pendingPurchase: true, transferContentKey: null };

jest.mock('../db', () => {
  function createChain(extra) {
    const inputs = {};
    return {
      input: jest.fn().mockImplementation(function (name, _type, value) { inputs[name] = value; return this; }),
      query: jest.fn().mockImplementation((sql) => extra.query(inputs, sql)),
    };
  }
  function makeTx(extra) {
    return {
      begin: jest.fn(() => Promise.resolve()),
      commit: jest.fn(() => Promise.resolve()),
      rollback: jest.fn(() => Promise.resolve()),
      request: jest.fn(() => createChain(extra)),
    };
  }
  return {
    getPool: jest.fn(() => ({
      request: jest.fn(() => createChain(mockPoolExtra)),
      transaction: jest.fn(() => makeTx(mockTxExtra)),
    })),
    sql: { NVarChar: 'NVarChar', Int: 'Int', DateTime: 'DateTime' },
  };
});

jest.mock('../middleware/rateLimit', () => ({
  apiLimiter: (req, res, next) => next(),
  authLimiter: (req, res, next) => next(),
  otpLimiter: (req, res, next) => next(),
  aiLimiter: (req, res, next) => next(),
}));

const app = require('../app');

const FINAL_AMOUNT = 129000;
// Canonical (uppercase, separator-stripped) memo of the purchase below.
const PURCHASE_KEY = 'BLANKUPAIPROGYYWA3';
const purchaseRow = () => ({
  id: 'purchase-e2e-001',
  userId: 'u-test',
  planId: 'plan-pro',
  highCreditsAdded: 18,
  lowCreditsAdded: 3,
  finalAmount: FINAL_AMOUNT,
  paymentStatus: 'pending',
});

let mockPoolExtra;
let mockTxExtra;

function resetDb({ pending = true } = {}) {
  mockCaptured.updates = [];
  mockCaptured.pendingPurchase = pending;
  mockPoolExtra = {
    query(inputs, sql) {
      if (sql.includes('FROM Users WHERE id')) {
        return Promise.resolve({ recordset: [{ id: inputs.id, username: 'testuser', role: 'user', provider: 'local', email: null, avatar: null, fullName: 'Test' }] });
      }
      // Post-rollback probe: "already processed?" — mirrors the real WHERE match.
      if (sql.includes('SELECT paymentStatus FROM AiPlanPurchases')) {
        return Promise.resolve({ recordset: inputs.transferContent === PURCHASE_KEY ? [{ paymentStatus: 'paid' }] : [] });
      }
      return Promise.resolve({ recordset: [] });
    },
  };
  mockTxExtra = {
    query(inputs, sql) {
      // Webhook marks the purchase paid (OUTPUT inserted.*).
      // Simulate the WHERE match: only the real purchase key hits a row.
      if (sql.includes('UPDATE AiPlanPurchases') && sql.includes("paymentStatus = 'paid'")) {
        mockCaptured.transferContentKey = inputs.transferContent;
        mockCaptured.purchaseLookups.push(inputs.transferContent);
        if (inputs.transferContent === PURCHASE_KEY && mockCaptured.pendingPurchase) {
          mockCaptured.pendingPurchase = false;
          return Promise.resolve({ recordset: [purchaseRow()] });
        }
        return Promise.resolve({ recordset: [] });
      }
      if (sql.includes('SELECT paymentStatus FROM AiPlanPurchases')) {
        return Promise.resolve({ recordset: inputs.transferContent === PURCHASE_KEY ? [{ paymentStatus: 'paid' }] : [] });
      }
      if (sql.includes('SELECT * FROM UserAiAccounts')) {
        return Promise.resolve({ recordset: [{ userId: 'u-test', highCredits: 10, bonusLowCredits: 5 }] });
      }
      if (sql.includes('UPDATE UserAiAccounts')) {
        mockCaptured.updates.push({ high: inputs.highCredits, low: inputs.lowCredits });
        return Promise.resolve({ recordset: [], rowsAffected: [1] });
      }
      if (sql.includes('INSERT INTO AiCreditLedger')) return Promise.resolve({ recordset: [], rowsAffected: [1] });
      return Promise.resolve({ recordset: [], rowsAffected: [1] });
    },
  };
}

beforeEach(() => resetDb());

const secret = process.env.SEPAY_WEBHOOK_SECRET;
const secHeaders = secret ? { 'x-sepay-secret': secret } : {};

function postWebhook(body) {
  return request(app).post('/api/ai-plans/webhook/sepay').set(secHeaders).send(body);
}

// Real SePay documented payload: transferAmount (NOT amount), memo carries bank noise.
const REAL_SEPAY_BODY = {
  id: 881231,
  gateway: 'MBBank',
  transactionDate: '2026-10-01 16:45:00',
  accountNumber: '0967145402',
  code: 'BLANKUP-AI-PRO-GYYWA3',
  content: 'CK TOI BLANKUP-AI-PRO-GYYWA3 MBVCB.328471834',
  transferType: 'in',
  transferAmount: FINAL_AMOUNT,
  accumulated: FINAL_AMOUNT,
  referenceCode: 'MBVCB.328471834',
  description: 'Chuyen tien',
};

describe('Sepay credit webhook — real SePay payload handling', () => {
  it('confirms a REAL SePay payload (transferAmount + memo noise) and issues credits', async () => {
    const res = await postWebhook(REAL_SEPAY_BODY);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Payment confirmed');
    // Credits issued: 10+18 high, 5+3 low
    expect(mockCaptured.updates).toEqual([{ high: 28, low: 8 }]);
  });

  it('normalizes the memo key (uppercase, separators stripped) before lookup', async () => {
    await postWebhook(REAL_SEPAY_BODY);
    // "CK TOI BLANKUP-AI-PRO-GYYWA3 MBVCB.328471834" → BLANKUPAIPROGYYWA3
    expect(mockCaptured.transferContentKey).toBe('BLANKUPAIPROGYYWA3');
  });

  it('matches even when the bank lowercases the memo and drops separators in code', async () => {
    const res = await postWebhook({
      ...REAL_SEPAY_BODY,
      code: 'BLANKUPAIPROGYYWA3', // SePay's extracted code: no separators
      content: 'ck toi blankup-ai-pro-gyywa3 mbvcb 328471',
    });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Payment confirmed');
    expect(mockCaptured.transferContentKey).toBe(PURCHASE_KEY);
    expect(mockCaptured.updates).toEqual([{ high: 28, low: 8 }]);
  });

  it('rejects a wrong transferAmount (underpayment) and issues NO credits', async () => {
    const res = await postWebhook({ ...REAL_SEPAY_BODY, transferAmount: 50000 });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Amount mismatch');
    expect(mockCaptured.updates).toEqual([]); // no credit movement
  });

  it('accepts the legacy simplified body shape (amount field) unchanged', async () => {
    const res = await postWebhook({
      transactionId: 'tx-legacy',
      amount: FINAL_AMOUNT,
      content: 'BLANKUP-AI-PRO-GYYWA3',
      bankAccount: '0967145402',
      status: 'success',
    });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Payment confirmed');
    expect(mockCaptured.updates).toEqual([{ high: 28, low: 8 }]);
  });

  it('is idempotent on SePay retries (no double credit)', async () => {
    const res1 = await postWebhook(REAL_SEPAY_BODY);
    const res2 = await postWebhook(REAL_SEPAY_BODY);
    expect(res1.body.message).toBe('Payment confirmed');
    expect(res2.status).toBe(200);
    expect(res2.body.message).toBe('Payment already processed');
    expect(mockCaptured.updates).toEqual([{ high: 28, low: 8 }]); // credited exactly once
  });

  it('ignores transfers without the BLANKUP-AI memo', async () => {
    const res = await postWebhook({ ...REAL_SEPAY_BODY, content: 'CAM ON ANH NHIEU', code: '', referenceCode: 'MBVCB.1' });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Not a Blankup transaction');
    expect(mockCaptured.updates).toEqual([]);
  });

  it('returns No matching purchase for an unknown BLANKUP-AI code', async () => {
    const res = await postWebhook({ ...REAL_SEPAY_BODY, code: 'BLANKUP-AI-PRO-ZZZZZ9', content: 'CK TOI BLANKUP-AI-PRO-ZZZZZ9' });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('No matching purchase');
    expect(mockCaptured.updates).toEqual([]);
  });
});
