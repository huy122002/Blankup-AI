/**
 * SePay → ORDER payment reconciliation.
 *
 * Two layers are covered:
 *  1. the pure service (payload normalisation, order matching, state decisions)
 *  2. the real HTTP webhook + status endpoints, against an ISOLATED orders store
 *     (helpers/testIsolation) so the real backend/data/orders.json is never touched.
 *
 * The invariant under test: an order may only become "paid" when a real transfer
 * matched it AND covered the expected amount. Everything else leaves it waiting.
 */
const request = require('supertest');

jest.mock('../db', () => require('./helpers/testIsolation').dbFactory());
jest.mock('../utils/fileStore', () => require('./helpers/testIsolation').fileStoreFactory('sepay-order'));
jest.mock('../middleware/rateLimit', () => ({
  apiLimiter: (req, res, next) => next(),
  authLimiter: (req, res, next) => next(),
  otpLimiter: (req, res, next) => next(),
}));

const app = require('../app');
const { _testOrdersFile: ordersFile, _testCleanup } = require('../utils/fileStore');
const {
  normalizeSepayPayload,
  findOrderForSepay,
  applySepayToOrders,
  verifySepayRequest,
} = require('../services/sepay.service');
const { subscribe } = require('../services/order-events');

afterAll(() => {
  _testCleanup();
});

/* ------------------------------------------------------------------ helpers */

const EMPTY_ORDER = (over = {}) => ({
  orderId: 'BU-MUPOAO3Z-942c5c69',
  transferContent: 'BLANKUP-BU-MUPOAO3Z-942c5c69',
  payment: 'BANK_TRANSFER',
  paymentStatus: 'pending',
  status: 'awaiting_payment',
  price: 250000,
  quantity: 2,
  total: 500000,
  finalPrice: 500000,
  ...over,
});

/** A verbatim SePay webhook body (docs shape). */
const sepayBody = (over = {}) => ({
  id: 92704,
  gateway: 'MB Bank',
  transactionDate: '2026-10-01 14:02:37',
  accountNumber: '0967145402',
  code: 'BU-MUPOAO3Z-942C5C69',
  content: 'BLANKUP-BU-MUPOAO3Z-942c5c69 chuyen tien',
  transferType: 'in',
  transferAmount: 500000,
  accumulated: 500000,
  referenceCode: 'MBVCB.100000000000.200455',
  description: '',
  ...over,
});

async function createBankTransferOrder() {
  const res = await request(app).post('/api/orders').send({
    productType: 'tshirt',
    color: '#ffffff',
    size: 'L',
    quantity: 2,
    customer: { name: 'Test Buyer', phone: '0901234567', address: '123 Test St' },
    payment: 'BANK_TRANSFER',
  });
  expect(res.status).toBe(201);
  return res.body;
}

/* ------------------------------------------------- 1. pure service: parsing */

describe('SePay payload handling', () => {
  it('normalises the documented SePay body', () => {
    const n = normalizeSepayPayload(sepayBody());
    expect(n.transferType).toBe('in');
    expect(n.amount).toBe(500000);
    expect(n.code).toBe('BU-MUPOAO3Z-942C5C69');
    expect(n.transactionId).toBe('MBVCB.100000000000.200455');
    expect(n.gateway).toBe('MB Bank');
  });

  it('also accepts the simplified internal body used by the AI-plan webhook', () => {
    const n = normalizeSepayPayload({ transactionId: 'TX1', amount: 129000, content: 'BLANKUP-AI-ABC123' });
    expect(n.amount).toBe(129000);
    expect(n.transactionId).toBe('TX1');
    expect(n.transferType).toBe('in'); // omitted → treated as incoming
  });

  it('matches an order even when SePay mangles the memo case/separators', () => {
    const orders = [EMPTY_ORDER()];
    const variants = [
      'BU-MUPOAO3Z-942C5C69',
      'bumupoao3z942c5c69',
      'BLANKUP-BU-MUPOAO3Z-942c5c69 thanh toan don hang',
      'SEVQR BUMUPOAO3Z942C5C69',
    ];
    variants.forEach((content) => {
      expect(findOrderForSepay(orders, normalizeSepayPayload({ content }))).toBe(0);
    });
  });

  it('never matches an AI-plan memo against orders', () => {
    const orders = [EMPTY_ORDER()];
    expect(findOrderForSepay(orders, normalizeSepayPayload({ content: 'BLANKUP-AI-7F3KQ9 chuyen tien' }))).toBe(-1);
  });
});

/* ------------------------------------------------- 2. pure service: decisions */

describe('SePay → order state machine', () => {
  const run = (orderOver, bodyOver) => {
    const orders = [EMPTY_ORDER(orderOver)];
    const result = applySepayToOrders(orders, normalizeSepayPayload(sepayBody(bodyOver)));
    return { result, order: orders[0] };
  };

  it('marks the order paid on a full transfer and parks it in paid (not processing)', () => {
    const { result, order } = run();
    expect(result.action).toBe('paid');
    expect(order.paymentStatus).toBe('paid');
    expect(order.status).toBe('paid');
    expect(order.paidAt).toBeTruthy();
    expect(order.paymentReferenceCode).toBe('MBVCB.100000000000.200455');
    expect(order.paymentReceivedAmount).toBe(500000);
  });

  it('accepts an overpayment and records the surplus', () => {
    const { result, order } = run({}, { transferAmount: 600000 });
    expect(result.action).toBe('paid');
    expect(order.paymentOverpaidAmount).toBe(100000);
  });

  it('NEVER marks an underpaid transfer as paid', () => {
    const { result, order } = run({}, { transferAmount: 200000 });
    expect(result.action).toBe('underpaid');
    expect(order.paymentStatus).toBe('underpaid');
    expect(order.status).toBe('awaiting_payment');
    expect(order.paidAt).toBeFalsy();
    expect(order.paymentReceivedAmount).toBe(200000);
  });

  it('is idempotent: a repeated webhook keeps the terminal paid state', () => {
    const orders = [EMPTY_ORDER({ paymentStatus: 'paid', status: 'processing', paidAt: '2026-10-01T00:00:00.000Z' })];
    const result = applySepayToOrders(orders, normalizeSepayPayload(sepayBody()));
    expect(result.action).toBe('already_paid');
    expect(orders[0].paidAt).toBe('2026-10-01T00:00:00.000Z');
  });

  it('ignores money arriving for a cancelled order', () => {
    const { result, order } = run({ status: 'cancelled' });
    expect(result.action).toBe('cancelled');
    expect(order.paymentStatus).toBe('pending');
  });

  it('ignores outgoing transfers and memo-less payloads', () => {
    expect(run({}, { transferType: 'out' }).result.action).toBe('ignored_transfer_type');
    expect(run({}, { content: '', code: '' }).result.action).toBe('no_content');
  });

  it('reports not_found instead of inventing a match', () => {
    const orders = [EMPTY_ORDER()];
    const result = applySepayToOrders(orders, normalizeSepayPayload(sepayBody({ content: 'BU-OTHER-ABC12345', code: '' })));
    expect(result.action).toBe('not_found');
    expect(orders[0].paymentStatus).toBe('pending');
  });
});

describe('SePay webhook credential', () => {
  it('accepts several header shapes when the secret matches', () => {
    expect(verifySepayRequest({ 'x-sepay-secret': 's3cret' }, 's3cret').ok).toBe(true);
    expect(verifySepayRequest({ authorization: 'Bearer s3cret' }, 's3cret').ok).toBe(true);
    expect(verifySepayRequest({ authorization: 'Apikey s3cret' }, 's3cret').ok).toBe(true);
    expect(verifySepayRequest({ 'x-api-key': 's3cret' }, 's3cret').ok).toBe(true);
  });

  it('rejects a wrong or missing secret when one is configured', () => {
    expect(verifySepayRequest({ 'x-sepay-secret': 'nope' }, 's3cret').ok).toBe(false);
    expect(verifySepayRequest({}, 's3cret').ok).toBe(false);
  });

  it('reports "not configured" rather than pretending a check happened', () => {
    expect(verifySepayRequest({}, '')).toEqual({ configured: false, ok: true });
  });
});

/* ------------------------------------------- 3. real HTTP flow (isolated store) */

describe('POST /api/payment/sepay-webhook — end to end', () => {
  it('creates a bank-transfer order already waiting for payment', async () => {
    const body = await createBankTransferOrder();
    expect(body.payment).toBe('BANK_TRANSFER');
    expect(body.paymentStatus).toBe('pending');
    expect(body.status).toBe('awaiting_payment');
    expect(body.transferContent).toMatch(/^BLANKUP-BU-/);
    expect(body.amount).toBe(500000); // 250000 × 2, from the server, not the client
    expect(body.paymentWatchToken).toMatch(/^[a-f0-9]{32}$/);
    expect(body.bankInfo.accountNumber).toBe('0967145402');
  });

  it('confirms the order from a real webhook payload and publishes the event', async () => {
    const order = await createBankTransferOrder();
    const events = [];
    const unsubscribe = subscribe((e) => events.push(e));

    const res = await request(app).post('/api/payment/sepay-webhook').send(sepayBody({
      content: `${order.transferContent} chuyen tien`,
      transferAmount: order.amount,
    }));
    unsubscribe();

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Payment confirmed');
    expect(res.body.orderId).toBe(order.orderId);

    const status = await request(app).get(`/api/orders/${order.orderId}/payment-status`).query({ token: order.paymentWatchToken });
    expect(status.status).toBe(200);
    expect(status.body.paymentStatus).toBe('paid');
    expect(status.body.status).toBe('paid');
    expect(status.body.paidAt).toBeTruthy();

    const mine = events.filter((e) => e.orderId === order.orderId && e.paymentStatus === 'paid');
    expect(mine.length).toBeGreaterThanOrEqual(1);
  });

  it('stays paid when the same transfer is delivered twice', async () => {
    const order = await createBankTransferOrder();
    const payload = sepayBody({ content: order.transferContent, transferAmount: order.amount });

    const first = await request(app).post('/api/payment/sepay-webhook').send(payload);
    const second = await request(app).post('/api/payment/sepay-webhook').send(payload);

    expect(first.body.message).toBe('Payment confirmed');
    expect(second.body.message).toBe('Order already paid');

    const status = await request(app).get(`/api/orders/${order.orderId}/payment-status`).query({ token: order.paymentWatchToken });
    expect(status.body.paymentStatus).toBe('paid');
  });

  it('does not confirm an underpaid transfer', async () => {
    const order = await createBankTransferOrder();
    const res = await request(app).post('/api/payment/sepay-webhook').send(sepayBody({
      content: order.transferContent,
      transferAmount: 1000,
    }));

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('Underpaid');

    const status = await request(app).get(`/api/orders/${order.orderId}/payment-status`).query({ token: order.paymentWatchToken });
    expect(status.body.paymentStatus).toBe('underpaid');
    expect(status.body.status).toBe('awaiting_payment');
  });

  it('acks an unrelated transfer without touching any order', async () => {
    const res = await request(app).post('/api/payment/sepay-webhook').send(sepayBody({ content: 'BLANKUP-AI-NOPE123', code: '' }));
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('No matching order');
  });

  it('rejects a webhook with the wrong secret when one is configured', async () => {
    process.env.SEPAY_WEBHOOK_SECRET = 'correct-horse';
    try {
      const bad = await request(app).post('/api/payment/sepay-webhook').set('x-sepay-secret', 'wrong').send(sepayBody());
      expect(bad.status).toBe(401);

      const order = await createBankTransferOrder();
      const good = await request(app).post('/api/payment/sepay-webhook')
        .set('x-sepay-secret', 'correct-horse')
        .send(sepayBody({ content: order.transferContent, transferAmount: order.amount }));
      expect(good.status).toBe(200);
      expect(good.body.message).toBe('Payment confirmed');
    } finally {
      delete process.env.SEPAY_WEBHOOK_SECRET;
    }
  });
});

describe('Order payment status access', () => {
  it('lets a guest watch its own order with the token, and nobody else', async () => {
    const order = await createBankTransferOrder();

    const withToken = await request(app).get(`/api/orders/${order.orderId}/payment-status`).query({ token: order.paymentWatchToken });
    expect(withToken.status).toBe(200);
    expect(withToken.body.paymentStatus).toBe('pending');

    // No credential at all → 401 (and no order-existence probe).
    const withoutToken = await request(app).get(`/api/orders/${order.orderId}/payment-status`);
    expect(withoutToken.status).toBe(401);

    const wrongToken = await request(app).get(`/api/orders/${order.orderId}/payment-status`).query({ token: 'a'.repeat(32) });
    expect(wrongToken.status).toBe(403);
  });

  it('refuses an unauthenticated realtime stream without a valid token', async () => {
    const order = await createBankTransferOrder();
    const denied = await request(app).get('/api/orders/stream');
    expect(denied.status).toBe(401);

    const badToken = await request(app).get('/api/orders/stream').query({ orderId: order.orderId, token: 'b'.repeat(32) });
    expect(badToken.status).toBe(403);
  });
});
