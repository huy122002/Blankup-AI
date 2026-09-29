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
/* PHASE 5 — PRINT PROJECTION SPEC.
   Artwork sống trong DESIGN SPACE (composite 1024×1024 = VUÔNG, aspect 1:1).
   Mọi garment PHẢI project design space đó với ĐÚNG aspect của nó. Trước đây
   plane decal lấy HAI phân số độc lập của model bounds (scaleX*size.x và
   scaleY*size.y) → cùng một ảnh vuông bị kéo giãn khác nhau tuỳ áo
   (tshirt +5%, hoodie +37%) — đúng lỗi biến dạng khi đổi sản phẩm.
   Quy tắc mới: plane decal suy ra từ MỘT chiều + aspect design space, nên
   aspect không bao giờ phụ thuộc hình dáng model.
     - print.heightFrac: chiều cao vùng in theo tỉ lệ chiều cao model
       (calibration vật lý cho vùng in ngực của từng garment).
     - print.aspect: W:H vùng in = aspect design space (bất biến theo garment).
   Đổi kích thước in của một garment = sửa DUY NHẤT heightFrac của nó. */
const DESIGN_SPACE_ASPECT = 1; // composite 1024×1024 trong studio.js

function printProjectionSize(entry, size) {
  const spec = (entry && entry.print) || {};
  const heightFrac = Number(spec.heightFrac) > 0 ? Number(spec.heightFrac) : 0.36;
  const aspect = Number(spec.aspect) > 0 ? Number(spec.aspect) : DESIGN_SPACE_ASPECT;
  const h = size.y * heightFrac;
  const w = h * aspect;
  return { w, h, aspect, heightFrac };
}

/* PHASE 5 — BỀ MẶT IN THẬT (raycast), không đoán hướng model.
   Mỗi GLB có thể quay mặt trước về +Z hoặc -Z. Trước đây decal được đặt cứng
   ở box.max.z + lọc tam giác theo dấu nz → với hoodie, ảnh in rơi vào MẶT
   TRONG của áo và chỉ lọt ra qua khe cổ/khoá (ảnh gần như vô hình, nhìn như
   "biến dạng"). Cách làm mới: raycast từ ngoài vào tâm vùng in để tìm BỀ MẶT
   NGOÀI thật của từng mặt, rồi đặt decal đúng trên bề mặt đó và lọc tam giác
   theo pháp tuyến của chính bề mặt ấy. Nhờ vậy garment nào (kể cả polo sau
   này) cũng in đúng mặt đang nhìn mà không cần hardcode hướng. */
const PRINT_SURFACE_CACHE = new Map(); // key: `${productType}:${side}`

function resolvePrintSurface(side) {
  if (!viewer.bounds || !viewer.model || !viewer.shirtMeshes.length) return null;
  const key = `${viewer.productType}:${side}`;
  if (PRINT_SURFACE_CACHE.has(key)) return PRINT_SURFACE_CACHE.get(key);
  const { size, center } = viewer.bounds;
  const entry = GARMENT_REGISTRY[viewer.productType];
  const decalCfg = (entry && entry.decal) || { liftY: 0.03 };
  const L = Math.max(size.x, size.y, size.z) * 1.5;
  const targetY = center.y + size.y * decalCfg.liftY;
  const aim = new THREE.Vector3(center.x, targetY, center.z);
  const raycaster = new THREE.Raycaster();
  const nominal = side === 'back' ? -1 : 1;
  let result = null;
  // Ưu tiên phía nominal (mặt trước = +Z, mặt sau = -Z); nếu model quay ngược
  // thì tự động lấy phía còn lại.
  for (const s of [nominal, -nominal]) {
    raycaster.set(new THREE.Vector3(aim.x, aim.y, aim.z + s * L), new THREE.Vector3(0, 0, -s));
    raycaster.far = L * 2.5;
    const hits = raycaster.intersectObjects(viewer.shirtMeshes, false);
    const hit = hits.find((h) => {
      if (!h.face) return false;
      const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
      return Math.abs(n.z) > 0.25; // bỏ qua mảnh vải hẹp (khoá áo, viền...)
    });
    if (!hit) continue;
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
    result = {
      point: hit.point.clone(),
      normal,
      sign: normal.z >= 0 ? 1 : -1,
      meshName: hit.object.name || '',
    };
    break;
  }
  PRINT_SURFACE_CACHE.set(key, result);
  debug3d('printSurface', key, result ? `${result.meshName} sign=${result.sign}` : 'unresolved');
  return result;
}

const GARMENT_REGISTRY = {
  tshirt: {
    id: 'tshirt',
    name: 'T-Shirt',
    modelUrl: 'assets/models/tshirt-web.glb',
    available3D: true,
    // Mesh mapping for this garment's printable area.
    decalTarget: /FRONT/i,
    // Decal placement relative to model bounds (depth/lift only — kích thước
    // plane do `print` quyết định).
    decal: { depthK: 1.8, liftY: 0.03, liftZ: 0.012 },
    // Vùng in ngực: cao 36% chiều cao áo, aspect = design space (1:1).
    print: { configured: true, heightFrac: 0.36, aspect: DESIGN_SPACE_ASPECT },
    // Camera framing relative to model bounds.
    camera: { distanceK: 2.45, heightK: 0.06 },
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
    decal: { depthK: 1.8, liftY: 0.03, liftZ: 0.012 },
    // CÙNG một spec design-space như tshirt → ảnh in không bị biến dạng khi
    // chuyển áo: chỉ khác kích thước vật lý, không khác aspect.
    print: { configured: true, heightFrac: 0.36, aspect: DESIGN_SPACE_ASPECT },
    camera: { distanceK: 2.45, heightK: 0.06 },
  },
  polo: {
    id: 'polo',
    name: 'Polo',
    modelUrl: null, // <-- set to 'assets/models/polo-web.glb' when the real asset lands
    available3D: false,
    decalTarget: null,
    decal: null,
    camera: null,
    print: { configured: false },
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
  decalsHidden: false,
  applyToken: 0,
  onDecalSwap: null,
  // PHASE 4: cache model đã parse theo product (bounded) — switch qua lại
  // KHÔNG tải lại GLB 2.4–3.6MB và không parse lại mỗi lần bấm.
  modelCache: new Map(),
  applyLog: [], // PHASE 5: nhật ký dựng decal (evidence cho race/async)
};

const MODEL_CACHE_MAX = 2;

window.tshirt360Viewer = {
  // onDecalSwap do studio.js gán qua window object, nhưng applyDesigns đọc từ
  // viewer nội bộ → forward bằng getter/setter (cùng họ vấn đề setInteractionMode).
  get onDecalSwap() { return viewer.onDecalSwap; },
  set onDecalSwap(fn) { viewer.onDecalSwap = fn; },
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
  // Studio gọi khi đổi giữa chế độ kéo layer (position → orbit OFF) và
  // xoay áo (rotate → orbit ON). Không-an-trước khi initializeViewer chạy.
  setInteractionMode(mode) {
    if (viewer.setInteractionMode) viewer.setInteractionMode(mode);
  },
  // Đang kéo layer: ẩn decal 3D (preview 2D thay thế theo con trỏ), thả
  // chuột: hiện lại — decal đã được swap sẵn tại vị trí mới (atomic).
  setDecalsHidden(hidden) {
    viewer.decalsHidden = !!hidden;
    viewer.decalMeshes.forEach((m) => { m.visible = !viewer.decalsHidden; });
  },
  // Bề rộng decal TRÊN MÀN HÌNH (px) — project bounding-box 3D qua camera.
  // Studio dùng để đặt bản-sao-kéo đúng kích thước ảnh thật (không phóng to
  // khi vừa nhấn kéo, không thu lại khi thả).
  getDecalScreenWidth(side = 'front') {
    if (!viewer.ready || !viewer.decalMeshes.length || !viewer.camera) return 0;
    // PHASE 5: đo HỢP của mọi patch thuộc mặt đang xét. Trước đây lấy patch
    // ĐẦU TIÊN → trên hoodie patch đầu là dải khoá áo mỏng (8px) nên preview
    // kéo/boundary bị bé tí dù vùng in thật rộng.
    const sidePatches = viewer.decalMeshes.filter((m) => (m.userData?.side || 'front') === side);
    const patches = sidePatches.length ? sidePatches : viewer.decalMeshes;
    try {
      const box = new THREE.Box3();
      patches.forEach((m) => box.union(new THREE.Box3().setFromObject(m)));
      if (box.isEmpty()) return 0;
      const rect = canvas.getBoundingClientRect();
      let minX = Infinity, maxX = -Infinity;
      for (let i = 0; i < 8; i++) {
        const v = new THREE.Vector3(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z,
        ).project(viewer.camera);
        const sx = (v.x * 0.5 + 0.5) * rect.width;
        minX = Math.min(minX, sx);
        maxX = Math.max(maxX, sx);
      }
      return maxX - minX;
    } catch (e) { return 0; }
  },
  /* CHUYỂN ĐỔI TỌA ĐỘ ĐÚNG THEO PIXEL 3D — chìa khóa hết lệch drag:
     điểm (px, py) theo % vị trí composite (hệ tạo ảnh in) → tọa độ màn hình
     thật. Cách làm: điểm 3D trên mặt decal plane = center + offset theo tỷ lệ
     decal (decal chiếm vùng in theo PRINT projection spec, composite 1024 map trọn
     vào decal) → project qua camera → pixel. Studio dùng để đặt preview/ghost
     đúng pixel nơi ảnh sẽ in, kéo tới đâu thấy đúng đó. */
  screenPosFromPrintPoint(px, py, side = 'front') {
    if (!viewer.ready || !viewer.camera || !viewer.bounds) return null;
    try {
      const entry = GARMENT_REGISTRY[viewer.productType];
      const decalCfg = (entry && entry.decal) || { liftY: 0.03 };
      const { size, center } = viewer.bounds;
      // Bán kính decal trên thân áo (theo 2 trục). Điểm (px,py) hệ %: tâm (0,0).
      // Kích thước plane lấy từ PRINT PROJECTION SPEC (aspect bất biến theo áo).
      const projSize = printProjectionSize(entry, size);
      const decalW = projSize.w;
      const decalH = projSize.h;
      const x = center.x + (px / 100) * (decalW / 2);
      // Trục Y thế giới: py dương = XUỐNG dưới (hệ ảnh) → trừ.
      // printCenterOffset: hệ tạo ảnh đặt tâm dọc ở 44% cao vùng in (decal
      // origin tại 50%) → dịch +6% để khớp pixel với bản in thật.
      const printCenterOffset = 0.06 * decalH;
      const yFinal = center.y + size.y * decalCfg.liftY - (py / 100) * (decalH / 2) + printCenterOffset;
      // PHASE 5: z lấy từ bề mặt in thật (raycast) → preview/ghost/kéo khớp
      // đúng chỗ ảnh được in, kể cả khi model quay mặt khác hướng.
      const surface = resolvePrintSurface(side);
      const sideSign = surface ? surface.sign : (side === 'back' ? -1 : 1);
      const zBase = surface
        ? surface.point.z + sideSign * size.z * decalCfg.liftZ
        : (side === 'back'
          ? viewer.bounds.box.min.z - size.z * decalCfg.liftZ
          : viewer.bounds.box.max.z + size.z * decalCfg.liftZ);
      // Nới z về phía camera 1 chút để project không bị mặt áo che.
      const z = zBase + sideSign * size.z * 0.05;
      const rect = canvas.getBoundingClientRect();
      const proj = new THREE.Vector3(x, yFinal, z).project(viewer.camera);
      return {
        x: rect.left + (proj.x * 0.5 + 0.5) * rect.width,
        y: rect.top + (-proj.y * 0.5 + 0.5) * rect.height,
        visible: proj.z < 1,
      };
    } catch (e) { return null; }
  },
  /* Bán kính decal trên MÀN HÌNH theo từng trục (px) — boundary khớp pixel. */
  getDecalScreenRadii(side = 'front') {
    const dw = this.getDecalScreenWidth(side);
    if (!dw) return null;
    const entry = GARMENT_REGISTRY[viewer.productType];
    const { size } = viewer.bounds;
    // Tỷ lệ W:H của vùng in = aspect design space (1:1) → không phụ thuộc model.
    const proj = printProjectionSize(entry, size);
    const ratio = proj.h / proj.w;
    return { w: dw, h: dw * ratio };
  },
  setColor(color) {
    viewer.pendingColor = color;
    if (viewer.ready) applyColor(color);
  },
  resize() {
    if (viewer.resize) viewer.resize();
  },
  // Render MỘT frame đồng bộ (không qua rAF loop). Dùng cho kiểm thử: đọc
  // pixel ngay sau lời gọi này trong cùng task vẫn hợp lệ kể cả khi tab ẩn
  // (rAF bị throttle 0 — buffer đã bị xóa sau composite).
  renderFrame() {
    if (viewer.ready && viewer.renderer && viewer.scene && viewer.camera) {
      viewer.controls.update();
      viewer.renderer.render(viewer.scene, viewer.camera);
      return true;
    }
    return false;
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
  // PHASE 5: log ngắn (bounded) các lần dựng decal — dùng để chứng minh không
  // có race/lần dựng nào bị bỏ rơi khi đổi sản phẩm.
  getApplyLog() {
    return viewer.applyLog.slice(-20);
  },
  // PHASE 5: chẩn đoán mapping vải → decal (read-only). Cho biết mesh nào đang
  // nhận decal và kích thước THẬT của từng patch — dùng để phát hiện decal in
  // nhầm lên vải lót (fleece lining) khiến ảnh in gần như vô hình / méo.
  getDecalMeshDebug() {
    if (!viewer.model) return null;
    const box3 = new THREE.Box3();
    const meshes = [];
    viewer.model.traverse((o) => {
      if (!o.isMesh) return;
      box3.setFromObject(o);
      const s = box3.getSize(new THREE.Vector3());
      const mats = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => m?.name || '');
      meshes.push({
        name: o.name || '',
        materials: mats,
        size: { x: +s.x.toFixed(3), y: +s.y.toFixed(3), z: +s.z.toFixed(3) },
        isDecalTarget: viewer.shirtMeshes.includes(o),
      });
    });
    const patches = viewer.decalMeshes.map((m) => {
      box3.setFromObject(m);
      const s = box3.getSize(new THREE.Vector3());
      const c = box3.getCenter(new THREE.Vector3());
      return { side: m.userData?.side || null, size: { x: +s.x.toFixed(3), y: +s.y.toFixed(3) },
               z: { min: +box3.min.z.toFixed(3), max: +box3.max.z.toFixed(3) },
               center: { x: +c.x.toFixed(3), y: +c.y.toFixed(3), z: +c.z.toFixed(3) },
               visible: m.visible, inScene: !!m.parent, renderOrder: m.renderOrder,
               tris: m.geometry?.attributes?.position ? m.geometry.attributes.position.count / 3 : 0 };
    });
    const mb = new THREE.Box3().setFromObject(viewer.model);
    return {
      product: viewer.productType, meshes, decalPatches: patches,
      modelBounds: { minZ: +mb.min.z.toFixed(3), maxZ: +mb.max.z.toFixed(3),
                     minY: +mb.min.y.toFixed(3), maxY: +mb.max.y.toFixed(3) },
      camera: viewer.camera ? { x: +viewer.camera.position.x.toFixed(3), y: +viewer.camera.position.y.toFixed(3), z: +viewer.camera.position.z.toFixed(3) } : null,
    };
  },
  // PHASE 5: introspection cho test/evidence — spec projection của garment hiện
  // tại. decalAspectHW phải LUÔN xấp xỉ designSpaceAspect (1:1) trên mọi áo;
  // đây là thước đo trực tiếp độ biến dạng artwork khi đổi sản phẩm.
  getPrintProjection() {
    if (!viewer.bounds) return null;
    const entry = GARMENT_REGISTRY[viewer.productType];
    const { size } = viewer.bounds;
    const proj = printProjectionSize(entry, size);
    return {
      product: viewer.productType,
      modelSize: { x: size.x, y: size.y, z: size.z },
      print: { w: proj.w, h: proj.h, heightFrac: proj.heightFrac, aspect: proj.aspect },
      decalAspectHW: proj.h / proj.w,
      designSpaceAspect: DESIGN_SPACE_ASPECT,
      decalCount: viewer.decalMeshes.length,
      // Bề mặt in thật mà raycast tìm được (mặt người dùng đang nhìn).
      printSurface: (() => {
        const s = resolvePrintSurface('front');
        return s ? { mesh: s.meshName, sign: s.sign,
                     point: { x: +s.point.x.toFixed(3), y: +s.point.y.toFixed(3), z: +s.point.z.toFixed(3) },
                     normal: { x: +s.normal.x.toFixed(3), y: +s.normal.y.toFixed(3), z: +s.normal.z.toFixed(3) } }
                 : null;
      })(),
    };
  },
  // PHASE 4: introspection cho test/evidence — đếm model product đang sống trong scene.
  getProductModelCounts() {
    if (!viewer.scene) return { total: 0, byProduct: {} };
    const byProduct = {};
    let total = 0;
    viewer.scene.traverse((obj) => {
      if (obj.userData && obj.userData.productType) {
        byProduct[obj.userData.productType] = (byProduct[obj.userData.productType] || 0) + 1;
        total++;
      }
    });
    return { total, byProduct };
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
  // Xoay CHỈ khi nhấn giữ + kéo; thả chuột → dừng NGAY (không quán tính).
  // Damping gây quán tính xoay tiếp sau khi thả — cảm giác “không controlled”
  // theo feedback người dùng → tắt hẳn, orbit trực tiếp theo con trỏ.
  controls.enableDamping = false;
  controls.enablePan = false;
  // Chỉ còn 2 luồng thao tác: kéo trái = xoay, lăn = zoom. Khóa cách khác.
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: null };
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

  // Studio đổi giữa 2 chế độ: kéo layer (orbit phải TẮT — không áo xoay theo
  // khi kéo mẫu in) và xoay áo (orbit BẬT). Hook này studio.js đã gọi từ trước
  // nhưng chưa từng được implement — giờ là code thật.
  viewer.setInteractionMode = (mode) => { controls.enabled = mode !== 'position'; };

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
  // PHASE 4: model đã từng load → kích hoạt tức thì từ cache (0 network, 0 parse).
  const cachedEntry = viewer.modelCache.get(entry.id);
  if (cachedEntry) {
    viewer.loadToken += 1; // vô hiệu hoá mọi GLB load đang bay
    activateModel(cachedEntry, entry, { fromCache: true });
    return { status: 'ready', productType: entry.id, fromCache: true };
  }
  loadGarmentModel(entry);
  return { status: viewer.ready && viewer.modelUrl === entry.modelUrl ? 'ready' : 'loading', productType: entry.id };
}

function enterUnavailableState(entry) {
  // Controlled state: do NOT touch another garment's model as a fake.
  // Gỡ model hiện tại khỏi scene (model vẫn nằm trong cache để quay lại tức thì)
  // — canvas không bao giờ hiển thị sai loại áo.
  debug3d('setProduct: unavailable, entering controlled state', entry.id);
  viewer.loadToken += 1; // invalidate any in-flight load
  viewer.productType = entry.id;
  detachCurrentModel();
  pruneModelCache(entry.id);
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

/* Gỡ model đang hiển thị khỏi scene NHƯNG không dispose (model nằm trong
   modelCache để quay lại tức thì). Decal luôn bị gỡ vì geometry decal gắn
   với mesh của model cũ. */
function detachCurrentModel() {
  clearDecals();
  if (viewer.model) {
    viewer.scene.remove(viewer.model);
    viewer.model = null;
  }
  viewer.shirtMeshes = [];
  viewer.colorMeshes = [];
  viewer.bounds = null;
  viewer.ready = false;
}

/* Giải phóng tài nguyên của MỘT entry cache (chỉ thuộc model đó). */
function disposeModelEntry(cached) {
  if (!cached || !cached.model) return;
  cached.model.traverse((object) => {
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
}

/* Bounded LRU: tối đa MODEL_CACHE_MAX model sống; vượt thì dispose cái cũ
   nhất (trừ product đang dùng). Nếu model bị gỡ không nằm trong cache
   (trường hợp hiếm), dispose luôn để không rò tài nguyên. */
function pruneModelCache(keepId) {
  const activeInCache = viewer.model ? [...viewer.modelCache.values()].some((c) => c.model === viewer.model) : false;
  if (viewer.model && !activeInCache) {
    disposeModelEntry({ model: viewer.model });
  }
  while (viewer.modelCache.size > MODEL_CACHE_MAX) {
    const victimKey = [...viewer.modelCache.keys()].find((k) => k !== keepId && viewer.modelCache.get(k).model !== viewer.model);
    if (victimKey === undefined) break;
    disposeModelEntry(viewer.modelCache.get(victimKey));
    viewer.modelCache.delete(victimKey);
    debug3d('pruneModelCache: disposed', victimKey);
  }
}

/* PHASE 4: kích hoạt model (vừa load xong hoặc từ cache) — ATOMIC SWAP:
   model cũ rời scene ngay trước khi model mới vào nên scene KHÔNG BAO GIỜ chứa
   2 product cùng lúc; design + màu hiện tại được áp lại trên model mới. */
function activateModel(cached, entry, { fromCache = false } = {}) {
  detachCurrentModel();
  exitUnavailableState(); // model thật đang vào → xoá trạng thái "3D đang bổ sung"
  viewer.model = cached.model;
  viewer.modelUrl = entry.modelUrl;
  viewer.shirtMeshes = cached.shirtMeshes;
  viewer.colorMeshes = cached.colorMeshes;
  cached.model.userData.productType = entry.id; // introspection: model nào thuộc product nào
  viewer.scene.add(cached.model);
  frameModel('front', entry);
  viewer.ready = true;
  viewer.modelLoading = false;
  container.classList.remove('viewer-loading', 'viewer-fallback');
  container.classList.add('has-real-3d');
  debug3d('activateModel', entry.id, fromCache ? '(cache)' : '(fresh)', 'meshes=', viewer.shirtMeshes.length);
  applyColor(viewer.pendingColor);
  if (viewer.pendingDesignUrls) applyDesigns(viewer.pendingDesignUrls);
  else if (viewer.pendingDesignUrl) applyDesign(viewer.pendingDesignUrl);
}

function loadGarmentModel(entry) {
  const token = ++viewer.loadToken;
  viewer.modelLoading = true;
  // PHASE 4 P0: REPLACE semantics — model cũ và model mới KHÔNG BAO GIỜ cùng
  // nằm trong scene. Model cũ được giữ hiển thị trong lúc tải (tránh nháy
  // canvas trống) rồi được gỡ CHÍNH XÁC tại activateModel() khi model mới sẵn
  // sàng — trước đây onModelLoaded chỉ scene.add() mà không gỡ model cũ, nên
  // tshirt → hoodie → tshirt để lại 3 model chồng nhau trong scene.
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
      // Load lỗi: KHÔNG để lại model hỏng trong scene. Model cũ (nếu có) vẫn
      // đang hiển thị nguyên vẹn — chỉ báo lỗi cho user, không dựng model giả.
      if (!viewer.ready) {
        container.classList.add('viewer-fallback');
        const fallbackMsg = document.createElement('div');
        fallbackMsg.className = 'viewer-error-msg';
        fallbackMsg.textContent = 'Không thể tải mô hình 3D — đang hiển thị bản xem 2D.';
        fallbackMsg.setAttribute('role', 'status');
        container.appendChild(fallbackMsg);
      }
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
  const shirtMeshes = [];
  const colorMeshes = [];
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
    if (matchTarget(object)) shirtMeshes.push(object);
    if (!colorRe) return;
    if (colorRe.test(object.name || '')) colorMeshes.push(object);
    else {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (materials.some((m) => colorRe.test(m?.name || ''))) colorMeshes.push(object);
    }
  });

  if (!shirtMeshes.length) {
    model.traverse((object) => {
      if (object.isMesh) shirtMeshes.push(object);
    });
  }
  // Default: color follows the decal set (tshirt behavior unchanged).
  if (!colorMeshes.length) colorMeshes.push(...shirtMeshes);

  // PHASE 4: vào cache (bounded) rồi kích hoạt bằng atomic swap.
  const cached = { model, shirtMeshes, colorMeshes };
  viewer.modelCache.set(entry.id, cached);
  activateModel(cached, entry, { fromCache: false });
  pruneModelCache(entry.id);
}

function frameModel(side = 'front', entry) {
  PRINT_SURFACE_CACHE.clear(); // model/bounds có thể đổi → bề mặt in phải tìm lại
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
   Decal trước: +Z; decal sau: -Z + quay Y theo PI (đọc đúng chiều khi xem từ sau).

   DECAL LIGHTING — ảnh in phải "ăn vào vải" thay vì là khối ảnh dán đè:
   shader decal tính ánh sáng BẰNG ĐÚNG bộ đèn của scene (hằng số dưới đây
   phải khớp setup đèn trong initThreeViewer — Hemisphere 2.2, key 3.4 tại
   (3.5,5,4), fill 1.4 tại (-4,2,2)). Pháp tuyến per-vertex của decal kế
   thừa từ lưới áo (DecalGeometry) → nếp gấp vải tự shading lên ảnh in.
   Màu đèn chuyển sang linear để nhân trực tiếp trong shader. */
const DECAL_KEY_DIR = new THREE.Vector3(3.5, 5, 4).normalize();
const DECAL_FILL_DIR = new THREE.Vector3(-4, 2, 2).normalize();
const DECAL_KEY_COLOR = new THREE.Color(1, 1, 1).multiplyScalar(3.4);
const DECAL_FILL_COLOR = new THREE.Color(0xdbeafe).multiplyScalar(1.4);
const DECAL_HEMI_SKY = new THREE.Color(1, 1, 1).multiplyScalar(2.2);
const DECAL_HEMI_GROUND = new THREE.Color(0x8692a5).multiplyScalar(2.2);

function applyDesigns(urls) {
  // Decal clipping runs on the main thread over a dense garment mesh, so
  // re-running it for an identical URL (color/product/position changes)
  // would wedge the UI for seconds. Skip when nothing changed.
  const norm = urls ? { front: urls.front || null, back: urls.back || null } : { front: null, back: null };
  if (!norm.front && !norm.back) {
    if (viewer.decalMeshes.length) clearDecals();
    return;
  }
  if (norm.front === viewer.appliedDesignUrls.front && norm.back === viewer.appliedDesignUrls.back && viewer.decalMeshes.length) {
    // Nothing changed — decal đã ở trạng thái đích (thường do rebuild debounced
    // trong lúc kéo đã dựng xong trước khi thả). Vẫn phải báo studio biết để
    // nó tắt preview 2D, nếu không preview treo mãi tới timeout.
    if (typeof viewer.onDecalSwap === 'function') {
      const cbEarly = viewer.onDecalSwap;
      viewer.onDecalSwap = null;
      try { cbEarly(); } catch (e) { /* */ }
    }
    return;
  }
  /* ATOMIC SWAP — trước đây clearDecals() gỡ decal cũ NGAY khi texture mới
     còn tải async → giữa hai decal có khoảng trống = “nháy màn hình 1 cái”
     khi thả chuột sau khi kéo. Giờ: giữ decal cũ hiển thị, xây decal mới
     song song, thay toàn bộ trong 1 tick khi mọi texture sẵn sàng. */
  const requestToken = ++viewer.applyToken;
  viewer.appliedDesignUrls = { ...norm };
  viewer.appliedDesignUrl = norm.front;
  viewer.applyLog.push({ t: Date.now(), token: requestToken, product: viewer.productType,
    targets: viewer.shirtMeshes.length, patches: 0, started: true });
  if (viewer.applyLog.length > 40) viewer.applyLog.shift();
  const oldMeshes = viewer.decalMeshes;
  const newMeshes = [];
  const newUniforms = [];
  let pendingLoads = 0;

  const entry = GARMENT_REGISTRY[viewer.productType];
  const decalCfg = (entry && entry.decal) || { depthK: 1.8, liftY: 0.03, liftZ: 0.012 };
  const { box, size, center } = viewer.bounds;
  const loader = new THREE.TextureLoader();
  const sides = [];
  if (norm.front) sides.push({ side: 'front', url: norm.front });
  if (norm.back) sides.push({ side: 'back', url: norm.back });
  pendingLoads = sides.length;
  if (!pendingLoads) return;

  for (const s of sides) {
    loader.load(s.url, (texture) => {
    // Stale-callback guard: the garment may have been disposed (product
    // switch) while the texture was in flight — never crash on dead state.
    if (!viewer.bounds || !viewer.shirtMeshes.length) { texture.dispose(); return; }
    // A newer design request superseded this load; drop it quietly instead
    // of painting an outdated design.
    if (requestToken !== viewer.applyToken || viewer.appliedDesignUrls[s.side] !== s.url) {
      texture.dispose();
      return;
    }
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = true;
    texture.anisotropy = Math.min(8, viewer.renderer.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;

    const entry = GARMENT_REGISTRY[viewer.productType];
    const decalCfg = (entry && entry.decal) || { depthK: 1.8, liftY: 0.03, liftZ: 0.012 };
    const { box, size, center } = viewer.bounds;
    // PHASE 5: đặt decal lên BỀ MẶT NGOÀI thật (raycast) thay vì box.max/min.z
    // cứng — tránh ảnh in rơi vào mặt trong khi model quay hướng khác.
    const surface = resolvePrintSurface(s.side);
    const faceSign = surface ? surface.sign : (s.side === 'back' ? -1 : 1);
    const position = surface
      ? new THREE.Vector3(surface.point.x, surface.point.y, surface.point.z + faceSign * size.z * decalCfg.liftZ)
      : (s.side === 'back'
        ? new THREE.Vector3(center.x, center.y + size.y * decalCfg.liftY, box.min.z - size.z * decalCfg.liftZ)
        : new THREE.Vector3(center.x, center.y + size.y * decalCfg.liftY, box.max.z + size.z * decalCfg.liftZ));
    const orientation = faceSign >= 0 ? new THREE.Euler(0, 0, 0) : new THREE.Euler(0, Math.PI, 0);
    // PHASE 5: plane decal theo print projection spec — W:H luôn = aspect
    // design space (1:1), KHÔNG lấy 2 phân số độc lập của bounds nữa (nguồn
    // gốc ảnh bị kéo giãn khi đổi garment).
    const proj = printProjectionSize(entry, size);
    const decalSize = new THREE.Vector3(proj.w, proj.h, Math.max(0.08, size.z * decalCfg.depthK));

    viewer.shirtMeshes.forEach((target) => {
      const geometry = new DecalGeometry(target, position, orientation, decalSize);
      /* DecalGeometry với depth lớn bắt CẢ 2 bề mặt áo (trước + sau) — decal
         mặt sau tạo geometry mirror chui ra mặt trước (và ngược lại). Lọc
         giữ chỉ tam giác pháp tuyến hướng về phía projector của mặt đó. */
      const pos = geometry.attributes.position;
      const norm = geometry.attributes.normal;
      const uvAttr = geometry.attributes.uv;
      const idx = geometry.index;
      // Phía projector lấy từ bề mặt thật đã raycast (không giả định hướng model).
      const sideSign = faceSign;
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
        uKeyDir: { value: DECAL_KEY_DIR },
        uKeyColor: { value: DECAL_KEY_COLOR },
        uFillDir: { value: DECAL_FILL_DIR },
        uFillColor: { value: DECAL_FILL_COLOR },
        uHemiSky: { value: DECAL_HEMI_SKY },
        uHemiGround: { value: DECAL_HEMI_GROUND },
      };
      /* Fragment shader "in vào vải": lambert với đúng bộ đèn scene (cùng
         công thức MeshStandard/Lambert — irradiance chia π), pháp tuyến lấy
         từ lưới áo nên nếp gấp thật của vải in bóng lên họa tiết. Hằng số
         0.97 = mực in hấp thụ nhẹ, khiến ảnh "nằm trong" vải thay vì nổi.
         colorspace_fragment: xuất sRGB chuẩn khớp pipeline material sẵn có
         (trước đây xuất linear thô — decal tối hơn bản composite 2D). */
      const material = new THREE.ShaderMaterial({
        uniforms,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        vertexShader: `
          varying vec2 vUv;
          varying vec3 vNormalW;
          void main() {
            vUv = uv;
            vNormalW = normalize(mat3(modelMatrix) * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D map;
          uniform float uRemoveWhite;
          uniform vec3 uKeyDir;
          uniform vec3 uKeyColor;
          uniform vec3 uFillDir;
          uniform vec3 uFillColor;
          uniform vec3 uHemiSky;
          uniform vec3 uHemiGround;
          varying vec2 vUv;
          varying vec3 vNormalW;
          void main() {
            vec4 pixel = texture2D(map, vUv);
            if (pixel.a < 0.08) discard;
            if (uRemoveWhite > 0.5) {
              float high = max(pixel.r, max(pixel.g, pixel.b));
              float low = min(pixel.r, min(pixel.g, pixel.b));
              if (high > 0.84 && high - low < 0.22) discard;
            }
            vec3 n = normalize(vNormalW);
            float hemiW = n.y * 0.5 + 0.5;
            vec3 hemi = mix(uHemiGround, uHemiSky, hemiW);
            float ndlKey = max(dot(n, uKeyDir), 0.0);
            float ndlFill = max(dot(n, uFillDir), 0.0);
            vec3 lit = pixel.rgb * (hemi + uKeyColor * ndlKey + uFillColor * ndlFill) / 3.14159265;
            gl_FragColor = vec4(lit * 0.97, pixel.a);
            #include <colorspace_fragment>
          }
        `,
      });
      const decal = new THREE.Mesh(filtered, material);
      decal.renderOrder = 2;
      decal.userData.side = s.side; // để tra decal theo mặt khi đo kích thước
      geometry.dispose(); // Geometry gốc 2-bề-mặt không còn được dùng.
      // Chưa add vào scene — đợi đủ texture của mọi mặt rồi swap nguyên khối.
      newMeshes.push(decal);
      newUniforms.push(uniforms);
    });
    /* PHASE 5 — GỐC RỄ: dòng giảm bộ đếm + swap trước đây nằm TRONG
       forEach từng mảnh vải, nên garment nhiều mảnh (hoodie: 4 mesh) swap
       ngay ở patch ĐẦU TIÊN; các patch sau được tạo nhưng không bao giờ vào
       scene (đồng thời leak geometry/material) → ảnh in hoodie gần như vô
       hình, chỉ còn dải khoá áo lọt qua khe. Giờ chỉ swap khi MỌI mảnh vải
       của mặt đó đã tạo xong patch. */
    pendingLoads -= 1;
      if (pendingLoads === 0) {
        if (requestToken !== viewer.applyToken) {
          // Request đã bị thay thế — dọn mesh chưa từng vào scene.
          newMeshes.forEach((m) => { m.geometry.dispose(); m.material.dispose(); });
          return;
        }
        // Swap 1 tick: gỡ cũ → thêm mới → không bao giờ mất thiết kế giữa chừng.
        oldMeshes.forEach((m) => { m.geometry.dispose(); m.material.dispose(); viewer.scene.remove(m); });
        newMeshes.forEach((m) => { m.visible = !viewer.decalsHidden; viewer.scene.add(m); });
        viewer.decalMeshes = newMeshes;
        viewer.decalUniforms = newUniforms;
        viewer.applyLog.push({ t: Date.now(), token: requestToken, product: viewer.productType,
          targets: viewer.shirtMeshes.length, patches: newMeshes.length, swapped: true });
        if (viewer.applyLog.length > 40) viewer.applyLog.shift();
        // Studio dùng để biết decal đã "đổ bộ" — tắt preview 2D NGAY SAU KHI
        // decal mới đã sẵn sàng (không có khoảng trống hình ảnh = không nháy).
        if (typeof viewer.onDecalSwap === 'function') {
          const cb = viewer.onDecalSwap;
          viewer.onDecalSwap = null;
          try { cb(); } catch (e) { /* */ }
        }
    }
  }, undefined, (err) => {
    pendingLoads -= 1; // lỗi 1 mặt vẫn cho các mặt còn lại swap được
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
