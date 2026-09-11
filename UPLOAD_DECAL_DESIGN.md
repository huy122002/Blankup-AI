# Upload-as-Decal Feature — Architecture & Design Audit

**Status**: PHASE 1 IMPLEMENTATION IN PROGRESS
**Based on**: Verified current codebase (2026-09-10)
**Updated**: 2026-09-10 with explicit resolutions (R1, R2, R3)

---

## EXPLICIT RESOLUTIONS (MANDATORY)

### R1. REFERENCE vs PLACED ASSET — RESOLVED
- **AI reference input is NOT a design layer**.
- Use: `generation.referenceAssetId` (or equivalent reference metadata on the generation record).
- **Layer kinds remain**: `asset`, `ai-generated`, `text`.
- An uploaded image becomes a layer **ONLY after explicit "Place on shirt"**.
- The `generate-from-image` endpoint accepts `mode: 'reference' | 'asset'` (default `'reference'` for backward compat).
  - `mode: 'reference'` → stores asset with `kind: 'reference'`, returns `referenceAssetId`, does NOT create layer.
  - `mode: 'asset'` → stores asset with `kind: 'asset'`, returns `assetId`, user must click "Place on shirt" to create layer.

### R2. SOURCE OF TRUTH — RESOLVED
- **`designLayers{front,back}` is canonical editor state**.
- **Composite is DERIVED** (computed on-demand via `buildSideComposite()`).
- Do NOT make composite the source of truth.
- Server persists full layer array in `designs.json` (`layers[]`) and `orders.json` (`layersSnapshot[]`).
- On read: if `layers` missing, synthesize from legacy fields (backward compat).

### R3. ORDER SNAPSHOT — RESOLVED
- **Orders must preserve the exact visual state required for that order**.
- Do NOT make historical order rendering depend on a mutable/deletable current asset.
- `orders.json` stores `layersSnapshot[]` — a **frozen copy** of each layer's visual properties at order time:
  - `{ layerId, assetId, kind, side, x, y, scale, rotation, z, visible, name, designUrl, assetUrl }`
  - `designUrl` = the rendered layer image (data URL or static URL) — **self-contained**.
  - `assetUrl` = the asset's URL at order time (for reference only).
- Asset deletion/soft-delete does NOT affect historical order rendering.

---

## A. Current Architecture (VERIFIED)

### A.1 Frontend State (`frontend/js/studio.js:110-130`)
```javascript
state = {
  // Per-side independent layer arrays
  designLayers: { front: [], back: [] },
  // Per-side selected layer ID
  selectedLayerId: { front: null, back: null },
  // Current view: 'front' | 'back'
  currentView: 'front',
  // Uploaded file (only for generate-from-image)
  uploadedFile: null,
  // Composite cache
  compositeCacheKey: null,
  compositeDesignUrls: { front: null, back: null },
  // Interaction
  interactionMode: 'position',
  // ... other fields
};
```

### A.2 Layer Structure (`studio.js:2028-2053`)
```javascript
{
  id: 'layer-xxx',
  url: 'data:image/png;base64,...' | '/uploads/design-xxx.png',
  kind: 'image',                    // only 'image' currently
  x: 0, y: -12, scale: 1, rotation: 0,
  visible: true,
  z: 1,                             // stacking order
  name: 'Mẫu 1',
  designId: 'design-xxx' | null,    // links to server record
  prompt: '',
  style: 'minimalist',
  createdAt: Date.now()
}
```

### A.3 Layer Operations (VERIFIED)
| Operation | Function | Status |
|-----------|----------|--------|
| Add layer | `addLayer(side, {...})` | ✅ Real |
| Remove layer | `removeLayer(side, id)` | ✅ Real |
| Move Z-index | `moveLayerZ(side, id, dir)` | ✅ Real |
| Select layer | `selectLayer(side, id)` | ✅ Real |
| Get layers | `sideLayers(side)` | ✅ Real |
| Bounds clamp | `sanitizeLayer()` | ✅ Real |

### A.4 Composite Generation (`studio.js:530-553`)
```javascript
async function buildSideComposite(side) {
  const layers = [...sideLayers(k)].filter(l => l.visible && l.url).sort((a,b) => a.z - b.z);
  // Draws to 1024x1024 canvas → returns data:image/png;base64
}
```
- Used by: 2D overlay, 3D texture, order submit, share, download, print preview
- **Single source of truth for rendering**

### A.5 3D Viewer (`tshirt-360.js:353-390`)
```javascript
function applyDesign(url) {
  // Single composite applied as DecalGeometry on tshirt mesh
  // Front/back handled by camera framing (showSide)
}
```
- Receives composite from `applyCurrentDesignToViewer()`
- **No per-layer decal support**

### A.6 Backend Storage (VERIFIED)

| Store | Path | Schema | Notes |
|-------|------|--------|-------|
| Designs | `backend/data/designs.json` | Single record per generation | `designUrl`, `frontDesignUrl`, `backDesignUrl`, `sourceImage` — **NO layer array** |
| Orders | `backend/data/orders.json` | `designUrl`, `frontDesignUrl`, `backDesignUrl`, placements | Composites only |
| Uploads | `backend/uploads/design-{ts}-{uuid}.ext` | Static files | Served via `express.static('/uploads')` — **no auth** |
| History | `localStorage.blankup_design_history` | Full layer snapshots | Client-only |

### A.7 Current Upload Flow (VERIFIED)
1. User drops file → `initUpload()` stores in `state.uploadedFile`
2. Preview shows data URL
3. User clicks "Tạo Design" → `generateFromImage()` POSTs multipart to `/api/ai-design/generate-from-image`
4. Backend: multer saves to `uploads/`, calls OmniRoute `images/edits` with reference image
5. Backend saves record to `designs.json` with `sourceImage: '/uploads/...'` and `designUrl: '/uploads/...'` (AI result)
6. Frontend receives AI design URL → `showDesignOnMockup()` → `addLayer(front, {url: aiDesignUrl, ...})`
7. **Uploaded file NEVER becomes a layer directly**

---

## B. Gap Analysis (VERIFIED)

| Gap | Impact | Severity |
|-----|--------|----------|
| No "Place on shirt" button in upload preview | User cannot use upload as decal | **Critical** |
| `state.uploadedFile` only consumed by AI generation | No direct placement path | **Critical** |
| `designs.json` lacks layer array | Server cannot reconstruct composition | **High** |
| `orders.json` stores composites only | Order loses layer fidelity | **High** |
| 3D viewer single composite | No independent layer manipulation in 3D | **Medium** |
| `/uploads/*` public no-auth | Security risk for user uploads | **Medium** |
| No asset deduplication | Same upload stored multiple times | **Low** |
| No EXIF stripping | Privacy leak | **Low** |
| No orphan cleanup | Storage bloat | **Low** |

---

## C. Proposed Data Model (PROPOSED)

### C.1 Asset Registry (New)
```javascript
// backend/data/assets.json
{
  assetId: 'asset-uuid-v4',
  userId: 'user-uuid',              // owner
  originalName: 'logo.png',
  mimeType: 'image/png',
  size: 123456,
  width: 512,
  height: 512,
  storagePath: '/uploads/assets/asset-uuid-v4.png',
  publicUrl: '/uploads/assets/asset-uuid-v4.png',  // served via auth middleware
  checksum: 'sha256:...',
  exifStripped: true,
  createdAt: '2026-09-10T12:00:00Z',
  // R1: Asset kind — NOT a layer kind
  kind: 'asset' | 'reference',      // 'asset' = user decal, 'reference' = AI generation input
  // Soft delete
  deletedAt: null
}
```

### C.2 Design Record Extension (Backward Compatible)
```javascript
// designs.json record (extended)
{
  designId: 'design-xxx',
  // ... existing fields ...
  // R1: Reference asset used for this generation (if any)
  referenceAssetId: 'asset-uuid' | null,
  // R2: Authoritative layer list (source of truth)
  layers: [
    {
      layerId: 'layer-uuid',
      assetId: 'asset-uuid' | null,  // null for AI-generated (ephemeral)
      kind: 'asset' | 'ai-generated' | 'text',
      side: 'front' | 'back',
      x: 0, y: -12, scale: 1, rotation: 0,
      z: 1,
      visible: true,
      name: 'Logo',
      // For AI-generated layers without asset:
      prompt: '...',
      style: 'minimalist',
      aiProvider: 'omniroute',
      designUrl: '/uploads/design-xxx.png'  // rendered asset
    }
  ],
  // Derived composites (kept for backward compat):
  frontDesignUrl: 'data:image/png;base64,...',
  backDesignUrl: 'data:image/png;base64,...'
}
```

### C.3 Order Record Extension (R3: Frozen Snapshot)
```javascript
// orders.json record (extended)
{
  orderId: 'BU-xxx',
  // ... existing fields ...
  // R3: Frozen visual state at order time — self-contained, survives asset deletion
  layersSnapshot: [
    {
      layerId: 'layer-uuid',
      assetId: 'asset-uuid' | null,
      kind: 'asset' | 'ai-generated' | 'text',
      side: 'front' | 'back',
      x: 0, y: -12, scale: 1, rotation: 0,
      z: 1, visible: true, name: 'Logo',
      // Self-contained rendered layer image (data URL or static URL)
      designUrl: 'data:image/png;base64,...',
      // Asset URL at order time (reference only, NOT used for rendering)
      assetUrl: '/uploads/assets/uuid.png'
    }
  ],
  // Composites for quick rendering:
  frontDesignUrl: 'data:image/png;base64,...',
  backDesignUrl: 'data:image/png;base64,...'
}
```

### C.4 Layer Kind Taxonomy (RESOLVED)
| Layer Kind | Source | Asset Link | Persistence |
|------------|--------|------------|-------------|
| `asset` | User upload → "Place on shirt" | `assetId` → `assets.json` (kind: 'asset') | `designs.json.layers[]` |
| `ai-generated` | AI generation | `designUrl` (ephemeral) | `designs.json.layers[]` |
| `text` | Custom text input | None | `designs.json.layers[]` |

| Asset Kind | Purpose | Creates Layer? |
|------------|---------|----------------|
| `asset` | User decal/logo | Only after explicit "Place on shirt" |
| `reference` | AI generation input | **Never** — stored as `generation.referenceAssetId` |

---

## D. Frontend State Model (PROPOSED)

### D.1 Extended State
```javascript
state = {
  // ... existing ...
  // NEW: Asset library (user's uploaded assets of kind 'asset')
  assetLibrary: [
    { assetId, url, name, mimeType, size, width, height, kind: 'asset' }
  ],
  // Upload UI state
  uploadState: 'idle' | 'processing' | 'preview' | 'error',
  pendingAsset: null,  // { file, dataUrl, assetId?, kind: 'asset' | 'reference' }
};
```

### D.2 Layer Structure (Extended)
```javascript
{
  // ... existing ...
  assetId: 'asset-uuid' | null,   // links to assetLibrary / server asset (kind: 'asset')
  kind: 'asset' | 'ai-generated' | 'text',
  // For AI-generated: designUrl is the rendered output
  // For asset: url === asset.publicUrl
  // For text: url === '' (handled separately in composite)
}
```

### D.3 New Actions
```javascript
// Add uploaded asset as layer (Mode 1 & 3) — ONLY for kind='asset'
function addAssetLayer(side, assetId, { x, y, scale, rotation } = {}) {
  const asset = state.assetLibrary.find(a => a.assetId === assetId);
  if (!asset || asset.kind !== 'asset') return null; // Guard: only 'asset' kind
  return addLayer(side, {
    url: asset.url,
    assetId,
    kind: 'asset',
    name: asset.name,
    x, y, scale, rotation
  });
}

// Place reference asset for AI generation (Mode 2)
function setReferenceAsset(assetId) {
  state.pendingReferenceAssetId = assetId;
}

// Replace layer asset (swap logo) — only for kind='asset'
function replaceLayerAsset(layerId, newAssetId) { ... }

// Delete asset (with cascade check)
async function deleteAsset(assetId) { ... }
```

---

## E. API Changes (PROPOSED)

### E.1 New Endpoints
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/assets/upload` | ✅ | Upload asset (multipart) → returns `{assetId, url}` |
| GET | `/api/assets` | ✅ | List user's assets |
| GET | `/api/assets/:id` | ✅ | Get asset metadata |
| DELETE | `/api/assets/:id` | ✅ | Soft delete (check layer references) |
| POST | `/api/assets/:id/replace` | ✅ | Replace file, keep assetId |

### E.2 Modified Endpoints
| Endpoint | Change |
|----------|--------|
| `POST /api/ai-design/generate-from-image` | Add optional `mode: 'reference' | 'asset'` (default `'reference'`). `reference`: stores asset kind='reference', returns `referenceAssetId`, no layer. `asset`: stores asset kind='asset', returns `assetId`, user must click "Place on shirt". |
| `POST /api/ai-design/generate` | Return `layers` array in response (include new layer) |
| `POST /api/ai-design/:id/share` | Persist `layers` array in design record |
| `POST /api/orders` | Accept optional `layersSnapshot` array; store in order |

### E.3 Upload Asset Endpoint Spec
```javascript
POST /api/assets/upload
Headers: Authorization: Bearer <token>
Content-Type: multipart/form-data
Body: file (image/*, max 10MB), kind?: 'asset' | 'reference' (default 'asset')

Response 201:
{
  success: true,
  asset: {
    assetId: 'uuid',
    url: '/uploads/assets/uuid.png',
    name: 'logo.png',
    mimeType: 'image/png',
    size: 123456,
    width: 512,
    height: 512,
    kind: 'asset' | 'reference',
    createdAt: '...'
  }
}

Response 400: { success: false, error: 'Invalid file type/size' }
Response 413: { success: false, error: 'File too large' }
```

---

## F. Storage Changes (PROPOSED)

### F.1 File Layout
```
backend/
├── uploads/
│   ├── assets/              # NEW: user assets (organized by userId or flat)
│   │   ├── asset-uuid-v4.png
│   │   └── ...
│   └── designs/             # AI-generated (existing)
│       └── design-xxx.png
├── data/
│   ├── assets.json          # NEW: asset registry
│   ├── designs.json         # EXTENDED: add layers[]
│   └── orders.json          # EXTENDED: add layersSnapshot[]
```

### F.2 FileStore Considerations
- `assets.json` uses same `fileStore` (atomic tmp+rename, cross-process lock, backup rotation)
- Max 10MB per file (AGENTS.md)
- Backup rotation: 3 versions (existing)

### F.3 Migration Strategy
```javascript
// One-time migration script
function migrateDesignsAddLayers() {
  const designs = readDesigns();
  designs.forEach(d => {
    if (!d.layers && d.designUrl) {
      d.layers = [{
        layerId: 'legacy-' + d.designId,
        assetId: null,
        kind: 'ai-generated',
        side: 'front',
        x: 0, y: -12, scale: 1, rotation: 0,
        z: 1, visible: true, name: 'Design',
        designUrl: d.designUrl,
        prompt: d.prompt, style: d.style
      }];
      if (d.backDesignUrl) {
        d.layers.push({ ...frontLayer, layerId: 'legacy-back-' + d.designId, side: 'back', designUrl: d.backDesignUrl });
      }
    }
  });
  writeDesigns(designs);
}
```

---

## G. 2D Compositor Changes (PROPOSED)

### G.1 Current (VERIFIED)
- `buildSideComposite(side)` draws all layers in z-order to canvas
- Returns single data URL
- Used everywhere: 2D, 3D, order, share, download

### G.2 Required Changes (PROPOSED)
1. **No change to algorithm** — already handles multiple layers
2. **Add assetKind awareness** for potential different rendering (e.g., preserve transparency for logos)
3. **Export layer list** for order/share payloads (already in `snapLayers()`)

### G.3 SnapLayers (VERIFIED at `studio.js:1433-1445`)
```javascript
const snapLayers = (side) => sideLayers(side).map(l => ({
  url: l.url, x: l.x, y: l.y, scale: l.scale, rotation: l.rotation || 0,
  visible: l.visible !== false, z: l.z, name: l.name,
  designId: l.designId, prompt: l.prompt, style: l.style,
  // NEW:
  assetId: l.assetId, kind: l.kind
}));
```

---

## H. 3D Strategy (PROPOSED)

### H.1 Current Limitation (VERIFIED)
- Single composite texture on single DecalGeometry
- Cannot independently manipulate layers in 3D

### H.2 Options (PROPOSED)

| Option | Complexity | Fidelity | Recommendation |
|--------|------------|----------|----------------|
| **A. Keep composite** | None | Composite only | **Short-term** |
| **B. Multi-decal** | Medium | Per-layer | Phase 2 |
| **C. Layered texture atlas** | High | Per-layer | Future |

### H.3 Option A — Composite (Immediate)
- No 3D code change
- 3D shows flattened composite (matches 2D exactly)
- Order/3D/2D perfectly aligned

### H.4 Option B — Multi-Decal (Future)
```javascript
// tshirt-360.js extension
function applyDesignLayers(layers, side) {
  // Remove old decals
  viewer.decalMeshes.forEach(m => { viewer.scene.remove(m); m.geometry.dispose(); m.material.map?.dispose(); m.material.dispose(); });
  viewer.decalMeshes = [];

  layers.filter(l => l.visible && l.url).sort((a,b) => a.z - b.z).forEach(layer => {
    const decal = createDecalMesh(layer.url, layer.x, layer.y, layer.scale, layer.rotation);
    viewer.decalMeshes.push(decal);
    viewer.scene.add(decal);
  });
}
```
- Requires: per-layer decal geometry, z-fighting prevention (depth offset), interaction hit-testing

---

## I. Security Model (PROPOSED)

### I.1 Upload Validation (EXTEND EXISTING)
| Check | Current | Proposed |
|-------|---------|----------|
| File size | 10MB (multer) | 10MB + server-side re-check |
| MIME type | `image/*` regex | Allowlist: png, jpeg, webp, gif, svg |
| Extension | Regex | Allowlist + magic bytes verification |
| EXIF | None | **Strip EXIF** (sharp `withMetadata(false)`) |
| Malware | None | Optional: ClamAV scan async |
| Dimensions | None | Max 4096x4096 |

### I.2 Access Control
| Resource | Current | Proposed |
|----------|---------|----------|
| `/uploads/assets/*` | Public static | **Signed URLs** (JWT + expiry) or auth middleware |
| `/uploads/designs/*` | Public static | Keep public (AI outputs) or signed |
| Asset metadata | `designs.json` userId | `assets.json` userId + RLS |

### I.3 Signed URL Implementation (PROPOSED)
```javascript
// GET /api/assets/:id/url?ttl=3600
// Returns: { url: '/uploads/assets/uuid.png?token=...&exp=...' }

// Middleware for /uploads/assets/*
function assetAuth(req, res, next) {
  const token = req.query.token;
  const exp = req.query.exp;
  if (!token || !exp || Date.now() > exp * 1000) return res.status(403).send('Expired');
  // Verify HMAC(tokenData, ASSET_URL_SECRET)
  next();
}
```

### I.4 Ownership Enforcement
- Every asset has `userId`
- Layer references `assetId` → verify ownership on order/share
- Soft delete: `deletedAt` set, exclude from listings

---

## J. Migration / Backward Compatibility (PROPOSED)

### J.1 Design Record Migration
- **Additive**: Add `layers[]` to existing records (see F.3)
- **No breaking change**: Existing `designUrl`, `frontDesignUrl`, `backDesignUrl` preserved
- **Read path**: If `layers` missing, synthesize from legacy fields

### J.2 Order Record Migration
- New orders include `layersSnapshot`
- Old orders: composites only (no layer fidelity)
- Admin UI: show "Legacy order — layer details unavailable"

### J.3 Frontend localStorage
- `blankup_design_history` already stores layers — **compatible**
- Add `assetId`, `kind` to history snapshots

### J.4 API Versioning
- No version bump needed (additive fields)
- New endpoints under same `/api/assets` namespace

---

## K. Test Matrix (PROPOSED)

### Phase 1 Test Matrix (MUST PASS before Phase 2)

| Test ID | Scenario | Expected |
|---------|----------|----------|
| T1 | Upload PNG 5MB → place on front | Layer added (kind='asset'), draggable, persists in history |
| T2 | Upload JPG 12MB → reject | 413 error, toast "File too large" |
| T3 | Upload .exe / .svg with script → reject | 400 error, toast "Invalid file type" |
| T4 | Upload → AI generate (mode='reference') | AI design created, asset kind='reference', NOT placed as layer, referenceAssetId stored |
| T5 | AI design → upload logo → place both | 2 layers on front (kind='ai-generated' + 'asset'), independent transform |
| T6 | Front: AI + logo, Back: AI + image | 2 layers each side, independent |
| T7 | Save to history → reload → layers restored | All layer props (x,y,scale,rot,z, assetId, kind) match |
| T8 | Share design → gallery shows composite | `isShared=true`, gallery shows flattened composite |
| T9 | Place order → order stores layersSnapshot | Order JSON has layersSnapshot[] with self-contained designUrl |
| T10 | Order reload (admin) → shows composites | Front/back composites render from layersSnapshot |
| T11 | Delete asset used in layer → soft delete | Asset hidden from library, layer shows placeholder, order unaffected |
| T12 | Replace asset → all layers update | Layer url updates, composite rebuilds |
| T13 | Concurrent uploads (2 tabs) → no corruption | fileStore lock serializes |
| T14 | Upload → logout → login → assets persist | Asset list loads from server |
| T15 | Malicious SVG with script → sanitized | No script execution, safe render |
| T16 | EXIF GPS data → stripped | No location data in stored file |
| T17 | 3D viewer shows composite | 3D matches 2D exactly (composite strategy) |
| T18 | Front/back toggle preserves layers | Each side independent layer list |
| T19 | Z-index reorder → composite updates | Visual stacking matches z-order |
| T20 | Layer visibility toggle | Hidden layer excluded from composite |

---

## L. Rollout Steps (PROPOSED)

### Phase 1: Asset Upload + Direct Placement (Mode 1) — **CURRENT SCOPE**
1. Backend: `POST /api/assets/upload`, `GET /api/assets`, `DELETE /api/assets/:id`
2. Backend: `assets.json` + `uploads/assets/` + auth middleware for `/uploads/assets/*`
3. Frontend: Add "Place on shirt" button in upload preview
4. Frontend: `addAssetLayer()` → `addLayer(kind:'asset')` (guard: only kind='asset')
5. Frontend: Asset library panel (tab or modal)
6. Frontend: Extend `designLayers` with `assetId`, `kind`; extend `snapLayers()` for history/share/order
7. Backend: Extend `designs.json` with `layers[]` + `referenceAssetId`
8. Backend: Extend `orders.json` with `layersSnapshot[]` (frozen, self-contained)
9. Tests: T1, T2, T3, T7, T11, T12, T13, T14, T16, T17, T18, T19, T20

### Phase 2: Reference Upload for AI (Mode 2)
1. Backend: Extend `generate-from-image` with `mode: 'reference' | 'asset'` (default `'reference'`)
2. Frontend: Radio/toggle in upload tab: "Use as reference" vs "Place as decal"
3. Frontend: `setReferenceAsset()` for AI generation
4. Tests: T4, T15

### Phase 3: Multi-Decal Composition Persistence (Mode 3)
1. Frontend: Ensure layer panel shows both AI and asset layers
2. Frontend: History/share/order include full layer list
3. Tests: T5, T6, T8, T9, T10

### Phase 4: 3D Multi-Decal (Optional Enhancement)
1. `tshirt-360.js`: `applyDesignLayers()` with multiple DecalGeometry
2. Interaction: hit-test per decal
3. Performance: texture atlas or instancing

### Phase 5: Security Hardening
1. Signed URLs for `/uploads/assets/*`
2. EXIF stripping pipeline
3. Malware scan integration
4. Orphan asset cleanup job

---

## M. Decision Log (RESOLVED)

| Decision | Rationale | Status |
|----------|-----------|--------|
| Asset as separate registry (`assets.json`) | Decouples upload from generation; enables reuse, deletion, replacement | **RESOLVED** |
| Layer `kind` field | Distinguishes asset vs AI vs text for rendering/export | **RESOLVED** |
| Composites remain derived | Single source of truth = layer array; composites cached | **RESOLVED (R2)** |
| Signed URLs for assets | Prevents public enumeration of user uploads | **RESOLVED** (Phase 1: auth middleware; Phase 5: signed URLs) |
| Soft delete for assets | Preserves order/share history; avoids broken layers | **RESOLVED** |
| No 3D multi-decal in Phase 1 | Composite matches 2D perfectly; avoids z-fighting complexity | **RESOLVED** |
| 10MB limit unchanged | AGENTS.md constraint; sufficient for logos | **VERIFIED** |
| Multer + sharp for EXIF strip | Reuse existing upload pipeline | **RESOLVED** (Phase 1: basic validation; Phase 5: EXIF strip) |
| **R1: Reference ≠ Layer** | AI reference input stored as `referenceAssetId`, never becomes layer | **RESOLVED** |
| **R3: Order snapshot frozen** | `layersSnapshot[]` with self-contained `designUrl` survives asset deletion | **RESOLVED** |

---

## N. Open Questions (UNKNOWN)

1. **SQL vs JSON for assets?** — Current uses JSON; SQL would enable transactions with orders. *Decision pending.*
2. **Asset deduplication?** — Hash-based dedup saves storage but adds complexity. *Default: no dedup Phase 1.*
3. **Guest uploads?** — Current auth requires login for AI gen. Assets need userId. *Default: authenticated only.*
4. **CDN for assets?** — `/uploads/*` served locally. *Future: Cloudflare R2 / S3.*
5. **Layer groups?** — Multiple assets grouped (e.g., logo + tagline). *Future.*

---

## O. File/Function Map (VERIFIED → PROPOSED)

| Area | Current File/Function | Proposed Change |
|------|----------------------|-----------------|
| Upload UI | `studio.html:164-199`, `studio.js:initUpload()` | Add "Place on shirt" button; radio for "reference" vs "asset" |
| Upload Handler | `studio.js:generateFromImage()` | New `placeUploadedAsset()`, `setReferenceAsset()` |
| Layer Model | `studio.js:addLayer()` | Accept `assetId`, `kind`; guard: `kind='asset'` only for asset layers |
| Asset API | — | New `backend/routes/assets.js` |
| Asset Storage | — | `backend/data/assets.json` |
| Design Record | `ai-design.js:saveDesignRecord()` | Add `layers[]` + `referenceAssetId` |
| Order Record | `orders.js:submitOrder()` | Add `layersSnapshot[]` (frozen, self-contained) |
| Composite | `studio.js:buildSideComposite()` | No change (already multi-layer) |
| 3D Viewer | `tshirt-360.js:applyDesign()` | Phase 1: composite only; Phase 2: `applyDesignLayers()` |
| History | `studio.js:saveToHistory()` | Already stores layers ✅; add `assetId`, `kind` |
| Security | `app.js:express.static(uploads)` | Add auth middleware for `/uploads/assets/*` |

---

## P. Risk Assessment (PROPOSED)

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking existing AI generation | Low | High | Additive schema; no change to generate endpoints |
| 3D/2D mismatch | Medium | Medium | Composite is single source; 3D always derives from composite |
| Asset URL leakage | Medium | Medium | Signed URLs + short TTL |
| Storage bloat | Low | Low | Orphan cleanup job + max upload size |
| Migration data loss | Low | High | Backup before migration; dry-run script |
| Performance (many layers) | Low | Medium | Canvas composite is O(n); n typically < 10 |

---

**End of Design Document**

**Next Step**: Phase 1 implementation per ECC cycle (Test → Implement → Refactor → Verify).