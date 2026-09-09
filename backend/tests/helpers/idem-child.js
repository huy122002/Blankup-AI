/**
 * Child worker for cross-process / restart idempotency tests.
 * Boots the REAL app (real SQL Server, no mocks) in a FRESH process
 * (fresh in-memory state, simulating restart/deploy) and POSTs one
 * AI-plan purchase. Prints a single JSON line with the outcome.
 *
 * Usage: node idem-child.js <idemKey> <planCode> [voucherCode] [userId]
 */
const request = require('supertest');

async function main() {
  const [, , idemKey, planCode, voucherCode, userId] = process.argv;
  const { initDatabase } = require('../../db');
  await initDatabase();
  const app = require('../../app');
  const body = { planCode };
  if (voucherCode) body.voucherCode = voucherCode;
  const res = await request(app)
    .post('/api/ai-plans/purchase')
    .set('Idempotency-Key', idemKey)
    .set('Authorization', `Bearer mock-token-${userId || 'u-1'}`)
    .send(body);
  console.log(JSON.stringify({
    status: res.status,
    purchaseId: res.body && res.body.purchaseId,
    idempotent: !!(res.body && res.body.idempotent),
    error: res.body && res.body.error,
  }));
}

main().then(() => process.exit(0), (e) => {
  console.log(JSON.stringify({ status: 0, fatal: String((e && e.message) || e).slice(0, 200) }));
  process.exit(1);
});
