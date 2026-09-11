const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const { apiLimiter, authLimiter, otpLimiter, aiLimiter } = require('./middleware/rateLimit');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const app = express();

// ---------------------------------------------------------------------------
// Security middleware
// ---------------------------------------------------------------------------
// CSP allows Google Identity Services (login.html) — everything else stays
// 'self'. Inline scripts remain blocked; page guards/config live in
// external js/ files. GIS needs script + frame + connect access.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      'default-src': ["'self'"],
      'base-uri': ["'self'"],
      'font-src': ["'self'", 'https:', 'data:'],
      'form-action': ["'self'"],
      'frame-ancestors': ["'self'"],
      'frame-src': ["'self'", 'https://accounts.google.com'],
      // img.vietqr.io serves the VietQR payment codes our own checkout builds
      // (account.js / pricing.js / studio.js). Blocking it breaks payment QR.
      'img-src': ["'self'", 'data:', 'https://img.vietqr.io'],
      'object-src': ["'none'"],
      // studio.html has exactly 2 audited inline scripts (auth entry guard +
      // three.js importmap); both are allowlisted by hash, all other inline
      // scripts stay blocked.
      'script-src': ["'self'", 'https://accounts.google.com', "'sha256-0D02wsfS+NlpLpIAaINSYArAPVInknzt55IwQNA1bu4='", "'sha256-lMdEI/ms9EMEHl64ayq+BlkKR8SpDJ7eqgoKF2Asp0k='", "'wasm-unsafe-eval'"],
      'script-src-attr': ["'none'"],
      // Three.js GLB loader (meshopt) compiles WASM and spawns blob workers.
      'worker-src': ["'self'", 'blob:'],
      'style-src': ["'self'", 'https:', "'unsafe-inline'"],
      'connect-src': ["'self'", 'blob:', 'https://accounts.google.com'],
      'upgrade-insecure-requests': [],
    },
  },
}));
app.use(compression());

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// CORS — Fail-closed in production, flexible in development
// ---------------------------------------------------------------------------
const isProduction = process.env.NODE_ENV === 'production';
const rawOrigins = process.env.ALLOWED_ORIGINS;
const allowedOrigins = rawOrigins
  ? rawOrigins.split(',').map(s => s.trim()).filter(Boolean)
  : null;

if (isProduction && (!allowedOrigins || allowedOrigins.length === 0)) {
  console.error('[CORS] FATAL: ALLOWED_ORIGINS must be set in production. Refusing to start with open CORS.');
  process.exit(1);
}

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (same-origin, mobile apps, curl)
    if (!origin) return cb(null, true);

    if (allowedOrigins) {
      // Block wildcard '*' — it must not be used with credentials
      if (allowedOrigins.includes('*')) {
        return cb(null, false);
      }
      if (allowedOrigins.includes(origin)) {
        return cb(null, true);
      }
      return cb(null, false);
    }

    // Development fallback: allow localhost origins only
    const devPatterns = [/^https?:\/\/localhost(:\d+)?$/, /^https?:\/\/127\.0\.0\.1(:\d+)?$/];
    if (devPatterns.some(p => p.test(origin))) {
      return cb(null, true);
    }
    return cb(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Idempotency-Key'],
  maxAge: 86400,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Global API rate limiter
app.use('/api/', apiLimiter);

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

// Serve uploaded files
app.use('/uploads', express.static(uploadsDir));

// Three.js vendor files
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules/three/build')));
app.use('/vendor/three/examples', express.static(path.join(__dirname, 'node_modules/three/examples')));

// Serve frontend as static files
const frontendDir = path.join(__dirname, '../frontend');
app.use(express.static(frontendDir, { etag: false, lastModified: false, maxAge: 0 }));

// ---------------------------------------------------------------------------
// API Routes
// ---------------------------------------------------------------------------

app.use('/api/products', require('./routes/products'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/contact', require('./routes/contact'));
// AI generation is costly — stricter limit (fallback to noop if mocked)
app.use('/api/ai-design/generate', aiLimiter || ((req, res, next) => next()));
app.use('/api/ai-design/generate-from-image', aiLimiter || ((req, res, next) => next()));
app.use('/api/ai-design', require('./routes/ai-design'));
app.use('/api/ai-plans', require('./routes/ai-plans'));
app.use('/api/auth/send-verification', otpLimiter);
app.use('/api/auth/verify', otpLimiter);
app.use('/api/auth/verify-forgot-otp', otpLimiter);
app.use('/api/auth/forgot-password', otpLimiter);
app.use('/api/auth/reset-password', otpLimiter);
app.use('/api/auth', authLimiter, require('./routes/auth').router);
app.use('/api/users', require('./routes/users'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/admin', require('./routes/admin-commerce'));
app.use('/api/admin', require('./routes/admin-reports'));
app.use('/api/payment', require('./routes/payment'));
app.use('/api/stats', require('./routes/stats'));
app.use('/api/assets', require('./routes/assets'));

// API 404 for unknown /api routes (before SPA fallback)
app.use('/api', notFoundHandler);

// ---------------------------------------------------------------------------
// SPA fallback (only for non-API GET)
// ---------------------------------------------------------------------------
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: 'Route not found.' });
  }
  const indexPath = path.join(frontendDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ success: false, error: 'Frontend not found.' });
  }
});

// ---------------------------------------------------------------------------
// Global error-handling middleware
// ---------------------------------------------------------------------------
app.use(errorHandler);

module.exports = app;
