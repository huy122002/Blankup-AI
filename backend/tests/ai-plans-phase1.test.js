/**
 * Phase 1 O — Quote + Purchase hardening + Voucher integrity
 * Covers spec items 1-27 + security tampering
 */
const request = require('supertest');
const { generateTestToken, authHeader } = require('./helpers/setup');

let mockDb;

jest.mock('../db', () => ({
  getPool: jest.fn(() => ({
    request: jest.fn(() => {
      const inputs = {};
      return {
        input: jest.fn().mockImplementation(function (name, type, value) { inputs[name]=value; return this; }),
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
          input: jest.fn().mockImplementation(function (name, type, value) { txInputs[name]=value; return this; }),
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

function ok(){ return Promise.resolve({ recordset: [], rowsAffected: [1] }); }
function handleAuth(inputs, sql){
  if(sql.includes('FROM Users WHERE id')){
    const userId = inputs.id;
    const users = { 'u-buyer': { id:'u-buyer', username:'buyer', role:'user' }, 'u-admin': { id:'u-admin', username:'admin', role:'admin' }, 'u-test': { id:'u-test', username:'testuser', role:'user' } };
    const u = users[userId] || { id:userId, username:'testuser', role:'user' };
    return Promise.resolve({ recordset: [u] });
  }
  return null;
}

const basePlan = { id:'plan-pro', code:'pro', name:'Pro', description:'Pro plan', priceVnd:129000, highCredits:18, bonusLowCredits:3, dailyFreeLowCredits:0, outputQuality:'high', planRank:3, isPaid:true, isActive:true };
const inactivePlan = { ...basePlan, id:'plan-inactive', code:'inactive', isActive:false };

describe('Phase1 POST /api/ai-plans/quote', ()=>{
  const userToken = generateTestToken({ id:'u-buyer', role:'user' });

  beforeEach(()=>{
    mockDb = (inputs, sql)=>{
      const auth = handleAuth(inputs, sql); if(auth) return auth;
      if(sql.includes('FROM AiPlans') && sql.includes('id = @planId')){
        const p = inputs.planId==='plan-inactive' ? inactivePlan : (inputs.planId==='plan-pro' || !inputs.planId ? basePlan : null);
        if(!p || !p.isActive) return Promise.resolve({ recordset: [] });
        return Promise.resolve({ recordset: [p] });
      }
      if(sql.includes('FROM AiPlans') && sql.includes('code = @planCode')){
        const p = inputs.planCode==='pro' ? basePlan : null;
        return Promise.resolve({ recordset: p ? [p] : [] });
      }
      if(sql.includes('FROM Vouchers') && sql.includes('code = @code')){
        const code = inputs.code;
        const vouchers = {
          'FIX10': { id:'v-fix', code:'FIX10', status:'active', discountType:'fixed', discountValue:10000, appliesTo:'all', totalUsageLimit:null, usedCount:0, perUserLimit:1, startsAt:null, expiresAt:null, eligiblePlanCodes:null, bonusHighCredits:0, bonusLowCredits:0, maxDiscountAmount:null, minOrderAmount:0 },
          'PERCENT20': { id:'v-pct', code:'PERCENT20', status:'active', discountType:'percent', discountValue:20, appliesTo:'plan', totalUsageLimit:null, usedCount:0, perUserLimit:5, startsAt:null, expiresAt:null, eligiblePlanCodes:null, bonusHighCredits:2, bonusLowCredits:3, maxDiscountAmount:30000, minOrderAmount:50000 },
          'EXPIRED': { id:'v-exp', code:'EXPIRED', status:'active', discountType:'fixed', discountValue:5000, appliesTo:'all', totalUsageLimit:null, usedCount:0, perUserLimit:5, startsAt:null, expiresAt: new Date(Date.now()-100000).toISOString(), eligiblePlanCodes:null, bonusHighCredits:0, bonusLowCredits:0, maxDiscountAmount:null, minOrderAmount:0 },
          'DISABLED': { id:'v-dis', code:'DISABLED', status:'disabled', discountType:'fixed', discountValue:5000, appliesTo:'all', totalUsageLimit:null, usedCount:0, perUserLimit:5, startsAt:null, expiresAt:null, eligiblePlanCodes:null, bonusHighCredits:0, bonusLowCredits:0, maxDiscountAmount:null, minOrderAmount:0 },
          'FUTURE': { id:'v-fut', code:'FUTURE', status:'active', discountType:'fixed', discountValue:5000, appliesTo:'all', totalUsageLimit:null, usedCount:0, perUserLimit:5, startsAt: new Date(Date.now()+1000000).toISOString(), expiresAt:null, eligiblePlanCodes:null, bonusHighCredits:0, bonusLowCredits:0, maxDiscountAmount:null, minOrderAmount:0 },
          'LIMIT1': { id:'v-limit', code:'LIMIT1', status:'active', discountType:'fixed', discountValue:5000, appliesTo:'all', totalUsageLimit:1, usedCount:1, perUserLimit:5, startsAt:null, expiresAt:null, eligiblePlanCodes:null, bonusHighCredits:0, bonusLowCredits:0, maxDiscountAmount:null, minOrderAmount:0 },
          'USERLIMIT': { id:'v-user', code:'USERLIMIT', status:'active', discountType:'fixed', discountValue:5000, appliesTo:'all', totalUsageLimit:10, usedCount:0, perUserLimit:1, startsAt:null, expiresAt:null, eligiblePlanCodes:null, bonusHighCredits:0, bonusLowCredits:0, maxDiscountAmount:null, minOrderAmount:0 },
          'ORDERONLY': { id:'v-ord', code:'ORDERONLY', status:'active', discountType:'fixed', discountValue:5000, appliesTo:'order', totalUsageLimit:null, usedCount:0, perUserLimit:5, startsAt:null, expiresAt:null, eligiblePlanCodes:null, bonusHighCredits:0, bonusLowCredits:0, maxDiscountAmount:null, minOrderAmount:0 },
          'ELIGIBLE': { id:'v-elig', code:'ELIGIBLE', status:'active', discountType:'fixed', discountValue:5000, appliesTo:'plan', totalUsageLimit:null, usedCount:0, perUserLimit:5, startsAt:null, expiresAt:null, eligiblePlanCodes:'studio_plus', bonusHighCredits:0, bonusLowCredits:0, maxDiscountAmount:null, minOrderAmount:0 },
          'MIN100K': { id:'v-min', code:'MIN100K', status:'active', discountType:'fixed', discountValue:5000, appliesTo:'all', totalUsageLimit:null, usedCount:0, perUserLimit:5, startsAt:null, expiresAt:null, eligiblePlanCodes:null, bonusHighCredits:0, bonusLowCredits:0, maxDiscountAmount:null, minOrderAmount:200000 },
          'BONUS': { id:'v-bonus', code:'BONUS', status:'active', discountType:'fixed', discountValue:5000, appliesTo:'all', totalUsageLimit:null, usedCount:0, perUserLimit:5, startsAt:null, expiresAt:null, eligiblePlanCodes:null, bonusHighCredits:5, bonusLowCredits:10, maxDiscountAmount:null, minOrderAmount:0 },
        };
        return Promise.resolve({ recordset: vouchers[code] ? [vouchers[code]] : [] });
      }
      if(sql.includes('SELECT COUNT(*)') && sql.includes('VoucherRedemptions')){
        if(inputs.voucherId==='v-user') return Promise.resolve({ recordset: [{ cnt:1 }] });
        return Promise.resolve({ recordset: [{ cnt:0 }] });
      }
      return ok();
    };
  });

  it('1. quote without voucher returns price/final/high/low', async()=>{
    const res = await request(app).post('/api/ai-plans/quote').set(authHeader(userToken)).send({ planId:'plan-pro' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.priceVnd).toBe(129000);
    expect(res.body.data.discountAmount).toBe(0);
    expect(res.body.data.finalAmount).toBe(129000);
    expect(res.body.data.highCredits).toBe(18);
    expect(res.body.data.lowCredits).toBe(3);
    expect(res.body.data.voucher).toBeNull();
  });
  it('2. quote voucher fixed', async()=>{
    const res = await request(app).post('/api/ai-plans/quote').set(authHeader(userToken)).send({ planCode:'pro', voucherCode:'FIX10' });
    expect(res.status).toBe(200);
    expect(res.body.data.discountAmount).toBe(10000);
    expect(res.body.data.finalAmount).toBe(119000);
    expect(res.body.data.voucher.code).toBe('FIX10');
  });
  it('3. quote voucher percent with maxDiscount', async()=>{
    const res = await request(app).post('/api/ai-plans/quote').set(authHeader(userToken)).send({ planId:'plan-pro', voucherCode:'PERCENT20' });
    expect(res.status).toBe(200);
    // 20% of 129000 =25800 < max 30000 => 25800
    expect(res.body.data.discountAmount).toBe(25800);
    expect(res.body.data.finalAmount).toBe(129000-25800);
  });
  it('4. maxDiscount cap (percent capped)', async()=>{
    mockDb = (inputs, sql)=>{
      const a = handleAuth(inputs, sql); if(a) return a;
      if(sql.includes('FROM AiPlans')) return Promise.resolve({ recordset: [basePlan] });
      if(sql.includes('FROM Vouchers') && sql.includes('code = @code')) return Promise.resolve({ recordset: [{ id:'v-cap', code:'CAP', status:'active', discountType:'percent', discountValue:50, appliesTo:'plan', totalUsageLimit:null, usedCount:0, perUserLimit:5, startsAt:null, expiresAt:null, eligiblePlanCodes:null, bonusHighCredits:0, bonusLowCredits:0, maxDiscountAmount:10000, minOrderAmount:0 }] });
      if(sql.includes('SELECT COUNT')) return Promise.resolve({ recordset:[{cnt:0}] });
      return ok();
    };
    const res = await request(app).post('/api/ai-plans/quote').set(authHeader(userToken)).send({ planId:'plan-pro', voucherCode:'CAP' });
    expect(res.status).toBe(200);
    expect(res.body.data.discountAmount).toBe(10000);
  });
  it('5. minOrderAmount rejected', async()=>{
    const res = await request(app).post('/api/ai-plans/quote').set(authHeader(userToken)).send({ planId:'plan-pro', voucherCode:'MIN100K' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tối thiểu/i);
  });
  it('6. appliesTo order-only rejected for plan', async()=>{
    const res = await request(app).post('/api/ai-plans/quote').set(authHeader(userToken)).send({ planId:'plan-pro', voucherCode:'ORDERONLY' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/không áp dụng cho gói/i);
  });
  it('7. eligiblePlanCodes mismatch', async()=>{
    const res = await request(app).post('/api/ai-plans/quote').set(authHeader(userToken)).send({ planId:'plan-pro', voucherCode:'ELIGIBLE' });
    expect(res.status).toBe(400);
  });
  it('8. expired voucher', async()=>{
    const res = await request(app).post('/api/ai-plans/quote').set(authHeader(userToken)).send({ planId:'plan-pro', voucherCode:'EXPIRED' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/hết hạn/i);
  });
  it('9. disabled voucher', async()=>{
    const res = await request(app).post('/api/ai-plans/quote').set(authHeader(userToken)).send({ planId:'plan-pro', voucherCode:'DISABLED' });
    expect(res.status).toBe(400);
  });
  it('10. not yet started', async()=>{
    const res = await request(app).post('/api/ai-plans/quote').set(authHeader(userToken)).send({ planId:'plan-pro', voucherCode:'FUTURE' });
    expect(res.status).toBe(400);
  });
  it('11. totalUsageLimit exceeded', async()=>{
    const res = await request(app).post('/api/ai-plans/quote').set(authHeader(userToken)).send({ planId:'plan-pro', voucherCode:'LIMIT1' });
    expect(res.status).toBe(400);
  });
  it('12. perUserLimit exceeded', async()=>{
    const res = await request(app).post('/api/ai-plans/quote').set(authHeader(userToken)).send({ planId:'plan-pro', voucherCode:'USERLIMIT' });
    expect(res.status).toBe(400);
  });
  it('13. bonusHigh/low credits in quote', async()=>{
    const res = await request(app).post('/api/ai-plans/quote').set(authHeader(userToken)).send({ planId:'plan-pro', voucherCode:'BONUS' });
    expect(res.status).toBe(200);
    expect(res.body.data.highCredits).toBe(18+5);
    expect(res.body.data.lowCredits).toBe(3+10);
  });
  it('15. invalid plan', async()=>{
    mockDb = (inputs, sql)=>{ const a=handleAuth(inputs,sql); if(a) return a; if(sql.includes('FROM AiPlans')) return Promise.resolve({ recordset:[] }); return ok(); };
    const res = await request(app).post('/api/ai-plans/quote').set(authHeader(userToken)).send({ planId:'nonexistent' });
    expect(res.status).toBe(404);
  });
  it('16. inactive plan', async()=>{
    const res = await request(app).post('/api/ai-plans/quote').set(authHeader(userToken)).send({ planId:'plan-inactive' });
    expect(res.status).toBe(404);
  });
  it('17. quote ignores price tampering', async()=>{
    const res = await request(app).post('/api/ai-plans/quote').set(authHeader(userToken)).send({ planId:'plan-pro', priceVnd:1, discountAmount:99999, finalAmount:1 });
    expect(res.status).toBe(200);
    expect(res.body.data.priceVnd).toBe(129000);
    expect(res.body.data.finalAmount).toBe(129000);
  });
  it('24. quote does not create purchase (no insert)', async()=>{
    let inserted=false;
    mockDb = (inputs, sql)=>{ const a=handleAuth(inputs,sql); if(a) return a; if(sql.includes('INSERT INTO AiPlanPurchases')) inserted=true; if(sql.includes('FROM AiPlans')) return Promise.resolve({ recordset:[basePlan] }); if(sql.includes('FROM Vouchers')) return Promise.resolve({ recordset:[] }); if(sql.includes('SELECT COUNT')) return Promise.resolve({ recordset:[{cnt:0}] }); return ok(); };
    const res = await request(app).post('/api/ai-plans/quote').set(authHeader(userToken)).send({ planId:'plan-pro' });
    expect(res.status).toBe(200);
    expect(inserted).toBe(false);
  });
  it('401 without auth', async()=>{
    const res = await request(app).post('/api/ai-plans/quote').send({ planId:'plan-pro' });
    expect(res.status).toBe(401);
  });
});

describe('Phase1 POST /api/ai-plans/purchase hardening', ()=>{
  const userToken = generateTestToken({ id:'u-buyer', role:'user' });
  // Stateful mimic of PurchaseIdempotency PK(userId,idemKey): reset per test
  // so same-key replay / mismatch tests observe real table semantics.
  let idemRows;
  beforeEach(()=>{
    idemRows = {};
    mockDb = (inputs, sql)=>{
      const authResult = handleAuth(inputs, sql);
      if(authResult) return authResult;
      
      // Plan lookup
      if(sql.includes('FROM AiPlans') && sql.includes('id = @planId')) return Promise.resolve({ recordset:[basePlan] });
      if(sql.includes('FROM AiPlans') && sql.includes('code = @planCode')) return Promise.resolve({ recordset: inputs.planCode==='pro'? [basePlan]:[] });
      
      // Voucher lookup (with optional forUpdate)
      if(sql.includes('FROM Vouchers') && sql.includes('code = @code')){
        if(inputs.code==='FIX10') return Promise.resolve({ recordset:[{ id:'v-fix', code:'FIX10', status:'active', discountType:'fixed', discountValue:10000, appliesTo:'all', totalUsageLimit:null, usedCount:0, perUserLimit:5, startsAt:null, expiresAt:null, eligiblePlanCodes:null, bonusHighCredits:0, bonusLowCredits:0, maxDiscountAmount:null, minOrderAmount:0 }] });
        return Promise.resolve({ recordset:[] });
      }
      
      // New PurchaseIdempotency table queries (stateful mimic)
      if(sql.includes('FROM PurchaseIdempotency WHERE userId = @userId AND idemKey = @key')) {
        const row = idemRows[`${inputs.userId}:${inputs.key}`];
        return Promise.resolve({ recordset: row ? [row] : [] });
      }
      
      // Transaction support - mock the transaction object
      if(sql.includes('BEGIN TRANSACTION') || sql.includes('COMMIT TRANSACTION') || sql.includes('ROLLBACK TRANSACTION')) {
        return Promise.resolve({ recordset: [] });
      }
      
      // Voucher validation with forUpdate (UPDLOCK, HOLDLOCK, ROWLOCK)
      if(sql.includes('FROM Vouchers') && sql.includes('WITH (UPDLOCK, HOLDLOCK, ROWLOCK)')) {
        if(inputs.code==='FIX10') return Promise.resolve({ recordset:[{ id:'v-fix', code:'FIX10', status:'active', discountType:'fixed', discountValue:10000, appliesTo:'all', totalUsageLimit:null, usedCount:0, perUserLimit:5, startsAt:null, expiresAt:null, eligiblePlanCodes:null, bonusHighCredits:0, bonusLowCredits:0, maxDiscountAmount:null, minOrderAmount:0 }] });
        return Promise.resolve({ recordset:[] });
      }
      
      // Voucher lookup without forUpdate
      if(sql.includes('FROM Vouchers') && sql.includes('code = @code')){
        if(inputs.code==='FIX10') return Promise.resolve({ recordset:[{ id:'v-fix', code:'FIX10', status:'active', discountType:'fixed', discountValue:10000, appliesTo:'all', totalUsageLimit:null, usedCount:0, perUserLimit:5, startsAt:null, expiresAt:null, eligiblePlanCodes:null, bonusHighCredits:0, bonusLowCredits:0, maxDiscountAmount:null, minOrderAmount:0 }] });
        return Promise.resolve({ recordset:[] });
      }
      
      // PurchaseIdempotency table queries (stateful mimic)
      if(sql.includes('FROM PurchaseIdempotency WHERE userId = @userId AND idemKey = @key')) {
        const row = idemRows[`${inputs.userId}:${inputs.key}`];
        return Promise.resolve({ recordset: row ? [row] : [] });
      }
      if(sql.includes('INSERT INTO PurchaseIdempotency')) {
        const k = `${inputs.userId}:${inputs.key}`;
        if (idemRows[k]) {
          const e = new Error('Violation of PRIMARY KEY constraint. Cannot insert duplicate key.');
          e.number = 2627;
          return Promise.reject(e);
        }
        idemRows[k] = { userId: inputs.userId, idemKey: inputs.key, bodyHash: inputs.bodyHash, responseJson: null, status: 'in_progress', createdAt: new Date() };
        return Promise.resolve({ recordset: [] });
      }
      if(sql.includes('UPDATE PurchaseIdempotency')) {
        const k = `${inputs.userId}:${inputs.key}`;
        if (idemRows[k] && inputs.resp) {
          idemRows[k] = { ...idemRows[k], responseJson: inputs.resp, status: 'complete' };
        }
        return Promise.resolve({ recordset: [] });
      }
      if(sql.includes('DELETE FROM PurchaseIdempotency')) {
        delete idemRows[`${inputs.userId}:${inputs.key}`];
        return Promise.resolve({ recordset: [] });
      }
      
      // VoucherRedemptions with voucherId filter
      if(sql.includes('FROM VoucherRedemptions WHERE voucherId = @voucherId') || sql.includes('FROM VoucherRedemptions WHERE voucherId = @v')) {
        return Promise.resolve({ recordset: [] });
      }
      
      // Voucher lookup
      if(sql.includes('FROM Vouchers') && sql.includes('code = @code = @code')){
        if(inputs.code==='FIX10') return Promise.resolve({ recordset:[{ id:'v-fix', code:'FIX10', status:'active', discountType:'fixed', discountValue:10000, appliesTo:'all', totalUsageLimit:null, usedCount:0, perUserLimit:5, startsAt:null, expiresAt:null, eligiblePlanCodes:null, bonusHighCredits:0, bonusLowCredits:0, maxDiscountAmount:null, minOrderAmount:0 }] });
        return Promise.resolve({ recordset:[] });
      }
      
      // Voucher redemptions
      if(sql.includes('SELECT COUNT(*) AS n FROM VoucherRedemptions WHERE voucherId = @v') || sql.includes('FROM VoucherRedemptions WHERE voucherId = @v')) {
        return Promise.resolve({ recordset: [{ cnt: 0 }] });
      }
      
      // Voucher updates
      if(sql.includes('UPDATE Vouchers SET usedCount')) {
        return Promise.resolve({ recordset: [], rowsAffected: [1] });
      }
      
      // Standard COUNT queries
      if(sql.includes('SELECT COUNT(*) AS n FROM VoucherRedemptions WHERE voucherId = @v') || sql.includes('FROM VoucherRedemptions WHERE voucherId = @v')) {
        return Promise.resolve({ recordset: [{ cnt: 0 }] });
      }
      
      if(sql.includes('SELECT COUNT(*) AS n FROM AiPlanPurchases WHERE idempotencyKey = @k')) {
        return Promise.resolve({ recordset: [{ n: 0 }] });
      }
      
      // Voucher code queries with COUNT
      if(sql.includes('SELECT COUNT(*)') && (sql.includes('VoucherRedemptions') || sql.includes('VoucherRedemptions'))) {
        return Promise.resolve({ recordset: [{ cnt: 0 }] });
      }
      
      // Standard count queries
      if(sql.includes('SELECT COUNT')) return Promise.resolve({ recordset:[{cnt:0}] });
      
      // INSERT statements - just return ok for now
      if(sql.includes('INSERT INTO AiPlanPurchases')) return ok();
      if(sql.includes('INSERT INTO VoucherRedemptions')) return ok();
      if(sql.includes('INSERT INTO PurchaseIdempotency')) return Promise.resolve({ recordset: [] });
      
      // UPDATE statements
      if(sql.includes('UPDATE PurchaseIdempotency')) return Promise.resolve({ recordset: [], rowsAffected: [1] });
      if(sql.includes('UPDATE Vouchers SET usedCount')) return Promise.resolve({ recordset: [], rowsAffected: [1] });
      if(sql.includes('UPDATE AiPlanPurchases SET paymentStatus')) return Promise.resolve({ recordset: [], rowsAffected: [1] });
      if(sql.includes('UPDATE UserAiAccounts SET highCredits')) return Promise.resolve({ recordset: [], rowsAffected: [1] });
      
      // DELETE statements
      if(sql.includes('DELETE FROM PurchaseIdempotency')) return Promise.resolve({ recordset: [], rowsAffected: [1] });
      
      // Transaction support
      if(sql.includes('BEGIN TRANSACTION') || sql.includes('COMMIT TRANSACTION') || sql.includes('ROLLBACK TRANSACTION')) {
        return Promise.resolve({ recordset: [] });
      }
      
      return ok();
    };
  });
  it('21. purchase returns finalAmount backend-calculated', async()=>{
    const res = await request(app).post('/api/ai-plans/purchase').set(authHeader(userToken)).send({ planCode:'pro', voucherCode:'FIX10' });
    expect(res.status).toBe(201);
    expect(res.body.priceVnd).toBe(129000);
    expect(res.body.discountAmount).toBe(10000);
    expect(res.body.finalAmount).toBe(119000);
    expect(res.body.highCreditsAdded).toBe(18);
    expect(res.body.voucherCode).toBe('FIX10');
    expect(res.body.transferContent).toMatch(/^BLANKUP-AI-/);
  });
  it('17-20. purchase ignores tampered financial fields', async()=>{
    const res = await request(app).post('/api/ai-plans/purchase').set(authHeader(userToken)).send({ planId:'plan-pro', priceVnd:1, discountAmount:99999, finalAmount:1, highCreditsAdded:999, voucherCode:'FIX10' });
    expect(res.status).toBe(201);
    expect(res.body.priceVnd).toBe(129000);
    expect(res.body.discountAmount).toBe(10000);
    expect(res.body.finalAmount).toBe(119000);
    expect(res.body.highCreditsAdded).toBe(18);
  });
  it('22. idempotency success same key same body', async()=>{
    const key='test-key-123';
    const res1 = await request(app).post('/api/ai-plans/purchase').set(authHeader(userToken)).set('Idempotency-Key', key).send({ planCode:'pro' });
    expect([201,200]).toContain(res1.status);
    const res2 = await request(app).post('/api/ai-plans/purchase').set(authHeader(userToken)).set('Idempotency-Key', key).send({ planCode:'pro' });
    expect(res2.status).toBe(200);
    expect(res2.body.idempotent).toBe(true);
    expect(res2.body.purchaseId).toBe(res1.body.purchaseId);
  });
  it('23. idempotency same key different body rejected 409', async()=>{
    const key='conflict-key-'+Date.now();
    const res1 = await request(app).post('/api/ai-plans/purchase').set(authHeader(userToken)).set('Idempotency-Key', key).send({ planCode:'pro' });
    expect([201,200]).toContain(res1.status);
    const res2 = await request(app).post('/api/ai-plans/purchase').set(authHeader(userToken)).set('Idempotency-Key', key).send({ planCode:'pro', voucherCode:'FIX10' });
    expect(res2.status).toBe(409);
  });
  it('double purchase without idempotency creates distinct purchases', async()=>{
    const res1 = await request(app).post('/api/ai-plans/purchase').set(authHeader(userToken)).send({ planCode:'pro' });
    const res2 = await request(app).post('/api/ai-plans/purchase').set(authHeader(userToken)).send({ planCode:'pro' });
    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    expect(res1.body.purchaseId).not.toBe(res2.body.purchaseId);
  });
});

describe('Phase1 GET /api/ai-plans/vouchers/available', ()=>{
  it('should require auth', async()=>{
    const res = await request(app).get('/api/ai-plans/vouchers/available');
    expect(res.status).toBe(401);
  });
  it('should return available vouchers when authed', async()=>{
    const token = generateTestToken({ id:'u-buyer', role:'user' });
    mockDb = (inputs, sql)=>{ const a=handleAuth(inputs,sql); if(a) return a; if(sql.includes('FROM Vouchers')) return Promise.resolve({ recordset:[{ code:'BLANKUP50', title:'Test', status:'active' }] }); return ok(); };
    const res = await request(app).get('/api/ai-plans/vouchers/available').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
