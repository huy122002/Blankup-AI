// backend/routes/reviews.js
//
// Customer reviews/feedback tied to REAL orders.
//
// Who can write: the order owner — either a logged-in user whose userId matches
// the order, or a guest presenting the order's paymentWatchToken (issued at
// checkout, same token that powers payment watching). One review per order.
// Orders that were cancelled cannot be reviewed.
//
// Moderation: reviews are VISIBLE by default (only real order owners can write,
// so spam risk is low). Admin can hide/unhide or delete any review and sees the
// full list with stats. The homepage "Cộng đồng nói gì" section and the admin
// dashboard both read from here.

const express = require('express');
const path = require('path');
const { authenticate, optionalAuthenticate, requireAdmin } = require('../middleware/auth');
let galleryLimiter;
try { ({ galleryLimiter } = require('../middleware/rateLimit')); } catch {}
if (typeof galleryLimiter !== 'function') galleryLimiter = (req, res, next) => next();
const { readJson, writeJson, withLock } = require('../utils/fileStore');

const router = express.Router();

const REVIEWS_FILE = path.join(__dirname, '../data/reviews.json');
const ORDERS_FILE = path.join(__dirname, '../data/orders.json');
const readReviews = () => {
  const data = readJson(REVIEWS_FILE);
  return Array.isArray(data) ? data : [];
};
const readOrders = () => {
  const data = readJson(ORDERS_FILE);
  return Array.isArray(data) ? data : [];
};

const MIN_COMMENT = 2;
const MAX_COMMENT = 600;

// Everything the public homepage needs — never leak userId / watch token.
function publicReview(r) {
  return {
    id: r.id,
    orderId: r.orderId,
    authorName: r.authorName,
    rating: r.rating,
    comment: r.comment || '',
    productType: r.productType || null,
    orderTotal: r.orderTotal != null ? Number(r.orderTotal) : null,
    createdAt: r.createdAt,
    // Shop's public reply (admin) — shown under the review on the homepage.
    reply: r.reply && r.reply.text
      ? { text: String(r.reply.text), at: r.reply.at || null }
      : null,
  };
}

// Aggregate stats over VISIBLE reviews — powers the homepage summary header
// and the admin dashboard.
function reviewStats(reviews) {
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  reviews.forEach(r => {
    const key = Math.min(5, Math.max(1, Math.floor(Number(r.rating) || 0)));
    distribution[key] += 1;
    sum += key;
  });
  return {
    total: reviews.length,
    averageRating: reviews.length ? Math.round((sum / reviews.length) * 10) / 10 : 0,
    distribution,
  };
}

function findOrder(orders, orderId) {
  if (!orderId || typeof orderId !== 'string') return null;
  return orders.find(o => o && String(o.orderId).toLowerCase() === orderId.trim().toLowerCase()) || null;
}

function orderTotalAmount(order) {
  if (order.finalPrice != null) return Number(order.finalPrice);
  if (order.total != null) return Number(order.total);
  return Number(order.price || 0) * Number(order.quantity || 1);
}

// ---------------------------------------------------------------------------
// POST /api/reviews — create a review for an order
// Body: { orderId, rating (1..5), comment?, watchToken? }
// ---------------------------------------------------------------------------
router.post('/', galleryLimiter, optionalAuthenticate, async (req, res) => {
  try {
    const { orderId, rating, comment, watchToken } = req.body || {};

    const ratingNum = Number(rating);
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ success: false, error: 'Điểm đánh giá phải là số nguyên từ 1 đến 5.' });
    }

    const text = String(comment == null ? '' : comment).trim();
    if (text.length > MAX_COMMENT) {
      return res.status(400).json({ success: false, error: `Nội dung đánh giá tối đa ${MAX_COMMENT} ký tự.` });
    }
    if (text.length > 0 && text.length < MIN_COMMENT) {
      return res.status(400).json({ success: false, error: `Nội dung đánh giá tối thiểu ${MIN_COMMENT} ký tự (hoặc bỏ trống).` });
    }

    const out = await withLock(ORDERS_FILE, () => {
      // Lock the ORDERS file because ownership is proven against it; reviews
      // live in their own file but are written under the same lock to keep
      // one-review-per-order race-free.
      const orders = readOrders();
      const order = findOrder(orders, orderId);
      if (!order) return { notFound: true };

      // Ownership proof: logged-in owner OR the checkout watch token.
      const isOwnerByAuth = Boolean(
        req.user && order.userId && String(order.userId) === String(req.user.id)
      );
      const isOwnerByToken = Boolean(
        watchToken && order.paymentWatchToken && String(watchToken) === String(order.paymentWatchToken)
      );
      if (!isOwnerByAuth && !isOwnerByToken) {
        return { forbidden: true };
      }

      if (String(order.status) === 'cancelled') {
        return { cancelled: true };
      }

      const reviews = readReviews();
      const existing = reviews.find(r => r && String(r.orderId).toLowerCase() === order.orderId.toLowerCase());
      if (existing) {
        return { duplicate: true, existing };
      }

      const now = new Date().toISOString();
      const review = {
        id: 'rev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
        orderId: order.orderId,
        userId: isOwnerByAuth ? String(req.user.id) : null,
        authorName: String(
          (isOwnerByAuth && (req.user.fullName || req.user.username)) ||
          order.customer?.name ||
          'Khách hàng'
        ).slice(0, 60),
        rating: ratingNum,
        comment: text,
        productType: order.productType || null,
        orderTotal: orderTotalAmount(order),
        status: 'visible', // visible | hidden
        createdAt: now,
        updatedAt: now,
      };
      reviews.push(review);
      writeJson(REVIEWS_FILE, reviews);
      return { review };
    });

    if (out && out.notFound) return res.status(404).json({ success: false, error: 'Không tìm thấy đơn hàng.' });
    if (out && out.forbidden) return res.status(403).json({ success: false, error: 'Bạn không có quyền đánh giá đơn hàng này.' });
    if (out && out.cancelled) return res.status(409).json({ success: false, error: 'Đơn đã hủy không thể đánh giá.' });
    if (out && out.duplicate) {
      return res.status(409).json({ success: false, error: 'Bạn đã đánh giá đơn hàng này rồi.', data: publicReview(out.existing) });
    }
    if (!out || !out.review) return res.status(500).json({ success: false, error: 'Không thể lưu đánh giá.' });

    return res.status(201).json({ success: true, message: 'Cảm ơn bạn đã đánh giá!', data: publicReview(out.review) });
  } catch (err) {
    console.error('[Reviews] Create error:', err.message);
    return res.status(500).json({ success: false, error: 'Không thể lưu đánh giá.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/reviews/summary — public, REAL numbers from the reviews store.
// Powers the admin overview KPIs (and any public trust widget). Same aggregation
// as /public but without review bodies.
router.get('/summary', (req, res) => {
  try {
    const reviews = readReviews().filter(r => r && r.status === 'visible');
    const stats = reviewStats(reviews);
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent = reviews.filter(r => r.createdAt && new Date(r.createdAt).getTime() >= weekAgo).length;
    res.json({ success: true, stats: { ...stats, last7d: recent } });
  } catch (err) {
    console.error('[Reviews] summary error:', err.stack || err.message);
    res.status(500).json({ success: false, error: 'Failed to load review summary.' });
  }
});

// GET /api/reviews/public — visible reviews for the homepage (no auth)
// Returns { data: [...], stats: { total, averageRating, distribution } }
// ---------------------------------------------------------------------------
router.get('/public', (req, res) => {
  try {
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 50) : 12;
    const visible = readReviews().filter(r => r && r.status === 'visible');
    const sorted = visible
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const data = sorted.slice(0, limit).map(publicReview);
    return res.json({ success: true, data, stats: reviewStats(visible), hasMore: sorted.length > data.length });
  } catch (err) {
    console.error('[Reviews] Public list error:', err.message);
    return res.status(500).json({ success: false, error: 'Không thể tải đánh giá.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/reviews/mine — the logged-in user's own reviews
// ---------------------------------------------------------------------------
router.get('/mine', authenticate, (req, res) => {
  try {
    const reviews = readReviews()
      .filter(r => r && r.userId && String(r.userId) === String(req.user.id))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .map(publicReview);
    return res.json({ success: true, data: reviews });
  } catch (err) {
    console.error('[Reviews] Mine error:', err.message);
    return res.status(500).json({ success: false, error: 'Không thể tải đánh giá.' });
  }
});

// ---------------------------------------------------------------------------
// Admin — list everything + stats
// ---------------------------------------------------------------------------
router.get('/', authenticate, requireAdmin, (req, res) => {
  try {
    const reviews = readReviews()
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const visible = reviews.filter(r => r.status === 'visible');
    const stats = {
      total: reviews.length,
      visible: visible.length,
      hidden: reviews.length - visible.length,
      averageRating: visible.length
        ? Math.round((visible.reduce((sum, r) => sum + (Number(r.rating) || 0), 0) / visible.length) * 10) / 10
        : 0,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    };
    visible.forEach(r => {
      const key = Math.min(5, Math.max(1, Math.floor(Number(r.rating) || 0)));
      stats.distribution[key] += 1;
    });
    return res.json({ success: true, data: reviews, stats });
  } catch (err) {
    console.error('[Reviews] Admin list error:', err.message);
    return res.status(500).json({ success: false, error: 'Không thể tải đánh giá.' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/reviews/:id/reply — shop's public reply  Body: { reply: string }
// Empty reply clears it.
// ---------------------------------------------------------------------------
router.put('/:id/reply', authenticate, requireAdmin, async (req, res) => {
  try {
    const text = String((req.body && req.body.reply) == null ? '' : req.body.reply).trim();
    if (text.length > 600) {
      return res.status(400).json({ success: false, error: 'Phản hồi tối đa 600 ký tự.' });
    }
    const out = await withLock(REVIEWS_FILE, () => {
      const reviews = readReviews();
      const idx = reviews.findIndex(r => r && r.id === req.params.id);
      if (idx === -1) return { notFound: true };
      if (text) {
        reviews[idx].reply = { text, at: new Date().toISOString(), by: req.user.username || 'Blankup' };
      } else {
        delete reviews[idx].reply;
      }
      reviews[idx].updatedAt = new Date().toISOString();
      writeJson(REVIEWS_FILE, reviews);
      return { review: reviews[idx] };
    });
    if (out && out.notFound) return res.status(404).json({ success: false, error: 'Không tìm thấy đánh giá.' });
    return res.json({ success: true, message: text ? 'Đã lưu phản hồi.' : 'Đã xóa phản hồi.', data: publicReview(out.review) });
  } catch (err) {
    console.error('[Reviews] Reply error:', err.message);
    return res.status(500).json({ success: false, error: 'Không thể lưu phản hồi.' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/reviews/:id/visibility — admin hide/unhide  Body: { visible: bool }
// ---------------------------------------------------------------------------
router.put('/:id/visibility', authenticate, requireAdmin, async (req, res) => {
  try {
    const visible = Boolean(req.body && req.body.visible);
    const out = await withLock(REVIEWS_FILE, () => {
      const reviews = readReviews();
      const idx = reviews.findIndex(r => r && r.id === req.params.id);
      if (idx === -1) return { notFound: true };
      reviews[idx].status = visible ? 'visible' : 'hidden';
      reviews[idx].updatedAt = new Date().toISOString();
      writeJson(REVIEWS_FILE, reviews);
      return { review: reviews[idx] };
    });
    if (out && out.notFound) return res.status(404).json({ success: false, error: 'Không tìm thấy đánh giá.' });
    return res.json({ success: true, message: visible ? 'Đã hiện đánh giá.' : 'Đã ẩn đánh giá.', data: publicReview(out.review) });
  } catch (err) {
    console.error('[Reviews] Visibility error:', err.message);
    return res.status(500).json({ success: false, error: 'Không thể cập nhật đánh giá.' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/reviews/:id — admin delete
// ---------------------------------------------------------------------------
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const out = await withLock(REVIEWS_FILE, () => {
      const reviews = readReviews();
      const idx = reviews.findIndex(r => r && r.id === req.params.id);
      if (idx === -1) return { notFound: true };
      const [removed] = reviews.splice(idx, 1);
      writeJson(REVIEWS_FILE, reviews);
      return { removed };
    });
    if (out && out.notFound) return res.status(404).json({ success: false, error: 'Không tìm thấy đánh giá.' });
    return res.json({ success: true, message: 'Đã xóa đánh giá.', data: publicReview(out.removed) });
  } catch (err) {
    console.error('[Reviews] Delete error:', err.message);
    return res.status(500).json({ success: false, error: 'Không thể xóa đánh giá.' });
  }
});

module.exports = router;
