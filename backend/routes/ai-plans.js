const express = require('express');
const router = express.Router();
const { getPool, sql } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { withLock } = require('../utils/fileStore');
const { validateVoucherForPlan } = require('../services/voucher.service');
const idemStore = require('../services/purchase-idempotency.service');

const BANK_TRANSFER_INFO = {
  bankId: '970422',
  bankName: 'MB Bank',
  accountName: 'LE LY HUY',
  accountNumber: '0967145402',
};

// Persistent idempotency lives in SQL (services/purchase-idempotency.service).
// The request hash below MUST stay byte-identical to the service canonical
// form, otherwise old keys would mismatch. Single source: idemStore.hashBody.
function hashPurchaseBody(body) {
  return idemStore.hashBody(body);
}

// Fire-and-forget expiry cleanup of completed idempotency records.
// Deletes completed-only rows, so it can never race in-flight work.
function cleanupIdempotencySoon(pool) {
  try {
    idemStore.cleanupExpired(pool, sql).catch(() => {});
  } catch {}
}

// ---------------------------------------------------------------------------
// GET /api/ai-plans — Danh sách gói AI (public)
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT id, code, name, description, priceVnd, highCredits, bonusLowCredits,
             dailyFreeLowCredits, outputQuality, planRank, isPaid, isActive
      FROM AiPlans
      WHERE isActive = 1
      ORDER BY planRank ASC, priceVnd ASC
    `);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    console.error('[AI-Plans] List error:', err.message);
    res.status(500).json({ success: false, error: 'Không thể tải danh sách gói.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/ai-plans/quote — Preview price/discount/final/credits (authenticated, no side effects)
// ---------------------------------------------------------------------------
router.post('/quote', authenticate, async (req, res) => {
  try {
    // Ignore any financial fields the client may try to send
    const { planId, planCode, voucherCode } = req.body;
    const userId = req.user.id;

    if (!planId && !planCode) {
      return res.status(400).json({ success: false, error: 'Thiếu planId hoặc planCode.' });
    }

    const pool = getPool();

    let plan;
    if (planId) {
      const r = await pool.request().input('planId', sql.NVarChar, planId).query('SELECT * FROM AiPlans WHERE id = @planId AND isActive = 1');
      plan = r.recordset[0];
    } else {
      const r = await pool.request().input('planCode', sql.NVarChar, planCode).query('SELECT * FROM AiPlans WHERE code = @planCode AND isActive = 1');
      plan = r.recordset[0];
    }

    if (!plan) {
      return res.status(404).json({ success: false, error: 'Gói không tồn tại hoặc đã ngưng.' });
    }

    // Quote does not create purchase, does not increment usedCount, does not create ledger
    const voucherResult = await validateVoucherForPlan({ pool, voucherCode, plan, userId, appliesToExpected: 'plan' });
    if (voucherResult.error) {
      return res.status(voucherResult.status || 400).json({ success: false, error: voucherResult.error });
    }

    const discountAmount = voucherResult.discountAmount || 0;
    const bonusHigh = voucherResult.bonusHigh || 0;
    const bonusLow = voucherResult.bonusLow || 0;
    const finalAmount = Math.max(0, Number(plan.priceVnd) - discountAmount);
    const highCredits = Number(plan.highCredits || 0) + bonusHigh;
    const lowCredits = Number(plan.bonusLowCredits || 0) + bonusLow;

    const voucher = voucherResult.voucher ? {
      code: voucherResult.voucher.code,
      discountType: voucherResult.voucher.discountType,
      discountValue: voucherResult.voucher.discountValue,
      maxDiscountAmount: voucherResult.voucher.maxDiscountAmount || null,
      bonusHighCredits: bonusHigh,
      bonusLowCredits: bonusLow,
    } : null;

    return res.json({
      success: true,
      data: {
        planId: plan.id,
        planCode: plan.code,
        planName: plan.name,
        priceVnd: Number(plan.priceVnd),
        discountAmount,
        finalAmount,
        highCredits,
        lowCredits,
        voucher,
      }
    });
  } catch (err) {
    console.error('[AI-Plans] Quote error:', err.message);
    res.status(500).json({ success: false, error: 'Không thể tính giá.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/ai-plans/purchase — Mua gói AI (authenticated)
// Body: { planId } hoặc { planCode } + optional { voucherCode }
// Idempotency-Key header supported
// ---------------------------------------------------------------------------
router.post('/purchase', authenticate, async (req, res) => {
  try {
    // Explicitly ignore financial fields if client sends them — backend is source of truth
    const { planId, planCode, voucherCode } = req.body;
    const userId = req.user.id;
    const idempotencyKey = req.headers['idempotency-key'] || req.headers['Idempotency-Key'] || null;
    const bodyHash = hashPurchaseBody({ planId, planCode, voucherCode });

    if (!planId && !planCode) {
      return res.status(400).json({ success: false, error: 'Thiếu planId hoặc planCode.' });
    }

    const pool = getPool();
    cleanupIdempotencySoon(pool);

    // Fast pre-check from persistent store (no lock held).
    if (idempotencyKey) {
      const existing = await idemStore.getRecord(pool, sql, userId, idempotencyKey);
      if (existing) {
        if (existing.bodyHash !== bodyHash) {
          return res.status(409).json({ success: false, error: 'Idempotency-Key đã được sử dụng với dữ liệu khác. Vui lòng tạo key mới.' });
        }
        const replayed = idemStore.parseResponse(existing);
        if (replayed) {
          return res.status(200).json({ ...replayed, idempotent: true });
        }
        if (!idemStore.isStale(existing)) {
          // Winner still in flight: wait for its response, then replay.
          const done = await idemStore.waitForCompletion(pool, sql, userId, idempotencyKey);
          const doneReplay = done && idemStore.parseResponse(done);
          if (doneReplay && done.bodyHash === bodyHash) {
            return res.status(200).json({ ...doneReplay, idempotent: true });
          }
          return res.status(503).json({ success: false, error: 'Đơn đang được xử lý ở request khác. Vui lòng thử lại với cùng key.' });
        }
        // Stale in-progress claim (crashed winner): reclaim below.
        await idemStore.deleteClaim(pool, sql, userId, idempotencyKey);
      }
    }

    // Find the plan (pool already acquired above for the idempotency pre-check)
    let plan;
    if (planId) {
      const result = await pool.request()
        .input('planId', sql.NVarChar, planId)
        .query('SELECT * FROM AiPlans WHERE id = @planId AND isActive = 1');
      plan = result.recordset[0];
    } else {
      const result = await pool.request()
        .input('planCode', sql.NVarChar, planCode)
        .query('SELECT * FROM AiPlans WHERE code = @planCode AND isActive = 1');
      plan = result.recordset[0];
    }

    if (!plan) {
      return res.status(404).json({ success: false, error: 'Gói không tồn tại hoặc đã ngưng.' });
    }

    if (!plan.isPaid || Number(plan.priceVnd) <= 0) {
      return res.status(400).json({ success: false, error: 'Gói này không yêu cầu thanh toán.' });
    }

    // Execute purchase inside lock when voucher or idempotency present.
    // The purchase itself ALWAYS runs in ONE SQL transaction covering:
    // idem-claim + voucher validation (row-locked) + purchase INSERT +
    // redemption + usedCount + idem-response, so any failure rolls back
    // everything atomically — across processes and restarts.
    const needsLock = Boolean(voucherCode) || Boolean(idempotencyKey);

    const makeTransferContent = () => {
      const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
      return `BLANKUP-AI-${String(plan.code).toUpperCase()}-${rnd}`;
    };

    const executePurchase = async () => {
      const tx = pool.transaction();
      await tx.begin();
      const t = () => tx.request();
      try {
        // 1. Claim the idempotency key first. On UNIQUE violation another
        // process/user-request won the race -> roll back and replay it.
        if (idempotencyKey) {
          try {
            await t()
              .input('userId', sql.NVarChar, userId)
              .input('key', sql.NVarChar, String(idempotencyKey))
              .input('bodyHash', sql.NVarChar, bodyHash)
              .query(`INSERT INTO PurchaseIdempotency (userId, idemKey, bodyHash, status)
                      VALUES (@userId, @key, @bodyHash, N'in_progress')`);
          } catch (claimErr) {
            await tx.rollback();
            if (idemStore.isUniqueViolation(claimErr)) return { lostRace: true };
            throw claimErr;
          }
        }

        // 2. Voucher validation inside the transaction (row-locked).
        const voucherResult = await validateVoucherForPlan({
          pool, transaction: tx, forUpdate: Boolean(voucherCode),
          voucherCode, plan, userId, appliesToExpected: 'plan',
        });
        if (voucherResult.error) {
          await tx.rollback();
          return { error: voucherResult.error, status: voucherResult.status || 400 };
        }

        const discountAmount = voucherResult.discountAmount || 0;
        const bonusHigh = voucherResult.bonusHigh || 0;
        const bonusLow = voucherResult.bonusLow || 0;
        const voucher = voucherResult.voucher || null;

        const finalAmount = Math.max(0, Number(plan.priceVnd) - discountAmount);
        const totalHigh = Number(plan.highCredits || 0) + bonusHigh;
        const totalLow = Number(plan.bonusLowCredits || 0) + bonusLow;

        // 3. Create purchase record (idempotencyKey recorded for audit/cleanup).
        const purchaseId = 'purchase-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
        let transferContent = makeTransferContent();
        const insertPurchase = () => t()
          .input('id', sql.NVarChar, purchaseId)
          .input('userId', sql.NVarChar, userId)
          .input('planId', sql.NVarChar, plan.id)
          .input('priceVnd', sql.Int, Number(plan.priceVnd))
          .input('highCreditsAdded', sql.Int, totalHigh)
          .input('lowCreditsAdded', sql.Int, totalLow)
          .input('finalAmount', sql.Int, finalAmount)
          .input('transferContent', sql.NVarChar, transferContent)
          .input('paymentMethod', sql.NVarChar, 'BANK_TRANSFER')
          .input('voucherCode', sql.NVarChar, voucher ? voucher.code : null)
          .input('discountAmount', sql.Int, discountAmount)
          .input('idemKey', sql.NVarChar, idempotencyKey ? String(idempotencyKey) : null)
          .query(`
            INSERT INTO AiPlanPurchases (
              id, userId, planId, priceVnd, highCreditsAdded, lowCreditsAdded,
              finalAmount, transferContent, paymentMethod, paymentStatus, voucherCode, discountAmount, idempotencyKey
            )
            VALUES (
              @id, @userId, @planId, @priceVnd, @highCreditsAdded, @lowCreditsAdded,
              @finalAmount, @transferContent, @paymentMethod, 'pending', @voucherCode, @discountAmount, @idemKey
            )
          `);
        try {
          await insertPurchase();
        } catch (insErr) {
          // transferContent collision (UNIQUE guard): regenerate once and retry.
          if (idemStore.isUniqueViolation(insErr)) {
            transferContent = makeTransferContent();
            await insertPurchase();
          } else {
            throw insErr;
          }
        }

        // 4. Record voucher redemption if used (same transaction).
        if (voucher) {
          const redemptionId = 'vr-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
          await t()
            .input('id', sql.NVarChar, redemptionId)
            .input('voucherId', sql.NVarChar, voucher.id)
            .input('voucherCode', sql.NVarChar, voucher.code)
            .input('userId', sql.NVarChar, userId)
            .input('purchaseId', sql.NVarChar, purchaseId)
            .input('appliesTo', sql.NVarChar, 'plan')
            .input('originalAmount', sql.Int, Number(plan.priceVnd))
            .input('discountAmount', sql.Int, discountAmount)
            .input('bonusHigh', sql.Int, bonusHigh)
            .input('bonusLow', sql.Int, bonusLow)
            .query(`
              INSERT INTO VoucherRedemptions (id, voucherId, voucherCode, userId, purchaseId, appliesTo, originalAmount, discountAmount, bonusHighCredits, bonusLowCredits, redeemedAt)
              VALUES (@id, @voucherId, @voucherCode, @userId, @purchaseId, @appliesTo, @originalAmount, @discountAmount, @bonusHigh, @bonusLow, GETDATE());
              UPDATE Vouchers SET usedCount = usedCount + 1, updatedAt = GETDATE() WHERE id = @voucherId;
            `);
        }

        const responsePayload = {
          success: true,
          purchaseId,
          planId: plan.id,
          planCode: plan.code,
          planName: plan.name,
          priceVnd: Number(plan.priceVnd),
          discountAmount,
          finalAmount,
          voucherCode: voucher ? voucher.code : null,
          highCreditsAdded: totalHigh,
          lowCreditsAdded: totalLow,
          transferContent,
          paymentMethod: 'BANK_TRANSFER',
          bankInfo: BANK_TRANSFER_INFO,
          message: 'Quét QR để thanh toán. Sau khi xác nhận, credit sẽ được cộng tự động.',
        };

        // 5. Publish the idempotent response, then commit everything together.
        if (idempotencyKey) {
          await t()
            .input('userId', sql.NVarChar, userId)
            .input('key', sql.NVarChar, String(idempotencyKey))
            .input('resp', sql.NVarChar, JSON.stringify(responsePayload))
            .query(`UPDATE PurchaseIdempotency
                    SET responseJson = @resp, status = N'complete', updatedAt = GETDATE()
                    WHERE userId = @userId AND idemKey = @key`);
        }

        await tx.commit();
        return responsePayload;
      } catch (err) {
        try { await tx.rollback(); } catch {}
        throw err;
      }
    };

    const replayLostRace = async () => {
      const done = await idemStore.waitForCompletion(pool, sql, userId, idempotencyKey);
      const replayed = done && idemStore.parseResponse(done);
      if (replayed && done.bodyHash === bodyHash) {
        console.log(`[AI-Plans] Idempotent replay (race): ${replayed.purchaseId} for user ${userId}`);
        return res.status(200).json({ ...replayed, idempotent: true });
      }
      if (done && done.bodyHash !== bodyHash) {
        return res.status(409).json({ success: false, error: 'Idempotency-Key đã được sử dụng với dữ liệu khác. Vui lòng tạo key mới.' });
      }
      return res.status(503).json({ success: false, error: 'Đơn đang được xử lý ở request khác. Vui lòng thử lại với cùng key.' });
    };

    let result;
    if (needsLock) {
      // Use voucher-redeem-plan lock to preserve existing concurrency semantics, plus idempotency
      const lockKey = voucherCode ? 'voucher-redeem-plan' : `purchase-${userId}`;
      result = await withLock(lockKey, executePurchase);
    } else {
      result = await executePurchase();
    }

    if (result && result.lostRace) {
      return replayLostRace();
    }

    if (result && result.error) {
      const status = result.status || 400;
      return res.status(status).json({ success: false, error: result.error });
    }

    console.log(`[AI-Plans] Purchase created: ${result.purchaseId} (${plan.code}) by user ${userId} final=${result.finalAmount} discount=${result.discountAmount}`);

    res.status(201).json(result);
  } catch (err) {
    console.error('[AI-Plans] Purchase error:', err.message);
    res.status(500).json({ success: false, error: 'Không thể tạo đơn mua gói.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/ai-plans/purchase/:purchaseId/status — Kiểm tra trạng thái thanh toán
// ---------------------------------------------------------------------------
router.get('/purchase/:purchaseId/status', authenticate, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request()
      .input('purchaseId', sql.NVarChar, req.params.purchaseId)
      .input('userId', sql.NVarChar, req.user.id)
      .query(`
        SELECT p.*, pl.code AS planCode, pl.name AS planName
        FROM AiPlanPurchases p
        JOIN AiPlans pl ON pl.id = p.planId
        WHERE p.id = @purchaseId AND p.userId = @userId
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, error: 'Đơn mua không tồn tại.' });
    }

    const purchase = result.recordset[0];
    res.json({
      success: true,
      purchaseId: purchase.id,
      planId: purchase.planId,
      planCode: purchase.planCode,
      planName: purchase.planName,
      priceVnd: purchase.priceVnd,
      discountAmount: purchase.discountAmount,
      amount: purchase.finalAmount,
      finalAmount: purchase.finalAmount,
      paymentStatus: purchase.paymentStatus,
      transferContent: purchase.transferContent,
      createdAt: purchase.createdAt,
      paidAt: purchase.paidAt,
    });
  } catch (err) {
    console.error('[AI-Plans] Status error:', err.message);
    res.status(500).json({ success: false, error: 'Không thể kiểm tra trạng thái.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/ai-plans/purchase/:purchaseId/confirm — Admin xác nhận thanh toán
// Body: { paymentStatus: 'paid' | 'failed', note? }
// ---------------------------------------------------------------------------
router.post('/purchase/:purchaseId/confirm', authenticate, requireAdmin, async (req, res) => {
  try {
    const { paymentStatus, note } = req.body;
    const { purchaseId } = req.params;

    if (!['paid', 'failed'].includes(paymentStatus)) {
      return res.status(400).json({ success: false, error: 'paymentStatus phải là paid hoặc failed.' });
    }

    const pool = getPool();

    if (paymentStatus === 'paid') {
      const transaction = pool.transaction();
      try {
        await transaction.begin();

        const markResult = await transaction.request()
          .input('purchaseId', sql.NVarChar, purchaseId)
          .input('note', sql.NVarChar, note || null)
          .query(`
            UPDATE AiPlanPurchases
            SET paymentStatus = 'paid',
                paymentDescription = @note,
                paymentCheckedAt = GETDATE(),
                paidAt = GETDATE()
            OUTPUT inserted.*
            WHERE id = @purchaseId AND paymentStatus = 'pending'
          `);

        if (markResult.recordset.length === 0) {
          await transaction.rollback();
          const check = await pool.request()
            .input('purchaseId', sql.NVarChar, purchaseId)
            .query('SELECT paymentStatus FROM AiPlanPurchases WHERE id = @purchaseId');
          if (check.recordset.length === 0) {
            return res.status(404).json({ success: false, error: 'Đơn mua không tồn tại.' });
          }
          return res.status(400).json({ success: false, error: 'Đơn này đã được xác nhận hoặc xử lý.' });
        }

        const purchase = markResult.recordset[0];

        const accountResult = await transaction.request()
          .input('userId', sql.NVarChar, purchase.userId)
          .query('SELECT * FROM UserAiAccounts WHERE userId = @userId');

        let account = accountResult.recordset[0];
        if (!account) {
          await transaction.request()
            .input('userId', sql.NVarChar, purchase.userId)
            .query(`INSERT INTO UserAiAccounts (userId, displayPlanId, highestPlanRank) VALUES (@userId, N'plan-free', 0)`);
          account = { highCredits: 0, bonusLowCredits: 0 };
        }

        const newHighCredits = (account.highCredits || 0) + purchase.highCreditsAdded;
        const newLowCredits = (account.bonusLowCredits || 0) + purchase.lowCreditsAdded;

        await transaction.request()
          .input('userId', sql.NVarChar, purchase.userId)
          .input('highCredits', sql.Int, newHighCredits)
          .input('lowCredits', sql.Int, newLowCredits)
          .input('planId', sql.NVarChar, purchase.planId)
          .query(`
            UPDATE UserAiAccounts
            SET highCredits = @highCredits,
                bonusLowCredits = @lowCredits,
                displayPlanId = @planId,
                updatedAt = GETDATE()
            WHERE userId = @userId
          `);

        const ledgerIdHigh = 'ledger-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        const ledgerIdLow = ledgerIdHigh + '-low';
        await transaction.request()
          .input('ledgerIdHigh', sql.NVarChar, ledgerIdHigh)
          .input('ledgerIdLow', sql.NVarChar, ledgerIdLow)
          .input('userId', sql.NVarChar, purchase.userId)
          .input('highCredits', sql.Int, purchase.highCreditsAdded)
          .input('lowCredits', sql.Int, purchase.lowCreditsAdded)
          .input('balanceHigh', sql.Int, newHighCredits)
          .input('balanceLow', sql.Int, newLowCredits)
          .input('purchaseId', sql.NVarChar, purchaseId)
          .input('note', sql.NVarChar, `Mua gói - Đơn ${purchaseId}`)
          .query(`
            INSERT INTO AiCreditLedger (id, userId, creditType, quality, amount, balanceAfter, reason, referenceType, referenceId, note)
            VALUES (@ledgerIdHigh, @userId, 'high', 'high', @highCredits, @balanceHigh, 'plan_purchase', 'purchase', @purchaseId, @note);
            INSERT INTO AiCreditLedger (id, userId, creditType, quality, amount, balanceAfter, reason, referenceType, referenceId, note)
            VALUES (@ledgerIdLow, @userId, 'low', 'low', @lowCredits, @balanceLow, 'plan_purchase', 'purchase', @purchaseId, @note);
          `);

        await transaction.commit();
        console.log(`[AI-Plans] Purchase ${purchaseId} confirmed. Credits added: ${purchase.highCreditsAdded} high, ${purchase.lowCreditsAdded} low`);
      } catch (txErr) {
        await transaction.rollback();
        throw txErr;
      }
    } else {
      const failResult = await pool.request()
        .input('purchaseId', sql.NVarChar, purchaseId)
        .input('note', sql.NVarChar, note || null)
        .query(`
          UPDATE AiPlanPurchases
          SET paymentStatus = 'failed',
              paymentDescription = @note,
              paymentCheckedAt = GETDATE()
          WHERE id = @purchaseId AND paymentStatus = 'pending'
        `);

      if (failResult.rowsAffected[0] === 0) {
        const check = await pool.request()
          .input('purchaseId', sql.NVarChar, purchaseId)
          .query('SELECT paymentStatus FROM AiPlanPurchases WHERE id = @purchaseId');
        if (check.recordset.length === 0) {
          return res.status(404).json({ success: false, error: 'Đơn mua không tồn tại.' });
        }
        return res.status(400).json({ success: false, error: 'Đơn này đã được xác nhận hoặc xử lý.' });
      }
    }

    res.json({
      success: true,
      message: paymentStatus === 'paid' ? 'Đã xác nhận thanh toán và cộng credit.' : 'Đã đánh dấu thanh toán thất bại.',
    });
  } catch (err) {
    console.error('[AI-Plans] Confirm error:', err.message);
    res.status(500).json({ success: false, error: 'Không thể xác nhận thanh toán.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/ai-plans/webhook/sepay — Sepay webhook (auto-confirm payment)
// ---------------------------------------------------------------------------
router.post('/webhook/sepay', async (req, res) => {
  try {
    if (process.env.SEPAY_WEBHOOK_SECRET) {
      const provided = req.headers['x-sepay-secret'] || req.headers['x-webhook-secret'] || (req.headers['authorization'] && req.headers['authorization'].replace('Bearer ', ''));
      if (provided !== process.env.SEPAY_WEBHOOK_SECRET) {
        console.warn('[AI-Plans] Sepay webhook unauthorized: invalid secret');
        return res.status(401).json({ success: false, error: 'Invalid webhook secret' });
      }
    }

    const { transactionId, amount, content, bankAccount, status } = req.body;

    console.log(`[AI-Plans] Sepay webhook received:`, { transactionId, amount, content, bankAccount, status });

    const match = content?.match(/^BLANKUP-AI-(.+)$/i);
    if (!match) {
      return res.json({ success: true, message: 'Not a Blankup transaction' });
    }

    const pool = getPool();

    const transaction = pool.transaction();
    try {
      await transaction.begin();

      const markResult = await transaction.request()
        .input('transferContent', sql.NVarChar, content)
        .input('transactionId', sql.NVarChar, transactionId || null)
        .query(`
          UPDATE AiPlanPurchases
          SET paymentStatus = 'paid',
              paymentTransactionId = @transactionId,
              paymentCheckedAt = GETDATE(),
              paidAt = GETDATE()
          OUTPUT inserted.*
          WHERE transferContent = @transferContent
            AND paymentStatus = 'pending'
        `);

      if (markResult.recordset.length === 0) {
        await transaction.rollback();
        const existing = await pool.request()
          .input('transferContent', sql.NVarChar, content)
          .query('SELECT paymentStatus FROM AiPlanPurchases WHERE transferContent = @transferContent');
        if (existing.recordset.length === 0) {
          return res.json({ success: true, message: 'No matching purchase' });
        }
        return res.json({ success: true, message: 'Payment already processed' });
      }

      const purchase = markResult.recordset[0];

      if (amount == null || Number(amount) !== purchase.finalAmount) {
        await transaction.rollback();
        return res.json({ success: true, message: 'Amount mismatch' });
      }

      const accountResult = await transaction.request()
        .input('userId', sql.NVarChar, purchase.userId)
        .query('SELECT * FROM UserAiAccounts WHERE userId = @userId');

      let account = accountResult.recordset[0];
      if (!account) {
        await transaction.request()
          .input('userId', sql.NVarChar, purchase.userId)
          .query(`INSERT INTO UserAiAccounts (userId, displayPlanId, highestPlanRank) VALUES (@userId, N'plan-free', 0)`);
        account = { highCredits: 0, bonusLowCredits: 0 };
      }

      const newHighCredits = (account.highCredits || 0) + purchase.highCreditsAdded;
      const newLowCredits = (account.bonusLowCredits || 0) + purchase.lowCreditsAdded;

      await transaction.request()
        .input('userId', sql.NVarChar, purchase.userId)
        .input('highCredits', sql.Int, newHighCredits)
        .input('lowCredits', sql.Int, newLowCredits)
        .input('planId', sql.NVarChar, purchase.planId)
        .query(`
          UPDATE UserAiAccounts
          SET highCredits = @highCredits,
              bonusLowCredits = @lowCredits,
              displayPlanId = @planId,
              updatedAt = GETDATE()
          WHERE userId = @userId
        `);

      const ledgerIdHigh = 'ledger-sepay-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      const ledgerIdLow = ledgerIdHigh + '-low';
      await transaction.request()
        .input('ledgerIdHigh', sql.NVarChar, ledgerIdHigh)
        .input('ledgerIdLow', sql.NVarChar, ledgerIdLow)
        .input('userId', sql.NVarChar, purchase.userId)
        .input('highCredits', sql.Int, purchase.highCreditsAdded)
        .input('lowCredits', sql.Int, purchase.lowCreditsAdded)
        .input('balanceHigh', sql.Int, newHighCredits)
        .input('balanceLow', sql.Int, newLowCredits)
        .input('purchaseId', sql.NVarChar, purchase.id)
        .input('note', sql.NVarChar, `Thanh toán QR - Đơn ${purchase.id}`)
        .query(`
          INSERT INTO AiCreditLedger (id, userId, creditType, quality, amount, balanceAfter, reason, referenceType, referenceId, note)
          VALUES (@ledgerIdHigh, @userId, 'high', 'high', @highCredits, @balanceHigh, 'plan_purchase', 'purchase', @purchaseId, @note);
          INSERT INTO AiCreditLedger (id, userId, creditType, quality, amount, balanceAfter, reason, referenceType, referenceId, note)
          VALUES (@ledgerIdLow, @userId, 'low', 'low', @lowCredits, @balanceLow, 'plan_purchase', 'purchase', @purchaseId, @note);
        `);

      await transaction.commit();
      console.log(`[AI-Plans] Sepay auto-confirmed: ${purchase.id}. Credits added.`);
      res.json({ success: true, message: 'Payment confirmed' });
    } catch (txErr) {
      await transaction.rollback();
      throw txErr;
    }
  } catch (err) {
    console.error('[AI-Plans] Sepay webhook error:', err.message);
    res.status(500).json({ success: false, error: 'Webhook processing failed' });
  }
});

// GET /api/ai-plans/vouchers/available — Vouchers applicable to current user/plans
router.get('/vouchers/available', authenticate, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT id, code, title, description, discountType, discountValue, maxDiscountAmount, minOrderAmount, appliesTo, eligiblePlanCodes, bonusHighCredits, bonusLowCredits, perUserLimit, totalUsageLimit, usedCount, startsAt, expiresAt, status
      FROM Vouchers
      WHERE status='active'
      ORDER BY createdAt DESC
    `);
    // Return all active, frontend will filter via quote; backend still validates at quote/purchase
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    console.error('[AI-Plans] Available vouchers error:', err.message);
    res.status(500).json({ success: false, error: 'Không thể tải voucher.' });
  }
});

module.exports = router;
