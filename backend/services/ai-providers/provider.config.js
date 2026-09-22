// backend/services/ai-providers/provider.config.js
// Reads env for all providers, determines enabled/available and selection policy.
// BlankUp can configure OmniRoute, OpenAI Direct, Cloudflare in parallel.
const path = require('path');
const fs = require('fs');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) return;
    const idx = trimmed.indexOf('=');
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  });
}
loadEnvFile(path.join(__dirname, '../../.env'));
loadEnvFile(path.join(__dirname, '../../../.env'));
loadEnvFile(path.join(__dirname, '../.env'));

function boolEnv(name, def = false) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  return String(v).toLowerCase() === 'true' || v === '1';
}
function strEnv(name, def = '') {
  const v = process.env[name];
  if (v === undefined) return def;
  return String(v).trim();
}
function intEnv(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function getConfig() {
  const aiProvider = strEnv('AI_PROVIDER', 'auto').toLowerCase() || 'auto';

  const omniroute = {
    name: 'omniroute',
    enabled: boolEnv('OMNIROUTE_ENABLED', false),
    baseUrl: strEnv('OMNIROUTE_BASE_URL', 'http://localhost:20128/v1'),
    apiKey: strEnv('OMNIROUTE_API_KEY', ''),
    model: strEnv('OMNIROUTE_MODEL', strEnv('OPENAI_IMAGE_MODEL', 'openai/gpt-image-2')),
    timeoutMs: intEnv('OMNIROUTE_TIMEOUT_MS', 90000),
    maxRetries: intEnv('OMNIROUTE_MAX_RETRIES', 1),
  };

  const openai = {
    name: 'openai',
    enabled: boolEnv('OPENAI_ENABLED', boolEnv('OPENAI_API_KEY' !== '' ? 'true' : 'false', false) || !!strEnv('OPENAI_API_KEY', '')),
    // OPENAI_ENABLED defaults to true if OPENAI_API_KEY is set, unless explicitly false
    apiKey: strEnv('OPENAI_API_KEY', ''),
    model: strEnv('OPENAI_MODEL', strEnv('OPENAI_IMAGE_MODEL', 'gpt-image-2')),
    timeoutMs: intEnv('OPENAI_TIMEOUT_MS', intEnv('OPENAI_TIMEOUT_MS', 90000)),
    maxRetries: intEnv('OPENAI_MAX_RETRIES', 1),
  };
  // Fix openai.enabled logic: if explicit env set, use it; else auto based on key
  if (process.env.OPENAI_ENABLED !== undefined && process.env.OPENAI_ENABLED !== '') {
    openai.enabled = boolEnv('OPENAI_ENABLED', false);
  } else {
    openai.enabled = !!openai.apiKey;
  }

  const cloudflare = {
    name: 'cloudflare',
    enabled: boolEnv('CLOUDFLARE_ENABLED', !!(strEnv('CLOUDFLARE_API_TOKEN', '') && strEnv('CLOUDFLARE_ACCOUNT_ID', ''))),
    accountId: strEnv('CLOUDFLARE_ACCOUNT_ID', ''),
    apiToken: strEnv('CLOUDFLARE_API_TOKEN', ''),
    imageModel: strEnv('CLOUDFLARE_IMAGE_MODEL', '@cf/black-forest-labs/flux-1-schnell'),
    promptModel: strEnv('CLOUDFLARE_PROMPT_MODEL', '@cf/meta/llama-3.1-8b-instruct'),
    timeoutMs: intEnv('CLOUDFLARE_TIMEOUT_MS', 90000),
    maxRetries: intEnv('CLOUDFLARE_MAX_RETRIES', 1),
  };
  // Allow explicit override
  if (process.env.CLOUDFLARE_ENABLED !== undefined && process.env.CLOUDFLARE_ENABLED !== '') {
    cloudflare.enabled = boolEnv('CLOUDFLARE_ENABLED', false);
  }

  const gemini = {
    name: 'google-gemini',
    enabled: boolEnv('GEMINI_ENABLED', !!strEnv('GEMINI_API_KEY', '')),
    apiKey: strEnv('GEMINI_API_KEY', ''),
    imageModel: strEnv('GEMINI_IMAGE_MODEL', 'gemini-3.1-flash-image'),
    timeoutMs: intEnv('GEMINI_TIMEOUT_MS', 120000),
    maxRetries: intEnv('GEMINI_MAX_RETRIES', 1),
  };
  // Allow explicit override (GEMINI_ENABLED=false disables even with a key present)
  if (process.env.GEMINI_ENABLED !== undefined && process.env.GEMINI_ENABLED !== '') {
    gemini.enabled = boolEnv('GEMINI_ENABLED', false);
  }

  // Strict mode: when true, generateWithFallback uses ONLY the explicitly
  // selected provider and never falls back to others. Intended for provider
  // verification/testing so a PASS cannot come from a different provider.
  // Normal production behavior (fallback chain) is unchanged.
  const strictProvider = boolEnv('AI_PROVIDER_STRICT', false);

  return { aiProvider, omniroute, openai, cloudflare, gemini, strictProvider };
}

function isProviderAvailable(name, cfg) {
  const c = cfg || getConfig();
  if (name === 'omniroute') return c.omniroute.enabled && !!c.omniroute.apiKey && !!c.omniroute.baseUrl;
  if (name === 'openai') return c.openai.enabled && !!c.openai.apiKey;
  if (name === 'cloudflare') return c.cloudflare.enabled && !!c.cloudflare.apiToken && !!c.cloudflare.accountId;
  if (name === 'google-gemini') return c.gemini.enabled && !!c.gemini.apiKey;
  return false;
}

function getAvailableProviders(cfg) {
  const c = cfg || getConfig();
  const list = [];
  if (isProviderAvailable('omniroute', c)) list.push('omniroute');
  if (isProviderAvailable('openai', c)) list.push('openai');
  if (isProviderAvailable('cloudflare', c)) list.push('cloudflare');
  if (isProviderAvailable('google-gemini', c)) list.push('google-gemini');
  return list;
}

function getFallbackOrder(primary, cfg) {
  const c = cfg || getConfig();
  const available = getAvailableProviders(c);
  // Deterministic order: primary first, then remaining in fixed priority
  // omniroute > openai > cloudflare > google-gemini
  const priority = ['omniroute', 'openai', 'cloudflare', 'google-gemini'];
  const ordered = [];
  if (primary && available.includes(primary)) ordered.push(primary);
  for (const p of priority) {
    if (p !== primary && available.includes(p)) ordered.push(p);
  }
  // If primary is auto or not in available, use priority order
  if (!primary || primary === 'auto' || !available.includes(primary)) {
    // Already ordered by priority, but ensure we include all available
    return priority.filter(p => available.includes(p));
  }
  return ordered;
}

module.exports = { getConfig, isProviderAvailable, getAvailableProviders, getFallbackOrder };
