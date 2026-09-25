// Load db.js first: it reads .env into process.env, and app.js's auth
// middleware reads JWT_SECRET at require time.
const { initDatabase } = require('./db');
const app = require('./app');

const PORT = process.env.PORT || 3000;
const frontendDir = require('path').join(__dirname, '../frontend');
const uploadsDir = require('path').join(__dirname, 'uploads');

// Non-blocking SMTP sanity check — surfaces bad credentials at startup instead
// of silently swallowing every forgot-password / verification email later.
function checkSmtpOnBoot() {
  const { isConfigured } = require('./services/mailer');
  if (!isConfigured()) {
    console.warn('[Mailer] ⚠️  SMTP not configured — verification & forgot-password emails will NOT be delivered.');
    return;
  }
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  transporter
    .verify()
    .then(() => console.log('[Mailer] ✅ SMTP ready — outgoing email configured correctly.'))
    .catch((err) => {
      console.error('[Mailer] ❌ SMTP check FAILED — emails cannot be delivered!');
      console.error(`         Reason: ${err.code || 'UNKNOWN'} — ${String(err.message).split('\n')[0]}`);
      console.error('         Fix: check SMTP_USER / SMTP_PASS in backend/.env.');
      console.error('         For Gmail: the 16-char App Password may have been revoked — generate a new one at https://myaccount.google.com/apppasswords');
    });
}

async function startServer() {
  try {
    await initDatabase();
    console.log('[DB] ✅ Database ready.\n');
    checkSmtpOnBoot();

    app.listen(PORT, () => {
      console.log(`🚀  Blankup API server running at http://localhost:${PORT}`);
      console.log(`📂  Serving frontend from ${frontendDir}`);
      console.log(`📁  Uploads directory: ${uploadsDir}\n`);
    });
  } catch (err) {
    console.error('\n❌ Failed to start server:', err.message);
    console.error('   Make sure SQL Server (SQLEXPRESS) is running and credentials are correct.\n');
    if (process.env.REQUIRE_SQL_SERVER === 'true') {
      process.exit(1);
    }

    console.warn('   Continuing in file-backed demo mode. Set REQUIRE_SQL_SERVER=true to require SQL startup.\n');
    app.listen(PORT, () => {
      console.log(`Blankup API server running at http://localhost:${PORT}`);
      console.log(`Serving frontend from ${frontendDir}`);
      console.log(`Uploads directory: ${uploadsDir}\n`);
    });
  }
}

startServer();
