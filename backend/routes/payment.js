const express = require('express');
const router = express.Router();
const path = require('path');
const { buildPaymentUrl, verifyIpn } = require('../services/vnpay.service');
const { authenticate, optionalAuthenticate } = require('../middleware/auth');
const {
  normalizeSepayPayload,
  verifySepayRequest,
  confirmOrderFromSepay,
  safeEqual,
  getBankInfo,
} = require('../services/sepay.service');
const { readJson, writeJson, withLock } = require('../utils/fileStore');
const { publishOrderEvent } = require('../services/order-events');

const ORDERS_FILE = path.join(__dirname, '../data/orders.json');
const readOrders = () => readJson(ORDERS_FILE);
const writeOrders = (data) => writeJson(ORDERS_FILE, data);

// ---------------------------------------------------------------------------
// Payment state transition guards
// ---------------------------------------------------------------------------
// paymentStatus lifecycle: undefined/null/pending → paid (terminal) | failed (retryable)
// order.status: pending, awaiting_payment, paid, processing, shipped, delivered, completed, cancelled, payment_failed
//
// Guards:
// - paid is terminal: no further payment state writes (idempotent)
// - cancelled/completed orders cannot accept payment
// - failed is retryable: a fresh valid callback may promote failed → paid (amount-verified)
// ---------------------------------------------------------------------------
const TERMINAL_PAYMENT_STATUSES = new Set(['paid']);
const BLOCKED_ORDER_STATUSES = new Set(['cancelled', 'completed']);

function isTerminalPayment(paymentStatus) {
  return TERMINAL_PAYMENT_STATUSES.has(paymentStatus);
}

function isBlockedOrderStatus(orderStatus) {
  return BLOCKED_ORDER_STATUSES.has(orderStatus);
}

// POST /api/payment/create — Generate payment URL for an order (mutex-protected, state-guarded)
router.post('/create', authenticate, async (req, res) => {
  try {
    const { orderId, paymentMethod } = req.body;
    if (!orderId) return res.status(400).json({ success: false, error: 'Missing orderId' });

    // Pre-read to find and authorize before locking
    let preOrder;
    try {
      preOrder = readOrders().find(o => o.orderId === orderId);
    } catch {}
    if (!preOrder) return res.status(404).json({ success: false, error: 'Order not found' });

    if (preOrder.userId && preOrder.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Bạn không có quyền thanh toán cho đơn này.' });
    }

    // State guards (fail fast before lock)
    if (isTerminalPayment(preOrder.paymentStatus)) {
      return res.status(409).json({ success: false, error: 'Đơn hàng đã được thanh toán.' });
    }
    if (isBlockedOrderStatus(preOrder.status)) {
      return res.status(409).json({ success: false, error: 'Đơn hàng không thể thanh toán ở trạng thái hiện tại.' });
    }

    const amount = preOrder.finalPrice != null ? preOrder.finalPrice : preOrder.price * preOrder.quantity;
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, error: 'Số tiền thanh toán không hợp lệ.' });
    }

    if (paymentMethod !== 'VNPAY') {
      return res.status(400).json({ success: false, error: 'Unsupported payment method' });
    }

    // VNPay fail-closed: missing secret/tmnCode → hard error, no silent fallback
    let paymentUrl;
    try {
      const ipAddr = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '127.0.0.1';
      const built = buildPaymentUrl({
        amount,
        orderInfo: `Thanh toan don hang ${orderId}`,
        orderRef: orderId,
        ipAddr,
      });
      paymentUrl = built.paymentUrl;
    } catch (err) {
      if (err.code === 'VNPAY_NOT_CONFIGURED') {
        console.error('[Payment] VNPay not configured:', err.message);
        return res.status(503).json({ success: false, error: 'Cổng thanh toán VNPay chưa được cấu hình.' });
      }
      throw err;
    }

    // Mutex-protected write: re-check state inside lock + idempotent update
    const result = await withLock(ORDERS_FILE, () => {
      const orders = readOrders();
      const order = orders.find(o => o.orderId === orderId);
      if (!order) return { action: 'not_found' };

      if (isTerminalPayment(order.paymentStatus)) {
        return { action: 'already_paid', paymentUrl: order.paymentUrl || paymentUrl };
      }
      if (isBlockedOrderStatus(order.status)) {
        return { action: 'blocked' };
      }

      order.paymentUrl = paymentUrl;
      order.paymentMethod = 'VNPAY';
      writeOrders(orders);
      return { action: 'created', paymentUrl };
    });

    if (result.action === 'not_found') return res.status(404).json({ success: false, error: 'Order not found' });
    if (result.action === 'already_paid') return res.status(409).json({ success: false, error: 'Đơn hàng đã được thanh toán.', paymentUrl: result.paymentUrl });
    if (result.action === 'blocked') return res.status(409).json({ success: false, error: 'Đơn hàng không thể thanh toán ở trạng thái hiện tại.' });

    return res.json({ success: true, paymentUrl: result.paymentUrl, orderId });
  } catch (e) {
    console.error('[Payment] create error:', e.message || e);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});

// GET /api/payment/vnpay-return — User returns after VNPay payment (mutex-protected)
router.get('/vnpay-return', async (req, res) => {
  const result = verifyIpn(req.query);

  // If VNPay secret missing, verifyIpn returns isValid=false — show as failed, never as success
  if (!result.isValid && result.code === '99') {
    return res.redirect(`/studio.html?payment=failed&orderId=${result.orderRef || 'unknown'}&code=config_error`);
  }

  const updatedOrder = await withLock(ORDERS_FILE, () => {
    const orders = readOrders();
    const order = orders.find(o => o.orderId === result.orderRef);

    if (!order) return { order: null, action: 'not_found' };

    // paid is terminal
    if (isTerminalPayment(order.paymentStatus)) {
      return { order, action: 'already_paid' };
    }
    // cancelled/completed cannot be paid
    if (isBlockedOrderStatus(order.status)) {
      return { order, action: 'blocked' };
    }

    if (result.isValid && result.responseCode === '00') {
      const expected = order.finalPrice != null ? order.finalPrice : order.price * order.quantity;
      if (result.amount && Math.round(result.amount) !== Math.round(expected)) {
        console.warn(`[Payment] vnpay-return amount mismatch: expected ${expected}, got ${result.amount} for ${result.orderRef}`);
        order.paymentStatus = 'failed';
        order.status = 'payment_failed';
        writeOrders(orders);
        return { order, action: 'amount_mismatch' };
      }
      order.paymentStatus = 'paid';
      // Paid ≠ in production: park in 'paid' (Đã thanh toán); admin starts production.
      order.status = 'paid';
      order.paymentTransactionId = result.transactionId;
      order.paidAt = new Date().toISOString();
      writeOrders(orders);
      publishOrderEvent(order, { source: 'vnpay' });
      return { order, action: 'paid' };
    }

    order.paymentStatus = 'failed';
    order.status = 'payment_failed';
    writeOrders(orders);
    return { order, action: 'failed' };
  });

  if (!updatedOrder || updatedOrder.action === 'not_found') {
    return res.redirect(`/studio.html?payment=failed&orderId=${result.orderRef}&code=not_found`);
  }
  if (updatedOrder.action === 'already_paid' || updatedOrder.action === 'paid') {
    return res.redirect(`/studio.html?payment=success&orderId=${result.orderRef}`);
  }
  if (updatedOrder.action === 'blocked') {
    return res.redirect(`/studio.html?payment=failed&orderId=${result.orderRef}&code=order_blocked`);
  }
  if (updatedOrder.action === 'amount_mismatch') {
    return res.redirect(`/studio.html?payment=failed&orderId=${result.orderRef}&code=amount_mismatch`);
  }
  const errorCode = result.responseCode || 'unknown';
  return res.redirect(`/studio.html?payment=failed&orderId=${result.orderRef}&code=${errorCode}`);
});

// GET /api/payment/vnpay-ipn — VNPay server notification (mutex-protected, idempotent)
router.get('/vnpay-ipn', async (req, res) => {
  const result = verifyIpn(req.query);

  if (!result.isValid) {
    // Config error (99) is a server issue — return generic invalid signature so VNPay retries
    return res.json({ RspCode: result.code, Message: result.reason || 'Invalid signature' });
  }

  const updated = await withLock(ORDERS_FILE, () => {
    const orders = readOrders();
    const order = orders.find(o => o.orderId === result.orderRef);
    if (!order) return { status: 'not_found' };

    if (isTerminalPayment(order.paymentStatus)) {
      return { status: 'already_paid' };
    }
    if (isBlockedOrderStatus(order.status)) {
      return { status: 'blocked' };
    }

    if (result.responseCode === '00') {
      const expected = order.finalPrice != null ? order.finalPrice : order.price * order.quantity;
      if (result.amount && Math.round(result.amount) !== Math.round(expected)) {
        console.warn(`[Payment] vnpay-ipn amount mismatch: expected ${expected}, got ${result.amount} for ${result.orderRef}`);
        order.paymentStatus = 'failed';
        order.status = 'payment_failed';
        writeOrders(orders);
        return { status: 'amount_mismatch' };
      }
      order.paymentStatus = 'paid';
      // Paid ≠ in production: park in 'paid' (Đã thanh toán); admin starts production.
      order.status = 'paid';
      order.paymentTransactionId = result.transactionId;
      order.paidAt = new Date().toISOString();
      writeOrders(orders);
      publishOrderEvent(order, { source: 'vnpay' });
      return { status: 'success' };
    }

    order.paymentStatus = 'failed';
    writeOrders(orders);
    return { status: 'failed' };
  });

  if (updated.status === 'not_found') return res.json({ RspCode: '01', Message: 'Order not found' });
  if (updated.status === 'already_paid') return res.json({ RspCode: '02', Message: 'Order already confirmed' });
  if (updated.status === 'blocked') return res.json({ RspCode: '02', Message: 'Order cannot be paid in current status' });
  if (updated.status === 'amount_mismatch') return res.json({ RspCode: '04', Message: 'Amount mismatch' });
  if (updated.status === 'success') return res.json({ RspCode: '00', Message: 'Confirm success' });
  return res.json({ RspCode: '00', Message: 'Payment failed recorded' });
});

// ---------------------------------------------------------------------------
// GET /api/payment/bank-info — bank details behind the checkout QR (public)
// ---------------------------------------------------------------------------
router.get('/bank-info', (req, res) => {
  res.json({
    success: true,
    bankInfo: getBankInfo(),
    // Tells the client whether webhook authentication is enforced server-side.
    sepayConfigured: Boolean(process.env.SEPAY_WEBHOOK_SECRET),
  });
});

// ---------------------------------------------------------------------------
// POST /api/payment/sepay-webhook — SePay reconciliation for PRODUCT ORDERS
// Paste this URL into the SePay dashboard (Webhooks). SePay retries every
// non-2xx response, so "nothing to do" answers 200 and only genuine failures
// answer 5xx (which makes SePay retry the transfer).
// ---------------------------------------------------------------------------
router.post('/sepay-webhook', async (req, res) => {
  try {
    const auth = verifySepayRequest(req.headers, process.env.SEPAY_WEBHOOK_SECRET);
    if (auth.configured && !auth.ok) {
      console.warn('[Payment] SePay webhook rejected: invalid secret');
      return res.status(401).json({ success: false, error: 'Invalid webhook secret' });
    }
    if (!auth.configured) {
      console.warn('[Payment] SEPAY_WEBHOOK_SECRET is not set — accepting an UNVERIFIED SePay webhook. Set it in .env AND in the SePay dashboard before going live.');
    }

    const normalized = normalizeSepayPayload(req.body || {});
    console.log(`[Payment] SePay webhook: type=${normalized.transferType} amount=${normalized.amount} code=${normalized.code || '-'} content="${normalized.content}" ref=${normalized.transactionId || '-'}`);

    if (normalized.transferType !== 'in') {
      return res.json({ success: true, message: 'Ignored: not an incoming transfer' });
    }

    const outcome = await confirmOrderFromSepay(normalized);

    switch (outcome.action) {
      case 'paid':
        return res.json({ success: true, message: 'Payment confirmed', orderId: outcome.order.orderId });
      case 'already_paid':
        return res.json({ success: true, message: 'Order already paid' });
      case 'underpaid':
        return res.json({ success: true, message: 'Underpaid: recorded, order stays unpaid until topped up' });
      case 'cancelled':
        return res.json({ success: true, message: 'Order cancelled — payment ignored' });
      case 'not_found':
        // Usually an AI-plan transfer landing on the order webhook (or vice versa).
        return res.json({ success: true, message: 'No matching order' });
      default:
        return res.json({ success: true, message: `Ignored: ${outcome.action}` });
    }
  } catch (err) {
    console.error('[Payment] SePay webhook error:', err.message);
    // 500 makes SePay retry — correct for transient failures.
    return res.status(500).json({ success: false, error: 'Webhook processing failed' });
  }
});

// GET /api/payment/status/:orderId — Check payment status
// Owner, admin, or the holder of the order's checkout watch token (a guest
// checkout has no session, and previously could not read its own status).
router.get('/status/:orderId', optionalAuthenticate, (req, res) => {
  const user = req.user || null;
  const watchToken = req.query.token;
  // No credential at all → 401, and answer before looking the order up so an
  // anonymous caller cannot probe which order ids exist.
  if (!user && !watchToken) {
    return res.status(401).json({ success: false, error: 'Unauthorized. Sign in or pass the order watch token.' });
  }

  const orders = readOrders();
  const order = orders.find(o => o.orderId === req.params.orderId);
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
    paymentUrl: order.paymentUrl || null,
    status: order.status,
    paidAt: order.paidAt || null,
  });
});

module.exports = router;
