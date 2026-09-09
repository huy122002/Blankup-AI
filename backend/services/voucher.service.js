/**
 * Voucher Service — single source of truth for voucher validation.
 * Used by:
 *  - POST /api/ai-plans/quote
 *  - POST /api/ai-plans/purchase
 *  - POST /api/orders (optional, not changed in Phase 1)
 *
 * Spec Phase 1A: voucher must be validated for 13 checks:
 *  1 exists, 2 status active, 3 startsAt, 4 expiresAt,
 *  5 appliesTo, 6 eligiblePlanCodes, 7 totalUsageLimit, 8 perUserLimit,
 *  9 minOrderAmount, 10 discountType, 11 discountValue, 12 maxDiscountAmount, 13 bonus credits
 * Discount is computed backend-only, never from client.
 */

const { sql } = require('../db');

/**
 * Validate a voucher code for a given plan and user.
 * @param {object} opts
 * @param {object} opts.pool - mssql pool
 * @param {string|null} opts.voucherCode - raw voucher code from client (optional)
 * @param {object} opts.plan - plan row from AiPlans (must have priceVnd, code, id)
 * @param {string} opts.userId - authenticated user id for perUserLimit
 * @param {string} opts.appliesToExpected - 'plan' | 'order' | 'all' — expected appliesTo
 * @param {object} [opts.transaction] - optional mssql Transaction: validation
 *   queries run inside it (used by the purchase flow for atomicity)
 * @param {boolean} [opts.forUpdate] - lock the voucher row (UPDLOCK, HOLDLOCK)
 *   so concurrent redemptions serialize; only meaningful with transaction
 * @returns {Promise<{voucher:object|null, discountAmount:number, bonusHigh:number, bonusLow:number, error?:string, status?:number}>}
 */
async function validateVoucherForPlan({ pool, voucherCode, plan, userId, appliesToExpected = 'plan', transaction, forUpdate }) {
  const q = transaction || pool;
  if (!voucherCode) {
    return { voucher: null, discountAmount: 0, bonusHigh: 0, bonusLow: 0 };
  }

  const raw = String(voucherCode).trim();
  if (!raw) {
    return { voucher: null, discountAmount: 0, bonusHigh: 0, bonusLow: 0 };
  }
  const code = raw.toUpperCase();

  // 1. exists (optionally row-locked for concurrent redemption safety)
  const vRes = await q.request()
    .input('code', sql.NVarChar, code)
    .query(`SELECT * FROM Vouchers${forUpdate && transaction ? ' WITH (UPDLOCK, HOLDLOCK, ROWLOCK)' : ''} WHERE code = @code`);

  if (vRes.recordset.length === 0) {
    return { error: 'Mã voucher không tồn tại.', status: 400 };
  }
  const voucher = vRes.recordset[0];

  // 2. status active
  if (voucher.status !== 'active') {
    return { error: 'Voucher không hoạt động.', status: 400 };
  }

  const now = new Date();
  // 3. startsAt
  if (voucher.startsAt && new Date(voucher.startsAt) > now) {
    return { error: 'Voucher chưa bắt đầu.', status: 400 };
  }
  // 4. expiresAt
  if (voucher.expiresAt && new Date(voucher.expiresAt) < now) {
    return { error: 'Voucher đã hết hạn.', status: 400 };
  }

  // 5. appliesTo
  // AiPlans purchase accepts 'all' or 'plan'
  const allowedApplies = appliesToExpected === 'plan' ? ['all', 'plan'] : ['all', 'order'];
  if (!allowedApplies.includes(String(voucher.appliesTo))) {
    const msg = appliesToExpected === 'plan' ? 'Voucher không áp dụng cho gói.' : 'Voucher không áp dụng cho đơn hàng.';
    return { error: msg, status: 400 };
  }

  // 6. eligiblePlanCodes (only for plan flow)
  if (appliesToExpected === 'plan' && voucher.eligiblePlanCodes) {
    const allowed = String(voucher.eligiblePlanCodes).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (allowed.length > 0) {
      const planCodeLower = String(plan.code || '').toLowerCase();
      const planIdLower = String(plan.id || '').toLowerCase();
      if (!allowed.includes(planCodeLower) && !allowed.includes(planIdLower)) {
        return { error: 'Voucher không áp dụng cho gói này.', status: 400 };
      }
    }
  }

  // 7. totalUsageLimit
  if (voucher.totalUsageLimit != null && Number(voucher.usedCount) >= Number(voucher.totalUsageLimit)) {
    return { error: 'Voucher đã hết lượt sử dụng.', status: 400 };
  }

  // 8. perUserLimit
  if (userId) {
    const perUserRes = await q.request()
      .input('voucherId', sql.NVarChar, voucher.id)
      .input('userId', sql.NVarChar, userId)
      .query('SELECT COUNT(*) as cnt FROM VoucherRedemptions WHERE voucherId = @voucherId AND userId = @userId');
    const cnt = Number(perUserRes.recordset[0]?.cnt || 0);
    if (cnt >= Number(voucher.perUserLimit || 1)) {
      return { error: 'Bạn đã dùng voucher này tối đa số lần cho phép.', status: 400 };
    }
  }

  // 9. minOrderAmount (price check) — applies to both plan and order uniformly
  const price = Number(plan.priceVnd || 0);
  if (voucher.minOrderAmount != null && price < Number(voucher.minOrderAmount)) {
    const min = Number(voucher.minOrderAmount).toLocaleString('vi-VN');
    return { error: `Đơn tối thiểu ${min}đ để dùng voucher.`, status: 400 };
  }

  // 10,11,12 discount calculation
  let discountAmount = 0;
  if (voucher.discountType === 'fixed') {
    discountAmount = Number(voucher.discountValue) || 0;
  } else if (voucher.discountType === 'percent') {
    discountAmount = Math.round(price * (Number(voucher.discountValue) || 0) / 100);
    if (voucher.maxDiscountAmount != null) {
      discountAmount = Math.min(discountAmount, Number(voucher.maxDiscountAmount));
    }
  }
  // Cap to price
  discountAmount = Math.min(discountAmount, price);
  if (discountAmount < 0) discountAmount = 0;

  // 13 bonus credits
  const bonusHigh = Number(voucher.bonusHighCredits) || 0;
  const bonusLow = Number(voucher.bonusLowCredits) || 0;

  return { voucher, discountAmount, bonusHigh, bonusLow };
}

module.exports = { validateVoucherForPlan };
