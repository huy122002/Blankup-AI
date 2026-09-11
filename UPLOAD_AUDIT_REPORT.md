# AI Studio Upload Image Feature - Comprehensive Audit Report

**Audit Date**: 2026-09-10  
**Branch**: `feat/verification-admin`  
**Scope**: Full lifecycle verification of 4 upload capabilities

---

## Executive Summary

The system supports **AI generation from uploaded reference images** but **does NOT support direct placement of uploaded images as independent decals/layers** without AI processing.

| Capability | Verdict | Evidence |
|------------|---------|----------|
| **A. Upload ảnh riêng (direct placement)** | **NO** | No "place on shirt" button in upload UI; `state.uploadedFile` only consumed by `generateFromImage()` |
| **B. Prompt + upload ảnh (AI uses reference)** | **YES** | `POST /api/ai-design/generate-from-image` accepts multipart `image` + `idea` prompt; returns AI-generated design |
| **C. AI design + upload logo cùng lúc (multi-decal)** | **PARTIAL** | AI generates first design; user CANNOT then upload a logo and place it as second independent layer |
| **D. Multiple decals cùng một mặt** | **PARTIAL** | Layer system exists (`designLayers{front,back}`) with move/resize/rotate/z-index, but NO way to add uploaded image as layer without AI |
| **E. Front/back độc lập** | **YES** (for AI designs) | Separate `designLayers.front` / `designLayers.back`; `setViewerSide` toggles; composites built per side |
| **F. Save/reload persistence** | **PARTIAL** | localStorage history saves layer snapshots; backend `designs.json` stores composites + `sourceImage` but NOT layer array |
| **G. Order preservation** | **YES** (composites) | Order POST sends `frontDesignUrl`/`backDesignUrl` composites; backend stores in `orders.json` |

---

## Detailed Evidence

### 1. UI Upload Zone (`frontend/studio.html:164-199`)
```html
<!-- TAB: IMAGE -->
<div class="panel-section tab-panel" data-panel="image">
  <div class="upload-zone" id="uploadDropzone">
    <input type="file" id="imageUpload" accept="image/png,image/jpeg,image/webp" hidden>
    ...
  </div>
  <div class="upload-preview" id="uploadPreview" style="display:none;">
    <img id="uploadPreviewImg" ...>
    <button id="removeUpload">✕</button>
  </div>
  <textarea id="ideaInput" placeholder="Mô tả ý tưởng chỉnh sửa dựa trên ảnh này..."></textarea>
  <button id="generateImageBtn">Tạo Design</button>
</div>
```
**Missing**: No "Place on shirt" / "Dùng ảnh này" button. Only action is **Generate Design** (AI).

### 2. Frontend Upload Logic (`frontend/js/studio.js:1096-1241`)
- `initUpload()` handles drag/drop, click, keyboard, file validation (10MB, image/*)
- Stores file in `state.uploadedFile` (line 1161)
- Preview shows data URL (line 1139)
- **No code path adds `state.uploadedFile` as a layer**
- Remove button clears `state.uploadedFile` (lines 1210, 1220)

### 3. Generate From Image (`frontend/js/studio.js:1676-1737`)
```javascript
async function generateFromImage() {
  if (!state.uploadedFile) { showToast('Vui lòng upload ảnh!'); return; }
  const formData = new FormData();
  formData.append('image', state.uploadedFile);
  formData.append('idea', ideaInput.value);
  formData.append('style', state.selectedStyle);
  // ...
  const resp = await fetch(`${API_BASE}/ai-design/generate-from-image`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth.token}` },
    body: formData,
  });
  // Result → showDesignOnMockup → addLayer(front, { url: data.designUrl, ... })
}
```
- Uploaded file sent as multipart to backend
- Backend returns **AI-generated design URL** (not the original upload)
- Result added as layer via `addLayer()` (line 1709)

### 4. Backend Endpoint (`backend/routes/ai-design.js:903-974`)
```javascript
router.post('/generate-from-image', authenticate, upload.single('image'), async (req, res) => {
  const file = req.file; // multer diskStorage → backend/uploads/design-{timestamp}-{uuid}.ext
  // Deduct credit
  // Generate via OmniRoute (images/edits endpoint with reference image)
  // Fallback to mock SVG if all providers fail (refunds credit)
  saveDesignRecord({
    designId,
    prompt: idea || 'Remix from image',
    style: 'abstract',
    sourceImage: `/uploads/${file.filename}`,  // <-- original upload saved
    designUrl,  // <-- AI-generated result
    // ...
  });
});
```
- Multer validates: 10MB limit, image mime types (jpeg/png/gif/webp/svg)
- File saved to `backend/uploads/` with unguessable name
- Served statically at `/uploads/*` (no auth check - `express.static`)
- `sourceImage` stored in `designs.json` record

### 5. Layer System (`frontend/js/studio.js:117, 1967-2077`)
```javascript
state = {
  designLayers: { front: [], back: [] },  // per-side independent
  selectedLayerId: { front: null, back: null },
  // ...
};

function addLayer(side, { url, name, designId, prompt, style, x, y, scale, rotation }) {
  // Creates layer with: id, url, kind:'image', x,y,scale,rotation,visible,z,name,designId,prompt,style,createdAt
  // Auto-selects new layer
}

function sideLayers(side) { return state.designLayers[side]; }
// Layers support: move (x,y), resize (scale), rotate, z-index (moveLayerZ), visibility, selection
```
**Capabilities exist but no entry point for uploaded images** - only AI-generated designs enter via `showDesignOnMockup → addLayer`.

### 6. 2D Composite (`frontend/js/studio.js:530-553`)
```javascript
async function buildSideComposite(side) {
  const layers = [...sideLayers(k)].filter(l => l.visible && l.url).sort((a,b) => a.z - b.z);
  // Draws all layers to canvas → returns data URL (PNG)
}
```
- Composites ALL visible layers per side
- Used for: 2D overlay, 3D texture, order submission, share, download, print preview

### 7. 3D Viewer (`frontend/js/tshirt-360.js:353-390`)
```javascript
function applyDesign(url) {
  // Single composite image applied as DecalGeometry on tshirt mesh
  // Front/back handled by showSide() camera framing
}
```
- Receives composite from `applyCurrentDesignToViewer()` (line 729)
- Shows composite - **individual layers NOT independently manipulable in 3D**

### 8. Order Submission (`frontend/js/studio.js:2256-2278`)
```javascript
commitActivePlacements();
const orderFrontComposite = await buildSideComposite('front');
const orderBackComposite = await buildSideComposite('back');
const orderData = {
  designUrl: orderFrontComposite || ...,
  frontDesignUrl: orderFrontComposite || ...,
  backDesignUrl: orderBackComposite || ...,
  // ... placement, text, product, customer, payment
};
```
- Sends **composites** (not layer array)
- Backend `orders.js:230-233` stores `designUrl`, `frontDesignUrl`, `backDesignUrl`

### 9. Save/Reload Persistence
| Storage | What's Saved | Limitation |
|---------|--------------|------------|
| `localStorage['blankup_history']` | Full layer snapshots (`layers: {front:[], back:[]}`) with x,y,scale,rotation,z | Client-only; cleared on browser data clear |
| `backend/data/designs.json` | Single record per generation: `designUrl`, `frontDesignUrl`, `backDesignUrl`, `sourceImage` | **No layer array**; composites only |
| `backend/data/orders.json` | Composites + placement coords | No layer breakdown |

### 10. Security / Ownership
- Uploaded files: `/uploads/design-{timestamp}-{uuid}.ext` - **unguessable but publicly accessible** (no auth on static)
- `designs.json` records have `userId` - ownership enforced on share/unshare (line 1009)
- Gallery only shows `isShared === true` (line 1216)
- **No per-file access control** - anyone with URL can access upload

---

## Missing Pieces for Full "Direct Upload" Capability

| Missing Component | Required For |
|-------------------|--------------|
| "Place on shirt" button in upload preview | Capability A |
| `addLayer(side, { url: uploadedFileDataURL, kind: 'upload', ... })` call | Capabilities A, C, D |
| Front/back tab awareness when placing upload | Capability E |
| Backend endpoint to accept layer array (or extended order schema) | Capability G (full fidelity) |
| 3D viewer multi-decal support (currently single composite) | Capability D (3D fidelity) |

---

## Conclusion

**The system is an "AI Design Studio with Reference Image Input" - NOT an "Image Upload & Decal Placement Studio".**

Users can:
- ✅ Upload reference image → AI generates design → design becomes layer
- ✅ Multiple AI designs on same side (each generation adds layer)
- ✅ Move/resize/rotate/z-index any layer
- ✅ Independent front/back compositions
- ✅ Order/share/download/3D reflect full composite

Users CANNOT:
- ❌ Upload logo → place directly on shirt without AI
- ❌ Upload logo → position it as independent decal alongside AI design
- ❌ Have uploaded logo persist as separate editable layer after reload (only composites saved server-side)

---

## Recommendation

If direct upload placement is required:
1. Add "Place on shirt" button in upload preview (calls `addLayer` with data URL)
2. Extend `saveDesignRecord` / order schema to persist layer array
3. Consider 3D multi-decal support for true fidelity

Current architecture supports this extension - layer system is already built.