import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// ---------------------------------------------------------------------------
// GARMENT REGISTRY — single source of truth for 3D product availability.
// ---------------------------------------------------------------------------
// To add a future real asset (e.g. hoodie-web.glb / polo-web.glb):
//   1. Drop the file into frontend/assets/models/
//   2. Set its `modelUrl` below and flip `available3D` to true
//   3. Optionally tune decalTarget / decal / camera for that garment
// No core render-engine changes are needed. NEVER point an unavailable
// garment at another garment's model — unavailable must stay unavailable.
// ---------------------------------------------------------------------------
const GARMENT_REGISTRY = {
  tshirt: {
    id: 'tshirt',
    name: 'T-Shirt',
    modelUrl: 'assets/models/tshirt-web.glb',
    available3D: true,
    // Mesh mapping for this garment's printable area.
    decalTarget: /FRONT/i,
    // Decal placement relative to model bounds (chest print area).
    decal: { scaleX: 0.42, scaleY: 0.36, depthK: 1.8, liftY: 0.06, liftZ: 0.012 },
    // Camera framing relative to model bounds.
    camera: { distanceK: 2.45, heightK: 0.06 },
    printArea: { configured: true },
  },
  hoodie: {
    id: 'hoodie',
    name: 'Hoodie',
    modelUrl: 'assets/models/hoodie-web.glb',
    available3D: true,
    // Sketchfab nodes are generic (Object_N); FRONT lives in material names
    // (Force_Fleece_FRONT, 2x2_Rib_FRONT, Fabric374733_FRONT). Decal stays on
    // front fabrics; color tints the whole garment (incl. side panels).
    decalTarget: /FRONT/i,
    colorTarget: /./,
    decal: { scaleX: 0.42, scaleY: 0.36, depthK: 1.8, liftY: 0.06, liftZ: 0.012 },
    camera: { distanceK: 2.45, heightK: 0.06 },
    printArea: { configured: true },
  },
  polo: {
    id: 'polo',
    name: 'Polo',
    modelUrl: null, // <-- set to 'assets/models/polo-web.glb' when the real asset lands
    available3D: false,
    decalTarget: null,
    decal: null,
    camera: null,
    printArea: { configured: false },
  },
};

function debug3d(...args) {
  try {
    if (localStorage.getItem('blankup_3d_debug') === '1') console.debug('[3D]', ...args);
  } catch { /* ignore */ }
}

const viewer = {
  ready: false,
  productType: 'tshirt',
  modelUrl: null,
  modelLoading: false,
  loadToken: 0,
  pendingDesignUrl: null,
  pendingDesignUrls: null,
  pendingColor: '#ffffff',
  decalMeshes: [],
  shirtMeshes: [],
  colorMeshes: [],
  appliedDesignUrl: null,
  appliedDesignUrls: { front: null, back: null },
};

window.tshirt360Viewer = {
  setDesign(url) {
    viewer.pendingDesignUrl = url;
    viewer.pendingDesignUrls = url ? { front: url, back: null } : null;
    if (viewer.ready) applyDesign(url);
  },
  setDesigns(urls) {
    // Dual-decal: { front, back } — mỗi mặt độc lập, null = không in mặt đó.
    const norm = urls ? { front: urls.front || null, back: urls.back || null } : null;
    viewer.pendingDesignUrls = norm;
    viewer.pendingDesignUrl = norm ? norm.front : null;
    if (viewer.ready) applyDesigns(norm);
  },
  getDecalInfo() {
    return {
      count: viewer.decalMeshes.length,
      applied: { ...viewer.appliedDesignUrls },
    };
  },
  setColor(color) {
    viewer.pendingColor = color;
    if (viewer.ready) applyColor(color);
  },
  resize() {
    if (viewer.resize) viewer.resize();
  },
  showSide(side) {
    if (viewer.ready) frameModel(side);
  },
  setRemoveWhiteBg(enabled) {
    return setRemoveWhiteBg(enabled);
  },
  // --- Multi-garment API (Phase 3D.1) ---
  // setProduct('hoodie') with no asset does NOT load another garment's
  // model. It enters a controlled unavailable state and reports it.
  setProduct(productType) {
    return setProduct(productType);
  },
  isAvailable(productType) {
    const entry = GARMENT_REGISTRY[productType];
    return !!(entry && entry.available3D && entry.modelUrl);
  },
  getProductState() {
    return {
      current: viewer.productType,
      available3D: this.isAvailable(viewer.productType),
      modelLoaded: viewer.ready,
      modelUrl: viewer.modelUrl,
      loading: viewer.modelLoading,
    };
  },
  getRegistry() {
    // Snapshot for UI badges (no live references).
    return Object.values(GARMENT_REGISTRY).map((g) => ({
      id: g.id,
      name: g.name,
      available3D: !!(g.available3D && g.modelUrl),
    }));
  },
};

const canvas = document.getElementById('tshirt360Canvas');
const container = document.getElementById('mockupContainer') || document.getElementById('canvasViewer') || document.getElementById('canvasWrapper') || (canvas ? canvas.parentElement : null);

if (canvas && container) {
  container.classList.add('viewer-loading');
  initializeViewer();
}

function initializeViewer() {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minPolarAngle = Math.PI * 0.32;
  controls.maxPolarAngle = Math.PI * 0.68;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8692a5, 2.2));
  const keyLight = new THREE.DirectionalLight(0xffffff, 3.4);
  keyLight.position.set(3.5, 5, 4);
  keyLight.castShadow = true;
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xdbeafe, 1.4);
  fillLight.position.set(-4, 2, 2);
  scene.add(fillLight);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(5, 64),
    new THREE.ShadowMaterial({ color: 0x0f172a, opacity: 0.14 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  viewer.renderer = renderer;
  viewer.scene = scene;
  viewer.camera = camera;
  viewer.controls = controls;
  viewer.floor = floor;

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
  };

  viewer.resize = resize;
  new ResizeObserver(resize).observe(container);
  window.addEventListener('resize', resize);
  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  // Default garment (T-Shirt). ONE renderer + ONE loop for the page lifetime.
  setProduct('tshirt');
}

// ---------------------------------------------------------------------------
// Garment model lifecycle
// ---------------------------------------------------------------------------
function setProduct(productType) {
  const entry = GARMENT_REGISTRY[productType];
  if (!entry) {
    debug3d('setProduct: unknown product', productType);
    return { status: 'error', productType, reason: 'unknown-product' };
  }
  if (viewer.productType === entry.id && viewer.ready && viewer.modelUrl === (entry.modelUrl || null)) {
    return { status: 'ready', productType: entry.id, cached: true };
  }
  if (!entry.available3D || !entry.modelUrl) {
    enterUnavailableState(entry);
    return { status: 'unavailable', productType: entry.id };
  }
  viewer.productType = entry.id;
  loadGarmentModel(entry);
  return { status: viewer.ready && viewer.modelUrl === entry.modelUrl ? 'ready' : 'loading', productType: entry.id };
}

function enterUnavailableState(entry) {
  // Controlled state: do NOT touch another garment's model as a fake.
  // Dispose the current model so the canvas never shows the wrong garment.
  debug3d('setProduct: unavailable, entering controlled state', entry.id);
  viewer.loadToken += 1; // invalidate any in-flight load
  viewer.productType = entry.id;
  disposeCurrentModel();
  viewer.ready = false;
  viewer.modelLoading = false;
  container.classList.remove('viewer-loading', 'has-real-3d');
  container.classList.add('garment-unavailable');
  const msg = container.querySelector('.garment-unavailable-msg');
  if (msg) {
    msg.hidden = false;
    msg.textContent = `Mẫu 3D ${entry.name} đang được bổ sung — bạn vẫn xem trước 2D và đặt hàng bình thường.`;
  }
}

function exitUnavailableState() {
  container.classList.remove('garment-unavailable');
  const msg = container.querySelector('.garment-unavailable-msg');
  if (msg) msg.hidden = true;
}

function disposeCurrentModel() {
  clearDecals();
  if (viewer.model) {
    viewer.model.traverse((object) => {
      if (!object.isMesh) return;
      if (object.geometry) object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        if (!material) return;
        Object.values(material).forEach((value) => {
          if (value && value.isTexture) value.dispose();
        });
        material.dispose();
      });
    });
    viewer.scene.remove(viewer.model);
    viewer.model = null;
  }
  viewer.shirtMeshes = [];
  viewer.colorMeshes = [];
  viewer.bounds = null;
}

function loadGarmentModel(entry) {
  const token = ++viewer.loadToken;
  viewer.modelLoading = true;
  viewer.ready = false;
  exitUnavailableState();
  container.classList.remove('has-real-3d');
  container.classList.add('viewer-loading');
  debug3d('loadGarmentModel: start', entry.id, entry.modelUrl);

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.load(
    entry.modelUrl,
    (gltf) => {
      if (token !== viewer.loadToken) {
        debug3d('loadGarmentModel: stale load ignored', entry.id);
        return; // a newer setProduct() superseded this load
      }
      onModelLoaded(gltf.scene, entry);
    },
    undefined,
    (error) => {
      if (token !== viewer.loadToken) return;
      viewer.modelLoading = false;
      container.classList.remove('viewer-loading');
      container.classList.add('viewer-fallback');
      const fallbackMsg = document.createElement('div');
      fallbackMsg.className = 'viewer-error-msg';
      fallbackMsg.textContent = 'Không thể tải mô hình 3D — đang hiển thị bản xem 2D.';
      fallbackMsg.setAttribute('role', 'status');
      container.appendChild(fallbackMsg);
      console.warn('Could not load 3D garment model:', entry.id, error);
      if (window.showToast) window.showToast('Không thể tải mô hình 3D, đã chuyển sang xem 2D.', 'warning');
    }
  );
}

function onModelLoaded(model, entry) {
  const targetRe = entry.decalTarget instanceof RegExp ? entry.decalTarget : null;
  const colorRe = entry.colorTarget instanceof RegExp ? entry.colorTarget : null;
  // Sketchfab-sourced models use generic node names (Object_N) with the real
  // part names living in MATERIALS — match against both so decalTarget keeps
  // working for curated models (name match) and generic ones (material match).
  const matchTarget = (object) => {
    if (!targetRe) return false;
    if (targetRe.test(object.name || '')) return true;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    return materials.some((m) => targetRe.test(m?.name || ''));
  };
  model.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    if (matchTarget(object)) viewer.shirtMeshes.push(object);
    if (!colorRe) return;
    if (colorRe.test(object.name || '')) viewer.colorMeshes.push(object);
    else {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (materials.some((m) => colorRe.test(m?.name || ''))) viewer.colorMeshes.push(object);
    }
  });

  if (!viewer.shirtMeshes.length) {
    model.traverse((object) => {
      if (object.isMesh) viewer.shirtMeshes.push(object);
    });
  }
  // Default: color follows the decal set (tshirt behavior unchanged).
  if (!viewer.colorMeshes.length) viewer.colorMeshes = [...viewer.shirtMeshes];

  viewer.model = model;
  viewer.modelUrl = entry.modelUrl;
  viewer.scene.add(model);
  frameModel('front', entry);
  viewer.ready = true;
  viewer.modelLoading = false;
  container.classList.remove('viewer-loading');
  container.classList.add('has-real-3d');
  debug3d('loadGarmentModel: ready', entry.id, 'meshes=', viewer.shirtMeshes.length);
  applyColor(viewer.pendingColor);
  if (viewer.pendingDesignUrls) applyDesigns(viewer.pendingDesignUrls);
  else if (viewer.pendingDesignUrl) applyDesign(viewer.pendingDesignUrl);
}

function frameModel(side = 'front', entry) {
  const cfg = (entry && entry.camera) || { distanceK: 2.45, heightK: 0.06 };
  const box = new THREE.Box3().setFromObject(viewer.model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const largest = Math.max(size.x, size.y, size.z);

  viewer.bounds = { box, size, center };
  const direction = side === 'back' ? -1 : 1;
  viewer.camera.position.set(center.x, center.y + size.y * cfg.heightK, center.z + direction * largest * cfg.distanceK);
  viewer.controls.target.set(center.x, center.y, center.z);
  viewer.controls.update();
  viewer.floor.position.set(center.x, box.min.y - size.y * 0.02, center.z);
}

function applyColor(color) {
  viewer.colorMeshes.forEach((mesh) => {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => {
      if (material?.color) material.color.set(color);
    });
  });
}

function clearDecals() {
  viewer.decalMeshes.forEach((mesh) => {
    mesh.geometry.dispose();
    mesh.material.dispose();
    viewer.scene.remove(mesh);
  });
  viewer.decalMeshes = [];
  viewer.decalUniforms = [];
  viewer.appliedDesignUrl = null;
  viewer.appliedDesignUrls = { front: null, back: null };
}

function applyDesign(url) {
  // Legacy single-URL entry (front-only). Delegates to the dual-side version.
  applyDesigns(url ? { front: url, back: null } : null);
}

/* Họa tiết in — hỗ trợ ĐỘC LẬP mặt trước VÀ mặt sau.
   applyDesigns({ front, back }): mỗi bên 1 texture (hoặc null = không in).
   Decal trước: +Z; decal sau: -Z + quay Y theo PI (đọc đúng chiều khi xem từ sau). */
function applyDesigns(urls) {
  // Decal clipping runs on the main thread over a dense garment mesh, so
  // re-running it for an identical URL (color/product/position changes)
  // would wedge the UI for seconds. Skip when nothing changed.
  const norm = urls ? { front: urls.front || null, back: urls.back || null } : { front: null, back: null };
  if (!norm.front && !norm.back) {
    if (viewer.decalMeshes.length) clearDecals();
    return;
  }
  if (norm.front === viewer.appliedDesignUrls.front && norm.back === viewer.appliedDesignUrls.back && viewer.decalMeshes.length) return;
  clearDecals();
  viewer.appliedDesignUrls = { ...norm };
  viewer.appliedDesignUrl = norm.front;

  const entry = GARMENT_REGISTRY[viewer.productType];
  const decalCfg = (entry && entry.decal) || { scaleX: 0.42, scaleY: 0.36, depthK: 1.8, liftY: 0.06, liftZ: 0.012 };
  const { box, size, center } = viewer.bounds;
  const loader = new THREE.TextureLoader();
  const sides = [];
  if (norm.front) sides.push({ side: 'front', url: norm.front });
  if (norm.back) sides.push({ side: 'back', url: norm.back });

  for (const s of sides) {
    loader.load(s.url, (texture) => {
    // Stale-callback guard: the garment may have been disposed (product
    // switch) while the texture was in flight — never crash on dead state.
    if (!viewer.bounds || !viewer.shirtMeshes.length) return;
    // A newer design request superseded this load; drop it quietly instead
    // of painting an outdated design.
    if (viewer.appliedDesignUrls[s.side] !== s.url) {
      texture.dispose();
      return;
    }
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = true;
    texture.anisotropy = Math.min(8, viewer.renderer.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;

    const entry = GARMENT_REGISTRY[viewer.productType];
    const decalCfg = (entry && entry.decal) || { scaleX: 0.42, scaleY: 0.36, depthK: 1.8, liftY: 0.06, liftZ: 0.012 };
    const { box, size, center } = viewer.bounds;
    // Back decal: phía -Z + quay Y theo PI (đọc đúng chiều khi nhìn từ sau).
    const position = s.side === 'back'
      ? new THREE.Vector3(center.x, center.y + size.y * decalCfg.liftY, box.min.z - size.z * decalCfg.liftZ)
      : new THREE.Vector3(center.x, center.y + size.y * decalCfg.liftY, box.max.z + size.z * decalCfg.liftZ);
    const orientation = s.side === 'back' ? new THREE.Euler(0, Math.PI, 0) : new THREE.Euler(0, 0, 0);
    const decalSize = new THREE.Vector3(size.x * decalCfg.scaleX, size.y * decalCfg.scaleY, Math.max(0.08, size.z * decalCfg.depthK));

    viewer.shirtMeshes.forEach((target) => {
      const geometry = new DecalGeometry(target, position, orientation, decalSize);
      /* DecalGeometry với depth lớn bắt CẢ 2 bề mặt áo (trước + sau) — decal
         mặt sau tạo geometry mirror chui ra mặt trước (và ngược lại). Lọc
         giữ chỉ tam giác pháp tuyến hướng về phía projector của mặt đó. */
      const pos = geometry.attributes.position;
      const norm = geometry.attributes.normal;
      const uvAttr = geometry.attributes.uv;
      const idx = geometry.index;
      // Phía projector: front = +Z, back = -Z (trục local áo, xấp xỉ Z world).
      const sideSign = s.side === 'back' ? -1 : 1;
      const keep = [];
      const triCount = idx ? idx.count / 3 : pos.count / 3;
      for (let t = 0; t < triCount; t++) {
        const i0 = idx ? idx.getX(t * 3) : t * 3;
        // Normal trung bình của tam giác (per-vertex normals).
        const nx = (norm.getX(i0) + norm.getX(i0 + 1) + norm.getX(i0 + 2)) / 3;
        const nz = (norm.getZ(i0) + norm.getZ(i0 + 1) + norm.getZ(i0 + 2)) / 3;
        // Ưu tiên Z (hướng bề mặt áo trước/sau); nếu gần vuông góc thì xét cả X.
        const facing = Math.abs(nz) >= 0.3 ? nz * sideSign : (nx !== 0 ? nx * sideSign : 1);
        if (facing > 0.05) {
          for (let k = 0; k < 3; k++) {
            const vi = idx ? idx.getX(t * 3 + k) : t * 3 + k;
            keep.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi), norm.getX(vi), norm.getY(vi), norm.getZ(vi), uvAttr.getX(vi), uvAttr.getY(vi));
          }
        }
      }
      if (!keep.length) return;
      const filtered = new THREE.BufferGeometry();
      filtered.setAttribute('position', new THREE.Float32BufferAttribute(keep.filter((_, i) => i % 8 < 3), 3));
      filtered.setAttribute('normal', new THREE.Float32BufferAttribute(keep.filter((_, i) => i % 8 >= 3 && i % 8 < 6), 3));
      filtered.setAttribute('uv', new THREE.Float32BufferAttribute(keep.filter((_, i) => i % 8 >= 6), 2));
      if (!filtered.attributes.position.count) return;
      const uniforms = {
        map: { value: texture },
        uRemoveWhite: { value: viewer.removeWhiteBg !== false },
      };
      const material = new THREE.ShaderMaterial({
        uniforms,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D map;
          uniform float uRemoveWhite;
          varying vec2 vUv;
          void main() {
            vec4 pixel = texture2D(map, vUv);
            if (pixel.a < 0.08) discard;
            if (uRemoveWhite > 0.5) {
              float high = max(pixel.r, max(pixel.g, pixel.b));
              float low = min(pixel.r, min(pixel.g, pixel.b));
              if (high > 0.84 && high - low < 0.22) discard;
            }
            gl_FragColor = pixel;
          }
        `,
      });
      const decal = new THREE.Mesh(filtered, material);
      decal.renderOrder = 2;
      geometry.dispose(); // Geometry gốc 2-bề-mặt không còn được dùng.
      viewer.scene.add(decal);
      viewer.decalMeshes.push(decal);
      viewer.decalUniforms.push(uniforms);
    });
  }, undefined, (err) => {
    console.warn('[3D] Failed to load decal texture:', s.url, err);
    if (window.showToast) window.showToast('Không thể tải họa tiết lên mô hình 3D.', 'warning');
  });
  }
}

function setRemoveWhiteBg(enabled) {
  if (!viewer) return;
  viewer.removeWhiteBg = !!enabled;
  if (viewer.decalUniforms) {
    viewer.decalUniforms.forEach((u) => { u.uRemoveWhite.value = viewer.removeWhiteBg; });
  }
  return viewer.removeWhiteBg;
}
