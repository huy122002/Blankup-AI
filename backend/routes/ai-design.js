const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { authenticate } = require('../middleware/auth');
let galleryLimiter;
try { ({ galleryLimiter } = require('../middleware/rateLimit')); } catch {}
if (typeof galleryLimiter !== 'function') galleryLimiter = (req, res, next) => next();
const { readJson, writeJson } = require('../utils/fileStore');
const { getPool, sql } = require('../db');
const { generateWithFallback } = require('../services/ai-providers');
const { getConfig } = require('../services/ai-providers/provider.config');

// Helper: deduct 1 credit for AI generation (dailyFree → bonusLow → high)
// Called BEFORE generation — deduct-then-generate pattern.
async function deductCreditForGenerate(userId) {
  let pool;
  try {
    pool = getPool();
  } catch {
    return { success: false, error: 'Credit service unavailable', serviceUnavailable: true };
  }

  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    let req = new sql.Request(transaction);
    let accountRes = await req
      .input('userId', sql.NVarChar, userId)
      .query(`
        SELECT a.*, p.dailyFreeLowCredits AS planDailyFree
        FROM UserAiAccounts a
        LEFT JOIN AiPlans p ON p.id = a.displayPlanId
        WHERE a.userId = @userId
      `);

    if (accountRes.recordset.length === 0) {
      await new sql.Request(transaction)
        .input('userId', sql.NVarChar, userId)
        .query(`INSERT INTO UserAiAccounts (userId, displayPlanId, highestPlanRank) VALUES (@userId, N'plan-free', 0)`);
      accountRes = await new sql.Request(transaction)
        .input('userId2', sql.NVarChar, userId)
        .query(`SELECT a.*, p.dailyFreeLowCredits AS planDailyFree FROM UserAiAccounts a LEFT JOIN AiPlans p ON p.id = a.displayPlanId WHERE a.userId = @userId2`);
    }

    let account = accountRes.recordset[0];
    const todayStr = new Date().toISOString().slice(0, 10);
    const resetDateStr = account.dailyFreeResetDate ? new Date(account.dailyFreeResetDate).toISOString().slice(0, 10) : null;
    if (resetDateStr !== todayStr) {
      await new sql.Request(transaction)
        .input('userId', sql.NVarChar, userId)
        .input('today', sql.Date, new Date(todayStr))
        .query(`UPDATE UserAiAccounts SET dailyFreeLowCreditsUsed = 0, dailyFreeResetDate = @today WHERE userId = @userId`);
      account.dailyFreeLowCreditsUsed = 0;
      account.dailyFreeResetDate = todayStr;
    }

    const planDailyFree = Number(account.planDailyFree) || 0;
    const dailyUsed = Number(account.dailyFreeLowCreditsUsed) || 0;
    const bonusLow = Number(account.bonusLowCredits) || 0;
    const high = Number(account.highCredits) || 0;

    let creditType = null;
    let updateSql = '';
    if (dailyUsed < planDailyFree) {
      creditType = 'daily';
      updateSql = `UPDATE UserAiAccounts SET dailyFreeLowCreditsUsed = dailyFreeLowCreditsUsed + 1, updatedAt = GETDATE() WHERE userId = @userIdDeduct`;
    } else if (bonusLow > 0) {
      creditType = 'low';
      updateSql = `UPDATE UserAiAccounts SET bonusLowCredits = bonusLowCredits - 1, updatedAt = GETDATE() WHERE userId = @userIdDeduct AND bonusLowCredits > 0`;
    } else if (high > 0) {
      creditType = 'high';
      updateSql = `UPDATE UserAiAccounts SET highCredits = highCredits - 1, updatedAt = GETDATE() WHERE userId = @userIdDeduct AND highCredits > 0`;
    } else {
      await transaction.rollback();
      return { success: false, error: 'Not enough credits' };
    }

    const updRes = await new sql.Request(transaction)
      .input('userIdDeduct', sql.NVarChar, userId)
      .query(updateSql);
    if (updRes.rowsAffected[0] === 0) {
      await transaction.rollback();
      return { success: false, error: 'Not enough credits' };
    }

    const ledgerId = 'ledger-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const balanceRes = await new sql.Request(transaction)
      .input('userIdBal', sql.NVarChar, userId)
      .query(`SELECT highCredits, bonusLowCredits, dailyFreeLowCreditsUsed FROM UserAiAccounts WHERE userId = @userIdBal`);
    const bal = balanceRes.recordset[0] || { highCredits: 0, bonusLowCredits: 0, dailyFreeLowCreditsUsed: 0 };
    const balanceAfter = creditType === 'high' ? bal.highCredits : creditType === 'low' ? bal.bonusLowCredits : (planDailyFree - Number(bal.dailyFreeLowCreditsUsed));

    await new sql.Request(transaction)
      .input('ledgerId', sql.NVarChar, ledgerId)
      .input('userId', sql.NVarChar, userId)
      .input('creditType', sql.NVarChar, creditType === 'daily' ? 'low' : creditType)
      .input('quality', sql.NVarChar, 'low')
      .input('amount', sql.Int, -1)
      .input('balanceAfter', sql.Int, balanceAfter)
      .input('reason', sql.NVarChar, 'ai_generate')
      .query(`
        INSERT INTO AiCreditLedger (id, userId, creditType, quality, amount, balanceAfter, reason, referenceType, referenceId, note)
        VALUES (@ledgerId, @userId, @creditType, @quality, @amount, @balanceAfter, @reason, N'ai_design', @ledgerId, N'AI design generation')
      `);

    await transaction.commit();
    return { success: true, creditType };
  } catch (err) {
    try { await transaction.rollback(); } catch {}
    throw err;
  }
}

// Helper: refund 1 credit when generation fails after successful deduction (compensating transaction)
// Must handle all three creditType values: daily, low, high.
async function refundCreditForGenerate(userId, creditType) {
  let pool;
  try {
    pool = getPool();
  } catch {
    console.error(`[AI-Design] Cannot refund credit: DB unavailable (userId=${userId}, creditType=${creditType})`);
    return;
  }

  try {
    const transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    let updateSql = '';
    if (creditType === 'daily') {
      // Daily free quota: decrement used count (refund the consumed slot)
      updateSql = `UPDATE UserAiAccounts SET dailyFreeLowCreditsUsed = CASE WHEN dailyFreeLowCreditsUsed > 0 THEN dailyFreeLowCreditsUsed - 1 ELSE 0 END, updatedAt = GETDATE() WHERE userId = @userId`;
    } else if (creditType === 'low') {
      updateSql = `UPDATE UserAiAccounts SET bonusLowCredits = bonusLowCredits + 1, updatedAt = GETDATE() WHERE userId = @userId`;
    } else if (creditType === 'high') {
      updateSql = `UPDATE UserAiAccounts SET highCredits = highCredits + 1, updatedAt = GETDATE() WHERE userId = @userId`;
    } else {
      await transaction.rollback();
      return;
    }

    await new sql.Request(transaction)
      .input('userId', sql.NVarChar, userId)
      .query(updateSql);

    // Fetch fresh balances for accurate ledger
    const balRes = await new sql.Request(transaction)
      .input('userIdBal', sql.NVarChar, userId)
      .query(`SELECT highCredits, bonusLowCredits, dailyFreeLowCreditsUsed, displayPlanId FROM UserAiAccounts WHERE userId = @userIdBal`);
    const bal = balRes.recordset[0] || { highCredits: 0, bonusLowCredits: 0, dailyFreeLowCreditsUsed: 0 };
    let balanceAfter = 0;
    if (creditType === 'daily') {
      let planDailyFree = 0;
      try {
        const planRes = await new sql.Request(transaction)
          .input('planId', sql.NVarChar, bal.displayPlanId)
          .query(`SELECT dailyFreeLowCredits FROM AiPlans WHERE id = @planId`);
        planDailyFree = Number(planRes.recordset[0]?.dailyFreeLowCredits) || 0;
      } catch {}
      balanceAfter = Math.max(0, planDailyFree - Number(bal.dailyFreeLowCreditsUsed || 0));
    } else if (creditType === 'low') {
      balanceAfter = Number(bal.bonusLowCredits) || 0;
    } else {
      balanceAfter = Number(bal.highCredits) || 0;
    }

    const ledgerId = 'ledger-refund-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    await new sql.Request(transaction)
      .input('ledgerId', sql.NVarChar, ledgerId)
      .input('userId', sql.NVarChar, userId)
      .input('creditType', sql.NVarChar, creditType === 'daily' ? 'low' : creditType)
      .input('quality', sql.NVarChar, 'low')
      .input('amount', sql.Int, 1)
      .input('balanceAfter', sql.Int, balanceAfter)
      .input('reason', sql.NVarChar, 'ai_generate_refund')
      .query(`
        INSERT INTO AiCreditLedger (id, userId, creditType, quality, amount, balanceAfter, reason, referenceType, referenceId, note)
        VALUES (@ledgerId, @userId, @creditType, @quality, @amount, @balanceAfter, @reason, N'ai_design', @ledgerId, N'AI design generation refund - generation failed')
      `);

    await transaction.commit();
    console.log(`[AI-Design] Credit refunded: userId=${userId}, type=${creditType}`);
  } catch (err) {
    console.error(`[AI-Design] Refund failed: userId=${userId}, type=${creditType}, error=${err.message}`);
  }
}

const router = express.Router();
const designsFilePath = path.join(__dirname, '../data/designs.json');
const uploadsDir = path.join(__dirname, '../uploads');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) return;

    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, '');
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  });
}

loadEnvFile(path.join(__dirname, '../.env'));
loadEnvFile(path.join(__dirname, '../../.env'));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';
const OPENAI_IMAGE_SIZE = process.env.OPENAI_IMAGE_SIZE || '1024x1024';
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 90000);
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_IMAGE_MODEL = process.env.CLOUDFLARE_IMAGE_MODEL || '@cf/black-forest-labs/flux-1-schnell';
const CLOUDFLARE_PROMPT_MODEL = process.env.CLOUDFLARE_PROMPT_MODEL || '@cf/meta/llama-3.1-8b-instruct';
const ENABLE_AI_PROMPT_ENHANCER = process.env.ENABLE_AI_PROMPT_ENHANCER === 'true';
const CLOUDFLARE_TIMEOUT_MS = Number(process.env.CLOUDFLARE_TIMEOUT_MS || 90000);

// ---------------------------------------------------------------------------
// Multer configuration for image uploads
// ---------------------------------------------------------------------------
const storage = multer.diskStorage({
  destination: path.join(__dirname, '../uploads'),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `design-${Date.now()}-${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB (AGENTS.md)
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|svg/;
    const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
    const mimeOk = allowed.test(file.mimetype);
    if (extOk && mimeOk) return cb(null, true);
    cb(new Error('Only image files (jpg, png, gif, webp, svg) are allowed.'));
  },
});

fs.mkdirSync(uploadsDir, { recursive: true });

// ---------------------------------------------------------------------------
// SVG Design Templates – one per style
// ---------------------------------------------------------------------------

function buildSvg(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">${body}</svg>`;
}

const SVG_TEMPLATES = {
  minimalist: buildSvg(`
    <rect width="200" height="200" fill="#111111"/>
    <circle cx="100" cy="82" r="32" fill="none" stroke="#f0ece2" stroke-width="1.8" stroke-dasharray="2,1"/>
    <line x1="100" y1="50" x2="100" y2="114" stroke="#f0ece2" stroke-width="1.2"/>
    <line x1="68" y1="82" x2="132" y2="82" stroke="#f0ece2" stroke-width="1.2"/>
    <text x="100" y="148" text-anchor="middle" font-family="Georgia,serif" font-size="11" fill="#c4b89a" letter-spacing="1">LESS IS MORE</text>
    <text x="100" y="164" text-anchor="middle" font-family="Courier New,monospace" font-size="7" fill="#6b6352">hand-drawn linework</text>
  `),

  streetwear: buildSvg(`
    <rect width="200" height="200" fill="#0a0a0a"/>
    <polygon points="100,18 128,68 168,78 138,112 146,162 100,140 54,162 62,112 32,78 72,68" fill="none" stroke="#ff3333" stroke-width="2.2" stroke-linejoin="round"/>
    <text x="100" y="96" text-anchor="middle" font-family="Impact,sans-serif" font-size="22" fill="#ff3333" letter-spacing="4">BLK</text>
    <text x="100" y="118" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" fill="#555" letter-spacing="6">UP</text>
    <text x="100" y="188" text-anchor="middle" font-family="Courier New,monospace" font-size="7" fill="#333" letter-spacing="2">RISOGRAPH PRINT</text>
  `),

  vintage: buildSvg(`
    <rect width="200" height="200" fill="#1a1612"/>
    <circle cx="100" cy="86" r="48" fill="none" stroke="#c4a96a" stroke-width="1.5"/>
    <circle cx="100" cy="86" r="40" fill="none" stroke="#c4a96a" stroke-width="0.8" stroke-dasharray="3,2"/>
    <text x="100" y="82" text-anchor="middle" font-family="Georgia,serif" font-size="14" fill="#e8d5b0" font-weight="700">VINTAGE</text>
    <text x="100" y="96" text-anchor="middle" font-family="Georgia,serif" font-size="7" fill="#8a7d5a">— Est. 2024 —</text>
    <line x1="58" y1="104" x2="142" y2="104" stroke="#6b5c3a" stroke-width="0.8"/>
    <text x="100" y="156" text-anchor="middle" font-family="Georgia,serif" font-size="8" fill="#c4a96a" letter-spacing="1">SCREEN PRINT</text>
  `),

  abstract: buildSvg(`
    <rect width="200" height="200" fill="#0c0a14"/>
    <circle cx="55" cy="65" r="35" fill="#5a4fcf" opacity="0.5"/>
    <circle cx="145" cy="55" r="28" fill="#9b59b6" opacity="0.4"/>
    <circle cx="95" cy="128" r="42" fill="#e05a24" opacity="0.35"/>
    <rect x="78" y="38" width="38" height="38" rx="6" fill="#e9b55c" opacity="0.5" transform="rotate(25 97 57)"/>
    <text x="100" y="185" text-anchor="middle" font-family="Courier New,monospace" font-size="9" fill="#888" letter-spacing="3">ABSTRACT</text>
  `),

  anime: buildSvg(`
    <rect width="200" height="200" fill="#0e0e0e"/>
    <polygon points="100,12 114,52 158,52 124,78 136,118 100,94 64,118 76,78 42,52 86,52" fill="#ff4444" opacity="0.85"/>
    <line x1="58" y1="136" x2="38" y2="126" stroke="#ff4444" stroke-width="1.8"/>
    <line x1="142" y1="136" x2="162" y2="126" stroke="#ff4444" stroke-width="1.8"/>
    <line x1="58" y1="144" x2="33" y2="141" stroke="#ffaa44" stroke-width="1.2"/>
    <line x1="142" y1="144" x2="167" y2="141" stroke="#ffaa44" stroke-width="1.2"/>
    <text x="100" y="186" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" fill="#ff4444" font-weight="700" letter-spacing="1">ANIME</text>
  `),

  ai3d: buildSvg(`
    <rect width="200" height="200" fill="#111"/>
    <circle cx="100" cy="88" r="50" fill="#ff8844"/>
    <circle cx="80" cy="74" r="8" fill="#111"/>
    <circle cx="120" cy="74" r="8" fill="#111"/>
    <ellipse cx="100" cy="102" rx="24" ry="15" fill="#ffcc99"/>
    <path d="M84 108 Q100 118 116 108" fill="none" stroke="#111" stroke-width="3.5" stroke-linecap="round"/>
    <circle cx="74" cy="66" r="9" fill="#fff" opacity="0.2"/>
    <text x="100" y="176" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" fill="#ff8844" font-weight="700">MASCOT</text>
  `),

  watercolor: buildSvg(`
    <rect width="200" height="200" fill="#0f0f0f"/>
    <ellipse cx="58" cy="58" rx="58" ry="50" fill="#4488cc" opacity="0.35"/>
    <ellipse cx="142" cy="85" rx="50" ry="55" fill="#cc4488" opacity="0.3"/>
    <ellipse cx="88" cy="140" rx="62" ry="45" fill="#44cc88" opacity="0.25"/>
    <ellipse cx="38" cy="135" rx="30" ry="25" fill="#8844cc" opacity="0.2"/>
    <text x="100" y="106" text-anchor="middle" font-family="Georgia,serif" font-size="12" fill="#ddd" font-style="italic">watercolor</text>
  `),

  geometric: buildSvg(`
    <rect width="200" height="200" fill="#080818"/>
    <polygon points="100,18 38,63 38,133 100,178 162,133 162,63" fill="none" stroke="#00cc88" stroke-width="1.8"/>
    <polygon points="100,38 58,70 58,126 100,158 142,126 142,70" fill="none" stroke="#00aa88" stroke-width="1.2"/>
    <polygon points="100,58 78,76 78,120 100,138 122,120 122,76" fill="#00cc88" opacity="0.2"/>
    <circle cx="100" cy="100" r="3.5" fill="#ff4488"/>
    <text x="100" y="194" text-anchor="middle" font-family="Courier New,monospace" font-size="9" fill="#00aa88" letter-spacing="3">GEO</text>
  `),

  typography: buildSvg(`
    <rect width="200" height="200" fill="#0e0e0e"/>
    <text x="100" y="48" text-anchor="middle" font-family="Impact,sans-serif" font-size="26" fill="#cc44ff" letter-spacing="2">TYPE</text>
    <text x="100" y="78" text-anchor="middle" font-family="Georgia,serif" font-size="11" fill="#ddd" font-style="italic">is an art form</text>
    <line x1="38" y1="88" x2="162" y2="88" stroke="#cc44ff" stroke-width="0.8"/>
    <text x="100" y="112" text-anchor="middle" font-family="Courier New,monospace" font-size="8" fill="#6688cc" letter-spacing="3">ABCDEFG</text>
    <text x="100" y="150" text-anchor="middle" font-family="Impact,sans-serif" font-size="18" fill="#ff4488" letter-spacing="5">FONT</text>
    <rect x="28" y="23" width="144" height="160" rx="3" fill="none" stroke="#cc44ff" stroke-width="0.6" opacity="0.3"/>
  `),
};

// Default fallback SVG for unknown styles
const DEFAULT_STYLE = 'abstract';

/**
 * Encode an SVG string as a data URI
 */
function svgToDataUri(svg) {
  // Using charset=utf-8 encoding for cleaner URLs
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Get the SVG template for a given style
 */
function getDesignSvg(style) {
  const key = (style || DEFAULT_STYLE).toLowerCase();
  const svg = SVG_TEMPLATES[key] || SVG_TEMPLATES[DEFAULT_STYLE];
  return svgToDataUri(svg);
}

// Build a special "from-image" SVG (used for generate-from-image endpoint)
function getFromImageSvg() {
  const svg = buildSvg(`
    <rect width="200" height="200" fill="#0c0a14"/>
    <rect x="28" y="28" width="55" height="55" rx="5" fill="#e05a24" opacity="0.6" transform="rotate(12 55 55)"/>
    <circle cx="142" cy="55" r="28" fill="#8f93f2" opacity="0.5"/>
    <polygon points="100,108 72,168 128,168" fill="#5fc4b4" opacity="0.4"/>
    <circle cx="55" cy="148" r="20" fill="#e9b55c" opacity="0.45"/>
    <rect x="118" cy="128" width="42" height="42" rx="4" fill="#ff4488" opacity="0.35" transform="rotate(-8 139 149)"/>
    <text x="100" y="194" text-anchor="middle" font-family="Courier New,monospace" font-size="9" fill="#888" letter-spacing="2">IMAGE REMIX</text>
  `);
  return svgToDataUri(svg);
}

const readDesigns = () => readJson(designsFilePath);
const writeDesigns = (data) => writeJson(designsFilePath, data);

function hasOpenAIConfig() {
  return Boolean(OPENAI_API_KEY && typeof fetch === 'function');
}

function hasCloudflareConfig() {
  return Boolean(CLOUDFLARE_API_TOKEN && CLOUDFLARE_ACCOUNT_ID && typeof fetch === 'function');
}

const STYLE_PROMPTS = {
  minimalist: 'clean minimalist single-color line art, thin precise pen strokes on plain background, generous negative space, hand-drawn imperfections visible, subtle screen-print halftone texture, like a designer drew it by hand on paper, NOT a digital vector, slight ink bleed on edges',
  streetwear: 'bold streetwear graphic tee print, high-contrast risograph or screen-print aesthetic, rough spray-stencil texture with visible overspray, hand-drawn marker outlines, torn paper collage energy, urban underground zine feel, limited color palette (2-3 colors max), distressed ink edges',
  vintage: 'vintage 1970s screen-print badge, faded ink texture with visible grain, hand-drawn illustration style, old-school patch stamp aesthetic, warm earthy muted palette, distressed edges like a worn-out thrift store find, halftone dot pattern in shadows, letterpress imperfection',
  abstract: 'expressive abstract art print, visible gestural brush strokes with texture, asymmetric composition with intentional imbalance, mixed media collage feel, layered paper and ink textures, like a contemporary art gallery poster, NOT smooth digital gradients, raw and imperfect',
  anime: 'hand-drawn anime ink illustration, confident dynamic linework with varying thickness, cel-shaded coloring with visible flat areas, screentone texture in shadows, motion lines and speed effects, designed like a custom doujinshi cover or event poster, NOT polished digital anime',
  watercolor: 'hand-painted watercolor on textured paper, visible pigment blooms and water edges, uneven organic color bleeding, paper grain showing through, sparse composition with lots of white space, like a field sketch or travel journal illustration, paint splatters and drips',
  geometric: 'geometric pattern print, precise angular shapes with slight hand-drawn wobble, limited palette (2-3 colors), screen-print registration offset effect, like a 1960s Swiss poster or constructivist print, halftone texture, NOT perfect digital vectors',
  typography: 'hand-lettered typographic print, expressive brush lettering or sign-painter style, vintage print imperfection, ink bleed on serifs, balanced asymmetric layout, like a letterpress or screen-printed poster, NOT clean digital fonts',
};

function normalizeDesignIdea(prompt) {
  return String(prompt || '').trim() || 'original bold graphic emblem';
}

function buildTshirtPrompt({ prompt, style, fromImage = false }) {
  const styleKey = (style || DEFAULT_STYLE).toLowerCase();
  const styleText = STYLE_PROMPTS[styleKey] || STYLE_PROMPTS[DEFAULT_STYLE];
  const idea = normalizeDesignIdea(prompt);
  const sourceInstruction = fromImage
    ? 'Use the uploaded reference only as inspiration for a new standalone print graphic.'
    : 'Create a standalone print graphic from the user idea.';

  return [
    'Print-ready T-shirt graphic design on a SOLID BLACK background. Flat graphic print, not a photograph.',
    sourceInstruction,
    `Subject: "${idea}".`,
    `Style: ${styleText}.`,
    'This is a standalone print artwork — no apparel mockup, no product photo.',
    '',
    'ANTI-AI QUALITY RULES (critical for natural, handmade feel):',
    '• Hand-drawn imperfections: slightly wobbly lines, uneven edges, visible pen/brush strokes',
    '• Limited flat colors: 2-4 solid colors max, NO gradients, NO smooth blends, NO glowing effects',
    '• Print texture: screen-print halftone dots, risograph grain, letterpress ink bleed, woodcut linework, or linocut edges',
    '• Rough edges: torn paper, distressed borders, ink splatter, registration misalignment',
    '• Asymmetric composition with intentional negative space, NOT perfectly centered or mirrored',
    '• Think: independent artist screen-print, underground zine illustration, hand-pulled risograph print, gig poster art',
    '',
    'FORBIDDEN (instant AI tell — will be rejected):',
    '• Gradient blobs, neon glows, lens flares, light rays, glass reflections',
    '• Perfect symmetry, mirrored compositions, centered orbs',
    '• Smooth 3D renders, glossy surfaces, photorealism',
    '• Generic abstract swirls, fractal patterns, digital vector perfection',
    '• T-shirt outlines, hangers, models, mannequins, frames, UI, watermarks',
    '',
    'Composition: one focused motif, large and unmistakable, centered or strong off-center on the square canvas.',
    'Background: plain solid black, no scene, no environment.',
  ].filter(Boolean).join(' ');
}

function buildProductMockupPrompt() {
  return [
    'Create a realistic blank product mockup image for an ecommerce custom t-shirt preview.',
    'Show one clean short-sleeve t-shirt as the main product, front view, slightly turned in 3/4 perspective, floating on a plain light studio background.',
    'The t-shirt must be completely blank so a separate customer artwork can be composited onto it later.',
    'No print, no graphic, no illustration, no logo, no symbol, no lettering, and no decoration anywhere on the shirt.',
    'Use soft studio lighting, subtle fabric texture, realistic shadows, polished ecommerce product render.',
    'No human model, no hanger, no mannequin, no extra text, no watermark, no UI, no frame.'
  ].join(' ');
}

function extractTextResult(data) {
  return (
    data?.result?.response ||
    data?.result?.text ||
    data?.result?.choices?.[0]?.message?.content ||
    data?.result?.choices?.[0]?.text ||
    data?.response ||
    data?.text ||
    ''
  );
}

function cleanEnhancedPrompt(text) {
  return String(text || '')
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .replace(/^["']|["']$/g, '')
    .trim();
}

async function enhanceImagePrompt(prompt, style, fromImage = false) {
  const fallbackPrompt = buildTshirtPrompt({ prompt, style, fromImage });

  if (!ENABLE_AI_PROMPT_ENHANCER || !hasCloudflareConfig()) {
    return fallbackPrompt;
  }

  try {
    const styleKey = (style || DEFAULT_STYLE).toLowerCase();
    const styleText = STYLE_PROMPTS[styleKey] || STYLE_PROMPTS[DEFAULT_STYLE];
    const data = await postCloudflareJson(CLOUDFLARE_PROMPT_MODEL, {
      messages: [
        {
          role: 'system',
          content: [
            'You are a prompt engineer for a premium t-shirt print artwork generator.',
            'Convert the user request (often in Vietnamese) into ONE detailed English image generation prompt.',
            'Return ONLY the final image prompt. No markdown. No explanations. No extra text.',
            '',
            'CORE RULES:',
            '• The image is standalone print artwork ONLY — never a shirt mockup, product photo, or scene.',
            '• Preserve every requested subject, place, color, number, action, and visual detail from the user.',
            '• Never replace a named place, character, animal, or object with a generic version.',
            '• For cultural references (Vietnamese, anime, memes), keep the name AND describe distinctive visual traits.',
            '• Translate Vietnamese faithfully. Fix minor typos without changing meaning.',
            '',
            'ART DIRECTION (think like a real print artist, not a stock generator):',
            '• Propose ONE specific creative twist: an unusual color pairing, a surreal hidden detail, a cultural fusion, or an ironic juxtaposition. Describe it concretely.',
            '• Pick a real print technique that matches the style: halftone screen-print, risograph, rough ink brush, woodcut, sticker-cut edge, watercolor paper, or letterpress. Name it explicitly.',
            '• The result should look like something an independent artist pulled from a screen-print press or risograph, NOT like a polished digital render.',
            '',
            'HANDMADE QUALITY (the most important rule):',
            '• The image MUST look hand-crafted, not AI-generated.',
            '• Include: visible hand-drawn line imperfections, limited flat color palette (2-4 colors), print texture grain, rough/distressed edges, asymmetric composition.',
            '• AVOID completely: gradient blobs, glossy renders, lens flare, perfect symmetry, centered orbs, neon glows, smooth 3D, generic abstract swirls, digital vector perfection.',
            '',
            'NEGATIVE REQUIREMENTS:',
            '• No t-shirt, clothing, apparel outline, hanger, model, mannequin, product photo, UI, watermark, frame, or text (unless user asked for lettering).',
            '',
            'Output format: one paragraph, 60-120 words, starting directly with the visual description.',
          ].join(' '),
        },
        {
          role: 'user',
          content: [
            `User request: ${prompt || 'original graphic artwork'}`,
            `Requested style: ${styleText}`,
            fromImage ? 'Reference mode: use the uploaded image only as inspiration.' : '',
            '',
            'Fidelity: include every meaningful detail from the user request. Do not add unrelated content.',
            'Handmade quality: the result must look like a real hand-pulled print, NOT an AI-generated image.',
            'Negative: no t-shirt, no clothing, no apparel outline, no hanger, no model, no mannequin, no product photo, no UI, no watermark, no frame, no text unless user asked for lettering.',
          ].filter(Boolean).join('\n'),
        },
      ],
      temperature: 0.7,
      max_tokens: 600,
    });

    const enhanced = cleanEnhancedPrompt(extractTextResult(data));
    if (enhanced && enhanced.length >= 40) {
      return enhanced;
    }
  } catch (err) {
    console.warn(`[AI-Design] Prompt enhancement failed, using fallback prompt: ${err.message}`);
  }

  return fallbackPrompt;
}

async function postCloudflareJson(model, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLOUDFLARE_TIMEOUT_MS);
  const url = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('image/')) {
      if (!response.ok) {
        throw new Error(`Cloudflare request failed with status ${response.status}`);
      }
      return { imageBuffer: Buffer.from(await response.arrayBuffer()) };
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
      const message = data.errors?.[0]?.message || data.error || `Cloudflare request failed with status ${response.status}`;
      throw new Error(message);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function postOpenAIJson(url, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.error?.message || `OpenAI request failed with status ${response.status}`;
      throw new Error(message);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function postOpenAIForm(url, formData) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: formData,
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.error?.message || `OpenAI request failed with status ${response.status}`;
      throw new Error(message);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function saveGeneratedImage(base64Image, designId) {
  if (!base64Image) {
    throw new Error('AI response did not include image data.');
  }

  const fileName = `${designId}.png`;
  const filePath = path.join(uploadsDir, fileName);
  fs.writeFileSync(filePath, Buffer.from(base64Image, 'base64'));
  return `/uploads/${fileName}`;
}

function saveGeneratedImageBuffer(buffer, designId) {
  if (!buffer || !buffer.length) {
    throw new Error('AI response did not include image data.');
  }

  const fileName = `${designId}.png`;
  const filePath = path.join(uploadsDir, fileName);
  fs.writeFileSync(filePath, buffer);
  return `/uploads/${fileName}`;
}

function extractBase64Image(data) {
  return (
    data?.data?.[0]?.b64_json ||
    data?.result?.image ||
    data?.result?.images?.[0] ||
    data?.image ||
    data?.images?.[0] ||
    data?.b64_json
  );
}

async function generateCloudflareImage(prompt, style, designId) {
  const finalPrompt = await enhanceImagePrompt(prompt, style);
  const data = await postCloudflareJson(CLOUDFLARE_IMAGE_MODEL, {
    prompt: finalPrompt,
  });

  let designUrl;
  if (data.imageBuffer) {
    designUrl = saveGeneratedImageBuffer(data.imageBuffer, designId);
  } else {
    designUrl = saveGeneratedImage(extractBase64Image(data), designId);
  }

  return { designUrl, finalPrompt };
}

async function generateCloudflareProductMockup(prompt, style, designId) {
  const finalProductPrompt = buildProductMockupPrompt({ prompt, style });
  const data = await postCloudflareJson(CLOUDFLARE_IMAGE_MODEL, {
    prompt: finalProductPrompt,
  });

  let productMockupUrl;
  if (data.imageBuffer) {
    productMockupUrl = saveGeneratedImageBuffer(data.imageBuffer, `${designId}-product`);
  } else {
    productMockupUrl = saveGeneratedImage(extractBase64Image(data), `${designId}-product`);
  }

  return { productMockupUrl, finalProductPrompt };
}

async function generateOpenAIImage(prompt, style, designId) {
  const finalPrompt = await enhanceImagePrompt(prompt, style);
  const data = await postOpenAIJson('https://api.openai.com/v1/images/generations', {
    model: OPENAI_IMAGE_MODEL,
    prompt: finalPrompt,
    size: OPENAI_IMAGE_SIZE,
  });

  return { designUrl: saveGeneratedImage(extractBase64Image(data), designId), finalPrompt };
}

async function generateOpenAIProductMockup(prompt, style, designId) {
  const finalProductPrompt = buildProductMockupPrompt({ prompt, style });
  const data = await postOpenAIJson('https://api.openai.com/v1/images/generations', {
    model: OPENAI_IMAGE_MODEL,
    prompt: finalProductPrompt,
    size: OPENAI_IMAGE_SIZE,
  });

  return {
    productMockupUrl: saveGeneratedImage(extractBase64Image(data), `${designId}-product`),
    finalProductPrompt,
  };
}

async function editOpenAIImage(file, idea, designId) {
  const prompt = await enhanceImagePrompt(
    idea || 'Turn this image into an original standalone print graphic',
    'reference remix',
    true
  );
  const legacyPrompt = buildTshirtPrompt({
    prompt: idea || 'Turn this image into an original t-shirt graphic',
    style: 'reference remix',
    fromImage: true,
  });
  const buffer = fs.readFileSync(file.path);
  const formData = new FormData();

  formData.append('model', OPENAI_IMAGE_MODEL);
  formData.append('prompt', prompt || legacyPrompt);
  formData.append('size', OPENAI_IMAGE_SIZE);
  formData.append('image[]', new Blob([buffer], { type: file.mimetype }), file.originalname);

  const data = await postOpenAIForm('https://api.openai.com/v1/images/edits', formData);
  return { designUrl: saveGeneratedImage(extractBase64Image(data), designId), finalPrompt: prompt || legacyPrompt };
}

function saveDesignRecord({ designId, prompt, style, author, userId, designUrl, productMockupUrl, productMockupBlank, sourceImage, finalPrompt, finalProductPrompt }) {
  const designs = readDesigns();
  designs.push({
    designId,
    prompt,
    promptEn: prompt,
    style: style || DEFAULT_STYLE,
    author: author || 'Guest',
    userId: userId || null,
    authorUsername: null,
    designUrl,
    frontDesignUrl: designUrl,
    backDesignUrl: '',
    // Privacy default: a fresh generation is PRIVATE. It appears in the
    // public gallery ONLY after the owner explicitly shares it.
    isShared: false,
    sharedAt: null,
    likes: 0,
    likedBy: [],
    createdAt: new Date().toISOString(),
    productMockupUrl,
    productMockupBlank: Boolean(productMockupBlank),
    sourceImage,
    finalPrompt,
    finalProductPrompt,
    aiProvider: designUrl?.startsWith('/uploads/') ? 'ai' : 'mock',
  });
  writeDesigns(designs);
}

const commentsFilePath = path.join(__dirname, '../data/comments.json');
const readComments = () => readJson(commentsFilePath);
const writeComments = (data) => writeJson(commentsFilePath, data);

// ---------------------------------------------------------------------------
// POST /api/ai-design/generate
// AI design generation from text prompt — requires authentication
// ---------------------------------------------------------------------------
router.post('/generate', authenticate, async (req, res) => {
  try {
    const { prompt, style, author, enhanceOnly } = req.body;

    if (!prompt) {
      return res.status(400).json({ success: false, error: 'A prompt is required.' });
    }

    if (enhanceOnly) {
      try {
        const enhancedPrompt = await enhanceImagePrompt(prompt, style, false);
        return res.json({ success: true, enhancedPrompt });
      } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
      }
    }

    // Step 1: Deduct credit BEFORE generation — backend is source of truth
    const creditRes = await deductCreditForGenerate(req.user.id);
    if (!creditRes.success) {
      if (creditRes.serviceUnavailable) {
        return res.status(503).json({ success: false, error: 'Credit service unavailable. Please try again later.' });
      }
      return res.status(400).json({ success: false, error: creditRes.error || 'Not enough credits' });
    }

    // Step 2: Generate image — if this fails, refund the credit
    const designId = 'design-' + Date.now();
    const authorName = author || 'Guest';
    let designUrl;
    let productMockupUrl;
    let finalPrompt;
    let finalProductPrompt;
    let provider = 'mock';

    try {
      // Provider abstraction: enhance prompt once, then route through AI Provider Layer
      // Business layer already deducted credit; provider layer must not deduct again.
      let enhanced = null;
      try { enhanced = await enhanceImagePrompt(prompt, style, false); } catch (e) { enhanced = null; }
      const genResult = await generateWithFallback({
        prompt,
        style,
        designId,
        enhancedPrompt: enhanced,
        finalPrompt: enhanced,
        isFromImage: false,
        requestId: `gen-${designId}`,
      });
      designUrl = genResult.designUrl;
      finalPrompt = genResult.finalPrompt || enhanced;
      provider = genResult.provider;
      // Product mockup is optional — try Cloudflare provider if available (blank product)
      try {
        const cfg = getConfig();
        if (cfg.cloudflare.enabled) {
          // Use cloudflare provider directly for mockup (non-critical)
          const { CloudflareProvider } = require('../services/ai-providers/cloudflare.provider');
          const cf = new CloudflareProvider(cfg);
          if (cf.isAvailable()) {
            const mockupPrompt = buildProductMockupPrompt();
            const mockData = await cf.generateProductMockup({ designId, finalProductPrompt: mockupPrompt });
            if (mockData) {
              productMockupUrl = mockData;
              finalProductPrompt = mockupPrompt;
            }
          }
        }
      } catch (mockupErr) {
        console.warn(`[AI-Design] Product mockup failed, continuing: ${mockupErr.message}`);
      }
      if (!designUrl) throw new Error('Provider returned no designUrl');
    } catch (genErr) {
      // All providers failed → fallback SVG + refund (preserve invariant: deduct once, refund once)
      if (genErr.code === 'ALL_PROVIDERS_FAILED' || !designUrl) {
        designUrl = getDesignSvg(style);
        console.warn(`[AI-Design] All providers failed, serving fallback SVG for style=${style}. Refunding creditType=${creditRes.creditType}. ProviderAttempts: ${genErr.message}`);
        await refundCreditForGenerate(req.user.id, creditRes.creditType);
        creditRes._refunded = true;
        provider = 'mock';
      } else {
        console.error(`[AI-Design] Generation failed after credit deduction, refunding: ${genErr.message}`);
        await refundCreditForGenerate(req.user.id, creditRes.creditType);
        return res.status(500).json({ success: false, error: 'AI generation failed. Your credit has been refunded.' });
      }
    }

    console.log(`[AI-Design] Generated design ${designId} via ${provider} for prompt: "${prompt}" (style: ${style || DEFAULT_STYLE})`);
    saveDesignRecord({
      designId,
      prompt,
      style: style || DEFAULT_STYLE,
      author: authorName,
      userId: req.user.id,
      designUrl,
      productMockupUrl,
      productMockupBlank: Boolean(productMockupUrl),
      finalPrompt,
      finalProductPrompt,
    });

    res.json({
      success: true,
      designId,
      designUrl,
      productMockupUrl,
      productMockupBlank: Boolean(productMockupUrl),
      prompt,
      style: style || DEFAULT_STYLE,
      author: authorName,
      provider,
      finalPrompt,
      finalProductPrompt,
    });
  } catch (err) {
    console.error('[AI-Design] Error generating design:', err.message);
    res.status(500).json({ success: false, error: 'Failed to generate design' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/ai-design/generate-from-image
// AI design generation from an uploaded image — requires authentication
// Supports mode: 'reference' (default) | 'asset'
// - reference: store as reference asset, return referenceAssetId, no layer created
// - asset: store as asset, return assetId (for backward compat, but user should use /api/assets/upload + place)
// ---------------------------------------------------------------------------
router.post('/generate-from-image', authenticate, upload.single('image'), async (req, res) => {
  try {
    const idea = req.body.idea || '';
    const author = req.body.author || 'Guest';
    const mode = req.body.mode || 'reference'; // 'reference' | 'asset'
    const file = req.file;

    if (!file) {
      return res.status(400).json({ success: false, error: 'An image file is required.' });
    }

    if (!['reference', 'asset'].includes(mode)) {
      return res.status(400).json({ success: false, error: 'Invalid mode. Must be "reference" or "asset".' });
    }

    // Step 1: Deduct credit BEFORE generation
    const creditResImg = await deductCreditForGenerate(req.user.id);
    if (!creditResImg.success) {
      if (creditResImg.serviceUnavailable) {
        return res.status(503).json({ success: false, error: 'Credit service unavailable. Please try again later.' });
      }
      return res.status(400).json({ success: false, error: creditResImg.error || 'Not enough credits' });
    }

    // Step 2: Generate — refund if fails
    const designId = 'design-' + Date.now();
    let designUrl;
    let finalPrompt;
    let provider = 'mock';

    try {
      let enhancedFrom = null;
      try { enhancedFrom = await enhanceImagePrompt(idea || 'Remix this reference image into an original t-shirt graphic', 'reference remix', true); } catch (e) { enhancedFrom = null; }
      const genResult = await generateWithFallback({
        prompt: idea,
        style: 'reference remix',
        designId,
        file,
        idea,
        enhancedPrompt: enhancedFrom,
        finalPrompt: enhancedFrom,
        isFromImage: true,
        requestId: `gen-img-${designId}`,
      });
      designUrl = genResult.designUrl;
      finalPrompt = genResult.finalPrompt || enhancedFrom;
      provider = genResult.provider;
      if (!designUrl) throw new Error('Provider returned no designUrl');
    } catch (genErr) {
      if (genErr.code === 'ALL_PROVIDERS_FAILED' || !designUrl) {
        designUrl = getFromImageSvg();
        console.warn(`[AI-Design] All providers failed for from-image, serving fallback SVG. Refunding creditType=${creditResImg.creditType}.`);
        await refundCreditForGenerate(req.user.id, creditResImg.creditType);
        creditResImg._refunded = true;
        provider = 'mock';
      } else {
        console.error(`[AI-Design] Image generation failed after credit deduction, refunding: ${genErr.message}`);
        await refundCreditForGenerate(req.user.id, creditResImg.creditType);
        return res.status(500).json({ success: false, error: 'AI generation failed. Your credit has been refunded.' });
      }
    }

    console.log(`[AI-Design] Generated design ${designId} via ${provider} from image: "${file.filename}" idea: "${idea}" mode: ${mode}`);

    // Save design record with mode-specific fields
    const designRecord = {
      designId,
      prompt: idea || 'Remix from image',
      style: 'abstract',
      author,
      userId: req.user.id,
      designUrl,
      sourceImage: `/uploads/${file.filename}`,
      finalPrompt,
    };

    let referenceAssetId = null;
    if (mode === 'reference') {
      // Create a reference asset record for tracking
      const { readJson, writeJson, withLock, DATA_DIR } = require('../utils/fileStore');
      const assetsFile = path.join(DATA_DIR, 'assets.json');
      const { v4: uuidv4 } = require('uuid');
      referenceAssetId = uuidv4();
      const referenceAsset = {
        assetId: referenceAssetId,
        userId: req.user.id,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        width: 0,
        height: 0,
        storagePath: path.join(__dirname, '..', 'uploads', file.filename),
        publicUrl: `/uploads/${file.filename}`,
        checksum: '',
        exifStripped: false,
        createdAt: new Date().toISOString(),
        kind: 'reference',
        deletedAt: null,
      };
      await withLock(assetsFile, async () => {
        const assets = readJson(assetsFile) || [];
        assets.push(referenceAsset);
        writeJson(assetsFile, assets);
      });
      designRecord.referenceAssetId = referenceAssetId;
    }

    saveDesignRecord(designRecord);

    const response = {
      success: true,
      designId,
      designUrl,
      productMockupUrl: designUrl,
      productMockupBlank: designUrl,
      prompt: idea || 'Remix from image',
      style: 'abstract',
    };

    if (mode === 'reference') {
      response.referenceAssetId = referenceAssetId;
    }

    res.json(response);
  } catch (err) {
    console.error('[AI-Design] Generate from image error:', err.message);
    res.status(500).json({ success: false, error: 'AI generation failed' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/ai-design/:id/share  — Share design to community gallery
// Explicit owner consent. Requires authentication; the owner identity comes
// from the session (JWT), never from client-supplied userId. Sharing is
// idempotent: repeated calls do NOT create duplicate records.
// ---------------------------------------------------------------------------
router.post('/:id/share', galleryLimiter, authenticate, (req, res) => {
  try {
    const designId = decodeURIComponent(req.params.id);
    const { designUrl, frontDesignUrl, backDesignUrl, prompt, style } = req.body;

    if (!designUrl) {
      return res.status(400).json({ success: false, error: 'designUrl is required' });
    }

    const designs = readDesigns();
    const existing = designs.find(d => d.designId === designId);

    if (existing) {
      // Ownership: a design already owned by someone else cannot be shared
      // by another user (IDOR protection).
      if (existing.userId && existing.userId !== req.user.id) {
        return res.status(403).json({ success: false, error: 'Bạn không có quyền chia sẻ thiết kế này.' });
      }
      const alreadyShared = existing.isShared === true;
      existing.isShared = true;
      if (!alreadyShared) existing.sharedAt = new Date().toISOString();
      // Identity always comes from the authenticated session.
      existing.userId = req.user.id;
      existing.authorUsername = req.user.username;
      existing.author = req.user.fullName || req.user.username || existing.author || 'Community';
      writeDesigns(designs);
      console.log(`[AI-Design] Design ${designId} shared to gallery by ${req.user.username}${alreadyShared ? ' (already shared, idempotent)' : ''}`);
      return res.json({ success: true, message: 'Design shared successfully', alreadyShared });
    }

    // Sharing a client-side composition not yet stored server-side: create
    // the record owned by the caller, shared from the start (explicit consent
    // = this authenticated call).
    designs.push({
      designId,
      prompt: prompt || '',
      style: style || 'abstract',
      author: req.user.fullName || req.user.username || 'Community',
      userId: req.user.id,
      authorUsername: req.user.username,
      designUrl,
      frontDesignUrl: frontDesignUrl || designUrl,
      backDesignUrl: backDesignUrl || '',
      isShared: true,
      sharedAt: new Date().toISOString(),
      likes: 0,
      likedBy: [],
    });
    writeDesigns(designs);

    console.log(`[AI-Design] Design ${designId} shared to gallery by ${req.user.username}`);
    res.json({ success: true, message: 'Design shared successfully', alreadyShared: false });
  } catch (err) {
    console.error('[AI-Design] Error sharing design:', err.message);
    res.status(500).json({ success: false, error: 'Failed to share design' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/ai-design/:id/unshare  — Remove design from community gallery
// Owner-only. The design itself is kept (private), only visibility changes.
// ---------------------------------------------------------------------------
router.post('/:id/unshare', galleryLimiter, authenticate, (req, res) => {
  try {
    const designId = decodeURIComponent(req.params.id);
    const designs = readDesigns();
    const existing = designs.find(d => d.designId === designId);

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Design not found' });
    }
    if (existing.userId && existing.userId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Bạn không có quyền gỡ chia sẻ thiết kế này.' });
    }
    // Legacy records without owner: only allow unshare when nothing proves
    // another owner; bind ownership to the caller for future checks.
    if (!existing.userId) {
      existing.userId = req.user.id;
      existing.authorUsername = existing.authorUsername || req.user.username;
    }
    existing.isShared = false;
    writeDesigns(designs);

    console.log(`[AI-Design] Design ${designId} unshared by ${req.user.username}`);
    res.json({ success: true, message: 'Đã gỡ thiết kế khỏi cộng đồng.' });
  } catch (err) {
    console.error('[AI-Design] Error unsharing design:', err.message);
    res.status(500).json({ success: false, error: 'Failed to unshare design' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/ai-design/:id/like  — Toggle like on a design
// ---------------------------------------------------------------------------
router.post('/:id/like', galleryLimiter, (req, res) => {
  try {
    const designId = decodeURIComponent(req.params.id);
    const userId = req.body.userId || 'anonymous';

    const designs = readDesigns();
    const design = designs.find(d => d.designId === designId);
    if (!design) return res.status(404).json({ success: false, error: 'Design not found' });

    if (!design.likedBy) design.likedBy = [];
    if (typeof design.likes !== 'number') design.likes = design.likedBy.length;

    const idx = design.likedBy.indexOf(userId);
    if (idx === -1) {
      design.likedBy.push(userId);
      design.likes = design.likedBy.length;
      writeDesigns(designs);
      return res.json({ success: true, liked: true, likes: design.likes });
    }

    design.likedBy.splice(idx, 1);
    design.likes = design.likedBy.length;
    writeDesigns(designs);
    res.json({ success: true, liked: false, likes: design.likes });
  } catch (err) {
    console.error('[AI-Design] Error toggling like:', err.message);
    res.status(500).json({ success: false, error: 'Failed to toggle like' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/ai-design/:id/comments — Danh sách comment của thiết kế
// POST /api/ai-design/:id/comments — Thêm comment (cần JWT)
// ---------------------------------------------------------------------------
router.get('/:id/comments', (req, res) => {
  try {
    const designId = decodeURIComponent(req.params.id);
    const comments = readComments()
      .filter(c => c.designId === designId)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    res.json({ success: true, data: comments });
  } catch (err) {
    console.error('[AI-Design] List comments error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to list comments' });
  }
});

router.post('/:id/comments', galleryLimiter, authenticate, (req, res) => {
  try {
    const designId = decodeURIComponent(req.params.id);
    const { text } = req.body;

    if (!text || !String(text).trim()) {
      return res.status(400).json({ success: false, error: 'Nội dung bình luận không được để trống.' });
    }

    const author = (req.user && req.user.id) ? {
      userId: req.user.id,
      authorName: req.user.fullName || req.user.username || 'Khách',
      authorUsername: req.user.username,
      authorAvatar: req.user.avatar || '',
    } : null;

    if (!author) {
      return res.status(401).json({ success: false, error: 'Vui lòng đăng nhập để bình luận.' });
    }

    const designs = readDesigns();
    if (!designs.some(d => d.designId === designId)) {
      return res.status(404).json({ success: false, error: 'Thiết kế không tồn tại.' });
    }

    const comment = {
      id: 'c-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      designId,
      ...author,
      text: String(text).trim().slice(0, 500),
      createdAt: new Date().toISOString(),
    };

    const comments = readComments();
    comments.push(comment);
    writeComments(comments);

    console.log(`[AI-Design] Comment added on ${designId} by ${comment.authorName}`);
    res.status(201).json({ success: true, message: 'Đã thêm bình luận.', data: comment });
  } catch (err) {
    console.error('[AI-Design] Add comment error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to add comment' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/ai-design/gallery
// PUBLIC endpoint: returns ONLY explicitly shared designs. Privacy filtering
// happens server-side (isShared === true); private records never leave the
// server in this response. Public payload exposes no userIds, emails, or
// internal fields — only display-safe data + author display name.
// ---------------------------------------------------------------------------
function toPublicDesign(d, commentCount) {
  const displayName = d.authorUsername || d.author || 'Community';
  return {
    designId: d.designId,
    prompt: d.prompt || '',
    style: d.style || 'abstract',
    authorName: displayName,
    author: displayName, // backward-compat alias for existing community cards
    authorUsername: d.authorUsername || null,
    designUrl: d.designUrl || (d.sourceImage ? getFromImageSvg() : getDesignSvg(d.style)),
    frontDesignUrl: d.frontDesignUrl || d.designUrl || null,
    backDesignUrl: d.backDesignUrl || '',
    productMockupUrl: d.productMockupUrl || null,
    likes: typeof d.likes === 'number' ? d.likes : 0,
    commentCount: commentCount || 0,
    sharedAt: d.sharedAt || null,
    createdAt: d.createdAt || null,
  };
}

router.get('/gallery', (req, res) => {
  try {
    const designs = readDesigns();
    const comments = readComments();
    const commentCountByDesign = comments.reduce((acc, c) => {
      acc[c.designId] = (acc[c.designId] || 0) + 1;
      return acc;
    }, {});
    // Privacy boundary: ONLY shared designs, filtered here — never frontend.
    const shared = designs.filter((d) => d.isShared === true && (d.designUrl || d.frontDesignUrl));
    const galleryWithImages = shared.map((d) => toPublicDesign(d, commentCountByDesign[d.designId]));
    // Sort: newest first
    const sortedGallery = [...galleryWithImages].reverse();
    // Pagination: always bounded (default 20) — never dump the whole store.
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const data = sortedGallery.slice(offset, offset + limit);
    const pagination = { page, limit, total: sortedGallery.length, totalPages: Math.ceil(sortedGallery.length / limit) };
    res.json({ success: true, count: data.length, total: sortedGallery.length, data, pagination });
  } catch (err) {
    console.error('[AI-Design] Error fetching gallery:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch gallery' });
  }
});

module.exports = router;
