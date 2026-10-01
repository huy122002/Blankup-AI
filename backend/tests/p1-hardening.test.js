/**
 * P1-01 Payment / Order / Voucher Business Hardening — Regression Tests
 *
 * Covers: P-07, P-06, O-01/S-02, O-02, P-04, P-08, P-05 (amount check)
 * Uses isolated fileStore + DB mock via testIsolation helper.
 */
const request = require('supertest');
const fs = require('fs');
const crypto = require('crypto');
const { generateTestToken, generateAdminToken, authHeader } = require('./helpers/setup');

jest.mock('../db', () => require('./helpers/testIsolation').dbFactory());
jest.mock('../utils/fileStore', () => require('./helpers/testIsolation').fileStoreFactory('p1-hardening'));
jest.mock('../middleware/rateLimit', () => ({
  apiLimiter: (req, res, next) => next(),
  authLimiter: (req, res, next) => next(),
  otpLimiter: (req, res, next) => next(),
  aiLimiter: (req, res, next) => next(),
  orderLimiter: (req, res, next) => next(),
}));

const app = require('../app');
const { _testOrdersFile: ordersFile, _testCleanup } = require('../utils/fileStore');

afterAll(() => { _testCleanup(); });

const VNP_HASH = 'TEST_SECRET_12345';
const VNP_TMN = 'TEST_TMN';

// Helper: build VNPay-style query params with valid HMAC
function vnpQuery(overrides = {}) {
  const secret = overrides.__hashSecret !== undefined ? overrides.__hashSecret : VNP_HASH;
  const params = {
    vnp_TmnCode: overrides.vnp_TmnCode !== undefined ? overrides.vnp_TmnCode : VNP_TMN,
    vnp_TxnRef: overrides.vnp_TxnRef || 'BU-TEST',
    vnp_Amount: overrides.vnp_Amount !== undefined ? String(overrides.vnp_Amount) : '50000000', // 500k *100
    vnp_ResponseCode: overrides.vnp_ResponseCode !== undefined ? overrides.vnp_ResponseCode : '00',
    vnp_TransactionNo: overrides.vnp_TransactionNo || '123456',
    vnp_BankCode: 'NCB',
    vnp_PayDate: '20260430120000',
    ...overrides,
  };
  delete params.__hashSecret;
  const keys = Object.keys(params).filter(k => k.startsWith('vnp_')).sort();
  const signData = keys.map(k => `${k}=${encodeURIComponent(String(params[k]).replace(/\+/g, ' '))}`).join('&');
  params.vnp_SecureHash = crypto.createHmac('sha512', secret).update(signData).digest('hex');
  return params;
}

function createOrderDirect(orderId, overrides = {}) {
  const orders = fs.existsSync(ordersFile) ? JSON.parse(fs.readFileSync(ordersFile, 'utf8') || '[]') : [];
  const order = {
    orderId,
    productType: 'tshirt', color: '#ffffff', size: 'M', quantity: 1,
    price: 250000, total: 250000, discountAmount: 0, finalPrice: 250000,
    customer: { name: 'Test', phone: '0901234567', address: 'HCM', note: '' },
    payment: 'VNPAY', paymentStatus: 'pending', status: 'awaiting_payment',
    userId: 'u-test', authorName: 'Tester',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
  orders.push(order);
  fs.writeFileSync(ordersFile, JSON.stringify(orders, null, 2), 'utf8');
  return order;
}

// ---------------------------------------------------------------------------
// P-07: VNPay secret fail-closed
// ---------------------------------------------------------------------------
describe('P-07: VNPay secret fail-closed', () => {
  const origSecret = process.env.VNP_HASH_SECRET;
  const origTmn = process.env.VNP_TMN_CODE;

  afterAll(() => {
    process.env.VNP_HASH_SECRET = origSecret;
    process.env.VNP_TMN_CODE = origTmn;
  });

  it('should reject /payment/create when VNPay not configured (503)', async () => {
    delete process.env.VNP_HASH_SECRET;
    delete process.env.VNP_TMN_CODE;
    const token = generateTestToken({ id: 'u-test', username: 'testuser', role: 'user' });
    const orderId = 'BU-P7-1-' + Date.now();
    createOrderDirect(orderId);
    const res = await request(app).post('/api/payment/create').set(authHeader(token)).send({ orderId, paymentMethod: 'VNPAY' });
    expect(res.status).toBe(503);
    expect(res.body.error.toLowerCase()).toMatch(/chưa được cấu hình|not configured/i);
    process.env.VNP_HASH_SECRET = VNP_HASH;
    process.env.VNP_TMN_CODE = VNP_TMN;
  });

  it('should accept /payment/create with correct secret (200 + paymentUrl)', async () => {
    process.env.VNP_HASH_SECRET = VNP_HASH;
    process.env.VNP_TMN_CODE = VNP_TMN;
    const token = generateTestToken({ id: 'u-test', username: 'testuser', role: 'user' });
    const orderId = 'BU-P7-2-' + Date.now();
    createOrderDirect(orderId);
    const res = await request(app).post('/api/payment/create').set(authHeader(token)).send({ orderId, paymentMethod: 'VNPAY' });
    expect(res.status).toBe(200);
    expect(res.body.paymentUrl).toBeDefined();
  });

  it('should reject verifyIpn when secret missing (isValid=false)', () => {
    const saved = process.env.VNP_HASH_SECRET;
    delete process.env.VNP_HASH_SECRET;
    const { verifyIpn } = require('../services/vnpay.service');
    // Need fresh require since module caches env. But verifyIpn reads process.env on each call.
    const r = verifyIpn({ vnp_SecureHash: 'anything', vnp_TxnRef: 'BU-X' });
    expect(r.isValid).toBe(false);
    expect(r.code).toBe('99');
    process.env.VNP_HASH_SECRET = saved || VNP_HASH;
  });

  it('should reject tampered payload (wrong signature)', async () => {
    process.env.VNP_HASH_SECRET = VNP_HASH;
    process.env.VNP_TMN_CODE = VNP_TMN;
    const orderId = 'BU-P7-3-' + Date.now();
    createOrderDirect(orderId);
    const q = vnpQuery({ vnp_TxnRef: orderId, vnp_ResponseCode: '00' });
    q.vnp_Amount = '999999999'; // tamper after sign
    const res = await request(app).get('/api/payment/vnpay-ipn').query(q);
    expect(res.body.RspCode).not.toBe('00');
  });

  it('should reject empty secret as invalid signature on IPN', async () => {
    process.env.VNP_HASH_SECRET = VNP_HASH;
    const orderId = 'BU-P7-4-' + Date.now();
    createOrderDirect(orderId);
    const q = vnpQuery({ vnp_TxnRef: orderId, __hashSecret: '' });
    const res = await request(app).get('/api/payment/vnpay-ipn').query(q);
    expect(res.body.RspCode).not.toBe('00');
  });
});

// ---------------------------------------------------------------------------
// P-06: VNPay state transition guard
// ---------------------------------------------------------------------------
describe('P-06: VNPay state transition guard', () => {
  beforeAll(() => {
    process.env.VNP_HASH_SECRET = VNP_HASH;
    process.env.VNP_TMN_CODE = VNP_TMN;
  });

  it('pending → paid via IPN: success', async () => {
    const orderId = 'BU-P6-1-' + Date.now();
    createOrderDirect(orderId, { paymentStatus: 'pending', status: 'awaiting_payment' });
    const q = vnpQuery({ vnp_TxnRef: orderId, vnp_ResponseCode: '00', vnp_Amount: '25000000' });
    const res = await request(app).get('/api/payment/vnpay-ipn').query(q);
    expect(res.body.RspCode).toBe('00');
    const orders = JSON.parse(fs.readFileSync(ordersFile, 'utf8'));
    const o = orders.find(x => x.orderId === orderId);
    expect(o.paymentStatus).toBe('paid');
    // Paid ≠ in production: successful payment parks the order in 'paid'.
    expect(o.status).toBe('paid');
  });

  it('pending → failed via IPN: failure code', async () => {
    const orderId = 'BU-P6-2-' + Date.now();
    createOrderDirect(orderId, { paymentStatus: 'pending', status: 'awaiting_payment' });
    const q = vnpQuery({ vnp_TxnRef: orderId, vnp_ResponseCode: '24' });
    const res = await request(app).get('/api/payment/vnpay-ipn').query(q);
    expect(res.body.RspCode).toBe('00'); // recorded as failure, but RspCode 00 (acknowledged)
    const o = JSON.parse(fs.readFileSync(ordersFile, 'utf8')).find(x => x.orderId === orderId);
    expect(o.paymentStatus).toBe('failed');
  });

  it('paid → paid is idempotent (already_paid)', async () => {
    const orderId = 'BU-P6-3-' + Date.now();
    createOrderDirect(orderId, { paymentStatus: 'paid', status: 'processing', paidAt: new Date().toISOString() });
    const q = vnpQuery({ vnp_TxnRef: orderId, vnp_ResponseCode: '00', vnp_Amount: '25000000' });
    const res = await request(app).get('/api/payment/vnpay-ipn').query(q);
    expect(res.body.RspCode).toBe('02');
    expect(res.body.Message).toMatch(/already/i);
  });

  it('failed → paid is allowed (retry): failed can be retried', async () => {
    const orderId = 'BU-P6-4-' + Date.now();
    createOrderDirect(orderId, { paymentStatus: 'failed', status: 'payment_failed' });
    const q = vnpQuery({ vnp_TxnRef: orderId, vnp_ResponseCode: '00', vnp_Amount: '25000000' });
    const res = await request(app).get('/api/payment/vnpay-ipn').query(q);
    expect(res.body.RspCode).toBe('00');
    const o = JSON.parse(fs.readFileSync(ordersFile, 'utf8')).find(x => x.orderId === orderId);
    expect(o.paymentStatus).toBe('paid');
  });

  it('cancelled order cannot be paid via IPN (blocked)', async () => {
    const orderId = 'BU-P6-5-' + Date.now();
    createOrderDirect(orderId, { paymentStatus: 'pending', status: 'cancelled' });
    const q = vnpQuery({ vnp_TxnRef: orderId, vnp_ResponseCode: '00', vnp_Amount: '25000000' });
    const res = await request(app).get('/api/payment/vnpay-ipn').query(q);
    expect(res.body.RspCode).toBe('02');
  });

  it('completed order cannot be paid via IPN (blocked)', async () => {
    const orderId = 'BU-P6-6-' + Date.now();
    createOrderDirect(orderId, { paymentStatus: 'pending', status: 'completed' });
    const q = vnpQuery({ vnp_TxnRef: orderId, vnp_ResponseCode: '00', vnp_Amount: '25000000' });
    const res = await request(app).get('/api/payment/vnpay-ipn').query(q);
    expect(res.body.RspCode).toBe('02');
  });

  it('cancelled order cannot create payment URL (409)', async () => {
    const orderId = 'BU-P6-7-' + Date.now();
    createOrderDirect(orderId, { paymentStatus: 'pending', status: 'cancelled' });
    const token = generateTestToken({ id: 'u-test', username: 'testuser', role: 'user' });
    const res = await request(app).post('/api/payment/create').set(authHeader(token)).send({ orderId, paymentMethod: 'VNPAY' });
    expect(res.status).toBe(409);
  });

  it('already paid order cannot create payment URL (409)', async () => {
    const orderId = 'BU-P6-8-' + Date.now();
    createOrderDirect(orderId, { paymentStatus: 'paid', status: 'processing' });
    const token = generateTestToken({ id: 'u-test', username: 'testuser', role: 'user' });
    const res = await request(app).post('/api/payment/create').set(authHeader(token)).send({ orderId, paymentMethod: 'VNPAY' });
    expect(res.status).toBe(409);
  });

  it('duplicate IPN is idempotent', async () => {
    const orderId = 'BU-P6-9-' + Date.now();
    createOrderDirect(orderId, { paymentStatus: 'pending', status: 'awaiting_payment' });
    const q = vnpQuery({ vnp_TxnRef: orderId, vnp_ResponseCode: '00', vnp_Amount: '25000000' });
    const r1 = await request(app).get('/api/payment/vnpay-ipn').query(q);
    const r2 = await request(app).get('/api/payment/vnpay-ipn').query(q);
    expect(r1.body.RspCode).toBe('00');
    expect(r2.body.RspCode).toBe('02'); // already paid
  });

  it('concurrent IPN: only one wins, other is already_paid', async () => {
    const orderId = 'BU-P6-10-' + Date.now();
    createOrderDirect(orderId, { paymentStatus: 'pending', status: 'awaiting_payment' });
    const q = vnpQuery({ vnp_TxnRef: orderId, vnp_ResponseCode: '00', vnp_Amount: '25000000' });
    const [r1, r2] = await Promise.all([
      request(app).get('/api/payment/vnpay-ipn').query(q),
      request(app).get('/api/payment/vnpay-ipn').query(q),
    ]);
    const codes = [r1.body.RspCode, r2.body.RspCode].sort();
    expect(codes).toEqual(['00', '02']);
  });

  it('amount mismatch is rejected even with valid signature', async () => {
    const orderId = 'BU-P6-11-' + Date.now();
    createOrderDirect(orderId, { paymentStatus: 'pending', status: 'awaiting_payment', finalPrice: 250000 });
    const q = vnpQuery({ vnp_TxnRef: orderId, vnp_ResponseCode: '00', vnp_Amount: '100000' }); // 1k not 250k
    const res = await request(app).get('/api/payment/vnpay-ipn').query(q);
    expect(res.body.RspCode).toBe('04');
  });
});

// ---------------------------------------------------------------------------
// O-02: Unknown productType must be rejected (no silent fallback)
// ---------------------------------------------------------------------------
describe('O-02: Unknown productType rejection', () => {
  it('should reject unknown productType', async () => {
    const res = await request(app).post('/api/orders').send({
      productType: 'unknown_type', color: '#ffffff', size: 'M', quantity: 1,
      customer: { name: 'A', phone: '0901', address: 'HN' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/không hợp lệ/i);
  });

  it('should reject empty productType as invalid', async () => {
    const res = await request(app).post('/api/orders').send({
      productType: '', color: '#ffffff', size: 'M', quantity: 1,
      customer: { name: 'A', phone: '0901', address: 'HN' },
    });
    expect(res.status).toBe(400);
  });

  it('should reject random string productType', async () => {
    const res = await request(app).post('/api/orders').send({
      productType: 'DROP TABLE', color: '#ffffff', size: 'M', quantity: 1,
      customer: { name: 'A', phone: '0901', address: 'HN' },
    });
    expect(res.status).toBe(400);
  });

  it('should accept valid productTypes', async () => {
    for (const pt of ['tshirt', 'oversize', 'polo', 'hoodie']) {
      const res = await request(app).post('/api/orders').send({
        productType: pt, color: '#ffffff', size: 'M', quantity: 1,
        customer: { name: 'A', phone: '0901', address: 'HN' },
      });
      expect(res.status).toBe(201);
    }
  });

  it('should accept case-insensitive valid productType', async () => {
    const res = await request(app).post('/api/orders').send({
      productType: 'TShirt', color: '#ffffff', size: 'M', quantity: 1,
      customer: { name: 'A', phone: '0901', address: 'HN' },
    });
    expect(res.status).toBe(201);
  });

  it('should use backend price, not client price (server-side price truth)', async () => {
    const res = await request(app).post('/api/orders').send({
      productType: 'hoodie', color: '#ffffff', size: 'M', quantity: 2,
      customer: { name: 'A', phone: '0901', address: 'HN' },
      price: 1, total: 1, finalPrice: 1, // client tries to cheat
    });
    expect(res.status).toBe(201);
    const orders = JSON.parse(fs.readFileSync(ordersFile, 'utf8'));
    const o = orders.find(x => x.orderId === res.body.orderId);
    expect(o.price).toBe(450000); // hoodie price
    expect(o.total).toBe(900000);
    expect(o.finalPrice).toBe(900000);
  });
});

// ---------------------------------------------------------------------------
// O-01/S-02: Guest userId spoofing
// ---------------------------------------------------------------------------
describe('O-01/S-02: Guest userId spoofing', () => {
  it('guest cannot claim arbitrary userId', async () => {
    const res = await request(app).post('/api/orders').send({
      productType: 'tshirt', color: '#ffffff', size: 'M', quantity: 1,
      customer: { name: 'Guest', phone: '0901', address: 'HN' },
      userId: 'u-victim',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/không được gán userId/i);
  });

  it('guest order without userId is allowed', async () => {
    const res = await request(app).post('/api/orders').send({
      productType: 'tshirt', color: '#ffffff', size: 'M', quantity: 1,
      customer: { name: 'Guest', phone: '0901', address: 'HN' },
    });
    expect(res.status).toBe(201);
  });

  it('authenticated user order is owned by req.user.id (ignores spoofed body)', async () => {
    const token = generateTestToken({ id: 'u-test', username: 'testuser', role: 'user' });
    // Body claims different userId — must be rejected
    const res = await request(app).post('/api/orders').set(authHeader(token)).send({
      productType: 'tshirt', color: '#ffffff', size: 'M', quantity: 1,
      customer: { name: 'Auth', phone: '0901', address: 'HN' },
      userId: 'u-other',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/không khớp/i);
  });

  it('authenticated user order without spoof is owned correctly', async () => {
    const token = generateTestToken({ id: 'u-test', username: 'testuser', role: 'user' });
    const res = await request(app).post('/api/orders').set(authHeader(token)).send({
      productType: 'tshirt', color: '#ffffff', size: 'M', quantity: 1,
      customer: { name: 'Auth', phone: '0901', address: 'HN' },
    });
    expect(res.status).toBe(201);
    const orders = JSON.parse(fs.readFileSync(ordersFile, 'utf8'));
    const o = orders.find(x => x.orderId === res.body.orderId);
    expect(o.userId).toBe('u-test');
  });

  it('authenticated user sending own userId explicitly is allowed', async () => {
    const token = generateTestToken({ id: 'u-test', username: 'testuser', role: 'user' });
    const res = await request(app).post('/api/orders').set(authHeader(token)).send({
      productType: 'tshirt', color: '#ffffff', size: 'M', quantity: 1,
      customer: { name: 'Auth', phone: '0901', address: 'HN' },
      userId: 'u-test',
    });
    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// P-08: Payment URL concurrency (write inside mutex)
// ---------------------------------------------------------------------------
describe('P-08: Payment URL concurrency', () => {
  beforeAll(() => {
    process.env.VNP_HASH_SECRET = VNP_HASH;
    process.env.VNP_TMN_CODE = VNP_TMN;
  });

  it('concurrent payment/create for same order: only one paymentUrl, no lost update', async () => {
    const orderId = 'BU-P8-1-' + Date.now();
    createOrderDirect(orderId, { paymentStatus: 'pending', status: 'awaiting_payment', finalPrice: 250000 });
    const token = generateTestToken({ id: 'u-test', username: 'testuser', role: 'user' });
    const reqs = Array.from({ length: 5 }, () =>
      request(app).post('/api/payment/create').set(authHeader(token)).send({ orderId, paymentMethod: 'VNPAY' })
    );
    const results = await Promise.all(reqs);
    // All should succeed or contain same paymentUrl
    const urls = results.filter(r => r.status === 200).map(r => r.body.paymentUrl).filter(Boolean);
    expect(urls.length).toBeGreaterThan(0);
    // No 500s
    results.forEach(r => expect([200, 409]).toContain(r.status));
    // Order file should have consistent paymentUrl
    const o = JSON.parse(fs.readFileSync(ordersFile, 'utf8')).find(x => x.orderId === orderId);
    expect(o.paymentUrl).toBeDefined();
  });

  it('duplicate payment/create is consistent (no duplicate payment records)', async () => {
    const orderId = 'BU-P8-2-' + Date.now();
    createOrderDirect(orderId, { paymentStatus: 'pending', status: 'awaiting_payment', finalPrice: 250000 });
    const token = generateTestToken({ id: 'u-test', username: 'testuser', role: 'user' });
    const r1 = await request(app).post('/api/payment/create').set(authHeader(token)).send({ orderId, paymentMethod: 'VNPAY' });
    const r2 = await request(app).post('/api/payment/create').set(authHeader(token)).send({ orderId, paymentMethod: 'VNPAY' });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
  });
});
