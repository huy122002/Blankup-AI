// backend/services/ai-providers/gemini.provider.js
// Google Gemini provider (Google AI Studio) — native image generation & editing.
//
// Verified against the OFFICIAL docs (https://ai.google.dev/gemini-api/docs/image-generation)
// and the installed @google/genai SDK (v2.24.x, dist/node/node.d.ts):
//   - Endpoint family: Interactions API  →  ai.interactions.create({ model, input })
//   - Text-to-image:   input: "<text>" (string)
//   - Image-to-image:  input: [{ type: 'text', text }, { type: 'image', mime_type, data(base64) }]
//   - Response image:  interaction.output_image → { data: base64, mime_type } (snake_case, confirmed in d.ts)
//   - Timeout:         client httpOptions.timeout (ms) — HttpOptions interface, confirmed in d.ts
//   - Errors:          SDK ApiError carries `.status` (HTTP status code)
//
// Secret handling: the API key lives ONLY in config/env (GEMINI_API_KEY). It is never
// logged, never returned in responses, and never embedded in URLs.

const fs = require('fs');
const path = require('path');
const { BaseAIProvider, AIProviderError } = require('./base.provider');

const uploadsDir = path.join(__dirname, '../../uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

// ---------------------------------------------------------------------------
// Image persistence — same pipeline as the other providers. Magic-byte sniffing
// decides the real extension; the provider NEVER assumes PNG.
// ---------------------------------------------------------------------------
function detectImageExt(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'png';
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'jpg';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'gif';
  if (buffer.slice(0, 4).toString() === 'RIFF' && buffer.slice(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

function saveGeneratedImageBuffer(buffer, designId) {
  if (!buffer || !buffer.length) throw new Error('Gemini response did not include image data.');
  const ext = detectImageExt(buffer) || 'png';
  const fileName = `${designId}.${ext}`;
  const filePath = path.join(uploadsDir, fileName);
  fs.writeFileSync(filePath, buffer);
  return `/uploads/${fileName}`;
}

// MIME types Gemini image input accepts (ImageContentMimeType in the SDK d.ts).
// SVG is NOT an accepted Gemini image input, so reference-mode SVG uploads must
// fail fast with a clear, non-retryable error instead of a remote 400.
const SUPPORTED_INPUT_MIME = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif',
  'image/gif', 'image/bmp', 'image/tiff',
]);

// ---------------------------------------------------------------------------
// Error classification — mirrors the retry semantics of the other providers.
// ---------------------------------------------------------------------------
function classifyGeminiError(e) {
  const statusCode = typeof e?.status === 'number' && e.status > 0
    ? e.status
    : (typeof e?.statusCode === 'number' && e.statusCode > 0 ? e.statusCode : 0);
  const msg = String(e?.message || '');
  const isTimeout = e?.name === 'AbortError' || /timeout|timed out|ETIMEDOUT|deadline/i.test(msg);
  const retryable = isTimeout || (statusCode >= 500 && statusCode < 600) || statusCode === 429;
  return { statusCode: statusCode || 500, retryable, isTimeout };
}

// Extract the generated image from an interaction response. Prefers the
// documented convenience property `output_image`, with a defensive scan of the
// output blocks as a fallback (both shapes exist in the SDK type definitions).
function extractImageFromInteraction(interaction) {
  const viaConvenience = interaction?.output_image;
  if (viaConvenience?.data) {
    return { data: viaConvenience.data, mimeType: viaConvenience.mime_type || null };
  }
  const blocks = Array.isArray(interaction?.output) ? interaction.output : [];
  for (const block of blocks) {
    const mime = block?.mime_type || block?.mimeType;
    const data = block?.data;
    if (data && (!mime || String(mime).startsWith('image/'))) {
      return { data, mimeType: mime || null };
    }
  }
  return null;
}

function geminiErrorMessage(e) {
  // SDK errors may embed nested details; keep the first meaningful line only.
  return String(e?.message || 'Gemini request failed').split('\n')[0].slice(0, 300);
}

class GeminiProvider extends BaseAIProvider {
  constructor(config) {
    super('google-gemini', config);
    this.apiKey = config.gemini.apiKey;
    this.imageModel = config.gemini.imageModel;
    this.timeoutMs = config.gemini.timeoutMs || 120000;
    // Client is created lazily so unit tests can mock the SDK module cleanly.
    this._client = null;
  }

  _getClient() {
    if (!this._client) {
      // Lazily required: keeps the SDK out of the require graph unless Gemini is used.
      const { GoogleGenAI } = require('@google/genai');
      this._client = new GoogleGenAI({
        apiKey: this.apiKey,
        httpOptions: { timeout: this.timeoutMs },
      });
    }
    return this._client;
  }

  isAvailable() {
    return this.config.gemini.enabled && !!this.apiKey;
  }

  async _createInteraction(payload) {
    try {
      return await this._getClient().interactions.create(payload);
    } catch (e) {
      const { statusCode, retryable, isTimeout } = classifyGeminiError(e);
      throw new AIProviderError({
        provider: this.name,
        code: isTimeout ? 'GEMINI_TIMEOUT' : (statusCode === 401 || statusCode === 403 ? 'GEMINI_AUTH_ERROR' : 'GEMINI_ERROR'),
        message: geminiErrorMessage(e),
        retryable,
        statusCode,
      });
    }
  }

  // Text → image. opts: { prompt, designId, finalPrompt }
  async generateImage({ prompt, designId, finalPrompt }) {
    if (!this.isAvailable()) {
      throw new AIProviderError({ provider: this.name, code: 'CONFIG_ERROR', message: 'Gemini not configured', retryable: false });
    }
    const text = String(finalPrompt || prompt || '').trim();
    if (!text) {
      throw new AIProviderError({ provider: this.name, code: 'VALIDATION_ERROR', message: 'A prompt is required.', retryable: false });
    }
    const interaction = await this._createInteraction({ model: this.imageModel, input: text });
    const image = extractImageFromInteraction(interaction);
    if (!image?.data) {
      // Safety refusal / text-only response — not a transport error, not retryable.
      throw new AIProviderError({
        provider: this.name,
        code: 'GEMINI_NO_IMAGE',
        message: 'Gemini response did not include image data (prompt may have been refused).',
        retryable: false,
        statusCode: 200,
      });
    }
    let buffer;
    try {
      buffer = Buffer.from(image.data, 'base64');
    } catch {
      throw new AIProviderError({ provider: this.name, code: 'GEMINI_MALFORMED_RESPONSE', message: 'Gemini image data could not be decoded.', retryable: false, statusCode: 200 });
    }
    const designUrl = saveGeneratedImageBuffer(buffer, designId);
    return { designUrl, finalPrompt: text, model: this.imageModel };
  }

  // Reference image + text → image. opts: { file, idea, designId, finalPrompt }
  async generateFromImage({ file, idea, designId, finalPrompt }) {
    if (!this.isAvailable()) {
      throw new AIProviderError({ provider: this.name, code: 'CONFIG_ERROR', message: 'Gemini not configured', retryable: false });
    }
    if (!file?.path) {
      throw new AIProviderError({ provider: this.name, code: 'VALIDATION_ERROR', message: 'A reference image file is required.', retryable: false });
    }
    const rawMime = String(file.mimetype || '').toLowerCase();
    if (!SUPPORTED_INPUT_MIME.has(rawMime)) {
      throw new AIProviderError({
        provider: this.name,
        code: 'UNSUPPORTED',
        message: `Gemini image input does not support ${rawMime || 'unknown'} files. Use PNG, JPEG, WEBP or GIF.`,
        retryable: false,
        statusCode: 400,
      });
    }
    const text = String(finalPrompt || idea || 'Turn this image into an original t-shirt graphic').trim();
    const buffer = fs.readFileSync(file.path);
    const input = [
      { type: 'text', text },
      { type: 'image', mime_type: rawMime, data: buffer.toString('base64') },
    ];
    const interaction = await this._createInteraction({ model: this.imageModel, input });
    const image = extractImageFromInteraction(interaction);
    if (!image?.data) {
      throw new AIProviderError({
        provider: this.name,
        code: 'GEMINI_NO_IMAGE',
        message: 'Gemini response did not include image data (prompt may have been refused).',
        retryable: false,
        statusCode: 200,
      });
    }
    const outBuffer = Buffer.from(image.data, 'base64');
    const designUrl = saveGeneratedImageBuffer(outBuffer, designId);
    return { designUrl, finalPrompt: text, model: this.imageModel };
  }

  // Optional product mockup — same text-to-image path, separate artifact id.
  async generateProductMockup({ designId, finalProductPrompt }) {
    if (!this.isAvailable()) return null;
    try {
      const interaction = await this._createInteraction({
        model: this.imageModel,
        input: String(finalProductPrompt || '').trim(),
      });
      const image = extractImageFromInteraction(interaction);
      if (!image?.data) return null;
      return saveGeneratedImageBuffer(Buffer.from(image.data, 'base64'), `${designId}-product`);
    } catch {
      return null; // mockup is non-critical by design (mirrors Cloudflare provider)
    }
  }
}

module.exports = { GeminiProvider, detectImageExt, extractImageFromInteraction, classifyGeminiError, saveGeneratedImageBuffer };
