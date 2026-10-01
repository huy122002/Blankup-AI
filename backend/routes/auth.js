/**
 * Blankup Authentication Routes — SQL Server
 * Handles local login/register, Google/Facebook social login,
 * session checking, and user lookup.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const { getPool, sql } = require('../db');
const { sendMail } = require('../services/mailer');
const { verifyGoogleIdToken } = require('../services/google-auth.service');
const { signToken } = require('../services/jwt.service');
const { verifyCode, createVerificationCode, OTP_EXPIRY_MINUTES, isAlreadyVerified } = require('../services/otp.service');
const pendingReg = require('../services/pending-registration.service');
const { generateResetAuthToken, validateResetAuthToken } = require('../services/reset-auth.service');
const { authenticate } = require('../middleware/auth');
const crypto = require('crypto');

const router = express.Router();

// ---------------------------------------------------------------------------
// Facebook OAuth — server-side Authorization Code flow (state store)
// ---------------------------------------------------------------------------
const FACEBOOK_OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const facebookOAuthStates = new Map(); // state -> { createdAt, redirectTo }

function isFacebookEnabled() {
  return String(process.env.FACEBOOK_ENABLED || '').toLowerCase() === 'true';
}

function getFacebookConfig(req) {
  const appId = process.env.FACEBOOK_APP_ID || '';
  const appSecret = process.env.FACEBOOK_APP_SECRET || '';
  const graphVersion = process.env.FACEBOOK_GRAPH_VERSION || 'v18.0';
  let redirectUri = process.env.FACEBOOK_REDIRECT_URI || '';
  if (!redirectUri && req) {
    // Default local redirect URI derived from request host, fallback to localhost:3000
    const host = req.get('host') || `localhost:${process.env.PORT || 3000}`;
    const protocol = req.protocol || 'http';
    redirectUri = `${protocol}://${host}/api/auth/facebook/callback`;
  }
  if (!redirectUri) {
    redirectUri = `http://localhost:${process.env.PORT || 3000}/api/auth/facebook/callback`;
  }
  return { appId, appSecret, graphVersion, redirectUri };
}

function createFacebookState(redirectTo) {
  const state = crypto.randomBytes(32).toString('hex');
  facebookOAuthStates.set(state, { createdAt: Date.now(), redirectTo: redirectTo || '' });
  // Cleanup expired entries (lazy)
  for (const [k, v] of facebookOAuthStates.entries()) {
    if (Date.now() - v.createdAt > FACEBOOK_OAUTH_STATE_TTL_MS) facebookOAuthStates.delete(k);
  }
  return state;
}

function consumeFacebookState(state) {
  const entry = facebookOAuthStates.get(state);
  if (!entry) return null;
  // Single-use: delete immediately
  facebookOAuthStates.delete(state);
  if (Date.now() - entry.createdAt > FACEBOOK_OAUTH_STATE_TTL_MS) return null;
  return entry;
}

function getSafeRedirectPath(redirectTo, req) {
  if (!redirectTo) return '/';
  try {
    const target = new URL(redirectTo, `${req.protocol}://${req.get('host')}`);
    if (target.origin !== `${req.protocol}://${req.get('host')}`) return '/';
    if (target.pathname.includes('login.html') && target.pathname.includes('facebook')) return '/';
    return target.pathname + target.search + target.hash;
  } catch {
    return '/';
  }
}

function renderFacebookSuccessHtml(token, user, redirectTo) {
  const safeUser = JSON.stringify(user).replace(/</g, '\\u003c');
  const safeRedirect = JSON.stringify(redirectTo || '/').replace(/</g, '\\u003c');
  const safeToken = JSON.stringify(token).replace(/</g, '\\u003c');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Blankup — Facebook Login</title></head><body><script>
    (function(){
      try {
        localStorage.setItem('blankup_token', ${safeToken});
        localStorage.setItem('blankup_user', ${safeUser});
      } catch(e) {}
      window.location.href = ${safeRedirect};
    })();
  </script><p>Đăng nhập Facebook thành công, đang chuyển hướng...</p></body></html>`;
}

function renderFacebookErrorHtml(message, redirectTo) {
  const safeMsg = String(message || 'Đăng nhập Facebook thất bại.').replace(/</g, '&lt;');
  const loginUrl = redirectTo && redirectTo.startsWith('/') ? '/login.html' : '/login.html';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Blankup — Facebook Login Failed</title></head><body style="font-family:Arial,sans-serif;max-width:480px;margin:40px auto;padding:24px;text-align:center;">
    <h2 style="color:#b43e12;">Đăng nhập Facebook thất bại</h2>
    <p>${safeMsg}</p>
    <p><a href="${loginUrl}" style="color:#b43e12;">Quay lại đăng nhập</a></p>
  </body></html>`;
}

// ---------------------------------------------------------------------------
// Lightweight in-process mutex for reset-password (prevents race condition)
// ---------------------------------------------------------------------------
const resetMutexes = new Map();
async function withResetLock(key, fn) {
  while (resetMutexes.get(key)) {
    await new Promise(r => setTimeout(r, 10));
  }
  resetMutexes.set(key, true);
  try {
    return await fn();
  } finally {
    resetMutexes.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Helper: read all users (for admin routes)
// ---------------------------------------------------------------------------
async function readUsers() {
  try {
    const pool = getPool();
    const result = await pool.request().query('SELECT id, username, fullName, email, avatar, provider, role, createdAt FROM Users');
    return result.recordset;
  } catch (err) {
    console.error('[Auth] Error reading users:', err.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// OTP Helpers — imported from services/otp.service.js
// ---------------------------------------------------------------------------

async function sendVerificationEmail(email, code) {
  return sendMail({
    to: email,
    subject: '[Blankup] Mã xác thực email của bạn',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;">
        <h2 style="color:#b43e12;">Xác thực email Blankup</h2>
        <p>Xin chào,</p>
        <p>Mã xác thực email của bạn là:</p>
        <div style="font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center;padding:20px;background:#f6f3ec;border-radius:12px;margin:20px 0;color:#1a1a2e;">${code}</div>
        <p style="color:#64748b;font-size:0.9rem;">Mã này hết hạn sau <strong>${OTP_EXPIRY_MINUTES} phút</strong>. Nếu bạn không yêu cầu mã này, vui lòng bỏ qua email này.</p>
      </div>
    `,
    text: `Mã xác thực Blankup: ${code}. Hết hạn sau ${OTP_EXPIRY_MINUTES} phút.`,
  });
}

/**
 * Mask an email for safe logging: "ab***@gmail.com".
 * Never log passwords, secrets, or full OTPs in production paths.
 */
function maskEmail(email) {
  const s = String(email || '');
  const at = s.indexOf('@');
  if (at <= 0) return '***';
  return s.slice(0, Math.min(2, at)) + '***' + s.slice(at);
}

function sendVerificationSms(phone, code) {
  // DEMO SMS provider: no real gateway yet. The demo code is generated and
  // verified by the pending-registration service; this function only logs
  // delivery locally. Do NOT treat log output as verification.
  console.log('\n──────── [SMS] Verification code (DEMO provider) ────────');
  console.log(`To:      ${phone}`);
  console.log(`Code:    ${code}`);
  console.log(`Expires: ${pendingReg.OTP_EXPIRY_MINUTES} minutes`);
  console.log('─────────────────────────────────────────────────────────────\n');
  return { sent: false, reason: 'sms_demo_provider' };
}

// ---------------------------------------------------------------------------
// Lightweight in-process mutex for registration (prevents double-submit /
// concurrent duplicate pending rows for the same username)
// ---------------------------------------------------------------------------
const registerMutexes = new Map();
async function withRegisterLock(key, fn) {
  while (registerMutexes.get(key)) {
    await new Promise(r => setTimeout(r, 10));
  }
  registerMutexes.set(key, true);
  try {
    return await fn();
  } finally {
    registerMutexes.delete(key);
  }
}

async function findActivePending(pool, { username, email, phone }) {
  // NOTE: Node stores UTC datetimes; SQL Server GETDATE() is server-local time.
  // All expiry comparisons must use GETUTCDATE() to match stored values.
  const result = await pool.request()
    .input('username', sql.NVarChar, username)
    .query(`SELECT * FROM PendingRegistrations WHERE username = @username AND status = 'pending' AND expiresAt > GETUTCDATE()`);
  let rows = result.recordset;
  if (email) {
    const byEmail = await pool.request()
      .input('email', sql.NVarChar, email)
      .query(`SELECT * FROM PendingRegistrations WHERE email = @email AND status = 'pending' AND expiresAt > GETUTCDATE() AND email IS NOT NULL`);
    rows = rows.concat(byEmail.recordset.filter(r => !rows.some(x => x.id === r.id)));
  }
  if (phone) {
    const byPhone = await pool.request()
      .input('phone', sql.NVarChar, phone)
      .query(`SELECT * FROM PendingRegistrations WHERE phone = @phone AND status = 'pending' AND expiresAt > GETUTCDATE() AND phone IS NOT NULL`);
    rows = rows.concat(byPhone.recordset.filter(r => !rows.some(x => x.id === r.id)));
  }
  return rows;
}

// ---------------------------------------------------------------------------
// POST /api/auth/register  (Local registration — verify-before-create)
//
// Creates ONLY a PendingRegistrations row. A real Users row is created
// atomically later, when ALL required channels verify (see POST /verify).
// Response keeps `userId` = pendingId for frontend compatibility, plus
// an explicit `pendingId` field.
// ---------------------------------------------------------------------------
router.post('/register', async (req, res) => {
  try {
    const { username, password, fullName, email, phone } = req.body;

    if (!username || !password || !fullName) {
      return res.status(400).json({
        success: false,
        error: 'Tên đăng nhập, mật khẩu và họ tên là bắt buộc.',
      });
    }

    if (!email && !phone) {
      return res.status(400).json({
        success: false,
        error: 'Vui lòng cung cấp email hoặc số điện thoại để xác thực.',
      });
    }

    const normalizedUsername = String(username).trim().toLowerCase();
    const trimmedFullName = String(fullName).trim();
    const normalizedEmail = email ? String(email).trim() : null;
    const normalizedPhone = phone ? String(phone).trim() : null;
    if (!trimmedFullName) {
      return res.status(400).json({ success: false, error: 'Họ và tên là bắt buộc.' });
    }

    const pool = getPool();
    const idempotencyKey = req.headers['idempotency-key'] || req.headers['Idempotency-Key'] || null;
    // Same-key requests must serialize globally so a reused key with a
    // different body is reliably rejected (409) instead of racing.
    const lockKey = idempotencyKey
      ? 'register:key:' + String(idempotencyKey)
      : 'register:' + normalizedUsername;

    const result = await withRegisterLock(lockKey, async () => {
      // Global idempotency check first: the same key may never map to two
      // different registration bodies.
      if (idempotencyKey) {
        const keyRes = await pool.request()
          .input('idempotencyKey', sql.NVarChar, String(idempotencyKey))
          .query(`SELECT * FROM PendingRegistrations WHERE idempotencyKey = @idempotencyKey AND status = 'pending' AND expiresAt > GETUTCDATE()`);
        const keyed = keyRes.recordset[0];
        if (keyed) {
          const expectedHash = pendingReg.hashIdempotency([
            normalizedUsername, trimmedFullName, normalizedEmail || '', normalizedPhone || '',
          ]);
          if (keyed.idempotencyHash && keyed.idempotencyHash !== expectedHash) {
            return { error: 'Idempotency-Key đã được sử dụng với dữ liệu khác. Vui lòng tạo key mới.', status: 409 };
          }
          return {
            idempotent: true,
            pendingId: keyed.id,
            verificationMethods: pendingReg.requiredMethods(keyed),
          };
        }
      }

      // A. Duplicate check against real accounts
      const existing = await pool.request()
        .input('username', sql.NVarChar, normalizedUsername)
        .query('SELECT id FROM Users WHERE username = @username');
      if (existing.recordset.length > 0) {
        return { error: 'Tên đăng nhập đã tồn tại trên hệ thống.', status: 400 };
      }
      if (normalizedEmail) {
        const dupEmail = await pool.request()
          .input('email', sql.NVarChar, normalizedEmail)
          .query('SELECT id FROM Users WHERE email = @email');
        if (dupEmail.recordset.length > 0) {
          return { error: 'Email đã được sử dụng.', status: 400 };
        }
      }
      if (normalizedPhone) {
        const dupPhone = await pool.request()
          .input('phone', sql.NVarChar, normalizedPhone)
          .query('SELECT id FROM Users WHERE phone = @phone');
        if (dupPhone.recordset.length > 0) {
          return { error: 'Số điện thoại đã được sử dụng.', status: 400 };
        }
      }

      // B. Duplicate check against active pending registrations
      const actives = await findActivePending(pool, {
        username: normalizedUsername,
        email: normalizedEmail,
        phone: normalizedPhone,
      });

      const conflicting = actives.find(p => {
        if (p.username === normalizedUsername) return true;
        if (normalizedEmail && p.email && String(p.email).toLowerCase() === normalizedEmail.toLowerCase()) return true;
        if (normalizedPhone && p.phone === normalizedPhone) return true;
        return false;
      });
      if (conflicting) {
        return {
          error: 'Thông tin đăng ký đang chờ xác thực. Vui lòng hoàn tất xác thực hoặc yêu cầu mã mới.',
          status: 409,
          pendingId: conflicting.id,
          verificationMethods: pendingReg.requiredMethods(conflicting),
        };
      }

      // C. Create pending registration (no Users row yet)
      const hashedPassword = bcrypt.hashSync(String(password), 10);
      const created = await pendingReg.createPending(pool, {
        username: normalizedUsername,
        passwordHash: hashedPassword,
        fullName: trimmedFullName,
        email: normalizedEmail,
        phone: normalizedPhone,
        idempotencyKey: idempotencyKey ? String(idempotencyKey) : null,
      });
      return { created };
    });

    if (result.error) {
      const payload = { success: false, error: result.error };
      if (result.pendingId) {
        payload.requiresVerification = true;
        payload.userId = result.pendingId;
        payload.pendingId = result.pendingId;
        payload.verificationMethods = result.verificationMethods || [];
      }
      return res.status(result.status || 400).json(payload);
    }

    if (result.idempotent) {
      console.log(`[Auth] Idempotent register replay: ${result.pendingId} (${normalizedUsername})`);
      return res.status(200).json({
        success: true,
        idempotent: true,
        requiresVerification: true,
        verificationMethods: result.verificationMethods,
        userId: result.pendingId,
        pendingId: result.pendingId,
        resendAvailableAt: result.resendAvailableAt
          ? new Date(result.resendAvailableAt).toISOString()
          : new Date(Date.now() + pendingReg.RESEND_COOLDOWN_SECONDS * 1000).toISOString(),
        message: 'Phiên đăng ký đã được tạo trước đó. Vui lòng xác thực để hoàn tất.',
      });
    }

    const { pendingId, emailOtp, phoneOtp, verificationMethods, resendAvailableAt } = result.created;
    console.log(`[Auth] Pending registration created: ${pendingId} (${normalizedUsername})`);

    // D. Deliver verification challenges. Failures here do NOT create a user
    //    (the user does not exist yet), but the response MUST reflect the
    //    real delivery state — never claim "sent" when the provider failed.
    let emailSent = null;
    try {
      if (normalizedEmail && emailOtp) {
        const emailRes = await sendVerificationEmail(normalizedEmail, emailOtp);
        emailSent = emailRes && emailRes.sent === true;
        if (!emailSent) {
          console.error(`[Auth] Initial email delivery failed: pending=${pendingId} to=${maskEmail(normalizedEmail)} reason=${(emailRes && emailRes.reason) || 'unknown'}`);
        }
      }
      if (normalizedPhone && phoneOtp) {
        sendVerificationSms(normalizedPhone, phoneOtp);
      }
    } catch (deliveryErr) {
      console.error(`[Auth] Verification delivery failed: pending=${pendingId} error=${deliveryErr.message}`);
      return res.status(201).json({
        success: true,
        requiresVerification: true,
        verificationMethods,
        userId: pendingId,
        pendingId,
        emailSent: false,
        resendAvailableAt: resendAvailableAt ? resendAvailableAt.toISOString() : null,
        deliveryWarning: 'Không thể gửi mã xác thực tự động. Vui lòng dùng chức năng gửi lại mã.',
        message: 'Đã tạo phiên đăng ký. Vui lòng xác thực email/SĐT để hoàn tất.',
      });
    }

    const responsePayload = {
      success: true,
      requiresVerification: true,
      verificationMethods,
      userId: pendingId,
      pendingId,
      resendAvailableAt: resendAvailableAt ? resendAvailableAt.toISOString() : null,
      message: 'Đã tạo phiên đăng ký. Vui lòng xác thực email/SĐT để hoàn tất.',
    };
    if (emailSent === false) {
      responsePayload.emailSent = false;
      responsePayload.deliveryWarning = 'Email xác thực chưa gửi được. Mã vẫn có hiệu lực khi gửi lại thành công — vui lòng dùng chức năng gửi lại mã sau ít phút.';
    }
    res.status(201).json(responsePayload);
  } catch (err) {
    console.error('[Auth] Error registering user:', err.message);
    res.status(500).json({ success: false, error: 'Đăng ký thất bại. Vui lòng thử lại.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/login  (Local login)
// ---------------------------------------------------------------------------
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Tên đăng nhập và mật khẩu là bắt buộc.',
      });
    }

    const normalizedUsername = username.trim().toLowerCase();
    const pool = getPool();

    const result = await pool.request()
      .input('username', sql.NVarChar, normalizedUsername)
      .query('SELECT id, username, password, fullName, email, phone, emailVerified, phoneVerified, avatar, provider, role FROM Users WHERE username = @username AND provider = \'local\'');

    if (result.recordset.length === 0) {
      // No real account — but a pending registration may exist. If the
      // password matches the pending hash, guide the user back to
      // verification instead of creating any session.
      try {
        const pendingRes = await pool.request()
          .input('username', sql.NVarChar, normalizedUsername)
          .query(`SELECT * FROM PendingRegistrations WHERE username = @username AND status = 'pending' AND expiresAt > GETUTCDATE()`);
        const pending = pendingRes.recordset[0];
        if (pending && pending.passwordHash && pending.passwordHash.startsWith('$2')
            && bcrypt.compareSync(String(password), pending.passwordHash)) {
          return res.status(403).json({
            success: false,
            requiresVerification: true,
            requiresRegistration: true,
            verificationMethods: pendingReg.requiredMethods(pending),
            userId: pending.id,
            pendingId: pending.id,
            error: 'Tài khoản chưa hoàn tất xác thực đăng ký. Vui lòng xác thực email/SĐT.',
          });
        }
      } catch (_) { /* fall through to generic 401 */ }
      return res.status(401).json({
        success: false,
        error: 'Tên đăng nhập hoặc mật khẩu không đúng.',
      });
    }

    const user = result.recordset[0];
    if (!user.password || !user.password.startsWith('$2')) {
      // No valid bcrypt hash found — account may have been created without a password
      return res.status(401).json({
        success: false,
        error: 'Tên đăng nhập hoặc mật khẩu không đúng.',
      });
    }
    const passwordOk = bcrypt.compareSync(password, user.password);
    if (!passwordOk) {
      return res.status(401).json({
        success: false,
        error: 'Tên đăng nhập hoặc mật khẩu không đúng.',
      });
    }

    // Check verification status (system admin bypasses the gate)
    const isSystemAdmin = user.role === 'admin';
    const hasEmail = !!user.email;
    const hasPhone = !!user.phone;
    const emailOk = !hasEmail || user.emailVerified;
    const phoneOk = !hasPhone || user.phoneVerified;
    const isVerified = emailOk && phoneOk;

    if (!isVerified && !isSystemAdmin) {
      const needs = [];
      if (hasEmail && !user.emailVerified) needs.push('email');
      if (hasPhone && !user.phoneVerified) needs.push('phone');
      return res.status(403).json({
        success: false,
        requiresVerification: true,
        verificationMethods: needs,
        userId: user.id,
        error: 'Tài khoản chưa được xác thực. Vui lòng xác thực ' + needs.join(' và ') + '.',
      });
    }

    console.log(`[Auth] User logged in: ${user.username} (Role: ${user.role})`);

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        email: user.email,
        avatar: user.avatar,
        role: user.role,
        provider: user.provider,
      },
      token: signToken(user),
      message: 'Đăng nhập thành công!',
    });
  } catch (err) {
    console.error('[Auth] Error logging in user:', err.message);
    res.status(500).json({ success: false, error: 'Đăng nhập thất bại. Vui lòng thử lại.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/social  (Google / Facebook login)
// Google: verifies the id_token server-side. Facebook: client-provided profile.
// ---------------------------------------------------------------------------
router.post('/social', async (req, res) => {
  try {
    const { provider, providerId, idToken, email, fullName, avatar } = req.body;

    if (!provider || !['google', 'facebook'].includes(provider)) {
      return res.status(400).json({
        success: false,
        error: 'Provider không hợp lệ. Chỉ hỗ trợ google hoặc facebook.',
      });
    }

    let socialProfile = null;

    if (provider === 'google') {
      // Server-side verification of the Google ID Token
      const clientId = process.env.GOOGLE_CLIENT_ID;
      if (!idToken) {
        return res.status(400).json({ success: false, error: 'Thiếu id_token từ Google.' });
      }
      try {
        socialProfile = await verifyGoogleIdToken(idToken, clientId);
      } catch (verifyErr) {
        console.error('[Auth] Google token verification failed:', verifyErr.message);
        return res.status(401).json({ success: false, error: 'ID token của Google không hợp lệ hoặc đã hết hạn.' });
      }
    } else {
      // Facebook — profile provided by the client (full FB SDK flow later)
      if (!providerId || !fullName) {
        return res.status(400).json({ success: false, error: 'Thiếu thông tin đăng nhập Facebook.' });
      }
      socialProfile = { providerId, email, fullName, avatar };
    }

    const pool = getPool();

    // Check if this social account already exists
    const existing = await pool.request()
      .input('provider', sql.NVarChar, provider)
      .input('providerId', sql.NVarChar, socialProfile.providerId)
      .query('SELECT id, username, fullName, email, avatar, provider, role FROM Users WHERE provider = @provider AND providerId = @providerId');

    let user;

    if (existing.recordset.length > 0) {
      // Existing social user — update their info (name, avatar may change)
      user = existing.recordset[0];
      await pool.request()
        .input('id', sql.NVarChar, user.id)
        .input('fullName', sql.NVarChar, socialProfile.fullName)
        .input('avatar', sql.NVarChar, socialProfile.avatar || null)
        .input('email', sql.NVarChar, socialProfile.email || null)
        .query('UPDATE Users SET fullName = @fullName, avatar = @avatar, email = @email WHERE id = @id');

      user.fullName = socialProfile.fullName;
      user.avatar = socialProfile.avatar;
      user.email = socialProfile.email;

      console.log(`[Auth] Social login (returning user): ${provider} — ${socialProfile.fullName}`);
    } else {
      // New social user — create account
      const newId = 'u-' + Date.now();
      const username = `${provider}_${socialProfile.providerId.slice(0, 10)}`;

      await pool.request()
        .input('id', sql.NVarChar, newId)
        .input('username', sql.NVarChar, username)
        .input('fullName', sql.NVarChar, socialProfile.fullName)
        .input('email', sql.NVarChar, socialProfile.email || null)
        .input('avatar', sql.NVarChar, socialProfile.avatar || null)
        .input('provider', sql.NVarChar, provider)
        .input('providerId', sql.NVarChar, socialProfile.providerId)
        .input('role', sql.NVarChar, 'user')
        .query(`
          INSERT INTO Users (id, username, fullName, email, avatar, provider, providerId, role)
          VALUES (@id, @username, @fullName, @email, @avatar, @provider, @providerId, @role)
        `);

      user = {
        id: newId,
        username,
        fullName: socialProfile.fullName,
        email: socialProfile.email,
        avatar: socialProfile.avatar,
        provider,
        role: 'user',
      };

      console.log(`[Auth] Social login (new user): ${provider} — ${socialProfile.fullName}`);
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        email: user.email,
        avatar: user.avatar,
        role: user.role,
        provider: user.provider || provider,
      },
      token: signToken(user),
      message: 'Đăng nhập thành công!',
    });
  } catch (err) {
    console.error('[Auth] Social login error:', err.message);
    res.status(500).json({ success: false, error: 'Đăng nhập mạng xã hội thất bại.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/send-verification  (Resend OTP)
// ---------------------------------------------------------------------------
router.post('/send-verification', async (req, res) => {
  try {
    const { userId, type } = req.body;

    if (!userId || !type) {
      return res.status(400).json({ success: false, error: 'Thiếu userId hoặc type.' });
    }

    if (!['email', 'phone'].includes(type)) {
      return res.status(400).json({ success: false, error: 'Type phải là email hoặc phone.' });
    }

    const pool = getPool();

    // New flow first: pending registration
    const pendingRes = await pool.request()
      .input('id', sql.NVarChar, userId)
      .query('SELECT id, email, phone FROM PendingRegistrations WHERE id = @id AND status = \'pending\'');
    if (pendingRes.recordset.length > 0) {
      const pending = pendingRes.recordset[0];
      if (type === 'email' && !pending.email) {
        return res.status(400).json({ success: false, error: 'Phiên đăng ký không có email.' });
      }
      if (type === 'phone' && !pending.phone) {
        return res.status(400).json({ success: false, error: 'Phiên đăng ký không có số điện thoại.' });
      }
      const renewed = await pendingReg.resendPendingOtp(pool, userId, type);
      if (!renewed.ok) {
        // Cooldown rejections must NOT reset the window and must tell the
        // client how long to wait. Rejected requests change nothing.
        if (renewed.cooldown) {
          return res.status(429).json({
            success: false,
            error: renewed.error,
            retryAfterSeconds: renewed.retryAfterSeconds,
          });
        }
        return res.status(400).json({ success: false, error: renewed.error });
      }
      if (type === 'email') {
        let emailSent = null;
        try {
          const emailRes = await sendVerificationEmail(pending.email, renewed.code);
          emailSent = emailRes && emailRes.sent === true;
        } catch (sendErr) {
          console.error(`[Auth] Resend email delivery failed: pending=${userId} to=${maskEmail(pending.email)} error=${sendErr.message}`);
          return res.json({
            success: true,
            emailSent: false,
            resendAvailableAt: renewed.resendAvailableAt ? renewed.resendAvailableAt.toISOString() : null,
            deliveryWarning: 'Mã mới đã được tạo nhưng email chưa gửi được. Vui lòng thử gửi lại sau khi hết cooldown.',
          });
        }
        if (!emailSent) {
          console.error(`[Auth] Resend email delivery failed: pending=${userId} to=${maskEmail(pending.email)} reason=smtp`);
          return res.json({
            success: true,
            emailSent: false,
            resendAvailableAt: renewed.resendAvailableAt ? renewed.resendAvailableAt.toISOString() : null,
            deliveryWarning: 'Mã mới đã được tạo nhưng email chưa gửi được. Vui lòng thử gửi lại sau khi hết cooldown.',
          });
        }
        return res.json({
          success: true,
          emailSent: true,
          resendAvailableAt: renewed.resendAvailableAt ? renewed.resendAvailableAt.toISOString() : null,
          message: 'Đã gửi mã xác thực qua email.',
        });
      }
      sendVerificationSms(pending.phone, renewed.code);
      return res.json({
        success: true,
        resendAvailableAt: renewed.resendAvailableAt ? renewed.resendAvailableAt.toISOString() : null,
        message: 'Đã gửi mã xác thực qua SĐT.',
      });
    }

    // Legacy fallback: Users row
    const userResult = await pool.request()
      .input('id', sql.NVarChar, userId)
      .query('SELECT id, email, phone FROM Users WHERE id = @id');

    if (userResult.recordset.length === 0) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản.' });
    }

    const user = userResult.recordset[0];

    if (type === 'email' && !user.email) {
      return res.status(400).json({ success: false, error: 'Tài khoản không có email.' });
    }
    if (type === 'phone' && !user.phone) {
      return res.status(400).json({ success: false, error: 'Tài khoản không có số điện thoại.' });
    }

    const otp = await createVerificationCode(userId, type);

    if (type === 'email') {
      await sendVerificationEmail(user.email, otp.code);
    } else {
      sendVerificationSms(user.phone, otp.code);
    }

    res.json({ success: true, message: `Đã gửi mã xác thực qua ${type === 'email' ? 'email' : 'SĐT'}.` });
  } catch (err) {
    console.error('[Auth] Error sending verification:', err.message);
    res.status(500).json({ success: false, error: 'Không thể gửi mã xác thực.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/verify  (Verify OTP)
// Accepts a PendingRegistrations id (new flow) or a legacy Users id.
// For pending registrations, the final channel atomically creates the
// real Users row — nothing is created before both channels verify.
// ---------------------------------------------------------------------------
router.post('/verify', async (req, res) => {
  try {
    const { userId, type, code } = req.body;

    if (!userId || !type || !code) {
      return res.status(400).json({ success: false, error: 'Thiếu userId, type hoặc code.' });
    }

    if (!['email', 'phone'].includes(type)) {
      return res.status(400).json({ success: false, error: 'Type phải là email hoặc phone.' });
    }

    const pool = getPool();

    // New flow first: pending registration
    const pendingRes = await pool.request()
      .input('id', sql.NVarChar, userId)
      .query('SELECT id FROM PendingRegistrations WHERE id = @id');
    if (pendingRes.recordset.length > 0) {
      const out = await pendingReg.verifyPendingOtp(pool, userId, type, code);
      if (!out.valid) {
        const status = out.locked ? 429 : 400;
        return res.status(status).json({ success: false, error: out.error });
      }
      if (out.completed) {
        console.log(`[Auth] Pending ${userId} completed -> user ${out.userId}`);
        return res.json({
          success: true,
          allVerified: true,
          completed: true,
          userId: out.userId,
          message: 'Đăng ký thành công! Bạn có thể đăng nhập.',
        });
      }
      if (out.alreadyVerified) {
        return res.json({ success: true, allVerified: out.allVerified === true, message: 'Phương thức này đã được xác thực.' });
      }
      console.log(`[Auth] Pending ${userId} verified ${type} (partial)`);
      return res.json({
        success: true,
        allVerified: false,
        message: `Đã xác thực ${type === 'email' ? 'email' : 'SĐT'} thành công. Vui lòng hoàn thành phần còn lại.`,
      });
    }

    // Legacy fallback: unverified Users rows created before verify-before-create
    const userResult = await pool.request()
      .input('id', sql.NVarChar, userId)
      .query('SELECT id, email, phone, emailVerified, phoneVerified FROM Users WHERE id = @id');

    if (userResult.recordset.length === 0) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản.' });
    }

    const user = userResult.recordset[0];

    // Check if already verified
    if (type === 'email' && user.emailVerified) {
      return res.json({ success: true, message: 'Email đã được xác thực.' });
    }
    if (type === 'phone' && user.phoneVerified) {
      return res.json({ success: true, message: 'SĐT đã được xác thực.' });
    }

    const result = await verifyCode(userId, type, code);
    if (!result.valid) {
      return res.status(400).json({ success: false, error: result.error });
    }

    // Mark as verified
    const column = type === 'email' ? 'emailVerified' : 'phoneVerified';
    await pool.request()
      .input('id', sql.NVarChar, userId)
      .query(`UPDATE Users SET ${column} = 1 WHERE id = @id`);

    // Check if all required verifications are done
    const updated = await pool.request()
      .input('id', sql.NVarChar, userId)
      .query('SELECT email, phone, emailVerified, phoneVerified FROM Users WHERE id = @id');
    const u = updated.recordset[0];
    const hasEmail = !!u.email;
    const hasPhone = !!u.phone;
    const allVerified = (!hasEmail || u.emailVerified) && (!hasPhone || u.phoneVerified);

    console.log(`[Auth] User ${userId} verified ${type}`);

    res.json({
      success: true,
      allVerified,
      message: `Đã xác thực ${type === 'email' ? 'email' : 'SĐT'} thành công.`,
    });
  } catch (err) {
    console.error('[Auth] Error verifying code:', err.message);
    res.status(500).json({ success: false, error: 'Xác thực thất bại.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/auth/me  (Check current session)
// ---------------------------------------------------------------------------
router.get('/me', authenticate, async (req, res) => {
  try {
    const pool = getPool();
    const creditResult = await pool.request()
      .input('userId', sql.NVarChar, req.user.id)
      .query(`
        SELECT a.userId, a.displayPlanId, a.highestPlanRank, a.highCredits, a.bonusLowCredits,
               a.dailyFreeLowCreditsUsed, a.dailyFreeResetDate,
               p.name AS planName, p.dailyFreeLowCredits AS planDailyFree,
               p.outputQuality AS planQuality
        FROM UserAiAccounts a
        LEFT JOIN AiPlans p ON p.id = a.displayPlanId
        WHERE a.userId = @userId
      `);

    let credits = null;
    if (creditResult.recordset.length > 0) {
      const c = creditResult.recordset[0];
      const dailyFreeLimit = Number(c.planDailyFree) || 0;
      const dailyFreeUsed = Number(c.dailyFreeLowCreditsUsed) || 0;
      credits = {
        planId: c.displayPlanId,
        planName: c.planName || 'Free',
        planQuality: c.planQuality || 'low',
        highCredits: Number(c.highCredits) || 0,
        lowCredits: Number(c.bonusLowCredits) || 0,
        dailyFreeLimit,
        dailyFreeUsed,
        dailyFreeResetDate: c.dailyFreeResetDate,
        // Số lượt tạo còn lại theo từng loại (daily reset theo ngày);
        // total = mọi lượt khả dụng hôm nay (daily → low → high).
        remainingDaily: Math.max(0, dailyFreeLimit - dailyFreeUsed),
        remainingLow: Number(c.bonusLowCredits) || 0,
        remainingHigh: Number(c.highCredits) || 0,
        remainingTotal: Math.max(0, dailyFreeLimit - dailyFreeUsed) + (Number(c.bonusLowCredits) || 0) + (Number(c.highCredits) || 0),
      };
    }

    res.json({
      success: true,
      user: {
        id: req.user.id,
        username: req.user.username,
        fullName: req.user.fullName,
        email: req.user.email,
        avatar: req.user.avatar,
        role: req.user.role,
        provider: req.user.provider,
      },
      credits,
    });
  } catch (err) {
    console.error('[Auth] /me error:', err.message);
    res.status(500).json({ success: false, error: 'Không thể tải thông tin tài khoản.' });
  }
});

// GET /api/auth/me/credits-ledger — lịch sử credit của chính người dùng
router.get('/me/credits-ledger', authenticate, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request()
      .input('userId', sql.NVarChar, req.user.id)
      .query(`
        SELECT TOP 50 id, creditType, quality, amount, balanceAfter, reason, note, createdAt
        FROM AiCreditLedger
        WHERE userId = @userId
        ORDER BY createdAt DESC
      `);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    console.error('[Auth] credits-ledger error:', err.message);
    res.status(500).json({ success: false, error: 'Không thể tải lịch sử credit.' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/auth/me  (Update profile and/or password)
// ---------------------------------------------------------------------------
router.patch('/me', authenticate, async (req, res) => {
  try {
    const { username, fullName, email, currentPassword, newPassword } = req.body;
    const pool = getPool();

    // Load full current record (includes password hash)
    const current = await pool.request()
      .input('id', sql.NVarChar, req.user.id)
      .query('SELECT id, username, fullName, email, avatar, provider, role, password, createdAt FROM Users WHERE id = @id');
    if (current.recordset.length === 0) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản.' });
    }
    const dbUser = current.recordset[0];

    // Username uniqueness (only when changed)
    const newUsername = (username && username.trim()) || dbUser.username;
    if (newUsername !== dbUser.username) {
      const exists = await pool.request()
        .input('username', sql.NVarChar, newUsername)
        .input('id', sql.NVarChar, req.user.id)
        .query('SELECT id FROM Users WHERE username = @username AND id <> @id');
      if (exists.recordset.length > 0) {
        return res.status(400).json({ success: false, error: 'Tên đăng nhập đã được sử dụng.' });
      }
    }

    // Full name is required
    const newFullName = (fullName && fullName.trim()) || dbUser.fullName;
    if (!newFullName) {
      return res.status(400).json({ success: false, error: 'Họ và tên là bắt buộc.' });
    }

    const newEmail = (email && email.trim()) || dbUser.email || null;

    // Password change (only when newPassword is provided)
    let finalPassword = dbUser.password;
    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ success: false, error: 'Vui lòng nhập mật khẩu hiện tại.' });
      }
      if (String(newPassword).length < 6) {
        return res.status(400).json({ success: false, error: 'Mật khẩu mới cần ít nhất 6 ký tự.' });
      }
      const stored = dbUser.password || '';
      const passwordOk = stored === currentPassword || (stored.startsWith('$2') && bcrypt.compareSync(currentPassword, stored));
      if (!passwordOk) {
        return res.status(400).json({ success: false, error: 'Mật khẩu hiện tại không đúng.' });
      }
      finalPassword = bcrypt.hashSync(String(newPassword), 10);
    }

    await pool.request()
      .input('id', sql.NVarChar, req.user.id)
      .input('username', sql.NVarChar, newUsername)
      .input('fullName', sql.NVarChar, newFullName)
      .input('email', sql.NVarChar, newEmail)
      .input('password', sql.NVarChar, finalPassword)
      .query('UPDATE Users SET username = @username, fullName = @fullName, email = @email, password = @password WHERE id = @id');

    res.json({
      success: true,
      user: {
        id: req.user.id,
        username: newUsername,
        fullName: newFullName,
        email: newEmail,
        avatar: dbUser.avatar,
        role: dbUser.role,
        provider: dbUser.provider,
        createdAt: dbUser.createdAt,
      },
    });
  } catch (err) {
    console.error('[Auth] PATCH /me error:', err.message);
    res.status(500).json({ success: false, error: 'Cập nhật thất bại.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/forgot-password — Request password reset OTP via email
// Always returns the same response regardless of whether the account exists
// (prevents account enumeration).
// ---------------------------------------------------------------------------
router.post('/forgot-password', async (req, res) => {
  try {
    const { identifier } = req.body;

    if (!identifier || !String(identifier).trim()) {
      return res.status(400).json({ success: false, error: 'Vui lòng nhập email hoặc tên đăng nhập.' });
    }

    const normalizedIdentifier = String(identifier).trim().toLowerCase();
    const pool = getPool();

    // Look up user by email OR username (case-insensitive)
    const userResult = await pool.request()
      .input('identifier', sql.NVarChar, normalizedIdentifier)
      .query('SELECT id, username, email FROM Users WHERE (LOWER(email) = @identifier OR LOWER(username) = @identifier) AND provider = \'local\'');

    // Always return the same generic message — never reveal account existence
    const GENERIC_MESSAGE = 'Nếu tài khoản tồn tại, mã xác thực đã được gửi đến email của bạn.';

    if (userResult.recordset.length === 0) {
      console.log(`[Auth] Forgot password requested for non-existent account: ${normalizedIdentifier}`);
      return res.json({ success: true, message: GENERIC_MESSAGE });
    }

    const user = userResult.recordset[0];

    // Check if user has an email to send to
    if (!user.email) {
      console.log(`[Auth] Forgot password for user without email: ${user.username}`);
      return res.json({ success: true, message: GENERIC_MESSAGE });
    }

    // Generate OTP for password reset
    const otp = await createVerificationCode(user.id, 'password_reset');

    // Send OTP email
    const emailResult = await sendMail({
      to: user.email,
      subject: '[Blankup] Mã xác thực đặt lại mật khẩu',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;">
          <h2 style="color:#b43e12;">Đặt lại mật khẩu Blankup</h2>
          <p>Xin chào <strong>${user.username}</strong>,</p>
          <p>Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn.</p>
          <p>Mã xác thực của bạn là:</p>
          <div style="font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center;padding:20px;background:#f6f3ec;border-radius:12px;margin:20px 0;color:#1a1a2e;">${otp.code}</div>
          <p style="color:#64748b;font-size:0.9rem;">Mã này hết hạn sau <strong>${OTP_EXPIRY_MINUTES} phút</strong>.</p>
          <p style="color:#64748b;font-size:0.9rem;">Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này. Mật khẩu hiện tại của bạn vẫn được giữ nguyên.</p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
          <p style="color:#94a3b8;font-size:0.8rem;">Email này được gửi từ Blankup. Nếu bạn có thắc mắc, vui lòng liên hệ hỗ trợ.</p>
        </div>
      `,
      text: `Mã xác thực đặt lại mật khẩu Blankup: ${otp.code}. Hết hạn sau ${OTP_EXPIRY_MINUTES} phút.`,
    });

    if (emailResult.sent) {
      console.log(`[Auth] Forgot password OTP sent to: ${user.email} (User: ${user.username})`);
    } else {
      console.warn(`[Auth] Forgot password OTP could not be sent (SMTP not configured): ${user.email}`);
    }

    res.json({ success: true, message: GENERIC_MESSAGE });
  } catch (err) {
    console.error('[Auth] Forgot password error:', err.message);
    res.json({ success: true, message: 'Nếu tài khoản tồn tại, mã xác thực đã được gửi đến email của bạn.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/verify-forgot-otp — Verify OTP for password reset
// Returns a short-lived reset authorization token on success.
// ---------------------------------------------------------------------------
router.post('/verify-forgot-otp', async (req, res) => {
  try {
    const { identifier, code } = req.body;

    if (!identifier || !code) {
      return res.status(400).json({ success: false, error: 'Thiếu thông tin xác thực.' });
    }

    const normalizedIdentifier = String(identifier).trim().toLowerCase();
    const pool = getPool();

    // Look up user
    const userResult = await pool.request()
      .input('identifier', sql.NVarChar, normalizedIdentifier)
      .query('SELECT id, username, email FROM Users WHERE (LOWER(email) = @identifier OR LOWER(username) = @identifier) AND provider = \'local\'');

    if (userResult.recordset.length === 0) {
      // Don't reveal account existence — use generic error
      return res.status(400).json({ success: false, error: 'Mã xác thực không đúng.' });
    }

    const user = userResult.recordset[0];

    // Verify OTP
    const result = await verifyCode(user.id, 'password_reset', code);
    if (!result.valid) {
      return res.status(400).json({ success: false, error: result.error });
    }

    // OTP verified — generate reset authorization token
    const { rawToken, expiresAt } = await generateResetAuthToken(user.id);

    console.log(`[Auth] Forgot password OTP verified for user: ${user.username}`);

    res.json({
      success: true,
      resetToken: rawToken,
      expiresAt: expiresAt.toISOString(),
      message: 'Xác thực thành công. Vui lòng nhập mật khẩu mới.',
    });
  } catch (err) {
    console.error('[Auth] Verify forgot OTP error:', err.message);
    res.status(500).json({ success: false, error: 'Xác thực thất bại. Vui lòng thử lại.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/reset-password — Reset password using authorization token
// Token is obtained after verifying OTP via /verify-forgot-otp.
// Mutex-protected: concurrent requests with same token → only 1 succeeds.
// ---------------------------------------------------------------------------
router.post('/reset-password', async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body;

    if (!resetToken || !newPassword) {
      return res.status(400).json({ success: false, error: 'Thiếu token hoặc mật khẩu mới.' });
    }

    // Password policy: minimum 8 characters
    if (String(newPassword).length < 8) {
      return res.status(400).json({ success: false, error: 'Mật khẩu mới cần ít nhất 8 ký tự.' });
    }

    // Mutex-protected: prevent concurrent reset with same token
    const result = await withResetLock(resetToken, async () => {
      // Validate reset authorization token
      const tokenResult = await validateResetAuthToken(resetToken);
      if (!tokenResult.valid) {
        return { success: false, error: tokenResult.error };
      }

      // Hash new password and update
      const hashedPassword = bcrypt.hashSync(String(newPassword), 10);
      const pool = getPool();

      await pool.request()
        .input('userId', sql.NVarChar, tokenResult.userId)
        .input('password', sql.NVarChar, hashedPassword)
        .query('UPDATE Users SET password = @password, updatedAt = GETDATE() WHERE id = @userId');

      console.log(`[Auth] Password reset successful for user: ${tokenResult.userId}`);
      return { success: true };
    });

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    res.json({
      success: true,
      message: 'Đặt lại mật khẩu thành công! Bạn có thể đăng nhập bằng mật khẩu mới.',
    });
  } catch (err) {
    console.error('[Auth] Reset password error:', err.message);
    res.status(500).json({ success: false, error: 'Đặt lại mật khẩu thất bại. Vui lòng thử lại.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/auth/facebook — Redirect to Facebook OAuth dialog
// ---------------------------------------------------------------------------
router.get('/facebook', (req, res) => {
  try {
    if (!isFacebookEnabled()) {
      return res.status(503).send(renderFacebookErrorHtml('Đăng nhập Facebook chưa được cấu hình.', '/login.html'));
    }
    const { appId, graphVersion, redirectUri } = getFacebookConfig(req);
    if (!appId) {
      console.error('[Auth] Facebook App ID missing');
      return res.status(500).send(renderFacebookErrorHtml('Cấu hình Facebook chưa hoàn tất.', '/login.html'));
    }
    const redirectTo = typeof req.query.redirect === 'string' ? req.query.redirect : '';
    const safeRedirectTo = getSafeRedirectPath(redirectTo, req);
    const state = createFacebookState(safeRedirectTo);

    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'public_profile,email',
      state,
    });
    const authUrl = `https://www.facebook.com/${graphVersion}/dialog/oauth?${params.toString()}`;
    return res.redirect(authUrl);
  } catch (err) {
    console.error('[Auth] Facebook redirect error:', err.message);
    return res.status(500).send(renderFacebookErrorHtml('Không thể khởi tạo đăng nhập Facebook.', '/login.html'));
  }
});

// ---------------------------------------------------------------------------
// GET /api/auth/facebook/callback — OAuth code exchange + profile + JWT
// ---------------------------------------------------------------------------
router.get('/facebook/callback', async (req, res) => {
  try {
    if (!isFacebookEnabled()) {
      return res.status(503).send(renderFacebookErrorHtml('Đăng nhập Facebook chưa được cấu hình.', '/login.html'));
    }
    const { code, state, error, error_description } = req.query;

    // User denied
    if (error) {
      console.warn('[Auth] Facebook callback error param:', error, error_description);
      return res.status(400).send(renderFacebookErrorHtml('Bạn đã hủy đăng nhập Facebook.', '/login.html'));
    }

    if (!state || typeof state !== 'string') {
      console.warn('[Auth] Facebook callback missing state');
      return res.status(400).send(renderFacebookErrorHtml('Thiếu thông tin xác thực (state).', '/login.html'));
    }
    const stateEntry = consumeFacebookState(state);
    if (!stateEntry) {
      console.warn('[Auth] Facebook callback invalid/expired state');
      return res.status(400).send(renderFacebookErrorHtml('Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng thử lại.', '/login.html'));
    }

    if (!code || typeof code !== 'string') {
      console.warn('[Auth] Facebook callback missing code');
      return res.status(400).send(renderFacebookErrorHtml('Thiếu mã xác thực từ Facebook.', '/login.html'));
    }

    const { appId, appSecret, graphVersion, redirectUri } = getFacebookConfig(req);
    if (!appId || !appSecret) {
      console.error('[Auth] Facebook App ID/Secret missing at callback');
      return res.status(500).send(renderFacebookErrorHtml('Cấu hình Facebook chưa hoàn tất.', '/login.html'));
    }

    // Exchange code for access token
    const tokenUrl = new URL(`https://graph.facebook.com/${graphVersion}/oauth/access_token`);
    tokenUrl.searchParams.set('client_id', appId);
    tokenUrl.searchParams.set('client_secret', appSecret);
    tokenUrl.searchParams.set('redirect_uri', redirectUri);
    tokenUrl.searchParams.set('code', code);

    let tokenData;
    try {
      const tokenRes = await fetch(tokenUrl.toString());
      const text = await tokenRes.text();
      try { tokenData = JSON.parse(text); } catch { tokenData = null; }
      if (!tokenRes.ok || !tokenData || tokenData.error) {
        const msg = tokenData?.error?.message || text || `Token exchange failed: ${tokenRes.status}`;
        console.warn('[Auth] Facebook token exchange failed:', tokenRes.status, msg.slice(0,200));
        return res.status(400).send(renderFacebookErrorHtml('Không thể xác thực với Facebook. Vui lòng thử lại.', '/login.html'));
      }
    } catch (fetchErr) {
      console.error('[Auth] Facebook token fetch error:', fetchErr.message);
      return res.status(502).send(renderFacebookErrorHtml('Không thể kết nối tới Facebook. Vui lòng thử lại.', '/login.html'));
    }

    const accessToken = tokenData.access_token;
    if (!accessToken) {
      console.warn('[Auth] Facebook token missing access_token');
      return res.status(400).send(renderFacebookErrorHtml('Không thể xác thực với Facebook.', '/login.html'));
    }

    // Fetch verified profile
    const profileUrl = new URL(`https://graph.facebook.com/${graphVersion}/me`);
    profileUrl.searchParams.set('fields', 'id,name,email,picture.width(256)');
    profileUrl.searchParams.set('access_token', accessToken);

    let profile;
    try {
      const profileRes = await fetch(profileUrl.toString());
      const text = await profileRes.text();
      try { profile = JSON.parse(text); } catch { profile = null; }
      if (!profileRes.ok || !profile || profile.error) {
        const msg = profile?.error?.message || text || `Profile fetch failed: ${profileRes.status}`;
        console.warn('[Auth] Facebook profile fetch failed:', profileRes.status, msg.slice(0,200));
        return res.status(400).send(renderFacebookErrorHtml('Không thể lấy thông tin Facebook.', '/login.html'));
      }
    } catch (fetchErr) {
      console.error('[Auth] Facebook profile fetch error:', fetchErr.message);
      return res.status(502).send(renderFacebookErrorHtml('Không thể lấy thông tin Facebook.', '/login.html'));
    }

    if (!profile.id) {
      console.warn('[Auth] Facebook profile missing id');
      return res.status(400).send(renderFacebookErrorHtml('Không thể xác thực tài khoản Facebook.', '/login.html'));
    }

    const providerId = String(profile.id);
    const fullName = String(profile.name || 'Facebook User');
    const email = profile.email ? String(profile.email) : null;
    const avatar = profile.picture?.data?.url ? String(profile.picture.data.url) : null;

    // Find or create user by provider + providerId
    const pool = getPool();
    const existing = await pool.request()
      .input('provider', sql.NVarChar, 'facebook')
      .input('providerId', sql.NVarChar, providerId)
      .query('SELECT id, username, fullName, email, avatar, provider, role FROM Users WHERE provider = @provider AND providerId = @providerId');

    let user;
    if (existing.recordset.length > 0) {
      user = existing.recordset[0];
      await pool.request()
        .input('id', sql.NVarChar, user.id)
        .input('fullName', sql.NVarChar, fullName)
        .input('avatar', sql.NVarChar, avatar || null)
        .input('email', sql.NVarChar, email || null)
        .query('UPDATE Users SET fullName = @fullName, avatar = @avatar, email = @email WHERE id = @id');
      user.fullName = fullName;
      user.avatar = avatar;
      user.email = email;
      console.log(`[Auth] Facebook login (returning user): ${fullName} (${providerId})`);
    } else {
      const newId = 'u-' + Date.now();
      const username = `facebook_${providerId.slice(0, 10)}`;
      await pool.request()
        .input('id', sql.NVarChar, newId)
        .input('username', sql.NVarChar, username)
        .input('fullName', sql.NVarChar, fullName)
        .input('email', sql.NVarChar, email || null)
        .input('avatar', sql.NVarChar, avatar || null)
        .input('provider', sql.NVarChar, 'facebook')
        .input('providerId', sql.NVarChar, providerId)
        .input('role', sql.NVarChar, 'user')
        .query(`
          INSERT INTO Users (id, username, fullName, email, avatar, provider, providerId, role)
          VALUES (@id, @username, @fullName, @email, @avatar, @provider, @providerId, @role)
        `);
      user = { id: newId, username, fullName, email, avatar, provider: 'facebook', role: 'user' };
      console.log(`[Auth] Facebook login (new user): ${fullName} (${providerId})`);
    }

    const token = signToken(user);
    const redirectTo = getSafeRedirectPath(stateEntry.redirectTo, req) || '/';
    // Ensure UserAiAccounts exists for credits
    try {
      await pool.request()
        .input('userId', sql.NVarChar, user.id)
        .query(`IF NOT EXISTS (SELECT 1 FROM UserAiAccounts WHERE userId = @userId) INSERT INTO UserAiAccounts (userId, displayPlanId, highestPlanRank) VALUES (@userId, N'plan-free', 0)`);
    } catch {}

    return res.send(renderFacebookSuccessHtml(token, {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      email: user.email,
      avatar: user.avatar,
      role: user.role,
      provider: user.provider,
    }, redirectTo));
  } catch (err) {
    console.error('[Auth] Facebook callback error:', err.message);
    return res.status(500).send(renderFacebookErrorHtml('Đăng nhập Facebook thất bại. Vui lòng thử lại.', '/login.html'));
  }
});

module.exports = {
  router,
  readUsers,
};
