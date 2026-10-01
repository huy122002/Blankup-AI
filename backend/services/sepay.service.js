// backend/services/sepay.service.js
//
// SePay (https://sepay.vn) bank-transfer reconciliation for PRODUCT ORDERS.
//
// The AI-plan purchase flow already had a SePay webhook; orders never did, so a
// bank transfer could never confirm itself. This module holds the pure, testable
// half of that flow: normalise the payload, find the order the transfer belongs
// to, and decide the state transition. File IO / locking stays in the route.
//
// Real SePay webhook body (docs):
//   { id, gateway, transactionDate, accountNumber, code, content, transferType,
//     transferAmount, accumulated, subAccount, referenceCode, description }
// Simplified bodies (used by the existing AI-plan webhook / manual tools) are
// accepted too, so one SePay webhook URL can serve every flow in this app.

const crypto = require('crypto');
const path = require('path');
const { readJson, writeJson, withLock } = require('../utils/fileStore');
const { publishOrderEvent } = require('./order-events');

const ORDERS_FILE = path.join(__dirname, '../data/orders.json');
const readOrders = () => readJson(ORDERS_FILE);
const writeOrders = (data) => writeJson(ORDERS_FILE, data);

const MEMO_PREFIX = 'BLANKUP-';
// Order ids look like BU-MUPOAO3Z-942c5c69 (base36 timestamp + uuid prefix).
const ORDER_ID_RE = /BU-[A-Z0-9]+-[A-Z0-9]+/i;
// SePay auto-extracts a "code" from the memo; it may upper-case it or strip
// separators, so every comparison happens on an alphanumeric-only form.
const ALNUM = /[^A-Z0-9]/g;

function normalizeCode(value) {
  return String(value == null ? '' : value).toUpperCase().replace(ALNUM, '');
}

function firstNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Accept both the documented SePay payload and the simplified internal shape. */
function normalizeSepayPayload(body = {}) {
  const content = body.content ?? body.description ?? body.transferContent ?? body.memo ?? '';
  return {
    eventId: body.id ?? body.transactionId ?? null,
    transactionId: body.referenceCode
      || (body.id != null ? String(body.id) : null)
      || (body.transactionId != null ? String(body.transactionId) : null),
    referenceCode: body.referenceCode || null,
    gateway: body.gateway || body.bankName || body.bankAccount || null,
    accountNumber: body.accountNumber || body.bankAccount || null,
    transactionDate: body.transactionDate || body.transaction_date || null,
    code: body.code || null,
    content: String(content || ''),
    // Only incoming transfers can pay an order. Default to 'in' so simplified
    // payloads (which omit the field) keep working.
    transferType: String(body.transferType || body.transfer_type || 'in').toLowerCase(),
    amount: firstNumber(body.transferAmount, body.amount, body.transactionAmount),
    rawStatus: body.status ?? null,
  };
}

/** The order id embedded in a transfer memo, if any (used for fast lookup). */
function extractOrderId(normalized) {
  const haystack = [normalized.code, normalized.content, normalized.referenceCode]
    .filter(Boolean)
    .join(' ');
  const match = haystack.match(ORDER_ID_RE);
  return match ? match[0] : null;
}

/**
 * Find the order a transfer belongs to.
 * Matching is done on the alphanumeric-only form so `BU-MUPOAO3Z-942C5C69`,
 * `BUMUPOAO3Z942C5C69` and `BLANKUP-BU-MUPOAO3Z-942c5c69 thanh toan` all match.
 * Unpaid orders win over already-paid ones; the longest match wins over a
 * shorter one (prevents a prefix from stealing another order's transfer).
 */
function findOrderForSepay(orders, normalized) {
  const haystack = [
    normalized.code,
    normalized.content,
    normalized.referenceCode,
  ].filter(Boolean).map(normalizeCode).join('|');
  if (!haystack) return -1;

  const hinted = extractOrderId(normalized);
  let bestIndex = -1;
  let bestLength = 0;
  let bestPaid = true;

  for (let i = 0; i < orders.length; i += 1) {
    const order = orders[i];
    if (!order || !order.orderId) continue;
    const candidates = [normalizeCode(order.orderId)];
    if (order.transferContent) candidates.push(normalizeCode(order.transferContent));

    for (const candidate of candidates) {
      if (!candidate || candidate.length < 8) continue;
      if (!haystack.includes(candidate)) continue;
      const paid = order.paymentStatus === 'paid';
      const better = candidate.length > bestLength
        || (candidate.length === bestLength && bestPaid && !paid);
      if (better) {
        bestIndex = i;
        bestLength = candidate.length;
        bestPaid = paid;
      }
      break;
    }
  }

  // If the memo only carries a short code (SePay truncates), fall back to the
  // extracted order id so we still resolve the intended order.
  if (bestIndex === -1 && hinted) {
    const idx = orders.findIndex((o) => o && String(o.orderId).toLowerCase() === hinted.toLowerCase());
    if (idx !== -1) return idx;
  }
  return bestIndex;
}

/**
 * Decide and apply the state transition for an incoming SePay transfer.
 * Mutates `orders` in place; the caller persists and publishes.
 * @returns {{action: string, order?: object, expected?: number, received?: number}}
 */
function applySepayToOrders(orders, normalized) {
  if (!Array.isArray(orders)) return { action: 'invalid_store' };
  if (normalized.transferType !== 'in') return { action: 'ignored_transfer_type' };
  if (!normalized.content && !normalized.code) return { action: 'no_content' };

  const index = findOrderForSepay(orders, normalized);
  if (index === -1) return { action: 'not_found' };

  const order = orders[index];
  const expected = order.finalPrice != null ? Number(order.finalPrice) : Number(order.total ?? Number(order.price || 0) * Number(order.quantity || 1));
  const received = normalized.amount;

  const paymentEvent = {
    at: new Date().toISOString(),
    source: 'sepay',
    transactionId: normalized.transactionId,
    referenceCode: normalized.referenceCode,
    gateway: normalized.gateway,
    amount: received,
    content: normalized.content,
  };
  order.paymentEvents = Array.isArray(order.paymentEvents) ? order.paymentEvents.slice(-19) : [];
  order.paymentEvents.push(paymentEvent);

  // Already settled: keep the terminal state (idempotent webhook retries).
  if (order.paymentStatus === 'paid') {
    return { action: 'already_paid', order, expected, received };
  }
  // Cancelled orders must never flip to paid just because money arrived.
  if (order.status === 'cancelled') {
    return { action: 'cancelled', order, expected, received };
  }
  if (!Number.isFinite(expected) || expected <= 0) {
    return { action: 'invalid_amount', order, expected, received };
  }
  if (received == null) {
    order.updatedAt = new Date().toISOString();
    return { action: 'amount_missing', order, expected, received };
  }
  if (received < expected) {
    // Short transfer: record what arrived, keep it unpaid so the admin can act.
    order.paymentReceivedAmount = received;
    order.paymentStatus = order.paymentStatus === 'paid' ? 'paid' : 'underpaid';
    order.paymentTransactionId = normalized.transactionId || order.paymentTransactionId || null;
    order.updatedAt = new Date().toISOString();
    return { action: 'underpaid', order, expected, received };
  }

  // Full (or over) payment → the order is genuinely paid.
  order.paymentStatus = 'paid';
  // awaiting_payment/pending/payment_failed advance to 'paid' (Đã thanh toán).
  // Production (processing) is a separate admin decision, never auto-started.
  if (['awaiting_payment', 'pending', 'payment_failed'].includes(order.status)) {
    order.status = 'paid';
  }
  order.paidAt = new Date().toISOString();
  order.paymentMethod = order.paymentMethod || order.payment || 'BANK_TRANSFER';
  order.paymentTransactionId = normalized.transactionId || null;
  order.paymentReferenceCode = normalized.referenceCode || null;
  order.paymentGateway = normalized.gateway || null;
  order.paymentReceivedAmount = received;
  if (received > expected) order.paymentOverpaidAmount = received - expected;
  order.paidByWebhookAt = order.paidAt;
  order.updatedAt = new Date().toISOString();
  return { action: 'paid', order, expected, received };
}

/**
 * Bank details behind the checkout QR. Single source of truth for the QR image,
 * the memo the customer transfers with, and what the webhook matches against.
 * Values come from .env with the live account as a fallback.
 */
function getBankInfo() {
  return {
    bankId: process.env.BANK_ID || '970422',
    bankName: process.env.BANK_NAME || 'MB Bank',
    accountNumber: process.env.BANK_ACCOUNT_NUMBER || '0967145402',
    accountName: process.env.BANK_ACCOUNT_NAME || 'LE LY HUY',
    template: process.env.BANK_QR_TEMPLATE || 'compact2',
  };
}

/**
 * Reconcile one SePay transfer against stored orders: lock the store, decide the
 * transition, persist, then publish the realtime event so every open screen
 * updates. Safe to call more than once for the same transfer (idempotent).
 *
 * @returns {Promise<{action: string, order?: object, expected?: number, received?: number}>}
 */
async function confirmOrderFromSepay(normalized) {
  const outcome = await withLock(ORDERS_FILE, () => {
    const orders = readOrders();
    const result = applySepayToOrders(orders, normalized);
    if (result.action === 'paid' || result.action === 'underpaid') writeOrders(orders);
    return result;
  });

  if (outcome.action === 'paid') {
    console.log(`[SePay] Order ${outcome.order.orderId} CONFIRMED — received ${outcome.received} / expected ${outcome.expected}`);
    publishOrderEvent(outcome.order, { source: 'sepay' });
  } else if (outcome.action === 'underpaid') {
    console.warn(`[SePay] Order ${outcome.order.orderId} underpaid — received ${outcome.received} < expected ${outcome.expected}`);
    publishOrderEvent(outcome.order, { source: 'sepay_underpaid' });
  } else if (outcome.action === 'already_paid') {
    console.log(`[SePay] Order ${outcome.order.orderId} already paid — duplicate webhook ignored`);
  }
  return outcome;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a == null ? '' : a));
  const right = Buffer.from(String(b == null ? '' : b));
  if (left.length !== right.length || left.length === 0) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * Verify the SePay webhook credential.
 * `configured: false` means no secret is set on this server — the route decides
 * how to treat that (it accepts the payload but warns loudly).
 */
function verifySepayRequest(headers = {}, secret) {
  if (!secret) return { configured: false, ok: true };
  const raw = headers['x-sepay-secret']
    || headers['x-webhook-secret']
    || headers['x-api-key']
    || headers['x-sepay-signature']
    || headers.authorization
    || '';
  const provided = String(raw).replace(/^(Bearer|Apikey|ApiKey|Basic|Token)\s+/i, '').trim();
  return { configured: true, ok: safeEqual(provided, secret) };
}

module.exports = {
  MEMO_PREFIX,
  normalizeCode,
  safeEqual,
  getBankInfo,
  confirmOrderFromSepay,
  normalizeSepayPayload,
  extractOrderId,
  findOrderForSepay,
  applySepayToOrders,
  verifySepayRequest,
};
