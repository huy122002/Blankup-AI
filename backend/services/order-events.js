// backend/services/order-events.js
//
// Minimal in-process publish/subscribe for order changes, used by the Server-Sent
// Events endpoints so the customer's checkout screen and the admin order board
// reflect payment/status changes the moment they happen.
//
// Deliberately dependency-free: one Node process owns one listener set. Payloads
// carry no customer PII (no name / phone / address) — only what a status view needs.

const listeners = new Set();

/**
 * Register a listener. Returns an unsubscribe function.
 * @param {(event: object) => void} listener
 */
function subscribe(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Shape a stored order into the realtime event payload. */
function orderEventPayload(order, extra = {}) {
  return {
    type: 'order.updated',
    orderId: order.orderId,
    userId: order.userId || null,
    status: order.status,
    paymentStatus: order.paymentStatus || null,
    paymentMethod: order.paymentMethod || order.payment || null,
    paidAt: order.paidAt || null,
    updatedAt: order.updatedAt || new Date().toISOString(),
    ...extra,
  };
}

/**
 * Publish an order event to every subscriber.
 * A throwing listener must never break the caller's write path, so each call is
 * isolated. Returns the event that was published (useful for tests/logging).
 */
function publishOrderEvent(order, extra = {}) {
  const event = orderEventPayload(order, extra);
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (err) {
      console.warn('[OrderEvents] listener failed:', err.message);
    }
  }
  return event;
}

/** Number of active subscribers — used by diagnostics/tests. */
function subscriberCount() {
  return listeners.size;
}

module.exports = { subscribe, publishOrderEvent, orderEventPayload, subscriberCount };
