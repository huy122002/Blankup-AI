// backend/services/ai-providers/openai.provider.js
const fs = require('fs');
const path = require('path');
const { BaseAIProvider, AIProviderError, isQuotaExhaustedError } = require('./base.provider');

const uploadsDir = path.join(__dirname, '../../uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

// Magic-byte sniffing — parity with the Cloudflare/Gemini providers. The bytes
// returned by the API decide the extension; we never blindly label them PNG.
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
  const buffer = Buffer.from(base64Image, 'base64');
  if (!buffer.length) throw new Error('AI response did not include image data.');
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

async function postOpenAIJson(apiKey, model, prompt, size, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, size }),
      signal: controller.signal,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = data.error?.message || `OpenAI request failed with status ${resp.status}`;
      const err = new Error(msg);
      err.statusCode = resp.status;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function postOpenAIForm(apiKey, formData, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
      signal: controller.signal,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = data.error?.message || `OpenAI request failed with status ${resp.status}`;
      const err = new Error(msg);
      err.statusCode = resp.status;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

class OpenAIProvider extends BaseAIProvider {
  constructor(config) {
    super('openai', config);
    this.apiKey = config.openai.apiKey;
    // Text/chat slot — reference image transposition into prompts, never /images/*.
    this.model = config.openai.model;
    // Image generation reads the DEDICATED image slot so OPENAI_IMAGE_MODEL and
    // OPENAI_IMAGE_SIZE in .env actually take effect (they used to be ignored).
    this.imageModel = config.openai.imageModel || config.openai.model;
    this.imageSize = config.openai.imageSize || '1024x1024';
    this.timeoutMs = config.openai.timeoutMs || 90000;
  }

  isAvailable() {
    return this.config.openai.enabled && !!this.apiKey && typeof fetch === 'function';
  }

  async generateImage({ prompt, designId, finalPrompt, size }) {
    if (!this.isAvailable()) {
      throw new AIProviderError({ provider: this.name, code: 'CONFIG_ERROR', message: 'OpenAI not configured', retryable: false });
    }
    try {
      const data = await postOpenAIJson(this.apiKey, this.imageModel, finalPrompt || prompt, size || this.imageSize, this.timeoutMs);
      const url = saveGeneratedImage(extractBase64Image(data), designId);
      return { designUrl: url, finalPrompt };
    } catch (e) {
      // Exhausted quota / billing 429s are NOT retryable — fall through immediately.
      const quota = isQuotaExhaustedError(e.statusCode, e.message);
      const retryable = !quota && (e.name === 'AbortError' || (e.statusCode >= 500 && e.statusCode < 600) || e.statusCode === 429);
      throw new AIProviderError({ provider: this.name, code: quota ? 'OPENAI_QUOTA_EXHAUSTED' : (e.code || 'OPENAI_ERROR'), message: e.message, retryable, statusCode: e.statusCode || 500 });
    }
  }

  async generateFromImage({ file, idea, designId, finalPrompt, size }) {
    if (!this.isAvailable()) {
      throw new AIProviderError({ provider: this.name, code: 'CONFIG_ERROR', message: 'OpenAI not configured', retryable: false });
    }
    if (typeof FormData === 'undefined' || typeof Blob === 'undefined') {
      throw new AIProviderError({ provider: this.name, code: 'UNSUPPORTED', message: 'FormData/Blob not available', retryable: false });
    }
    try {
      const buffer = fs.readFileSync(file.path);
      const formData = new FormData();
      formData.append('model', this.imageModel);
      formData.append('prompt', finalPrompt || idea || 'Turn this image into an original t-shirt graphic');
      formData.append('size', size || this.imageSize);
      formData.append('image[]', new Blob([buffer], { type: file.mimetype }), file.originalname);
      const data = await postOpenAIForm(this.apiKey, formData, this.timeoutMs);
      const url = saveGeneratedImage(extractBase64Image(data), designId);
      return { designUrl: url, finalPrompt };
    } catch (e) {
      // Exhausted quota / billing 429s are NOT retryable — fall through immediately.
      const quota = isQuotaExhaustedError(e.statusCode, e.message);
      const retryable = !quota && (e.name === 'AbortError' || (e.statusCode >= 500 && e.statusCode < 600) || e.statusCode === 429);
      throw new AIProviderError({ provider: this.name, code: quota ? 'OPENAI_QUOTA_EXHAUSTED' : (e.code || 'OPENAI_ERROR'), message: e.message, retryable, statusCode: e.statusCode || 500 });
    }
  }
}

module.exports = { OpenAIProvider };
