// backend/db.js
/**
 * Blankup Database Connection — SQL Server Express
 * Handles connection pooling and auto-initialization of tables.
 * Professional Edition: FK, CHECK, INDEX, SchemaVersion, unified columns.
 */

const sql = require('mssql');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

function hashSeedPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) return;

    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  });
}

loadEnvFile(path.join(__dirname, '.env'));
loadEnvFile(path.join(__dirname, '../.env'));

// ---------------------------------------------------------------------------
// Connection Configuration
// ---------------------------------------------------------------------------
const SQL_SERVER = process.env.SQL_SERVER || 'localhost';
const SQL_PORT = process.env.SQL_PORT;
const SQL_USER = process.env.SQL_USER;
const SQL_PASSWORD = process.env.SQL_PASSWORD;
const isNamedInstance = SQL_SERVER.includes('\\');
const useWindowsAuth = !SQL_USER && !SQL_PASSWORD;

const DB_CONFIG = {
  server: SQL_SERVER,
  ...(isNamedInstance
    ? {}
    : { port: Number(SQL_PORT || 1433) }),
  ...(useWindowsAuth
    ? { trustedConnection: true }
    : { user: SQL_USER, password: SQL_PASSWORD }),
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

// The working database name
const DB_NAME = process.env.SQL_DATABASE || 'BlankupDB';

let pool = null;

// ---------------------------------------------------------------------------
// Initialize: Create DB if not exists, create tables, seed admin user
// ---------------------------------------------------------------------------
async function initDatabase() {
  try {
    // 1. Connect to master first to create the database if needed
    console.log('[DB] Connecting to SQL Server (master)...');
    const masterPool = await new sql.ConnectionPool({
      ...DB_CONFIG,
      database: 'master',
    }).connect();

    // Check if BlankupDB exists
    const dbCheck = await masterPool.request().query(
      `SELECT name FROM sys.databases WHERE name = '${DB_NAME}'`
    );

    if (dbCheck.recordset.length === 0) {
      console.log(`[DB] Creating database "${DB_NAME}"...`);
      await masterPool.request().query(`CREATE DATABASE [${DB_NAME}]`);
      console.log(`[DB] Database "${DB_NAME}" created successfully.`);
    } else {
      console.log(`[DB] Database "${DB_NAME}" already exists.`);
    }

    await masterPool.close();

    // 2. Connect to BlankupDB
    console.log(`[DB] Connecting to "${DB_NAME}"...`);
    pool = await new sql.ConnectionPool({
      ...DB_CONFIG,
      database: DB_NAME,
    }).connect();

    console.log('[DB] Connected to BlankupDB successfully.');

    // 3. Create tables
    await createTables();

    // 4. Upgrade plaintext passwords to bcrypt hashes
    await migrateLegacyPasswords();

    // 5. Ensure required demo users exist
    await seedAdminUser();
    await seedAiCommerce();

    // 6. Ensure professional constraints (FK, CHECK, INDEX) — idempotent
    await ensureProfessionalConstraints();

    return pool;
  } catch (err) {
    console.error('[DB] Database initialization failed:', err.message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Create Tables (professional schema — includes all columns for new DBs)
// ---------------------------------------------------------------------------
async function createTables() {
  const request = pool.request();

  // --- SchemaVersion (migration tracking) ---
  await request.query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='SchemaVersion' AND xtype='U')
    CREATE TABLE SchemaVersion (
      version     INT            NOT NULL PRIMARY KEY,
      description NVARCHAR(200)  NOT NULL,
      appliedAt   DATETIME       NOT NULL DEFAULT GETDATE()
    )
  `);
  console.log('[DB] Table "SchemaVersion" ready.');

  // --- Users Table (professional: includes emailVerified, phone, updatedAt) ---
  await request.query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Users' AND xtype='U')
    CREATE TABLE Users (
      id                  NVARCHAR(50)   PRIMARY KEY,
      username            NVARCHAR(100)  NOT NULL UNIQUE,
      password            NVARCHAR(255)  NULL,
      fullName            NVARCHAR(200)  NOT NULL,
      email               NVARCHAR(255)  NULL,
      avatar              NVARCHAR(500)  NULL,
      provider            NVARCHAR(20)   NOT NULL DEFAULT 'local',
      providerId          NVARCHAR(255)  NULL,
      role                NVARCHAR(20)   NOT NULL DEFAULT 'user',
      emailVerified       BIT            NOT NULL DEFAULT 0,
      phone               NVARCHAR(20)   NULL,
      phoneVerified       BIT            NOT NULL DEFAULT 0,
      resetTokenHash      NVARCHAR(255)  NULL,
      resetTokenExpiresAt DATETIME       NULL,
      createdAt           DATETIME       NOT NULL DEFAULT GETDATE(),
      updatedAt           DATETIME       NULL
    )
  `);
  console.log('[DB] Table "Users" ready.');

  // --- Orders Table (professional: paymentStatus, voucher, updatedAt) ---
  await request.query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Orders' AND xtype='U')
    CREATE TABLE Orders (
      orderId         NVARCHAR(50)   PRIMARY KEY,
      designUrl       NVARCHAR(MAX)  NULL,
      productType     NVARCHAR(50)   NOT NULL,
      color           NVARCHAR(20)   DEFAULT '#ffffff',
      size            NVARCHAR(10)   NOT NULL,
      quantity        INT            NOT NULL DEFAULT 1,
      price           INT            NOT NULL DEFAULT 200000,
      customerName    NVARCHAR(200)  NOT NULL,
      customerPhone   NVARCHAR(50)   NOT NULL,
      customerAddress NVARCHAR(500)  NOT NULL,
      customerNote    NVARCHAR(500)  NULL,
      payment         NVARCHAR(20)   DEFAULT 'COD',
      paymentStatus   NVARCHAR(20)   NULL,
      status          NVARCHAR(20)   DEFAULT 'pending',
      userId          NVARCHAR(50)   NULL,
      authorName      NVARCHAR(200)  DEFAULT 'Guest',
      voucherCode     NVARCHAR(50)   NULL,
      discountAmount  INT            NOT NULL DEFAULT 0,
      finalPrice      INT            NULL,
      createdAt       DATETIME       NOT NULL DEFAULT GETDATE(),
      updatedAt       DATETIME       NULL
    )
  `);
  console.log('[DB] Table "Orders" ready.');

  // --- Designs Table (professional: userId, quality, hasWatermark, isShared) ---
  await request.query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Designs' AND xtype='U')
    CREATE TABLE Designs (
      id                NVARCHAR(50)   PRIMARY KEY,
      prompt            NVARCHAR(500)  NULL,
      promptEn          NVARCHAR(500)  NULL,
      style             NVARCHAR(50)   NULL,
      designUrl         NVARCHAR(MAX)  NULL,
      author            NVARCHAR(200)  DEFAULT 'Guest',
      likes             INT            DEFAULT 0,
      userId            NVARCHAR(50)   NULL,
      quality           NVARCHAR(20)   NOT NULL DEFAULT 'low',
      hasWatermark      BIT            NOT NULL DEFAULT 1,
      sourceCreditType  NVARCHAR(30)   NULL,
      isShared          BIT            NOT NULL DEFAULT 1,
      createdAt         DATETIME       NOT NULL DEFAULT GETDATE(),
      updatedAt         DATETIME       NULL
    )
  `);
  console.log('[DB] Table "Designs" ready.');

  // --- Migrations for existing DBs (idempotent) ---
  await request.query(`
    IF COL_LENGTH(N'Users', N'emailVerified') IS NULL
      ALTER TABLE dbo.Users ADD emailVerified BIT NOT NULL DEFAULT 0;
    IF COL_LENGTH(N'Users', N'phone') IS NULL
      ALTER TABLE dbo.Users ADD phone NVARCHAR(20) NULL;
    IF COL_LENGTH(N'Users', N'phoneVerified') IS NULL
      ALTER TABLE dbo.Users ADD phoneVerified BIT NOT NULL DEFAULT 0;
    IF COL_LENGTH(N'Users', N'resetTokenHash') IS NULL
      ALTER TABLE dbo.Users ADD resetTokenHash NVARCHAR(255) NULL;
    IF COL_LENGTH(N'Users', N'resetTokenExpiresAt') IS NULL
      ALTER TABLE dbo.Users ADD resetTokenExpiresAt DATETIME NULL;
    IF COL_LENGTH(N'Users', N'updatedAt') IS NULL
      ALTER TABLE dbo.Users ADD updatedAt DATETIME NULL;

    IF COL_LENGTH(N'Orders', N'voucherCode') IS NULL
      ALTER TABLE dbo.Orders ADD voucherCode NVARCHAR(50) NULL;
    IF COL_LENGTH(N'Orders', N'discountAmount') IS NULL
      ALTER TABLE dbo.Orders ADD discountAmount INT NOT NULL DEFAULT 0;
    IF COL_LENGTH(N'Orders', N'finalPrice') IS NULL
      ALTER TABLE dbo.Orders ADD finalPrice INT NULL;
    IF COL_LENGTH(N'Orders', N'paymentStatus') IS NULL
      ALTER TABLE dbo.Orders ADD paymentStatus NVARCHAR(20) NULL;
    IF COL_LENGTH(N'Orders', N'updatedAt') IS NULL
      ALTER TABLE dbo.Orders ADD updatedAt DATETIME NULL;

    IF COL_LENGTH(N'Designs', N'userId') IS NULL
      ALTER TABLE dbo.Designs ADD userId NVARCHAR(50) NULL;
    IF COL_LENGTH(N'Designs', N'quality') IS NULL
      ALTER TABLE dbo.Designs ADD quality NVARCHAR(20) NOT NULL DEFAULT N'low';
    IF COL_LENGTH(N'Designs', N'hasWatermark') IS NULL
      ALTER TABLE dbo.Designs ADD hasWatermark BIT NOT NULL DEFAULT 1;
    IF COL_LENGTH(N'Designs', N'sourceCreditType') IS NULL
      ALTER TABLE dbo.Designs ADD sourceCreditType NVARCHAR(30) NULL;
    IF COL_LENGTH(N'Designs', N'isShared') IS NULL
      ALTER TABLE dbo.Designs ADD isShared BIT NOT NULL DEFAULT 1;
    IF COL_LENGTH(N'Designs', N'updatedAt') IS NULL
      ALTER TABLE dbo.Designs ADD updatedAt DATETIME NULL;

    -- VerificationCodes: code must hold SHA-256 hex (64 chars); add attempts tracking
    IF COL_LENGTH(N'VerificationCodes', N'code') IS NOT NULL
      BEGIN
        DECLARE @codeLen INT = (SELECT CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'VerificationCodes' AND COLUMN_NAME = 'code');
        IF @codeLen IS NOT NULL AND @codeLen < 64
          ALTER TABLE dbo.VerificationCodes ALTER COLUMN code NVARCHAR(64) NOT NULL;
      END
    IF COL_LENGTH(N'VerificationCodes', N'attempts') IS NULL
      ALTER TABLE dbo.VerificationCodes ADD attempts INT NOT NULL DEFAULT 0;

    -- PendingRegistrations: resend cooldown tracking (server-enforced, 120s)
    IF COL_LENGTH(N'PendingRegistrations', N'lastEmailSentAt') IS NULL
      ALTER TABLE dbo.PendingRegistrations ADD lastEmailSentAt DATETIME NULL;
    IF COL_LENGTH(N'PendingRegistrations', N'lastPhoneSentAt') IS NULL
      ALTER TABLE dbo.PendingRegistrations ADD lastPhoneSentAt DATETIME NULL;
  `);

  await request.query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='AiPlans' AND xtype='U')
    CREATE TABLE AiPlans (
      id                  NVARCHAR(50)   PRIMARY KEY,
      code                NVARCHAR(50)   NOT NULL UNIQUE,
      name                NVARCHAR(100)  NOT NULL,
      description         NVARCHAR(500)  NULL,
      priceVnd            INT            NOT NULL DEFAULT 0,
      highCredits         INT            NOT NULL DEFAULT 0,
      bonusLowCredits     INT            NOT NULL DEFAULT 0,
      dailyFreeLowCredits INT            NOT NULL DEFAULT 0,
      outputQuality       NVARCHAR(20)   NOT NULL DEFAULT N'low',
      planRank            INT            NOT NULL DEFAULT 0,
      isPaid              BIT            NOT NULL DEFAULT 0,
      isComebackOffer     BIT            NOT NULL DEFAULT 0,
      comebackWindowDays  INT            NULL,
      isActive            BIT            NOT NULL DEFAULT 1,
      createdAt           DATETIME       NOT NULL DEFAULT GETDATE(),
      updatedAt           DATETIME       NULL
    );

    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='UserAiAccounts' AND xtype='U')
    CREATE TABLE UserAiAccounts (
      userId                  NVARCHAR(50)  NOT NULL PRIMARY KEY,
      displayPlanId           NVARCHAR(50)  NOT NULL DEFAULT N'plan-free',
      highestPlanRank         INT           NOT NULL DEFAULT 0,
      highCredits             INT           NOT NULL DEFAULT 0,
      bonusLowCredits         INT           NOT NULL DEFAULT 0,
      dailyFreeLowCreditsUsed INT           NOT NULL DEFAULT 0,
      dailyFreeResetDate      DATE          NOT NULL DEFAULT CONVERT(date, GETDATE()),
      comebackOfferStartedAt  DATETIME      NULL,
      comebackOfferExpiresAt  DATETIME      NULL,
      comebackOfferUsed       BIT           NOT NULL DEFAULT 0,
      firstDiscountUsed       BIT           NOT NULL DEFAULT 0,
      createdAt               DATETIME      NOT NULL DEFAULT GETDATE(),
      updatedAt               DATETIME      NULL
    );

    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='AiPlanPurchases' AND xtype='U')
    CREATE TABLE AiPlanPurchases (
      id                    NVARCHAR(50)   PRIMARY KEY,
      userId                NVARCHAR(50)   NOT NULL,
      planId                NVARCHAR(50)   NOT NULL,
      priceVnd              INT            NOT NULL,
      highCreditsAdded      INT            NOT NULL DEFAULT 0,
      lowCreditsAdded       INT            NOT NULL DEFAULT 0,
      voucherCode           NVARCHAR(50)   NULL,
      discountAmount        INT            NOT NULL DEFAULT 0,
      finalAmount           INT            NOT NULL,
      paymentStatus         NVARCHAR(30)   NOT NULL DEFAULT N'pending',
      paymentMethod         NVARCHAR(30)   NULL,
      transferContent       NVARCHAR(100)  NULL,
      paymentReceivedAmount INT            NOT NULL DEFAULT 0,
      paymentTransactionId  NVARCHAR(100)  NULL,
      paymentDescription    NVARCHAR(500)  NULL,
      paymentCheckedAt      DATETIME       NULL,
      createdAt             DATETIME       NOT NULL DEFAULT GETDATE(),
      paidAt                DATETIME       NULL
    );

    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='AiCreditLedger' AND xtype='U')
    CREATE TABLE AiCreditLedger (
      id             NVARCHAR(50)   PRIMARY KEY,
      userId         NVARCHAR(50)   NOT NULL,
      creditType     NVARCHAR(20)   NOT NULL,
      quality        NVARCHAR(20)   NOT NULL,
      amount         INT            NOT NULL,
      balanceAfter   INT            NULL,
      reason         NVARCHAR(50)   NOT NULL,
      referenceType  NVARCHAR(50)   NULL,
      referenceId    NVARCHAR(50)   NULL,
      note           NVARCHAR(500)  NULL,
      createdAt      DATETIME       NOT NULL DEFAULT GETDATE()
    );

    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Vouchers' AND xtype='U')
    CREATE TABLE Vouchers (
      id                 NVARCHAR(50)   PRIMARY KEY,
      code               NVARCHAR(50)   NOT NULL UNIQUE,
      title              NVARCHAR(200)  NOT NULL,
      description        NVARCHAR(500)  NULL,
      discountType       NVARCHAR(30)   NOT NULL,
      discountValue      INT            NOT NULL DEFAULT 0,
      maxDiscountAmount  INT            NULL,
      minOrderAmount     INT            NOT NULL DEFAULT 0,
      appliesTo          NVARCHAR(30)   NOT NULL DEFAULT N'all',
      eligiblePlanCodes  NVARCHAR(500)  NULL,
      bonusHighCredits   INT            NOT NULL DEFAULT 0,
      bonusLowCredits    INT            NOT NULL DEFAULT 0,
      totalUsageLimit    INT            NULL,
      perUserLimit       INT            NOT NULL DEFAULT 1,
      usedCount          INT            NOT NULL DEFAULT 0,
      startsAt           DATETIME       NULL,
      expiresAt          DATETIME       NULL,
      status             NVARCHAR(20)   NOT NULL DEFAULT N'active',
      createdBy          NVARCHAR(50)   NULL,
      internalNote       NVARCHAR(500)  NULL,
      createdAt          DATETIME       NOT NULL DEFAULT GETDATE(),
      updatedAt          DATETIME       NULL
    );

    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='VoucherRedemptions' AND xtype='U')
    CREATE TABLE VoucherRedemptions (
      id                NVARCHAR(50)   PRIMARY KEY,
      voucherId         NVARCHAR(50)   NOT NULL,
      voucherCode       NVARCHAR(50)   NOT NULL,
      userId            NVARCHAR(50)   NOT NULL,
      orderId           NVARCHAR(50)   NULL,
      purchaseId        NVARCHAR(50)   NULL,
      appliesTo         NVARCHAR(30)   NOT NULL,
      originalAmount    INT            NOT NULL DEFAULT 0,
      discountAmount    INT            NOT NULL DEFAULT 0,
      bonusHighCredits  INT            NOT NULL DEFAULT 0,
      bonusLowCredits   INT            NOT NULL DEFAULT 0,
      redeemedAt        DATETIME       NOT NULL DEFAULT GETDATE()
    );
  `);
  console.log('[DB] AI plans and voucher tables ready.');

  // --- VerificationCodes Table (OTP for email/phone verification) ---
  // NOTE: code stores SHA-256 hex (64 chars). attempts tracks failed tries.
  await request.query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='VerificationCodes' AND xtype='U')
    CREATE TABLE VerificationCodes (
      id          NVARCHAR(50)   PRIMARY KEY,
      userId      NVARCHAR(50)   NOT NULL,
      code        NVARCHAR(64)   NOT NULL,
      type        NVARCHAR(20)   NOT NULL,
      expiresAt   DATETIME       NOT NULL,
      used        BIT            NOT NULL DEFAULT 0,
      attempts    INT            NOT NULL DEFAULT 0,
      createdAt   DATETIME       NOT NULL DEFAULT GETDATE()
    )
  `);
  console.log('[DB] Table "VerificationCodes" ready.');

  // --- PendingRegistrations Table (verify-before-create) ---
  // Holds registration data BEFORE email+SMS verification completes.
  // A real Users row is created ONLY after both required channels verify.
  await request.query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='PendingRegistrations' AND xtype='U')
    CREATE TABLE PendingRegistrations (
      id                 NVARCHAR(50)   PRIMARY KEY,
      username           NVARCHAR(100)  NOT NULL,
      passwordHash       NVARCHAR(255)  NOT NULL,
      fullName           NVARCHAR(200)  NOT NULL,
      email              NVARCHAR(255)  NULL,
      phone              NVARCHAR(20)   NULL,
      emailVerified      BIT            NOT NULL DEFAULT 0,
      phoneVerified      BIT            NOT NULL DEFAULT 0,
      emailOtpHash       NVARCHAR(64)   NULL,
      emailOtpExpiresAt  DATETIME       NULL,
      emailOtpAttempts   INT            NOT NULL DEFAULT 0,
      phoneOtpHash       NVARCHAR(64)   NULL,
      phoneOtpExpiresAt  DATETIME       NULL,
      phoneOtpAttempts   INT            NOT NULL DEFAULT 0,
      status             NVARCHAR(20)   NOT NULL DEFAULT 'pending',
      idempotencyKey     NVARCHAR(100)  NULL,
      idempotencyHash    NVARCHAR(64)   NULL,
      lastEmailSentAt    DATETIME       NULL,
      lastPhoneSentAt    DATETIME       NULL,
      createdAt          DATETIME       NOT NULL DEFAULT GETDATE(),
      updatedAt          DATETIME       NULL,
      expiresAt          DATETIME       NOT NULL
    )
  `);
  console.log('[DB] Table "PendingRegistrations" ready.');

  await seedAiCommerce();
}

// ---------------------------------------------------------------------------
// Ensure professional constraints: CHECK, FK, INDEX (idempotent)
// ---------------------------------------------------------------------------
async function ensureProfessionalConstraints() {
  const r = pool.request();
  try {
    // CHECK constraints
    await r.query(`
      IF NOT EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_Users_role')
        ALTER TABLE dbo.Users ADD CONSTRAINT CK_Users_role CHECK (role IN (N'user', N'admin'));
      IF NOT EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_Users_provider')
        ALTER TABLE dbo.Users ADD CONSTRAINT CK_Users_provider CHECK (provider IN (N'local', N'google', N'facebook'));
      IF NOT EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_Orders_productType')
        ALTER TABLE dbo.Orders ADD CONSTRAINT CK_Orders_productType CHECK (productType IN (N'tshirt', N'oversize', N'polo', N'hoodie'));
      IF NOT EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_Orders_status')
        ALTER TABLE dbo.Orders ADD CONSTRAINT CK_Orders_status CHECK (status IN (N'pending', N'awaiting_payment', N'processing', N'shipped', N'delivered', N'completed', N'cancelled', N'payment_failed'));
      IF NOT EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_Orders_payment')
        ALTER TABLE dbo.Orders ADD CONSTRAINT CK_Orders_payment CHECK (payment IN (N'COD', N'BANK_TRANSFER', N'VNPAY'));
      IF NOT EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_Orders_quantity')
        ALTER TABLE dbo.Orders ADD CONSTRAINT CK_Orders_quantity CHECK (quantity >= 1);
      IF NOT EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_Orders_price')
        ALTER TABLE dbo.Orders ADD CONSTRAINT CK_Orders_price CHECK (price >= 0);
      IF NOT EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_Designs_quality')
        ALTER TABLE dbo.Designs ADD CONSTRAINT CK_Designs_quality CHECK (quality IN (N'low', N'high'));
      IF NOT EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_AiPlans_quality')
        ALTER TABLE dbo.AiPlans ADD CONSTRAINT CK_AiPlans_quality CHECK (outputQuality IN (N'low', N'high'));
      IF NOT EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_Vouchers_discountType')
        ALTER TABLE dbo.Vouchers ADD CONSTRAINT CK_Vouchers_discountType CHECK (discountType IN (N'fixed', N'percent'));
      IF NOT EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_Vouchers_appliesTo')
        ALTER TABLE dbo.Vouchers ADD CONSTRAINT CK_Vouchers_appliesTo CHECK (appliesTo IN (N'all', N'order', N'plan'));
      IF NOT EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_Vouchers_status')
        ALTER TABLE dbo.Vouchers ADD CONSTRAINT CK_Vouchers_status CHECK (status IN (N'active', N'disabled', N'expired'));
      IF NOT EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_AiCreditLedger_creditType')
        ALTER TABLE dbo.AiCreditLedger ADD CONSTRAINT CK_AiCreditLedger_creditType CHECK (creditType IN (N'high', N'low'));
      IF NOT EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_AiCreditLedger_quality')
        ALTER TABLE dbo.AiCreditLedger ADD CONSTRAINT CK_AiCreditLedger_quality CHECK (quality IN (N'low', N'high'));
      IF NOT EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_VerificationCodes_type')
        ALTER TABLE dbo.VerificationCodes ADD CONSTRAINT CK_VerificationCodes_type CHECK (type IN (N'email', N'phone'));
      IF NOT EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_Orders_paymentStatus')
        ALTER TABLE dbo.Orders ADD CONSTRAINT CK_Orders_paymentStatus CHECK (paymentStatus IS NULL OR paymentStatus IN (N'pending', N'paid', N'failed', N'awaiting_transfer', N'underpaid'));
      IF NOT EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_Orders_finalPrice')
        ALTER TABLE dbo.Orders ADD CONSTRAINT CK_Orders_finalPrice CHECK (finalPrice IS NULL OR finalPrice >= 0);
      IF NOT EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_Orders_discountAmount')
        ALTER TABLE dbo.Orders ADD CONSTRAINT CK_Orders_discountAmount CHECK (discountAmount >= 0);
      IF NOT EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_UserAiAccounts_highCredits')
        ALTER TABLE dbo.UserAiAccounts ADD CONSTRAINT CK_UserAiAccounts_highCredits CHECK (highCredits >= 0);
      IF NOT EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_UserAiAccounts_bonusLow')
        ALTER TABLE dbo.UserAiAccounts ADD CONSTRAINT CK_UserAiAccounts_bonusLow CHECK (bonusLowCredits >= 0);
      IF NOT EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_UserAiAccounts_dailyUsed')
        ALTER TABLE dbo.UserAiAccounts ADD CONSTRAINT CK_UserAiAccounts_dailyUsed CHECK (dailyFreeLowCreditsUsed >= 0);
      IF NOT EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_AiPlanPurchases_status')
        ALTER TABLE dbo.AiPlanPurchases ADD CONSTRAINT CK_AiPlanPurchases_status CHECK (paymentStatus IN (N'pending', N'paid', N'failed'));
      IF NOT EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_AiPlanPurchases_price')
        ALTER TABLE dbo.AiPlanPurchases ADD CONSTRAINT CK_AiPlanPurchases_price CHECK (priceVnd >= 0 AND finalAmount >= 0 AND highCreditsAdded >= 0 AND lowCreditsAdded >= 0);
      IF NOT EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_AiCreditLedger_amount')
        ALTER TABLE dbo.AiCreditLedger ADD CONSTRAINT CK_AiCreditLedger_amount CHECK (amount <> 0);
      IF NOT EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_Vouchers_amounts')
        ALTER TABLE dbo.Vouchers ADD CONSTRAINT CK_Vouchers_amounts CHECK (discountValue >= 0 AND minOrderAmount >= 0 AND bonusHighCredits >= 0 AND bonusLowCredits >= 0);
      IF NOT EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_PendingRegistrations_status')
        ALTER TABLE dbo.PendingRegistrations ADD CONSTRAINT CK_PendingRegistrations_status CHECK (status IN (N'pending', N'completed', N'expired', N'cancelled'));
    `);
    console.log('[DB] CHECK constraints ensured.');

    // Foreign keys
    await r.query(`
      IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_Orders_Users')
        ALTER TABLE dbo.Orders ADD CONSTRAINT FK_Orders_Users FOREIGN KEY (userId) REFERENCES dbo.Users(id) ON DELETE SET NULL ON UPDATE CASCADE;
      IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_Designs_Users')
        ALTER TABLE dbo.Designs ADD CONSTRAINT FK_Designs_Users FOREIGN KEY (userId) REFERENCES dbo.Users(id) ON DELETE SET NULL ON UPDATE CASCADE;
      IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_UserAiAccounts_Users')
        ALTER TABLE dbo.UserAiAccounts ADD CONSTRAINT FK_UserAiAccounts_Users FOREIGN KEY (userId) REFERENCES dbo.Users(id) ON DELETE CASCADE ON UPDATE CASCADE;
      IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_UserAiAccounts_AiPlans')
        ALTER TABLE dbo.UserAiAccounts ADD CONSTRAINT FK_UserAiAccounts_AiPlans FOREIGN KEY (displayPlanId) REFERENCES dbo.AiPlans(id) ON DELETE NO ACTION ON UPDATE CASCADE;
      IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_AiPlanPurchases_Users')
        ALTER TABLE dbo.AiPlanPurchases ADD CONSTRAINT FK_AiPlanPurchases_Users FOREIGN KEY (userId) REFERENCES dbo.Users(id) ON DELETE CASCADE ON UPDATE CASCADE;
      IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_AiPlanPurchases_AiPlans')
        ALTER TABLE dbo.AiPlanPurchases ADD CONSTRAINT FK_AiPlanPurchases_AiPlans FOREIGN KEY (planId) REFERENCES dbo.AiPlans(id) ON DELETE NO ACTION ON UPDATE CASCADE;
      IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_AiCreditLedger_Users')
        ALTER TABLE dbo.AiCreditLedger ADD CONSTRAINT FK_AiCreditLedger_Users FOREIGN KEY (userId) REFERENCES dbo.Users(id) ON DELETE CASCADE ON UPDATE CASCADE;
      IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_VoucherRedemptions_Vouchers')
        ALTER TABLE dbo.VoucherRedemptions ADD CONSTRAINT FK_VoucherRedemptions_Vouchers FOREIGN KEY (voucherId) REFERENCES dbo.Vouchers(id) ON DELETE NO ACTION ON UPDATE NO ACTION;
      IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_VoucherRedemptions_Users')
        ALTER TABLE dbo.VoucherRedemptions ADD CONSTRAINT FK_VoucherRedemptions_Users FOREIGN KEY (userId) REFERENCES dbo.Users(id) ON DELETE CASCADE ON UPDATE CASCADE;
      IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_VoucherRedemptions_Orders')
        ALTER TABLE dbo.VoucherRedemptions ADD CONSTRAINT FK_VoucherRedemptions_Orders FOREIGN KEY (orderId) REFERENCES dbo.Orders(orderId) ON DELETE NO ACTION ON UPDATE NO ACTION;
      IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_VoucherRedemptions_Purchases')
        ALTER TABLE dbo.VoucherRedemptions ADD CONSTRAINT FK_VoucherRedemptions_Purchases FOREIGN KEY (purchaseId) REFERENCES dbo.AiPlanPurchases(id) ON DELETE NO ACTION ON UPDATE NO ACTION;
      IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_VerificationCodes_Users')
        ALTER TABLE dbo.VerificationCodes ADD CONSTRAINT FK_VerificationCodes_Users FOREIGN KEY (userId) REFERENCES dbo.Users(id) ON DELETE CASCADE ON UPDATE CASCADE;
      IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_Vouchers_CreatedBy')
        ALTER TABLE dbo.Vouchers ADD CONSTRAINT FK_Vouchers_CreatedBy FOREIGN KEY (createdBy) REFERENCES dbo.Users(id) ON DELETE SET NULL ON UPDATE CASCADE;
    `);
    console.log('[DB] Foreign keys ensured.');

    // Indexes
    await r.query(`
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Users_email' AND object_id = OBJECT_ID('dbo.Users'))
        CREATE INDEX IX_Users_email ON dbo.Users(email);
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Users_provider' AND object_id = OBJECT_ID('dbo.Users'))
        CREATE INDEX IX_Users_provider ON dbo.Users(provider, providerId);
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Users_createdAt' AND object_id = OBJECT_ID('dbo.Users'))
        CREATE INDEX IX_Users_createdAt ON dbo.Users(createdAt DESC);
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Orders_userId' AND object_id = OBJECT_ID('dbo.Orders'))
        CREATE INDEX IX_Orders_userId ON dbo.Orders(userId);
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Orders_status' AND object_id = OBJECT_ID('dbo.Orders'))
        CREATE INDEX IX_Orders_status ON dbo.Orders(status);
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Orders_payment' AND object_id = OBJECT_ID('dbo.Orders'))
        CREATE INDEX IX_Orders_payment ON dbo.Orders(payment, paymentStatus);
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Orders_createdAt' AND object_id = OBJECT_ID('dbo.Orders'))
        CREATE INDEX IX_Orders_createdAt ON dbo.Orders(createdAt DESC);
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Orders_voucherCode' AND object_id = OBJECT_ID('dbo.Orders'))
        CREATE INDEX IX_Orders_voucherCode ON dbo.Orders(voucherCode) WHERE voucherCode IS NOT NULL;
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Orders_productType' AND object_id = OBJECT_ID('dbo.Orders'))
        CREATE INDEX IX_Orders_productType ON dbo.Orders(productType);
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Designs_userId' AND object_id = OBJECT_ID('dbo.Designs'))
        CREATE INDEX IX_Designs_userId ON dbo.Designs(userId);
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Designs_createdAt' AND object_id = OBJECT_ID('dbo.Designs'))
        CREATE INDEX IX_Designs_createdAt ON dbo.Designs(createdAt DESC);
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Designs_style' AND object_id = OBJECT_ID('dbo.Designs'))
        CREATE INDEX IX_Designs_style ON dbo.Designs(style);
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_AiPlanPurchases_userId' AND object_id = OBJECT_ID('dbo.AiPlanPurchases'))
        CREATE INDEX IX_AiPlanPurchases_userId ON dbo.AiPlanPurchases(userId);
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_AiPlanPurchases_planId' AND object_id = OBJECT_ID('dbo.AiPlanPurchases'))
        CREATE INDEX IX_AiPlanPurchases_planId ON dbo.AiPlanPurchases(planId);
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_AiPlanPurchases_createdAt' AND object_id = OBJECT_ID('dbo.AiPlanPurchases'))
        CREATE INDEX IX_AiPlanPurchases_createdAt ON dbo.AiPlanPurchases(createdAt DESC);
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_AiCreditLedger_userId' AND object_id = OBJECT_ID('dbo.AiCreditLedger'))
        CREATE INDEX IX_AiCreditLedger_userId ON dbo.AiCreditLedger(userId, createdAt DESC);
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_AiCreditLedger_createdAt' AND object_id = OBJECT_ID('dbo.AiCreditLedger'))
        CREATE INDEX IX_AiCreditLedger_createdAt ON dbo.AiCreditLedger(createdAt DESC);
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Vouchers_status' AND object_id = OBJECT_ID('dbo.Vouchers'))
        CREATE INDEX IX_Vouchers_status ON dbo.Vouchers(status, expiresAt);
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_VoucherRedemptions_voucherId' AND object_id = OBJECT_ID('dbo.VoucherRedemptions'))
        CREATE INDEX IX_VoucherRedemptions_voucherId ON dbo.VoucherRedemptions(voucherId);
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_VoucherRedemptions_userId' AND object_id = OBJECT_ID('dbo.VoucherRedemptions'))
        CREATE INDEX IX_VoucherRedemptions_userId ON dbo.VoucherRedemptions(userId);
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_VoucherRedemptions_orderId' AND object_id = OBJECT_ID('dbo.VoucherRedemptions'))
        CREATE INDEX IX_VoucherRedemptions_orderId ON dbo.VoucherRedemptions(orderId) WHERE orderId IS NOT NULL;
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_VerificationCodes_userId' AND object_id = OBJECT_ID('dbo.VerificationCodes'))
        CREATE INDEX IX_VerificationCodes_userId ON dbo.VerificationCodes(userId);
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_VerificationCodes_expiresAt' AND object_id = OBJECT_ID('dbo.VerificationCodes'))
        CREATE INDEX IX_VerificationCodes_expiresAt ON dbo.VerificationCodes(expiresAt) WHERE used = 0;
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_UserAiAccounts_displayPlanId' AND object_id = OBJECT_ID('dbo.UserAiAccounts'))
        CREATE INDEX IX_UserAiAccounts_displayPlanId ON dbo.UserAiAccounts(displayPlanId);
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'UX_PendingRegistrations_username' AND object_id = OBJECT_ID('dbo.PendingRegistrations'))
        CREATE UNIQUE INDEX UX_PendingRegistrations_username ON dbo.PendingRegistrations(username) WHERE status = N'pending';
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_PendingRegistrations_expiresAt' AND object_id = OBJECT_ID('dbo.PendingRegistrations'))
        CREATE INDEX IX_PendingRegistrations_expiresAt ON dbo.PendingRegistrations(expiresAt) WHERE status = N'pending';
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_PendingRegistrations_email' AND object_id = OBJECT_ID('dbo.PendingRegistrations'))
        CREATE INDEX IX_PendingRegistrations_email ON dbo.PendingRegistrations(email) WHERE email IS NOT NULL AND status = N'pending';
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_PendingRegistrations_phone' AND object_id = OBJECT_ID('dbo.PendingRegistrations'))
        CREATE INDEX IX_PendingRegistrations_phone ON dbo.PendingRegistrations(phone) WHERE phone IS NOT NULL AND status = N'pending';
    `);
    console.log('[DB] Indexes ensured.');

    // Persistent purchase idempotency (survives restart/deploy/cross-process).
    // All statements idempotent and safe to re-run. No existing data touched.
    await r.query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='PurchaseIdempotency' AND xtype='U')
        CREATE TABLE PurchaseIdempotency (
          userId      NVARCHAR(50)   NOT NULL,
          idemKey     NVARCHAR(100)  NOT NULL,
          bodyHash    NVARCHAR(64)   NOT NULL,
          responseJson NVARCHAR(MAX) NULL,
          status      NVARCHAR(20)   NOT NULL DEFAULT N'in_progress',
          createdAt   DATETIME       NOT NULL DEFAULT GETDATE(),
          updatedAt   DATETIME       NULL,
          CONSTRAINT PK_PurchaseIdempotency PRIMARY KEY (userId, idemKey)
        );
      IF COL_LENGTH(N'AiPlanPurchases', N'idempotencyKey') IS NULL
        ALTER TABLE dbo.AiPlanPurchases ADD idempotencyKey NVARCHAR(100) NULL;
    `);
    // Unique transferContent: only when no duplicates exist (never force).
    try {
      await r.query(`
        IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'UX_AiPlanPurchases_transferContent' AND object_id = OBJECT_ID('dbo.AiPlanPurchases'))
        BEGIN
          IF NOT EXISTS (SELECT transferContent FROM dbo.AiPlanPurchases WHERE transferContent IS NOT NULL GROUP BY transferContent HAVING COUNT(*) > 1)
            CREATE UNIQUE INDEX UX_AiPlanPurchases_transferContent ON dbo.AiPlanPurchases(transferContent) WHERE transferContent IS NOT NULL;
        END
      `);
    } catch (uqErr) {
      console.warn('[DB] Skipping transferContent unique index:', uqErr.message);
    }
    console.log('[DB] Purchase idempotency storage ensured.');

    // SchemaVersion
    await r.query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.SchemaVersion WHERE version = 2)
        INSERT INTO dbo.SchemaVersion (version, description) VALUES (2, N'Professional schema: FK, INDEX, CHECK, updatedAt, isShared');
      IF NOT EXISTS (SELECT 1 FROM dbo.SchemaVersion WHERE version = 3)
        INSERT INTO dbo.SchemaVersion (version, description) VALUES (3, N'Persistent purchase idempotency + transferContent uniqueness guard');
    `);
  } catch (err) {
    console.warn('[DB] ensureProfessionalConstraints warning (non-fatal):', err.message);
  }
}

async function migrateLegacyPasswords() {
  try {
    const result = await pool.request().query("SELECT id, password FROM Users WHERE password IS NOT NULL AND password NOT LIKE '$2%'");
    let migrated = 0;
    for (const user of result.recordset) {
      const hash = bcrypt.hashSync(user.password, 10);
      await pool.request()
        .input('id', sql.NVarChar, user.id)
        .input('password', sql.NVarChar, hash)
        .query('UPDATE Users SET password = @password WHERE id = @id');
      migrated += 1;
    }
    if (migrated > 0) console.log(`[DB] Migrated ${migrated} plaintext password(s) to bcrypt.`);
  } catch (err) {
    console.error('[DB] Password migration failed:', err.message);
  }
}

async function seedAiCommerce() {
  const plansCount = await pool.request().query('SELECT COUNT(*) as cnt FROM AiPlans');
  if (plansCount.recordset[0].cnt === 0) {
    await pool.request().query(`
      INSERT INTO AiPlans (
        id, code, name, description, priceVnd, highCredits, bonusLowCredits,
        dailyFreeLowCredits, outputQuality, planRank, isPaid, isComebackOffer, comebackWindowDays
      )
      VALUES
        (N'plan-free', N'free', N'Free', N'3 lượt Low miễn phí mỗi ngày, có watermark.', 0, 0, 0, 3, N'low', 0, 0, 0, NULL),
        (N'plan-comeback', N'comeback', N'Comeback Offer', N'Ưu đãi 7 ngày sau khi dùng hết Premium: 10 lượt High.', 59000, 10, 0, 0, N'high', 1, 1, 1, 7),
        (N'plan-premium', N'premium', N'Premium', N'10 lượt High, không watermark, sẵn sàng để in.', 79000, 10, 0, 0, N'high', 2, 1, 0, NULL),
        (N'plan-pro', N'pro', N'Pro', N'18 lượt High và tặng 3 lượt Low.', 129000, 18, 3, 0, N'high', 3, 1, 0, NULL),
        (N'plan-studio-plus', N'studio_plus', N'Studio Plus', N'30 lượt High và tặng 5 lượt Low cho người dùng nhiều.', 199000, 30, 5, 0, N'high', 4, 1, 0, NULL)
    `);
  }

  const voucherResult = await pool.request()
    .input('code', sql.NVarChar, 'BLANKUP50')
    .query('SELECT id FROM Vouchers WHERE code = @code');
  if (voucherResult.recordset.length === 0) {
    await pool.request().query(`
      INSERT INTO Vouchers (
        id, code, title, description, discountType, discountValue, minOrderAmount,
        appliesTo, eligiblePlanCodes, perUserLimit, startsAt, status, internalNote
      )
      VALUES (
        N'voucher-blankup50', N'BLANKUP50',
        N'Giảm 50,000đ cho giao dịch từ 100,000đ',
        N'Mã hệ thống dùng 1 lần mỗi tài khoản cho đơn/gói đủ điều kiện.',
        N'fixed', 50000, 100000, N'all', N'pro,studio_plus', 1, GETDATE(), N'active',
        N'Seed mặc định theo chính sách voucher đầu tiên của Blankup.'
      )
    `);
  }

  await pool.request().query(`
    INSERT INTO UserAiAccounts (userId, displayPlanId, highestPlanRank)
    SELECT id, N'plan-free', 0
    FROM Users u
    WHERE NOT EXISTS (SELECT 1 FROM UserAiAccounts a WHERE a.userId = u.id)
  `);
}

// ---------------------------------------------------------------------------
// Seed default admin user
// ---------------------------------------------------------------------------
async function seedAdminUser() {
  const result = await pool.request().query(`SELECT COUNT(*) as cnt FROM Users`);
  const adminResult = await pool.request()
    .input('adminUsername', sql.NVarChar, 'admin')
    .query('SELECT id, role, provider FROM Users WHERE username = @adminUsername');

  if (adminResult.recordset.length === 0) {
    console.log('[DB] Seeding default admin user...');
    await pool.request()
      .input('password', sql.NVarChar, hashSeedPassword('admin123'))
      .query(`
        INSERT INTO Users (id, username, password, fullName, role, provider, createdAt)
        VALUES ('u-admin', 'admin', @password, 'System Admin', 'admin', 'local', '2026-06-01T12:00:00.000Z')
      `);
  } else {
    // Only repair role/provider if they've drifted — this must NEVER touch
    // the password column on an existing account, or every server restart
    // would silently revert any password the admin has since changed.
    const admin = adminResult.recordset[0];
    if (admin.role !== 'admin' || admin.provider !== 'local') {
      console.log('[DB] Repairing default admin role/provider...');
      await pool.request()
        .input('id', sql.NVarChar, admin.id)
        .input('role', sql.NVarChar, 'admin')
        .input('provider', sql.NVarChar, 'local')
        .query('UPDATE Users SET role = @role, provider = @provider WHERE id = @id');
    }
  }
  if (result.recordset[0].cnt === 0) {
    console.log('[DB] Seeding default sample users...');
    await pool.request()
      .input('password', sql.NVarChar, hashSeedPassword('password123'))
      .query(`
        INSERT INTO Users (id, username, password, fullName, role, provider, createdAt)
        VALUES
          ('u-1', 'minht', @password, N'Minh T.', 'user', 'local', '2026-06-15T08:30:00.000Z'),
          ('u-2', 'ann', @password, N'An N.', 'user', 'local', '2026-06-16T14:20:00.000Z'),
          ('u-3', 'huongl', @password, N'Hương L.', 'user', 'local', '2026-06-17T09:15:00.000Z')
      `);
    console.log('[DB] Default users seeded.');
  }
}

// ---------------------------------------------------------------------------
// Get Pool (for use in route files)
// ---------------------------------------------------------------------------
function getPool() {
  if (!pool) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return pool;
}

module.exports = {
  sql,
  initDatabase,
  getPool,
  DB_NAME,
};
