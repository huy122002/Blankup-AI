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
  printDesignUrl: null,
  preparedDesignUrls: { front: null, back: null },
  // Multi-design layers: independent entities per garment side.
  // layer = { id, url, x, y, scale, rotation, visible, z, name,
  //           designId, prompt, style }
  designLayers: { front: [], back: [] },
  selectedLayerId: { front: null, back: null },
  lastGenerated: { front: null, back: null },
  customText: '',
  printPlacement: { x: 0, y: -12, scale: 1 },
  textPlacement: { x: 0, y: 18, scale: 1 },
  sidePrintPlacement: { front: null, back: null },
  sideTextPlacement: { front: null, back: null },
  compositeDesignUrls: { front: null, back: null },
  compositeCacheKey: '',
  interactionMode: 'position',
  activePlacementLayer: 'image',
  isGeneratingAi: false,
  customTextSides: { front: '', back: '' },
  designProcessVersion: 0,
  viewer3d: null,
  cssViewer: null,
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
function commitActivePlacements() {
  const k = sideKey();
  state.sidePrintPlacement[k] = { ...state.printPlacement };
  state.sideTextPlacement[k] = { ...state.textPlacement };
  state.compositeCacheKey = '';
}
function loadPlacementsForSide(side) {
  state.printPlacement = { ...getSidePrintPlacement(side) };
  state.textPlacement = { ...getSideTextPlacement(side) };
}
function syncCustomTextInputs() {
  const v = getSideCustomText();
  document.querySelectorAll('#customTextInput, #customTextInputImage').forEach(o => { if (o) o.value = v; });
}
function updateSideBadge() {
  const badge = document.getElementById('viewerSideBadge');
  if (badge) {
    const back = state.currentView === 'back';
    badge.textContent = back ? 'MẶT SAU' : 'MẶT TRƯỚC';
    badge.classList.toggle('is-back', back);
  }
  const tag = document.getElementById('placementSideTag');
  if (tag) {
    const back = state.currentView === 'back';
    tag.textContent = back ? 'mặt sau' : 'mặt trước';
    tag.classList.toggle('is-back', back);
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
  document.getElementById('backGenerateBtn')?.addEventListener('click', () => generateFromPrompt('back'));
  document.getElementById('backClearBtn')?.addEventListener('click', () => {
    clearSideLayers('back');
    state.preparedDesignUrls.back = null;
    if (state.currentDesign) state.currentDesign.backDesignUrl = '';
    state.compositeCacheKey = '';
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
  const snap = (side) => sideLayers(side).map(l => [l.id, l.url, l.x, l.y, l.scale, l.rotation, l.visible, l.z]);
  return JSON.stringify({
    front: snap('front'), back: snap('back'),
    customText: state.customText, customTextSides: state.customTextSides,
    sideTextPlacement: state.sideTextPlacement,
  });
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
function loadImageForCanvas(url) {
  return new Promise((resolve, reject) => {
    if (!url) return resolve(null);
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img); img.onerror = reject; img.src = url;
  });
}

async function drawLayerOnContext(ctx, size, layer) {
  // Same mapping as the 2D overlay so 2D == composite == 3D decal.
  try {
    const img = await loadImageForCanvas(layer.url);
    if (!img) return;
    const maxW = size * 0.58 * layer.scale, maxH = size * 0.58 * layer.scale;
    const ratio = Math.min(maxW / img.width, maxH / img.height);
    const w = img.width * ratio, h = img.height * ratio;
    const cx = size * (0.5 + layer.x / 100), cy = size * (0.44 + layer.y / 100);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(((layer.rotation || 0) * Math.PI) / 180);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
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
    const tp = getSideTextPlacement(k);
    const text = sideText.toUpperCase();
    const fs = Math.max(34, 82 * tp.scale);
    const x = size * (0.5 + tp.x / 100), y = size * (0.5 + tp.y / 100);
    ctx.font = `900 ${fs}px Outfit, Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(6, fs * 0.12);
    ctx.strokeStyle = 'rgba(255,255,255,0.94)'; ctx.fillStyle = '#111827';
    ctx.strokeText(text, x, y); ctx.fillText(text, x, y);
  }
  return canvas.toDataURL('image/png');
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
  await drawLayerOnContext(ctx, size, { url: designUrl, x: 0, y: -12, scale: 1, rotation: 0 });
  if (sideText) {
    const tp = getSideTextPlacement(k);
    ctx.font = `900 ${Math.max(34, 82 * tp.scale)}px Outfit, Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#111827';
    ctx.fillText(sideText.toUpperCase(), size * (0.5 + tp.x / 100), size * (0.5 + tp.y / 100));
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
  overlay.innerHTML = layers.map(l => {
    const isSel = selected && selected.id === l.id;
    const style = `left:0;top:0;width:46%;max-width:320px;transform:translate(calc(-50% + ${l.x}%), calc(-50% + ${l.y}%)) scale(${l.scale}) rotate(${l.rotation || 0}deg);z-index:${10 + l.z};cursor:pointer;${isSel ? 'outline:2px dashed var(--s-accent, #ff6b00);outline-offset:3px;' : ''}`;
    return `<img src="${escapeAttr(l.url)}" alt="${escapeAttr(l.name || 'Design')}" class="mockup-print-design" data-layer-id="${escapeAttr(l.id)}" draggable="false" style="${style}">`;
  }).join('') + (activeText ? `<div class="mockup-print-text">${escapeHtml(activeText)}</div>` : '');
  // Click-to-select a specific layer (controls then affect ONLY it).
  overlay.querySelectorAll('img[data-layer-id]').forEach(img => {
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      selectLayer(side, img.dataset.layerId);
      showToast(`Đang chỉnh: ${getSelectedLayer(side)?.name || ''}`, 'info', 1500);
      refreshSideViews();
    });
  });
  updateOverlayPlacement();
  updateThreeTexture();
  renderLayerList();
}

function renderLayerList() {
  const list = document.getElementById('layerList');
  const countTag = document.getElementById('layerCountTag');
  if (!list) return;
  const side = state.currentView;
  const layers = [...sideLayers(side)].sort((a, b) => b.z - a.z);
  if (countTag) countTag.textContent = layers.length ? `${layers.length} mẫu · ${side === 'back' ? 'mặt sau' : 'mặt trước'}` : '';
  if (!layers.length) {
    list.innerHTML = `<div class="layer-empty">Chưa có mẫu nào ở mặt này. Hãy tạo thiết kế rồi chọn “Thêm vào áo”.</div>`;
    return;
  }
  const selected = getSelectedLayer(side);
  list.innerHTML = layers.map((l, idx) => `
    <div class="layer-row${selected && selected.id === l.id ? ' selected' : ''}" data-layer-id="${escapeAttr(l.id)}">
      <img class="layer-thumb" src="${escapeAttr(l.url)}" alt="">
      <div class="layer-info">
        <div class="layer-name">${escapeHtml(l.name || 'Mẫu')}</div>
        <div class="layer-meta">x:${Math.round(l.x)} y:${Math.round(l.y)} · ${Math.round(l.scale * 100)}%${l.rotation ? ` · ${Math.round(l.rotation)}°` : ''}${l.visible === false ? ' · ẩn' : ''}</div>
      </div>
      <div class="layer-actions">
        <button class="layer-btn" data-action="up" title="Đưa lên trên" ${idx === 0 ? 'disabled' : ''}>▲</button>
        <button class="layer-btn" data-action="down" title="Đưa xuống dưới" ${idx === layers.length - 1 ? 'disabled' : ''}>▼</button>
        <button class="layer-btn" data-action="toggle" title="Ẩn/hiện">${l.visible === false ? '👁‍🗨' : '👁'}</button>
        <button class="layer-btn" data-action="replace" title="Thay bằng mẫu mới nhất">⟳</button>
        <button class="layer-btn layer-del" data-action="delete" title="Xóa mẫu">✕</button>
      </div>
    </div>`).join('');
  list.querySelectorAll('.layer-row').forEach(row => {
    const id = row.dataset.layerId;
    row.addEventListener('click', (e) => {
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
}

async function handleLayerAction(side, id, action) {
  const layers = sideLayers(side);
  const layer = layers.find(l => l.id === id);
  if (action === 'delete') {
    removeLayer(side, id);
    showToast('Đã xóa mẫu khỏi áo.', 'info');
  } else if (action === 'toggle') {
    if (layer) layer.visible = layer.visible === false ? true : false;
  } else if (action === 'up') {
    moveLayerZ(side, id, +1);
  } else if (action === 'down') {
    moveLayerZ(side, id, -1);
  } else if (action === 'replace') {
    const fresh = state.lastGenerated[side === 'back' ? 'back' : 'front'];
    if (!fresh) {
      showToast('Chưa có mẫu mới nào. Hãy bấm “Tạo Design” trước.', 'warning');
      return;
    }
    if (layer) {
      layer.url = fresh;
      showToast('Đã thay mẫu đang chọn bằng mẫu mới nhất.', 'success');
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
}

function updateThreeTexture() {
  // Debounced: rebuilds the side composite and pushes it to the 3D decal.
  // Cache + viewer guards make no-op updates cheap.
  scheduleViewerUpdate();
}

async function applyCurrentDesignToViewer() {
  // The side composite (all visible layers + text) is the single image the
  // 3D decal shows — 2D and 3D always agree. The viewer skips recompute when
  // the composite URL is unchanged, so color/product/rotate updates stay
  // instant and only real composition changes re-run decal clipping.
  const vd = await getCompositeDesignsForViewer();
  const activeComposite = state.currentView === 'back' ? (vd.back || vd.front) : (vd.front || vd.back);
  state.printDesignUrl = activeComposite || '';
  try { window.tshirt360Viewer?.setDesign?.(activeComposite || null); } catch (e) { /* */ }
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

function setActivePlacementLayer(layer = 'image') { state.activePlacementLayer = layer === 'text' ? 'text' : 'image'; updateOverlayPlacement(); }

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
  const preset = PRINT_POSITION_PRESETS[key];
  if (!preset) return;
  const sel = requireSelectedLayer();
  if (!sel) return;
  sel.x = preset.x; sel.y = preset.y; sel.scale = preset.scale;
  state.printPlacement = { x: sel.x, y: sel.y, scale: sel.scale };
  commitActivePlacements();
  syncPlacementInputs();
  refreshSideViews();
  syncPresetChips();
}

function applyPrintSizePreset(key) {
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
  if (!dropzone || !fileInput) return;

  // A11y: make dropzone focusable and operable via keyboard
  if (!dropzone.hasAttribute('tabindex')) dropzone.setAttribute('tabindex', '0');
  dropzone.setAttribute('role', 'button');
  dropzone.setAttribute('aria-label', 'Upload ảnh tham khảo');

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

  function handleFile(file) {
    if (!file.type.startsWith('image/')) { showError('Chỉ chấp nhận file ảnh!'); return; }
    if (file.size > 10 * 1024 * 1024) { showError('File quá lớn (tối đa 10MB)!'); return; }
    state.uploadedFile = file;
    // PROCESSING → PREVIEW (FileReader async, but we treat as preview)
    dropzone.classList.remove('is-dragging', 'dragover');
    dropzone.style.willChange = '';
    showPreview(file);
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
    // keep is-dragging during dragover
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

  // Broken preview file (e.g. corrupt data URL): fall back to dropzone, never a broken box
  previewImg?.addEventListener('error', () => {
    state.uploadedFile = null;
    try { previewImg.removeAttribute('src'); } catch {}
    preview.style.display = 'none';
    dropzone.style.display = 'flex';
    setIdle();
    if (window.showToast) window.showToast('Không đọc được ảnh này. Hãy thử file PNG/JPG/WEBP khác.', 'warning');
  });

  // Remove → IDLE with fade out
  if (removeBtn) removeBtn.addEventListener('click', () => {
    state.uploadedFile = null;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce && preview.style.display !== 'none') {
      preview.classList.add('leaving');
      preview.style.willChange = 'transform, opacity';
      preview.addEventListener('animationend', function h(){
        preview.style.display = 'none';
        preview.classList.remove('leaving', 'entering');
        preview.style.willChange = '';
        dropzone.style.display = 'flex';
        // Ensure dropzone is clean idle
        setIdle();
        preview.removeEventListener('animationend', h);
      }, {once:true});
    } else {
      preview.style.display = 'none';
      dropzone.style.display = 'flex';
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
      <img class="history-item-thumb" src="${escapeAttr(h.designUrl || h.frontDesignUrl)}" alt="" loading="lazy" onerror="this.dataset.fbk='1';this.src='${IMAGE_FALLBACK_SVG}'">
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
        // Restore full multi-layer composition when available; otherwise
        // fall back to adding the single snapshot URL as one layer.
        if (entry.layers && (entry.layers.front?.length || entry.layers.back?.length)) {
          for (const side of ['front', 'back']) {
            clearSideLayers(side);
            (entry.layers[side] || []).forEach((l) => {
              const added = addLayer(side, { url: l.url, name: l.name, designId: l.designId, prompt: l.prompt, style: l.style });
              if (added) Object.assign(added, { x: l.x, y: l.y, scale: l.scale, rotation: l.rotation || 0, visible: l.visible !== false, z: l.z });
            });
          }
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

async function generateFromPrompt(targetSide = 'front') {
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
  const btn = document.getElementById('generatePromptBtn');
  const isBack = targetSide === 'back';
  updateActionButtons(false);
  setLoading(btn, true);
  startGenProgress();

  const draft = generateMockDesign(state.selectedStyle, prompt);
  draft.isDraft = true;
  // The draft is a real layer marked draft; the AI result REPLACES this same
  // layer on success (no duplicate) or stays visible on failure.
  let draftLayerId = null;
  if (isBack) {
    if (!state.currentDesign) state.currentDesign = draft;
    state.currentDesign.backDesignUrl = draft.designUrl;
    const created = await showDesignOnMockup(draft.designUrl, null, null, 'back', { name: 'Đang tạo (sau)…', designId: draft.designId, prompt, style: state.selectedStyle });
    if (created) { created.isDraft = true; draftLayerId = created.id; }
  } else {
    state.currentDesign = draft;
    state.isGeneratingAi = true;
    const created = await showDesignOnMockup(draft.designUrl, null, null, undefined, { name: 'Đang tạo…', designId: draft.designId, prompt, style: state.selectedStyle });
    if (created) { created.isDraft = true; draftLayerId = created.id; }
  }

  const genController = new AbortController();
  const genTimeout = setTimeout(() => genController.abort(), GEN_FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(`${API_BASE}/ai-design/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth.token ? `Bearer ${auth.token}` : '' },
      body: JSON.stringify({ prompt, style: state.selectedStyle, customText: state.customText, author: auth.user?.fullName || auth.user?.username || '' }),
      signal: genController.signal,
    });
    clearTimeout(genTimeout);
    const data = await resp.json();
    if (!resp.ok || data.success === false) throw new Error(formatAiError(data));
    if (data.success && data.designUrl) {
      state.isGeneratingAi = false;
      completeGenProgress(true);
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
    } else {
      failGenProgress();
    }
  } catch (e) {
    clearTimeout(genTimeout);
    state.isGeneratingAi = false;
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
      await showDesignOnMockup(data.designUrl, data.productMockupUrl, data.productMockupBlank, undefined, { name: String(data.prompt || 'Ảnh remix').slice(0, 24), designId: data.designId, prompt: data.prompt, style: data.style });
      updateShareButton();
      saveToHistory(data);
      showButtonSuccess(btn, '✓ Đã tạo');
      showToast('Đã thêm mẫu mới vào mặt trước.', 'success');
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
  if (state.currentView === next) {
    if (state.currentDesign || state.printDesignUrl || hasLayerDesigns(next)) { updateDesignOverlayForSide(); applyCurrentDesignToViewer(); }
    updateSideBadge();
    updateBackDesignControls();
    return;
  }
  commitActivePlacements();
  state.currentView = next;
  loadPlacementsForSide(next);
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
  set('textPosX', Math.round(state.textPlacement.x));
  set('textPosY', Math.round(state.textPlacement.y));
  set('textScale', Math.round(state.textPlacement.scale * 100));
}

// Master refresh for one side: overlay (per-layer DOM) + inputs + list +
// composite-driven 3D. All transform edits funnel through here.
async function refreshSideViews() {
  renderLayersOverlay();
  syncPlacementInputs();
  syncPresetChips();
  try {
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
    updateDesignOverlayForSide();
    applyCurrentDesignToViewer();
  }, 160);
  textInputs.forEach(input => {
    input.setAttribute('maxlength', String(HARDEN_LIMITS.customTextMax));
    input.addEventListener('input', () => applyCustomText(input));
  });

  // Image placement — always edits the SELECTED layer (never the whole side).
  const bind = (ids, stateKey, defaults) => {
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => {
        if (stateKey === 'printPlacement') {
          const sel = requireSelectedLayer();
          if (!sel) return;
          setActivePlacementLayer('image');
          sel.x = clampNum(Number(document.getElementById(ids[0])?.value ?? defaults.x), ...LAYER_BOUNDS.x);
          sel.y = clampNum(Number(document.getElementById(ids[1])?.value ?? defaults.y), ...LAYER_BOUNDS.y);
          sel.scale = clampNum(Number(document.getElementById(ids[2])?.value ?? defaults.scale * 100) / 100, ...LAYER_BOUNDS.scale, 1);
          const rotEl = document.getElementById('printRotation');
          if (rotEl) sel.rotation = clampNum(Number(rotEl.value ?? 0), ...LAYER_BOUNDS.rotation);
          state.printPlacement = { x: sel.x, y: sel.y, scale: sel.scale };
          commitActivePlacements();
          refreshSideViews();
          return;
        }
        setActivePlacementLayer('text');
        state[stateKey] = {
          x: Number(document.getElementById(ids[0])?.value || defaults.x),
          y: Number(document.getElementById(ids[1])?.value || defaults.y),
          scale: Number(document.getElementById(ids[2])?.value || defaults.scale * 100) / 100,
        };
        commitActivePlacements();
        updateOverlayPlacement();
        applyCurrentDesignToViewer();
        syncPresetChips();
      });
    });
  };
  bind(['printPosX', 'printPosY', 'printScale'], 'printPlacement', { x: 0, y: -12, scale: 1 });
  bind(['textPosX', 'textPosY', 'textScale'], 'textPlacement', { x: 0, y: 18, scale: 1 });
  document.getElementById('printRotation')?.addEventListener('input', (e) => {
    const sel = requireSelectedLayer();
    if (!sel) return;
    sel.rotation = clampNum(Number(e.target.value ?? 0), ...LAYER_BOUNDS.rotation);
    commitActivePlacements();
    refreshSideViews();
  });

  document.getElementById('placementReset')?.addEventListener('click', () => {
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
  });

  // Keyboard nudge
  document.addEventListener('keydown', e => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    if (state.interactionMode !== 'position') return;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const step = e.shiftKey ? 5 : 1;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    nudgePlacement(state.activePlacementLayer, dx, dy);
    e.preventDefault();
  });

  setInteractionMode(state.interactionMode);
  syncPlacementInputs();
  updateOverlayPlacement();
}

function nudgePlacement(layer, dx, dy) {
  if (layer === 'text') {
    state.textPlacement.x = Math.max(-80, Math.min(80, state.textPlacement.x + dx));
    state.textPlacement.y = Math.max(-75, Math.min(45, state.textPlacement.y + dy));
  } else {
    const target = getSelectedLayer();
    if (!target) return;
    target.x = clampNum(target.x + dx, ...LAYER_BOUNDS.x);
    target.y = clampNum(target.y + dy, ...LAYER_BOUNDS.y);
  }
  commitActivePlacements();
  syncPlacementInputs();
  renderLayersOverlay();
  scheduleViewerUpdate();
}

/* ============================================================
   MULTI-DESIGN LAYERS — independent entities per garment side
   ============================================================ */
const LAYER_BOUNDS = { x: [-80, 80], y: [-75, 45], scale: [0.2, 2.2], rotation: [0, 360] };

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
  if (!Number.isFinite(l.z)) l.z = 0;
  return l;
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

function selectLayer(side, id) {
  const k = side === 'back' ? 'back' : 'front';
  const layers = sideLayers(k);
  if (id != null && !layers.some(l => l.id === id)) return null;
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

function addLayer(side, { url, name, designId, prompt, style, x, y, scale, rotation } = {}) {
  if (!url) return null;
  const k = side === 'back' ? 'back' : 'front';
  const layers = sideLayers(k);
  const maxZ = layers.reduce((m, l) => Math.max(m, Number(l.z) || 0), 0);
  const layer = sanitizeLayer({
    id: layerUid('layer'),
    url,
    kind: 'image',
    x: x !== undefined ? x : 0,
    y: y !== undefined ? y : -12,
    scale: scale !== undefined ? scale : 1,
    rotation: rotation !== undefined ? rotation : 0,
    visible: true,
    z: maxZ + 1,
    name: name || `Mẫu ${layers.length + 1}`,
    designId: designId || null,
    prompt: prompt || '',
    style: style || 'minimalist',
    createdAt: Date.now(),
  });
  layers.push(layer);
  state.selectedLayerId[k] = layer.id;
  state.printPlacement = { x: layer.x, y: layer.y, scale: layer.scale };
  syncCurrentDesignFromSelection(k);
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
   3D VIEWER
   ============================================================ */
function initThreeViewer() {
  // Wait for tshirt-360.js module to load
  const check = setInterval(() => {
    if (window.tshirt360Viewer) {
      clearInterval(check);
      window.tshirt360Viewer.setColor(state.selectedColor);
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
      headers: { 'Content-Type': 'application/json', Authorization: auth.token ? `Bearer ${auth.token}` : '' },
      body: JSON.stringify(orderData),
    }, 15000);
    const data = await resp.json().catch(() => ({}));
    if (resp.status === 401) { showToast('Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.', 'warning', 5000); showStudioAuthPrompt('expired'); throw new Error('Unauthorized'); }
    if (resp.status === 429) throw new Error('Bạn thao tác quá nhanh. Vui lòng đợi 30 giây rồi thử lại.');
    if (!resp.ok || data.success === false) throw new Error(data.error || `Đặt hàng thất bại (HTTP ${resp.status}).`);

    const orderId = data.orderId || 'BU-' + Date.now();
    const payment = data.payment || state.selectedPaymentMethod;

    if (payment === 'VNPAY') {
      showOrderSuccess(orderId, payment, data.transferContent);
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

    showOrderSuccess(orderId, payment, data.transferContent);
    showButtonSuccess(submitBtn, '✓ Đã đặt');
  } catch (e) {
    if (e?.message === 'Unauthorized') { /* auth prompt already shown */ }
    else {
      shakeButton(submitBtn);
      const msg = e && e.name === 'TimeoutError' ? 'Đặt hàng quá hạn (mạng chậm). Kiểm tra Tài khoản → Đơn hàng trước khi đặt lại.' : (e.message || 'Đặt hàng thất bại. Thử lại sau.');
      showToast(msg, 'error', 7000);
    }
  } finally {
    submitBtn.disabled = false;
    if (submitBtn.innerHTML === 'Đang xử lý…') submitBtn.innerHTML = originalBtnHtml;
    submitBtn.classList.remove('is-loading');
    submitBtn.style.willChange = '';
  }
}

function showOrderSuccess(orderId, payment, transferContent) {
  document.getElementById('orderFormContent').style.display = 'none';
  document.getElementById('orderSuccess').style.display = 'block';
  document.getElementById('orderSuccessId').textContent = `Mã đơn hàng: ${orderId}`;

  if (payment === 'BANK_TRANSFER') {
    const box = document.getElementById('bankTransferBox');
    box.style.display = 'block';
    const amount = PRODUCT_PRICES[state.selectedProductType] * state.quantity;
    const qrUrl = `https://img.vietqr.io/image/${BANK_TRANSFER_INFO.bankId}-${BANK_TRANSFER_INFO.accountNumber}-compact2.png?amount=${amount}&addInfo=${encodeURIComponent(transferContent || orderId)}&accountName=${encodeURIComponent(BANK_TRANSFER_INFO.accountName)}`;
    const qrImg = document.getElementById('successQrImage');
    if (qrImg) { qrImg.style.visibility = ''; qrImg.src = qrUrl; }
    document.getElementById('successBankName').textContent = BANK_TRANSFER_INFO.bankName;
    document.getElementById('successAccountName').textContent = BANK_TRANSFER_INFO.accountName;
    document.getElementById('successAccountNumber').textContent = BANK_TRANSFER_INFO.accountNumber;
    document.getElementById('successTransferContent').textContent = transferContent || orderId;
  }

  if (payment === 'VNPAY') {
    const note = document.querySelector('.order-success-note');
    if (note) note.textContent = 'Đang chuyển hướng đến cổng thanh toán VNPay…';
  }
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
    return `<div class="community-card" data-id="${escapeAttr(d.designId || '')}">
      <div class="community-card-img-wrap" data-url="${escapeAttr(previewUrl)}" data-prompt="${escapeAttr(d.prompt || '')}" data-style="${escapeAttr(d.style || '')}" data-author="${escapeAttr(d.author || 'Anonymous')}" data-back="${escapeAttr(d.backDesignUrl || '')}" tabindex="0" role="button" aria-label="Thêm mẫu ${escapeAttr(promptShort || 'cộng đồng')} vào áo">
        <img class="community-card-img" src="${escapeAttr(previewUrl)}" alt="${escapeAttr(promptShort || 'Thiết kế cộng đồng')}" loading="lazy" onerror="this.dataset.fbk='1';this.src='${IMAGE_FALLBACK_SVG}'">
      </div>
      <div class="community-card-info">
        <div class="community-card-prompt">"${escapeHtml(d.prompt || '')}"</div>
        <div class="community-card-meta">
          <span class="community-card-author" data-author="${escapeAttr(d.author || 'Anonymous')}"><svg class="community-author-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ${escapeHtml(d.author || 'Anonymous')}</span>
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
  initTabs();
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
  initPrintPreview();
  initBackDesignControls();
  initInteractionMode();
  initOrderFlow();
  initDownload();
  initShareDesign();
  initViewToggle();
  initThreeViewer();
  initHistory();
  initOnboarding();
  loadCommunityDesigns();
  updatePrice();
  // Entry guard: must notify immediately if not authenticated (fix: Studio login-entry)
  // Use rAF + timeout to ensure auth.js init has run and toast.js ready, deduped
  requestAnimationFrame(() => setTimeout(checkStudioAuthOnEntry, 80));

  // Also re-check when auth state changes (e.g., logout then back, or login via modal)
  window.addEventListener('storage', (e) => {
    if (e.key === 'blankup_token' || e.key === 'blankup_user') {
      if (isStudioAuthenticated()) hideStudioAuthPrompt();
      else showStudioAuthPrompt('storage');
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
