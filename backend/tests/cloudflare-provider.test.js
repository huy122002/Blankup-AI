/**
 * Cloudflare provider tests — MOCK TESTS (HTTP mocked, no real Cloudflare calls).
 * REAL E2E is verified separately via live flux-1-schnell request (see Phase 8/9 report).
 */
const fs = require('fs');
const path = require('path');

const PROVIDER_PATH = path.join(__dirname, '../services/ai-providers/cloudflare.provider.js');
const INDEX_PATH = path.join(__dirname, '../services/ai-providers/index.js');
const CONFIG_PATH = path.join(__dirname, '../services/ai-providers/provider.config.js');

const REAL_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const REAL_JPG_B64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwA/AB//2Q==';

function loadProviderWithEnv(env) {
  jest.resetModules();
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; process.env[k] = env[k]; }
  const { CloudflareProvider } = require('../services/ai-providers/cloudflare.provider');
  const { getConfig } = require('../services/ai-providers/provider.config');
  const cfg = getConfig();
  const provider = new CloudflareProvider(cfg);
  return {
    provider,
    cfg,
    restore() {
      for (const k of Object.keys(env)) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      jest.resetModules();
    },
  };
}

const CF_ENV = {
  CLOUDFLARE_ENABLED: 'true',
  CLOUDFLARE_ACCOUNT_ID: 'test-acct-id',
  CLOUDFLARE_API_TOKEN: 'test-token-not-real',
  CLOUDFLARE_IMAGE_MODEL: '@cf/black-forest-labs/flux-1-schnell',
  AI_PROVIDER: 'cloudflare',
  OMNIROUTE_ENABLED: 'false',
  OPENAI_ENABLED: 'false',
};

describe('MOCK: Cloudflare provider selection & availability', () => {
  it('1. AI_PROVIDER=cloudflare puts cloudflare first with no fallback when others disabled', () => {
    jest.resetModules();
    process.env.CLOUDFLARE_ENABLED = 'true';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'a';
    process.env.CLOUDFLARE_API_TOKEN = 't';
    process.env.AI_PROVIDER = 'cloudflare';
    process.env.OMNIROUTE_ENABLED = 'false';
    process.env.OPENAI_ENABLED = 'false';
    process.env.CLOUDFLARE_ENABLED = 'true';
    const { getFallbackOrder } = require('../services/ai-providers/provider.config');
    expect(getFallbackOrder('cloudflare')).toEqual(['cloudflare']);
    delete process.env.CLOUDFLARE_ENABLED;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.AI_PROVIDER;
    delete process.env.OMNIROUTE_ENABLED;
    delete process.env.OPENAI_ENABLED;
    jest.resetModules();
  });

  it('2. missing account ID → isAvailable false', () => {
    const { provider, restore } = loadProviderWithEnv({ ...CF_ENV, CLOUDFLARE_ACCOUNT_ID: '' });
    expect(provider.isAvailable()).toBe(false);
    restore();
  });

  it('3. missing API token → isAvailable false', () => {
    const { provider, restore } = loadProviderWithEnv({ ...CF_ENV, CLOUDFLARE_API_TOKEN: '' });
    expect(provider.isAvailable()).toBe(false);
    restore();
  });

  it('4. default model is flux-1-schnell when CLOUDFLARE_IMAGE_MODEL unset', () => {
    const env = { ...CF_ENV };
    delete env.CLOUDFLARE_IMAGE_MODEL;
    const { provider, restore } = loadProviderWithEnv(env);
    expect(provider.imageModel).toBe('@cf/black-forest-labs/flux-1-schnell');
    restore();
  });

  it('5. empty prompt → VALIDATION_ERROR non-retryable (MOCK)', async () => {
    const { provider, restore } = loadProviderWithEnv(CF_ENV);
    await expect(provider.generateImage({ prompt: '', designId: 'd1' })).rejects.toMatchObject({
      provider: 'cloudflare',
      code: 'VALIDATION_ERROR',
      retryable: false,
    });
    restore();
  });
});

describe('MOCK: Cloudflare request construction & normalization (fetch mocked)', () => {
  let savedFetch;
  beforeEach(() => { savedFetch = global.fetch; });
  afterEach(() => { global.fetch = savedFetch; });

  function mockFetchOnce(handler) {
    global.fetch = jest.fn().mockImplementation(handler);
  }

  it('6. sends {prompt, steps:4} by default; clamps steps to 1..8 (MOCK)', async () => {
    const { provider, restore } = loadProviderWithEnv(CF_ENV);
    const bodies = [];
    mockFetchOnce(async (url, opts) => {
      bodies.push(JSON.parse(opts.body));
      return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ success: true, result: { image: REAL_PNG_B64 }, errors: [] }) };
    });
    await provider.generateImage({ prompt: 'a', designId: 'mock-steps-1' });
    expect(bodies[0].steps).toBe(4);
    expect(typeof bodies[0].prompt).toBe('string');
    await provider.generateImage({ prompt: 'a', designId: 'mock-steps-2', steps: 99 });
    expect(bodies[1].steps).toBe(8);
    await provider.generateImage({ prompt: 'a', designId: 'mock-steps-3', steps: 0 });
    expect(bodies[2].steps).toBe(4);
    for (const f of ['mock-steps-1.png', 'mock-steps-2.png', 'mock-steps-3.png']) {
      try { fs.unlinkSync(path.join(__dirname, '../uploads', f)); } catch {}
    }
    restore();
  });

  it('7. REAL JPEG bytes normalize to .jpg designUrl, REAL PNG to .png (MOCK transport, REAL bytes)', async () => {
    const { provider, restore } = loadProviderWithEnv(CF_ENV);
    mockFetchOnce(async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ success: true, result: { image: REAL_JPG_B64 }, errors: [] }) }));
    const jpg = await provider.generateImage({ prompt: 'a', designId: 'mock-fmt-jpg' });
    expect(jpg.designUrl).toMatch(/\.jpg$/);
    expect(fs.existsSync(path.join(__dirname, '../uploads', 'mock-fmt-jpg.jpg'))).toBe(true);
    mockFetchOnce(async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ success: true, result: { image: REAL_PNG_B64 }, errors: [] }) }));
    const png = await provider.generateImage({ prompt: 'a', designId: 'mock-fmt-png' });
    expect(png.designUrl).toMatch(/\.png$/);
    for (const f of ['mock-fmt-jpg.jpg', 'mock-fmt-png.png']) {
      try { fs.unlinkSync(path.join(__dirname, '../uploads', f)); } catch {}
    }
    restore();
  });

  it('8. malformed response (success=false, no image) throws non-fake error (MOCK)', async () => {
    const { provider, restore } = loadProviderWithEnv(CF_ENV);
    mockFetchOnce(async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ success: false, errors: [{ code: 9999, message: 'mock bad' }] }) }));
    await expect(provider.generateImage({ prompt: 'a', designId: 'mock-bad' })).rejects.toThrow('mock bad');
    mockFetchOnce(async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ success: true, result: {} }) }));
    await expect(provider.generateImage({ prompt: 'a', designId: 'mock-noimg' })).rejects.toThrow();
    restore();
  });

  it('9. HTTP 500 → retryable, HTTP 401 → non-retryable (MOCK)', async () => {
    const { provider, restore } = loadProviderWithEnv(CF_ENV);
    mockFetchOnce(async () => ({ ok: false, status: 500, headers: { get: () => 'application/json' }, json: async () => ({ success: false }) }));
    await expect(provider.generateImage({ prompt: 'a', designId: 'mock-500' })).rejects.toMatchObject({ retryable: true });
    mockFetchOnce(async () => ({ ok: false, status: 401, headers: { get: () => 'application/json' }, json: async () => ({ success: false }) }));
    await expect(provider.generateImage({ prompt: 'a', designId: 'mock-401' })).rejects.toMatchObject({ retryable: false });
    restore();
  });

  it('10. timeout AbortError → retryable (MOCK)', async () => {
    const { provider, restore } = loadProviderWithEnv({ ...CF_ENV, CLOUDFLARE_TIMEOUT_MS: '30' });
    mockFetchOnce(async (url, opts) => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    });
    await expect(provider.generateImage({ prompt: 'a', designId: 'mock-timeout' })).rejects.toMatchObject({ retryable: true });
    restore();
  });
});

describe('MOCK: strict mode + secrets + existing providers', () => {
  it('11. strict cloudflare-only order contains no omniroute/openai (MOCK config)', () => {
    jest.resetModules();
    process.env.CLOUDFLARE_ENABLED = 'true';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'a';
    process.env.CLOUDFLARE_API_TOKEN = 't';
    process.env.AI_PROVIDER = 'cloudflare';
    process.env.OMNIROUTE_ENABLED = 'false';
    process.env.OPENAI_ENABLED = 'false';
    const { getFallbackOrder } = require('../services/ai-providers/provider.config');
    const order = getFallbackOrder('cloudflare');
    expect(order).toEqual(['cloudflare']);
    delete process.env.CLOUDFLARE_ENABLED;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.AI_PROVIDER;
    delete process.env.OMNIROUTE_ENABLED;
    delete process.env.OPENAI_ENABLED;
    jest.resetModules();
  });

  it('12. secret never in code/logs: no hardcoded token or account id in provider sources', () => {
    const src = fs.readFileSync(PROVIDER_PATH, 'utf8') + fs.readFileSync(INDEX_PATH, 'utf8') + fs.readFileSync(CONFIG_PATH, 'utf8');
    expect(src).not.toMatch(/cfut_[A-Za-z0-9]+/);
    expect(src).not.toMatch(/Bearer [A-Za-z0-9]{10,}/);
    expect(src).not.toMatch(/[a-f0-9]{32}/);
    // logging only safe metadata
    expect(src).not.toMatch(/console\.log\([^)]*apiKey/i);
    expect(src).not.toMatch(/console\.log\([^)]*apiToken/i);
  });

  it('13. existing providers intact: omniroute/openai modules + fallback priority unchanged', () => {
    expect(fs.existsSync(path.join(__dirname, '../services/ai-providers/omniroute.provider.js'))).toBe(true);
    expect(fs.existsSync(path.join(__dirname, '../services/ai-providers/openai.provider.js'))).toBe(true);
    const cfgCode = fs.readFileSync(CONFIG_PATH, 'utf8');
    expect(cfgCode).toContain("['omniroute', 'openai', 'cloudflare']");
  });
});
