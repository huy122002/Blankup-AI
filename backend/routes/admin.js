const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const { readUsers } = require('./auth');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { getPool, sql } = require('../db');
const { readJson } = require('../utils/fileStore');

const router = express.Router();
const ordersFilePath = path.join(__dirname, '../data/orders.json');
const designsFilePath = path.join(__dirname, '../data/designs.json');

const readOrders = () => readJson(ordersFilePath);
const readDesigns = () => readJson(designsFilePath);

// ---------------------------------------------------------------------------
// GET /api/admin/stats
// Returns overview statistics, recent orders, and user list (Admin only)
// ---------------------------------------------------------------------------
router.get('/stats', authenticate, requireAdmin, async (req, res) => {
  try {
    const orders = readOrders();
    const users = await readUsers();
    const designs = readDesigns();

    // 1. Order Status Counts
    let completedCount = 0;
    let pendingCount = 0;
    let cancelledCount = 0;

    // 2. Financial Metrics
    let totalRevenue = 0; // completed orders only
    let pendingRevenue = 0; // pending orders

    // 3. Category Breakdown (Completed orders only)
    const categories = {
      tshirt: { revenue: 0, count: 0 },
      oversize: { revenue: 0, count: 0 },
      polo: { revenue: 0, count: 0 },
      hoodie: { revenue: 0, count: 0 },
    };

    orders.forEach((order) => {
      const effectiveTotal = order.finalPrice != null ? Number(order.finalPrice) : (order.total != null ? Number(order.total) : ((order.price || 0) * (order.quantity || 1)));

      if (order.status === 'completed') {
        completedCount++;
        totalRevenue += effectiveTotal;

        const cat = (order.productType || 'tshirt').toLowerCase();
        if (categories[cat]) {
          categories[cat].revenue += effectiveTotal;
          categories[cat].count += order.quantity;
        } else {
          categories.tshirt.revenue += effectiveTotal;
          categories.tshirt.count += order.quantity;
        }
      } else if (order.status === 'cancelled') {
        cancelledCount++;
      } else {
        pendingCount++;
        pendingRevenue += effectiveTotal;
      }
    });

    const totalOrdersCount = orders.length;
    const averageOrderValue = completedCount > 0 ? Math.round(totalRevenue / completedCount) : 0;

    // 4b. Review stats — REAL numbers from the reviews store (no placeholders).
    const reviewsData = readJson(path.join(__dirname, '../data/reviews.json'));
    const allReviews = Array.isArray(reviewsData) ? reviewsData : [];
    const visibleReviews = allReviews.filter(r => r && r.status === 'visible');
    const reviewDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let reviewSum = 0;
    let reviewUnreplied = 0;
    const weekAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let reviewLast7d = 0;
    visibleReviews.forEach(r => {
      const key = Math.min(5, Math.max(1, Math.floor(Number(r.rating) || 0)));
      reviewDistribution[key] += 1;
      reviewSum += key;
      if (!(r.reply && r.reply.text)) reviewUnreplied += 1;
      if (r.createdAt && new Date(r.createdAt).getTime() >= weekAgoMs) reviewLast7d += 1;
    });
    const reviewStats = {
      total: visibleReviews.length,
      allTotal: allReviews.length,
      averageRating: visibleReviews.length ? Math.round((reviewSum / visibleReviews.length) * 10) / 10 : 0,
      distribution: reviewDistribution,
      unreplied: reviewUnreplied,
      last7d: reviewLast7d,
    };

    // 4. Users stats (add order count and register date)
    const userList = users.map((u) => {
      const userOrders = orders.filter((o) => o.userId === u.id);
      const userOrdersCount = userOrders.length;
      const userCompletedOrders = userOrders.filter((o) => o.status === 'completed');
      const userSpend = userCompletedOrders.reduce((sum, o) => {
        const v = o.finalPrice != null ? Number(o.finalPrice) : (o.total != null ? Number(o.total) : (o.price || 0) * (o.quantity || 1));
        return sum + v;
      }, 0);

      return {
        id: u.id,
        username: u.username,
        fullName: u.fullName,
        role: u.role,
        createdAt: u.createdAt,
        ordersCount: userOrdersCount,
        totalSpend: userSpend,
      };
    });

    // 5. Recent orders (take last 5)
    const recentOrders = [...orders]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 5);

    res.json({
      success: true,
      stats: {
        totalRevenue,
        pendingRevenue,
        completedCount,
        pendingCount,
        cancelledCount,
        totalOrdersCount,
        averageOrderValue,
        categories,
        usersCount: users.length,
        designsCount: designs.length,
        reviews: reviewStats,
      },
      users: userList,
      recentOrders,
    });
  } catch (err) {
    console.error('[Admin] Error calculating statistics:', err.stack || err.message);
    res.status(500).json({ success: false, error: 'Failed to calculate stats' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/users
// Create a new user (admin only)
// ---------------------------------------------------------------------------
router.post('/users', authenticate, requireAdmin, async (req, res) => {
  try {
    const { username, password, fullName, email, role } = req.body;

    if (!username || !password || !fullName) {
      return res.status(400).json({ success: false, error: 'Tên đăng nhập, mật khẩu và họ tên là bắt buộc.' });
    }

    const allowedRoles = ['user', 'admin'];
    const userRole = allowedRoles.includes(role) ? role : 'user';

    const pool = getPool();

    const existing = await pool.request()
      .input('username', sql.NVarChar, username.trim().toLowerCase())
      .query('SELECT id FROM Users WHERE username = @username');

    if (existing.recordset.length > 0) {
      return res.status(400).json({ success: false, error: 'Tên đăng nhập đã tồn tại.' });
    }

    const newId = 'u-' + Date.now();
    const hashedPassword = bcrypt.hashSync(password, 10);

    await pool.request()
      .input('id', sql.NVarChar, newId)
      .input('username', sql.NVarChar, username.trim().toLowerCase())
      .input('password', sql.NVarChar, hashedPassword)
      .input('fullName', sql.NVarChar, fullName.trim())
      .input('email', sql.NVarChar, email || null)
      .input('role', sql.NVarChar, userRole)
      .input('provider', sql.NVarChar, 'local')
      .query(`
        INSERT INTO Users (id, username, password, fullName, email, role, provider)
        VALUES (@id, @username, @password, @fullName, @email, @role, @provider)
      `);

    console.log(`[Admin] User ${username} created by ${req.user.username}`);
    res.status(201).json({ success: true, message: `Đã tạo tài khoản ${username}.`, data: { id: newId, username: username.trim().toLowerCase(), fullName: fullName.trim(), role: userRole } });
  } catch (err) {
    console.error('[Admin] Error creating user:', err.message);
    res.status(500).json({ success: false, error: 'Failed to create user.' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/admin/users/:id
// Update user info (admin only) — last-admin guard
// ---------------------------------------------------------------------------
router.put('/users/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { fullName, email, role } = req.body;
    const allowedRoles = ['user', 'admin'];

    const pool = getPool();

    const userCheck = await pool.request()
      .input('id', sql.NVarChar, id)
      .query('SELECT id, role FROM Users WHERE id = @id');

    if (userCheck.recordset.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    if (role === 'user' && userCheck.recordset[0].role === 'admin') {
      const adminCount = await pool.request().query(`SELECT COUNT(*) AS cnt FROM Users WHERE role = 'admin'`);
      if (Number(adminCount.recordset[0]?.cnt) <= 1) {
        return res.status(400).json({ success: false, error: 'Không thể hạ cấp admin cuối cùng.' });
      }
    }

    const updates = [];
    const request = pool.request().input('id', sql.NVarChar, id);

    if (fullName !== undefined) {
      updates.push('fullName = @fullName');
      request.input('fullName', sql.NVarChar, fullName.trim());
    }
    if (email !== undefined) {
      updates.push('email = @email');
      request.input('email', sql.NVarChar, email || null);
    }
    if (role !== undefined && allowedRoles.includes(role)) {
      updates.push('role = @role');
      request.input('role', sql.NVarChar, role);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'Không có dữ liệu cập nhật.' });
    }

    await request.query(`UPDATE Users SET ${updates.join(', ')} WHERE id = @id`);

    console.log(`[Admin] User ${id} updated by ${req.user.username}`);
    res.json({ success: true, message: 'Đã cập nhật thông tin người dùng.' });
  } catch (err) {
    console.error('[Admin] Error updating user:', err.message);
    res.status(500).json({ success: false, error: 'Failed to update user.' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/admin/users/:id/role
// Update a user's role (admin only)
// ---------------------------------------------------------------------------
router.put('/users/:id/role', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    const allowedRoles = ['user', 'admin'];

    if (!role || !allowedRoles.includes(role)) {
      return res.status(400).json({ success: false, error: `Invalid role. Must be one of: ${allowedRoles.join(', ')}` });
    }

    const pool = getPool();
    const result = await pool.request()
      .input('id', sql.NVarChar, id)
      .input('role', sql.NVarChar, role)
      .query('UPDATE Users SET role = @role WHERE id = @id');

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    console.log(`[Admin] User ${id} role updated to ${role} by ${req.user.username}`);
    res.json({ success: true, message: `Đã cập nhật vai trò người dùng thành ${role}.` });
  } catch (err) {
    console.error('[Admin] Error updating user role:', err.message);
    res.status(500).json({ success: false, error: 'Failed to update user role.' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/users/:id
// Delete a user (admin only, cannot delete self)
// ---------------------------------------------------------------------------
router.delete('/users/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (req.user.id === id) {
      return res.status(400).json({ success: false, error: 'Không thể xóa tài khoản của chính mình.' });
    }

    const pool = getPool();

    const userCheck = await pool.request()
      .input('id', sql.NVarChar, id)
      .query('SELECT id, username, role FROM Users WHERE id = @id');

    if (userCheck.recordset.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    const targetUser = userCheck.recordset[0];
    if (targetUser.role === 'admin') {
      return res.status(400).json({ success: false, error: 'Không thể xóa tài khoản admin khác.' });
    }

    await pool.request()
      .input('id', sql.NVarChar, id)
      .query('DELETE FROM Users WHERE id = @id');

    console.log(`[Admin] User ${targetUser.username} (${id}) deleted by ${req.user.username}`);
    res.json({ success: true, message: `Đã xóa tài khoản ${targetUser.username}.` });
  } catch (err) {
    console.error('[Admin] Error deleting user:', err.message);
    res.status(500).json({ success: false, error: 'Failed to delete user.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/users/:id
// Get single user details (admin only)
// ---------------------------------------------------------------------------
router.get('/users/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const pool = getPool();

    const result = await pool.request()
      .input('id', sql.NVarChar, id)
      .query('SELECT id, username, fullName, email, avatar, provider, role, createdAt FROM Users WHERE id = @id');

    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    const user = result.recordset[0];
    const orders = readOrders();
    const userOrders = orders.filter(o => o.userId === id);
    const completedOrders = userOrders.filter(o => o.status === 'completed');
    const totalSpend = completedOrders.reduce((sum, o) => {
      const v = o.finalPrice != null ? Number(o.finalPrice) : (o.total != null ? Number(o.total) : (o.price || 0) * (o.quantity || 1));
      return sum + v;
    }, 0);

    res.json({
      success: true,
      data: {
        ...user,
        ordersCount: userOrders.length,
        totalSpend,
        recentOrders: userOrders
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          .slice(0, 5),
      },
    });
  } catch (err) {
    console.error('[Admin] Error fetching user:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch user details.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/designs
// Get all designs (admin only)
// ---------------------------------------------------------------------------
router.get('/designs', authenticate, requireAdmin, (req, res) => {
  try {
    const designs = readDesigns();
    res.json({ success: true, data: designs });
  } catch (err) {
    console.error('[Admin] Error fetching designs:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch designs.' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/admin/designs/:id/visibility
// Toggle design visibility (admin only)
// ---------------------------------------------------------------------------
router.put('/designs/:id/visibility', authenticate, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { isShared } = req.body;

    const designs = readDesigns();
    const index = designs.findIndex(d => d.id === id);
    if (index === -1) {
      return res.status(404).json({ success: false, error: 'Design not found.' });
    }

    designs[index].isShared = Boolean(isShared);
    fs.writeFileSync(designsFilePath, JSON.stringify(designs, null, 2), 'utf8');

    console.log(`[Admin] Design ${id} visibility set to ${isShared} by ${req.user.username}`);
    res.json({ success: true, data: designs[index] });
  } catch (err) {
    console.error('[Admin] Error updating design visibility:', err.message);
    res.status(500).json({ success: false, error: 'Failed to update design visibility.' });
  }
});

module.exports = router;
