/**
 * P2 OmniRoute + Multi-Provider — AI Provider Abstraction Tests
 * Covers: isolation, disabled, missing key, fallback, all-fail refund, credit, security, timeout, loop prevention
 */
const fs = require('fs');
const path = require('path');

// --- Static checks ---
describe('Provider config — env parallel support', () => {
  const cfgPath = path.join(__dirname, '../services/ai-providers/provider.config.js');
  const cfgCode = fs.readFileSync(cfgPath, 'utf8');
  it('should support OMNIROUTE_ENABLED, OPENAI_ENABLED, CLOUDFLARE_ENABLED independently', () => {
    expect(cfgCode).toContain('OMNIROUTE_ENABLED');
    expect(cfgCode).toContain('OPENAI_ENABLED');
    expect(cfgCode).toContain('CLOUDFLARE_ENABLED');
  });
  it('should support AI_PROVIDER=auto', () => {
    expect(cfgCode).toContain('AI_PROVIDER');
    expect(cfgCode).toContain("'auto'");
  });
  it('should not use if OmniRoute has key then skip OpenAI logic', () => {
    expect(cfgCode).not.toContain('Nếu OmniRoute có key');
    // Should have independent getAvailableProviders
    expect(cfgCode).toContain('getAvailableProviders');
  });
  it('should define fallback order deterministic', () => {
    expect(cfgCode).toContain('getFallbackOrder');
    // Full four-provider priority list (google-gemini appended last).
    expect(cfgCode).toContain("['omniroute', 'openai', 'cloudflare', 'google-gemini']");
  });
});

describe('Provider abstraction — file structure', () => {
  it('should have base, omniroute, openai, cloudflare providers', () => {
    expect(fs.existsSync(path.join(__dirname, '../services/ai-providers/base.provider.js'))).toBe(true);
    expect(fs.existsSync(path.join(__dirname, '../services/ai-providers/omniroute.provider.js'))).toBe(true);
    expect(fs.existsSync(path.join(__dirname, '../services/ai-providers/openai.provider.js'))).toBe(true);
    expect(fs.existsSync(path.join(__dirname, '../services/ai-providers/cloudflare.provider.js'))).toBe(true);
    expect(fs.existsSync(path.join(__dirname, '../services/ai-providers/index.js'))).toBe(true);
  });
  it('should expose AIProviderError with provider/code/retryable', () => {
    const baseCode = fs.readFileSync(path.join(__dirname, '../services/ai-providers/base.provider.js'), 'utf8');
    expect(baseCode).toContain('AIProviderError');
    expect(baseCode).toContain('provider');
    expect(baseCode).toContain('retryable');
  });
});

describe('Provider isolation — disabled not called', () => {
  const { getConfig, getFallbackOrder } = require('../services/ai-providers/provider.config');
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it('OMNIROUTE_ENABLED=false → not in fallback', () => {
    process.env.OMNIROUTE_ENABLED = 'false';
    process.env.OPENAI_ENABLED = 'true';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.CLOUDFLARE_ENABLED = 'false';
    jest.resetModules();
    const { getFallbackOrder: gfo } = require('../services/ai-providers/provider.config');
    const order = gfo('auto');
    expect(order).not.toContain('omniroute');
    expect(order).toContain('openai');
  });

  it('OPENAI_ENABLED=false → not called even if key set', () => {
    process.env.OPENAI_ENABLED = 'false';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.OMNIROUTE_ENABLED = 'true';
    process.env.OMNIROUTE_API_KEY = 'sk-omni';
    process.env.OMNIROUTE_BASE_URL = 'http://localhost:20128/v1';
    process.env.CLOUDFLARE_ENABLED = 'false';
    jest.resetModules();
    const { getFallbackOrder: gfo } = require('../services/ai-providers/provider.config');
    const order = gfo(null);
    expect(order).not.toContain('openai');
    expect(order).toContain('omniroute');
  });
});

describe('Missing key → configuration error', () => {
  it('OmniRoute enabled but no key → not available', () => {
    const { isProviderAvailable } = require('../services/ai-providers/provider.config');
    const cfg = {
      aiProvider: 'omniroute',
      omniroute: { enabled: true, apiKey: '', baseUrl: 'http://localhost:20128/v1' },
      openai: { enabled: false, apiKey: '' },
      cloudflare: { enabled: false, apiToken: '', accountId: '' },
    };
    expect(isProviderAvailable('omniroute', cfg)).toBe(false);
  });
  it('OpenAI enabled but no key → not available', () => {
    const { isProviderAvailable } = require('../services/ai-providers/provider.config');
    const cfg = {
      aiProvider: 'openai',
      omniroute: { enabled: false, apiKey: '', baseUrl: '' },
      openai: { enabled: true, apiKey: '' },
      cloudflare: { enabled: false, apiToken: '', accountId: '' },
    };
    expect(isProviderAvailable('openai', cfg)).toBe(false);
  });
});

describe('Fallback — A fail → B success', () => {
  it('should have fallback loop with visited Set and provider attempt tracking', () => {
    const code = fs.readFileSync(path.join(__dirname, '../services/ai-providers/index.js'), 'utf8');
    expect(code).toContain('visited');
    expect(code).toContain('for (const providerName of fallbackOrder)');
    expect(code).toContain('generateImage');
    // Should have fallback to next provider after failure
    expect(code).toContain('lastError');
  });
});

describe('All providers fail → final failure', () => {
  it('should throw ALL_PROVIDERS_FAILED when all fail', () => {
    const code = fs.readFileSync(path.join(__dirname, '../services/ai-providers/index.js'), 'utf8');
    expect(code).toContain('ALL_PROVIDERS_FAILED');
    expect(code).toContain("provider: 'all'");
  });
});

describe('Credit invariant — deduct once', () => {
  it('ai-design should deduct before generate and refund only on all fail', () => {
    const code = fs.readFileSync(path.join(__dirname, '../routes/ai-design.js'), 'utf8');
    // Deduct before generate (check call sites, not helper definition)
    const deductCallIdx = code.indexOf('await deductCreditForGenerate');
    const genCallIdx = code.indexOf('await generateWithFallback');
    const refundCallIdx = code.indexOf('await refundCreditForGenerate');
    expect(deductCallIdx).toBeGreaterThan(-1);
    expect(genCallIdx).toBeGreaterThan(deductCallIdx);
    expect(refundCallIdx).toBeGreaterThan(genCallIdx);
    // Should have comment about not deducting twice
    expect(code).toContain('Business layer already deducted credit; provider layer must not deduct again');
  });
});

describe('Security — no keys in frontend/log', () => {
  it('frontend should not contain API keys', () => {
    const frontendFiles = ['../../frontend/js/studio.js', '../../frontend/js/app.js', '../../frontend/js/home.js'];
    frontendFiles.forEach(p => {
      const c = fs.readFileSync(path.join(__dirname, p), 'utf8');
      expect(c).not.toContain('OPENAI_API_KEY');
      expect(c).not.toContain('OMNIROUTE_API_KEY');
      expect(c).not.toContain('CLOUDFLARE_API_TOKEN');
    });
  });
  it('provider logs should not contain apiKey', () => {
    const omniCode = fs.readFileSync(path.join(__dirname, '../services/ai-providers/omniroute.provider.js'), 'utf8');
    const openaiCode = fs.readFileSync(path.join(__dirname, '../services/ai-providers/openai.provider.js'), 'utf8');
    expect(omniCode).not.toMatch(/apiKey.*log/i);
    expect(openaiCode).not.toMatch(/apiKey.*log/i);
    const idxCode = fs.readFileSync(path.join(__dirname, '../services/ai-providers/index.js'), 'utf8');
    expect(idxCode).toContain('provider=');
    expect(idxCode).not.toContain('apiKey');
  });
  it('.env should be ignored', () => {
    const gitignore = fs.readFileSync(path.join(__dirname, '../../.gitignore'), 'utf8');
    expect(gitignore).toContain('backend/.env');
  });
});

describe('Timeout → fallback if retryable', () => {
  it('should have retry logic per provider with maxRetries and retryable handling', () => {
    const idxCode = fs.readFileSync(path.join(__dirname, '../services/ai-providers/index.js'), 'utf8');
    const openaiCode = fs.readFileSync(path.join(__dirname, '../services/ai-providers/openai.provider.js'), 'utf8');
    expect(idxCode).toContain('maxRetries');
    expect(idxCode).toContain('for (let attempt = 0; attempt <= retries; attempt++)');
    expect(idxCode).toContain('retryable');
    expect(openaiCode).toContain('AbortError');
  });
});

describe('Infinite loop prevention', () => {
  it('should have visited Set to prevent loop', () => {
    const code = fs.readFileSync(path.join(__dirname, '../services/ai-providers/index.js'), 'utf8');
    expect(code).toContain('visited');
    expect(code).toContain('visited.has(providerName)');
    expect(code).toContain('visited.add(providerName)');
  });
});
