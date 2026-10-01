// frontend/js/studio.js — v2 Redesign
const API_BASE = window.location.origin + '/api';

/* Toast — provided by js/toast.js */

/* ============================================================
   CONSTANTS
   ============================================================ */
const PRODUCT_PRICES = { tshirt: 250000, hoodie: 450000, polo: 350000 };
const PRODUCT_LABELS = { tshirt: 'T-Shirt Custom AI', hoodie: 'Hoodie Custom AI', polo: 'Polo Custom AI' };
const BANK_TRANSFER_INFO = { bankId: '970422', bankName: 'MB Bank', accountName: 'LE LY HUY', accountNumber: '0967145402', template: 'compact2' };

/* ============================================================
   HARDEN — production guards (errors, i18n, edge cases)
   Keeps incumbent behavior; adds limits, inline errors,
   debouncing, safe storage, and resilient gallery states.
   ============================================================ */
const HARDEN_LIMITS = {
  promptMax: 2000,
  promptMin: 3,
  ideaMax: 1000,
  customTextMax: 60,
  nameMax: 100,
  phoneMax: 20,
  addressMax: 500,
  noteMax: 500,
  qtyMin: 1,
  qtyMax: 100,
};

function debounce(fn, wait = 180) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function safeGet(key, fallback = null) {
  try { return localStorage.getItem(key); }
  catch { return fallback; }
}

function safeSet(key, value) {
  try { localStorage.setItem(key, value); return true; }
  catch { return false; }
}

function currentLang() {
  try {
    if (typeof i18n !== 'undefined' && i18n.lang) return i18n.lang;
    return document.documentElement.getAttribute('data-lang') || document.documentElement.lang || 'vi';
  } catch { return 'vi'; }
}

function setFieldError(inputEl, errorEl, message) {
  if (errorEl) {
    if (!message) { errorEl.hidden = true; errorEl.textContent = ''; }
    else { errorEl.hidden = false; errorEl.textContent = message; }
  }
  if (inputEl) {
    if (!message) inputEl.removeAttribute('aria-invalid');
    else inputEl.setAttribute('aria-invalid', 'true');
  }
}

function normalizeVnPhone(raw) {
  return String(raw || '').replace(/[\s.\-()]/g, '');
}

function isValidVnPhone(raw) {
  const p = normalizeVnPhone(raw);
  return /^(\+?84|0)[3-9]\d{8}$/.test(p);
}

const IMAGE_FALLBACK_SVG =
  'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="#ece4d3"/><g fill="none" stroke="#8e7657" stroke-width="2"><rect x="40" y="50" width="120" height="100" rx="4"/><circle cx="75" cy="80" r="8"/><path d="M40 130l35-30 25 20 30-25 30 30v25H40z" fill="#c19856" opacity="0.35"/></g></svg>`
  );

function handleImgError(img) {
  if (!img || img.dataset.fbk) return;
  img.dataset.fbk = '1';
  img.src = IMAGE_FALLBACK_SVG;
}

function syncPressed(containerId, selector, activeEl) {
  const c = document.getElementById(containerId);
  if (!c) return;
  c.querySelectorAll(selector).forEach(b => {
    const on = b === activeEl;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) b.classList.add('active');
    else if (b.dataset.role !== 'keep') b.classList.remove('active');
  });
}

/* ============================================================
   STATE
   ============================================================ */
/* ============================================================
   TEXT STYLE — slogan/câu chữ có bộ điều chỉnh kiểu in thật:
   viết hoa, font, độ đậm, màu, nghiêng/gạch chân/viền, giãn chữ.
   Fonts khớp bộ self-hosted tokens.css (+ system display fonts) —
   KHÔNG dùng font không tồn tại (bug cũ: 'Outfit' fallback Arial).
   ============================================================ */
const DEFAULT_TEXT_STYLE = {
  font: 'display',     // TEXT_FONTS key
  weight: 900,         // 400 | 700 | 900 (cap theo font)
  color: '#111827',
  transform: 'upper',  // upper | lower | title | none
  italic: false,
  underline: false,
  stroke: true,        // viền trắng quanh chữ — chữ nổi trên nền tối
  spacing: 0,          // giãn chữ, % cỡ chữ (0–30)
};
const TEXT_FONTS = {
  display: { stack: "'Arial Black', Arial, sans-serif", weightCap: 900, label: 'Display · Arial Black' },
  poster:  { stack: "Impact, 'Arial Narrow', Arial, sans-serif", weightCap: 400, label: 'Poster · Impact' },
  serif:   { stack: "'Playfair Display', Georgia, serif", weightCap: 600, label: 'Serif · Playfair' },
  sans:    { stack: "Manrope, Arial, sans-serif", weightCap: 700, label: 'Sans · Manrope' },
  mono:    { stack: "'DM Mono', 'Courier New', monospace", weightCap: 500, label: 'Mono · DM Mono' },
  classic: { stack: "Georgia, 'Times New Roman', serif", weightCap: 700, label: 'Classic · Georgia' },
};

const state = {
  currentDesign: null,
  selectedProductType: 'tshirt',
  selectedColor: '#ffffff',
  selectedSize: 'M',
  quantity: 1,
  selectedPaymentMethod: 'COD',
  paymentPollingTimer: null,
  currentView: 'front',
  selectedStyle: 'minimalist',
  uploadedFile: null,
  uploadedFilePreviewUrl: null,
  printDesignUrl: null,
  preparedDesignUrls: { front: null, back: null },
  // Multi-design layers: independent entities per garment side.
  // layer = { id, url, x, y, scale, rotation, visible, z, name,
  //           designId, prompt, style, assetId, kind }
  designLayers: { front: [], back: [] },
  selectedLayerId: { front: null, back: null },
  lastGenerated: { front: null, back: null },
  customText: '',
  groupMoveMode: false, // "Kéo chung": ảnh + chữ di chuyển cùng lúc
  printPlacement: { x: 0, y: -12, scale: 1 },
  textPlacement: { x: 0, y: 18, scale: 1 },
  sidePrintPlacement: { front: null, back: null },
  sideTextPlacement: { front: null, back: null },
  compositeDesignUrls: { front: null, back: null },
  compositeCacheKey: '',
  interactionMode: 'position',
  activePlacementLayer: 'image',
  orderIdempotencyKey: '', // 1 lượt đặt hàng = 1 key (xem newOrderIdempotencyKey)
  isGeneratingAi: false,
  customTextSides: { front: '', back: '' },
  // Kiểu chữ per side (slogan) — getSideTextStyle merge DEFAULT_TEXT_STYLE.
  textStyle: { ...DEFAULT_TEXT_STYLE },
  sideTextStyle: { front: null, back: null },
  // Per-side AI prompts — "mặt trước/mặt sau có prompt riêng".
  // promptInput mirrors the CURRENT side's prompt; switching sides swaps text.
  sidePrompts: { front: '', back: '' },
  promptSide: 'front',
  designProcessVersion: 0,
  viewer3d: null,
  cssViewer: null,
  // Asset library for uploaded assets (kind='asset')
  assetLibrary: [],
  // Pending reference asset for AI generation
  pendingReferenceAssetId: null,
  // PHASE 4 — persistent saved design identity (null = design mới chưa lưu)
  savedDesignId: null,
  savedDesignName: null,
};

function getFrontDesignUrl(d = state.currentDesign) { return d?.frontDesignUrl || d?.designUrl || ''; }
function getBackDesignUrl(d = state.currentDesign) { return d?.backDesignUrl || ''; }
function getActiveDesignUrl(d = state.currentDesign) {
  const f = getFrontDesignUrl(d), b = getBackDesignUrl(d);
  return state.currentView === 'back' ? (b || f) : f;
}
function getPreparedDesignUrl(side = state.currentView) {
  const f = state.preparedDesignUrls.front || getFrontDesignUrl();
  const b = state.preparedDesignUrls.back || getBackDesignUrl();
  return side === 'back' ? (b || f) : f;
}
function getSideCustomText(side = state.currentView) {
  const key = side === 'back' ? 'back' : 'front';
  const perSide = state.customTextSides?.[key];
  if (perSide) return perSide;
  const fromDesign = state.currentDesign?.customTextSides?.[key];
  if (fromDesign) return fromDesign;
  const hasAnyPerSide = !!(state.customTextSides?.front || state.customTextSides?.back || state.currentDesign?.customTextSides?.front || state.currentDesign?.customTextSides?.back);
  if (!hasAnyPerSide) return state.customText || '';
  return '';
}
function sideKey(side = state.currentView) { return side === 'back' ? 'back' : 'front'; }
function hasBackDesign() { return hasLayerDesigns('back') || !!(state.preparedDesignUrls.back || getBackDesignUrl()); }
function hasBackContent() { return hasBackDesign() || !!getSideCustomText('back'); }
function hasFrontContent() { return hasLayerDesigns('front') || !!(state.preparedDesignUrls.front || getFrontDesignUrl()) || !!getSideCustomText('front'); }
function getSidePrintPlacement(side = state.currentView) {
  const k = sideKey(side);
  const stored = state.sidePrintPlacement?.[k];
  if (stored) return stored;
  return { ...(k === 'back' ? PRINT_POSITION_PRESETS.back : PRINT_POSITION_PRESETS.chest) };
}
function getSideTextPlacement(side = state.currentView) {
  const k = sideKey(side);
  const stored = state.sideTextPlacement?.[k];
  if (stored) return stored;
  return { x: 0, y: k === 'back' ? 16 : 18, scale: 1 };
}
/* PHASE 1 — rotation + lock cho TEXT (slogan), per side. Lưu trong
   sideTextPlacement (rotation) + sideTextLocked — đi vào composite cache key,
   snapshot undo và saveToHistory tự động. */
function getSideTextRotation(side = state.currentView) {
  const k = sideKey(side);
  return Number(state.sideTextPlacement?.[k]?.rotation) || 0;
}
function commitTextRotation(side, deg) {
  const k = sideKey(side);
  const cur = state.sideTextPlacement[k] || { ...state.textPlacement };
  cur.rotation = ((Math.round(Number(deg) || 0) % 360) + 360) % 360;
  state.sideTextPlacement[k] = cur;
  state.textPlacement = { ...cur };
  state.compositeCacheKey = '';
}
function getSideTextLocked(side = state.currentView) {
  return state.sideTextLocked?.[sideKey(side)] === true;
}
function commitTextLocked(side, val) {
  const k = sideKey(side);
  state.sideTextLocked = state.sideTextLocked || { front: false, back: false };
  state.sideTextLocked[k] = !!val;
  state.compositeCacheKey = '';
}
/* Kiểu chữ per side — stored chỉ lưu các field người dùng đã chạm
   (merge DEFAULT để tương thích dữ liệu cũ). */
function getSideTextStyle(side = state.currentView) {
  const k = sideKey(side);
  return { ...DEFAULT_TEXT_STYLE, ...(state.sideTextStyle?.[k] || {}) };
}
function commitSideTextStyle(patch) {
  const k = sideKey();
  state.sideTextStyle[k] = { ...getSideTextStyle(k), ...patch };
  state.textStyle = { ...state.sideTextStyle[k] };
  state.compositeCacheKey = '';
}
function commitActivePlacements() {
  const k = sideKey();
  // Central chokepoint: mọi đường chỉnh vị trí (kéo overlay, kéo canvas,
  // slider, nudge, preset) đều đi qua đây → clamp layer vào vùng in áo.
  const sel = getSelectedLayer(k);
  if (sel) clampLayerToPrintArea(sel);
  // PHASE 3: chỉ clear composite cache khi placement THỰC SỰ đổi.
  // Mọi thứ ảnh hưởng composite (layer x/y/scale/rot, sideTextPlacement) đã nằm
  // trong getCompositeCacheKey() — clear vô điều kiện khiến mỗi lần đổi mặt áo
  // (gọi commit khi load placements) rebuild lại cả 2 composite thừa.
  const prevP = state.sidePrintPlacement[k];
  const prevT = state.sideTextPlacement[k];
  const nextP = { ...state.printPlacement };
  const nextT = { ...state.textPlacement };
  const changed = !prevP || !prevT || JSON.stringify(prevP) !== JSON.stringify(nextP) || JSON.stringify(prevT) !== JSON.stringify(nextT);
  state.sidePrintPlacement[k] = nextP;
  state.sideTextPlacement[k] = nextT;
  if (changed) state.compositeCacheKey = '';
}
function loadPlacementsForSide(side) {
  state.printPlacement = { ...getSidePrintPlacement(side) };
  state.textPlacement = { ...getSideTextPlacement(side) };
  state.textStyle = { ...getSideTextStyle(side) };
  syncTextStyleControls();
}
function syncCustomTextInputs() {
  const v = getSideCustomText();
  document.querySelectorAll('#customTextInput, #customTextInputImage').forEach(o => { if (o) o.value = v; });
}
function updateSideBadge() {
  const badge = document.getElementById('viewerSideBadge');
  if (badge) {
    const back = state.currentView === 'back';
    const textMode = state.activePlacementLayer === 'text' && getSideCustomText(state.currentView);
    badge.textContent = (back ? 'MẶT SAU' : 'MẶT TRƯỚC') + (textMode ? ' · CHỮ' : '');
    badge.classList.toggle('is-back', back);
  }
  const tag = document.getElementById('placementSideTag');
  if (tag) {
    const back = state.currentView === 'back';
    tag.textContent = back ? 'mặt sau' : 'mặt trước';
    tag.classList.toggle('is-back', back);
  }
  const stickerTag = document.getElementById('stickerSideTag');
  if (stickerTag) {
    stickerTag.textContent = state.currentView === 'back' ? 'mặt sau' : 'mặt trước';
  }
}
function updateBackDesignControls() {
  const box = document.getElementById('backDesignControls');
  if (!box) return;
  if (state.currentView !== 'back') { box.style.display = 'none'; return; }
  box.style.display = 'block';
  const status = document.getElementById('backDesignStatus');
  const gen = document.getElementById('backGenerateBtn');
  const clear = document.getElementById('backClearBtn');
  const has = hasBackDesign();
  if (status) status.textContent = has ? 'Đã có mẫu in. Bạn có thể chỉnh vị trí, hoặc bỏ để áo sau trơn.' : 'Chưa có mẫu cho mặt sau — tạo từ prompt hiện tại';
  if (gen) gen.style.display = has ? 'none' : '';
  if (clear) clear.style.display = has ? '' : 'none';
}
function initBackDesignControls() {
  document.getElementById('backGenerateBtn')?.addEventListener('click', () => { switchPromptSide('back'); generateFromPrompt('back'); });
  document.getElementById('backClearBtn')?.addEventListener('click', () => {
    beginDesignUndoBatch('clear-back');
    clearSideLayers('back');
    state.preparedDesignUrls.back = null;
    if (state.currentDesign) state.currentDesign.backDesignUrl = '';
    state.compositeCacheKey = '';
    pushDesignUndo('clear-back');
    updateDesignOverlayForSide();
    applyCurrentDesignToViewer();
    updateBackDesignControls();
    showToast('Đã bỏ toàn bộ mẫu ở mặt sau.', 'info');
  });
  syncCustomTextInputs();
  updateSideBadge();
  updateBackDesignControls();
}
function getCompositeCacheKey() {
  const snap = (side) => sideLayers(side).map(l => [l.id, l.url, l.x, l.y, l.scale, l.rotation, l.visible, l.z, l.locked, l.opacity, l.crop ? 1 : 0, l.assetId, l.kind, l.name, l.prompt, l.style, l.flipH ? 1 : 0, l.flipV ? 1 : 0]);
  // JSON.stringify sánh nông các mảng lồng — cần key bổ sung khi có state đặc biệt:
  if (state.designLayers.front.some(l => l.crop) || state.designLayers.back.some(l => l.crop)) {
    return JSON.stringify({ f: snap('front'), b: snap('back'), crops: { front: state.designLayers.front.map(l => l.crop), back: state.designLayers.back.map(l => l.crop) },
      customText: state.customText, customTextSides: state.customTextSides, sideTextPlacement: state.sideTextPlacement, sideTextStyle: state.sideTextStyle, sideTextLocked: state.sideTextLocked });
  }
  return JSON.stringify({
    front: snap('front'), back: snap('back'),
    customText: state.customText, customTextSides: state.customTextSides,
    sideTextPlacement: state.sideTextPlacement,
    sideTextStyle: state.sideTextStyle,
    sideTextLocked: state.sideTextLocked,
  });
}

/* Chuyển text theo transform: upper/lower/title/none + capitalize từng từ.
   Dùng chung overlay 2D + composite 3D/đơn hàng — hiển thị == bản in. */
function applyTextTransform(text, transform) {
  const raw = String(text || '');
  switch (transform) {
    case 'upper': return raw.toUpperCase();
    case 'lower': return raw.toLowerCase();
    case 'title': return raw.toLowerCase().replace(new RegExp('(^|\\s|[-—–])(\\p{L})', 'gu'), (m, p, c) => p + c.toUpperCase());
    case 'capitalize': return raw.replace(new RegExp('(^|\\s)(\\p{L})', 'gu'), (m, p, c) => p + c.toUpperCase());
    default: return raw;
  }
}

// Debounced 3D refresh: slider drags rebuild the composite live in 2D, but
// the 3D decal recompute is throttled so interaction never wedges the UI.
let viewerUpdateTimer = null;
function scheduleViewerUpdate() {
  if (viewerUpdateTimer) clearTimeout(viewerUpdateTimer);
  viewerUpdateTimer = setTimeout(() => {
    viewerUpdateTimer = null;
    applyCurrentDesignToViewer().catch(() => {});
  }, 350);
}

// Throttle (KHÔNG phải debounce) cho kéo slider: debounce reset timer mỗi
// event → kéo liên tục thì decal KHÔNG BAO GIỜ cập nhật (cảm giác 'slider
// không hoạt động'). Throttle đảm bảo decal sống lại đều đặn khi kéo.
let sliderViewerTick = 0;
function scheduleViewerUpdateThrottled(minInterval = 140) {
  const now = Date.now();
  if (now - sliderViewerTick >= minInterval) {
    sliderViewerTick = now;
    if (viewerUpdateTimer) { clearTimeout(viewerUpdateTimer); viewerUpdateTimer = null; }
    applyCurrentDesignToViewer().catch(() => {});
  } else if (!viewerUpdateTimer) {
    viewerUpdateTimer = setTimeout(() => {
      viewerUpdateTimer = null;
      sliderViewerTick = Date.now();
      applyCurrentDesignToViewer().catch(() => {});
    }, minInterval - (now - sliderViewerTick));
  }
}

/* ============================================================
   UTILITY
   ============================================================ */
function escapeHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function escapeAttr(s) { return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function formatPrice(v) {
  const lang = currentLang() === 'en' ? 'en-US' : 'vi-VN';
  try {
    return new Intl.NumberFormat(lang, { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(v) || 0);
  } catch {
    return (Number(v) || 0).toLocaleString('vi-VN') + '₫';
  }
}
function formatDateTime(ts) {
  const lang = currentLang() === 'en' ? 'en-US' : 'vi-VN';
  try {
    return new Intl.DateTimeFormat(lang, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(ts));
  } catch {
    const time = new Date(ts);
    return time.toLocaleDateString('vi-VN') + ' ' + time.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  }
}
function isLightColor(hex) { const c = hex.replace('#', ''); const r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16); return (r * 299 + g * 587 + b * 114) / 1000 > 128; }
function lightenColor(hex, pct) { const c = hex.replace('#', ''); let r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16); r = Math.min(255, r + Math.round((255 - r) * pct / 100)); g = Math.min(255, g + Math.round((255 - g) * pct / 100)); b = Math.min(255, b + Math.round((255 - b) * pct / 100)); return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`; }
function darkenColor(hex, pct) { const c = hex.replace('#', ''); let r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16); r = Math.max(0, r - Math.round(r * pct / 100)); g = Math.max(0, g - Math.round(g * pct / 100)); b = Math.max(0, b - Math.round(b * pct / 100)); return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`; }
function setLoading(btn, loading) {
  if (!btn) return;
  btn.classList.toggle('loading', loading);
  btn.classList.toggle('is-loading', loading);
  btn.disabled = loading;
  if (loading) btn.style.willChange = 'transform';
  else setTimeout(()=> { btn.style.willChange = ''; }, 200);
}
function showButtonSuccess(btn, label = '✓ Thành công') {
  if (!btn) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  btn.classList.add('is-success');
  const textEl = btn.querySelector('.generate-btn-text') || btn.querySelector('.btn-label') || btn;
  const original = textEl ? textEl.textContent : btn.textContent;
  if (textEl) textEl.textContent = label;
  if (!reduce) btn.animate([{transform:'scale(1)'},{transform:'scale(1.02)'},{transform:'scale(1)'}], {duration:240, easing:'cubic-bezier(0.16,1,0.3,1)'});
  setTimeout(()=> {
    btn.classList.remove('is-success');
    if (textEl) textEl.textContent = original;
  }, 1400);
}
function shakeButton(btn) {
  if (!btn) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;
  btn.classList.remove('shake');
  // force reflow
  void btn.offsetWidth;
  btn.classList.add('shake');
  btn.addEventListener('animationend', () => btn.classList.remove('shake'), {once:true});
}
function formatAiError(data) { if (data?.error) return data.error; if (data?.message) return data.message; return 'AI generation failed. Please try again.'; }

/* ============================================================
   AUTH GUARD — must be logged in to use studio
   ============================================================ */
function isJwtExpired(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && Date.now() >= payload.exp * 1000) return true;
  } catch {}
  return false;
}

function isStudioAuthenticated() {
  // Use existing BlankUp auth state: token + user, plus client-side expiry check
  if (typeof auth === 'undefined' || !auth) return false;
  if (!auth.isLoggedIn()) return false;
  if (auth.token && isJwtExpired(auth.token)) return false;
  return true;
}

window._studioAuthPromptShown = window._studioAuthPromptShown || false;
// A11y: move focus into the auth dialog (non-critical, never throws).
// Standalone (not inside showStudioAuthPrompt) because the inline entry-guard
// in studio.html can show the modal directly while the dedup flag suppresses
// showStudioAuthPrompt — focus must still be ensured on every entry path.
function ensureAuthModalFocus() {
  try {
    const modal = document.getElementById('authRequiredModal');
    if (!modal || modal.style.display !== 'flex') return;
    if (document.activeElement && modal.contains(document.activeElement)) return;
    modal.querySelector('.auth-modal-btn-primary')?.focus();
  } catch {}
}
function showStudioAuthPrompt(reason = 'login-required') {
  if (window._studioAuthPromptShown) { ensureAuthModalFocus(); return; }
  window._studioAuthPromptShown = true;
  const modal = document.getElementById('authRequiredModal');
  if (modal) {
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    setTimeout(ensureAuthModalFocus, 60);
    setTimeout(ensureAuthModalFocus, 600);
  }
  if (window.showToast) {
    window.showToast('Vui lòng đăng nhập để sử dụng Studio.', 'warning', 5000);
  }
  // Also ensure toast system is ready: if showToast not yet, retry once
  else {
    setTimeout(() => {
      if (window.showToast) window.showToast('Vui lòng đăng nhập để sử dụng Studio.', 'warning', 5000);
    }, 300);
  }
}

function hideStudioAuthPrompt() {
  window._studioAuthPromptShown = false;
  const modal = document.getElementById('authRequiredModal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
}

function requireAuth() {
  if (isStudioAuthenticated()) return false;
  showStudioAuthPrompt('requireAuth');
  return true;
}

/* ============================================================
   CREDIT REMAINING BADGE (studio)
   Hiển thị số lượt tạo AI còn lại (daily free → low → high).
   Nguồn: /api/auth/me (credits.remaining*) + remainingCredits trả kèm
   từ response /generate(.from-image) để cập nhật không cần gọi lại.
   Badge là UX-only: mọi lỗi bỏ qua, không bao giờ chặn tạo design.
   ============================================================ */
function renderCreditRemaining(credits) {
  const badge = document.getElementById('creditRemainingBadge');
  const textEl = document.getElementById('creditRemainingText');
  if (!badge || !textEl || !credits) return;
  const daily = Number(credits.remainingDaily) || 0;
  const low = Number(credits.remainingLow) || 0;
  const high = Number(credits.remainingHigh) || 0;
  const total = credits.remainingTotal != null ? Number(credits.remainingTotal) : daily + low + high;
  const parts = [];
  if (daily > 0) parts.push(`${daily} miễn phí`);
  if (low > 0) parts.push(`${low} low`);
  if (high > 0) parts.push(`${high} high`);
  textEl.textContent = total > 0
    ? `Còn ${total} lượt tạo${parts.length ? ' (' + parts.join(' · ') + ')' : ''}`
    : 'Hết lượt tạo AI';
  badge.dataset.tone = total === 0 ? 'empty' : (daily === 0 && low === 0 ? 'low' : 'normal');
  badge.hidden = false;
}

async function refreshCreditRemaining() {
  if (!auth.isLoggedIn || !auth.isLoggedIn()) return;
  try {
    const resp = await fetch(`${API_BASE}/auth/me`, { headers: auth.getAuthHeaders() });
    if (!resp.ok) return;
    const data = await resp.json();
    if (data && data.success && data.credits) renderCreditRemaining(data.credits);
  } catch { /* UX-only — ignore */ }
}

function applyRemainingCreditsFromResponse(data) {
  if (data && data.remainingCredits) renderCreditRemaining(data.remainingCredits);
}

function checkStudioAuthOnEntry() {
  // Immediate check after Studio init — entry guard, not button guard
  if (!isStudioAuthenticated()) {
    showStudioAuthPrompt('entry');
    return;
  }
  // If token exists but server says invalid (async), handle after checkSession
  // Do light async verification without spamming: single fetch, deduped
  if (auth.token) {
    fetch(`${API_BASE}/auth/me`, { headers: auth.getAuthHeaders() })
      .then(res => {
        if (!res.ok) {
          // Token invalid/expired on server → clear and prompt
          if (typeof auth.clearSession === 'function') auth.clearSession();
          showStudioAuthPrompt('expired');
        } else {
          // Valid → ensure prompt not shown
          hideStudioAuthPrompt();
        }
      })
      .catch(() => {
        // Network slow/fail → do not spam, keep current state (already checked isLoggedIn)
      });
  }
}

/* ============================================================
   AI GENERATION PROGRESS
   ============================================================ */
const GEN_STAGES = [
  { pct: 8,  msg: 'Khởi tạo mô hình AI…' },
  { pct: 20, msg: 'Phân tích prompt và chọn phong cách in…' },
  { pct: 35, msg: 'Xây dựng layout & bố cục thủ công…' },
  { pct: 50, msg: 'Tối ưu prompt sang tiếng Anh (print-ready)…' },
  { pct: 65, msg: 'Vẽ chi tiết với texture halftone & ink bleed…' },
  { pct: 78, msg: 'Áp dụng phong cách screen-print / risograph…' },
  { pct: 88, msg: 'Hoàn thiện & kiểm tra chất lượng in…' },
  { pct: 95, msg: 'Áp bản decal lên mô hình 3D…' },
];

const genProgress = {
  overlay: null,
  fill: null,
  messageEl: null,
  percentEl: null,
  timer: null,
  currentPct: 0,
  stageIdx: 0,
  done: false,
};

function initGenProgress() {
  genProgress.overlay = document.getElementById('genProgressOverlay');
  genProgress.fill = document.getElementById('genProgressFill');
  genProgress.messageEl = document.getElementById('genProgressMessage');
  genProgress.percentEl = document.getElementById('genProgressPercent');
}

// Max time we wait for the AI backend before failing honestly.
// Backend provider timeout is ~90s; 120s leaves margin for upload/save.
const GEN_FETCH_TIMEOUT_MS = 120000;

function startGenProgress() {
  if (!genProgress.overlay) initGenProgress();
  genProgress.done = false;
  genProgress.currentPct = 0;
  genProgress.stageIdx = 0;
  genProgress.startedAt = Date.now();
  genProgress.overlay.classList.remove('error', 'success');
  genProgress.overlay.classList.add('active');
  updateGenProgressUI(0, GEN_STAGES[0].msg);
  clearInterval(genProgress.timer);
  genProgress.timer = setInterval(() => {
    if (genProgress.done) return;
    const step = 1 + Math.floor(Math.random() * 3);
    const next = Math.min(genProgress.currentPct + step, GEN_STAGES[GEN_STAGES.length - 1].pct);
    genProgress.currentPct = next;
    let msg = GEN_STAGES[genProgress.stageIdx].msg;
    for (let i = 0; i < GEN_STAGES.length; i++) {
      if (next >= GEN_STAGES[i].pct) {
        genProgress.stageIdx = i;
        msg = GEN_STAGES[i].msg;
      }
    }
    // Honesty at the 95% cap: the bar is capped while the backend request is
    // still in flight, so show elapsed wait time instead of a frozen stage.
    if (next >= GEN_STAGES[GEN_STAGES.length - 1].pct && genProgress.startedAt) {
      const waited = Math.round((Date.now() - genProgress.startedAt) / 1000);
      msg = `Đang chờ AI phản hồi… (${waited}s)`;
    }
    updateGenProgressUI(next, msg);
  }, 650);
}

function updateGenProgressUI(pct, msg) {
  if (genProgress.fill) genProgress.fill.style.transform = `scaleX(${(Math.max(0, Math.min(100, Number(pct) || 0)) / 100).toFixed(4)})`;
  if (genProgress.percentEl) genProgress.percentEl.textContent = pct + '%';
  if (genProgress.messageEl && msg) genProgress.messageEl.textContent = msg;
}

function completeGenProgress(success = true, message = '') {
  if (!genProgress.overlay || genProgress.done) return;
  genProgress.done = true;
  clearInterval(genProgress.timer);
  genProgress.currentPct = 100;
  updateGenProgressUI(100, message || (success ? 'Hoàn tất!' : ''));
  genProgress.overlay.classList.add(success ? 'success' : 'error');
  const title = genProgress.overlay.querySelector('.gen-progress-title');
  if (title) title.textContent = success ? 'Thiết kế đã sẵn sàng!' : 'Có lỗi xảy ra';
  setTimeout(() => {
    genProgress.overlay.classList.remove('active', 'success', 'error');
    if (title) title.textContent = 'AI đang sáng tạo…';
    genProgress.currentPct = 0;
    updateGenProgressUI(0, GEN_STAGES[0].msg);
  }, success ? 900 : 2200);
}

function failGenProgress(message = 'Vui lòng thử lại sau') {
  completeGenProgress(false, message);
}

/* ============================================================
   COMPOSITE DESIGN (canvas overlay for text + image)
   ============================================================ */
/* Cache Image đã decode cho composite (PHASE 3): cùng URL không decode lại.
   Giới hạn 50 entries LRU — URL là key (dataURL/server path), value là HTMLImageElement.
   Ảnh lỗi (rejected promise) cũng cache để tránh retry-spam mỗi composite rebuild. */
const IMG_DECODE_CACHE = new Map();
const IMG_DECODE_CACHE_MAX = 50;
function loadImageForCanvas(url) {
  if (!url) return Promise.resolve(null);
  if (IMG_DECODE_CACHE.has(url)) {
    const hit = IMG_DECODE_CACHE.get(url);
    // LRU: đẩy lại cuối map trước khi trả.
    IMG_DECODE_CACHE.delete(url); IMG_DECODE_CACHE.set(url, hit);
    return hit;
  }
  const p = new Promise((resolve, reject) => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => {
      // PHASE 3: lỗi load (mạng tạm thời, 404…) → gỡ khỏi cache để lần sau
      // được retry; không cache reject vĩnh viễn.
      IMG_DECODE_CACHE.delete(url);
      reject(new Error('Image decode failed'));
    };
    img.src = url;
  });
  IMG_DECODE_CACHE.set(url, p);
  if (IMG_DECODE_CACHE.size > IMG_DECODE_CACHE_MAX) {
    IMG_DECODE_CACHE.delete(IMG_DECODE_CACHE.keys().next().value);
  }
  return p;
}

/* PHASE 5 SVG P0 — Chromium KHÔNG rasterize được ảnh SVG qua dạng 9 tham số
   `drawImage(img, sx, sy, sw, sh, …)` (source-rect): nó vẽ ra 0 pixel, im lặng.
   Đo thật: raster+crop = 88,506 px | SVG no-crop = 10,438 px | SVG+crop = 0 px.
   Hệ quả trước fix: layer sticker (SVG) + crop biến mất khỏi composite → decal
   3D → Print Preview → đơn in, dù overlay 2D vẫn hiển thị.
   Fix: rasterize SVG MỘT LẦN vào offscreen canvas (đúng intrinsic size, giữ
   aspect ratio + alpha) rồi dùng canvas đó làm nguồn cho đường crop — canvas
   là bitmap nên source-rect hoạt động đúng. Asset gốc không bị sửa. */
function isSvgSource(url) {
  const u = String(url || '');
  return /^data:image\/svg\+xml/i.test(u) || /\.svg(?:[?#]|$)/i.test(u);
}
const SVG_RASTER_CACHE = new Map(); // url → Promise<HTMLCanvasElement> (chỉ cache thành công)
const SVG_RASTER_CACHE_MAX = 24;
function rasterizeSvgSource(url, img) {
  if (SVG_RASTER_CACHE.has(url)) {
    const hit = SVG_RASTER_CACHE.get(url);
    SVG_RASTER_CACHE.delete(url); SVG_RASTER_CACHE.set(url, hit); // LRU touch
    return hit;
  }
  const p = (async () => {
    const W = Math.max(1, img.naturalWidth || img.width || 512);
    const H = Math.max(1, img.naturalHeight || img.height || 512);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const cx = cv.getContext('2d');
    cx.drawImage(img, 0, 0, W, H); // bitmap-through-bitmap: an toàn cho SVG
    return cv;
  })().catch((err) => {
    SVG_RASTER_CACHE.delete(url); // fail KHÔNG bị cache → lần sau retry được
    throw err;
  });
  SVG_RASTER_CACHE.set(url, p);
  if (SVG_RASTER_CACHE.size > SVG_RASTER_CACHE_MAX) {
    SVG_RASTER_CACHE.delete(SVG_RASTER_CACHE.keys().next().value);
  }
  return p;
}

async function drawLayerOnContext(ctx, size, layer) {
  // Same mapping as the 2D overlay so 2D == composite == 3D decal.
  // Hỗ trợ non-destructive crop (vẽ đúng vùng crop của asset gốc) + opacity.
  try {
    const img = await loadImageForCanvas(layer.url);
    if (!img) return;
    const c = (layer.crop && layer.crop.w > 0 && layer.crop.h > 0) ? layer.crop : null;
    // Đường crop: SVG phải đi qua bản raster (xem rasterizeSvgSource).
    // Raster giữ nguyên đường cũ (không copy thêm, không đổi chất lượng).
    let src = img;
    if (c && isSvgSource(layer.url)) src = await rasterizeSvgSource(layer.url, img);
    if (!src) return;
    const srcW = Math.max(1, src.width || img.width), srcH = Math.max(1, src.height || img.height);
    const sx = c ? c.x * srcW : 0, sy = c ? c.y * srcH : 0;
    const sw = c ? c.w * srcW : srcW, sh = c ? c.h * srcH : srcH;
    const maxW = size * 0.58 * layer.scale, maxH = size * 0.58 * layer.scale;
    const ratio = Math.min(maxW / sw, maxH / sh);
    const w = sw * ratio, h = sh * ratio;
    const cx = size * (0.5 + layer.x / 100), cy = size * (0.44 + layer.y / 100);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, Number(layer.opacity) || 0));
    ctx.translate(cx, cy);
    ctx.rotate(((layer.rotation || 0) * Math.PI) / 180);
    // PRO EDIT: lật ảnh (non-destructive) — scale âm quanh tâm sau rotate,
    // crop vẫn đúng hướng vùng chọn.
    if (layer.flipH || layer.flipV) ctx.scale(layer.flipH ? -1 : 1, layer.flipV ? -1 : 1);
    if (c) ctx.drawImage(src, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
    else ctx.drawImage(src, -w / 2, -h / 2, w, h);
    ctx.restore();
  } catch (e) {
    console.warn('Composite print error:', e);
    // UX reliability: composite failure must not be silent — design may not render on mockup
    if (window.showToast) window.showToast('Không thể dựng bản in trên mockup. Vui lòng thử lại.', 'warning');
  }
}

// Composite of ALL visible layers of one side (+ slogan text). This single
// image is what the user sees in 2D-equivalent form, what goes on the 3D
// decal, what is ordered, and what is shared — one source of truth.
async function buildSideComposite(side = state.currentView) {
  const k = side === 'back' ? 'back' : 'front';
  const layers = [...sideLayers(k)].filter(l => l.visible !== false && l.url).sort((a, b) => a.z - b.z);
  const sideText = getSideCustomText(k);
  if (!layers.length && !sideText) return '';
  const size = 1024;
  const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, size, size);
  for (const layer of layers) {
    await drawLayerOnContext(ctx, size, layer);
  }
  if (sideText) {
    drawStyledText(ctx, size, sideText, getSideTextPlacement(k), getSideTextStyle(k));
  }
  return canvas.toDataURL('image/png');
}

/* Vẽ slogan theo đúng style người dùng chọn — DÙNG CHO CẢ composite đơn
   hàng lẫn preview, nên "nhìn thấy gì in nấy". Weight cap theo font
   (Playfair chỉ có 500/600; DM Mono 400/500) để canvas không giả lập đậm ảo. */
function drawStyledText(ctx, size, rawText, tp, style) {
  const st = { ...DEFAULT_TEXT_STYLE, ...(style || {}) };
  if (tp && Number.isFinite(tp.opacity)) ctx.globalAlpha = Math.max(0, Math.min(1, Number(tp.opacity) || 0)); // khôi phục tạm — save/restore bên dưới giữ sạch
  // PHASE 1: rotation text — xoay quanh TÂM CHỮ (khớp transform-origin 0 0
  // của overlay: rotate được áp trước translate trong CSS => cùng tâm).
  const textRot = Number(tp?.rotation) || 0;
  const fontDef = TEXT_FONTS[st.font] || TEXT_FONTS.display;
  const weight = Math.min(st.weight, fontDef.weightCap);
  const text = applyTextTransform(rawText, st.transform);
  if (!text) return;
  const fs = Math.max(34, 82 * tp.scale);
  const x = size * (0.5 + tp.x / 100), y = size * (0.5 + tp.y / 100);
  ctx.save();
  // Xoay quanh điểm neo chữ (x,y) — trùng tâm chữ vì textAlign=center/baseline=middle.
  if (textRot) { ctx.translate(x, y); ctx.rotate((textRot * Math.PI) / 180); ctx.translate(-x, -y); }
  ctx.font = `${st.italic ? 'italic ' : ''}${weight} ${fs}px ${fontDef.stack}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.letterSpacing = `${Math.round(fs * (st.spacing || 0) / 100)}px`;
  // Ink stroke: viền nền áo quanh chữ giúp chữ nổi trên mọi màu áo
  ctx.lineWidth = st.stroke ? Math.max(5, fs * 0.11) : 0;
  ctx.lineJoin = 'round'; ctx.miterLimit = 2;
  ctx.strokeStyle = st.stroke ? getInkContrast(st.color) : 'transparent';
  ctx.fillStyle = st.color;
  ctx.globalAlpha = Math.max(0, Math.min(1, Number(tp?.opacity) || 1)); // opacity chữ (composite = preview)
  if (ctx.lineWidth > 0) ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
  if (st.underline) {
    const m = ctx.measureText(text);
    ctx.fillRect(x - m.width / 2, y + fs * 0.52, m.width, Math.max(3, fs * 0.06));
  }
  ctx.restore();
}

/* Viền tương phản theo màu chữ: chữ sáng viền ink, chữ tối viền trắng.
   Giữ chữ đọc được trên cả áo trắng lẫn áo đen. */
function getInkContrast(colorHex) {
  try {
    const h = String(colorHex || '#111827').replace('#', '');
    const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 140 ? '#101418' : 'rgba(255,255,255,0.95)';
  } catch (e) { return '#ffffff'; }
}

async function buildCompositePrintUrl(designUrl, side = state.currentView) {
  // Legacy single-URL entry kept for compatibility; the layered composite
  // is authoritative for render/order/share.
  if (!designUrl) return buildSideComposite(side);
  const k = side === 'back' ? 'back' : 'front';
  const layers = sideLayers(k).filter(l => l.visible !== false && l.url);
  if (layers.length === 1 && layers[0].url === designUrl) return buildSideComposite(k);
  const sideText = getSideCustomText(k);
  const size = 1024;
  const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, size, size);
  await drawLayerOnContext(ctx, size, { url: designUrl, x: 0, y: -12, scale: 1, rotation: 0, opacity: 1, crop: null });
  if (sideText) {
    drawStyledText(ctx, size, sideText, getSideTextPlacement(k), getSideTextStyle(k));
  }
  return canvas.toDataURL('image/png');
}

async function getCompositeDesignsForViewer() {
  const key = getCompositeCacheKey();
  if (state.compositeCacheKey === key) return state.compositeDesignUrls;
  const [front, back] = await Promise.all([
    buildSideComposite('front'),
    buildSideComposite('back'),
  ]);
  state.compositeCacheKey = key;
  state.compositeDesignUrls = { front: front || null, back: back || null };
  return state.compositeDesignUrls;
}

/* ============================================================
   DESIGN OVERLAY
   ============================================================ */
function updateDesignOverlayForSide() {
  renderLayersOverlay();
}

/* ============================================================
   DRAG PREVIEW — ảnh clone RIÊNG bám con trỏ 1:1 ở screen-space.
   Vì sao cần phần tử riêng: (1) overlay img bị renderLayersOverlay tái tạo
   mỗi pointermove nên không giữ được trạng thái; (2) ở chế độ 3D overlay
   bị ẩn/0-size nên preview qua overlay là vô hình (lỗi "kéo là ảnh biến
   mất"). Preview = <img> gắn vào body, vị trí = vị trí ban đầu + delta
   chuột → kéo tới đâu THẤY tới đó. Thả chuột: đợi decal mới dựng xong
   (atomic swap + onDecalSwap) mới gỡ preview → không nháy, không trống.
   ============================================================ */
function beginLayerDragPreview(src, rect, startX, startY, scale = 1, opts = {}) {
  endLayerDragPreview(true); // dọn preview cũ nếu còn sót
  const container = document.getElementById('canvasViewer');
  if (container) container.classList.add('is-layer-dragging');
  try { window.tshirt360Viewer?.setDecalsHidden?.(true); } catch (e) { /* */ }
  if (!src) return;
  // KÍCH THƯỚC preview = kích thước decal THẬT trên màn hình (project 3D →
  // pixel qua camera). LƯU Ý QUAN TRỌNG: decal 3D hiển thị TOÀN BỘ composite
  // 1024px (mọi layer gộp lại), còn TỪNG layer chỉ chiếm 58% bề rộng
  // composite × scale — thiếu phép nhân này là nguồn gốc ảnh bị phóng to
  // bằng cả mặt in khi vừa nhấn kéo, thả ra mới co về. Ưu tiên: decal thật
  // > rect overlay hiển thị > ước lượng cuối cùng.
  // ƯU TIÊN 1: rect projection THẬT truyền qua opts.rectPx (chữ ở 3D — đo
  // bằng screenPosFromPrintPoint, đúng pixel hiển thị trên áo).
  // ƯU TIÊN 2: rect px truyền vào (ảnh — giờ cũng đo bằng projection).
  // ƯU TIÊN CUỐI: ước lượng cũ (decalScreenWidth × ratio) — chỉ khi không đo
  // được. Thứ tự này hết "preview to ra rồi giật về size decal thật".
  let w = 0, h = 0, leftPx = null, topPx = null;
  const rectUsable = !!(rect && rect.width > 4);
  if (opts.rectPx && opts.rectPx.w > 4) {
    w = Math.round(opts.rectPx.w); h = Math.round(opts.rectPx.h || 0);
    leftPx = opts.rectPx.left; topPx = opts.rectPx.top;
  } else if (rectUsable) {
    w = Math.round(rect.width); h = Math.round(rect.height || 0);
  }
  if (!w) {
    const contentRatio = opts.ratio || 0.58;
    try {
      const dw = Math.round(window.tshirt360Viewer?.getDecalScreenWidth?.(state.currentView) || 0);
      if (dw > 0) w = Math.max(40, Math.round(dw * contentRatio * (scale || 1)));
    } catch (e) { w = 0; }
  }
  if (!w) w = Math.max(40, Math.round((opts.ratio || 0.58) * (scale || 1) * 0.30 * (container?.clientWidth || 800)));
  const p = document.createElement('img');
  p.src = src;
  p.className = 'studio-drag-preview';
  p.alt = '';
  p.style.width = `${w}px`;
  if (h > 4) p.style.height = `${h}px`; // giữ đúng tỉ lệ decal — không co giãn tự do
  p.style.left = `${leftPx != null ? leftPx : (rectUsable ? rect.left : startX - w / 2)}px`;
  p.style.top = `${topPx != null ? topPx : (rectUsable ? rect.top : startY - w / 2)}px`;
  document.body.appendChild(p);
  state.dragPreviewEl = p;
  state.dragPreviewMeta = { left: parseInt(p.style.left, 10), top: parseInt(p.style.top, 10), startX, startY };
}
function moveLayerDragPreview(clientX, clientY) {
  const p = state.dragPreviewEl;
  const m = state.dragPreviewMeta;
  if (!p || !m) return;
  p.style.left = `${m.left + (clientX - m.startX)}px`;
  p.style.top = `${m.top + (clientY - m.startY)}px`;
}
function endLayerDragPreview(immediate = false) {
  const container = document.getElementById('canvasViewer');
  const viewer3d = window.tshirt360Viewer;
  const removePreview = () => {
    state.dragPreviewEl?.remove();
    state.dragPreviewEl = null;
    state.dragPreviewMeta = null;
    if (container) container.classList.remove('is-layer-dragging');
  };
  const unhideDecal = () => { try { viewer3d?.setDecalsHidden?.(false); } catch (e) { /* */ } };
  if (immediate) { removePreview(); unhideDecal(); return; }
  // Viewer 3D thật + atomic swap: dựng decal mới xong (onDecalSwap) rồi mới
  // gỡ preview — hình ảnh liên tục tuyệt đối, không có khoảnh khắc trống.
  if (viewer3d?.setDecalsHidden && document.querySelector('.has-real-3d')) {
    let done = false;
    const finish = () => { if (done) return; done = true; removePreview(); unhideDecal(); };
    try {
      viewer3d.onDecalSwap = finish; // 1-shot trong viewer
      setTimeout(finish, 2500); // safety: lỗi texture vẫn phải tắt preview
      Promise.resolve(applyCurrentDesignToViewer()).catch(() => {});
      setTimeout(() => { if (!done && !viewer3d.getDecalInfo?.().count) finish(); }, 400);
    } catch (e) { finish(); }
    return;
  }
  removePreview(); unhideDecal();
}

function renderLayersOverlay() {
  const overlay = document.getElementById('mockupDesign');
  if (!overlay) return;
  const side = state.currentView;
  const layers = [...sideLayers(side)]
    .filter(l => l.visible !== false && l.url)
    .sort((a, b) => a.z - b.z);
  const activeText = getSideCustomText();
  if (!layers.length && !activeText) {
    overlay.innerHTML = '';
    state.printDesignUrl = '';
    updateOverlayPlacement();
    updateThreeTexture();
    renderLayerList();
    return;
  }
  const selected = getSelectedLayer(side);
  const cropping = isCropMode();
  overlay.innerHTML = layers.map(l => {
    const isSel = selected && selected.id === l.id;
    // PHASE 2: layer đang crop hiển thị KẾT QUẢ LIVE của crop draft (bg-position
    // theo draft) — phản hồi trực quan tức thì, không đợi Apply.
    const inCrop = cropping && isCropTarget(l);
    const c = inCrop ? sanitizeCropRect(state.cropSession.draft) : l.crop;
    const cropStyle = inCrop && (c.w < 1 || c.h < 1)
      ? `object-fit:none;background-image:url('${l.url}');background-repeat:no-repeat;`
      : '';
    const style = `left:0;top:0;width:46%;max-width:320px;transform:translate(calc(-50% + ${l.x}%), calc(-50% + ${l.y}%)) scale(${l.scale}) rotate(${l.rotation || 0}deg) scaleX(${l.flipH ? -1 : 1}) scaleY(${l.flipV ? -1 : 1});z-index:${10 + l.z};cursor:grab;opacity:${Math.max(0, Math.min(1, Number(l.opacity) || 0))};${cropStyle}${isSel && !cropping ? 'outline:2px dashed var(--s-accent, #ff6b00);outline-offset:3px;' : ''}`;
    return `<img src="${escapeAttr(l.url)}" alt="${escapeAttr(l.name || 'Design')}" class="mockup-print-design" data-layer-id="${escapeAttr(l.id)}" draggable="false" style="${style}">`;
  }).join('') + (activeText ? renderStyledTextOverlay(activeText) : '');
  wireTextOverlayDrag(overlay);
  // Click-to-select + DIRECT DRAG-TO-MOVE on the layer itself.
  // Pixels→percent: layer x/y are % of overlay box; overlay center is (0,0).
  overlay.querySelectorAll('img[data-layer-id]').forEach(img => {
    img.style.pointerEvents = 'auto';
    img.addEventListener('pointerdown', (e) => {
      if (isCropMode()) return; // CROP MODE: drag = reframe trong khung crop — không move layer
      e.stopPropagation();
      e.preventDefault();
      const layer = sideLayers(side).find(l => l.id === img.dataset.layerId);
      if (!layer) return;
      if (layer.locked) { showToast(`"${layer.name || 'Mẫu'}" đang khóa — bấm 🔓 để mở.`, 'warning', 1800); return; }
      // PRO MODIFIER: Alt+drag = nhân bản KÉO NHANH (Figma-style) — giữ nguyên
      // layer gốc, kéo thẳng bản sao tới chỗ mới. 1 gesture = 1 undo entry.
      if (e.altKey) {
        const dup = duplicateLayer(side, layer.id);
        if (!dup) return;
        // duplicateLayer đã refresh overlay → tìm node bản sao và chuyển giao
        // gesture kéo sang nó (tái dispatch pointerdown trên node mới).
        const dupNode = document.querySelector(`#mockupDesign img[data-layer-id="${CSS.escape(dup.id)}"]`);
        if (dupNode) {
          const re = new PointerEvent('pointerdown', { clientX: e.clientX, clientY: e.clientY, bubbles: true, cancelable: true, pointerId: e.pointerId });
          dupNode.dispatchEvent(re);
        }
        return;
      }
      // Đo rect TRƯỚC khi selectLayer (nó re-render overlay và thay thế node img
      // → rect trên node detached sẽ là 0x0).
      const layerBox = img.getBoundingClientRect();
      beginDesignUndoBatch('move');
      const overlayBox = overlay.getBoundingClientRect();
      selectLayer(side, layer.id);
      const startX = e.clientX, startY = e.clientY;
      const origX = layer.x, origY = layer.y, origRot = layer.rotation || 0;
      // CSS translate(%) tính theo KÍCH THƯỚC CHÍNH ẢNH LAYER (không phải
      // overlay — overlay là container absolute rỗng, width có thể = 0).
      // Fallback: overlay box, cuối cùng là 1 để tránh chia 0.
      const refW = Math.max(1, layerBox.width || overlayBox.width || 1);
      const refH = Math.max(1, layerBox.height || overlayBox.height || 1);
      const ppx = 100 / refW;
      const ppy = 100 / refH;
      let moved = false;
      let previewStarted = false;
      const onMove = (ev) => {
        const dx = (ev.clientX - startX) * ppx;
        const dy = (ev.clientY - startY) * ppy;
        if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 3) return;
        if (!previewStarted) {
          previewStarted = true;
          moved = true;
          beginLayerDragPreview(layer.url, layerBox, startX, startY, layer.scale);
        }
        moveLayerDragPreview(ev.clientX, ev.clientY);
        if (state.interactionMode === 'rotate') {
          // Rotate mode: drag spins the layer around its center (delta angle
          // from drag start, applied to the ORIGINAL rotation — no drift).
          const cx = overlayBox.left + overlayBox.width / 2;
          const cy = overlayBox.top + overlayBox.height / 2;
          const ang = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI;
          const ang0 = Math.atan2(startY - cy, startX - cx) * 180 / Math.PI;
          layer.rotation = clampNum(Math.round(origRot + (ang - ang0)), ...LAYER_BOUNDS.rotation);
          updateDragHud({ extra: `${Math.round(layer.rotation)}°` });
        } else {
          /* GROUP MOVE: kéo ảnh cũng kéo theo chữ (cùng delta) — mỗi bên
             clamp theo biên riêng; delta chữ tính theo overlay box của
             node chữ để % chạy đúng tốc độ tay. */
          if (groupMoveEnabled() && getSideCustomText() && !getSideTextLocked()) {
            /* Đơn vị: ảnh % theo KÍCH THƯỚC NODE ẢNH, chữ % theo NODE CHỮ —
               2 hệ quy chiếu KHÁC nhau. Đổi delta px tay sang % chữ theo
               đúng rộng/cao node chữ để CẢ HAI chạy cùng số px màn hình
               (trước đây y dùng tỉ lệ rộng → chữ trôi dọc sai tốc độ). */
            const tr = overlay.querySelector('.mockup-print-text[data-text-drag]')?.getBoundingClientRect();
            const tW = Math.max(1, tr?.width || refW), tH = Math.max(1, tr?.height || refH);
            state.textPlacement.x = clampNum(state.textPlacement.x + dx * (refW / tW), ...TEXT_BOUNDS.x);
            state.textPlacement.y = clampNum(state.textPlacement.y + dy * (refH / tH), ...TEXT_BOUNDS.y);
          }
          layer.x = clampNum(origX + dx, ...LAYER_BOUNDS.x);
          layer.y = clampNum(origY + dy, ...LAYER_BOUNDS.y);
          const sn = snapPlacement({ x: layer.x, y: layer.y }, { bypass: ev.altKey, siblings: siblingSnapTargets(side, layer.id), layer });
          layer.x = sn.x; layer.y = sn.y;
          updateDragHud({ x: layer.x, y: layer.y, snapLabel: sn.snapLabel, limitLabel: sn.limitLabel });
        }
        commitActivePlacements();
        syncPlacementInputs();
        // MƯỢT: trong lúc kéo CHỈ transform node hiện có (không rebuild DOM —
        // renderLayersOverlay() tái tạo innerHTML mỗi pixel chuột là nguồn gốc
        // giật/nháy trước đây). Rebuild đầy đủ khi thả chuột.
        moveOverlayLayerNode(img, layer);
        scheduleViewerUpdate();
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        hideSnapGuides(); hideDragHud(); hidePrintBoundary();
        if (moved) {
          endLayerDragPreview();
          pushDesignUndo('move'); // gộp cả quá trình kéo thành 1 entry
          renderLayersOverlay(); // rebuild 1 lần khi thả — đồng bộ danh sách/z-index
          showToast(`Đã di chuyển: ${layer.name || 'mẫu'} (x:${Math.round(layer.x)} y:${Math.round(layer.y)}${state.interactionMode === 'rotate' ? ` · ${Math.round(layer.rotation)}°` : ''})`, 'info', 1600);
        } else {
          showToast(`Đang chỉnh: ${layer.name || ''}`, 'info', 1500);
        }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
  });
  updateOverlayPlacement();
  updateThreeTexture();
  renderLayerList();
}

/* Di chuyển node layer TRONG overlay bằng transform trực tiếp (không rebuild).
   Cùng mapping với renderLayersOverlay: translate(calc(-50% + x%), ...) —
   % tính theo kích thước chính ảnh layer. */
function moveOverlayLayerNode(img, layer) {
  if (!img || !layer) return;
  img.style.transform = `translate(calc(-50% + ${layer.x}%), calc(-50% + ${layer.y}%)) scale(${layer.scale}) rotate(${layer.rotation || 0}deg) scaleX(${layer.flipH ? -1 : 1}) scaleY(${layer.flipV ? -1 : 1})`;
  img.style.opacity = String(Math.max(0, Math.min(1, Number(layer.opacity) || 0)));
}

/* ============================================================
   SELECTION FRAME — direct manipulation chuẩn editor:
   bounding box + 4 corner resize handles + rotation handle,
   BÁM ĐÚNG node thật (cả 2D lẫn 3D mode), xoay theo object,
   thao tác trực tiếp lên LAYER STATE (không state UI riêng).
   Text (slogan) cũng là target: scale/rotate per side qua
   sideTextPlacement/sideTextRotation — cùng pipeline composite.
   ============================================================ */
const selFrame = {
  el: null, kind: null, layerId: null, side: null,
  hidden: false, gesture: null,
};

/* CROP frame state (Phase 2) — element refs, no transform state here. */
const cropFrame = { el: null, img: null, dim: null, win: null };

function getSelectionTarget(side = state.currentView) {
  if (state.activePlacementLayer === 'text' && getSideCustomText(side)) return { kind: 'text', layer: null };
  const l = getSelectedLayer(side);
  if (l) return { kind: 'image', layer: l };
  if (getSideCustomText(side)) return { kind: 'text', layer: null };
  return null;
}

function ensureSelectionFrame() {
  if (selFrame.el && document.contains(selFrame.el)) return selFrame.el;
  const viewer = document.getElementById('canvasViewer');
  if (!viewer) return null;
  const el = document.createElement('div');
  el.className = 'selection-frame';
  el.innerHTML = `
    <span class="sel-unlock" data-handle="unlock" title="Mở khóa để chỉnh" hidden>🔒 Mở khóa</span>
    <span class="sel-corner" data-handle="nw"></span>
    <span class="sel-corner" data-handle="ne"></span>
    <span class="sel-corner" data-handle="sw"></span>
    <span class="sel-corner" data-handle="se"></span>
    <span class="sel-rot-line"></span>
    <span class="sel-rot-handle" data-handle="rot" title="Kéo để xoay">↻</span>`;
  viewer.appendChild(el);
  selFrame.el = el;
  wireSelectionHandles(el);
  return el;
}

/* Kích thước hiển thị (px, CHƯA tính rotation) của target + node tương ứng. */
function selectionGeometry(kind, layer) {
  const overlay = document.getElementById('mockupDesign');
  if (!overlay) return null;
  if (kind === 'image' && layer) {
    const node = overlay.querySelector(`img[data-layer-id="${CSS.escape(layer.id)}"]`);
    if (node) {
      const s = Math.max(0.01, Number(layer.scale) || 1);
      const rect = node.getBoundingClientRect();
      if (rect.width > 2) {
        // rect.width đã gồm scale — chia lại để ra kích thước gốc hiển thị.
        try {
          const m = new DOMMatrixReadOnly(getComputedStyle(node).transform);
          const sc = Math.hypot(m.a, m.b) || s;
          return { node, w: rect.width / sc, h: rect.height / sc, cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 };
        } catch (e) { /* matrix fail → dùng scale */ }
      }
      // MODE 3D: overlay node bị ẩn (0px) — đo kích thước thật qua PROJECTION
      // decal (nguồn hiển thị chính xác trên áo). Không dùng offsetWidth=0.
      const V = window.tshirt360Viewer;
      if (V?.screenPosFromPrintPoint) {
        const { hx, hy } = printSizeToUnits('image', layer);
        const pC = V.screenPosFromPrintPoint(layer.x, layer.y, state.currentView);
        const pA = V.screenPosFromPrintPoint(layer.x + hx, layer.y, state.currentView);
        const pB = V.screenPosFromPrintPoint(layer.x - hx, layer.y, state.currentView);
        const pCv = V.screenPosFromPrintPoint(layer.x, layer.y + hy, state.currentView);
        const pD = V.screenPosFromPrintPoint(layer.x, layer.y - hy, state.currentView);
        if (pC && pA && pB && pCv && pD) {
          return { node, w: Math.max(4, Math.hypot(pA.x - pB.x, pA.y - pB.y)), h: Math.max(4, Math.hypot(pCv.x - pD.x, pCv.y - pD.y)), cx: pC.x, cy: pC.y };
        }
      }
      return { node, w: node.offsetWidth * s, h: node.offsetHeight * s, cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 };
    }
    return null;
  }
  // TEXT: đo chính node chữ (layout size, chưa scale).
  const tnode = overlay.querySelector('.mockup-print-text[data-text-drag]');
  if (tnode) {
    const rect = tnode.getBoundingClientRect();
    try {
      const m = new DOMMatrixReadOnly(getComputedStyle(tnode).transform);
      const sc = Math.hypot(m.a, m.b) || Math.max(0.01, getSideTextPlacement().scale || 1);
      return { node: tnode, w: tnode.offsetWidth, h: tnode.offsetHeight, cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2, sc };
    } catch (e) { return { node: tnode, w: tnode.offsetWidth, h: tnode.offsetHeight, cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2, sc: getSideTextPlacement().scale || 1 }; }
  }
  return null;
}

function selectionRotation(kind, layer) {
  return kind === 'image' ? (Number(layer?.rotation) || 0) : (Number(getSideTextRotation()) || 0);
}

/* Screen rect của object (ảnh/chữ) — 3D dùng PROJECTION decal (cùng phép
   chiếu với selection frame), 2D dùng node overlay thật. Dùng cho hit-test
   chọn object + kích thước preview kéo ĐÚNG decal (trước đây preview đo
   ước lượng → to/nhỏ hơn thật, thả ra "giật" về size cũ). */
function printObjectScreenRect(kind, layer) {
  const V = window.tshirt360Viewer;
  const viewer = document.getElementById('canvasViewer');
  if (viewer?.classList.contains('has-real-3d') && typeof V?.screenPosFromPrintPoint === 'function') {
    const x = kind === 'image' ? layer.x : getSideTextPlacement().x;
    const y = kind === 'image' ? layer.y : getSideTextPlacement().y;
    const { hx, hy } = printSizeToUnits(kind, layer);
    const th = ((kind === 'image' ? (Number(layer.rotation) || 0) : (Number(getSideTextRotation()) || 0)) * Math.PI) / 180;
    const c = Math.cos(th), s = Math.sin(th);
    const corners = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]]
      .map(([ux, uy]) => V.screenPosFromPrintPoint(x + ux * c - uy * s, y + ux * s + uy * c, state.currentView));
    if (corners.every(Boolean)) {
      const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
      return { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    return null;
  }
  const overlay = document.getElementById('mockupDesign');
  const node = kind === 'image' && layer
    ? overlay?.querySelector(`img[data-layer-id="${CSS.escape(layer.id)}"]`)
    : overlay?.querySelector('.mockup-print-text[data-text-drag]');
  const r = node?.getBoundingClientRect();
  if (r && r.width > 2) return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height };
  return null;
}

/* Hit-test: object dưới con trỏ (text vẽ trên cùng trong composite → kiểm
   trước; rồi layer theo z giảm dần). Padding 6px cho dễ trúng. Trả null khi
   không trúng gì. Đây là mảnh ghép còn thiếu của UX "click vào cái nào chọn
   cái đó" — trước đây activePlacementLayer='text' bắt mọi pointer thành chữ
   nên không thể chọn lại ảnh sau khi tạo chữ. */
function hitTestPrintObject(clientX, clientY) {
  const side = state.currentView;
  if (getSideCustomText(side)) {
    const r = printObjectScreenRect('text', null);
    if (r && r.w > 4 && Math.abs(clientX - r.cx) <= r.w / 2 + 6 && Math.abs(clientY - r.cy) <= r.h / 2 + 6) {
      return { kind: 'text', layer: null };
    }
  }
  const layers = [...sideLayers(side)].filter(l => l.visible !== false && l.url).sort((a, b) => (b.z || 0) - (a.z || 0));
  for (const l of layers) {
    const r = printObjectScreenRect('image', l);
    if (r && r.w > 4 && Math.abs(clientX - r.cx) <= r.w / 2 + 6 && Math.abs(clientY - r.cy) <= r.h / 2 + 6) {
      return { kind: 'image', layer: l };
    }
  }
  return null;
}

/* Cập nhật vị trí/kích thước khung theo object. Gọi sau MỌI thay đổi.
   • Mode 3D (has-real-3d): anchor qua PROJECTION THẬT (screenPosFromPrintPoint)
     → khung bám chính xác decal trên áo, kể cả khi áo đã xoay.
   • Mode 2D: anchor thẳng node overlay (chính xác tuyệt đối ở chế độ 2D). */
/* Canvas dùng chung để đo chữ (không cấp phát mỗi lần update frame). */
let _textMetricsCtx = null;
function textMetricsContext() {
  if (!_textMetricsCtx) {
    const c = document.createElement('canvas');
    c.width = 8; c.height = 8;
    _textMetricsCtx = c.getContext('2d');
  }
  return _textMetricsCtx;
}

function printSizeToUnits(kind, layer) {
  // Half-extents của object trong hệ toạ độ print-point (100 = nửa composite).
  if (kind === 'image' && layer) {
    const s = Math.max(0.01, Number(layer.scale) || 1);
    let aspect = 1;
    const node = document.querySelector(`#mockupDesign img[data-layer-id="${CSS.escape(layer.id)}"]`);
    if (node && node.naturalWidth && node.naturalHeight) aspect = node.naturalWidth / node.naturalHeight;
    // drawLayerOnContext: fit trong khung 58%·scale — chiều bị giới hạn bởi
    // chiều dài hơn, chiều kia co theo aspect.
    const wPct = 58 * s * Math.min(1, aspect);
    const hPct = 58 * s * Math.min(1, 1 / aspect);
    return { hx: wPct, hy: hPct };
  }
  /* TEXT — PHASE 5 COMPLETION: đo bằng CANVAS metrics (cùng font/size/spacing
     với drawStyledText) thay vì offsetWidth của node overlay.
     ROOT CAUSE trước đây: ở chế độ 3D (has-real-3d) overlay bị co về 0×0 nên
     offsetWidth = 0 → hx/hy = 0 → khung chọn CHỮ không bao giờ hiện và kéo chữ
     không có kích thước tham chiếu. Ảnh đã có fallback projection; chữ thì không.
     Đơn vị: hx/hy là NỬA kích thước theo print-unit (100 = nửa vùng in) nên
     giá trị = bề rộng/bề cao đầy đủ tính theo % composite (xem
     screenPosFromPrintPoint: px/100 * decalW/2). */
  const tp = getSideTextPlacement();
  const text = applyTextTransform(getSideCustomText(), getSideTextStyle().transform);
  if (text) {
    const st = getSideTextStyle();
    const fontDef = TEXT_FONTS[st.font] || TEXT_FONTS.display;
    const weight = Math.min(Number(st.weight) || 900, fontDef.weightCap);
    const fs = Math.max(34, 82 * (Number(tp.scale) || 1));
    const mctx = textMetricsContext();
    mctx.font = `${st.italic ? 'italic ' : ''}${weight} ${fs}px ${fontDef.stack}`;
    try { mctx.letterSpacing = `${Math.round(fs * (Number(st.spacing) || 0) / 100)}px`; } catch (e) { /* */ }
    const m = mctx.measureText(text);
    const wFull = Math.max(1, m.width); // composite px (đã gồm letter-spacing)
    const asc = Number.isFinite(m.actualBoundingBoxAscent) ? m.actualBoundingBoxAscent : fs * 0.72;
    const desc = Number.isFinite(m.actualBoundingBoxDescent) ? m.actualBoundingBoxDescent : fs * 0.22;
    const hFull = Math.max(fs * 0.6, asc + desc);
    return { hx: (wFull / 1024) * 100, hy: (hFull / 1024) * 100 };
  }
  // Chưa có chữ → fallback cũ (giữ nguyên hành vi).
  return { hx: 29 * (Number(tp.scale) || 1), hy: 12 * (Number(tp.scale) || 1) };
}

let selTrackRaf = 0;
function stopSelectionTracking() {
  if (selTrackRaf) { cancelAnimationFrame(selTrackRaf); selTrackRaf = 0; }
}
function startSelectionTracking() {
  if (selTrackRaf) return;
  const tick = () => {
    selTrackRaf = requestAnimationFrame(tick);
    updateSelectionFrame();
  };
  selTrackRaf = requestAnimationFrame(tick);
}

function updateSelectionFrame() {
  const frame = ensureSelectionFrame();
  if (!frame) return;
  const viewer = document.getElementById('canvasViewer');
  if (!viewer || viewer.style.display === 'none') { frame.classList.remove('active'); stopSelectionTracking(); return; }
  if (selFrame.hidden || isCropMode()) { frame.classList.remove('active'); stopSelectionTracking(); return; }
  const side = state.currentView;
  const target = getSelectionTarget(side);
  if (!target) { frame.classList.remove('active'); stopSelectionTracking(); return; }
  const rot = selectionRotation(target.kind, target.layer);
  const locked = target.kind === 'image' ? target.layer.locked === true : getSideTextLocked();
  let cx = null, cy = null, w = 0, h = 0;
  const is3D = viewer.classList.contains('has-real-3d') && typeof window.tshirt360Viewer?.screenPosFromPrintPoint === 'function';
  if (is3D) {
    // ---- 3D: project center + 4 điểm trục → w/h/center chính xác trên decal
    const x = target.kind === 'image' ? target.layer.x : getSideTextPlacement().x;
    const y = target.kind === 'image' ? target.layer.y : getSideTextPlacement().y;
    const { hx, hy } = printSizeToUnits(target.kind, target.layer);
    const th = (rot * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
    const pC = window.tshirt360Viewer.screenPosFromPrintPoint(x, y, side);
    const pA = window.tshirt360Viewer.screenPosFromPrintPoint(x + hx * c, y + hx * s, side);
    const pB = window.tshirt360Viewer.screenPosFromPrintPoint(x - hx * c, y - hx * s, side);
    const pCv = window.tshirt360Viewer.screenPosFromPrintPoint(x - hy * s, y + hy * c, side);
    const pD = window.tshirt360Viewer.screenPosFromPrintPoint(x + hy * s, y - hy * c, side);
    if (pC && pA && pB && pCv && pD) {
      const vr = viewer.getBoundingClientRect();
      cx = pC.x - vr.left; cy = pC.y - vr.top;
      w = Math.hypot(pA.x - pB.x, pA.y - pB.y);
      h = Math.hypot(pCv.x - pD.x, pCv.y - pD.y);
    }
  }
  if (cx == null) {
    // ---- 2D fallback: anchor node overlay
    const geo = selectionGeometry(target.kind, target.layer);
    if (!geo || geo.w < 4 || geo.h < 4) { frame.classList.remove('active'); stopSelectionTracking(); return; }
    const vr = viewer.getBoundingClientRect();
    cx = geo.cx - vr.left; cy = geo.cy - vr.top; w = geo.w; h = geo.h;
  }
  if (w < 4 || h < 4) { frame.classList.remove('active'); stopSelectionTracking(); return; }
  frame.classList.add('active');
  frame.classList.toggle('locked-view', !!locked);
  frame.classList.toggle('text-frame', target.kind === 'text');
  const chip = frame.querySelector('.sel-unlock');
  if (chip) chip.hidden = !locked;
  frame.style.width = `${w}px`;
  frame.style.height = `${h}px`;
  frame.style.left = `${cx}px`;
  frame.style.top = `${cy}px`;
  frame.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`;
  selFrame.kind = target.kind; selFrame.layerId = target.layer?.id || null; selFrame.side = side;
  // 3D mode: camera động (lerp/auto) → frame phải bám LIÊN TỤC theo projection.
  if (is3D) startSelectionTracking();
}

function hideSelectionFrame() {
  selFrame.hidden = true;
  selFrame.el?.classList.remove('active');
}
function showSelectionFrame() {
  selFrame.hidden = false;
  updateSelectionFrame();
}

/* Hook preview kéo: đang kéo → frame ẩn (preview là feedback chính);
   thả → frame hiện lại bám vị trí mới. */
(function patchSelectionPreviewHooks() {
  const origBegin = beginLayerDragPreview;
  beginLayerDragPreview = function (...a) { selFrame.hidden = true; selFrame.el?.classList.remove('active'); return origBegin.apply(this, a); };
  const origEnd = endLayerDragPreview;
  endLayerDragPreview = function (...a) { const r = origEnd.apply(this, a); selFrame.hidden = false; refreshSelectionFrameSoon(); return r; };
})();

/* ---------------- RESIZE (corner handle) ---------------- */
/* Resize GIỮ TỈ LỆ (mặc định) quanh góc đối diện, giữ rotation.
   Toán học: làm việc trong hệ local (xoay ngược), scale factor k = w'/w.
   center' = cornerW − R·(±w'/2, ±h'/2) → suy ngược x'/y' per kind:
   • image (origin 50%): O = center − R·((x−50)w/100, (y−50)h/100); x' = 50 + (R⁻¹(center'−O)).x·100/w'
   • text (origin 0 0):  T = cornerW − k·R·(±w/2, ±h/2);            x' = 50 + T.x·100/w'
   Giới hạn: scale ∈ LAYER_BOUNDS.scale + min 24px hiển thị. */
const SEL_MIN_PX = 24;

function wireSelectionHandles(frame) {
  frame.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('[data-handle]');
    if (!handle) return;
    if (isCropMode()) return; // CROP MODE: handles selection không hoạt động
    /* PASSTHROUGH (fix "không chọn lại được chữ sau khi tạo chữ"):
       tay xoay ↻ treo 20px dưới khung + hit-area vô hình ±7px — khi chữ nằm
       ngay dưới khung ảnh, bấm vào chữ bị nuốt thành gesture XOAY ẢNH
       (stopPropagation → canvas không bao giờ nhận pointerdown).
       Giờ: nếu dưới con trỏ là object KHÁC object đang chọn → nhường click
       (không stopPropagation → event chảy xuống canvas → hit-test chọn đúng
       object thật). Handle vẫn xoay/resize bình thường khi không ai ở dưới. */
    if (handle.dataset.handle !== 'unlock') {
      const cur = getSelectionTarget(state.currentView);
      const hit = typeof hitTestPrintObject === 'function' ? hitTestPrintObject(e.clientX, e.clientY) : null;
      const hitIsSelf = hit && cur && hit.kind === cur.kind && (hit.kind === 'text' || hit.layer?.id === cur.layer?.id);
      if (hit && !hitIsSelf) return; // object khác nằm dưới handle → để canvas xử lý
    }
    e.stopPropagation(); e.preventDefault();
    const side = state.currentView;
    const target = getSelectionTarget(side);
    if (!target) return;
    // UNLOCK CHIP: bấm chip trên khung → mở khóa ngay (image/text).
    if (handle.dataset.handle === 'unlock') {
      if (target.kind === 'image') target.layer.locked = false;
      else commitTextLocked(side, false);
      pushDesignUndo('lock');
      refreshSideViews();
      showToast('Đã mở khóa — chỉnh thoải mái.', 'success', 1400);
      return;
    }
    const locked = target.kind === 'image' ? target.layer.locked === true : getSideTextLocked();
    if (locked) { showToast('Object đang khóa — bấm 🔒 Mở khóa trên khung.', 'warning', 2000); return; }
    const geo = selectionGeometry(target.kind, target.layer);
    if (!geo) return;
    const rot = selectionRotation(target.kind, target.layer);
    const isRotate = handle.dataset.handle === 'rot';
    const cornerName = isRotate ? null : handle.dataset.handle;
    const sign = cornerName === 'nw' ? { x: 1, y: 1 } : cornerName === 'ne' ? { x: -1, y: 1 } : cornerName === 'sw' ? { x: 1, y: -1 } : { x: -1, y: -1 };
    const vr = document.getElementById('canvasViewer').getBoundingClientRect();
    const centerW = { x: geo.cx - vr.left, y: geo.cy - vr.top };
    const rad = (rot * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    // Góc đối diện handle (hệ world, viewer-local):
    const cornerW = isRotate
      ? null
      : { x: centerW.x + cos * (sign.x * geo.w / 2) - sin * (sign.y * geo.h / 2), y: centerW.y + sin * (sign.x * geo.w / 2) + cos * (sign.y * geo.h / 2) };
    // Khoảng cách chuột→corner lúc BẮT ĐẦU (local) — scale tương đối theo
    // đây nên không bao giờ nhảy dù handle bắt đầu lệch so với góc khung.
    const startMouse = { x: e.clientX - vr.left, y: e.clientY - vr.top };
    // ROTATE không dùng corner — bỏ qua tính local-origin quanh corner (cornerW=null).
    const startLx0 = isRotate ? 1 : Math.max(4, cos * (startMouse.x - cornerW.x) + sin * (startMouse.y - cornerW.y));
    const startLy0 = isRotate ? 1 : Math.max(4, -sin * (startMouse.x - cornerW.x) + cos * (startMouse.y - cornerW.y));
    const start = {
      w: geo.w, h: geo.h, rot,
      mouse: startMouse,
      angle0: Math.atan2(startMouse.y - centerW.y, startMouse.x - centerW.x) * 180 / Math.PI,
      lx0: startLx0, ly0: startLy0,
    };
    beginDesignUndoBatch(isRotate ? 'rotate' : 'resize');
    /* PHASE 5 FINAL — 1 GESTURE = 1 HISTORY ENTRY (rotate/resize handle).
       Trước đây onMove đẩy undo mỗi ≥350ms → gesture dài sinh 4 entry, và vì
       entry ghi ở trạng thái GIỮA gesture nên Ctrl+Z trả về rotation trung gian
       chứ không phải rotation trước khi bắt đầu kéo. Giờ chỉ đẩy MỘT lần ở
       pointerup (onUp đã có), nên pre = snapshot ngay trước gesture → undo chính xác. */
    const onMove = (ev) => {
      const m = { x: ev.clientX - vr.left, y: ev.clientY - vr.top };
      if (isRotate) {
        const ang = Math.atan2(m.y - centerW.y, m.x - centerW.x) * 180 / Math.PI;
        let next = start.rot + (ang - start.angle0);
        next = ((Math.round(next) % 360) + 360) % 360;
        // Snap 45°: hút ổn định trong ±3.5° — không rung (chỉ snap khi vào vùng).
        const near = ((next % 45) + 45) % 45;
        const snapped = near <= 3.5 ? next - near : near >= 41.5 ? next + (45 - near) : null;
        const val = snapped != null ? snapped : next;
        if (target.kind === 'image') target.layer.rotation = val;
        else commitTextRotation(state.currentView, val);
        updateDragHud({ x: target.kind === 'image' ? target.layer.x : getSideTextPlacement().x, y: target.kind === 'image' ? target.layer.y : getSideTextPlacement().y, extra: `${Math.round(val)}°`, snapLabel: snapped != null ? `SNAP ${snapped}°` : '' });
      } else {
        // Chuột → local (xoay ngược quanh góc cố định). Scale TƯƠNG ĐỐI theo
        // khoảng cách chuột lúc bắt đầu → kéo 1.5× = to 1.5×, đúng tốc độ tay.
        const dx = m.x - cornerW.x, dy = m.y - cornerW.y;
        const lx = cos * dx + sin * dy, ly = -sin * dx + cos * dy;
        const k = Math.max(Math.abs(lx) / start.lx0, Math.abs(ly) / start.ly0, 0.05);
        const scaleMax = target.kind === 'image' ? LAYER_BOUNDS.scale[1] : TEXT_BOUNDS.scale[1];
        const scaleCur = target.kind === 'image' ? (Number(target.layer.scale) || 1) : (getSideTextPlacement().scale || 1);
        let kNew = Math.min(k, scaleMax / scaleCur);
        const minK = Math.max(0.1 / scaleCur, SEL_MIN_PX / Math.max(start.w, start.h));
        kNew = Math.max(kNew, minK);
        const nw = start.w * kNew, nh = start.h * kNew;
        // Center mới trong local rồi quay ra world
        const lc = { x: -sign.x * nw / 2, y: -sign.y * nh / 2 };
        const cW = { x: cornerW.x + cos * lc.x - sin * lc.y, y: cornerW.y + sin * lc.x + cos * lc.y };
        if (target.kind === 'image') {
          const O = { x: centerW.x - (cos * ((target.layer.x - 50) * start.w / 100) - sin * ((target.layer.y - 50) * start.h / 100)), y: centerW.y - (sin * ((target.layer.x - 50) * start.w / 100) + cos * ((target.layer.y - 50) * start.h / 100)) };
          const rx = cos * (cW.x - O.x) + sin * (cW.y - O.y), ry = -sin * (cW.x - O.x) + cos * (cW.y - O.y);
          target.layer.scale = +(scaleCur * kNew).toFixed(4);
          target.layer.x = +(50 + rx * 100 / nw).toFixed(3);
          target.layer.y = +(50 + ry * 100 / nh).toFixed(3);
          clampLayerToPrintArea(target.layer);
          state.printPlacement = { x: target.layer.x, y: target.layer.y, scale: target.layer.scale };
          updateDragHud({ x: target.layer.x, y: target.layer.y, extra: `${Math.round(target.layer.scale * 100)}%` });
        } else {
          const rx = cos * (-sign.x * nw / 2) - sin * (-sign.y * nh / 2), ry = sin * (-sign.x * nw / 2) + cos * (-sign.y * nh / 2);
          const tp = state.textPlacement;
          tp.scale = +(scaleCur * kNew).toFixed(4);
          // Clamp về TEXT_BOUNDS — chữ không bao giờ bị resize văng ra ngoài vùng in
          // (nhánh ảnh có clampLayerToPrintArea, nhánh chữ thiếu → x/y trôi tới 100%).
          tp.x = clampNum(+(50 + rx * 100 / nw).toFixed(3), ...TEXT_BOUNDS.x);
          tp.y = clampNum(+(50 + ry * 100 / nh).toFixed(3), ...TEXT_BOUNDS.y);
          commitActivePlacements();
          updateDragHud({ x: tp.x, y: tp.y, extra: `${Math.round(tp.scale * 100)}%` });
        }
      }
      // Live: node transform + slider + decal throttle — KHÔNG rebuild DOM.
      commitActivePlacements();
      syncPlacementInputs();
      if (target.kind === 'image' && target.layer) {
        const node = document.querySelector(`#mockupDesign img[data-layer-id="${CSS.escape(target.layer.id)}"]`);
        if (node) moveOverlayLayerNode(node, target.layer);
      } else {
        updateOverlayPlacement();
        const tn = document.querySelector('#mockupDesign .mockup-print-text');
        if (tn) { const tp2 = state.textPlacement; tn.style.transform = `translate(calc(-50% + ${tp2.x}%), calc(-50% + ${tp2.y}%)) scale(${tp2.scale}) rotate(${getSideTextRotation()}deg)`; }
      }
      scheduleViewerUpdate();
      // Frame bám object mỗi frame move (nhẹ: chỉ style).
      updateSelectionFrame();
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      hideDragHud();
      pushDesignUndo(isRotate ? 'rotate' : 'resize');
      refreshSideViews();
      showToast(isRotate ? `Đã xoay ${target.kind === 'image' ? 'mẫu' : 'chữ'} ${Math.round(selectionRotation(target.kind, target.layer))}°.` : `Kích thước: ${Math.round((target.kind === 'image' ? target.layer.scale : getSideTextPlacement().scale) * 100)}%.`, 'info', 1500);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
}

/* Selection phải sống sót qua mọi render — gắn hook nhẹ vào các hàm refresh
   (không sửa từng call-site): observe sự thay đổi overlay bằng rAF ngắn
   sau mỗi renderLayersOverlay/selectLayer via monkey-patch CÓ KIỂM SOÁT. */
(function patchSelectionRefresh() {
  const origRender = renderLayersOverlay;
  renderLayersOverlay = function (...a) {
    const r = origRender.apply(this, a);
    requestAnimationFrame(() => updateSelectionFrame());
    return r;
  };
  const origSelect = selectLayer;
  selectLayer = function (...a) {
    const r = origSelect.apply(this, a);
    requestAnimationFrame(() => updateSelectionFrame());
    return r;
  };
})();

/* ============================================================
   SNAP ENGINE + HUD — nâng trải nghiệm đặt vị trí lên tầm pro:
   • Snap dẫn hướng (không cứng): tâm ngang X=0, tâm dọc Y=0, căn cạnh
     trên/dưới với layer khác. Vào vùng hút → giá trị chốt chính xác,
     guide vàng sáng + HUD báo "ĐÃ CĂN GIỮA".
   • Alt giữ khi kéo → tắt snap hoàn toàn (free placement).
   • HUD chip cạnh con trỏ: x/y/° live từng frame.
   ============================================================ */
const SNAP_RADIUS = 2.2;      // % vị trí — vùng hút quanh vạch snap
const SNAP_LINES = { x: [0], y: [0] }; // tâm ngang + tâm dọc

function applySnaps(value, axis, otherValue, otherSnapTargets) {
  // Trả về { value, snapped } — snapped = vạch đã hút (để vẽ guide).
  const eps = SNAP_RADIUS;
  for (const line of SNAP_LINES[axis]) {
    if (Math.abs(value - line) <= eps) return { value: line, snapped: line };
  }
  if (Array.isArray(otherSnapTargets)) {
    for (const t of otherSnapTargets) {
      if (Math.abs(value - t) <= eps) return { value: t, snapped: t };
    }
  }
  return { value, snapped: null };
}

/* Vạch snap targets từ layer KHÁC cùng mặt (căn trên/dưới/tâm-dọc với nhau) */
function siblingSnapTargets(side, excludeLayerId) {
  return sideLayers(side)
    .filter(l => l.visible !== false && l.url && l.id !== excludeLayerId)
    .map(l => ({ top: l.y, bottom: l.y, cx: l.x }));
}

let snapGuideEls = null;
function ensureSnapGuides() {
  if (snapGuideEls && document.contains(snapGuideEls.v)) return snapGuideEls;
  const viewer = document.getElementById('canvasViewer');
  if (!viewer) return null;
  const v = document.createElement('div'); v.className = 'snap-guide snap-guide-v';
  const h = document.createElement('div'); h.className = 'snap-guide snap-guide-h';
  viewer.appendChild(v); viewer.appendChild(h);
  snapGuideEls = { v, h };
  return snapGuideEls;
}
function showSnapGuides({ x, y } = {}) {
  const g = ensureSnapGuides();
  if (!g) return;
  // Guide vẽ trong hệ % của viewer (vạch tâm = 50%).
  if (x != null) { g.v.style.left = `calc(50% + ${x * 0.5}%)`; g.v.classList.add('active'); }
  else g.v.classList.remove('active');
  if (y != null) { g.h.style.top = `calc(50% + ${y * 0.28}%)`; g.h.classList.add('active'); }
  else g.h.classList.remove('active');
}
function hideSnapGuides() {
  if (!snapGuideEls) return;
  snapGuideEls.v.classList.remove('active');
  snapGuideEls.h.classList.remove('active');
}

let hudEl = null;
function ensureDragHud() {
  if (hudEl && document.contains(hudEl)) return hudEl;
  const viewer = document.getElementById('canvasViewer');
  if (!viewer) return null;
  hudEl = document.createElement('div');
  hudEl.className = 'drag-hud';
  viewer.appendChild(hudEl);
  return hudEl;
}
function updateDragHud(obj) {
  // obj: { x, y, extra, snapLabel, limitLabel } — vị trí % hiển thị live.
  const hud = ensureDragHud();
  if (!hud || !obj) return;
  const parts = [];
  if (obj.x != null) parts.push(`X ${Math.round(obj.x)}`);
  if (obj.y != null) parts.push(`Y ${Math.round(obj.y)}`);
  if (obj.extra) parts.push(obj.extra);
  hud.textContent = parts.join('  ·  ');
  hud.classList.toggle('snap-locked', !!obj.snapLabel);
  hud.dataset.snap = obj.snapLabel || '';
  // CHẠM GIỚI HẠN: ưu tiên hiển thị tên biên chạm (phải/vòng/trái/dưới)
  hud.classList.toggle('at-limit', !!obj.limitLabel);
  hud.dataset.limit = obj.limitLabel || '';
  hud.classList.toggle('overflow', !!obj.overflow && !obj.limitLabel);
  hud.dataset.overflow = obj.overflow ? 'VƯỢT KHUNG IN — VẪN IN ĐƯỢC' : '';
  hud.classList.add('active');
}
function hideDragHud() {
  if (hudEl) hudEl.classList.remove('active', 'snap-locked', 'at-limit');
}

/* KHUNG GIỚI HẠN — hiện vùng di chuyển TỐI ĐA của ảnh đang kéo.
   Là khung vàng nét đứt trong viewer, kích thước = nơi mép ảnh có thể tới.
   Người dùng nhìn thấy ngay: "đây là giới hạn, ảnh sẽ luôn nguyên vẹn". */
let boundaryEl = null;
let boundaryGhostEl = null;
let boundaryChipEl = null;
function showPrintBoundary(layer, posX, posY) {
  const viewer = document.getElementById('canvasViewer');
  if (!viewer) return;
  /* PRINT BOUNDARY 3.0 — khung ĐỎ ôm VÙNG IN trên áo (theo mẫu thiết kế):
     chiếu 4 góc decal (±100 print-point) qua projection 3D → SVG polygon bám
     đúng hình vùng in trên áo (không phải hình chữ nhật viewport). Ý nghĩa
     rõ ràng: mép artwork KHÔNG BAO GIỜ vượt khung đỏ này — clamp theo mép
     object đảm bảo điều đó. */
  if (!boundaryEl || !document.contains(boundaryEl)) {
    boundaryEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    // SVG: className là SVGAnimatedString (readonly) — PHẢI setAttribute('class')
    // để CSS .print-boundary match được.
    boundaryEl.setAttribute('class', 'print-boundary');
    boundaryEl.innerHTML = '<polygon class="pb-quad" points="0,0 0,0 0,0 0,0"></polygon>';
    viewer.appendChild(boundaryEl);
  }
  if (!boundaryChipEl || !document.contains(boundaryChipEl)) {
    boundaryChipEl = document.createElement('div');
    boundaryChipEl.className = 'pb-limit-chip';
    boundaryChipEl.textContent = 'ĐÃ TỚI GIỚI HẠN VÙNG IN';
    viewer.appendChild(boundaryChipEl);
  }
  const V = window.tshirt360Viewer;
  const lim = layerPrintLimits(layer);
  const vr0 = viewer.getBoundingClientRect();
  let quad = null;
  try {
    const pts = [
      V?.screenPosFromPrintPoint?.(-100, -100, state.currentView),
      V?.screenPosFromPrintPoint?.(100, -100, state.currentView),
      V?.screenPosFromPrintPoint?.(100, 100, state.currentView),
      V?.screenPosFromPrintPoint?.(-100, 100, state.currentView),
    ].filter(Boolean);
    if (pts.length === 4) {
      quad = pts.map(p => `${(p.x - vr0.left).toFixed(1)},${(p.y - vr0.top).toFixed(1)}`).join(' ');
    }
  } catch (e) { /* fallback dưới */ }
  if (!quad) {
    const vw = viewer.clientWidth || 1, vh = viewer.clientHeight || 1;
    const w = (lim.maxX - lim.minX) * 0.58 / 100 * vw;
    const h = (lim.maxY - lim.minY) * 0.58 / 100 * vh * 0.72;
    const cx = (lim.minX + lim.maxX) / 2, cy = (lim.minY + lim.maxY) / 2;
    const left = (50 + cx * 0.29) / 100 * vw, top = (44 + cy * 0.29) / 100 * vh;
    quad = [
      `${(left - w / 2).toFixed(1)},${(top - h / 2).toFixed(1)}`,
      `${(left + w / 2).toFixed(1)},${(top - h / 2).toFixed(1)}`,
      `${(left + w / 2).toFixed(1)},${(top + h / 2).toFixed(1)}`,
      `${(left - w / 2).toFixed(1)},${(top + h / 2).toFixed(1)}`,
    ].join(' ');
  }
  const pbQuad = boundaryEl.querySelector('.pb-quad');
  if (pbQuad) pbQuad.setAttribute('points', quad);
  boundaryEl.classList.add('active');
  // CẢNH BÁO CHẠM BIÊN (kiểu mới): khung đập đỏ + CHIP đỏ nổi sát object —
  // "tới đây là tối đa" hiện ngay tại chỗ, thay nhãn góc khung cũ.
  const atLimit = layer && Number.isFinite(posX) && (
    Math.abs(posX - lim.maxX) < 0.8 || Math.abs(posX - lim.minX) < 0.8 ||
    Math.abs(posY - lim.maxY) < 0.8 || Math.abs(posY - lim.minY) < 0.8);
  boundaryEl.classList.toggle('at-limit', !!atLimit);
  if (boundaryChipEl) {
    if (atLimit) {
      const kind = layer?.url ? 'image' : 'text';
      const r = typeof printObjectScreenRect === 'function' ? printObjectScreenRect(kind, layer?.url ? layer : null) : null;
      if (r) {
        const topPx = r.cy - r.h / 2 - vr0.top;
        const below = topPx < 56; // sát mép trên → chip xuống đáy object
        boundaryChipEl.classList.toggle('below', below);
        boundaryChipEl.style.left = `${r.cx - vr0.left}px`;
        boundaryChipEl.style.top = `${below ? r.cy + r.h / 2 - vr0.top : topPx}px`;
        boundaryChipEl.classList.add('active');
      }
    } else {
      boundaryChipEl.classList.remove('active');
    }
  }
  // GHOST ẢNH Ở BIÊN: bản-sao mờ của ảnh đặt tại giới hạn gần chuột nhất —
  // người dùng THẤY TRƯỚC ảnh sẽ nằm đâu khi đẩy tới giới hạn.
  if (layer && layer.url && !boundaryGhostEl) {
    boundaryGhostEl = document.createElement('img');
    boundaryGhostEl.className = 'boundary-ghost';
    boundaryGhostEl.alt = '';
    boundaryGhostEl.draggable = false;
    boundaryGhostEl.src = layer.url;
    viewer.appendChild(boundaryGhostEl);
  }
  if (boundaryGhostEl && layer) {
    const { hx } = printSizeToUnits('image', layer);
    const limW = Math.round((V?.getDecalScreenWidth?.(state.currentView) || 300) * (hx / 50));
    boundaryGhostEl.style.width = `${Math.max(30, limW)}px`;
  }
}
/* Đặt ghost ảnh ở điểm biên GẦN vị trí kéo hiện tại (theo từng trục).
   Hiện khi VƯỚT hoặc ĐẦM CHẶT biên (eps 0.5) — preview nơi ảnh sẽ dừng. */
function moveBoundaryGhost(layer, x, y) {
  if (!boundaryGhostEl || !layer) return;
  const lim = layerPrintLimits(layer);
  // Vẽ ghost ở biên khi object ĐỤNG biên (≤0.8%) — đúng điểm dừng thật,
  // kích thước = kích thước thật (projection) — không ước lượng.
  const eps = 0.8;
  const nearMax = (v, max) => Math.abs(v - max) < eps;
  const nearMin = (v, min) => Math.abs(v - min) < eps;
  const gx = nearMax(x, lim.maxX) ? lim.maxX : nearMin(x, lim.minX) ? lim.minX : null;
  const gy = nearMax(y, lim.maxY) ? lim.maxY : nearMin(y, lim.minY) ? lim.minY : null;
  if (gx == null && gy == null) { boundaryGhostEl.classList.remove('active'); return; }
  const px = window.tshirt360Viewer?.screenPosFromPrintPoint?.(
    gx != null ? gx : x,
    gy != null ? gy : y,
    state.currentView
  );
  if (!px) { boundaryGhostEl.classList.remove('active'); return; }
  const viewer = document.getElementById('canvasViewer');
  const vr = viewer.getBoundingClientRect();
  // Kích thước ghost = kích thước thật của object trên màn hình (projection).
  const kind = layer.url ? 'image' : 'text';
  const r = printObjectScreenRect(kind, layer.url ? layer : null);
  if (r) {
    boundaryGhostEl.style.width = `${Math.max(30, Math.round(r.w))}px`;
    if (r.h > 4) boundaryGhostEl.style.height = `${Math.round(r.h)}px`;
  }
  boundaryGhostEl.style.left = `${px.x - vr.left - boundaryGhostEl.offsetWidth / 2}px`;
  boundaryGhostEl.style.top = `${px.y - vr.top - boundaryGhostEl.offsetHeight / 2}px`;
  boundaryGhostEl.classList.add('active');
}
function hidePrintBoundary() {
  if (boundaryEl) boundaryEl.classList.remove('active');
  if (boundaryGhostEl) { boundaryGhostEl.classList.remove('active'); }
  if (boundaryChipEl) boundaryChipEl.classList.remove('active');
}

/* Kiểm tra chạm biên sau clamp — trả về tên biên để HUD báo rõ. */
function limitLabel(x, y, lim) {
  const eps = 0.51;
  const labels = [];
  if (Math.abs(x - lim.maxX) < eps) labels.push('GIỚI HẠN PHẢI');
  else if (Math.abs(x - lim.minX) < eps) labels.push('GIỚI HẠN TRÁI');
  if (Math.abs(y - lim.maxY) < eps) labels.push('GIỚI HẠN DƯỚI');
  else if (Math.abs(y - lim.minY) < eps) labels.push('GIỚI HẠN TRÊN');
  return labels.join(' + ');
}

/* Snap + guide + BOUNDARY chung cho mọi đường kéo (overlay/canvas, ảnh/chữ).
   Trả về vị trí đã snap/clamp + nhãn snap/limit để HUD hiển thị rõ. */
function snapPlacement(pos, opts = {}) {
  const bypass = opts.bypass === true; // Alt giữ → free
  const layer = opts.layer || null;
  // 1. CLAMP NGUYÊN VẸN TRƯỚC — ảnh không bao giờ khuất, bất kể Alt.
  let clamped = { x: pos.x, y: pos.y };
  let lim = null;
  if (layer) {
    lim = layerPrintLimits(layer);
    clamped.x = clampNum(pos.x, lim.minX, lim.maxX);
    clamped.y = clampNum(pos.y, lim.minY, lim.maxY);
  }
  // 2. Boundary frame luôn hiện trong lúc kéo → người dùng thấy giới hạn
  //    (pos truyền vào để cảnh báo đỏ khi object ĐỤNG biên).
  if (layer) showPrintBoundary(layer, clamped.x, clamped.y);
  if (bypass) {
    showSnapGuides({});
    const ll = lim ? limitLabel(clamped.x, clamped.y, lim) : '';
    if (layer) moveBoundaryGhost(layer, clamped.x, clamped.y);
    return { x: clamped.x, y: clamped.y, snapLabel: '', limitLabel: ll, snappedX: null, snappedY: null };
  }
  const sib = opts.siblings || [];
  const sx = applySnaps(clamped.x, 'x', clamped.y, sib.map(s => s.cx));
  const sy = applySnaps(clamped.y, 'y', clamped.x, [...sib.map(s => s.top), ...sib.map(s => s.bottom)]);
  showSnapGuides({ x: sx.snapped, y: sy.snapped });
  if (layer) moveBoundaryGhost(layer, sx.value, sy.value);
  const label = [];
  if (sx.snapped === 0) label.push('CĂN GIỮA NGANG');
  if (sy.snapped === 0) label.push('CĂN GIỮA DỌC');
  const ll = lim ? limitLabel(sx.value, sy.value, lim) : '';
  // SOFT-WARN: ảnh tràn khung composite (chủ ý full-print) vẫn in được trên
  // decal plane — HUD báo nhẹ để người dùng biết đang dùng vùng mở rộng.
  const overflow = lim && lim.soft && (Math.abs(sx.value) + lim.half > 50 || sy.value - lim.half < -44 || sy.value + lim.half > 56);
  pushDesignUndo('move'); // drag path = 1 entry/gesture (coalesce 350ms)
  return { x: sx.value, y: sy.value, snapLabel: label.join(' + '), limitLabel: ll, overflow, snappedX: sx.snapped, snappedY: sy.snapped };
}

/* Master update selection frame — gọi sau MỌI render/refresh/select.
   Không thay đổi state; chỉ định vị khung theo geometry thật. */
function refreshSelectionFrameSoon() {
  requestAnimationFrame(() => updateSelectionFrame());
}

/* Slogan overlay theo đúng style (font/case/màu/đậm/viền/giãn) — cùng công
   thức vẽ với composite nên overlay 2D == bản in 3D == đơn hàng. */
function renderStyledTextOverlay(rawText) {
  const st = getSideTextStyle();
  const def = TEXT_FONTS[st.font] || TEXT_FONTS.display;
  const weight = Math.min(st.weight, def.weightCap);
  const text = applyTextTransform(rawText, st.transform);
  const tp = getSideTextPlacement();
  const fs = Math.max(34, 82 * tp.scale); // khớp drawStyledText (px trên composite 1024 → quy đổi % qua text-scale var)
  // Viền 4 hướng + halo mềm — chữ nổi rõ trên mọi màu áo, tắt được.
  const ink = st.stroke ? getInkContrast(st.color) : '';
  const stroke = st.stroke
    ? `text-shadow: 1px 1px 0 ${ink}, -1px 1px 0 ${ink}, 1px -1px 0 ${ink}, -1px -1px 0 ${ink}, 0 0 3px ${ink}, 0 3px 8px rgba(0,0,0,0.28);`
    : 'text-shadow: none;';
  const deco = `${st.italic ? ' font-style:italic;' : ''}${st.underline ? ' text-decoration:underline;' : ''}`;
  const tpv = getSideTextPlacement();
  const textOp = Math.max(0, Math.min(1, Number(tpv.opacity) || 1));
  return `<div class="mockup-print-text" data-text-drag="1" style="font-family:${def.stack};font-weight:${weight};color:${escapeAttr(st.color)};letter-spacing:${(st.spacing || 0) / 100}em;text-transform:none;opacity:${textOp};${stroke}${deco}">${escapeHtml(text)}</div>`;
}

/* Kéo chữ TRỰC TIẾP trên overlay (như layer ảnh): pointerdown trên
   .mockup-print-text → di chuyển textPlacement. Preview = ảnh chữ
   screen-space (cùng đường beginLayerDragPreview). */
function wireTextOverlayDrag(overlay) {
  const el = overlay.querySelector('.mockup-print-text[data-text-drag]');
  if (!el) return;    el.style.pointerEvents = 'auto';
    el.addEventListener('pointerdown', el._textDragDown = (e) => {
      e.stopPropagation();
      e.preventDefault();
      setActivePlacementLayer('text');
      if (getSideTextLocked()) { showToast('Chữ đang khóa — mở khóa để di chuyển.', 'warning', 1700); return; }
      beginDesignUndoBatch('text-move');
    const box = el.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    const origX = getSideTextPlacement().x, origY = getSideTextPlacement().y;
    const refW = Math.max(1, box.width || 1), refH = Math.max(1, box.height || 1);
    const ppx = 100 / refW, ppy = 100 / refH;
    let moved = false, previewStarted = false;
    const onMove = (ev) => {
      if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 3) return;
      if (!previewStarted) {
        previewStarted = true; moved = true;
        beginLayerDragPreview(buildTextDragPreviewUrl(), box, startX, startY, getSideTextPlacement().scale, { ratio: 0.4 });
      }
      moveLayerDragPreview(ev.clientX, ev.clientY);
      // GHI VÀO BUFFER HOẠT ĐỘNG state.textPlacement — commitActivePlacements
      // copy buffer này sang sideTextPlacement; ghi thẳng side trước đây bị
      // commit ghi đè ngược về 0 mỗi move (drag chữ đứng yên).
      state.textPlacement.x = clampNum(origX + (ev.clientX - startX) * ppx, ...TEXT_BOUNDS.x);
      state.textPlacement.y = clampNum(origY + (ev.clientY - startY) * ppy, ...TEXT_BOUNDS.y);
      /* GROUP MOVE: kéo chữ cũng kéo theo ảnh đang chọn — delta px tay đổi
         sang % ảnh theo NODE ẢNH (không phải cộng nguyên % chữ: 2 hệ quy
         chiếu khác nhau làm ảnh trôi khác chữ = "2 cái riêng biệt"). */
      if (groupMoveEnabled()) {
        const sel = getSelectedLayer(sideKey());
        if (sel && !sel.locked) {
          const ir = overlay.querySelector(`img[data-layer-id="${CSS.escape(sel.id)}"]`)?.getBoundingClientRect();
          const iW = Math.max(1, ir?.width || 1), iH = Math.max(1, ir?.height || 1);
          sel.x = clampNum(sel.x + (ev.clientX - startX) * 100 / iW, ...LAYER_BOUNDS.x);
          sel.y = clampNum(sel.y + (ev.clientY - startY) * 100 / iH, ...LAYER_BOUNDS.y);
        }
      }
      const sn = snapPlacement({ x: state.textPlacement.x, y: state.textPlacement.y }, { bypass: ev.altKey, siblings: siblingSnapTargets(sideKey(), null), layer: { kind: 'text', scale: state.textPlacement.scale } });
      state.textPlacement.x = sn.x; state.textPlacement.y = sn.y;
      commitTextRotation(sideKey(), getSideTextRotation()); // giữ rotation trong side buffer
      if (sn.snapLabel) updateDragHud({ x: state.textPlacement.x, y: state.textPlacement.y, snapLabel: sn.snapLabel, limitLabel: sn.limitLabel });
      updateDragHud({ x: state.textPlacement.x, y: state.textPlacement.y, snapLabel: sn.snapLabel, limitLabel: sn.limitLabel });
      commitActivePlacements();
      syncPlacementInputs();
      scheduleViewerUpdate();
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      hideSnapGuides(); hideDragHud(); hidePrintBoundary();
      if (moved) {
        endLayerDragPreview();
        pushDesignUndo('text-move');
        renderLayersOverlay();
        showToast(`Đã di chuyển chữ (x:${Math.round(getSideTextPlacement().x)} y:${Math.round(getSideTextPlacement().y)})`, 'info', 1500);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
}


function renderLayerList() {
  const list = document.getElementById('layerList');
  const countTag = document.getElementById('layerCountTag');
  if (!list) return;
  const side = state.currentView;
  const layers = [...sideLayers(side)].sort((a, b) => b.z - a.z);
  // Align tools chỉ có nghĩa khi ≥2 mẫu hiển thị
  const alignTools = document.getElementById('alignTools');
  if (alignTools) alignTools.style.display = layers.filter(l => l.visible !== false && l.url).length >= 2 ? 'flex' : 'none';
  if (countTag) countTag.textContent = layers.length ? `${layers.length} mẫu · ${side === 'back' ? 'mặt sau' : 'mặt trước'}` : '';
  if (!layers.length) {
    list.innerHTML = `<div class="layer-empty">Chưa có mẫu nào ở mặt này. Hãy tạo thiết kế rồi chọn “Thêm vào áo”.</div>`;
    return;
  }
  const selected = getSelectedLayer(side);
  list.innerHTML = layers.map((l, idx) => {
    const op = Math.round(Math.max(0, Math.min(1, Number(l.opacity) || 0)) * 100);
    const locked = l.locked === true;
    const meta = `x:${Math.round(l.x)} y:${Math.round(l.y)} · ${Math.round(l.scale * 100)}%${l.rotation ? ` · ${Math.round(l.rotation)}°` : ''}${l.visible === false ? ' · ẩn' : ''}${op < 100 ? ` · ${op}%` : ''}${locked ? ' · 🔒' : ''}${l.crop ? ' · đã cắt' : ''}`;
    const nameCell = locked
      ? `<div class="layer-name" title="Đang khóa">${escapeHtml((l.name || 'Mẫu').slice(0, 60))}</div>`
      : `<input class="layer-name-input" data-rename="1" value="${escapeAttr(l.name || 'Mẫu')}" maxlength="60" aria-label="Tên mẫu" title="Bấm để đổi tên">`;
    return `
    <div class="layer-row${selected && selected.id === l.id ? ' selected' : ''}${locked ? ' locked' : ''}${l.visible === false ? ' hidden' : ''}" data-layer-id="${escapeAttr(l.id)}">
      <img class="layer-thumb" src="${escapeAttr(l.url)}" alt="" loading="lazy">
      <div class="layer-info">
        ${nameCell}
        <div class="layer-meta">${meta}</div>
      </div>
      <div class="layer-actions">
        <button class="layer-btn" data-action="up" title="Đưa lên trên" ${idx === 0 ? 'disabled' : ''}>▲</button>
        <button class="layer-btn" data-action="down" title="Đưa xuống dưới" ${idx === layers.length - 1 ? 'disabled' : ''}>▼</button>
        <button class="layer-btn" data-action="toggle" title="Ẩn/hiện" aria-pressed="${l.visible === false ? 'true' : 'false'}">${l.visible === false ? '🚫' : '👁'}</button>
        <button class="layer-btn${locked ? ' active' : ''}" data-action="lock" title="${locked ? 'Mở khóa để sửa' : 'Khóa chống sửa/xóa'}" aria-pressed="${locked}">🔒</button>
        <button class="layer-btn${l.flipH ? ' active' : ''}" data-action="flip-h" title="Lật ngang (mirror)">⇋</button>
        <button class="layer-btn${l.flipV ? ' active' : ''}" data-action="flip-v" title="Lật dọc">⇅</button>
        <button class="layer-btn" data-action="duplicate" title="Nhân bản (Ctrl+D)">⧉</button>
        <button class="layer-btn" data-action="replace" title="Thay bằng mẫu mới nhất">⟳</button>
        <button class="layer-btn layer-del" data-action="delete" title="Xóa mẫu" ${locked ? 'disabled title="Đang khóa"' : ''}>✕</button>
      </div>
    </div>`;
  }).join('');
  list.querySelectorAll('.layer-row').forEach(row => {
    const id = row.dataset.layerId;
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-rename]')) return; // đang gõ tên — không select lại
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (!action) {
        selectLayer(side, id);
        refreshSideViews();
        return;
      }
      e.stopPropagation();
      handleLayerAction(side, id, action);
    });
  });
  list.querySelectorAll('input[data-rename]').forEach(inp => {
    inp.addEventListener('change', () => {
      const id = inp.closest('.layer-row')?.dataset.layerId;
      const layer = sideLayers(side).find(l => l.id === id);
      if (!layer) return;
      const name = inp.value.trim().slice(0, 60) || layer.name || 'Mẫu';
      if (name !== layer.name) {
        beginDesignUndoBatch('rename');
        layer.name = name;
        pushDesignUndo('rename');
        showToast('Đã đổi tên mẫu.', 'success', 1400);
      }
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); inp.value = sideLayers(side).find(l => l.id === inp.closest('.layer-row')?.dataset.layerId)?.name || ''; inp.blur(); }
    });
  });
}

async function handleLayerAction(side, id, action) {
  const layers = sideLayers(side);
  const layer = layers.find(l => l.id === id);
  if (layer?.locked && !['toggle', 'lock', 'delete'].includes(action)) {
    showToast('Mẫu đang khóa — mở khóa để chỉnh.', 'warning', 1600);
    return;
  }
  if (action === 'flip-h' || action === 'flip-v') {
    // PRO EDIT: lật non-destructive — chỉ đổi cờ, asset gốc nguyên vẹn.
    // Lật trong Crop Mode không được phép (giống các transform khác).
    if (isCropMode()) return;
    if (layer) {
      beginDesignUndoBatch('flip');
      if (action === 'flip-h') layer.flipH = !layer.flipH;
      else layer.flipV = !layer.flipV;
      pushDesignUndo('flip');
      showToast(layer.flipH !== undefined ? (action === 'flip-h' ? (layer.flipH ? 'Đã lật ngang — bấm lần nữa để lật lại.' : 'Đã lật lại bình thường.') : (layer.flipV ? 'Đã lật dọc — bấm lần nữa để lật lại.' : 'Đã lật lại bình thường.')) : '', 'success', 1500);
    }
  } else if (action === 'delete') {
    removeLayerWithUndo(side, id);
  } else if (action === 'duplicate') {
    duplicateLayer(side, id);
    return; // tự refresh
  } else if (action === 'lock') {
    beginDesignUndoBatch('lock');
    if (layer) layer.locked = !layer.locked;
    pushDesignUndo('lock');
    showToast(layer?.locked ? 'Đã khóa mẫu — chống sửa/xóa nhầm.' : 'Đã mở khóa mẫu.', 'info', 1600);
  } else if (action === 'toggle') {
    beginDesignUndoBatch('visibility');
    if (layer) layer.visible = layer.visible === false ? true : false;
    pushDesignUndo('visibility');
  } else if (action === 'up') {
    beginDesignUndoBatch('reorder');
    moveLayerZ(side, id, +1);
    pushDesignUndo('reorder');
  } else if (action === 'down') {
    beginDesignUndoBatch('reorder');
    moveLayerZ(side, id, -1);
    pushDesignUndo('reorder');
  } else if (action === 'replace') {
    const fresh = state.lastGenerated[side === 'back' ? 'back' : 'front'];
    if (!fresh) {
      showToast('Chưa có mẫu mới nào. Hãy bấm “Tạo Design” trước.', 'warning');
      return;
    }
    if (layer) {
      beginDesignUndoBatch('replace');
      layer.url = fresh;
      layer.designId = state.currentDesign?.designId || layer.designId;
      pushDesignUndo('replace');
      showToast('Đã thay mẫu đang chọn bằng mẫu mới nhất — cùng layer, không rác.', 'success', 2000);
    }
  } else {
    selectLayer(side, id);
  }
  if (!getSelectedLayer(side) && sideLayers(side).length) {
    selectLayer(side, sideLayers(side).sort((a, b) => b.z - a.z)[0].id);
  }
  await refreshSideViews();
}

function updateOverlayPlacement() {
  const overlay = document.getElementById('mockupDesign');
  if (!overlay) return;
  const ip = state.printPlacement || { x: 0, y: -12, scale: 1 };
  const tp = state.textPlacement || { x: 0, y: 18, scale: 1 };
  overlay.style.setProperty('--print-x', `${ip.x}%`);
  overlay.style.setProperty('--print-y', `${ip.y}%`);
  overlay.style.setProperty('--print-scale', String(ip.scale));
  overlay.style.setProperty('--text-x', `${tp.x}%`);
  overlay.style.setProperty('--text-y', `${tp.y}%`);
  overlay.style.setProperty('--text-scale', String(tp.scale));
  overlay.style.setProperty('--text-rot', `${Number(tp.rotation) || 0}deg`);
}

function updateThreeTexture() {
  // Debounced: rebuilds the side composite and pushes it to the 3D decal.
  // Cache + viewer guards make no-op updates cheap.
  scheduleViewerUpdate();
}

/* PHASE 3: token chống stale-callback — khi 2 apply chạy song song (throttle tick
   trộn với commit pointerup), call cũ hoàn thành SAU không được ghi đè decal
   bằng composite cũ. Call mới nhất luôn thắng. */
let viewerApplyToken = 0;
async function applyCurrentDesignToViewer() {
  const myToken = ++viewerApplyToken;
  // The side composites (all visible layers + text per side) are the images
  // the 3D decals show — 2D and 3D always agree. Front và BACK là 2 decal
  // độc lập; mặt không có thiết kế truyền null (không in).
  const vd = await getCompositeDesignsForViewer();
  if (myToken !== viewerApplyToken) return; // stale — một call mới hơn đang sở hữu viewer
  const activeComposite = state.currentView === 'back' ? (vd.back || vd.front) : (vd.front || vd.back);
  state.printDesignUrl = activeComposite || '';
  try {
    if (window.tshirt360Viewer?.setDesigns) {
      window.tshirt360Viewer.setDesigns({ front: vd.front || null, back: vd.back || null });
    } else {
      window.tshirt360Viewer?.setDesign?.(activeComposite || null);
    }
  } catch (e) { /* */ }
  updateOverlayPlacement();
}

function setInteractionMode(mode = 'position') {
  state.interactionMode = mode === 'rotate' ? 'rotate' : 'position';
  document.getElementById('placementModeBtn')?.classList.toggle('active', state.interactionMode === 'position');
  document.getElementById('rotateModeBtn')?.classList.toggle('active', state.interactionMode === 'rotate');
  const viewer = document.getElementById('canvasViewer');
  viewer?.classList.toggle('interaction-position', state.interactionMode === 'position');
  viewer?.classList.toggle('interaction-rotate', state.interactionMode === 'rotate');
  try { window.tshirt360Viewer?.setInteractionMode?.(state.interactionMode); } catch (e) { /* */ }
  if (state.currentDesign || state.printDesignUrl || getSideCustomText()) applyCurrentDesignToViewer();
}

function setActivePlacementLayer(layer = 'image') { state.activePlacementLayer = layer === 'text' ? 'text' : 'image'; updateOverlayPlacement(); updateSideBadge(); }

/* ============================================================
   PRINT PRESETS (vị trí & kích thước in)
   ============================================================ */
const PRINT_POSITION_PRESETS = {
  chest:      { x: 0,   y: -12, scale: 1,    label: 'Giữa ngực' },
  'chest-left':  { x: -30, y: -16, scale: 0.85, label: 'Ngực trái' },
  'chest-right': { x: 30,  y: -16, scale: 0.85, label: 'Ngực phải' },
  back:       { x: 0,   y: -26, scale: 1.1,  label: 'Lưng trên' },
  stomach:    { x: 0,   y: 14,  scale: 0.9,  label: 'Bụng' },
};

const PRINT_SIZE_PRESETS = {
  small:  { scale: 0.8,  label: 'Nhỏ' },
  medium: { scale: 1,    label: 'Trung bình' },
  large:  { scale: 1.3,  label: 'Lớn' },
  xl:     { scale: 1.6,  label: 'Rất lớn' },
};

function requireSelectedLayer() {
  const sel = getSelectedLayer();
  if (!sel) {
    showToast('Hãy chọn một mẫu trên áo trước (bấm vào mẫu hoặc trong danh sách lớp).', 'warning');
    return null;
  }
  return sel;
}

function applyPrintPositionPreset(key) {
  if (isCropMode()) return; // CROP MODE: preset position không tác dụng
  const presetDef = PRINT_POSITION_PRESETS[key];
  if (!presetDef) return;
  const sel = requireSelectedLayer();
  if (!sel) return;
  if (sel.locked) { showToast(`"${sel.name || 'Mẫu'}" đang khóa — mở khóa để chỉnh.`, 'warning', 1600); return; }
  sel.x = presetDef.x; sel.y = presetDef.y; sel.scale = presetDef.scale;
  state.printPlacement = { x: sel.x, y: sel.y, scale: sel.scale };
  commitActivePlacements();
  syncPlacementInputs();
  refreshSideViews();
  syncPresetChips();
}

function applyPrintSizePreset(key) {
  if (isCropMode()) return; // CROP MODE: preset size không tác dụng
  const preset = PRINT_SIZE_PRESETS[key];
  if (!preset) return;
  const sel = requireSelectedLayer();
  if (!sel) return;
  sel.scale = preset.scale;
  state.printPlacement = { x: sel.x, y: sel.y, scale: sel.scale };
  commitActivePlacements();
  syncPlacementInputs();
  refreshSideViews();
  syncPresetChips();
}

function applyRotationToSelected(deg) {
  const sel = requireSelectedLayer();
  if (!sel) return;
  sel.rotation = clampNum(deg, ...LAYER_BOUNDS.rotation);
  commitActivePlacements();
  syncPlacementInputs();
  refreshSideViews();
}

function syncPresetChips() {
  const ip = selectedLayerPlacement();
  let posKey = '';
  for (const [k, v] of Object.entries(PRINT_POSITION_PRESETS)) {
    if (Math.abs(v.x - ip.x) <= 3 && Math.abs(v.y - ip.y) <= 3 && Math.abs(v.scale - ip.scale) <= 0.08) { posKey = k; break; }
  }
  document.querySelectorAll('#printPositionPresets .placement-preset-btn').forEach(btn => {
    btn.classList.toggle('active', posKey === btn.dataset.pp);
  });

  let sizeKey = '';
  for (const [k, v] of Object.entries(PRINT_SIZE_PRESETS)) {
    if (Math.abs(v.scale - ip.scale) <= 0.08) { sizeKey = k; break; }
  }
  document.querySelectorAll('#printSizePresets .placement-preset-btn').forEach(btn => {
    btn.classList.toggle('active', sizeKey === btn.dataset.ps);
  });
}

function initPrintPresets() {
  document.querySelectorAll('#printPositionPresets .placement-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => applyPrintPositionPreset(btn.dataset.pp));
  });
  document.querySelectorAll('#printSizePresets .placement-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => applyPrintSizePreset(btn.dataset.ps));
  });
}

function selectedLayerPlacement(side = state.currentView) {
  const sel = getSelectedLayer(side);
  return sel ? { x: sel.x, y: sel.y, scale: sel.scale } : getSidePrintPlacement(side);
}

function getPrintPositionLabel(side = state.currentView) {
  const ip = selectedLayerPlacement(side);
  for (const [k, v] of Object.entries(PRINT_POSITION_PRESETS)) {
    if (Math.abs(v.x - ip.x) <= 3 && Math.abs(v.y - ip.y) <= 3 && Math.abs(v.scale - ip.scale) <= 0.08) return v.label;
  }
  return 'Tùy chỉnh';
}

function getPrintSizeLabel(side = state.currentView) {
  const ip = selectedLayerPlacement(side);
  for (const [k, v] of Object.entries(PRINT_SIZE_PRESETS)) {
    if (Math.abs(v.scale - ip.scale) <= 0.08) return v.label;
  }
  return `~${Math.round(ip.scale * 100)}%`;
}

/* ============================================================
   PRINT PREVIEW (In / Lưu PDF)
   ============================================================ */
function buildMockupSvg(hex) {
  const c = hex || '#ffffff', light = isLightColor(c);
  const sc = light ? '#ddd' : 'rgba(255,255,255,0.2)';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 360"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${lightenColor(c, 10)}"/><stop offset="100%" stop-color="${darkenColor(c, 10)}"/></linearGradient></defs><path d="M75 50 L30 80 L10 140 L55 150 L65 100 L65 330 L235 330 L235 100 L245 150 L290 140 L270 80 L225 50 L195 65 Q175 80 150 80 Q125 80 105 65 Z" fill="url(#g)" stroke="${sc}" stroke-width="1"/><ellipse cx="150" cy="52" rx="30" ry="15" fill="none" stroke="${sc}" stroke-width="1"/></svg>`;
}

function buildPrintSheetMockup(printUrl) {
  return new Promise(async (resolve) => {
    const w = 600, h = 720;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');

    const shirt = new Image();
    shirt.crossOrigin = 'anonymous';
    shirt.onload = async () => {
      ctx.drawImage(shirt, 0, 0, w, h);
      if (printUrl) {
        try {
          const print = await loadImageForCanvas(printUrl);
          if (print) {
            const side = Math.min(w * 0.86, h * 0.78);
            ctx.drawImage(print, (w - side) / 2, (h * 0.42) - side / 2, side, side);
          }
        } catch (e) { console.warn('Print sheet composite error:', e); }
      }
      resolve(canvas.toDataURL('image/png'));
    };
    shirt.onerror = () => resolve('');
    shirt.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(buildMockupSvg(state.selectedColor));
  });
}

async function openPrintPreview() {
  const modal = document.getElementById('printPreviewModal');
  if (!modal) return;
  if (!state.currentDesign && !getActiveDesignUrl()) return;

  commitActivePlacements();
  const frontUrl = await buildSideComposite('front');
  const hasBack = hasBackContent();
  if (!frontUrl && !hasBack) return;

  document.getElementById('printSheetDate').textContent = new Date().toLocaleString('vi-VN');

  const product = PRODUCT_LABELS[state.selectedProductType] || 'T-Shirt Custom AI';
  const price = PRODUCT_PRICES[state.selectedProductType] || 250000;
  const colorNames = { '#ffffff': 'Trắng', '#000000': 'Đen', '#1e293b': 'Navy', '#6b7280': 'Xám', '#dc2626': 'Đỏ', '#2563eb': 'Xanh', '#059669': 'Xanh lá' };
  document.getElementById('psProduct').textContent = product;
  document.getElementById('psColor').textContent = colorNames[state.selectedColor] || state.selectedColor;
  document.getElementById('psSize').textContent = state.selectedSize;
  document.getElementById('psQty').textContent = state.quantity;
  document.getElementById('psPosition').textContent = getPrintPositionLabel('front');
  document.getElementById('psPrintSize').textContent = getPrintSizeLabel('front');
  const backRow = document.getElementById('psPositionBackRow');
  if (backRow) {
    backRow.style.display = hasBack ? '' : 'none';
    const lbl = document.getElementById('psPositionBack');
    if (lbl) lbl.textContent = hasBack ? `${getPrintPositionLabel('back')} · ${getPrintSizeLabel('back')}` : '';
  }
  document.getElementById('psTotal').textContent = formatPrice(price * state.quantity);

  const thumb = document.getElementById('printSheetDesign');
  if (thumb) {
    if (frontUrl) { thumb.style.visibility = ''; thumb.src = frontUrl; }
    else { thumb.removeAttribute('src'); thumb.style.visibility = 'hidden'; }
  }

  const frontSheet = await buildPrintSheetMockup(frontUrl || null);
  const frontImg = document.getElementById('printSheetMockup');
  if (frontImg) {
    if (frontSheet) { frontImg.style.visibility = ''; frontImg.src = frontSheet; }
    else { frontImg.removeAttribute('src'); frontImg.style.visibility = 'hidden'; }
  }

  const backBox = document.getElementById('printSheetBack');
  if (hasBack && backBox) {
    const backComposite = await buildSideComposite('back');
    const backSheet = await buildPrintSheetMockup(backComposite || null);
    const backImg = backBox.querySelector('img');
    if (backImg) {
      if (backSheet) { backImg.style.visibility = ''; backImg.src = backSheet; }
      else { backImg.removeAttribute('src'); backImg.style.visibility = 'hidden'; }
    }
    backBox.style.display = '';
  } else if (backBox) {
    backBox.style.display = 'none';
  }
  if (backBox) {
    const cap = backBox.querySelector('.print-mockup-caption');
    if (cap) cap.textContent = hasBackContent() ? 'Mặt sau' : 'Mặt sau (trống)';
  }

  modal.classList.add('active');
  document.body.classList.add('print-preview-open');
}

function closePrintPreview() {
  const modal = document.getElementById('printPreviewModal');
  if (modal) modal.classList.remove('active');
  document.body.classList.remove('print-preview-open');
}

function initPrintPreview() {
  document.getElementById('printPreviewBtn')?.addEventListener('click', openPrintPreview);
  document.getElementById('printPdfBtn')?.addEventListener('click', () => window.print());
  document.getElementById('printPreviewClose')?.addEventListener('click', closePrintPreview);
  const modal = document.getElementById('printPreviewModal');
  modal?.addEventListener('click', e => { if (e.target === modal) closePrintPreview(); });
}

/* ============================================================
   MOCKUP SVG & COLOR
   ============================================================ */
function updateMockupColor() {
  const mockup = document.getElementById('mockupTshirt');
  if (!mockup) return;
  mockup.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(buildMockupSvg(state.selectedColor));
  updateThreeTexture();
  try { window.tshirt360Viewer?.setColor?.(state.selectedColor); } catch (e) { /* */ }
}

/* ============================================================
   MOCK DESIGN (SVG fallback)
   ============================================================ */
function generateMockDesign(style, prompt) {
  const palettes = [
    ['#e05a24', '#8f93f2', '#e9b55c'],
    ['#ff4444', '#222222', '#f5f5f5'],
    ['#00cc88', '#0a0a0a', '#ffffff'],
    ['#cc44ff', '#111111', '#ffaa44'],
  ];
  const pal = palettes[Math.floor(Math.random() * palettes.length)];
  const words = String(prompt || 'DESIGN').split(/\s+/).slice(0, 3);
  const lines = [];
  for (let i = 0; i < words.length; i++) {
    lines.push(`<text x="512" y="${400 + i * 70}" text-anchor="middle" font-family="Outfit,Arial,sans-serif" font-size="${40 + i * 4}" font-weight="800" fill="${pal[i % pal.length]}">${escapeHtml(words[i])}</text>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#111" rx="16"/><circle cx="512" cy="340" r="90" fill="none" stroke="${pal[0]}" stroke-width="3" stroke-dasharray="6,4" opacity="0.5"/><circle cx="512" cy="340" r="60" fill="${pal[0]}" opacity="0.12"/>${lines.join('')}</svg>`;
  return { success: true, designId: 'draft-' + Date.now(), designUrl: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), prompt, style, author: 'AI Draft', isDraft: true };
}

/* ============================================================
   SHOW DESIGN ON MOCKUP
   ============================================================ */
async function showDesignOnMockup(designUrl, productMockupUrl, productMockupBlank, targetSide, meta = {}) {
  const viewer = document.getElementById('canvasViewer');
  const empty = document.getElementById('canvasEmpty');
  if (viewer) viewer.style.display = 'flex';
  if (empty) empty.style.display = 'none';

  // ADDITIVE: a new design becomes a new layer — existing layers are kept.
  // (This fixes generate-B-wipes-A.) Returns the created layer (or null).
  let created = null;
  if (designUrl) {
    const side = targetSide === 'back' ? 'back' : state.currentView;
    created = addLayer(side, {
      url: designUrl,
      name: meta.name,
      designId: meta.designId || state.currentDesign?.designId || null,
      prompt: meta.prompt || state.currentDesign?.prompt || '',
      style: meta.style || state.currentDesign?.style || state.selectedStyle,
    });
  }

  await refreshSideViews();
  document.getElementById('placementPanel')?.style && (document.getElementById('placementPanel').style.display = 'block');
  updatePrice();
  updateActionButtons(true);
  updateSideBadge();
  updateBackDesignControls();
  // Stage 4+5 choreography (REAL state only: a layer was actually created).
  if (created) announceFreshResult();
  return created;
}

/* Stage 4 (result blur-in) + Stage 5 (actions stagger) — presentation only.
   Fires only when a design truly landed on the canvas. Skipped entirely
   under prefers-reduced-motion. Never touches generation/3D logic. */
function announceFreshResult() {
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const stage = document.querySelector('.studio-canvas') || document.getElementById('canvasViewer');
    const actions = document.querySelector('.actions-section');
    if (stage) {
      stage.classList.remove('result-fresh');
      void stage.offsetWidth; // restart the one-shot animation
      stage.classList.add('result-fresh');
      window.setTimeout(() => stage.classList.remove('result-fresh'), 800);
    }
    if (actions) {
      actions.classList.remove('actions-fresh');
      void actions.offsetWidth;
      actions.classList.add('actions-fresh');
      window.setTimeout(() => actions.classList.remove('actions-fresh'), 900);
    }
  } catch { /* choreography must never break functionality */ }
}

/* ============================================================
   PROMPT PER-SIDE — front/back là 2 prompt độc lập.
   promptInput luôn mirror sidePrompts[promptSide]; switching side
   lưu text hiện tại rồi nạp text của side mới.
   ============================================================ */
function currentPromptSide() { return state.promptSide === 'back' ? 'back' : 'front'; }

// Swap textarea content between side prompts (single source of the swap logic).
function switchPromptSide(side) {
  const next = side === 'back' ? 'back' : 'front';
  const cur = currentPromptSide();
  if (next === cur) return;
  const input = document.getElementById('promptInput');
  if (input) {
    state.sidePrompts[cur] = input.value;
    // Cập nhật state.promptSide TRƯỚC khi dispatch 'input' — nếu không,
    // listener mirror sẽ ghi text mới vào side CŨ và xoá prompt của nó.
    state.promptSide = next;
    input.value = state.sidePrompts[next] || '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    state.promptSide = next;
  }
  document.querySelectorAll('.prompt-side-btn').forEach(btn => {
    const on = btn.dataset.side === next;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  updatePromptCount();
}

/* ============================================================
   SPLIT PROMPT — prompt tổng nhắc cả 2 mặt.
   "con chó mặt trước, con mèo mặt sau" → { front: 'con chó', back: 'con mèo' }.
   Phân đoạn bằng dấu phẩy/xa hàng dòng; mỗi segment nhận diện mặt bằng từ
   khóa 'mặt trước/front', 'mặt sau/back'. Segment không nhắc mặt → null
   (áp dụng cho mặt đang soạn, không tự đoán). Trả về null nếu prompt
   KHÔNG phải dạng 2-mặt (không đổi hành vi hiện tại).
   ============================================================ */
function splitDualSidePrompt(rawPrompt) {
  const text = String(rawPrompt || '').trim();
  if (!text) return null;
  const FRONT_RE = /(?:mặt\s*trước|mat\s*truoc|front(?:\s*side)?)/i;
  const BACK_RE = /(?:mặt\s*sau|mat\s*sau|back(?:\s*side)?)/i;
  const segments = text.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
  if (segments.length < 2) return null;
  // Từ thừa sau khi bỏ keyword mặt: "mặt trước áo" → bỏ nốt "áo".
  const stripGarment = s => s.replace(/^(?:trên\s*|của\s*)?(?:áo\s*|ao\s*|shirt\s*|t-?shirt\s*)?/i, '').replace(/\s*(?:áo|ao)$/i, '').replace(/^[\s:：-]+/, '').trim();
  const frontSegs = [];
  const backSegs = [];
  let untagged = [];
  for (const seg of segments) {
    const isF = FRONT_RE.test(seg);
    const isB = BACK_RE.test(seg);
    if (isF && !isB) frontSegs.push(stripGarment(seg.replace(FRONT_RE, '')));
    else if (isB && !isF) backSegs.push(stripGarment(seg.replace(BACK_RE, '')));
    else untagged.push(seg);
  }
  // Chỉ coi là prompt 2-mặt khi CẢ front VÀ back được nhắc tường minh.
  if (!frontSegs.length || !backSegs.length) return null;
  // Segment không nhắc mặt (vd câu mô tả chung) → ghép vào cả hai.
  const joinSegs = arr => arr.filter(Boolean).join(', ').trim();
  const extra = untagged.filter(Boolean);
  const front = joinSegs([...frontSegs, ...extra]);
  const back = joinSegs([...backSegs, ...extra]);
  if (!front || !back) return null;
  return { front, back };
}

function updatePromptCount() {
  const count = document.getElementById('promptCount');
  const input = document.getElementById('promptInput');  
  if (count && input) count.textContent = `${input.value.length} / ${HARDEN_LIMITS.promptMax}`;
}

function initPromptSideSwitch() {
  document.querySelectorAll('.prompt-side-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const side = btn.dataset.side === 'back' ? 'back' : 'front';
      if (side === currentPromptSide()) return;
      switchPromptSide(side);
      // Soạn prompt cho mặt nào → khung nhìn áo chuyển sang mặt đó.
      setViewerSide(side);
      showToast(`Đang soạn prompt cho ${side === 'back' ? 'MẶT SAU' : 'MẶT TRƯỚC'}.`, 'info', 1800);
      const pi = document.getElementById('promptInput');
      if (pi) { pi.focus(); }
    });
  });
  // Mirror typing → sidePrompts (realtime) và đếm ký tự (gap cũ: promptCount không update).
  const input = document.getElementById('promptInput');
  if (input) {
    input.addEventListener('input', () => {
      state.sidePrompts[currentPromptSide()] = input.value;
      updatePromptCount();
    });
  }
}

/* ============================================================
   TAB SWITCHING
   ============================================================ */
function initTabs() {
  document.querySelectorAll('.toolbar-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.toolbar-tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      const panel = document.querySelector(`.tab-panel[data-panel="${tab.dataset.tab}"]`);
      if (panel) panel.classList.add('active');
    });
  });
}

/* ============================================================
   STYLE SELECTOR
   ============================================================ */
function initStyleSelector() {
  document.querySelectorAll('.style-chip').forEach(btn => {
    if (!btn.hasAttribute('aria-pressed')) btn.setAttribute('aria-pressed', btn.classList.contains('active') ? 'true' : 'false');
    btn.addEventListener('click', () => {
      document.querySelectorAll('.style-chip').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      state.selectedStyle = btn.dataset.style;
    });
  });
}

/* ============================================================
   IMAGE UPLOAD
   ============================================================ */
function initUpload() {
  const dropzone = document.getElementById('uploadDropzone');
  const fileInput = document.getElementById('imageUpload');
  const preview = document.getElementById('uploadPreview');
  const previewImg = document.getElementById('uploadPreviewImg');
  const removeBtn = document.getElementById('removeUpload');
  const placeBtn = document.getElementById('placeUploadBtn');
  const uploadModeAsset = document.getElementById('uploadModeAsset');
  const uploadModeReference = document.getElementById('uploadModeReference');
  if (!dropzone || !fileInput) return;

  // A11y: make dropzone focusable and operable via keyboard
  if (!dropzone.hasAttribute('tabindex')) dropzone.setAttribute('tabindex', '0');
  dropzone.setAttribute('role', 'button');
  dropzone.setAttribute('aria-label', 'Upload ảnh');

  let dragCounter = 0;
  let errorTimer = null;

  function setIdle() {
    dropzone.classList.remove('is-dragging', 'dragover', 'is-error', 'shake');
    dropzone.style.willChange = '';
    preview.classList.remove('entering', 'leaving');
  }

  function showError(msg) {
    if (window.showToast) window.showToast(msg, 'warning');
    dropzone.classList.add('is-error', 'shake');
    dropzone.classList.remove('is-dragging');
    clearTimeout(errorTimer);
    dropzone.addEventListener('animationend', function handler(e){
      if(e.animationName === 'shakeX'){
        dropzone.classList.remove('shake', 'is-error');
        dropzone.removeEventListener('animationend', handler);
      }
    });
    errorTimer = setTimeout(()=> {
      dropzone.classList.remove('shake', 'is-error');
    }, 600);
  }

  function showPreview(file) {
    const reader = new FileReader();
    reader.onload = e => {
      previewImg.style.visibility = '';
      previewImg.removeAttribute('hidden');
      previewImg.src = e.target.result;
      state.uploadedFilePreviewUrl = e.target.result;
      preview.style.display = 'block';
      dropzone.style.display = 'none';
      // Sprint 1: preview scale .88 → 1
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!reduce) {
        preview.classList.remove('leaving');
        preview.classList.add('entering');
        preview.style.willChange = 'transform, opacity';
        preview.addEventListener('animationend', function h(){
          preview.classList.remove('entering');
          preview.style.willChange = '';
          preview.removeEventListener('animationend', h);
        });
      }
    };
    reader.readAsDataURL(file);
  }

  function getCurrentUploadMode() {
    return uploadModeReference?.checked ? 'reference' : 'asset';
  }

  async function uploadFileToServer(file, kind) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('kind', kind);
    const res = await fetch(`${API_BASE}/assets/upload`, {
      method: 'POST',
      headers: { Authorization: auth.token ? `Bearer ${auth.token}` : '' },
      body: formData,
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Upload failed');
    return data.asset;
  }

  async function handleFile(file) {
    if (!file.type.startsWith('image/')) { showError('Chỉ chấp nhận file ảnh!'); return; }
    if (file.size > 10 * 1024 * 1024) { showError('File quá lớn (tối đa 10MB)!'); return; }
    
    state.uploadedFile = file;
    dropzone.classList.remove('is-dragging', 'dragover');
    dropzone.style.willChange = '';
    showPreview(file);

    // For asset mode: upload to server immediately to get assetId
    const mode = getCurrentUploadMode();
    if (mode === 'asset') {
      try {
        placeBtn.disabled = true;
        placeBtn.innerHTML = '<span class="generate-btn-spinner"></span><span>Đang tải...</span>';
        const asset = await uploadFileToServer(file, 'asset');
        // Store asset in library for later placement
        if (!state.assetLibrary) state.assetLibrary = [];
        state.assetLibrary.unshift(asset);
        placeBtn.disabled = false;
        placeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><span>Đặt lên áo</span>';
        if (window.showToast) window.showToast('Ảnh đã sẵn sàng. Bấm "Đặt lên áo" để thêm vào thiết kế.', 'success');
      } catch (err) {
        placeBtn.disabled = false;
        placeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><span>Đặt lên áo</span>';
        if (window.showToast) window.showToast(err.message || 'Tải ảnh thất bại', 'error');
      }
    } else {
      // Reference mode: just show preview, upload happens when generating
      placeBtn.style.display = 'none';
      if (window.showToast) window.showToast('Chế độ tham chiếu AI. Bấm "Tạo Design" để sinh thiết kế từ ảnh này.', 'info');
    }
  }

  // Click / keyboard
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });

  // Drag state machine: IDLE ↔ DRAGGING
  dropzone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    dropzone.classList.add('is-dragging');
    dropzone.style.willChange = 'transform';
  });
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!dropzone.classList.contains('is-dragging')) {
      dropzone.classList.add('is-dragging');
    }
  });
  dropzone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter = Math.max(0, dragCounter - 1);
    if (dragCounter === 0) {
      dropzone.classList.remove('is-dragging');
      dropzone.style.willChange = '';
    }
  });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropzone.classList.remove('is-dragging', 'dragover');
    dropzone.style.willChange = '';
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  // File picker
  fileInput.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });

  /* PRO UPLOAD: KÉO FILE THẲNG LÊN ÁO → đặt lên áo NGAY (không qua panel
     upload 2 bước). Drop lên khung 3D/2D = upload + place + select tức thì.
     Giữ nguyên dropzone cũ cho người thích quy trình xem trước. */
  const canvasHost = document.getElementById('canvasViewer');
  if (canvasHost && !canvasHost.dataset.fileDropWired) {
    canvasHost.dataset.fileDropWired = '1';
    let dropDepth = 0;
    const overlayEl = document.createElement('div');
    overlayEl.className = 'canvas-drop-overlay'; // mặc định display:none (CSS)
    overlayEl.innerHTML = '<div class="canvas-drop-hint">📥 Thả ảnh để in lên áo</div>';
    canvasHost.appendChild(overlayEl);
    /* WATCHDOG — overlay chỉ được sống KHI ĐANG KÉO FILE. Kéo file rồi hủy
       giữa chừng (Esc, rê ra ngoài cửa sổ, hủy trên OS) → dragleave có thể
       KHÔNG bắn → overlay treo che hết vùng sửa (bug user báo). Giờ: mọi
       lần hiện đều đặt hẹn giờ tự hủy 6s; MỌI dragover tiếp tục (bắn liên
       tục trong lúc kéo thật) đều gia hạn — kéo thật không bao giờ bị tắt
       giữa chừng (6s >> khoảng cách 2 dragover), hủy thật thì overlay tự
       tháo sau tối đa 6s. Thêm dragend + window blur để tắt ngay khi có thể. */
    let dropWatchdog = null;
    const hideDropOverlay = () => {
      dropDepth = 0;
      overlayEl.classList.remove('is-active');
      if (dropWatchdog) { clearTimeout(dropWatchdog); dropWatchdog = null; }
    };
    const showDropOverlay = () => {
      overlayEl.classList.add('is-active');
      if (dropWatchdog) clearTimeout(dropWatchdog);
      dropWatchdog = setTimeout(hideDropOverlay, 6000); // tự-vệ: không bao giờ kẹt
    };
    canvasHost.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
      dropDepth++;
      showDropOverlay();
    });
    canvasHost.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
      showDropOverlay(); // gia hạn watchdog — kéo thật luôn còn sống
    });
    canvasHost.addEventListener('dragleave', () => {
      dropDepth = Math.max(0, dropDepth - 1);
      if (dropDepth === 0) hideDropOverlay();
    });
    window.addEventListener('dragend', hideDropOverlay);
    window.addEventListener('blur', hideDropOverlay);
    canvasHost.addEventListener('drop', async (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
      hideDropOverlay();
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) { showToast('Chỉ chấp nhận file ảnh!', 'warning'); return; }
      if (file.size > 10 * 1024 * 1024) { showToast('File quá lớn (tối đa 10MB)!', 'warning'); return; }
      try {
        showToast('Đang tải ảnh lên…', 'info', 2000);
        const asset = await uploadFileToServer(file, 'asset');
        if (!state.assetLibrary) state.assetLibrary = [];
        state.assetLibrary.unshift(asset);
        const layer = placeUploadedAsset(asset.assetId);
        if (layer) {
          state.activePlacementLayer = 'image';
          refreshSelectionFrameSoon();
          showToast(`Đã đặt "${asset.name || 'ảnh'}" lên áo — kéo thẳng để chỉnh.`, 'success', 2400);
        }
      } catch (err) {
        showToast(err.message || 'Tải ảnh thất bại', 'error');
      }
    });
  }

  // Mode radio change
  if (uploadModeAsset && uploadModeReference) {
    const updateModeUI = () => {
      const mode = getCurrentUploadMode();
      if (mode === 'asset') {
        placeBtn.style.display = '';
        placeBtn.textContent = 'Đặt lên áo';
      } else {
        placeBtn.style.display = 'none';
      }
    };
    uploadModeAsset.addEventListener('change', updateModeUI);
    uploadModeReference.addEventListener('change', updateModeUI);
    updateModeUI();
  }

  // Broken preview file (e.g. corrupt data URL): fall back to dropzone, never a broken box
  previewImg?.addEventListener('error', () => {
    state.uploadedFile = null;
    try { previewImg.removeAttribute('src'); } catch {}
    preview.style.display = 'none';
    dropzone.style.display = 'flex';
    setIdle();
    if (window.showToast) window.showToast('Không đọc được ảnh này. Hãy thử file PNG/JPG/WEBP/GIF khác.', 'warning');
  });

  // Place on shirt button
  if (placeBtn) {
    placeBtn.addEventListener('click', async () => {
      if (!state.uploadedFile) return;
      const mode = getCurrentUploadMode();
      if (mode !== 'asset') return;
      
      // Find the asset in library (most recent upload)
      const asset = state.assetLibrary?.find(a => a.url === state.uploadedFilePreviewUrl || a.name === state.uploadedFile.name);
      if (asset) {
        placeUploadedAsset(asset.assetId);
      }
      // Clear upload state
      removeBtn?.click();
    });
  }

  // Remove → IDLE with fade out
  if (removeBtn) removeBtn.addEventListener('click', () => {
    state.uploadedFile = null;
    state.uploadedFilePreviewUrl = null;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce && preview.style.display !== 'none') {
      preview.classList.add('leaving');
      preview.style.willChange = 'transform, opacity';
      preview.addEventListener('animationend', function h(){
        preview.style.display = 'none';
        preview.classList.remove('leaving', 'entering');
        preview.style.willChange = '';
        dropzone.style.display = 'flex';
        placeBtn.style.display = 'none';
        setIdle();
        preview.removeEventListener('animationend', h);
      }, {once:true});
    } else {
      preview.style.display = 'none';
      dropzone.style.display = 'flex';
      placeBtn.style.display = 'none';
      setIdle();
    }
    fileInput.value = '';
  });
}

/* ============================================================
   COLOR PICKER
   ============================================================ */
function initColorPicker() {
  const options = document.getElementById('colorOptions');
  if (!options) return;
  options.querySelectorAll('.color-dot').forEach(btn => {
    btn.addEventListener('click', () => {
      options.querySelectorAll('.color-dot').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      state.selectedColor = btn.dataset.color;
      updateMockupColor();
    });
  });
}

/* ============================================================
   PRODUCT TYPE SELECTOR
   ============================================================ */
function syncProductAvailabilityBadges(retries = 10) {
  const viewer = window.tshirt360Viewer;
  if (!viewer?.getRegistry) {
    // tshirt-360.js is an ES module (deferred) and may initialize after this
    // classic script. Retry briefly; badges are UX-only, never blocking.
    if (retries > 0) setTimeout(() => syncProductAvailabilityBadges(retries - 1), 500);
    return;
  }
  viewer.getRegistry().forEach((g) => {
    const btn = document.querySelector(`.product-type-btn[data-product-type="${g.id}"]`);
    if (!btn) return;
    btn.classList.toggle('product-3d-missing', !g.available3D);
    if (!g.available3D && !btn.querySelector('.product-3d-badge')) {
      const badge = document.createElement('span');
      badge.className = 'product-3d-badge';
      badge.textContent = '3D sắp có';
      btn.appendChild(badge);
    }
    if (g.available3D) btn.querySelector('.product-3d-badge')?.remove();
  });
}

function initProductTypeSelector() {
  const options = document.getElementById('productTypeOptions');
  if (!options) return;
  syncProductAvailabilityBadges();
  options.querySelectorAll('.product-type-btn').forEach(btn => {
    if (!btn.hasAttribute('aria-pressed')) btn.setAttribute('aria-pressed', btn.classList.contains('active') ? 'true' : 'false');
    btn.addEventListener('click', () => {
      const pt = btn.dataset.productType;
      if (!PRODUCT_PRICES[pt] || pt === state.selectedProductType) return;
      state.selectedProductType = pt;
      options.querySelectorAll('.product-type-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      updatePrice();
      updateMockupColor();
      // 3D model switch is registry-driven. Unavailable garments (no real
      // asset yet) NEVER fall back to another garment's model — the viewer
      // enters a controlled unavailable state and the 2D preview stays.
      try {
        const result = window.tshirt360Viewer?.setProduct?.(pt);
        if (result && result.status === 'unavailable') {
          const label = pt === 'hoodie' ? 'Hoodie' : pt === 'polo' ? 'Polo' : pt;
          showToast(`Mẫu 3D ${label} đang được bổ sung — bạn vẫn xem trước 2D và đặt hàng bình thường.`, 'info', 5000);
        }
      } catch (e) { /* 3D optional; 2D preview continues */ }
      if (state.currentDesign?.designUrl) applyCurrentDesignToViewer();
    });
  });
}

/* ============================================================
   SIZE SELECTOR
   ============================================================ */
function initSizeSelector() {
  const options = document.getElementById('sizeOptions');
  if (!options) return;
  options.querySelectorAll('.size-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      options.querySelectorAll('.size-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      state.selectedSize = btn.dataset.size;
    });
  });
}

/* ============================================================
   QUANTITY
   ============================================================ */
function initQuantity() {
  const minus = document.getElementById('qtyMinus');
  const plus = document.getElementById('qtyPlus');
  const display = document.getElementById('qtyValue');
  if (!minus || !plus || !display) return;
  const render = () => {
    state.quantity = Math.min(HARDEN_LIMITS.qtyMax, Math.max(HARDEN_LIMITS.qtyMin, Number(state.quantity) || 1));
    display.textContent = state.quantity;
    display.setAttribute('aria-label', `Số lượng: ${state.quantity}`);
    minus.disabled = state.quantity <= HARDEN_LIMITS.qtyMin;
    plus.disabled = state.quantity >= HARDEN_LIMITS.qtyMax;
    minus.setAttribute('aria-disabled', String(minus.disabled));
    plus.setAttribute('aria-disabled', String(plus.disabled));
    updatePrice();
  };
  minus.addEventListener('click', () => { if (state.quantity > HARDEN_LIMITS.qtyMin) { state.quantity--; render(); } });
  plus.addEventListener('click', () => { if (state.quantity < HARDEN_LIMITS.qtyMax) { state.quantity++; render(); } });
  render();
}

/* ============================================================
   PRICE
   ============================================================ */
function updatePrice() {
  const price = PRODUCT_PRICES[state.selectedProductType] || 250000;
  const total = price * state.quantity;
  const el = document.getElementById('totalPrice');
  if (el) el.textContent = formatPrice(total);
}

/* ============================================================
   ACTION BUTTONS
   ============================================================ */
function updateActionButtons(enabled) {
  document.getElementById('orderBtn').disabled = !enabled;
  document.getElementById('downloadBtn').disabled = !enabled;
  document.getElementById('printPreviewBtn').disabled = !enabled;
  document.getElementById('shareDesignBtn').disabled = !enabled;
}

function updateShareButton() {
  const btn = document.getElementById('shareDesignBtn');
  if (!btn) return;
  const canShare = state.currentDesign?.designId && !state.currentDesign?.isDraft && !state.currentDesign?.designId?.startsWith('community-') && !state.currentDesign?.designId?.startsWith('text-only-');
  btn.disabled = !canShare;
}

/* ============================================================
   PROMPT ENHANCE (NEW)
   ============================================================ */
async function enhancePrompt() {
  const input = document.getElementById('promptInput');
  const btn = document.getElementById('promptEnhanceBtn');
  if (!input || !btn) return;
  const prompt = input.value.trim();
  if (!prompt) { showToast('Nhập prompt trước khi enhance!', 'warning'); return; }

  btn.classList.add('enhancing');
  btn.disabled = true;

  try {
    const response = await fetch(`${API_BASE}/ai-design/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth.token ? `Bearer ${auth.token}` : '' },
      body: JSON.stringify({ prompt, style: state.selectedStyle, enhanceOnly: true }),
    });
    const data = await response.json();
    if (data.enhancedPrompt) {
      input.value = data.enhancedPrompt;
      state.customText = '';
      showToast('Prompt đã được AI tối ưu!', 'success');
    } else {
      showToast('Không thể enhance prompt. Thử lại sau.', 'warning');
    }
  } catch (e) {
    // Client-side fallback: simple enhancement
    const enhanced = `Hand-crafted t-shirt print design: ${prompt}. Style: screen-print halftone texture, limited flat colors (2-3 max), hand-drawn linework with visible imperfections, rough distressed edges, asymmetric composition, like an independent artist risograph print. NOT AI-generated, NOT digital render, NOT gradient blobs, NOT glossy.`;
    input.value = enhanced;
    showToast('Prompt đã được tối ưu (offline mode)', 'info');
  }

  btn.classList.remove('enhancing');
  btn.disabled = false;
}

/* ============================================================
   DESIGN HISTORY (NEW - localStorage)
   ============================================================ */
const HISTORY_KEY = 'blankup_design_history';
function getHistory() {
  try {
    const raw = safeGet(HISTORY_KEY, '[]');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
function saveToHistory(design) {
  if (!design || design.isDraft) return;
  const history = getHistory();
  const snapLayers = (side) => sideLayers(side).map(l => ({
    url: l.url, x: l.x, y: l.y, scale: l.scale, rotation: l.rotation || 0,
    visible: l.visible !== false, z: l.z, name: l.name,
    designId: l.designId, prompt: l.prompt, style: l.style,
    opacity: Number(l.opacity) || 1, locked: l.locked === true,
    crop: l.crop ? { ...l.crop } : null, assetId: l.assetId, kind: l.kind,
  }));
  const entry = {
    id: design.designId || 'design-' + Date.now(),
    prompt: design.prompt || '',
    style: design.style || 'minimalist',
    designUrl: design.designUrl || '',
    frontDesignUrl: design.frontDesignUrl || '',
    backDesignUrl: design.backDesignUrl,
    layers: { front: snapLayers('front'), back: snapLayers('back') },
    timestamp: Date.now(),
  };
  history.unshift(entry);
  if (history.length > 20) history.length = 20;
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); }
  catch { /* private mode: history stays in-memory for this session */ }
  renderHistory();
}
function renderHistory() {
  const list = document.getElementById('historyList');
  if (!list) return;
  const history = getHistory();
  if (history.length === 0) { list.innerHTML = '<div style="padding:8px 12px;font-size:0.78rem;color:var(--s-text-muted);">Chưa có thiết kế nào</div>'; return; }
  list.innerHTML = history.map(h => {
    const timeStr = formatDateTime(h.timestamp);
    return `<div class="history-item" data-id="${escapeAttr(h.id)}" tabindex="0" role="button" aria-label="Khôi phục thiết kế ${escapeAttr((h.prompt || 'Untitled').slice(0, 60))}">
      <img class="history-item-thumb" src="${escapeAttr(h.designUrl || h.frontDesignUrl)}" alt="" loading="lazy">
      <div class="history-item-info">
        <div class="history-item-prompt">${escapeHtml(h.prompt || 'Untitled')}</div>
        <div class="history-item-time">${timeStr}</div>
      </div>
      <button class="history-item-delete" title="Xoá" aria-label="Xoá thiết kế khỏi lịch sử" type="button">✕</button>
    </div>`;
  }).join('');

  list.querySelectorAll('.history-item').forEach(item => {
    const activate = async () => item.click();
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); item.click(); }
    });
    item.addEventListener('click', async (e) => {
      if (e.target.closest('.history-item-delete')) return;
      const id = item.dataset.id;
      const entry = history.find(h => h.id === id);
      if (entry) {
        state.currentDesign = { success: true, designId: entry.id, designUrl: entry.designUrl, frontDesignUrl: entry.frontDesignUrl || entry.designUrl, backDesignUrl: entry.backDesignUrl, prompt: entry.prompt, style: entry.style, author: 'History' };
        state.savedDesignId = null; state.savedDesignName = null; updateSavedBadge(); // history-restore = identity mới, không ghi đè bản đã lưu
        // Restore full multi-layer composition when available; otherwise
        // fall back to adding the single snapshot URL as one layer.
        if (entry.layers && (entry.layers.front?.length || entry.layers.back?.length)) {
          withDesignUndoSuppressed(() => { // khôi phục N layer = ĐÚNG 1 entry undo
            for (const side of ['front', 'back']) {
              clearSideLayers(side);
              (entry.layers[side] || []).forEach((l) => {
                const added = addLayer(side, { url: l.url, name: l.name, designId: l.designId, prompt: l.prompt, style: l.style });
                if (added) { Object.assign(added, { x: l.x, y: l.y, scale: l.scale, rotation: l.rotation || 0, visible: l.visible !== false, z: l.z, opacity: Number(l.opacity) || 1, locked: l.locked === true, crop: l.crop ? { ...l.crop } : null }); clampLayerToPrintArea(added); }
              });
            }
          });
          pushDesignUndo('restore');
          await refreshSideViews();
          updateBackDesignControls();
          updateShareButton();
        } else {
          showDesignOnMockup(state.currentDesign.designUrl);
        }
        const promptInput = document.getElementById('promptInput');
        if (promptInput && entry.prompt) promptInput.value = entry.prompt;
        showToast('Đã khôi phục thiết kế', 'success');
      }
    });
  });

  list.querySelectorAll('.history-item-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = btn.closest('.history-item');
      const id = item?.dataset.id;
      if (!id) return;
      const h = getHistory().filter(x => x.id !== id);
      safeSet(HISTORY_KEY, JSON.stringify(h));
      renderHistory();
    });
  });
}

function initHistory() {
  document.getElementById('historyToggle')?.addEventListener('click', () => {
    document.getElementById('panelHistory')?.classList.toggle('open');
  });
  renderHistory();
}

/* ============================================================
   PHASE 4 — SAVED DESIGNS (persistent, server-backed, fully editable)
   Lưu CẢ 2 mặt áo + mọi layer (transform/crop/opacity/lock/visibility/z)
   + text per side + product + color — reopen = thiết kế nguyên trạng.
   ============================================================ */
function buildSavedDesignPayload() {
  const snapText = (side) => {
    const content = getSideCustomText(side);
    if (!content) return null;
    const tp = getSideTextPlacement(side);
    return {
      content,
      placement: {
        x: tp.x, y: tp.y, scale: tp.scale,
        rotation: tp.rotation || 0, opacity: Number.isFinite(tp.opacity) ? tp.opacity : 1,
      },
      style: getSideTextStyle(side),
      locked: getSideTextLocked(side),
    };
  };
  const snapLayers = (side) => sideLayers(side).map(l => ({
    url: l.url, name: l.name, kind: l.kind, assetId: l.assetId || null,
    x: l.x, y: l.y, scale: l.scale, rotation: l.rotation || 0,
    opacity: Number(l.opacity) || 1, visible: l.visible !== false,
    locked: l.locked === true, z: l.z,
    crop: l.crop ? { ...l.crop } : null,
    flipH: l.flipH === true, flipV: l.flipV === true,
    prompt: l.prompt || '', style: l.style || '',
  }));
  const payload = {
    designId: state.savedDesignId || undefined,
    name: state.savedDesignName || (state.currentDesign?.prompt ? String(state.currentDesign.prompt).slice(0, 80) : ''),
    productType: state.selectedProductType,
    color: state.selectedColor,
    size: state.selectedSize,
    front: { layers: snapLayers('front'), text: snapText('front') },
    back: { layers: snapLayers('back'), text: snapText('back') },
  };
  return payload;
}

async function saveDesignToServer({ silent = false, asNew = false } = {}) {
  if (asNew) { state.savedDesignId = null; state.savedDesignName = null; } // fork: luôn tạo record mới
  if (requireAuth()) return null;
  if (!state.savedDesignId && !hasLayerDesigns('front') && !hasLayerDesigns('back') && !getSideCustomText('front') && !getSideCustomText('back')) {
    if (!silent) showToast('Chưa có thiết kế để lưu.', 'warning');
    return null;
  }
  const btn = document.getElementById('saveDesignBtn');
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.classList.add('is-loading'); }
  try {
    const resp = await fetchWithTimeout(`${API_BASE}/ai-design/saved`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth.getAuthHeaders() },
      body: JSON.stringify(buildSavedDesignPayload()),
    }, 15000);
    const data = await resp.json().catch(() => ({}));
    if (resp.status === 401) { showToast('Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.', 'warning', 5000); return null; }
    if (!resp.ok || data.success === false) throw new Error(data.error || `Lưu thất bại (HTTP ${resp.status}).`);
    state.savedDesignId = data.designId; // identity ổn định — save lại = update
    state.savedDesignName = data.record?.name || state.savedDesignName;
    updateSavedBadge();
    if (!silent) showToast(data.created ? 'Đã lưu thiết kế vào tài khoản!' : 'Đã cập nhật thiết kế!', 'success');
    renderSavedDesigns();
    return data.designId;
  } catch (e) {
    if (!silent) showToast(e.message || 'Lưu thiết kế thất bại.', 'error');
    return null;
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove('is-loading'); btn.innerHTML = originalHtml; }
  }
}

async function loadSavedDesign(designId) {
  if (requireAuth()) return false;
  try {
    const resp = await fetchWithTimeout(`${API_BASE}/ai-design/saved/${encodeURIComponent(designId)}`, {
      headers: auth.getAuthHeaders(),
    }, 15000);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.success === false) throw new Error(data.error || 'Không tải được thiết kế.');
    const rec = data.record;
    // Product trước layer: đúng model + mapping trước khi dựng layers.
    const productBtn = document.querySelector(`.product-type-btn[data-product-type="${rec.productType}"]`);
    if (productBtn && rec.productType !== state.selectedProductType) productBtn.click();
    else if (rec.productType === state.selectedProductType) window.tshirt360Viewer?.setProduct?.(rec.productType);
    // Màu áo + size đã lưu (2 lựa chọn này thuộc design/product snapshot).
    if (rec.color && /^#[0-9a-fA-F]{3,8}$/.test(rec.color)) {
      state.selectedColor = rec.color;
      updateMockupColor(); // áp màu lên mockup 2D + texture/3D + UI
    }
    if (rec.size && String(rec.size)) {
      state.selectedSize = String(rec.size).slice(0, 4);
      document.querySelectorAll('.size-btn').forEach(b => {
        const on = String(b.dataset.size || '') === state.selectedSize;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    state.savedDesignId = rec.designId;
    state.savedDesignName = rec.name;
    // Hiện khung xem thật (không còn empty state) — cùng reveal như showDesignOnMockup
    // nhưng KHÔNG tạo thêm layer (layers đã được khôi phục bên dưới).
    const viewerEl = document.getElementById('canvasViewer');
    const emptyEl = document.getElementById('canvasEmpty');
    if (viewerEl) viewerEl.style.display = 'flex';
    if (emptyEl) emptyEl.style.display = 'none';
    const placementPanel = document.getElementById('placementPanel');
    if (placementPanel) placementPanel.style.display = 'block';
    withDesignUndoSuppressed(() => { // khôi phục N layer = 1 entry undo
      for (const side of ['front', 'back']) {
        clearSideLayers(side);
        (rec[side]?.layers || []).forEach((l) => {
          const added = addLayer(side, { url: l.url, name: l.name, kind: l.kind, assetId: l.assetId, prompt: l.prompt, style: l.style });
          if (added) {
            Object.assign(added, {
              x: l.x, y: l.y, scale: l.scale, rotation: l.rotation || 0,
              opacity: Number(l.opacity) || 1, visible: l.visible !== false,
              locked: l.locked === true, z: l.z,
              crop: l.crop ? { ...l.crop } : null,
            });
            clampLayerToPrintArea(added);
          }
        });
      }
      // Text per side (content + placement + style + lock)
      for (const side of ['front', 'back']) {
        const t = rec[side]?.text;
        if (t && t.content) {
          state.customTextSides[side] = t.content;
          if (side === state.currentView) state.customText = t.content;
          state.compositeCacheKey = '';
          const tp = { x: t.placement?.x ?? 0, y: t.placement?.y ?? 18, scale: t.placement?.scale ?? 1, rotation: t.placement?.rotation ?? 0, opacity: t.placement?.opacity ?? 1 };
          state.sideTextPlacement[side] = tp;
          if (side === state.currentView) state.textPlacement = { ...tp };
          if (t.style) state.sideTextStyle[side] = { ...getSideTextStyle(side), ...t.style };
          if (side === state.currentView) { state.textStyle = { ...state.sideTextStyle[side] }; syncTextStyleControls?.(); }
          commitTextLocked(side, t.locked === true);
        }
      }
    });
    pushDesignUndo('restore-saved');
    state.currentDesign = state.currentDesign || { success: true, designId: rec.designId, isSaved: true };
    await refreshSideViews();
    updateBackDesignControls();
    updateActionButtons(true);
    updateShareButton();
    syncCustomTextInputs();
    updateSavedBadge();
    showToast(`Đã mở "${rec.name}"`, 'success');
    return true;
  } catch (e) {
    showToast(e.message || 'Mở thiết kế thất bại.', 'error');
    return false;
  }
}

async function renderSavedDesigns() {
  const list = document.getElementById('savedDesignsList');
  if (!list) return;
  if (typeof auth === 'undefined' || !auth?.isLoggedIn?.()) {
    list.innerHTML = '<div class="saved-empty">Đăng nhập để lưu thiết kế vào tài khoản.</div>';
    return;
  }
  try {
    const resp = await fetchWithTimeout(`${API_BASE}/ai-design/saved`, { headers: auth.getAuthHeaders() }, 15000);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.success === false) throw new Error(data.error || 'Lỗi');
    const items = data.data || [];
    if (!items.length) {
      list.innerHTML = '<div class="saved-empty">Chưa có thiết kế nào được lưu.</div>';
      return;
    }
    list.innerHTML = items.map(d => `
      <div class="saved-item ${d.designId === state.savedDesignId ? 'current' : ''}" data-id="${escapeAttr(d.designId)}">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <div class="saved-item-info">
          <div class="saved-item-name">${escapeHtml(d.name || 'Không tên')}</div>
          <div class="saved-item-meta">${escapeHtml({ tshirt: 'T-Shirt', hoodie: 'Hoodie', polo: 'Polo' }[d.productType] || d.productType)} · ${d.counts?.front || 0}L/${d.counts?.back || 0}L · ${formatDateTime(Date.parse(d.updatedAt) || Date.now())}</div>
        </div>
        <button class="saved-item-delete" title="Xóa thiết kế" aria-label="Xóa thiết kế" type="button">✕</button>
      </div>`).join('');
    list.querySelectorAll('.saved-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.saved-item-delete')) return;
        loadSavedDesign(item.dataset.id);
      });
    });
    list.querySelectorAll('.saved-item-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.closest('.saved-item')?.dataset.id;
        if (!id || !confirm('Xóa thiết kế đã lưu này?')) return;
        try {
          const resp = await fetchWithTimeout(`${API_BASE}/ai-design/saved/${encodeURIComponent(id)}`, { method: 'DELETE', headers: auth.getAuthHeaders() }, 15000);
          if (resp.ok) {
            if (state.savedDesignId === id) { state.savedDesignId = null; state.savedDesignName = null; updateSavedBadge(); }
            renderSavedDesigns();
            showToast('Đã xóa thiết kế.', 'success');
          }
        } catch { showToast('Xóa thất bại.', 'error'); }
      });
    });
  } catch (e) {
    list.innerHTML = '<div class="saved-empty">Không tải được danh sách — thử lại sau.</div>';
  }
}

function updateSavedBadge() {
  const badge = document.getElementById('savedBadge');
  if (badge) {
    badge.hidden = !state.savedDesignId;
    badge.textContent = state.savedDesignName || 'Đã lưu';
  }
  const saveBtn = document.getElementById('saveDesignBtn');
  if (saveBtn) {
    const label = saveBtn.querySelector('span');
    if (label) label.textContent = state.savedDesignId ? 'Cập nhật thiết kế' : 'Lưu thiết kế';
  }
}

function initSavedDesigns() {
  document.getElementById('saveDesignBtn')?.addEventListener('click', () => saveDesignToServer());
  document.getElementById('saveAsNewBtn')?.addEventListener('click', () => saveDesignToServer({ asNew: true }));
  const toggle = document.getElementById('savedToggle');
  if (toggle) toggle.addEventListener('click', () => {
    document.getElementById('panelSaved')?.classList.toggle('open');
    if (document.getElementById('panelSaved')?.classList.contains('open')) renderSavedDesigns();
  });
  if (typeof auth !== 'undefined' && auth?.isLoggedIn?.()) renderSavedDesigns();
}

/* ============================================================
   PROMPT SUGGESTIONS
   ============================================================ */
function initPromptSuggestions() {
  const container = document.getElementById('promptSuggestions');
  const input = document.getElementById('promptInput');
  if (!container || !input) return;
  container.querySelectorAll('.prompt-suggestion-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const prompt = chip.dataset.prompt;
      if (prompt) {
        input.value = prompt;
        input.focus();
        input.dispatchEvent(new Event('input'));
      }
    });
  });
}

/* ============================================================
   AI GENERATION - PROMPT
   ============================================================ */
function initGenerateButtons() {
  document.getElementById('generatePromptBtn')?.addEventListener('click', generateFromPrompt);
  document.getElementById('generateImageBtn')?.addEventListener('click', generateFromImage);
  document.getElementById('promptEnhanceBtn')?.addEventListener('click', enhancePrompt);
}

async function generateFromPrompt(targetSide = 'front', opts = {}) {
  if (requireAuth()) return;
  if (state.isGeneratingAi) { showToast('AI đang tạo mẫu trước đó — vui lòng đợi hoàn tất.', 'info'); return; }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    showToast('Bạn đang ngoại tuyến. Hãy kết nối mạng rồi thử lại.', 'error', 5000);
    return;
  }
  const inputEl = document.getElementById('promptInput');
  const prompt = inputEl?.value?.trim() || '';
  const errEl = document.getElementById('promptError');
  const _genBtnEarly = document.getElementById('generatePromptBtn');
  if (!prompt) { if(_genBtnEarly) shakeButton(_genBtnEarly); setFieldError(inputEl, errEl, 'Vui lòng nhập mô tả thiết kế (tối thiểu 3 ký tự).'); showToast('Vui lòng nhập mô tả thiết kế!', 'warning'); return; }
  if (prompt.length < HARDEN_LIMITS.promptMin) { if(_genBtnEarly) shakeButton(_genBtnEarly); setFieldError(inputEl, errEl, `Mô tả quá ngắn (${prompt.length}/${HARDEN_LIMITS.promptMin} ký tự tối thiểu).`); return; }
  if (prompt.length > HARDEN_LIMITS.promptMax) { if(_genBtnEarly) shakeButton(_genBtnEarly); setFieldError(inputEl, errEl, `Mô tả quá dài (${prompt.length}/${HARDEN_LIMITS.promptMax}). Hãy rút gọn.`); showToast(`Prompt vượt quá ${HARDEN_LIMITS.promptMax} ký tự.`, 'warning'); return; }
  setFieldError(inputEl, errEl, '');
  // Prompt tổng 2 mặt ("con chó mặt trước, con mèo mặt sau") → tự tách và
  // tạo TỪNG mặt lần lượt. Chỉ chạy ở lượt gọi từ nút bấm (không re-entry).
  if (!opts.promptOverride && !opts.skipSplit) {
    const dual = splitDualSidePrompt(prompt);
    if (dual) {
      state.sidePrompts.front = dual.front;
      state.sidePrompts.back = dual.back;
      const pi = document.getElementById('promptInput');
      if (pi) { pi.value = dual[currentPromptSide()] || ''; pi.dispatchEvent(new Event('input', { bubbles: true })); }
      showToast('Nhận diện prompt cho cả 2 mặt — sẽ tạo MẶT TRƯỚC rồi MẶT SAU lần lượt.', 'info', 4000);
      await generateFromPrompt('front', { promptOverride: dual.front, skipSplit: true });
      await generateFromPrompt('back', { promptOverride: dual.back, skipSplit: true });
      return;
    }
  }
  const btn = document.getElementById('generatePromptBtn');
  // Per-side prompts: target side defaults to the side the user is composing
  // for in the prompt panel (promptSide), not always 'front'.
  const target = targetSide === 'back' ? 'back' : currentPromptSide();
  const activePrompt = opts.promptOverride || prompt;
  state.sidePrompts[target] = activePrompt;
  const isBack = target === 'back';
  updateActionButtons(false);
  setLoading(btn, true);
  startGenProgress();

  const draft = generateMockDesign(state.selectedStyle, activePrompt);
  draft.isDraft = true;
  // The draft is a real layer marked draft; the AI result REPLACES this same
  // layer on success (no duplicate) or stays visible on failure.
  let draftLayerId = null;
  if (isBack) {
    if (!state.currentDesign) state.currentDesign = draft;
    state.currentDesign.backDesignUrl = draft.designUrl;
    const created = await showDesignOnMockup(draft.designUrl, null, null, 'back', { name: 'Đang tạo (sau)…', designId: draft.designId, prompt: activePrompt, style: state.selectedStyle });
    if (created) { created.isDraft = true; draftLayerId = created.id; }
  } else {
    state.currentDesign = draft;
    state.isGeneratingAi = true;
    const created = await showDesignOnMockup(draft.designUrl, null, null, undefined, { name: 'Đang tạo…', designId: draft.designId, prompt: activePrompt, style: state.selectedStyle });
    if (created) { created.isDraft = true; draftLayerId = created.id; }
  }

  const genController = new AbortController();
  const genTimeout = setTimeout(() => genController.abort(), GEN_FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(`${API_BASE}/ai-design/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth.token ? `Bearer ${auth.token}` : '' },
      body: JSON.stringify({ prompt: activePrompt, style: state.selectedStyle, customText: state.customText, author: auth.user?.fullName || auth.user?.username || '' }),
      signal: genController.signal,
    });
    clearTimeout(genTimeout);
    const data = await resp.json();
    if (!resp.ok || data.success === false) throw new Error(formatAiError(data));
    if (data.success && data.designUrl) {
      state.isGeneratingAi = false;
      completeGenProgress(true);
      applyRemainingCreditsFromResponse(data);
      const side = isBack ? 'back' : 'front';
      // Replace the draft layer in place (same id/placement) — never append
      // a second layer for one generation, never wipe sibling layers.
      const draftLayer = draftLayerId ? sideLayers(side).find(l => l.id === draftLayerId) : null;
      if (draftLayer) {
        draftLayer.url = data.designUrl;
        draftLayer.isDraft = false;
        draftLayer.name = data.prompt ? String(data.prompt).slice(0, 24) : draftLayer.name;
        draftLayer.designId = data.designId || draftLayer.designId;
        draftLayer.prompt = data.prompt || draftLayer.prompt;
        draftLayer.style = data.style || draftLayer.style;
        state.selectedLayerId[side] = draftLayer.id;
      }
      state.lastGenerated[side] = data.designUrl;
      if (isBack) {
        if (!state.currentDesign) state.currentDesign = data;
        state.currentDesign.backDesignUrl = data.designUrl;
        state.preparedDesignUrls.back = data.designUrl;
        await refreshSideViews();
        updateBackDesignControls();
        setViewerSide('back');
        saveToHistory(state.currentDesign);
      } else {
        state.currentDesign = data;
        state.customTextSides = data.customTextSides || state.customTextSides;
        state.preparedDesignUrls.front = data.designUrl;
        await refreshSideViews();
        updateShareButton();
        saveToHistory(data);
      }
      showToast(`Đã thêm mẫu mới vào mặt ${isBack ? 'sau' : 'trước'}.`, 'success');
      if (data.provider === 'mock') {
        showToast('⚠ Lưu ý: Hệ thống AI hiện không khả dụng — đây là ảnh DEMO (mẫu có sẵn), KHÔNG theo prompt của bạn. Credit đã được hoàn lại.', 'warning', 10000);
      }
    } else {
      failGenProgress();
    }
  } catch (e) {
    clearTimeout(genTimeout);
    state.isGeneratingAi = false;
    // Gén lỗi → gỡ draft "Đang tạo…" ra khỏi áo (nếu chưa bị thay).
    // Trước đây draft bị kẹt lại mãi khi gen thất bại (vd hết credit).
    const draftLayerFail = draftLayerId ? sideLayers(isBack ? 'back' : 'front').find(l => l.id === draftLayerId && l.isDraft) : null;
    if (draftLayerFail) removeLayer(isBack ? 'back' : 'front', draftLayerId);
    if (e && e.name === 'AbortError') {
      failGenProgress('Quá thời gian chờ AI (120s). Vui lòng thử lại.');
      shakeButton(btn);
      showToast('AI phản hồi quá lâu (quá 120s). Yêu cầu có thể vẫn đang xử lý ở server — vui lòng đợi một lúc rồi kiểm tra lại, tránh bấm tạo liên tục.', 'error', 7000);
      refreshSideViews();
      setLoading(btn, false); return;
    }
    failGenProgress();
    if (e.message && e.message !== 'Failed to fetch') {
      shakeButton(btn);
      showToast(e.message, 'error', 7000);
      refreshSideViews();
      setLoading(btn, false); return;
    }
    console.warn('API unavailable, keeping draft');
    if (isBack) {
      updateDesignOverlayForSide();
      applyCurrentDesignToViewer();
      updateBackDesignControls();
      setViewerSide('back');
    }
  }
  state.isGeneratingAi = false;
  setLoading(btn, false);
  // Success micro: button was loading, now show checkmark briefly (only if not already failed)
  if (btn && !btn.disabled) {
    // Only show success if we actually have a design (not draft fallback)
    const hasRealDesign = state.currentDesign && !state.currentDesign.isDraft;
    if (hasRealDesign) showButtonSuccess(btn, '✓ Đã tạo');
  }
}

/* ============================================================
   AI GENERATION - IMAGE
   ============================================================ */
async function generateFromImage() {
  if (requireAuth()) return;
  const _imgBtnEarly = document.getElementById('generateImageBtn');
  if (!state.uploadedFile) { if(_imgBtnEarly) shakeButton(_imgBtnEarly); showToast('Vui lòng upload ảnh!', 'warning'); return; }
  const idea = document.getElementById('ideaInput')?.value?.trim() || '';
  const btn = document.getElementById('generateImageBtn');
  const mode = document.getElementById('uploadModeReference')?.checked ? 'reference' : 'asset';
  updateActionButtons(false);
  setLoading(btn, true);
  startGenProgress();

  try {
    const formData = new FormData();
    formData.append('image', state.uploadedFile);
    formData.append('idea', idea);
    formData.append('style', state.selectedStyle);
    formData.append('customText', state.customText);
    formData.append('author', auth.user?.fullName || auth.user?.username || '');
    formData.append('mode', mode);

    const imgController = new AbortController();
    const imgTimeout = setTimeout(() => imgController.abort(), GEN_FETCH_TIMEOUT_MS);
    const resp = await fetch(`${API_BASE}/ai-design/generate-from-image`, {
      method: 'POST',
      headers: { Authorization: auth.token ? `Bearer ${auth.token}` : '' },
      body: formData,
      signal: imgController.signal,
    });
    clearTimeout(imgTimeout);
    const data = await resp.json();
    if (!resp.ok || data.success === false) throw new Error(formatAiError(data));
    if (data.success && data.designUrl) {
      state.currentDesign = data;
      completeGenProgress(true);
      state.lastGenerated.front = data.designUrl;
      // Store reference asset ID if in reference mode
      if (mode === 'reference' && data.referenceAssetId) {
        state.pendingReferenceAssetId = data.referenceAssetId;
      }
      applyRemainingCreditsFromResponse(data);
      await showDesignOnMockup(data.designUrl, data.productMockupUrl, data.productMockupBlank, undefined, { name: String(data.prompt || 'Ảnh remix').slice(0, 24), designId: data.designId, prompt: data.prompt, style: data.style });
      updateShareButton();
      saveToHistory(data);
      showButtonSuccess(btn, '✓ Đã tạo');
      if (data.provider === 'mock') {
        showToast('⚠ Lưu ý: Hệ thống AI hiện không khả dụng — đây là ảnh DEMO (mẫu có sẵn), KHÔNG theo prompt của bạn. Credit đã được hoàn lại.', 'warning', 10000);
      } else {
        showToast('Đã thêm mẫu mới vào mặt trước.', 'success');
      }
    } else {
      shakeButton(btn);
      failGenProgress();
    }
  } catch (e) {
    clearTimeout(imgTimeout);
    if (e && e.name === 'AbortError') {
      failGenProgress('Quá thời gian chờ AI (120s). Vui lòng thử lại.');
      shakeButton(btn);
      showToast('AI phản hồi quá lâu (quá 120s). Yêu cầu có thể vẫn đang xử lý ở server — vui lòng đợi một lúc rồi kiểm tra lại, tránh bấm tạo liên tục.', 'error', 7000);
      setLoading(btn, false); return;
    }
    failGenProgress();
    if (e.message && e.message !== 'Failed to fetch') {
      shakeButton(btn);
      showToast(e.message, 'error', 7000);
      setLoading(btn, false); return;
    }
    const mock = generateMockDesign('abstract', 'Image remix');
    state.currentDesign = mock;
    showDesignOnMockup(mock.designUrl);
  }
  setLoading(btn, false);
}

/* ============================================================
   VIEW TOGGLE (Front/Back)
   ============================================================ */
function initViewToggle() {
  document.querySelectorAll('.view-toggle-btn').forEach(btn => {
    if (!btn.hasAttribute('aria-pressed')) btn.setAttribute('aria-pressed', btn.classList.contains('active') ? 'true' : 'false');
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-toggle-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      setViewerSide(btn.dataset.view);
    });
  });
}

function setViewerSide(side) {
  const next = side === 'back' ? 'back' : 'front';
  if (isCropMode() && next !== state.currentView) {
    // Đổi mặt áo trong Crop Mode = hủy phiên (không tạo entry — đúng hợp đồng Cancel).
    exitCropMode({ apply: false, silent: true });
    showToast('Đã thoát Crop Mode khi đổi mặt áo.', 'info', 1600);
  }
  if (state.currentView === next) {
    if (state.currentDesign || state.printDesignUrl || hasLayerDesigns(next)) { updateDesignOverlayForSide(); applyCurrentDesignToViewer(); }
    updateSideBadge();
    updateBackDesignControls();
    return;
  }
  commitActivePlacements();
  state.currentView = next;
  loadPlacementsForSide(next);
  // Prompt panel follows the viewed side (two-way sync with prompt-side switch).
  if (state.promptSide !== next) {
    const pi = document.getElementById('promptInput');
    if (pi) {
      state.sidePrompts[state.promptSide] = pi.value;
      state.promptSide = next;
      pi.value = state.sidePrompts[next] || '';
      pi.dispatchEvent(new Event('input', { bubbles: true }));
    }
    state.promptSide = next;
    document.querySelectorAll('.prompt-side-btn').forEach(btn => {
      const on = btn.dataset.side === next;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    updatePromptCount();
  }
  document.querySelectorAll('.view-toggle-btn').forEach(btn => {
    const on = btn.dataset.view === next;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  try { window.tshirt360Viewer?.showSide?.(next); } catch (e) { /* */ }
  if (state.cssViewer) { next === 'back' ? state.cssViewer.showBack() : state.cssViewer.showFront(); }
  syncPlacementInputs();
  syncPresetChips();
  syncCustomTextInputs();
  updateSideBadge();
  updateBackDesignControls();
  if (state.currentDesign || state.preparedDesignUrls.front || state.preparedDesignUrls.back || hasLayerDesigns('front') || hasLayerDesigns('back')) {
    updateDesignOverlayForSide();
    applyCurrentDesignToViewer();
  }
}

/* ============================================================
   INTERACTION MODE (Position/Rotate)
   ============================================================ */
function initInteractionMode() {
  document.getElementById('placementModeBtn')?.addEventListener('click', () => setInteractionMode('position'));
  document.getElementById('rotateModeBtn')?.addEventListener('click', () => setInteractionMode('rotate'));
  document.getElementById('resetViewBtn')?.addEventListener('click', () => {
    // Reset ONLY the selected layer (never the whole side).
    const sel = getSelectedLayer();
    const defaults = PRINT_POSITION_PRESETS[state.currentView === 'back' ? 'back' : 'chest'];
    if (sel) {
      sel.x = defaults.x; sel.y = defaults.y; sel.scale = defaults.scale; sel.rotation = 0;
      state.printPlacement = { x: sel.x, y: sel.y, scale: sel.scale };
    } else {
      state.printPlacement = { ...defaults };
    }
    state.textPlacement = getSideTextPlacement(state.currentView);
    commitActivePlacements();
    refreshSideViews();
    try { window.tshirt360Viewer?.showSide?.(state.currentView); } catch (e) { /* */ }
  });
  document.getElementById('removeWhiteBgBtn')?.addEventListener('click', () => {
    const btn = document.getElementById('removeWhiteBgBtn');
    const enabled = window.tshirt360Viewer?.setRemoveWhiteBg ? window.tshirt360Viewer.setRemoveWhiteBg(btn.classList.contains('active') === false) : true;
    btn.classList.toggle('active', enabled);
  });
}

/* ============================================================
   PLACEMENT CONTROLS
   ============================================================ */
function syncPlacementInputs() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  const sel = getSelectedLayer();
  const ip = sel || state.printPlacement;
  set('printPosX', Math.round(ip.x));
  set('printPosY', Math.round(ip.y));
  set('printScale', Math.round(ip.scale * 100));
  set('printRotation', Math.round(sel ? (sel.rotation || 0) : 0));
  // Opacity + crop của layer đang chọn (slider phản ánh state thật)
  set('layerOpacity', Math.round(Math.max(0, Math.min(1, Number(sel?.opacity) || 1)) * 100));
  set('layerCropW', Math.round((sel?.crop ? sel.crop.w : 1) * 100));
  set('layerCropH', Math.round((sel?.crop ? sel.crop.h : 1) * 100));
  set('textPosX', Math.round(state.textPlacement.x));
  set('textPosY', Math.round(state.textPlacement.y));
  set('textScale', Math.round(state.textPlacement.scale * 100));
  paintSliderFills();
}

/* Track fill % cho mọi slider vị trí — xuất phát từ CSS var --fill mà CSS mới đọc.
   Gọi trong syncPlacementInputs (mọi mutation đều đi qua đây) + lúc init. */
function paintSliderFills() {
  ['printPosX', 'printPosY', 'printScale', 'printRotation', 'textPosX', 'textPosY', 'textScale', 'textSpacing', 'textRotate', 'layerOpacity', 'layerCropW', 'layerCropH'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const min = Number(el.min) || 0;
    const max = Number(el.max) || 100;
    const val = Number(el.value) || 0;
    const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
    if (el.classList.contains('center-origin')) {
      // Trục X/Y: fill tỏa từ giữa — nửa vạch gold quanh mốc 50%.
      el.style.setProperty('--off', `${Math.min(50, Math.abs(pct - 50))}%`);
    } else {
      el.style.setProperty('--fill', `${pct}%`);
    }
    // Chip giá trị live (output trong label)
    const out = document.getElementById(id + 'Value');
    if (out) {
      if (id === 'printScale' || id === 'textScale' || id === 'layerOpacity' || id === 'layerCropW' || id === 'layerCropH') out.textContent = `${Math.round(val)}%`;
      else if (id === 'printRotation' || id === 'textRotate') out.textContent = `${Math.round(val)}°`;
      else out.textContent = String(Math.round(val));
    }
  });
}

// Master refresh for one side: overlay (per-layer DOM) + inputs + list +
// composite-driven 3D. All transform edits funnel through here.
async function refreshSideViews() {
  renderLayersOverlay();
  syncPlacementInputs();
  syncPresetChips();
  try {
    if (viewerUpdateTimer) { clearTimeout(viewerUpdateTimer); viewerUpdateTimer = null; }
    await applyCurrentDesignToViewer();
  } catch (e) {
    console.warn('Viewer refresh failed:', e?.message || e);
  }
}

function initPrintControls() {
  const textInputs = [document.getElementById('customTextInput'), document.getElementById('customTextInputImage')].filter(Boolean);
  const applyCustomText = debounce((sourceInput) => {
    let raw = sourceInput.value || '';
    if (raw.length > HARDEN_LIMITS.customTextMax) {
      raw = raw.slice(0, HARDEN_LIMITS.customTextMax);
      sourceInput.value = raw;
      showToast(`Chữ/slogan giới hạn ${HARDEN_LIMITS.customTextMax} ký tự để không tràn bản in.`, 'warning');
    }
    state.customText = raw.trim().slice(0, HARDEN_LIMITS.customTextMax);
    state.customTextSides[sideKey()] = state.customText;
    textInputs.forEach(o => { if (o !== sourceInput) o.value = sourceInput.value; });
    state.compositeCacheKey = '';
    pushDesignUndo('text-content');
    /* PHASE 5 COMPLETION — ROOT CAUSE (chữ/slogan không thao tác được ngay):
       trước đây đường tạo/sửa chữ chỉ cập nhật state.customText mà KHÔNG đặt
       chữ làm đối tượng đang thao tác → activePlacementLayer vẫn là 'image',
       nên kéo trên áo là kéo ẢNH và khung chọn bám ảnh. Người dùng phải click
       vào chữ trước; vì tưởng thao tác không ăn nên họ lặp lại thao tác tạo
       → thấy như "2 chữ giống hệt nhau".
       Giờ: có chữ ⇒ chữ là target NGAY (khung chọn + kéo chữ hoạt động luôn);
       xoá hết chữ ⇒ trả target về ảnh. */
    setActivePlacementLayer(state.customText ? 'text' : 'image');
    updateDesignOverlayForSide();
    requestAnimationFrame(() => updateSelectionFrame());
    applyCurrentDesignToViewer();
  }, 160);
  textInputs.forEach(input => {
    input.setAttribute('maxlength', String(HARDEN_LIMITS.customTextMax));
    input.addEventListener('input', () => applyCustomText(input));
  });
  initTextStyleControls();

  // Image placement — always edits the SELECTED layer (never the whole side).
  const bind = (ids, stateKey, defaults) => {
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => {
        if (stateKey === 'printPlacement') {
          if (isCropMode()) return; // CROP MODE: sliders transform tạm ngưng
          const sel = requireSelectedLayer();
          if (!sel) return;
          if (sel.locked) { showToast(`"${sel.name || 'Mẫu'}" đang khóa — mở khóa để chỉnh.`, 'warning', 1600); return; }
          setActivePlacementLayer('image');
          sel.x = clampNum(Number(document.getElementById(ids[0])?.value ?? defaults.x), ...LAYER_BOUNDS.x);
          sel.y = clampNum(Number(document.getElementById(ids[1])?.value ?? defaults.y), ...LAYER_BOUNDS.y);
          sel.scale = clampNum(Number(document.getElementById(ids[2])?.value ?? defaults.scale * 100) / 100, ...LAYER_BOUNDS.scale, 1);
          const rotEl = document.getElementById('printRotation');
          if (rotEl) sel.rotation = clampNum(Number(rotEl.value ?? 0), ...LAYER_BOUNDS.rotation);
          state.printPlacement = { x: sel.x, y: sel.y, scale: sel.scale };
          commitActivePlacements();
          syncPlacementInputs();
          pushDesignUndo('placement');
          scheduleViewerUpdateThrottled(); // live 3D feedback trong lúc kéo
          return;
        }
        setActivePlacementLayer('text');
        if (getSideTextLocked()) { showToast('Chữ đang khóa — mở khóa để chỉnh.', 'warning', 1600); return; }
        // numOr: rỗng → fallback, else Number — toán tử `||` trước đây nuốt
        // giá trị 0 hợp lệ (kéo X chữ về 0 bị hiểu là 'falsy' → nhảy về 18).
        const numOr = (id, fallback) => {
          const el = document.getElementById(id);
          const raw = el ? String(el.value ?? '').trim() : '';
          if (raw === '') return fallback;
          const n = Number(raw);
          return Number.isFinite(n) ? n : fallback;
        };
        state[stateKey] = {
          x: clampNum(numOr(ids[0], defaults.x), ...TEXT_BOUNDS.x),
          y: clampNum(numOr(ids[1], defaults.y), ...TEXT_BOUNDS.y),
          scale: clampNum(numOr(ids[2], defaults.scale * 100) / 100, ...TEXT_BOUNDS.scale, 1),
        };
        commitActivePlacements();
        pushDesignUndo('text-placement');
        updateOverlayPlacement();
        syncPlacementInputs();
        scheduleViewerUpdateThrottled();
      });
    });
  };
  bind(['printPosX', 'printPosY', 'printScale'], 'printPlacement', { x: 0, y: -12, scale: 1 });
  bind(['textPosX', 'textPosY', 'textScale'], 'textPlacement', { x: 0, y: 18, scale: 1 });
  // Thả chuột (change) → refresh đầy đủ 1 lần (list, presets, decal final).
  ['printPosX', 'printPosY', 'printScale', 'printRotation', 'textPosX', 'textPosY', 'textScale'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () => refreshSideViews());
  });
  document.getElementById('printRotation')?.addEventListener('input', (e) => {
    if (isCropMode()) return; // CROP MODE: rotation giữ nguyên khi crop
    const sel = requireSelectedLayer();
    if (!sel) return;
    if (sel.locked) { showToast(`"${sel.name || 'Mẫu'}" đang khóa — mở khóa để xoay.`, 'warning', 1600); return; }
    sel.rotation = clampNum(Number(e.target.value ?? 0), ...LAYER_BOUNDS.rotation);
    commitActivePlacements();
    pushDesignUndo('rotate');
    syncPlacementInputs();
    scheduleViewerUpdateThrottled(); // xoay live mượt, full refresh khi thả (change)
  });

  document.getElementById('placementReset')?.addEventListener('click', () => {
    if (isCropMode()) { showToast('Đang ở Crop Mode — Apply/Hủy trước khi reset.', 'warning', 1800); return; }
    // Reset ONLY the selected layer (never the whole side).
    const sel = getSelectedLayer();
    const defaults = PRINT_POSITION_PRESETS[state.currentView === 'back' ? 'back' : 'chest'];
    if (sel?.locked) { showToast(`"${sel.name || 'Mẫu'}" đang khóa.`, 'warning', 1600); return; }
    if (sel) {
      sel.x = defaults.x; sel.y = defaults.y; sel.scale = defaults.scale; sel.rotation = 0;
      state.printPlacement = { x: sel.x, y: sel.y, scale: sel.scale };
    } else {
      state.printPlacement = { ...defaults };
    }
    state.textPlacement = getSideTextPlacement(state.currentView);
    commitActivePlacements();
    pushDesignUndo('reset');
    refreshSideViews();
  });

  // Căn giữa nhanh (1 click = chính xác, không cần kéo săm snap):
  document.getElementById('printCenterH')?.addEventListener('click', () => {
    const sel = getSelectedLayer();
    if (!sel) { showToast('Chọn một mẫu để căn giữa.', 'warning'); return; }
    sel.x = 0;
    state.printPlacement.x = 0;
    commitActivePlacements();
    pushDesignUndo('align');
    refreshSideViews();
    showToast('Đã căn giữa ngang.', 'success', 1200);
  });
  document.getElementById('printCenterV')?.addEventListener('click', () => {
    const sel = getSelectedLayer();
    if (!sel) { showToast('Chọn một mẫu để căn giữa.', 'warning'); return; }
    // Giữa dọc vùng in = y 0 (mapping 0.44 chiều cao composite — ngực).
    sel.y = 0;
    state.printPlacement.y = 0;
    commitActivePlacements();
    pushDesignUndo('align');
    refreshSideViews();
    showToast('Đã căn giữa dọc.', 'success', 1200);
  });
  document.getElementById('textCenterH')?.addEventListener('click', () => {
    state.textPlacement.x = 0;
    commitActivePlacements();
    pushDesignUndo('align');
    refreshSideViews();
    showToast('Chữ đã căn giữa ngang.', 'success', 1200);
  });
  document.getElementById('textCenterV')?.addEventListener('click', () => {
    state.textPlacement.y = 0;
    commitActivePlacements();
    pushDesignUndo('align');
    refreshSideViews();
    showToast('Chữ đã căn giữa dọc.', 'success', 1200);
  });

  // Keyboard nudge
  document.addEventListener('keydown', e => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    if (isCropMode()) return; // CROP MODE: arrow nudge tạm ngưng
    if (state.interactionMode !== 'position') return;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const step = e.shiftKey ? 5 : 1;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    // Locked guard — theo đúng TARGET đang chọn thật (image hoặc text)
    const tgt = getSelectionTarget();
    if (tgt?.kind === 'image' && tgt.layer?.locked) { showToast(`"${tgt.layer.name || 'Mẫu'}" đang khóa — mở khóa để di chuyển.`, 'warning', 1600); e.preventDefault(); return; }
    if (tgt?.kind === 'text' && getSideTextLocked()) { showToast('Chữ đang khóa — mở khóa để di chuyển.', 'warning', 1600); e.preventDefault(); return; }
    nudgePlacement(tgt?.kind === 'text' ? 'text' : 'image', dx, dy);
    e.preventDefault();
  });

  setInteractionMode(state.interactionMode);
  syncPlacementInputs();
  updateOverlayPlacement();
  initStickerPicker();
  initAlignTools();
  initDesignUndoRedo();
  initLayerEditControls();
}

/* ============================================================
   OPACITY + CROP (non-destructive) + QUICK ACTIONS
   — mọi thay đổi đi qua layer state → composite → 3D. Không UI giả.
   ============================================================ */
function initLayerEditControls() {
  const sel = () => getSelectedLayer();

  // OPACITY — live trong lúc kéo, 1 entry undo khi thả (change).
  const opacityEl = document.getElementById('layerOpacity');
  opacityEl?.addEventListener('input', (e) => {
    if (isCropMode()) return; // CROP MODE: opacity tạm ngưng (giữ nguyên khi crop)
    const target = sel();
    if (!target) return;
    target.opacity = clampNum(Number(e.target.value ?? 100) / 100, 0, 1, 1);
    commitActivePlacements();
    paintSliderFills();
    const node = document.querySelector(`#mockupDesign img[data-layer-id="${CSS.escape(target.id)}"]`);
    if (node) node.style.opacity = String(target.opacity);
    scheduleViewerUpdateThrottled();
  });
  opacityEl?.addEventListener('change', () => {
    pushDesignUndo('opacity');
    refreshSideViews();
  });

  // CROP non-destructive — slider = draft khi Crop Mode; 1 gesture = 1 entry (change).
  const cropInput = (id, axis) => {
    const el = document.getElementById(id);
    el?.addEventListener('input', (e) => applyCropSlider(axis, e.target.value));
    el?.addEventListener('change', () => {
      const target = sel();
      if (!target) return;
      pushDesignUndo('crop'); // 1 entry/gesture (coalesce 350ms gộp burst)
      refreshSideViews();
    });
  };
  cropInput('layerCropW', 'w');
  cropInput('layerCropH', 'h');
  document.getElementById('cropResetBtn')?.addEventListener('click', () => {
    const target = sel();
    if (!target || !target.crop) return;
    target.crop = null;
    commitActivePlacements();
    pushDesignUndo('crop');
    refreshSideViews();
    showToast('Đã khôi phục toàn bộ ảnh gốc.', 'success', 1500);
  });

  // QUICK ACTIONS trên layer đang chọn
  document.getElementById('qaDuplicate')?.addEventListener('click', () => {
    const target = sel();
    if (!target) { showToast('Chọn một mẫu để nhân bản.', 'warning'); return; }
    duplicateLayer(state.currentView, target.id);
  });
  document.getElementById('qaLock')?.addEventListener('click', () => {
    const target = sel();
    if (!target) { showToast('Chọn một mẫu để khóa/mở khóa.', 'warning'); return; }
    beginDesignUndoBatch('lock');
    target.locked = !target.locked;
    pushDesignUndo('lock');
    refreshSideViews();
    showToast(target.locked ? 'Đã khóa mẫu — chống sửa/xóa nhầm.' : 'Đã mở khóa.', 'info', 1600);
  });
  document.getElementById('qaReset')?.addEventListener('click', () => {
    if (isCropMode()) { showToast('Đang ở Crop Mode — Apply/Hủy trước khi reset.', 'warning', 1800); return; }
    const target = sel();
    if (!target) { showToast('Chọn một mẫu để reset.', 'warning'); return; }
    const defaults = PRINT_POSITION_PRESETS[state.currentView === 'back' ? 'back' : 'chest'];
    beginDesignUndoBatch('reset');
    target.x = defaults.x; target.y = defaults.y; target.scale = defaults.scale; target.rotation = 0;
    state.printPlacement = { x: target.x, y: target.y, scale: target.scale };
    commitActivePlacements();
    pushDesignUndo('reset');
    refreshSideViews();
    showToast('Đã reset vị trí + xoay mẫu.', 'success', 1400);
  });
  document.getElementById('qaDelete')?.addEventListener('click', () => {
    const target = sel();
    if (!target) { showToast('Chọn một mẫu để xóa.', 'warning'); return; }
    removeLayerWithUndo(state.currentView, target.id);
  });
}

/* ============================================================
   STICKER / CHI TIẾT TÙY Ý — thêm họa tiết nhỏ độc lập lên mặt áo
   đang xem. Mỗi sticker là 1 layer bình thường: kéo thả tự do,
   chỉnh scale/rotation/ẩn/xóa như mọi layer khác.
   ============================================================ */
function initStickerPicker() {
  const picker = document.getElementById('stickerPicker');
  if (!picker) return;
  const sideTag = document.getElementById('stickerSideTag');
  if (sideTag) sideTag.textContent = state.currentView === 'back' ? 'mặt sau' : 'mặt trước';
  picker.addEventListener('click', (e) => {
    const chip = e.target.closest('.sticker-chip');
    if (!chip) return;
    const glyph = chip.dataset.sticker;
    if (!glyph) return;
    addStickerLayer(state.currentView, glyph);
  });
}

function addStickerLayer(side, glyph) {
  // SVG data-URL, nền trong suốt — composite/overlay/3D đều dùng được.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><text x="128" y="128" font-size="190" text-anchor="middle" dominant-baseline="central">${glyph}</text></svg>`;
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  const layer = addLayer(side, {
    url,
    kind: 'sticker',
    name: `Chi tiết ${glyph}`,
    scale: 0.32,
  });
  if (!layer) return;
  // Mở panel chỉnh sửa + ẩn empty-state để layer hiển thị ngay trên khung áo.
  const panel = document.getElementById('placementPanel');
  if (panel) panel.style.display = 'block';
  const viewerEl = document.getElementById('canvasViewer');
  const emptyEl = document.getElementById('canvasEmpty');
  if (viewerEl) viewerEl.style.display = 'flex';
  if (emptyEl) emptyEl.style.display = 'none';
  refreshSideViews().then(() => {
    updatePrice();
    updateActionButtons(true);
    updateSideBadge();
    updateBackDesignControls();
  });
  showToast(`Đã thêm ${glyph} — kéo để đặt vị trí`, 'success', 1800);
}

/* ============================================================
   TEXT STYLE CONTROLS — font / hoa-thường / đậm / màu / nghiêng /
   gạch chân / viền / giãn chữ. Mọi thay đổi cập nhật overlay + composite
   (cache key gồm style nên decal 3D tự rebuild đúng).
   ============================================================ */
function syncTextStyleControls() {
  const st = getSideTextStyle();
  const fontSel = document.getElementById('textFontSelect');
  if (fontSel) fontSel.value = st.font;
  const weightSel = document.getElementById('textWeightSelect');
  if (weightSel) weightSel.value = String(st.weight);
  const colorIn = document.getElementById('textColorInput');
  if (colorIn) colorIn.value = st.color;
  const spacingEl = document.getElementById('textSpacing');
  if (spacingEl) spacingEl.value = String(st.spacing);
  const spacingOut = document.getElementById('textSpacingValue');
  if (spacingOut) spacingOut.textContent = `${Math.round(st.spacing)}%`;
  document.querySelectorAll('#textCaseGroup .text-case-btn').forEach(b => {
    const on = b.dataset.case === st.transform;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const map = { textItalicBtn: 'italic', textUnderlineBtn: 'underline', textStrokeBtn: 'stroke' };
  Object.entries(map).forEach(([id, key]) => {
    const b = document.getElementById(id);
    if (b) { b.classList.toggle('active', !!st[key]); b.setAttribute('aria-pressed', st[key] ? 'true' : 'false'); }
  });
  document.querySelectorAll('#textColorPresets .text-color-dot').forEach(d => {
    d.classList.toggle('active', (d.dataset.color || '').toLowerCase() === String(st.color).toLowerCase());
  });
  // PHASE 1: xoay + khóa chữ per side
  const rotEl = document.getElementById('textRotate');
  if (rotEl) rotEl.value = String(getSideTextRotation());
  const rotOut = document.getElementById('textRotateValue');
  if (rotOut) rotOut.textContent = `${Math.round(getSideTextRotation())}°`;
  const lockBtn = document.getElementById('textLockBtn');
  if (lockBtn) { lockBtn.classList.toggle('active', getSideTextLocked()); lockBtn.setAttribute('aria-pressed', getSideTextLocked() ? 'true' : 'false'); }
}

function initTextStyleControls() {
  const rerender = () => {
    updateDesignOverlayForSide();
    applyCurrentDesignToViewer();
  };
  const styleRerender = () => { pushDesignUndo('text-style'); syncTextStyleControls(); rerender(); };
  document.getElementById('textFontSelect')?.addEventListener('change', (e) => {
    commitSideTextStyle({ font: e.target.value });
    // Weight vượt cap của font mới → hạ về cap (Playfair không có 900).
    const cap = (TEXT_FONTS[e.target.value] || TEXT_FONTS.display).weightCap;
    if ((getSideTextStyle().weight || 0) > cap) commitSideTextStyle({ weight: cap });
    styleRerender();
  });
  document.getElementById('textWeightSelect')?.addEventListener('change', (e) => {
    commitSideTextStyle({ weight: clampNum(Number(e.target.value), 400, 900, 900) });
    styleRerender();
  });
  // Color input: 'input' live mượt (không đợi change).
  document.getElementById('textColorInput')?.addEventListener('input', (e) => {
    commitSideTextStyle({ color: e.target.value });
    styleRerender();
  });
  document.getElementById('textSpacing')?.addEventListener('input', (e) => {
    commitSideTextStyle({ spacing: clampNum(Number(e.target.value), 0, 30, 0) });
    styleRerender();
  });
  document.querySelectorAll('#textCaseGroup .text-case-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      commitSideTextStyle({ transform: btn.dataset.case || 'upper' });
      styleRerender();
      rerender();
    });
  });
  const toggleMap = { textItalicBtn: 'italic', textUnderlineBtn: 'underline', textStrokeBtn: 'stroke' };
  Object.entries(toggleMap).forEach(([id, key]) => {
    document.getElementById(id)?.addEventListener('click', () => {
      commitSideTextStyle({ [key]: !getSideTextStyle()[key] });
      styleRerender();
    });
  });
  /* GROUP MOVE toggle — "Kéo chung": ảnh + chữ di chuyển cùng lúc trên mọi
     đường kéo (overlay/canvas/nudge). Persist qua localStorage để giữ ý
     người dùng giữa các phiên thiết kế. */
  const gmt = document.getElementById('groupMoveToggle');
  if (gmt) {
    state.groupMoveMode = safeGet('blankup_group_move', '0') === '1';
    const paint = () => {
      gmt.classList.toggle('active', state.groupMoveMode);
      gmt.setAttribute('aria-pressed', state.groupMoveMode ? 'true' : 'false');
    };
    paint();
    gmt.addEventListener('click', () => {
      state.groupMoveMode = !state.groupMoveMode;
      safeSet('blankup_group_move', state.groupMoveMode ? '1' : '0');
      paint();
      showToast(state.groupMoveMode
        ? '⛓ Kéo chung BẬT — ảnh và chữ di chuyển cùng lúc.'
        : 'Kéo chung TẮT — ảnh và chữ di chuyển riêng.', 'info', 2200);
    });
  }
  document.querySelectorAll('#textColorPresets .text-color-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      commitSideTextStyle({ color: dot.dataset.color });
      styleRerender();
    });
  });
  // PHASE 1: xoay + khóa CHỮ (per side)
  document.getElementById('textRotate')?.addEventListener('input', (e) => {
    if (getSideTextLocked()) { showToast('Chữ đang khóa — mở khóa để xoay.', 'warning', 1600); e.target.value = getSideTextRotation(); paintSliderFills(); return; }
    commitTextRotation(state.currentView, Number(e.target.value ?? 0));
    commitActivePlacements();
    pushDesignUndo('text-rotate');
    updateOverlayPlacement();
    const tn = document.querySelector('#mockupDesign .mockup-print-text');
    if (tn) tn.style.transform = `translate(calc(-50% + ${state.textPlacement.x}%), calc(-50% + ${state.textPlacement.y}%)) scale(${state.textPlacement.scale}) rotate(${getSideTextRotation()}deg)`;
    scheduleViewerUpdateThrottled();
    refreshSelectionFrameSoon();
  });
  document.getElementById('textRotate')?.addEventListener('change', () => refreshSideViews());
  document.getElementById('textLockBtn')?.addEventListener('click', () => {
    const next = !getSideTextLocked();
    commitTextLocked(state.currentView, next);
    pushDesignUndo('lock');
    syncTextStyleControls();
    refreshSideViews();
    showToast(next ? 'Đã khóa chữ — chống sửa/di chuyển nhầm.' : 'Đã mở khóa chữ.', 'info', 1600);
  });
  syncTextStyleControls();
}

function nudgePlacement(layer, dx, dy) {
  if (state.groupMoveMode) {
    /* GROUP MOVE (kéo chung): mũi tên di chuyển ảnh + chữ CÙNG LÚC —
       đúng nghĩa "mẫu ảnh và chữ là một tổng thể" người dùng mong đợi.
       Mỗi thành phần vẫn bị clamp/snap theo biên riêng (không vượt vùng in). */
    let movedAny = false;
    const sel = getSelectedLayer();
    if (sel && !sel.locked) {
      sel.x = clampNum(sel.x + dx, ...LAYER_BOUNDS.x);
      sel.y = clampNum(sel.y + dy, ...LAYER_BOUNDS.y);
      movedAny = true;
    }
    if (getSideCustomText() && !getSideTextLocked()) {
      /* cùng chuẩn quy đổi composite như các đường kéo (0.58×scale; y ×h/w) */
      const sc = Number(sel?.scale) || 1;
      const nr = sel ? document.querySelector(`#mockupDesign img[data-layer-id="${CSS.escape(sel.id)}"]`)?.getBoundingClientRect() : null;
      const ar = nr && nr.width > 1 ? nr.height / nr.width : 1;
      state.textPlacement.x = clampNum(state.textPlacement.x + dx * 0.58 * sc, ...TEXT_BOUNDS.x);
      state.textPlacement.y = clampNum(state.textPlacement.y + dy * 0.58 * sc * ar, ...TEXT_BOUNDS.y);
      movedAny = true;
    }
    if (!movedAny) return;
    pushDesignUndo('nudge-group');
    commitActivePlacements();
    syncPlacementInputs();
    renderLayersOverlay();
    scheduleViewerUpdate();
    return;
  }
  if (layer === 'text') {
    if (getSideTextLocked()) { showToast('Chữ đang khóa — mở khóa để di chuyển.', 'warning', 1600); return; }
    state.textPlacement.x = clampNum(state.textPlacement.x + dx, ...TEXT_BOUNDS.x);
    state.textPlacement.y = clampNum(state.textPlacement.y + dy, ...TEXT_BOUNDS.y);
    pushDesignUndo('text-move');
  } else {
    const target = getSelectedLayer();
    if (!target) return;
    if (target.locked) { showToast(`"${target.name || 'Mẫu'}" đang khóa — mở khóa để di chuyển.`, 'warning', 1600); return; }
    target.x = clampNum(target.x + dx, ...LAYER_BOUNDS.x);
    target.y = clampNum(target.y + dy, ...LAYER_BOUNDS.y);
    pushDesignUndo('nudge');
  }
  commitActivePlacements();
  syncPlacementInputs();
  renderLayersOverlay();
  scheduleViewerUpdate();
}

/* ============================================================
   GROUP MOVE ("Kéo chung") — ảnh + chữ di chuyển như MỘT tổng thể.
   Slogan và artwork là 2 thực thể riêng trong kiến trúc hiện tại
   (per-side text vs layer list) nên không gộp state được; thay vào đó
   mọi đường kéo (overlay image / overlay text / canvas) khi bật chế độ
   này sẽ cộng CÙNG delta cho cả hai, mỗi bên vẫn clamp theo biên riêng
   và có snap riêng. 1 gesture = 1 undo entry (beginDesignUndoBatch
   đã bao phủ cả đường overlay lẫn canvas).
   ============================================================ */
function groupMoveEnabled() { return state.groupMoveMode === true; }

/* Dịch cả ảnh đang chọn + chữ cùng một delta (đã tính theo % vùng in).
   Trả về vị trí thật sau clamp để caller dùng cho preview/snap. */
function applyGroupMoveDelta(dx, dy) {
  const moved = { image: null, text: null };
  const sel = getSelectedLayer();
  if (sel && !sel.locked) {
    sel.x = clampNum(sel.x + dx, ...LAYER_BOUNDS.x);
    sel.y = clampNum(sel.y + dy, ...LAYER_BOUNDS.y);
    moved.image = { x: sel.x, y: sel.y };
  }
  if (getSideCustomText() && !getSideTextLocked()) {
    /* % chữ quy đổi từ % ảnh theo chuẩn composite: ×0.58×scale (x), y ×(h/w) */
    const sc = Number(sel?.scale) || 1;
    const nr = sel ? document.querySelector(`#mockupDesign img[data-layer-id="${CSS.escape(sel.id)}"]`)?.getBoundingClientRect() : null;
    const ar = nr && nr.width > 1 ? nr.height / nr.width : 1;
    state.textPlacement.x = clampNum(state.textPlacement.x + dx * 0.58 * sc, ...TEXT_BOUNDS.x);
    state.textPlacement.y = clampNum(state.textPlacement.y + dy * 0.58 * sc * ar, ...TEXT_BOUNDS.y);
    moved.text = { x: state.textPlacement.x, y: state.textPlacement.y };
  }
  return moved;
}

function isTextLockedForDrag() { return getSideCustomText() && getSideTextLocked(); }

/* ============================================================
   MULTI-DESIGN LAYERS — independent entities per garment side
   ============================================================ */
const LAYER_BOUNDS = { x: [-115, 115], y: [-110, 80], scale: [0.1, 2.6], rotation: [0, 360] };
// Bounds slider placement chữ (khớp min/max trong studio.html)
// Biên chữ được siết để TÂM chữ luôn nằm trong vùng in (composite dùng
// cx = size*(0.5 + x/100)): ngoài khoảng này chữ sẽ nằm hoàn toàn ngoài
// composite → biến mất khỏi 3D/print/order dù overlay 2D vẫn vẽ.
const TEXT_BOUNDS = { x: [-48, 48], y: [-48, 45], scale: [0.3, 2.6] };

function clampNum(v, min, max, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function layerUid(prefix) {
  return (prefix || 'layer') + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
}

function sideLayers(side) {
  const k = side === 'back' ? 'back' : 'front';
  if (!state.designLayers) state.designLayers = { front: [], back: [] };
  if (!Array.isArray(state.designLayers[k])) state.designLayers[k] = [];
  return state.designLayers[k];
}

function sanitizeLayer(l) {
  l.x = clampNum(l.x, ...LAYER_BOUNDS.x);
  l.y = clampNum(l.y, ...LAYER_BOUNDS.y);
  l.scale = clampNum(l.scale, ...LAYER_BOUNDS.scale, 1);
  l.rotation = clampNum(l.rotation, ...LAYER_BOUNDS.rotation);
  l.visible = l.visible !== false;
  l.locked = l.locked === true; // layer khóa: select được nhưng không sửa được
  l.opacity = clampNum(l.opacity, 0, 1, 1); // 0..1 — composite + overlay + 3D đồng bộ
  l.flipH = l.flipH === true; // PRO EDIT: lật ngang (mirror) — non-destructive
  l.flipV = l.flipV === true; // PRO EDIT: lật dọc — non-destructive
  if (!Number.isFinite(l.z)) l.z = 0;
  // Non-destructive crop state (tỉ lệ vùng gốc): 1 = toàn ảnh. Không bao giờ
  // phá asset gốc — chỉ là state re-editable.
  if (!l.crop || typeof l.crop !== 'object') l.crop = null;
  else {
    l.crop.x = clampNum(l.crop.x, 0, 1, 0); l.crop.y = clampNum(l.crop.y, 0, 1, 0);
    l.crop.w = clampNum(l.crop.w, 0.05, 1, 1); l.crop.h = clampNum(l.crop.h, 0.05, 1, 1);
    if (l.crop.w >= 1 && l.crop.h >= 1 && !l.crop.x && !l.crop.y) l.crop = null;
  }
  if (typeof l.name !== 'string') l.name = '';
  clampLayerToPrintArea(l);
  return l;
}

/* VÙNG IN — NGUYÊN TẮC "ẢNH NGUYÊN VẸN": ảnh luôn nằm TRỌN VÙNG IN,
   KHÔNG BAO GIỜ bị khuất mép (lỗi cũ: cho phép tâm ảnh tràn tới 45% gần biên
   → kéo tới biên thì một phần ảnh bị cắt ngoài vùng in, trông như bị khuất).
   Composite in là canvas 1024: ảnh chiếm 58% * scale kích thước, tâm dọc 44%.
   Áp cho MỌI đường di chuyển: kéo overlay, kéo canvas, slider, nudge, wheel,
   restore từ history. Bounds trả về qua getLayerLimits() để boundary UI
   (khung giới hạn + HUD) biết chính xác biên hiện tại. */
function layerPrintLimits(layer) {
  const isImage = !!(layer && layer.url);
  const s = Math.max(0.01, Number(layer?.scale) || 1);
  /* GIỚI HẠN THEO MÉP OBJECT — fix "đi sát viền áo thì bị khuất":
     Đơn vị layer.x/y = % COMPOSITE (cx = 1024·(0.5 + x/100); ảnh tâm dọc
     0.44, chữ 0.5). printSizeToUnits trả hx/hy = FULL width/height %
     composite → NỬA kích thước trong hệ x/y = hx/2, hy/2.
     Ràng buộc mép object nằm trọn trong [0,1024]:
       X: |x| ≤ 50 − halfW
       ảnh Y: y ∈ [halfH − 44, 56 − halfH]   (tâm dọc 44%)
       chữ Y: y ∈ [halfH − 50, 50 − halfH]   (tâm dọc 50%)
     → object LUÔN in được 100%, kéo tới đâu thấy nấy, không bị cắt. */
  let halfW = 29 * s, halfH = 29 * s; // fallback: nửa khung 58%·scale (ảnh vuông)
  try {
    const { hx, hy } = isImage ? printSizeToUnits('image', layer) : printSizeToUnits('text', null);
    if (hx > 0) halfW = hx / 2;
    if (hy > 0) halfH = hy / 2;
  } catch (e) { /* fallback đã đặt */ }
  const mX = Math.max(4, 50 - halfW);
  const yCenter = isImage ? 44 : 50;
  const minY = Math.min(-4, halfH - yCenter);
  const maxY = Math.max(4, (100 - yCenter) - halfH);
  return { minX: -mX, maxX: mX, minY, maxY, half: Math.max(halfW, halfH), soft: false };
}
function clampLayerToPrintArea(layer) {
  if (!layer) return layer;
  const lim = layerPrintLimits(layer);
  layer.x = clampNum(layer.x, lim.minX, lim.maxX);
  layer.y = clampNum(layer.y, lim.minY, lim.maxY);
  return layer;
}

function getSelectedLayer(side = state.currentView) {
  const layers = sideLayers(side).filter(l => l.visible !== false);
  if (!layers.length) return null;
  const k = side === 'back' ? 'back' : 'front';
  const sel = layers.find(l => l.id === state.selectedLayerId[k]);
  if (sel) return sel;
  return [...layers].sort((a, b) => b.z - a.z)[0];
}

function syncCurrentDesignFromSelection(side = state.currentView) {
  // Compatibility: share/order/download read state.currentDesign.
  // It mirrors the SELECTED layer's metadata (never merges layers).
  const sel = getSelectedLayer(side);
  if (!sel) return;
  state.currentDesign = {
    success: true,
    designId: sel.designId || ('layer-' + sel.id),
    designUrl: sel.url,
    frontDesignUrl: sel.url,
    backDesignUrl: '',
    prompt: sel.prompt || '',
    style: sel.style || 'minimalist',
    author: 'You',
  };
}

/* PHASE 5 COMPLETION — bảo vệ shape của selection state.
   Mọi writer/reader dùng state.selectedLayerId như OBJECT {front, back}. Nếu
   giá trị bị ghi đè thành string (dữ liệu cũ/legacy, hoặc bất kỳ caller nào
   gán nhầm), thì `state.selectedLayerId[k] = id` trở thành no-op im lặng trên
   string primitive → "thêm xong không được chọn" mà không có lỗi nào. Chuẩn
   hoá 1 lần để lỗi này không thể tái diễn. */
function ensureSelectionShape() {
  if (state.selectedLayerId && typeof state.selectedLayerId === 'object') return;
  const legacy = typeof state.selectedLayerId === 'string' ? state.selectedLayerId : null;
  state.selectedLayerId = { front: null, back: null };
  if (legacy) state.selectedLayerId[state.currentView] = legacy;
}

function selectLayer(side, id) {
  ensureSelectionShape();
  const k = side === 'back' ? 'back' : 'front';
  const layers = sideLayers(k);
  if (id != null && !layers.some(l => l.id === id)) return null;
  // Layer khóa vẫn CHỌN được (xem/kéo danh sách) nhưng không kéo/sửa transform.
  state.selectedLayerId[k] = id;
  const sel = getSelectedLayer(k);
  if (sel) {
    // Mirror selection into legacy single-placement buffer for inputs.
    state.printPlacement = { x: sel.x, y: sel.y, scale: sel.scale };
    syncCurrentDesignFromSelection(k);
  }
  syncPlacementInputs();
  syncPresetChips();
  renderLayersOverlay();
  renderLayerList();
  return sel;
}

function addLayer(side, { url, name, designId, prompt, style, x, y, scale, rotation, assetId, kind, opacity, locked, visible, z, crop } = {}) {
  if (!url) return null;
  ensureSelectionShape(); // layer mới luôn phải ghi được vào selection state
  const k = side === 'back' ? 'back' : 'front';
  const layers = sideLayers(k);
  const maxZ = layers.reduce((m, l) => Math.max(m, Number(l.z) || 0), 0);
  // Cascade spawn: layer mới KHÔNG đè lên layer cũ. Khi caller không chỉ định
  // vị trí, rải theo đường chéo quanh tâm ngực (0,-12) — cùng vị trí lặp lại
  // sau 4 mẫu để không trôi vô hạn ra ngoài vùng in.
  const SPAWN_X = [0, 20, -20, 8];
  const SPAWN_Y = [-12, -4, -4, -26];
  const spawnIdx = layers.length % SPAWN_X.length;
  const layer = sanitizeLayer({
    id: layerUid('layer'),
    url,
    kind: kind || 'image',
    assetId: assetId || null,
    x: x !== undefined ? x : SPAWN_X[spawnIdx],
    y: y !== undefined ? y : SPAWN_Y[spawnIdx],
    scale: scale !== undefined ? scale : 1,
    rotation: rotation !== undefined ? rotation : 0,
    opacity: opacity !== undefined ? opacity : 1,
    locked: locked === true,
    visible: visible !== false,
    z: z !== undefined ? z : maxZ + 1,
    name: name || `Mẫu ${layers.length + 1}`,
    designId: designId || null,
    prompt: prompt || '',
    style: style || 'minimalist',
    crop: crop ? { x: crop.x || 0, y: crop.y || 0, w: crop.w || 1, h: crop.h || 1 } : null, // PHASE 2: duplicate giữ crop ban đầu (sanitize bên dưới)
    createdAt: Date.now(),
  });
  layers.push(layer);
  state.selectedLayerId[k] = layer.id;
  state.printPlacement = { x: layer.x, y: layer.y, scale: layer.scale };
  syncCurrentDesignFromSelection(k);
  pushDesignUndo('add'); // MỌI đường thêm layer (AI/upload/sticker/duplicate) = 1 entry undo
  return layer;
}

/**
 * Place an uploaded asset (kind='asset') onto the current side as a new layer.
 * Called when user clicks "Đặt lên áo" in upload preview.
 */
function placeUploadedAsset(assetId) {
  const asset = state.assetLibrary?.find(a => a.assetId === assetId);
  if (!asset) {
    if (window.showToast) window.showToast('Không tìm thấy asset', 'warning');
    return null;
  }
  // Guard: only place assets of kind 'asset', not 'reference'
  if (asset.kind !== 'asset') {
    if (window.showToast) window.showToast('Chỉ có thể đặt decal từ ảnh upload (không phải tham chiếu AI)', 'warning');
    return null;
  }
  const side = state.currentView;
  const layer = addLayer(side, {
    url: asset.url,
    assetId: asset.assetId,
    kind: 'asset',
    name: asset.name,
  });
  if (layer) {
    if (window.showToast) window.showToast(`Đã thêm "${asset.name}" lên mặt ${side === 'front' ? 'trước' : 'sau'}`, 'success');
    // Refresh views to show new layer
    refreshSideViews().then(() => {
      updatePrice();
      updateActionButtons(true);
      updateSideBadge();
      updateBackDesignControls();
    });
  }
  return layer;
}

function removeLayer(side, id) {
  const k = side === 'back' ? 'back' : 'front';
  const layers = sideLayers(k);
  const idx = layers.findIndex(l => l.id === id);
  if (idx === -1) return false;
  layers.splice(idx, 1);
  // Renormalize z to keep order dense.
  [...layers].sort((a, b) => a.z - b.z).forEach((l, i) => { l.z = i + 1; });
  if (state.selectedLayerId[k] === id) state.selectedLayerId[k] = null;
  return true;
}

function moveLayerZ(side, id, dir) {
  const layers = [...sideLayers(side)].sort((a, b) => a.z - b.z);
  const idx = layers.findIndex(l => l.id === id);
  const j = idx + dir;
  if (idx === -1 || j < 0 || j >= layers.length) return false;
  const [moved] = layers.splice(idx, 1);
  layers.splice(j, 0, moved);
  layers.forEach((l, i) => { l.z = i + 1; });
  return true;
}

function replaceLayerUrl(side, id, url) {
  const layer = sideLayers(side).find(l => l.id === id);
  if (!layer || !url) return false;
  layer.url = url;
  return true;
}

function clearSideLayers(side) {
  const k = side === 'back' ? 'back' : 'front';
  state.designLayers[k] = [];
  state.selectedLayerId[k] = null;
}

function hasLayerDesigns(side) {
  return sideLayers(side).some(l => l.visible !== false && l.url);
}

/* ============================================================
   UNDO / REDO — history toàn diện của mọi thao tác thay đổi design:
   add/delete/move/resize/rotate/opacity/crop/lock/visibility/reorder/
   rename/replace/text-style/text-content/alignment/clear-side.
   Mỗi entry = 1 SNAPSHOT JSON toàn bộ design (cả 2 mặt + text) — đơn giản,
   bất biến, không bao giờ lệch state. Coalescing: các commit liên tiếp
   trong ~350ms cùng một label (VD kéo slider/đang kéo chuột) gộp thành
   MỘT entry — không phình history khi drag liên tục, không memory leak.
   ============================================================ */
const DESIGN_UNDO_LIMIT = 80;
const DESIGN_UNDO_STACKS = { undo: [], redo: [] };
let designUndoGroup = null;    // { label, until } — nhóm thao tác liên tục đang mở
let designUndoLast = null;     // snapshot sau commit gần NHẤT (= "trước" của thay đổi kế tiếp)
let designUndoSuppressed = 0;  // >0: tạm ngưng ghi history (restore nhiều layer = 1 entry)

function designSnapshot() {
  const dump = (side) => sideLayers(side).map((l) => ({
    id: l.id, url: l.url, kind: l.kind, assetId: l.assetId,
    x: l.x, y: l.y, scale: l.scale, rotation: l.rotation || 0,
    visible: l.visible !== false, locked: l.locked === true,
    opacity: Number(l.opacity) || 0, z: l.z, name: l.name,
    designId: l.designId || null, prompt: l.prompt || '', style: l.style || 'minimalist',
    crop: l.crop ? { ...l.crop } : null, createdAt: l.createdAt || 0,
    flipH: l.flipH === true, flipV: l.flipV === true,
  }));
  return JSON.stringify({
    front: dump('front'), back: dump('back'),
    selected: { front: state.selectedLayerId.front, back: state.selectedLayerId.back },
    customText: state.customText, customTextSides: state.customTextSides,
    sideTextPlacement: state.sideTextPlacement, sideTextStyle: state.sideTextStyle,
    sideTextLocked: state.sideTextLocked,
  });
}

/* Ghi 1 entry undo. Gọi SAU khi thay đổi đã xảy ra. "Trước" = snapshot của
   commit gần nhất (designUndoLast) — luôn đồng bộ vì MỌI đường thay đổi đều
   push. Coalescing: các push cùng label trong cửa sổ 350ms (đang kéo liên tục)
   gộp thành 1 entry — không phình history khi drag/slider liên tục. */
function pushDesignUndo(label = 'edit') {
  if (designUndoSuppressed > 0) return;
  const snap = designSnapshot();
  const now = Date.now();
  if (designUndoGroup && designUndoGroup.label === label && now < designUndoGroup.until) {
    designUndoGroup.until = now + 350; // nhóm liên tục — entry trước nhóm đã nằm trong stack
    return;
  }
  const pre = designUndoLast;
  designUndoLast = snap;
  designUndoGroup = { label, until: now + 350 };
  if (pre != null && pre !== snap) {
    DESIGN_UNDO_STACKS.undo.push(pre);
    if (DESIGN_UNDO_STACKS.undo.length > DESIGN_UNDO_LIMIT) DESIGN_UNDO_STACKS.undo.shift();
    DESIGN_UNDO_STACKS.redo.length = 0;
    updateUndoRedoButtons();
  }
}

/* Gọi TRƯỚC một thao tác có cấu trúc (pointerdown, batch): đóng nhóm cũ để
   push kế tiếp luôn tạo entry mới với "trước" = designUndoLast (đúng trạng
   thái trước thao tác, vì giữa 2 commit không có thay đổi nào khác). */
function beginDesignUndoBatch(label) {
  void label;
  designUndoGroup = null;
}

/* Gộp nhiều mutation nhỏ thành 1 entry undo (VD khôi phục design từ history). */
function withDesignUndoSuppressed(fn) {
  designUndoSuppressed++;
  try { return fn(); }
  finally { designUndoSuppressed--; }
}

function applyDesignSnapshot(json) {
  let d;
  try { d = JSON.parse(json); } catch { return false; }
  if (!d || typeof d !== 'object') return false;
  const restoreSide = (side, arr) => {
    state.designLayers[side] = (Array.isArray(arr) ? arr : []).map((l) => sanitizeLayer({ ...l }));
  };
  restoreSide('front', d.front); restoreSide('back', d.back);
  state.selectedLayerId.front = d.selected?.front ?? null;
  state.selectedLayerId.back = d.selected?.back ?? null;
  if (typeof d.customText === 'string') state.customText = d.customText;
  if (d.customTextSides) state.customTextSides = { ...state.customTextSides, ...d.customTextSides };
  if (d.sideTextPlacement) state.sideTextPlacement = { ...state.sideTextPlacement, ...d.sideTextPlacement };
  if (d.sideTextStyle) state.sideTextStyle = { ...state.sideTextStyle, ...d.sideTextStyle };
  if (d.sideTextLocked) state.sideTextLocked = { ...state.sideTextLocked, ...d.sideTextLocked };
  const k = sideKey();
  state.printPlacement = { ...getSidePrintPlacement(k) };
  state.textPlacement = { ...getSideTextPlacement(k) };
  loadPlacementsForSide(k);
  state.compositeCacheKey = '';
  designUndoLast = designSnapshot(); // baseline khớp trạng thái vừa khôi phục
  designUndoGroup = null;
  // UI sync đầy đủ sau undo/redo — một nguồn refresh duy nhất.
  refreshSideViews();
  syncCustomTextInputs();
  syncTextStyleControls();
  updatePrice();
  updateActionButtons(true);
  updateBackDesignControls();
  return true;
}

function undoDesign() {
  if (!DESIGN_UNDO_STACKS.undo.length) { showToast('Không còn gì để hoàn tác.', 'info', 1400); return false; }
  const cur = designSnapshot(); // trạng thái HIỆN TẠI thật — không tin baseline
  const snap = DESIGN_UNDO_STACKS.undo.pop();
  DESIGN_UNDO_STACKS.redo.push(cur);
  designUndoGroup = null;
  applyDesignSnapshot(snap);
  updateUndoRedoButtons();
  showToast('Đã hoàn tác.', 'info', 1400);
  return true;
}

function redoDesign() {
  if (!DESIGN_UNDO_STACKS.redo.length) { showToast('Không còn gì để làm lại.', 'info', 1400); return false; }
  const cur = designSnapshot();
  const snap = DESIGN_UNDO_STACKS.redo.pop();
  DESIGN_UNDO_STACKS.undo.push(cur);
  designUndoGroup = null;
  applyDesignSnapshot(snap);
  updateUndoRedoButtons();
  showToast('Đã làm lại.', 'info', 1400);
  return true;
}

function updateUndoRedoButtons() {
  const u = document.getElementById('undoDesignBtn');
  const r = document.getElementById('redoDesignBtn');
  if (u) u.disabled = !DESIGN_UNDO_STACKS.undo.length;
  if (r) r.disabled = !DESIGN_UNDO_STACKS.redo.length;
}

function initDesignUndoRedo() {
  // Baseline ban đầu = design rỗng hiện tại → hành động add ĐẦU TIÊN cũng
  // undo được (trả về trạng thái trước khi có mẫu).
  if (designUndoLast == null) designUndoLast = designSnapshot();
  document.getElementById('undoDesignBtn')?.addEventListener('click', undoDesign);
  document.getElementById('redoDesignBtn')?.addEventListener('click', redoDesign);
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
    // CROP MODE shortcuts: Enter = Apply · Esc = Cancel (chuẩn editor chuyên nghiệp)
    if (isCropMode()) {
      if (e.key === 'Enter') { e.preventDefault(); exitCropMode({ apply: true }); return; }
      if (e.key === 'Escape') { e.preventDefault(); exitCropMode({ apply: false }); showToast('Đã hủy cắt — giữ nguyên crop trước đó.', 'info', 1500); return; }
      if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) {
        e.preventDefault(); showToast('Undo/Redo bị tạm ngưng trong Crop Mode — Apply/Hủy trước.', 'warning', 2000); return;
      }
    }
    const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z';
    const isRedo = ((e.ctrlKey || e.metaKey) && (e.shiftKey && e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y'));
    const isDel = (e.key === 'Delete' || e.key === 'Backspace');
    const isDup = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd';
    if (isUndo) { e.preventDefault(); undoDesign(); return; }
    if (isRedo) { e.preventDefault(); redoDesign(); return; }
    if (isDup) {
      const sel = getSelectedLayer();
      if (sel) { e.preventDefault(); duplicateLayer(state.currentView, sel.id); }
      return;
    }
    if (isDel) {
      const sel = getSelectedLayer();
      if (sel && sel.locked) { showToast('Mẫu đang bị khóa — mở khóa để xóa.', 'warning'); e.preventDefault(); return; }
      if (sel) { e.preventDefault(); removeLayerWithUndo(state.currentView, sel.id); }
    }
  });
  updateUndoRedoButtons();
}

/* Delete có bảo vệ: layer khóa không xóa được; mọi xóa đều undo được. */
function removeLayerWithUndo(side, id) {
  const layer = sideLayers(side).find(l => l.id === id);
  if (!layer) return false;
  if (layer.locked) { showToast('Mẫu đang bị khóa — bấm 🔓 trong danh sách lớp để mở khóa trước.', 'warning'); return false; }
  beginDesignUndoBatch('delete');
  removeLayer(side, id);
  const k = side === 'back' ? 'back' : 'front';
  if (!getSelectedLayer(k) && sideLayers(k).length) {
    selectLayer(k, [...sideLayers(k)].sort((a, b) => b.z - a.z)[0].id);
  }
  pushDesignUndo('delete');
  refreshSideViews();
  showToast(`Đã xóa "${layer.name || 'mẫu'}" — Ctrl+Z để hoàn tác.`, 'info', 2200);
  return true;
}

/* Duplicate: layer MỚI hoàn toàn (id/transform/z riêng) — không dính gốc.
   Toàn bộ thuộc tính truyền qua addLayer (1 mutation = 1 entry undo). */
function duplicateLayer(side, id) {
  const src = sideLayers(side).find(l => l.id === id);
  if (!src) return null;
  beginDesignUndoBatch('duplicate');
  const created = addLayer(side, {
    url: src.url, name: (src.name || 'Mẫu') + ' (bản sao)',
    designId: src.designId, prompt: src.prompt, style: src.style,
    assetId: src.assetId, kind: src.kind,
    x: src.x + 6, y: src.y + 4, scale: src.scale, rotation: src.rotation || 0,
    opacity: Number(src.opacity) || 1,
    crop: src.crop ? { ...src.crop } : null,
    flipH: src.flipH === true, flipV: src.flipV === true,
  });
  if (created) {
    refreshSideViews();
    showToast(`Đã nhân bản "${src.name || 'mẫu'}" — chỉnh bản sao không ảnh hưởng gốc.`, 'success', 2000);
  }
  return created;
}

/* ============================================================
   PHASE 2 — CROP MODE (professional non-destructive crop/reframe)
   Hai mode tách bạch tuyệt đối:
   • NORMAL: move/resize/rotate trực tiếp (selection frame Phase 1)
   • CROP: khung cắt + reframe + Apply/Cancel — KHÔNG đổi x/y/scale/rotation
   Temporary state riêng (state.cropSession), chỉ Apply mới commit vào
   layer.crop → composite → 3D → undo (1 entry). Cancel = 0 entry.
   Crop là state trên layer: asset gốc KHÔNG BAO GIỜ bị sửa.
   ============================================================ */
const CROP_MIN = 0.06; // minCropWidth = minCropHeight = 6% ảnh gốc (sanitize cho phép 5%)

function isCropMode() { return state.cropMode === true; }

function enterCropMode() {
  if (isCropMode()) return;
  if (state.interactionMode !== 'position') setInteractionMode('position');
  if (state.activePlacementLayer === 'text' && getSideCustomText()) { showToast('Crop chỉ áp dụng cho mẫu ảnh — chữ/slogan không hỗ trợ cắt.', 'warning', 2400); return; }
  const sel = getSelectedLayer();
  if (!sel) { showToast('Chọn một mẫu ảnh để cắt.', 'warning', 2200); return; }
  if (sel.locked) { showToast(`"${sel.name || 'Mẫu'}" đang khóa — mở khóa để cắt.`, 'warning', 2000); return; }
  if (!sel.url) { showToast('Mẫu này không có ảnh để cắt.', 'warning'); return; }
  state.cropMode = true;
  // Re-edit: mở ĐÚNG crop hiện tại (không reset về full) — Crop Again = previous frame.
  const c = (sel.crop && sel.crop.w > 0 && sel.crop.h > 0) ? { x: sel.crop.x, y: sel.crop.y, w: sel.crop.w, h: sel.crop.h } : { x: 0, y: 0, w: 1, h: 1 };
  state.cropSession = { layerId: sel.id, side: state.currentView, draft: c, orig: c ? { ...c } : null };
  document.body.classList.add('crop-mode-active');
  const tb = document.getElementById('cropToolbar');
  const hint = document.getElementById('cropToolbarHint');
  if (tb) tb.hidden = false;
  if (hint) hint.hidden = false;
  ensureCropFrame();
  updateCropFrameFromSession();
  syncCropModeUI();
  showToast('Crop Mode: kéo góc để định vùng giữ, kéo ảnh bên trong để reframe.', 'info', 2600);
}

function exitCropMode({ apply = false, silent = false } = {}) {
  if (!isCropMode()) return;
  const session = state.cropSession;
  state.cropMode = false;
  state.cropSession = null;
  document.body.classList.remove('crop-mode-active');
  destroyCropFrame();
  const tb = document.getElementById('cropToolbar');
  const hint = document.getElementById('cropToolbarHint');
  if (tb) tb.hidden = true;
  if (hint) hint.hidden = true;
  if (apply && session) {
    const layer = sideLayers(session.side || state.currentView).find(l => l.id === session.layerId);
    if (layer) {
      const d = sanitizeCropRect(session.draft);
      const full = d.w >= 1 - 1e-6 && d.h >= 1 - 1e-6 && d.x <= 1e-6 && d.y <= 1e-6;
      layer.crop = full ? null : d;
      // commit chuỗi chuẩn: chokepoint → cache key → 3D (tôn trọng mọi pipeline hiện có)
      commitActivePlacements();
      pushDesignUndo('crop'); // ĐÚNG 1 logical entry cho cả phiên crop (suppressed các đường live)
      refreshSideViews();
    }
  }
  syncCropModeUI();
  if (!silent && !apply) { /* cancel path */ }
}

function sanitizeCropRect(c) {
  const cl = (v, a, b, f) => (Number.isFinite(Number(v)) ? Math.min(b, Math.max(a, Number(v))) : f);
  const x = cl(c?.x, 0, 1, 0), y = cl(c?.y, 0, 1, 0);
  const w = cl(c?.w, CROP_MIN, 1 - x, 1), h = cl(c?.h, CROP_MIN, 1 - y, 1);
  return { x: +x.toFixed(4), y: +y.toFixed(4), w: +w.toFixed(4), h: +h.toFixed(4) };
}

function isCropTarget(layer) {
  if (!isCropMode() || !state.cropSession) return false;
  return state.cropSession.layerId === layer.id && (state.cropSession.side || state.currentView) === state.currentView;
}

/* ---- CROP FRAME: dựng 1 lần, cập nhật bằng style (không rebuild khi kéo) ---- */
function ensureCropFrame() {
  if (cropFrame.el && document.contains(cropFrame.el)) return cropFrame.el;
  const viewer = document.getElementById('canvasViewer');
  if (!viewer) return null;
  const el = document.createElement('div');
  el.className = 'crop-frame';
  el.innerHTML = `
    <div class="crop-img-holder">
      <img class="crop-img" alt="" draggable="false">
      <div class="crop-dim"></div>
      <div class="crop-window">
        <span class="crop-c" data-crop="nw"></span>
        <span class="crop-c" data-crop="ne"></span>
        <span class="crop-c" data-crop="sw"></span>
        <span class="crop-c" data-crop="se"></span>
        <span class="crop-e" data-crop="n"></span>
        <span class="crop-e" data-crop="s"></span>
        <span class="crop-e" data-crop="w"></span>
        <span class="crop-e" data-crop="e"></span>
      </div>
    </div>
    <span class="crop-badge">CROP</span>`;
  viewer.appendChild(el);
  cropFrame.el = el;
  cropFrame.img = el.querySelector('.crop-img');
  cropFrame.dim = el.querySelector('.crop-dim');
  cropFrame.win = el.querySelector('.crop-window');
  wireCropFrame(el);
  return el;
}

function destroyCropFrame() {
  cropFrame.el?.remove();
  cropFrame.el = null; cropFrame.img = null; cropFrame.dim = null; cropFrame.win = null;
}

/* Áp draft vào frame: holder = TOÀN BỘ ảnh gốc (đúng transform layer),
   window = vùng giữ (crop draft) — image ĐẦY ĐỦ nhìn thấy để reframe.
   Anchor ưu tiên PROJECTION 3D (bám decal khi áo xoay) → node overlay 2D. */
function updateCropFrameFromSession() {
  const el = ensureCropFrame();
  const session = state.cropSession;
  if (!el || !session) return;
  const layer = sideLayers(session.side || state.currentView).find(l => l.id === session.layerId);
  if (!layer) { exitCropMode({ silent: true }); return; }
  if (cropFrame.img.dataset.layerId !== layer.id) {
    cropFrame.img.src = layer.url; cropFrame.img.dataset.layerId = layer.id;
  }
  // Geometry gốc hiển thị (chưa xoay) + center + rotation.
  const geo = cropAnchorGeometry(layer);
  if (!geo) { cropFrame.el.classList.remove('active'); stopCropTracking(); return; }
  const d = sanitizeCropRect(session.draft);
  // Holder phủ đúng toàn bộ ảnh gốc (rect chưa xoay quanh tâm).
  cropFrame.el.classList.add('active');
  el.style.width = `${geo.w}px`;
  el.style.height = `${geo.h}px`;
  el.style.left = `${geo.cx}px`;
  el.style.top = `${geo.cy}px`;
  el.style.transform = `translate(-50%, -50%) rotate(${layer.rotation || 0}deg)`;
  // Cửa sổ giữ = vùng draft trong hệ ảnh gốc (top-left anchored).
  cropFrame.win.style.left = `${d.x * 100}%`;
  cropFrame.win.style.top = `${d.y * 100}%`;
  cropFrame.win.style.width = `${d.w * 100}%`;
  cropFrame.win.style.height = `${d.h * 100}%`;
  // Dim mask theo cùng draft (CSS vars cho clip-path evenodd).
  if (cropFrame.dim) {
    cropFrame.dim.style.setProperty('--cx', `${d.x * 100}%`);
    cropFrame.dim.style.setProperty('--cy', `${d.y * 100}%`);
    cropFrame.dim.style.setProperty('--cw', `${d.w * 100}%`);
    cropFrame.dim.style.setProperty('--ch', `${d.h * 100}%`);
  }
  cropFrame.el.dataset.cropping = '1';
  startCropTracking();
}

/* Anchor 3D/projection trước, 2D node fallback — y hệt selectionGeometry. */
function cropAnchorGeometry(layer) {
  const viewer = document.getElementById('canvasViewer');
  if (!viewer) return null;
  const vr = viewer.getBoundingClientRect();
  const rot = Number(layer.rotation) || 0;
  const V = window.tshirt360Viewer;
  if (viewer.classList.contains('has-real-3d') && V?.screenPosFromPrintPoint) {
    const { hx, hy } = printSizeToUnits('image', layer);
    const pC = V.screenPosFromPrintPoint(layer.x, layer.y, state.currentView);
    const pA = V.screenPosFromPrintPoint(layer.x + hx, layer.y, state.currentView);
    const pB = V.screenPosFromPrintPoint(layer.x - hx, layer.y, state.currentView);
    const pCv = V.screenPosFromPrintPoint(layer.x, layer.y + hy, state.currentView);
    const pD = V.screenPosFromPrintPoint(layer.x, layer.y - hy, state.currentView);
    if (pC && pA && pB && pCv && pD) {
      return { w: Math.max(12, Math.hypot(pA.x - pB.x, pA.y - pB.y)), h: Math.max(12, Math.hypot(pCv.x - pD.x, pCv.y - pD.y)), cx: pC.x - vr.left, cy: pC.y - vr.top, rot };
    }
  }
  const node = document.querySelector(`#mockupDesign img[data-layer-id="${CSS.escape(layer.id)}"]`);
  if (node) {
    const s = Math.max(0.01, Number(layer.scale) || 1);
    const rect = node.getBoundingClientRect();
    if (rect.width > 2) {
      try {
        const m = new DOMMatrixReadOnly(getComputedStyle(node).transform);
        const sc = Math.hypot(m.a, m.b) || s;
        return { w: rect.width / sc, h: rect.height / sc, cx: rect.left + rect.width / 2 - vr.left, cy: rect.top + rect.height / 2 - vr.top, rot };
      } catch (e) { /* */ }
    }
  }
  return null;
}

/* Camera 3D động (lerp/auto-rotate) → frame phải bám liên tục như selection frame. */
let cropTrackRaf = 0;
function stopCropTracking() { if (cropTrackRaf) { cancelAnimationFrame(cropTrackRaf); cropTrackRaf = 0; } }
function startCropTracking() {
  if (cropTrackRaf) return;
  const tick = () => {
    cropTrackRaf = requestAnimationFrame(tick);
    if (!isCropMode()) { stopCropTracking(); return; }
    updateCropFrameFromSession();
  };
  cropTrackRaf = requestAnimationFrame(tick);
}

/* ---- Crop frame interaction: corner/edge = resize draft · drag inside = REFRAME ---- */
function wireCropFrame(el) {
  el.addEventListener('pointerdown', (e) => {
    if (!isCropMode()) return;
    e.stopPropagation(); e.preventDefault();
    const session = state.cropSession;
    if (!session) return;
    const layer = sideLayers(session.side || state.currentView).find(l => l.id === session.layerId);
    if (!layer) return;
    const handle = e.target.closest('[data-crop]');
    const geo = cropAnchorGeometry(layer);
    if (!geo) return;
    const vr = document.getElementById('canvasViewer').getBoundingClientRect();
    const startClient = { x: e.clientX, y: e.clientY };
    // px → % ảnh gốc: holder w px = 100% ảnh.
    /* PHASE 5 SVG P0 (phát hiện khi verify crop): crop rect là FRACTION 0..1
       (sanitizeCropRect/CROP_MIN) nhưng ppx cũ = 100/geo.w trả về PERCENT →
       1px kéo ≈ 100× sai → mọi gesture luôn clamp thẳng về biên (thu nhỏ tức thì
       về CROP_MIN hoặc reframe nhảy về 0) khiến Crop Mode không dùng được.
       Đo trước fix: geo 27px, kéo SE 13px → w/h = 0.06 (min) thay vì ~0.5.
       Giờ chuẩn hoá px → fraction; semantics crop không đổi. */
    const ppx = 1 / Math.max(8, geo.w), ppy = 1 / Math.max(8, geo.h);
    const d0 = { ...sanitizeCropRect(session.draft) };
    const mode = handle ? handle.dataset.crop : 'move'; // move = REFRAME
    try { el.setPointerCapture?.(e.pointerId); } catch (err) { /* synthetic/edge pointerId */ }
    let moved = false;
    const onMove = (ev) => {
      const sdx = ev.clientX - startClient.x, sdy = ev.clientY - startClient.y;
      const p = { x: sdx * ppx, y: sdy * ppy };
      if (!moved && Math.abs(sdx) + Math.abs(sdy) < 2) return;
      moved = true;
      const d = { ...d0 };
      if (mode === 'move') {
        // REFRAME: dịch ảnh bên trong khung — ngược với dịch khung.
        d.x = clampNum(d0.x - p.x, 0, 1 - d0.w, 0);
        d.y = clampNum(d0.y - p.y, 0, 1 - d0.h, 0);
        updateDragHud({ extra: `reframe x:${Math.round(d.x * 100)} y:${Math.round(d.y * 100)}` });
      } else {
        // Resize khung theo handle (corner/edge) — min/max chuẩn §5.
        if (mode.includes('w')) { d.x = clampNum(d0.x + p.x, 0, d0.x + d0.w - CROP_MIN, 0); d.w = d0.x + d0.w - d.x; }
        if (mode.includes('e')) { d.w = clampNum(d0.w + p.x, CROP_MIN, 1 - d.x, d0.w); }
        if (mode.includes('n')) { d.y = clampNum(d0.y + p.y, 0, d0.y + d0.h - CROP_MIN, 0); d.h = d0.y + d0.h - d.y; }
        if (mode.includes('s')) { d.h = clampNum(d0.h + p.y, CROP_MIN, 1 - d.y, d0.h); }
        updateDragHud({ extra: `${Math.round(d.w * 100)}×${Math.round(d.h * 100)}%` });
      }
      session.draft = d;
      updateCropFrameFromSession();
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      hideDragHud();
      // KHÔNG pushDesignUndo ở đây — Apply mới tạo 1 entry duy nhất.
      void moved;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
}

/* Slider W/H: draft trong crop mode, layer.crop ngoài mode — 1 gesture = 1 entry
   (bỏ push-per-tick cũ; push 1 lần ở 'change'). */
function applyCropSlider(axis, v) {
  const target = isCropMode()
    ? sideLayers(state.cropSession?.side || state.currentView).find(l => l.id === state.cropSession?.layerId)
    : getSelectedLayer();
  if (!target) return;
  const val = clampNum(Number(v ?? 100) / 100, 0.2, 1, 1);
  if (isCropMode()) {
    const d = { ...sanitizeCropRect(state.cropSession.draft) };
    if (axis === 'w') { const cx = d.x + d.w / 2; d.w = val; d.x = clampNum(cx - val / 2, 0, 1 - val, 0); }
    else { const cy = d.y + d.h / 2; d.h = val; d.y = clampNum(cy - val / 2, 0, 1 - val, 0); }
    state.cropSession.draft = d;
    updateCropFrameFromSession();
  } else {
    const cur = target.crop || { x: 0, y: 0, w: 1, h: 1 };
    target.crop = axis === 'w'
      ? { x: Math.min(cur.x, 1 - val) / 2, y: cur.y, w: val, h: cur.h }
      : { x: cur.x, y: Math.min(cur.y, 1 - val) / 2, w: cur.w, h: val };
    if (target.crop.w >= 1 && target.crop.h >= 1) target.crop = null;
    commitActivePlacements();
    refreshSideViews();
  }
}

function syncCropModeUI() {
  const btn = document.getElementById('qaCrop');
  if (btn) btn.classList.toggle('active', isCropMode());
  const sel = getSelectedLayer();
  if (sel) {
    const show = isCropMode() && state.cropSession ? state.cropSession.draft : (sel.crop || { w: 1, h: 1 });
    const wEl = document.getElementById('layerCropW'); const hEl = document.getElementById('layerCropH');
    if (wEl && document.activeElement !== wEl) wEl.value = Math.round(show.w * 100);
    if (hEl && document.activeElement !== hEl) hEl.value = Math.round(show.h * 100);
  }
}

function initCropMode() {
  document.getElementById('qaCrop')?.addEventListener('click', () => { isCropMode() ? exitCropMode({ apply: false }) : enterCropMode(); });
  document.getElementById('cropApplyBtn')?.addEventListener('click', () => exitCropMode({ apply: true }));
  document.getElementById('cropCancelBtn')?.addEventListener('click', () => { exitCropMode({ apply: false }); showToast('Đã hủy cắt — giữ nguyên crop trước đó.', 'info', 1500); });
  document.getElementById('cropResetBtn2')?.addEventListener('click', () => {
    if (!isCropMode()) return;
    const session = state.cropSession;
    if (!session) return;
    const layer = sideLayers(session.side || state.currentView).find(l => l.id === session.layerId);
    if (layer) {
      layer.crop = null; session.draft = { x: 0, y: 0, w: 1, h: 1 };
      commitActivePlacements(); pushDesignUndo('crop'); refreshSideViews();
      showToast('Đã xóa cắt — dùng toàn bộ ảnh gốc (Ctrl+Z để hoàn tác).', 'success', 1800);
    }
  });
}

/* ============================================================
   3D VIEWER
   ============================================================ */
/* Kéo layer TRỰC TIẾP trên khung 3D (chế độ Vị trí).
   Design hiển thị qua 3D decal dựng từ composite các layer, nên drag ở đây
   cập nhật layer.x/y → rebuild composite (debounced) → decal 3D chạy theo.
   Cùng pipeline với slider vị trí: commitActivePlacements + syncPlacementInputs
   + renderLayersOverlay + scheduleViewerUpdate. */
function initCanvasLayerDrag() {
  const container = document.getElementById('canvasViewer');
  if (!container) return;
  let dragging = false, lastX = 0, lastY = 0, layer = null;
  let dragSrc = null, dragRect = null, previewStarted = false;
  container.addEventListener('pointerdown', (e) => {
    if (isCropMode()) return; // CROP MODE: canvas gestures thuộc về crop frame
    if (state.interactionMode !== 'position') return; // rotate mode: tilt áo
    if (e.button !== undefined && e.button !== 0) return;
    // Kéo cái gì? ƯỚNG theo VỊ TRÍ CON TRỎ THẬT (hit-test): trúng chữ → kéo
    // chữ; trúng layer ảnh → kéo ảnh. Trước đây activePlacementLayer='text'
    // bắt MỌI pointerdown thành kéo chữ → sau khi tạo chữ KHÔNG THỂ chọn/kéo
    // lại ảnh nữa (bug người dùng báo). Không trúng gì → theo object active
    // (giữ hành vi cũ cho vùng trống).
    const hit = hitTestPrintObject(e.clientX, e.clientY);
    const isTextDrag = hit ? hit.kind === 'text' : (state.activePlacementLayer === 'text' && getSideCustomText());
    if (hit) {
      if (hit.kind === 'text') setActivePlacementLayer('text');
      else { selectLayer(state.currentView, hit.layer.id); setActivePlacementLayer('image'); }
    }
    if (isTextDrag) {
      layer = null;
      if (getSideTextLocked()) { showToast('Chữ đang khóa — mở khóa để di chuyển.', 'warning', 1700); return; }
    } else {
      layer = getSelectedLayer();
      if (layer?.locked) { showToast(`"${layer.name || 'Mẫu'}" đang khóa — bấm 🔓 để mở.`, 'warning', 1700); return; }
      if (!layer) {
        const top = [...sideLayers(state.currentView)].filter(l => l.visible !== false && l.url).sort((a, b) => b.z - a.z)[0];
        if (!top) return;
        selectLayer(state.currentView, top.id);
        layer = top;
        showToast(`Đang kéo: ${top.name || 'mẫu'} — đổi mẫu cần kéo trong danh sách lớp.`, 'info', 2200);
      }
    }
    // Rect preview: 3D đo bằng PROJECTION decal (printObjectScreenRect —
    // đúng kích thước thật trên áo, hết "kéo to ra rồi giật về"); 2D fallback
    // node overlay. Trước đây ước lượng → preview lệch decal thật.
    if (isTextDrag) {
      dragRect = null; // nhánh move sẽ đo qua printObjectScreenRect
    } else {
      const r = printObjectScreenRect('image', layer);
      if (r && r.w > 4) {
        dragRect = { left: r.cx - r.w / 2, top: r.cy - r.h / 2, width: r.w, height: r.h, right: r.cx + r.w / 2, bottom: r.cy + r.h / 2, x: r.cx - r.w / 2, y: r.cy - r.h / 2, toJSON() {} };
      } else {
        const overlayImg = layer ? document.querySelector(`#mockupDesign img[data-layer-id="${CSS.escape(layer.id)}"]`) : null;
        dragRect = overlayImg && overlayImg.getBoundingClientRect().width > 4 ? overlayImg.getBoundingClientRect() : null;
      }
    }
    dragSrc = isTextDrag ? null : layer.url;
    previewStarted = false;
    dragging = true;
    lastX = e.clientX; lastY = e.clientY;
    try { container.setPointerCapture(e.pointerId); } catch (err) { /* */ }
    e.preventDefault();
    beginDesignUndoBatch(isTextDrag ? 'text-move' : 'move');
  });
  // PHASE 1: CHỌN object bằng cách TAP/TRỰC TIẾP trên khung 3D (khi không kéo):
  // select theo z-index (decal vẽ theo z), phân biệt tap vs drag bằng khoảng
  // moved. Kéo chữ nếu text đang active, else image; click vùng trống → theo
  // object có sẵn (không deselect — giữ UX an toàn).
  let tapStart = null;
  container.addEventListener('pointerdown', (e) => {
    if (isCropMode()) return; // tap-select off trong crop mode
    if (state.interactionMode !== 'position') return;
    tapStart = { x: e.clientX, y: e.clientY, t: Date.now() };
  });
  container.addEventListener('pointerup', (e) => {
    if (!tapStart) return;
    const movedFar = Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) > 6 || (Date.now() - tapStart.t) > 600;
    tapStart = null;
    if (movedFar) return;
    // Tap ngắn: chọn ĐÚNG object dưới ngón/chuột (hit-test thật, text kiểm
    // trước vì vẽ trên cùng trong composite) — không còn "text luôn thắng".
    const hit = hitTestPrintObject(e.clientX, e.clientY);
    if (hit?.kind === 'text') {
      setActivePlacementLayer('text');
      refreshSelectionFrameSoon();    } else if (hit?.layer) {
      selectLayer(state.currentView, hit.layer.id);
      setActivePlacementLayer('image');
      refreshSelectionFrameSoon();
    } else if (state.activePlacementLayer === 'text' && getSideCustomText()) {
      setActivePlacementLayer('text');
      refreshSelectionFrameSoon();
    } else {
      const top = [...sideLayers(state.currentView)].filter(l => l.visible !== false && l.url).sort((a, b) => b.z - a.z)[0];      if (top) { selectLayer(state.currentView, top.id); setActivePlacementLayer('image'); refreshSelectionFrameSoon(); }
    }
  });
  container.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    if (!previewStarted) {
      previewStarted = true;
      // Preview SIZE = projection THẬT của object ĐANG KÉO (chữ hoặc ảnh):
      // hết "kéo giữ to ra, thả ra giật về size cũ" do ước lượng lệch decal.
      const draggingText = !layer; // nhánh canvas: layer=null khi kéo chữ
      const objR = draggingText ? printObjectScreenRect('text', null) : null;
      const srcForPreview = draggingText ? (dragSrc || buildTextDragPreviewUrl()) : dragSrc;
      beginLayerDragPreview(srcForPreview, dragRect, e.clientX, e.clientY, draggingText ? 1 : (layer.scale || 1),
        objR ? { rectPx: { w: objR.w, h: objR.h, left: objR.cx - objR.w / 2, top: objR.cy - objR.h / 2 } } : {});
    }
    moveLayerDragPreview(e.clientX, e.clientY);
    const w = container.clientWidth || 1;
    // Chuẩn 1:1 giống đường kéo overlay: ảnh decal ≈ 42% rộng áo, áo ≈ 70% rộng
    // khung → ảnh hiển thị ≈ 0.294w px; 1% vị trí = 0.294w px chuột → ảnh chạy
    // đúng tốc độ tay (trước đây k=100/0.3w làm 1px chuột = 100% — ảnh “bay”).
    const k = 1 / (0.294 * w) * 100;
    const dx = (e.clientX - lastX) * k;
    const dy = (e.clientY - lastY) * k;
    lastX = e.clientX; lastY = e.clientY;
    if (state.activePlacementLayer === 'text' && !layer) {
      const tp = state.textPlacement;
      // Dùng CHUNG TEXT_BOUNDS — trước đây hardcode -80/80 & -75/45 nên kéo
      // trên canvas có thể đẩy chữ ra ngoài vùng in (mất khỏi composite/3D/order).
      tp.x = clampNum(tp.x + dx, ...TEXT_BOUNDS.x);
      tp.y = clampNum(tp.y + dy, ...TEXT_BOUNDS.y);
      /* GROUP MOVE: kéo chữ trên canvas cũng kéo theo ảnh đang chọn —
         đổi % chữ sang % ảnh theo CHUẨN COMPOSITE (decal 3D là render cuối):
         1% ảnh = 0.58×scale% chữ theo x; trục y nhân thêm tỉ lệ khung ảnh. */
      if (groupMoveEnabled()) {
        const sel = getSelectedLayer(state.currentView);
        if (sel && !sel.locked) {
          const sc = Number(sel.scale) || 1;
          const ir = document.querySelector(`#mockupDesign img[data-layer-id="${CSS.escape(sel.id)}"]`)?.getBoundingClientRect();
          const ar = ir && ir.width > 1 ? ir.height / ir.width : 1;
          sel.x = clampNum(sel.x + dx * 0.58 * sc, ...LAYER_BOUNDS.x);
          sel.y = clampNum(sel.y + dy * 0.58 * sc * ar, ...LAYER_BOUNDS.y);
        }
      }
      const sn = snapPlacement({ x: tp.x, y: tp.y }, { bypass: e.altKey, siblings: siblingSnapTargets(state.currentView, null), layer: { kind: 'text', scale: tp.scale } });
      tp.x = sn.x; tp.y = sn.y;
      updateDragHud({ x: tp.x, y: tp.y, snapLabel: sn.snapLabel, limitLabel: sn.limitLabel });
    } else if (layer) {
      /* GROUP MOVE: kéo ảnh trên canvas cũng kéo theo chữ — đổi % ảnh sang
         % chữ theo CHUẨN COMPOSITE (1% ảnh = 0.58×scale% chữ; y nhân h/w). */
      if (groupMoveEnabled() && getSideCustomText() && !getSideTextLocked()) {
        const sc = Number(layer.scale) || 1;
        const nr = document.querySelector(`#mockupDesign img[data-layer-id="${CSS.escape(layer.id)}"]`)?.getBoundingClientRect();
        const ar = nr && nr.width > 1 ? nr.height / nr.width : 1;
        state.textPlacement.x = clampNum(state.textPlacement.x + dx * 0.58 * sc, ...TEXT_BOUNDS.x);
        state.textPlacement.y = clampNum(state.textPlacement.y + dy * 0.58 * sc * ar, ...TEXT_BOUNDS.y);
      }
      layer.x = clampNum(layer.x + dx, ...LAYER_BOUNDS.x);
      layer.y = clampNum(layer.y + dy, ...LAYER_BOUNDS.y);
      const sn = snapPlacement({ x: layer.x, y: layer.y }, { bypass: e.altKey, siblings: siblingSnapTargets(state.currentView, layer.id), layer });
      layer.x = sn.x; layer.y = sn.y;
      updateDragHud({ x: layer.x, y: layer.y, snapLabel: sn.snapLabel, limitLabel: sn.limitLabel });
    } else { return; }
    commitActivePlacements();
    syncPlacementInputs();
    // MƯỢT: trong khi kéo chỉ update node overlay hiện có + input (KHÔNG rebuild
    // DOM mỗi pixel chuột — renderLayersOverlay() tái tạo innerHTML là nguồn gốc
    // giật khi kéo trên canvas). Rebuild đầy đủ 1 lần khi thả.
    if (layer) {
      const node = document.querySelector(`#mockupDesign img[data-layer-id="${CSS.escape(layer.id)}"]`);
      if (node) moveOverlayLayerNode(node, layer);
    }
    scheduleViewerUpdate();
  });
  const stop = () => {
    if (!dragging) return;
    const movedAny = previewStarted;
    dragging = false; layer = null;
    hideSnapGuides(); hideDragHud(); hidePrintBoundary();
    endLayerDragPreview();
    if (movedAny) {
      pushDesignUndo('move');
      renderLayersOverlay(); // rebuild 1 lần khi thả — list/z/overlay khớp state
    }
  };
  container.addEventListener('pointerup', stop);
  container.addEventListener('pointercancel', stop);

  // PRO SHORTCUT: DOUBLE-CLICK ảnh trên áo → vào Crop Mode ngay (chuẩn editor
  // chuyên nghiệp — Photoshop/Illustrator đều dùng double-click để "vào trong"
  // chỉnh nội dung object). Không cần tìm nút Crop trên toolbar.
  container.addEventListener('dblclick', (e) => {
    if (isCropMode()) return; // đã trong crop → double-click không loop
    if (state.interactionMode !== 'position') return;
    const hit = hitTestPrintObject(e.clientX, e.clientY);
    if (!hit || hit.kind !== 'image' || !hit.layer) return;
    if (hit.layer.locked) { showToast(`"${hit.layer.name || 'Mẫu'}" đang khóa — mở khóa để cắt.`, 'warning', 1800); return; }
    selectLayer(state.currentView, hit.layer.id);
    setActivePlacementLayer('image');
    enterCropMode();
  });

  // WHEEL-TO-SCALE: lăn chuột trên canvas (chế độ Vị trí) đổi kích thước
  // layer đang chọn (hoặc chữ). Ctrl+lăn = bước lớn. Đây là shortcut tiêu
  // chuẩn của mọi phần mềm thiết kế — không conflict với page scroll vì
  // preventDefault trong canvas.
  container.addEventListener('wheel', (e) => {
    if (isCropMode()) return; // crop mode: wheel không đổi scale layer
    if (state.interactionMode !== 'position') return;
    e.preventDefault();
    const stepDir = e.deltaY < 0 ? 1 : -1;
    // PRO MODIFIER: Shift+lăn = XOAY (15°/notch, Ctrl+Shift = 5° fine) thay vì
    // scale — chuẩn mọi editor chuyên nghiệp. Không Shift → scale như cũ.
    if (e.shiftKey) {
      const rotStep = e.ctrlKey ? 5 : 15;
      let rotChanged = false;
      if (state.activePlacementLayer === 'text' && getSideCustomText()) {
        if (getSideTextLocked()) { showToast('Chữ đang khóa.', 'warning', 1400); return; }
        const tp = state.textPlacement;
        const nr = clampNum(Math.round((tp.rotation || 0) + stepDir * rotStep), ...LAYER_BOUNDS.rotation);
        if (nr !== tp.rotation) { tp.rotation = nr; rotChanged = true; }
      } else {
        const sel = getSelectedLayer();
        if (!sel) return;
        if (sel.locked) { showToast(`"${sel.name || 'Mẫu'}" đang khóa.`, 'warning', 1400); return; }
        const nr = clampNum(Math.round((sel.rotation || 0) + stepDir * rotStep), ...LAYER_BOUNDS.rotation);
        if (nr !== sel.rotation) { sel.rotation = nr; rotChanged = true; }
      }
      if (!rotChanged) return;
      commitActivePlacements();
      syncPlacementInputs();
      renderLayersOverlay();
      scheduleViewerUpdateThrottled();
      return;
    }
    const step = e.ctrlKey ? 0.12 : 0.05;
    // PHASE 3: tính trước giá trị scale mới — chỉ commit/rebuild khi THỰC SỰ đổi
    // (tránh rebuild DOM + composite mù mỗi notch khi locked/no-selection/bão hòa).
    let changed = false;
    if (state.activePlacementLayer === 'text' && getSideCustomText()) {
      if (getSideTextLocked()) { showToast('Chữ đang khóa.', 'warning', 1400); return; }
      const tp = state.textPlacement;
      const ns = clampNum(tp.scale + stepDir * step, ...TEXT_BOUNDS.scale, 1);
      if (ns !== tp.scale) { tp.scale = ns; changed = true; }
    } else {
      const sel = getSelectedLayer();
      if (!sel) return;
      if (sel.locked) { showToast(`"${sel.name || 'Mẫu'}" đang khóa.`, 'warning', 1400); return; }
      const ns = clampNum(sel.scale + stepDir * step, ...LAYER_BOUNDS.scale, 1);
      if (ns !== sel.scale) {
        sel.scale = ns;
        state.printPlacement = { x: sel.x, y: sel.y, scale: sel.scale };
        changed = true;
      }
    }
    if (!changed) return;
    commitActivePlacements();
    syncPlacementInputs();
    renderLayersOverlay();
    scheduleViewerUpdateThrottled();
  }, { passive: false });
}

/* Preview kéo chữ: render slogan theo đúng style hiện tại ra canvas trong suốt
   → dataURL. Cache theo composite key — không re-render mỗi lần nhấn. */
function buildTextDragPreviewUrl() {
  const side = state.currentView;
  const text = getSideCustomText(side);
  const style = getSideTextStyle(side);
  const tp = getSideTextPlacement(side);
  const size = 256;
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  drawStyledText(c.getContext('2d'), size, text, { x: 0, y: 0, scale: tp.scale }, style);
  return c.toDataURL('image/png');
}

/* ============================================================
   ALIGN TOOLS PRO — phân bố đều / xếp hàng / cột cho nhiều mẫu.
   Toán học: sort theo trục, chốt 2 mẫu đầu-cuối giữ nguyên, các mẫu
   giữa nhận vị trí nội suy đều. Không đụng scale/rotation/z.
   ============================================================ */
function distributeLayers(axis) {
  const side = state.currentView;
  const layers = sideLayers(side).filter(l => l.visible !== false && l.url);
  if (layers.length < 3) { showToast('Cần ít nhất 3 mẫu để phân bố đều.', 'warning'); return; }
  const sorted = [...layers].sort((a, b) => a[axis] - b[axis]);
  const first = sorted[0][axis], last = sorted[sorted.length - 1][axis];
  const step = (last - first) / (sorted.length - 1);
  sorted.forEach((l, i) => { l[axis] = clampNum(first + step * i, ...LAYER_BOUNDS[axis]); });
  commitActivePlacements();
  refreshSideViews();
  showToast(`Đã phân bố đều ${sorted.length} mẫu theo trục ${axis === 'x' ? 'ngang' : 'dọc'}.`, 'success', 1600);
}
function alignLayersRow(axis) {
  // Xếp thẳng hàng: tất cả lấy vị trí trục của mẫu đang chọn (hoặc trung bình).
  const side = state.currentView;
  const layers = sideLayers(side).filter(l => l.visible !== false && l.url);
  if (layers.length < 2) { showToast('Cần ít nhất 2 mẫu để xếp hàng.', 'warning'); return; }
  const sel = getSelectedLayer(side);
  const ref = sel ? sel[axis] : layers.reduce((s, l) => s + l[axis], 0) / layers.length;
  layers.forEach(l => { l[axis] = clampNum(ref, ...LAYER_BOUNDS[axis]); });
  commitActivePlacements();
  refreshSideViews();
  showToast(`Đã xếp thẳng ${axis === 'x' ? 'cột dọc' : 'hàng ngang'} qua mẫu đang chọn.`, 'success', 1600);
}
function initAlignTools() {
  const guard = (fn) => () => { if (isCropMode()) { showToast('Đang ở Crop Mode — Apply/Hủy trước khi căn chỉnh.', 'warning', 1800); return; } fn(); };
  document.getElementById('distributeH')?.addEventListener('click', guard(() => distributeLayers('x')));
  document.getElementById('distributeV')?.addEventListener('click', guard(() => distributeLayers('y')));
  document.getElementById('alignRowH')?.addEventListener('click', guard(() => alignLayersRow('x')));
  document.getElementById('alignColV')?.addEventListener('click', guard(() => alignLayersRow('y')));
}

function initThreeViewer() {
  // Wait for tshirt-360.js module to load
  const check = setInterval(() => {
    if (window.tshirt360Viewer) {
      clearInterval(check);
      window.tshirt360Viewer.setColor(state.selectedColor);
      // Viewer sẵn sàng → áp chế độ chuột hiện tại (mặc định position → orbit
      // TẮT, tránh kéo layer bị áo quay theo).
      try { window.tshirt360Viewer.setInteractionMode?.(state.interactionMode); } catch (e) { /* */ }
    }
  }, 200);
  setTimeout(() => clearInterval(check), 5000);

  // CSS 3D fallback
  initCss3DViewer();
}

function initCss3DViewer() {
  const container = document.getElementById('canvasViewer');
  if (!container) return;
  let dragging = false, lastX = 0, lastY = 0, tiltX = -3, tiltY = 4;

  function setTilt(x, y) {
    tiltX = Math.max(-18, Math.min(18, x));
    tiltY = Math.max(-38, Math.min(38, y));
    container.style.setProperty('--tilt-x', `${tiltX}deg`);
    container.style.setProperty('--tilt-y', `${tiltY}deg`);
  }

  state.cssViewer = { showFront: () => setTilt(-3, 4), showBack: () => setTilt(-3, -38) };

  container.addEventListener('pointerdown', e => {
    if (state.interactionMode === 'position') return;
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    container.setPointerCapture(e.pointerId);
  });
  container.addEventListener('pointermove', e => {
    if (state.interactionMode === 'position' || !dragging) return;
    setTilt(tiltX - (e.clientY - lastY) * 0.18, tiltY + (e.clientX - lastX) * 0.18);
    lastX = e.clientX; lastY = e.clientY;
  });
  container.addEventListener('pointerup', () => dragging = false);
  container.addEventListener('pointercancel', () => dragging = false);
  container.addEventListener('dblclick', () => setTilt(0, 0));
  setTilt(-3, 4);
}

/* ============================================================
   ORDER FLOW
   ============================================================ */
/* PHASE 5 FINAL — ORDER IDEMPOTENCY (client dùng hạ tầng server có sẵn).
   Server: `Idempotency-Key` + cùng body → trả lại ĐÚNG đơn cũ (200, idempotent:true),
   không tạo đơn thứ hai; cùng key + body khác → 409. Trước đây client KHÔNG gửi
   header này nên double-submit/retry tạo nhiều đơn thật.
   Quy tắc: 1 "lượt đặt hàng" (mở modal → submit, kể cả retry trong lúc modal còn mở)
   = 1 key; mở modal mới = key mới (đơn logic mới). */
function newOrderIdempotencyKey() {
  const rnd = window.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `order-${rnd}`;
}
let orderSubmitting = false; // defense-in-depth: chặn submit thứ hai khi đang gửi

function initOrderFlow() {
  const modal = document.getElementById('orderModal');
  const form = document.getElementById('orderForm');
  const closeBtn = document.getElementById('modalClose');
  const closeBtn2 = document.getElementById('orderCloseBtn');
  let lastFocus = null;

  const openModal = () => {
    lastFocus = document.activeElement;
    modal?.classList.add('active');
    setTimeout(() => document.getElementById('orderName')?.focus(), 60);
  };
  const closeModal = () => {
    modal?.classList.remove('active');
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch {} }
  };

  document.getElementById('orderBtn')?.addEventListener('click', () => {
    if (requireAuth()) return;
    if (!state.currentDesign && !hasFrontContent() && !hasBackContent()) { showToast('Hãy tạo thiết kế trước khi đặt hàng.', 'warning'); return; }
    updateOrderSummary();
    // Đơn logic MỚI → key MỚI. Retry trong lúc modal còn mở dùng lại key này.
    state.orderIdempotencyKey = newOrderIdempotencyKey();
    if (auth.isLoggedIn()) {
      const nameInput = document.getElementById('orderName');
      if (nameInput && !nameInput.value) nameInput.value = auth.user?.fullName || auth.user?.username || '';
    }
    openModal();
  });

  closeBtn?.addEventListener('click', closeModal);
  closeBtn2?.addEventListener('click', () => { closeModal(); resetOrderModal(); });
  modal?.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (modal?.classList.contains('active')) closeModal();
    const pp = document.getElementById('printPreviewModal');
    if (pp?.classList.contains('active')) closePrintPreview();
  });

  // Payment method
  document.querySelectorAll('.payment-method-option').forEach(btn => {
    if (!btn.hasAttribute('aria-pressed')) btn.setAttribute('aria-pressed', btn.classList.contains('active') ? 'true' : 'false');
    btn.addEventListener('click', () => {
      document.querySelectorAll('.payment-method-option').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      state.selectedPaymentMethod = btn.dataset.paymentMethod || 'COD';
    });
  });

  form?.addEventListener('submit', e => { e.preventDefault(); submitOrder(); });
  // Clear inline errors on input
  ['orderName', 'orderPhone', 'orderAddress'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', (e) => {
      e.target.removeAttribute('aria-invalid');
      const err = document.getElementById(id + 'Error');
      if (err) { err.hidden = true; err.textContent = ''; }
    });
  });
  document.getElementById('orderNote')?.addEventListener('input', (e) => {
    const c = document.getElementById('orderNoteCount');
    if (c) c.textContent = `${e.target.value.length} / ${HARDEN_LIMITS.noteMax}`;
  });
}

function updateOrderSummary() {
  const product = PRODUCT_LABELS[state.selectedProductType] || 'T-Shirt Custom AI';
  const price = PRODUCT_PRICES[state.selectedProductType] || 250000;
  const total = price * state.quantity;
  const colorNames = { '#ffffff': 'Trắng', '#000000': 'Đen', '#1e293b': 'Navy', '#6b7280': 'Xám', '#dc2626': 'Đỏ', '#2563eb': 'Xanh', '#059669': 'Xanh lá' };
  document.getElementById('orderProduct').textContent = product;
  document.getElementById('orderColor').textContent = colorNames[state.selectedColor] || state.selectedColor;
  document.getElementById('orderSize').textContent = state.selectedSize;
  document.getElementById('orderQty').textContent = state.quantity;
  document.getElementById('orderTotal').textContent = formatPrice(total);
}

function resetOrderModal() {
  stopOrderPaymentWatch();
  state.orderIdempotencyKey = ''; // đóng modal → lượt đặt hàng tiếp theo là đơn logic mới
  document.getElementById('orderFormContent').style.display = 'block';
  document.getElementById('orderSuccess').style.display = 'none';
  document.getElementById('bankTransferBox').style.display = 'none';
  document.getElementById('orderForm')?.reset();
  document.getElementById('orderSubmitBtn').disabled = false;
}

async function submitOrder() {
  const submitBtn = document.getElementById('orderSubmitBtn');
  const nameEl = document.getElementById('orderName');
  const phoneEl = document.getElementById('orderPhone');
  const addressEl = document.getElementById('orderAddress');
  const noteEl = document.getElementById('orderNote');
  const name = nameEl?.value?.trim() || '';
  const phone = phoneEl?.value?.trim() || '';
  const address = addressEl?.value?.trim() || '';
  const note = (noteEl?.value || '').slice(0, HARDEN_LIMITS.noteMax).trim();

  let firstInvalid = null;
  if (!name) { setFieldError(nameEl, document.getElementById('orderNameError'), 'Vui lòng nhập họ tên (tối đa 100 ký tự).'); firstInvalid = firstInvalid || nameEl; }
  else if (name.length > HARDEN_LIMITS.nameMax) { setFieldError(nameEl, document.getElementById('orderNameError'), `Họ tên quá dài (${name.length}/${HARDEN_LIMITS.nameMax}).`); firstInvalid = firstInvalid || nameEl; }
  if (!phone) { setFieldError(phoneEl, document.getElementById('orderPhoneError'), 'Vui lòng nhập số điện thoại.'); firstInvalid = firstInvalid || phoneEl; }
  else if (!isValidVnPhone(phone)) { setFieldError(phoneEl, document.getElementById('orderPhoneError'), 'Số điện thoại không hợp lệ. VD: 0912345678 hoặc +84912345678.'); firstInvalid = firstInvalid || phoneEl; }
  if (!address) { setFieldError(addressEl, document.getElementById('orderAddressError'), 'Vui lòng nhập địa chỉ giao hàng.'); firstInvalid = firstInvalid || addressEl; }
  else if (address.length > HARDEN_LIMITS.addressMax) { setFieldError(addressEl, document.getElementById('orderAddressError'), `Địa chỉ quá dài (${address.length}/${HARDEN_LIMITS.addressMax}).`); firstInvalid = firstInvalid || addressEl; }
  if (firstInvalid) { shakeButton(submitBtn); firstInvalid.focus(); showToast('Vui lòng kiểm tra lại thông tin giao hàng.', 'warning'); return; }

  if (orderSubmitting) return; // đang gửi — không gửi chồng
  orderSubmitting = true;
  const idempotencyKey = state.orderIdempotencyKey || (state.orderIdempotencyKey = newOrderIdempotencyKey());
  const originalBtnHtml = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = 'Đang xử lý…';
  submitBtn.classList.add('is-loading');
  submitBtn.style.willChange = 'transform';

  commitActivePlacements();
  // The order captures the full side compositions (all layers + text),
  // never a single design URL — what you see is what gets printed.
  const orderFrontComposite = await buildSideComposite('front');
  const orderBackComposite = await buildSideComposite('back');
  const orderData = {
    designUrl: orderFrontComposite || state.currentDesign?.designUrl || '',
    frontDesignUrl: orderFrontComposite || getFrontDesignUrl(),
    backDesignUrl: orderBackComposite || getBackDesignUrl(),
    productType: state.selectedProductType,
    color: state.selectedColor,
    size: state.selectedSize,
    quantity: state.quantity,
    customText: state.customText,
    printPlacement: getSidePrintPlacement('front'),
    textPlacement: getSideTextPlacement('front'),
    printPlacementBack: getSidePrintPlacement('back'),
    textPlacementBack: getSideTextPlacement('back'),
    customer: { name, phone, address, note },
    payment: state.selectedPaymentMethod,
    userId: auth.user?.id,
    authorName: auth.user?.fullName || auth.user?.username || '',
  };

  try {
    const resp = await fetchWithTimeout(`${API_BASE}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth.token ? `Bearer ${auth.token}` : '', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(orderData),
    }, 15000);
    const data = await resp.json().catch(() => ({}));
    if (resp.status === 401) { showToast('Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.', 'warning', 5000); showStudioAuthPrompt('expired'); throw new Error('Unauthorized'); }
    if (resp.status === 429) throw new Error('Bạn thao tác quá nhanh. Vui lòng đợi 30 giây rồi thử lại.');
    // 409 = key này đã gắn với dữ liệu khác → cấp key mới để người dùng gửi lại được
    if (resp.status === 409) {
      state.orderIdempotencyKey = newOrderIdempotencyKey();
      throw new Error(data.error || 'Khoá đặt hàng đã dùng cho dữ liệu khác — đã làm mới, vui lòng gửi lại.');
    }
    if (!resp.ok || data.success === false) throw new Error(data.error || `Đặt hàng thất bại (HTTP ${resp.status}).`);

    const orderId = data.orderId || 'BU-' + Date.now();
    const payment = data.payment || state.selectedPaymentMethod;

    if (payment === 'VNPAY') {
      showOrderSuccess(data, orderId, payment);
      // Success micro for VNPAY order creation (before redirect)
      showButtonSuccess(submitBtn, '✓ Đã tạo đơn');
      try {
        const payResp = await fetchWithTimeout(`${API_BASE}/payment/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: auth.token ? `Bearer ${auth.token}` : '' },
          body: JSON.stringify({ orderId, paymentMethod: 'VNPAY' }),
        }, 12000);
        const payData = await payResp.json().catch(() => ({}));
        if (payData.success && payData.paymentUrl) {
          window.location.href = payData.paymentUrl;
          return;
        }
        shakeButton(submitBtn);
        showToast(payData.error || 'Không thể tạo link thanh toán. Vui lòng thử lại.', 'error');
      } catch (err) {
        shakeButton(submitBtn);
        const msg = err && err.name === 'TimeoutError' ? 'Kết nối cổng thanh toán quá hạn. Vui lòng thử lại.' : 'Không thể kết nối cổng thanh toán.';
        showToast(msg, 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnHtml;
        submitBtn.classList.remove('is-loading');
        submitBtn.style.willChange = '';
      }
      return;
    }

    showOrderSuccess(data, orderId, payment);
    showButtonSuccess(submitBtn, '✓ Đã đặt');
  } catch (e) {
    if (e?.message === 'Unauthorized') { /* auth prompt already shown */ }
    else {
      shakeButton(submitBtn);
      const msg = e && e.name === 'TimeoutError' ? 'Đặt hàng quá hạn (mạng chậm). Kiểm tra Tài khoản → Đơn hàng trước khi đặt lại.' : (e.message || 'Đặt hàng thất bại. Thử lại sau.');
      showToast(msg, 'error', 7000);
    }
  } finally {
    orderSubmitting = false;
    submitBtn.disabled = false;
    if (submitBtn.innerHTML === 'Đang xử lý…') submitBtn.innerHTML = originalBtnHtml;
    submitBtn.classList.remove('is-loading');
    submitBtn.style.willChange = '';
  }
}

function showOrderSuccess(order, fallbackOrderId, fallbackPayment) {
  const payload = order && typeof order === 'object' ? order : {};
  const orderId = payload.orderId || fallbackOrderId;
  const payment = payload.payment || fallbackPayment;

  document.getElementById('orderFormContent').style.display = 'none';
  document.getElementById('orderSuccess').style.display = 'block';
  document.getElementById('orderSuccessId').textContent = `Mã đơn hàng: ${orderId}`;

  if (payment === 'BANK_TRANSFER') {
    const box = document.getElementById('bankTransferBox');
    box.style.display = 'block';
    const bank = payload.bankInfo || BANK_TRANSFER_INFO;
    // The amount MUST come from the server: it is the discounted finalPrice, and
    // the SePay webhook reconciles the transfer against exactly that number.
    const amount = Number(payload.amount) || (PRODUCT_PRICES[state.selectedProductType] || 250000) * state.quantity;
    const memo = payload.transferContent || `BLANKUP-${orderId}`;
    const qrUrl = `https://img.vietqr.io/image/${bank.bankId}-${bank.accountNumber}-${bank.template || 'compact2'}.png?amount=${amount}&addInfo=${encodeURIComponent(memo)}&accountName=${encodeURIComponent(bank.accountName)}`;
    const qrImg = document.getElementById('successQrImage');
    if (qrImg) { qrImg.style.visibility = ''; qrImg.src = qrUrl; }
    document.getElementById('successBankName').textContent = bank.bankName || '';
    document.getElementById('successAccountName').textContent = bank.accountName || '';
    document.getElementById('successAccountNumber').textContent = bank.accountNumber || '';
    document.getElementById('successTransferContent').textContent = memo;
    setBankTransferStatus('Đang chờ hệ thống xác nhận chuyển khoản...', 'waiting');
    // Wait for a REAL confirmation (SePay webhook / admin action) before paying
    // any success state. Until that arrives the screen keeps saying "waiting".
    startOrderPaymentWatch(orderId, payload.paymentWatchToken);
  }

  if (payment === 'VNPAY') {
    const note = document.querySelector('.order-success-note');
    if (note) note.textContent = 'Đang chuyển hướng đến cổng thanh toán VNPay…';
  }
}

/* ============================================================
   ORDER PAYMENT WATCH
   Only a server-side confirmation may flip the checkout screen to "paid".
   Primary channel is a Server-Sent Events push; a 5s poll is kept as a safety
   net for proxies/browsers that block or silently drop the stream.
   ============================================================ */
let orderWatch = null;

function setBankTransferStatus(text, tone) {
  const el = document.getElementById('bankTransferStatus');
  if (!el) return;
  el.textContent = text;
  el.dataset.tone = tone || 'waiting';
}

function stopOrderPaymentWatch() {
  if (!orderWatch) return;
  try { orderWatch.source?.close(); } catch { /* already closed */ }
  if (orderWatch.timer) clearInterval(orderWatch.timer);
  orderWatch = null;
}

function startOrderPaymentWatch(orderId, watchToken) {
  stopOrderPaymentWatch();
  if (!orderId) return;

  const state2 = { orderId, source: null, timer: null, done: false };
  orderWatch = state2;
  const token = watchToken || '';

  const apply = (payload) => {
    if (!payload || orderWatch !== state2 || state2.done) return;
    if (payload.paymentStatus === 'paid') {
      state2.done = true;
      setBankTransferStatus('✅ Đã nhận thanh toán — đơn hàng đang được xử lý.', 'paid');
      const note = document.querySelector('.order-success-note');
      if (note) note.textContent = 'Thanh toán đã được ngân hàng xác nhận tự động.';
      showToast('Thanh toán thành công! Đơn hàng đã được xác nhận.', 'success', 8000);
      showOrderReviewCta(orderId, token); // mời đánh giá NGAY — hoạt động cả cho khách guest
      stopOrderPaymentWatch();
      return;
    }
    if (payload.paymentStatus === 'underpaid') {
      setBankTransferStatus('⚠️ Số tiền chuyển chưa đủ. Vui lòng chuyển bổ sung đúng số tiền.', 'warn');
      return;
    }
    if (payload.status === 'cancelled') {
      setBankTransferStatus('Đơn hàng đã bị hủy.', 'warn');
      stopOrderPaymentWatch();
    }
  };

  // 1) Instant push from the server.
  try {
    if (typeof EventSource !== 'undefined') {
      const url = `${API_BASE}/orders/stream?orderId=${encodeURIComponent(orderId)}&token=${encodeURIComponent(token)}`;
      const source = new EventSource(url);
      state2.source = source;
      source.addEventListener('order', (event) => {
        try { apply(JSON.parse(event.data)); } catch { /* ignore malformed frame */ }
      });
      source.addEventListener('error', () => { /* polling keeps the screen correct */ });
    }
  } catch { /* SSE unsupported → polling only */ }

  // 2) Polling safety net.
  const poll = async () => {
    if (orderWatch !== state2 || state2.done) return;
    try {
      const resp = await fetch(`${API_BASE}/orders/${encodeURIComponent(orderId)}/payment-status?token=${encodeURIComponent(token)}`, {
        headers: auth.token ? { Authorization: `Bearer ${auth.token}` } : {},
      });
      if (!resp.ok) return;
      const data = await resp.json();
      if (data && data.success) apply(data);
    } catch { /* transient — next tick retries */ }
  };
  state2.timer = setInterval(poll, 5000);
  setTimeout(poll, 1200);
}

/* ============================================================
   DOWNLOAD
   ============================================================ */
function initDownload() {
  document.getElementById('downloadBtn')?.addEventListener('click', async () => {
    if (requireAuth()) return;
    // Download what is actually on the current side (full composition).
    const url = await buildSideComposite(state.currentView) || getActiveDesignUrl();
    if (!url) { showToast('Chưa có thiết kế để tải.', 'warning'); return; }
    const link = document.createElement('a');
    if (url.startsWith('data:')) {
      const isPng = url.startsWith('data:image/png');
      const isJpeg = url.startsWith('data:image/jpeg') || url.startsWith('data:image/jpg');
      const ext = isPng ? 'png' : isJpeg ? 'jpg' : url.includes('svg') ? 'svg' : 'png';
      link.href = url; link.download = `blankup-design-${Date.now()}.${ext}`;
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
      return;
    }
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Download failed (HTTP ${resp.status})`);
      const blob = await resp.blob();
      const ext = blob.type.includes('png') ? 'png' : blob.type.includes('svg') ? 'svg' : 'jpg';
      const objUrl = URL.createObjectURL(blob);
      link.href = objUrl; link.download = `blankup-design-${Date.now()}.${ext}`;
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(objUrl), 4000);
    } catch {
      showToast('Không tải trực tiếp được — đang mở ảnh ở tab mới.', 'info');
      window.open(url, '_blank', 'noopener');
    }
  });
}

/* ============================================================
   SHARE
   ============================================================ */
function initShareDesign() {
  document.getElementById('shareDesignBtn')?.addEventListener('click', async () => {
    if (requireAuth()) return;
    // Share = publish the CURRENT garment composition under the selected
    // layer's source design identity. Identity is verified server-side from
    // the session; nothing sensitive is sent from the client.
    const sel = getSelectedLayer();
    const designId = sel?.designId || state.currentDesign?.designId;
    if (!designId || state.currentDesign?.isDraft || String(designId).startsWith('community-') || String(designId).startsWith('text-only-')) {
      showToast('Cần có thiết kế AI thật để chia sẻ!', 'warning'); return;
    }
    if (!confirm('Chia sẻ mẫu này lên cộng đồng? Ảnh và tên hiển thị của bạn sẽ công khai.')) return;
    const btn = document.getElementById('shareDesignBtn');
    btn.disabled = true; btn.textContent = 'Đang chia sẻ…';
    try {
      const frontComposite = await buildSideComposite('front');
      const backComposite = await buildSideComposite('back');
      const resp = await fetch(`${API_BASE}/ai-design/${encodeURIComponent(designId)}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth.token ? `Bearer ${auth.token}` : '' },
        body: JSON.stringify({
          designUrl: sel?.url || frontComposite || state.currentDesign.designUrl,
          frontDesignUrl: frontComposite || getFrontDesignUrl(),
          backDesignUrl: backComposite || getBackDesignUrl(),
          prompt: sel?.prompt || state.currentDesign.prompt,
          style: sel?.style || state.currentDesign.style,
        }),
      });
      const result = await resp.json();
      if (!resp.ok || result.success === false) throw new Error(result.error || 'Share failed');
      if (state.currentDesign) state.currentDesign.isShared = true;
      updateShareButton();
      loadCommunityDesigns();
      showToast(result.alreadyShared ? 'Mẫu này đã được chia sẻ trước đó.' : 'Đã chia sẻ thiết kế!', 'success');
    } catch (e) { showToast(e.message || 'Chia sẻ thất bại', 'error'); }
    btn.disabled = false; btn.textContent = 'Chia sẻ';
  });
}

/* ============================================================
   COMMUNITY GALLERY
   ============================================================ */
function getUserId() {
  try {
    if (auth.user?.id) return auth.user.id;
    let gid = null;
    try { gid = localStorage.getItem('guest_id'); } catch { gid = null; }
    if (!gid) {
      gid = Date.now().toString(36);
      try { localStorage.setItem('guest_id', gid); } catch { /* private mode */ }
    }
    return 'guest_' + gid;
  } catch {
    return 'guest_' + Date.now().toString(36);
  }
}

function renderCommunityState(kind, message) {
  const box = document.getElementById('communityState');
  const grid = document.getElementById('communityGrid');
  if (!box) return;
  if (kind === 'hide') { box.hidden = true; if (grid) grid.setAttribute('aria-busy', 'false'); return; }
  box.hidden = false;
  if (grid) grid.setAttribute('aria-busy', kind === 'loading' ? 'true' : 'false');
  if (kind === 'loading') {
    box.innerHTML = `<div class="skeleton-row" aria-hidden="true"><span></span><span></span><span></span><span></span></div><p class="field-hint">Đang tải thiết kế cộng đồng…</p>`;
  } else if (kind === 'empty') {
    box.innerHTML = `<p class="field-hint">${escapeHtml(message || 'Chưa có thiết kế cộng đồng nào. Hãy là người đầu tiên chia sẻ!')}</p>`;
  } else if (kind === 'error') {
    box.innerHTML = `<p class="field-hint">${escapeHtml(message || 'Không tải được thư viện cộng đồng. Kiểm tra mạng rồi thử lại.')}</p><button class="community-retry-btn" id="communityRetry" type="button">Thử lại</button>`;
    document.getElementById('communityRetry')?.addEventListener('click', () => loadCommunityDesigns());
  }
}

async function loadCommunityDesigns() {
  const grid = document.getElementById('communityGrid');
  if (!grid) return;
  renderCommunityState('loading');
  let designs;
  try {
    const resp = await (window.fetchWithTimeout
      ? window.fetchWithTimeout(`${API_BASE}/ai-design/gallery`, {}, 12000)
      : fetch(`${API_BASE}/ai-design/gallery`));
    if (!resp.ok) {
      if (resp.status === 429) throw new Error('Cộng đồng đang quá tải (429). Vui lòng thử lại sau.');
      throw new Error(`Không tải được thư viện (HTTP ${resp.status}).`);
    }
    const result = await resp.json();
    designs = result.data || result.designs || [];
  } catch (e) {
    grid.innerHTML = '';
    renderCommunityState('error', e?.message || 'Không tải được thư viện cộng đồng.');
    return;
  }

  if (!Array.isArray(designs) || !designs.length) {
    grid.innerHTML = '';
    renderCommunityState('empty');
    return;
  }
  renderCommunityState('hide');

  const userId = getUserId();
  // Cap initial render for large galleries: first 48, rest on demand via “Xem thêm”.
  const PAGE = 48;
  let shown = designs.slice(0, PAGE);

  const cardHtml = (d) => {
    const previewUrl = d.frontDesignUrl || d.designUrl || '';
    const liked = Array.isArray(d.likedBy) && d.likedBy.includes(userId);
    const promptShort = String(d.prompt || '').slice(0, 80);
    const promptDisplay = String(d.prompt || '').slice(0, 120);
    const authorDisplay = String(d.author || 'Anonymous').slice(0, 40);
    return `<div class="community-card" data-id="${escapeAttr(d.designId || '')}">
      <div class="community-card-img-wrap" data-url="${escapeAttr(previewUrl)}" data-prompt="${escapeAttr(d.prompt || '')}" data-style="${escapeAttr(d.style || '')}" data-author="${escapeAttr(d.author || 'Anonymous')}" data-back="${escapeAttr(d.backDesignUrl || '')}" tabindex="0" role="button" aria-label="Thêm mẫu ${escapeAttr(promptShort || 'cộng đồng')} vào áo">
        <img class="community-card-img" src="${escapeAttr(previewUrl)}" alt="${escapeAttr(promptShort || 'Thiết kế cộng đồng')}" loading="lazy">
      </div>
      <div class="community-card-info">
        <div class="community-card-prompt">"${escapeHtml(promptDisplay)}"</div>
        <div class="community-card-meta">
          <span class="community-card-author" data-author="${escapeAttr(d.author || 'Anonymous')}"><svg class="community-author-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ${escapeHtml(authorDisplay)}</span>
          <button class="community-card-like ${liked ? 'liked' : ''}" data-id="${escapeAttr(d.designId || '')}" data-likes="${d.likes || 0}" aria-pressed="${liked ? 'true' : 'false'}" aria-label="Thích thiết kế, hiện có ${d.likes || 0} lượt thích" type="button">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="${liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            <span>${d.likes || 0}</span>
          </button>
        </div>
      </div>
    </div>`;
  };

  grid.innerHTML = shown.map(cardHtml).join('') + (designs.length > PAGE ? `<div class="community-state" id="communityMoreWrap"><button class="community-retry-btn" id="communityMore" type="button">Xem thêm (${designs.length - PAGE} mẫu)</button></div>` : '');

  grid.querySelectorAll('.community-card-img-wrap').forEach(wrap => {
    const pick = () => {
      if (!wrap.dataset.url) { showToast('Mẫu này thiếu ảnh xem trước.', 'warning'); return; }
      state.currentDesign = { success: true, designId: 'community-' + Date.now(), designUrl: wrap.dataset.url, frontDesignUrl: wrap.dataset.url, backDesignUrl: wrap.dataset.back, prompt: wrap.dataset.prompt, style: wrap.dataset.style, author: wrap.dataset.author };
      state.savedDesignId = null; state.savedDesignName = null; updateSavedBadge(); // remix community = identity mới
      // Additive like every other source: community picks join the layers.
      showDesignOnMockup(wrap.dataset.url, null, null, undefined, { name: String(wrap.dataset.prompt || 'Cộng đồng').slice(0, 24), designId: state.currentDesign.designId, prompt: wrap.dataset.prompt, style: wrap.dataset.style });
      const pi = document.getElementById('promptInput');
      if (pi && wrap.dataset.prompt) { pi.value = wrap.dataset.prompt; pi.dispatchEvent(new Event('input')); }
      const sb = document.querySelector(`.style-chip[data-style="${wrap.dataset.style}"]`);
      if (sb) { document.querySelectorAll('.style-chip').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); }); sb.classList.add('active'); sb.setAttribute('aria-pressed', 'true'); state.selectedStyle = wrap.dataset.style; }
      showToast('Đã thêm mẫu cộng đồng vào áo.', 'success');
    };
    wrap.addEventListener('click', pick);
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
  });

  document.getElementById('communityMore')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const rest = designs.slice(PAGE).map(cardHtml).join('');
    btn.closest('#communityMoreWrap')?.remove();
    grid.insertAdjacentHTML('beforeend', rest);
    // Rebind new nodes (simple: reload bindings for all — idempotent for old nodes? use fresh query for new only via delegation fallback: reload whole gallery bindings by re-calling lightweight binder)
    loadCommunityBindings(grid, userId);
  });

  loadCommunityBindings(grid, userId);
}

function loadCommunityBindings(grid, userId) {
  grid.querySelectorAll('.community-card-like:not([data-bound])').forEach(btn => {
    btn.dataset.bound = '1';
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const designId = btn.dataset.id;
      if (!designId || btn.disabled) return;
      btn.disabled = true;
      try {
        const resp = await fetch(`${API_BASE}/ai-design/${encodeURIComponent(designId)}/like`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId }),
        });
        const data = await resp.json();
        if (data.success) {
          btn.classList.toggle('liked', data.liked);
          btn.setAttribute('aria-pressed', data.liked ? 'true' : 'false');
          btn.setAttribute('aria-label', `Thích thiết kế, hiện có ${data.likes} lượt thích`);
          const heart = btn.querySelector('svg');
          if (heart) heart.setAttribute('fill', data.liked ? 'currentColor' : 'none');
          const label = btn.querySelector('span');
          if (label) label.textContent = data.likes;
        } else {
          showToast('Không thể thích mẫu lúc này. Thử lại sau.', 'warning');
        }
      } catch { showToast('Mất kết nối — không thể thích mẫu.', 'warning'); }
      finally { btn.disabled = false; }
    });
  });
}

/* ============================================================
   INIT
   ============================================================ */
/* ============================================================
   ONBOARDING
   ============================================================ */
function initOnboarding() {
  if (localStorage.getItem('blankup_onboarding_done') === 'true') return;
  if (localStorage.getItem('blankup_guest_trial_used') === 'true') return;
  const authModal = document.getElementById('authRequiredModal');
  if (authModal && authModal.style.display === 'flex') return;

  const steps = [
    {
      title: 'Chào mừng đến với AI Studio',
      desc: 'Tạo thiết kế áo thun độc đáo với AI. Chúng tôi sẽ hướng dẫn bạn các bước cơ bản để bắt đầu.',
      target: null,
      arrow: null,
    },
    {
      title: 'Nhập mô tả thiết kế',
      desc: 'Viết mô tả chi tiết về thiết kế bạn muốn. AI sẽ biến ý tưởng của bạn thành hiện thực.',
      target: '#promptInput',
      arrow: 'bottom',
    },
    {
      title: 'Chọn phong cách',
      desc: 'Lựa chọn từ 8 phong cách: Tối giản, Streetwear, Vintage, Anime, Màu nước và nhiều hơn nữa.',
      target: '.style-grid',
      arrow: 'bottom',
    },
    {
      title: 'Tạo thiết kế',
      desc: 'Nhấn nút này để AI tạo ra thiết kế độc đáo dựa trên mô tả và phong cách bạn đã chọn.',
      target: '#generatePromptBtn',
      arrow: 'right',
    },
    {
      title: 'Xem trước 3D',
      desc: 'Thiết kế hiển thị trực tiếp trên mô hình áo 3D. Xoay, phóng to để xem mọi góc cạnh.',
      target: '#canvasWrapper',
      arrow: 'top',
    },
    {
      title: 'Tùy chỉnh & Đặt hàng',
      desc: 'Chọn loại áo, màu sắc, kích cỡ và số lượng. Khi hài lòng, bạn có thể đặt hàng hoặc tải về.',
      target: '.studio-right',
      arrow: 'left',
    },
    {
      title: 'Sẵn sàng sáng tạo!',
      desc: 'Bạn đã nắm được các thao tác cơ bản. Hãy tạo ra những thiết kế độc đáo của riêng bạn!',
      target: null,
      arrow: null,
    },
  ];

  let currentStep = 0;
  const overlay = document.getElementById('onboardingOverlay');
  const tooltip = document.getElementById('onboardingTooltip');
  const dots = document.getElementById('onboardingDots');
  const skipBtn = document.getElementById('onboardingSkip');
  const prevBtn = document.getElementById('onboardingPrev');
  const nextBtn = document.getElementById('onboardingNext');
  let highlightEl = null;

  function removeHighlight() {
    if (highlightEl) { highlightEl.remove(); highlightEl = null; }
  }

  function showStep(idx) {
    const step = steps[idx];
    currentStep = idx;

    removeHighlight();
    prevBtn.style.display = idx === 0 ? 'none' : '';
    nextBtn.textContent = idx === steps.length - 1 ? 'Bắt đầu!' : 'Tiếp theo';
    skipBtn.style.display = idx === steps.length - 1 ? 'none' : '';

    dots.querySelectorAll('.onboarding-dot').forEach((d, i) => {
      d.classList.toggle('active', i === idx);
    });

    tooltip.className = 'onboarding-tooltip';
    tooltip.innerHTML = `
      <div class="onboarding-tooltip-step">Bước ${idx + 1}/${steps.length}</div>
      <div class="onboarding-tooltip-title">${step.title}</div>
      <div class="onboarding-tooltip-desc">${step.desc}</div>
      <div class="onboarding-tooltip-arrow"></div>
    `;

    if (!step.target) {
      tooltip.style.position = 'relative';
      tooltip.style.left = 'auto';
      tooltip.style.top = 'auto';
      tooltip.style.transform = 'none';
      tooltip.style.maxWidth = '420px';
      return;
    }

    const targetEl = document.querySelector(step.target);
    if (!targetEl) {
      tooltip.style.position = 'relative';
      tooltip.style.left = 'auto';
      tooltip.style.top = 'auto';
      tooltip.style.transform = 'none';
      return;
    }

    const rect = targetEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Highlight ring
    highlightEl = document.createElement('div');
    highlightEl.className = 'onboarding-highlight';
    highlightEl.style.left = rect.left + 'px';
    highlightEl.style.top = rect.top + 'px';
    highlightEl.style.width = rect.width + 'px';
    highlightEl.style.height = rect.height + 'px';
    overlay.appendChild(highlightEl);

    const tipW = 340;
    const tipH = 160;

    tooltip.style.position = 'absolute';
    tooltip.style.maxWidth = tipW + 'px';
    tooltip.classList.add('onboarding-arrow-' + step.arrow);

    switch (step.arrow) {
      case 'bottom':
        tooltip.style.left = Math.max(16, Math.min(rect.left + rect.width / 2 - tipW / 2, vw - tipW - 16)) + 'px';
        tooltip.style.top = (rect.bottom + 12) + 'px';
        break;
      case 'top':
        tooltip.style.left = Math.max(16, Math.min(rect.left + rect.width / 2 - tipW / 2, vw - tipW - 16)) + 'px';
        tooltip.style.top = (rect.top - tipH - 12) + 'px';
        break;
      case 'left':
        tooltip.style.left = (rect.left - tipW - 12) + 'px';
        tooltip.style.top = Math.max(16, Math.min(rect.top + rect.height / 2 - tipH / 2, vh - tipH - 16)) + 'px';
        break;
      case 'right':
        tooltip.style.left = (rect.right + 12) + 'px';
        tooltip.style.top = Math.max(16, Math.min(rect.top + rect.height / 2 - tipH / 2, vh - tipH - 16)) + 'px';
        break;
    }

    // Clamp tooltip within viewport
    const tRect = tooltip.getBoundingClientRect();
    if (tRect.right > vw) tooltip.style.left = (vw - tRect.width - 16) + 'px';
    if (tRect.left < 0) tooltip.style.left = '16px';
    if (tRect.bottom > vh) tooltip.style.top = (vh - tRect.height - 16) + 'px';
    if (tRect.top < 0) tooltip.style.top = '16px';
  }

  function finish() {
    overlay.style.display = 'none';
    document.body.style.overflow = '';
    removeHighlight();
    localStorage.setItem('blankup_onboarding_done', 'true');
  }

  skipBtn.addEventListener('click', finish);
  prevBtn.addEventListener('click', () => { if (currentStep > 0) showStep(currentStep - 1); });
  nextBtn.addEventListener('click', () => {
    if (currentStep < steps.length - 1) showStep(currentStep + 1);
    else finish();
  });

  // Build dots
  dots.innerHTML = steps.map((_, i) => `<span class="onboarding-dot${i === 0 ? ' active' : ''}"></span>`).join('');

  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  setTimeout(() => showStep(0), 150);
}

document.addEventListener('DOMContentLoaded', () => {
  i18n.init();
  // CSP-safe image fallback: single capture-phase listener replaces inline
  // onerror attributes (blocked by script-src-attr 'none'). Swaps any failed
  // design thumbnail to the embedded SVG fallback exactly once.
  document.addEventListener('error', (e) => {
    const t = e.target;
    if (t && t.tagName === 'IMG' && !t.dataset.fbk && typeof IMAGE_FALLBACK_SVG === 'string') {
      t.dataset.fbk = '1';
      t.src = IMAGE_FALLBACK_SVG;
    }
  }, true);
  initTabs();
  initPromptSideSwitch();
  initStyleSelector();
  initUpload();
  initPromptSuggestions();
  initProductTypeSelector();
  initColorPicker();
  initSizeSelector();
  initQuantity();
  initGenerateButtons();
  initPrintControls();
  initPrintPresets();
  initCropMode();
  initPrintPreview();
  initBackDesignControls();
  initInteractionMode();
  initCanvasLayerDrag();
  initOrderFlow();
  initDownload();
  initShareDesign();
  initViewToggle();
  initThreeViewer();
  initHistory();
  initSavedDesigns();
  initOnboarding();
  loadCommunityDesigns();
  updatePrice();
  // Entry guard: must notify immediately if not authenticated (fix: Studio login-entry)
  // Use rAF + timeout to ensure auth.js init has run and toast.js ready, deduped
  requestAnimationFrame(() => setTimeout(checkStudioAuthOnEntry, 80));
  // Credit badge: load once after entry (plain setTimeout — rAF is throttled in
  // background tabs), again on auth change, and whenever the tab becomes visible.
  setTimeout(refreshCreditRemaining, 400);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshCreditRemaining();
  });

  // Also re-check when auth state changes (e.g., logout then back, or login via modal)
  window.addEventListener('storage', (e) => {
    if (e.key === 'blankup_token' || e.key === 'blankup_user') {
      if (isStudioAuthenticated()) hideStudioAuthPrompt();
      else showStudioAuthPrompt('storage');
      refreshCreditRemaining();
    }
  });

  // UI-03: Escape closes authRequiredModal (a11y parity with commentsModal)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('authRequiredModal');
      if (modal && modal.style.display === 'flex') {
        hideStudioAuthPrompt();
        // Focus stays on body; toast unaffected; Generate still guarded by requireAuth()
      }
    }
  });

  // Handle payment return from VNPay — NEVER trust query param alone. Verify via backend.
  (async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const paymentStatus = urlParams.get('payment');
    if (!paymentStatus) return;
    const orderId = urlParams.get('orderId');
    const cleanUrl = window.location.pathname + window.location.hash;
    // Strip query immediately to avoid replay on refresh, but keep orderId for verification
    window.history.replaceState({}, '', cleanUrl);
    if (!orderId) {
      showToast('Thiếu mã đơn hàng trong kết quả thanh toán. Vui lòng kiểm tra Tài khoản → Đơn hàng.', 'warning', 8000);
      return;
    }
    try {
      const headers = {};
      if (typeof auth !== 'undefined' && auth.token) headers['Authorization'] = `Bearer ${auth.token}`;
      const resp = await fetch(`${API_BASE}/payment/status/${encodeURIComponent(orderId)}`, { headers });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      const realStatus = data.paymentStatus || data.status;
      const backendStatus = data.status;
      if (data.paymentStatus === 'paid' || data.status === 'processing') {
        showToast(`Thanh toán thành công! Mã đơn: ${orderId}`, 'success', 8000);
      } else if (data.paymentStatus === 'failed' || backendStatus === 'payment_failed') {
        showToast(`Thanh toán thất bại cho đơn ${orderId}. Vui lòng thử lại.`, 'error', 8000);
      } else if (paymentStatus === 'success' && data.paymentStatus !== 'paid') {
        // Query claimed success but backend not paid → show backend truth
        showToast(`Đơn ${orderId} chưa được xác nhận thanh toán (trạng thái: ${data.paymentStatus || backendStatus || 'chưa rõ'}). Vui lòng kiểm tra lại.`, 'warning', 8000);
      } else if (paymentStatus === 'failed') {
        showToast(`Thanh toán thất bại (mã: ${urlParams.get('code') || 'unknown'}). Vui lòng thử lại.`, 'error', 8000);
      } else {
        showToast(`Trạng thái thanh toán đơn ${orderId}: ${data.paymentStatus || backendStatus || paymentStatus}`, data.paymentStatus === 'paid' ? 'success' : 'info', 8000);
      }
    } catch (e) {
      console.warn('[Payment] verify return failed:', e);
      // Fallback: do not claim success if verification fails
      if (paymentStatus === 'success') {
        showToast(`Không thể xác thực thanh toán cho đơn ${orderId || ''}. Vui lòng kiểm tra Tài khoản → Đơn hàng.`, 'warning', 8000);
      } else {
        showToast(`Thanh toán thất bại (mã: ${urlParams.get('code') || 'unknown'}). Vui lòng thử lại.`, 'error', 8000);
      }
    }
  })();

  // Load design from URL params
  const params = new URLSearchParams(window.location.search);
  const designUrl = params.get('designUrl');
  if (designUrl) {
    setTimeout(() => {
      if (typeof window.loadCommunityDesign === 'function') {
        window.loadCommunityDesign(designUrl, params.get('prompt') || '', params.get('style') || 'abstract', params.get('author') || 'Community');
      } else {
        state.currentDesign = { success: true, designId: 'url-' + Date.now(), designUrl, prompt: params.get('prompt') || '', style: params.get('style') || 'abstract' };
        showDesignOnMockup(designUrl);
      }
    }, 300);
  }

  // Prefill prompt + style from URL (e.g. homepage collection cards)
  const promptParam = params.get('prompt');
  if (promptParam && !designUrl) {
    setTimeout(() => {
      const input = document.getElementById('promptInput');
      if (input) {
        input.value = promptParam;
        input.focus();
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      const styleParam = (params.get('style') || '').toLowerCase();
      if (styleParam) {
        const chip = document.querySelector(`.style-chip[data-style="${styleParam}"]`);
        if (chip) {
          document.querySelectorAll('.style-chip').forEach(b => b.classList.remove('active'));
          chip.classList.add('active');
          state.selectedStyle = styleParam;
        }
      }
      showToast('Đã tải sẵn ý tưởng — bấm "Tạo thiết kế" để bắt đầu!', 'info', 5000);
    }, 300);
  }
});

i18n.onChange?.(() => loadCommunityDesigns());

/* ============================================================
   ORDER REVIEW CTA — mời đánh giá ngay sau khi thanh toán được xác nhận.
   Hoạt động cho CẢ khách guest (chứng thực bằng paymentWatchToken phát tại
   checkout) và user đã đăng nhập (JWT). Một đơn chỉ đánh giá được một lần —
   server chặn trùng (409) và giao diện chuyển sang trạng thái đã cảm ơn.
   ============================================================ */
(function () {
  'use strict';

  const ORDER_RATING_LABELS = { 1: 'Không hài lòng', 2: 'Cần cải thiện', 3: 'Bình thường', 4: 'Rất tốt', 5: 'Tuyệt vời' };
  let orderReviewRating = 5;
  let orderReviewPreview = 0;
  let orderReviewOrderId = null;
  let orderReviewWatchToken = '';

  function renderOrderReviewStars() {
    const wrap = document.getElementById('orderReviewStars');
    const label = document.getElementById('orderReviewLabel');
    if (!wrap) return;
    const shown = orderReviewPreview || orderReviewRating;
    wrap.innerHTML = [1, 2, 3, 4, 5].map(n =>
      `<button type="button" class="order-review-star${n <= shown ? ' on' : ''}${orderReviewPreview && n <= orderReviewPreview ? ' preview' : ''}" data-star="${n}" role="radio" aria-checked="${n === orderReviewRating}" aria-label="${n} sao">★</button>`
    ).join('');
    if (label) {
      label.textContent = ORDER_RATING_LABELS[shown] || '';
      label.dataset.level = String(shown);
    }
  }

  function showOrderReviewCta(orderId, watchToken) {
    orderReviewOrderId = orderId || null;
    orderReviewWatchToken = watchToken || '';
    orderReviewRating = 5;
    orderReviewPreview = 0;
    const cta = document.getElementById('orderReviewCta');
    if (!cta) return;
    const done = document.getElementById('orderReviewDone');
    const ta = document.getElementById('orderReviewText');
    const count = document.getElementById('orderReviewCount');
    const btn = document.getElementById('orderReviewSubmitBtn');
    if (done) done.style.display = 'none';
    if (ta) ta.value = '';
    if (count) count.textContent = '0/600';
    if (btn) { btn.disabled = false; btn.textContent = 'Gửi đánh giá'; btn.classList.remove('loading', 'success'); }
    renderOrderReviewStars();
    cta.style.display = 'block';
  }
  window.showOrderReviewCta = showOrderReviewCta;

  function submitOrderReview() {
    if (!orderReviewOrderId) return;
    const btn = document.getElementById('orderReviewSubmitBtn');
    if (!btn || btn.disabled) return;
    const comment = (document.getElementById('orderReviewText')?.value || '').trim();
    btn.disabled = true;
    btn.textContent = '⏳ Đang gửi...';
    btn.classList.add('loading');
    const headers = { 'Content-Type': 'application/json' };
    if (window.auth && typeof window.auth.getAuthHeaders === 'function') {
      Object.assign(headers, window.auth.getAuthHeaders());
    }
    fetch(window.location.origin + '/api/reviews', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        orderId: orderReviewOrderId,
        rating: orderReviewRating,
        comment: comment || undefined,
        watchToken: orderReviewWatchToken || undefined,
      }),
    }).then(async (resp) => {
      const data = await resp.json().catch(() => ({}));
      const done = document.getElementById('orderReviewDone');
      if (!resp.ok || data.success === false) {
        // Đã đánh giá rồi (409) → coi như thành công, hiện trạng thái cảm ơn.
        if (resp.status === 409) {
          if (done) { done.textContent = '✓ Đơn này đã được đánh giá trước đó — cảm ơn bạn!'; done.style.display = 'block'; }
          const btnDup = document.getElementById('orderReviewSubmitBtn');
          if (btnDup) { btnDup.textContent = '✓ Đã gửi'; btnDup.classList.remove('loading'); btnDup.disabled = false; }
          hideOrderReviewForm();
          return;
        }
        throw new Error(data.error || 'Không thể gửi đánh giá.');
      }
      if (done) done.style.display = 'block';
      const btnOk = document.getElementById('orderReviewSubmitBtn');
      if (btnOk) { btnOk.textContent = '✓ Đã gửi'; btnOk.classList.remove('loading'); btnOk.classList.add('success'); }
      hideOrderReviewForm();
    }).catch((err) => {
      const btn2 = document.getElementById('orderReviewSubmitBtn');
      if (btn2) { btn2.disabled = false; btn2.textContent = 'Gửi đánh giá'; btn2.classList.remove('loading'); }
      if (typeof showToast === 'function') showToast(err.message || 'Không thể gửi đánh giá.', 'error');
    });
  }

  function hideOrderReviewForm() {
    const head = document.querySelector('#orderReviewCta .order-review-head');
    const ta = document.getElementById('orderReviewText');
    const foot = document.querySelector('#orderReviewCta .order-review-foot');
    if (head) head.style.display = 'none';
    if (ta) ta.style.display = 'none';
    if (foot) foot.style.display = 'none';
  }

  document.addEventListener('click', (e) => {
    const star = e.target.closest('#orderReviewStars [data-star]');
    if (star) {
      orderReviewRating = Number(star.dataset.star) || 5;
      orderReviewPreview = 0;
      renderOrderReviewStars();
      return;
    }
    if (e.target.closest('#orderReviewSubmitBtn')) submitOrderReview();
  });

  document.addEventListener('mouseover', (e) => {
    const star = e.target.closest('#orderReviewStars [data-star]');
    if (star) {
      orderReviewPreview = Number(star.dataset.star) || 0;
      renderOrderReviewStars();
      return;
    }
    if (e.target.closest('#orderReviewCta') && orderReviewPreview) {
      orderReviewPreview = 0;
      renderOrderReviewStars();
    }
  });

  document.getElementById('orderReviewText')?.addEventListener('input', (e) => {
    const count = document.getElementById('orderReviewCount');
    if (count) count.textContent = `${e.target.value.length}/600`;
  });
})();
