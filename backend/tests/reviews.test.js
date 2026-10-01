/**
 * Reviews API — customer feedback tied to real orders.
 * POST /api/reviews (owner or guest+watchToken, one per order, not cancelled)
 * GET  /api/reviews/public (visible only) / /mine (own)
 * Admin: GET / (all + stats), PUT /:id/visibility, DELETE /:id
 *
 * Isolation: fileStoreFactoryAll mirrors EVERY data/*.json into a temp dir, so
 * tests never touch real orders.json / reviews.json.
 */
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { generateTestToken, generateAdminToken, authHeader } = require('./helpers/setup');

jest.mock('../db', () => require('./helpers/testIsolation').dbFactory());
jest.mock('../utils/fileStore', () => require('./helpers/testIsolation').fileStoreFactoryAll('reviews'));
jest.mock('../middleware/rateLimit', () => ({
  apiLimiter: (req, res, next) => next(),
  authLimiter: (req, res, next) => next(),
  otpLimiter: (req, res, next) => next(),
  aiLimiter: (req, res, next) => next(),
  orderLimiter: (req, res, next) => next(),
  galleryLimiter: (req, res, next) => next(),
}));

const app = require('../app');
const { _testDir, _testCleanup } = require('../utils/fileStore');

afterAll(() => { _testCleanup(); });

const reviewsFile = () => path.join(_testDir, 'reviews.json');
const ordersFile = () => path.join(_testDir, 'orders.json');

function seedOrder(order) {
  const p = ordersFile();
  const list = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8') || '[]') : [];
  list.push(order);
  fs.writeFileSync(p, JSON.stringify(list, null, 2), 'utf8');
}

let counter = 0;
function makeOrder(overrides = {}) {
  counter += 1;
  return Object.assign({
    orderId: 'BU-REV-' + String(counter).padStart(4, '0'),
    userId: 'u-test',
    customer: { name: 'Test Customer', phone: '0900000000', address: 'HCM' },
    productType: 'tshirt',
    quantity: 1,
    price: 250000,
    total: 250000,
    finalPrice: 250000,
    status: 'processing',
    paymentStatus: 'paid',
    payment: 'BANK_TRANSFER',
    paymentWatchToken: 'watch-' + counter,
    createdAt: new Date().toISOString(),
  }, overrides);
}

describe('POST /api/reviews — create review', () => {
  it('401 for a guest without token and without watchToken', async () => {
    seedOrder(makeOrder({ orderId: 'BU-REV-NOAUTH' }));
    const res = await request(app).post('/api/reviews').send({ orderId: 'BU-REV-NOAUTH', rating: 5, comment: 'Great!' });
    expect(res.status).toBe(403);
  });

  it('403 for a logged-in user who does not own the order (no watchToken)', async () => {
    seedOrder(makeOrder({ orderId: 'BU-REV-OTHER', userId: 'u-someone-else' }));
    const token = generateTestToken({ id: 'u-test' });
    const res = await request(app).post('/api/reviews').set(authHeader(token)).send({ orderId: 'BU-REV-OTHER', rating: 4, comment: 'Nice' });
    expect(res.status).toBe(403);
  });

  it('201 for the logged-in owner (visible, author from account)', async () => {
    seedOrder(makeOrder({ orderId: 'BU-REV-OWNER' }));
    const token = generateTestToken({ id: 'u-test', username: 'testuser' });
    const res = await request(app).post('/api/reviews').set(authHeader(token))
      .send({ orderId: 'BU-REV-OWNER', rating: 5, comment: 'Áo đẹp, giao nhanh!' });
    expect(res.status).toBe(201);
    expect(res.body.data.rating).toBe(5);
    expect(res.body.data.authorName).toBe('Test User');
    expect(res.body.data.userId).toBeUndefined(); // never leaked publicly
    expect(res.body.data.watchToken).toBeUndefined();
  });

  it('201 for a guest with the correct paymentWatchToken', async () => {
    const order = makeOrder({ orderId: 'BU-REV-GUEST', userId: null, customer: { name: 'Khách lẻ', phone: '0911', address: 'HN' } });
    seedOrder(order);
    const res = await request(app).post('/api/reviews').send({ orderId: 'BU-REV-GUEST', rating: 4, comment: 'Quy trình QR tiện', watchToken: order.paymentWatchToken });
    expect(res.status).toBe(201);
    expect(res.body.data.authorName).toBe('Khách lẻ');
  });

  it('403 for a guest with the WRONG watchToken', async () => {
    seedOrder(makeOrder({ orderId: 'BU-REV-GUESTRONG', userId: null }));
    const res = await request(app).post('/api/reviews').send({ orderId: 'BU-REV-GUESTRONG', rating: 4, comment: 'Impersonation', watchToken: 'wrong-token' });
    expect(res.status).toBe(403);
  });

  it('409 when the same order is reviewed twice', async () => {
    seedOrder(makeOrder({ orderId: 'BU-REV-DUP' }));
    const token = generateTestToken({ id: 'u-test' });
    const first = await request(app).post('/api/reviews').set(authHeader(token)).send({ orderId: 'BU-REV-DUP', rating: 5, comment: 'Lần đầu' });
    expect(first.status).toBe(201);
    const second = await request(app).post('/api/reviews').set(authHeader(token)).send({ orderId: 'BU-REV-DUP', rating: 1, comment: 'Lần hai' });
    expect(second.status).toBe(409);
  });

  it('409 when reviewing a cancelled order', async () => {
    seedOrder(makeOrder({ orderId: 'BU-REV-CANCELLED', status: 'cancelled' }));
    const token = generateTestToken({ id: 'u-test' });
    const res = await request(app).post('/api/reviews').set(authHeader(token)).send({ orderId: 'BU-REV-CANCELLED', rating: 1, comment: 'Đã hủy' });
    expect(res.status).toBe(409);
  });

  it('404 for unknown orderId', async () => {
    const token = generateTestToken({ id: 'u-test' });
    const res = await request(app).post('/api/reviews').set(authHeader(token)).send({ orderId: 'BU-REV-GHOST', rating: 5 });
    expect(res.status).toBe(404);
  });

  it('400 for invalid ratings', async () => {
    seedOrder(makeOrder({ orderId: 'BU-REV-BADR' }));
    const token = generateTestToken({ id: 'u-test' });
    for (const rating of [0, 6, 3.5, 'five']) {
      const res = await request(app).post('/api/reviews').set(authHeader(token)).send({ orderId: 'BU-REV-BADR', rating, comment: 'ok' });
      expect(res.status).toBe(400);
    }
  });

  it('400 for a comment that is too short or too long', async () => {
    seedOrder(makeOrder({ orderId: 'BU-REV-BADC' }));
    const token = generateTestToken({ id: 'u-test' });
    const short = await request(app).post('/api/reviews').set(authHeader(token)).send({ orderId: 'BU-REV-BADC', rating: 5, comment: 'a' });
    expect(short.status).toBe(400);
    const long = await request(app).post('/api/reviews').set(authHeader(token)).send({ orderId: 'BU-REV-BADC', rating: 5, comment: 'x'.repeat(601) });
    expect(long.status).toBe(400);
  });

  it('accepts a rating-only review (no comment)', async () => {
    seedOrder(makeOrder({ orderId: 'BU-REV-STARS' }));
    const token = generateTestToken({ id: 'u-test' });
    const res = await request(app).post('/api/reviews').set(authHeader(token)).send({ orderId: 'BU-REV-STARS', rating: 5 });
    expect(res.status).toBe(201);
    expect(res.body.data.comment).toBe('');
  });
});

describe('GET /api/reviews/public + /mine', () => {
  it('returns only visible reviews and never leaks private fields', async () => {
    seedOrder(makeOrder({ orderId: 'BU-REV-PUB1', userId: 'u-test' }));
    seedOrder(makeOrder({ orderId: 'BU-REV-PUB2', userId: 'u-test' }));
    const token = generateTestToken({ id: 'u-test' });
    await request(app).post('/api/reviews').set(authHeader(token)).send({ orderId: 'BU-REV-PUB1', rating: 5, comment: 'Public một' });
    await request(app).post('/api/reviews').set(authHeader(token)).send({ orderId: 'BU-REV-PUB2', rating: 4, comment: 'Public hai' });

    const res = await request(app).get('/api/reviews/public');
    expect(res.status).toBe(200);
    const ids = res.body.data.map(r => r.orderId);
    expect(ids).toContain('BU-REV-PUB1');
    expect(ids).toContain('BU-REV-PUB2');
    res.body.data.forEach(r => {
      expect(r.userId).toBeUndefined();
      expect(r.paymentWatchToken).toBeUndefined();
      expect(r.status).toBeUndefined();
    });
  });

  it('GET /mine returns only the current user reviews', async () => {
    seedOrder(makeOrder({ orderId: 'BU-REV-MINE1', userId: 'u-test' }));
    const otherOrder = makeOrder({ orderId: 'BU-REV-MINE2', userId: 'u-other' });
    seedOrder(otherOrder);
    const token = generateTestToken({ id: 'u-test' });
    await request(app).post('/api/reviews').set(authHeader(token)).send({ orderId: 'BU-REV-MINE1', rating: 5, comment: 'Của tôi' });
    await request(app).post('/api/reviews').send({ orderId: 'BU-REV-MINE2', rating: 3, comment: 'Của người khác', watchToken: otherOrder.paymentWatchToken });
    const res = await request(app).get('/api/reviews/mine').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data.some(r => r.orderId === 'BU-REV-MINE1')).toBe(true);
    expect(res.body.data.some(r => r.orderId === 'BU-REV-MINE2')).toBe(false);
  });

  it('401 for /mine without token', async () => {
    const res = await request(app).get('/api/reviews/mine');
    expect(res.status).toBe(401);
  });
});

describe('Admin review moderation', () => {
  it('non-admin cannot list, hide or delete', async () => {
    const userToken = generateTestToken({ id: 'u-test' });
    expect((await request(app).get('/api/reviews').set(authHeader(userToken))).status).toBe(403);
    expect((await request(app).put('/api/reviews/rev-x/visibility').set(authHeader(userToken)).send({ visible: false })).status).toBe(403);
    expect((await request(app).delete('/api/reviews/rev-x').set(authHeader(userToken))).status).toBe(403);
  });

  it('admin hides a review → it disappears from public, stats update', async () => {
    seedOrder(makeOrder({ orderId: 'BU-REV-HIDE', userId: 'u-test' }));
    const token = generateTestToken({ id: 'u-test' });
    const created = await request(app).post('/api/reviews').set(authHeader(token)).send({ orderId: 'BU-REV-HIDE', rating: 2, comment: 'Chưa ổn' });
    const id = created.body.data.id;

    const adminToken = generateAdminToken();
    const hide = await request(app).put(`/api/reviews/${id}/visibility`).set(authHeader(adminToken)).send({ visible: false });
    expect(hide.status).toBe(200);

    const pub = await request(app).get('/api/reviews/public');
    expect(pub.body.data.some(r => r.id === id)).toBe(false);

    const all = await request(app).get('/api/reviews').set(authHeader(adminToken));
    expect(all.status).toBe(200);
    const mine = all.body.data.find(r => r.id === id);
    expect(mine.status).toBe('hidden');
    expect(all.body.stats.hidden).toBeGreaterThanOrEqual(1);
    expect(all.body.stats.averageRating).toBeGreaterThanOrEqual(0);
    expect(all.body.stats.distribution).toBeDefined();
  });

  it('admin un-hides and deletes a review', async () => {
    seedOrder(makeOrder({ orderId: 'BU-REV-DEL', userId: 'u-test' }));
    const token = generateTestToken({ id: 'u-test' });
    const created = await request(app).post('/api/reviews').set(authHeader(token)).send({ orderId: 'BU-REV-DEL', rating: 5, comment: 'Sẽ xóa' });
    const id = created.body.data.id;
    const adminToken = generateAdminToken();

    const unhide = await request(app).put(`/api/reviews/${id}/visibility`).set(authHeader(adminToken)).send({ visible: true });
    expect(unhide.status).toBe(200);

    const del = await request(app).delete(`/api/reviews/${id}`).set(authHeader(adminToken));
    expect(del.status).toBe(200);
    expect((await request(app).delete(`/api/reviews/${id}`).set(authHeader(adminToken))).status).toBe(404);

    const pub = await request(app).get('/api/reviews/public');
    expect(pub.body.data.some(r => r.id === id)).toBe(false);
  });
});

describe('Shop reply + public stats', () => {
  it('admin replies to a review → reply appears in public data, empty clears it', async () => {
    seedOrder(makeOrder({ orderId: 'BU-REV-REPLY', userId: 'u-test' }));
    const token = generateTestToken({ id: 'u-test' });
    const created = await request(app).post('/api/reviews').set(authHeader(token)).send({ orderId: 'BU-REV-REPLY', rating: 4, comment: 'Sản phẩm ổn' });
    const id = created.body.data.id;
    const adminToken = generateAdminToken();

    const long = await request(app).put(`/api/reviews/${id}/reply`).set(authHeader(adminToken)).send({ reply: 'x'.repeat(601) });
    expect(long.status).toBe(400);

    const reply = await request(app).put(`/api/reviews/${id}/reply`).set(authHeader(adminToken)).send({ reply: 'Cảm ơn anh đã tin tưởng Blankup!' });
    expect(reply.status).toBe(200);
    expect(reply.body.data.reply.text).toBe('Cảm ơn anh đã tin tưởng Blankup!');

    const pub = await request(app).get('/api/reviews/public');
    const row = pub.body.data.find(r => r.id === id);
    expect(row.reply && row.reply.text).toBe('Cảm ơn anh đã tin tưởng Blankup!');
    expect(pub.body.stats.total).toBeGreaterThanOrEqual(1);
    expect(pub.body.stats.distribution[4]).toBeGreaterThanOrEqual(1);

    const cleared = await request(app).put(`/api/reviews/${id}/reply`).set(authHeader(adminToken)).send({ reply: '' });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.reply).toBeNull();
  });

  it('non-admin cannot reply', async () => {
    const userToken = generateTestToken({ id: 'u-test' });
    expect((await request(app).put('/api/reviews/rev-x/reply').set(authHeader(userToken)).send({ reply: 'hi' })).status).toBe(403);
  });
});
