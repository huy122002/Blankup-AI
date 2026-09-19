// Load db.js first: it reads .env into process.env, and app.js's auth
// middleware reads JWT_SECRET at require time.
const { initDatabase } = require('./db');
const app = require('./app');

const PORT = process.env.PORT || 3000;
const frontendDir = require('path').join(__dirname, '../frontend');
const uploadsDir = require('path').join(__dirname, 'uploads');

async function startServer() {
  try {
    await initDatabase();
    console.log('[DB] ✅ Database ready.\n');

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
