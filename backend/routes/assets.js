const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { readJson, writeJson, withLock, DATA_DIR } = require('../utils/fileStore');
const { authenticate, optionalAuthenticate } = require('../middleware/auth');

const router = express.Router();

const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
const ALLOWED_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const ASSETS_DIR = path.join(__dirname, '..', 'uploads', 'assets');
const ASSETS_FILE = path.join(DATA_DIR, 'assets.json');

if (!fs.existsSync(ASSETS_DIR)) {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: ASSETS_DIR,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      return cb(new Error('Invalid file extension'));
    }
    cb(null, `asset-${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeOk = ALLOWED_MIME.includes(file.mimetype);
    const extOk = ALLOWED_EXT.includes(ext);
    if (mimeOk && extOk) return cb(null, true);
    cb(new Error('Only image files (png, jpg, jpeg, webp, gif) are allowed.'));
  },
});

function getDimensions(buffer) {
  try {
    if (buffer.length < 24) return { width: 0, height: 0 };
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      // PNG
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return { width, height };
    }
    if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
      // JPEG - simplified, find SOF marker
      let i = 2;
      while (i < buffer.length - 1) {
        if (buffer[i] === 0xFF && buffer[i + 1] >= 0xC0 && buffer[i + 1] <= 0xC3) {
          const height = buffer.readUInt16BE(i + 5);
          const width = buffer.readUInt16BE(i + 7);
          return { width, height };
        }
        i++;
      }
      return { width: 0, height: 0 };
    }
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
      // WEBP
      if (buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
        if (buffer[12] === 0x56 && buffer[13] === 0x50) {
          // VP8
          const width = buffer.readUInt16LE(26) | ((buffer[28] & 0x3F) << 16);
          const height = buffer.readUInt16LE(28) | ((buffer[30] & 0x3F) << 16);
          return { width, height };
        }
      }
    }
    return { width: 0, height: 0 };
  } catch {
    return { width: 0, height: 0 };
  }
}

function computeChecksum(buffer) {
  const crypto = require('crypto');
  return 'sha256:' + crypto.createHash('sha256').update(buffer).digest('hex');
}

function stripExif(buffer) {
  // For Phase 1: basic EXIF stripping for JPEG
  // In Phase 5, use sharp for full EXIF stripping
  if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
    // JPEG - remove APP1 segment (EXIF)
    let i = 2;
    while (i < buffer.length - 1) {
      if (buffer[i] === 0xFF && buffer[i + 1] === 0xE1) {
        const segmentLength = buffer.readUInt16BE(i + 2);
        const segmentData = buffer.slice(i + 4, i + 4 + segmentLength - 2);
        if (segmentData.toString('ascii', 0, 6) === 'Exif\x00\x00') {
          const newBuffer = Buffer.concat([buffer.slice(0, i), buffer.slice(i + 2 + segmentLength)]);
          return newBuffer;
        }
      }
      if (buffer[i] === 0xFF && buffer[i + 1] >= 0xE0 && buffer[i + 1] <= 0xEF) {
        const segmentLength = buffer.readUInt16BE(i + 2);
        i += 2 + segmentLength;
      } else {
        i++;
      }
    }
  }
  return buffer;
}

function readAssets() {
  try {
    const data = readJson(ASSETS_FILE);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeAssets(assets) {
  writeJson(ASSETS_FILE, assets);
}

// POST /api/assets/upload
router.post('/upload', authenticate, upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    const kind = req.body.kind || 'asset';

    if (!file) {
      return res.status(400).json({ success: false, error: 'File is required' });
    }

    if (!['asset', 'reference'].includes(kind)) {
      try { fs.unlinkSync(file.path); } catch {}
      return res.status(400).json({ success: false, error: 'Invalid kind. Must be "asset" or "reference".' });
    }

    const fileBuffer = fs.readFileSync(file.path);
    const strippedBuffer = stripExif(fileBuffer);
    if (strippedBuffer !== fileBuffer) {
      fs.writeFileSync(file.path, strippedBuffer);
    }

    const { width, height } = getDimensions(strippedBuffer);
    const checksum = computeChecksum(strippedBuffer);
    const assetId = uuidv4();
    const url = `/uploads/assets/${path.basename(file.path)}`;

    const asset = {
      assetId,
      userId: req.user.id,
      name: file.originalname,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: strippedBuffer.length,
      width,
      height,
      storagePath: file.path,
      url,
      publicUrl: url,
      checksum,
      exifStripped: strippedBuffer !== fileBuffer,
      createdAt: new Date().toISOString(),
      kind,
      deletedAt: null,
    };

    await withLock(ASSETS_FILE, async () => {
      const assets = readAssets();
      assets.push(asset);
      writeAssets(assets);
    });

    return res.status(201).json({ success: true, asset });
  } catch (err) {
    console.error('[Assets] Upload error:', err.message);
    if (req.file) {
      try { fs.unlinkSync(req.file.path); } catch {}
    }
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ success: false, error: 'File too large (max 10MB)' });
      }
      return res.status(400).json({ success: false, error: err.message });
    }
    if (err.message?.includes('extension') || err.message?.includes('image files')) {
      return res.status(400).json({ success: false, error: 'Invalid file type. Only PNG, JPG, WEBP, GIF allowed.' });
    }
    return res.status(500).json({ success: false, error: 'Upload failed' });
  }
});

// GET /api/assets
router.get('/', authenticate, async (req, res) => {
  try {
    const assets = readAssets();
    const userAssets = assets
      .filter(a => a.userId === req.user.id && a.kind === 'asset' && !a.deletedAt)
      .map(({ storagePath, checksum, ...a }) => a);
    return res.json({ success: true, data: userAssets });
  } catch (err) {
    console.error('[Assets] List error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to list assets' });
  }
});

// GET /api/assets/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const assets = readAssets();
    const asset = assets.find(a => a.assetId === req.params.id);
    if (!asset || asset.deletedAt) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }
    if (asset.userId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    const { storagePath, checksum, ...safeAsset } = asset;
    return res.json({ success: true, asset: safeAsset });
  } catch (err) {
    console.error('[Assets] Get error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to get asset' });
  }
});

// DELETE /api/assets/:id
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const result = await withLock(ASSETS_FILE, async () => {
      const assets = readAssets();
      const idx = assets.findIndex(a => a.assetId === req.params.id);
      if (idx === -1) return { notFound: true };
      const asset = assets[idx];
      if (asset.userId !== req.user.id) return { forbidden: true };
      if (asset.deletedAt) return { alreadyDeleted: true };

      // Soft delete
      asset.deletedAt = new Date().toISOString();
      writeAssets(assets);
      return { success: true };
    });

    if (result.notFound) return res.status(404).json({ success: false, error: 'Asset not found' });
    if (result.forbidden) return res.status(403).json({ success: false, error: 'Forbidden' });
    if (result.alreadyDeleted) return res.status(404).json({ success: false, error: 'Asset not found' });

    return res.json({ success: true });
  } catch (err) {
    console.error('[Assets] Delete error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to delete asset' });
  }
});

module.exports = router;