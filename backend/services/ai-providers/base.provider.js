// backend/services/ai-providers/base.provider.js
class AIProviderError extends Error {
  constructor({ provider, code, message, retryable = false, statusCode = 500 }) {
    super(message);
    this.name = 'AIProviderError';
    this.provider = provider;
    this.code = code;
    this.retryable = retryable;
    this.statusCode = statusCode;
  }
}

class BaseAIProvider {
  constructor(name, config) {
    this.name = name;
    this.config = config;
  }

  getName() {
    return this.name;
  }

  // Must be overridden: true if provider can be called (enabled + has required keys)
  isAvailable() {
    return false;
  }

  // Generate image from prompt. Must return { designUrl, finalPrompt? } or throw AIProviderError
  // opts: { prompt, style, designId, enhancedPrompt? }
  async generateImage(opts) {
    throw new AIProviderError({ provider: this.name, code: 'NOT_IMPLEMENTED', message: 'generateImage not implemented', retryable: false });
  }

  // Generate from image (multipart). opts: { file, idea, designId }
  async generateFromImage(opts) {
    throw new AIProviderError({ provider: this.name, code: 'NOT_IMPLEMENTED', message: 'generateFromImage not implemented', retryable: false });
  }

  // Optional: generate product mockup? If provider supports, else can no-op
  async generateProductMockup(opts) {
    return null;
  }
}

// A 429 is normally retryable (rate limit). A 429 caused by an EXHAUSTED QUOTA or a
// billing problem is not: retrying cannot succeed and only delays the fallback to the
// next provider. Observed real payloads this matches:
//   OpenAI  : "You have no credits remaining. Add credits ... billing/."
//   Gemini  : "429 Rate limit exceeded ... (limit: 0 requests per day on Free Tier)"
// status 402 is included because some gateways report exhausted credit as Payment Required.
const QUOTA_EXHAUSTED_PATTERNS = [
  /insufficient_quota/i,
  /no credits remaining/i,
  /exceeded your current quota/i,
  /quota exceeded/i,
  /limit:\s*0\s+(requests|input tokens)/i,
  /free tier/i,
  /billing/i,
];

function isQuotaExhaustedError(statusCode, message) {
  const status = Number(statusCode);
  if (status !== 429 && status !== 402) return false;
  const msg = String(message || '');
  return QUOTA_EXHAUSTED_PATTERNS.some((re) => re.test(msg));
}

module.exports = { BaseAIProvider, AIProviderError, isQuotaExhaustedError };
