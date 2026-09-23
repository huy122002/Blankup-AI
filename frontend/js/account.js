// frontend/js/account.js
const API_BASE = window.location.origin + '/api';

/* ---------- Helpers ---------- */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}
function escapeAttr(str) { return escapeHtml(str).replace(/"/g, '&quot;'); }
function formatMoney(amount) { return Number(amount || 0).toLocaleString('vi-VN') + 'đ'; }
function formatPrice(amount) { return formatMoney(amount); }
function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
const STATUS_META = {
  pending: { label: 'Đang xử lý', cls: 'status-pending' },
  awaiting_payment: { label: 'Chờ thanh toán', cls: 'status-pending' },
  processing: { label: 'Đang sản xuất', cls: 'status-pending' },
  shipped: { label: 'Đã gửi hàng', cls: 'status-pending' },
  delivered: { label: 'Đã giao hàng', cls: 'status-pending' },
  completed: { label: 'Hoàn thành', cls: 'status-completed' },
  cancelled: { label: 'Đã hủy', cls: 'status-cancelled' },
  payment_failed: { label: 'Thanh toán thất bại', cls: 'status-cancelled' },
};
let currentCredits = null;
let availableVouchers = [];
let selectedVoucherCode = ''; // empty = no voucher
let selectedPlanId = null;
// Idempotency key lifecycle: one stable key per (plan, voucher) selection.
// Retries reuse the SAME key so the server replays instead of duplicating.
let accountIdemKey = null;
function newAccountIdemKey(planId) {
  accountIdemKey = 'acc-' + String(planId || 'na') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  return accountIdemKey;
}
let quoteCache = null; // last quote data
let quoteLoading = false;
let currentPlans = [];
let pollingTimer = null;
let pollingAttempts = 0;
let lastPurchaseId = null;
let lastTransferContent = null;

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  loadProfile();
  initProfileForm();
  initPasswordForm();
  let ordersLoaded = false;
  document.querySelector('.account-tab[data-tab="orders"]')?.addEventListener('click', () => {
    if (!ordersLoaded) { ordersLoaded = true; loadOrders(); }
  });
  let creditsLoaded = false;
  document.querySelector('.account-tab[data-tab="credits"]')?.addEventListener('click', () => {
    renderCreditsSummary();
    if (!creditsLoaded) {
      creditsLoaded = true;
      loadCreditLedger();
      loadPlans().then(() => {
        // handle pending plan from pricing.html
        const pending = sessionStorage.getItem('blankup_pending_plan');
        if (pending) {
          sessionStorage.removeItem('blankup_pending_plan');
          const exists = currentPlans.find(p=>p.id===pending);
          if (exists) {
            selectedPlanId = pending;
            setTimeout(()=> openPurchaseModalForPlan(pending), 300);
          }
        }
        // also handle ?plan= query param
        const qp = new URLSearchParams(window.location.search).get('plan');
        if (qp) {
          const existsQ = currentPlans.find(p=>p.id===qp || p.code===qp);
          if (existsQ) { selectedPlanId = existsQ.id; setTimeout(()=> openPurchaseModalForPlan(existsQ.id), 300); }
        }
      });
      loadAvailableVouchers();
      initVoucherUI();
    }
  });
  initPlanPurchaseModal();
  if (window.location.hash === '#orders') document.querySelector('.account-tab[data-tab="orders"]')?.click();
  if (window.location.hash === '#credits') document.querySelector('.account-tab[data-tab="credits"]')?.click();
});

function initTabs() {
  document.querySelectorAll('.account-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.account-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.account-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`panel-${tab.dataset.tab}`)?.classList.add('active');
    });
  });
}

async function loadProfile() {
  try {
    const response = await fetch(`${API_BASE}/auth/me`, { headers: auth.getAuthHeaders() });
    const result = await response.json();
    if (!response.ok || result.success === false) throw new Error(result.error || 'Không thể tải hồ sơ.');
    const user = result.user;
    currentCredits = result.credits || null;
    document.getElementById('accountGreetName').textContent = user.fullName || user.username;
    document.getElementById('profileUsername').value = user.username || '';
    document.getElementById('profileFullName').value = user.fullName || '';
    document.getElementById('profileEmail').value = user.email || '';
    document.getElementById('profileRole').textContent = user.role === 'admin' ? 'Quản trị viên' : 'Khách hàng';
    document.getElementById('profileProvider').textContent = user.provider === 'local' ? 'Tài khoản nội bộ' : (user.provider || '—');
    document.getElementById('profileCreatedAt').textContent = formatDate(user.createdAt);
    if (user.provider && user.provider !== 'local') {
      const card = document.getElementById('passwordCard');
      if (card) card.innerHTML = `<div class="account-card-title">Đổi mật khẩu</div><p class="account-card-desc">Tài khoản của bạn đăng nhập qua ${escapeHtml(user.provider)} và không dùng mật khẩu nội bộ.</p>`;
    }
  } catch (err) {
    showToast(err.message || 'Không thể tải hồ sơ.', 'error');
  }
}

function initProfileForm() {
  const form = document.getElementById('profileForm');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('profileSaveBtn');
    const payload = { username: document.getElementById('profileUsername').value.trim(), fullName: document.getElementById('profileFullName').value.trim(), email: document.getElementById('profileEmail').value.trim() };
    if (!payload.fullName) { showToast('Họ và tên là bắt buộc.', 'warning'); return; }
    btn.disabled = true; const originalText = btn.textContent; btn.textContent = 'Đang lưu...';
    try {
      const response = await fetch(`${API_BASE}/auth/me`, { method: 'PATCH', headers: { ...auth.getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok || result.success === false) throw new Error(result.error || 'Cập nhật thất bại.');
      localStorage.setItem('blankup_user', JSON.stringify(result.user));
      auth.user = result.user;
      document.getElementById('accountGreetName').textContent = result.user.fullName || result.user.username;
      showToast('Đã cập nhật hồ sơ thành công.', 'success');
    } catch (err) { showToast(err.message || 'Cập nhật thất bại.', 'error'); } finally { btn.disabled = false; btn.textContent = originalText; }
  });
}

function initPasswordForm() {
  const form = document.getElementById('passwordForm');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('passwordSaveBtn');
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    if (newPassword.length < 8) { showToast('Mật khẩu mới cần ít nhất 8 ký tự.', 'warning'); return; }
    if (newPassword !== confirmPassword) { showToast('Xác nhận mật khẩu mới không khớp.', 'warning'); return; }
    btn.disabled = true; const originalText = btn.textContent; btn.textContent = 'Đang xử lý...';
    try {
      const response = await fetch(`${API_BASE}/auth/me`, { method: 'PATCH', headers: { ...auth.getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ username: document.getElementById('profileUsername').value.trim(), fullName: document.getElementById('profileFullName').value.trim(), email: document.getElementById('profileEmail').value.trim(), currentPassword, newPassword }) });
      const result = await response.json();
      if (!response.ok || result.success === false) throw new Error(result.error || 'Đổi mật khẩu thất bại.');
      form.reset(); showToast('Đổi mật khẩu thành công.', 'success');
    } catch (err) { showToast(err.message || 'Đổi mật khẩu thất bại.', 'error'); } finally { btn.disabled = false; btn.textContent = originalText; }
  });
}

async function loadOrders() {
  const container = document.getElementById('ordersListContainer');
  try {
    const response = await fetch(`${API_BASE}/orders/me`, { headers: auth.getAuthHeaders() });
    const result = await response.json();
    if (!response.ok || result.success === false) throw new Error(result.error || 'Không thể tải đơn hàng.');
    const orders = result.data || []; const summary = result.summary || {};
    document.getElementById('ordersSummary').style.display = orders.length ? 'flex' : 'none';
    document.getElementById('summaryTotal').textContent = summary.totalOrders || 0;
    document.getElementById('summaryPending').textContent = summary.pendingOrders || 0;
    document.getElementById('summaryCompleted').textContent = summary.completedOrders || 0;
    document.getElementById('summarySpend').textContent = formatMoney(summary.totalSpend || 0);
    if (!orders.length) { container.innerHTML = `<div class="account-empty account-empty-hero"><svg width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.38 3.46 16 2 12 3.46 8 2 3.62 3.46a2 2 0 0 0-1.34 1.89v13.3a2 2 0 0 0 2.66 1.89L8 19l4-1.46L16 19l4.38-1.46a2 2 0 0 0 1.34-1.89V5.35a2 2 0 0 0-1.34-1.89z"/><circle cx="12" cy="10" r="1.2" fill="currentColor" stroke="none"/><path d="M10 15.5c1.2.7 2.8.7 4 0" stroke-width="1.2"/></svg><p class="account-empty-title">Chưa có đơn hàng nào</p><p class="account-empty-desc">Mọi đơn hàng bạn đặt sẽ xuất hiện ở đây. Hãy tạo chiếc áo đầu tiên của riêng bạn ngay bây giờ!</p><a href="studio.html" class="account-empty-cta">Bắt đầu thiết kế chiếc áo đầu tiên →</a></div>`; return; }
    container.innerHTML = orders.map(order => {
      const status = STATUS_META[order.status] || { label: order.status || 'N/A', cls: '' };
      const total = Number(order.total || (order.price || 0) * (order.quantity || 1));
      return `<article class="account-order-card"><div class="account-order-thumb">${order.designUrl ? `<img src="${escapeHtml(order.designUrl)}" alt="Thiết kế đơn ${escapeHtml(String(order.orderId || '').slice(0, 40))}" loading="lazy">` : ''}</div><div class="account-order-body"><div class="account-order-top"><div><span class="account-order-id">#${escapeHtml(String(order.orderId || '').slice(0, 40))}</span> <span class="account-badge ${status.cls}">${escapeHtml(status.label)}</span></div><div class="account-order-price">${formatMoney(total)}</div></div><div class="account-order-meta">${escapeHtml(String(order.productType || 'Áo thun').slice(0, 60))} · Size ${escapeHtml(String(order.size || '—').slice(0, 10))} · SL ${Number(order.quantity || 1)} · ${formatDate(order.createdAt)}</div></div></article>`;
    }).join('');
  } catch (err) { container.innerHTML = `<div class="account-empty">Không thể tải đơn hàng. Vui lòng thử lại sau.</div>`; showToast(err.message || 'Không thể tải đơn hàng.', 'error'); }
}

/* ---------- Credits AI ---------- */
function renderCreditsSummary() {
  const summaryEl = document.getElementById('creditsSummary');
  if (!summaryEl) return;
  if (!currentCredits) { summaryEl.style.display = 'none'; const list = document.getElementById('creditLedgerList'); if (list) list.innerHTML = `<div class="account-empty">Không có thông tin credit cho tài khoản này.</div>`; return; }
  summaryEl.style.display = 'grid';
  document.getElementById('creditHigh').textContent = currentCredits.highCredits ?? 0;
  document.getElementById('creditLow').textContent = currentCredits.lowCredits ?? 0;
  document.getElementById('creditDaily').textContent = `${currentCredits.dailyFreeUsed ?? 0}/${currentCredits.dailyFreeLimit ?? 0}`;
  document.getElementById('creditPlan').textContent = currentCredits.planName || 'Free';
}
async function loadCreditLedger() {
  const container = document.getElementById('creditLedgerList');
  if (!container) return;
  try {
    const response = await fetch(`${API_BASE}/auth/me/credits-ledger`, { headers: auth.getAuthHeaders() });
    const result = await response.json();
    if (!response.ok || result.success === false) throw new Error(result.error || 'Không thể tải lịch sử credit.');
    const rows = result.data || [];
    if (rows.length === 0) { container.innerHTML = `<div class="account-empty"><p class="account-empty-title">Chưa có giao dịch credit</p><p class="account-empty-desc">Credit sẽ được cộng khi bạn nâng gói hoặc nhận ưu đãi, và trừ khi tạo thiết kế.</p></div>`; return; }
    container.innerHTML = rows.map(row => {
      const amount = Number(row.amount) || 0; const typeLabel = row.creditType === 'high' ? 'High' : 'Low';
      return `<article class="account-credit-row"><div class="account-credit-icon ${amount > 0 ? 'credit-in' : 'credit-out'}">${amount > 0 ? '+' : '−'}</div><div class="account-credit-info"><div class="account-credit-title">${amount > 0 ? 'Nhận credit' : 'Dùng credit'} · ${escapeHtml(typeLabel)} <span class="account-credit-note">${escapeHtml(row.note || '')}</span></div><div class="account-credit-date">${formatDate(row.createdAt)}</div></div><div class="account-credit-amount ${amount > 0 ? 'credit-in-text' : 'credit-out-text'}">${amount > 0 ? '+' : ''}${amount}</div></article>`;
    }).join('');
  } catch (err) { container.innerHTML = `<div class="account-empty">Không thể tải lịch sử credit. Vui lòng thử lại sau.</div>`; }
}

/* ---------- Voucher UI (Phase 1D+1E) ---------- */
async function loadAvailableVouchers() {
  try {
    const resp = await fetch(`${API_BASE}/ai-plans/vouchers/available`, { headers: auth.getAuthHeaders() });
    if (!resp.ok) return;
    const data = await resp.json();
    if (data.success) { availableVouchers = data.data || []; renderVoucherList(); }
  } catch (e) { /* silent */ }
}
function renderVoucherList() {
  const container = document.getElementById('voucherAvailableList');
  if (!container) return;
  // keep first radio (no voucher), then add each voucher
  const noVoucher = container.querySelector('input[value=""]')?.parentElement?.outerHTML || '<label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:0.88rem;"><input type="radio" name="voucherChoice" value="" checked> <span>Không dùng voucher</span></label>';
  // rebuild
  container.innerHTML = noVoucher;
  availableVouchers.forEach(v => {
    const label = `${escapeHtml(v.code)} — ${escapeHtml(v.title || v.description || '')} ${v.discountType==='percent' ? v.discountValue+'%' : formatMoney(v.discountValue)}${v.minOrderAmount ? ' (đơn ≥'+formatMoney(v.minOrderAmount)+')' : ''}`;
    const isExpired = v.expiresAt && new Date(v.expiresAt) < new Date();
    const isDisabled = v.status !== 'active' || isExpired;
    const disabledAttr = isDisabled ? ' disabled' : '';
    const hint = isExpired ? ' (hết hạn)' : v.status!=='active' ? ' (tạm tắt)' : '';
    container.innerHTML += `<label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:0.88rem; opacity:${isDisabled ? '0.6' : '1'};"><input type="radio" name="voucherChoice" value="${escapeAttr(v.code)}"${disabledAttr}> <span>${label}${hint}</span></label>`;
  });
  container.querySelectorAll('input[name="voucherChoice"]').forEach(r => {
    r.addEventListener('change', () => {
      const val = container.querySelector('input[name="voucherChoice"]:checked')?.value || '';
      document.getElementById('voucherInput').value = val;
      selectedVoucherCode = val.trim().toUpperCase();
      updateVoucherStatus('', '');
      document.getElementById('voucherQuotePreview').style.display = 'none';
      if (selectedPlanId) triggerQuote(selectedPlanId, selectedVoucherCode);
    });
  });
}
function initVoucherUI() {
  const input = document.getElementById('voucherInput');
  const applyBtn = document.getElementById('voucherApplyBtn');
  const clearBtn = document.getElementById('voucherClearBtn');
  applyBtn?.addEventListener('click', () => {
    const code = (input.value || '').trim().toUpperCase();
    selectedVoucherCode = code;
    // sync radio
    const radios = document.querySelectorAll('input[name="voucherChoice"]');
    let matched = false;
    radios.forEach(r => { if (r.value === code) { r.checked = true; matched = true; } });
    if (!matched && code) {
      // keep manual code even if not in list
      radios.forEach(r => r.checked = false);
    } else if (!code) {
      const no = document.querySelector('input[name="voucherChoice"][value=""]'); if (no) no.checked = true;
    }
    if (!selectedPlanId) { updateVoucherStatus('warning', 'Hãy chọn gói trước khi áp voucher. Voucher sẽ được áp khi bạn bấm Mua.'); return; }
    triggerQuote(selectedPlanId, selectedVoucherCode);
  });
  clearBtn?.addEventListener('click', () => {
    input.value = ''; selectedVoucherCode = '';
    const no = document.querySelector('input[name="voucherChoice"][value=""]'); if (no) no.checked = true;
    document.querySelectorAll('input[name="voucherChoice"]').forEach(r => { if (r.value === '') r.checked = true; else r.checked = false; });
    updateVoucherStatus('', '');
    document.getElementById('voucherQuotePreview').style.display = 'none';
    quoteCache = null;
    if (selectedPlanId) triggerQuote(selectedPlanId, '');
  });
  input?.addEventListener('input', () => {
    // upper-case
    input.value = input.value.toUpperCase();
  });
  input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyBtn?.click(); } });
}

function updateVoucherStatus(type, msg) {
  const el = document.getElementById('voucherStatus');
  if (!el) return;
  const colors = { success: '#16a34a', error: '#dc2626', warning: '#d97706', info: 'var(--text-muted)', '': 'var(--text-muted)' };
  el.style.color = colors[type] || 'var(--text-muted)';
  el.textContent = msg || '';
}

async function triggerQuote(planId, voucherCode) {
  if (quoteLoading) return;
  // New voucher selection = new idempotency key for a new purchase attempt.
  // The key is scoped to (plan, voucher) so changing voucher gets a new key.
  if (planId !== selectedPlanId || voucherCode !== selectedVoucherCode) {
    newAccountIdemKey(planId);
  }
  quoteLoading = true;
  const preview = document.getElementById('voucherQuotePreview');
  const statusTypeMap = {
    'Mã voucher không tồn tại.': 'error',
    'Voucher không hoạt động.': 'error',
    'Voucher chưa bắt đầu.': 'warning',
    'Voucher đã hết hạn.': 'error',
    'Voucher không áp dụng cho gói.': 'warning',
    'Voucher không áp dụng cho gói này.': 'warning',
    'Voucher đã hết lượt sử dụng.': 'error',
    'Bạn đã dùng voucher này tối đa số lần cho phép.': 'error',
  };
  quoteLoading = true;
  updateVoucherStatus('info', 'Đang kiểm tra voucher...');
  try {
    const resp = await fetch(`${API_BASE}/ai-plans/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth.getAuthHeaders() },
      body: JSON.stringify({ planId, voucherCode: voucherCode || undefined })
    });
    const data = await resp.json();
    if (!resp.ok || data.success === false) {
      const errMsg = data.error || 'Không thể áp dụng voucher.';
      let type = 'error';
      for (const k in statusTypeMap) if (errMsg.includes(k.slice(0, 10))) type = statusTypeMap[k];
      if (errMsg.includes('chưa bắt đầu')) type = 'warning';
      if (errMsg.includes('hết hạn')) type = 'error';
      if (errMsg.includes('hết lượt')) type = 'error';
      if (errMsg.includes('tối đa')) type = 'error';
      if (errMsg.includes('không áp dụng')) type = 'warning';
      if (errMsg.includes('tối thiểu')) type = 'warning';
      updateVoucherStatus(type, errMsg);
      if (preview) preview.style.display = 'none';
      quoteCache = null;
      return;
    }
    const d = data.data;
    quoteCache = d;
    // success statuses
    if (voucherCode && d.discountAmount > 0) updateVoucherStatus('success', `Voucher hợp lệ: giảm ${formatMoney(d.discountAmount)}`);
    else if (voucherCode && d.discountAmount === 0 && d.voucher) updateVoucherStatus('info', 'Voucher hợp lệ nhưng không giảm tiền cho gói này (có thể chỉ tặng credit).');
    else if (!voucherCode) updateVoucherStatus('info', 'Không dùng voucher — giá gốc.');
    else updateVoucherStatus('success', 'Voucher đã áp dụng.');

    // preview (backend-sourced only)
    if (preview) {
      preview.style.display = 'block';
      document.getElementById('quotePrice').textContent = formatMoney(d.priceVnd);
      document.getElementById('quoteDiscount').textContent = d.discountAmount > 0 ? '-' + formatMoney(d.discountAmount) : '0đ';
      document.getElementById('quoteFinal').textContent = formatMoney(d.finalAmount);
      const saving = d.discountAmount > 0 ? ` (tiết kiệm ${formatMoney(d.discountAmount)})` : '';
      document.getElementById('quoteSaving').textContent = saving;
      document.getElementById('quoteCredits').textContent = `${d.highCredits} High + ${d.lowCredits} Low`;
      document.getElementById('quoteVoucherCode').textContent = d.voucher ? `Voucher: ${escapeHtml(d.voucher.code)} (${escapeHtml(d.voucher.discountType)} ${escapeHtml(String(d.voucher.discountValue))})` : '';
    }
  } catch (err) {
    updateVoucherStatus('error', err.message || 'Lỗi kiểm tra voucher.');
    if (preview) preview.style.display = 'none';
    quoteCache = null;
  } finally { quoteLoading = false; }
}

/* ---------- AI Plans ---------- */
async function loadPlans() {
  const container = document.getElementById('planList');
  if (!container) return;
  try {
    const resp = await fetch(`${API_BASE}/ai-plans`);
    const result = await resp.json();
    if (!resp.ok || result.success === false) throw new Error(result.error || 'Không thể tải danh sách gói.');
    const plans = (result.data || []).filter(p => p.isPaid && p.priceVnd > 0);
    currentPlans = plans;
    if (plans.length === 0) { container.innerHTML = `<div class="account-empty">Hiện chưa có gói nào khả dụng.</div>`; return; }
    container.innerHTML = plans.map(plan => `
      <div class="account-plan-card" data-plan-id="${escapeAttr(plan.id)}" data-plan-code="${escapeAttr(plan.code)}">
        <div class="account-plan-info">
          <div class="account-plan-name">${escapeHtml(plan.name)}</div>
          <div class="account-plan-desc">${escapeHtml(plan.description || '')}</div>
          <div class="account-plan-credits">
            <span class="plan-credit-high">+${plan.highCredits} High</span>
            ${plan.bonusLowCredits > 0 ? `<span class="plan-credit-low">+${plan.bonusLowCredits} Low</span>` : ''}
            ${plan.dailyFreeLowCredits > 0 ? `<span style="color:var(--text-muted);">· ${plan.dailyFreeLowCredits}/ngày</span>` : ''}
          </div>
        </div>
        <div class="account-plan-action">
          <div class="account-plan-price">${formatMoney(plan.priceVnd)}</div>
          <div style="font-size:0.7rem; color:var(--text-muted);">${escapeHtml(plan.outputQuality || 'high')} · rank ${plan.planRank}</div>
          <button class="btn btn-primary btn-sm plan-buy-btn" data-plan-id="${escapeAttr(plan.id)}">Mua</button>
        </div>
      </div>
    `).join('');
    container.querySelectorAll('.plan-buy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const planId = btn.dataset.planId;
        selectedPlanId = planId;
        // trigger quote with current voucher
        triggerQuote(planId, selectedVoucherCode);
        // scroll to voucher panel so user sees preview
        document.getElementById('voucherPanel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // highlight card
        container.querySelectorAll('.account-plan-card').forEach(c => c.style.outline = '');
        btn.closest('.account-plan-card').style.outline = '2px solid var(--rust)';
        // after short delay, open purchase modal with updated quote? Keep flow: user must confirm after seeing preview, then click Mua again to confirm? Instead we make Buy open modal
        // For better UX: directly open modal with quote embedded
        setTimeout(() => openPurchaseModalForPlan(planId), 400);
      });
    });
  } catch (err) { container.innerHTML = `<div class="account-empty">Không thể tải danh sách gói. ${escapeHtml(err.message)}</div>`; }
}

async function openPurchaseModalForPlan(planId) {
  const plan = currentPlans.find(p => p.id === planId);
  if (!plan) return;
  // Ensure quote fresh
  if (!quoteCache || quoteCache.planId !== planId || (quoteCache.voucher?.code || '') !== (selectedVoucherCode || '')) {
    await triggerQuote(planId, selectedVoucherCode);
  }
  // Generate a fresh idempotency key for this new purchase modal session.
  // Retries within the same modal will reuse this key; changing voucher/plan will
  // create a new key via triggerQuote.
  newAccountIdemKey(planId);
  const q = quoteCache;
  if (!q) { showToast('Không thể lấy giá. Vui lòng thử lại.', 'error'); return; }
  showPlanPurchaseModal({ plan, quote: q });
}

async function purchasePlan(planId) { // legacy entry, redirect to modal
  return openPurchaseModalForPlan(planId);
}

async function confirmPurchase(planId, voucherCode) {
  if (!auth.isLoggedIn()) { showToast('Vui lòng đăng nhập để mua gói.', 'warning'); return; }
  // Use stable idempotency key for this (plan, voucher) session.
  // Reuses the SAME key across retries so the server replays instead of duplicating.
  const idempotencyKey = accountIdemKey || newAccountIdemKey(planId);
  try {
    const resp = await fetch(`${API_BASE}/ai-plans/purchase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': accountIdemKey, ...auth.getAuthHeaders() },
      body: JSON.stringify({ planId, voucherCode: voucherCode || undefined })
    });
    const data = await resp.json();
    if (!resp.ok || data.success === false) throw new Error(data.error || 'Không thể tạo đơn mua.');
    return data;
  } catch (err) { throw err; }
}

function showPlanPurchaseModal({ plan, quote }) {
  const modal = document.getElementById('planPurchaseModal');
  if (!modal) return;
  const title = document.getElementById('planPurchaseTitle');
  const breakdown = document.getElementById('purchaseBreakdown');
  const breakdownPlanName = document.getElementById('breakdownPlanName');
  const breakdownPrice = document.getElementById('breakdownPrice');
  const breakdownDiscountRow = document.getElementById('breakdownDiscountRow');
  const breakdownVoucherCode = document.getElementById('breakdownVoucherCode');
  const breakdownDiscount = document.getElementById('breakdownDiscount');
  const breakdownFinal = document.getElementById('breakdownFinal');
  const breakdownCredits = document.getElementById('breakdownCredits');
  const qrSection = document.getElementById('qrSection');
  const transferSection = document.getElementById('transferSection');
  const paymentBox = document.getElementById('paymentStatusBox');

  // reset
  breakdown.style.display = 'none';
  qrSection.style.display = 'none';
  transferSection.style.display = 'none';
  paymentBox.style.display = 'none';
  document.getElementById('postPurchaseActions').style.display = 'none';
  document.getElementById('planPurchaseInfo').style.display = 'none';

  // fill breakdown from quote (backend truth)
  title.textContent = `Mua gói ${plan.name}`;
  breakdownPlanName.textContent = quote.planName || plan.name;
  breakdownPrice.textContent = formatMoney(quote.priceVnd);
  if (quote.discountAmount > 0) {
    breakdownDiscountRow.style.display = 'flex';
    breakdownVoucherCode.textContent = quote.voucher ? `(${quote.voucher.code})` : '';
    breakdownDiscount.textContent = '-' + formatMoney(quote.discountAmount);
  } else {
    breakdownDiscountRow.style.display = 'none';
  }
  breakdownFinal.textContent = formatMoney(quote.finalAmount);
  breakdownCredits.textContent = `${quote.highCredits} High + ${quote.lowCredits} Low`;
  breakdown.style.display = 'block';

  // show confirm button or create purchase
  let confirmBtn = document.getElementById('confirmPurchaseBtn');
  if (!confirmBtn) {
    confirmBtn = document.createElement('button');
    confirmBtn.id = 'confirmPurchaseBtn';
    confirmBtn.className = 'btn btn-primary';
    confirmBtn.style.width = '100%';
    confirmBtn.style.marginTop = '12px';
    confirmBtn.textContent = 'Tạo đơn & lấy QR';
    document.querySelector('#planPurchaseModal .modal-content').appendChild(confirmBtn);
  }
  confirmBtn.style.display = 'block';
  confirmBtn.disabled = false;
  confirmBtn.textContent = `Thanh toán ${formatMoney(quote.finalAmount)} — Tạo QR`;

  const newBtn = confirmBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
  newBtn.addEventListener('click', async () => {
    newBtn.disabled = true; newBtn.textContent = 'Đang tạo đơn...';
    try {
      const purchase = await confirmPurchase(plan.id, selectedVoucherCode);
      // purchase contains finalAmount, transferContent, bankInfo
      // Update breakdown with purchase final (should match quote)
      breakdownFinal.textContent = formatMoney(purchase.finalAmount);
      breakdownDiscount.textContent = purchase.discountAmount > 0 ? '-' + formatMoney(purchase.discountAmount) : '0đ';
      if (purchase.voucherCode) { breakdownVoucherCode.textContent = `(${purchase.voucherCode})`; breakdownDiscountRow.style.display = 'flex'; }
      breakdownCredits.textContent = `${purchase.highCreditsAdded} High + ${purchase.lowCreditsAdded} Low`;
      // Show QR using backend finalAmount
      const qr = document.getElementById('planPurchaseQr');
      const transferEl = document.getElementById('planPurchaseTransferContent');
      const qrUrl = `https://img.vietqr.io/image/${purchase.bankInfo.bankId}-${purchase.bankInfo.accountNumber}-compact2.png?amount=${purchase.finalAmount}&addInfo=${encodeURIComponent(purchase.transferContent)}&accountName=${encodeURIComponent(purchase.bankInfo.accountName)}`;
      qr.src = qrUrl;
      qrSection.style.display = 'block';
      transferEl.textContent = purchase.transferContent;
      transferSection.style.display = 'block';
      // Polling
      lastPurchaseId = purchase.purchaseId;
      lastTransferContent = purchase.transferContent;
      paymentBox.style.display = 'block';
      document.getElementById('paymentStatusText').textContent = 'Chờ thanh toán';
      document.getElementById('paymentStatusText').style.color = '#d97706';
      document.getElementById('paymentStatusHint').textContent = 'Vui lòng chuyển khoản đúng số tiền và nội dung. Hệ thống sẽ tự xác nhận.';
      document.getElementById('pollingInfo').textContent = 'Đang kiểm tra trạng thái mỗi 5s...';
      document.getElementById('postPurchaseActions').style.display = 'flex';
      newBtn.style.display = 'none';
      startPolling(purchase.purchaseId);
    } catch (err) {
      showToast(err.message || 'Lỗi khi mua gói.', 'error');
      newBtn.disabled = false; newBtn.textContent = `Thanh toán ${formatMoney(quote.finalAmount)} — Tạo QR`;
    }
  });

  modal.style.display = 'flex';
}

function startPolling(purchaseId) {
  stopPolling();
  pollingAttempts = 0;
  const maxAttempts = 60; // 5min
  pollingTimer = setInterval(async () => {
    pollingAttempts++;
    try {
      const resp = await fetch(`${API_BASE}/ai-plans/purchase/${purchaseId}/status`, { headers: auth.getAuthHeaders() });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Lỗi kiểm tra');
      const status = data.paymentStatus;
      const statusText = document.getElementById('paymentStatusText');
      const hint = document.getElementById('paymentStatusHint');
      const pollingInfo = document.getElementById('pollingInfo');
      if (status === 'paid') {
        stopPolling();
        statusText.textContent = 'Thanh toán thành công!';
        statusText.style.color = '#16a34a';
        hint.textContent = 'Credit đã được cộng vào tài khoản.';
        pollingInfo.textContent = '';
        showToast('Thanh toán thành công! Credit đã được cộng.', 'success');
        // refresh credits + ledger
        try {
          const meResp = await fetch(`${API_BASE}/auth/me`, { headers: auth.getAuthHeaders() });
          const meData = await meResp.json();
          if (meData.success) { currentCredits = meData.credits; renderCreditsSummary(); }
          await loadCreditLedger();
        } catch {}
        return;
      } else if (status === 'failed') {
        stopPolling();
        statusText.textContent = 'Thanh toán thất bại';
        statusText.style.color = '#dc2626';
        hint.textContent = 'Đơn đã bị đánh dấu thất bại. Vui lòng liên hệ hỗ trợ.';
        pollingInfo.textContent = '';
        showToast('Thanh toán thất bại.', 'error');
        return;
      } else {
        // pending
        pollingInfo.textContent = `Đang chờ thanh toán... (${pollingAttempts * 5}s)`;
        if (pollingAttempts >= maxAttempts) {
          stopPolling();
          statusText.textContent = 'Thanh toán vẫn đang chờ xác nhận';
          statusText.style.color = '#d97706';
          hint.textContent = 'Nếu bạn đã chuyển khoản, hệ thống sẽ xác nhận trong vài phút. Bấm Kiểm tra lại để cập nhật.';
          pollingInfo.textContent = 'Đã dừng tự động kiểm tra sau 5 phút.';
        }
      }
    } catch (err) {
      console.error('Poll error', err);
    }
  }, 5000);
}
function stopPolling() { if (pollingTimer) { clearInterval(pollingTimer); pollingTimer = null; } }

function initPlanPurchaseModal() {
  document.getElementById('planPurchaseClose')?.addEventListener('click', () => {
    document.getElementById('planPurchaseModal').style.display = 'none';
    stopPolling();
  });
  document.getElementById('planPurchaseModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'planPurchaseModal') { e.target.style.display = 'none'; stopPolling(); }
  });
  document.getElementById('checkAgainBtn')?.addEventListener('click', async () => {
    if (!lastPurchaseId) return;
    document.getElementById('pollingInfo').textContent = 'Đang kiểm tra...';
    try {
      const resp = await fetch(`${API_BASE}/ai-plans/purchase/${lastPurchaseId}/status`, { headers: auth.getAuthHeaders() });
      const data = await resp.json();
      if (data.paymentStatus === 'paid') {
        document.getElementById('paymentStatusText').textContent = 'Thanh toán thành công!';
        document.getElementById('paymentStatusText').style.color = '#16a34a';
        showToast('Thanh toán thành công!', 'success');
        const meResp = await fetch(`${API_BASE}/auth/me`, { headers: auth.getAuthHeaders() });
        const meData = await meResp.json(); if (meData.success) { currentCredits = meData.credits; renderCreditsSummary(); }
        await loadCreditLedger();
        stopPolling();
      } else {
        document.getElementById('pollingInfo').textContent = `Trạng thái: ${data.paymentStatus} — thử lại sau.`;
      }
    } catch (err) { showToast('Không thể kiểm tra.', 'error'); }
  });
  document.getElementById('purchaseCloseDoneBtn')?.addEventListener('click', () => {
    document.getElementById('planPurchaseModal').style.display = 'none';
    stopPolling();
  });
}
