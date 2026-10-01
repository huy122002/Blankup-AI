const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { authenticate, optionalAuthenticate } = require('../middleware/auth');
const { readJson, writeJson, withLock } = require('../utils/fileStore');
// O-04: Rate limit for order creation (backward-compatible with test mocks that lack orderLimiter)
// Skips limiter for legitimate idempotent retries (same Idempotency-Key + same body)
function _orderRateLimit(req, res, next) {
  try {
    const idempotencyKey = req.headers['idempotency-key'];
    if (idempotencyKey) {
      const bodyHash = hashBody(req.body || {});
      const entry = idempotencyStore.get(idempotencyKey);
      if (entry && entry.bodyHash === bodyHash) {
        return next(); // idempotent retry — do not count against rate limit
      }
    }
    const rl = require('../middleware/rateLimit');
    if (rl && typeof rl.orderLimiter === 'function') return rl.orderLimiter(req, res, next);
  } catch {}
  return next();
}
const { getPool, sql } = require('../db');
const { publishOrderEvent, subscribe } = require('../services/order-events');
const { safeEqual, getBankInfo } = require('../services/sepay.service');

const router = express.Router();
const ordersFilePath = path.join(__dirname, '../data/orders.json');

const readOrders = () => readJson(ordersFilePath);
const writeOrders = (data) => writeJson(ordersFilePath, data);

// Map product category to default price
const PRODUCT_PRICES = {
  tshirt: 250000,
  oversize: 290000,
  polo: 350000,
  hoodie: 450000,
};

// ---------------------------------------------------------------------------
// Idempotency store — in-memory with 24h TTL
// Prevents duplicate order creation from double-click / retry / concurrent requests.
// Limitation: lost on server restart (acceptable — idempotency window is short).
// For multi-server: migrate to Redis or DB-backed store.
// ---------------------------------------------------------------------------
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const idempotencyStore = new Map(); // key → { bodyHash, result, createdAt }

function cleanupExpiredKeys() {
  const now = Date.now();
  for (const [key, entry] of idempotencyStore) {
    if (now - entry.createdAt > IDEMPOTENCY_TTL_MS) {
      idempotencyStore.delete(key);
    }
  }
}

function hashBody(body) {
  // Deterministic hash of the request body (excluding volatile fields like timestamps)
  const stable = JSON.stringify(body, Object.keys(body).sort());
  return crypto.createHash('sha256').update(stable).digest('hex');
}

// ---------------------------------------------------------------------------
// GET /api/orders
// Retrieve all orders (Admin only)
// ---------------------------------------------------------------------------
router.get('/', authenticate, (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Forbidden. Admin access required.' });
    }

    const orders = readOrders();
    const sortedOrders = [...orders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    let data = sortedOrders;
    let pagination;
    if (req.query.page != null || req.query.limit != null) {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
      const offset = (page - 1) * limit;
      data = sortedOrders.slice(offset, offset + limit);
      pagination = { page, limit, total: sortedOrders.length, totalPages: Math.ceil(sortedOrders.length / limit) };
    }

    const safeData = data.map(stripOrderSecrets);
    res.json({ success: true, count: safeData.length, total: sortedOrders.length, data: safeData, ...(pagination ? { pagination } : {}) });
  } catch (err) {
    console.error('[Orders] Error fetching orders:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch orders' });
  }
});

const VALID_PRODUCT_TYPES = new Set(['tshirt', 'oversize', 'polo', 'hoodie']);

// Payment methods that expect money to arrive remotely (VNPay redirect, or a
// bank transfer confirmed by the SePay webhook). Both start in awaiting_payment.
const ONLINE_PAYMENT_METHODS = new Set(['VNPAY', 'BANK_TRANSFER']);

// The per-order watch token is a checkout convenience for guests, never part of
// a browsable order record.
function stripOrderSecrets(order) {
  if (!order) return order;
  const { paymentWatchToken, ...rest } = order;
  return rest;
}

// Uniform create/read payload for the checkout screen.
function orderPaymentResponse(order, message, extra = {}) {
  const method = order.paymentMethod || order.payment || 'COD';
  return {
    success: true,
    orderId: order.orderId,
    transferContent: order.transferContent || `BLANKUP-${order.orderId}`,
    payment: method,
    paymentStatus: order.paymentStatus || null,
    status: order.status,
    amount: order.finalPrice != null ? Number(order.finalPrice) : Number(order.total ?? 0),
    bankInfo: method === 'BANK_TRANSFER' ? getBankInfo() : null,
    paymentWatchToken: order.paymentWatchToken || null,
    message,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// POST /api/orders
// Create a new order — mutex-protected, idempotent, backend is source of truth
// P1 fixes: O-02 (reject unknown productType), O-01/S-02 (auth-derived userId),
// P-04 (voucher validation+redemption inside mutex)
// ---------------------------------------------------------------------------
router.post('/', _orderRateLimit, optionalAuthenticate, async (req, res) => {
  try {
    const { designUrl, frontDesignUrl, backDesignUrl, productType, color, size, quantity, customer, payment, userId: bodyUserId, authorName, voucherCode } = req.body;

    if (!customer || !customer.name || !customer.phone || !customer.address) {
      return res.status(400).json({ success: false, error: 'Họ tên, SĐT và địa chỉ nhận hàng là bắt buộc.' });
    }

    if (!productType || !size || !quantity) {
      return res.status(400).json({ success: false, error: 'Kiểu áo, kích cỡ và số lượng là bắt buộc.' });
    }

    // O-02: Reject unknown productType — never silently fallback
    const normalizedType = String(productType).trim().toLowerCase();
    if (!VALID_PRODUCT_TYPES.has(normalizedType)) {
      return res.status(400).json({ success: false, error: `Kiểu áo không hợp lệ. Cho phép: ${[...VALID_PRODUCT_TYPES].join(', ')}.` });
    }

    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 100) {
      return res.status(400).json({ success: false, error: 'Số lượng phải là số nguyên từ 1 đến 100.' });
    }

    // O-01/S-02: Derive effective userId from auth context, not body
    let effectiveUserId = null;
    if (req.user && req.user.id) {
      effectiveUserId = req.user.id;
      // If body claimed a different userId → reject
      if (bodyUserId != null && String(bodyUserId) !== String(effectiveUserId)) {
        return res.status(400).json({ success: false, error: 'userId không khớp với tài khoản đã xác thực.' });
      }
    } else {
      // Guest: must not claim any userId
      if (bodyUserId != null && String(bodyUserId).trim() !== '') {
        return res.status(400).json({ success: false, error: 'Đơn khách không được gán userId. Vui lòng đăng nhập.' });
      }
    }

    // Price is ALWAYS from backend — never trust client
    const basePrice = PRODUCT_PRICES[normalizedType];
    const totalPrice = basePrice * qty;

    // Idempotency setup (read before lock but check inside lock)
    const idempotencyKey = req.headers['idempotency-key'] || null;
    const bodyHash = hashBody(req.body);
    if (idempotencyStore.size > 100) cleanupExpiredKeys();

    // --- Everything that touches voucher or order state is inside the mutex ---
    const order = await withLock(ordersFilePath, async () => {
      // Idempotency check — inside mutex for concurrency safety
      if (idempotencyKey) {
        const existing = idempotencyStore.get(idempotencyKey);
        if (existing) {
          if (existing.bodyHash !== bodyHash) {
            return { idempotent: true, conflict: true };
          }
          return { idempotent: true, conflict: false, result: existing.result };
        }
      }

      // P-04: All voucher validation+redemption inside mutex — no TOCTOU.
      // Voucher check is INSIDE the lock so concurrent requests to the same
      // voucher are serialized: only N requests pass where N = remaininguses.
      let discountAmount = 0;
      let voucher = null;

      if (voucherCode) {
        const code = String(voucherCode).trim().toUpperCase();
        // Demo mode: DB unavailable → no voucher, no discount
        try {
          const pool = getPool();
          const vRes = await pool.request()
            .input('code', sql.NVarChar, code)
            .query('SELECT * FROM Vouchers WHERE code = @code');
          if (vRes.recordset.length === 0) {
            return { voucherError: 'Mã voucher không tồn tại.', voucherStatus: 400 };
          }
          voucher = vRes.recordset[0];
          if (voucher.status !== 'active') {
            return { voucherError: 'Voucher không hoạt động.', voucherStatus: 400 };
          }
          const now = new Date();
          if (voucher.startsAt && new Date(voucher.startsAt) > now) {
            return { voucherError: 'Voucher chưa bắt đầu.', voucherStatus: 400 };
          }
          if (voucher.expiresAt && new Date(voucher.expiresAt) < now) {
            return { voucherError: 'Voucher đã hết hạn.', voucherStatus: 400 };
          }
          if (!['all', 'order'].includes(voucher.appliesTo)) {
            return { voucherError: 'Voucher không áp dụng cho đơn hàng.', voucherStatus: 400 };
          }
          if (voucher.minOrderAmount && totalPrice < voucher.minOrderAmount) {
            return { voucherError: `Đơn tối thiểu ${voucher.minOrderAmount.toLocaleString('vi-VN')}đ để dùng voucher.`, voucherStatus: 400 };
          }
          if (voucher.totalUsageLimit && voucher.usedCount >= voucher.totalUsageLimit) {
            return { voucherError: 'Voucher đã hết lượt sử dụng.', voucherStatus: 400 };
          }
          if (effectiveUserId) {
            const perUserRes = await pool.request()
              .input('voucherId', sql.NVarChar, voucher.id)
              .input('userId', sql.NVarChar, effectiveUserId)
              .query('SELECT COUNT(*) as cnt FROM VoucherRedemptions WHERE voucherId = @voucherId AND userId = @userId');
            if (perUserRes.recordset[0].cnt >= voucher.perUserLimit) {
              return { voucherError: 'Bạn đã dùng voucher này tối đa số lần cho phép.', voucherStatus: 400 };
            }
          }
          if (voucher.discountType === 'fixed') {
            discountAmount = Number(voucher.discountValue) || 0;
          } else if (voucher.discountType === 'percent') {
            discountAmount = Math.round(totalPrice * (Number(voucher.discountValue) || 0) / 100);
            if (voucher.maxDiscountAmount) discountAmount = Math.min(discountAmount, voucher.maxDiscountAmount);
          }
          discountAmount = Math.min(discountAmount, totalPrice);
        } catch (e) {
          if (e.message && e.message.includes('Database not initialized')) {
            console.warn('[Orders] Voucher validation skipped (demo mode, no DB).');
            discountAmount = 0;
            voucher = null;
          } else {
            throw e;
          }
        }
      }

      const finalPrice = totalPrice - discountAmount;
      const isOnlinePayment = ONLINE_PAYMENT_METHODS.has(payment);
      const orderId = 'BU-' + Date.now().toString(36).toUpperCase() + '-' + uuidv4().slice(0, 8);
      const newOrder = {
        orderId,
        designUrl: designUrl || null,
        // Multi-design: persist per-side print composites (additive; null when absent).
        frontDesignUrl: frontDesignUrl || null,
        backDesignUrl: backDesignUrl || null,
        productType: normalizedType,
        color: color || '#ffffff',
        size,
        quantity: qty,
        price: basePrice,
        total: totalPrice,
        discountAmount,
        finalPrice,
        voucherCode: voucher ? voucher.code : null,
        customer: {
          name: customer.name,
          phone: customer.phone,
          address: customer.address,
          note: customer.note || '',
        },
        payment: payment || 'COD',
        paymentStatus: isOnlinePayment ? 'pending' : undefined,
        status: isOnlinePayment ? 'awaiting_payment' : 'pending',
        // Exact memo the customer must transfer with. SePay echoes it back in
        // `code`/`content`, which is how the webhook finds this order.
        transferContent: isOnlinePayment ? `BLANKUP-${orderId}` : undefined,
        // Lets a guest checkout screen follow this one order's payment state
        // without a session. Not an account credential.
        paymentWatchToken: crypto.randomBytes(16).toString('hex'),
        userId: effectiveUserId,
        authorName: authorName || 'Guest',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Persist order BEFORE voucher redemption — fileStore is atomic (tmp+rename)
      const orders = readOrders();
      orders.push(newOrder);
      writeOrders(orders);

      // P-04: Voucher redemption must succeed or the order is rolled back.
      // Without DB cross-storage transaction, we compensate by removing the order.
      if (voucher) {
        try {
          const pool = getPool();
          const redemptionId = 'vr-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
          await pool.request()
            .input('id', sql.NVarChar, redemptionId)
            .input('voucherId', sql.NVarChar, voucher.id)
            .input('voucherCode', sql.NVarChar, voucher.code)
            .input('userId', sql.NVarChar, effectiveUserId || 'guest')
            .input('orderId', sql.NVarChar, newOrder.orderId)
            .input('appliesTo', sql.NVarChar, 'order')
            .input('originalAmount', sql.Int, totalPrice)
            .input('discountAmount', sql.Int, discountAmount)
            .query(`
              INSERT INTO VoucherRedemptions (id, voucherId, voucherCode, userId, orderId, appliesTo, originalAmount, discountAmount, redeemedAt)
              VALUES (@id, @voucherId, @voucherCode, @userId, @orderId, @appliesTo, @originalAmount, @discountAmount, GETDATE());
              UPDATE Vouchers SET usedCount = usedCount + 1, updatedAt = GETDATE() WHERE id = @voucherId;
            `);
        } catch (e) {
          // Redemption failed but order already persisted with discount → compensate by removing discount
          if (e.message && e.message.includes('Database not initialized')) {
            // Demo mode: no DB → keep order as-is (no voucher effect) but clear voucher fields
            console.warn('[Orders] Voucher redemption skipped (demo mode):', e.message);
            const rollback = readOrders();
            const idx = rollback.findIndex(o => o.orderId === newOrder.orderId);
            if (idx !== -1) {
              rollback[idx].voucherCode = null;
              rollback[idx].discountAmount = 0;
              rollback[idx].finalPrice = totalPrice;
              writeOrders(rollback);
              newOrder.voucherCode = null;
              newOrder.discountAmount = 0;
              newOrder.finalPrice = totalPrice;
            }
          } else {
            // Real DB error: rollback order entirely to avoid free discount
            console.error('[Orders] Voucher redemption failed, rolling back order:', newOrder.orderId, e.message);
            try {
              const rollback = readOrders().filter(o => o.orderId !== newOrder.orderId);
              writeOrders(rollback);
            } catch {}
            return { voucherError: 'Không thể áp dụng voucher lúc này. Vui lòng thử lại.', voucherStatus: 500 };
          }
        }
      }

      return newOrder;
    });

    // Handle voucher validation failures produced inside the lock
    if (order.voucherError) {
      return res.status(order.voucherStatus || 400).json({ success: false, error: order.voucherError });
    }

    // --- Handle idempotent responses ---
    if (order.idempotent) {
      if (order.conflict) {
        return res.status(409).json({
          success: false,
          error: 'Idempotency-Key đã được sử dụng với dữ liệu khác. Vui lòng tạo key mới.',
        });
      }
      // Return cached result (same key + same body = same order)
      return res.status(200).json(
        orderPaymentResponse(order.result, 'Đơn hàng đã được tạo trước đó.', { idempotent: true })
      );
    }

    // Store in idempotency cache for future duplicate requests
    if (idempotencyKey) {
      idempotencyStore.set(idempotencyKey, {
        bodyHash,
        result: order,
        createdAt: Date.now(),
      });
    }

    console.log(`[Orders] New order created: ${order.orderId} (By: ${order.authorName})`);

    // Let every admin/user board see the new order immediately.
    publishOrderEvent(order, { source: 'created' });

    res.status(201).json(
      orderPaymentResponse(order, 'Đặt hàng thành công! Chúng tôi sẽ liên hệ bạn sớm nhất.')
    );
  } catch (err) {
    console.error('[Orders] Error creating order:', err.message);
    res.status(500).json({ success: false, error: 'Failed to create order' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/orders/me
// ---------------------------------------------------------------------------
router.get('/me', authenticate, (req, res) => {
  try {
    const orders = readOrders()
      .filter(o => o.userId === req.user.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const totalSpend = orders.reduce((sum, o) => {
      const total = Number(o.finalPrice != null ? o.finalPrice : (o.price || 0) * (o.quantity || 1));
      return sum + (o.status === 'cancelled' ? 0 : total);
    }, 0);

    res.json({
      success: true,
      count: orders.length,
      data: orders,
      summary: {
        totalOrders: orders.length,
        pendingOrders: orders.filter(o => ['pending', 'awaiting_payment'].includes(o.status)).length,
        completedOrders: orders.filter(o => ['completed', 'delivered', 'shipped'].includes(o.status)).length,
        totalSpend,
      },
    });
  } catch (err) {
    console.error('[Orders] Error fetching my orders:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch orders' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/orders/stream — Server-Sent Events feed of order changes
// Declared BEFORE '/:id' so the literal path can never be read as an order id.
//   admin          → every order
//   signed-in user → their own orders
//   guest          → the single order it holds a watch token for
// ---------------------------------------------------------------------------
router.get('/stream', optionalAuthenticate, (req, res) => {
  try {
    const user = req.user || null;
    const isAdmin = Boolean(user && user.role === 'admin');
    const { orderId, token } = req.query;

    let guestOrderId = null;
    if (!isAdmin && !user) {
      if (!orderId || !token) {
        return res.status(401).json({ success: false, error: 'Unauthorized. Sign in, or pass orderId + watch token.' });
      }
      const order = readOrders().find((o) => o.orderId === orderId);
      if (!order || !order.paymentWatchToken || !safeEqual(order.paymentWatchToken, token)) {
        return res.status(403).json({ success: false, error: 'Forbidden. Invalid order watch token.' });
      }
      guestOrderId = order.orderId;
    }

    // no-transform + no-store are REQUIRED: the global compression middleware
    // buffers any compressible response, which would silently starve the stream.
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n\n');
    res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const listener = (event) => {
      if (!isAdmin) {
        if (guestOrderId) {
          if (event.orderId !== guestOrderId) return;
        } else if (!user || event.userId !== user.id) {
          return;
        }
      }
      try {
        res.write(`event: order\ndata: ${JSON.stringify(event)}\n\n`);
      } catch { /* client vanished — cleanup happens on close */ }
    };

    const unsubscribe = subscribe(listener);
    // Heartbeat keeps proxies and the browser from dropping an idle stream.
    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { /* closed */ }
    }, 25000);
    if (heartbeat.unref) heartbeat.unref();

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  } catch (err) {
    console.error('[Orders] SSE stream error:', err.message);
    if (!res.headersSent) res.status(500).json({ success: false, error: 'Stream unavailable' });
    else res.end();
  }
});

// ---------------------------------------------------------------------------
// GET /api/orders/:orderId/payment-status
// Payment state only (no customer PII). Readable by the owner/admin, or by
// whoever holds the order's watch token — a guest checkout has no session.
// ---------------------------------------------------------------------------
router.get('/:orderId/payment-status', optionalAuthenticate, (req, res) => {
  try {
    const user = req.user || null;
    const watchToken = req.query.token;
    // No credential at all → 401 before any lookup, so an anonymous caller cannot
    // probe which order ids exist.
    if (!user && !watchToken) {
      return res.status(401).json({ success: false, error: 'Unauthorized. Sign in or pass the order watch token.' });
    }

    const order = readOrders().find((o) => o.orderId === req.params.orderId);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });

    const isAdmin = Boolean(user && user.role === 'admin');
    const isOwner = Boolean(user && order.userId && order.userId === user.id);
    const hasToken = Boolean(
      order.paymentWatchToken && watchToken && safeEqual(order.paymentWatchToken, watchToken)
    );
    if (!isAdmin && !isOwner && !hasToken) {
      return res.status(403).json({ success: false, error: 'Forbidden. Not your order.' });
    }

    res.json({
      success: true,
      orderId: order.orderId,
      paymentStatus: order.paymentStatus || 'pending',
      paymentMethod: order.paymentMethod || order.payment || 'COD',
      status: order.status,
      paidAt: order.paidAt || null,
      amount: order.finalPrice != null ? Number(order.finalPrice) : Number(order.total ?? 0),
      paymentReceivedAmount: order.paymentReceivedAmount ?? null,
    });
  } catch (err) {
    console.error('[Orders] Error fetching payment status:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch payment status' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/orders/:id
// ---------------------------------------------------------------------------
router.get('/:id', authenticate, (req, res) => {
  try {
    const orders = readOrders();
    const order = orders.find((o) => o.orderId === req.params.id);

    if (!order) {
      return res.status(404).json({ success: false, error: `Order with id "${req.params.id}" not found` });
    }

    if (order.userId && order.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Forbidden. Not your order.' });
    }
    if (!order.userId && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Forbidden. Admin only for guest orders.' });
    }

    res.json({ success: true, data: stripOrderSecrets(order) });
  } catch (err) {
    console.error('[Orders] Error fetching order:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch order' });
  }
});

// ---------------------------------------------------------------------------
// Order / payment invariants + status state machine
// ---------------------------------------------------------------------------
const ORDER_STATUSES = ['pending', 'awaiting_payment', 'paid', 'processing', 'shipped', 'delivered', 'completed', 'cancelled', 'payment_failed'];
const PAYMENT_STATUSES = ['paid', 'underpaid', 'failed', 'pending', 'awaiting_transfer'];
const TERMINAL_ORDER_STATUSES = new Set(['cancelled', 'completed']);
const BLOCKED_PAYMENT_TARGET_STATUSES = new Set(['cancelled', 'completed']);
const ORDER_TRANSITIONS = {
  // Lane: pending/awaiting → paid (Đã thanh toán) → processing (Đang sản xuất)
  // → shipped → delivered → completed. payment_failed is the recoverable failure.
  // NOTE: payment confirmation parks the order in 'paid'; production starts only
  // when an admin explicitly moves it to 'processing'.
  pending: new Set(['paid', 'processing', 'cancelled', 'payment_failed']),
  awaiting_payment: new Set(['paid', 'processing', 'cancelled', 'payment_failed']),
  payment_failed: new Set(['paid', 'processing', 'cancelled']),
  paid: new Set(['processing', 'cancelled']),
  processing: new Set(['shipped', 'cancelled', 'completed']),
  shipped: new Set(['delivered', 'completed', 'cancelled']),
  delivered: new Set(['completed', 'cancelled']),
  // completed/cancelled are terminal except idempotent no-op (same value).
};

function getEffectiveAmount(order) {
  if (order.finalPrice != null) return Number(order.finalPrice);
  if (order.total != null) return Number(order.total);
  return Number(order.price || 0) * Number(order.quantity || 1);
}

function isValidOrderTransition(from, to) {
  if (from === to) return true;
  if (TERMINAL_ORDER_STATUSES.has(from)) return false;
  const allowed = ORDER_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.has(to);
}

function orderPaymentInvariantError(order, nextPaymentStatus) {
  // paid cannot be demoted
  if (order.paymentStatus === 'paid' && nextPaymentStatus !== 'paid') return 'Không thể hạ cấp payment của đơn đã paid.';
  // cancelled/completed cannot receive paid
  if (BLOCKED_PAYMENT_TARGET_STATUSES.has(order.status) && nextPaymentStatus === 'paid') return 'Đơn đã cancelled/completed không thể chuyển thành paid.';
  // completed must not have non-paid payment if we are moving toward payment
  // unpaid order cannot jump to shipped/delivered/completed via status PUT — handled in status guard
  return null;
}

// ---------------------------------------------------------------------------
// PUT /api/orders/:id/payment — mutex-protected, state-guarded, version-aware
// ---------------------------------------------------------------------------
router.put('/:id/payment', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Forbidden. Admin access required.' });
    }

    const { paymentStatus, receivedAmount, note, expectedUpdatedAt } = req.body;
    const allowedStatuses = PAYMENT_STATUSES;

    if (!paymentStatus || !allowedStatuses.includes(paymentStatus)) {
      return res.status(400).json({ success: false, error: `Invalid paymentStatus. Must be one of: ${allowedStatuses.join(', ')}` });
    }

    const numericAmount = receivedAmount != null ? Number(receivedAmount) : null;
    if (numericAmount != null && (!Number.isFinite(numericAmount) || numericAmount < 0)) {
      return res.status(400).json({ success: false, error: 'receivedAmount phải là số ≥ 0.' });
    }

    const out = await withLock(ordersFilePath, () => {
      const orders = readOrders();
      const idx = orders.findIndex(o => o.orderId === req.params.id);
      if (idx === -1) return { notFound: true };
      const order = orders[idx];

      if (expectedUpdatedAt != null && order.updatedAt != null && String(order.updatedAt) !== String(expectedUpdatedAt)) {
        return { conflict: true, current: order };
      }

      const invariant = orderPaymentInvariantError(order, paymentStatus);
      if (invariant) return { invariant, current: order };

      const effective = getEffectiveAmount(order);
      if (paymentStatus === 'paid' && effective > 0 && numericAmount != null && numericAmount < effective) {
        // Under-payment marked as paid is not allowed; use underpaid or top-up
        return { invalidAmount: `receivedAmount (${numericAmount}) nhỏ hơn số tiền đơn (${effective}). Dùng underpaid hoặc bổ sung đủ.` };
      }

      const prev = { paymentStatus: order.paymentStatus, status: order.status, paidAt: order.paidAt };
      order.paymentStatus = paymentStatus;
      if (receivedAmount != null) order.receivedAmount = numericAmount;
      if (note) order.paymentNote = note;
      order.updatedAt = new Date().toISOString();

      if (paymentStatus === 'paid') {
        if (order.status === 'awaiting_payment' || order.status === 'payment_failed' || order.status === 'pending') {
          // Money received ≠ production started. Park the order in 'paid'
          // (Đã thanh toán) until an admin explicitly starts production.
          order.status = 'paid';
        }
        if (!order.paidAt) order.paidAt = new Date().toISOString();
      } else if (paymentStatus === 'underpaid') {
        if (order.status === 'completed' || order.status === 'cancelled') {
          return { invariant: 'Không thể chuyển completed/cancelled thành underpaid.' };
        }
        order.status = 'pending';
      } else if (paymentStatus === 'failed') {
        if (BLOCKED_PAYMENT_TARGET_STATUSES.has(order.status)) {
          return { invariant: 'Không thể chuyển completed/cancelled thành failed.' };
        }
        order.status = 'payment_failed';
        // keep paidAt untouched
      } else if (paymentStatus === 'awaiting_transfer') {
        if (BLOCKED_PAYMENT_TARGET_STATUSES.has(order.status)) {
          return { invariant: 'Đơn đã đóng không thể chuyển awaiting_transfer.' };
        }
      }

      writeOrders(orders);
      return { order, prev };
    });

    if (out.notFound) return res.status(404).json({ success: false, error: `Order with id "${req.params.id}" not found` });
    if (out.conflict) return res.status(409).json({ success: false, error: 'Dữ liệu đã bị chỉnh sửa bởi người khác. Vui lòng tải lại.', current: out.current });
    if (out.invariant) return res.status(409).json({ success: false, error: out.invariant });
    if (out.invalidAmount) return res.status(400).json({ success: false, error: out.invalidAmount });

    console.log(`[Orders] Order ${req.params.id} payment ${out.prev.paymentStatus}→${paymentStatus} status ${out.prev.status}→${out.order.status} paidAt=${out.order.paidAt}`);
    // Realtime: the customer's checkout screen and every admin board update now.
    publishOrderEvent(out.order, { source: 'admin_payment_update' });
    res.json({ success: true, message: 'Cập nhật thanh toán thành công!', data: stripOrderSecrets(out.order) });
  } catch (err) {
    console.error('[Orders] Error updating payment:', err.message);
    res.status(500).json({ success: false, error: 'Failed to update payment' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/orders/:id/status — mutex-protected, transition-guarded, version-aware
// ---------------------------------------------------------------------------
router.put('/:id/status', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Forbidden. Admin access required.' });
    }

    const { status, expectedUpdatedAt } = req.body;
    const allowedStatuses = ORDER_STATUSES;

    if (!status || !allowedStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: `Invalid status. Must be one of: ${allowedStatuses.join(', ')}` });
    }

    const out = await withLock(ordersFilePath, () => {
      const orders = readOrders();
      const idx = orders.findIndex((o) => o.orderId === req.params.id);
      if (idx === -1) return { notFound: true };
      const order = orders[idx];
      const from = order.status;

      if (expectedUpdatedAt != null && order.updatedAt != null && String(order.updatedAt) !== String(expectedUpdatedAt)) {
        return { conflict: true, current: order };
      }

      if (!isValidOrderTransition(from, status)) {
        return { invalidTransition: `Không thể chuyển trạng thái ${from} → ${status}.`, current: order };
      }

      // Payment ↔ status coherence
      // X-03: processing requires paid for online payments (VNPAY/BANK_TRANSFER).
      // COD and guest-no-payment orders have no paymentStatus requirement.
      if (status === 'processing') {
        const isOnline = order.payment != null && order.payment !== 'COD';
        if (isOnline && order.paymentStatus !== 'paid') {
          return { invariant: 'Đơn chưa thanh toán không thể chuyển sang đang sản xuất.' };
        }
      }
      if ((status === 'shipped' || status === 'delivered' || status === 'completed') && order.paymentStatus === 'failed') {
        return { invariant: 'Đơn payment failed không thể chuyển sang shipped/delivered/completed.' };
      }
      if ((status === 'shipped' || status === 'delivered') && (order.paymentStatus === 'pending' || order.paymentStatus === 'awaiting_transfer' || order.paymentStatus === 'underpaid')) {
        // COD-style orders have no paymentStatus (null) → allowed. Only explicit pending-like payment blocks shipped/delivered.
        if (order.payment != null && order.payment !== 'COD') {
          return { invariant: 'Đơn chưa paid không thể chuyển sang shipped/delivered.' };
        }
      }
      if (status === 'completed' && BLOCKED_PAYMENT_TARGET_STATUSES.has(from) === false) {
        // completed requires paid or COD-no-payment; if we know payment failed/underpaid, block
        if (order.paymentStatus === 'failed' || order.paymentStatus === 'underpaid') {
          return { invariant: 'Đơn chưa paid (failed/underpaid) không thể completed.' };
        }
      }

      const prev = from;
      order.status = status;
      order.updatedAt = new Date().toISOString();
      if (status === 'cancelled') order.cancelledAt = order.cancelledAt || new Date().toISOString();
      writeOrders(orders);
      return { order, prev };
    });

    if (out.notFound) return res.status(404).json({ success: false, error: `Order with id "${req.params.id}" not found` });
    if (out.conflict) return res.status(409).json({ success: false, error: 'Dữ liệu đã bị chỉnh sửa bởi người khác. Vui lòng tải lại.', current: out.current });
    if (out.invalidTransition) return res.status(409).json({ success: false, error: out.invalidTransition, current: out.current });
    if (out.invariant) return res.status(409).json({ success: false, error: out.invariant });

    console.log(`[Orders] Order ${req.params.id} status ${out.prev}→${out.order.status}`);
    publishOrderEvent(out.order, { source: 'admin_status_update' });
    res.json({ success: true, message: 'Cập nhật trạng thái đơn hàng thành công!', data: stripOrderSecrets(out.order) });
  } catch (err) {
    console.error('[Orders] Error updating status:', err.message);
    res.status(500).json({ success: false, error: 'Failed to update order status' });
  }
});

module.exports = router;
