// backend/services/ai-providers/index.js
// AI Provider Abstraction Layer — orchestrates OmniRoute / OpenAI Direct / Cloudflare
const crypto = require('crypto');
const { getConfig, getFallbackOrder, isProviderAvailable } = require('./provider.config');
const { CloudflareProvider } = require('./cloudflare.provider');
const { OpenAIProvider } = require('./openai.provider');
const { OmniRouteProvider } = require('./omniroute.provider');
const { AIProviderError } = require('./base.provider');

function createProviders(cfg) {
  const c = cfg || getConfig();
  return {
    omniroute: new OmniRouteProvider(c),
    openai: new OpenAIProvider(c),
    cloudflare: new CloudflareProvider(c),
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
  const fallbackOrder = getFallbackOrder(primary === 'auto' ? null : primary, cfg);
  // If AI_PROVIDER is explicit and available, order already starts with it. If auto, order is priority list.

  // Also support direct selection: if AI_PROVIDER is explicit, we treat fallbackOrder as [primary, ...others]
  // For auto, fallbackOrder is all available in priority order.

  const visited = new Set();
  const attempts = [];
  const rid = requestId || crypto.randomBytes(8).toString('hex');
  let lastError = null;

  for (const providerName of fallbackOrder) {
    if (visited.has(providerName)) continue;
    visited.add(providerName);
    const provider = getProviderInstance(providerName, cfg);
    if (!provider || !provider.isAvailable()) {
      attempts.push({ provider: providerName, skipped: true, reason: 'not_available' });
      continue;
    }

    const maxRetries = provider.config[providerName]?.maxRetries ?? 1;
    // Actually config structure: cfg.omniroute.maxRetries etc.
    // Let's get correctly:
    const maxR = (() => {
      if (providerName === 'omniroute') return cfg.omniroute.maxRetries;
      if (providerName === 'openai') return cfg.openai.maxRetries;
      if (providerName === 'cloudflare') return cfg.cloudflare.maxRetries;
      return 0;
    })();
    const retries = Math.max(0, maxR);

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
        // else retry same provider
      }
    }
  }

  // All providers exhausted
  const allErr = lastError ? lastError.message : 'All AI providers unavailable';
  throw new AIProviderError({ provider: 'all', code: 'ALL_PROVIDERS_FAILED', message: allErr, retryable: false });
}

// Helper to check if any provider is available (for health)
function hasAvailableProvider() {
  const cfg = getConfig();
  return getFallbackOrder(null, cfg).length > 0;
}

module.exports = {
  getConfig,
  isProviderAvailable,
  getFallbackOrder,
  createProviders,
  getProviderInstance,
  generateWithFallback,
  hasAvailableProvider,
  AIProviderError,
};
