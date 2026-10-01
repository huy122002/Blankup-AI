// backend/services/ai-providers/index.js
// AI Provider Abstraction Layer — orchestrates OmniRoute / OpenAI Direct / Cloudflare
const crypto = require('crypto');
const { getConfig, getFallbackOrder, isProviderAvailable, getAvailableProviders } = require('./provider.config');
const { CloudflareProvider } = require('./cloudflare.provider');
const { OpenAIProvider } = require('./openai.provider');
const { OmniRouteProvider } = require('./omniroute.provider');
const { GeminiProvider } = require('./gemini.provider');
const { AIProviderError } = require('./base.provider');

function createProviders(cfg) {
  const c = cfg || getConfig();
  return {
    omniroute: new OmniRouteProvider(c),
    openai: new OpenAIProvider(c),
    cloudflare: new CloudflareProvider(c),
    'google-gemini': new GeminiProvider(c),
  };
}

function getProviderInstance(name, cfg) {
  const providers = createProviders(cfg);
  return providers[name] || null;
}

// Core: generate with fallback, retry per provider, loop prevention, observability
async function generateWithFallback({ prompt, style, designId, file, idea, enhancedPrompt, finalPrompt, finalProductPrompt, isFromImage = false, requestId }) {
  const cfg = getConfig();
  const primary = (cfg.aiProvider || 'auto').toLowerCase();
  // Strict mode (AI_PROVIDER_STRICT=true): only the explicitly selected provider
  // is used — no fallback. Used for provider-specific verification so a PASS
  // cannot silently come from another provider. Production behavior unchanged.
  const fallbackOrder = cfg.strictProvider
    ? [primary]
    : getFallbackOrder(primary === 'auto' ? null : primary, cfg);
  // If AI_PROVIDER is explicit and available, order already starts with it. If auto, order is priority list.

  // Also support direct selection: if AI_PROVIDER is explicit, we treat fallbackOrder as [primary, ...others]
  // For auto, fallbackOrder is all available in priority order.

  const visited = new Set();
  const attempts = [];
  const rid = requestId || crypto.randomBytes(8).toString('hex');
  let lastError = null;

  // Whole-chain budget. Without it, 4 providers × (1 + maxRetries) attempts ×
  // 90–120s each could hold the request (and an already-deducted credit) for
  // many minutes. When the budget is gone we stop and let the caller refund.
  const chainTimeoutMs = Math.max(1000, Number(cfg.chainTimeoutMs) || 180000);
  const chainDeadline = Date.now() + chainTimeoutMs;
  const retryBackoffMs = Math.max(0, Number(cfg.retryBackoffMs) || 0);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  for (const providerName of fallbackOrder) {
    if (visited.has(providerName)) continue;
    visited.add(providerName);
    const provider = getProviderInstance(providerName, cfg);
    if (!provider || !provider.isAvailable()) {
      attempts.push({ provider: providerName, skipped: true, reason: 'not_available' });
      continue;
    }

    // Per-provider retry budget, read from cfg.<provider>.maxRetries.
    const maxR = (() => {
      if (providerName === 'omniroute') return cfg.omniroute.maxRetries;
      if (providerName === 'openai') return cfg.openai.maxRetries;
      if (providerName === 'cloudflare') return cfg.cloudflare.maxRetries;
      if (providerName === 'google-gemini') return cfg.gemini.maxRetries;
      return 0;
    })();
    const retries = Math.max(0, maxR);

    if (Date.now() >= chainDeadline) {
      attempts.push({ provider: providerName, skipped: true, reason: 'chain_deadline_exceeded' });
      console.warn(`[AI-Provider] requestId=${rid} provider=${providerName} skipped=chain_deadline_exceeded`);
      continue;
    }
    // Clamp this provider's per-attempt timeout to the remaining chain budget so
    // one slow upstream cannot overshoot the deadline by minutes. Providers read
    // this.timeoutMs per call (Gemini reads it when it lazily builds its client),
    // and instances are created fresh per request, so this mutation is contained.
    const chainRemaining = chainDeadline - Date.now();
    if (typeof provider.timeoutMs === 'number' && provider.timeoutMs > chainRemaining) {
      provider.timeoutMs = Math.max(1000, chainRemaining);
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
      const attemptNum = attempt + 1;
      const start = Date.now();
      try {
        let result;
        if (isFromImage) {
          result = await provider.generateFromImage({ file, idea, designId, finalPrompt: enhancedPrompt || finalPrompt, prompt, style });
        } else {
          result = await provider.generateImage({ prompt, style, designId, finalPrompt: enhancedPrompt || finalPrompt, finalProductPrompt });
        }
        const latency = Date.now() - start;
        console.log(`[AI-Provider] requestId=${rid} provider=${providerName} attempt=${attemptNum} latency=${latency}ms success=true model=${provider.config[providerName]?.model || provider.config[providerName]?.imageModel || 'unknown'}`);
        // Also try product mockup if provider supports (optional, non-blocking)
        // Product mockup is handled outside? For now return main designUrl and let caller handle mockup via separate provider call if needed
        return { success: true, provider: providerName, attempt: attemptNum, requestId: rid, designUrl: result.designUrl, finalPrompt: result.finalPrompt, attempts };
      } catch (e) {
        const latency = Date.now() - start;
        const isRetryable = e.retryable === true;
        console.warn(`[AI-Provider] requestId=${rid} provider=${providerName} attempt=${attemptNum} latency=${latency}ms success=false error=${e.message} retryable=${isRetryable}`);
        lastError = e;
        attempts.push({ provider: providerName, attempt: attemptNum, error: e.message, retryable: isRetryable, latency });
        if (!isRetryable || attempt >= retries) break; // fallback to next provider
        // Retry the SAME provider, never instantly: a 429 or 5xx needs room to
        // breathe, and full jitter keeps parallel requests from re-syncing.
        const backoff = retryBackoffMs * Math.pow(2, attempt);
        const jittered = Math.round(backoff * (0.5 + Math.random() * 0.5));
        if (Date.now() + jittered >= chainDeadline) {
          attempts.push({ provider: providerName, attempt: attemptNum, error: 'chain_deadline_exceeded_before_retry' });
          break;
        }
        if (jittered > 0) await sleep(jittered);
      }
    }
  }

  // All providers exhausted. Surface the full attempt history (bounded) instead of
  // only the last message, so operations can see WHICH provider failed on WHAT.
  const summary = attempts
    .slice(-8)
    .map((a) => (a.skipped ? `${a.provider}=skipped(${a.reason})` : `${a.provider}#${a.attempt}=${a.error}`))
    .join(' | ');
  const allErr = lastError ? lastError.message : 'All AI providers unavailable';
  const chainErr = new AIProviderError({
    provider: 'all',
    code: 'ALL_PROVIDERS_FAILED',
    message: summary ? `${allErr} [${summary}]` : allErr,
    retryable: false,
  });
  // Keep structured attempts on the error so callers/logs can inspect them.
  chainErr.attempts = attempts;
  chainErr.requestId = rid;
  throw chainErr;
}

// Helper to check if any provider is available (for health)
function hasAvailableProvider() {
  const cfg = getConfig();
  return getFallbackOrder(null, cfg).length > 0;
}

// Read-only snapshot of the provider wiring, for the admin diagnostics endpoint.
// Reports availability and non-secret metadata only — never credentials.
function getProviderHealth() {
  const cfg = getConfig();
  const sections = { omniroute: 'omniroute', openai: 'openai', cloudflare: 'cloudflare', 'google-gemini': 'gemini' };
  const providers = Object.keys(sections).map((name) => {
    const c = cfg[sections[name]];
    let model = c.model || null;
    if (name === 'cloudflare' || name === 'google-gemini') model = c.imageModel;
    else if (name === 'openai') model = c.imageModel || c.model;
    return {
      name,
      enabled: Boolean(c.enabled),
      available: isProviderAvailable(name, cfg),
      model,
      timeoutMs: c.timeoutMs ?? null,
      maxRetries: c.maxRetries ?? null,
    };
  });
  const primary = cfg.aiProvider === 'auto' ? null : cfg.aiProvider;
  return {
    aiProvider: cfg.aiProvider,
    strictProvider: Boolean(cfg.strictProvider),
    chainTimeoutMs: cfg.chainTimeoutMs,
    retryBackoffMs: cfg.retryBackoffMs,
    availableProviders: getAvailableProviders(cfg),
    fallbackOrder: getFallbackOrder(primary, cfg),
    providers,
  };
}

module.exports = {
  getConfig,
  isProviderAvailable,
  getFallbackOrder,
  createProviders,
  getProviderInstance,
  generateWithFallback,
  hasAvailableProvider,
  getProviderHealth,
  AIProviderError,
};
