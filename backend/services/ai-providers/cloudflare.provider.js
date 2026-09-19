// backend/services/ai-providers/cloudflare.provider.js
const fs = require('fs');
const path = require('path');
const { BaseAIProvider, AIProviderError } = require('./base.provider');

const uploadsDir = path.join(__dirname, '../../uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

function detectImageExt(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'png';
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'jpg';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'gif';
  if (buffer.slice(0, 4).toString() === 'RIFF' && buffer.slice(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

function saveGeneratedImage(base64Image, designId) {
  if (!base64Image) throw new Error('AI response did not include image data.');
  return saveGeneratedImageBuffer(Buffer.from(base64Image, 'base64'), designId);
}
function saveGeneratedImageBuffer(buffer, designId) {
  if (!buffer || !buffer.length) throw new Error('AI response did not include image data.');
  // REAL flux-1-schnell returns JPEG — never blindly label bytes as PNG.
  const ext = detectImageExt(buffer) || 'png';
  const fileName = `${designId}.${ext}`;
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

async function postCloudflareJson(accountId, apiToken, model, body, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('image/')) {
      if (!resp.ok) throw new Error(`Cloudflare request failed with status ${resp.status}`);
      return { imageBuffer: Buffer.from(await resp.arrayBuffer()) };
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.success === false) {
      const msg = data.errors?.[0]?.message || data.error || `Cloudflare request failed with status ${resp.status}`;
      const err = new Error(msg);
      err.statusCode = resp.status;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

class CloudflareProvider extends BaseAIProvider {
  constructor(config) {
    super('cloudflare', config);
    this.accountId = config.cloudflare.accountId;
    this.apiToken = config.cloudflare.apiToken;
    this.imageModel = config.cloudflare.imageModel;
    this.timeoutMs = config.cloudflare.timeoutMs || 90000;
  }

  isAvailable() {
    return this.config.cloudflare.enabled && !!this.apiToken && !!this.accountId && typeof fetch === 'function';
  }

  async generateImage({ prompt, designId, finalPrompt, steps }) {
    if (!this.isAvailable()) {
      throw new AIProviderError({ provider: this.name, code: 'CONFIG_ERROR', message: 'Cloudflare not configured', retryable: false });
    }
    // flux-1-schnell constraints: prompt required, max 2048 chars; steps default 4, max 8.
    const text = String(finalPrompt || prompt || '').slice(0, 2048);
    if (!text) {
      throw new AIProviderError({ provider: this.name, code: 'VALIDATION_ERROR', message: 'A prompt is required.', retryable: false });
    }
    const nSteps = Math.min(8, Math.max(1, Number(steps) || 4));
    try {
      const data = await postCloudflareJson(this.accountId, this.apiToken, this.imageModel, { prompt: text, steps: nSteps }, this.timeoutMs);
      let designUrl;
      if (data.imageBuffer) designUrl = saveGeneratedImageBuffer(data.imageBuffer, designId);
      else designUrl = saveGeneratedImage(extractBase64Image(data), designId);
      return { designUrl, finalPrompt };
    } catch (e) {
      const retryable = e.name === 'AbortError' || (e.statusCode >= 500 && e.statusCode < 600) || e.statusCode === 429;
      throw new AIProviderError({ provider: this.name, code: e.code || 'CLOUDFLARE_ERROR', message: e.message, retryable, statusCode: e.statusCode || 500 });
    }
  }

  async generateFromImage({ idea, designId, finalPrompt }) {
    // Cloudflare generate-from-image not natively supported for t-shirt remix in blankup; use same generateImage with idea as prompt
    return this.generateImage({ prompt: finalPrompt || idea || 'Remix this reference image into an original t-shirt graphic', designId, finalPrompt });
  }

  // Product mockup via Cloudflare is optional; reuse same logic as before
  async generateProductMockup({ designId, finalProductPrompt }) {
    if (!this.isAvailable()) return null;
    try {
      const data = await postCloudflareJson(this.accountId, this.apiToken, this.imageModel, { prompt: finalProductPrompt }, this.timeoutMs);
      if (data.imageBuffer) return saveGeneratedImageBuffer(data.imageBuffer, `${designId}-product`);
      return saveGeneratedImage(extractBase64Image(data), `${designId}-product`);
    } catch {
      return null;
    }
  }
}

module.exports = { CloudflareProvider };
