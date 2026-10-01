/**
 * AI provider layer — resilience & payload handling.
 *
 * Covers behaviour that a static source-text assertion cannot verify:
 *   - retry of the SAME provider waits for a backoff instead of hammering
 *   - the whole-chain deadline stops the chain instead of stacking timeouts
 *   - a failed chain surfaces every attempt, not just the last message
 *   - a gateway answering with an image URL is downloaded (never base64-decoded)
 *   - image generation reads the DEDICATED image model/size config slot
 */
const fs = require('fs');
const path = require('path');

const UPLOADS = path.join(__dirname, '../uploads');

// A real PNG signature + body, so magic-byte detection can be asserted.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03, 0x04]);
const PNG_B64 = PNG.toString('base64');

const BASE_ENV = {
  AI_PROVIDER: 'cloudflare',
  CLOUDFLARE_ENABLED: 'true',
  CLOUDFLARE_ACCOUNT_ID: 'test-account',
  CLOUDFLARE_API_TOKEN: 'test-token',
  OMNIROUTE_ENABLED: 'true',
  OMNIROUTE_BASE_URL: 'http://localhost:20128/v1',
  OMNIROUTE_API_KEY: 'sk-test-omni',
  OPENAI_ENABLED: 'false',
  GEMINI_ENABLED: 'false',
  ENABLE_AI_PROMPT_ENHANCER: 'false',
};

const MANAGED_KEYS = [
  ...Object.keys(BASE_ENV),
  'AI_CHAIN_TIMEOUT_MS',
  'AI_RETRY_BACKOFF_MS',
  'CLOUDFLARE_MAX_RETRIES',
  'CLOUDFLARE_TIMEOUT_MS',
  'OMNIROUTE_MAX_RETRIES',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'OPENAI_IMAGE_MODEL',
  'OPENAI_IMAGE_SIZE',
];

const realFetch = global.fetch;
const createdFiles = [];

function setEnv(extra = {}) {
  MANAGED_KEYS.forEach((k) => delete process.env[k]);
  Object.entries({ ...BASE_ENV, ...extra }).forEach(([k, v]) => {
    process.env[k] = String(v);
  });
  jest.resetModules();
}

function loadProviders() {
  // eslint-disable-next-line global-require
  return require('../services/ai-providers');
}

function trackDesign(designId, ext = 'png') {
  createdFiles.push(path.join(UPLOADS, `${designId}.${ext}`));
}

/** fetch that never settles on its own but rejects once the signal aborts. */
function mockAbortableFetch() {
  global.fetch = jest.fn((url, opts = {}) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ ok: true, status: 200, json: async () => ({}) }), 30000);
    if (opts.signal) {
      opts.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    }
  }));
}

function mockCloudflare429() {
  global.fetch = jest.fn(async () => ({
    ok: false,
    status: 429,
    headers: { get: () => 'application/json' },
    json: async () => ({ success: false, errors: [{ message: 'rate limited' }] }),
  }));
}

afterEach(() => {
  createdFiles.splice(0).forEach((f) => {
    try { fs.unlinkSync(f); } catch { /* file may not exist */ }
  });
});

afterAll(() => {
  MANAGED_KEYS.forEach((k) => delete process.env[k]);
  global.fetch = realFetch;
  jest.resetModules();
});

describe('Chain deadline', () => {
  it('stops the chain instead of stacking a second provider timeout', async () => {
    setEnv({ AI_CHAIN_TIMEOUT_MS: '1000', CLOUDFLARE_TIMEOUT_MS: '5000', AI_RETRY_BACKOFF_MS: '0' });
    mockAbortableFetch();
    const { generateWithFallback } = loadProviders();

    let err;
    try {
      await generateWithFallback({ prompt: 'a cat', style: 'line art', designId: 'test-deadline', requestId: 'rid-deadline' });
    } catch (e) {
      err = e;
    }

    expect(err).toBeDefined();
    expect(err.code).toBe('ALL_PROVIDERS_FAILED');
    expect(err.requestId).toBe('rid-deadline');
    // The second provider must be skipped for lack of budget, not given a fresh timeout.
    expect(err.attempts.some((a) => a.skipped && a.reason === 'chain_deadline_exceeded')).toBe(true);
  }, 15000);
});

describe('Retry backoff', () => {
  it('retries the same provider after a delay, not instantly', async () => {
    setEnv({ OMNIROUTE_ENABLED: 'false', AI_RETRY_BACKOFF_MS: '200', CLOUDFLARE_MAX_RETRIES: '1' });
    mockCloudflare429();
    const { generateWithFallback } = loadProviders();

    const started = Date.now();
    await expect(
      generateWithFallback({ prompt: 'a cat', style: 'line art', designId: 'test-backoff' })
    ).rejects.toMatchObject({ code: 'ALL_PROVIDERS_FAILED' });
    const elapsed = Date.now() - started;

    // 1 initial attempt + exactly 1 retry on the only enabled provider.
    expect(global.fetch).toHaveBeenCalledTimes(2);
    // Full jitter never returns less than half the nominal 200ms backoff.
    expect(elapsed).toBeGreaterThanOrEqual(90);
  }, 15000);
});

describe('Failure reporting', () => {
  it('surfaces every attempt and the provider-specific reason', async () => {
    setEnv({ OMNIROUTE_ENABLED: 'false', AI_RETRY_BACKOFF_MS: '0', CLOUDFLARE_MAX_RETRIES: '1' });
    mockCloudflare429();
    const { generateWithFallback } = loadProviders();

    let err;
    try {
      await generateWithFallback({ prompt: 'a cat', designId: 'test-report', requestId: 'rid-report' });
    } catch (e) {
      err = e;
    }

    expect(err.code).toBe('ALL_PROVIDERS_FAILED');
    expect(Array.isArray(err.attempts)).toBe(true);
    expect(err.attempts.length).toBe(2);
    expect(err.attempts.every((a) => a.provider === 'cloudflare')).toBe(true);
    expect(err.message).toContain('cloudflare#1=');
    expect(err.message).toContain('rate limited');
    expect(err.requestId).toBe('rid-report');
  }, 15000);

  it('fails closed without any network call when no provider is usable', async () => {
    setEnv({
      AI_PROVIDER: 'openai',
      OPENAI_ENABLED: 'true',
      OPENAI_API_KEY: '', // enabled but keyless → not available
      OMNIROUTE_ENABLED: 'false',
      CLOUDFLARE_ENABLED: 'false',
    });
    global.fetch = jest.fn();
    const { generateWithFallback } = loadProviders();

    let err;
    try {
      await generateWithFallback({ prompt: 'a cat', designId: 'test-no-provider' });
    } catch (e) {
      err = e;
    }

    expect(err.code).toBe('ALL_PROVIDERS_FAILED');
    expect(err.message).toContain('All AI providers unavailable');
    // Never fake a success, and never pay for an upstream call.
    expect(global.fetch).not.toHaveBeenCalled();
  }, 15000);
});

describe('OmniRoute payload handling', () => {
  it('downloads an image URL instead of base64-decoding it', async () => {
    setEnv({ CLOUDFLARE_ENABLED: 'false', OPENAI_ENABLED: 'false' });
    global.fetch = jest.fn(async (url) => {
      if (String(url).includes('/images/generations')) {
        return { ok: true, status: 200, json: async () => ({ data: [{ url: 'http://example.test/out.png' }] }) };
      }
      return { ok: true, status: 200, arrayBuffer: async () => PNG };
    });

    const { OmniRouteProvider } = require('../services/ai-providers/omniroute.provider');
    const { getConfig } = require('../services/ai-providers/provider.config');
    const provider = new OmniRouteProvider(getConfig());

    const designId = `test-omni-url-${Date.now()}`;
    trackDesign(designId);
    const result = await provider.generateImage({ prompt: 'a cat', designId, finalPrompt: 'a cat' });

    expect(result.designUrl).toBe(`/uploads/${designId}.png`);
    // The bytes on disk are the downloaded image — NOT the URL string.
    expect(fs.readFileSync(path.join(UPLOADS, `${designId}.png`)).equals(PNG)).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  }, 15000);

  it('uses inline base64 without any extra network call', async () => {
    setEnv({ CLOUDFLARE_ENABLED: 'false', OPENAI_ENABLED: 'false' });
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ b64_json: PNG_B64 }] }),
    }));

    const { OmniRouteProvider } = require('../services/ai-providers/omniroute.provider');
    const { getConfig } = require('../services/ai-providers/provider.config');
    const provider = new OmniRouteProvider(getConfig());

    const designId = `test-omni-b64-${Date.now()}`;
    trackDesign(designId);
    const result = await provider.generateImage({ prompt: 'a cat', designId, finalPrompt: 'a cat' });

    expect(result.designUrl).toBe(`/uploads/${designId}.png`);
    expect(fs.readFileSync(path.join(UPLOADS, `${designId}.png`)).equals(PNG)).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  }, 15000);

  it('fails clearly (non-retryable) when the response carries no image', async () => {
    setEnv({ CLOUDFLARE_ENABLED: 'false', OPENAI_ENABLED: 'false' });
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [{}] }) }));

    const { OmniRouteProvider } = require('../services/ai-providers/omniroute.provider');
    const { getConfig } = require('../services/ai-providers/provider.config');
    const provider = new OmniRouteProvider(getConfig());

    await expect(
      provider.generateImage({ prompt: 'a cat', designId: 'test-omni-empty', finalPrompt: 'a cat' })
    ).rejects.toMatchObject({ code: 'OMNIROUTE_ERROR', retryable: false });
  }, 15000);
});

describe('OpenAI image slot plumbing', () => {
  it('sends OPENAI_IMAGE_MODEL and OPENAI_IMAGE_SIZE, not the text model', async () => {
    setEnv({
      AI_PROVIDER: 'openai',
      OPENAI_ENABLED: 'true',
      OPENAI_API_KEY: 'sk-test-openai',
      OPENAI_MODEL: 'gpt-4o',
      OPENAI_IMAGE_MODEL: 'gpt-image-9',
      OPENAI_IMAGE_SIZE: '512x512',
    });
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [{ b64_json: PNG_B64 }] }) }));

    const { OpenAIProvider } = require('../services/ai-providers/openai.provider');
    const { getConfig } = require('../services/ai-providers/provider.config');
    const provider = new OpenAIProvider(getConfig());

    const designId = `test-openai-slot-${Date.now()}`;
    trackDesign(designId);
    await provider.generateImage({ prompt: 'a cat', designId, finalPrompt: 'a cat' });

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.model).toBe('gpt-image-9');
    expect(body.size).toBe('512x512');
  }, 15000);
});

describe('Quota exhaustion is not retried', () => {
  const { isQuotaExhaustedError } = require('../services/ai-providers/base.provider');

  it('matches the payloads real providers actually return', () => {
    // Verbatim messages observed from OpenAI/Direct, OmniRoute and Gemini free tier.
    expect(isQuotaExhaustedError(429, 'You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.')).toBe(true);
    expect(isQuotaExhaustedError(429, 'Rate limit exceeded for model gemini-3.1-flash-image (limit: 0 requests per day on Free Tier).')).toBe(true);
    expect(isQuotaExhaustedError(429, 'insufficient_quota')).toBe(true);
  });

  it('leaves ordinary rate limiting retryable', () => {
    expect(isQuotaExhaustedError(429, 'Rate limit reached for requests. Please try again in 20ms.')).toBe(false);
    expect(isQuotaExhaustedError(500, 'insufficient_quota')).toBe(false);
    expect(isQuotaExhaustedError(undefined, 'You have no credits remaining.')).toBe(false);
  });

  it('skips the wasted retry and moves on to the next provider', async () => {
    setEnv({ AI_RETRY_BACKOFF_MS: '2000', CLOUDFLARE_MAX_RETRIES: '1' });
    global.fetch = jest.fn(async (url) => {
      if (String(url).includes('cloudflare.com')) {
        return {
          ok: false,
          status: 429,
          headers: { get: () => 'application/json' },
          json: async () => ({ success: false, errors: [{ message: 'Free tier quota exhausted' }] }),
        };
      }
      return {
        ok: false,
        status: 429,
        json: async () => ({ error: { message: 'You have no credits remaining. Add credits to continue using the API at billing/', type: 'insufficient_quota' } }),
      };
    });

    const { generateWithFallback } = loadProviders();
    const started = Date.now();
    let err;
    try {
      await generateWithFallback({ prompt: 'a cat', designId: 'test-quota' });
    } catch (e) {
      err = e;
    }
    const elapsed = Date.now() - started;

    expect(err.code).toBe('ALL_PROVIDERS_FAILED');
    // Exactly one attempt each: no retry budget burned, no 2s backoff waited.
    expect(err.attempts.filter((a) => a.provider === 'cloudflare').length).toBe(1);
    expect(err.attempts.filter((a) => a.provider === 'omniroute').length).toBe(1);
    expect(elapsed).toBeLessThan(2000);
  }, 15000);
});
