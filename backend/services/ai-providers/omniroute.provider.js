// backend/services/ai-providers/omniroute.provider.js
// OmniRoute is OpenAI-compatible gateway at http://localhost:20128/v1
// Supports POST /v1/images/generations and POST /v1/images/edits (multipart)
const fs = require('fs');
const path = require('path');
const { BaseAIProvider, AIProviderError, isQuotaExhaustedError } = require('./base.provider');

const uploadsDir = path.join(__dirname, '../../uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

// Magic-byte sniffing — parity with the Cloudflare/Gemini/OpenAI providers, so a
// JPEG returned by an upstream is never stored (and served) as a .png.
function detectImageExt(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'png';
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'jpg';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'gif';
  if (buffer.slice(0, 4).toString() === 'RIFF' && buffer.slice(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

function saveGeneratedImageBuffer(buffer, designId) {
  if (!buffer || !buffer.length) throw new Error('AI response did not include image data.');
  const ext = detectImageExt(buffer) || 'png';
  const fileName = `${designId}.${ext}`;
  const filePath = path.join(uploadsDir, fileName);
  fs.writeFileSync(filePath, buffer);
  return `/uploads/${fileName}`;
}

function saveGeneratedImage(base64Image, designId) {
  if (!base64Image) throw new Error('AI response did not include image data.');
  const buffer = Buffer.from(base64Image, 'base64');
  if (!buffer.length) throw new Error('AI response did not include image data.');
  return saveGeneratedImageBuffer(buffer, designId);
}

// A gateway may answer with inline base64 OR with a hosted URL. Those two are NOT
// interchangeable: a URL must be downloaded. Treating it as base64 used to write
// the URL text itself to disk as "<designId>.png", report success, and charge the
// user a credit for an unreadable image.
function extractImagePayload(data) {
  const base64 =
    data?.data?.[0]?.b64_json ||
    data?.result?.image ||
    data?.result?.images?.[0] ||
    data?.image ||
    data?.images?.[0] ||
    data?.b64_json;
  if (base64) return { base64, url: null };
  const url = data?.data?.[0]?.url || data?.url || data?.result?.url;
  if (url) return { base64: null, url };
  return { base64: null, url: null };
}

async function materializeImage(payload, designId) {
  if (payload.base64) return saveGeneratedImage(payload.base64, designId);
  if (payload.url) {
    const imgResp = await fetch(payload.url);
    if (!imgResp.ok) {
      throw new Error(`OmniRoute returned an image URL that could not be downloaded (status ${imgResp.status})`);
    }
    return saveGeneratedImageBuffer(Buffer.from(await imgResp.arrayBuffer()), designId);
  }
  throw new Error('OmniRoute response did not include image data.');
}

async function postOmnirouteJson(baseUrl, apiKey, model, prompt, size, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${baseUrl.replace(/\/$/, '')}/images/generations`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, size }),
      signal: controller.signal,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = data.error?.message || data.error || `OmniRoute request failed with status ${resp.status}`;
      const err = new Error(msg);
      err.statusCode = resp.status;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function postOmnirouteForm(baseUrl, apiKey, formData, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${baseUrl.replace(/\/$/, '')}/images/edits`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
      signal: controller.signal,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = data.error?.message || data.error || `OmniRoute request failed with status ${resp.status}`;
      const err = new Error(msg);
      err.statusCode = resp.status;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

class OmniRouteProvider extends BaseAIProvider {
  constructor(config) {
    super('omniroute', config);
    this.baseUrl = config.omniroute.baseUrl;
    this.apiKey = config.omniroute.apiKey;
    this.model = config.omniroute.model;
    this.timeoutMs = config.omniroute.timeoutMs || 90000;
  }

  isAvailable() {
    return this.config.omniroute.enabled && !!this.apiKey && !!this.baseUrl && typeof fetch === 'function';
  }

  async generateImage({ prompt, designId, finalPrompt, size = '1024x1024' }) {
    if (!this.isAvailable()) {
      throw new AIProviderError({ provider: this.name, code: 'CONFIG_ERROR', message: 'OmniRoute not configured (missing API key or baseUrl)', retryable: false });
    }
    try {
      const data = await postOmnirouteJson(this.baseUrl, this.apiKey, this.model, finalPrompt || prompt, size, this.timeoutMs);
      const payload = extractImagePayload(data);
      const designUrl = await materializeImage(payload, designId);
      return { designUrl, finalPrompt };
    } catch (e) {
      // Exhausted quota / billing 429s are NOT retryable — fall through immediately.
      const quota = isQuotaExhaustedError(e.statusCode, e.message);
      const retryable = !quota && (e.name === 'AbortError' || (e.statusCode >= 500 && e.statusCode < 600) || e.statusCode === 429);
      throw new AIProviderError({ provider: this.name, code: quota ? 'OMNIROUTE_QUOTA_EXHAUSTED' : (e.code || 'OMNIROUTE_ERROR'), message: e.message, retryable, statusCode: e.statusCode || 500 });
    }
  }

  async generateFromImage({ file, idea, designId, finalPrompt, size = '1024x1024' }) {
    if (!this.isAvailable()) {
      throw new AIProviderError({ provider: this.name, code: 'CONFIG_ERROR', message: 'OmniRoute not configured', retryable: false });
    }
    if (typeof FormData === 'undefined' || typeof Blob === 'undefined') {
      throw new AIProviderError({ provider: this.name, code: 'UNSUPPORTED', message: 'FormData/Blob not available', retryable: false });
    }
    try {
      const buffer = fs.readFileSync(file.path);
      const formData = new FormData();
      formData.append('model', this.model);
      formData.append('prompt', finalPrompt || idea || 'Turn this image into an original t-shirt graphic');
      formData.append('size', size);
      // OmniRoute images/edits expects 'image' field (OpenAI spec)
      formData.append('image', new Blob([buffer], { type: file.mimetype }), file.originalname);
      // Also try image[] for compatibility
      // formData.append('image[]', ...) not needed for OmniRoute
      const data = await postOmnirouteForm(this.baseUrl, this.apiKey, formData, this.timeoutMs);
      const payload = extractImagePayload(data);
      const designUrl = await materializeImage(payload, designId);
      return { designUrl, finalPrompt };
    } catch (e) {
      // Exhausted quota / billing 429s are NOT retryable — fall through immediately.
      const quota = isQuotaExhaustedError(e.statusCode, e.message);
      const retryable = !quota && (e.name === 'AbortError' || (e.statusCode >= 500 && e.statusCode < 600) || e.statusCode === 429);
      throw new AIProviderError({ provider: this.name, code: quota ? 'OMNIROUTE_QUOTA_EXHAUSTED' : (e.code || 'OMNIROUTE_ERROR'), message: e.message, retryable, statusCode: e.statusCode || 500 });
    }
  }
}

module.exports = { OmniRouteProvider, extractImagePayload, detectImageExt };
